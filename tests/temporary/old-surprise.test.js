/**
 * Temporary: surprise as plans and live battles had it before Surprise was a choice of its own. A 0.3.0 live battle's
 * spec says a side's surprise round (options.surpriseSide) and the sides rolling Stealth (options.stealthSides), with
 * no options.surprise, and a battle kept then has no run.surprise; a plan from 0.1 to 0.2 says its Initiative choice
 * ("tracker", "stealth", "friendly", "hostile"). These tests keep both read for the releases that carry them, and fail
 * once the core reaches REMOVE_AT, so neither lives on unnoticed. Then remove:
 *  - engine/behavior/surprise.js resolveSurprise's `!mode` branch (and its header's note),
 *  - engine/behavior/standoff.js opensWithTalk's `o.surpriseSide`,
 *  - engine/simulator.js rollInitiative's `options.stealthSides`,
 *  - foundry/battle.js OLD_SURPRISE,
 *  - tests/surprise.test.js's "a plan from before" and the old choices in "the planner's Surprise", and this file.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { beginRun, prepareBattle } from "../../scripts/engine/simulator.js";
import { resolveSurprise } from "../../scripts/engine/behavior/surprise.js";
import { opensWithTalk } from "../../scripts/engine/behavior/standoff.js";
import { surpriseMode } from "../../scripts/foundry/battle.js";
import { pf2eRules } from "../fixtures/three-action-rules.js";
import { creature, strike, battle, social } from "../helpers.js";

const ROOT = path.join(import.meta.dirname, "..", "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8")).version;
/** The release this file, and the old ways of saying surprise, go with. */
const REMOVE_AT = "0.7.0";
const older = (a, b) => {
  const [x, y] = [a, b].map(v => String(v).split(".").map(n => Number(n) || 0));
  for ( let i = 0; i < 3; i++ ) if ( (x[i] ?? 0) !== (y[i] ?? 0) ) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
};

/** Two who'd rather talk, a 0.3.0 spec's options with them. */
const talkers = options => {
  const talker = (id, side) => creature({ id, side, kind: side === "friendly" ? "pc" : "npc", alwaysTalk: true, social: social({ diplomacy: 6 }), actions: [strike()] });
  return battle([talker("hero", "friendly"), talker("bandit", "hostile")], { talking: true, ...options });
};

describe("temporary: surprise as it was said before", () => {
  test(`expires at ${REMOVE_AT}`, () => {
    expect(older(VERSION, REMOVE_AT), `FastFighting ${VERSION} has reached ${REMOVE_AT}: remove the old ways of saying surprise (see tests/temporary/old-surprise.test.js's header) and this file`).toBe(true);
  });

  test("a 0.3.0 live battle's spec: one side's surprise round, and the sides rolling Stealth", () => {
    const run = beginRun(prepareBattle(talkers({ surpriseSide: "hostile", stealthSides: ["hostile", 7] }), pf2eRules), 1);
    expect(resolveSurprise(run)).toMatchObject({ by: ["hostile"], round: true, stealthSides: ["hostile"] });
    // (A plan that says Surprise itself: the old fields count for nothing.)
    const now = beginRun(prepareBattle(talkers({ surprise: "none", surpriseSide: "hostile", stealthSides: ["hostile"] }), pf2eRules), 1);
    expect(resolveSurprise(now)).toMatchObject({ by: [], round: false, stealthSides: [] });
  });

  test("a battle kept then, with no surprise of its own worked out: an ambush still opens with no talk", () => {
    const quiet = beginRun(prepareBattle(talkers({}), pf2eRules), 1);
    delete quiet.surprise;
    expect(opensWithTalk(quiet)).toBe(true);
    const ambush = beginRun(prepareBattle(talkers({ surpriseSide: "hostile" }), pf2eRules), 1);
    delete ambush.surprise;
    expect(opensWithTalk(ambush)).toBe(false);
  });

  test("a 0.1 to 0.2 plan's Initiative choice, as the Surprise that took its place", () => {
    const helper = surprise => ({ rules: surprise ? { surprise: () => null } : {} });
    expect(surpriseMode("tracker", helper(true))).toBe("system");
    expect(surpriseMode("stealth", helper(true))).toBe("system");
    expect(surpriseMode("stealth", helper(false))).toBe("none");
    expect(surpriseMode("friendly", helper(false))).toBe("friendlySurprise");
    expect(surpriseMode("hostile", helper(false))).toBe("friendlySurprised");
  });
});
