import { describe, expect, test } from "vitest";
import { runBatchSync } from "../scripts/engine/simulator.js";
import { costKind } from "../scripts/engine/behavior/reluctance.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";
import { parseFormula } from "../scripts/engine/dice.js";

const potion = () => ({ id: "potion", name: "Healing Potion", kind: "heal", cost: 1, heal: [parseFormula("1d8+4", "healing")], resource: "item:p", selfOnly: true });
const bolt = () => ({ id: "bolt", name: "Lightning Bolt", kind: "spell-attack", cost: 2, rank: 3, bonus: 12, range: { increment: 120, max: 120 }, damage: [parseFormula("4d12", "electricity")], resource: "slots:3" });
const spark = () => ({ id: "spark", name: "Electric Arc", kind: "spell-attack", cost: 2, rank: 0, bonus: 12, range: { increment: 30, max: 30 }, damage: [parseFormula("2d4", "electricity")] });
const heal = () => ({ id: "heal", name: "Heal", kind: "heal", cost: 2, rank: 1, heal: [parseFormula("1d8+8", "healing")], resource: "slots:1" });

describe("reluctance", () => {
  test("what counts: used-up items, and spells that spend something (cantrips are free)", () => {
    expect(costKind(potion())).toBe("consumable");
    expect(costKind(bolt())).toBe("costlySpell");
    expect(costKind(spark())).toBeNull();
    expect(costKind(strike())).toBeNull();
  });

  test("a character who doesn't like using consumables drinks far fewer potions", () => {
    // (Hurt, but not near death: that's when reluctance holds.)
    const pc = avoid => creature({ id: "pc", kind: "pc", diesAtZero: false, hp: { value: 60, max: 60, temp: 0 }, actions: [strike(), potion()], resources: { "item:p": 3 }, avoidConsumables: avoid, tactics: { potionThreshold: "75" } });
    const brute = () => creature({ id: "brute", side: "hostile", hp: { value: 80, max: 80 }, actions: [strike({ bonus: 10, damage: [parseFormula("1d6+2", "slashing")] })] });
    // (The batch reports how many were used, on average.)
    const used = avoid => runBatchSync(battle([pc(avoid), brute()], { maxRounds: 6 }), pf2eRules, { runs: 300 }).combatants.pc.resources["item:p"] ?? 0;
    expect(used(true)).toBeLessThan(used(false) * 0.7);
  });

  test("a caster who doesn't like spending slots reaches for the cantrip", () => {
    const mage = avoid => creature({ id: "mage", actions: [bolt(), spark()], resources: { "slots:3": 3 }, avoidCostlySpells: avoid });
    const foe = () => creature({ id: "foe", side: "hostile", hp: { value: 200, max: 200 }, actions: [strike({ bonus: -50 })] });
    const used = avoid => runBatchSync(battle([mage(avoid), foe()], { maxRounds: 3 }), pf2eRules, { runs: 200 }).combatants.mage.resources["slots:3"] ?? 0;
    expect(used(true)).toBeLessThan(used(false) - 1);
  });

  test("a friend bleeding out overrides it", () => {
    const cleric = creature({ id: "cleric", actions: [strike(), heal()], resources: { "slots:1": 2 }, avoidCostlySpells: true });
    const friend = creature({ id: "friend", kind: "pc", diesAtZero: false, hp: { value: 0, max: 30, temp: 0 }, dying: 1 });
    const foe = creature({ id: "foe", side: "hostile", hp: { value: 200, max: 200 }, actions: [strike({ bonus: -50 })] });
    const r = runBatchSync(battle([cleric, friend, foe], { maxRounds: 1, aftermath: "none" }), pf2eRules, { runs: 100 });
    expect(r.combatants.cleric.resources["slots:1"]).toBeGreaterThan(0.5); // slots used
  });
});
