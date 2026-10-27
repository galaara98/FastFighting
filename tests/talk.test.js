import { describe, expect, test } from "vitest";
import { runBatchSync, replay, prepareBattle, beginRun } from "../scripts/engine/simulator.js";
import { createRun } from "../scripts/engine/battle-state.js";
import { stepsToConvince, talkDC, talkAffinity, shareLanguage, foesKnown, movedThisTurn, resolveTalk, bestPitch, choosePitch, inEarshot, TALK_FEET } from "../scripts/engine/behavior/talk.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle, social as talkData } from "./helpers.js";

const social = (over = {}) => talkData({ diplomacy: 3, intimidation: 3, deception: 3, ...over });

const talker = (over = {}) => creature({
  id: "talker", kind: "pc", diesAtZero: false,
  social: social({ diplomacy: 12, intimidation: 10, deception: 8 }),
  actions: [strike({ bonus: 2, damage: [parseFormula("1d4", "bludgeoning")] })],
  ...over
});
const bandit = (over = {}) => creature({ id: "bandit", side: "hostile", social: social(), ...over });

describe("talk: who and how hard", () => {
  test("a shared language is required", () => {
    const run = createRun(prepareBattle(battle([talker(), bandit()]), pf2eRules));
    expect(shareLanguage(run.units[0], run.units[1])).toBe(true);
    const run2 = createRun(prepareBattle(battle([talker(), bandit({ social: social({ languages: ["draconic"] }) })]), pf2eRules));
    expect(shareLanguage(run2.units[0], run2.units[1])).toBe(false);
  });

  test("several steps unless very gullible", () => {
    const run = createRun(prepareBattle(battle([
      talker(),
      bandit({ id: "normal" }),
      bandit({ id: "gullible", social: social({ gullible: true }) }),
      bandit({ id: "stalwart", defenses: { ac: 16, will: 14 }, traits: { loyal: { base: 90, fudge: 0 }, brave: { base: 90, fudge: 0 } } })
    ]), pf2eRules));
    const [, normal, gullible, stalwart] = run.units;
    expect(stepsToConvince(normal)).toBeGreaterThanOrEqual(2);
    expect(stepsToConvince(gullible)).toBe(1);
    expect(stepsToConvince(stalwart)).toBeGreaterThan(stepsToConvince(normal));
  });

  test("hurting someone or failing to convince them raises the DC", () => {
    const run = createRun(prepareBattle(battle([talker(), bandit()]), pf2eRules));
    const [t, b] = run.units;
    const base = talkDC(run, t, b, "diplomacy");
    b.harmedBy.set(t.id, 8);
    const hurt = talkDC(run, t, b, "diplomacy");
    b.rebuffed.set(t.id, 1);
    const rebuffed = talkDC(run, t, b, "diplomacy");
    expect(hurt).toBeGreaterThanOrEqual(base + 5);
    expect(rebuffed).toBeGreaterThan(hurt);
  });

  test("diplomats and smooth talkers have high talk affinity; mindless have none", () => {
    expect(talkAffinity({ level: 1, social: social({ diplomacy: 12 }), playstyles: []  }, null, pf2eRules)).toBeGreaterThan(0.75);
    expect(talkAffinity({ level: 1, social: social({ diplomacy: 2 }), playstyles: ["diplomat"]  }, null, pf2eRules)).toBeGreaterThan(0.6);
    expect(talkAffinity({ level: 1, social: social({ mindless: true })  }, null, pf2eRules)).toBe(0);
  });
});

