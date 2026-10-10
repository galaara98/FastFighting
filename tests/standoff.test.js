import { describe, expect, test } from "vitest";
import { runBatchSync, replay, prepareBattle } from "../scripts/engine/simulator.js";
import { createRun } from "../scripts/engine/battle-state.js";
import { impatience, opensWithTalk } from "../scripts/engine/behavior/standoff.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { buildStory } from "../scripts/story/story.js";
import { buildEnglishTables } from "../scripts/story/tables-en.js";
import { creature, strike, battle, social } from "./helpers.js";

const english = buildEnglishTables();
const tables = { get: k => english[k] };
const speaks = (extra = {}) => social({ diplomacy: 12, intimidation: 8, deception: 6, willDC: 16, perceptionDC: 16, ...extra });

/** A negotiator facing a guard captain and a guard, all of whom would rather talk. */
function parley({ opening, guardTalk = "first", captainTalk = guardTalk, beast = false } = {}) {
  // A resolute envoy: the guards rarely talk her into anything, so these tests are about the party talking.
  const envoy = creature({ id: "envoy", name: "Seelah", kind: "pc", diesAtZero: false, social: speaks({ willDC: 30 }), tactics: { talk: "first" } });
  const captain = creature({ id: "captain", name: "Captain", side: "hostile", social: speaks({ diplomacy: 6 }), tactics: { talk: captainTalk } });
  const other = beast
    ? creature({ id: "hound", name: "Hound", side: "hostile", social: null, traits: { tactical: { base: 10, fudge: 0 }, brave: { base: 70, fudge: 0 }, selfish: { base: 50, fudge: 0 }, loyal: { base: 50, fudge: 0 } } })
    : creature({ id: "guard", name: "Guard", side: "hostile", social: speaks({ diplomacy: 2 }), tactics: { talk: guardTalk } });
  const spec = battle([envoy, captain, other], { maxRounds: 10, opening });
  spec.sides.hostile.leaderId = "captain";
  return spec;
}

describe("standoffs", () => {
  test("when everyone would rather talk, it opens with words", () => {
    const run = createRun(prepareBattle(parley(), pf2eRules));
    for ( const u of run.units ) u.tac = u.spec.tactics;
    expect(opensWithTalk(run)).toBe(true);
    expect(replay(parley(), pf2eRules, 1).log.some(e => e.type === "standoff")).toBe(true);
  });

  test("some standoffs are settled with words, others break into battle", () => {
    const r = runBatchSync(parley(), pf2eRules, { runs: 400 });
    expect(r.pPeaceful).toBeGreaterThan(0.05);
    expect(r.pPeaceful).toBeLessThan(0.95);
    // A peaceful ending means nobody was hurt, and the persuaded stood down rather than surrendered.
    const calm = [...Array(60).keys()].map(s => replay(parley(), pf2eRules, s + 1)).find(x => x.peaceful);
    expect(calm).toBeDefined();
    expect(calm.log.some(e => e.type === "attack" || e.type === "save")).toBe(false);
    expect(Object.values(calm.units).some(u => u.final.status === "stoodDown")).toBe(true);
    const story = buildStory(calm, parley(), "roleplay", { tables, seed: 1 }).text;
    expect(english["event.peace"].some(line => story.includes(line))).toBe(true);
  });

  test("a broken standoff becomes a battle from that turn on", () => {
    const broken = [...Array(60).keys()].map(s => replay(parley(), pf2eRules, s + 1)).find(x => x.log.some(e => e.type === "breakStandoff"));
    expect(broken).toBeDefined();
    const at = broken.log.findIndex(e => e.type === "breakStandoff");
    expect(broken.log.slice(0, at).some(e => e.type === "attack")).toBe(false);
    expect(broken.log.slice(at).some(e => e.type === "attack" || e.type === "save")).toBe(true);
  });

  test("a beast that can't follow the talk doesn't wait long", () => {
    const quick = [];
    for ( let s = 1; s <= 40; s++ ) {
      const r = replay(parley({ opening: "talk", beast: true }), pf2eRules, s);
      const brk = r.log.find(e => e.type === "breakStandoff");
      if ( brk ) quick.push(brk.round);
    }
    expect(quick.length).toBeGreaterThan(30);
    expect(quick.filter(n => n <= 3).length).toBeGreaterThan(quick.length / 2);
  });

  test("hot-headed sides go straight to battle, and so does 'straight to battle'", () => {
    expect(replay(parley({ guardTalk: "never" }), pf2eRules, 2).log.some(e => e.type === "standoff")).toBe(false);
    // Talkers may still talk the others down before a blow is struck, but nobody waits for it.
    for ( let s = 1; s <= 20; s++ ) expect(replay(parley({ opening: "fight" }), pf2eRules, s).log.some(e => e.type === "standoff")).toBe(false);
  });

  test("a leader who wants to talk holds their side back", () => {
    const spec = parley({ guardTalk: "opportune", captainTalk: "first" });
    const run = createRun(prepareBattle(spec, pf2eRules));
    for ( const u of run.units ) u.tac = u.spec.tactics;
    run.round = 1;
    const guard = run.byId.get("guard");
    const held = impatience(run, guard);
    run.byId.get("captain").status = "dead";
    expect(impatience(run, guard)).toBeGreaterThan(held);
  });
});
