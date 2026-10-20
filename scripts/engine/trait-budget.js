/**
 * The trait budget: a creature's four traits (TRAITS), as its sliders have them (its sheet's reading, then the GM's
 * nudges), total TRAIT_BUDGET at most, so nobody is best at everything. What its playstyles, its leader and its ADHD
 * do to them comes after the sliders, outside the budget.
 *  - Its sheet's reading over it (the system helper's, its biography's words, other modules' trait rules): the excess
 *    comes off the highest, a point at a time, whichever is highest each time (api.js characterSpec).
 *  - A trait raised past it (a slider in the planner, a side's defaults): the excess comes off the highest of the
 *    others the same way; with the others all at 0, off the raised one.
 * A side's group personality keeps to it too. Pure.
 */
import { TRAITS } from "../constants.js";

export const TRAIT_BUDGET = 250;

/** The four traits' total. */
export const traitTotal = values => TRAITS.reduce((s, k) => s + (Number(values?.[k]) || 0), 0);

/**
 * The traits kept within the budget: {tactical, brave, selfish, loyal}, the excess taken off the highest (the highest
 * of those other than `raised`, where one was just raised).
 */
export function withinBudget(values, { raised = null, budget = TRAIT_BUDGET } = {}) {
  const out = Object.fromEntries(TRAITS.map(k => [k, Math.max(0, Number(values?.[k]) || 0)]));
  let over = traitTotal(out) - budget;
  while ( over > 1e-9 ) {
    const others = TRAITS.filter(k => k !== raised && out[k] > 0);
    const pool = others.length ? others : TRAITS.filter(k => out[k] > 0);
    if ( !pool.length ) break;
    // (The highest; of those as high, the first. A point at a time, so those as high come down together.)
    const top = pool.reduce((a, b) => (out[b] > out[a] ? b : a));
    const step = Math.min(over, 1, out[top]);
    out[top] -= step;
    over -= step;
  }
  return out;
}

/**
 * The GM's nudges (`fudges`, by trait) kept so the sliders (each base plus its nudge, 0 to 100) stay within the budget,
 * as withinBudget has it: the nudges, those it took the excess off lowered.
 */
export function budgetFudges(bases, fudges, { raised = null, budget = TRAIT_BUDGET } = {}) {
  const base = k => Number(bases?.[k]) || 0;
  const fudge = k => Number(fudges?.[k]) || 0;
  const values = Object.fromEntries(TRAITS.map(k => [k, Math.min(100, Math.max(0, base(k) + fudge(k)))]));
  if ( traitTotal(values) <= budget + 1e-9 ) return Object.fromEntries(TRAITS.map(k => [k, fudge(k)]));
  const kept = withinBudget(values, { raised, budget });
  return Object.fromEntries(TRAITS.map(k => [k, kept[k] < values[k] ? Math.round((kept[k] - base(k)) * 1000) / 1000 : fudge(k)]));
}
