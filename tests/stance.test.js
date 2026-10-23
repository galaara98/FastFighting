/**
 * Team stances (engine/behavior/stance.js): a team's head takes a view of the fight as a whole, and its team acts on
 * it: leaving when outmatched, a friend group jumping in for a side or against one, and a team hanging back while two
 * others fight, then preying on the spent.
 */
import { describe, expect, test } from "vitest";
import { beginRun, prepareBattle, replay, playTurn, beginRound } from "../scripts/engine/simulator.js";
import { stanceOf, teamOdds, STANCE } from "../scripts/engine/behavior/stance.js";
import { STATUS, NEUTRAL_PARTY, TACTICAL } from "../scripts/constants.js";
import { startLeaving } from "../scripts/engine/behavior/leaving.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";
import { buildStory } from "../scripts/story/story.js";
import { storyTables, text } from "./foundry-i18n.js";

const english = storyTables();
const tables = { get: k => english[k] };

const mind = (tactical, { brave = 50, selfish = 40, loyal = 60 } = {}) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: brave, fudge: 0 }, selfish: { base: selfish, fudge: 0 }, loyal: { base: loyal, fudge: 0 } });
const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
const lead = () => ({ brave: 0, tacticalFloor: 0, attack: 0, ac: 0 });
const chain = (...ids) => ids.map((id, i) => ({ id, role: i ? "lieutenant" : "leader", leadership: lead() }));
const goblin = (id, tactical = 50, extra = {}) => creature({ id, name: id, side: "hostile", hp: { value: 8, max: 8 }, traits: mind(tactical), ...extra });
const hero = (extra = {}) => creature({ id: "hero", name: "Hero", kind: "pc", diesAtZero: false, hp: { value: 300, max: 300 }, traits: mind(65),
  actions: [strike({ bonus: 20, damage: [parseFormula("3d10+10", "slashing")] })], ...extra });
const villager = (id, extra = {}) => creature({ id, name: id, side: NEUTRAL_PARTY, originSide: "neutral", group: 1, traits: mind(50, { brave: 70, loyal: 70 }), ...extra });

/** A fight set up, its first round begun (so each team's head has looked it over), with `rng` chances fixed if given. */
function fight(combatants, command, { options = {}, chance = null, sides = null } = {}) {
  const spec = { ...battle(combatants, { leadership: true, ...options }, sides), command };
  const run = beginRun(prepareBattle(spec, pf2eRules), 1, { log: true });
  if ( chance !== null ) run.rng = { ...run.rng, chance: () => chance };
  return { run, by: id => run.byId.get(id) };
}

