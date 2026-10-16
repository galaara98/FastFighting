/**
 * Afflictions: what takes hold of a creature and runs its course over turns (a poison, a disease, a curse, a hex,
 * radiation sickness, a parasite). One spec covers the lot, from PF2e's staged ones to a simple "he gave you a disease":
 *   {kind: "affliction", id, name, slug?, traits?, save?: {type, dc}, onset?, maxDuration?, stages, virulent?, stacks?,
 *    tally?, simple?}
 *     save         the save that resists it and, later, works it off (none: it simply takes hold, and stays until it
 *                  runs out or is taken off: a hex)
 *     onset        rounds before its first stage takes hold
 *     maxDuration  rounds it lasts at most
 *     stages       [{damage, conditions, mods, duration}]: what each stage does as it takes hold, and how many rounds
 *                  it lasts before the next save (duration, 1 by default; a disease's days: never, in a fight)
 *     virulent     two saves in a row to ease it a stage, and a critical success eases it only one (PF2e's virulent;
 *                  by default, its trait)
 *     stacks       a fresh exposure while it's on worsens it (PF2e: a poison does, without making it last longer; a
 *                  disease or a curse doesn't: by default, its traits say)
 *     tally        {cure, keep}: no stages moving; a save at the end of each of its turns until `cure` successes end it
 *                  or `keep` failures settle it for the fight (5e Contagion: three of either)
 *     simple       {key}: a simple affliction, its stage the value of one condition (simpleAffliction below)
 * How a save moves its stage is the system's (rules.afflictionStep(degree, phase)): by default a failure worsens it a
 * stage and a success eases it one; on the first exposure a failure gives it its first stage.
 * Pure: no Foundry globals.
 */

/** Rounds in a stage, by default (a save at the end of each of its turns). */
const STAGE_ROUNDS = 1;

/** Traits that make an affliction one a fresh exposure doesn't worsen (PF2e's multiple exposures). */
const NO_STACKING = Object.freeze(["disease", "curse"]);

/** How a degree of success moves an affliction along: on first exposure, and at each later save. */
export function stepOf(rules, degree, phase) {
  if ( rules.afflictionStep ) return rules.afflictionStep(degree, phase);
  return phase === "exposure" ? (degree <= 1 ? 1 : 0) : (degree <= 1 ? 1 : -1);
}

/** Is it virulent (its own word, or its trait)? */
export const isVirulent = spec => spec.virulent ?? (spec.traits ?? []).includes("virulent");

/** Does a fresh exposure while it's on worsen it (its own word, else unless it's a disease or a curse)? */
export const stacks = spec => spec.stacks ?? !(spec.traits ?? []).some(t => NO_STACKING.includes(t));

/** How many rounds its stage lasts before the next save. */
export const stageRounds = (spec, stage) => Math.max(1, Math.round(Number(spec.stages?.[stage - 1]?.duration) || STAGE_ROUNDS));

/**
 * One save's move of an affliction at its end of a stage: the system's step, with a virulent one's two saves in a
 * row (a.streak) and its critical success worth only one. Returns the stage change.
 */
export function stageMove(rules, a, degree) {
  let step = stepOf(rules, degree, "stage");
  if ( !isVirulent(a.spec) || step >= 0 ) {
    a.streak = 0;
    return step;
  }
  if ( degree >= 3 ) {
    a.streak = 0;
    return -1;
  }
  a.streak = (a.streak ?? 0) + 1;
  if ( a.streak < 2 ) return 0;
  a.streak = 0;
  return Math.max(step, -1);
}

/**
 * A simple affliction, for systems without stages (or a GM's "he gave you a disease"): one condition (`key`: diseased,
 * cursed, irradiated, poisoned ...), its value the stage, from `start` up to `most`. Each stage lasts `every` rounds,
 * and then a save (if it has one) worsens or eases it a step (worsens, eases: whether it can); without a save it stays
 * as it is until it runs out (maxDuration) or is taken off. `harm`: damage parts each stage deals as it takes hold,
 * by its value (a function of the value, or parts for every stage). `tally`: 5e's three successes or three failures.
 */
export function simpleAffliction({ id, name = "", key, start = 1, most = 3, every = STAGE_ROUNDS, save = null, onset = 0, maxDuration = null, harm = null, traits = [], tally = null, stacks: stacking = false, virulent = false } = {}) {
  const top = Math.max(1, Math.round(Number(most) || 1));
  const damage = v => (typeof harm === "function" ? harm(v) : harm) ?? [];
  return {
    kind: "affliction", id: id ?? `simple:${key}`, name, traits, save, onset, maxDuration,
    stages: Array.from({ length: top }, (_, i) => ({ conditions: { [key]: i + 1 }, damage: damage(i + 1), duration: every })),
    start: Math.min(top, Math.max(1, Math.round(Number(start) || 1))),
    stacks: stacking, virulent, tally, simple: { key }
  };
}

/** The affliction on u that stands for this condition (a simple affliction whose stage is its value), or null. */
export const afflictionFor = (u, key) => (u.afflictions ?? []).find(a => a.spec.simple?.key === key) ?? null;
