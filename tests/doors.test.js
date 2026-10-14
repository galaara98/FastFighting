import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";
import { beginLive, liveRound, liveTurn, snapshotRun, restoreRun } from "../scripts/engine/live.js";
import { parseFormula } from "../scripts/engine/dice.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const tough = { value: 500, max: 500, temp: 0 };
const harmless = () => strike({ bonus: -50 });
const traits = (tactical = 60) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } });

/**
 * A hero, a foe behind a door 20 feet away (the way the fight found runs through it), and maybe a decoy in the
 * open. The approach matrix is given by hand, as the Foundry side would build it.
 */
function behindDoor({ locked = true, hero = {}, decoy = false, rounds = 3 } = {}) {
  const h = creature({ id: "hero", position: at(0), traits: traits(), initiative: { mod: 50 }, ...hero });
  const foe = creature({ id: "foe", side: "hostile", position: at(40), hp: tough, actions: [harmless()] });
  const list = [h, foe];
  if ( decoy ) list.push(creature({ id: "decoy", side: "hostile", position: at(0, 40), hp: tough, actions: [harmless()] }));
  const spec = battle(list, { positioning: true, maxRounds: rounds, aftermath: "none" });
  spec.doors = { d1: { locked, x: 20, y: 0 } };
  spec.approach = { hero: { foe: { dist: 35, mult: 1, speed: 25, mode: "walk", los: true, meleeOk: true, doors: ["d1"] } } };
  return spec;
}
const doorEvents = r => r.log.filter(e => e.type === "door" && e.actorId === "hero");

describe("doors in a live battle", () => {
  test("a turn kept and restored (a reload, a rewind) still knows the scene's doors and which are open", () => {
    const spec = behindDoor({ locked: false });
    const run = beginLive(spec, pf2eRules, { seed: 2 });
    liveRound(run, 1);
    for ( const u of run.units ) u.active = true;
    const again = restoreRun(behindDoor({ locked: false }), pf2eRules, snapshotRun(run));
    expect(again.prep.doors.get("d1")).toMatchObject({ x: 20, y: 0 });
    expect(again.doors.get("d1")).toMatchObject({ open: false });
    const { events } = liveTurn(again, "hero");
    expect(events.some(e => e.type === "door" && e.actorId === "hero")).toBe(true);
  });
});

describe("doors", () => {
  test("a closed door is walked to and opened, then it's on to the foe", () => {
    const r = replay(behindDoor({ locked: false }), pf2eRules, 2);
    const mine = r.log.filter(e => e.actorId === "hero" && e.type !== "thought");
    expect(mine[0]).toMatchObject({ type: "move", purpose: "door" });
    expect(doorEvents(r)[0]).toMatchObject({ method: "open", success: true });
    expect(mine.some(e => e.type === "attack" && e.targetId === "foe")).toBe(true);
  });

  test("a strong character who wants it badly forces a locked door", () => {
    const r = replay(behindDoor({ hero: { doorWork: { force: { mod: 25 } }, desires: [{ kind: "hurt", targetId: "foe", level: 90 }] } }), pf2eRules, 3);
    expect(doorEvents(r).some(e => e.method === "force" && e.success)).toBe(true);
    expect(r.log.some(e => e.actorId === "hero" && e.type === "attack" && e.targetId === "foe")).toBe(true);
  });

  test("with nothing to break it with, an ordinary urge isn't worth a locked door", () => {
    const weak = { actions: [strike({ damage: [parseFormula("1", "bludgeoning")] })], doorWork: { force: { mod: -10 } } };
    const alone = replay(behindDoor({ hero: weak, rounds: 2 }), pf2eRules, 4);
    expect(doorEvents(alone).some(e => e.method === "giveup")).toBe(true);
    // With another foe in the open, it goes for that one instead.
    const decoy = replay(behindDoor({ decoy: true, hero: weak }), pf2eRules, 4);
    expect(decoy.log.some(e => e.actorId === "hero" && e.type === "attack" && e.targetId === "decoy")).toBe(true);
  });

  test("no strength for it, but a big weapon: it hacks the door down (the system's hardness takes the edge off)", () => {
    const axe = strike({ name: "Greataxe", bonus: 20, damage: [parseFormula("3d12+10", "slashing")] });
    const r = replay(behindDoor({ hero: { actions: [axe], doorWork: { force: { mod: -20 } }, desires: [{ kind: "hurt", targetId: "foe", level: 90 }] } }), pf2eRules, 5);
    const hits = doorEvents(r).filter(e => e.method === "attack");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some(e => e.success)).toBe(true);
    expect(hits.every(e => !e.hit || e.damage >= 0)).toBe(true);
  });
});
