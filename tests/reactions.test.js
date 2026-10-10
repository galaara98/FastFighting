import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const traits = tactical => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } });

/** A hero beside a tough foe, with a nearly beaten one a short walk away. */
function engaged({ tactical = 25, reactiveStrike = true, roleplay = false } = {}) {
  const hero = creature({ id: "hero", position: at(0), traits: traits(tactical), roleplay, initiative: { mod: 50 } });
  const brute = creature({ id: "brute", side: "hostile", position: at(5), hp: { value: 500, max: 500, temp: 0 }, actions: [strike({ bonus: -50 })], flags: { reactiveStrike } });
  const straggler = creature({ id: "straggler", side: "hostile", position: at(25), hp: { value: 1, max: 20, temp: 0 }, actions: [strike({ bonus: -50 })] });
  return battle([hero, brute, straggler], { positioning: true, maxRounds: 1, aftermath: "none" });
}
const heroLog = r => r.log.filter(e => e.actorId === "hero");
const struckLeaving = r => r.log.some(e => e.type === "opportunity" && e.targetId === "hero");

describe("opportunity attacks", () => {
  test("only a creature that has the reaction punishes walking away", () => {
    const without = replay(engaged({ reactiveStrike: false }), pf2eRules, 3);
    expect(heroLog(without).some(e => e.type === "move")).toBe(true);
    expect(struckLeaving(without)).toBe(false);
    const withIt = replay(engaged({ reactiveStrike: true }), pf2eRules, 3);
    expect(struckLeaving(withIt)).toBe(true);
  });

  test("a tactical fighter keeps to the foe beside it rather than turning its back", () => {
    const r = replay(engaged({ tactical: 80 }), pf2eRules, 3);
    expect(heroLog(r).some(e => e.type === "move")).toBe(false);
    expect(heroLog(r).some(e => e.type === "attack" && e.targetId === "brute")).toBe(true);
    expect(struckLeaving(r)).toBe(false);
  });

  test("with no one to punish it, the same fighter goes for the quick kill", () => {
    const r = replay(engaged({ tactical: 80, reactiveStrike: false }), pf2eRules, 3);
    expect(heroLog(r).some(e => e.type === "attack" && e.targetId === "straggler")).toBe(true);
  });

  test("played for the story, a tactical fighter sometimes forgets", () => {
    const left = Array.from({ length: 40 }, (_, i) => struckLeaving(replay(engaged({ tactical: 80, roleplay: true }), pf2eRules, 100 + i)));
    expect(left.some(Boolean)).toBe(true);
    expect(left.every(Boolean)).toBe(false);
  });

  test("a careful healer steps clear before walking to a fallen friend", () => {
    const touch = { id: "lay", name: "Lay On Hands", kind: "heal", cost: 1, heal: [{ dice: [{ n: 1, faces: 8, mult: 1 }], flat: 4, type: "healing", persistent: false, category: null }], reach: 5 };
    const healer = creature({ id: "healer", position: at(0), traits: traits(80), actions: [strike(), touch], initiative: { mod: 50 } });
    const friend = creature({ id: "friend", kind: "pc", diesAtZero: false, position: at(-25), hp: { value: 0, max: 20, temp: 0 }, dying: 1 });
    const brute = creature({ id: "brute", side: "hostile", position: at(5), hp: { value: 500, max: 500, temp: 0 }, actions: [strike({ bonus: -50 })], flags: { reactiveStrike: true } });
    const r = replay(battle([healer, friend, brute], { positioning: true, maxRounds: 1, aftermath: "none" }), pf2eRules, 4);
    const mine = r.log.filter(e => e.actorId === "healer").map(e => e.type);
    expect(mine.indexOf("disengage")).toBeGreaterThanOrEqual(0);
    expect(mine.indexOf("move")).toBeGreaterThan(mine.indexOf("disengage"));
    expect(mine.indexOf("heal")).toBeGreaterThan(mine.indexOf("move"));
    expect(r.log.some(e => e.type === "opportunity")).toBe(false);
  });
});
