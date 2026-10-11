import { describe, expect, test } from "vitest";
import { combinePlaystyles, sampleRunTactics, PLAYSTYLE_IDS, MAX_PLAYSTYLES } from "../scripts/engine/playstyles.js";
import { runBatchSync } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { createRng } from "../scripts/engine/rng.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

describe("every pill", () => {
  test("does something", () => {
    for ( const id of PLAYSTYLE_IDS ) {
      const p = combinePlaystyles([id]);
      const neutral = combinePlaystyles([]);
      const changed = Object.keys(p.traits).length || Object.keys(p.suggest).length || Object.keys(p.behavior).length
        || JSON.stringify(p.desire) !== JSON.stringify(neutral.desire);
      expect(changed, id).toBeTruthy();
      // ... and has a say in what the character wants.
      expect(JSON.stringify(p.desire) !== JSON.stringify(neutral.desire), id).toBe(true);
    }
  });

  test("when pills disagree on a tactic, each gets its chance by its place", () => {
    const p = combinePlaystyles(["cruel", "leader"]); // weakest (first) vs dangerous (second)
    expect(p.suggest.target).toBe("weakest");
    expect(p.mix.target).toEqual([{ value: "weakest", weight: 1 }, { value: "dangerous", weight: 0.75 }]);
    const rng = createRng(7);
    const spec = { tactics: { target: "weakest" }, tacticsMix: p.mix };
    let dangerous = 0;
    for ( let i = 0; i < 2000; i++ ) if ( sampleRunTactics(spec, rng).target === "dangerous" ) dangerous++;
    expect(dangerous / 2000).toBeGreaterThan(0.38);
    expect(dangerous / 2000).toBeLessThan(0.48);
  });
});

describe("pick order", () => {
  test("the first pill counts in full, each later one less", () => {
    const scaredFirst = combinePlaystyles(["chicken", "cruel"]);
    const cruelFirst = combinePlaystyles(["cruel", "chicken"]);
    expect(scaredFirst.traits.brave).toBe(-30);
    expect(cruelFirst.traits.brave).toBeCloseTo(-22.5);
    expect(cruelFirst.desire.hurt.weakest).toBe(15);
    expect(scaredFirst.desire.hurt.weakest).toBeCloseTo(11.25);
  });
});

describe("playstyle combination", () => {
  test("twenty-four playstyles, at most four count", () => {
    expect(PLAYSTYLE_IDS).toHaveLength(24);
    expect(combinePlaystyles(PLAYSTYLE_IDS).ids).toHaveLength(MAX_PLAYSTYLES);
  });

  test("first-listed playstyle wins conflicting suggestions", () => {
    expect(combinePlaystyles(["martyr", "chicken"]).suggest.retreat).toBe("never");
    expect(combinePlaystyles(["chicken", "martyr"]).suggest.retreat).toBe("hurt");
  });

  test("stay mostly true caps trait shifts at 10 and behaviors at 10%", () => {
    const free = combinePlaystyles(["chicken", "cruel"]);
    const capped = combinePlaystyles(["chicken", "cruel"], { stayTrue: true });
    expect(free.traits.brave).toBe(-30);
    expect(capped.traits.brave).toBe(-10);
    expect(capped.behavior.finishDowned).toBeLessThanOrEqual(0.1);
  });

  test("roleplay doubles trait shifts and strengthens behaviors", () => {
    const normal = combinePlaystyles(["cruel"]);
    const heavy = combinePlaystyles(["cruel"], { roleplay: true });
    expect(heavy.traits.selfish).toBe(normal.traits.selfish * 2);
    expect(heavy.behavior.finishDowned).toBeGreaterThan(normal.behavior.finishDowned);
  });

  test("stay true applies a differing answer in about 10% of fights", () => {
    const spec = { stayTrue: true, tactics: { retreat: "hurt", style: "ranged" }, tacticsCalc: { retreat: "never", style: "ranged" } };
    const rng = createRng(3);
    let applied = 0;
    for ( let i = 0; i < 5000; i++ ) if ( sampleRunTactics(spec, rng).retreat === "hurt" ) applied += 1;
    expect(applied / 5000).toBeGreaterThan(0.07);
    expect(applied / 5000).toBeLessThan(0.13);
    expect(sampleRunTactics({ ...spec, stayTrue: false }, rng).retreat).toBe("hurt");
  });
});

describe("playstyles in the simulation", () => {
  const hard = () => strike({ bonus: 12, damage: [parseFormula("2d8+5", "slashing")] });

  test("cruel monsters kill more downed PCs than moralists", () => {
    const make = ids => battle([
      creature({ id: "pc1", kind: "pc", diesAtZero: false, hp: { value: 18, max: 18 } }),
      creature({ id: "pc2", kind: "pc", diesAtZero: false, hp: { value: 18, max: 18 } }),
      creature({ id: "ogre", side: "hostile", hp: { value: 80, max: 80 }, actions: [hard()], behavior: combinePlaystyles(ids, { roleplay: true }).behavior })
    ]);
    const cruel = runBatchSync(make(["cruel"]), pf2eRules, { runs: 600 });
    const moral = runBatchSync(make(["moralist"]), pf2eRules, { runs: 600 });
    expect(cruel.pAnyPcDead).toBeGreaterThan(moral.pAnyPcDead);
  });

  test("wallflowers are attacked less and instigators more", () => {
    const make = (a, b) => battle([
      creature({ id: "a", kind: "pc", diesAtZero: false, hp: { value: 200, max: 200 }, behavior: combinePlaystyles(a).behavior }),
      creature({ id: "b", kind: "pc", diesAtZero: false, hp: { value: 200, max: 200 }, behavior: combinePlaystyles(b).behavior }),
      creature({ id: "foe", side: "hostile", hp: { value: 200, max: 200 }, traits: { tactical: { base: 10, fudge: 0 } } })
    ], { maxRounds: 6 });
    const r = runBatchSync(make(["wallflower"], ["instigator"]), pf2eRules, { runs: 400 });
    expect(r.combatants.a.meanHpFrac).toBeGreaterThan(r.combatants.b.meanHpFrac);
  });

  test("diplomats lose damage to opening parley", () => {
    const make = ids => battle([
      creature({ id: "d", behavior: combinePlaystyles(ids, { roleplay: true }).behavior }),
      creature({ id: "dummy", side: "hostile", hp: { value: 500, max: 500 }, actions: [strike({ bonus: -30 })] })
    ], { maxRounds: 1 });
    const talky = runBatchSync(make(["diplomat"]), pf2eRules, { runs: 400 });
    const plain = runBatchSync(make([]), pf2eRules, { runs: 400 });
    expect(talky.combatants.d.meanDamage).toBeLessThan(plain.combatants.d.meanDamage);
  });
});
