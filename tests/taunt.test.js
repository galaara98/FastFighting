/**
 * Taunting: an outcome's `taunt` is a desire to go for the taunter (behavior/desire.js), while it lasts and the
 * taunter stands; `defy` is what ignoring it costs, on rolls against anyone else.
 */
import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { applyOutcome, tauntLevel, TAUNT } from "../scripts/engine/behavior/effects.js";
import { initDesires, goaded, levelOf, mind } from "../scripts/engine/behavior/desire.js";
import { modsAgainst } from "../scripts/engine/battle-state.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const bare = (id, side) => ({ id, side, status: "standing", active: true, effects: [], baseConds: {}, spec: { name: id, iwr: {} } });
const fakeRun = units => ({ units, byId: new Map(units.map(u => [u.id, u])), prep: { sides: { friendly: { enemies: new Set(["hostile"]) }, hostile: { enemies: new Set(["friendly"]) } } } });

describe("taunts", () => {
  test("a taunt needs a taunter; true means a driven want", () => {
    expect(tauntLevel(true)).toBe(TAUNT);
    expect(tauntLevel(150)).toBe(100);
    expect(tauntLevel(0)).toBe(0);
    const orc = bare("orc", "hostile");
    expect(applyOutcome(orc, { taunt: true, rounds: 1 })).toBe(null);
    expect(applyOutcome(orc, { taunt: true, rounds: 1 }, "orc")).toBe(null);
    expect(applyOutcome(orc, { taunt: 80, rounds: 1 }, "gnome")).toMatchObject({ taunt: 80, sourceId: "gnome", rounds: 1 });
  });

  test("ignoring it costs what it says, against anyone but the taunter", () => {
    const orc = bare("orc", "hostile");
    applyOutcome(orc, { taunt: true, defy: { attack: -2 }, rounds: 1 }, "gnome");
    expect(modsAgainst(orc, { id: "elf" }).attack).toBe(-2);
    expect(modsAgainst(orc, { id: "gnome" }).attack ?? 0).toBe(0);
  });

  test("taunted, it wants the taunter, driven and blind to lesser things; not once the taunter falls", () => {
    const gnome = bare("gnome", "friendly");
    const elf = bare("elf", "friendly");
    const orc = bare("orc", "hostile");
    const run = fakeRun([gnome, elf, orc]);
    orc.spec.desires = [{ kind: "hurt", targetId: "elf", level: 50 }];
    initDesires(orc);
    applyOutcome(orc, { taunt: true, rounds: 1 }, "gnome");
    goaded(run, orc);
    expect(levelOf(orc, "hurt", "gnome")).toBe(TAUNT);
    const m = mind(run, orc);
    expect(m.lead).toMatchObject({ kind: "hurt", targetId: "gnome", driven: "taunted" });
    expect(m.blinding).toBe(true);
    gnome.status = "down";
    goaded(run, orc);
    expect(levelOf(orc, "hurt", "gnome")).toBe(0);
  });

  test("a stronger want of its own still wins", () => {
    const gnome = bare("gnome", "friendly");
    const orc = bare("orc", "hostile");
    const run = fakeRun([gnome, bare("elf", "friendly"), orc]);
    orc.spec.desires = [{ kind: "hurt", targetId: "elf", level: 90 }];
    initDesires(orc);
    applyOutcome(orc, { taunt: true, rounds: 1 }, "gnome");
    goaded(run, orc);
    expect(mind(run, orc).lead.targetId).toBe("elf");
  });

  test("in a fight: a guardian's taunt draws a brute's blows off the wizard it was after", () => {
    const taunt = { id: "taunt", name: "Taunt", kind: "control", cost: 1, auto: true, range: { increment: 30, max: 30, noPenalty: true }, melee: false, outcome: { taunt: true, rounds: 1, label: "goaded" } };
    const tactical = { tactical: { base: 70, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
    const scene = withTaunt => battle([
      creature({ id: "wiz", kind: "pc", diesAtZero: false, hp: { value: 400, max: 400 }, defenses: { ac: 12, fortitude: 4, reflex: 4, will: 8 }, actions: [strike({ bonus: -20 })] }),
      creature({ id: "guard", kind: "pc", diesAtZero: false, hp: { value: 400, max: 400 }, defenses: { ac: 24, fortitude: 10, reflex: 6, will: 6 }, traits: tactical,
        actions: withTaunt ? [strike({ bonus: -20 }), taunt] : [strike({ bonus: -20 })] }),
      creature({ id: "brute", side: "hostile", hp: { value: 400, max: 400 }, flags: { fearless: true }, desires: [{ kind: "hurt", targetId: "wiz", level: 50 }],
        actions: [strike({ id: "maul", bonus: 12, damage: [parseFormula("2d8+6", "bludgeoning")] })] })
    ], { maxRounds: 4 });
    const atWizard = withTaunt => {
      let n = 0;
      let taunted = 0;
      for ( let s = 1; s <= 20; s++ ) {
        const log = replay(scene(withTaunt), pf2eRules, s).log;
        n += log.filter(e => e.type === "attack" && e.actorId === "brute" && e.targetId === "wiz").length;
        taunted += log.filter(e => e.type === "control" && e.taunt && e.took).length;
      }
      return { n, taunted };
    };
    const without = atWizard(false);
    const withIt = atWizard(true);
    expect(withIt.taunted).toBeGreaterThan(0);
    expect(withIt.n).toBeLessThan(without.n * 0.5);
  });
});
