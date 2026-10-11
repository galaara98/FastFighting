/**
 * Expected-value helpers used by behavior decisions. The simulation itself always rolls real dice.
 */
import { meanPart, doubled } from "../dice.js";
import { degreeDistribution } from "../probability.js";
import { attackRoll, attackOptions, currentAc, saveRoll, bonusDamageParts, enemiesOf, isStanding } from "../battle-state.js";
import { costOf, costUnits, mainPool } from "../turn.js";
import { controlValue } from "./control.js";
import { iwrOf } from "./effects.js";
import { critExtraMean } from "./riders.js";
import { castChanceOf } from "./casting.js";

function meanByType(parts) {
  const out = {};
  for ( const p of parts ?? [] ) {
    if ( p.persistent ) continue;
    out[p.type] = (out[p.type] ?? 0) + Math.max(0, meanPart(p));
  }
  return out;
}

function persistentMean(parts) {
  // Persistent damage lasts ~2.5 turns on average (a DC 15 flat check ends it 30% of the time).
  return (parts ?? []).filter(p => p.persistent).reduce((s, p) => s + Math.max(0, meanPart(p)) * 2.5, 0);
}

/** Rough expected value of riders such as afflictions (their stage damage over a few rounds). */
function effectMean(action) {
  let total = 0;
  for ( const e of action.effects ?? [] ) {
    if ( e.kind === "affliction" ) total += 0.5 * (e.stages?.[0]?.damage ?? []).reduce((s, p) => s + meanPart(p), 0) * 2;
    if ( e.kind === "prone" || e.kind === "grabbed" ) total += 1.5;
    // A save on a hit: about half the time it bites (the damage), and the condition is worth a little.
    if ( e.kind === "save" ) total += 0.6 * (e.damage ?? []).reduce((s, p) => s + Math.max(0, meanPart(p)), 0) + (e.conditions ? 0.75 : 0);
  }
  return total;
}

/** A critical hit's damage: the action's own, or the rules' way of making it (PF2e doubles, 5e doubles dice). */
export function criticalParts(rules, parts) {
  return rules.critical ? rules.critical(parts ?? []) : doubled(parts ?? []);
}

/** How much damage a save lets through at each degree, by the system's rules. */
export function saveMultiplier(rules, degree, save) {
  if ( rules.saveMultiplier ) return rules.saveMultiplier(degree, save);
  return degree >= 2 ? (save?.basic === false ? 0 : 0.5) : 1;
}

/** Mean damage of `action` against `target` after IWR, for normal and critical outcomes. Cached per batch. */
export function meanDamageVs(run, action, target) {
  const key = `${action.id}|${target.id}${target.iwrKey ? `|${target.iwrKey}` : ""}`;
  const cache = run.prep.meanCache;
  let hit = cache.get(key);
  if ( hit ) return hit;
  const rules = run.prep.rules;
  const iwr = iwrOf(target); // (with any resistance an effect lends it: Rage, Stoneskin)
  const crit = action.critDamage ?? criticalParts(rules, action.damage);
  const rider = effectMean(action);
  // Rolled several times (magic missiles), and a crit table's extra on a crit.
  const times = action.repeat ? Math.max(1, meanPart(action.repeat)) : 1;
  hit = {
    normal: times * (rules.applyIwr(iwr, meanByType(action.damage)) + persistentMean(action.damage)) + rider,
    critical: times * (rules.applyIwr(iwr, meanByType(crit)) + persistentMean(crit)) + rider + critExtraMean(action.crit)
  };
  cache.set(key, hit);
  return hit;
}

/** Expected damage dealt by one use of `action` from a against t, given attacks already made this turn. */
export function expectedDamage(run, a, action, t, attacksMade = 0) {
  // A spell check that may fail (DCC): what it does when it works, as often as it works.
  if ( action.casting ) return castChanceOf(a, action) * expectedDamage(run, a, { ...action, casting: null }, t, attacksMade);
  // A multiattack is its strikes in order.
  if ( action.sequence?.length ) {
    let total = 0;
    action.sequence.forEach((strike, i) => { total += expectedDamage(run, a, strike, t, attacksMade + i); });
    return total;
  }
  if ( action.kind === "control" ) return controlValue(run, a, action, t, attacksMade);
  const rules = run.prep.rules;
  const dmg = meanDamageVs(run, action, t);
  const targets = areaTargets(run, a, action);
  if ( action.kind === "auto" ) {
    const extra = bonusDamageParts(run, a, action, t).reduce((s, p) => s + Math.max(0, meanPart(p)), 0);
    return targets * (dmg.normal + extra);
  }
  if ( action.kind === "save" && action.save ) {
    const extra = bonusDamageParts(run, a, action, t).reduce((s, p) => s + Math.max(0, meanPart(p)), 0);
    const save = saveRoll(run, t, action.save.type);
    const dist = degreeDistribution(rules, save.mod, action.save.dc, { advantage: save.advantage, kind: "save" });
    return targets * dist.reduce((s, p, d) => s + p * saveMultiplier(rules, d, action.save) * (dmg.normal + extra), 0);
  }
  const roll = attackRoll(run, a, t, action, attacksMade);
  const extraParts = bonusDamageParts(run, a, action, t, { advantage: roll.advantage });
  // A deed die adds what it shows to the damage, as well as to the roll.
  const deed = roll.deed ? (roll.deed + 1) / 2 : 0;
  const extra = extraParts.reduce((s, p) => s + Math.max(0, meanPart(p)), 0) + deed;
  const extraCrit = (extraParts.length ? criticalParts(rules, extraParts).reduce((s, p) => s + Math.max(0, meanPart(p)), 0) : 0) + deed;
  const dist = degreeDistribution(rules, roll.bonus, currentAc(run, t, a, action), attackOptions(roll, { deed: true }));
  return targets * (dist[2] * (dmg.normal + extra) + dist[3] * (dmg.critical + extraCrit));
}

