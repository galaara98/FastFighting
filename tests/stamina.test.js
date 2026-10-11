import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { commonOutcome } from "../scripts/i18n.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle } from "./helpers.js";
import { en } from "./foundry-i18n.js";

const quiet = { pitches: {}, resist: {}, languages: [] };

describe("stamina: spent before hit points (PF2e's Stamina variant)", () => {
  const fight = () => battle([
    creature({ id: "hero", kind: "pc", diesAtZero: false, hp: { value: 20, max: 20, temp: 0, stamina: { value: 15, max: 15 } }, social: quiet }),
    creature({ id: "orc", side: "hostile", hp: { value: 40, max: 40 }, social: quiet })
  ], { talking: false, morale: false });

  test("damage takes stamina before hit points, and stamina never comes back", () => {
    let hurt = 0;
    for ( let seed = 1; seed <= 40; seed++ ) {
      const hero = replay(fight(), pf2eRules, seed).units.hero.final;
      expect(hero.stamina).toBeLessThanOrEqual(15);
      if ( hero.stamina > 0 ) expect(hero.hp).toBe(20); // (hit points untouched while stamina lasts)
      if ( hero.hp < 20 ) {
        expect(hero.stamina).toBe(0);
        hurt++;
      }
    }
    expect(hurt).toBeGreaterThan(0);
  });

  test("Make it So names a change of stamina in the game's word for it; a creature without stamina has no such line", () => {
    const spec = { kind: "pc", hp: { value: 20, max: 20, stamina: { value: 15, max: 15 } } };
    expect(commonOutcome(spec, { hp: 12, stamina: 0, status: "standing" })).toContain(en["FASTFIGHTING.MakeItSo.Outcome.Stamina"]
      .replace("{SP}", en["FASTFIGHTING.Stat.sp"]).replace("{from}", "15").replace("{to}", "0"));
    expect(commonOutcome({ kind: "npc", hp: { value: 20, max: 20 } }, { hp: 12, stamina: 0, status: "standing" })).toHaveLength(1);
  });
});
