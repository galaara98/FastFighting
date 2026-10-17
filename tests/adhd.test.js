/**
 * A creature's own ADHD (0 to 100%, 0 by default): a nudge to its Tactical, down to 70% of what it is at 100%.
 * (The world's ADHD setting, the chance its mind jumps to the strongest thing it wants, is agenda.test.js's.)
 */
import { describe, expect, test } from "vitest";
import { prepareBattle } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle } from "./helpers.js";

const tacticalOf = adhd => {
  const me = creature({ id: "me", traits: { tactical: { base: 80, fudge: 0 }, brave: { base: 50, fudge: 0 }, selfish: { base: 50, fudge: 0 }, loyal: { base: 50, fudge: 0 } }, ...(adhd ? { adhd } : {}) });
  const prep = prepareBattle(battle([me, creature({ id: "foe", side: "hostile" })]), pf2eRules);
  return prep.combatants.find(c => c.spec.id === "me").traits.tactical;
};

describe("a creature's own ADHD", () => {
  test("none: its Tactical as it is; all of it: 70% of that; half: 85%", () => {
    const base = tacticalOf(0);
    expect(tacticalOf(100)).toBe(Math.round(base * 0.7));
    expect(tacticalOf(50)).toBe(Math.round(base * 0.85));
  });
});
