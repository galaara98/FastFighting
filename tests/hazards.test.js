import { describe, expect, test } from "vitest";
import { replay, runBatchSync } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle, strike } from "./helpers.js";
import { applyHazard, HAZARD_MARKS } from "../scripts/foundry/battle.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";

const quiet = { pitches: {}, resist: {}, languages: [] };
const mindless = { mindless: true, languages: [], pitches: {}, resist: {} };

/** A trap on the enemy's side: a dart launcher (a ranged Strike), a simple one by default. */
const trap = (over = {}) => creature({
  id: "trap", name: "Dart Launcher", side: "hostile", kind: "hazard", hazard: { once: true }, untargetable: true,
  speeds: {}, social: mindless, flags: { fearless: true, mindless: true }, hp: { value: 1, max: 1, temp: 0 },
  actions: [strike({ id: "dart", name: "Dart", melee: false, range: { increment: 60 }, bonus: 12 })], ...over
});
const hero = (over = {}) => creature({ id: "hero", kind: "pc", diesAtZero: false, hp: { value: 60, max: 60, temp: 0 }, social: quiet, ...over });
const goblin = (over = {}) => creature({ id: "goblin", side: "hostile", hp: { value: 12, max: 12, temp: 0 }, social: quiet, ...over });

/** What the hazard did, and what was done to it, in one logged fight. */
function fight(combatants, seed, options = {}) {
  const result = replay(battle(combatants, { talking: false, ...options }), pf2eRules, seed);
  const log = result.log ?? [];
  return {
    result,
    fired: log.filter(e => e.actorId === "trap" && e.targetId).map(e => e.round),
    struck: log.filter(e => e.targetId === "trap" && e.actorId !== "trap").length
  };
}

describe("hazards", () => {
  test("a simple hazard fires once; a complex one, every round", () => {
    for ( let seed = 1; seed <= 10; seed++ ) {
      // (A long fight: a sturdy hero, a sturdy goblin.)
      const sturdy = { hp: { value: 300, max: 300, temp: 0 } };
      const simple = fight([hero(sturdy), goblin(sturdy), trap()], seed);
      expect(new Set(simple.fired).size).toBe(1);
      expect(simple.fired[0]).toBe(1); // (first thing in round 1)
      expect(simple.result.log.find(e => e.type === "initiative").order[0]).toBe("Dart Launcher");
      const complex = fight([hero(sturdy), goblin(sturdy), trap({ hazard: { once: false } })], seed);
      expect(new Set(complex.fired).size).toBeGreaterThan(1);
    }
  });

  test("nobody attacks it, and it keeps no side in the fight: the last foe down, the party has won", () => {
    for ( let seed = 1; seed <= 10; seed++ ) {
      const { struck, result } = fight([hero(), goblin(), trap({ hazard: { once: false } })], seed);
      expect(struck).toBe(0);
      expect(result.units.trap.final.status).toBe("standing");
    }
    // (A trap that only stings: the goblin decides the fight.)
    const sting = trap({ hazard: { once: false }, actions: [strike({ id: "dart", name: "Dart", melee: false, range: { increment: 60 }, bonus: 2, damage: [] })] });
    const results = runBatchSync(battle([hero(), goblin(), sting], { talking: false }), pf2eRules, { runs: 200, seed: 4 });
    expect(results.sides.friendly.pWin).toBeGreaterThan(0.9);
    expect(results.pStalemate).toBeLessThan(0.05);
  });

  test("even a creature that goes for the most dangerous foe never goes for a hazard", () => {
    const sturdy = { hp: { value: 300, max: 300, temp: 0 } };
    for ( let seed = 1; seed <= 15; seed++ ) {
      const bold = combinePlaystyles(["instigator", "leader"]);
      const { struck } = fight([hero({ ...sturdy, playstyles: bold.ids, desireStyle: bold.desire, behavior: bold.behavior }), goblin(sturdy), trap({ hazard: { once: false } })], seed);
      expect(struck).toBe(0);
    }
  });

  test("outside the encounter it's set all the same, and never 'notices' the fight", () => {
    const sturdy = { hp: { value: 300, max: 300, temp: 0 } };
    for ( let seed = 1; seed <= 5; seed++ ) {
      const { result, fired } = fight([hero(sturdy), goblin(sturdy), trap({ hazard: { once: false }, inEncounter: false })], seed);
      expect(fired.length).toBeGreaterThan(0);
      expect(result.log.some(e => e.actorId === "trap" && e.type === "notice")).toBe(false);
    }
  });

  test("it doesn't break a standoff, and fires only once the fighting starts", () => {
    const talkers = [
      hero({ social: { ...quiet, languages: ["common"] }, tactics: { talk: "first" } }),
      goblin({ social: { ...quiet, languages: ["common"] } }),
      trap({ hazard: { once: false } })
    ];
    const { result } = fight(talkers, 3, { talking: true, opening: "talk", maxRounds: 3 });
    const log = result.log;
    const fightStarts = log.findIndex(e => e.type === "standoffEnds" || e.type === "standoffBroken" || (e.targetId && e.actorId !== "trap"));
    const firstShot = log.findIndex(e => e.actorId === "trap" && e.targetId);
    if ( firstShot >= 0 ) expect(firstShot).toBeGreaterThan(fightStarts);
  });
});

