/**
 * Holding back from killing (an answer to avoiding killing: battle-state.js holdsBack), where the system says which
 * blows can be pulled (rules.pullsBlow: DCC a blunt or subduing melee blow): a foe dropped by one of those is knocked
 * out, one dropped by anything else dies, as the system has it (simulator.js sparesWith); and one holding back reaches
 * for a blow it can pull first (targeting.js PULLED).
 */
import { describe, expect, test } from "vitest";
import { replay, runBatchSync } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

// (Only a club can be pulled.)
const rules = { ...pf2eRules, pullsBlow: (u, a) => !!a?.melee && (a.damage ?? []).some(p => p.type === "bludgeoning") };
const club = strike({ id: "club", name: "Club", bonus: 14, damage: [parseFormula("2d6+6", "bludgeoning")] });
const sword = strike({ id: "sword", name: "Sword", bonus: 14, damage: [parseFormula("2d8+8", "slashing")] });
const hero = actions => creature({ id: "hero", kind: "pc", hp: { value: 300, max: 300 }, avoidKilling: true, actions });
const orc = () => creature({ id: "orc", side: "hostile", diesAtZero: true, hp: { value: 12, max: 12 }, actions: [strike({ bonus: -50 })], flags: { fearless: true } });
const ends = (actions, seeds = 12) => [...Array(seeds).keys()].map(s => replay(battle([hero(actions), orc()], { maxRounds: 4, avoidKilling: 100 }), rules, s + 1).units.orc.final.status);

describe("holding back from killing", () => {
  test("a blow it can pull knocks the foe out; one it can't kills, as the system has it", () => {
    expect(ends([club]).every(s => s === "down")).toBe(true);
    expect(ends([sword]).every(s => s === "dead")).toBe(true);
  });

  test("with both to hand, it reaches for the one it can pull", () => {
    const outcomes = ends([sword, club], 20);
    expect(outcomes.filter(s => s === "down").length).toBeGreaterThan(outcomes.length * 0.7);
  });
});

describe("what pulling a blow costs", () => {
  test("its system's penalty on a pulled blow (PF2e's -2 with a lethal weapon), nothing on a blow it isn't pulling", async () => {
    const { beginRun, beginRound, prepareBattle } = await import("../scripts/engine/simulator.js");
    const { attackRoll } = await import("../scripts/engine/battle-state.js");
    const any = { ...pf2eRules, pullsBlow: (u, a) => a?.kind === "strike", pullPenalty: (u, a) => ((a.traits ?? []).includes("nonlethal") ? 0 : -2) };
    const fist = strike({ id: "fist", name: "Fist", bonus: 14, traits: ["nonlethal"], damage: [parseFormula("1d4", "bludgeoning")] });
    const run = beginRun(prepareBattle(battle([hero([sword, fist]), orc()], { maxRounds: 4, avoidKilling: 100 }), any), 1);
    beginRound(run, 1);
    const h = run.byId.get("hero");
    const o = run.byId.get("orc");
    expect(attackRoll(run, h, o, sword).bonus).toBe(12);
    expect(attackRoll(run, h, o, fist).bonus).toBe(14);
    // (Not holding back: no penalty.)
    const free = beginRun(prepareBattle(battle([creature({ id: "hero", kind: "pc", hp: { value: 300, max: 300 }, actions: [sword] }), orc()], { maxRounds: 4 }), any), 1);
    beginRound(free, 1);
    expect(attackRoll(free, free.byId.get("hero"), free.byId.get("orc"), sword).bonus).toBe(14);
  });
});
