/**
 * What a maneuver's result can do, wherever it comes from (a control action's degree, a deed, a rider): a grab the
 * target can't take refused, a grab as long as what it laid, broken with what it laid; damage at one degree only; a
 * botch that moves the one who tried it; a blow's rider that pushes; a failed save's push; a fall's prone as the system
 * says; a collision; a push until so far off; re-grabbing one it holds worth nothing.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, endOfTurn, prepareBattle } from "../scripts/engine/simulator.js";
import { outcomeWorth } from "../scripts/engine/behavior/effects.js";
import { holdsOf, release } from "../scripts/engine/behavior/holds.js";
import { forcedPath } from "../scripts/engine/behavior/forced.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const traits = { tactical: { base: 70, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 40, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
/** A maneuver that always lands critically (an Athletics of +60). */
const sure = (extra = {}) => ({ id: "move", name: "Move", kind: "control", check: { mod: 60, against: "fortitude" }, melee: true, reach: 5, cost: 1, traits: ["attack"], ...extra });
const hero = (actions, extra = {}) => creature({ id: "hero", name: "Hero", traits, hp: { value: 300, max: 300 }, actions, ...at(0), ...extra });
const orc = (extra = {}) => creature({ id: "orc", name: "Orc", side: "hostile", traits, hp: { value: 60, max: 60 }, actions: [strike({ bonus: -50 })], ...at(5), ...extra });

