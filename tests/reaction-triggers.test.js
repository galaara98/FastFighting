import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { genericRules } from "../scripts/adapters/generic/rules.js";
import { STATUS } from "../scripts/constants.js";
import { REACTION_TRIGGERS, TRIGGERS, REACTION_EFFECTS, triggerOf, triggersOf, answersTo } from "../scripts/story/master.js";
import { tellingOrder } from "../scripts/story/story.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const rules = { ...genericRules, id: "test-triggers", reactions: () => 1, onDropped(c) { c.status = c.spec.kind === "pc" ? STATUS.DOWN : STATUS.DEAD; c.stable = true; return c.status; } };
const traits = (tactical = 70) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 20, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const logs = (spec, ruleset = rules, seeds = 12) => {
  const out = [];
  for ( let s = 1; s <= seeds; s++ ) out.push(replay(spec, ruleset, s).log);
  return out;
};

describe("the master list of reaction triggers", () => {
  test("every trigger once, in its group; the effects named", () => {
    expect(new Set(TRIGGERS).size).toBe(TRIGGERS.length);
    expect(TRIGGERS.length).toBe(Object.values(REACTION_TRIGGERS).reduce((n, g) => n + g.length, 0));
    expect(TRIGGERS.length).toBeGreaterThan(90);
    for ( const id of ["attacked", "hit", "missed", "damaged", "allyHit", "foeCasts", "foeLeavesReach", "foeOpening", "foeMovesInReach", "allyTargeted", "wouldDrop", "slain"] ) {
      expect(TRIGGERS).toContain(id);
    }
    expect(REACTION_EFFECTS).toEqual(expect.arrayContaining(["acBonus", "halve", "reduce", "stayUp", "areaBurst", "guardAlly", "takeTheBlow", "strike", "counter"]));
  });

  test("a reaction's on: a trigger, an older name, or a list of them", () => {
    expect(triggerOf("spell")).toBe("foeCasts");
    expect(triggerOf("leaveReach")).toBe("foeLeavesReach");
    expect(triggerOf("nonsense")).toBe(null);
    expect(triggersOf({ on: ["foeOpening", "foeMovesInReach", "leaveReach", "nonsense"] })).toEqual(["foeOpening", "foeMovesInReach", "foeLeavesReach"]);
    expect(answersTo({ on: "spell" }, "foeCasts")).toBe(true);
    expect(answersTo({ on: "foeCasts" }, "spell")).toBe(true);
    expect(answersTo({ on: ["attacked", "hit"] }, "hit")).toBe(true);
    expect(answersTo({ on: "hit" }, "missed")).toBe(false);
  });
});

