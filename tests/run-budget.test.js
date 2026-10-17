import { describe, expect, test } from "vitest";
import { budgetMs, expectedRuns, paceOf, fightMs, swingShareMs, MAX_RUNS, PREDICTION_SECONDS, ROUGH_RUNS } from "../scripts/engine/run-budget.js";
import { runBatch } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const duel = () => battle([creature({ id: "a", actions: [strike()] }), creature({ id: "b", side: "hostile", actions: [strike()] })], { maxRounds: 5 });

describe("the prediction's time", () => {
  test("6 to 60 seconds, 10 unless the world or the battle says otherwise", () => {
    expect(PREDICTION_SECONDS).toEqual({ default: 10, min: 6, max: 60 });
    expect(budgetMs()).toBe(10000);
    expect(budgetMs(3)).toBe(6000);
    expect(budgetMs(14)).toBe(14000);
    expect(budgetMs(60)).toBe(60000);
    expect(budgetMs(90)).toBe(60000);
  });

  test("the more creatures, the fewer fights fit it; the more time, the more", () => {
    const counts = [4, 10, 14, 20, 30, 40, 64, 100];
    const fits = counts.map(n => expectedRuns(n, 10));
    for ( let i = 1; i < fits.length; i++ ) expect(fits[i]).toBeLessThan(fits[i - 1]);
    expect(expectedRuns(30, 20)).toBeGreaterThan(expectedRuns(30, 6));
    expect(expectedRuns(1, 20)).toBe(MAX_RUNS);
    expect(swingShareMs(15, 10)).toBe(2000);
  });

  test("this computer's pace, from a prediction that ran out of time, and the next estimate at it", () => {
    // (15 creatures, 8 seconds, 67 fights: about 16 times as long a fight as the formula says.)
    const pace = paceOf(15, 8, 67);
    expect(pace).toBeCloseTo(8000 / 67 / fightMs(15), 9);
    expect(pace).toBeGreaterThan(15);
    expect(expectedRuns(15, 8, pace)).toBe(67);
    // (At 13 seconds, about 108: past the rough odds.)
    expect(expectedRuns(15, 13, pace)).toBeGreaterThanOrEqual(ROUGH_RUNS);
    // (Nothing to go by: no fights, or every fight it could. And no pace at all, the formula's.)
    expect(paceOf(15, 8, 0)).toBeNull();
    expect(paceOf(2, 20, MAX_RUNS)).toBeNull();
    for ( const none of [undefined, 0, -3, NaN] ) expect(expectedRuns(15, 8, none)).toBe(expectedRuns(15, 8));
  });

  test("a prediction runs until its time is up: the fight under way finished, none started after", async () => {
    const all = await runBatch(duel(), pf2eRules, { runs: 300, seed: 1 });
    expect(all.runs).toBe(300);
    const t0 = performance.now();
    const timed = await runBatch(duel(), pf2eRules, { runs: MAX_RUNS, seed: 1, maxMs: 40 });
    expect(timed.runs).toBeGreaterThan(0);
    expect(timed.runs).toBeLessThan(MAX_RUNS);
    expect(performance.now() - t0).toBeLessThan(1000);
    // (How many are done, with each step of its progress: the last, all of them.)
    const counts = [];
    const counted = await runBatch(duel(), pf2eRules, { runs: 300, seed: 1, onProgress: (p, done) => counts.push(done) });
    expect(counts.at(-1)).toBe(counted.runs);
    for ( let i = 1; i < counts.length; i++ ) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    // (No time at all: still the one fight.)
    expect((await runBatch(duel(), pf2eRules, { runs: MAX_RUNS, seed: 1, maxMs: 0.0001 })).runs).toBe(1);
  });
});
