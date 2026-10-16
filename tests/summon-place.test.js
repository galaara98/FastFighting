/**
 * Where a summoning's creatures appear (behavior/summons.js appearAt): in the nearest space no one's in to where each
 * would want to be, beside the foe it would go for (within the summoning's range, in the summoner's sight), else
 * beside the summoner; never in anyone's space.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, prepareBattle } from "../scripts/engine/simulator.js";
import { callSummons } from "../scripts/engine/behavior/summons.js";
import { inTheWay } from "../scripts/engine/behavior/space.js";
import { edgeDistance } from "../scripts/engine/battle-state.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
const wolf = { name: "Summoned Wolf", level: 1, hp: { value: 18, max: 18 }, defenses: { ac: 15, fortitude: 6, reflex: 7, will: 4 }, initiative: { mod: 5 }, speeds: { walk: 35 },
  actions: [strike({ id: "jaws", name: "Jaws", bonus: 7, damage: [parseFormula("1d6+2", "piercing")] })], iwr: {}, diesAtZero: true };
const summon = (extra = {}) => ({ id: "summon-animal", name: "Summon Animal", kind: "summon", cost: 3, creatures: [wolf, wolf, wolf], rounds: 10, ...extra });

function called(list, { walls, action = summon() } = {}) {
  const druid = creature({ id: "druid", name: "Druid", kind: "pc", hp: { value: 50, max: 50 }, actions: [strike(), action], ...at(0) });
  const spec = battle([druid, ...list], { maxRounds: 3, positioning: true, aftermath: "none" });
  if ( walls ) spec.walls = walls;
  const run = beginRun(prepareBattle(spec, pf2eRules), 1, { log: true });
  beginRound(run, 1);
  const d = run.byId.get("druid");
  return { run, wolves: callSummons(run, d, d.spec.actions.find(a => a.kind === "summon")) };
}
const ogre = (x, y = 0) => creature({ id: `ogre${x}`, name: "Ogre", side: "hostile", hp: { value: 80, max: 80 }, ...at(x, y) });

describe("where summoned creatures appear", () => {
  test("beside the foe they'd go for, within range: each in a space of its own", () => {
    const { run, wolves } = called([ogre(25)]);
    const o = run.byId.get("ogre25");
    for ( const w of wolves ) {
      expect(inTheWay(run, w, w.pos)).toBeNull();
      expect(edgeDistance(w, o)).toBeLessThanOrEqual(5.5);
    }
    expect(new Set(wolves.map(w => `${w.pos.x},${w.pos.y}`)).size).toBe(3);
  });

  test("a foe beyond the summoning's range: beside the summoner, nobody's space taken", () => {
    const { run, wolves } = called([ogre(80), creature({ id: "friend", name: "Friend", ...at(5) })]);
    const d = run.byId.get("druid");
    for ( const w of wolves ) {
      expect(inTheWay(run, w, w.pos)).toBeNull();
      expect(edgeDistance(w, d)).toBeLessThanOrEqual(15);
    }
  });

  test("a foe behind a wall the summoner can't see past: beside the summoner, on its side", () => {
    const walls = [{ a: [15, -30], b: [15, 30], s: 20, d: 0, door: null, open: false }];
    const { wolves } = called([ogre(25)], { walls });
    for ( const w of wolves ) expect(w.pos.x).toBeLessThan(15);
  });

  test("its own range, farther off", () => {
    const { run, wolves } = called([ogre(80)], { action: summon({ range: { increment: 100, max: 100 } }) });
    const o = run.byId.get("ogre80");
    for ( const w of wolves ) expect(edgeDistance(w, o)).toBeLessThanOrEqual(10.5);
  });
});
