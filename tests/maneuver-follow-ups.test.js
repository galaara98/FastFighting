/**
 * API 20: a maneuver after a blow (PF2e's Grab, Knockdown and Push), as the core plays it: an effect that lasts until the
 * end of its source's next turn (until: "source"), a hold kept up (renew), a blow's maneuver rider with a roll of its own
 * (kind "control": Improved Grab), a maneuver that needs a hit first (requires.lastHit), and what the Statistics Engine
 * makes of each; in a live battle, its own card first where it says it has one (card).
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, prepareBattle, takeTurn, endOfTurn, replay } from "../scripts/engine/simulator.js";
import { applyOutcome } from "../scripts/engine/behavior/effects.js";
import { controlValue } from "../scripts/engine/behavior/control.js";
import { expectedDamage } from "../scripts/engine/behavior/evaluate.js";
import { followUpWorth, freshTurn } from "../scripts/engine/behavior/requires.js";
import { beginLive, liveRound, liveTurn, NeedsDecision } from "../scripts/engine/live.js";
import { Turn } from "../scripts/engine/turn.js";
import { STATUS } from "../scripts/constants.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const minded = n => ({ tactical: { base: n, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const held = (key = "grabbed") => ({ grab: true, conditions: { [key]: 1 }, rounds: 1, until: "source", label: key });
/** A Grapple of the user's own (no hand needed, no multiple attack penalty): grabbed, restrained on a critical success. */
const grapple = (over = {}) => ({ id: "grapple", name: "Grab", kind: "control", maneuver: "grapple", cost: 1, melee: true, reach: 5, hands: 0,
  check: { mod: 40, against: "fortitude" }, onHit: [null, null, held(), held("restrained")], ...over });
/** Jaws that hit a typical foe most of the time (a foe off guard, more often still). */
const jaws = (over = {}) => strike({ id: "jaws", name: "Jaws", bonus: 8, damage: [parseFormula("1d6+4", "piercing")], ...over });
const squeeze = { id: "squeeze", name: "Squeeze", kind: "save", cost: 1, melee: true, reach: 5, save: { type: "fortitude", dc: 30, basic: true },
  damage: [parseFormula("4d6", "bludgeoning")], requires: { holding: true } };
const dummy = (over = {}) => creature({ id: "hero", hp: { value: 900, max: 900 }, flags: { fearless: true }, defenses: { ac: 15, fortitude: 5, reflex: 5, will: 5 },
  actions: [strike({ id: "fist", bonus: 5, damage: [parseFormula("1d6", "bludgeoning")] })], escapeWork: { mod: -40 }, ...over });

