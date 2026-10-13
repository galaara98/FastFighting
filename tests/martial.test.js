import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const dummy = (over = {}) => creature({ id: "dummy", side: "hostile", hp: { value: 900, max: 900 }, flags: { fearless: true }, defenses: { ac: 15, fortitude: 5, reflex: 5, will: 5 },
  actions: [strike({ bonus: 0, damage: [parseFormula("1", "bludgeoning")] })], ...over });
const attacks = (r, who) => r.log.filter(e => e.actor === who && e.type === "attack");

describe("martial actions in a fight", () => {
  test("an action that counts as two attacks: the next Strike is at the third penalty", () => {
    const swing = { ...strike({ id: "swing", name: "Swing", bonus: 10 }), cost: 2, attacks: 2, damage: [parseFormula("3d12+4", "slashing")] };
    const r = replay(battle([creature({ id: "fighter", actions: [strike({ id: "jab", name: "Jab", bonus: 10, damage: [parseFormula("1d4", "slashing")] }), swing] }), dummy()], { maxRounds: 1 }), pf2eRules, 4);
    const used = attacks(r, "fighter");
    const swingAt = used.findIndex(e => e.action === "Swing");
    expect(swingAt).toBeGreaterThanOrEqual(0);
    const after = used[swingAt + 1];
    if ( after ) expect(after.attackNumber).toBe(used[swingAt].attackNumber + 2);
  });

  test("a sequence at the same penalty: both strikes at the first attack's bonus", () => {
    const blade = strike({ id: "b1", name: "Blade", bonus: 10 });
    const dagger = strike({ id: "b2", name: "Dagger", bonus: 10 });
    const slice = { ...blade, id: "slice", name: "Double Slice", cost: 2, sequence: [blade, dagger], sameMap: true, damage: [parseFormula("4d8+8", "slashing")] };
    const r = replay(battle([creature({ id: "fighter", actions: [slice] }), dummy()], { maxRounds: 1 }), pf2eRules, 2);
    const [a, b] = attacks(r, "fighter");
    expect(a.mod).toBe(b.mod);
  });

  test("a charge: it reaches a foe 40 feet off and strikes in the same action", () => {
    const at = (x, y) => ({ x, y, size: 5 });
    const charge = { ...strike({ id: "charge", name: "Charge", bonus: 10 }), cost: 2, charge: 2 };
    const r = replay(battle([creature({ id: "fighter", position: at(0, 0), speeds: { walk: 25 }, actions: [strike({ id: "axe", bonus: 10 }), charge] }), dummy({ position: at(45, 0) })], { positioning: true, maxRounds: 1 }), pf2eRules, 3);
    expect(attacks(r, "fighter").some(e => e.action === "Charge")).toBe(true);
  });

  test("once a turn: a flurry isn't used twice in one turn", () => {
    const fist = strike({ id: "fist", name: "Fist", bonus: 10, damage: [parseFormula("1d6+4", "bludgeoning")] });
    const flurry = { ...fist, id: "flurry", name: "Flurry", cost: 1, oncePerTurn: true, sequence: [fist, { ...fist, id: "fist2" }], damage: [parseFormula("2d6+8", "bludgeoning")] };
    for ( let seed = 1; seed <= 5; seed++ ) {
      const r = replay(battle([creature({ id: "monk", actions: [fist, flurry] }), dummy()], { maxRounds: 2 }), pf2eRules, seed);
      for ( const round of [1, 2] ) {
        const fists = attacks(r, "monk").filter(e => e.round === round).length;
        expect(fists).toBeLessThanOrEqual(4); // a flurry (two) and two more single blows at most
      }
    }
  });

  test("a friend nearby takes some of the blow off, and strikes back (a champion's reaction)", () => {
    const champion = creature({ id: "champion", hp: { value: 200, max: 200 }, actions: [strike({ id: "sword", bonus: 12 })],
      reactions: [{ id: "retributive", label: "Retributive Strike", on: "allyHit", range: 15, reduce: { dice: [], flat: 7, type: "untyped" }, strike: true }] });
    const ward = creature({ id: "ward", hp: { value: 200, max: 200 }, actions: [strike({ bonus: 0, damage: [parseFormula("1", "bludgeoning")] })] });
    const brute = creature({ id: "brute", side: "hostile", hp: { value: 300, max: 300 }, flags: { fearless: true }, actions: [strike({ bonus: 15, damage: [parseFormula("2d8+10", "slashing")] })] });
    let reacted = 0;
    for ( let seed = 1; seed <= 6; seed++ ) {
      const r = replay(battle([champion, ward, brute], { maxRounds: 3 }), pf2eRules, seed);
      const guards = r.log.filter(e => e.type === "reaction" && e.actor === "champion");
      reacted += guards.length;
      for ( const g of guards ) {
        const i = r.log.indexOf(g);
        // (Told just after the blow it answers.)
        const blow = r.log.slice(0, i).reverse().find(e => e.type === "attack" && e.actor === "brute");
        if ( blow && blow.target === "ward" ) expect(blow.lessened).toBeGreaterThan(0);
      }
    }
    expect(reacted).toBeGreaterThan(2);
  });

  test("a guardian takes a friend's blow instead, against its own resistance (Intercept Attack)", () => {
    const guardian = creature({ id: "guardian", hp: { value: 300, max: 300 }, iwr: { resist: { physical: 5 } }, actions: [strike({ id: "flail", bonus: 12 })],
      reactions: [{ id: "intercept", label: "Intercept Attack", on: "allyHit", range: 10, physical: true, redirect: true, tell: "intercept" }] });
    const ward = creature({ id: "ward", hp: { value: 30, max: 30 }, actions: [strike({ bonus: 0, damage: [parseFormula("1", "bludgeoning")] })] });
    const brute = creature({ id: "brute", side: "hostile", hp: { value: 300, max: 300 }, flags: { fearless: true }, actions: [strike({ bonus: 15, damage: [parseFormula("2d8+10", "slashing")] })] });
    let taken = 0;
    for ( let seed = 1; seed <= 6; seed++ ) {
      const r = replay(battle([guardian, ward, brute], { maxRounds: 3 }), pf2eRules, seed);
      for ( const blow of r.log.filter(e => e.type === "attack" && e.actor === "brute" && e.interceptedBy) ) {
        taken += 1;
        expect(blow.interceptedBy).toBe("guardian");
        expect(blow.damage).toBe(0); // the friend takes none of it
      }
    }
    expect(taken).toBeGreaterThan(0);
  });
});
