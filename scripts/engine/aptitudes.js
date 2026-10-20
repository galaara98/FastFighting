/**
 * Aptitudes (API 23): a quick, hidden judgment of what a creature is like, for the Statistics Engine to weigh. Never
 * shown, never fudged: each system's helper reads it from its own numbers, as its own game ranges them, and the core
 * only compares it.
 *
 *   spec.aptitudes = {smart, strong, fast, wise, charismatic}, each 0 to 4 (fractions allowed):
 *     0 very low (smart: mindless, or no more than an animal's wits)   1 low   2 average   3 high   4 exceptional
 *   smart: reasoning, cunning; strong: might; fast: agility, quickness (not how far it moves: spec.speeds); wise:
 *   awareness, good sense; charismatic: force of personality.
 *
 * Unsaid (an older helper, or none), the core's own reading: smart 0 for a mindless or animalistic creature, else 2;
 * the rest 2. The engine judges by the halfway marks (APTITUDE_AT), so a helper may give whole bands or anything between.
 * Pure: no Foundry globals.
 */
import { clamp } from "../constants.js";
import { isAnimalistic } from "./behavior/animal.js";

export const APTITUDES = Object.freeze(["smart", "strong", "fast", "wise", "charismatic"]);
/** The scale: 0 to APTITUDE_MOST, AVERAGE its middle. */
export const APTITUDE_MOST = 4;
export const APTITUDE_AVERAGE = 2;
/** Where the engine draws its lines: below `low`, very low (dumb); from `average` up, average or better; from `high` up, high. */
export const APTITUDE_AT = Object.freeze({ low: 0.5, average: 1.5, high: 2.5 });

/** Mindless, by its spec (its social side or its flags). */
const mindless = spec => !!(spec?.social?.mindless || spec?.flags?.mindless);

/** One of a creature's aptitudes (APTITUDES), 0 to 4: its helper's judgment, else the core's own reading. */
export function aptitude(u, key) {
  const said = Number(u?.spec?.aptitudes?.[key]);
  if ( Number.isFinite(said) ) return clamp(said, 0, APTITUDE_MOST);
  if ( key === "smart" && (mindless(u?.spec) || isAnimalistic(u)) ) return 0;
  return APTITUDE_AVERAGE;
}

/** Smart enough to count as more than dumb (above very low). */
export const notDumb = u => aptitude(u, "smart") >= APTITUDE_AT.low;
