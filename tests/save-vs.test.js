/**
 * Situational saves (behavior/save-vs.js): a bonus, a penalty or advantage against effects with some tags only, stacked
 * the PF2e way, and a fight where one changes how a save went.
 */
import { describe, expect, test } from "vitest";
import { prepareBattle, replay } from "../scripts/engine/simulator.js";
import { createRun, saveRoll } from "../scripts/engine/battle-state.js";
import { effectTags, saveVsBonus, saveVsApplies } from "../scripts/engine/behavior/save-vs.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const fireball = { id: "fireball", name: "Fireball", kind: "save", rank: 3, traits: ["fire", "arcane"], area: { targets: 3 }, save: { type: "reflex", dc: 20, basic: true }, damage: [parseFormula("6d6", "fire")] };
const scare = { id: "scare", name: "Scare", kind: "control", traits: ["emotion", "fear", "mental"], save: { type: "will", dc: 18 },
  onSave: [{ conditions: { frightened: 3 } }, { conditions: { frightened: 2 } }, { conditions: { frightened: 1 } }, null] };
const venom = { id: "venom", name: "Jaws", kind: "strike", traits: ["poison"], effects: [{ kind: "save", save: { type: "fortitude", dc: 18 }, conditions: { sickened: 1 } }], damage: [parseFormula("1d6", "piercing")] };

describe("an effect's tags", () => {
  test("its traits, and the engine's own: magical, spell, area, damaging, what it inflicts", () => {
    const fire = effectTags(fireball);
    for ( const tag of ["fire", "arcane", "magical", "spell", "area", "damaging"] ) expect(fire.has(tag), tag).toBe(true);
    const fear = effectTags(scare);
    expect([...fear].sort()).toEqual(["emotion", "fear", "inflicts:frightened", "mental"]);
    expect(effectTags(venom).has("inflicts:sickened")).toBe(true);
    expect(effectTags(strike()).has("magical")).toBe(false);
    expect(effectTags(strike(), { magical: true }).has("magical")).toBe(true);
    expect(effectTags(null).size).toBe(0);
  });
});

describe("spec.saveVs", () => {
  const holder = saveVs => ({ spec: { saveVs } });

  test("which saves, which tags, every one of them, none of them, from whom", () => {
    const tags = effectTags(scare);
    expect(saveVsApplies({ bonus: 1, vs: ["fear"] }, "will", tags)).toBe(true);
    expect(saveVsApplies({ bonus: 1, vs: ["poison"] }, "will", tags)).toBe(false);
    expect(saveVsApplies({ bonus: 1, saves: ["fortitude"], vs: ["fear"] }, "will", tags)).toBe(false);
    expect(saveVsApplies({ bonus: 1, saves: "all", vs: ["fear"] }, "will", tags)).toBe(true);
    expect(saveVsApplies({ bonus: 1, all: ["fear", "mental"] }, "will", tags)).toBe(true);
    expect(saveVsApplies({ bonus: 1, all: ["fear", "magical"] }, "will", tags)).toBe(false);
    expect(saveVsApplies({ bonus: 1, vs: ["mental"], not: ["emotion"] }, "will", tags)).toBe(false);
    const dragon = { spec: { creatureTraits: ["dragon", "fire"] } };
    expect(saveVsApplies({ bonus: 2, from: ["dragon"] }, "will", tags, dragon)).toBe(true);
    expect(saveVsApplies({ bonus: 2, from: ["undead"] }, "will", tags, dragon)).toBe(false);
    expect(saveVsApplies({ bonus: 2, from: ["dragon"] }, "will", tags, null)).toBe(false);
  });

  test("of each kind only the best bonus and the worst penalty; untyped ones add up; advantage as one", () => {
    const list = [
      { bonus: 1, type: "status", vs: ["magical"] },
      { bonus: 2, type: "status", vs: ["arcane"] },
      { bonus: 1, type: "circumstance", vs: ["fire"] },
      { bonus: -1, type: "status", vs: ["area"] },
      { bonus: -2, type: "status", vs: ["damaging"] },
      { bonus: 1, vs: ["spell"] },
      { bonus: 1, vs: ["fire"] }
    ];
    // (status +2 and -2, circumstance +1, untyped +2)
    expect(saveVsBonus(holder(list), "reflex", { action: fireball })).toEqual({ bonus: 3, advantage: 0 });
    expect(saveVsBonus(holder(list), "reflex", { action: { id: "shove", traits: ["attack"] } })).toEqual({ bonus: 0, advantage: 0 });
    // (A blow that hurts: only the penalty against what deals damage.)
    expect(saveVsBonus(holder(list), "reflex", { action: strike() })).toEqual({ bonus: -2, advantage: 0 });
    expect(saveVsBonus(holder([{ advantage: true, vs: ["magical"] }]), "reflex", { action: fireball }).advantage).toBe(1);
    expect(saveVsBonus(holder([{ advantage: 1, vs: ["magical"] }, { advantage: -1, vs: ["fire"] }]), "reflex", { action: fireball }).advantage).toBe(0);
    expect(saveVsBonus(holder([]), "reflex", { action: fireball })).toEqual({ bonus: 0, advantage: 0 });
  });

  test("in the save itself: against a spell, not a sword; advantage against magic (5e Magic Resistance's form)", () => {
    const run = createRun(prepareBattle(battle([
      creature({ id: "mage" }),
      creature({ id: "troll", side: "hostile", saveVs: [{ bonus: 1, type: "status", vs: ["magical"] }, { advantage: 1, saves: ["will"], vs: ["fear"] }] })
    ]), pf2eRules));
    const troll = run.units[1];
    const plain = troll.spec.defenses.reflex;
    expect(saveRoll(run, troll, "reflex", { action: fireball }).mod).toBe(plain + 1);
    expect(saveRoll(run, troll, "reflex", { action: strike() }).mod).toBe(plain);
    expect(saveRoll(run, troll, "reflex", { magical: true }).mod).toBe(plain + 1);
    expect(saveRoll(run, troll, "will", { action: scare }).advantage).toBe(1);
    expect(saveRoll(run, troll, "fortitude", { action: scare }).advantage).toBe(0);
  });
});

