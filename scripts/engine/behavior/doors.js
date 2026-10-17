/**
 * Doors in the way. A closed door between a creature and what it's after is walked to and opened; a locked one has
 * to be got through, by whoever wants it badly enough, the quickest way that creature has:
 *   force  bash it open (5e Strength/Athletics, PF2e Force Open), if the creature is strong enough to try
 *   attack hack it down with its best weapon, against the door's defense and hit points (the system says how much
 *          of a blow gets through)
 *   pick   pick the lock (thieves' tools, Thievery), if it has the skill and the tools
 *
 * The core knows only the shape of it. The system says what a door is like (rules.door: its defense, hit points and
 * the DCs to force or pick it, plus anything its own rules need), what each way costs (rules.doorCosts), and how much
 * of a blow gets through (rules.doorDamage: PF2e takes off Hardness, 5e has a damage threshold); the helper says what
 * a creature can bring to it (spec.doorWork: {force: {mod}, pick: {mod}}). A system with its own way of forcing or
 * picking one plays the try itself (rules.tryDoor(run, u, door, {method, mod, dc}): {success, degree, said: {text}},
 * or null for the core's check: Ironsworn's Face Danger). Each failed try wears down the desire that brought it there.
 */
import { degreeDistribution } from "../probability.js";
import { costOf, costUnits, normalizeCost, mainPool } from "../turn.js";
import { meanPart } from "../dice.js";
import { bestReactionStrike } from "./reactions.js";
import { isAnimalistic } from "./animal.js";

/** A plain door, where the system says nothing. */
const DEFAULT_DOOR = Object.freeze({ ac: 15, hp: 20, forceDC: 15, pickDC: 15 });

/** How much of a blow gets through to a door, by the system's rules (all of it, if it has none). */
export function doorDamage(rules, door, damage) {
  return Math.max(0, rules.doorDamage ? rules.doorDamage(door, damage) : damage);
}

/** The fight's doors: the scene's, filled out with the system's typical door. */
export function prepareDoors(spec, rules) {
  return new Map(Object.entries(spec.doors ?? {}).map(([id, d]) => [id, { id, ...DEFAULT_DOOR, ...(rules.door ?? {}), ...d }]));
}

/** Each fight starts with the doors as the scene has them. */
export function doorStates(prep) {
  return new Map([...(prep.doors ?? new Map())].map(([id, d]) => [id, { open: false, locked: !!d.locked, hp: d.hp, broken: false }]));
}

const feetBetween = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

/**
 * The first closed door between u and t on the way the fight found (if it's still on the way: u may have gone
 * round, or already be through). Returns the door's data or null.
 */
export function doorAhead(run, u, t) {
  if ( !run.doors?.size || !u.pos || !t.pos ) return null;
  const ids = run.prep.approachOf(u.id, t.id)?.doors;
  if ( !ids?.length ) return null;
  const straight = feetBetween(u.pos, t.pos);
  for ( const id of ids ) {
    const state = run.doors.get(id);
    if ( !state || state.open ) continue;
    const door = run.prep.doors.get(id);
    // Still roughly between them?
    if ( feetBetween(u.pos, door) + feetBetween(door, t.pos) > straight * 1.6 + 10 ) continue;
    return door;
  }
  return null;
}

/** Is u standing at the door (within reach of it)? */
export function atDoor(u, door) {
  return !!u.pos && feetBetween(u.pos, door) <= 5 + (u.spec.position?.size ?? 5) / 2 + 0.5;
}

/**
 * The quickest way u has through a locked door: {method, cost, chance, perTry, turns, strike?} (turns: how many of
 * its turns it should take), or null if it has none.
 */
export function doorPlan(run, u, door, state) {
  const rules = run.prep.rules;
  // A turn's worth of main actions (PF2e three, 5e one).
  const perTurn = Math.max(1, (rules.turn ? rules.turn(u) : { actions: rules.actionsPerTurn ?? 1 })[mainPool(rules)] ?? 1);
  const costs = rules.doorCosts ?? {};
  const basic = rules.basicAction ?? 1;
  const plans = [];
  const check = (method, work, dc) => {
    if ( !work || !Number.isFinite(work.mod) ) return;
    const dist = degreeDistribution(rules, work.mod, dc, { kind: "check", roller: u, faces: work.faces });
    const chance = (dist[2] ?? 0) + (dist[3] ?? 0);
    if ( chance <= 0 ) return;
    const cost = normalizeCost(rules, costs[method] ?? basic);
    plans.push({ method, cost, chance, turns: costUnits(rules, cost) / (chance * perTurn), mod: work.mod, dc, faces: work.faces });
  };
  check("force", u.spec.doorWork?.force, door.forceDC);
  // (An animal picks no lock: behavior/animal.js.)
  if ( !isAnimalistic(u) ) check("pick", u.spec.doorWork?.pick, door.pickDC);
  const strike = bestReactionStrike(u);
  if ( strike ) {
    const dist = degreeDistribution(rules, strike.bonus ?? 0, door.ac, { kind: "attack", roller: u });
    const hit = (dist[2] ?? 0) + (dist[3] ?? 0);
    const dmg = doorDamage(rules, door, (strike.damage ?? []).reduce((s, p) => s + meanPart(p), 0));
    if ( hit > 0 && dmg > 0 ) {
      const cost = costOf(rules, strike, u);
      const tries = Math.ceil(Math.max(1, state.hp) / (hit * dmg));
      plans.push({ method: "attack", cost, chance: hit, strike, turns: (tries * costUnits(rules, cost)) / perTurn });
    }
  }
  return plans.sort((a, b) => a.turns - b.turns)[0] ?? null;
}

/** How many turns at a locked door a desire of this level is worth (an obsession will hammer away for six). */
export function patienceFor(level) {
  return Math.max(0.5, level / 15);
}
