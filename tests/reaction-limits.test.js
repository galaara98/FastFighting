/**
 * What an opportunity strike answers and what it strikes with (behavior/reactions.js), and actions that share a once a
 * turn (battle-state.js onceKey: PF2e's flourish).
 */
import { describe, expect, test } from "vitest";
import { beginRun, prepareBattle, strikeOutOfTurn, replay } from "../scripts/engine/simulator.js";
import { bestReactionStrike, reactsWith } from "../scripts/engine/behavior/reactions.js";
import { onceKey, usedOnce, useOnce } from "../scripts/engine/battle-state.js";
import { draw } from "../scripts/engine/gear.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const rules = { ...pf2eRules, opportunityOn: ["foeLeavesReach", "foeOpening", "foeMovesInReach"] };
const blast = { id: "blast", name: "Devastating Blast", kind: "save", cost: 2, save: { type: "reflex", dc: 30, basic: true }, melee: false,
  range: { increment: 30, max: 30, noPenalty: true }, area: { targets: 3, shape: "cone", feet: 30 }, damage: [{ dice: [{ n: 4, faces: 6, mult: 1 }], flat: 0, type: "cold", persistent: false, category: null }], traits: ["arcane", "cold"] };
const dagger = strike({ id: "dagger", name: "Dagger", melee: false, range: { increment: 10, max: 60 }, thrown: true });
const spetum = strike({ id: "spetum", name: "Spetum", reach: 10, bonus: 30, drawCost: 1, gear: "spetum" });
const fist = strike({ id: "fist", name: "Fist", bonus: 20 });

function setting(guardActions = [strike({ id: "sword", name: "Sword", bonus: 30 })]) {
  const run = beginRun(prepareBattle(battle([
    creature({ id: "guard", position: at(0), flags: { reactiveStrike: true }, actions: guardActions, hp: { value: 200, max: 200 } }),
    creature({ id: "knight", side: "hostile", position: at(5), actions: [blast, dagger], hp: { value: 200, max: 200 }, flags: { fearless: true } })
  ], { positioning: true, maxRounds: 3 }), rules), 1, { log: true });
  return { run, by: id => run.byId.get(id) };
}

describe("Reactive Strike's openings: a ranged attack, a manipulate action", () => {
  test("an area or a save from afar, without manipulate, opens no one up", () => {
    const { run, by } = setting();
    strikeOutOfTurn(run, by("knight"), by("knight").prep.offense.find(a => a.id === "blast"), by("guard"));
    expect(run.log.some(e => e.type === "opportunity")).toBe(false);
  });

  test("a ranged Strike in its reach does", () => {
    const { run, by } = setting();
    strikeOutOfTurn(run, by("knight"), by("knight").prep.offense.find(a => a.id === "dagger"), by("guard"));
    expect(run.log.find(e => e.type === "opportunity")).toMatchObject({ actorId: "guard", targetId: "knight", trigger: "foeOpening" });
  });

  test("the same area with the manipulate trait does", () => {
    const { run, by } = setting();
    strikeOutOfTurn(run, by("knight"), { ...blast, traits: ["manipulate"] }, by("guard"));
    expect(run.log.some(e => e.type === "opportunity" && e.trigger === "foeOpening")).toBe(true);
  });
});

describe("what a reaction strikes with", () => {
  test("only a weapon in hand: one still to be drawn waits, and the fist does it", () => {
    const { by } = setting([spetum, fist]);
    const guard = by("guard");
    expect(bestReactionStrike(guard).id).toBe("fist");
    draw(guard, guard.prep.offense.find(a => a.id === "spetum"));
    expect(bestReactionStrike(guard).id).toBe("spetum");
  });

  test("one blow: not an activity of two actions, a class action's, nor a once-a-turn one", () => {
    const { by } = setting([fist]);
    const guard = by("guard");
    expect(reactsWith(guard, fist)).toBe(true);
    expect(reactsWith(guard, { ...fist, cost: 2, classAction: "vicious-swing" })).toBe(false);
    expect(reactsWith(guard, { ...fist, cost: { actions: 2 } })).toBe(false);
    expect(reactsWith(guard, { ...fist, oncePerTurn: "flourish" })).toBe(false);
  });
});

describe("once a turn, shared (oncePerTurn as a string)", () => {
  test("true: by the action's own id; a string: one key for all that name it", () => {
    expect(onceKey({ id: "a", oncePerTurn: true })).toBe("a");
    expect(onceKey({ id: "a", oncePerTurn: "flourish" })).toBe(onceKey({ id: "b", oncePerTurn: "flourish" }));
    const u = {};
    useOnce(u, { id: "a", oncePerTurn: "flourish" });
    expect(usedOnce(u, { id: "b", oncePerTurn: "flourish" })).toBe(true);
    expect(usedOnce(u, { id: "c", oncePerTurn: true })).toBe(false);
    expect(usedOnce(u, { id: "d" })).toBe(false);
  });

  test("two flourishes: one a turn, however many actions are left", () => {
    const swing = strike({ id: "swing", name: "Vicious Swing", cost: 2, bonus: 40, damage: [{ dice: [{ n: 4, faces: 12, mult: 1 }], flat: 10, type: "slashing", persistent: false, category: null }], oncePerTurn: "flourish" });
    const spec = battle([
      creature({ id: "hero", actions: [swing, { ...swing, id: "charge", name: "Sudden Charge" }, strike({ id: "axe", name: "Axe", bonus: 0 })], hp: { value: 500, max: 500 } }),
      creature({ id: "ogre", side: "hostile", hp: { value: 5000, max: 5000 }, flags: { fearless: true } })
    ], { maxRounds: 3 });
    let swings = 0;
    for ( const seed of [1, 2, 3, 4, 5] ) {
      const r = replay(spec, { ...pf2eRules, actionsPerTurn: 4 }, seed);
      const byTurn = new Map();
      for ( const e of r.log.filter(x => x.type === "attack" && x.actorId === "hero" && ["Vicious Swing", "Sudden Charge"].includes(x.action)) ) {
        byTurn.set(e.round, (byTurn.get(e.round) ?? 0) + 1);
        swings += 1;
      }
      expect(Math.max(0, ...byTurn.values())).toBeLessThanOrEqual(1);
    }
    expect(swings).toBeGreaterThan(0);
  });
});
