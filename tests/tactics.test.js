import { describe, expect, test } from "vitest";
import { suggestTactics, resolveTactics, styleWeight } from "../scripts/engine/tactics.js";
import { runBatchSync } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const bow = () => strike({ id: "bow", name: "Shortbow", melee: false, range: { increment: 60, max: 360 }, damage: [parseFormula("1d6+1", "piercing")] });
const blast = () => ({ id: "blast", name: "Fire Blast", kind: "save", cost: 2, save: { type: "reflex", dc: 17, basic: true }, damage: [parseFormula("4d6", "fire")], resource: "slot:1" });
const potion = () => ({ id: "potion", name: "Healing Potion", kind: "heal", cost: 1, heal: [parseFormula("1d8", "healing")], resource: "item:p", selfOnly: true });

describe("suggested tactics", () => {
  test("archers favor ranged, sword-and-board protects, casters cast", () => {
    expect(suggestTactics(creature({ kind: "pc", actions: [strike({ bonus: 3, damage: [parseFormula("1d4", "bludgeoning")] }), bow()] })).style).toBe("ranged");
    const knight = suggestTactics(creature({ kind: "pc", shield: { ac: 2 }, actions: [strike()] }));
    expect(knight.style).toBe("protector");
    expect(knight.shield).toBe("spare");
    const mage = creature({ kind: "pc", actions: [strike({ bonus: 2, damage: [parseFormula("1d4", "bludgeoning")] }), { ...blast(), resource: null, id: "cantrip" }] });
    expect(suggestTactics(mage).style).toBe("caster");
  });

  test("preferred action is the best free option; potions default to 50%", () => {
    const s = suggestTactics(creature({ actions: [strike({ id: "fist", damage: [parseFormula("1d4", "bludgeoning")] }), strike({ id: "sword" }), blast(), potion()] }));
    expect(s.preferredAction).toBe("sword");
    expect(s.potionThreshold).toBe("50");
  });

  test("auto and blank answers resolve to the suggestion", () => {
    const r = resolveTactics({ style: "auto", target: "weakest", notes: "" }, { style: "ranged", target: "nearest", notes: "" });
    expect(r.style).toBe("ranged");
    expect(r.target).toBe("weakest");
  });

  test("style weights", () => {
    expect(styleWeight({ style: "ranged" }, bow())).toBeGreaterThan(1);
    expect(styleWeight({ style: "ranged" }, strike())).toBeLessThan(1);
    expect(styleWeight({ style: "frontline", preferredAction: "x" }, strike({ id: "x" }))).toBeCloseTo(1.2 * 1.35);
  });
});

describe("tactics in the simulation", () => {
  test("a favorite weapon that still needs drawing never wastes the last action", () => {
    const sword = strike({ id: "sword", name: "Sword", drawCost: 1, damage: [parseFormula("1d10+4", "slashing")] });
    const fist = strike({ id: "fist", name: "Fist", damage: [parseFormula("1d4+4", "bludgeoning")], maps: [0, -4, -8] });
    const make = preferredAction => battle([
      creature({ id: "pc", kind: "pc", diesAtZero: false, actions: [fist, sword], tactics: { preferredAction } }),
      creature({ id: "dummy", side: "hostile", hp: { value: 300, max: 300 }, actions: [strike({ bonus: -30 })] })
    ], { maxRounds: 3 });
    const preferring = runBatchSync(make("sword"), pf2eRules, { runs: 300 });
    const neutral = runBatchSync(make(""), pf2eRules, { runs: 300 });
    expect(preferring.combatants.pc.meanDamage).toBeGreaterThan(neutral.combatants.pc.meanDamage * 0.9);
  });

  const foe = () => creature({ id: "foe", side: "hostile", hp: { value: 120, max: 120 }, defenses: { ac: 15, reflex: 4 } });

  test("conserving casters spend fewer slots than novas", () => {
    // A modest spell: worth a slot to a nova caster, not to a careful one who is not in trouble.
    const mage = t => creature({ id: "mage", kind: "pc", diesAtZero: false, hp: { value: 200, max: 200 }, actions: [strike({ bonus: 7 }), { ...blast(), damage: [parseFormula("3d6", "fire")] }], resources: { "slot:1": 3 }, tactics: t });
    const nova = runBatchSync(battle([mage({ resourceUse: "nova" }), foe()], { maxRounds: 6 }), pf2eRules, { runs: 400 });
    const careful = runBatchSync(battle([mage({ resourceUse: "conserve" }), foe()], { maxRounds: 6 }), pf2eRules, { runs: 400 });
    expect(careful.combatants.mage.resources["slot:1"]).toBeLessThan(nova.combatants.mage.resources["slot:1"]);
  });

  test("potion threshold 'never' keeps potions unused", () => {
    const pc = t => creature({ id: "pc", kind: "pc", diesAtZero: false, actions: [strike(), potion()], resources: { "item:p": 2 }, tactics: t });
    const brute = creature({ id: "brute", side: "hostile", hp: { value: 60, max: 60 }, actions: [strike({ bonus: 10, damage: [parseFormula("2d8+4", "slashing")] })] });
    const never = runBatchSync(battle([pc({ potionThreshold: "never" }), brute]), pf2eRules, { runs: 300 });
    const often = runBatchSync(battle([pc({ potionThreshold: "75" }), brute]), pf2eRules, { runs: 300 });
    expect(never.combatants.pc.resources["item:p"] ?? 0).toBe(0);
    expect(often.combatants.pc.resources["item:p"]).toBeGreaterThan(0.5);
  });

  test("'never retreat' players never flee; 'retreat when hurt' sometimes do", () => {
    const pc = t => creature({ id: "pc", kind: "pc", diesAtZero: false, hp: { value: 30, max: 30 }, tactics: t });
    const brute = creature({ id: "brute", side: "hostile", hp: { value: 60, max: 60 }, actions: [strike({ bonus: 10, damage: [parseFormula("1d10+4", "slashing")] })] });
    const never = runBatchSync(battle([pc({ retreat: "never" }), brute]), pf2eRules, { runs: 300 });
    const hurt = runBatchSync(battle([pc({ retreat: "hurt" }), brute]), pf2eRules, { runs: 300 });
    expect(never.combatants.pc.pFled).toBe(0);
    expect(hurt.combatants.pc.pFled).toBeGreaterThan(0.1);
  });
});
