/**
 * On a map an area catches only who's in it: within its size of where it spreads from, a cone or a line only toward
 * its target, and none behind a wall. Off the map, anyone (as many as its count says).
 */
import { expect, test } from "vitest";
import { prepareBattle, inArea } from "../scripts/engine/simulator.js";
import { createRun } from "../scripts/engine/battle-state.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const wall = (ax, ay, bx, by) => ({ a: [ax, ay], b: [bx, by], s: 20, d: 0, door: null, open: false });
/** The pyro at 0, its target 10 feet east, and others about. */
function setUp({ positioning = true, walls = null } = {}) {
  const spec = battle([
    creature({ id: "pyro", side: "hostile", position: at(0) }),
    creature({ id: "near", kind: "pc", position: at(10) }),
    creature({ id: "beside", kind: "pc", position: at(15, 5) }),
    creature({ id: "behind", kind: "pc", position: at(-15) }),
    creature({ id: "far", kind: "pc", position: at(10, 200) }),
    creature({ id: "aside", kind: "pc", position: at(10, 25) })
  ], { positioning });
  if ( walls ) spec.walls = walls;
  const run = createRun(prepareBattle(spec, pf2eRules));
  const by = id => run.byId.get(id);
  return { run, catches: (area, id) => inArea(run, by("pyro"), by("near"), by(id), area) };
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
