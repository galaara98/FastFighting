/**
 * A turn played whole, whatever cuts it short; what can't act, can't; dice after a reload; two creatures sharing action
 * ids; fate taking a death back entirely; the surprise round as other rounds (an engine review's findings).
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, playTurn, prepareBattle, runOne } from "../scripts/engine/simulator.js";
import { turnFor } from "../scripts/engine/battle-state.js";
import { beginLive, liveRound, gmReinforce, snapshotRun, restoreRun } from "../scripts/engine/live.js";
import { applyOutcome, beginConcentration } from "../scripts/engine/behavior/effects.js";
import { meanDamageVs } from "../scripts/engine/behavior/evaluate.js";
import { callSummons } from "../scripts/engine/behavior/summons.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";
import { SURPRISE } from "../scripts/engine/behavior/surprise.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { STATUS } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
// A 5e-style economy: an action, a bonus action, movement in feet.
const feetRules = { ...pf2eRules, mainPool: "action", movement: "feet", turn: () => ({ action: 1, bonus: 1, move: 30 }),
  costOf: a => (a.economy === "bonus" ? { bonus: 1 } : { action: 1 }), basicAction: { action: 1 } };
const scare = { conditions: { frightened: 1 }, rounds: 1, label: "Scare" };

describe("one that can't act", () => {
  const held = (foeAt, seed) => {
    const spec = battle([
      creature({ id: "hero", position: at(0), actions: [strike({ id: "sword" }), strike({ id: "offhand", economy: "bonus", name: "Dagger" })] }),
      creature({ id: "foe", side: "hostile", position: at(foeAt), initiative: { mod: -50 }, actions: [strike({ bonus: -50 })] })
    ], { positioning: true, maxRounds: 2 });
    const run = beginRun(prepareBattle(spec, feetRules), seed, { log: true });
    const hero = run.byId.get("hero");
    applyOutcome(hero, { conditions: { incapacitated: 1 }, rounds: 5, label: "Hold" }, "foe", { id: "hold" });
    return { run, hero };
  };

  test("has nothing of its turn: no bonus action, no movement (even hasted)", () => {
    const { run, hero } = held(40, 1);
    hero.mods = { ...hero.mods, actions: 1 };
    expect(turnFor(run, hero).pools).toEqual({ action: 0, bonus: 0, move: 0 });
    // (The system's own total loss, 99: the same.)
    const lost = { ...feetRules, modifiers: { ...feetRules.modifiers, actionsLost: () => 99 } };
    const run2 = beginRun(prepareBattle(battle([creature({ id: "x" }), creature({ id: "y", side: "hostile" })]), lost), 1);
    expect(turnFor(run2, run2.byId.get("x")).pools).toEqual({ action: 0, bonus: 0, move: 0 });
  });

  test("doesn't walk up to a foe, nor strike one beside it with a bonus action", () => {
    for ( const [foeAt, seed] of [[40, 1], [40, 2], [5, 1], [5, 2], [5, 3]] ) {
      const { run, hero } = held(foeAt, seed);
      beginRound(run, 1);
      const from = run.log.length;
      playTurn(run, hero);
      expect(hero.pos.x).toBe(0);
      expect(run.log.slice(from).filter(e => e.type === "attack" && e.actorId === "hero")).toEqual([]);
    }
  });
});

describe("a turn cut short still ends", () => {
  const isMinion = u => u.spec.creatureTraits?.includes("minion");
  const minionRules = { ...pf2eRules, turn: u => ({ actions: isMinion(u) ? 2 : 3 }), minionCommand: u => (isMinion(u) ? { actions: 1 } : null) };
  const tough = { hp: { value: 400, max: 400, temp: 0 }, flags: { fearless: true } };
  const pets = () => battle([
    creature({ id: "master", kind: "pc", diesAtZero: false, ...tough }),
    creature({ id: "pet", kind: "companion", diesAtZero: false, creatureTraits: ["minion"], ...tough, flags: { fearless: true, masterId: "master" } }),
    creature({ id: "foe", side: "hostile", ...tough })
  ], { maxRounds: 10 });

  test("a minion down and dying, never commanded: fights for its life, and what's on it runs out", () => {
    const run = beginRun(prepareBattle(pets(), minionRules), 3, { log: true });
    const pet = run.byId.get("pet");
    Object.assign(pet, { hp: 0, status: STATUS.DOWN, dying: 1, stable: false });
    applyOutcome(pet, scare, "foe", { id: "scare" });
    beginRound(run, 1);
    for ( const u of run.order ) playTurn(run, u);
    expect(run.log.filter(e => e.type === "recovery" && e.actorId === "pet").length).toBe(1);
    expect(pet.effects.some(e => e.key === "scare")).toBe(false);
  });

  test("a minion waiting for a word: does nothing, but its turn begins and ends", () => {
    const run = beginRun(prepareBattle(pets(), minionRules), 3, { log: true });
    const pet = run.byId.get("pet");
    applyOutcome(pet, scare, "foe", { id: "scare" });
    beginRound(run, 1);
    const from = run.log.length;
    playTurn(run, pet); // (before its master's turn: not commanded)
    expect(run.log.slice(from).filter(e => e.actorId === "pet" && e.type === "attack")).toEqual([]);
    expect(pet.effects.some(e => e.key === "scare")).toBe(false);
    expect(pet.turnsTaken).toBe(1);
  });

  test("one too lazy to act this turn: its effects run on, and it's no longer the one acting", () => {
    const pill = combinePlaystyles(["lazy"]);
    let lazy = 0;
    for ( let seed = 1; seed <= 20; seed++ ) {
      const spec = battle([
        creature({ id: "slob", position: at(0), behavior: { ...pill.behavior, slacks: 0.9 }, playstyles: ["lazy"], hp: { value: 200, max: 200 },
          actions: [strike({ id: "bow", name: "Shortbow", melee: false, range: { increment: 60, max: 360 } })] }),
        creature({ id: "foe", side: "hostile", position: at(60), hp: { value: 200, max: 200 }, actions: [strike({ bonus: -50, melee: false, range: { increment: 60, max: 360 } })] })
      ], { positioning: true, maxRounds: 4 });
      const run = beginRun(prepareBattle(spec, pf2eRules), seed, { log: true });
      const slob = run.byId.get("slob");
      applyOutcome(slob, scare, "foe", { id: "scare" });
      beginRound(run, 1);
      const from = run.log.length;
      playTurn(run, slob);
      if ( !run.log.slice(from).some(e => e.type === "lazy" && e.chose) ) continue;
      lazy += 1;
      expect(slob.effects.some(e => e.key === "scare")).toBe(false);
      expect(run.acting).toBeNull();
      expect(slob.turnsTaken).toBe(1);
    }
    expect(lazy).toBeGreaterThan(0);
  });
});

describe("a live battle brought back", () => {
  test("has dice for the round's beginning: reinforcements called before a reload come", () => {
    const grunt = creature({ id: "grunt", side: "hostile", tactics: { shield: "never" }, tacticsMix: { shield: [{ value: "never", weight: 1 }, { value: "always", weight: 1 }] } });
    const spec = { ...battle([creature({ id: "hero", kind: "pc" }), creature({ id: "foe", side: "hostile" })]), reinforcements: { hostile: { spec: grunt, count: 3 } } };
    const run = beginLive(spec, pf2eRules, { seed: 5 });
    liveRound(run, 1);
    expect(gmReinforce(run, "hostile", 2)).toBe(2);
    const back = restoreRun(spec, pf2eRules, snapshotRun(run, { log: false }), { log: run.log });
    expect(() => liveRound(back, 2)).not.toThrow();
    expect(back.units.length).toBe(4);
  });
});

describe("two creatures with the same action ids (two unlinked tokens of one actor)", () => {
  test("what one's action deals isn't taken for the other's", () => {
    const weak = creature({ id: "tokA", side: "hostile", actions: [strike({ id: "ACTOR.dogslicer", damage: [parseFormula("1d6", "slashing")] })] });
    const strong = creature({ id: "tokB", side: "hostile", actions: [strike({ id: "ACTOR.dogslicer", damage: [parseFormula("1d6+10", "slashing")] })] });
    const run = beginRun(prepareBattle(battle([creature({ id: "hero" }), weak, strong]), pf2eRules), 1);
    const h = run.byId.get("hero");
    expect(meanDamageVs(run, run.byId.get("tokA").spec.actions[0], h).normal).toBeCloseTo(3.5);
    expect(meanDamageVs(run, run.byId.get("tokB").spec.actions[0], h).normal).toBeCloseTo(13.5);
  });

  test("each one's summoning calls its own creatures", () => {
    const beast = name => ({ name, level: 1, hp: { value: 10, max: 10 }, defenses: { ac: 14, fortitude: 5, reflex: 5, will: 5 }, speeds: { walk: 25 }, actions: [strike()], iwr: {}, diesAtZero: true });
    const caller = (id, name) => creature({ id, side: "hostile", actions: [strike(), { id: "ACTOR.summon", name: "Summon", kind: "summon", cost: 3, creatures: [beast(name)], rounds: 10 }] });
    const run = beginRun(prepareBattle(battle([creature({ id: "hero" }), caller("tokA", "Wolf"), caller("tokB", "Bear")]), pf2eRules), 1);
    const b = run.byId.get("tokB");
    const [s] = callSummons(run, b, b.spec.actions.find(a => a.kind === "summon"));
    expect(s.spec.name).toBe("Bear");
    const a = run.byId.get("tokA");
    expect(callSummons(run, a, a.spec.actions.find(x => x.kind === "summon"))[0].spec.name).toBe("Wolf");
  });
});

describe("fate taking a death back", () => {
  test("takes back what the death ended: its concentration, and what that held up on a friend", () => {
    // (A save it can't fail: only death breaks its concentration.)
    const rules = { ...pf2eRules, concentration: { save: "fortitude", dc: () => -100 } };
    const shield = { id: "sof", name: "Shield of Faith", kind: "buff", cost: 1, concentration: true, range: { increment: 60, max: 60 }, outcome: { mods: { ac: 2 }, rounds: 10, label: "shielded" } };
    let saved = 0;
    for ( let seed = 1; seed <= 60; seed++ ) {
      const spec = battle([
        creature({ id: "hero", kind: "pc", hp: { value: 20, max: 20 }, resources: { fate: 3 }, actions: [strike({ bonus: -50 }), shield] }),
        creature({ id: "friend", kind: "pc", hp: { value: 900, max: 900 }, defenses: { ac: 40, fortitude: 7, reflex: 7, will: 7 }, actions: [strike({ bonus: -50 })] }),
        creature({ id: "killer", side: "hostile", hp: { value: 900, max: 900 }, flags: { fearless: true }, actions: [strike({ id: "maul", bonus: 9, damage: [parseFormula("2d10+8", "bludgeoning")] })] })
      ], { maxRounds: 2, talking: false });
      const run = beginRun(prepareBattle(spec, rules), seed, { log: true });
      const [hero, friend, killer] = ["hero", "friend", "killer"].map(id => run.byId.get(id));
      beginConcentration(run, hero, shield);
      applyOutcome(friend, shield.outcome, hero.id, shield);
      beginRound(run, 1);
      const from = run.log.length;
      playTurn(run, killer);
      if ( hero.status === STATUS.DEAD || !run.log.slice(from).some(e => e.type === "fate" && e.targetId === "hero") ) continue;
      saved += 1;
      expect(hero.concentration?.actionId).toBe("sof");
      expect(friend.mods.ac).toBe(2);
    }
    expect(saved).toBeGreaterThan(0);
  });
});

describe("the surprise round", () => {
  test("may end the fight: those after the blow that ends it don't act", () => {
    const hero = creature({ id: "hero", kind: "pc", diesAtZero: false, hp: { value: 200, max: 200 }, actions: [strike({ bonus: 40, damage: [parseFormula("50", "slashing")] })] });
    const second = creature({ id: "second", kind: "pc", diesAtZero: false, hp: { value: 200, max: 200 }, initiative: { mod: -20 }, actions: [strike({ bonus: 40 })] });
    const foe = creature({ id: "foe", side: "hostile", hp: { value: 10, max: 10 }, initiative: { mod: 0 }, defenses: { ac: 5, fortitude: 0, reflex: 0, will: 0 } });
    const r = runOne(prepareBattle(battle([hero, second, foe], { maxRounds: 2, talking: false, surprise: SURPRISE.PARTY_SURPRISES }), pf2eRules), 1, { log: true });
    expect(r.log.find(e => e.type === "death" && e.actorId === "foe")?.round).toBe(0);
    // (The fight over with the first blow: the second's turn never comes.)
    expect(r.log.filter(e => e.round === 0 && e.actorId === "second" && e.type !== "thought")).toEqual([]);
  });

  test("a last stand runs out with its turns there too", () => {
    const hero = creature({ id: "hero", kind: "pc", diesAtZero: false, hp: { value: 200, max: 200 }, actions: [strike({ bonus: -50 })] });
    const foe = creature({ id: "foe", side: "hostile", hp: { value: 200, max: 200 }, actions: [strike({ bonus: -50 })] });
    const rules = { ...pf2eRules, initRun: run => { run.byId.get("hero").lastStand = { turns: 1, label: "" }; } };
    const r = runOne(prepareBattle(battle([hero, foe], { maxRounds: 2, talking: false, surprise: SURPRISE.PARTY_SURPRISES }), rules), 1, { log: true });
    expect(r.log.find(e => e.type === "death" && e.actorId === "hero")?.round).toBe(0);
  });
});
