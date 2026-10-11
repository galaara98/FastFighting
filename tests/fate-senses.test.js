import { describe, expect, test } from "vitest";
import { replay, prepareBattle } from "../scripts/engine/simulator.js";
import { createRun } from "../scripts/engine/battle-state.js";
import { perceives, apparentHealth } from "../scripts/engine/behavior/senses.js";
import { STATUS } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const traits = (selfish = 30) => ({ tactical: { base: 60, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: selfish, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
// A brute that finishes off whoever it drops (it keeps hitting the fallen PC).
const killer = () => creature({ id: "killer", side: "hostile", hp: { value: 400, max: 400 }, traits: traits(), behavior: { finishDowned: 1 },
  actions: [strike({ id: "maul", bonus: 14, damage: [parseFormula("3d10+10", "bludgeoning")] })], flags: { fearless: true } });
const tank = () => creature({ id: "tank", kind: "pc", diesAtZero: false, hp: { value: 900, max: 900 }, traits: traits(), actions: [strike({ id: "poke", bonus: -10 })] });
const pc = (id, extra = {}) => creature({ id, kind: "pc", diesAtZero: false, hp: { value: 30, max: 30 }, traits: traits(), actions: [strike({ id: `${id}-s`, bonus: 0 })], ...extra });

describe("fate: hero points and the like", () => {
  test("a PC with fate cheats death: the same fights, with and without it", () => {
    let saved = 0;
    let spent = 0;
    for ( let s = 1; s <= 40; s++ ) {
      const without = replay(battle([pc("hero"), tank(), killer()], { maxRounds: 2 }), pf2eRules, s);
      const withFate = replay(battle([pc("hero", { resources: { fate: 3 } }), tank(), killer()], { maxRounds: 2 }), pf2eRules, s);
      spent += withFate.log.filter(e => e.type === "fate").length;
      if ( without.units.hero.final.status === "dead" && withFate.units.hero.final.status !== "dead" ) saved += 1;
    }
    expect(spent).toBeGreaterThan(0);
    expect(saved).toBeGreaterThan(0);
  });

  test("a sure way out where the system has one (PF2e Heroic Recovery: all of them, and stable)", () => {
    const rules = { ...pf2eRules, avertDeath(u) { u.status = STATUS.DOWN; u.dying = 0; u.stable = true; u.hp = 0; } };
    for ( let s = 1; s <= 20; s++ ) {
      const r = replay(battle([pc("hero", { resources: { fate: 2 } }), tank(), killer()], { maxRounds: 4 }), rules, s);
      const sure = r.log.find(e => e.type === "fate");
      if ( !sure ) continue;
      expect(sure.sure).toBe(true);
      expect(r.units.hero.final.resources.fate).toBe(0);
      expect(r.units.hero.final.status).not.toBe("dead");
      return;
    }
    throw new Error("no death to avert in 20 fights");
  });

  test("friends spend theirs too, the selfish rarely", () => {
    const saves = selfish => {
      let n = 0;
      for ( let s = 1; s <= 60; s++ ) {
        const r = replay(battle([pc("hero"), pc("friend", { traits: traits(selfish), resources: { fate: 3 }, hp: { value: 500, max: 500 } }), killer()], { maxRounds: 4 }), pf2eRules, s);
        n += r.log.filter(e => e.type === "fate" && e.actorId === "friend" && e.targetId === "hero").length;
      }
      return n;
    };
    expect(saves(5)).toBeGreaterThan(saves(95) * 2);
  });
});

describe("senses", () => {
  const at = (x, y) => ({ x, y, size: 5 });
  const setup = (extra = {}, darkness = 0) => {
    const spec = battle([pc("a", { position: at(0, 0), ...extra }), pc("b", { position: at(200, 0) }), creature({ id: "foe", side: "hostile", position: at(100, 0) })], { positioning: true, darkness });
    // No line of sight from a to anyone (a wall), positions as given.
    spec.approach = { a: { b: { dist: 200, mult: 1, speed: 25, los: false, meleeOk: true }, foe: { dist: 100, mult: 1, speed: 25, los: false, meleeOk: true } } };
    const run = createRun(prepareBattle(spec, pf2eRules));
    return { run, a: run.byId.get("a"), b: run.byId.get("b"), foe: run.byId.get("foe") };
  };

  test("behind a wall and out of earshot: a foe's wounds go unseen", () => {
    const { run, a, foe } = setup();
    foe.hp = 1;
    expect(perceives(run, a, foe)).toBe(false);
    expect(apparentHealth(run, a, foe)).toBe(1);
  });

  test("within earshot it can tell, wall or not; a keen sense reaches further", () => {
    const near = setup();
    near.foe.pos = { x: 40, y: 0 };
    near.run.geo = (near.run.geo ?? 0) + 1;
    expect(perceives(near.run, near.a, near.foe)).toBe(true);
    const keen = setup({ senses: [{ type: "tremorsense", range: 120, blind: true }] });
    expect(perceives(keen.run, keen.a, keen.foe)).toBe(true);
  });

  test("in a crisis perception bends: a dying friend far off behind a wall is still noticed", () => {
    const { run, a, b } = setup();
    b.pos = { x: 110, y: 0 };
    run.geo = (run.geo ?? 0) + 1;
    expect(perceives(run, a, b)).toBe(false);
    expect(perceives(run, a, b, { crisis: true })).toBe(true);
  });

  test("darkness: darkvision sees, others don't", () => {
    const dark = setup({}, 1);
    dark.run.prep.spec.approach.a.foe.los = true;
    dark.foe.pos = { x: 50, y: 0 };
    dark.run.geo = (dark.run.geo ?? 0) + 1;
    expect(perceives(dark.run, dark.a, dark.foe)).toBe(true); // 50 ft: hearing still reaches
    dark.foe.pos = { x: 90, y: 0 };
    dark.run.geo += 1;
    expect(perceives(dark.run, dark.a, dark.foe)).toBe(false);
    const seer = setup({ senses: [{ type: "darkvision", range: 120, dark: true }] }, 1);
    seer.run.prep.spec.approach.a.foe.los = true;
    seer.foe.pos = { x: 90, y: 0 };
    seer.run.geo = (seer.run.geo ?? 0) + 1;
    expect(perceives(seer.run, seer.a, seer.foe)).toBe(true);
  });
});

describe("the execution luck check", () => {
  const fight = luck => battle([pc("hero"), tank(), killer()], { maxRounds: 3, executeLuck: luck });

  test("at 0 the fallen PC is never struck: the killer turns on the next foe, desires and all", () => {
    for ( let s = 1; s <= 30; s++ ) {
      const r = replay(fight(0), pf2eRules, s);
      expect(r.log.some(e => e.type === "struckDown" && e.actorId === "hero")).toBe(false);
      for ( const e of r.log.filter(x => x.type === "execute") ) {
        expect(e.goes).toBe(false);
        expect(e.next).toBe("tank");
      }
    }
  });

  test("at 100 it always goes ahead; in between, about as often as the number says", () => {
    let struck = 0;
    for ( let s = 1; s <= 30; s++ ) struck += replay(fight(100), pf2eRules, s).log.filter(e => e.type === "struckDown" && e.actorId === "hero").length;
    expect(struck).toBeGreaterThan(0);
    let checks = 0;
    let goes = 0;
    for ( let s = 1; s <= 200; s++ ) {
      for ( const e of replay(fight(39), pf2eRules, s).log.filter(x => x.type === "execute") ) {
        checks += 1;
        if ( e.goes ) goes += 1;
      }
    }
    expect(goes / checks).toBeGreaterThan(0.29);
    expect(goes / checks).toBeLessThan(0.49);
  });
});