describe("a fight where a save bonus against magic changes a save", () => {
  const at = (x, y) => ({ x, y, size: 5 });
  const bolt = { id: "bolt", name: "Arc Bolt", kind: "save", rank: 1, cost: 2, traits: ["electricity"], range: { increment: 60, max: 60 }, melee: false,
    save: { type: "reflex", dc: 17, basic: true }, damage: [parseFormula("2d6", "electricity")] };
  const spec = saveVs => battle([
    creature({ id: "adept", name: "Adept", side: "hostile", position: at(0, 0), actions: [bolt] }),
    creature({ id: "ranger", name: "Ranger", position: at(30, 0), saveVs, actions: [strike({ name: "Spear" })] })
  ], { positioning: true });

  test("the same dice, one more to the Ranger's Reflex save: one save goes the other way", () => {
    let changed = null;
    for ( let seed = 1; seed <= 300 && !changed; seed++ ) {
      const without = replay(spec(undefined), pf2eRules, seed).log.find(e => e.type === "save" && e.targetId === "ranger");
      const withIt = replay(spec([{ bonus: 1, type: "status", vs: ["magical"] }]), pf2eRules, seed).log.find(e => e.type === "save" && e.targetId === "ranger");
      if ( !without || !withIt || without.natural !== withIt.natural ) continue;
      expect(withIt.mod).toBe(without.mod + 1);
      if ( withIt.degree !== without.degree ) changed = { without, withIt };
    }
    expect(changed).not.toBeNull();
    expect(changed.withIt.degree).toBe(changed.without.degree + 1);
    expect(changed.withIt.total).toBe(changed.without.total + 1);
  });
});

describe("against a trap", () => {
  test("an effect a hazard sets off carries hazard and trap; anyone else's doesn't", async () => {
    const { saveVsBonus } = await import("../scripts/engine/behavior/save-vs.js");
    const angel = { spec: { saveVs: [{ bonus: 2, vs: ["trap"] }] } };
    expect(saveVsBonus(angel, "ref", { action: { traits: [] }, from: { spec: { hazard: { once: true } } } }).bonus).toBe(2);
    expect(saveVsBonus(angel, "ref", { action: { traits: [] }, from: { spec: {} } }).bonus).toBe(0);
  });
});
