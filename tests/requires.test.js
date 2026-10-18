/**
 * What an action needs first (action.requires, behavior/requires.js): two hits in a row on one foe (a rend), its last
 * action a hit (a bite that follows one), a foe it holds (a constrict), a condition on its target or on itself, a
 * shield raised; and what an option sets up, weighed by the Statistics Engine.
 */
import { describe, expect, test } from "vitest";
import { replay, beginRun, prepareBattle } from "../scripts/engine/simulator.js";
import { meets, noteBlow, freshTurn, setupUsed, followUpWorth, hasCondition, holds, requirementsOf } from "../scripts/engine/behavior/requires.js";
import { bestOptionVs, chooseTarget } from "../scripts/engine/behavior/targeting.js";
import { threatOf } from "../scripts/engine/behavior/evaluate.js";
import { typicalValue } from "../scripts/engine/tactics.js";
import { Turn } from "../scripts/engine/turn.js";
import { STATUS } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const dummy = (over = {}) => creature({ id: "dummy", side: "hostile", hp: { value: 900, max: 900 }, flags: { fearless: true }, defenses: { ac: 15, fortitude: 5, reflex: 5, will: 5 },
  actions: [strike({ bonus: 0, damage: [parseFormula("1", "bludgeoning")] })], ...over });
// (A claw that hits a typical foe most of the time, less after a blow or two.)
const claw = (over = {}) => strike({ id: "claw", name: "Claw", bonus: 10, maps: [0, -4, -8], damage: [parseFormula("1d8+4", "slashing")], ...over });
const rend = { id: "rend", name: "Rend", kind: "auto", cost: 1, melee: true, reach: 5, damage: [parseFormula("1d8+4", "slashing")], requires: { hits: { n: 2, with: ["claw"] } } };
const byActor = (r, who) => r.log.filter(e => e.actor === who && ["attack", "auto", "save"].includes(e.type));

/** A run with u acting, its turn begun (the simulator's own order: requires.js counts what it pays for). */
function acting(spec, id, seed = 1) {
  const run = beginRun(prepareBattle(spec, pf2eRules), seed);
  const u = run.byId.get(id);
  run.acting = u;
  u.turn = new Turn(pf2eRules, u);
  freshTurn(u);
  return { run, u };
}

