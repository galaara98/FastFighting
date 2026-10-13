/**
 * How long the planner's prediction runs, and what that means for a big battle. The prediction runs fight after fight
 * until its time is up (the Prediction time: 6 to 20 seconds); a fight under way is always finished, and none is
 * started after. At most MAX_RUNS (past that the odds don't get any surer). A fight's work grows with the square of the
 * creatures in it (each, on its turn, weighs everyone else): about FIGHT_MS_PER_PAIR × creatures² for a fight of six
 * rounds (measured on a desktop: 16 creatures 7.5 ms a fight, 32 21 ms, 64 76 ms, 100 173 ms, in fights of about four
 * rounds), so a big battle gets fewer fights in the same time: the planner warns when so few fit that the odds will be
 * rough.
 * Pure: no Foundry globals.
 */

/** How long the planner's prediction runs, unless the world (or the battle) says otherwise (seconds), and its bounds. */
export const PREDICTION_SECONDS = Object.freeze({ default: 10, min: 6, max: 20 });
/** The most fights a prediction runs, however fast they go. */
export const MAX_RUNS = 20000;
/** Fewer fights than this, and the odds are rough (±5% and worse): the planner says so. */
export const ROUGH_RUNS = 100;
/** The most fights for each of the swing factors' tests. */
export const SWING_RUNS = 300;
/** A fight's work for each pair of creatures (ms), in a fight of six rounds. */
export const FIGHT_MS_PER_PAIR = 0.035;

/** The prediction's time (ms), from seconds (the Prediction time, bounded). */
export function budgetMs(seconds) {
  const s = Number(seconds);
  return 1000 * (Number.isFinite(s) ? Math.max(PREDICTION_SECONDS.min, Math.min(PREDICTION_SECONDS.max, s)) : PREDICTION_SECONDS.default);
}

/** About how long one fight takes with n creatures (ms). */
export const fightMs = n => 0.5 + FIGHT_MS_PER_PAIR * Math.max(1, n) ** 2;

/** About how many fights fit the prediction's time with n creatures (for the planner's warning). */
export const expectedRuns = (n, seconds) => Math.max(1, Math.min(MAX_RUNS, Math.floor(budgetMs(seconds) / fightMs(n))));

/** Each of the swing factors' tests' share of three predictions' time (ms). */
export const swingShareMs = (tests, seconds) => 3 * budgetMs(seconds) / Math.max(1, tests);
