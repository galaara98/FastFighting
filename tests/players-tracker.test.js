/**
 * A player's Combat Tracker (foundry/live-battle.js playersTracker): no Previous Turn while FastFighting is in use for
 * its encounter (the combat's flag: on, and begun or used in the Battle Vantage); otherwise as Foundry draws it.
 */
import { afterEach, describe, expect, test } from "vitest";
import { playersTracker } from "../scripts/foundry/live-battle.js";

const was = globalThis.game;
afterEach(() => { globalThis.game = was; });

/** The tracker drawn for this user, its combat flagged so: whether it gets the live battle's class. */
function drawn({ isGM = false, live = null } = {}) {
  globalThis.game = { ...was, user: { isGM } };
  const classes = new Set();
  const element = { classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } };
  const combat = { getFlag: (module, key) => (module === "fast-fighting" && key === "live" ? live : undefined) };
  playersTracker({ viewed: combat }, element);
  return classes.has("ff-live-tracker");
}

describe("a player's Combat Tracker", () => {
  test("FastFighting in use for its encounter: no Previous Turn", () => {
    expect(drawn({ live: { id: "b", active: true, inUse: true } })).toBe(true);
  });

  test("as Foundry draws it: FastFighting never used on it, only prepared, or the battle over", () => {
    expect(drawn({ live: null })).toBe(false);
    expect(drawn({ live: { id: "b", active: true, inUse: false } })).toBe(false);
    expect(drawn({ live: { id: "b", active: true } })).toBe(false);
    expect(drawn({ live: { id: "b", active: false, inUse: false } })).toBe(false);
  });

  test("a GM's: always as Foundry draws it", () => {
    expect(drawn({ isGM: true, live: { id: "b", active: true, inUse: true } })).toBe(false);
  });
});