/**
 * How many foes an area really catches: as many as it can take, but no more than are standing against u (a Mass
 * Suggestion for twelve, against two foes, takes two).
 */
export function areaTargets(run, u, action) {
  if ( !action.area ) return 1;
  const most = Math.max(1, action.area.targets ?? 2);
  const foes = enemiesOf(run, u).filter(isStanding).length;
  return Math.max(1, Math.min(most, foes));
}

/** Main-pool units a creature gets each turn (PF2e 3 actions; 5e 1 action). */
export function unitsPerTurn(rules, u) {
  const budget = rules.turn ? rules.turn(u) : { actions: rules.actionsPerTurn ?? 1 };
  return budget[mainPool(rules)] ?? 1;
}

/**
 * A unit's typical damage per round against a foe: its best action used as often as a turn allows (plus its best
 * bonus-action attack, where the system has them). Targeting and morale ask this constantly, so it is worked out
 * once per pair per round (within a round it barely changes).
 *
 * What a debuff is worth depends on how dangerous its target is, which depends on that target's own debuffs: worked
 * out inside another such estimate, a creature's control counts for its damage only, so the two never chase each
 * other round and round.
 */
/** Rounds a fight typically lasts, for spreading a creature's limited spells and items over it. */
const TYPICAL_ROUNDS = 3;

export function threatOf(run, u, versus) {
  if ( run.threatRound !== run.round ) {
    run.threatRound = run.round;
    run.threatCache = new Map();
    run.threatCacheInner = new Map();
  }
  const inner = (run.threatDepth ?? 0) > 0;
  const cache = inner ? (run.threatCacheInner ??= new Map()) : run.threatCache;
  let row = cache.get(u);
  if ( !row ) cache.set(u, row = new Map());
  const cached = row.get(versus);
  if ( cached !== undefined ) return cached;
  run.threatDepth = (run.threatDepth ?? 0) + 1;
  try {
    const best = threatNow(run, u, versus);
    row.set(versus, best);
    return best;
  } finally {
    run.threatDepth -= 1;
  }
}

function threatNow(run, u, versus) {
  const rules = run.prep.rules;
  const main = mainPool(rules);
  const perTurn = unitsPerTurn(rules, u);
  let bestMain = 0;
  let bestBonus = 0;
  for ( const action of u.prep.offense ) {
    const cost = costOf(rules, action);
    if ( cost.bonus && !cost[main] ) {
      bestBonus = Math.max(bestBonus, expectedDamage(run, u, action, versus, 0));
      continue;
    }
    const each = Math.max(1e-9, cost[main] ?? 1);
    let total = 0;
    let made = 0;
    for ( let spent = 0; spent + each <= perTurn + 1e-9; spent += each ) {
      total += expectedDamage(run, u, action, versus, made);
      made += attacksIn(action);
      if ( Number.isFinite(action.uses) || action.resource ) break;
    }
    // A spell or item it can only use so often counts in a round's threat only as far as what's left could last a
    // typical fight (a single Meteor Swarm isn't three rounds of Meteor Swarms).
    const left = action.resource ? (u.resources[action.resource] ?? 0) : Number.isFinite(action.uses) ? (u.uses?.[action.id] ?? action.uses) : Infinity;
    if ( Number.isFinite(left) ) total *= Math.min(1, left / TYPICAL_ROUNDS);
    bestMain = Math.max(bestMain, total);
  }
  return bestMain + bestBonus;
}

/** Attack rolls one use makes (for the multiple attack penalty): a multiattack makes several. */
export function attacksIn(action) {
  if ( action.sequence?.length ) return action.sequence.filter(countsAsAttack).length;
  return countsAsAttack(action) ? 1 : 0;
}

export function countsAsAttack(action) {
  // Control: an attack roll counts; so does a skill with the attack trait (PF2e Trip); a save or a mark doesn't.
  if ( action.kind === "control" ) {
    if ( action.save || action.auto || (action.outcome && !action.onHit) ) return false;
    if ( action.check ) return !!action.check.attack;
    return action.attack !== false;
  }
  return action.attack !== false && (action.kind === "strike" || action.kind === "spell-attack");
}

export function hasUses(u, action) {
  if ( u.lost?.has(action.id) ) return false; // a spell lost to a failed check (DCC)
  if ( action.resource ) return (u.resources[action.resource] ?? 0) > 0;
  if ( Number.isFinite(action.uses) ) return (u.uses[action.id] ?? 0) > 0;
  return true;
}

export function spendUse(u, action) {
  if ( action.resource ) u.resources[action.resource] -= 1;
  else if ( Number.isFinite(action.uses) ) u.uses[action.id] -= 1;
}

export { costOf, costUnits };
