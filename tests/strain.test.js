import { describe, expect, test } from "vitest";
import { replay, prepareBattle } from "../scripts/engine/simulator.js";
import { createRun } from "../scripts/engine/battle-state.js";
import { createRng } from "../scripts/engine/rng.js";
import { attemptTalk } from "../scripts/engine/behavior/talk.js";
import { strainOf } from "../scripts/engine/behavior/strain.js";
import { buildStory } from "../scripts/story/story.js";
import { logLine } from "../scripts/story/log-lines.js";
import { storyTables } from "./foundry-i18n.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle, social as talkData } from "./helpers.js";

const english = storyTables();
const tables = { get: k => english[k] };
const social = (over = {}) => talkData({ diplomacy: 3, intimidation: 3, deception: 3, ...over });
const composure = { pool: "composure", label: "Composure" };

const talker = (over = {}) => creature({
  id: "talker", name: "Talker", kind: "pc", diesAtZero: false, resources: { composure: 3 },
  social: { ...social({ diplomacy: 12, intimidation: 10, deception: 8 }), strain: composure },
  actions: [strike({ bonus: 2, damage: [parseFormula("1d4", "bludgeoning")] })],
  ...over
});
const bandit = (over = {}) => creature({ id: "bandit", name: "Bandit", side: "hostile", resources: { composure: 3 }, social: { ...social(), strain: composure }, ...over });

/** One pitch, as sure to land (or to fail) as the dice allow: the log entries it made. */
function pitch(spec, mod, rules = pf2eRules) {
  const run = createRun(prepareBattle(spec, rules));
  run.rng = createRng(7);
  run.log = [];
  const log = (u, d) => run.log.push({ actor: u.spec.name, actorId: u.id, ...d });
  const [t, b] = run.units;
  attemptTalk(run, t, { target: b, kind: "persuade", skill: "Diplomacy", mod, dc: 20, dcLabel: "Will" }, log);
  return { run, t, b, talk: run.log.find(e => e.type === "talk"), strained: run.log.filter(e => e.type === "strain") };
}

describe("strain: words that wear a creature down", () => {
  test("a pitch that fails costs the talker (twice on a critical failure); the one it talked to pays nothing", () => {
    const { t, b, talk, strained } = pitch(battle([talker(), bandit()]), -100);
    const lost = talk.degree === 0 ? 2 : 1;
    expect(t.resources.composure).toBe(3 - lost);
    expect(b.resources.composure).toBe(3);
    expect(strained).toMatchObject([{ actorId: "talker", targetId: "bandit", lost, left: 3 - lost, empty: false }]);
  });

  test("a pitch that gets through costs the one it's aimed at (twice on a critical success)", () => {
    const { t, b, talk, strained } = pitch(battle([talker(), bandit()]), 100);
    const lost = talk.degree === 3 ? 2 : 1;
    expect(b.resources.composure).toBe(3 - lost);
    expect(t.resources.composure).toBe(3);
    expect(strained[0]).toMatchObject({ actorId: "bandit", lost });
  });

  test("run dry, it's worn down: the outcome the system says lands on it", () => {
    const worn = { ...composure, empty: { conditions: { frightened: 1 }, rounds: 2 } };
    const { b, strained } = pitch(battle([talker(), bandit({ resources: { composure: 1 }, social: { ...social(), strain: worn } })]), 100);
    expect(b.resources.composure).toBe(0);
    expect(b.conds.frightened).toBeGreaterThan(0);
    expect(strained[0]).toMatchObject({ empty: true, conditions: ["frightened"] });
  });

  test("for everyone, by the system (rules.talkStrain); a creature's own settings win; no pool, nothing lost", () => {
    const rules = { ...pf2eRules, talkStrain: { pool: "focus", amount: 1, crit: 1 } };
    const plain = pitch(battle([talker({ social: social({ diplomacy: 12 }), resources: { focus: 2 } }), bandit({ social: social() })]), -100, rules);
    expect(plain.t.resources.focus).toBe(1);
    expect(strainOf(plain.run, plain.b)).toMatchObject({ pool: "focus", amount: 1, crit: 1 });
    expect(strainOf(plain.run, plain.t).label).toBe("focus");
    const own = pitch(battle([talker(), bandit()]), -100, rules);
    expect(own.t.resources.composure).toBeLessThan(3); // (its own composure, not the system's focus)
    const none = pitch(battle([talker({ social: social({ diplomacy: 12 }), resources: {} }), bandit({ social: social() })]), -100, rules);
    expect(none.strained).toEqual([]);
    const off = pitch(battle([talker({ social: social({ diplomacy: 12 }) }), bandit({ social: social() })]), -100);
    expect(off.strained).toEqual([]);
  });

  test("the log and the story tell it", () => {
    let told = 0;
    for ( let seed = 1; seed <= 40 && told < 3; seed++ ) {
      const spec = battle([talker(), bandit()], { maxRounds: 3 });
      const r = replay(spec, pf2eRules, seed);
      const e = r.log.find(x => x.type === "strain");
      if ( !e ) continue;
      told += 1;
      expect(logLine(e)).toContain("Composure");
      const text = buildStory(r, spec, "roleplay", { tables, seed }).text;
      const key = e.empty ? "event.strainEmpty" : "event.strain";
      expect(english[key].some(l => text.includes(l.replace("{actor}", e.actor).replace("{target}", e.target).split(" ").slice(0, 3).join(" ")))).toBe(true);
    }
    expect(told).toBeGreaterThan(0);
  });
});
