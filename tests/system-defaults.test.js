/**
 * Core settings that are the game system's (settings.js systemDefaults, rangeOf): a helper's settingDefaults() (API 28)
 * gives Max rounds and the Lore-Collector's advantage its system's range, default, and own name and hint.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { systemDefaults, rangeOf, roundsRange } from "../scripts/settings.js";
import { MAX_ROUNDS, LORE_BOOST } from "../scripts/constants.js";

let rounds;
let lore;
beforeEach(() => {
  rounds = { name: "FASTFIGHTING.Settings.maxRounds.Name", default: MAX_ROUNDS.default, range: { min: MAX_ROUNDS.min, max: MAX_ROUNDS.max, step: 1 } };
  lore = { name: "FASTFIGHTING.Settings.loreBoost.Name", hint: "FASTFIGHTING.Settings.loreBoost.Hint", default: LORE_BOOST.default, range: { min: LORE_BOOST.min, max: LORE_BOOST.max, step: LORE_BOOST.step } };
  globalThis.game ??= {};
  globalThis.game.settings = { settings: new Map([["fast-fighting.maxRounds", rounds], ["fast-fighting.loreBoost", lore]]) };
});

describe("a system's own settings", () => {
  test("Max rounds: the helper's range and default", () => {
    systemDefaults({ settingDefaults: () => ({ maxRounds: { min: 6, max: 16, default: 16 } }) });
    expect(roundsRange()).toEqual({ min: 6, max: 16, default: 16 });
    expect(rounds.range).toEqual({ min: 6, max: 16, step: 1 });
  });

  test("the Lore-Collector's advantage: the helper's default, and its own words for its system's skill", () => {
    systemDefaults({ settingDefaults: () => ({ loreBoost: { default: 2, name: "FFPF2E.Settings.loreBoost.Name", hint: "FFPF2E.Settings.loreBoost.Hint" } }) });
    expect(rangeOf("loreBoost")).toEqual({ min: LORE_BOOST.min, max: LORE_BOOST.max, default: 2 });
    expect([lore.name, lore.hint]).toEqual(["FFPF2E.Settings.loreBoost.Name", "FFPF2E.Settings.loreBoost.Hint"]);
  });

  test("a default outside the range is held to it; no default, the core's, held to the new range", () => {
    systemDefaults({ settingDefaults: () => ({ maxRounds: { min: 6, max: 16, default: 3 } }) });
    expect(roundsRange().default).toBe(6);
    rounds.default = 20;
    systemDefaults({ settingDefaults: () => ({ maxRounds: { min: 6, max: 16 } }) });
    expect(roundsRange().default).toBe(16);
  });

  test("a checkbox: the helper's true or false, and its words; a list: one of its choices", () => {
    const tied = { type: Boolean, default: true, name: "core.tied" };
    const style = { type: String, choices: { roleplay: "", standard: "" }, default: "roleplay" };
    game.settings.settings.set("fast-fighting.tiedStopsSpells", tied);
    game.settings.settings.set("fast-fighting.storyStyle", style);
    const settings = { tiedStopsSpells: {}, storyStyle: {} };
    systemDefaults({ settingDefaults: () => ({ tiedStopsSpells: { default: false, name: "helper.tied" }, storyStyle: { default: "standard" } }) }, settings);
    expect([tied.default, tied.name, style.default]).toEqual([false, "helper.tied", "standard"]);
    // (Not a true or false, not one of the choices: left as it was.)
    systemDefaults({ settingDefaults: () => ({ tiedStopsSpells: { default: 1 }, storyStyle: { default: "poetry" } }) }, settings);
    expect([tied.default, style.default]).toEqual([false, "standard"]);
  });

  test("no helper, nothing said, or a range out of bounds: the core's", () => {
    for ( const adapter of [null, {}, { settingDefaults: () => ({}) }, { settingDefaults: () => ({ maxRounds: { min: 10, max: 5 }, loreBoost: { min: 0.5, max: 9 } }) }] ) {
      systemDefaults(adapter);
      expect(roundsRange()).toEqual({ min: MAX_ROUNDS.min, max: MAX_ROUNDS.max, default: MAX_ROUNDS.default });
      expect(rangeOf("loreBoost")).toEqual({ min: LORE_BOOST.min, max: LORE_BOOST.max, default: LORE_BOOST.default });
      expect(lore.name).toBe("FASTFIGHTING.Settings.loreBoost.Name");
    }
  });
});
