/**
 * Leaving the fight (its nerve gone, talked into going, a retreat called): a creature that means to go doesn't
 * vanish. It wants nothing so much as to be off the map (a desire to leave, as strong as any), lets go of its quarrel
 * with whoever talked it into going (all its foes, when its own nerve sent it), and on its turns makes for the nearest
 * way off, as fast as it goes: it can still be struck, or talked to, on the way. At the edge it's gone (fled). One with
 * no way off has one turn more, then is gone all the same. It doesn't keep its side in the fight, and one still on its
 * way when the fight ends has gone.
 *
 * What the map tells it, all optional:
 *   spec.bounds {x0, y0, x1, y1}   the map's edges, in feet (foundry/battle.js: the scene's)
 *   run.live.exitOf(u)             the way off from where it stands, around the walls (a live battle's: its scene's):
 *                                  {path: [[x, y], ...], its turning points from where it stands; feet, how far}, or
 *                                  {none: true}: there's none; null where it can't tell (straight to the nearest edge)
 * Without positions or edges, it's gone at once, as before.
 */
import { STATUS, LEAVE_RESOLVE, clamp } from "../../constants.js";
import { ORDER_WEIGHTS } from "../playstyles.js";
import { areEnemies, liveTrait } from "../battle-state.js";

/** Desires toward others that leaving lays down: whatever would keep it in the quarrel. */
const QUARREL = new Set(["hurt", "bind", "rob", "avoid"]);

/**
 * Stopped on its way (struck, or spoken to): of the world's Committed to leaving share (options.leaveResolve, 79% by
 * default), how much a creature's nature holds it to going. All of it for one whose answers and pills lean that way
 * (retreating once hurt, never answering back; a Chicken, a Wallflower), less for each that pulls it back into the
 * fight, by how much that pill counts (its place, playstyles.js ORDER_WEIGHTS), but never under MOST_PULL of it.
 */
const PULLS = Object.freeze({
  attack: Object.freeze({ vengeful: 0.25, relentless: 0.2, brawler: 0.15, tank: 0.15, cruel: 0.1, martyr: 0.1, leader: 0.1, instigator: 0.05, redeemSeeker: 0.05 }),
  talk: Object.freeze({ diplomat: 0.2, peacekeeper: 0.2, peoplePleaser: 0.15, redeemSeeker: 0.1, moralist: 0.1, mercenary: 0.1, instigator: 0.05, leader: 0.05 })
});
/** When it retreats (its tactics answer): readily once hurt, as the battle turns, never if it can help it. */
const RETREAT_PULL = Object.freeze({ hurt: 0, losing: 0.1, never: 0.3 });
/** How readily it talks (its tactics answer): spoken to, the readier it is, the more it stops to answer. */
const TALK_PULL = Object.freeze({ never: 0, opportune: 0.05, first: 0.1, always: 0.2 });
const MOST_PULL = 0.3;
/** Each time it's stopped, its wish to go falls this far (more as its nature pulls it back), and under FORGET it's gone. */
const STOPPED_BY = 15;
const FORGET = 40;

/** Can u leave the long way (walk off the map), rather than be gone at once? */
export const mayLeave = (run, u) => !!(u.pos && run.prep?.spec?.bounds && !run.standoff);

/** Is u still leaving, and on its way (not stopped to deal with something), in the fight to do it? */
export const isLeaving = u => !!u.leaving && !u.leaving.stopped && u.status === STATUS.STANDING;

/** How much of the world's share u's nature holds it to leaving when `cause` ("attack", "talk") would stop it: 0.7 to 1. */
export function commitment(run, u, cause) {
  let pull = RETREAT_PULL[u.tac?.retreat] ?? 0.05;
  if ( cause === "talk" ) pull += TALK_PULL[u.tac?.talk] ?? 0.05;
  // (The brave turn to face what strikes them.)
  if ( cause === "attack" ) pull += 0.1 * Math.max(0, liveTrait(run, u, "brave") - 50) / 50;
  (u.spec.playstyles ?? []).forEach((id, i) => { pull += (PULLS[cause]?.[id] ?? 0) * (ORDER_WEIGHTS[i] ?? 0); });
  return 1 - clamp(pull, 0, MOST_PULL);
}

/**
 * Something would stop u on its way off the map: `by`'s blow, or its words (`cause` "attack", "talk"). Its nature
 * decides (commitment): it keeps going, or turns to deal with it, that first and leaving second, its wish to go the
 * less for it; stopped often enough, it forgets going altogether. Every blow, every word, is a try. Returns what came of
 * it ({kept, roll, needed, forgot}), or null when u isn't leaving.
 */
export function confronted(run, u, by, cause, log = null) {
  const l = u.leaving;
  if ( !l || u.status !== STATUS.STANDING || !by || by === u ) return null;
  const share = clamp(Number(run.prep?.options?.leaveResolve ?? LEAVE_RESOLVE), 0, 100);
  const how = commitment(run, u, cause);
  const needed = Math.round(share * how);
  const roll = run.rng.die(100);
  if ( roll <= needed ) return { kept: true, roll, needed, forgot: false };
  l.level = (l.level ?? 100) - Math.round(STOPPED_BY * (1 + (1 - how) / MOST_PULL));
  const forgot = l.level < FORGET;
  const what = cause === "talk" ? "talk" : "hurt";
  if ( forgot ) {
    // (Going forgotten: it's in the fight again, stirred against whoever stopped it, as anything that stirs it fades.)
    stopLeaving(u);
    u.desire?.memory.set(`${what}|${by.id}`, Math.max(u.desire.memory.get(`${what}|${by.id}`) ?? 0, FORGET + 1));
  } else {
    // (What stopped it, first; going, second: back on its way once it has dealt with that, unless something else stops it.)
    if ( l.stopped ) u.desire?.stated.delete(`${l.stopped.kind}|${l.stopped.byId}`);
    l.stopped = { cause, kind: what, byId: by.id, acted: false };
    l.whole = 0; // (its turns given to going start over)
    u.desire?.stated.set(`leave|${u.id}`, l.level);
    u.desire?.stated.set(`${what}|${by.id}`, clamp(l.level + 1, 0, 100));
  }
  log?.(u, { type: "leaveStopped", cause, by: by.spec.name, byId: by.id, roll, needed, forgot });
  return { kept: false, roll, needed, forgot };
}

