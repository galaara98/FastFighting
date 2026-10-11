/**
 * Points spent after a roll to make it good (DCC: burning Luck). Unlike fate (a reroll when someone would die, see
 * the simulator), these add to a roll the spender sees fall short, and they're gone for good unless the system says
 * they come back.
 *
 * spec.boosts: [{pool, label, per?, faces?, allies?, kinds?, keep?, recovers?}]
 *   pool      the resources key spent (spec.resources[pool]: how much there is to spend)
 *   per       added for each point (default 1; a DCC halfling's count double)
 *   faces     instead, a die rolled for each point (a DCC thief's luck die)
 *   allies    added for each point spent on a friend's roll (0 or unset: only its own)
 *   range     how near the friend has to be, in feet (unset: anywhere it can tell what's happening)
 *   kinds     the rolls it may go on: "attack", "save", "cast", "check" (default: all)
 *   keep      it won't go below this, unless a life is at stake
 *   recovers  it comes back (a DCC thief's or halfling's Luck): spent more freely
 *   shared    a key: a pool several creatures draw on together (DCC's Fleeting Luck, a player's for all its
 *             characters), kept in run.sharedPools[key] (set from the first of them: spec.resources[pool])
 *
 * How readily: by what's at stake (the caller says, 0 to 1: a save against a killing blow is near 1, an ordinary
 * swing low), how much is left, and, for a friend's roll, how selfish the spender is.
 * Pure: no Foundry globals.
 */
import { clamp, STATUS } from "../../constants.js";
import { isStanding, liveTrait, areEnemies, edgeDistance } from "../battle-state.js";
import { regrade } from "../probability.js";
import { perceives } from "./senses.js";

const left = (run, u, b) => (b.shared ? run.sharedPools?.[b.shared] ?? 0 : u.resources[b.pool] ?? 0);

/** What one point adds, on average and as rolled: on its own roll, or on a friend's. */
function pointValue(b, own) {
  if ( !own ) return { mean: b.allies ?? 0, roll: () => b.allies ?? 0 };
  if ( b.faces ) return { mean: (b.faces + 1) / 2, roll: rng => rng.die(b.faces) };
  const per = b.per ?? 1;
  return { mean: per, roll: () => per };
}

/** Who could pay for roller's roll: itself first, then a friend who can spend on others and sees it happen. */
function payers(run, roller, kind) {
  const out = [];
  for ( const b of roller.spec.boosts ?? [] ) {
    if ( (!b.kinds || b.kinds.includes(kind)) && left(run, roller, b) > 0 ) out.push({ u: roller, b, own: true });
  }
  for ( const a of run.units ) {
    if ( a === roller || !isStanding(a) || areEnemies(run, a, roller) || !a.spec.boosts ) continue;
    for ( const b of a.spec.boosts ) {
      if ( !b.allies || (b.kinds && !b.kinds.includes(kind)) || left(run, a, b) <= 0 ) continue;
      const d = b.range ? edgeDistance(a, roller) : null;
      if ( d !== null && d > b.range ) continue;
      if ( perceives(run, a, roller, { crisis: true }) ) out.push({ u: a, b, own: false });
    }
  }
  return out;
}

/**
 * A roll that fell short: does someone spend to make it? Returns the roll as it now stands (total and degree may
 * change) and logs the spending. `stakes` 0..1.
 * @param {object} run
 * @param {object} roller   who made the roll
 * @param {object} roll     {natural, total, degree}
 * @param {number} dc
 * @param {object} ctx      {kind: "attack"|"save"|"cast"|"check", stakes, options: the roll's die options, label}
 * @param {Function} log    (unit, data): the run's log
 */
export function boost(run, roller, roll, dc, { kind, stakes = 0.3, options = {}, label = "" } = {}, log = null) {
  if ( !roll || roll.degree >= 2 || !Number.isFinite(dc) || !Number.isFinite(roll.total) ) return roll;
  if ( roller.status === STATUS.DEAD ) return roll;
  const rules = run.prep.rules;
  for ( const { u, b, own } of payers(run, roller, kind) ) {
    const value = pointValue(b, own);
    if ( !(value.mean > 0) ) continue;
    const need = dc - roll.total;
    const points = Math.ceil(need / value.mean);
    const available = left(run, u, b) - (stakes >= 0.85 ? 0 : (b.keep ?? 0));
    const cap = stakes >= 0.85 ? available : Math.min(available, b.recovers ? 4 : 2);
    if ( points > cap ) continue;
    let p = clamp(stakes * (b.recovers ? 1.2 : 0.8), 0, 0.95);
    if ( !own ) p *= clamp(1 - liveTrait(run, u, "selfish") / 100, 0.05, 0.95);
    if ( !run.rng.chance(p) ) continue;
    // Spend a point at a time until it's enough (a rolled die may need more, or fewer, than reckoned).
    let spent = 0;
    let total = roll.total;
    while ( total < dc && spent < cap ) {
      total += value.roll(run.rng);
      spent += 1;
    }
    if ( b.shared ) run.sharedPools[b.shared] -= spent;
    else u.resources[b.pool] -= spent;
    const next = { ...roll, total, boosted: spent };
    next.degree = regrade(rules, next, dc, kind === "cast" ? "check" : kind, options);
    log?.(u, {
      type: "boost", target: roller.spec.name, targetId: roller.id, self: own, label: b.label ?? b.pool, spent, from: roll.total, to: total,
      dc, made: next.degree >= 2, kind
    });
    return next;
  }
  return roll;
}

