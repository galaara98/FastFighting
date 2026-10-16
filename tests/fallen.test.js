import { describe, expect, test } from "vitest";
import { replay, runBatchSync, beginRun, beginRound, takeTurn, prepareBattle } from "../scripts/engine/simulator.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";
import { suggestTactics } from "../scripts/engine/tactics.js";
import { initDesires, think, mind, partyWants } from "../scripts/engine/behavior/desire.js";
import { diffOutcome } from "../scripts/engine/changes.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const traits = (tactical = 60) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const hero = (extra = {}) => creature({ id: "hero", kind: "pc", diesAtZero: false, hp: { value: 300, max: 300 }, traits: traits(),
  actions: [strike({ id: "blade", bonus: 14, damage: [parseFormula("2d8+8", "slashing")] })], ...extra });
const purse = { money: 40, denominations: null, stowed: [{ id: "ring", name: "Ring", value: 5 }], wielded: [{ id: "club", name: "Club", value: 1 }] };
// A foe that goes dying at 0 rather than dying outright: someone to tie up, or rob.
const bandit = (id = "bandit", extra = {}) => creature({ id, name: id, side: "hostile", diesAtZero: false, hp: { value: 30, max: 30 }, traits: traits(40),
  actions: [strike({ id: "club", bonus: 2, damage: [parseFormula("1d6", "bludgeoning")] })], flags: { fearless: true }, valuables: purse, ...extra });

const at = (x, y = 0) => ({ position: { x, y, size: 5 } });

/** A fight on a map, one turn in: the first bandit down at the hero's feet, the other across the room. */
function oneDown(heroExtra = {}, { far = 60 } = {}) {
  const spec = battle([hero({ ...at(0), ...heroExtra }), bandit("bandit", at(5)), bandit("lurker", at(far))], { maxRounds: 6, positioning: true });
  const run = beginRun(prepareBattle(spec, pf2eRules), 3, { log: true });
  beginRound(run, 1);
  const down = run.byId.get("bandit");
  Object.assign(down, { status: "down", hp: 0, dying: 1, wasDowned: true });
  return { run, me: run.byId.get("hero"), down };
}

describe("tying them up", () => {
  test("mid-fight: with no foe on top of it, it ties up the fallen foe beside it; healed, that foe is a prisoner, and does nothing", () => {
    const { run, me, down } = oneDown({ tactics: { fallen: "tie" } });
    takeTurn(run, me);
    expect(down.boundBy).toBe("hero");
    expect(run.log.some(e => e.type === "bind" && e.targetId === "bandit" && !e.aftermath)).toBe(true);
    // (Back on its feet, by a friend's healing or its own: still tied up.)
    Object.assign(down, { status: "standing", hp: 10 });
    takeTurn(run, down);
    expect(down.status).toBe("bound");
    expect(run.log.at(-1)).toMatchObject({ type: "bound", byId: "hero" });
    expect(run.log.some(e => e.actorId === "bandit" && e.type === "attack")).toBe(false);
  });

  test("with no answer to it, it doesn't; nor while a foe stands within reach (it fights; the fallen can wait)", () => {
    const left = oneDown();
    takeTurn(left.run, left.me);
    expect(left.down.boundBy).toBeUndefined();
    const pressed = oneDown({ tactics: { fallen: "tie" } }, { far: -5 });
    takeTurn(pressed.run, pressed.me);
    expect(pressed.down.boundBy).toBeUndefined();
    expect(pressed.run.log.some(e => e.type === "attack" && e.targetId === "lurker")).toBe(true);
  });

  test("after the fight: the fallen are prisoners, tended as the spared are", () => {
    let bound = 0;
    for ( let s = 1; s <= 20; s++ ) {
      const r = replay(battle([hero({ tactics: { fallen: "tie" }, firstAid: { mod: 30 } }), bandit()], { maxRounds: 6 }), pf2eRules, s);
      const out = r.units.bandit;
      if ( out.final.status === "standing" ) continue;
      expect(out.final.bound).toMatchObject({ by: "hero" });
      expect(out.status).toBe("bound");
      expect(r.log.some(e => e.type === "bind" && e.targetId === "bandit")).toBe(true);
      bound += 1;
    }
    expect(bound).toBeGreaterThan(15);
  });

  test("a Peacekeeper ties them up with no answer of its own; the results count the tied-up", () => {
    const keeper = hero({ desireStyle: combinePlaystyles(["peacekeeper"]).desire, behavior: combinePlaystyles(["peacekeeper"]).behavior });
    const res = runBatchSync(battle([keeper, bandit()], { maxRounds: 6 }), pf2eRules, { runs: 60 });
    expect(res.combatants.bandit.pBound).toBeGreaterThan(0.5);
  });

  test("taking them alive: one who'd tie them up holds back from a kill most of the time, so they fall rather than die", () => {
    let alive = 0;
    for ( let s = 1; s <= 30; s++ ) {
      const r = replay(battle([hero({ tactics: { fallen: "tie" } }), bandit("bandit", { diesAtZero: true })], { maxRounds: 6 }), pf2eRules, s);
      if ( r.units.bandit.final.status !== "dead" ) alive += 1;
    }
    // (90% of the 66%: about six in ten.)
    expect(alive).toBeGreaterThan(10);
    expect(alive).toBeLessThan(28);
  });

  test("the sheets hear it: a turn that ties someone up says so", () => {
    expect(diffOutcome({ status: "down" }, { status: "down", bound: { by: "hero" } })).toMatchObject({ bound: true });
    expect(diffOutcome({ status: "down", bound: { by: "hero" } }, { status: "down", bound: { by: "hero" } })).toBeNull();
  });
});

