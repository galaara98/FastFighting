import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { initDesires, think, want, thwart, levelOf, levelsFromScores } from "../scripts/engine/behavior/desire.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const traits = tactical => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const bow = (bonus = 50) => strike({ name: "Bow", melee: false, reach: undefined, range: { increment: 100, max: 300 }, bonus, damage: [parseFormula("1", "piercing")] });
const harmless = () => strike({ bonus: -50 });
const tough = { value: 500, max: 500, temp: 0 };

describe("desires", () => {
  test("levels: max(logic, stated) + memory - frustration; the strongest leads", () => {
    const u = { id: "u", spec: { desires: [{ kind: "hurt", targetId: "x", level: 30 }], traits: {} } };
    initDesires(u);
    think(u, "hurt", "x", 50);
    expect(levelOf(u, "hurt", "x")).toBe(50);
    want(u, "hurt", "x", 20);
    expect(levelOf(u, "hurt", "x")).toBe(70);
    // Thwarted: it wears down (a timid character, brave 30, loses heart faster).
    const run = { prep: { sides: { a: {} } }, units: [u] };
    Object.assign(u, { side: "a", prep: { traits: { brave: 30 } } });
    thwart(run, u, "hurt", "x", 10);
    expect(levelOf(u, "hurt", "x")).toBe(60);
  });

  test("the tactics' favorite sits a little above the choice level; runners-up below in proportion", () => {
    const [a, b] = levelsFromScores([{ id: "a", score: 4 }, { id: "b", score: 2 }]);
    expect(a.level).toBeGreaterThan(45);
    expect(b.level).toBeCloseTo(22.5);
  });

  test("a feral creature goes for whoever just hurt it", () => {
    const beast = creature({ id: "beast", position: at(0), traits: traits(5), actions: [strike()] });
    const near = creature({ id: "near", side: "hostile", position: at(25), hp: tough, actions: [harmless()], initiative: { mod: -50 } });
    const archer = creature({ id: "archer", side: "hostile", position: at(60), hp: tough, actions: [bow()], initiative: { mod: 60 } });
    const r = replay(battle([beast, near, archer], { positioning: true, maxRounds: 1, aftermath: "none" }), pf2eRules, 3);
    const move = r.log.find(e => e.actorId === "beast" && e.type === "move");
    expect(move?.towardId).toBe("archer");
  });

  test("shot from afar while already in a fight, it keeps at the one in front of it", () => {
    const beast = creature({ id: "beast", position: at(0), traits: traits(5), actions: [strike({ bonus: -50 })] });
    const brawler = creature({ id: "brawler", side: "hostile", position: at(5), hp: tough, actions: [harmless()], initiative: { mod: 70 } });
    const archer = creature({ id: "archer", side: "hostile", position: at(60), hp: tough, actions: [bow()], initiative: { mod: 60 } });
    const r = replay(battle([beast, brawler, archer], { positioning: true, maxRounds: 1, aftermath: "none" }), pf2eRules, 3);
    expect(r.log.some(e => e.actorId === "beast" && e.type === "move")).toBe(false);
    expect(r.log.some(e => e.actorId === "beast" && e.type === "attack" && e.targetId === "brawler")).toBe(true);
  });

  test("an obsession stated in Tactics beats the tactics, and leaves no room for caution", () => {
    const hero = creature({
      id: "hero", position: at(0), traits: traits(80), initiative: { mod: 50 },
      desires: [{ kind: "hurt", targetId: "wizard", level: 95 }]
    });
    const brute = creature({ id: "brute", side: "hostile", position: at(5), hp: tough, actions: [harmless()], flags: { reactiveStrike: true } });
    const wizard = creature({ id: "wizard", side: "hostile", position: at(30), hp: tough, actions: [harmless()] });
    const r = replay(battle([hero, brute, wizard], { positioning: true, maxRounds: 1, aftermath: "none" }), pf2eRules, 2);
    const mine = r.log.filter(e => e.actorId === "hero");
    expect(mine.find(e => e.type === "move")?.towardId).toBe("wizard");
    expect(mine.some(e => e.type === "disengage")).toBe(false); // obsessed: no careful Step first
    expect(r.log.some(e => e.type === "opportunity" && e.targetId === "hero")).toBe(true);
  });

  test("the story gets the two strongest thoughts", () => {
    const healer = creature({
      id: "healer", position: at(0), traits: traits(60),
      actions: [strike(), { id: "heal", name: "Heal", kind: "heal", cost: 1, heal: [parseFormula("1d8+4", "healing")] }]
    });
    const friend = creature({ id: "friend", position: at(10), hp: { value: 3, max: 20, temp: 0 } });
    const wolf = creature({ id: "wolf", side: "hostile", position: at(40), hp: tough, actions: [harmless()] });
    const r = replay(battle([healer, friend, wolf], { positioning: true, maxRounds: 1, aftermath: "none" }), pf2eRules, 2);
    const thought = r.log.find(e => e.type === "thought" && e.actorId === "healer");
    expect(thought.desires.map(d => d.kind).sort()).toEqual(["heal", "hurt"]);
    expect(thought.desires.find(d => d.kind === "heal").target).toBe("friend");
  });
});

