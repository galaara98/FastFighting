/**
 * Where a player's End Turn takes the tracker (foundry/live-battle.js nextPlace): the only move a player may make in a
 * live battle. Anything else (going back, skipping others' turns) is put back.
 */
import { describe, expect, test } from "vitest";
import { nextPlace } from "../scripts/foundry/live-battle.js";

describe("a player's End Turn", () => {
  test("the next in the order; past the last, the next round's first", () => {
    expect(nextPlace([false, false, false], { round: 2, turn: 0 })).toEqual({ round: 2, turn: 1 });
    expect(nextPlace([false, false, false], { round: 2, turn: 2 })).toEqual({ round: 3, turn: 0 });
  });

  test("skipping the defeated, where the combat does", () => {
    const defeated = [true, false, true, false];
    expect(nextPlace(defeated, { round: 1, turn: 1 }, true)).toEqual({ round: 1, turn: 3 });
    expect(nextPlace(defeated, { round: 1, turn: 3 }, true)).toEqual({ round: 2, turn: 1 });
    expect(nextPlace(defeated, { round: 1, turn: 1 }, false)).toEqual({ round: 1, turn: 2 });
  });

  test("one place only: four on, or a round on mid-order, isn't where End Turn goes", () => {
    const next = nextPlace([false, false, false, false, false, false], { round: 1, turn: 1 });
    expect(next).not.toEqual({ round: 1, turn: 5 });
    expect(next).not.toEqual({ round: 2, turn: 3 });
  });
});