describe("leaving: the odds too long", () => {
  test("a competent head takes its outmatched team out of the fight, and it goes", () => {
    const { run, by } = fight([goblin("chief"), goblin("gob"), hero()], { hostile: chain("chief") });
    beginRound(run, 1);
    expect(run.stance.hostile).toMatchObject({ kind: STANCE.LEAVE, byId: "chief" });
    expect(stanceOf(run, by("gob"))?.kind).toBe(STANCE.LEAVE);
    expect(run.log.some(e => e.type === "stance" && e.kind === STANCE.LEAVE && e.actorId === "chief")).toBe(true);
    // (On its turn, it runs: told why.)
    playTurn(run, by("gob"));
    expect(run.log.some(e => e.type === "flee" && e.actorId === "gob" && e.why === "odds")).toBe(true);
  });

  test("not an instinctive head (morale is all it has), nor a leaderless team, nor the boss (almost never)", () => {
    const dim = fight([goblin("chief", 30), goblin("gob", 30), hero()], { hostile: chain("chief") });
    beginRound(dim.run, 1);
    expect(dim.run.stance.hostile ?? null).toBeNull();
    const alone = fight([goblin("chief"), goblin("gob"), hero()], {});
    beginRound(alone.run, 1);
    expect(alone.run.stance.hostile ?? null).toBeNull();
    const boss = fight([goblin("chief"), goblin("gob"), hero()], { hostile: [{ id: "chief", role: "boss", leadership: lead() }] }, { chance: false });
    beginRound(boss.run, 1);
    expect(boss.run.stance.hostile ?? null).toBeNull();
  });

  test("a new head (the old one fallen) takes the team's view again, by its own nature: a brave one calls them back", () => {
    const { run, by } = fight([goblin("chief", 50, { traits: mind(50, { brave: 20, selfish: 80 }) }), goblin("lt", 50, { traits: mind(50, { brave: 95, selfish: 10 }) }), goblin("gob"), hero()],
      { hostile: chain("chief", "lt") });
    beginRound(run, 1);
    expect(run.stance.hostile).toMatchObject({ kind: STANCE.LEAVE, byId: "chief" });
    startLeaving(run, by("gob"), { why: "odds" });
    Object.assign(by("chief"), { status: STATUS.DEAD, hp: 0 });
    beginRound(run, 2);
    expect(run.stance.hostile ?? null).toBeNull();
    expect(by("gob").leaving).toBeNull();
    expect(run.log.some(e => e.type === "stance" && e.kind === "stay" && e.actorId === "lt")).toBe(true);
  });

  test("an even fight: it stays", () => {
    const { run } = fight([goblin("chief", 50, { hp: { value: 300, max: 300 } }), goblin("gob", 50, { hp: { value: 300, max: 300 } }), hero()], { hostile: chain("chief") });
    beginRound(run, 1);
    expect(run.stance.hostile ?? null).toBeNull();
  });

  test("the party only when FastFighting plays all of it", () => {
    const party = () => [hero({ hp: { value: 5, max: 80 } }), creature({ id: "ally", kind: "pc", hp: { value: 5, max: 80 }, traits: mind(65) }),
      goblin("brute", 50, { hp: { value: 300, max: 300 }, actions: [strike({ bonus: 20, damage: [parseFormula("3d10+10", "slashing")] })] })];
    const players = fight(party(), { friendly: chain("hero") });
    beginRound(players.run, 1);
    expect(players.run.stance.friendly ?? null).toBeNull();
    const ours = fight(party(), { friendly: chain("hero") }, { options: { playersRun: false } });
    beginRound(ours.run, 1);
    expect(ours.run.stance.friendly).toMatchObject({ kind: STANCE.LEAVE });
  });

  test("kept with the fight, not with what a batch shares", () => {
    const { run } = fight([goblin("chief"), goblin("gob"), hero()], { hostile: chain("chief") });
    beginRound(run, 1);
    expect(run.stance.hostile).toBeTruthy();
    expect(run.prep.stance).toBeUndefined();
    const again = beginRun(run.prep, 2, { log: true });
    expect(again.stance ?? {}).toEqual({});
  });
});

describe("jumping in: a friend group of those taking no side", () => {
  const setUp = ({ beset = true, grudge = 0, lean = "friendly" } = {}, chance = true) => {
    const s = fight([villager("elder", { lean, ...at(10) }), villager("son", { lean, ...at(15) }), goblin("gob", 50, { hp: { value: 30, max: 30 }, ...at(0, 10) }), hero(at(0))],
      { [`${NEUTRAL_PARTY}#1`]: chain("elder") }, { options: { positioning: true }, chance });
    for ( const id of ["elder", "son"] ) s.by(id).leanLevel = 60;
    if ( beset ) s.by("hero").harmedBy.set("gob", 5);
    if ( grudge ) s.by("son").grievance.set("hostile", grudge);
    return s;
  };

  test("the side it leans to set upon near it: it jumps in for it, against those who set upon it", () => {
    const { run, by } = setUp();
    beginRound(run, 1);
    expect(run.stance[`${NEUTRAL_PARTY}#1`]).toMatchObject({ kind: STANCE.SAVE, target: "friendly" });
    for ( const id of ["elder", "son"] ) expect(by(id).against.has("hostile")).toBe(true);
    expect(run.log.some(e => e.type === "stance" && e.kind === STANCE.SAVE && e.targetName)).toBe(true);
  });

  test("not before that side is set upon, nor when the chance doesn't come", () => {
    const calm = setUp({ beset: false });
    beginRound(calm.run, 1);
    expect(calm.run.stance[`${NEUTRAL_PARTY}#1`] ?? null).toBeNull();
    const no = setUp({}, false);
    beginRound(no.run, 1);
    expect(no.run.stance[`${NEUTRAL_PARTY}#1`] ?? null).toBeNull();
  });

  test("a grudge against a side near it: it jumps in against that side", () => {
    const { run, by } = setUp({ beset: false, grudge: 80, lean: null });
    beginRound(run, 1);
    expect(run.stance[`${NEUTRAL_PARTY}#1`]).toMatchObject({ kind: STANCE.HARM, target: "hostile" });
    expect(by("elder").against.has("hostile")).toBe(true);
  });
});