describe("the vocabulary", () => {
  test("an object, or a list of them (any will do); none at all is always met", () => {
    expect(requirementsOf({})).toBeNull();
    expect(requirementsOf({ requires: { holding: true } })).toHaveLength(1);
    expect(requirementsOf({ requires: [{ holding: true }, { lastHit: true }] })).toHaveLength(2);
    const { run, u } = acting(battle([creature({ id: "beast" }), dummy()]), "beast");
    expect(meets(run, u, strike(), run.byId.get("dummy"))).toBe(true);
  });

  test("holding: only the foe it has grabbed, or holds with something it laid", () => {
    const squeeze = { id: "squeeze", kind: "save", cost: 1, melee: true, reach: 5, save: { type: "fortitude", dc: 20, basic: true }, damage: [parseFormula("2d6", "bludgeoning")], requires: { holding: true } };
    const { run, u } = acting(battle([creature({ id: "snake", actions: [strike(), squeeze] }), dummy(), dummy({ id: "other" })]), "snake");
    const [d, o] = ["dummy", "other"].map(id => run.byId.get(id));
    expect(meets(run, u, squeeze, d)).toBe(false);
    d.grabbedBy = u.id;
    expect(holds(u, d)).toBe(true);
    expect(meets(run, u, squeeze, d)).toBe(true);
    expect(meets(run, u, squeeze, o)).toBe(false);
    o.effects.push({ sourceId: u.id, conditions: { restrained: 1 }, escape: { dc: 20 } });
    expect(meets(run, u, squeeze, o)).toBe(true);
  });

  test("target: one of the conditions, unconscious counting one down at 0", () => {
    const drink = { id: "drink", kind: "auto", cost: 1, melee: true, reach: 5, damage: [parseFormula("1d6", "void")], requires: { target: ["paralyzed", "unconscious", "prone"] } };
    const { run, u } = acting(battle([creature({ id: "vampire", actions: [strike(), drink] }), dummy()]), "vampire");
    const d = run.byId.get("dummy");
    expect(meets(run, u, drink, d)).toBe(false);
    d.prone = true;
    expect(meets(run, u, drink, d)).toBe(true);
    d.prone = false;
    d.status = STATUS.DOWN;
    expect(hasCondition(run, d, "unconscious")).toBe(true);
    expect(meets(run, u, drink, d)).toBe(true);
  });

  test("self and shieldRaised: what it needs of itself", () => {
    const slices = { ...strike({ id: "slices" }), requires: { self: ["hidden"] } };
    const bash = { ...strike({ id: "bash" }), requires: { shieldRaised: true } };
    const { run, u } = acting(battle([creature({ id: "rogue", shield: { ac: 2 }, actions: [strike(), slices, bash] }), dummy()]), "rogue");
    const d = run.byId.get("dummy");
    expect(meets(run, u, slices, d)).toBe(false);
    u.conds.invisible = 1;
    expect(meets(run, u, slices, d)).toBe(true);
    expect(meets(run, u, bash, d)).toBe(false);
    u.shieldRaised = true;
    expect(meets(run, u, bash, d)).toBe(true);
  });

  test("lastHit: only straight after a hit with the Strike it names, at the foe it hit", () => {
    const bite = strike({ id: "jaws", name: "Jaws" });
    const follow = { id: "wicked", kind: "auto", cost: 1, melee: true, reach: 5, damage: [parseFormula("2d6", "piercing")], requires: { lastHit: { with: ["jaws"] } } };
    const { run, u } = acting(battle([creature({ id: "urdefhan", actions: [bite, claw(), follow] }), dummy(), dummy({ id: "other" })]), "urdefhan");
    const [d, o] = ["dummy", "other"].map(id => run.byId.get(id));
    noteBlow(run, u, bite, d, 2);
    u.turn.spend(1);
    expect(meets(run, u, follow, d)).toBe(true);
    expect(meets(run, u, follow, o)).toBe(false);
    // (Anything else paid for since, a Stride: its last action wasn't the hit.)
    u.turn.payForMove(25);
    expect(meets(run, u, follow, d)).toBe(false);
    // (A hit with another Strike doesn't do.)
    noteBlow(run, u, claw(), d, 3);
    u.turn.spend(1);
    expect(meets(run, u, follow, d)).toBe(false);
    // (A miss doesn't either.)
    noteBlow(run, u, bite, d, 1);
    u.turn.spend(1);
    expect(meets(run, u, follow, d)).toBe(false);
  });

  test("hits: the last two Strikes hit the same foe, with the Strike it names; used, it wants two fresh ones", () => {
    const { run, u } = acting(battle([creature({ id: "troll", actions: [claw(), rend] }), dummy(), dummy({ id: "other" })]), "troll");
    const [d, o] = ["dummy", "other"].map(id => run.byId.get(id));
    const c = claw();
    noteBlow(run, u, c, d, 2);
    expect(meets(run, u, rend, d)).toBe(false);
    noteBlow(run, u, c, d, 3);
    expect(meets(run, u, rend, d)).toBe(true);
    expect(meets(run, u, rend, o)).toBe(false);
    setupUsed(u, rend);
    expect(meets(run, u, rend, d)).toBe(false);
    // (A part of a multiattack built on the claw counts as the claw: its `from`.)
    noteBlow(run, u, { ...c, id: "claw.frenzy.1", from: "claw" }, d, 2);
    noteBlow(run, u, { ...c, id: "claw.frenzy.2", from: "claw" }, d, 2);
    expect(meets(run, u, rend, d)).toBe(true);
    // (Not outside its own turn.)
    run.acting = null;
    expect(meets(run, u, rend, d)).toBe(false);
  });

  test("a turn counts what it pays for: an action, a Stride", () => {
    const t = new Turn(pf2eRules, { conds: {} });
    expect(t.acts).toBe(0);
    t.spend(1);
    t.payForMove(25);
    expect(t.acts).toBe(2);
  });
});