/** A fight a round in, everyone in it, with the log. */
function fight(list, seed = 1) {
  const run = beginRun(prepareBattle(battle(list, { maxRounds: 4 }), pf2eRules), seed, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}

/** A run with u acting, its turn begun (requires.js counts what it pays for). */
function acting(list, id) {
  const run = beginRun(prepareBattle(battle(list), pf2eRules), 1);
  const u = run.byId.get(id);
  run.acting = u;
  u.turn = new Turn(pf2eRules, u);
  freshTurn(u);
  return { run, u };
}

describe("until the end of its source's next turn (until: \"source\")", () => {
  test("laid on a foe in its own turn: through the foe's turn, and gone at the end of its own next one, the grab with it", () => {
    const run = fight([creature({ id: "brute", side: "hostile" }), dummy()]);
    const [brute, hero] = ["brute", "hero"].map(id => run.byId.get(id));
    run.acting = brute;
    const e = applyOutcome(hero, held(), brute.id, { id: "grip" });
    hero.grabbedBy = brute.id;
    hero.grabKey = e.key;
    expect(e).toMatchObject({ until: "source", rounds: 2 });
    endOfTurn(run, brute);
    endOfTurn(run, hero);
    endOfTurn(run, hero);
    expect([hero.conds.grabbed, hero.grabbedBy]).toEqual([1, "brute"]);
    endOfTurn(run, brute);
    expect([hero.conds.grabbed, hero.grabbedBy]).toEqual([undefined, null]);
  });

  test("its source down: the bearer's own turns run it out", () => {
    const run = fight([creature({ id: "brute", side: "hostile" }), dummy()]);
    const [brute, hero] = ["brute", "hero"].map(id => run.byId.get(id));
    run.acting = brute;
    applyOutcome(hero, held(), brute.id, { id: "grip" });
    brute.status = STATUS.DOWN;
    endOfTurn(run, hero);
    endOfTurn(run, hero);
    expect(hero.conds.grabbed).toBeUndefined();
  });

  test("on itself, or with none of it said: as ever, by the bearer's turns", () => {
    const run = fight([creature({ id: "brute", side: "hostile" }), dummy()]);
    const [brute, hero] = ["brute", "hero"].map(id => run.byId.get(id));
    expect(applyOutcome(hero, { conditions: { grabbed: 1 }, rounds: 1 }, brute.id, { id: "plain" })).toMatchObject({ rounds: 1 });
    expect(applyOutcome(hero, { conditions: { grabbed: 1 }, rounds: 1 }, brute.id, { id: "plain" }).until).toBeUndefined();
    expect(applyOutcome(brute, { ...held(), self: true }, brute.id, { id: "own" }).until).toBeUndefined();
    endOfTurn(run, hero);
    expect(hero.conds.grabbed).toBeUndefined();
  });
});

describe("a hold kept up (renew)", () => {
  const keep = { id: "keep", name: "Grab", kind: "control", maneuver: "grapple", auto: true, cost: 1, melee: true, reach: 5, hands: 0,
    requires: { holding: true }, outcome: { renew: true, rounds: 1, label: "held" } };

  test("worth an action only while the hold would end this turn; kept, it lasts through the next", () => {
    const grabbed = actions => {
      const run = fight([creature({ id: "brute", side: "hostile", actions, traits: minded(70) }), dummy()]);
      const [brute, hero] = ["brute", "hero"].map(id => run.byId.get(id));
      run.acting = brute;
      const e = applyOutcome(hero, held(), brute.id, { id: "grip" });
      hero.grabbedBy = brute.id;
      hero.grabKey = e.key;
      return { run, brute, hero, e };
    };
    {
      const { run, brute, hero, e } = grabbed([jaws(), keep]);
      expect(controlValue(run, brute, keep, hero)).toBe(0); // (fresh: it lasts through its next turn already)
      endOfTurn(run, brute);
      endOfTurn(run, hero);
      run.acting = brute;
      expect(e.rounds).toBe(1);
      expect(controlValue(run, brute, keep, hero)).toBeGreaterThan(0);
    }
    // (Played: with nothing else to do, it keeps hold.)
    const { run, brute, hero } = grabbed([keep]);
    endOfTurn(run, brute);
    endOfTurn(run, hero);
    takeTurn(run, brute);
    expect(run.log.find(x => x.type === "control" && x.actorId === "brute")).toMatchObject({ maneuver: "grapple", took: true });
    // (Its own turn over, the hold still there: the hero's turn, and the brute's next, to go.)
    expect([hero.conds.grabbed, hero.grabbedBy]).toEqual([1, "brute"]);
    endOfTurn(run, hero);
    endOfTurn(run, brute);
    expect(hero.grabbedBy).toBeNull();
  });
});

describe("a blow's maneuver with a roll of its own (a rider of kind \"control\")", () => {
  test("a hit: its Grapple at once, free, its own check, no multiple attack penalty taken or added", () => {
    const run = fight([creature({ id: "croc", side: "hostile", actions: [jaws({ bonus: 40, effects: [{ kind: "control", control: grapple({ id: "improved", cost: 0 }) }] })], traits: minded(70) }), dummy()]);
    takeTurn(run, run.byId.get("croc"));
    const mine = run.log.filter(e => e.actorId === "croc" && ["attack", "control"].includes(e.type));
    expect(mine.slice(0, 2).map(e => e.type)).toEqual(["attack", "control"]);
    expect(mine[1]).toMatchObject({ maneuver: "grapple", roll: "check", against: "fortitude", took: true });
    expect(run.byId.get("hero").grabbedBy).toBe("croc");
    // (Three Strikes in the turn, the Grapples between them counted for nothing.)
    expect(mine.filter(e => e.type === "attack").map(e => e.attackNumber)).toEqual([1, 2, 3]);
  });

  test("worth what its control is worth, as often as the blow hits", () => {
    const plain = jaws();
    const grabbing = jaws({ id: "jaws2", effects: [{ kind: "control", control: grapple({ id: "improved", cost: 0 }) }] });
    const run = fight([creature({ id: "croc", side: "hostile", actions: [plain, grabbing], traits: minded(70) }), dummy()]);
    const [croc, hero] = ["croc", "hero"].map(id => run.byId.get(id));
    expect(expectedDamage(run, croc, grabbing, hero)).toBeGreaterThan(expectedDamage(run, croc, plain, hero));
  });
});

describe("a maneuver that needs a hit first (PF2e's Grab)", () => {
  const grab = grapple({ requires: { lastHit: { with: ["jaws"] } } });

  test("only straight after a hit with the Strike it names, an action of its own (worth it, for the squeeze it sets up)", () => {
    let grabs = 0;
    for ( let seed = 1; seed <= 6; seed++ ) {
      const r = replay(battle([creature({ id: "croc", side: "hostile", hp: { value: 200, max: 200 }, actions: [jaws(), grab, squeeze], traits: minded(70) }), dummy()], { maxRounds: 2 }), pf2eRules, seed);
      const mine = r.log.filter(e => e.actor === "croc" && ["attack", "control", "save"].includes(e.type));
      mine.forEach((e, i) => {
        if ( e.type !== "control" ) return;
        grabs += 1;
        expect(mine[i - 1]).toMatchObject({ type: "attack", action: "Jaws", round: e.round });
        expect(mine[i - 1].degree).toBeGreaterThanOrEqual(2);
      });
      // (An action each: no more than three things a turn.)
      for ( const round of [1, 2] ) expect(mine.filter(e => e.round === round).length).toBeLessThanOrEqual(3);
    }
    expect(grabs).toBeGreaterThan(3);
  });

  test("the Statistics Engine: a Strike that would set it up is worth more; the Grab that would set up a squeeze too", () => {
    const { run, u } = acting([creature({ id: "croc", side: "hostile", actions: [jaws(), grab, squeeze] }), dummy()], "croc");
    const hero = run.byId.get("hero");
    expect(followUpWorth(run, u, jaws(), hero, 0, u.turn)).toBeGreaterThan(0);
    expect(followUpWorth(run, u, grab, hero, 1, u.turn)).toBeGreaterThan(0);
    const alone = acting([creature({ id: "croc", side: "hostile", actions: [jaws()] }), dummy()], "croc");
    expect(followUpWorth(alone.run, alone.u, jaws(), alone.run.byId.get("hero"), 0, alone.u.turn)).toBe(0);
    // (A grab already on it: nothing more to set up for the squeeze.)
    hero.grabbedBy = u.id;
    expect(followUpWorth(run, u, grab, hero, 1, u.turn)).toBe(0);
  });
});

describe("in a live battle: its own card first, where it says it has one (card)", () => {
  const at = (x, y = 0) => ({ x, y, size: 5 });
  const setUp = actions => () => {
    const run = beginLive(battle([
      creature({ id: "hero", kind: "pc", position: at(0), hp: { value: 100, max: 100 }, diesAtZero: false }),
      creature({ id: "croc", side: "hostile", position: at(5), hp: { value: 100, max: 100 }, actions, traits: minded(60), flags: { fearless: true } })
    ], { positioning: true, maxRounds: 5 }), pf2eRules, { seed: 2, players: ["hero"], systemRolls: ["use", "check"] });
    liveRound(run, 1);
    return run;
  };
  function asked(actions) {
    const answers = [];
    const requests = [];
    for ( let tries = 0; tries < 60; tries++ ) {
      try {
        liveTurn(setUp(actions)(), "croc", { answers });
        return requests;
      } catch ( err ) {
        if ( !(err instanceof NeedsDecision) ) throw err;
        requests.push(err.request);
        answers.push([err.request.key, err.request.roll === "check" ? { degree: 2, natural: 15, total: 30 } : err.request.roll === "use" ? { card: "grab-card" } : null]);
      }
    }
    throw new Error("a turn that never stops asking");
  }

  test("a blow's Grapple rider: the ability's card, then its check", () => {
    const requests = asked([jaws({ effects: [{ kind: "control", control: grapple({ id: "croc.grab.grapple", card: true, cost: 0 }) }] })]);
    const rolls = requests.filter(r => r.action?.id === "croc.grab.grapple").map(r => r.roll);
    expect(rolls.slice(0, 2)).toEqual(["use", "check"]);
  });

  test("without it, no card: the check's card is the one", () => {
    const requests = asked([jaws({ effects: [{ kind: "control", control: grapple({ id: "croc.grab.grapple", cost: 0 }) }] })]);
    expect(requests.some(r => r.roll === "use")).toBe(false);
    expect(requests.some(r => r.roll === "check")).toBe(true);
  });
});
