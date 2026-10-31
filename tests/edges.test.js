import { describe, expect, test } from "vitest";
import { replay, prepareBattle, shareChance } from "../scripts/engine/simulator.js";
import { createRun, boostBonus, modsAgainst, checkRoll, studyBonus } from "../scripts/engine/battle-state.js";
import { applyOutcome, spendEdges } from "../scripts/engine/behavior/effects.js";
import { bestPitch } from "../scripts/engine/behavior/talk.js";
import { degreeDistribution } from "../scripts/engine/probability.js";
import { buildStory, storyBeats } from "../scripts/story/story.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";
import { storyTables, text } from "./foundry-i18n.js";
import { logLine, loreLine } from "../scripts/story/log-lines.js";
import { bestAndWorst } from "../scripts/engine/aptitudes.js";

/** A roll as the log writes it ("d20 12 +30 = 42 vs DC 15"). */
const rollText = (c, label = text("FASTFIGHTING.Log.DC")) => text("FASTFIGHTING.Log.Roll", { faces: 20, natural: c.natural, mod: c.mod >= 0 ? `+${c.mod}` : c.mod, total: c.total, label, dc: c.dc });
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { genericRules } from "../scripts/adapters/generic/rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle, social } from "./helpers.js";

const english = storyTables();
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
    const line = logLine(given);
    expect(buildStory(r, spec, "statistician").text).toContain(line);
    for ( const piece of ["helper", "f1", "Aid", "aided", rollText({ ...given.check, dc: 15 }), text("FASTFIGHTING.Log.Degree3"), text("FASTFIGHTING.Log.BuffAgainst", { names: "ogre" })] ) {
      expect(line).toContain(piece);
    }
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

  test("a critical success says, for everyone, what the foe is best at and worst at (none on a plain success)", () => {
    const brute = () => ogre("ogre", { aptitudes: { smart: 0, strong: 4, fast: 2, wise: 2, charismatic: 1 } });
    let crits = 0;
    for ( let seed = 1; seed <= 12; seed++ ) {
      const spec = battle([fighter("s", { behavior: { study: 1 }, initiative: { mod: 50 }, sizeUp: { mod: 15, dc: 20, label: "Recall Knowledge" } }), brute()], { maxRounds: 1 });
      const r = replay(spec, pf2eRules, seed);
      const study = r.log.find(e => e.type === "study" && e.actorId === "s");
      const lore = r.log.filter(e => e.type === "lore");
      if ( study.check.degree !== 3 ) {
        expect(lore).toHaveLength(0);
        continue;
      }
      crits += 1;
      expect(lore).toHaveLength(1);
      expect(lore[0]).toMatchObject({ actorId: "s", targetId: "ogre", best: { key: "strong", band: 4 }, worst: { key: "smart", band: 0 } });
      // (Told for everyone, in a live battle's story in every style, not among the GM's lines; in the planner's story too.)
      for ( const style of ["roleplay", "standard", "statistician"] ) {
        const beats = storyBeats(r, spec, style, { tables, seed: 3 });
        expect(beats.some(b => b.html.includes(text("FASTFIGHTING.Aptitude.strong.4")))).toBe(true);
        expect(beats.some(b => b.gmHtml.includes(text("FASTFIGHTING.Aptitude.strong.4")))).toBe(false);
      }
      expect(buildStory(r, spec, "statistician").text).toContain(text("FASTFIGHTING.Aptitude.strong.4"));
    }
    expect(crits).toBeGreaterThan(0);
    expect(crits).toBeLessThan(12);
  });

  test("best and worst in words; ties go by the pair, without the fight's dice; one alike in everything, said once", () => {
    const u = { spec: { aptitudes: { smart: 3, strong: 1, fast: 3, wise: 1, charismatic: 2 } } };
    const picks = new Set();
    for ( const salt of ["a|b", "a|c", "b|c", "x|y", "q|r"] ) {
      const { best, worst } = bestAndWorst(u, salt);
      expect([best.band, worst.band]).toEqual([3, 1]);
      expect(["smart", "fast"]).toContain(best.key);
      expect(["strong", "wise"]).toContain(worst.key);
      expect(bestAndWorst(u, salt)).toEqual({ best, worst });
      picks.add(best.key);
    }
    expect(picks.size).toBe(2);
    const e = { actor: "s", target: "ogre", ...bestAndWorst(u, "a|b") };
    expect(loreLine(e)).toBe(text("FASTFIGHTING.Story.Lore", { actor: "s", target: "ogre", best: text(`FASTFIGHTING.Aptitude.${e.best.key}.3`), worst: text(`FASTFIGHTING.Aptitude.${e.worst.key}.1`) }));
    const even = bestAndWorst({ spec: { aptitudes: { smart: 2, strong: 2, fast: 2, wise: 2, charismatic: 2 } } }, "a|b");
    expect(even.best).toEqual(even.worst);
    expect(loreLine({ actor: "s", target: "ogre", ...even })).toBe(text("FASTFIGHTING.Story.LoreEven", { actor: "s", target: "ogre", trait: text(`FASTFIGHTING.Aptitude.${even.best.key}.2`) }));
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
    expect(buildStory(r, spec, "statistician").text).toContain(text("FASTFIGHTING.Log.Observe", { actor: "lore", targets: "bandit" }));
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

describe("a system's own payoff for sizing up", () => {
  test("one roll's worth, at anyone, as the system says (Ironsworn: 25% likelier)", () => {
    const scholar = fighter("s", { behavior: { study: 1 }, initiative: { mod: 50 }, sizeUp: { mod: 40, dc: 10, label: "Secure an Advantage", boost: 1.25, uses: 1, anyFoe: true } });
    const spec = battle([scholar, ogre("a"), ogre("b")], { maxRounds: 2 });
    const r = replay(spec, pf2eRules, 5);
    const study = r.log.find(e => e.type === "study" && e.actorId === "s");
    expect(study).toMatchObject({ worked: true, factor: 1.25, oneRoll: true, anyFoe: true });
    const boosted = r.log.filter(e => e.type === "attack" && e.actorId === "s" && e.boost > 0);
    expect(boosted).toHaveLength(1); // the next roll only
    const line = logLine(study);
    expect(buildStory(r, spec, "statistician").text).toContain(line);
    for ( const piece of ["Secure an Advantage", rollText({ ...study.check, dc: 10 }), text("FASTFIGHTING.Log.NextRoll", { against: "", factor: 1.25, target: study.target })] ) {
      expect(line).toContain(piece);
    }
  });
});

describe("what sizing up teaches holds for the foe's sort", () => {
  test("one goblin warrior sized up is all of them: one turn, and the payoff against any of them", () => {
    const scholar = fighter("s", { behavior: { study: 1 }, initiative: { mod: 50 }, sizeUp: { mod: 40, dc: 10, label: "Recall Knowledge" } });
    const warrior = n => ogre(`w${n}`, { name: `Goblin Warrior ${n}`, hp: { value: 30, max: 30, temp: 0 } });
    const spec = battle([scholar, warrior(1), warrior(2), warrior(3)], { maxRounds: 3 });
    const r = replay(spec, pf2eRules, 5);
    const studies = r.log.filter(e => e.type === "study" && e.actorId === "s");
    expect(studies).toHaveLength(1);
    expect(studies[0].kin).toBe(2);
    const line = logLine(studies[0]);
    expect(buildStory(r, spec, "statistician").text).toContain(line);
    expect(line).toContain(text("FASTFIGHTING.Log.StudyKin", { kin: 2, target: studies[0].target }));
    expect(studies[0].target).toMatch(/^Goblin Warrior \d$/);
    // The boosted blows land on whichever warrior it fights.
    const boosted = r.log.filter(e => e.type === "attack" && e.actorId === "s" && e.boost > 0);
    expect(boosted.length).toBeGreaterThan(0);
  });
});

describe("a Lore-Collector leading its side shares what it learns", () => {
  const sage = (extra = {}) => fighter("sage", { behavior: { study: 1, share: 1 }, initiative: { mod: 50 }, sizeUp: { mod: 40, dc: 10 },
    social: social({ diplomacy: 2 }), traits: { tactical: { base: 70, fudge: 0 }, brave: { base: 60, fudge: 0 }, selfish: { base: 10, fudge: 0 }, loyal: { base: 90, fudge: 0 } }, ...extra });
  const ally = (id, languages = ["common"]) => fighter(id, { social: social({ diplomacy: 0, languages }) });
  const sides = leaderId => ({ friendly: { label: "Party", enemies: ["hostile"], leaderId }, hostile: { label: "Foes", enemies: ["friendly"] } });

  test("the leader spends an action telling the friends within a move who understand it; they know that sort too", () => {
    const at = (x, y = 0) => ({ x, y, size: 5 });
    const spec = battle([sage({ position: at(0), speeds: { walk: 25 } }), { ...ally("a1"), position: at(20) }, { ...ally("far"), position: at(0, 80) }, { ...ally("elf", ["elvish"]), position: at(10) },
      ogre("ogre", { position: at(5, 5), speeds: { walk: 0 } })], { maxRounds: 1, leadership: true, positioning: true }, sides("sage"));
    const r = replay(spec, pf2eRules, 4);
    const told = r.log.find(e => e.type === "shareLore");
    expect(told.with).toEqual(["a1"]); // (not one too far off to explain it to, nor one without a language in common)
    // Three actions: size it up, tell them, and one left to strike with.
    expect(r.log.filter(e => e.actorId === "sage" && e.type === "attack" && e.round === 1).length).toBeLessThanOrEqual(1);
    expect(told).toMatchObject({ actor: "sage", target: "ogre" });
    expect(buildStory(r, spec, "statistician").text).toContain(text("FASTFIGHTING.Log.ShareLore", {
      actor: "sage", allies: "a1", target: "ogre", chance: Number.isFinite(told.chance) ? text("FASTFIGHTING.Log.MindedToShare", { n: Math.round(told.chance * 100) }) : ""
    }));
    const prose = buildStory(r, spec, "roleplay", { tables, seed: 4 }).text;
    expect(prose).not.toMatch(/\{\w+\}/);
  });

  test("with one action a turn: sizing up takes this turn, telling the next", () => {
    const r = replay(battle([sage(), ally("a1"), ogre()], { maxRounds: 2, leadership: true }, sides("sage")), genericRules, 4);
    const mine = r.log.filter(e => e.actorId === "sage" && e.type !== "thought");
    expect(mine.find(e => e.round === 1)?.type).toBe("study");
    expect(mine.find(e => e.round === 2)?.type).toBe("shareLore");
    expect(mine.filter(e => e.round === 2 && e.type === "attack")).toHaveLength(0);
  });

  test("anyone else shares half as readily as the leader, unless it would rather talk than fight", () => {
    const chanceAs = (leaderId, extra = {}) => {
      const { run, by } = unitsOf(battle([sage(extra), ally("a1"), ogre()], { leadership: true }, sides(leaderId)));
      return shareChance(run, by("sage"));
    };
    const leading = chanceAs("sage");
    expect(chanceAs("a1")).toBeCloseTo(leading / 2, 6);
    expect(chanceAs("a1", { alwaysTalk: true })).toBeCloseTo(leading, 6);
    // And it does share, now and then, without leading.
    let shared = 0;
    for ( let seed = 1; seed <= 20; seed++ ) shared += replay(battle([sage(), ally("a1"), ogre()], { maxRounds: 1, leadership: true }, sides("a1")), pf2eRules, seed).log.filter(e => e.type === "shareLore").length;
    expect(shared).toBeGreaterThan(0);
    expect(shared).toBeLessThan(20);
  });
});

describe("every Lore-Collector chance is smaller the further down its pills it is", () => {
  test("sizing up, watching in a standoff, sharing: 1st, 2nd, 3rd, 4th pick", () => {
    const at = i => combinePlaystyles([...["cruel", "brawler", "skeptic"].slice(0, i), "loreCollector"]).behavior;
    const picks = [0, 1, 2, 3].map(at);
    for ( const key of ["study", "observe", "share"] ) {
      const values = picks.map(b => b[key]);
      for ( let i = 1; i < 4; i++ ) expect(values[i], `${key} at pick ${i + 1}`).toBeLessThan(values[i - 1]);
    }
    expect(picks.map(b => +b.study.toFixed(3))).toEqual([0.5, 0.375, 0.275, 0.2]);
  });
});

describe("not every leader likes to share", () => {
  test("the chance to share: the pill's, times how minded it is (loyal, unselfish, tactical, supportive pills)", () => {
    const leader = (traits, pills = ["loreCollector"]) => {
      const p = combinePlaystyles(pills);
      return fighter("lead", { traits, behavior: p.behavior, desireStyle: p.desire, social: social({ diplomacy: 2 }) });
    };
    const t = (tactical, loyal, selfish) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 60, fudge: 0 }, selfish: { base: selfish, fudge: 0 }, loyal: { base: loyal, fudge: 0 } });
    // (As its side's leader: anyone else, half as readily.)
    const chanceOf = spec => { const { run, by } = unitsOf(battle([spec, ogre()], { leadership: true }, { friendly: { label: "Party", enemies: ["hostile"], leaderId: "lead" }, hostile: { label: "Foes", enemies: ["friendly"] } })); return shareChance(run, by("lead")); };
    const generous = chanceOf(leader(t(70, 90, 10)));
    const average = chanceOf(leader(t(40, 50, 50)));
    const grasping = chanceOf(leader(t(40, 20, 90)));
    expect(generous).toBeGreaterThan(0.8);
    expect(average).toBeGreaterThan(0.3);
    expect(average).toBeLessThan(0.6);
    expect(grasping).toBeLessThan(0.05);
    // Supportive pills more, a mercenary less; and the further down the Lore-Collector pill, the less.
    expect(chanceOf(leader(t(40, 50, 50), ["loreCollector", "enabler"]))).toBeGreaterThan(average);
    expect(chanceOf(leader(t(40, 50, 50), ["loreCollector", "mercenary"]))).toBeLessThan(average);
    expect(chanceOf(leader(t(40, 50, 50), ["brawler", "loreCollector"]))).toBeLessThan(average);
  });

  test("a leader that keeps it to itself: the statistician says so", () => {
    const keeper = fighter("sage", { behavior: { study: 1, share: 1 }, initiative: { mod: 50 }, sizeUp: { mod: 40, dc: 10 }, social: social({ diplomacy: 2 }),
      traits: { tactical: { base: 40, fudge: 0 }, brave: { base: 60, fudge: 0 }, selfish: { base: 95, fudge: 0 }, loyal: { base: 10, fudge: 0 } } });
    const spec = battle([keeper, fighter("a1", { social: social({ diplomacy: 0 }) }), ogre()], { maxRounds: 1, leadership: true },
      { friendly: { label: "Party", enemies: ["hostile"], leaderId: "sage" }, hostile: { label: "Foes", enemies: ["friendly"] } });
    const r = replay(spec, pf2eRules, 4);
    expect(r.log.some(e => e.type === "shareLore")).toBe(false);
  });
});