describe("leaders and teams", () => {
  const at2 = (x, y = 0) => ({ x, y, size: 5 });
  /** A boss who wants the left foe dead, a follower, and two equally good foes. How often does the follower go left? */
  function leftShare(follower = {}, runs = 30) {
    let left = 0;
    for ( let seed = 1; seed <= runs; seed++ ) {
      const boss = creature({ id: "boss", position: at2(0), traits: traits(60), actions: [harmless()], desires: [{ kind: "hurt", targetId: "left", level: 95 }], initiative: { mod: 60 } });
      const mate = creature({ id: "mate", position: at2(0, 10), traits: traits(70), actions: [strike({ bonus: -50 })], initiative: { mod: 40 }, ...follower });
      const l = creature({ id: "left", side: "hostile", position: at2(30, -20), hp: tough, actions: [harmless()] });
      const r = creature({ id: "right", side: "hostile", position: at2(30, 40), hp: tough, actions: [harmless()] });
      const spec = battle([boss, mate, l, r], { positioning: true, maxRounds: 1, aftermath: "none" }, {
        friendly: { label: "Party", enemies: ["hostile"], leaderId: "boss" }, hostile: { label: "Foes", enemies: ["friendly"] }
      });
      const move = replay(spec, pf2eRules, seed).log.find(e => e.actorId === "mate" && e.type === "move");
      if ( move?.towardId === "left" ) left++;
    }
    return left / runs;
  }

  test("a follower leans toward what its leader wants", () => {
    expect(leftShare()).toBeGreaterThan(0.7);
  });

  test("a contrarian (a chaotic one, or an instigator, who isn't leading) may lean away from it", () => {
    const pills = ids => ({ playstyles: ids, desireStyle: combinePlaystyles(ids).desire, behavior: combinePlaystyles(ids).behavior });
    expect(leftShare(pills(["instigator"]))).toBeLessThan(leftShare());
  });

  test("a leaderless team pulls together less (but not when it comes to vengeance)", async () => {
    const { listen, initDesires, think, levelOf } = await import("../scripts/engine/behavior/desire.js");
    const mk = (id, side = "a") => ({ id, side, spec: { traits: {} }, prep: { traits: { loyal: 60, brave: 50 } }, status: "standing", active: true, hp: 10, maxHp: 10 });
    const u = mk("u");
    const friend = mk("friend");
    const run = leaderId => ({ prep: { sides: { a: { leaderId } } }, units: [u, friend], byId: new Map([["u", u], ["friend", friend]]), rng: { chance: () => false } });
    const heal = leaderId => {
      initDesires(u);
      think(u, "heal", "friend", 50);
      listen(run(leaderId), u, { canHeal: true });
      return levelOf(u, "heal", "friend");
    };
    expect(heal(null)).toBeLessThan(heal("friend"));
  });

  test("a would-be leader half ignores the actual leader", () => {
    const pills = ids => ({ playstyles: ids, desireStyle: combinePlaystyles(ids).desire, behavior: combinePlaystyles(ids).behavior });
    expect(leftShare(pills(["leader"]))).toBeLessThanOrEqual(leftShare());
  });
});
