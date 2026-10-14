import { describe, expect, test } from "vitest";
import { reconcile } from "../scripts/foundry/live-battle.js";

/** A run as reconcile reads it: each creature's hit points as the engine had them. */
const runOf = hp => ({ byId: new Map(Object.entries(hp).map(([id, value]) => [id, { id, hp: value }])) });

describe("a player's turn: what the cards say, against what the sheets show", () => {
  test("the harm a creature really took is shared among the blows read at it", () => {
    const run = runOf({ pc: 20, orc: 30 });
    const out = reconcile(run, "pc", [
      { type: "attack", targetId: "orc", degree: 2, damage: 6, sure: true },
      { type: "attack", targetId: "orc", degree: 2, damage: 2, sure: true }
    ], { pc: { hp: 20 }, orc: { hp: 18 } });
    expect(out.map(e => e.damage)).toEqual([9, 3]);
  });

  test("blows read at no one go to the one creature whose loss nothing else explains", () => {
    const run = runOf({ pc: 5, raider: 10, wolf: 10 });
    const out = reconcile(run, "pc", [{ type: "attack", targetId: null, degree: 3, damage: 0, sure: false, aimless: true }],
      { pc: { hp: 5 }, raider: { hp: 7 }, wolf: { hp: 10 } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ targetId: "raider", damage: 3, sure: true });
  });

  test("with no one, or more than one, to put them at, they stay at no one, for the GM", () => {
    const run = runOf({ pc: 5, raider: 10, wolf: 10 });
    const out = reconcile(run, "pc", [{ type: "attack", targetId: null, degree: 2, damage: 0, sure: false, aimless: true }],
      { pc: { hp: 5 }, raider: { hp: 7 }, wolf: { hp: 8 } });
    expect(out[0]).toMatchObject({ targetId: null, sure: false });
    // (The losses no card explains: put down to the player, for the GM to look at.)
    expect(out.filter(e => e.type === "auto").map(e => [e.targetId, e.damage])).toEqual([["raider", 3], ["wolf", 2]]);
  });
});
