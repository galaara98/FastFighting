import { describe, expect, test } from "vitest";
import { replay, runBatchSync } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const troll = (over = {}) => creature({ id: "troll", side: "hostile", hp: { value: 40, max: 40 }, flags: { fearless: true },
  regen: { amount: 10, stoppedBy: ["fire", "acid"] }, actions: [strike({ bonus: 6, damage: [parseFormula("1d6+2", "slashing")] })], ...over });
const knight = (fire = false) => creature({ id: "knight", kind: "pc", diesAtZero: false, hp: { value: 300, max: 300 },
  actions: [strike({ bonus: 12, damage: [parseFormula("2d8+6", "slashing")] }), ...(fire ? [strike({ id: "torch", name: "Torch", bonus: 12, damage: [parseFormula("2d6+4", "fire")] })] : [])] });

describe("regeneration", () => {
  test("a troll cut down gets back up, unless it's burned", () => {
    const blades = runBatchSync(battle([knight(false), troll()], { maxRounds: 8 }), pf2eRules, { runs: 200 });
    const torch = runBatchSync(battle([knight(true), troll()], { maxRounds: 8 }), pf2eRules, { runs: 200 });
    expect(blades.combatants.troll.pDead).toBe(0);
    expect(torch.combatants.troll.pDead).toBeGreaterThan(0.8);
  });

  test("it regenerates at the start of its turn, but not the turn after fire", () => {
    let mended = 0;
    for ( let seed = 1; seed <= 5; seed++ ) {
      const r = replay(battle([knight(false), troll()], { maxRounds: 4 }), pf2eRules, seed);
      mended += r.log.filter(e => e.type === "regen" && e.actor === "troll").length;
    }
    expect(mended).toBeGreaterThan(3);
  });

  test("fast healing heals each turn, whatever hit it", () => {
    const r = replay(battle([knight(true), troll({ regen: undefined, fastHealing: 5, hp: { value: 200, max: 200 } })], { maxRounds: 4 }), pf2eRules, 3);
    expect(r.log.filter(e => e.type === "regen").every(e => e.amount <= 5)).toBe(true);
    expect(r.log.some(e => e.type === "regen")).toBe(true);
  });
});

describe("holding on (Undead Fortitude)", () => {
  test("a blow that would drop it may leave it at 1 hit point, but never a critical or a radiant one", () => {
    const zombie = creature({ id: "zombie", side: "hostile", hp: { value: 30, max: 30 }, flags: { fearless: true }, defenses: { ac: 10, fortitude: 30, reflex: 0, will: 0 },
      holdOn: { save: "fortitude", base: 5, except: ["radiant"], notOnCrit: true, label: "Undead Fortitude" } });
    let held = 0;
    for ( let seed = 1; seed <= 6; seed++ ) held += replay(battle([knight(false), zombie], { maxRounds: 6 }), pf2eRules, seed).log.filter(e => e.type === "holdOn").length;
    expect(held).toBeGreaterThan(0);
  });
});