describe("talk in the simulation", () => {
  test("a smooth talker can end a fight without violence", () => {
    const spec = battle([talker(), bandit({ originSide: "neutral" })]);
    const r = runBatchSync(spec, pf2eRules, { runs: 600 });
    expect(r.pAnySwayed).toBeGreaterThan(0.25);
    expect(r.combatants.bandit.pTalkedDown).toBeGreaterThan(0.25);
  });

  test("talkers start swaying on their very first turn", () => {
    const r = replay(battle([talker(), bandit()]), pf2eRules, 21);
    const first = r.log.find(e => e.actor === "talker" && e.round === 1 && e.type !== "thought");
    expect(first.type).toBe("talk");
  });

  test("weak fighters talk twice a turn", () => {
    const meek = talker({ actions: [strike({ bonus: -2, damage: [parseFormula("1", "bludgeoning")] })] });
    const fighter = creature({ id: "fighter", kind: "pc", diesAtZero: false, actions: [strike({ bonus: 12, damage: [parseFormula("2d8+6", "slashing")] })] });
    // A critical failure ends the conversation, so look across a few fights.
    let most = 0;
    for ( let seed = 1; seed <= 10; seed++ ) {
      const r = replay(battle([meek, fighter, bandit({ hp: { value: 300, max: 300 } })], { maxRounds: 1 }), pf2eRules, seed);
      const talks = r.log.filter(e => e.actor === "talker" && e.round === 1 && e.type === "talk");
      most = Math.max(most, talks.length);
    }
    expect(most).toBe(2);
  });

  test("only a successful pitch convinces anyone", () => {
    for ( let seed = 1; seed <= 40; seed++ ) {
      const r = replay(battle([talker(), bandit({ originSide: "neutral" })]), pf2eRules, seed);
      for ( let i = 0; i < r.log.length; i++ ) {
        const e = r.log[i];
        // Talked into surrendering, switching sides or leaving: the pitch before it was a success.
        if ( e.type === "sway" && !e.recruit && ["surrendered", "switched", "fled"].includes(e.outcome) ) {
          const pitch = [...r.log.slice(0, i)].reverse().find(x => x.type === "talk");
          expect(pitch.degree).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  test("hidden ambushers can't be talked to until they attack", () => {
    const r = replay(battle([talker(), bandit({ hidden: true, actions: [strike({ bonus: -30 })] })], { maxRounds: 1 }), pf2eRules, 2);
    const firstTalk = r.log.findIndex(e => e.actor === "talker" && e.type === "talk");
    const firstAttack = r.log.findIndex(e => e.actor === "bandit" && ["attack", "save", "auto", "control"].includes(e.type));
    expect(firstTalk === -1 || (firstAttack !== -1 && firstAttack < firstTalk)).toBe(true);
  });

  test("no shared language, no talking; turning it off disables it", () => {
    const deaf = runBatchSync(battle([talker(), bandit({ social: social({ languages: ["aklo"] }) })]), pf2eRules, { runs: 200 });
    expect(deaf.pAnySwayed).toBe(0);
    const off = runBatchSync(battle([talker(), bandit()], { talking: false }), pf2eRules, { runs: 200 });
    expect(off.pAnySwayed).toBe(0);
  });

  test("neutrals fighting for a side are talked back to taking no side far more often than hostiles", () => {
    const n = runBatchSync(battle([talker(), bandit({ originSide: "neutral" })]), pf2eRules, { runs: 800 });
    const h = runBatchSync(battle([talker(), bandit({ originSide: "hostile" })]), pf2eRules, { runs: 800 });
    expect(n.combatants.bandit.pNeutral).toBeGreaterThan(h.combatants.bandit.pNeutral);
    // An enemy only ever stands aside: nobody switches straight over.
    expect(n.combatants.bandit.pSwitched).toBe(0);
  });
});

describe("languages set aside", () => {
  test("with languages ignored, anyone who speaks one understands anyone else who does (but not a beast)", () => {
    const run = createRun(prepareBattle(battle([talker(), bandit({ social: social({ languages: ["draconic"] }) }), bandit({ id: "wolf", social: social({ languages: [] }) })], { ignoreLanguages: true }), pf2eRules));
    const [t, drake, wolf] = run.units;
    expect(shareLanguage(t, drake)).toBe(false); // (without the run's options: as written)
    expect(shareLanguage(t, drake, run)).toBe(true);
    expect(shareLanguage(t, wolf, run)).toBe(false);
  });

  test("off by default: a fight with no shared language still has no talking", () => {
    const r = runBatchSync(battle([talker(), bandit({ social: social({ languages: ["aklo"] }) })]), pf2eRules, { runs: 200 });
    expect(r.pAnySwayed).toBe(0);
    const on = runBatchSync(battle([talker(), bandit({ social: social({ languages: ["aklo"] }) })], { ignoreLanguages: true }), pf2eRules, { runs: 200 });
    expect(on.pAnySwayed).toBeGreaterThan(0);
  });
});

describe("talk: what's fair in a crowded fight", () => {
  const wall = (ax, ay, bx, by) => ({ a: [ax, ay], b: [bx, by], s: 20, d: 0, door: null, open: false });
  const at = (x, y = 0) => ({ position: { x, y, size: 5 } });

  test("outnumbered: by the foes it knows of, not a third side it can't see", () => {
    // (The talker and the bandit face to face; two beasts of a third side far off behind a wall, out of earshot.)
    const sides = { friendly: { label: "Party", enemies: ["hostile", "hostile2"] }, hostile: { label: "Bandits", enemies: ["friendly", "hostile2"] }, hostile2: { label: "Beasts", enemies: ["friendly", "hostile"] } };
    const beasts = [creature({ id: "b1", side: "hostile2", ...at(400, 0) }), creature({ id: "b2", side: "hostile2", ...at(400, 10) })];
    const set = (walls, far) => {
      const spec = battle([talker(at(0)), bandit(at(10)), ...far], { positioning: true }, sides);
      spec.walls = walls;
      return createRun(prepareBattle(spec, pf2eRules));
    };
    const alone = set([], []);
    const hidden = set([wall(200, -100, 200, 100)], beasts);
    const seen = set([], beasts.map(b => ({ ...b, position: { ...b.position, x: 40 } })));
    const show = run => {
      const [t, b] = run.units;
      return [foesKnown(run, b).length, stepsToConvince(b, run, t), talkDC(run, t, b, "persuade")];
    };
    expect(show(hidden)).toEqual(show(alone));
    // (In plain sight, three foes against one: outnumbered.)
    const [known, steps, dc] = show(seen);
    expect(known).toBe(3);
    expect(steps).toBe(show(alone)[1] - 1);
    expect(dc).toBe(show(alone)[2] - 2);
    // (One that hurt it counts, wherever it is.)
    const [, b] = hidden.units;
    b.harmedBy.set("b1", 3);
    expect(foesKnown(hidden, b).map(o => o.id)).toEqual(["talker", "b1"]);
  });

  test("one step a turn from each talker: a second success at it that turn adds nothing, and its next pitch goes elsewhere", () => {
    // (A stalwart bandit: three steps or more, outnumbered as it is, so the track has room to fill.)
    const stalwart = bandit({ hp: { value: 300, max: 300 }, traits: { loyal: { base: 90, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, tactical: { base: 50, fudge: 0 } } });
    const run = beginRun(prepareBattle(battle([talker(), creature({ id: "friend", kind: "pc", diesAtZero: false, social: social({ diplomacy: 12 }) }), stalwart]), pf2eRules), 3, { log: false });
    const [t, friend, b] = ["talker", "friend", "bandit"].map(id => run.byId.get(id));
    expect(stepsToConvince(b, run, t)).toBeGreaterThanOrEqual(3);
    const pitch = { ...bestPitch(run, t, b), target: b };
    const say = () => {};
    resolveTalk(run, t, pitch, { degree: 2, natural: 15, total: 25 }, say);
    expect(b.sway.get(t.side)).toBe(1);
    expect(movedThisTurn(b, t)).toBe(true);
    resolveTalk(run, t, pitch, { degree: 2, natural: 15, total: 25 }, say);
    expect(b.sway.get(t.side)).toBe(1);
    expect(choosePitch(run, t)).toBeNull();
    // (Another talker of the side fills the same track, in its own turn.)
    resolveTalk(run, friend, { ...bestPitch(run, friend, b), target: b }, { degree: 2, natural: 15, total: 25 }, say);
    expect(b.sway.get(t.side)).toBe(2);
    // (The talker's next turn: a step again; a critical success still counts twice.)
    t.turnsTaken += 1;
    expect(movedThisTurn(b, t)).toBe(false);
    expect(choosePitch(run, t)?.target).toBe(b);
    const before = b.sway.get(t.side);
    resolveTalk(run, t, pitch, { degree: 3, natural: 20, total: 35 }, say);
    expect(b.sway.get(t.side) === before + 2 || b.swayOutcome).toBeTruthy();
  });
});

describe("earshot", () => {
  const at = (x, y = 0) => ({ x, y, size: 5 });
  const wall = (ax, ay, bx, by) => ({ a: [ax, ay], b: [bx, by], s: 20, d: 0, door: null, open: false });
  const set = (foeAt, { walls = null, rules = pf2eRules } = {}) => {
    const spec = battle([
      creature({ id: "talker", side: "hostile", position: at(0), social: talkData({ diplomacy: 20, intimidation: 20, deception: 20 }) }),
      creature({ id: "foe", position: foeAt, social: talkData({ diplomacy: 0 }) })
    ], { positioning: true });
    if ( walls ) spec.walls = walls;
    const run = createRun(prepareBattle(spec, rules));
    return { run, talker: run.byId.get("talker"), foe: run.byId.get("foe") };
  };

  test("words reach only so far (rules.talkFeet, else 30 feet), and not through a wall", () => {
    let s = set(at(25));
    expect(inEarshot(s.run, s.talker, s.foe)).toBe(true);
    s = set(at(90));
    expect(inEarshot(s.run, s.talker, s.foe)).toBe(false);
    expect(choosePitch(s.run, s.talker)).toBe(null);
    s = set(at(90), { rules: { ...pf2eRules, talkFeet: 120 } });
    expect(inEarshot(s.run, s.talker, s.foe)).toBe(true);
    s = set(at(25), { walls: [wall(12.5, -20, 12.5, 20)] });
    expect(inEarshot(s.run, s.talker, s.foe)).toBe(false);
    expect(TALK_FEET).toBe(30);
  });
});