/** u's own turn begins: stopped on its way, it gives this turn to what stopped it. */
export function dealsWithIt(u) {
  if ( u.leaving?.stopped ) u.leaving.stopped.acted = true;
}

/**
 * u's own turn is done: stopped on its way, and with this turn given to what stopped it (nothing new stopping it since),
 * it's on its way again; what stopped it wants as much as it did before.
 */
export function backOnItsWay(run, u) {
  const s = u.leaving?.stopped;
  if ( !s?.acted ) return;
  u.desire?.stated.delete(`${s.kind}|${s.byId}`);
  u.leaving.stopped = null;
  layDown(run, u); // (what the turn stirred, laid down again)
}

/**
 * u means to go: off the map, its quarrel with `by`'s side laid down (with all its foes when nobody talked it into
 * it). It stays in the fight until it's off. Returns u.leaving.
 */
export function startLeaving(run, u, { by = null, why = null } = {}) {
  u.leaving = { round: run.round, bySide: by?.side ?? null, byId: by?.id ?? null, why, turns: 0, level: 100, stopped: null };
  u.ranRound = run.round; // (seen running: its friends take it hard)
  layDown(run, u);
  // (Nothing it wants as badly: held there for as long as it's leaving.)
  u.desire?.stated.set(`leave|${u.id}`, 100);
  return u.leaving;
}

/** u's quarrel laid down, as it sets out: with whoever talked it into going (their side), else with all its foes. */
function layDown(run, u) {
  const d = u.desire;
  if ( !d || !u.leaving ) return;
  const side = u.leaving.bySide;
  const done = o => !!o && o !== u && (side ? o.side === side : areEnemies(run, u, o));
  for ( const layer of ["stated", "memory", "frustration", "logic", "social", "style", "lean", "taunt", "puppet"] ) {
    const m = d[layer];
    if ( !m ) continue;
    for ( const k of [...m.keys()] ) {
      const at = k.indexOf("|");
      if ( QUARREL.has(k.slice(0, at)) && done(run.byId.get(k.slice(at + 1))) ) m.delete(k);
    }
  }
}

/** u gives up leaving: it's in the fight as before. */
export function stopLeaving(u) {
  u.leaving = null;
  u.desire?.stated.delete(`leave|${u.id}`);
}

/**
 * The way off from where u stands: the path its map gives it (from about where u is), else straight to the nearest
 * edge. {points: [[x, y], ...], feet} (feet to go), or null when there's no way off.
 */
export function wayOff(run, u) {
  const exit = run.live?.exitOf?.(u) ?? null;
  if ( exit?.none ) return null;
  const path = Array.isArray(exit?.path) && exit.path.length ? exit.path : null;
  if ( path && Math.hypot(path[0][0] - u.pos.x, path[0][1] - u.pos.y) <= 10 ) {
    const points = [[u.pos.x, u.pos.y], ...path.slice(1)];
    return { points, feet: lengthOf(points) };
  }
  const b = run.prep.spec.bounds;
  const { x, y } = u.pos;
  const clampX = v => Math.min(b.x1, Math.max(b.x0, v));
  const clampY = v => Math.min(b.y1, Math.max(b.y0, v));
  const edges = [[b.x0, y], [b.x1, y], [x, b.y0], [x, b.y1]].map(([ex, ey]) => [clampX(ex), clampY(ey)]);
  const to = edges.reduce((best, p) => (Math.hypot(p[0] - x, p[1] - y) < Math.hypot(best[0] - x, best[1] - y) ? p : best));
  return { points: [[x, y], to], feet: Math.hypot(to[0] - x, to[1] - y) };
}

const lengthOf = points => points.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);

/**
 * u goes `feet` along its way off: where it ends up, whether it's off the map, and the rest of the way. Moves u.pos.
 * {feet, off, from, to, rest}.
 */
export function goAlong(run, u, way, feet) {
  const from = { x: u.pos.x, y: u.pos.y };
  let left = Math.max(0, feet);
  let walked = 0;
  const pts = way.points;
  let i = 1;
  for ( ; i < pts.length && left > 0; i++ ) {
    const [ax, ay] = [u.pos.x, u.pos.y];
    const [bx, by] = pts[i];
    const d = Math.hypot(bx - ax, by - ay);
    const step = Math.min(left, d);
    if ( d > 0 ) {
      u.pos.x = ax + ((bx - ax) / d) * step;
      u.pos.y = ay + ((by - ay) / d) * step;
    }
    left -= step;
    walked += step;
    if ( step < d ) break;
  }
  run.geo = (run.geo ?? 0) + 1;
  u.feetMoved = (u.feetMoved ?? 0) + walked;
  const off = walked >= way.feet - 0.5;
  // (What's left of it: from here, on past the turning points behind.)
  const ahead = pts.slice(i).filter(p => Math.hypot(p[0] - u.pos.x, p[1] - u.pos.y) > 0.01);
  const rest = { points: [[u.pos.x, u.pos.y], ...ahead], feet: Math.max(0, way.feet - walked) };
  return { feet: Math.round(walked), off, from, to: { x: u.pos.x, y: u.pos.y }, rest };
}
