import { describe, expect, test } from "vitest";
import { runBatchSync, replay } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { buildStory } from "../scripts/story/story.js";
import { storyTables, en } from "./foundry-i18n.js";
import { creature, battle, social } from "./helpers.js";

const english = storyTables();
const tables = { get: k => english[k] };
const speaks = (extra = {}) => social({ diplomacy: 12, intimidation: 8, deception: 6, willDC: 16, perceptionDC: 16, ...extra });

/** A negotiator and a guard captain with a guard, and (to sour it) a hound that can't follow the talk. */
function meeting({ opening = "argument", hound = false } = {}) {
  const envoy = creature({ id: "envoy", name: "Seelah", kind: "pc", diesAtZero: false, social: speaks(), tactics: { talk: "first" } });
  const captain = creature({ id: "captain", name: "Captain", side: "hostile", social: speaks({ diplomacy: 6 }), tactics: { talk: "first" } });
  const guard = creature({ id: "guard", name: "Guard", side: "hostile", social: speaks({ diplomacy: 2 }) });
  const others = hound ? [creature({ id: "hound", name: "Hound", side: "hostile", social: null,
    traits: { tactical: { base: 10, fudge: 0 }, brave: { base: 70, fudge: 0 }, selfish: { base: 50, fudge: 0 }, loyal: { base: 50, fudge: 0 } } })] : [];
  const spec = battle([envoy, captain, guard, ...others], { maxRounds: 8, opening });
  spec.sides.hostile.leaderId = "captain";
  return spec;
}

const blows = log => log.filter(e => e.type === "attack" || e.type === "opportunity").length;

describe("only an argument", () => {
  test("it opens as a standoff, and nobody ever strikes a blow", () => {
    for ( let seed = 1; seed <= 40; seed++ ) {
      const r = replay(meeting({ hound: true }), pf2eRules, seed);
      expect(r.log.some(e => e.type === "standoff")).toBe(true);
      expect(blows(r.log)).toBe(0);
      // Settled with words, the talks collapsed (settling nothing), or they stalled.
      expect(r.peaceful || r.collapsed || r.outcome === "stalemate").toBe(true);
      if ( r.collapsed ) expect(r.peaceful).toBe(false);
    }
  });

  test("what would come to blows ends it instead: the talks collapse, nobody's the winner", () => {
    let collapsed = 0;
    for ( let seed = 1; seed <= 40; seed++ ) {
      const r = replay(meeting({ hound: true }), pf2eRules, seed);
      if ( !r.collapsed ) continue;
      collapsed++;
      expect(r.winners).toEqual([]);
      expect(r.log.some(e => e.type === "collapse")).toBe(true);
      expect(r.log.find(e => e.type === "end").resolved).toBe("collapsed");
    }
    expect(collapsed).toBeGreaterThan(0);
    // The same meeting opened for talk, but not only an argument: it comes to blows now and then.
    let fought = 0;
    for ( let seed = 1; seed <= 40; seed++ ) if ( blows(replay(meeting({ opening: "talk", hound: true }), pf2eRules, seed).log) ) fought++;
    expect(fought).toBeGreaterThan(0);
  });

  test("why the talks collapsed: each fight says why and by whom, and the odds keep the most common reason", () => {
    for ( let seed = 1; seed <= 40; seed++ ) {
      const r = replay(meeting({ hound: true }), pf2eRules, seed);
      if ( !r.collapsed ) {
        expect(r.collapseCause).toBeNull();
        continue;
      }
      const told = r.log.find(e => e.type === "collapse");
      expect(r.collapseCause).toEqual({ cause: told.cause, by: told.actorId });
    }
    const results = runBatchSync(meeting({ hound: true }), pf2eRules, { runs: 300, seed: 3 });
    const top = results.collapseCause;
    // (The hound can't follow the talk: it breaks it most.)
    expect(top.cause).toBe("beast");
    expect(top.by[0]).toBe("hound");
    expect(top.by.length).toBeLessThanOrEqual(3);
    expect(top.share).toBeGreaterThan(0.5);
    expect(top.share).toBeLessThanOrEqual(1);
    expect(runBatchSync(meeting(), pf2eRules, { runs: 50, seed: 3 }).collapseCause?.cause ?? null).not.toBe("beast");
  });

  test("the odds: talks collapsed counted apart, everything adds up, and nobody is hurt", () => {
    const results = runBatchSync(meeting({ hound: true }), pf2eRules, { runs: 300, seed: 3 });
    expect(results.pCollapsed).toBeGreaterThan(0);
    const total = Object.values(results.sides).reduce((s, x) => s + x.pWin, 0) + results.pStalemate + results.pNone;
    expect(total).toBeCloseTo(1, 5);
    expect(results.pCollapsed).toBeLessThanOrEqual(results.pNone + 1e-9);
    for ( const c of Object.values(results.combatants) ) expect(c.meanDamage ?? 0).toBe(0);
  });

  test("the story says the talks collapsed, or what was settled", () => {
    for ( let seed = 1; seed <= 20; seed++ ) {
      const spec = meeting({ hound: true });
      const r = replay(spec, pf2eRules, seed);
      const story = buildStory(r, spec, "roleplay", { tables, seed });
      expect(story.text).not.toMatch(/undefined|NaN|\{[a-zA-Z]+\}/);
      if ( r.collapsed ) expect(english["event.talksCollapse"].some(line => story.text.includes(line))).toBe(true);
      const statistician = buildStory(r, spec, "statistician", { tables, seed });
      // (The Statistician's log says why: one of the collapse lines, in the reader's words.)
      const why = ["CollapseInsulted", "CollapseBeast", "CollapseAnnoyed", "CollapseBlood", "CollapseImpatient", "CollapseFray"].map(k => en[`FASTFIGHTING.Log.${k}`]);
      if ( r.collapsed ) expect(why.some(w => statistician.text.includes(w))).toBe(true);
    }
  });
});
