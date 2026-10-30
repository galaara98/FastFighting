/**
 * Setting a character up by itself as the planner opens (foundry/auto-config.js ensureAutoConfig) writes FastFighting's
 * own flags and nothing else: one write, sent without a diff, so the system's update rules don't run again on it (PF2e
 * re-checks its Grant Item rules on every diffed update, and a sheet whose grant lost track of its item says so in a
 * banner each time).
 */
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { creature } from "./helpers.js";

vi.mock("../scripts/api.js", () => ({ getAdapter: () => null }));
vi.mock("../scripts/foundry/keywords.js", () => ({ keywords: async () => ({}), currentKeywords: () => ({}) }));

const { ensureAutoConfig } = await import("../scripts/foundry/auto-config.js");

const was = { game: globalThis.game };
afterAll(() => Object.assign(globalThis, was));
beforeEach(() => {
  globalThis.game = { settings: { get: () => "auto" }, i18n: { localize: k => k, format: k => k, has: () => false } };
});

describe("the planner setting a character up", () => {
  test("its own flags in one write, without a diff: the system's update rules left alone", async () => {
    const writes = [];
    const actor = { uuid: "Actor.jerky", name: "Jerky", isOwner: true, getFlag: () => undefined, update: async (changes, options) => writes.push({ changes, options }) };
    expect(await ensureAutoConfig(actor, creature({ id: "jerky", name: "Jerky", kind: "pc" }))).toBe(true);
    expect(writes).toHaveLength(1);
    expect(Object.keys(writes[0].changes).every(k => k.startsWith("flags.fast-fighting."))).toBe(true);
    expect(writes[0].options).toMatchObject({ diff: false });
  });
});
