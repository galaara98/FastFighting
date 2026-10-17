/**
 * What playstyle perks can lean on in any system (core API 11): one in a hurry doesn't stop to get clear or set up; a
 * guard (5e Dodge) as the shield answer says; leans; a roll against the foes' sharpest eyes; a pulled blow; a price that
 * lands on a friend; a skill's own die; a caster by the system's say; Stealth for initiative.
 */
import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { prepareBattle, createRun, turnFor } from "../scripts/engine/battle-state.js";
import { takesSafeWay, isWary } from "../scripts/engine/behavior/reactions.js";
import { decideBuff, checkDc } from "../scripts/engine/behavior/support.js";
import { STATUS } from "../scripts/constants.js";
import { createRng } from "../scripts/engine/rng.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const sharp = { tactical: { base: 90, fudge: 0 }, brave: { base: 70, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
const runOf = (combatants, rules = pf2eRules, options = {}) => {
  const run = createRun(prepareBattle(battle(combatants, options), rules));
  run.rng = createRng(7);
  return run;
};
const dodge = { id: "me.dodge", name: "Dodge", kind: "buff", targets: "self", cost: 1, traits: [], tell: "dodge", guard: true, setup: true, outcome: { mods: { defAdv: -1 }, rounds: 1, label: "Dodging" } };
const hopeless = () => strike({ bonus: -30, damage: [parseFormula("1", "bludgeoning")] });
const brute = () => creature({ id: "brute", side: "hostile", hp: { value: 300, max: 300 }, flags: { fearless: true }, actions: [strike({ bonus: 20, damage: [parseFormula("3d10+10", "slashing")] })] });

describe("one played for the story", () => {
  test("forgets opportunity attacks as often as the setting says: a third of the time by default", () => {
    const wary = forget => {
      let n = 0;
      for ( let seed = 1; seed <= 600; seed++ ) {
        const run = runOf([creature({ id: "me", traits: sharp, roleplay: true }), brute()], pf2eRules, forget === undefined ? {} : { roleplayForgets: forget });
        run.rng = createRng(seed);
        if ( isWary(run, run.byId.get("me")) ) n++;
      }
      return n / 600;
    };
    expect(wary()).toBeGreaterThan(0.6);
    expect(wary()).toBeLessThan(0.74);
    expect(wary(0)).toBe(1);
    expect(wary(100)).toBe(0);
  });
});

describe("one in a hurry", () => {
  test("doesn't stop to get clear of a foe beside it: it takes the free swings", () => {
    const safe = { cost: { actions: 1 }, label: "Step" };
    const careful = runOf([creature({ id: "me", traits: sharp }), brute()]);
    expect(takesSafeWay(careful, careful.byId.get("me"), safe, turnFor(careful, careful.byId.get("me")))).toBe(true);
    const hurried = runOf([creature({ id: "me", traits: sharp, behavior: { rush: 1 } }), brute()]);
    expect(takesSafeWay(hurried, hurried.byId.get("me"), safe, turnFor(hurried, hurried.byId.get("me")))).toBe(false);
  });

  test("doesn't stop to set anything up (a Dodge)", () => {
    const run = runOf([creature({ id: "me", traits: sharp, actions: [hopeless(), dodge], behavior: { rush: 1 } }), brute()]);
    expect(decideBuff(run, run.byId.get("me"), turnFor(run, run.byId.get("me")))).toBe(null);
  });
});

describe("a guard (5e Dodge), where there's no shield to raise", () => {
  test("the shield answer says how readily: never, not at all; always, more readily than it would", () => {
    const decide = shield => {
      const run = runOf([creature({ id: "me", traits: sharp, actions: [hopeless(), dodge] }), brute()]);
      const u = run.byId.get("me");
      u.tac = { shield };
      return decideBuff(run, u, turnFor(run, u));
    };
    expect(decide("spare")?.action.id).toBe("me.dodge");
    expect(decide("never")).toBe(null);
    expect(decide("always").score).toBeCloseTo(decide("spare").score * 1.5);
  });
});

