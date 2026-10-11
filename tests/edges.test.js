import { describe, expect, test } from "vitest";
import { replay, prepareBattle } from "../scripts/engine/simulator.js";
import { createRun, boostBonus, modsAgainst, checkRoll, studyBonus } from "../scripts/engine/battle-state.js";
import { applyOutcome, spendEdges } from "../scripts/engine/behavior/effects.js";
import { bestPitch } from "../scripts/engine/behavior/talk.js";
import { degreeDistribution } from "../scripts/engine/probability.js";
import { buildStory } from "../scripts/story/story.js";
import { buildEnglishTables } from "../scripts/story/tables-en.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { genericRules } from "../scripts/adapters/generic/rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle, social } from "./helpers.js";

const english = buildEnglishTables();
const tables = { get: k => english[k] };
const minded = (tactical = 70) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const tough = { value: 400, max: 400, temp: 0 };
const fighter = (id, extra = {}) => creature({ id, kind: "pc", diesAtZero: false, hp: { value: 120, max: 120 }, traits: minded(60),
  actions: [strike({ id: `${id}-sword`, bonus: 7, damage: [parseFormula("1d10+5", "slashing")] })], ...extra });
const ogre = (id = "ogre", extra = {}) => creature({ id, side: "hostile", hp: tough, defenses: { ac: 20, fortitude: 8, reflex: 6, will: 4 }, traits: minded(40),
  actions: [strike({ id: `${id}-club`, bonus: 6, damage: [parseFormula("1d8+4", "bludgeoning")] })], flags: { fearless: true }, ...extra });
const unitsOf = spec => {
  const run = createRun(prepareBattle(spec, pf2eRules));
  return { run, by: id => run.byId.get(id) };
};

