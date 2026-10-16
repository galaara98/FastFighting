import { describe, expect, test } from "vitest";
import { runBatchSync, prepareBattle } from "../scripts/engine/simulator.js";
import { createRun, areEnemies, alliesOf } from "../scripts/engine/battle-state.js";
import { createRng } from "../scripts/engine/rng.js";
import { initDesires } from "../scripts/engine/behavior/desire.js";
import { crossed, refreshLeans, FELLOW, LEAN_PULL, leanPull } from "../scripts/engine/behavior/neutral.js";
import { standsGround } from "../scripts/engine/behavior/morale.js";
import { proposeGroups, squaresApart, sameKind } from "../scripts/engine/groups.js";
import { NEUTRAL_PARTY } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle } from "./helpers.js";

const quiet = { pitches: {}, resist: {}, languages: [] };
/** A neutral at (col, row) on a 5-ft grid. */
const at = (id, col, row, over = {}) => ({ id, x: col * 5 + 2.5, y: row * 5 + 2.5, size: 5, ...over });

describe("proposing friend groups for neutrals", () => {
  test("squares apart, edge to edge: adjacent is 1 (diagonals too), a gap of one square is 2", () => {
    expect(squaresApart(at("a", 0, 0), at("b", 1, 0))).toBe(1);
    expect(squaresApart(at("a", 0, 0), at("b", 1, 1))).toBe(1);
    expect(squaresApart(at("a", 0, 0), at("b", 2, 0))).toBe(2);
    // A large creature (10 ft) next to a medium one.
    expect(squaresApart({ x: 5, y: 5, size: 10 }, at("b", 2, 0))).toBe(1);
  });

  test("the same kind: the same stat block, the same type, or the same name", () => {
    expect(sameKind({ block: "x" }, { block: "x" })).toBe(true);
    expect(sameKind({ kind: "beast" }, { kind: "beast" })).toBe(true);
    expect(sameKind({ name: "goblin" }, { name: "goblin" })).toBe(true);
    expect(sameKind({ block: "x", kind: "beast" }, { block: "y", kind: "humanoid" })).toBe(false);
    expect(sameKind({}, {})).toBe(false);
  });

  test("the nearest to the top-left starts group 1 with its kind and its neighbours; group 2 the same; the rest are group 3", () => {
    const list = [
      at("wolf1", 1, 1, { kind: "wolf" }),
      at("wolf2", 30, 30, { kind: "wolf" }),      // far away, but a wolf: group 1
      at("hunter", 3, 1, { kind: "human" }),      // 2 squares from wolf1: group 1
      at("dog", 33, 30, { kind: "dog" }),         // 3 squares from wolf2: group 1
      at("merchant", 12, 2, { kind: "human" }),   // the next nearest the corner: starts group 2
      at("guard", 14, 2, { kind: "dwarf" }),      // near the merchant: group 2
      at("cat", 20, 20, { kind: "cat" }),         // near no one: group 3
      at("owl", 22, 22, { kind: "owl" })          // near only the cat: group 3
    ];
    const groups = proposeGroups(list, { reach: 3 });
    expect(Object.fromEntries(groups)).toEqual({ wolf1: 1, wolf2: 1, hunter: 1, dog: 1, merchant: 2, guard: 2, cat: 3, owl: 3 });
  });

  test("closeness pulls others in three steps out, no further; the reach can be changed", () => {
    // A line of different creatures, each 2 squares from the next.
    const line = ["a", "b", "c", "d", "e"].map((id, i) => at(id, i * 2, 0, { kind: id }));
    const near = proposeGroups(line, { reach: 2 });
    expect(["a", "b", "c", "d"].map(id => near.get(id))).toEqual([1, 1, 1, 1]);
    expect(near.get("e")).toBe(2); // four steps out: it starts group 2
    const short = proposeGroups(line, { reach: 1 });
    expect(["a", "b", "c", "d", "e"].map(id => short.get(id))).toEqual([1, 2, 3, 3, 3]);
  });
});