describe("any system's token can be a hazard: the GM's mark", () => {
  test("simple or complex makes a creature a hazard; 'no' undoes the system's; none leaves it as it is", () => {
    expect(HAZARD_MARKS).toEqual(["", "no", "simple", "complex"]);
    const made = applyHazard(goblin({ flags: { packTactics: true } }), "simple");
    expect(made).toMatchObject({ kind: "hazard", hazard: { once: true }, untargetable: true, speeds: {}, leadership: null });
    expect(made.social.mindless).toBe(true);
    expect(made.flags).toMatchObject({ fearless: true, mindless: true, packTactics: true });
    expect(applyHazard(goblin(), "complex").hazard).toEqual({ once: false });
    const undone = applyHazard(trap(), "no");
    expect(undone.hazard).toBeUndefined();
    expect(undone.untargetable).toBeUndefined();
    expect(undone.kind).toBe("npc");
    expect(applyHazard(trap(), "").hazard).toEqual({ once: true });
    expect(applyHazard(goblin(), undefined).hazard).toBeUndefined();
  });

  test("a goblin marked a complex hazard fights as one: it fires each round and nobody attacks it", () => {
    const sturdy = { hp: { value: 300, max: 300, temp: 0 } };
    const marked = applyHazard(creature({ id: "trap", side: "hostile", actions: [strike({ id: "spear", name: "Spear", melee: false, range: { increment: 30 } })] }), "complex");
    const { fired, struck } = fight([hero(sturdy), goblin(sturdy), marked], 2);
    expect(new Set(fired).size).toBeGreaterThan(1);
    expect(struck).toBe(0);
  });
});

describe("a hazard has no mind", () => {
  test("whatever stirs it, it wants nothing: no desires ranked, none on the map of minds, no attitudes or goals", async () => {
    const { beginLive, liveRound, liveTurn, networkOf } = await import("../scripts/engine/live.js");
    const { want, rankedDesires, wantsKind } = await import("../scripts/engine/behavior/desire.js");
    const run = beginLive(battle([hero({ position: { x: 0, y: 0, size: 5 } }), goblin({ position: { x: 10, y: 0, size: 5 } }), trap({ position: { x: 5, y: 5, size: 5 } })], { talking: false, positioning: true }), pf2eRules, { seed: 3, players: ["hero"] });
    liveRound(run, 1);
    liveTurn(run, "trap");
    const pit = run.byId.get("trap");
    want(pit, "hurt", "hero", 40);
    expect(rankedDesires(run, pit)).toEqual([]);
    expect(wantsKind(pit, ["hurt"])).toBe(false);
    const map = networkOf(run);
    expect(map.creatures.find(c => c.id === "trap")).toMatchObject({ hazard: true });
    expect(map.links.filter(l => l.from === "trap")).toEqual([]);
    expect((map.marks ?? []).filter(m => m.on === "trap" && m.type !== "status")).toEqual([]);
  });
});
