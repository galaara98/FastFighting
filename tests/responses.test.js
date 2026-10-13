import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { parseFormula, part } from "../scripts/engine/dice.js";
import { genericRules } from "../scripts/adapters/generic/rules.js";
import { STATUS } from "../scripts/constants.js";
import { creature, strike, battle } from "./helpers.js";

/** A 5e-ish game: one reaction a round, nobody makes opportunity attacks (they'd only muddy these tests). */
const rules = { ...genericRules, id: "test-responses", reactions: () => 1, onDropped(c) { c.status = c.spec.kind === "pc" ? STATUS.DOWN : STATUS.DEAD; c.stable = true; return c.status; } };
const traits = (tactical = 70) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 20, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const brute = (extra = {}) => creature({ id: "brute", side: "hostile", hp: { value: 500, max: 500 }, defenses: { ac: 12, fortitude: 2, reflex: 2, will: 2 },
  actions: [strike({ id: "club", name: "Club", bonus: 6, damage: [parseFormula("2d6+4", "bludgeoning")] })], flags: { fearless: true }, traits: traits(40), ...extra });
const hero = (extra = {}) => creature({ id: "hero", kind: "pc", diesAtZero: false, hp: { value: 400, max: 400 }, defenses: { ac: 13, fortitude: 2, reflex: 2, will: 2 }, traits: traits(70),
  actions: [strike({ id: "staff", name: "Staff", bonus: 2, damage: [parseFormula("1d6", "bludgeoning")] })], ...extra });
const logs = (spec, seeds = 12) => {
  const out = [];
  for ( let s = 1; s <= seeds; s++ ) out.push(replay(spec, rules, s).log);
  return out;
};

describe("reactions that answer an attack", () => {
  test("Shield: a hit becomes a miss when +5 AC is enough; at most once a round; it spends its slot", () => {
    const shield = { id: "shield", label: "Shield", on: "hit", ac: 5, resource: "slot" };
    const spec = battle([hero({ reactions: [shield], resources: { slot: 3 }, tac: { resourceUse: "nova" } }), brute()], { maxRounds: 6 });
    let saved = 0;
    for ( const log of logs(spec) ) {
      const used = log.filter(e => e.type === "reaction" && e.reaction === "Shield");
      expect(used.length).toBeLessThanOrEqual(3);
      const rounds = used.map(e => e.round);
      expect(new Set(rounds).size).toBe(rounds.length);
      saved += log.filter(e => e.type === "attack" && e.savedBy === "Shield").length;
    }
    expect(saved).toBeGreaterThan(3);
  });

  test("Uncanny Dodge halves a blow; Shield Block takes some off", () => {
    const dodge = { id: "uncanny", label: "Uncanny Dodge", on: "hit", halve: true };
    const halved = logs(battle([hero({ reactions: [dodge] }), brute()], { maxRounds: 3 })).flat().filter(e => e.type === "attack" && e.lessened > 0);
    expect(halved.length).toBeGreaterThan(3);
    const block = { id: "block", label: "Shield Block", on: "hit", reduce: part([], 5, "untyped"), physical: true };
    const blocked = logs(battle([hero({ reactions: [block] }), brute()], { maxRounds: 3 })).flat().filter(e => e.type === "attack" && e.lessened > 0);
    expect(blocked.length).toBeGreaterThan(3);
    for ( const e of blocked ) expect(e.lessened).toBeLessThanOrEqual(5);
  });

  test("Nimble Dodge: +2 AC before the roll", () => {
    const nimble = { id: "nimble", label: "Nimble Dodge", on: "attacked", ac: 2 };
    const reacted = logs(battle([hero({ reactions: [nimble] }), brute()], { maxRounds: 3 })).flat().filter(e => e.type === "reaction" && e.trigger === "attacked");
    expect(reacted.length).toBeGreaterThan(3);
  });

  test("a reaction is told after the attack it answers, never before (the dice come first, then the answer)", () => {
    const shield = { id: "shield", label: "Shield", on: "hit", ac: 5, resource: "slot" };
    const nimble = { id: "nimble", label: "Nimble Dodge", on: "attacked", ac: 2 };
    const block = { id: "block", label: "Shield Block", on: "hit", reduce: part([], 5, "untyped"), physical: true };
    let told = 0;
    for ( const reactions of [[shield], [nimble], [block]] ) {
      for ( const log of logs(battle([hero({ reactions, resources: { slot: 3 } }), brute()], { maxRounds: 3 })) ) {
        log.forEach((e, i) => {
          if ( e.type !== "reaction" ) return;
          told += 1;
          // (Several answers to one blow follow it together.)
          let k = i - 1;
          while ( log[k]?.type === "reaction" ) k -= 1;
          expect(log[k]).toMatchObject({ type: "attack", actorId: e.targetId, targetId: e.actorId });
        });
      }
    }
    expect(told).toBeGreaterThan(5);
  });

  test("Riposte: a melee miss is answered with a strike", () => {
    const riposte = { id: "riposte", label: "Riposte", on: "missed", strike: true };
    const fencer = hero({ defenses: { ac: 20, fortitude: 2, reflex: 2, will: 2 }, reactions: [riposte], actions: [strike({ id: "rapier", name: "Rapier", bonus: 6, damage: [parseFormula("1d8+3", "piercing")] })] });
    let answered = 0;
    for ( const log of logs(battle([fencer, brute()], { maxRounds: 4 })) ) {
      log.forEach((e, i) => {
        if ( e.type === "reaction" && e.reaction === "Riposte" ) {
          answered += 1;
          expect(log[i + 1]).toMatchObject({ type: "attack", actorId: "hero", targetId: "brute" });
        }
      });
    }
    expect(answered).toBeGreaterThan(3);
  });
});

