/**
 * How many fights a simulation runs, by how many creatures are in it. A fight's work grows with the square of the
 * creatures in it (each, on its turn, weighs everyone else): about FIGHT_MS_PER_PAIR × creatures² for a fight of six
 * rounds (measured on a desktop: 16 creatures 7.5 ms a fight, 32 21 ms, 64 76 ms, 100 173 ms, in fights of about four
 * rounds). So the more creatures, the fewer fights fit the time the GM waits: the planner runs what fits RUN_BUDGET_MS,
 * never fewer than MIN_RUNS (fewer, and the odds say little: ±3.5% at 200), and never more than the GM asks for. A GM
 * with a faster or slower computer than the one this was measured on moves the budget by the GM hardware setting
 * (`speed`: -50 to +50, in percent).
 * Pure: no Foundry globals.
 */

/** About how long the planner's simulation should take (ms). */
export const RUN_BUDGET_MS = 15000;
/** The fewest fights a simulation runs, however many creatures. */
export const MIN_RUNS = 200;
/** A fight's work for each pair of creatures (ms), in a fight of six rounds. */
export const FIGHT_MS_PER_PAIR = 0.035;
/** So many creatures that even MIN_RUNS takes a while (well past RUN_BUDGET_MS): the planner says so. */
export const MANY_CREATURES = 64;

/** About how long one fight takes with n creatures (ms). */
export const fightMs = n => 0.5 + FIGHT_MS_PER_PAIR * Math.max(1, n) ** 2;

/** The time budget for a computer `speed` percent faster (or, below 0, slower) than the one measured. */
const budgetFor = (ms, speed = 0) => ms * (1 + Math.max(-50, Math.min(50, Number(speed) || 0)) / 100);

/** The most fights worth running with n creatures: what fits the budget (in hundreds), at least MIN_RUNS. */
export function maxRunsFor(n, speed = 0) {
  return Math.max(MIN_RUNS, Math.floor(budgetFor(RUN_BUDGET_MS, speed) / fightMs(n) / 100) * 100);
}

/** The fights to run: the GM's number, brought down to what n creatures allow. */
export function runsFor(requested, n, speed = 0) {
  const asked = Math.max(1, Math.floor(Number(requested) || MIN_RUNS));
  return Math.min(asked, maxRunsFor(n, speed));
}

/**
 * The fights for each of the swing factors' tests (a battle without each combatant, without each rule): as many as
 * fit `budget` for all of them, between `min` and `max`.
 */
export function swingRunsFor(n, tests, { min = 50, max = 300, budget = 3 * RUN_BUDGET_MS, speed = 0 } = {}) {
  const fit = Math.floor(budgetFor(budget, speed) / (Math.max(1, tests) * fightMs(n)) / 10) * 10;
  return Math.max(min, Math.min(max, fit));
}
