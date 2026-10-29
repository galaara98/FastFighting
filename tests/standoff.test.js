import { describe, expect, test } from "vitest";
import { runBatchSync, replay, prepareBattle } from "../scripts/engine/simulator.js";
import { createRun } from "../scripts/engine/battle-state.js";
import { impatience, opensWithTalk, followsTalk } from "../scripts/engine/behavior/standoff.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { buildStory } from "../scripts/story/story.js";
import { storyTables } from "./foundry-i18n.js";
import { creature, battle, social } from "./helpers.js";

const english = storyTables();
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
  test("a smart creature holds a standoff its side is in, unless its side is losing the talk", () => {
    const minded = tactical => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 60, fudge: 0 }, selfish: { base: 50, fudge: 0 }, loyal: { base: 50, fudge: 0 } });
    const run = createRun(prepareBattle(battle([
      creature({ id: "envoy", kind: "pc", diesAtZero: false, social: speaks() }),
      creature({ id: "sharp", side: "hostile", social: speaks(), traits: minded(70) }),
      creature({ id: "dull", side: "hostile", social: speaks(), traits: minded(45) })
    ]), pf2eRules));
    run.round = 2;
    const [envoy, sharp, dull] = run.units;
    const calm = impatience(run, sharp);
    expect(calm).toBeLessThan(impatience(run, dull));
    // The envoy is halfway to talking them both down: now the smart one would rather strike first.
    sharp.sway.set("friendly", 2);
    dull.sway.set("friendly", 2);
    expect(impatience(run, sharp)).toBeGreaterThan(calm * 2);
    expect(envoy.side).toBe("friendly");
  });

  test("one who shares no language with the other side loses patience as fast as a beast", () => {
    const run = createRun(prepareBattle(battle([
      creature({ id: "envoy", kind: "pc", diesAtZero: false, social: speaks() }),
      creature({ id: "guard", side: "hostile", social: speaks() }),
      creature({ id: "orc", side: "hostile", social: speaks({ languages: ["orcish"] }) }),
      creature({ id: "hound", side: "hostile", social: null })
    ]), pf2eRules));
    const [, guard, orc, hound] = run.units;
    for ( const u of run.units ) u.tac = {};
    expect(followsTalk(run, guard)).toBe(true);
    expect(followsTalk(run, orc)).toBe(false);
    expect(impatience(run, orc)).toBeGreaterThan(impatience(run, guard) * 4);
    expect(impatience(run, orc)).toBeCloseTo(impatience(run, hound), 6);
    // (With languages set aside, it follows.)
    run.prep.options.ignoreLanguages = true;
    expect(followsTalk(run, orc)).toBe(true);
  });

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

describe("a standoff turn with nothing said", () => {
  const spetum = { id: "spetum", name: "Spetum", kind: "strike", cost: 1, bonus: 10, maps: [0, -5, -10], melee: true, reach: 10, drawCost: 1, gear: "spetum",
    damage: [{ dice: [{ n: 1, faces: 8, mult: 1 }], flat: 4, type: "piercing", persistent: false, category: null }] };
  const fist = { id: "fist", name: "Fist", kind: "strike", cost: 1, bonus: 6, maps: [0, -5, -10], melee: true, reach: 5,
    damage: [{ dice: [{ n: 1, faces: 4, mult: 1 }], flat: 0, type: "bludgeoning", persistent: false, category: null }] };
  const at = x => ({ position: { x, y: 0, size: 5 } });
  // (A silent fighter facing a captain who talks: the standoff holds while the captain weighs its words.)
  const field = actions => {
    const spec = battle([
      creature({ id: "spet", name: "Spet", kind: "pc", diesAtZero: false, social: null, tactics: { talk: "never" }, actions, initiative: { mod: 100 }, ...at(0) }),
      creature({ id: "captain", name: "Captain", side: "hostile", social: speaks(), tactics: { talk: "first" }, initiative: { mod: -100 }, ...at(10) })
    ], { maxRounds: 2, opening: "talk", positioning: true });
    spec.sides.hostile.leaderId = "captain";
    return spec;
  };
  const spetsFirst = r => r.log.filter(e => e.actorId === "spet" && e.round === 1 && e.type !== "thought").map(e => e.type);
  // (Where the standoff held through its first turn: it didn't break it itself.)
  const held = r => r.log.some(e => e.type === "standoff") && !spetsFirst(r).includes("breakStandoff");

  test("it gets ready where it stands: its weapon drawn, as in any spare turn", () => {
    const seen = [];
    for ( const seed of [1, 2, 3, 4, 5] ) {
      const r = replay(field([spetum, fist]), pf2eRules, seed);
      if ( !held(r) ) continue;
      seen.push(spetsFirst(r));
    }
    expect(seen.length).toBeGreaterThan(0);
    for ( const types of seen ) {
      expect(types).toContain("draw");
      expect(types).not.toContain("lazy");
      expect(types).not.toContain("move");
    }
  });

  test("nothing to get ready: told as watching, never as idling", () => {
    let seen = 0;
    for ( const seed of [1, 2, 3, 4, 5] ) {
      const r = replay(field([fist]), pf2eRules, seed);
      if ( !held(r) ) continue;
      seen++;
      expect(spetsFirst(r)).toEqual(["watch"]);
      expect(r.log.find(e => e.actorId === "spet" && e.round === 1 && e.type === "watch")).toMatchObject({ standoff: true });
    }
    expect(seen).toBeGreaterThan(0);
  });
});
