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
 *   goad: share                      a playstyle's taunt (behavior/goad.js): its talking against the foe's
 *                                    resistance, then a luck check (the Taunting setting): onHit
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
import { saveRoll, attackRoll, attackOptions, checkRoll, currentAc, defenseDc, liveTier, isMagical, boostBonus } from "../battle-state.js";
import { netAdvantage } from "../mods.js";
import { meanDamageVs, saveMultiplier, areaTargets } from "./evaluate.js";
import { outcomeWorth, hasFresh, concentrationCost, heldElsewhere } from "./effects.js";
import { castChanceOf } from "./casting.js";
import { goadPitch, goadLuck } from "./goad.js";

/** How a control action is decided: "save", "check", "attack", "auto" or "goad" (a playstyle's taunt). */
export function rollKind(action) {
  if ( action.goad ) return "goad";
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

/**
 * Is the target immune to this action (its tags or the conditions it imposes)? The system decides. Kept for the batch
 * by the action, the target, and what the target is immune to just now (its iwrKey, which an effect changes).
 */
export function isImmune(run, target, action) {
  if ( !action.id ) return immuneNow(run, target, action);
  const cache = run.prep.immuneCache ??= new Map();
  let byTarget = cache.get(action.id);
  if ( !byTarget ) cache.set(action.id, byTarget = new Map());
  let byIwr = byTarget.get(target.id);
  if ( !byIwr ) byTarget.set(target.id, byIwr = new Map());
  const iwrKey = target.iwrKey ?? "";
  let v = byIwr.get(iwrKey);
  if ( v === undefined ) byIwr.set(iwrKey, v = immuneNow(run, target, action));
  return v;
}

function immuneNow(run, target, action) {
  // (A playstyle's taunt is words: only the mindless pay them no heed.)
  if ( action.goad ) return !!target.spec.social?.mindless;
  // (A grab and nothing else, at one that can't be grabbed.)
  if ( grabOnly(action) && (target.spec.iwr?.immune ?? []).some(k => k === "grabbed" || k === "grappled") ) return true;
  const rules = run.prep.rules;
  if ( rules.isImmune ) return !!rules.isImmune(target, action);
  const immune = new Set(target.spec.iwr?.immune ?? []);
  if ( (action.traits ?? []).some(t => immune.has(t)) ) return true;
  const keys = new Set(outcomesOf(action).filter(o => !o.self).flatMap(o => [...Object.keys(o.conditions ?? {}), ...(o.grab ? ["grabbed"] : [])]));
  return keys.size > 0 && [...keys].every(k => immune.has(k));
}

/** Is all an action does to its target a grab (nothing else laid, moved or dealt)? */
export function grabOnly(action) {
  const outs = [...(action.onHit ?? []), ...(action.onSave ?? []), action.outcome].filter(o => o && !o.self);
  return outs.length > 0 && outs.every(o => o.grab && !Object.keys(o.conditions ?? {}).length && !o.move && !o.damage?.length && !o.mods);
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
    const save = saveRoll(run, t, action.save.type, { magical: isMagical(action), from: u, action });
    return { kind, mod: save.mod, dc: Number(action.save.dc) || 10, advantage: netAdvantage(save.advantage, Number(action.save.advantage) || 0), dice: save.dice, rollKind: "save", roller: t };
  }
  if ( kind === "goad" ) {
    // A playstyle's taunt: its talking, as any pitch (behavior/goad.js), and then its luck check.
    const pitch = goadPitch(run, u, t, action);
    if ( !pitch ) return { kind, mod: -99, dc: 99, advantage: 0, dice: null, rollKind: "check", luck: 0, roller: u };
    return { kind, mod: pitch.mod, dc: pitch.dc, advantage: pitch.advantage, dice: pitch.dice, rollKind: "check", pitch, luck: goadLuck(run, action), roller: u };
  }
  if ( kind === "check" ) {
    const check = checkRoll(run, u, action.check.mod, t, { purpose: "control", action });
    const map = action.check.attack ? (run.prep.rules.attackPenalty?.(action, attacksMade) ?? 0) : 0;
    const dc = defenseDc(run, t, action.check.against ?? "will", u);
    const mod = check.mod + map;
    const lift = boostBonus(run.prep.rules, u, t, mod, dc, { advantage: check.advantage, dice: check.dice, kind: "check" });
    return { kind, mod: mod + lift, dc, advantage: check.advantage, dice: check.dice, rollKind: "check", faces: action.check.faces, roller: u };
  }
  const roll = attackRoll(run, u, t, action, attacksMade);
  const opts = attackOptions(roll);
  const dc = currentAc(run, t, u, action);
  const lift = boostBonus(run.prep.rules, u, t, roll.bonus, dc, opts);
  return { kind, mod: roll.bonus + lift, dc, advantage: roll.advantage, dice: roll.dice, rollKind: "attack", faces: opts.faces, critOn: opts.critOn, fumbleOn: opts.fumbleOn, roller: u };
}

