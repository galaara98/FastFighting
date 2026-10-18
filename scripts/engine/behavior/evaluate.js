/**
 * Expected-value helpers used by behavior decisions. The simulation itself always rolls real dice.
 */
import { meanPart, doubled } from "../dice.js";
import { degreeDistribution } from "../probability.js";
import { attackRoll, attackOptions, currentAc, saveRoll, bonusDamageParts, enemiesOf, isStanding, isMagical, upgradesSave, boostBonus, liveTier, inArea } from "../battle-state.js";
import { TACTICAL } from "../../constants.js";
import { costOf, costUnits, mainPool } from "../turn.js";
import { controlValue } from "./control.js";
import { iwrOf, outcomeWorth } from "./effects.js";
import { critExtraMean } from "./riders.js";
import { castChanceOf } from "./casting.js";
import { stepOf } from "./afflictions.js";
import { hasTrait } from "../conditions.js";
import { withManeuver } from "../maneuvers.js";

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
    // (Moved, by the blow or a failed save: about as much, more where it would hurt, which the planner can't see.)
    if ( e.kind === "move" || e.move ) total += 1.5;
    // A save on a hit: about half the time it bites (the damage), and the condition is worth a little.
    if ( e.kind === "save" ) total += 0.6 * (e.damage ?? []).reduce((s, p) => s + Math.max(0, meanPart(p)), 0) + (e.conditions ? 0.75 : 0);
  }
  return total;
}

/** Does the action lay an affliction (a poison, a disease, a curse)? */
const afflicts = action => !!action.effects?.some(e => e.kind === "affliction");

/** Rounds an affliction's stage is reckoned to last, for its worth (no more than the fight will: effects.js usefulRounds). */
const AFFLICTION_ROUNDS = 10;

/** Each way an affliction's own exposure save may go for t: [[chance, stages it takes hold by]] (no save: it takes hold). */
function exposureSteps(run, t, e) {
  const rules = run.prep.rules;
  if ( !e.save ) return [[1, 1]];
  const save = saveRoll(run, t, e.save.type, { action: e });
  const dist = upgradedDistribution(degreeDistribution(rules, save.mod, e.save.dc, { advantage: save.advantage, kind: "save", roller: t }), t, e.save.type);
  return dist.map((p, d) => [p, stepOf(rules, d, "exposure")]);
}

/**
 * What the afflictions an action lays would do to t besides their damage (effectMean counts that): the conditions and
 * penalties of the stage each would take hold at, worth what any outcome's are (effects.js outcomeWorth), as often as
 * it would take hold once the action has landed: by its own exposure save, or (bySave) as the action's own save went,
 * at `degree`. Not one already on t, nor one it's immune to, nor deep inside another estimate (threatOf).
 */
