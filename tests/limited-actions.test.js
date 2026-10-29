/**
 * Actions a turn may spend only on some things (rules.modifiers.limitedActions, engine/turn.js): PF2e's quickened, an
 * action more for a single Strike or a Stride, never part of an activity nor anything else.
 */
import { describe, expect, test } from "vitest";
import { Turn, limitedFits } from "../scripts/engine/turn.js";
import { replay } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const quick = { ...pf2eRules, modifiers: { ...pf2eRules.modifiers, limitedActions: u => (u.conds?.quickened ? { n: 1, for: ["strike", "stride"] } : null) } };
const hasted = { conds: { quickened: 1 }, mods: {} };
const sword = { id: "sword", kind: "strike", cost: 1 };
const spell = { id: "bolt", kind: "save", cost: 2 };
const swing = { id: "swing", kind: "strike", cost: 2, classAction: "vicious-swing" };

describe("limited actions on the Turn", () => {
  test("what fits: a single Strike, a Stride; not an activity, nor a spell", () => {
    const kinds = new Set(["strike", "stride"]);
    expect(limitedFits(kinds, sword)).toBe(true);
    expect(limitedFits(kinds, swing)).toBe(false);
    expect(limitedFits(kinds, { ...sword, sequence: [sword, sword] })).toBe(false);
    expect(limitedFits(kinds, spell)).toBe(false);
  });

  test("four actions, one for a Strike or a Stride: a 2-action spell and a Strike, then only a Strike or a move", () => {
    const turn = new Turn(quick, hasted, -1);
    expect(turn.left).toBe(4);
    expect(turn.canAfford(3, spell)).toBe(true);
    expect(turn.canAfford(4)).toBe(false);
    turn.spend(2, spell);
    turn.spend(1, sword);
    expect(turn.left).toBe(1);
    expect(turn.canAfford(1, sword)).toBe(true);
    turn.spend(1, sword);
    expect(turn.left).toBe(0);
  });

  test("three spent on anything else leave the one only a Strike or a Stride can use", () => {
    const turn = new Turn(quick, hasted, -1);
    turn.spend(2, spell);
    turn.spend(1, { id: "demoralize", kind: "control", cost: 1 });
    expect(turn.left).toBe(1);
    expect(turn.canAfford(1, { id: "demoralize", kind: "control", cost: 1 })).toBe(false);
    expect(turn.canAfford(1)).toBe(false);
    expect(turn.canAfford(1, sword)).toBe(true);
    expect(turn.payForMove(25)).toBe(25);
    expect(turn.left).toBe(0);
  });

  test("never two activities of two actions on it: the second can't be paid", () => {
    const turn = new Turn(quick, hasted, -1);
    turn.spend(2, swing);
    expect(turn.canAfford(2, swing)).toBe(false);
    expect(turn.howMany(1, sword)).toBe(2);
  });

  test("without the system's limits, every action is any action", () => {
    const turn = new Turn(pf2eRules, hasted, -1);
    turn.spend(2, spell);
    expect(turn.canAfford(2, spell)).toBe(true);
  });
});

describe("a hasted caster in a fight", () => {
  test("its two-action spells never take the extra action: two in a turn at most once the third is a Strike's", () => {
    const blast = { id: "blast", name: "Blast", kind: "spell-attack", cost: 2, bonus: 30, maps: [0, -5, -10], range: { increment: 60, max: 60 }, melee: false,
      damage: [{ dice: [{ n: 6, faces: 6, mult: 1 }], flat: 0, type: "fire", persistent: false, category: null }] };
    const spec = battle([
      creature({ id: "mage", actions: [blast, strike({ id: "staff", name: "Staff", bonus: 0 })], conditions: { quickened: 1 }, hp: { value: 200, max: 200 } }),
      creature({ id: "ogre", side: "hostile", hp: { value: 5000, max: 5000 }, flags: { fearless: true } })
    ], { maxRounds: 3 });
    const rules = { ...quick, modifiers: { ...quick.modifiers, actionsLost: u => (u.conds.quickened ? -1 : 0) } };
    for ( const seed of [1, 2, 3] ) {
      const r = replay(spec, rules, seed);
      const blasts = new Map();
      for ( const e of r.log.filter(x => x.actorId === "mage" && x.action === "Blast" && x.type === "attack") ) blasts.set(e.round, (blasts.get(e.round) ?? 0) + 1);
      expect(Math.max(0, ...blasts.values())).toBeLessThanOrEqual(1);
    }
  });
});
