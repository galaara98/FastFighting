/**
 * A creature plans only around the foes it knows of (senses.js knowsOf): in its senses now, seen before, or come to
 * blows with. A third side out of sight behind a wall, never met, isn't someone it wants to hurt yet.
 */
import { expect, test } from "vitest";
import { beginRun, prepareBattle } from "../scripts/engine/simulator.js";
import { scoreTargets } from "../scripts/engine/behavior/targeting.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const wall = (ax, ay, bx, by) => ({ a: [ax, ay], b: [bx, by], s: 20, d: 0, door: null, open: false });

function setUp() {
  const spec = battle([
    creature({ id: "kobold", side: "hostile", position: at(0), flags: { fearless: true } }),
    creature({ id: "hero", side: "friendly", position: at(10) }),
    creature({ id: "hyena", side: "beasts", position: at(150), flags: { fearless: true } })
  ], { positioning: true, maxRounds: 3 }, {
    friendly: { label: "Party", enemies: ["hostile", "beasts"] },
    hostile: { label: "Kobolds", enemies: ["friendly", "beasts"] },
    beasts: { label: "Hyenas", enemies: ["friendly", "hostile"] }
  });
  spec.walls = [wall(75, -100, 75, 100)];
  const run = beginRun(prepareBattle(spec, pf2eRules), 1, { log: true });
  return { run, by: id => run.byId.get(id) };
}

test("a foe behind a wall it has never seen or fought: not one it wants to hurt", () => {
  const { run, by } = setUp();
  expect(scoreTargets(run, by("kobold")).map(x => x.t.id)).toEqual(["hero"]);
});

test("once seen, or once they've come to blows, it is", () => {
  const seen = setUp();
  seen.by("kobold").seenFoes = new Set(["hyena"]);
  expect(scoreTargets(seen.run, seen.by("kobold")).map(x => x.t.id).sort()).toEqual(["hero", "hyena"]);
  const bitten = setUp();
  bitten.by("kobold").harmedBy.set("hyena", 3);
  expect(scoreTargets(bitten.run, bitten.by("kobold")).map(x => x.t.id).sort()).toEqual(["hero", "hyena"]);
});
