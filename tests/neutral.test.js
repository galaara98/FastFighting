import { describe, expect, test } from "vitest";
import { runBatchSync, replay, prepareBattle } from "../scripts/engine/simulator.js";
import { createRun, areEnemies, alliesOf } from "../scripts/engine/battle-state.js";
import { createRng } from "../scripts/engine/rng.js";
import { initDesires } from "../scripts/engine/behavior/desire.js";
import { crossed, refreshLeans, appeal, GRIEVANCE } from "../scripts/engine/behavior/neutral.js";
import { attemptTalk, choosePitch, talkDC, stepsToConvince } from "../scripts/engine/behavior/talk.js";
import { NEUTRAL_PARTY } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle, social as talkData } from "./helpers.js";

const social = (over = {}) => talkData({ diplomacy: 3, intimidation: 3, deception: 3, ...over });
const quiet = { pitches: {}, resist: {}, languages: [] }; // can't be talked to, and doesn't talk
const fighter = (over = {}) => creature({ id: "fighter", kind: "pc", diesAtZero: false, hp: { value: 60, max: 60 }, social: quiet, ...over });
const brute = (over = {}) => creature({ id: "brute", side: "hostile", hp: { value: 40, max: 40 }, social: quiet, ...over });
const guard = (over = {}) => creature({ id: "guard", side: NEUTRAL_PARTY, originSide: "neutral", social: quiet, actions: [strike({ bonus: 10, damage: [parseFormula("1d10+4", "slashing")] })], ...over });

/** A fight ready to poke at directly: desires and leans in place. */
function ready(combatants, options = {}) {
  const run = createRun(prepareBattle(battle(combatants, options), pf2eRules));
  run.rng = createRng(7);
  run.log = [];
  for ( const u of run.units ) initDesires(u);
  refreshLeans(run);
  const say = (unit, text, data) => run.log.push({ actor: unit.spec.name, text, ...data });
  return { run, say, units: Object.fromEntries(run.units.map(u => [u.id, u])) };
}

describe("taking no side", () => {
  test("nobody fights someone who takes no side, and each stands alone", () => {
    const { run, units } = ready([fighter(), brute(), guard(), guard({ id: "other" })]);
    expect(areEnemies(run, units.guard, units.fighter)).toBe(false);
    expect(areEnemies(run, units.brute, units.guard)).toBe(false);
    expect(alliesOf(run, units.guard)).toEqual([units.guard]);
  });

  test("whoever hurts it offends it: it turns on that side, and only that side", () => {
    const { run, say, units } = ready([fighter(), brute(), guard()]);
    crossed(run, units.brute, units.guard, "harm", 1, say);
    expect(units.guard.against.has("hostile")).toBe(true);
    expect(areEnemies(run, units.guard, units.brute)).toBe(true);
    expect(areEnemies(run, units.guard, units.fighter)).toBe(false);
    expect(run.log.some(e => e.what === "offended" && e.why === "hurt")).toBe(true);
  });

  test("a lean toward the party: watching the party get hurt builds a grievance, then it turns on the attackers", () => {
    const { run, say, units } = ready([fighter(), brute(), guard({ lean: "friendly" })]);
    crossed(run, units.brute, units.fighter, "harm", 1, say);
    expect(units.guard.against.size).toBe(0); // one blow isn't enough
    expect(units.guard.grievance.get("hostile")).toBeGreaterThan(0);
    crossed(run, units.brute, units.fighter, "harm", 1.5, say);
    expect(units.guard.grievance.get("hostile")).toBeGreaterThanOrEqual(GRIEVANCE);
    expect(units.guard.against.has("hostile")).toBe(true);
    // The party hurting the brute means nothing to it.
    crossed(run, units.fighter, units.brute, "harm", 3, say);
    expect(units.guard.against.has("friendly")).toBe(false);
  });

  test("in a fight, a guard who leans toward the party ends up fighting the brute, never the party", () => {
    let joined = 0;
    for ( let seed = 1; seed <= 20; seed++ ) {
      const r = replay(battle([fighter(), brute(), guard({ lean: "friendly" })], { maxRounds: 8 }), pf2eRules, seed);
      const turned = r.log.filter(e => e.type === "neutral" && e.what === "offended");
      expect(turned.every(e => e.side === "hostile")).toBe(true);
      if ( turned.length ) joined += 1;
      expect(r.log.some(e => e.actor === "guard" && e.type === "attack" && e.target === "fighter")).toBe(false);
    }
    expect(joined).toBeGreaterThan(10);
  });

  test("someone who takes no side doesn't keep a fight going, and never wins it", () => {
    const r = runBatchSync(battle([fighter(), brute(), guard()], { maxRounds: 10 }), pf2eRules, { runs: 100 });
    expect(r.sides[NEUTRAL_PARTY]).toBeUndefined();
    expect(r.sides.friendly.pWin + r.sides.hostile.pWin + r.pStalemate + r.pNone).toBeCloseTo(1, 5);
  });
});

