/**
 * The Kiter playstyle: keeps its distance, strikes from out of reach and slips away again, picks on foes that can't
 * follow; cornered, it fights. And how a character is set up as one by itself (auto-playstyles.js).
 */
import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";
import { scorePlaystyles, pickPlaystyles } from "../scripts/engine/auto-playstyles.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const kiter = combinePlaystyles(["kiter"]);
const kiting = over => creature({ id: "kite", name: "Kite", playstyles: ["kiter"], behavior: kiter.behavior, desireStyle: kiter.desire, hp: { value: 30, max: 30 }, ...over });
const brute = over => creature({ id: "brute", name: "Brute", side: "hostile", hp: { value: 120, max: 120 }, flags: { fearless: true }, speeds: { walk: 25 },
  actions: [strike({ id: "maul", name: "Maul", bonus: 12, damage: [parseFormula("2d10+6", "bludgeoning")] })], ...over });
const shortbow = () => strike({ id: "bow", name: "Shortbow", melee: false, reach: undefined, range: { increment: 60, max: 360 } });
/** 5e-style rules: an action and movement in feet (no bonus action), from the three-action fixture's dice. */
const feetRules = { ...pf2eRules, mainPool: "action", movement: "feet", actionsPerTurn: 1, turn: () => ({ action: 1, move: 30 }), costOf: a => (typeof a.cost === "object" ? a.cost : { action: 1 }),
  attackPenalty: () => 0, disengage: () => ({ cost: { action: 1 }, label: "" }) };
const finalOf = (r, id) => {
  const moves = r.log.filter(e => e.actorId === id && e.type === "move" && e.round === 1);
  return moves.at(-1)?.to ?? null;
};

describe("a kiter keeps its distance", () => {
  test("a ranged kiter shoots, then ends its turn at the edge of its first range increment, beyond its foe's move and reach", () => {
    const spec = battle([kiting({ position: at(0), actions: [shortbow()] }), brute({ position: at(20) })], { positioning: true, maxRounds: 1, initiativeOrder: ["kite", "brute"] });
    const r = replay(spec, feetRules, 1);
    const own = r.log.filter(e => e.actorId === "kite" && e.round === 1 && e.type !== "thought");
    expect(own[0].type).toBe("attack");
    const to = finalOf(r, "kite");
    const d = Math.hypot(to.x - 20, to.y) - 5;
    // (Out of the brute's move and reach, 25 + 5, and still within the bow's first increment.)
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThanOrEqual(60);
  });

  test("a melee kiter goes in, strikes, and is out of its target's reach as its turn ends", () => {
    const spec = battle([
      kiting({ position: at(0), speeds: { walk: 35 }, actions: [strike({ id: "rapier", name: "Rapier", bonus: 10, damage: [parseFormula("1d6+4", "piercing")] })] }),
      brute({ position: at(25), speeds: { walk: 20 } })
    ], { positioning: true, maxRounds: 1, initiativeOrder: ["kite", "brute"] });
    const r = replay(spec, pf2eRules, 1);
    const own = r.log.filter(e => e.actorId === "kite" && e.round === 1 && e.type !== "thought");
    const firstAttack = own.findIndex(e => e.type === "attack");
    expect(firstAttack).toBeGreaterThan(-1);
    const out = own.findIndex(e => e.type === "prepare" && (e.step === "hitAndRun" || e.step === "fallBack"));
    expect(out).toBeGreaterThan(firstAttack);
    const to = finalOf(r, "kite");
    expect(Math.hypot(to.x - 25, to.y) - 5).toBeGreaterThan(5);
  });

  test("cornered, a kiter fights: nowhere to fall back to, it strikes with all it has", () => {
    // (A pocket a square wide, walls on three sides, the brute in its mouth.)
    const spec = battle([
      kiting({ position: at(0), actions: [strike({ id: "rapier", name: "Rapier", bonus: 10, damage: [parseFormula("1d6+4", "piercing")] })] }),
      brute({ position: at(5) })
    ], { positioning: true, maxRounds: 1, initiativeOrder: ["kite", "brute"] });
    spec.walls = [{ a: [-2.5, -2.5], b: [7.5, -2.5], s: 20 }, { a: [-2.5, 2.5], b: [7.5, 2.5], s: 20 }, { a: [-2.5, -2.5], b: [-2.5, 2.5], s: 20 }];
    const r = replay(spec, pf2eRules, 1);
    const own = r.log.filter(e => e.actorId === "kite" && e.round === 1 && e.type !== "thought");
    expect(own.filter(e => e.type === "attack").length).toBeGreaterThanOrEqual(2);
    expect(own.filter(e => e.type === "move")).toEqual([]);
  });

  test("it would rather go for a foe that can't follow it", () => {
    expect(kiter.desire.hurt.slow).toBeGreaterThan(0);
  });
});

describe("set up as a Kiter by itself", () => {
  const picks = spec => pickPlaystyles(scorePlaystyles(spec, { rules: pf2eRules }));
  const fit = (spec, id) => scorePlaystyles(spec, { rules: pf2eRules }).find(x => x.id === id).numbers;

  test("a fast archer", () => {
    const archer = creature({ level: 3, speeds: { walk: 40 }, actions: [shortbow(), strike({ id: "fist", name: "Fist", damage: [parseFormula("1d4", "bludgeoning")] })] });
    expect(picks(archer)).toContain("kiter");
  });

  test("a reach weapon leans it a Kiter: a clear sign with speed, a lean on its own; a slow, armoured guard with a glaive stays a Tank", () => {
    const glaive = () => strike({ id: "glaive", name: "Glaive", reach: 10, damage: [parseFormula("1d8+4", "slashing")] });
    const fast = creature({ level: 3, speeds: { walk: 40 }, defenses: { ac: 20, fortitude: 9, reflex: 9, will: 7 }, actions: [glaive()] });
    const slowReach = creature({ level: 3, speeds: { walk: 25 }, actions: [glaive()] });
    const plain = creature({ level: 3, speeds: { walk: 25 }, actions: [strike()] });
    expect(fit(fast, "kiter")).toBeGreaterThan(fit(slowReach, "kiter"));
    expect(fit(slowReach, "kiter")).toBeGreaterThan(fit(plain, "kiter"));
    expect(picks(fast)).toContain("kiter");
    expect(picks(slowReach)).not.toContain("kiter");
    const guard = creature({ level: 3, speeds: { walk: 20 }, defenses: { ac: 25, fortitude: 12, reflex: 6, will: 9 }, shield: { ac: 2 }, actions: [glaive()],
      traits: { tactical: { base: 50, fudge: 0 }, brave: { base: 75, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 70, fudge: 0 } } });
    const chosen = picks(guard);
    expect(chosen).not.toContain("kiter");
    expect(["tank", "brawler"]).toContain(chosen[0]);
  });
});