describe("reactions that answer harm, and spells", () => {
  test("Hellish Rebuke: fire for whoever hurt it", () => {
    const rebuke = { id: "rebuke", label: "Hellish Rebuke", on: "damaged", resource: "slot", damage: [parseFormula("2d10", "fire")], save: { type: "reflex", dc: 30, basic: true }, range: 60 };
    const fires = logs(battle([hero({ reactions: [rebuke], resources: { slot: 2 }, tac: { resourceUse: "nova" } }), brute()], { maxRounds: 4 })).flat().filter(e => e.reaction === true && e.type === "auto");
    expect(fires.length).toBeGreaterThan(3);
    expect(fires.every(e => e.targetId === "brute" && e.damage > 0)).toBe(true);
  });

  test("Counterspell: a spell of its level or lower fails; a higher one only if the check beats 10 + its level", () => {
    const hold = { id: "hold", name: "Hold Monster", kind: "control", rank: 5, cost: 1, save: { type: "will", dc: 30 }, range: { increment: 90 },
      onSave: [{ conditions: { incapacitated: 1 }, rounds: 3, label: "held" }, { conditions: { incapacitated: 1 }, rounds: 3, label: "held" }, null, null], resource: "slot5" };
    const mage = brute({ id: "mage", actions: [hold, strike({ id: "club", bonus: 0, damage: [parseFormula("1", "bludgeoning")] })], resources: { slot5: 2 }, traits: traits(90), initiative: { mod: 20 } });
    const counter = level => ({ id: "counter", label: "Counterspell", on: "spell", resource: "slot3", counter: { level, mod: 0 } });
    const tries = (level, rank) => logs(battle([hero({ reactions: [counter(level)], resources: { slot3: 3 }, tac: { resourceUse: "nova" } }), { ...mage, actions: [{ ...hold, rank }, ...mage.actions.slice(1)] }], { maxRounds: 2 }), 20).flat().filter(e => e.type === "counter");
    const sure = tries(5, 5);
    expect(sure.length).toBeGreaterThan(5);
    expect(sure.every(e => e.countered && e.natural === null)).toBe(true);
    const chancy = tries(3, 5);
    expect(chancy.length).toBeGreaterThan(5);
    expect(chancy.every(e => e.natural !== null && e.countered === (e.total >= 15))).toBe(true);
  });
});
