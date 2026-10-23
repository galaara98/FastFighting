/**
 * Settings that are the game system's (settings.js systemDefaults, roundsRange): Max rounds' range and default, when a
 * fight in that system counts as a stalemate, from its helper's stalemateRounds() (API 28).
 */
import { beforeEach, describe, expect, test } from "vitest";
import { systemDefaults, roundsRange } from "../scripts/settings.js";
import { MAX_ROUNDS } from "../scripts/constants.js";

let config;
beforeEach(() => {
  config = { default: MAX_ROUNDS.default, range: { min: MAX_ROUNDS.min, max: MAX_ROUNDS.max, step: 1 } };
  globalThis.game ??= {};
  globalThis.game.settings = { settings: new Map([["fast-fighting.maxRounds", config]]) };
});

describe("Max rounds: the system's stalemate", () => {
  test("a helper's range and default become the setting's", () => {
    systemDefaults({ stalemateRounds: () => ({ min: 6, max: 16, default: 16 }) });
    expect(roundsRange()).toEqual({ min: 6, max: 16, default: 16 });
    expect(config.range).toEqual({ min: 6, max: 16, step: 1 });
  });

  test("no default said: its max; one outside the range: held to it", () => {
    systemDefaults({ stalemateRounds: () => ({ min: 6, max: 16 }) });
    expect(roundsRange().default).toBe(16);
    systemDefaults({ stalemateRounds: () => ({ min: 6, max: 16, default: 3 }) });
    expect(roundsRange().default).toBe(6);
  });

  test("no helper, none said, or a range that makes no sense: the core's", () => {
    for ( const adapter of [null, {}, { stalemateRounds: () => ({ min: 10, max: 5 }) }, { stalemateRounds: () => ({ min: 0, max: 500 }) }] ) {
      systemDefaults(adapter);
      expect(roundsRange()).toEqual({ min: MAX_ROUNDS.min, max: MAX_ROUNDS.max, default: MAX_ROUNDS.default });
    }
  });
});
