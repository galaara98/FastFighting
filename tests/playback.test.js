import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { packSpec, unpackSpec } from "../scripts/foundry/make-it-so.js";
import { creature, strike, battle } from "./helpers.js";

function fight() {
  const at = (x, y) => ({ x, y, size: 5 });
  return battle([
    creature({ id: "amiri", name: "Amiri", kind: "pc", diesAtZero: false, position: at(0, 0), actions: [strike({ name: "Bastard Sword" })] }),
    creature({ id: "wolf", name: "Wolf", side: "hostile", position: at(40, 0), actions: [strike({ name: "Jaws", uses: Infinity, damage: [parseFormula("1d6+2", "piercing")] })] })
  ], { positioning: true });
}

describe("a fight kept on the scene while it plays", () => {
  test("comes back exactly, limitless numbers and all", () => {
    const spec = fight();
    spec.combatants[1].reach = Infinity;
    spec.combatants[1].odd = -Infinity;
    const back = unpackSpec(packSpec(spec));
    expect(back.combatants[1].reach).toBe(Infinity);
    expect(back.combatants[1].odd).toBe(-Infinity);
    expect(back.combatants[1].actions[0].uses).toBe(Infinity);
    expect(back).toEqual(spec);
  });

  test("plays the same fight again after a crash", () => {
    const spec = fight();
    const back = unpackSpec(packSpec(spec));
    for ( const seed of [1, 5, 9] ) {
      expect(JSON.stringify(replay(back, pf2eRules, seed).log)).toBe(JSON.stringify(replay(spec, pf2eRules, seed).log));
    }
  });
});
