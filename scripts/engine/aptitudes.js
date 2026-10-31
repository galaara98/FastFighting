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

/**
 * What a creature is best and worst at, of its aptitudes, in whole bands (0 to 4): {best: {key, band}, worst: {key,
 * band}}; the same aptitude for both when it's as good at all of them. Ties go by `salt` (a size-up's: its two
 * creatures' ids), which starts the aptitudes somewhere else in their order, so the same creature isn't always called
 * the same thing, and the fight's dice aren't touched.
 */
export function bestAndWorst(u, salt = "") {
  const n = APTITUDES.length;
  let start = 0;
  for ( const ch of String(salt) ) start = (start + ch.charCodeAt(0)) % n;
  const order = APTITUDES.map((_, i) => APTITUDES[(start + i) % n]);
  const band = key => clamp(Math.round(aptitude(u, key)), 0, APTITUDE_MOST);
  let best = order[0];
  let worst = order[0];
  for ( const key of order ) {
    if ( band(key) > band(best) ) best = key;
    if ( band(key) < band(worst) ) worst = key;
  }
  return { best: { key: best, band: band(best) }, worst: { key: worst, band: band(worst) } };
}

/**
 * The aptitude a defense or a save tests, by the names systems give them (PF2e's Reflex, 5e's dex, DCC's ref, a
 * Perception DC ...), or null (an AC: none).
 */
const TESTED = Object.freeze({
  __proto__: null,
  reflex: "fast", ref: "fast", dex: "fast", dexterity: "fast", agility: "fast",
  fortitude: "strong", fort: "strong", str: "strong", strength: "strong", con: "strong", constitution: "strong",
  will: "wise", wis: "wise", wisdom: "wise", perception: "wise",
  int: "smart", intelligence: "smart", wits: "smart",
  cha: "charismatic", charisma: "charismatic", presence: "charismatic"
});
export const aptitudeTested = defense => TESTED[String(defense ?? "").toLowerCase()] ?? null;

/** Smart enough to count as more than dumb (above very low). */
export const notDumb = u => aptitude(u, "smart") >= APTITUDE_AT.low;
