import { describe, expect, test } from "vitest";
import { runBatchSync, replay } from "../scripts/engine/simulator.js";
import { pf2eRules } from "../scripts/adapters/pf2e/rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const sumOutcomes = r => Object.values(r.sides).reduce((s, x) => s + x.pWin, 0) + r.pStalemate + r.pNone;

describe("simulator", () => {
  test("identical 1v1 is roughly even", () => {
    const spec = battle([creature({ id: "a", side: "friendly" }), creature({ id: "b", side: "hostile" })]);
    const r = runBatchSync(spec, pf2eRules, { runs: 4000, seed: 11 });
    expect(r.sides.friendly.pWin).toBeGreaterThan(0.44);
    expect(r.sides.friendly.pWin).toBeLessThan(0.56);
    expect(sumOutcomes(r)).toBeCloseTo(1);
  });

  test("outnumbering wins", () => {
    const spec = battle([
      creature({ id: "a1" }), creature({ id: "a2" }), creature({ id: "a3" }),
      creature({ id: "b1", side: "hostile" })
    ]);
    const r = runBatchSync(spec, pf2eRules, { runs: 1000 });
    expect(r.sides.friendly.pWin).toBeGreaterThan(0.95);
  });

  test("same seed replays identically", () => {
    const spec = battle([creature({ id: "a" }), creature({ id: "b", side: "hostile" })]);
    const x = replay(spec, pf2eRules, 123);
    const y = replay(spec, pf2eRules, 123);
    expect(x.log).toEqual(y.log);
    expect(x.log.length).toBeGreaterThan(2);
  });

  test("battle respects max rounds and HP bounds", () => {
    const weak = strike({ bonus: -10 });
    const t1 = creature({ id: "t", hp: { value: 500, max: 500 }, defenses: { ac: 40 }, actions: [weak] });
    const t2 = creature({ id: "u", side: "hostile", hp: { value: 500, max: 500 }, defenses: { ac: 40 }, actions: [weak] });
    const r = runBatchSync(battle([t1, t2], { maxRounds: 5 }), pf2eRules, { runs: 200 });
    expect(r.pStalemate).toBeGreaterThan(0.9);
    expect(r.rounds.median).toBeLessThanOrEqual(5);
    for ( const c of Object.values(r.combatants) ) expect(c.meanHpFrac).toBeLessThanOrEqual(1);
  });

  test("immunity makes a creature unbeatable by that damage", () => {
    const fireOnly = strike({ damage: [parseFormula("2d6+4", "fire")] });
    const a = creature({ id: "a", actions: [fireOnly] });
    const b = creature({ id: "b", side: "hostile", iwr: { immune: ["fire"] } });
    const r = runBatchSync(battle([a, b]), pf2eRules, { runs: 300 });
    expect(r.sides.hostile.pWin).toBeGreaterThan(0.99);
  });

  test("PCs go dying instead of dead, and healers revive them", () => {
    const heal = { id: "heal", name: "Heal", kind: "heal", cost: 2, heal: [parseFormula("1d8+8", "healing")], resource: "slot:1" };
    const pcs = [
      creature({ id: "fighter", kind: "pc", diesAtZero: false }),
      creature({ id: "cleric", kind: "pc", diesAtZero: false, actions: [strike(), heal], resources: { "slot:1": 3 } })
    ];
    const ogre = creature({
      id: "ogre", side: "hostile", hp: { value: 60, max: 60 },
      actions: [strike({ bonus: 11, damage: [parseFormula("2d10+6", "bludgeoning")] })]
    });
    const r = runBatchSync(battle([...pcs, ogre]), pf2eRules, { runs: 1000 });
    expect(r.pAnyPcDowned).toBeGreaterThan(0.2);
    expect(r.combatants.cleric.meanHealing).toBeGreaterThan(0);
    expect(r.combatants.cleric.resources["slot:1"]).toBeGreaterThan(0);
    expect(r.combatants.fighter.pDead).toBeLessThan(r.combatants.fighter.pDowned);
  });

  test("cowards rout, the fearless do not", () => {
    const mk = fearless => battle([
      creature({ id: "x1", hp: { value: 40, max: 40 } }),
      creature({ id: "x2", hp: { value: 40, max: 40 } }),
      creature({ id: "g1", side: "hostile", traits: { brave: { base: 5, fudge: 0 } }, flags: { fearless } }),
      creature({ id: "g2", side: "hostile", traits: { brave: { base: 5, fudge: 0 } }, flags: { fearless } })
    ], {}, {
      friendly: { enemies: ["hostile"] },
      hostile: { enemies: ["friendly"], traits: { brave: { base: 5, fudge: 0 } } }
    });
    const craven = runBatchSync(mk(false), pf2eRules, { runs: 600 });
    const fearless = runBatchSync(mk(true), pf2eRules, { runs: 600 });
    expect(craven.combatants.g1.pFled).toBeGreaterThan(0.05);
    expect(fearless.combatants.g1.pFled).toBe(0);
  });
});

describe("positioning and movement modes", () => {
  test("ranged attackers get free rounds against melee across difficult terrain", () => {
    const archer = creature({ id: "archer", actions: [strike({ id: "bow", melee: false, range: { increment: 60, max: 360 } })] });
    const brute = creature({ id: "brute", side: "hostile" });
    const spec = battle([archer, brute], { positioning: true });
    spec.approach = {
      archer: { brute: { dist: 90, mult: 1, speed: 25, mode: "walk", los: true, meleeOk: true } },
      brute: { archer: { dist: 90, mult: 2, speed: 25, mode: "walk", los: true, meleeOk: true } }
    };
    const open = runBatchSync(battle([archer, brute]), pf2eRules, { runs: 2000, seed: 5 });
    const terrain = runBatchSync(spec, pf2eRules, { runs: 2000, seed: 5 });
    expect(terrain.sides.friendly.pWin).toBeGreaterThan(open.sides.friendly.pWin + 0.1);
  });

  test("a high flyer cannot be reached by a ground-bound melee creature", () => {
    const flyer = creature({
      id: "flyer", speeds: { walk: 10, fly: 40 },
      actions: [strike({ id: "spit", melee: false, range: { increment: 30, max: 90 } })]
    });
    const brute = creature({ id: "brute", side: "hostile", hp: { value: 60, max: 60 } });
    const spec = battle([flyer, brute], { positioning: true, maxRounds: 20 });
    spec.approach = {
      flyer: { brute: { dist: 30, mult: 1, speed: 40, mode: "fly", los: true, meleeOk: true } },
      brute: { flyer: { dist: 30, mult: Infinity, speed: 25, mode: "walk", los: true, meleeOk: false } }
    };
    const r = runBatchSync(spec, pf2eRules, { runs: 300 });
    expect(r.combatants.flyer.pStanding).toBeGreaterThan(0.99);
  });
});
