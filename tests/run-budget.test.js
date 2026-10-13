import { describe, expect, test } from "vitest";
import { maxRunsFor, runsFor, swingRunsFor, fightMs, MIN_RUNS, RUN_BUDGET_MS } from "../scripts/engine/run-budget.js";

describe("how many fights a simulation runs, by how many creatures", () => {
  test("fewer the more creatures there are, never below the floor", () => {
    const counts = [4, 10, 14, 20, 30, 40, 64, 100, 200];
    const caps = counts.map(maxRunsFor);
    for ( let i = 1; i < caps.length; i++ ) expect(caps[i]).toBeLessThanOrEqual(caps[i - 1]);
    expect(caps.at(-1)).toBe(MIN_RUNS);
    // (What a small battle asks for runs in full; a big one fits the time.)
    expect(runsFor(2000, 10)).toBe(2000);
    expect(runsFor(2000, 30)).toBeLessThan(2000);
    expect(runsFor(2000, 30) * fightMs(30)).toBeLessThanOrEqual(RUN_BUDGET_MS);
    expect(runsFor(500, 20)).toBe(500);
    expect(runsFor(150, 200)).toBe(150);
  });

  test("a faster or slower GM computer moves the caps (the hardware setting, -50% to +50%)", () => {
    expect(maxRunsFor(30, 50)).toBeGreaterThan(maxRunsFor(30));
    expect(maxRunsFor(30, -50)).toBeLessThan(maxRunsFor(30));
    expect(maxRunsFor(30, 500)).toBe(maxRunsFor(30, 50));
    expect(runsFor(2000, 10, 50)).toBe(2000);
    expect(swingRunsFor(30, 15, { speed: 50 })).toBeGreaterThan(swingRunsFor(30, 15));
  });

  test("the swing factors' tests share their time too", () => {
    expect(swingRunsFor(10, 13)).toBe(300);
    expect(swingRunsFor(30, 15)).toBeLessThan(300);
    expect(swingRunsFor(100, 15)).toBe(50);
  });
});
