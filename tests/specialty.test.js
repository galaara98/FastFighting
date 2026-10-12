/**
 * Magic and specialties: what counts as one, and the answer (an Un-Mundane character's lean) that makes it likelier
 * than a plain blow, an everyday move or talking.
 */
import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { prepareBattle, createRun, turnFor } from "../scripts/engine/battle-state.js";
import { isSpecial, specialtyLean, helpsTalk, talkDamping, SPECIALTY_WEIGHT } from "../scripts/engine/behavior/specialty.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";
import { suggestTactics, TACTIC_KEYS } from "../scripts/engine/tactics.js";
import { createRng } from "../scripts/engine/rng.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const sharp = { tactical: { base: 80, fudge: 0 }, brave: { base: 70, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
const sword = () => strike({ id: "sword", bonus: 12, damage: [parseFormula("1d8+4", "slashing")] });
const bolt = () => ({ id: "bolt", name: "Bolt", kind: "spell-attack", cost: 1, bonus: 10, rank: 1, range: { increment: 60, max: 60 }, damage: [parseFormula("2d6", "fire")] });

describe("what counts", () => {
  test("magic, an ability with its own uses or the character's own resource; not a weapon, gear, a taunt or first aid", () => {
    expect(isSpecial(bolt())).toBe(true);
    expect(isSpecial({ kind: "save", uses: 1 })).toBe(true);
    expect(isSpecial({ kind: "buff", resource: "focus" })).toBe(true);
    expect(isSpecial(sword())).toBe(false);
    expect(isSpecial({ kind: "heal", resource: "item:p1", selfOnly: true })).toBe(false);
    expect(isSpecial({ kind: "heal", firstAid: true })).toBe(false);
    expect(isSpecial({ kind: "control", goad: 1, resource: "x" })).toBe(false);
    // (What the system marks wins: a class's own strike; Help an Ally, though it costs a Hope.)
    expect(isSpecial({ ...sword(), special: true })).toBe(true);
    expect(isSpecial({ kind: "buff", resource: "hope", special: false })).toBe(false);
  });

  test("Un-Mundane leans hard on them (and spends freely); a Puzzle-Maniac a little; the question comes after resources", () => {
    expect(combinePlaystyles(["unmundane"]).suggest).toMatchObject({ specialty: "strong", resourceUse: "nova" });
    expect(combinePlaystyles(["puzzleManiac"]).suggest.specialty).toBe("some");
    expect(suggestTactics(creature({ actions: [bolt()] })).specialty).toBe("none");
    expect(TACTIC_KEYS.indexOf("specialty")).toBe(TACTIC_KEYS.indexOf("resourceUse") + 1);
  });
});

describe("the answer", () => {
  test("a specialty counts its weight more against attacking; something ordinary that much less, while a specialty's at hand", () => {
    const run = createRun(prepareBattle(battle([creature({ id: "me", actions: [sword(), bolt()] }), creature({ id: "foe", side: "hostile" })]), pf2eRules));
    const u = run.byId.get("me");
    u.tac = { specialty: "strong" };
    expect(specialtyLean(u, bolt())).toBe(SPECIALTY_WEIGHT.strong);
    expect(specialtyLean(u, { kind: "buff", targets: "self" })).toBeCloseTo(1 / SPECIALTY_WEIGHT.strong);
    u.tac = { specialty: "none" };
    expect(specialtyLean(u, bolt())).toBe(1);
  });

  test("the stronger the answer, the more often it casts where its sword would do as well", () => {
    const casts = specialty => {
      let n = 0;
      for ( let seed = 1; seed <= 15; seed++ ) {
        const me = creature({ id: "me", traits: sharp, actions: [sword(), bolt()], tactics: { specialty } });
        const foe = creature({ id: "foe", side: "hostile", hp: { value: 200, max: 200 }, flags: { fearless: true }, actions: [strike({ bonus: -20 })] });
        n += replay(battle([me, foe], { maxRounds: 3 }), pf2eRules, seed).log.filter(e => e.actorId === "me" && e.action === "Bolt").length;
      }
      return n;
    };
    const counts = ["none", "some", "strong", "always"].map(casts);
    // (Here a little more often already casts now and then, and much more often casts every time it can.)
    expect(counts[1]).toBeGreaterThan(counts[0]);
    expect(counts[2]).toBeGreaterThan(counts[1]);
    expect(counts[3]).toBeGreaterThanOrEqual(counts[2]);
  });
});

describe("talking", () => {
  const charm = { id: "charm", name: "Charm", kind: "control", cost: 2, rank: 1, save: { type: "will", dc: 17 }, onSave: [{ conditions: { controlled: 1 }, rounds: 10 }, { conditions: { controlled: 1 }, rounds: 1 }, null, null] };
  const guidance = { id: "guidance", name: "Guidance", kind: "buff", cost: 1, rank: 0, targets: "self", outcome: { mods: { checkDie: 4 }, uses: 1, rounds: 1 } };

  test("a specialty that makes it better with words: a charm, an edge to its checks; not a bolt", () => {
    expect(helpsTalk(charm)).toBe(true);
    expect(helpsTalk(guidance)).toBe(true);
    expect(helpsTalk(bolt())).toBe(false);
    expect(helpsTalk({ kind: "buff", outcome: { mods: { checkDie: 4 } } })).toBe(false); // (anyone's: not a specialty)
  });

  test("leaning on its specialties, it talks less, unless one of them makes it better with words", () => {
    const damping = actions => {
      const run = createRun(prepareBattle(battle([creature({ id: "me", actions }), creature({ id: "foe", side: "hostile" })]), pf2eRules));
      const u = run.byId.get("me");
      u.tac = { specialty: "strong" };
      return talkDamping(u);
    };
    expect(damping([sword(), bolt()])).toBeCloseTo(1 / SPECIALTY_WEIGHT.strong);
    expect(damping([sword(), bolt(), charm])).toBe(1);
    expect(damping([sword(), bolt(), guidance])).toBe(1);
    expect(damping([sword()])).toBe(1);
  });
});
