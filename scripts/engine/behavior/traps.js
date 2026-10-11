/**
 * Trap avoiders: a creature whose playstyles keep it wary of traps (behavior trapWary, how watchful: a Thief most, then
 * a Puzzle-Maniac, Skeptic, Lore-Collector, Chicken, Wallflower; less for a pill further down) may spot a hazard. Each one
 * it spots on a luck check at the start of the fight (a d100 at or under the Trap avoiders setting, 59 by default, times
 * how watchful it is), it keeps out of the reach of:
 *  - moving, it goes around the hazard; with no way around, it stops short of it;
 *  - when what it's after is in the hazard's reach, it asks itself whether it wants it badly enough to go in (how badly
 *    it wants it: driven or more, it goes; merely wanting it, it doesn't; determined, it might, the likelier the more);
 *  - starting its turn in a hazard's reach with nobody beside it, it steps out first.
 * Anyone a hazard goes for, hit or miss, knows that hazard from then on and keeps clear of it the same way (learnTrap).
 * Only with positions on the map (the planner's Terrain & positioning).
 */
import { TRAP_LUCK } from "../../constants.js";
import { edgeDistance, isStanding, behaviorOf, canMove, areEnemies } from "../battle-state.js";
import { levelOf } from "./desire.js";

/** How near is too near a hazard: its longest reach (a ranged one's, up to 30 feet), from its edge. */
export function dangerOf(h) {
  let reach = 5;
  for ( const a of h.prep.offense ) reach = Math.max(reach, a.range ? Math.min(30, a.range.max ?? a.range.increment ?? 30) : (a.reach ?? 5));
  return reach;
}

/** At the start of a fight, each trap avoider makes a luck check for each hazard: the ones it spots, it keeps clear of. */
export function spotTraps(run, log) {
  if ( !run.prep.options.positioning ) return;
  const hazards = run.units.filter(h => h.spec.hazard);
  if ( !hazards.length ) return;
  const luck = run.prep.options.trapLuck ?? TRAP_LUCK;
  for ( const u of run.units ) {
    const watchful = Math.min(1, behaviorOf(u).trapWary ?? 0);
    if ( u.spec.hazard || !(watchful > 0) ) continue;
    // (A Thief gets all the luck; the less watchful, a share of it.)
    const needed = Math.round(luck * watchful);
    for ( const h of hazards ) {
      if ( !areEnemies(run, h, u) ) continue; // (a hazard that won't strike it is nothing to keep clear of)
      const luck = run.rng.die(100);
      if ( luck > needed ) continue;
      (u.spottedTraps ??= new Set()).add(h.id);
      log?.(u, { type: "trap", what: "spots", target: h.spec.name, targetId: h.id, luck, needed });
    }
  }
  run.trapsSpotted = run.units.some(u => u.spottedTraps?.size);
}

/**
 * A hazard went for u, hit or miss: u knows it's there and keeps clear of it from now on, trap avoider or not (with
 * positions on the map).
 */
export function learnTrap(run, u, hazard, log) {
  if ( !run.prep.options.positioning || u.spottedTraps?.has(hazard.id) ) return;
  (u.spottedTraps ??= new Set()).add(hazard.id);
  run.trapsSpotted = true;
  log?.(u, { type: "trap", what: "learns", target: hazard.spec.name, targetId: hazard.id });
}

/** The hazards it spotted, still set, whose reach a point (where u would stand) is in. */
export function inDanger(run, u, point) {
  if ( !u.spottedTraps?.size || !point ) return [];
  const there = { pos: point, spec: u.spec };
  return [...u.spottedTraps].map(id => run.byId.get(id))
    .filter(h => h?.pos && isStanding(h) && !h.spent && edgeDistance(there, h) <= dangerOf(h) + 0.5);
}

/**
 * Whether u goes into a hazard's reach for t: decided once a turn, by how badly it wants t (what it would do to or
 * for it). Driven or more: it goes. Merely wanting it: it doesn't. Determined: it might, the likelier the more it wants it.
 */
