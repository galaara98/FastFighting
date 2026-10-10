/**
 * Crowd control: spells and abilities that impose conditions instead of (or as well as) damage.
 *
 * A control action is an ActionSpec with kind "control" and either a save ({type, dc}) or an attack bonus, plus
 * what happens at each degree:
 *   onSave: [critFail, fail, success, critSuccess]   (the target's save)
 *   onHit:  [critMiss, miss, hit, crit]              (the attacker's roll)
 * Each outcome is null or {conditions: {key: value}, rounds, label, endsOnDamage}. Condition keys are the
 * system's own, passed through to its rules, plus three the engine itself understands:
 *   prone          knocked down (standing up costs what the system says)
 *   immobilized    can't move
 *   incapacitated  can't act (asleep, held, ...); with endsOnDamage, any damage ends it
 *
 * Tags: the action's traits (the system's tags, e.g. PF2e "mental", "fear", "incapacitation") decide immunity
 * through rules.isImmune. Thinking creatures read them and don't waste spells on the immune; the feral don't.
 * Pure: no Foundry globals.
 */
import { TACTICAL, clamp } from "../../constants.js";
import { degreeDistribution } from "../probability.js";
import { saveRoll, attackRoll, currentAc, liveTier } from "../battle-state.js";
import { threatOf, meanDamageVs, saveMultiplier } from "./evaluate.js";

/** Outcome of a control action at a degree (the target's save degree, or the attacker's). */
export function controlOutcome(action, degree) {
  return (action.save ? action.onSave : action.onHit)?.[degree] ?? null;
}

/** Is the target immune to this action (its tags or the conditions it imposes)? The system decides. */
export function isImmune(run, target, action) {
  const rules = run.prep.rules;
  if ( rules.isImmune ) return !!rules.isImmune(target, action);
  const immune = new Set(target.spec.iwr?.immune ?? []);
  if ( (action.traits ?? []).some(t => immune.has(t)) ) return true;
  const outcomes = [...(action.onSave ?? []), ...(action.onHit ?? [])].filter(Boolean);
  const keys = new Set(outcomes.flatMap(o => Object.keys(o.conditions ?? {})));
  return keys.size > 0 && [...keys].every(k => immune.has(k));
}

/** Degrees the target's result shifts for this action (PF2e incapacitation: +1 for much higher-level targets). */
export function degreeShift(run, caster, target, action) {
  return run.prep.rules.controlShift?.({ caster, target, action }) ?? 0;
}

/** Share of a creature's fighting a set of conditions takes away each round (0-1). */
export function conditionWeight(rules, conditions = {}) {
  let w = 0;
  for ( const [key, raw] of Object.entries(conditions) ) {
    const value = raw === true ? 1 : Number(raw) || 0;
    const custom = rules.conditionWeight?.(key, value);
    if ( typeof custom === "number" ) { w += custom; continue; }
    if ( key === "incapacitated" ) w += 1;
    else if ( key === "immobilized" ) w += 0.25;
    else if ( key === "prone" ) w += 0.15;
    else w += 0.08 * value;
  }
  return clamp(w, 0, 1);
}

/** How many of its rounds an effect will matter, in a fight that rarely lasts long. */
const usefulRounds = rounds => Math.min(rounds ?? 1, 3);

/**
 * Expected value of a control action against t, in damage terms: the damage it stops t doing (its threat, for the
 * share of its turns the conditions take away, for as long as they last), plus any damage the action deals.
 * Tactical creatures know who's immune; instinctive ones half the time; feral ones never.
 */
export function controlValue(run, u, action, t, attacksMade = 0) {
  const rules = run.prep.rules;
  const tier = liveTier(run, u);
  const knows = tier >= TACTICAL.COMPETENT ? 1 : tier === TACTICAL.INSTINCTIVE ? 0.5 : 0;
  const immunity = isImmune(run, t, action) ? knows : 0;
  let dist;
  if ( action.save ) {
    const save = saveRoll(run, t, action.save.type);
    dist = [...degreeDistribution(rules, save.mod, action.save.dc, { advantage: save.advantage, kind: "save" })];
  } else {
    const roll = attackRoll(run, u, t, action, attacksMade);
    dist = [...degreeDistribution(rules, roll.bonus, currentAc(run, t, u, action), { advantage: roll.advantage, kind: "attack" })];
  }
  // Shifted degrees (incapacitation): the target fares better.
  const shift = degreeShift(run, u, t, action);
  if ( shift ) {
    const shifted = [0, 0, 0, 0];
    dist.forEach((p, d) => { shifted[clamp(d + (action.save ? shift : -shift), 0, 3)] += p; });
    dist = shifted;
  }
  const threat = threatOf(run, t, u);
  let value = 0;
  dist.forEach((p, d) => {
    const o = controlOutcome(action, d);
    if ( o ) value += p * conditionWeight(rules, o.conditions) * usefulRounds(o.rounds) * threat * (o.endsOnDamage ? 0.6 : 1);
  });
  if ( action.damage?.length ) {
    const dmg = meanDamageVs(run, action, t).normal;
    value += action.save ? dist.reduce((s, p, d) => s + p * saveMultiplier(rules, d, action.save) * dmg, 0) : (dist[2] + dist[3]) * dmg;
  }
  const targets = action.area ? Math.max(1, action.area.targets ?? 2) : 1;
  return targets * value * (1 - immunity);
}

/** Lay an outcome's conditions on a target for its rounds. */
export function applyControl(target, outcome, sourceId) {
  const conditions = { ...(outcome.conditions ?? {}) };
  if ( conditions.prone ) {
    target.prone = true;
    delete conditions.prone;
  }
  if ( Object.keys(conditions).length ) {
    target.effects.push({ conditions, rounds: Math.max(1, outcome.rounds ?? 1), endsOnDamage: !!outcome.endsOnDamage, sourceId, label: outcome.label ?? "" });
  }
}
