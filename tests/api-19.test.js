/**
 * API 19: players' damage in a live battle. A helper reads a damage card, applies it through its system, and says when
 * the system (or a module) applies players' damage itself; by default none of it, and the core goes by the sheets. A
 * creature a player's blow leaves at 0 hit points falls by the battle's rules.
 */
import { expect, test } from "vitest";
import { CORE_API, CORE_API_VERSION, SystemAdapter, STATUS } from "../scripts/core-api.js";
import { beginLive, liveRound, liveDrop } from "../scripts/engine/live.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle } from "./helpers.js";

test("the API is 19 or later, major.bug: the version, and its parts", () => {
  expect(CORE_API.major).toBeGreaterThanOrEqual(19);
  expect(CORE_API_VERSION).toBe(`${CORE_API.major}.${CORE_API.bug}`);
});

test("a helper that knows nothing of damage cards reads none, applies none, and says the system applies none", async () => {
  const adapter = new SystemAdapter();
  expect(adapter.damageCard({})).toBeNull();
  expect(await adapter.applyDamageCard({}, {})).toEqual([]);
  expect(adapter.appliesPlayerDamage()).toBeNull();
  expect(adapter.namesFollowNameplates()).toBe(false);
});

test("a helper with no roller of its own rolls no strikes: the engine's dice", () => {
  const adapter = new SystemAdapter();
  expect(adapter.rollStrike({}, { action: { id: "a" }, target: {}, attackNumber: 1 })).toBeNull();
  expect(adapter.rollReaction).toBeUndefined();
});

test("a creature left at 0 hit points by a player's blow falls; one still standing on its feet, or already down, doesn't", () => {
  const run = beginLive(battle([creature({ id: "pc", kind: "pc", diesAtZero: false }), creature({ id: "orc", side: "hostile" })]), pf2eRules, { seed: 1 });
  liveRound(run, 1);
  const orc = run.byId.get("orc");
  expect(liveDrop(run, "orc")).toBe(false);
  orc.hp = 0;
  expect(liveDrop(run, "orc")).toBe(true);
  expect(orc.status).not.toBe(STATUS.STANDING);
  expect(liveDrop(run, "orc")).toBe(false);
});
