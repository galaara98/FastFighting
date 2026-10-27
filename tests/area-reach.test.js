/**
 * On a map an area catches only who's in it: within its size of where it spreads from, a cone or a line only toward
 * its target, and none behind a wall. Off the map, anyone (as many as its count says).
 */
import { expect, test } from "vitest";
import { prepareBattle, inArea, replay } from "../scripts/engine/simulator.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { createRun, burstPoint, friendsInArea } from "../scripts/engine/battle-state.js";
import { areaTargets, LONE_COSTLY_AREA, CROWDED_AREA } from "../scripts/engine/behavior/evaluate.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const wall = (ax, ay, bx, by) => ({ a: [ax, ay], b: [bx, by], s: 20, d: 0, door: null, open: false });
/** The pyro at 0, its target 10 feet east, and others about. */
function setUp({ positioning = true, walls = null, tactical = 50, more = [] } = {}) {
  const spec = battle([
    creature({ id: "pyro", side: "hostile", position: at(0), traits: { tactical: { base: tactical, fudge: 0 }, brave: { base: 50, fudge: 0 }, selfish: { base: 50, fudge: 0 }, loyal: { base: 50, fudge: 0 } } }),
    creature({ id: "near", kind: "pc", position: at(10) }),
    creature({ id: "beside", kind: "pc", position: at(15, 5) }),
    creature({ id: "behind", kind: "pc", position: at(-15) }),
    creature({ id: "far", kind: "pc", position: at(10, 200) }),
    creature({ id: "aside", kind: "pc", position: at(10, 25) }),
    ...more
  ], { positioning });
  if ( walls ) spec.walls = walls;
  const run = createRun(prepareBattle(spec, pf2eRules));
  const by = id => run.byId.get(id);
  return { run, by, catches: (area, id) => inArea(run, by("pyro"), by("near"), by(id), area) };
}

test("a cone: in front of the caster, within its length", () => {
  const { catches } = setUp();
  const cone = { targets: 4, shape: "cone", feet: 30 };
  expect(catches(cone, "beside")).toBe(true);
  expect(catches(cone, "behind")).toBe(false);
  expect(catches(cone, "far")).toBe(false);
  expect(catches(cone, "aside")).toBe(false); // (off to the side: outside its quarter turn)
});

test("a line: 5 feet across, toward the target", () => {
  const { catches } = setUp();
  const line = { targets: 3, shape: "line", feet: 60 };
  expect(catches(line, "beside")).toBe(true);
  expect(catches(line, "aside")).toBe(false);
  expect(catches(line, "behind")).toBe(false);
});

test("a cone as wide as the system says (5e: 53 degrees); a line as wide; a cube, one face against the caster", () => {
  const { catches } = setUp({ more: [creature({ id: "slant", kind: "pc", position: at(20, 12) }), creature({ id: "past", kind: "pc", position: at(25) })] });
  expect(catches({ shape: "cone", feet: 30 }, "slant")).toBe(true); // (31 degrees off: inside a quarter turn)
  expect(catches({ shape: "cone", feet: 30, angle: 53.13 }, "slant")).toBe(false);
  expect(catches({ shape: "cone", feet: 30, angle: 53.13 }, "beside")).toBe(true);
  expect(catches({ shape: "line", feet: 60, width: 60 }, "aside")).toBe(true);
  const cube = { shape: "cube", feet: 15 };
  expect(catches(cube, "near")).toBe(true);
  expect(catches(cube, "beside")).toBe(true);
  expect(catches(cube, "past")).toBe(false); // (beyond its far face)
  expect(catches(cube, "aside")).toBe(false);
  expect(catches(cube, "behind")).toBe(false);
});

test("a square: so many feet on a side round its target, its sides along the map's", () => {
  const { catches } = setUp();
  const square = { shape: "square", feet: 20 };
  expect(catches(square, "near")).toBe(true);
  expect(catches(square, "beside")).toBe(true); // (15, 5): 5 feet off on each side, inside its 10 and its own half
  expect(catches(square, "behind")).toBe(false);
  expect(catches(square, "aside")).toBe(false);
});

test("a burst: around its target, 10 feet when the system doesn't say", () => {
  const { catches } = setUp();
  expect(catches({ targets: 4 }, "beside")).toBe(true);
  expect(catches({ targets: 4 }, "behind")).toBe(false);
  expect(catches({ targets: 4, shape: "burst", feet: 30 }, "aside")).toBe(true);
});

test("a wall wholly between stops it; off the map, anyone", () => {
  const walled = setUp({ walls: [wall(12.5, -20, 12.5, 20)] });
  expect(walled.catches({ targets: 4, shape: "emanation", feet: 30 }, "beside")).toBe(false);
  expect(setUp({ positioning: false }).catches({ targets: 4, shape: "cone", feet: 15 }, "far")).toBe(true);
});

