import { describe, expect, test } from "vitest";
import { runBatchSync, replay, prepareBattle } from "../scripts/engine/simulator.js";
import { createRun } from "../scripts/engine/battle-state.js";
import { opensWithTalk } from "../scripts/engine/behavior/standoff.js";
import { talkAffinity } from "../scripts/engine/behavior/talk.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle, social } from "./helpers.js";

const COINS = [{ label: "gp", value: 100 }, { label: "sp", value: 10 }, { label: "cp", value: 1 }];
const traits = (brave, selfish = 40) => ({ tactical: { base: 50, fudge: 0 }, brave: { base: brave, fudge: 0 }, selfish: { base: selfish, fudge: 0 }, loyal: { base: 50, fudge: 0 } });

/** A toll on the road: a smooth-talking bandit chief and a lone traveller with a purse (or a pack). */
function toll({ money = 5000, stowed = [], talk = "opportune", chiefAlways = false } = {}) {
  const traveller = creature({
    id: "pc", name: "Kyra", kind: "pc", diesAtZero: false, traits: traits(30),
    social: social({ diplomacy: 2, intimidation: 2, deception: 2, willDC: 12, perceptionDC: 12 }), tactics: { talk },
    valuables: { money, denominations: COINS, stowed, wielded: [{ id: "sword", name: "Longsword", value: 1500 }] }
  });
  const chief = creature({
    id: "chief", name: "Bandit Chief", side: "hostile", alwaysTalk: chiefAlways, tactics: { talk: "first" },
    social: social({ diplomacy: 14, intimidation: 14, deception: 10 })
  });
  const spec = battle([traveller, chief], { maxRounds: 10, opening: "talk" });
  spec.sides.hostile.leaderId = "chief";
  return spec;
}

const fights = (spec, n = 120) => [...Array(n).keys()].map(s => replay(spec, pf2eRules, s + 1));

describe("a PC who won't listen", () => {
  test("a PC who lets weapons do the talking won't be talked into anything", () => {
    for ( const r of fights(toll({ talk: "never" }), 60) ) {
      expect(r.log.some(e => e.type === "talk" && e.targetId === "pc")).toBe(false);
      expect(r.log.some(e => e.type === "sway" && e.actorId === "pc")).toBe(false);
    }
  });
});

describe("always prefers talking to fighting", () => {
  const mumbler = (extra = {}) => creature({ id: "m", side: "hostile", social: social({ diplomacy: 0, intimidation: 0, deception: 0 }), ...extra });

  test("it makes even a poor talker keen, and only a little keener when staying true", () => {
    const plain = talkAffinity(mumbler().spec ?? mumbler(), { tactical: 50 }, pf2eRules);
    const keen = talkAffinity({ ...mumbler(), alwaysTalk: true }, { tactical: 50 }, pf2eRules);
    const steady = talkAffinity({ ...mumbler(), alwaysTalk: true, stayTrue: true }, { tactical: 50 }, pf2eRules);
    expect(keen).toBeGreaterThanOrEqual(0.85);
    expect(steady - plain).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(steady).toBeGreaterThan(plain);
  });

  test("it's a vote to open with a standoff", () => {
    const pc = creature({ id: "pc", kind: "pc", diesAtZero: false, tactics: { talk: "opportune" }, social: social({ diplomacy: 2 }) });
    const foe = creature({ id: "foe", side: "hostile", tactics: { talk: "opportune" }, social: social({ diplomacy: 2 }) });
    const open = extra => {
      const run = createRun(prepareBattle(battle([{ ...pc, ...extra }, { ...foe, ...extra }], {}), pf2eRules));
      for ( const u of run.units ) u.tac = u.spec.tactics;
      return opensWithTalk(run);
    };
    expect(open({})).toBe(false);
    expect(open({ alwaysTalk: true })).toBe(true);
  });
});

describe("a charismatic leader's last word", () => {
  test("before a standoff breaks, the chief may press the party once more", () => {
    // An impatient second bandit tends to break the standoff; the chief steps in first.
    const spec = toll();
    spec.combatants.push(creature({ id: "hothead", side: "hostile", playstyles: ["impatient", "cruel"], tactics: { talk: "never" }, social: social({ diplomacy: 0 }) }));
    const words = fights(spec, 150).filter(r => r.log.some(e => e.type === "lastWord"));
    expect(words.length).toBeGreaterThan(0);
    for ( const r of words ) expect(r.log.filter(e => e.type === "lastWord").length).toBe(1);
    const r = runBatchSync(spec, pf2eRules, { runs: 200 });
    expect(r.pPeaceful).toBeGreaterThan(0);
  });
});

describe("a grudge against whoever took from it", () => {
  test("they fear the taker until the taker attacks them, then want only the taker", async () => {
    const { chooseTarget } = await import("../scripts/engine/behavior/targeting.js");
    const giver = creature({ id: "g", kind: "pc", diesAtZero: false });
    const taker = creature({ id: "t", side: "hostile" });
    const other = creature({ id: "o", side: "hostile" });
    const run = createRun(prepareBattle(battle([giver, taker, other]), pf2eRules));
    run.rng = { next: () => 0.5, chance: () => false, pick: l => l[0], shuffle: l => l, d20: () => 10, die: () => 1 };
    const g = run.byId.get("g");
    g.grudges = new Map([["t", { provoked: false }]]);
    for ( let i = 0; i < 5; i++ ) expect(chooseTarget(run, g)?.id).toBe("o");
    g.grudges.get("t").provoked = true;
    expect(chooseTarget(run, g)?.id).toBe("t");
  });
});