function afflictionWorth(run, a, action, t, degree = null) {
  if ( (run.threatDepth ?? 0) >= 2 ) return 0;
  const rules = run.prep.rules;
  let total = 0;
  for ( const e of action.effects ?? [] ) {
    if ( e.kind !== "affliction" || !e.stages?.length ) continue;
    if ( t.afflictions?.some(x => x.spec.id === e.id) || t.spec.iwr?.immune?.some(k => e.traits?.includes(k)) ) continue;
    const steps = e.bySave && degree !== null ? [[1, stepOf(rules, degree, "exposure")]] : exposureSteps(run, t, e);
    for ( const [p, step] of steps ) {
      if ( !(p > 0) || !(step > 0) ) continue;
      const stage = e.stages[Math.min(e.stages.length, Math.max(1, (Number(e.start) || 1) - 1 + step)) - 1];
      if ( !stage?.conditions && !stage?.mods ) continue;
      const worth = outcomeWorth(run, a, t, { conditions: stage.conditions, mods: stage.mods, rounds: Number(e.maxDuration) || AFFLICTION_ROUNDS });
      total += p * Math.max(0, -worth);
    }
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

/**
 * As saveMultiplier, for this target: one with evasion against this kind of save (spec.evasion: "dex") takes less
 * from damage it can save for half (the system's rules.evasion; by default 5e's: none on a success, half on a failure).
 */
export function saveMultiplierFor(rules, degree, save, target) {
  const evades = target?.spec.evasion && save?.basic !== false && [].concat(save?.type).includes(target.spec.evasion);
  if ( !evades ) return saveMultiplier(rules, degree, save);
  if ( rules.evasion ) return rules.evasion(degree, save);
  return degree >= 2 ? 0 : 0.5 * saveMultiplier(rules, degree, save);
}

/** A save's chances by degree, with a success counting as a critical success for whoever upgrades this save. */
export function upgradedDistribution(dist, t, type) {
  return upgradesSave(t, type) ? [dist[0], dist[1], 0, dist[2] + dist[3]] : dist;
}

/** Mean damage of `action` against `target` after IWR, for normal and critical outcomes. Cached per batch. */
export function meanDamageVs(run, action, target) {
  // (An action with no id of its own can't be told from another: worked out each time.)
  if ( action.id === undefined || action.id === null ) return meanDamageNow(run, action, target);
  // (Kept by the action, then the target, then what the target resists just now.)
  let byTarget = run.prep.meanCache.get(action.id);
  if ( !byTarget ) run.prep.meanCache.set(action.id, byTarget = new Map());
  let byIwr = byTarget.get(target.id);
  if ( !byIwr ) byTarget.set(target.id, byIwr = new Map());
  const iwrKey = target.iwrKey ?? "";
  let hit = byIwr.get(iwrKey);
  if ( hit ) return hit;
  hit = meanDamageNow(run, action, target);
  byIwr.set(iwrKey, hit);
  return hit;
}

function meanDamageNow(run, action, target) {
  const rules = run.prep.rules;
  const iwr = iwrOf(target); // (with any resistance an effect lends it: Rage, Stoneskin)
  const crit = action.critDamage ?? criticalParts(rules, action.damage);
  const rider = effectMean(action);
  // Rolled several times (magic missiles), and a crit table's extra on a crit.
  const times = action.repeat ? Math.max(1, meanPart(action.repeat)) : 1;
  return {
    normal: times * (rules.applyIwr(iwr, meanByType(action.damage)) + persistentMean(action.damage)) + rider,
    critical: times * (rules.applyIwr(iwr, meanByType(crit)) + persistentMean(crit)) + rider + critExtraMean(action.crit, rules.applyIwr(iwr, meanByType(crit)) + persistentMean(crit))
  };
}

/** Expected damage dealt by one use of `action` from a against t, given attacks already made this turn. */
export function expectedDamage(run, a, action, t, attacksMade = 0) {
  // A spell check that may fail (DCC): what it does when it works, as often as it works.
  if ( action.casting ) return castChanceOf(a, action) * expectedDamage(run, a, { ...action, casting: null }, t, attacksMade);
  // A multiattack is its strikes in order.
  if ( action.sequence?.length ) {
    let total = 0;
    // (Each at the same penalty when it says so: PF2e Double Slice.)
    action.sequence.forEach((strike, i) => { total += expectedDamage(run, a, strike, t, attacksMade + (action.sameMap ? 0 : i)); });
    return total;
  }
  if ( action.kind === "control" ) return controlValue(run, a, action, t, attacksMade);
  const rules = run.prep.rules;
  // A finishing move: everything the foe has left, as often as it lands.
  if ( action.finish ) {
    const r = attackRoll(run, a, t, action, attacksMade);
    const ac = currentAc(run, t, a, action);
    const dist = degreeDistribution(rules, r.bonus + boostBonus(rules, a, t, r.bonus, ac, attackOptions(r)), ac, attackOptions(r));
    return (dist[2] + dist[3]) * (t.hp + t.temp + (t.stamina ?? 0));
  }
  const dmg = meanDamageVs(run, action, t);
  const targets = areaTargets(run, a, action, t);
  if ( action.kind === "auto" ) {
    const extra = bonusDamageParts(run, a, action, t).reduce((s, p) => s + Math.max(0, meanPart(p)), 0);
    return targets * (dmg.normal + extra);
  }
  if ( action.kind === "save" && action.save ) {
    const extra = bonusDamageParts(run, a, action, t).reduce((s, p) => s + Math.max(0, meanPart(p)), 0);
    const save = saveRoll(run, t, action.save.type, { magical: isMagical(action), action });
    const dist = upgradedDistribution(degreeDistribution(rules, save.mod, action.save.dc, { advantage: save.advantage, kind: "save", roller: t }), t, action.save.type);
    // (What it lays on a failure, an affliction's conditions: as its save went.)
    const laid = afflicts(action) ? (p, d) => (d <= 1 && saveMultiplierFor(rules, d, action.save, t) > 0 ? p * afflictionWorth(run, a, action, t, d) : 0) : () => 0;
    return targets * dist.reduce((s, p, d) => s + p * saveMultiplierFor(rules, d, action.save, t) * (dmg.normal + extra) + laid(p, d), 0);
  }
  const roll = attackRoll(run, a, t, action, attacksMade);
  const extraParts = bonusDamageParts(run, a, action, t, { advantage: roll.advantage });
  // A deed die adds what it shows to the damage, as well as to the roll.
  const deed = roll.deed ? (roll.deed + 1) / 2 : 0;
  const extra = extraParts.reduce((s, p) => s + Math.max(0, meanPart(p)), 0) + deed;
  const extraCrit = (extraParts.length ? criticalParts(rules, extraParts).reduce((s, p) => s + Math.max(0, meanPart(p)), 0) : 0) + deed;
  const ac = currentAc(run, t, a, action);
  const opts = attackOptions(roll, { deed: true });
  const dist = degreeDistribution(rules, roll.bonus + boostBonus(rules, a, t, roll.bonus, ac, opts), ac, opts);
  // (What a hit lays, an affliction's conditions, as often as it hits; a maneuver it makes on a hit, as its roll goes.)
  const laid = afflicts(action) ? (dist[2] + dist[3]) * afflictionWorth(run, a, action, t) : 0;
  const tries = maneuverWorth(run, a, action, t);
  return targets * (dist[2] * (dmg.normal + extra + tries.hit) + dist[3] * (dmg.critical + extraCrit + tries.crit) + laid);
}

/**
 * What a blow's maneuver riders (kind "control": a roll of their own on a hit, PF2e's Improved Grab) are worth to a
 * against t: {hit, crit}, a critical hit's with those that come of one only (critOnly).
 */
function maneuverWorth(run, a, action, t) {
  let hit = 0;
  let crit = 0;
  for ( const e of action.effects ?? [] ) {
    if ( e.kind !== "control" || !e.control ) continue;
    const v = controlValue(run, a, withManeuver(e.control), t, 0);
    crit += v;
    if ( !e.critOnly ) hit += v;
  }
  return { hit, crit };
}

/** What a costly area loses, to a creature that thinks it through, when it would catch only the one it's aimed at. */
export const LONE_COSTLY_AREA = 0.85;
/** What an area gains, to a creature that thinks it through, when it would catch three foes or more: well worth it. */
export const CROWDED_AREA = 1.5;

/** Does an action cost something to use: a spell slot or another resource, limited uses, a recharge? */
const costly = action => !!action.resource || Number.isFinite(action.uses) || !!action.cooldown;

/**
 * How many foes an area really catches: as many as it can take, but no more than are standing against u (a Mass
 * Suggestion for twelve, against two foes, takes two). A creature that thinks it through (Tactical and up), aiming it at
 * t on a map: as many as it would really catch there (inArea); a costly one that would catch only t a little less worth
 * it (LONE_COSTLY_AREA), as it would rather save it for more; and one that would catch three or more a lot more worth it
 * (CROWDED_AREA).
 */
export function areaTargets(run, u, action, t = null) {
  if ( !action.area ) return 1;
  const most = Math.max(1, action.area.targets ?? 2);
  const foes = enemiesOf(run, u).filter(isStanding);
  let n = Math.max(1, Math.min(most, foes.length));
  if ( t && run.prep.options.positioning && t.pos && liveTier(run, u) >= TACTICAL.TACTICAL ) {
    const caught = 1 + foes.filter(o => o !== t && inArea(run, u, t, o, action.area)).length;
    n = Math.max(1, Math.min(n, caught));
    if ( caught < 2 && costly(action) ) n *= LONE_COSTLY_AREA;
    else if ( n >= 3 ) n *= CROWDED_AREA;
  }
  return n;
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
    // (What needs setting up first, a Rend after two hits, isn't a turn's usual: what sets it up counts instead.)
    if ( action.requires ) continue;
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
    const left = action.resource ? resourceLeft(u, action) / Math.max(1, action.resourceCost ?? 1) : Number.isFinite(action.uses) ? (u.uses?.[action.id] ?? action.uses) : Infinity;
    // (One that recharges is there whenever it's ready, and may well be again.)
    if ( action.recharge || action.cooldown ) total *= left > 0 ? 1 : 0.4;
    else if ( Number.isFinite(left) ) total *= Math.min(1, left / TYPICAL_ROUNDS);
    bestMain = Math.max(bestMain, total);
  }
  return bestMain + bestBonus;
}

/** Attack rolls one use makes (for the multiple attack penalty): a multiattack makes several. */
export function attacksIn(action) {
  if ( Number.isFinite(action.attacks) ) return action.attacks; // (PF2e Power Attack counts as two)
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

/**
 * What's left to pay for an action from: its own resource (spec.resources), or, with `shared`, a pool its whole side
 * draws on (run.sharedPools: Daggerheart's Fear, the GM's).
 */
export function resourceLeft(u, action) {
  return action.shared ? (u.sharedPools?.[action.shared] ?? 0) : (u.resources[action.resource] ?? 0);
}

/** An action that costs something it has only so much of: a resource, or uses. */
export const limited = a => !!a.resource || Number.isFinite(a.uses);

export function hasUses(u, action) {
  if ( u.lost?.has(action.id) ) return false; // a spell lost to a failed check (DCC)
  if ( (u.bound || u.boundBy) && u.handActions?.has(action.id) ) return false; // tied up: nothing that needs hands
  // (In another shape: nothing that needs hands, and no spells.)
  if ( hasTrait(u, "noGear") && (u.handActions?.has(action.id) || isMagical(action)) ) return false;
  // (resourceCost: what one use takes, a point by default: Daggerheart's 3 Hope for a class's Hope feature.)
  if ( action.resource && resourceLeft(u, action) < (action.resourceCost ?? 1) ) return false;
  // (And so many uses, beside what it costs: a Fear, once a scene.)
  if ( Number.isFinite(action.uses) ) return (u.uses[action.id] ?? 0) > 0;
  return true;
}

export function spendUse(u, action) {
  if ( action.resource && action.shared && u.sharedPools ) u.sharedPools[action.shared] -= action.resourceCost ?? 1;
  else if ( action.resource ) u.resources[action.resource] -= action.resourceCost ?? 1;
  if ( Number.isFinite(action.uses) ) u.uses[action.id] -= 1;
}

export { costOf, costUnits };
