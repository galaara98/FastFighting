import { describe, expect, test } from "vitest";
import { budgetMs, expectedRuns, swingShareMs, MAX_RUNS, PREDICTION_SECONDS } from "../scripts/engine/run-budget.js";
import { runBatch } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const duel = () => battle([creature({ id: "a", actions: [strike()] }), creature({ id: "b", side: "hostile", actions: [strike()] })], { maxRounds: 5 });

describe("the prediction's time", () => {
  test("4 to 20 seconds, 6 unless the world or the battle says otherwise", () => {
    expect(budgetMs()).toBe(PREDICTION_SECONDS.default * 1000);
    expect(budgetMs(3)).toBe(4000);
    expect(budgetMs(14)).toBe(14000);
    expect(budgetMs(60)).toBe(20000);
  });

  test("the more creatures, the fewer fights fit it; the more time, the more", () => {
    const counts = [4, 10, 14, 20, 30, 40, 64, 100];
    const fits = counts.map(n => expectedRuns(n, 10));
    for ( let i = 1; i < fits.length; i++ ) expect(fits[i]).toBeLessThan(fits[i - 1]);
    expect(expectedRuns(30, 20)).toBeGreaterThan(expectedRuns(30, 6));
    expect(expectedRuns(1, 20)).toBe(MAX_RUNS);
    expect(swingShareMs(15, 10)).toBe(2000);
  });

  test("a prediction runs until its time is up: the fight under way finished, none started after", async () => {
    const all = await runBatch(duel(), pf2eRules, { runs: 300, seed: 1 });
    expect(all.runs).toBe(300);
    const t0 = performance.now();
    const timed = await runBatch(duel(), pf2eRules, { runs: MAX_RUNS, seed: 1, maxMs: 40 });
    expect(timed.runs).toBeGreaterThan(0);
    expect(timed.runs).toBeLessThan(MAX_RUNS);
    expect(performance.now() - t0).toBeLessThan(1000);
    // (No time at all: still the one fight.)
    expect((await runBatch(duel(), pf2eRules, { runs: MAX_RUNS, seed: 1, maxMs: 0.0001 })).runs).toBe(1);
  });
});
