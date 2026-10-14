import { describe, expect, test } from "vitest";
import { replay, prepareBattle } from "../scripts/engine/simulator.js";
import { createRun, command, commandOf, liveTrait } from "../scripts/engine/battle-state.js";
import { followChance, follow, listen, levelOf, leaderless, styleOf, initDesires } from "../scripts/engine/behavior/desire.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";
import { STATUS, NEUTRAL_PARTY } from "../scripts/constants.js";
import { buildStory } from "../scripts/story/story.js";
import { storyTables, text } from "./foundry-i18n.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const english = storyTables();
const tables = { get: k => english[k] };
const minded = (loyal = 60) => ({ tactical: { base: 60, fudge: 0 }, brave: { base: 70, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: loyal, fudge: 0 } });
const goblin = (id, extra = {}) => creature({ id, side: "hostile", traits: minded(), ...extra });
const hero = (id, extra = {}) => creature({ id, kind: "pc", diesAtZero: false, hp: { value: 80, max: 80 }, traits: minded(), ...extra });
const lead = (brave = 10) => ({ brave, tacticalFloor: 40, attack: 0, ac: 0 });
const chain = (...entries) => entries.map(([id, role]) => ({ id, role, leadership: lead() }));
const runOf = (combatants, command, options = {}) => {
  const spec = { ...battle(combatants, { leadership: true, ...options }), command };
  const run = createRun(prepareBattle(spec, pf2eRules));
  return { run, by: id => run.byId.get(id) };
};

describe("chains of command", () => {
  test("the boss commands; down, its 1st lieutenant steps up (as a leader); then the 2nd; back up, the boss takes over again", () => {
    const { run, by } = runOf([goblin("boss"), goblin("lt1"), goblin("lt2"), goblin("grunt"), hero("pc")], { hostile: chain(["boss", "boss"], ["lt1", "lieutenant"], ["lt2", "lieutenant"]) });
    const grunt = by("grunt");
    expect(commandOf(run, grunt)).toMatchObject({ role: "boss", boss: true, rank: 0 });
    by("boss").status = STATUS.DOWN;
    expect(commandOf(run, grunt)).toMatchObject({ role: "leader", boss: false, rank: 1 });
    expect(commandOf(run, grunt).unit.id).toBe("lt1");
    by("lt1").status = STATUS.DEAD;
    expect(commandOf(run, grunt).unit.id).toBe("lt2");
    by("boss").status = STATUS.STANDING;
    expect(commandOf(run, grunt).unit.id).toBe("boss");
  });

  test("one who can't make itself seen and heard can't lead: blinded, deafened, silenced, out of its wits", () => {
    const { run, by } = runOf([goblin("chief"), goblin("lt1"), goblin("grunt"), hero("pc")], { hostile: chain(["chief", "leader"], ["lt1", "lieutenant"]) });
    for ( const c of ["blinded", "deafened", "silenced", "confused", "stunned", "incapacitated"] ) {
      by("chief").conds = { [c]: 1 };
      expect(commandOf(run, by("grunt")).unit.id, c).toBe("lt1");
    }
    by("chief").conds = { frightened: 1 }; // (frightened, it can still give orders)
    expect(commandOf(run, by("grunt")).unit.id).toBe("chief");
  });

  test("all of them out: leaderless; nobody's leadership lends anything", () => {
    const { run, by } = runOf([goblin("chief"), goblin("lt1"), goblin("grunt"), hero("pc")], { hostile: chain(["chief", "leader"], ["lt1", "lieutenant"]) });
    const brave = liveTrait(run, by("grunt"), "brave");
    by("chief").status = STATUS.DEAD;
    by("lt1").status = STATUS.FLED;
    expect(leaderless(run, by("grunt"))).toBe(true);
    expect(liveTrait(run, by("grunt"), "brave")).toBe(brave - 10);
  });

  test("neutral friend groups have chains of their own", () => {
    const n = (id, group) => creature({ id, side: NEUTRAL_PARTY, originSide: "neutral", group, traits: minded() });
    const { run, by } = runOf([n("elder", 1), n("villager", 1), n("hermit", 2), hero("pc")], { [`${NEUTRAL_PARTY}#1`]: chain(["elder", "leader"]) });
    expect(commandOf(run, by("villager")).unit.id).toBe("elder");
    expect(commandOf(run, by("hermit"))).toBeNull();
  });

  test("a side with only a leaderId still has that leader (older plans)", () => {
    const spec = battle([goblin("chief"), goblin("grunt"), hero("pc")], { leadership: true });
    spec.sides.hostile.leaderId = "chief";
    const run = createRun(prepareBattle(spec, pf2eRules));
    expect(command(run, "hostile").unit.id).toBe("chief");
  });

  test("wanting to lead (a playstyle) makes no one a commander", () => {
    const pill = combinePlaystyles(["leader"]);
    const { run, by } = runOf([goblin("keen", { behavior: pill.behavior, desireStyle: pill.desire, playstyles: ["leader"] }), goblin("grunt"), hero("pc")], {});
    expect(commandOf(run, by("grunt"))).toBeNull();
    expect(pill.behavior.leads).toBeUndefined();
  });
});

