/**
 * Space on the map (behavior/space.js): nobody's move ends in another's space; a melee move takes the nearest free
 * spot within reach, and one with every spot round it taken can't be reached; past a foe the long way round, past a
 * friend freely, as the system says otherwise (passThrough, tumbleThrough, endIn). And sight past the scene's walls: a
 * ranged attacker with no clear line moves to a spot it has one from, a one-way wall and limited walls as Foundry has
 * them, a door shut or open, the cover a target has.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, prepareBattle } from "../scripts/engine/simulator.js";
import { movesNeeded, moveToward, edgeDistance, currentAc, saveRoll, COVER_POINTS } from "../scripts/engine/battle-state.js";
import { inTheWay, spotWithin, lineOfSight, sightBlocked, coverFrom, crossed, pastCost } from "../scripts/engine/behavior/space.js";
import { areEnemies } from "../scripts/engine/battle-state.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const traits = { tactical: { base: 70, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 40, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
const bow = { id: "bow", name: "Bow", kind: "strike", cost: 1, bonus: 9, maps: [0, -5, -10], melee: false, range: { increment: 60, max: 60 }, damage: [{ dice: [{ n: 1, faces: 8, mult: 1 }], flat: 0, type: "piercing", persistent: false, category: null }] };
const who = (id, side, x, y = 0, extra = {}) => creature({ id, name: id, side, traits, hp: { value: 60, max: 60 }, actions: [strike({ bonus: -50 })], ...at(x, y), ...extra });

function fight(list, { rules = pf2eRules, walls = undefined } = {}) {
  const spec = battle(list, { maxRounds: 4, positioning: true, aftermath: "none" });
  if ( walls !== undefined ) spec.walls = walls;
  const run = beginRun(prepareBattle(spec, rules), 2, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}
const get = (run, ...ids) => ids.map(id => run.byId.get(id));
const wall = (ax, ay, bx, by, extra = {}) => ({ a: [ax, ay], b: [bx, by], s: 20, d: 0, door: null, open: false, ...extra });

describe("room", () => {
  test("a melee move never ends in another's space: the nearest free spot within reach instead", () => {
    // (The orc at 20, a goblin already where the hero would stop, at 15.)
    const run = fight([who("hero", "friendly", 0), who("goblin", "friendly", 15), who("orc", "hostile", 20)]);
    const [h, , o] = get(run, "hero", "goblin", "orc");
    expect(inTheWay(run, h, { x: 15, y: 0 })).toBeTruthy();
    moveToward(run, h, o, 5, 30);
    expect(inTheWay(run, h, h.pos)).toBeNull();
    expect(edgeDistance(h, o)).toBeLessThanOrEqual(5.5);
  });

  test("one with every spot round it taken can't be reached up close; with a reach weapon it can", () => {
    const ring = [[-5, -5], [0, -5], [5, -5], [-5, 0], [5, 0], [-5, 5], [0, 5], [5, 5]].map(([x, y], i) => who(`g${i}`, "hostile", 50 + x, y));
    const run = fight([who("hero", "friendly", 0), who("orc", "hostile", 50), ...ring]);
    const [h, o] = get(run, "hero", "orc");
    expect(spotWithin(run, h, o, 5)).toBeNull();
    expect(movesNeeded(run, h, o, strike())).toBe(Infinity);
    expect(Number.isFinite(movesNeeded(run, h, o, strike({ reach: 10 })))).toBe(true);
  });

  test("past a foe on its feet: the long way round; past a friend: freely; as the system says otherwise", () => {
    const run = fight([who("hero", "friendly", 0), who("ally", "friendly", 10), who("orc", "hostile", 20), who("target", "hostile", 40)]);
    const [h, , , t] = get(run, "hero", "ally", "orc", "target");
    const list = crossed(run, h, h.pos, { x: 35, y: 0 }, t);
    expect(list.map(x => x.o.id)).toEqual(["ally", "orc"]);
    expect(pastCost(run, h, list, areEnemies).extra).toBe(5);
    const fivee = fight([who("hero", "friendly", 0), who("ally", "friendly", 10), who("target", "hostile", 40)], { rules: { ...pf2eRules, passThrough: (r, u, o) => (areEnemies(r, u, o) ? "around" : "difficult") } });
    const [h2, , t2] = get(fivee, "hero", "ally", "target");
    expect(pastCost(fivee, h2, crossed(fivee, h2, h2.pos, { x: 35, y: 0 }, t2), areEnemies).extra).toBe(5);
  });

  test("tumbling past: failed, its move stops short of that one", () => {
    const rules = { ...pf2eRules, passThrough: (r, u, o) => (areEnemies(r, u, o) ? "tumble" : null), tumbleThrough: () => ({ success: false, natural: 3, mod: 5, total: 8, dc: 15 }) };
    const run = fight([who("hero", "friendly", 0), who("orc", "hostile", 15), who("target", "hostile", 30)], { rules });
    const [h, o, t] = get(run, "hero", "orc", "target");
    moveToward(run, h, t, 5, 30);
    expect(h.pos.x).toBeLessThan(15);
    expect(inTheWay(run, h, h.pos)).toBeNull();
    expect(run.log.find(e => e.type === "tumble")).toMatchObject({ targetId: "orc", success: false });
    expect(o.pos.x).toBe(15);
  });

  test("ending in another's space, where the system allows it (a Tiny creature)", () => {
    const rules = { ...pf2eRules, endIn: (r, u, o) => o.id === "pixie" };
    const run = fight([who("hero", "friendly", 0), who("pixie", "friendly", 15)], { rules });
    expect(inTheWay(run, run.byId.get("hero"), { x: 15, y: 0 })).toBeNull();
  });
});

describe("sight past walls", () => {
  test("a wall between them: no line of sight; moved to where it has one, it shoots", () => {
    // (A wall from (20,-10) to (20,10): between the archer at 0 and the orc at 40; open ground below it.)
    const walls = [wall(20, -10, 20, 10)];
    const run = fight([who("archer", "friendly", 0, 0, { actions: [bow] }), who("orc", "hostile", 40)], { walls });
    const [a, o] = get(run, "archer", "orc");
    expect(lineOfSight(run, a, o)).toBe(false);
    expect(movesNeeded(run, a, o, bow)).toBeGreaterThanOrEqual(1);
    takeTurn(run, a);
    expect(lineOfSight(run, a, o)).toBe(true);
    expect(run.log.some(e => e.type === "attack" && e.actorId === "archer")).toBe(true);
    // (And no closer than it had to: it didn't walk up to the orc.)
    expect(edgeDistance(a, o)).toBeGreaterThan(10);
  });

  test("in the open, in range: it stays where it is", () => {
    const run = fight([who("archer", "friendly", 0, 0, { actions: [bow] }), who("orc", "hostile", 40)], { walls: [] });
    const [a, o] = get(run, "archer", "orc");
    expect(movesNeeded(run, a, o, bow)).toBe(0);
  });

  test("a one-way wall lets sight through from the side it faces; two limited walls stop it, one doesn't", () => {
    const run = fight([who("a", "friendly", 0), who("b", "hostile", 40)], { walls: [] });
    const p = { x: 0, y: 0 };
    const q = { x: 40, y: 0 };
    const oneWay = d => fight([who("a", "friendly", 0), who("b", "hostile", 40)], { walls: [wall(20, -10, 20, 10, { d })] });
    // (Foundry's rule: it lets sight through when the viewer is on the side it names.)
    const blocks = [1, 2].map(d => sightBlocked(oneWay(d), p, q));
    expect(blocks.filter(Boolean)).toHaveLength(1);
    expect(sightBlocked(oneWay(1), p, q)).not.toBe(sightBlocked(oneWay(1), q, p));
    const limited = n => fight([who("a", "friendly", 0), who("b", "hostile", 40)], { walls: Array.from({ length: n }, (_, i) => wall(15 + 10 * i, -10, 15 + 10 * i, 10, { s: 10 })) });
    expect(sightBlocked(limited(1), p, q)).toBe(false);
    expect(sightBlocked(limited(2), p, q)).toBe(true);
    expect(sightBlocked(run, p, q)).toBe(false);
  });

  test("a door: shut, it stops sight; opened in the fight, not", () => {
    const run = fight([who("a", "friendly", 0), who("b", "hostile", 40)], { walls: [wall(20, -10, 20, 10, { door: "d1" })] });
    const [a, b] = get(run, "a", "b");
    expect(lineOfSight(run, a, b)).toBe(false);
    run.doors.set("d1", { open: true });
    run.geo = (run.geo ?? 0) + 1;
    expect(lineOfSight(run, a, b)).toBe(true);
  });

  test("cover the system has no rule for: three quarters of it hidden or more, a little more AC and saves against that one; none for less", () => {
    // (A wall hiding the orc's upper corners and middle: three of its five points.)
    const walls = [wall(20, -20, 20, 0.5)];
    const run = fight([who("archer", "friendly", 0), who("orc", "hostile", 40)], { walls });
    const [a, o] = get(run, "archer", "orc");
    expect(coverFrom(run, a, o)).toBe("most");
    expect(currentAc(run, o, a, bow) - o.spec.defenses.ac).toBe(COVER_POINTS);
    expect(saveRoll(run, o, "reflex", { from: a }).mod - saveRoll(run, o, "reflex").mod).toBe(COVER_POINTS);
    // (A system with its own: none of the core's; its rules see the cover.)
    const seen = [];
    const own = fight([who("archer", "friendly", 0), who("orc", "hostile", 40)], { walls, rules: { ...pf2eRules, handlesCover: true, modifiers: { ...pf2eRules.modifiers, defense: ctx => (seen.push(ctx.cover), 0) } } });
    const [a2, o2] = get(own, "archer", "orc");
    expect(currentAc(own, o2, a2, bow)).toBe(o2.spec.defenses.ac);
    expect(seen).toContain("most");
    // (Some of it only: nothing more.)
    const some = fight([who("archer", "friendly", 0), who("orc", "hostile", 40)], { walls: [wall(20, -20, 20, -0.5)] });
    const [a3, o3] = get(some, "archer", "orc");
    expect(currentAc(some, o3, a3, bow)).toBe(o3.spec.defenses.ac);
  });

  test("cover: some of it hidden behind a wall's end", () => {
    // (A wall up to the line between them, hiding the orc's upper corners only.)
    const run = fight([who("archer", "friendly", 0), who("orc", "hostile", 40)], { walls: [wall(20, -20, 20, -0.5)] });
    const [a, o] = get(run, "archer", "orc");
    expect(lineOfSight(run, a, o)).toBe(true);
    expect(coverFrom(run, a, o)).toBe("some");
  });
});