function wantsBadly(run, u, t, hazard, log) {
  u.trapRisk ??= new Map();
  const key = `${run.round}|${t.id}`;
  if ( u.trapRisk.has(key) ) return u.trapRisk.get(key);
  const level = Math.max(...["hurt", "heal", "protect", "aid"].map(kind => levelOf(u, kind, t.id)));
  const goes = level >= 60 || (level >= 40 && run.rng.chance((level - 40) / 20));
  u.trapRisk.set(key, goes);
  log?.(u, { type: "trap", what: goes ? "braves" : "holds", target: hazard.spec.name, targetId: hazard.id, by: t.spec.name, byId: t.id });
  return goes;
}

/** Where u's move toward t ends instead of `to`, a trap avoider keeping clear of the hazards it spotted. */
export function keepClear(run, u, t, to, log) {
  const near = inDanger(run, u, to);
  if ( !near.length ) return to;
  // What it's after is in the hazard's reach: it goes in only if it wants it badly enough.
  if ( t?.pos && inDanger(run, u, t.pos).length ) return wantsBadly(run, u, t, near[0], log) ? to : short(run, u, to);
  return around(run, u, t, to) ?? short(run, u, to);
}

/** Around the hazard: the same move turned aside (up to a right angle), the one that ends nearest t. */
function around(run, u, t, to) {
  const dx = to.x - u.pos.x;
  const dy = to.y - u.pos.y;
  let best = null;
  for ( const degrees of [20, -20, 45, -45, 70, -70, 90, -90] ) {
    const r = (degrees * Math.PI) / 180;
    const p = { x: u.pos.x + dx * Math.cos(r) - dy * Math.sin(r), y: u.pos.y + dx * Math.sin(r) + dy * Math.cos(r) };
    if ( inDanger(run, u, p).length ) continue;
    const d = t?.pos ? Math.hypot(t.pos.x - p.x, t.pos.y - p.y) : 0;
    if ( !best || d < best.d ) best = { p, d };
  }
  return best?.p ?? null;
}

/** As far along the move as it can go without going near (where it is, if that's already too near). */
function short(run, u, to) {
  const from = { x: u.pos.x, y: u.pos.y };
  if ( inDanger(run, u, from).length ) return from;
  let lo = 0;
  let hi = 1;
  for ( let i = 0; i < 12; i++ ) {
    const m = (lo + hi) / 2;
    if ( inDanger(run, u, { x: from.x + (to.x - from.x) * m, y: from.y + (to.y - from.y) * m }).length ) hi = m;
    else lo = m;
  }
  return { x: from.x + (to.x - from.x) * lo, y: from.y + (to.y - from.y) * lo };
}

/**
 * Starting its turn in the reach of a hazard it spotted, with nobody beside it to slip away from, u steps out first:
 * straight away from it, just far enough, with a move it pays for. Not if what it's after is in there and it wants it
 * badly enough. Returns the feet it stepped (0: it stayed).
 */
export function stepOut(run, u, turn, log) {
  if ( !u.spottedTraps?.size || !u.pos || !canMove(run, u) ) return 0;
  const near = inDanger(run, u, u.pos);
  if ( !near.length ) return 0;
  if ( [...u.adjacent].some(id => { const o = run.byId.get(id); return o && isStanding(o) && !o.spec.hazard && areEnemies(run, u, o); }) ) return 0;
  const t = u.targetId ? run.byId.get(u.targetId) : null;
  if ( t?.pos && isStanding(t) && inDanger(run, u, t.pos).length && wantsBadly(run, u, t, near[0], log) ) return 0;
  const h = near[0];
  const budget = turn.payForMove(u.spec.speeds?.walk ?? 25);
  if ( !budget ) return 0;
  const dx = u.pos.x - h.pos.x;
  const dy = u.pos.y - h.pos.y;
  const len = Math.hypot(dx, dy) || 1;
  const feet = Math.min(budget, dangerOf(h) - edgeDistance(u, h) + 5);
  u.pos.x += (dx / len) * feet;
  u.pos.y += (dy / len) * feet;
  u.feetMoved += feet;
  turn.usedMove(feet);
  run.geo = (run.geo ?? 0) + 1;
  for ( const id of [...u.adjacent] ) {
    run.byId.get(id)?.adjacent.delete(u.id);
    u.adjacent.delete(id);
  }
  log?.(u, { type: "trap", what: "stepsOut", target: h.spec.name, targetId: h.id });
  return feet;
}