describe("waiting, then preying", () => {
  const THREE = {
    friendly: { label: "Party", enemies: ["hostile", "hostile2"] },
    hostile: { label: "Orcs", enemies: ["friendly", "hostile2"] },
    hostile2: { label: "Jackals", enemies: ["friendly", "hostile"] }
  };
  const setUp = (tactical = 70) => {
    const s = fight([
      goblin("orc", 50, { hp: { value: 300, max: 300 }, actions: [strike({ bonus: 20, damage: [parseFormula("3d10+10", "slashing")] })] }), hero({ hp: { value: 300, max: 300 } }),
      creature({ id: "jackal", name: "jackal", side: "hostile2", hp: { value: 30, max: 30 }, traits: mind(tactical, { selfish: 70 }) }),
      creature({ id: "pup", name: "pup", side: "hostile2", hp: { value: 30, max: 30 }, traits: mind(tactical, { selfish: 70 }) })
    ], { hostile2: chain("jackal") }, { sides: THREE });
    // (The orc and the hero at blows; the jackals not yet.)
    s.by("hero").harmedBy.set("orc", 4);
    s.by("orc").harmedBy.set("hero", 10);
    return s;
  };

  test("a tactical head hangs back while two others fight; its own hold back on their turns", () => {
    const { run, by } = setUp();
    beginRound(run, 1);
    expect(run.stance.hostile2).toMatchObject({ kind: STANCE.WAIT });
    const before = run.log.length;
    playTurn(run, by("pup"));
    expect(run.log.slice(before).some(e => e.type === "attack" || e.type === "strike")).toBe(false);
  });

  test("once one of them is spent, it goes after its mark: told, and wanting what it can take", () => {
    const { run, by } = setUp();
    beginRound(run, 1);
    Object.assign(by("orc"), { status: STATUS.DOWN, hp: 0 });
    by("hero").hp = 5;
    beginRound(run, 2);
    expect(run.stance.hostile2).toMatchObject({ kind: STANCE.PREY, target: "friendly" });
    expect(run.log.some(e => e.type === "stance" && e.kind === STANCE.PREY)).toBe(true);
  });

  test("not a head below tactical (a competent one, outmatched, goes instead)", () => {
    const { run } = setUp(50);
    beginRound(run, 1);
    expect([STANCE.WAIT, STANCE.PREY]).not.toContain(run.stance.hostile2?.kind);
  });
});

describe("the odds", () => {
  test("by heads and hit points; a tactical head weighs what each deals a round", () => {
    const { run, by } = fight([goblin("a"), goblin("b"), hero()], {});
    const gobs = [by("a"), by("b")];
    expect(teamOdds(run, gobs, [by("hero")], TACTICAL.COMPETENT)).toBeLessThan(0.5);
    expect(teamOdds(run, [by("hero")], gobs, TACTICAL.TACTICAL)).toBeGreaterThan(0.9);
    expect(teamOdds(run, gobs, [], TACTICAL.COMPETENT)).toBe(1);
  });

  test("told: the planner's log says who called it and on what odds; the story tells it as it's seen", () => {
    const spec = { ...battle([goblin("chief"), goblin("gob"), hero()], { leadership: true, maxRounds: 3 }), command: { hostile: chain("chief") } };
    const r = replay(spec, pf2eRules, 2);
    const e = r.log.find(x => x.type === "stance");
    expect(e).toMatchObject({ kind: STANCE.LEAVE, actor: "chief" });
    expect(buildStory(r, spec, "statistician").text).toContain(text("FASTFIGHTING.Log.StanceLeave", { actor: "chief", odds: Math.round(e.odds * 100) }));
    const told = buildStory(r, spec, "roleplay", { tables, seed: 2 }).text;
    expect(told).not.toMatch(/\{\w+\}/);
    // (One of the team-leaves lines, told of its head.)
    expect(english["event.stanceLeave"].some(line => told.toLowerCase().includes(line.replace("{actor}", "chief").toLowerCase()))).toBe(true);
  });

  test("the planner's fights still play out the same with stances in them (the batch and a replay agree)", () => {
    const spec = { ...battle([goblin("chief"), goblin("gob"), hero()], { leadership: true }), command: { hostile: chain("chief") } };
    const a = replay(spec, pf2eRules, 7);
    const b = replay(spec, pf2eRules, 7);
    expect(a.log.filter(e => e.type === "stance")).toEqual(b.log.filter(e => e.type === "stance"));
  });
});