describe("neutral friend groups in the fight", () => {
  const fighter = (over = {}) => creature({ id: "fighter", kind: "pc", diesAtZero: false, hp: { value: 60, max: 60 }, social: quiet, ...over });
  const brute = (over = {}) => creature({ id: "brute", side: "hostile", hp: { value: 40, max: 40 }, social: quiet, ...over });
  const neutral = (id, group, over = {}) => creature({ id, side: NEUTRAL_PARTY, originSide: "neutral", group, social: quiet, ...over });

  function ready(combatants) {
    const run = createRun(prepareBattle(battle(combatants), pf2eRules));
    run.rng = createRng(3);
    run.log = [];
    for ( const u of run.units ) initDesires(u);
    refreshLeans(run);
    const say = (unit, data) => run.log.push({ actor: unit.spec.name, ...data });
    return { run, say, units: Object.fromEntries(run.units.map(u => [u.id, u])) };
  }

  test("a friend group looks out for its own, not for another group", () => {
    const { run, units } = ready([fighter(), brute(), neutral("miller", 1), neutral("wife", 1), neutral("tinker", 2)]);
    expect(units.miller.desire.lean.get("protect|wife")).toBeCloseTo(leanPull(run, units.miller, FELLOW * LEAN_PULL.fellows));
    expect(units.miller.desire.lean.get("protect|tinker")).toBeUndefined();
    expect(alliesOf(run, units.miller).map(u => u.id).sort()).toEqual(["miller", "wife"]);
    expect(alliesOf(run, units.tinker)).toEqual([units.tinker]);
    // Different groups are still nobody's enemies.
    expect(areEnemies(run, units.miller, units.tinker)).toBe(false);
  });

  test("hurting one of a group builds a grievance in its friends, not in another group", () => {
    const { run, say, units } = ready([fighter(), brute(), neutral("miller", 1), neutral("wife", 1), neutral("tinker", 2)]);
    crossed(run, units.brute, units.wife, "harm", 1, say);
    expect(units.wife.against.has("hostile")).toBe(true);
    expect(units.miller.grievance.get("hostile")).toBeGreaterThan(0);
    expect(units.tinker.grievance.get("hostile") ?? 0).toBe(0);
  });

  test("a Secret token on a neutral team is in that team's friend group", () => {
    const { run, units } = ready([fighter(), brute(), neutral("miller", 2), neutral("spy", 2, { originSide: "secret" }), neutral("tinker", 1)]);
    expect(alliesOf(run, units.spy).map(u => u.id).sort()).toEqual(["miller", "spy"]);
    expect(units.miller.desire.lean.get("protect|spy")).toBeCloseTo(leanPull(run, units.miller, FELLOW * LEAN_PULL.fellows));
  });

  test("neutrals can be in three friend groups: each looks out for its own", () => {
    const { run, say, units } = ready([fighter(), brute(), neutral("miller", 1), neutral("wife", 1), neutral("tinker", 2), neutral("smith", 2),
      neutral("monk", 3), neutral("nun", 3)]);
    for ( const [a, b] of [["miller", "wife"], ["tinker", "smith"], ["monk", "nun"]] ) {
      expect(alliesOf(run, units[a]).map(u => u.id).sort()).toEqual([a, b].sort());
      expect(units[a].desire.lean.get(`protect|${b}`)).toBeCloseTo(leanPull(run, units[a], FELLOW * LEAN_PULL.fellows));
    }
    expect(units.monk.desire.lean.get("protect|tinker")).toBeUndefined();
    crossed(run, units.brute, units.nun, "harm", 1, say);
    expect(units.monk.grievance.get("hostile")).toBeGreaterThan(0);
    expect(units.miller.grievance.get("hostile") ?? 0).toBe(0);
    expect(units.tinker.grievance.get("hostile") ?? 0).toBe(0);
  });
});

describe("hostile groups", () => {
  const sides = {
    friendly: { label: "Party", enemies: ["hostile", "hostile2"] },
    hostile: { label: "Hostile 1", enemies: ["friendly", "hostile2"] },
    hostile2: { label: "Hostile 2", enemies: ["friendly", "hostile"] }
  };

  test("each group is the others' enemy as much as the party's, and only one is left at the end", () => {
    const combatants = [
      creature({ id: "hero", kind: "pc", hp: { value: 30, max: 30 }, diesAtZero: false, social: quiet }),
      creature({ id: "orc", side: "hostile", social: quiet }),
      creature({ id: "bandit", side: "hostile2", social: quiet })
    ];
    const run = createRun(prepareBattle(battle(combatants, {}, sides), pf2eRules));
    const [hero, orc, bandit] = run.units;
    expect(areEnemies(run, orc, bandit)).toBe(true);
    expect(areEnemies(run, orc, hero)).toBe(true);
    expect(areEnemies(run, bandit, hero)).toBe(true);
    const results = runBatchSync(battle(combatants, { morale: false, talking: false }, sides), pf2eRules, { runs: 300, seed: 5 });
    expect(Object.keys(results.sides).sort()).toEqual(["friendly", "hostile", "hostile2"]);
    expect(results.sides.hostile.pWin).toBeGreaterThan(0);
    expect(results.sides.hostile2.pWin).toBeGreaterThan(0);
    const total = Object.values(results.sides).reduce((s, x) => s + x.pWin, 0) + results.pStalemate + results.pNone;
    expect(total).toBeCloseTo(1, 5);
  });
});

describe("I don't like to flee", () => {
  const craven = { tactical: { base: 50, fudge: 0 }, brave: { base: 5, fudge: 0 }, selfish: { base: 70, fudge: 0 }, loyal: { base: 30, fudge: 0 } };
  const scene = over => battle([
    creature({ id: "knight", kind: "pc", hp: { value: 80, max: 80 }, diesAtZero: false, social: quiet }),
    creature({ id: "knight2", kind: "pc", hp: { value: 80, max: 80 }, diesAtZero: false, social: quiet }),
    creature({ id: "coward", side: "hostile", hp: { value: 30, max: 30 }, traits: craven, tactics: { retreat: "hurt" }, social: quiet, ...over })
  ], { talking: false });

  test("someone who doesn't like to flee mostly stays when it would run", () => {
    const usual = runBatchSync(scene(), pf2eRules, { runs: 400, seed: 11 });
    const stubborn = runBatchSync(scene({ avoidFleeing: true }), pf2eRules, { runs: 400, seed: 11 });
    expect(usual.combatants.coward.pFled).toBeGreaterThan(0.15);
    expect(stubborn.combatants.coward.pFled).toBeLessThan(usual.combatants.coward.pFled / 3);
  });

  test("it stays nine times in ten (or as often as the setting says); anyone else doesn't hold back (and doesn't touch the dice)", () => {
    const share = standGround => {
      const run = { rng: createRng(9), prep: { options: standGround === undefined ? {} : { standGround } } };
      return Array.from({ length: 2000 }, () => standsGround(run, { spec: { avoidFleeing: true } })).filter(Boolean).length / 2000;
    };
    expect(share()).toBeGreaterThan(0.86);
    expect(share()).toBeLessThan(0.94);
    expect(share(50)).toBeGreaterThan(0.45);
    expect(share(50)).toBeLessThan(0.55);
    const before = createRng(9).next?.();
    const fresh = { rng: createRng(9) };
    expect(standsGround(fresh, { spec: {} })).toBe(false);
    if ( before !== undefined ) expect(fresh.rng.next()).toBe(before);
  });
});
