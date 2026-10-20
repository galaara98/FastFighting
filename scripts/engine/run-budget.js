/**
 * How long the planner's prediction runs, and what that means for a big battle. The prediction runs fight after fight
 * until its time is up (the Prediction time: 6 to 60 seconds); a fight under way is always finished, and none is
 * started after. Where it can, it runs on background workers, several fights at once (engine/batch-pool.js): the
 * estimates count those threads. At most MAX_RUNS (past that the odds don't get any surer). A fight's work grows with the square of the
 * creatures in it (each, on its turn, weighs everyone else), a little faster past fifty or so: about FIGHT_MS_PER_PAIR ×
 * creatures² for a fight of six rounds (measured on a desktop, two sides in blocks 40 feet apart, a third of each
 * shooting: 16 creatures 6.7 ms a fight, 32 27 ms, 64 142 ms, 100 502 ms, in fights of five or six rounds), so a big
 * battle gets fewer fights in the same time: the planner warns when so few fit that the odds will be rough. Real
 * battles take longer than that (creatures with a dozen actions, walls, three sides): each prediction tells this
 * computer's pace (paceOf), and the planner's next estimate goes by it.
 * Pure: no Foundry globals.
 */

/** How long the planner's prediction runs, unless the world (or the battle) says otherwise (seconds), and its bounds. */
export const PREDICTION_SECONDS = Object.freeze({ default: 10, min: 6, max: 60 });
/** The most fights a prediction runs, however fast they go. */
export const MAX_RUNS = 20000;
/** Fewer fights than this, and the odds are rough (±5% and worse): the planner says so. */
export const ROUGH_RUNS = 100;
/** The most fights for each of the swing factors' tests. */
export const SWING_RUNS = 300;
/** A fight's work for each pair of creatures (ms), in a fight of six rounds. */
export const FIGHT_MS_PER_PAIR = 0.031;

/** The prediction's time (ms), from seconds (the Prediction time, bounded). */
export function budgetMs(seconds) {
  const s = Number(seconds);
  return 1000 * (Number.isFinite(s) ? Math.max(PREDICTION_SECONDS.min, Math.min(PREDICTION_SECONDS.max, s)) : PREDICTION_SECONDS.default);
}

/** About how long one fight takes with n creatures (ms). */
export const fightMs = n => 0.5 + FIGHT_MS_PER_PAIR * Math.max(1, n) ** 2;

/**
 * About how many fights fit the prediction's time with n creatures (for the planner's warning), at this computer's
 * `pace` (paceOf: how many times longer its last prediction's fights took than fightMs says, on each thread; 1, as it
 * says), on so many `threads` (engine/batch-pool.js: its background workers, or this thread alone).
 */
export const expectedRuns = (n, seconds, pace = 1, threads = 1) => Math.max(1, Math.min(MAX_RUNS,
  Math.floor((threads >= 1 ? Math.floor(threads) : 1) * budgetMs(seconds) / (fightMs(n) * (pace > 0 ? pace : 1)))));

/**
 * This computer's pace, from a prediction that ran until its time was up: how many times longer its fights took than
 * fightMs says (creatures with many actions, walls to see past and around, three sides, a slower computer: a 15-creature
 * PF2e battle on a walled map, about 14). On each thread: a prediction on four workers ran its `runs` on four
 * `threads`, so each a quarter of them. Null when it says nothing: none run, or every fight it could (MAX_RUNS).
 */
export function paceOf(n, seconds, runs, threads = 1) {
  if ( !(runs > 0) || runs >= MAX_RUNS ) return null;
  return budgetMs(seconds) / (runs / (threads >= 1 ? Math.floor(threads) : 1)) / fightMs(n);
}

/** Each of the swing factors' tests' share of three predictions' time (ms). */
export const swingShareMs = (tests, seconds) => 3 * budgetMs(seconds) / Math.max(1, tests);