describe("leans and rolls", () => {
  test("an action that leans on a perk is worth that much more to one who has it", () => {
    const hide = { ...dodge, id: "me.hide", guard: false, leans: ["lowProfile"] };
    const score = behavior => {
      const run = runOf([creature({ id: "me", traits: sharp, actions: [hopeless(), hide], behavior }), brute()]);
      return decideBuff(run, run.byId.get("me"), turnFor(run, run.byId.get("me"))).score;
    };
    expect(score({ lowProfile: 0.5 })).toBeCloseTo(score({}) * 1.5);
  });

  test("a roll against the foes' sharpest eyes: the best of their Perception DCs", () => {
    const run = runOf([creature({ id: "me" }), creature({ id: "a", side: "hostile", perception: 3 }), creature({ id: "b", side: "hostile", perception: 9 })]);
    expect(checkDc(run, run.byId.get("me"), { against: "perception", dc: 10 })).toBe(19);
    expect(checkDc(run, run.byId.get("me"), { dc: 12 })).toBe(12);
  });

  test("a skill check names its die: a d10 never shows more than 10", () => {
    let highest = 0;
    for ( let seed = 1; seed <= 15; seed++ ) {
      const sage = creature({ id: "sage", traits: sharp, behavior: { study: 1 }, sizeUp: { mod: 0, dc: 5, faces: 10 } });
      // (A system that rolls a plain die: PF2e's own roll is always a d20.)
      const log = replay(battle([sage, creature({ id: "foe", side: "hostile", hp: { value: 200, max: 200 } })], { maxRounds: 2 }), { ...pf2eRules, roll: undefined }, seed).log;
      for ( const e of log.filter(x => x.type === "study" && x.check) ) highest = Math.max(highest, e.check.natural);
    }
    expect(highest).toBeGreaterThan(0);
    expect(highest).toBeLessThanOrEqual(10);
  });
});

describe("the system's say", () => {
  test("one who spares the fallen pulls a killing blow, where the system has a way to: the foe is knocked out", () => {
    const rules = { ...pf2eRules, pullsBlow: (u, action) => !!action.melee };
    const outcome = behavior => {
      const knight = creature({ id: "knight", traits: sharp, behavior, actions: [strike({ bonus: 30, damage: [parseFormula("40", "slashing")] })] });
      const goblin = creature({ id: "gob", side: "hostile", hp: { value: 5, max: 5 }, flags: { fearless: true }, actions: [hopeless()] });
      return replay(battle([knight, goblin], { maxRounds: 2 }), rules, 1).units.gob.status;
    };
    expect(outcome({})).toBe(STATUS.DEAD);
    expect(outcome({ spareDowned: 1 })).toBe(STATUS.DOWN);
  });

  test("the price of a miss can land on a friend put in harm's way", () => {
    const rules = { ...pf2eRules, backlash: (run, u, target) => ({ label: "Price", damage: [parseFormula("5", "untyped")], to: run.byId.get("friend") }) };
    const me = creature({ id: "me", actions: [strike({ bonus: -30 })] });
    const friend = creature({ id: "friend", hp: { value: 300, max: 300 }, actions: [hopeless()] });
    const r = replay(battle([me, friend, creature({ id: "foe", side: "hostile", hp: { value: 300, max: 300 }, actions: [hopeless()] })], { maxRounds: 1 }), rules, 3);
    const prices = r.log.filter(e => e.type === "backlash");
    expect(prices.length).toBeGreaterThan(0);
    expect(prices.every(e => e.actorId === "friend")).toBe(true);
  });

  test("a caster by the system's say (Ironsworn's horrors), with no spell to show for it", () => {
    const prep = prepareBattle(battle([creature({ id: "me" }), creature({ id: "haunt", side: "hostile", caster: true })]), pf2eRules);
    expect(prep.byId.get("haunt").isCaster).toBe(true);
    expect(prep.byId.get("me").isCaster).toBe(false);
  });

  test("keeping out of sight on the way in: Stealth for initiative, where the system rolls it (PF2e's Avoid Notice)", () => {
    const rules = { ...pf2eRules, stealthInitiative: true };
    const first = behavior => {
      const sneak = creature({ id: "sneak", initiative: { mod: -10, stealth: 40 }, behavior });
      const log = replay(battle([sneak, creature({ id: "foe", side: "hostile", initiative: { mod: 10 } })], { maxRounds: 1 }), rules, 2).log;
      return log.find(e => e.type === "initiative").order[0];
    };
    expect(first({ lowProfile: 0.3 })).toBe("sneak");
    expect(first({})).toBe("foe");
  });
});

describe("the log names the skill", () => {
  test("a heal's check, by its label (or medicine); first aid, by the skill given (or medicine)", async () => {
    const { logLine } = await import("../scripts/story/log-lines.js");
    const { text } = await import("./foundry-i18n.js");
    const check = { natural: 12, mod: 2, total: 14, dc: 10, degree: 2 };
    const heal = e => logLine({ type: "heal", actor: "Kara", target: "Brand", action: "Heal", amount: 2, check: { ...check, ...e } });
    expect(heal({ skill: "Heal (+wits)" })).toContain("Heal (+wits)");
    expect(heal({})).toContain("14");
    const aid = skill => logLine({ type: "firstAid", actor: "Kyra", target: "Valeros", skill, ...check, stable: true });
    expect(aid("binding the wound")).toContain("binding the wound");
    expect(aid(null)).toContain(text("FASTFIGHTING.Log.MedicineSkill"));
  });
});