test("a creature that thinks it through counts who an area would really catch, and holds back a costly one for more", () => {
  const sharp = setUp({ tactical: 80 });
  const cone = { targets: 4, shape: "cone", feet: 30 };
  const breath = { id: "b", kind: "save", area: cone, resource: "slot1" };
  // (Aimed at near: near and beside caught, two of them.)
  expect(areaTargets(sharp.run, sharp.by("pyro"), breath, sharp.by("near"))).toBe(2);
  // (Aimed at behind: behind alone; a spell slot spent on one, a little less worth it.)
  expect(areaTargets(sharp.run, sharp.by("pyro"), breath, sharp.by("behind"))).toBeCloseTo(LONE_COSTLY_AREA, 6);
  // (Free to use: just the one, no holding back.)
  expect(areaTargets(sharp.run, sharp.by("pyro"), { ...breath, resource: null }, sharp.by("behind"))).toBe(1);
  // (A burst of 30 feet on near: near, beside, aside and behind, four of them: well worth it, but for the pyro in it
  // too: three. Selective, sparing itself: well worth it.)
  expect(areaTargets(sharp.run, sharp.by("pyro"), { ...breath, area: { targets: 4, shape: "burst", feet: 30 } }, sharp.by("near"))).toBe(3);
  expect(areaTargets(sharp.run, sharp.by("pyro"), { ...breath, area: { targets: 4, shape: "burst", feet: 30, selective: true } }, sharp.by("near"))).toBeCloseTo(4 * CROWDED_AREA, 6);
  // (One that doesn't think it through: as many as the area takes, wherever it's aimed.)
  const dull = setUp({ tactical: 30 });
  expect(areaTargets(dull.run, dull.by("pyro"), breath, dull.by("behind"))).toBe(4);
});

test("a burst goes off at a corner of its target's space: 5 feet across a corner is four squares", () => {
  // (On the grid: squares' middles at 2.5, 7.5 ... The foe at (7.5, 7.5); others in the squares about it.)
  const spec = battle([
    creature({ id: "pyro", side: "hostile", position: at(57.5, 7.5), traits: { tactical: { base: 80, fudge: 0 }, brave: { base: 50, fudge: 0 }, selfish: { base: 50, fudge: 0 }, loyal: { base: 50, fudge: 0 } } }),
    creature({ id: "t", kind: "pc", position: at(7.5, 7.5) }),
    creature({ id: "east", kind: "pc", position: at(12.5, 7.5) }),
    creature({ id: "south", kind: "pc", position: at(7.5, 12.5) }),
    creature({ id: "corner", kind: "pc", position: at(12.5, 12.5) }),
    creature({ id: "west", kind: "pc", position: at(2.5, 7.5) })
  ], { positioning: true });
  const run = createRun(prepareBattle(spec, pf2eRules));
  const by = id => run.byId.get(id);
  const column = { targets: 4, shape: "burst", feet: 5 }; // (10 feet across: PF2e's Scorching Column)
  const caught = ["t", "east", "south", "corner", "west"].filter(id => inArea(run, by("pyro"), by("t"), by(id), column));
  // (The corner between t, east, south and corner: four foes, not t alone; west is left out.)
  expect(caught).toEqual(["t", "east", "south", "corner"]);
  expect(burstPoint(run, by("pyro"), by("t"), column)).toEqual({ x: 10, y: 10 });
});

test("an area on the map catches its maker's friends in it, unless it's selective; a careful one won't aim it so", () => {
  const ally = creature({ id: "ally", side: "hostile", position: at(15, 5) });
  const sharp = setUp({ tactical: 80, more: [ally] });
  const burst = { targets: 4, shape: "burst", feet: 10 };
  const pyro = sharp.by("pyro");
  expect(friendsInArea(sharp.run, pyro, sharp.by("near"), burst).map(o => o.id)).toContain("ally");
  expect(friendsInArea(sharp.run, pyro, sharp.by("near"), { ...burst, selective: true })).toEqual([]);
  // (A cone spreads from its maker: never itself.)
  expect(friendsInArea(sharp.run, pyro, sharp.by("near"), { targets: 4, shape: "cone", feet: 30 }).map(o => o.id)).not.toContain("pyro");
  // (Off the map: no one but foes, as many as it takes.)
  expect(friendsInArea(setUp({ positioning: false, more: [ally] }).run, pyro, sharp.by("near"), burst)).toEqual([]);
  const fireball = { id: "f", kind: "save", area: burst, resource: "slot1" };
  expect(areaTargets(sharp.run, pyro, fireball, sharp.by("near"))).toBeLessThan(areaTargets(sharp.run, pyro, { ...fireball, area: { ...burst, selective: true } }, sharp.by("near")));
});

test("in a fight, a burst lands on everyone in it: the foe beside the target and the maker's friend standing there", () => {
  const fireball = { id: "fb", name: "Fireball", kind: "save", cost: 2, rank: 3, magical: true, save: { type: "reflex", dc: 40, basic: true },
    damage: [parseFormula("6d6", "fire")], range: { increment: 500, max: 500, noPenalty: true }, area: { targets: 4, shape: "burst", feet: 10 } };
  const dull = { tactical: { base: 0, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 50, fudge: 0 }, loyal: { base: 50, fudge: 0 } };
  const spec = battle([
    creature({ id: "pyro", side: "hostile", position: at(102.5, 7.5), actions: [fireball], traits: dull, flags: { fearless: true } }),
    creature({ id: "t", kind: "pc", position: at(7.5, 7.5), hp: { value: 500, max: 500, temp: 0 }, actions: [] }),
    creature({ id: "ogre", side: "hostile", position: at(12.5, 7.5), hp: { value: 500, max: 500, temp: 0 }, actions: [], flags: { fearless: true } })
  ], { positioning: true, maxRounds: 1 });
  let friendly = 0;
  for ( let seed = 1; seed <= 10; seed++ ) {
    const { log } = replay(spec, pf2eRules, seed);
    const hit = log.filter(e => e.actorId === "pyro" && e.actionId === "fb" || (e.actorId === "pyro" && e.action === "Fireball"));
    if ( hit.some(e => e.targetId === "ogre") ) friendly += 1;
  }
  expect(friendly).toBeGreaterThan(0);
});
