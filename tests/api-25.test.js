/**
 * API 25: the Statistics Engine's estimates say so. `rules.applyIwr(iwr, byType, target, ctx)` serves both a blow that
 * lands and the engine's estimate of one (what an action would deal a foe, what a condition's harm or an outcome's
 * damage is worth); an estimate's ctx says `estimate: true`, so a system whose damage spends something of the target's
 * (Daggerheart's Armor Slots, its Stress) spends nothing for it, and an estimate kept for the batch (prep.meanCache) is
 * the same whichever fight worked it out first.
 */
import { describe, expect, test } from "vitest";
import { CORE_API, CORE_API_VERSION } from "../scripts/core-api.js";
import { beginRun, beginRound, prepareBattle, replay } from "../scripts/engine/simulator.js";
import { meanDamageVs, iwrContext } from "../scripts/engine/behavior/evaluate.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

/** pf2eRules, each applyIwr's ctx noted (null where none was given). */
function noting() {
  const seen = [];
  const rules = { ...pf2eRules, applyIwr(iwr, byType, target, ctx) {
    seen.push(ctx ?? null);
    return pf2eRules.applyIwr(iwr, byType, target, ctx ?? {});
  } };
  return { rules, seen };
}

test("the API is 25 or later", () => {
  expect(CORE_API.major).toBeGreaterThanOrEqual(25);
  expect(CORE_API_VERSION).toBe(`${CORE_API.major}.${CORE_API.bug}`);
});

describe("an estimate says it is one", () => {
  test("an action's damage against a foe, worked out for a choice: estimate", () => {
    const { rules, seen } = noting();
    const run = beginRun(prepareBattle(battle([creature({ id: "a" }), creature({ id: "b", side: "hostile" })]), rules), 1);
    beginRound(run, 1);
    meanDamageVs(run, strike({ id: "axe", damage: [parseFormula("2d6+3", "slashing")] }), run.byId.get("b"));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(ctx => ctx?.estimate === true)).toBe(true);
  });

  test("a blow that lands: no estimate in its ctx", () => {
    const { rules, seen } = noting();
    const spec = battle([creature({ id: "a", actions: [strike({ bonus: 30 })] }), creature({ id: "b", side: "hostile", hp: { value: 200, max: 200 } })], { maxRounds: 1 });
    const before = seen.length;
    replay(spec, rules, 3);
    const landed = seen.slice(before).filter(ctx => ctx && !ctx.estimate);
    expect(landed.length).toBeGreaterThan(0);
    expect(landed.every(ctx => !("estimate" in ctx))).toBe(true);
  });

  test("iwrContext: the field only where it's an estimate, so a blow's ctx is as it was", () => {
    expect(iwrContext(null, { estimate: true }).estimate).toBe(true);
    expect("estimate" in iwrContext(null, {})).toBe(false);
  });
});
