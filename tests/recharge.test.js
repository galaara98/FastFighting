import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

/** A dragon with a breath weapon (one use, which may come back) against a sturdy knight. */
function lair(breath) {
  const dragon = creature({
    id: "dragon", side: "hostile", hp: { value: 400, max: 400 }, flags: { fearless: true },
    actions: [strike({ id: "bite", bonus: 5, damage: [parseFormula("1d6", "piercing")] }),
      { id: "breath", name: "Breath", kind: "save", cost: 2, save: { type: "reflex", dc: 25, basic: true }, damage: [parseFormula("6d6", "fire")], uses: 1, ...breath }]
  });
  const knight = creature({ id: "knight", kind: "pc", diesAtZero: false, hp: { value: 900, max: 900 }, actions: [strike({ bonus: 0, damage: [parseFormula("1", "slashing")] })] });
  return battle([knight, dragon], { maxRounds: 12 });
}
const breaths = (spec, seed) => replay(spec, pf2eRules, seed).log.filter(e => e.actor === "dragon" && e.action === "Breath" && e.type === "save").map(e => e.round);

describe("abilities that come back", () => {
  test("a one-use ability without a recharge is used once", () => {
    for ( let seed = 1; seed <= 5; seed++ ) expect(new Set(breaths(lair({}), seed)).size).toBeLessThanOrEqual(1);
  });

  test("5e Recharge 5–6: it comes back on a d6, about a third of the turns", () => {
    let uses = 0;
    for ( let seed = 1; seed <= 10; seed++ ) uses += new Set(breaths(lair({ recharge: { on: 5, die: 6 } }), seed)).size;
    expect(uses / 10).toBeGreaterThan(2.5); // 12 rounds: ~1 + 11/3 at best
  });

  test("PF2e: can't use it again for 1d4 rounds", () => {
    for ( let seed = 1; seed <= 8; seed++ ) {
      const rounds = [...new Set(breaths(lair({ cooldown: { n: 1, faces: 4 } }), seed))].sort((a, b) => a - b);
      expect(rounds.length).toBeGreaterThan(1);
      for ( let i = 1; i < rounds.length; i++ ) {
        expect(rounds[i] - rounds[i - 1]).toBeGreaterThanOrEqual(1);
        expect(rounds[i] - rounds[i - 1]).toBeLessThanOrEqual(5);
      }
    }
  });
});
