import { describe, expect, test } from "vitest";
import { runBatchSync, replay, prepareBattle } from "../scripts/engine/simulator.js";
import { createRun } from "../scripts/engine/battle-state.js";
import { stepsToConvince, talkDC, talkAffinity, shareLanguage } from "../scripts/engine/behavior/talk.js";
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
    expect(first.text).toMatch(/reasons with|threatens|bluffs/);
  });

  test("weak fighters talk twice a turn", () => {
    const meek = talker({ actions: [strike({ bonus: -2, damage: [parseFormula("1", "bludgeoning")] })] });
    const fighter = creature({ id: "fighter", kind: "pc", diesAtZero: false, actions: [strike({ bonus: 12, damage: [parseFormula("2d8+6", "slashing")] })] });
    // A critical failure ends the conversation, so look across a few fights.
    let most = 0;
    for ( let seed = 1; seed <= 10; seed++ ) {
      const r = replay(battle([meek, fighter, bandit({ hp: { value: 300, max: 300 } })], { maxRounds: 1 }), pf2eRules, seed);
      const talks = r.log.filter(e => e.actor === "talker" && e.round === 1 && /reasons with|threatens|bluffs/.test(e.text));
      most = Math.max(most, talks.length);
    }
    expect(most).toBe(2);
  });

  test("only a successful pitch convinces anyone", () => {
    for ( let seed = 1; seed <= 40; seed++ ) {
      const r = replay(battle([talker(), bandit({ originSide: "neutral" })]), pf2eRules, seed);
      for ( let i = 0; i < r.log.length; i++ ) {
        if ( /surrenders|switches sides|talked into leaving/.test(r.log[i].text) ) {
          const pitch = [...r.log.slice(0, i)].reverse().find(e => /reasons with|threatens|bluffs/.test(e.text));
          expect(pitch.text).toMatch(/wavering|badly shaken/);
        }
      }
    }
  });

  test("hidden ambushers can't be talked to until they attack", () => {
    const r = replay(battle([talker(), bandit({ hidden: true, actions: [strike({ bonus: -30 })] })], { maxRounds: 1 }), pf2eRules, 2);
    const order = r.log.map(e => e.actor + ":" + e.text);
    const firstTalk = order.findIndex(x => /^talker:.*(reasons with|threatens|bluffs)/.test(x));
    const firstAttack = order.findIndex(x => /^bandit:.*→/.test(x));
    expect(firstTalk === -1 || (firstAttack !== -1 && firstAttack < firstTalk)).toBe(true);
  });

  test("no shared language, no talking; turning it off disables it", () => {
    const deaf = runBatchSync(battle([talker(), bandit({ social: social({ languages: ["aklo"] }) })]), pf2eRules, { runs: 200 });
    expect(deaf.pAnySwayed).toBe(0);
    const off = runBatchSync(battle([talker(), bandit()], { talking: false }), pf2eRules, { runs: 200 });
    expect(off.pAnySwayed).toBe(0);
  });

  test("neutrals switch sides far more often than hostiles", () => {
    const n = runBatchSync(battle([talker(), bandit({ originSide: "neutral" })]), pf2eRules, { runs: 800 });
    const h = runBatchSync(battle([talker(), bandit({ originSide: "hostile" })]), pf2eRules, { runs: 800 });
    expect(n.combatants.bandit.pSwitched).toBeGreaterThan(h.combatants.bandit.pSwitched);
  });
});