describe("in a fight", () => {
  test("a rend comes only after two claw hits on one foe, once for each pair", () => {
    let rends = 0;
    for ( let seed = 1; seed <= 8; seed++ ) {
      const r = replay(battle([creature({ id: "troll", hp: { value: 200, max: 200 }, actions: [claw(), rend] }), dummy()], { maxRounds: 3 }), pf2eRules, seed);
      const mine = byActor(r, "troll");
      mine.forEach((e, i) => {
        if ( e.action !== "Rend" ) return;
        rends += 1;
        const before = mine.slice(0, i).filter(x => x.round === e.round);
        const last2 = before.slice(-2);
        expect(last2.map(x => x.action)).toEqual(["Claw", "Claw"]);
        expect(last2.every(x => x.degree >= 2 && x.targetId === e.targetId)).toBe(true);
      });
    }
    expect(rends).toBeGreaterThan(4);
  });

  test("a follow-up to a bite comes straight after a bite that hit", () => {
    const bite = strike({ id: "jaws", name: "Jaws", bonus: 30, damage: [parseFormula("1d6+2", "piercing")] });
    const follow = { id: "wicked", name: "Wicked Bite", kind: "auto", cost: 1, melee: true, reach: 5, damage: [parseFormula("3d6", "piercing")], requires: { lastHit: { with: ["jaws"] } } };
    let used = 0;
    for ( let seed = 1; seed <= 6; seed++ ) {
      const r = replay(battle([creature({ id: "urdefhan", hp: { value: 200, max: 200 }, actions: [bite, follow] }), dummy()], { maxRounds: 2 }), pf2eRules, seed);
      const mine = byActor(r, "urdefhan");
      mine.forEach((e, i) => {
        if ( e.action !== "Wicked Bite" ) return;
        used += 1;
        expect(mine[i - 1].action).toBe("Jaws");
        expect(mine[i - 1].degree).toBeGreaterThanOrEqual(2);
        expect(mine[i - 1].round).toBe(e.round);
      });
    }
    expect(used).toBeGreaterThan(3);
  });

  test("a squeeze only on the foe it has grabbed: its grabbing claw first", () => {
    const grip = strike({ id: "grip", name: "Grip", bonus: 30, effects: [{ kind: "grabbed" }], damage: [parseFormula("1d4", "bludgeoning")] });
    const squeeze = { id: "squeeze", name: "Squeeze", kind: "save", cost: 1, melee: true, reach: 5, save: { type: "fortitude", dc: 30, basic: true }, damage: [parseFormula("4d6", "bludgeoning")], requires: { holding: true } };
    let squeezed = 0;
    for ( let seed = 1; seed <= 5; seed++ ) {
      const r = replay(battle([creature({ id: "snake", hp: { value: 200, max: 200 }, actions: [grip, squeeze] }), dummy({ escapeWork: { mod: -20 } })], { maxRounds: 2 }), pf2eRules, seed);
      const mine = byActor(r, "snake");
      const first = mine.findIndex(e => e.action === "Squeeze");
      if ( first < 0 ) continue;
      squeezed += 1;
      expect(mine.slice(0, first).some(e => e.action === "Grip" && e.degree >= 2)).toBe(true);
    }
    expect(squeezed).toBeGreaterThan(2);
  });

  test("a multiattack of two actions: each Strike at its own penalty, and the next after it at the third", () => {
    const jaws = strike({ id: "jaws", name: "Jaws", bonus: 10, maps: [0, -5, -10] });
    const talon = strike({ id: "talon", name: "Talon", bonus: 10, maps: [0, -4, -8] });
    const frenzy = { ...jaws, id: "frenzy", name: "Frenzy", cost: 2, sequence: [jaws, { ...talon, id: "talon.f1", from: "talon" }, { ...talon, id: "talon.f2", from: "talon" }] };
    const r = replay(battle([creature({ id: "dragon", actions: [frenzy] }), dummy()], { maxRounds: 1 }), pf2eRules, 2);
    const [a, b, c] = byActor(r, "dragon");
    expect([a.action, b.action, c.action]).toEqual(["Jaws", "Talon", "Talon"]);
    expect(a.mod - b.mod).toBe(4);
    expect(a.mod - c.mod).toBe(8);
    expect(c.attackNumber).toBe(3);
  });
});

