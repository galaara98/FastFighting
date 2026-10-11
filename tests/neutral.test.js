import { describe, expect, test } from "vitest";
import { runBatchSync, replay, prepareBattle } from "../scripts/engine/simulator.js";
import { createRun, areEnemies, alliesOf } from "../scripts/engine/battle-state.js";
import { createRng } from "../scripts/engine/rng.js";
import { initDesires } from "../scripts/engine/behavior/desire.js";
import { crossed, refreshLeans, appeal, seemsFoe, sparedForTruce, GRIEVANCE, LEAN, FELLOW } from "../scripts/engine/behavior/neutral.js";
import { attemptTalk, choosePitch, talkDC, stepsToConvince } from "../scripts/engine/behavior/talk.js";
import { NEUTRAL_PARTY } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle, social as talkData } from "./helpers.js";

const social = (over = {}) => talkData({ diplomacy: 3, intimidation: 3, deception: 3, ...over });
const quiet = { pitches: {}, resist: {}, languages: [] }; // can't be talked to, and doesn't talk
const minded = tactical => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 60, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
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
  // A tactical talker: it knows someone taking no side could be won over.
  const talker = (over = {}) => creature({ id: "talker", side: "hostile", traits: minded(70), social: social({ diplomacy: 14, deception: 12 }), ...over });
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
      const r = replay(battle([fighter(), talker({ traits: minded(45), actions: [strike({ bonus: 8 })] }), listener({ lean: "friendly", social: social({ diplomacy: 14 }) })], { maxRounds: 8, opening: "fight" }), pf2eRules, seed);
      if ( !r.log.some(e => e.what === "truce") ) continue;
      truces += 1;
      const guardTalks = r.log.filter(e => e.actor === "guard" && e.type === "talk");
      // (Settling its quarrel; and, leaning toward the party, talking the talker out of the fight once it has no quarrel.)
      expect(guardTalks.every(e => e.target === "talker" && ["settle", "down"].includes(e.aim))).toBe(true);
    }
    expect(truces).toBeGreaterThan(5);
  });
});