function fight(list, { rules = pf2eRules, ground = null, positioning = true } = {}) {
  const spec = battle(list, { maxRounds: 4, positioning, aftermath: "none" });
  if ( ground ) spec.ground = { size: 5, cells: ground };
  const run = beginRun(prepareBattle(spec, rules), 2, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}
const ids = run => ["hero", "orc"].map(id => run.byId.get(id));

describe("grabs", () => {
  test("re-grabbing one it already holds is worth only what else it lays", () => {
    const run = fight([hero([strike()]), orc({ actions: [strike({ bonus: 12 })] })]);
    const [h, o] = ids(run);
    expect(outcomeWorth(run, h, o, { grab: true })).toBeLessThan(0);
    o.grabbedBy = h.id;
    expect(outcomeWorth(run, h, o, { grab: true })).toBe(0);
  });

  test("one that can't be grabbed isn't: a maneuver's, a rider's", () => {
    const slippery = { iwr: { immune: ["grabbed"] } };
    const run = fight([hero([sure({ onHit: [null, null, { grab: true }, { grab: true }] })]), orc(slippery)]);
    takeTurn(run, run.byId.get("hero"));
    expect(run.byId.get("orc").grabbedBy).toBeFalsy();
    const bite = fight([hero([strike({ bonus: 60, damage: [parseFormula("1", "piercing")], effects: [{ kind: "grabbed" }] })]), orc(slippery)]);
    takeTurn(bite, bite.byId.get("hero"));
    expect(bite.byId.get("orc").grabbedBy).toBeFalsy();
  });

  test("a grab lasts as long as what it laid with it; broken free, what it laid goes too", () => {
    const run = fight([hero([sure({ onHit: [null, null, { grab: true, conditions: { grabbed: 1 }, rounds: 1 }, { grab: true, conditions: { restrained: 1 }, rounds: 1 }] })]), orc()]);
    const [h, o] = ids(run);
    takeTurn(run, h);
    expect(o.grabbedBy).toBe("hero");
    expect(o.conds.restrained).toBe(1);
    endOfTurn(run, o);
    expect(o.grabbedBy).toBeNull();
    // (Held longer, and broken free: the restrained laid with it goes.)
    const held = fight([hero([sure({ onHit: [null, null, { grab: true }, { grab: true, conditions: { restrained: 1 }, rounds: 5 }] })]), orc()]);
    const [h2, o2] = ids(held);
    takeTurn(held, h2);
    release(held, o2, holdsOf(held, o2).find(x => x.key === "grabbed"));
    expect(o2.grabbedBy).toBeNull();
    expect(o2.conds.restrained).toBeUndefined();
  });
});

describe("a degree's own damage, a botch that moves, a blow that pushes", () => {
  test("damage only at the degree that has it (a critical Trip's 1d6)", () => {
    const run = fight([hero([sure({ onHit: [null, null, { conditions: { prone: 1 } }, { conditions: { prone: 1 }, damage: [parseFormula("6", "bludgeoning")] }] })]), orc()]);
    const [h, o] = ids(run);
    takeTurn(run, h);
    expect(o.hp).toBeLessThan(60);
    expect(run.log.find(e => e.type === "control")).toMatchObject({ degree: 3 });
  });

  test("a botch that moves: the target moves the one who tried it", () => {
    const run = fight([hero([sure({ check: { mod: -60, against: "fortitude" }, onHit: [{ self: true, move: { kind: "push", feet: 10 } }, null, null, null] })]), orc()]);
    const [h] = ids(run);
    takeTurn(run, h);
    expect(run.log.find(e => e.type === "forced")).toMatchObject({ targetId: "hero", actorId: "orc" });
    expect(h.pos.x).toBeLessThan(0);
  });

  test("a botched Grapple: the foe has hold of the one who tried", () => {
    const run = fight([hero([sure({ check: { mod: -60, against: "fortitude" }, onHit: [{ self: true, grab: true }, null, { grab: true }, { grab: true }] })]), orc()]);
    const [h] = ids(run);
    takeTurn(run, h);
    expect(h.grabbedBy).toBe("orc");
  });

  test("a paid rider's push lands (5e Thunderous Smite), and a crit table's knockback row (DCC)", () => {
    const smite = { id: "smite", label: "Smite", when: "hit", melee: true, damage: [parseFormula("6", "thunder")], outcome: { move: { kind: "push", feet: 10 } } };
    const run = fight([hero([strike({ bonus: 60, damage: [parseFormula("1", "slashing")] })], { riders: [smite] }), orc()]);
    takeTurn(run, run.byId.get("hero"));
    expect(run.log.some(e => e.type === "forced" && e.targetId === "orc")).toBe(true);
    const crit = { die: parseFormula("1", "untyped"), mod: 0, rows: [{ lo: 0, hi: 99, outcome: { move: { kind: "push", feet: 10 }, label: "Hurled back" } }] };
    const thrown = fight([hero([strike({ bonus: 60, damage: [parseFormula("1", "slashing")] })], { crit }), orc()]);
    takeTurn(thrown, thrown.byId.get("hero"));
    expect(thrown.log.some(e => e.type === "forced" && e.targetId === "orc")).toBe(true);
  });

  test("a reaction to being hurt knocks the one who did it back (Vengeful Fate)", () => {
    const fate = { id: "fate", label: "Vengeful Fate", on: "damaged", move: { kind: "push", feet: 10 } };
    const run = fight([hero([strike({ bonus: 60, cost: 3, damage: [parseFormula("3", "slashing")] })]), orc({ reactions: [fate] })]);
    takeTurn(run, run.byId.get("hero"));
    expect(run.log.some(e => e.type === "forced" && e.targetId === "hero" && e.actorId === "orc")).toBe(true);
  });

  test("direct damage, every part of it, is told to the system", () => {
    const told = [];
    const rules = { ...pf2eRules, applyIwr: (iwr, byType, t, opts) => (told.push(!!opts?.direct), Object.values(byType).reduce((s, v) => s + v, 0)) };
    const run = fight([hero([strike({ bonus: 60, cost: 3, damage: [{ ...parseFormula("3", "slashing"), direct: true }] })]), orc()], { rules });
    takeTurn(run, run.byId.get("hero"));
    expect(told).toContain(true);
  });

  test("a rider's failed save that kills outright (a death poison); one immune to the rider's kind spared it, save and all", () => {
    const venom = [{ kind: "save", save: { type: "fortitude", dc: 99 }, slay: true, traits: ["poison"], label: "Poison" }];
    const deadly = fight([hero([strike({ bonus: 60, damage: [parseFormula("1", "piercing")], effects: venom })]), orc()]);
    takeTurn(deadly, deadly.byId.get("hero"));
    expect(deadly.byId.get("orc").status).toBe("dead");
    expect(deadly.log.some(e => e.type === "riderSave" && e.degree <= 1)).toBe(true);
    const golem = fight([hero([strike({ bonus: 60, damage: [parseFormula("1", "piercing")], effects: venom })]), orc({ iwr: { immune: ["poison"], resist: {}, weak: {} } })]);
    takeTurn(golem, golem.byId.get("hero"));
    expect(golem.byId.get("orc").status).not.toBe("dead");
    expect(golem.log.some(e => e.type === "riderSave")).toBe(false);
  });

  test("a blow's rider pushes; a failed save's push too", () => {
    const smite = fight([hero([strike({ bonus: 60, damage: [parseFormula("1", "thunder")], effects: [{ kind: "move", move: { kind: "push", feet: 10 } }] })]), orc()]);
    takeTurn(smite, smite.byId.get("hero"));
    expect(smite.log.some(e => e.type === "forced" && e.targetId === "orc")).toBe(true);
    const wave = fight([hero([strike({ bonus: 60, damage: [parseFormula("1", "thunder")], effects: [{ kind: "save", save: { type: "fortitude", dc: 99 }, move: { kind: "push", feet: 10 } }] })]), orc()]);
    takeTurn(wave, wave.byId.get("hero"));
    expect(wave.log.some(e => e.type === "forced" && e.targetId === "orc")).toBe(true);
  });
});

describe("where it's moved to", () => {
  const ledge = Array.from({ length: 6 }, (_, k) => [2 + k, 0, { g: -20 }]);
  const shove = sure({ maneuver: "shove", onHit: [null, null, { move: { kind: "push", feet: 5 } }, { move: { kind: "push", feet: 5 } }] });

  test("a fall's prone, as the system says (5e: only if it hurt)", () => {
    const rules = { ...pf2eRules, fallDamage: () => [], fallProne: (t, dealt) => dealt > 0 };
    const run = fight([hero([shove]), orc()], { rules, ground: ledge });
    takeTurn(run, run.byId.get("hero"));
    expect(run.log.some(e => e.type === "fall")).toBe(true);
    expect(run.byId.get("orc").prone).toBeFalsy();
  });

  test("against a wall: the system's collision", () => {
    const rules = { ...pf2eRules, collisionDamage: () => [parseFormula("7", "bludgeoning")] };
    const run = fight([hero([shove]), orc()], { rules, ground: [[1, 0, { b: ["e"] }]] });
    takeTurn(run, run.byId.get("hero"));
    const hits = run.log.filter(e => e.type === "collision");
    expect(hits[0]).toMatchObject({ amount: 7 });
    expect(run.byId.get("orc").hp).toBe(60 - 7 * hits.length);
  });

  test("pushed until it's that far off", () => {
    // (Beside it, 5 feet off: 15 more to be 20 off; already farther, nowhere.)
    const run = fight([hero([strike()]), orc()]);
    const [h, o] = ids(run);
    expect(forcedPath(run, h, o, { kind: "push", to: 20 })).toMatchObject({ feet: 15 });
    const far = fight([hero([strike()]), orc({ ...at(25) })]);
    expect(forcedPath(far, ...ids(far), { kind: "push", to: 10 })).toMatchObject({ feet: 0 });
  });
});

describe("an action that lays its user open (provokes)", () => {
  test("every foe in reach strikes as it's taken, whatever the system's openings; a plain blow invites nothing", () => {
    const rules = { ...pf2eRules, opportunityOn: [], opportunity: (e) => (e.spec.actions ?? []).find(a => a.kind === "strike") ?? null };
    const wild = fight([hero([strike({ bonus: 60, damage: [parseFormula("1", "slashing")], provokes: true })]), orc()], { rules });
    takeTurn(wild, wild.byId.get("hero"));
    expect(wild.log.some(e => e.type === "opportunity" && e.targetId === "hero" && e.trigger === "provoked")).toBe(true);
    const plain = fight([hero([strike({ bonus: 60, damage: [parseFormula("1", "slashing")] })]), orc()], { rules });
    takeTurn(plain, plain.byId.get("hero"));
    expect(plain.log.some(e => e.type === "opportunity")).toBe(false);
  });
});