/** Chance of each degree, from the target's side for a save and from the user's otherwise ([1] for "auto": a hit). */
export function controlDistribution(run, u, t, action, attacksMade = 0) {
  const roll = controlRoll(run, u, t, action, attacksMade);
  if ( roll.kind === "auto" ) return [0, 0, 1, 0];
  let dist = [...degreeDistribution(run.prep.rules, roll.mod, roll.dc, { advantage: roll.advantage, kind: roll.rollKind, dice: roll.dice, faces: roll.faces ?? 20, critOn: roll.critOn ?? null, fumbleOn: roll.fumbleOn ?? null, roller: roll.roller ?? null })];
  // (A playstyle's taunt that gets through still needs its luck.)
  if ( roll.kind === "goad" ) {
    const p = roll.luck / 100;
    dist = [dist[0], dist[1] + (dist[2] + dist[3]) * (1 - p), dist[2] * p, dist[3] * p];
  }
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
  // (Deep inside another estimate of how dangerous someone is: its damage only. See threatOf. With none, it's worth
  // nothing there, and nothing more need be worked out: none of it is kept, nor rolls dice.)
  const inner = (run.threatDepth ?? 0) >= 2;
  if ( inner && !action.damage?.length ) return 0;
  const rules = run.prep.rules;
  const tier = liveTier(run, u);
  const knows = tier >= TACTICAL.COMPETENT ? 1 : tier === TACTICAL.INSTINCTIVE ? 0.5 : 0;
  const immunity = isImmune(run, t, action) ? knows : 0;
  const dist = controlDistribution(run, u, t, action, attacksMade);
  // Already under it, from u, with time to run: casting it again gains nothing.
  const fresh = tier >= TACTICAL.INSTINCTIVE && hasFresh(t, action, u.id);
  let value = 0;
  if ( !fresh && !inner ) {
    // (Inside a threat estimate of u's against t nothing changes, so each outcome is weighed once, however many uses of
    // however many actions lay it: evaluate.js threatOf's worthCache.)
    const kept = run.worthCache?.u === u && run.worthCache.t === t ? run.worthCache.map : null;
    dist.forEach((p, d) => {
      const o = controlOutcome(action, d);
      if ( !o || !p ) return;
      // (One that ends with this turn is worth what's left of it, so it's never kept.)
      let worth = o.thisTurn ? undefined : kept?.get(o);
      if ( worth === undefined ) {
        const cost = action.cost ?? 1;
        worth = o.self ? outcomeWorth(run, u, u, o, { cost }) : outcomeWorth(run, u, t, o, { versus: u, cost });
        if ( !o.thisTurn ) kept?.set(o, worth);
      }
      value += o.self ? p * worth : -p * worth;
    });
  }
  if ( action.damage?.length ) {
    const dmg = meanDamageVs(run, action, t).normal;
    value += action.save ? dist.reduce((s, p, d) => s + p * saveMultiplier(rules, d, action.save) * dmg, 0) : (dist[2] + dist[3]) * dmg;
  }
  const targets = areaTargets(run, u, action, t);
  return Math.max(0, castChanceOf(u, action) * targets * value * (1 - immunity) - concentrationCost(run, u, action));
}