describe("following the commander", () => {
  test("a boss's lead is taken more readily, by the Boss influence; Leader influence scales it all (0: nobody follows)", () => {
    const at = (role, options) => {
      const { run, by } = runOf([goblin("head"), goblin("grunt", { traits: minded(30) }), hero("pc")], { hostile: chain(["head", role]) }, options);
      return followChance(run, by("grunt")).raw;
    };
    expect(at("boss", { bossInfluence: 2 })).toBeCloseTo(2 * at("leader", {}), 6);
    expect(at("boss", { bossInfluence: 3 })).toBeCloseTo(3 * at("leader", {}), 6);
    expect(at("leader", { leaderInfluence: 100 })).toBeCloseTo(2 * at("leader", { leaderInfluence: 50 }), 6);
    expect(at("leader", { leaderInfluence: 0 })).toBe(0);
  });

  test("it wants the topmost thing its commander wants that it can actually do", () => {
    const { run, by } = runOf([goblin("chief"), goblin("grunt", { traits: minded(95) }), goblin("hurt"), hero("pc")], { hostile: chain(["chief", "leader"]) }, { leaderInfluence: 100 });
    const chief = by("chief");
    const grunt = by("grunt");
    // The chief would rather heal a friend first; the grunt can't heal, so it takes up the chief's next wish.
    chief.lastDesires = [{ kind: "heal", targetId: "hurt", level: 80 }, { kind: "hurt", targetId: "pc", level: 60 }];
    by("hurt").hp = 5;
    initDesires(grunt);
    run.rng = { chance: () => true, next: () => 0 };
    follow(run, grunt);
    listen(run, grunt, { canHeal: false });
    expect(grunt.following).toMatchObject({ id: "chief" });
    expect(levelOf(grunt, "heal", "hurt")).toBe(0);
    expect(levelOf(grunt, "hurt", "pc")).toBeGreaterThan(30);
  });

  test("following, its playstyle leans toward its commander's for the turn", () => {
    const cruel = combinePlaystyles(["cruel"]);
    const { run, by } = runOf([goblin("chief", { desireStyle: cruel.desire, behavior: cruel.behavior }), goblin("grunt"), hero("pc")], { hostile: chain(["chief", "boss"]) });
    const grunt = by("grunt");
    run.rng = { chance: () => true, next: () => 0 };
    follow(run, grunt);
    expect(styleOf(grunt).hurt.weakest).toBeGreaterThan(0);
    expect(styleOf(grunt).hurt.weakest).toBeLessThan(cruel.desire.hurt.weakest);
    expect(grunt.turnBehavior.finishDowned).toBeGreaterThan(0);
    // Not following: its own again.
    run.rng = { chance: () => false, next: () => 0.99 };
    follow(run, grunt);
    expect(styleOf(grunt).hurt.weakest ?? 0).toBe(0);
  });
});

describe("the story of who's in charge", () => {
  test("a lieutenant takes command when the boss falls, and the statistician and the story tell it", () => {
    const boss = goblin("boss", { name: "Boss", hp: { value: 1, max: 30 } });
    const spec = { ...battle([boss, goblin("lt", { name: "Lieutenant", hp: { value: 200, max: 200 } }), hero("pc", { initiative: { mod: 50 }, actions: [strike({ bonus: 30, damage: [parseFormula("20", "slashing")] })] })], { leadership: true, maxRounds: 2 }),
      command: { hostile: chain(["boss", "boss"], ["lt", "lieutenant"]) } };
    const r = replay(spec, pf2eRules, 3);
    const took = r.log.find(e => e.type === "command");
    expect(took).toMatchObject({ actor: "Lieutenant", from: "Boss", role: "lieutenant 1" });
    expect(buildStory(r, spec, "statistician").text).toContain(text("FASTFIGHTING.Log.CommandTakes", {
      actor: "Lieutenant", role: text("FASTFIGHTING.Log.RoleLieutenant", { n: 1 }), from: text("FASTFIGHTING.Log.CommandFrom", { name: "Boss" })
    }));
    expect(buildStory(r, spec, "roleplay", { tables, seed: 3 }).text).not.toMatch(/\{\w+\}/);
  });

  test("taking command is its own moment, the new commander's, not part of whoever's turn is starting", () => {
    const boss = goblin("boss", { name: "Boss", hp: { value: 1, max: 30 } });
    const spec = { ...battle([boss, goblin("lt", { name: "Lieutenant", hp: { value: 200, max: 200 } }), hero("pc", { initiative: { mod: 50 }, actions: [strike({ bonus: 30, damage: [parseFormula("20", "slashing")] })] })], { leadership: true, maxRounds: 2 }),
      command: { hostile: chain(["boss", "boss"], ["lt", "lieutenant"]) } };
    const r = replay(spec, pf2eRules, 3);
    const took = r.log.find(e => e.type === "command");
    expect(took.turnOf).toBe("lt");
    // (Nothing else is told in that moment: the next turn starts afresh.)
    expect(r.log.filter(e => e.turn === took.turn).every(e => e === took)).toBe(true);
  });
});