describe("what a critical hit brings back", () => {
  test("a breath that waits rounds is back at once after a critical hit with a Strike (rechargeOnCrit)", () => {
    const breath = { id: "breath", name: "Breath", kind: "save", cost: 2, range: { increment: 30, max: 30, noPenalty: true }, save: { type: "reflex", dc: 10, basic: true },
      damage: [parseFormula("10d6", "fire")], uses: 1, cooldown: { n: 1, faces: 4 }, rechargeOnCrit: true };
    // (A claw that always hits hard: every hit a critical one.)
    const sure = strike({ id: "claw", name: "Claw", bonus: 40, damage: [parseFormula("1", "slashing")] });
    let back = 0;
    for ( let seed = 1; seed <= 4; seed++ ) {
      const r = replay(battle([creature({ id: "drake", actions: [breath, sure] }), dummy()], { maxRounds: 3 }), pf2eRules, seed);
      const recharged = r.log.filter(e => e.type === "recharge" && e.actor === "drake");
      back += recharged.length;
      for ( const e of recharged ) {
        const i = r.log.indexOf(e);
        expect(r.log[i - 1]).toMatchObject({ type: "attack", actor: "drake", degree: 3 });
      }
    }
    expect(back).toBeGreaterThan(0);
  });
});

describe("the Statistics Engine", () => {
  test("a claw that would set up a rend is worth more than its own damage; a bite that sets nothing up isn't", () => {
    const bite = strike({ id: "jaws", name: "Jaws", bonus: 30, damage: [parseFormula("1d10+5", "piercing")] });
    const { run, u } = acting(battle([creature({ id: "troll", actions: [claw(), bite, rend] }), dummy()]), "troll");
    const d = run.byId.get("dummy");
    const fresh = followUpWorth(run, u, claw(), d, 0, u.turn);
    expect(fresh).toBeGreaterThan(0);
    expect(followUpWorth(run, u, bite, d, 0, u.turn)).toBe(0);
    // (One claw hit already in: the second sets it up if it hits, if the turn has room for the rend.)
    noteBlow(run, u, claw(), d, 2);
    u.turn.spend(1);
    expect(followUpWorth(run, u, claw(), d, 1, u.turn)).toBeGreaterThan(fresh);
    u.turn.spend(1);
    expect(followUpWorth(run, u, claw(), d, 2, u.turn)).toBe(0); // (no action left for the rend)
  });

  test("an option it can't use yet isn't weighed; one it can is", () => {
    const { run, u } = acting(battle([creature({ id: "troll", actions: [claw(), rend] }), dummy()]), "troll");
    const d = run.byId.get("dummy");
    expect(bestOptionVs(run, u, d, 0, u.turn).action.id).toBe("claw");
    noteBlow(run, u, claw(), d, 2);
    noteBlow(run, u, claw(), d, 2);
    u.turn.spend(2);
    expect(bestOptionVs(run, u, d, 2, u.turn).action.id).toBe("rend");
  });

  test("an opening only one foe allows: the one it holds, to squeeze, over the one it would have picked", () => {
    const grip = strike({ id: "grip", name: "Grip", bonus: 10, damage: [parseFormula("1d4", "bludgeoning")] });
    const squeeze = { id: "squeeze", name: "Squeeze", kind: "save", cost: 1, melee: true, reach: 5, save: { type: "fortitude", dc: 30, basic: true }, damage: [parseFormula("6d6", "bludgeoning")], requires: { holding: true } };
    let held = 0;
    for ( let seed = 1; seed <= 4; seed++ ) {
      const { run, u } = acting(battle([creature({ id: "snake", actions: [grip, squeeze] }), dummy({ hp: { value: 5, max: 900 } }), dummy({ id: "other" })]), "snake", seed);
      // (Holding none, it goes for the one nearly down.)
      expect(chooseTarget(run, u)?.id).toBe("dummy");
      run.byId.get("other").grabbedBy = u.id;
      if ( chooseTarget(run, u)?.id === "other" ) held += 1;
    }
    expect(held).toBe(4);
  });

  test("what needs setting up isn't a turn's usual: not its threat, nor its typical worth", () => {
    expect(typicalValue(rend, 5)).toBe(0);
    expect(typicalValue({ ...rend, requires: undefined }, 5)).toBeGreaterThan(0);
    const run = beginRun(prepareBattle(battle([creature({ id: "a", actions: [claw()] }), creature({ id: "b", actions: [claw(), rend] }), dummy()]), pf2eRules), 1);
    const d = run.byId.get("dummy");
    expect(threatOf(run, run.byId.get("b"), d)).toBeCloseTo(threatOf(run, run.byId.get("a"), d), 5);
  });
});
