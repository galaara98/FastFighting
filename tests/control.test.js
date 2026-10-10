import { describe, expect, test } from "vitest";
import { runBatchSync, replay } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle, social } from "./helpers.js";
import { buildStory } from "../scripts/story/story.js";
import { buildEnglishTables } from "../scripts/story/tables-en.js";

const english = buildEnglishTables();
const tables = { get: k => english[k] };

const tactical = n => ({ tactical: { base: n, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 40, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const brute = (extra = {}) => creature({
  id: "brute", side: "hostile", hp: { value: 200, max: 200 }, defenses: { ac: 14, fortitude: 5, reflex: 5, will: 0 },
  actions: [strike({ id: "maul", bonus: 12, damage: [parseFormula("2d8+6", "bludgeoning")] })], flags: { fearless: true }, ...extra
});
const slow = { id: "slow", name: "Slow", kind: "control", cost: 2, save: { type: "fortitude", dc: 25 }, range: { increment: 30, max: 30, noPenalty: true }, melee: false, resource: "slot",
  onSave: [{ conditions: { slowed: 2 }, rounds: 10, label: "slowed 2" }, { conditions: { slowed: 1 }, rounds: 10, label: "slowed 1" }, { conditions: { slowed: 1 }, rounds: 1, label: "slowed 1" }, null] };
const sleep = { id: "sleep", name: "Sleep", kind: "control", cost: 2, save: { type: "will", dc: 30 }, range: { increment: 30, max: 30, noPenalty: true }, melee: false, traits: ["mental", "sleep"],
  onSave: [{ conditions: { incapacitated: 1 }, rounds: 10, endsOnDamage: true, label: "asleep" }, { conditions: { incapacitated: 1 }, rounds: 10, endsOnDamage: true, label: "asleep" }, null, null] };

describe("crowd control", () => {
  test("slowing a heavy hitter cuts the damage it does", () => {
    const mage = (actions, resources) => creature({ id: "mage", kind: "pc", diesAtZero: false, hp: { value: 300, max: 300 }, actions, resources, traits: tactical(70) });
    const zap = strike({ id: "zap", name: "Zap", bonus: 2, melee: false, range: { increment: 30, max: 120 }, damage: [parseFormula("1d4", "fire")] });
    const without = runBatchSync(battle([mage([zap]), brute()], { maxRounds: 4 }), pf2eRules, { runs: 300 });
    const withSlow = runBatchSync(battle([mage([zap, slow], { slot: 1 }), brute()], { maxRounds: 4 }), pf2eRules, { runs: 300 });
    expect(withSlow.combatants.brute.meanDamage).toBeLessThan(without.combatants.brute.meanDamage * 0.85);
  });

  test("sleep stops a creature acting until something hurts it", () => {
    const caster = creature({ id: "c", kind: "pc", diesAtZero: false, hp: { value: 300, max: 300 }, actions: [sleep], traits: tactical(70) });
    const r = replay(battle([caster, brute()], { maxRounds: 3 }), pf2eRules, 4);
    const slept = r.log.find(e => e.type === "control" && e.took);
    expect(slept).toBeDefined();
    const after = r.log.slice(r.log.indexOf(slept) + 1);
    expect(after.some(e => e.actorId === "brute" && e.type === "attack")).toBe(false);
  });

  test("thinking casters don't waste spells on the immune; feral ones might", () => {
    const sleepy = { ...sleep, resource: undefined };
    const zap = strike({ id: "zap", name: "Zap", bonus: 10, melee: false, range: { increment: 30, max: 120 }, damage: [parseFormula("1d4", "fire")] });
    const golem = () => brute({ id: "brute", iwr: { immune: ["mental"] } });
    const casts = tier => {
      const caster = creature({ id: "c", kind: "pc", diesAtZero: false, hp: { value: 300, max: 300 }, actions: [zap, sleepy], traits: tactical(tier) });
      let n = 0;
      for ( let s = 1; s <= 40; s++ ) n += replay(battle([caster, golem()], { maxRounds: 2 }), pf2eRules, s).log.filter(e => e.type === "control").length;
      return n;
    };
    expect(casts(75)).toBe(0);
    expect(casts(5)).toBeGreaterThan(0);
  });

  test("an immobilized creature can't close in", () => {
    const hold = { ...slow, id: "hold", name: "Hold", onSave: [{ conditions: { immobilized: 1 }, rounds: 10, label: "immobilized" }, { conditions: { immobilized: 1 }, rounds: 10, label: "immobilized" }, null, null], save: { type: "reflex", dc: 40 }, resource: undefined };
    const at = (x, y) => ({ x, y, size: 5 });
    const archer = creature({ id: "a", kind: "pc", diesAtZero: false, position: at(0, 0), hp: { value: 300, max: 300 }, actions: [hold], traits: tactical(70) });
    const r = replay(battle([archer, brute({ position: at(60, 0) })], { maxRounds: 3, positioning: true }), pf2eRules, 2);
    const held = r.log.findIndex(e => e.type === "control" && e.took);
    expect(held).toBeGreaterThanOrEqual(0);
    expect(r.log.slice(held).some(e => e.actorId === "brute" && e.type === "move")).toBe(false);
  });
});

describe("theft", () => {
  const COINS = [{ label: "gp", value: 100 }, { label: "cp", value: 1 }];
  const scene = ({ hidden = true, playstyles = ["thief"], mod = 20, crowd = false } = {}) => {
    const victim = creature({ id: "pc", kind: "pc", diesAtZero: false, hp: { value: 400, max: 400 }, actions: [strike({ bonus: -20 })],
      social: social({ diplomacy: 0, perceptionDC: 10 }), valuables: { money: 10000, denominations: COINS, stowed: [], wielded: [] } });
    victim.social.resist.steal = { dc: 10, label: "Perception" };
    const thief = creature({ id: "thief", side: "hostile", hp: { value: 400, max: 400 }, playstyles, theft: { skill: "Thievery", mod }, hidden,
      traits: { tactical: { base: 50, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 100, fudge: 0 }, loyal: { base: 50, fudge: 0 } } });
    const friends = crowd ? [creature({ id: "friend", kind: "pc", diesAtZero: false, hp: { value: 400, max: 400 }, actions: [strike({ bonus: -20 })] })] : [];
    return battle([victim, thief, ...friends], { maxRounds: 6 });
  };

  test("theft is rare: only Thieves or the very skilled, and only when it's safe", () => {
    const tries = spec => [...Array(60).keys()].reduce((n, s) => n + replay(spec, pf2eRules, s + 1).log.filter(e => e.type === "theft").length, 0);
    // Out in the open, one on one, nobody winning: no one tries.
    expect(tries(scene({ hidden: false }))).toBe(0);
    // An ordinary hand at it never does, even hidden.
    expect(tries(scene({ playstyles: [], mod: 6 }))).toBe(0);
    // Hidden, with the mark alone: a Thief (or a real expert) will.
    expect(tries(scene())).toBeGreaterThan(0);
    expect(tries(scene({ playstyles: [] }))).toBeGreaterThan(0);
    // With the mark's friend beside them, and the thief's side outnumbered, it isn't safe.
    expect(tries(scene({ crowd: true }))).toBe(0);
  });

  test("a hidden thief and its mark off on their own, away from the fight, count as alone", () => {
    const at = (x, y) => ({ x, y, size: 5 });
    const isolated = (far, hidden = true) => {
      const spec = scene({ hidden });
      const [victim, thief] = spec.combatants;
      victim.position = at(far ? 300 : 20, 0);
      thief.position = at(far ? 305 : 25, 0);
      // The rest of the battle: one more on each side, back where the fighting is.
      spec.combatants.push(creature({ id: "pal", kind: "pc", diesAtZero: false, position: at(0, 0), hp: { value: 400, max: 400 }, actions: [strike({ bonus: -20 })] }));
      spec.combatants.push(creature({ id: "crony", side: "hostile", position: at(5, 0), hp: { value: 400, max: 400 }, actions: [strike({ bonus: -20 })] }));
      spec.options.positioning = true;
      return spec;
    };
    const tries = spec => [...Array(60).keys()].reduce((n, s) => n + replay(spec, pf2eRules, s + 1).log.filter(e => e.type === "theft").length, 0);
    expect(tries(isolated(true))).toBeGreaterThan(0);
    expect(tries(isolated(false))).toBe(0);
    // Alone isn't enough on its own: stealing still takes being unseen.
    expect(tries(isolated(true, false))).toBe(0);
  });

  test("robbing a PC takes a success and a luck roll under 30", () => {
    const thefts = [...Array(150).keys()].flatMap(s => replay(scene(), pf2eRules, s + 1).log.filter(e => e.type === "theft"));
    expect(thefts.length).toBeGreaterThan(10);
    for ( const e of thefts ) {
      if ( e.stolen ) {
        expect(e.degree).toBeGreaterThanOrEqual(2);
        expect(e.luck).toBeLessThan(30);
      }
      if ( e.degree >= 2 && e.luck >= 30 ) expect(e.stolen ?? null).toBeNull();
    }
    expect(thefts.some(e => e.stolen)).toBe(true);
    expect(thefts.some(e => e.degree >= 2 && !e.stolen)).toBe(true);
  });

  test("whatever a thief takes comes back if the thief is beaten", () => {
    for ( let s = 1; s <= 80; s++ ) {
      const r = replay(scene(), pf2eRules, s);
      const beaten = ["dead", "down", "surrendered", "stoodDown"].includes(r.units.thief.final.status);
      for ( const c of r.units.pc.final.concessions ) {
        expect(c.how).toBe("theft");
        expect(!!c.returned).toBe(beaten);
      }
    }
  });
});

describe("open theft", () => {
  const COINS = [{ label: "gp", value: 100 }, { label: "cp", value: 1 }];
  const winning = ({ kind = "pc" } = {}) => {
    const victim = creature({ id: "v", kind, diesAtZero: false, hp: { value: 400, max: 400 }, actions: [strike({ bonus: -20 })],
      social: social({ diplomacy: 0, perceptionDC: 10 }), valuables: { money: 10000, denominations: COINS, stowed: [], wielded: [] } });
    victim.social.resist.steal = { dc: 10, label: "Perception" };
    const thief = creature({ id: "thief", side: "hostile", hp: { value: 400, max: 400 }, playstyles: ["thief"], theft: { skill: "Thievery", mod: 20 },
      actions: [strike({ id: "dagger", name: "Dagger", bonus: 8 })] });
    // The thief's side is winning: two of them against one.
    const crony = creature({ id: "crony", side: "hostile", hp: { value: 400, max: 400 }, actions: [strike({ bonus: -20 })] });
    return battle([victim, thief, crony], { maxRounds: 6 });
  };
  const thefts = spec => [...Array(120).keys()].flatMap(s => replay(spec, pf2eRules, s + 1).log.filter(e => e.type === "theft"));

  test("acting openly, a thief feints with its weapon first and only steals if the feint lands", () => {
    const all = thefts(winning());
    expect(all.length).toBeGreaterThan(5);
    for ( const e of all ) {
      expect(e.feint?.weapon).toBe("Dagger");
      if ( !e.feint.hit ) expect(e.degree).toBeUndefined(); // no stealing test after a missed feint
    }
    expect(all.some(e => !e.feint.hit)).toBe(true);
    expect(all.some(e => e.feint.hit && e.stolen)).toBe(true);
  });

  test("a PC also needs the hidden luck check; a companion doesn't", () => {
    for ( const e of thefts(winning()).filter(x => x.stolen) ) expect(e.luck).toBeLessThan(30);
    const companion = thefts(winning({ kind: "companion" }));
    expect(companion.some(e => e.stolen)).toBe(true);
    for ( const e of companion ) expect(e.luck ?? null).toBeNull();
  });

  test("the luck check never shows up in a story", () => {
    const spec = winning();
    for ( let s = 1; s <= 60; s++ ) {
      const r = replay(spec, pf2eRules, s);
      if ( !r.log.some(e => e.type === "theft" && e.luck) ) continue;
      for ( const style of ["roleplay", "standard", "statistician"] ) {
        expect(buildStory(r, spec, style, { tables, seed: s }).text.toLowerCase()).not.toContain("luck");
      }
    }
  });
});
