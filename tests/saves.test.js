import { describe, expect, test } from "vitest";
import { prepareBattle } from "../scripts/engine/simulator.js";
import { createRun, saveRoll, isMagical, upgradesSave } from "../scripts/engine/battle-state.js";
import { saveMultiplierFor, upgradedDistribution } from "../scripts/engine/behavior/evaluate.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle } from "./helpers.js";

const ready = combatants => createRun(prepareBattle(battle(combatants), pf2eRules));

describe("special saves", () => {
  test("Magic Resistance: advantage against spells, not against a sword or a breath", () => {
    const run = ready([creature({ id: "mage" }), creature({ id: "golem", side: "hostile", magicResistance: true })]);
    const golem = run.units[1];
    expect(isMagical({ rank: 3 })).toBe(true);
    expect(isMagical({ name: "Breath" })).toBe(false);
    expect(saveRoll(run, golem, "reflex", { magical: true }).advantage).toBe(1);
    expect(saveRoll(run, golem, "reflex").advantage).toBe(0);
  });

  test("an aura of protection: the best friend's bonus within reach, while it's up", () => {
    const at = (x, y) => ({ x, y, size: 5 });
    const run = ready([
      creature({ id: "paladin", position: at(0, 0), saveAura: { bonus: 4, range: 10 } }),
      creature({ id: "near", position: at(10, 0) }),
      creature({ id: "far", position: at(60, 0) }),
      creature({ id: "foe", side: "hostile", position: at(5, 5) })
    ]);
    const [paladin, near, far, foe] = run.units;
    const plain = u => u.spec.defenses.will;
    expect(saveRoll(run, near, "will").mod).toBe(plain(near) + 4);
    expect(saveRoll(run, paladin, "will").mod).toBe(plain(paladin) + 4);
    expect(saveRoll(run, far, "will").mod).toBe(plain(far));
    expect(saveRoll(run, foe, "will").mod).toBe(plain(foe)); // not for the other side
    paladin.status = "down";
    expect(saveRoll(run, near, "will").mod).toBe(plain(near));
  });

  test("evasion (5e): no damage on a successful Dex save, half on a failure", () => {
    const rules = { saveMultiplier: (degree, save) => (degree >= 2 ? (save?.basic === false ? 0 : 0.5) : 1) };
    const rogue = { spec: { evasion: "dex" } };
    const fireball = { type: "dex", dc: 15, basic: true };
    expect(saveMultiplierFor(rules, 2, fireball, rogue)).toBe(0);
    expect(saveMultiplierFor(rules, 1, fireball, rogue)).toBe(0.5);
    expect(saveMultiplierFor(rules, 1, { ...fireball, type: "con" }, rogue)).toBe(1);
    expect(saveMultiplierFor(rules, 2, fireball, { spec: {} })).toBe(0.5);
  });

  test("a success that counts as a critical success (PF2e Evasion, Juggernaut, Resolve)", () => {
    const rogue = { spec: { saveUpgrades: ["reflex"] } };
    expect(upgradesSave(rogue, "reflex")).toBe(true);
    expect(upgradesSave(rogue, "will")).toBe(false);
    expect(upgradedDistribution([0.1, 0.2, 0.5, 0.2], rogue, "reflex")).toEqual([0.1, 0.2, 0, 0.7]);
  });
});
