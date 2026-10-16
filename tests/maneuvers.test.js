/**
 * Maneuvers the core knows (maneuvers.js) and forced movement (behavior/forced.js): a helper names its system's own
 * (shove, drag, reposition, trip, grapple ...) and the core plays it; a shove's worth is what it would do where it
 * leaves the foe (off a ledge, into a trap, onto bad ground), so one good at it uses it where it would hurt.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, prepareBattle } from "../scripts/engine/simulator.js";
import { MANEUVERS, MANEUVER_IDS, withManeuver } from "../scripts/engine/maneuvers.js";
import { forcedPath, forcedWorth } from "../scripts/engine/behavior/forced.js";
import { MANEUVERS as STORY_MANEUVERS } from "../scripts/story/master.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const traits = (tactical = 70) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 40, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
const shove = (extra = {}) => ({ id: "shove", name: "Shove", kind: "control", maneuver: "shove", check: { mod: 40, against: "fortitude" }, melee: true, reach: 5, cost: 1, traits: ["attack"], ...extra });
const hero = (extra = {}) => creature({ id: "hero", name: "Hero", traits: traits(), hp: { value: 300, max: 300 }, actions: [strike({ id: "fist", bonus: 10, damage: [parseFormula("1d4", "bludgeoning")] }), shove()], ...at(0), ...extra });
const orc = (x = 5, extra = {}) => creature({ id: "orc", name: "Orc", side: "hostile", traits: traits(40), hp: { value: 60, max: 60 }, actions: [strike({ bonus: -50 })], ...at(x), ...extra });

/** A fight on a map, with the ground as given (cells: [[i, j, cell]]). */
function fight(list, ground = null) {
  const spec = battle(list, { maxRounds: 4, positioning: true, aftermath: "none" });
  if ( ground ) spec.ground = { size: 5, cells: ground };
  const run = beginRun(prepareBattle(spec, pf2eRules), 2, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}
/** A ledge behind the orc: the ground falls away 20 feet from x = 10 on. */
const ledge = (from = 2, depth = -20) => Array.from({ length: 6 }, (_, k) => [from + k, 0, { g: depth }]);

describe("the maneuvers the core knows", () => {
  test("each has outcomes by degree, and a name the story tells; one that names it takes them, one with its own keeps its own", () => {
    for ( const id of MANEUVER_IDS ) {
      expect(MANEUVERS[id].success).toBeTruthy();
      expect(STORY_MANEUVERS).toContain(id);
    }
    const checked = withManeuver({ kind: "control", maneuver: "shove", check: { mod: 5, against: "fortitude" } });
    expect(checked.onHit[2]).toEqual({ move: { kind: "push", feet: 5 } });
    expect(checked.onHit[3]).toEqual({ move: { kind: "push", feet: 10 } });
    expect(checked.onHit[0]).toMatchObject({ self: true, conditions: { prone: 1 } });
    const saved = withManeuver({ kind: "control", maneuver: "trip", save: { type: "reflex", dc: 15 } });
    expect(saved.onSave[1]).toEqual({ conditions: { prone: 1 } });
    expect(saved.onSave[2]).toBeNull();
    const own = { kind: "control", maneuver: "shove", check: { mod: 5 }, onHit: [null, null, { conditions: { prone: 1 } }, null] };
    expect(withManeuver(own)).toBe(own);
  });
});

describe("forced movement", () => {
  test("a shove on open ground: away from the one shoving, 5 feet a step; out of its reach", () => {
    const run = fight([hero(), orc(5)]);
    const [h, o] = ["hero", "orc"].map(id => run.byId.get(id));
    h.adjacent.add("orc");
    o.adjacent.add("hero");
    expect(forcedPath(run, h, o, { kind: "push", feet: 10 })).toMatchObject({ to: { x: 15, y: 0 }, feet: 10, fall: 0 });
  });

  test("a wall behind it stops it; someone standing there too", () => {
    const walled = fight([hero(), orc(5)], [[1, 0, { b: ["e"] }]]);
    expect(forcedPath(walled, walled.byId.get("hero"), walled.byId.get("orc"), { kind: "push", feet: 10 })).toMatchObject({ feet: 0, blocked: true });
    const crowd = fight([hero(), orc(5), creature({ id: "goblin", side: "hostile", ...at(10) })]);
    expect(forcedPath(crowd, crowd.byId.get("hero"), crowd.byId.get("orc"), { kind: "push", feet: 10 })).toMatchObject({ feet: 0, blocked: true });
  });

  test("over a ledge: it falls (1d6 for each 10 feet), lands prone, and the story tells it", () => {
    const run = fight([hero(), orc(5)], ledge());
    const [h, o] = ["hero", "orc"].map(id => run.byId.get(id));
    expect(forcedPath(run, h, o, { kind: "push", feet: 5 })).toMatchObject({ feet: 5, fall: 20 });
    // (Shoved for real: the hero's turn, the shove what it would rather do by the drop.)
    takeTurn(run, h);
    const pushed = run.log.find(e => e.type === "forced" && e.targetId === "orc");
    expect(pushed).toMatchObject({ how: "push", fall: 20 });
    expect(run.log.find(e => e.type === "fall" && e.actorId === "orc")).toMatchObject({ feet: 20 });
    expect(o.hp).toBeLessThan(60);
    expect(o.prone).toBe(true);
  });

  test("into a trap's reach: the trap goes off at it", () => {
    const blades = creature({ id: "trap", name: "Blade Trap", side: "hostile", kind: "hazard", hazard: { once: false }, untargetable: true, speeds: {},
      actions: [strike({ id: "blade", bonus: 40, reach: 5, damage: [parseFormula("4d6", "slashing")] })], ...at(15) });
    const run = fight([hero(), orc(5), blades]);
    const [h, o] = ["hero", "orc"].map(id => run.byId.get(id));
    expect(forcedPath(run, h, o, { kind: "push", feet: 5 }).hazards.map(x => x.id)).toEqual(["trap"]);
    expect(forcedWorth(run, h, o, { kind: "push", feet: 5 })).toBeGreaterThan(forcedWorth(fight([hero(), orc(5)]), h, o, { kind: "push", feet: 5 }));
  });

  test("dragged: toward the one dragging, no closer than beside it; put somewhere: the worst spot in reach", () => {
    const run = fight([hero(), orc(15)]);
    const [h, o] = ["hero", "orc"].map(id => run.byId.get(id));
    expect(forcedPath(run, h, o, { kind: "pull", feet: 10 })).toMatchObject({ to: { x: 5, y: 0 }, feet: 10 });
    const pit = fight([hero(), orc(5)], [[0, 1, { g: -30 }]]);
    const placed = forcedPath(pit, pit.byId.get("hero"), pit.byId.get("orc"), { kind: "place", feet: 5 });
    expect(placed).toMatchObject({ to: { x: 0, y: 5 }, fall: 30 });
  });

  test("grappled: held by it", () => {
    const grab = { id: "grapple", name: "Grapple", kind: "control", maneuver: "grapple", check: { mod: 40, against: "fortitude" }, melee: true, reach: 5, cost: 1, traits: ["attack"] };
    const run = fight([hero({ actions: [grab] }), orc(5)]);
    takeTurn(run, run.byId.get("hero"));
    expect(run.byId.get("orc").grabbedBy).toBe("hero");
  });
});

describe("a shove where it would hurt", () => {
  test("by a drop, one good at it shoves rather than strike; on flat ground, it strikes", () => {
    const shoved = r => r.log.some(e => e.type === "forced" && e.actorId === "hero");
    const byTheEdge = fight([hero(), orc(5)], ledge());
    takeTurn(byTheEdge, byTheEdge.byId.get("hero"));
    expect(shoved(byTheEdge)).toBe(true);
    const flat = fight([hero({ actions: [strike({ id: "axe", bonus: 14, damage: [parseFormula("2d12+6", "slashing")] }), shove()] }), orc(5)]);
    takeTurn(flat, flat.byId.get("hero"));
    expect(flat.log.some(e => e.type === "attack" && e.actorId === "hero")).toBe(true);
  });

  test("the feral hardly see the drop; a Brawler likes it more", () => {
    const run = fight([hero(), orc(5)], ledge());
    const [h, o] = ["hero", "orc"].map(id => run.byId.get(id));
    const sharp = forcedWorth(run, h, o, { kind: "push", feet: 5 });
    h.prep.traits.tactical = 5;
    expect(forcedWorth(run, h, o, { kind: "push", feet: 5 })).toBeLessThan(sharp);
    // (A Brawler's pills: it likes moving a foe where it'll hurt.)
    h.prep.traits.tactical = 70;
    h.spec.behavior = { shoves: 0.5 };
    expect(forcedWorth(run, h, o, { kind: "push", feet: 5 })).toBeCloseTo(sharp * 1.5);
  });
});
