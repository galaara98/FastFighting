/**
 * Crowd control and debuffs: spells, skills and abilities that lay conditions, penalties or marks on foes instead
 * of (or as well as) damage.
 *
 * A control action is an ActionSpec with kind "control" and one way of deciding how it went:
 *   save: {type, dc, advantage?}     the target saves:      onSave: [critFail, fail, success, critSuccess]
 *                                    (advantage: +1 when it saves with advantage, as against a 5e charm in a fight)
 *   check: {mod, against, attack?}   a skill against the target's defense DC (PF2e Demoralize: Intimidation vs
 *                                    Will; Trip: Athletics vs Reflex, an attack that counts for the multiple attack
 *                                    penalty):              onHit:  [critFail, fail, success, critSuccess]
 *   bonus                            an attack roll vs AC:  onHit:  [critMiss, miss, hit, crit]
 *   auto: true                       it simply happens (Hunter's Mark, Hex): outcome
 * Each outcome is null or an effect (see effects.js): conditions, mods, mark, tempHp, rounds, label, endsOnDamage,
 * repeatSave, onlyVs, self. Condition keys are the system's own, passed through to its rules, plus three the
 * engine itself understands: prone, immobilized, incapacitated (with endsOnDamage, any damage ends it).
 * oncePerTarget: each target only once a fight (PF2e Demoralize leaves it immune to that creature's).
 *
 * Tags: the action's traits (the system's tags, e.g. PF2e "mental", "fear", "incapacitation") decide immunity
 * through rules.isImmune. Thinking creatures read them and don't waste spells on the immune; the feral don't.
 * Pure: no Foundry globals.
 */
import { TACTICAL, clamp } from "../../constants.js";
import { degreeDistribution } from "../probability.js";
import { saveRoll, attackRoll, checkRoll, currentAc, defenseDc, liveTier } from "../battle-state.js";
import { netAdvantage } from "../mods.js";
import { meanDamageVs, saveMultiplier } from "./evaluate.js";
import { outcomeWorth, hasFresh, concentrationCost, heldElsewhere } from "./effects.js";

/** How a control action is decided: "save", "check", "attack" or "auto". */
export function rollKind(action) {
  if ( action.save ) return "save";
  if ( action.check ) return "check";
  if ( action.auto || (action.outcome && !action.onHit) ) return "auto";
  return "attack";
}

/** Outcome of a control action at a degree (the target's save degree, or the user's). */
export function controlOutcome(action, degree) {
  switch ( rollKind(action) ) {
    case "save": return action.onSave?.[degree] ?? null;
    case "auto": return action.outcome ?? action.onHit?.[2] ?? null;
    default: return action.onHit?.[degree] ?? null;
  }
}

/** Every outcome the action can have. */
function outcomesOf(action) {
  return [...(action.onSave ?? []), ...(action.onHit ?? []), action.outcome].filter(o => o && typeof o === "object");
}

/** Is the target immune to this action (its tags or the conditions it imposes)? The system decides. */
export function isImmune(run, target, action) {
  if ( !action.id ) return immuneNow(run, target, action);
  const cache = run.prep.immuneCache ??= new Map();
  const key = `${action.id}|${target.id}|${target.iwrKey ?? ""}`;
  let v = cache.get(key);
  if ( v === undefined ) cache.set(key, v = immuneNow(run, target, action));
  return v;
}

function immuneNow(run, target, action) {
  const rules = run.prep.rules;
  if ( rules.isImmune ) return !!rules.isImmune(target, action);
  const immune = new Set(target.spec.iwr?.immune ?? []);
  if ( (action.traits ?? []).some(t => immune.has(t)) ) return true;
  const keys = new Set(outcomesOf(action).filter(o => !o.self).flatMap(o => Object.keys(o.conditions ?? {})));
  return keys.size > 0 && [...keys].every(k => immune.has(k));
}

/** Degrees the target's result shifts for this action (PF2e incapacitation: +1 for much higher-level targets). */
export function degreeShift(run, caster, target, action) {
  return run.prep.rules.controlShift?.({ caster, target, action }) ?? 0;
}