describe("edges: one roll, one foe", () => {
  test("a bonus against one foe counts only against that foe, and one good for a single roll is spent by it", () => {
    const { by } = unitsOf(battle([fighter("f1"), ogre("a"), ogre("b")]));
    const f = by("f1");
    applyOutcome(f, { mods: { attack: 2, adv: 1 }, uses: 1, vs: "a", rounds: 3, label: "helped" }, "x", { id: "help" });
    expect(modsAgainst(f, by("a"))).toEqual({ attack: 2, adv: 1 });
    expect(modsAgainst(f, by("b"))).toEqual({});
    spendEdges(f, "attack", "b"); // a roll at the other foe spends nothing
    expect(f.effects).toHaveLength(1);
    spendEdges(f, "check", "a"); // nor does a roll it doesn't help
    expect(f.effects).toHaveLength(1);
    spendEdges(f, "attack", "a");
    expect(f.effects).toHaveLength(0);
    expect(modsAgainst(f, by("a"))).toEqual({});
  });

  test("a die and advantage on checks reach the words (Guidance, Friends)", () => {
    const talker = fighter("t", { social: social({ diplomacy: 6 }) });
    const { run, by } = unitsOf(battle([talker, ogre("a", { social: social() })]));
    const t = by("t");
    const before = bestPitch(run, t, by("a"));
    applyOutcome(t, { mods: { checkDie: 4 }, uses: 1, rounds: 10, label: "guided" }, "t", { id: "guidance" });
    applyOutcome(t, { mods: { checkAdv: 1 }, vs: "a", rounds: 10, label: "friendly" }, "t", { id: "friends" });
    const after = bestPitch(run, t, by("a"));
    expect(after.dice).toEqual([4]);
    expect(after.advantage).toBe(1);
    expect(after.pSuccess).toBeGreaterThan(before.pSuccess + 0.15);
    expect(checkRoll(run, t, 6).advantage).toBe(0); // (friendly toward that one only)
  });

  test("an edge that needs a roll: what the roll reaches decides what comes of it", () => {
    // PF2e Aid: DC 15; a success +1 to the friend's next roll at its foe, a critical failure -1.
    const aid = { id: "aid", name: "Aid", kind: "buff", cost: 1, includeSelf: false, check: { mod: 30, dc: 15, label: "Aid" },
      onDegree: [{ mods: { attack: -1 }, uses: 1, vsFocus: true, label: "hindered" }, null, { mods: { attack: 1 }, uses: 1, vsFocus: true, label: "aided" }, { mods: { attack: 2 }, uses: 1, vsFocus: true, label: "aided" }] };
    const helper = fighter("helper", { initiative: { mod: -50 }, actions: [strike({ id: "jab", bonus: 0, damage: [parseFormula("1", "bludgeoning")] }), aid] });
    const spec = battle([fighter("f1", { initiative: { mod: 50 } }), helper, ogre()], { maxRounds: 2 });
    const r = replay(spec, pf2eRules, 4);
    const given = r.log.find(e => e.type === "buff" && e.actorId === "helper");
    expect(given.check.degree).toBe(3);
    expect(given.against).toEqual(["ogre"]);
    expect(buildStory(r, spec, "statistician").text).toMatch(/helper → f1: Aid · Aid d20 \d+ \+\d+ = \d+ vs DC 15 · critical success · aided \(against ogre\)/);
    // A roll that can't make it: nothing comes of it, and the story says so.
    const hopeless = { ...aid, check: { mod: -40, dc: 15, label: "Aid" } };
    const spec2 = battle([fighter("f1", { initiative: { mod: 50 } }), fighter("helper", { initiative: { mod: -50 }, actions: [strike({ id: "jab", bonus: 0, damage: [parseFormula("1", "bludgeoning")] }), hopeless] }), ogre()], { maxRounds: 2 });
    const run2 = replay(spec2, pf2eRules, 4);
    expect(run2.log.some(e => e.type === "buff" && e.actorId === "helper")).toBe(false); // (it knows it can't: not worth an action)
  });

  test("5e Help: only for a friend whose foe is beside the helper", () => {
    const at = (x, y = 0) => ({ x, y, size: 5 });
    const help = { id: "help", name: "Help", kind: "buff", cost: 1, includeSelf: false, besideFoe: 5, range: { increment: 120, max: 120, noPenalty: true }, outcome: { mods: { adv: 1 }, uses: 1, vsFocus: true, label: "helped" } };
    const helper = pos => fighter("helper", { position: pos, initiative: { mod: -50 }, actions: [strike({ id: "jab", bonus: -5, damage: [parseFormula("1", "bludgeoning")] }), help] });
    const helped = r => r.log.some(e => e.type === "buff" && e.actorId === "helper");
    const near = replay(battle([fighter("f1", { position: at(0), initiative: { mod: 50 } }), helper(at(10)), ogre("ogre", { position: at(5) })], { positioning: true, maxRounds: 2 }), genericRules, 3);
    expect(helped(near)).toBe(true);
    const far = replay(battle([fighter("f1", { position: at(0), initiative: { mod: 50 } }), helper(at(0, 60)), ogre("ogre", { position: at(5), speeds: { walk: 0 } })], { positioning: true, maxRounds: 1 }), genericRules, 3);
    expect(far.log.filter(e => e.actorId === "helper" && e.round === 1).some(e => e.type === "buff")).toBe(false);
  });
});

