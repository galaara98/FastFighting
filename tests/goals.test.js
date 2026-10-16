/**
 * The GM's hold on what a creature wants (a desire, a goal), and goals: what a creature wants that isn't another
 * creature. The engine's own (a door in the way, a trap it knows, running), and those it doesn't play yet.
 */
import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { beginLive, liveRound, liveTurn, applyFact, setGoal, mindOf, snapshotRun, restoreRun } from "../scripts/engine/live.js";
import { levelOf, rankedDesires, holdDesire } from "../scripts/engine/behavior/desire.js";
import { goalsOf, GOALS, GOAL_KINDS } from "../scripts/engine/behavior/goals.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const tough = { value: 500, max: 500, temp: 0 };
const traits = () => ({ tactical: { base: 60, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } });

/** A hero, a foe behind a door (the way the fight found runs through it), as doors.test.js has it. */
function behindDoor({ locked = false, hero = {}, goals = null } = {}) {
  const h = creature({ id: "hero", position: at(0), traits: traits(), initiative: { mod: 50 }, ...(goals ? { goals } : {}), ...hero });
  const foe = creature({ id: "foe", side: "hostile", position: at(40), hp: tough, actions: [strike({ bonus: -50 })] });
  const spec = battle([h, foe], { positioning: true, maxRounds: 3, aftermath: "none" });
  spec.doors = { d1: { locked, x: 20, y: 0 } };
  spec.approach = { hero: { foe: { dist: 35, mult: 1, speed: 25, mode: "walk", los: true, meleeOk: true, doors: ["d1"] } } };
  return spec;
}
const live = spec => {
  const run = beginLive(spec, pf2eRules, { seed: 2 });
  liveRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
};

describe("the GM holds a desire", () => {
  test("at the level the GM says, whatever else would move it; at 0, set aside; handed back, the engine's again", () => {
    const run = live(behindDoor({ hero: { desires: [{ kind: "hurt", targetId: "foe", level: 70 }] } }));
    const hero = run.byId.get("hero");
    expect(levelOf(hero, "hurt", "foe")).toBe(70);
    // Lowered: the GM's word stands, below what it was told to want.
    applyFact(run, { kind: "want", id: "hero", desire: "hurt", targetId: "foe", level: 30 });
    expect(levelOf(hero, "hurt", "foe")).toBe(30);
    expect(mindOf(run, "hero").gm).toEqual([{ kind: "hurt", targetId: "foe", level: 30 }]);
    // Set aside: it doesn't want it at all.
    applyFact(run, { kind: "want", id: "hero", desire: "hurt", targetId: "foe", level: 0 });
    expect(rankedDesires(run, hero).some(d => d.kind === "hurt" && d.targetId === "foe")).toBe(false);
    // Handed back.
    applyFact(run, { kind: "forget", id: "hero", desire: "hurt", targetId: "foe" });
    expect(levelOf(hero, "hurt", "foe")).toBe(70);
  });

  test("kept with the battle: restored, it's still held", () => {
    const run = live(behindDoor());
    holdDesire(run.byId.get("hero"), "hurt", "foe", 90);
    const again = restoreRun(behindDoor(), pf2eRules, JSON.parse(JSON.stringify(snapshotRun(run))));
    expect(levelOf(again.byId.get("hero"), "hurt", "foe")).toBe(90);
  });
});

