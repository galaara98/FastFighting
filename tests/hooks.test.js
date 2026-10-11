import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { degreeDistribution } from "../scripts/engine/probability.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

/** pf2eRules with some system hooks of its own. */
const withHooks = hooks => Object.assign(Object.create(pf2eRules), hooks);

describe("system hooks", () => {
  test("rules.distribution: a system's own chances", () => {
    const rules = withHooks({ distribution: () => [0.1, 0.2, 0.3, 0.4] });
    expect(degreeDistribution(rules, 5, 15, { kind: "attack" })).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  test("rules.adjustRoll and rules.afterRoll see every attack and save", () => {
    const seen = [];
    const rules = withHooks({
      adjustRoll: (run, u, roll, ctx) => (ctx.kind === "attack" && roll.degree < 2 ? { ...roll, degree: 2, adjusted: true } : roll),
      afterRoll: (run, u, roll, ctx) => seen.push(`${u.id}:${ctx.kind}:${roll.degree}`)
    });
    const r = replay(battle([creature({ id: "a", actions: [strike({ bonus: -20 })] }), creature({ id: "b", side: "hostile", hp: { value: 200, max: 200 } })], { maxRounds: 1 }), rules, 1);
    const swings = r.log.filter(e => e.actor === "a" && e.type === "attack");
    expect(swings.length).toBeGreaterThan(0);
    expect(swings.every(e => e.degree >= 2)).toBe(true); // every miss made good
    expect(seen.some(s => s.startsWith("a:attack:"))).toBe(true);
  });

  test("rules.canTarget: someone who can't be pressed now isn't attacked", () => {
    const rules = withHooks({ canTarget: (run, u, t) => t.id !== "shielded" });
    const r = replay(battle([creature({ id: "shielded" }), creature({ id: "brute", side: "hostile", hp: { value: 200, max: 200 } })], { maxRounds: 3 }), rules, 2);
    expect(r.log.some(e => e.actor === "brute" && e.type === "attack")).toBe(false);
  });

  test("rules.retort: a save done well strikes back; rules.afterHarm: what being hurt sets off", () => {
    const harm = [parseFormula("1", "bludgeoning")];
    const rules = withHooks({
      retort: (run, saver, by, action, degree) => (degree >= 2 ? { label: "Clash", damage: harm } : null),
      afterHarm: (run, u, amount) => ({ text: `endures ${amount}`, data: { amount } })
    });
    const blast = { id: "blast", name: "Blast", kind: "save", cost: 1, save: { type: "reflex", dc: 5, basic: false }, damage: [parseFormula("2d6", "fire")], range: { increment: 30, max: 30 } };
    const r = replay(battle([creature({ id: "hero", hp: { value: 200, max: 200 }, defenses: { ac: 16, fortitude: 5, reflex: 20, will: 5 }, actions: [strike({ bonus: -20 })] }),
      creature({ id: "mage", side: "hostile", hp: { value: 200, max: 200 }, actions: [blast] })], { maxRounds: 2 }), rules, 3);
    expect(r.log.some(e => e.actor === "hero" && e.retort && e.target === "mage")).toBe(true);
    expect(r.log.some(e => e.type === "endure")).toBe(true);
  });
});