describe("talking with those who take no side", () => {
  const talker = (over = {}) => creature({ id: "talker", side: "hostile", social: social({ diplomacy: 14, deception: 12 }), ...over });
  const listener = (over = {}) => guard({ social: social(), ...over });

  test("winning someone over goes easier when it gives them what they want, harder when it betrays it", () => {
    const { run, units } = ready([fighter(), talker(), creature({ id: "ally", social: social({ diplomacy: 14 }) }), listener({ lean: "friendly" })]);
    const party = units.ally;
    const foe = units.talker;
    expect(appeal(run, units.guard, "friendly").fulfils?.kind).toBe("protect");
    expect(appeal(run, units.guard, "hostile").betrays?.kind).toBe("protect");
    expect(talkDC(run, foe, units.guard, "persuade")).toBeGreaterThan(talkDC(run, party, units.guard, "persuade"));
    expect(stepsToConvince(units.guard, run, foe)).toBeGreaterThan(stepsToConvince(units.guard, run, party));
  });

  test("the other side can still win it over, against its lean, with no luck check", () => {
    const { run, say, units } = ready([fighter(), talker(), listener({ lean: "friendly" })]);
    const t = units.guard;
    const pitch = { target: t, kind: "persuade", aim: "recruit", skill: "diplomacy", mod: 40, dc: 10, dcLabel: "will" };
    t.sway.set("hostile", stepsToConvince(t, run, units.talker) - 1);
    expect(attemptTalk(run, units.talker, pitch, say)).toBe(true);
    expect(t.side).toBe("hostile");
    expect(t.swayOutcome).toBe("switched");
    expect(run.log.some(e => e.what === "luck")).toBe(false);
  });

  test("but not once it has seen that side cross it", () => {
    const { run, say, units } = ready([fighter(), talker(), listener({ lean: "friendly" })]);
    expect(choosePitch(run, units.talker, { only: o => o === units.guard })?.target).toBe(units.guard);
    crossed(run, units.talker, units.fighter, "harm", 0.5, say);
    expect(units.guard.crossedBy.has("hostile")).toBe(true);
    expect(choosePitch(run, units.talker, { only: o => o === units.guard })).toBeNull();
  });

  test("a talker who's crossed confronts the offender first: a truce in the middle of the fight", () => {
    const { run, say, units } = ready([fighter(), talker(), listener({ lean: "friendly", social: social({ diplomacy: 14 }) })]);
    crossed(run, units.talker, units.fighter, "harm", 3, say);
    expect(units.guard.truce?.side).toBe("hostile");
    expect(units.guard.against.size).toBe(0);
    expect(run.log.some(e => e.what === "truce")).toBe(true);
    // Crossing it again while they talk ends the talking.
    crossed(run, units.talker, units.fighter, "harm", 0.5, say);
    expect(units.guard.truce).toBeNull();
    expect(units.guard.against.has("hostile")).toBe(true);
  });

  test("in a fight, a truce settles or breaks, and the talking happens between the two of them", () => {
    let truces = 0;
    for ( let seed = 1; seed <= 30; seed++ ) {
      const r = replay(battle([fighter(), talker({ actions: [strike({ bonus: 8 })] }), listener({ lean: "friendly", social: social({ diplomacy: 14 }) })], { maxRounds: 8, opening: "fight" }), pf2eRules, seed);
      if ( !r.log.some(e => e.what === "truce") ) continue;
      truces += 1;
      const guardTalks = r.log.filter(e => e.actor === "guard" && e.type === "talk");
      expect(guardTalks.every(e => e.target === "talker" && e.aim === "settle")).toBe(true);
    }
    expect(truces).toBeGreaterThan(5);
  });
});

describe("enemies changing sides", () => {
  const talker = () => creature({ id: "talker", kind: "pc", diesAtZero: false, social: social({ diplomacy: 14, intimidation: 12, deception: 10 }), actions: [strike({ bonus: 2, damage: [parseFormula("1d4", "bludgeoning")] })] });
  const bandit = (over = {}) => creature({ id: "bandit", side: "hostile", originSide: "neutral", social: social(), ...over });

  test("they only stand aside, and only on a d100 under the switch luck", () => {
    const always = runBatchSync(battle([talker(), bandit()], { switchLuck: 100 }), pf2eRules, { runs: 400 });
    const never = runBatchSync(battle([talker(), bandit()], { switchLuck: 0 }), pf2eRules, { runs: 400 });
    const usual = runBatchSync(battle([talker(), bandit()]), pf2eRules, { runs: 400 });
    expect(always.combatants.bandit.pNeutral).toBeGreaterThan(0.1);
    expect(never.combatants.bandit.pNeutral).toBe(0);
    expect(usual.combatants.bandit.pNeutral).toBeGreaterThan(never.combatants.bandit.pNeutral);
    expect(usual.combatants.bandit.pNeutral).toBeLessThan(always.combatants.bandit.pNeutral);
    // Talked into something else instead: they still leave the fight.
    expect(never.combatants.bandit.pTalkedDown).toBeGreaterThan(0.1);
  });

  test("one who stands aside still leans a little toward old friends, and can be won over from there", () => {
    const { run, say, units } = ready([talker(), bandit({ traits: { tactical: { base: 50, fudge: 0 }, brave: { base: 50, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 80, fudge: 0 } } }), creature({ id: "boss", side: "hostile" })], { switchLuck: 100 });
    const b = units.bandit;
    b.sway.set("friendly", 10);
    const pitch = { target: b, kind: "persuade", aim: "down", skill: "diplomacy", mod: 40, dc: 10, dcLabel: "will" };
    // Keep rolling until the convinced bandit picks changing sides (a 60% chance for a neutral).
    for ( let i = 0; i < 20 && b.side === "hostile"; i++ ) {
      b.status = "standing";
      b.sway.set("friendly", 10);
      attemptTalk(run, units.talker, pitch, say);
    }
    expect(b.side).toBe(NEUTRAL_PARTY);
    expect(b.swayOutcome).toBe("neutral");
    expect(b.lean).toBe("hostile");
    expect(b.desire.lean.get("protect|boss")).toBeGreaterThan(0);
    expect(choosePitch(run, units.talker, { only: o => o === b })?.aim).toBe("recruit");
  });
});