describe("goals", () => {
  test("every kind says what it's about and how it's counted; the engine plays a door, a trap, running", () => {
    for ( const kind of GOAL_KINDS ) {
      expect(["door", "hazard", "item", "place", "object", "self"]).toContain(GOALS[kind].about);
      expect(["band", "count"]).toContain(GOALS[kind].scale);
    }
    expect(GOAL_KINDS.filter(k => GOALS[k].played)).toEqual(["openDoor", "avoidTrap", "runAway"]);
  });

  test("a door between it and what it's after: through it, as badly as it wants what's behind; given up at the GM's word", () => {
    const run = live(behindDoor({ hero: { desires: [{ kind: "hurt", targetId: "foe", level: 60 }] } }));
    const hero = run.byId.get("hero");
    expect(goalsOf(run, hero).find(g => g.kind === "openDoor")).toMatchObject({ thing: { type: "door", id: "d1", x: 20, y: 0 }, via: "foe", level: 60, played: true });
    expect(setGoal(run, "hero", { kind: "openDoor", thingId: "d1", level: 0 })).toBe(true);
    expect(goalsOf(run, hero).some(g => g.kind === "openDoor")).toBe(false);
    const { events } = liveTurn(run, "hero");
    expect(events.find(e => e.type === "door" && e.actorId === "hero")).toMatchObject({ method: "giveup" });
    expect(hero.walledOff.get("foe")).toBe("d1");
  });

  test("held higher, a locked door is worth more of its time", () => {
    const weak = { actions: [strike({ bonus: -50 })], doorWork: { force: { mod: 0 } } };
    const tries = level => {
      const run = live(behindDoor({ locked: true, hero: weak }));
      if ( level !== null ) setGoal(run, "hero", { kind: "openDoor", thingId: "d1", level });
      let n = 0;
      for ( let r = 1; r <= 3; r++ ) {
        if ( r > 1 ) liveRound(run, r);
        n += liveTurn(run, "hero").events.filter(e => e.type === "door" && e.actorId === "hero" && e.method !== "giveup").length;
      }
      return n;
    };
    expect(tries(100)).toBeGreaterThan(tries(null));
  });

  test("a trap it knows it keeps clear of, until the GM says it forgot; running, steady again or running now", () => {
    const trap = creature({ id: "trap", side: "hostile", kind: "hazard", hazard: { once: false }, untargetable: true, speeds: {}, position: at(20) });
    const spec = battle([creature({ id: "hero", position: at(0), traits: traits() }), creature({ id: "foe", side: "hostile", position: at(40) }), trap], { positioning: true, maxRounds: 3, aftermath: "none" });
    const run = live(spec);
    const hero = run.byId.get("hero");
    expect(setGoal(run, "hero", { kind: "avoidTrap", thingId: "trap", level: 1 })).toBe(true);
    expect(goalsOf(run, hero).find(g => g.kind === "avoidTrap")).toMatchObject({ targetId: "trap", level: 1, most: 1 });
    setGoal(run, "hero", { kind: "avoidTrap", thingId: "trap", level: 0 });
    expect(hero.spottedTraps.has("trap")).toBe(false);
    // Not a hazard: nothing to keep clear of.
    expect(setGoal(run, "hero", { kind: "avoidTrap", thingId: "foe", level: 1 })).toBe(false);
    // Shaken: thinking of running. The GM steadies it, then sends it running.
    hero.wavering = true;
    expect(goalsOf(run, hero).find(g => g.kind === "runAway")).toMatchObject({ level: 1, most: 2 });
    setGoal(run, "hero", { kind: "runAway", level: 0 });
    expect(hero.wavering).toBe(false);
    setGoal(run, "hero", { kind: "runAway", level: 2 });
    expect(hero.status).toBe("fled");
  });

  test("one the engine doesn't play yet is kept and shown, held as the GM says, and changes nothing it does", () => {
    const idol = [{ kind: "pickUp", thing: { type: "item", id: "idol", x: 10, y: 5, name: "the idol" }, level: 50 }];
    const run = live(behindDoor({ goals: idol }));
    const hero = run.byId.get("hero");
    expect(goalsOf(run, hero).find(g => g.kind === "pickUp")).toMatchObject({ thing: { type: "item", id: "idol", name: "the idol" }, level: 50, played: false, gm: false });
    setGoal(run, "hero", { kind: "pickUp", thingId: "idol", level: 90 });
    expect(goalsOf(run, hero).find(g => g.kind === "pickUp")).toMatchObject({ level: 90, gm: true });
    setGoal(run, "hero", { kind: "pickUp", thingId: "idol", level: null });
    expect(goalsOf(run, hero).find(g => g.kind === "pickUp")).toMatchObject({ level: 50, gm: false });
    for ( const seed of [1, 2, 3] ) expect(replay(behindDoor({ goals: idol }), pf2eRules, seed).log).toEqual(replay(behindDoor(), pf2eRules, seed).log);
  });
});

describe("a bystander the GM says noticed the fight", () => {
  test("notices it (at the table), and comes in next round", () => {
    const guard = creature({ id: "guard", side: "hostile", inEncounter: false, position: at(60, 0) });
    const spec = battle([creature({ id: "hero", position: at(0) }), creature({ id: "foe", side: "hostile", position: at(10) }), guard], { positioning: true, maxRounds: 3, aftermath: "none" });
    const run = beginLive(spec, pf2eRules, { seed: 1 });
    liveRound(run, 1);
    const g = run.byId.get("guard");
    expect(g.active).toBe(false);
    expect(applyFact(run, { kind: "notice", id: "guard" })).toBe(true);
    expect(run.log.at(-1)).toMatchObject({ type: "notice", cause: "gm", actorId: "guard" });
    expect(g.joinsRound).toBe(run.round + 1);
    expect(applyFact(run, { kind: "notice", id: "guard" })).toBe(false);
  });
});