describe("the engine at the new moments", () => {
  const brute = (extra = {}) => creature({ id: "brute", side: "hostile", hp: { value: 500, max: 500 }, defenses: { ac: 10, fortitude: 2, reflex: 2, will: 2 },
    actions: [strike({ id: "maul", name: "Maul", bonus: 12, damage: [parseFormula("3d6+8", "bludgeoning")] })], flags: { fearless: true }, traits: traits(40), ...extra });

  test("about to fall: Relentless Endurance keeps it up at 1 hit point, once", () => {
    const relentless = { id: "relentless", label: "Relentless Endurance", on: "wouldDrop", stayUp: { hp: 1 }, uses: 1, free: true };
    const hero = creature({ id: "hero", kind: "pc", diesAtZero: false, hp: { value: 30, max: 30 }, defenses: { ac: 10, fortitude: 2, reflex: 2, will: 2 }, traits: traits(70),
      actions: [strike({ id: "axe", name: "Axe", bonus: 2, damage: [parseFormula("1d6", "slashing")] })], reactions: [relentless] });
    let held = 0;
    for ( const log of logs(battle([hero, brute()], { maxRounds: 8 })) ) {
      const used = log.filter(e => e.type === "reaction" && e.trigger === "wouldDrop");
      expect(used.length).toBeLessThanOrEqual(1);
      held += used.length;
      // (Kept up: the blow that would have dropped it didn't; a later one may.)
      if ( used.length ) {
        const at = log.indexOf(used[0]);
        expect(log.slice(at + 1).findIndex(e => ["down", "death"].includes(e.type) && e.actorId === "hero")).not.toBe(0);
      }
    }
    expect(held).toBeGreaterThan(3);
  });

  test("slain: a death burst hurts everyone beside it as it goes, a save for half", () => {
    const burst = { id: "burst", label: "Death Burst", on: "slain", free: true, areaBurst: { damage: [parseFormula("2d6", "fire")], save: { type: "reflex", dc: 30, basic: true }, range: 5 } };
    const mephit = creature({ id: "mephit", side: "hostile", hp: { value: 3, max: 3 }, defenses: { ac: 5, fortitude: 2, reflex: 2, will: 2 }, reactions: [burst], traits: traits(40),
      actions: [strike({ id: "claw", name: "Claw", bonus: -20, damage: [parseFormula("1d4", "slashing")] })] });
    const hero = creature({ id: "hero", kind: "pc", diesAtZero: false, hp: { value: 100, max: 100 }, traits: traits(70), initiative: { mod: 50 },
      actions: [strike({ id: "sword", name: "Sword", bonus: 30, damage: [parseFormula("1d8+10", "slashing")] })] });
    let burned = 0;
    for ( const log of logs(battle([hero, mephit], { maxRounds: 2 })) ) {
      const went = log.filter(e => e.type === "reaction" && e.trigger === "slain" && e.actorId === "mephit");
      expect(went.length).toBeLessThanOrEqual(1);
      const hurt = log.filter(e => e.type === "auto" && e.reaction && e.actorId === "mephit" && e.targetId === "hero");
      if ( went.length ) burned += hurt.filter(e => e.damage > 0).length;
    }
    expect(burned).toBeGreaterThan(3);
  });

  test("a friend attacked: one beside it covers it (+AC against that attack)", () => {
    const protection = { id: "protection", label: "Protection", on: "allyTargeted", ac: 5, range: 5 };
    const guard = creature({ id: "guard", kind: "pc", diesAtZero: false, hp: { value: 400, max: 400 }, defenses: { ac: 40, fortitude: 2, reflex: 2, will: 2 }, traits: traits(70), reactions: [protection],
      actions: [strike({ id: "spear", name: "Spear", bonus: 0, damage: [parseFormula("1d4", "piercing")] })] });
    const ward = creature({ id: "ward", kind: "pc", diesAtZero: false, hp: { value: 400, max: 400 }, defenses: { ac: 10, fortitude: 2, reflex: 2, will: 2 }, traits: traits(70),
      actions: [strike({ id: "dagger", name: "Dagger", bonus: 0, damage: [parseFormula("1d4", "piercing")] })] });
    let covered = 0;
    for ( const log of logs(battle([guard, ward, brute()], { maxRounds: 4 })) ) {
      const cover = log.filter(e => e.type === "reaction" && e.trigger === "allyTargeted");
      expect(cover.every(e => e.actorId === "guard")).toBe(true);
      covered += cover.length;
    }
    expect(covered).toBeGreaterThan(3);
  });
});

describe("opportunity strikes at the moments the system says (PF2e Reactive Strike)", () => {
  const at = (x, y = 0) => ({ x, y, size: 5 });
  const reactive = { ...pf2eRules, opportunityOn: ["foeLeavesReach", "foeOpening", "foeMovesInReach"] };
  const bow = strike({ id: "bow", name: "Shortbow", melee: false, reach: undefined, range: { increment: 60 }, bonus: 9 });
  const archer = (extra = {}) => creature({ id: "hero", position: at(0), traits: traits(25), initiative: { mod: 50 }, actions: [bow], ...extra });
  const brute = () => creature({ id: "brute", side: "hostile", position: at(5), hp: { value: 500, max: 500, temp: 0 }, actions: [strike({ bonus: -50 })], flags: { reactiveStrike: true } });
  const struck = (log, trigger) => log.filter(e => e.type === "opportunity" && e.targetId === "hero" && e.trigger === trigger).length;

  test("shooting in reach draws a strike; not where the system doesn't say so", () => {
    const spec = battle([archer(), brute()], { positioning: true, maxRounds: 1, aftermath: "none" });
    const drawn = logs(spec, reactive, 6).reduce((n, log) => n + struck(log, "foeOpening"), 0);
    expect(drawn).toBeGreaterThan(0);
    expect(logs(spec, pf2eRules, 6).reduce((n, log) => n + struck(log, "foeOpening"), 0)).toBe(0);
  });

  test("standing up in reach draws one too; told where it happens, not moved after a move", () => {
    const spec = battle([archer({ conditions: { prone: 1 }, actions: [strike({ id: "sword", name: "Sword" })] }), brute()], { positioning: true, maxRounds: 1, aftermath: "none" });
    const r = replay(spec, reactive, 2);
    expect(struck(r.log, "foeMovesInReach")).toBe(1);
    const told = tellingOrder(r.log);
    const blow = told.findIndex(e => e.type === "opportunity" && e.trigger === "foeMovesInReach");
    const stand = told.findIndex(e => e.type === "stand" && e.actorId === "hero");
    expect(blow).toBeLessThan(stand);
  });
});