/**
 * The roll that decides a control action against t: {kind, mod, dc, advantage, dice}, or {kind: "auto"}.
 * The simulation rolls it; behavior weighs its distribution.
 */
export function controlRoll(run, u, t, action, attacksMade = 0) {
  const kind = rollKind(action);
  if ( kind === "auto" ) return { kind };
  if ( kind === "save" ) {
    const save = saveRoll(run, t, action.save.type);
    return { kind, mod: save.mod, dc: Number(action.save.dc) || 10, advantage: netAdvantage(save.advantage, Number(action.save.advantage) || 0), dice: save.dice, rollKind: "save" };
  }
  if ( kind === "check" ) {
    const check = checkRoll(run, u, action.check.mod);
    const map = action.check.attack ? (run.prep.rules.attackPenalty?.(action, attacksMade) ?? 0) : 0;
    return { kind, mod: check.mod + map, dc: defenseDc(run, t, action.check.against ?? "will"), advantage: check.advantage, dice: null, rollKind: "check" };
  }
  const roll = attackRoll(run, u, t, action, attacksMade);
  return { kind, mod: roll.bonus, dc: currentAc(run, t, u, action), advantage: roll.advantage, dice: roll.dice, rollKind: "attack" };
}

/** Chance of each degree, from the target's side for a save and from the user's otherwise ([1] for "auto": a hit). */
function controlDistribution(run, u, t, action, attacksMade) {
  const roll = controlRoll(run, u, t, action, attacksMade);
  if ( roll.kind === "auto" ) return [0, 0, 1, 0];
  let dist = [...degreeDistribution(run.prep.rules, roll.mod, roll.dc, { advantage: roll.advantage, kind: roll.rollKind, dice: roll.dice })];
  // Shifted degrees (incapacitation): the target fares better.
  const shift = degreeShift(run, u, t, action);
  if ( shift ) {
    const shifted = [0, 0, 0, 0];
    dist.forEach((p, d) => { shifted[clamp(d + (action.save ? shift : -shift), 0, 3)] += p; });
    dist = shifted;
  }
  return dist;
}

/**
 * Expected value of a control action against t, in damage terms: what its conditions, penalties and marks are worth
 * over the rounds they'll matter (the damage they stop t doing, the damage they let u's side do), plus any damage
 * the action deals, less what it costs u if it goes wrong for u (a failed Trip lands u on the floor).
 * Tactical creatures know who's immune; instinctive ones half the time; feral ones never.
 */
export function controlValue(run, u, action, t, attacksMade = 0) {
  if ( action.oncePerTarget && u.triedOn?.has(`${action.id}|${t.id}`) ) return 0;
  // A mark or a hold it's keeping on a foe still standing stays where it is.
  if ( heldElsewhere(run, u, action, t) ) return 0;
  const rules = run.prep.rules;
  const tier = liveTier(run, u);
  const knows = tier >= TACTICAL.COMPETENT ? 1 : tier === TACTICAL.INSTINCTIVE ? 0.5 : 0;
  const immunity = isImmune(run, t, action) ? knows : 0;
  const dist = controlDistribution(run, u, t, action, attacksMade);
  // Already under it, from u, with time to run: casting it again gains nothing.
  const fresh = tier >= TACTICAL.INSTINCTIVE && hasFresh(t, action, u.id);
  // (Deep inside another estimate of how dangerous someone is: its damage only. See threatOf.)
  const inner = (run.threatDepth ?? 0) >= 2;
  let value = 0;
  if ( !fresh && !inner ) {
    dist.forEach((p, d) => {
      const o = controlOutcome(action, d);
      if ( !o || !p ) return;
      value += o.self ? p * outcomeWorth(run, u, u, o) : -p * outcomeWorth(run, u, t, o, { versus: u });
    });
  }
  if ( action.damage?.length ) {
    const dmg = meanDamageVs(run, action, t).normal;
    value += action.save ? dist.reduce((s, p, d) => s + p * saveMultiplier(rules, d, action.save) * dmg, 0) : (dist[2] + dist[3]) * dmg;
  }
  const targets = action.area ? Math.max(1, action.area.targets ?? 2) : 1;
  return Math.max(0, targets * value * (1 - immunity) - concentrationCost(run, u, action));
}