describe("a Lore-Collector's payoff", () => {
  test("about 2.5 times as likely to succeed, worked out roll by roll", () => {
    const { by } = unitsOf(battle([fighter("s"), ogre()]));
    const s = by("s");
    const ogreUnit = by("ogre");
    const p = mod => { const d = degreeDistribution(pf2eRules, mod, 20, { kind: "attack" }); return d[2] + d[3]; };
    expect(boostBonus(pf2eRules, s, ogreUnit, 5, 20, { kind: "attack" })).toBe(0); // nothing paid for, nothing given
    s.studied.add("ogre");
    expect(boostBonus(pf2eRules, s, ogreUnit, 5, 20, { kind: "attack" })).toBe(0); // (sized up some other way: still no boost)
    applyOutcome(s, { boost: 2.5, vs: "ogre", rounds: 1, label: "sized up" }, "s", { id: "sizeUp:ogre" });
    const lift = boostBonus(pf2eRules, s, ogreUnit, 5, 20, { kind: "attack" });
    expect(p(5 + lift)).toBeGreaterThanOrEqual(2.5 * p(5) - 1e-9);
    expect(p(5 + lift - 1)).toBeLessThan(2.5 * p(5));
    expect(studyBonus(s, ogreUnit)).toBe(0); // (the boost counts instead of the lasting +1 while it holds)
    // A sure thing stays a sure thing; a long shot gets only as far as the dice allow.
    expect(boostBonus(pf2eRules, s, ogreUnit, 30, 20, { kind: "attack" })).toBe(0);
  });

  test("only after it pays for it: an action spent sizing the foe up, and the sizing up worked", () => {
    const scholar = (extra = {}) => fighter("s", { behavior: { study: 1 }, initiative: { mod: 50 }, ...extra });
    const boosted = r => r.log.filter(e => e.type === "attack" && e.actorId === "s" && e.boost > 0);
    const r = replay(battle([scholar(), ogre()], { maxRounds: 2 }), pf2eRules, 5);
    const study = r.log.find(e => e.type === "study" && e.actorId === "s");
    expect(study.worked).toBe(true);
    expect(boosted(r).length).toBeGreaterThan(0);
    // Its boosted blows come right after (the rest of that turn), and no others.
    for ( const e of boosted(r) ) expect(e.round).toBe(study.round);
    // Its check failed: nothing gained.
    const dunce = replay(battle([scholar({ sizeUp: { mod: -50, label: "Recall Knowledge" } }), ogre()], { maxRounds: 2 }), pf2eRules, 5);
    expect(dunce.log.find(e => e.type === "study" && e.actorId === "s").worked).toBe(false);
    expect(boosted(dunce)).toHaveLength(0);
    // No Lore-Collector, no sizing up, no boost.
    expect(boosted(replay(battle([fighter("s", { initiative: { mod: 50 } }), ogre()], { maxRounds: 2 }), pf2eRules, 5))).toHaveLength(0);
  });

  test("in a standoff its first turn may go into watching, and its next turn's words land far more often", () => {
    const lore = creature({ id: "lore", kind: "pc", diesAtZero: false, behavior: { observe: 1 }, initiative: { mod: 50 }, traits: minded(70),
      social: social({ diplomacy: 4, intimidation: 2, deception: 0 }), sizeUp: { mod: 40, label: "Recall Knowledge" } });
    const bandit = creature({ id: "bandit", side: "hostile", social: social({ diplomacy: 2 }), hp: tough, traits: minded(70) });
    const spec = battle([lore, bandit], { maxRounds: 3, opening: "talk" });
    const r = replay(spec, pf2eRules, 7);
    const mine = r.log.filter(e => e.actorId === "lore" && e.type !== "thought");
    expect(mine[0].type).toBe("observe");
    expect(mine.filter(e => e.round === 1).some(e => e.type === "talk")).toBe(false);
    const words = mine.find(e => e.type === "talk");
    expect(words.round).toBe(2);
    expect(words.mod).toBeGreaterThan(4 + 2); // its +4, and the boost on top
    const prose = buildStory(r, spec, "roleplay", { tables, seed: 7 }).text;
    expect(prose).not.toMatch(/\{\w+\}/);
    expect(buildStory(r, spec, "statistician").text).toMatch(/lore watches bandit instead of talking/);
  });
});

describe("set on bolstering a friend", () => {
  test("told to (driven or more), it bolsters that friend even when hitting would do more", () => {
    const pep = { id: "pep", name: "Pep Talk", kind: "buff", cost: 1, includeSelf: false, outcome: { mods: { attack: 1 }, uses: 1, rounds: 1, label: "heartened" } };
    const bard = (desires = []) => fighter("bard", { initiative: { mod: 50 }, desires, actions: [strike({ id: "rapier", bonus: 12, damage: [parseFormula("2d8+6", "piercing")] }), pep] });
    const given = r => r.log.filter(e => e.type === "buff" && e.actorId === "bard" && e.round === 1);
    const plain = replay(battle([bard(), fighter("f1"), ogre()], { maxRounds: 1 }), pf2eRules, 3);
    expect(given(plain)).toHaveLength(0); // (not worth an action next to its rapier)
    const told = replay(battle([bard([{ kind: "aid", targetId: "f1", level: 90 }]), fighter("f1"), ogre()], { maxRounds: 1 }), pf2eRules, 3);
    expect(given(told).map(e => e.targetIds)).toEqual([["f1"]]);
  });
});