describe("enemies changing sides", () => {
  const talker = () => creature({ id: "talker", kind: "pc", diesAtZero: false, traits: minded(70), social: social({ diplomacy: 14, intimidation: 12, deception: 10 }), actions: [strike({ bonus: 2, damage: [parseFormula("1d4", "bludgeoning")] })] });
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

describe("leans don't last, and not everyone sees a neutral for what it is", () => {
  const villager = (over = {}) => guard({ id: "villager", ...over });

  test("neutral tokens want each other safe; a lean wears down as its side hurts them, and ends when its side hurts it", () => {
    const { run, say, units } = ready([fighter(), brute(), guard({ lean: "friendly" }), villager()]);
    expect(units.guard.desire.lean.get("protect|villager")).toBe(FELLOW);
    expect(units.guard.desire.lean.get("protect|fighter")).toBe(LEAN);
    // The party hurts the villager: the guard's lean toward the party wears down.
    crossed(run, units.fighter, units.villager, "harm", 1, say);
    expect(units.guard.leanLevel).toBeLessThan(LEAN);
    expect(units.guard.lean).toBe("friendly");
    expect(units.guard.desire.lean.get("protect|fighter")).toBe(units.guard.leanLevel);
    // The party hurts the guard itself: the lean is gone at once.
    crossed(run, units.fighter, units.guard, "harm", 0.5, say);
    expect(units.guard.lean).toBeNull();
    expect(units.guard.desire.lean.get("protect|fighter")).toBeUndefined();
    expect(units.guard.desire.lean.get("protect|villager")).toBe(FELLOW); // still a friend of the villager
  });

  test("only tactical minds see someone taking no side for what it is; others go by appearances", () => {
    const { run, units } = ready([fighter(), brute({ traits: minded(30) }), creature({ id: "captain", side: "hostile", traits: minded(70) }),
      creature({ id: "beast", side: "hostile", traits: minded(5), position: { x: 0, y: 0, size: 5 } }),
      guard({ lean: "friendly" }), villager({ position: { x: 5, y: 0, size: 5 } })], { positioning: false });
    // Leaning toward the party, the guard looks like one of them to the brute, not to the captain.
    expect(seemsFoe(run, units.brute, units.guard)).toBe(true);
    expect(seemsFoe(run, units.captain, units.guard)).toBe(false);
    // The party doesn't take the guard for a foe (it leans their way).
    expect(seemsFoe(run, units.fighter, units.guard)).toBe(false);
    // To a feral beast, anything close is fair game.
    expect(seemsFoe(run, units.beast, units.villager)).toBe(true);
  });

  test("in a fight, an unthinking brute sometimes goes for a guard leaning toward the party; a captain never does", () => {
    // The guard stands right beside the brute; the fighter is a long way off.
    const at = x => ({ x, y: 0, size: 5 });
    const fight = brains => battle([fighter({ hp: { value: 200, max: 200 }, position: at(120) }), brute({ traits: minded(brains), hp: { value: 200, max: 200 }, position: at(0) }),
      guard({ lean: "friendly", position: at(5) })], { maxRounds: 4, positioning: true });
    // (Attacks before the guard has turned on them: afterwards it's a foe like any other.)
    const attacks = brains => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter(seed => {
      const log = replay(fight(brains), pf2eRules, seed).log;
      const turned = log.findIndex(e => e.type === "neutral" && e.what === "offended");
      return log.some((e, i) => e.actor === "brute" && e.type === "attack" && e.target === "guard" && (turned < 0 || i < turned));
    }).length;
    expect(attacks(30)).toBeGreaterThan(0);
    expect(attacks(70)).toBe(0);
  });

  test("only a tactical talker tries to win someone over unprompted; others when they want to, or when they always talk first", () => {
    const talker = (over = {}) => creature({ id: "talker", side: "hostile", social: social({ diplomacy: 14 }), ...over });
    const pick = (t, extra = []) => {
      const { run, units } = ready([fighter(), t, guard({ lean: "friendly", social: social() }), ...extra]);
      return choosePitch(run, units.talker, { only: o => o === units.guard })?.aim ?? null;
    };
    expect(pick(talker({ traits: minded(70) }))).toBe("recruit");
    expect(pick(talker({ traits: minded(45) }))).toBeNull();
    // A desire to talk to it (here, stated): it tries.
    expect(pick(talker({ traits: minded(45), desires: [{ kind: "talk", targetId: "guard", level: 50 }] }))).toBe("recruit");
    // Words before blows, at someone it takes for a foe: it may win it over by accident.
    expect(pick(talker({ traits: minded(30), tactics: { talk: "first" } }))).toBe("recruit");
  });

  test("while someone taking no side has words with a side, its smart members hold off hurting it or those it wants safe", () => {
    const listener = guard({ lean: "friendly", social: social({ diplomacy: 14 }) });
    const { run, say, units } = ready([fighter(), creature({ id: "talker", side: "hostile", traits: minded(70), social: social({ diplomacy: 12 }) }),
      brute({ traits: minded(30) }), listener]);
    crossed(run, units.talker, units.fighter, "harm", 3, say);
    expect(units.guard.truce?.side).toBe("hostile");
    const spared = sparedForTruce(run, units.talker);
    expect(spared.has("guard") && spared.has("fighter")).toBe(true);
    expect(sparedForTruce(run, units.brute)).toBeNull(); // not smart enough to hold back
    // Once nobody on that side can talk to it, the talk is lost anyway: no holding back.
    units.talker.status = "fled";
    expect(sparedForTruce(run, units.talker)).toBeNull();
  });
});

describe("not one for killing", () => {
  const speaker = (over = {}) => creature({ id: "kind", kind: "pc", diesAtZero: false, neverKill: true, traits: minded(45), social: social({ diplomacy: 14 }), ...over });
  const standing = (over = {}) => creature({ id: "bandit", side: NEUTRAL_PARTY, originSide: "hostile", social: social(), ...over });

  function primed(talker, extra = []) {
    const { run, say, units } = ready([talker, standing(), brute(), ...extra]);
    units.bandit.swayOutcome = "neutral"; // talked out of the fight earlier
    return { run, say, units };
  }

  test("seeing an enemy talked aside, it wants to talk to it again: just under what's most on its mind", async () => {
    const { peaceDesires } = await import("../scripts/engine/behavior/neutral.js");
    const { levelOf } = await import("../scripts/engine/behavior/desire.js");
    // (No great talker, and no leader: a plain soul who would rather not kill.)
    const { run, units } = primed(speaker({ social: social({ diplomacy: 4 }) }));
    const peace = peaceDesires(run, units.kind, 60);
    expect(peace).toMatchObject({ targetId: "bandit", aim: "recruit", level: 55 });
    expect(levelOf(units.kind, "talk", "bandit")).toBe(55);
  });

  test("leaders and talkers among them would rather send it away, want it more, and look at any neutral", async () => {
    const { peaceDesires } = await import("../scripts/engine/behavior/neutral.js");
    const { run, units } = primed(speaker({ playstyles: ["leader"] }), [guard({ social: social() })]);
    const peace = peaceDesires(run, units.kind, 60);
    expect(peace).toMatchObject({ targetId: "bandit", aim: "dismiss", level: 65 });
    expect(units.kind.desire.logic.get("talk|guard")).toBe(50); // any neutral it sees, a little less
  });

  test("talked into leaving, someone taking no side leaves the field", () => {
    const { run, say, units } = primed(speaker({ playstyles: ["diplomat"] }));
    units.kind.peace = { targetId: "bandit", aim: "dismiss", level: 60 };
    const t = units.bandit;
    const pitch = { target: t, kind: "persuade", aim: "dismiss", skill: "diplomacy", mod: 40, dc: 10, dcLabel: "will" };
    t.sway.set("friendly", 10);
    expect(attemptTalk(run, units.kind, pitch, say)).toBe(true);
    expect(t.status).toBe("fled");
    expect(run.log.some(e => e.type === "talk" && /to leave/.test(e.text ?? ""))).toBe(true);
  });

  test("in a fight, a peacemaker who never kills tries to talk a neutral off the field", () => {
    let talked = 0;
    let gone = 0;
    for ( let seed = 1; seed <= 12; seed++ ) {
      const spec = battle([speaker({ playstyles: ["leader"] }), standing({ originSide: "neutral" }), brute({ hp: { value: 80, max: 80 } })], { maxRounds: 5, opening: "fight" });
      const r = replay(spec, pf2eRules, seed);
      const talks = r.log.filter(e => e.actor === "kind" && e.type === "talk" && e.target === "bandit");
      if ( talks.length ) talked += 1;
      expect(talks.every(e => e.aim === "dismiss")).toBe(true);
      if ( r.units.bandit.status === "fled" ) gone += 1;
      expect(r.log.some(e => e.actor === "kind" && e.type === "attack" && e.target === "bandit")).toBe(false);
    }
    expect(talked).toBeGreaterThan(6);
    expect(gone).toBeGreaterThan(2);
  });
});

describe("a neutral talking for the side it leans toward", () => {
  const elder = (over = {}) => guard({ id: "elder", lean: "friendly", social: social({ diplomacy: 25, intimidation: 20 }), playstyles: ["diplomat"], behavior: { parleyFirst: 1 }, ...over });
  const bandit = (over = {}) => brute({ id: "bandit", social: social(), hp: { value: 40, max: 40 }, ...over });
  const pc = (over = {}) => fighter({ social: social(), ...over });

  test("in a standoff it talks the party's enemies out of the fight, and that settles it for the party", () => {
    let settled = 0;
    for ( let seed = 1; seed <= 30; seed++ ) {
      const r = replay(battle([pc(), bandit(), elder({ initiative: { mod: 50 } })], { maxRounds: 4, opening: "talk" }), pf2eRules, seed);
      const words = r.log.filter(e => e.actor === "elder" && e.type === "talk");
      for ( const e of words ) expect([e.target, e.aim]).toEqual(["bandit", "down"]);
      if ( r.log.some(e => e.type === "sway" && e.byId === "elder" && ["fled", "conceded", "stoodDown"].includes(e.outcome)) ) settled += 1;
    }
    expect(settled).toBeGreaterThan(3);
  });

  test("in the encounter from the start, it's aware at once: its words come in the first round", () => {
    const r = replay(battle([pc(), bandit(), elder({ initiative: { mod: 50 } })], { maxRounds: 2, opening: "talk" }), pf2eRules, 2);
    expect(r.log.find(e => e.actor === "elder" && e.type === "talk")?.round).toBe(1);
    // A bystander (not in the encounter) has to notice the fight first.
    const late = replay(battle([pc(), bandit(), elder({ initiative: { mod: 50 }, inEncounter: false, position: { x: 500, y: 500, size: 5 } })], { maxRounds: 1, opening: "talk" }), pf2eRules, 2);
    expect(late.log.some(e => e.actor === "elder" && e.type === "talk")).toBe(false);
  });

  test("leaning toward the party's enemies, it talks the party down instead (a player character can only pay up or back off)", () => {
    const r = replay(battle([pc({ valuables: { money: 50 } }), bandit(), elder({ lean: "hostile", initiative: { mod: 50 } })], { maxRounds: 3, opening: "talk" }), pf2eRules, 4);
    for ( const e of r.log.filter(x => x.actor === "elder" && x.type === "talk") ) expect(e.target).toBe("fighter");
  });
});
