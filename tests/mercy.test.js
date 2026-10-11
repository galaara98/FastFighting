import { describe, expect, test } from "vitest";
import { replay, runBatchSync } from "../scripts/engine/simulator.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const traits = (tactical = 60) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const hero = (extra = {}) => creature({ id: "hero", kind: "pc", diesAtZero: false, hp: { value: 300, max: 300 }, traits: traits(),
  actions: [strike({ id: "blade", bonus: 14, damage: [parseFormula("2d8+8", "slashing")] })], ...extra });
// A foe that goes dying at 0 rather than dying outright, so the victors have someone to decide about.
const bandit = (extra = {}) => creature({ id: "bandit", side: "hostile", diesAtZero: false, hp: { value: 30, max: 30 }, traits: traits(40),
  actions: [strike({ id: "club", bonus: 2, damage: [parseFormula("1d6", "bludgeoning")] })], flags: { fearless: true }, ...extra });

describe("I never kill", () => {
  test("its blows knock out instead: the fallen live, unconscious and stable", () => {
    let knocked = 0;
    for ( let s = 1; s <= 20; s++ ) {
      const r = replay(battle([hero({ neverKill: true }), bandit({ diesAtZero: true })], { maxRounds: 6 }), pf2eRules, s);
      const f = r.units.bandit.final;
      expect(f.status).not.toBe("dead");
      if ( r.log.some(e => e.type === "down" && e.knockedOut) ) knocked += 1;
    }
    expect(knocked).toBeGreaterThan(15);
  });
});

describe("the fallen after the fight", () => {
  const second = (playstyles, extra = {}) => creature({ id: "second", kind: "npc", hp: { value: 300, max: 300 }, traits: traits(),
    behavior: combinePlaystyles(playstyles).behavior, actions: [strike({ id: "knife", bonus: 10 })], ...extra });

  test("the cruel finish them off", () => {
    let dead = 0;
    for ( let s = 1; s <= 20; s++ ) {
      const r = replay(battle([hero(), second(["cruel"]), bandit()], { maxRounds: 6 }), pf2eRules, s);
      if ( r.units.bandit.final.status === "dead" ) dead += 1;
    }
    expect(dead).toBe(20);
  });

  test("one who spares them stops the cruel, and tends them if it can", () => {
    for ( let s = 1; s <= 20; s++ ) {
      const medic = hero({ firstAid: { mod: 30 }, behavior: combinePlaystyles(["moralist"]).behavior });
      const r = replay(battle([medic, second(["cruel"]), bandit()], { maxRounds: 6 }), pf2eRules, s);
      const f = r.units.bandit.final;
      if ( f.status === "standing" ) continue; // (it got away or was never downed)
      expect(f.status).toBe("down");
      expect(r.log.some(e => e.type === "mercy" && e.targetId === "bandit")).toBe(true);
    }
  });

  test("the rest leave them to fate", () => {
    const res = runBatchSync(battle([hero(), second([]), bandit()], { maxRounds: 6 }), pf2eRules, { runs: 200 });
    // Left to its own recovery checks, a dying bandit sometimes pulls through and sometimes doesn't.
    expect(res.combatants.bandit.pDead).toBeGreaterThan(0.05);
    expect(res.combatants.bandit.pDead).toBeLessThan(0.95);
  });
});