describe("robbing them", () => {
  test("mid-fight: its purse, whole, once; taken back if the robber ends it beaten", () => {
    const { run, me, down } = oneDown({ tactics: { fallen: "rob" } });
    takeTurn(run, me);
    expect(down.concessions).toEqual([expect.objectContaining({ how: "loot", kind: "money", amount: 40, to: "hero" })]);
    expect(run.log.some(e => e.type === "rob" && e.stolen?.amount === 40)).toBe(true);
    // (Once: it doesn't go back for more.)
    takeTurn(run, me);
    expect(down.concessions).toHaveLength(1);
  });

  test("a player character's things go only on a thief's luck check against one", () => {
    let kept = 0;
    for ( let seed = 1; seed <= 40; seed++ ) {
      const spec = battle([hero({ valuables: purse, ...at(5) }), bandit("brute", { tactics: { fallen: "rob" }, ...at(0) }), creature({ id: "ally", kind: "pc", ...at(90) })], { maxRounds: 6, positioning: true });
      const run = beginRun(prepareBattle(spec, pf2eRules), seed, { log: true });
      beginRound(run, 1);
      const pc = run.byId.get("hero");
      Object.assign(pc, { status: "down", hp: 0, dying: 1 });
      takeTurn(run, run.byId.get("brute"));
      const c = pc.concessions?.[0];
      expect(c).toBeDefined();
      if ( c.kept ) kept += 1;
      expect(c.luck > c.needed).toBe(!!c.kept);
    }
    // (29 or less: it keeps its things seven times in ten.)
    expect(kept).toBeGreaterThan(20);
  });

  test("after the fight: a Thief goes through the fallen's pockets", () => {
    let robbed = 0;
    for ( let s = 1; s <= 20; s++ ) {
      const thief = hero({ desireStyle: combinePlaystyles(["thief"]).desire, behavior: combinePlaystyles(["thief"]).behavior });
      const r = replay(battle([thief, bandit()], { maxRounds: 6 }), pf2eRules, s);
      if ( r.units.bandit.final.status !== "down" ) continue;
      expect(r.units.bandit.final.concessions.some(c => c.how === "loot")).toBe(true);
      robbed += 1;
    }
    expect(robbed).toBeGreaterThan(0);
  });
});

describe("the desires", () => {
  test("tying up only a fallen foe not tied yet; robbing only one with something on it, once each", () => {
    const { run, me, down } = oneDown();
    initDesires(me);
    think(me, "bind", "bandit", 60);
    expect(mind(run, me).lead).toMatchObject({ kind: "bind", targetId: "bandit" });
    down.boundBy = "hero";
    expect(mind(run, me).lead?.kind).not.toBe("bind");
    think(me, "rob", "bandit", 60);
    expect(mind(run, me).lead).toMatchObject({ kind: "rob", targetId: "bandit" });
    me.robbedFrom = new Set(["bandit"]);
    expect(mind(run, me).lead?.kind).not.toBe("rob");
  });

  test("the party's \"tie them up\": every member wants each fallen foe tied, at the party's sway", () => {
    const { run, me } = oneDown();
    run.prep.sides[me.side].party = { fallen: "tie", sway: 0.5 };
    initDesires(me);
    partyWants(run, me, []);
    expect(me.desire.social.get("bind|bandit")).toBe(50);
  });

  test("what \"Let this character decide\" makes of it: by its traits", () => {
    const t = (tactical, selfish, loyal) => suggestTactics({ traits: { tactical: { base: tactical }, brave: { base: 50 }, selfish: { base: selfish }, loyal: { base: loyal } }, actions: [] }).fallen;
    expect(t(10, 50, 50)).toBe("leave"); // (a beast)
    expect(t(50, 90, 20)).toBe("finish");
    expect(t(50, 70, 50)).toBe("rob");
    expect(t(50, 10, 80)).toBe("spare");
    expect(t(80, 30, 50)).toBe("tie");
    // (The usual player character leaves them be: bold, loyal, unselfish, a good head, but not that clear a one.)
    expect(t(65, 25, 80)).toBe("leave");
  });
});
