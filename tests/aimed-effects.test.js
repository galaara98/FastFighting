/**
 * API 20: effects aimed at some rolls only. Conditions against one creature's melee attacks alone (an outcome's
 * `onlyVs: "melee"`), spent with `uses` by its attacks (PF2e's Feint: off-guard to the feinter's next melee attack);
 * and bonuses to one save or one check alone (mods.js bySave, byCheck: PF2e's Bon Mot, Will saves and Perception).
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, prepareBattle } from "../scripts/engine/simulator.js";
import { isExposed, saveRoll, defenseDc, checkRoll } from "../scripts/engine/battle-state.js";
import { applyOutcome, spendEdges } from "../scripts/engine/behavior/effects.js";
import { combineMods, describeMods } from "../scripts/engine/mods.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

/** The fixture's rules with the core's own reading of who's exposed (its exposedTo: off-guard to one attacker). */
const rules = { ...pf2eRules, modifiers: { ...pf2eRules.modifiers, exposed: undefined } };

function setUp() {
  const run = beginRun(prepareBattle(battle([creature({ id: "rogue" }), creature({ id: "foe", side: "hostile", perception: 6 }), creature({ id: "other" })]), rules), 1);
  beginRound(run, 1);
  return ["rogue", "foe", "other"].map(id => run.byId.get(id)).concat([run]);
}

const sword = strike({ id: "sword", melee: true });
const bow = strike({ id: "bow", melee: false, range: { increment: 60, max: 360 } });

describe("off-guard to one creature's melee attacks, for its next one (onlyVs: \"melee\", uses)", () => {
  test("its melee attacks find the foe exposed; its ranged ones and anyone else's don't", () => {
    const [rogue, foe, other, run] = setUp();
    applyOutcome(foe, { conditions: { offGuard: 1 }, onlyVs: "melee", uses: 1, rounds: 1 }, rogue.id, { id: "feint" });
    expect(isExposed(run, foe, rogue, sword)).toBe(true);
    expect(isExposed(run, foe, rogue, bow)).toBe(false);
    expect(isExposed(run, foe, other, sword)).toBe(false);
  });

  test("spent by its next melee attack, not by a ranged one nor by another's", () => {
    const [rogue, foe, other, run] = setUp();
    applyOutcome(foe, { conditions: { offGuard: 1 }, onlyVs: "melee", uses: 1, rounds: 1 }, rogue.id, { id: "feint" });
    spendEdges(foe, "defend", rogue.id, { melee: false });
    spendEdges(foe, "defend", other.id, { melee: true });
    expect(isExposed(run, foe, rogue, sword)).toBe(true);
    spendEdges(foe, "defend", rogue.id, { melee: true });
    expect(isExposed(run, foe, rogue, sword)).toBe(false);
  });

  test("without uses, it lasts its rounds; plain onlyVs is to every attack of its source's", () => {
    const [rogue, foe, , run] = setUp();
    applyOutcome(foe, { conditions: { offGuard: 1 }, onlyVs: "melee", rounds: 2 }, rogue.id, { id: "feint" });
    spendEdges(foe, "defend", rogue.id, { melee: true });
    expect(isExposed(run, foe, rogue, sword)).toBe(true);
    const [r2, f2, , run2] = setUp();
    applyOutcome(f2, { conditions: { offGuard: 1 }, onlyVs: true, rounds: 1 }, r2.id, { id: "trick" });
    expect(isExposed(run2, f2, r2, bow)).toBe(true);
  });
});

describe("a bonus or penalty to one save or one check alone (bySave, byCheck)", () => {
  test("combined: the best bonus and the worst penalty of its kind, every save's counted with it", () => {
    expect(combineMods([{ bySave: { will: -2 } }, { bySave: { will: -3 } }])).toEqual({ bySave: { will: -3 } });
    // (A penalty to every save already: only what's worse for Will on top.)
    expect(combineMods([{ saves: -1 }, { bySave: { will: -2 } }])).toEqual({ saves: -1, bySave: { will: -1 } });
    expect(combineMods([{ saves: -3 }, { bySave: { will: -2 } }])).toEqual({ saves: -3 });
    expect(combineMods([{ saves: 1 }, { bySave: { will: 2, fortitude: -1 } }])).toEqual({ saves: 1, bySave: { will: 1, fortitude: -1 } });
    expect(combineMods([{ byCheck: { perception: -2 } }])).toEqual({ byCheck: { perception: -2 } });
    expect(describeMods({ bySave: { will: -2 }, byCheck: { perception: -2 } })).toBe(describeMods({ saves: -2 }));
  });

  test("Will saves and Perception only: the Will save and DC, the Perception DC and checks; not Fortitude, nor another skill", () => {
    const [rogue, foe, , run] = setUp();
    const before = {
      will: saveRoll(run, foe, "will").mod, fortitude: saveRoll(run, foe, "fortitude").mod, willDc: defenseDc(run, foe, "will"),
      perceptionDc: defenseDc(run, foe, "perception"), notice: checkRoll(run, foe, 6, null, { skill: "perception" }).mod, athletics: checkRoll(run, foe, 6, null, { skill: "athletics" }).mod
    };
    applyOutcome(foe, { mods: { bySave: { will: -2 }, byCheck: { perception: -2 } }, rounds: 10, label: "Flustered" }, rogue.id, { id: "bon-mot" });
    expect(saveRoll(run, foe, "will").mod).toBe(before.will - 2);
    expect(saveRoll(run, foe, "fortitude").mod).toBe(before.fortitude);
    expect(defenseDc(run, foe, "will")).toBe(before.willDc - 2);
    expect(defenseDc(run, foe, "perception")).toBe(before.perceptionDc - 2);
    expect(checkRoll(run, foe, 6, null, { skill: "perception" }).mod).toBe(before.notice - 2);
    expect(checkRoll(run, foe, 6, null, { skill: "athletics" }).mod).toBe(before.athletics);
  });
});
