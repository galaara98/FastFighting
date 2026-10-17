/**
 * On a map an area catches only who's in it: within its size of where it spreads from, a cone or a line only toward
 * its target, and none behind a wall. Off the map, anyone (as many as its count says).
 */
import { expect, test } from "vitest";
import { prepareBattle, inArea } from "../scripts/engine/simulator.js";
import { createRun } from "../scripts/engine/battle-state.js";
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
  // (A burst of 30 feet on near: near, beside, aside and behind, four of them: well worth it.)
  expect(areaTargets(sharp.run, sharp.by("pyro"), { ...breath, area: { targets: 4, shape: "burst", feet: 30 } }, sharp.by("near"))).toBeCloseTo(4 * CROWDED_AREA, 6);
  // (One that doesn't think it through: as many as the area takes, wherever it's aimed.)
  const dull = setUp({ tactical: 30 });
  expect(areaTargets(dull.run, dull.by("pyro"), breath, dull.by("behind"))).toBe(4);
});
