/**
 * A character the players run, as its turn begins (engine/live.js handOver): none of its players here, FastFighting
 * takes it over; one back, it's theirs again; the setting off, or a GM's own say, and nothing changes.
 */
import { describe, expect, test } from "vitest";
import { handOver } from "../scripts/engine/live.js";

const sets = (players = [], away = []) => ({ players: new Set(players), away: new Set(away) });

describe("a player's character, its players away or back", () => {
  test("none of its players here: FastFighting takes it over", () => {
    expect(handOver({ id: "harsk", ...sets(["harsk"]), here: false })).toEqual({ result: "away", id: "harsk" });
  });

  test("one of them here: theirs, as before", () => {
    expect(handOver({ id: "harsk", ...sets(["harsk"]), here: true })).toBeNull();
  });

  test("taken over, and one of them back: theirs again; still away: FastFighting's still", () => {
    expect(handOver({ id: "harsk", ...sets([], ["harsk"]), here: true })).toEqual({ result: "back", id: "harsk" });
    expect(handOver({ id: "harsk", ...sets([], ["harsk"]), here: false })).toBeNull();
  });

  test("the setting off: its turn waits for someone to play it", () => {
    expect(handOver({ id: "harsk", ...sets(["harsk"]), here: false, absentPlayers: false })).toBeNull();
  });

  test("one FastFighting plays anyway (a creature, or one the GM automated): nothing to hand over", () => {
    expect(handOver({ id: "kobold", ...sets(["harsk"]), here: false })).toBeNull();
  });

  test("a summons goes with its controller", () => {
    expect(handOver({ id: "wolf", controlledBy: "harsk", ...sets(["harsk"]), here: false })).toEqual({ result: "away", id: "harsk" });
    expect(handOver({ id: "wolf", controlledBy: "harsk", ...sets([], ["harsk"]), here: true })).toEqual({ result: "back", id: "harsk" });
  });
});
