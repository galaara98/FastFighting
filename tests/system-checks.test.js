/**
 * API 19: saves and checks in a turn FastFighting plays, rolled by the system (run.live.systemRolls "save", "check";
 * battle-state.js systemRolled): asked where the engine would roll them, the turn played again with how they went.
 * Null: the engine's own dice.
 */
import { describe, expect, test } from "vitest";
import { beginLive, liveRound, liveTurn, NeedsDecision } from "../scripts/engine/live.js";
import { SystemAdapter } from "../scripts/core-api.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const minded = n => ({ tactical: { base: n, fudge: 0 }, brave: { base: 60, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } });

/** The NPC's turn played through its questions, each answered by `answer(request)`. */
function playThrough(setUp, id, answer) {
  const answers = [];
  const requests = [];
  for ( let tries = 0; tries < 60; tries++ ) {
    const run = setUp();
    try {
      const { events } = liveTurn(run, id, { answers });
      return { run, events, requests };
    } catch ( err ) {
      if ( !(err instanceof NeedsDecision) ) throw err;
      requests.push(err.request);
      answers.push([err.request.key, answer(err.request)]);
    }
  }
  throw new Error("a turn that never stops asking");
}

const blast = { id: "blast", name: "Fire Blast", kind: "save", cost: 2, rank: 1, save: { type: "reflex", dc: 20, basic: true },
  damage: [parseFormula("20", "fire")], range: { increment: 60, max: 60, noPenalty: true }, melee: false };
const demoralize = { id: "demoralize", name: "Demoralize", kind: "control", cost: 1, check: { mod: 10, against: "will" }, oncePerTarget: true,
  range: { increment: 30, max: 30, noPenalty: true }, melee: false, traits: ["mental"],
  onHit: [null, null, { conditions: { frightened: 1 }, rounds: 1, label: "frightened 1" }, { conditions: { frightened: 2 }, rounds: 2, label: "frightened 2" }] };

function setUp(actions, kinds) {
  return () => {
    const run = beginLive(battle([
      creature({ id: "hero", kind: "pc", position: at(0), hp: { value: 100, max: 100 }, diesAtZero: false }),
      creature({ id: "witch", side: "hostile", position: at(20), hp: { value: 100, max: 100 }, actions, traits: minded(60), flags: { fearless: true } })
    ], { positioning: true, maxRounds: 5 }), pf2eRules, { seed: 2, players: ["hero"], systemRolls: kinds });
    liveRound(run, 1);
    return run;
  };
}

describe("a save the system rolls", () => {
  test("asked of the one who saves, against what and whose; its degree is the save's", () => {
    const { events, requests } = playThrough(setUp([blast], ["save"]), "witch", () => ({ degree: 3, natural: 19, total: 30 }));
    expect(requests.find(r => r.roll === "save")).toMatchObject({ kind: "save", unitId: "hero", targetId: "witch", save: "reflex", dc: 20, action: { id: "blast", name: "Fire Blast" } });
    expect(events.find(e => e.type === "save" && e.targetId === "hero")).toMatchObject({ degree: 3, natural: 19, total: 30, damage: 0 });
  });

  test("a critical failure the system rolled: double the damage (a basic save)", () => {
    const { run } = playThrough(setUp([blast], ["save"]), "witch", () => ({ degree: 0, natural: 1, total: 5 }));
    expect(run.byId.get("hero").hp).toBe(60);
  });

  test("the rules' say after the dice still comes (a flat check), told the system rolled them", () => {
    const seen = [];
    const rules = { ...pf2eRules, adjustRoll: (run, u, roll, ctx) => (seen.push([ctx.kind, ctx.rolled]), roll) };
    const make = () => {
      const run = beginLive(battle([
        creature({ id: "hero", kind: "pc", position: at(0), hp: { value: 100, max: 100 }, diesAtZero: false }),
        creature({ id: "witch", side: "hostile", position: at(20), hp: { value: 100, max: 100 }, actions: [blast], traits: minded(60), flags: { fearless: true } })
      ], { positioning: true, maxRounds: 5 }), rules, { seed: 2, players: ["hero"], systemRolls: ["save"] });
      liveRound(run, 1);
      return run;
    };
    playThrough(make, "witch", () => ({ degree: 2, natural: 12, total: 21 }));
    expect(seen.at(-1)).toEqual(["save", true]);
  });

  test("the rules change a roll the system made on its own card (adjust: Ironsworn's burn), or keep it as it fell", () => {
    const rules = { ...pf2eRules, adjustRoll(run, u, roll, ctx) {
      if ( !ctx.rolled || ctx.kind !== "save" || roll.degree >= 2 ) return roll;
      const done = run.live?.roll?.(run, { kind: "adjust", unitId: u.id, card: roll.card ?? null, adjust: "burnMomentum" });
      return done?.done ? { ...roll, degree: 2 } : roll;
    } };
    const make = () => {
      const run = beginLive(battle([
        creature({ id: "hero", kind: "pc", position: at(0), hp: { value: 100, max: 100 }, diesAtZero: false }),
        creature({ id: "witch", side: "hostile", position: at(20), hp: { value: 100, max: 100 }, actions: [blast], traits: minded(60), flags: { fearless: true } })
      ], { positioning: true, maxRounds: 5 }), rules, { seed: 2, players: ["hero"], systemRolls: ["save", "adjust"] });
      liveRound(run, 1);
      return run;
    };
    const failed = { degree: 1, natural: 3, total: 9, card: "save-card" };
    const burned = playThrough(make, "witch", r => (r.roll === "save" ? failed : r.roll === "adjust" ? { done: true } : null));
    expect(burned.requests.find(r => r.roll === "adjust")).toMatchObject({ unitId: "hero", card: "save-card", adjust: "burnMomentum" });
    expect(burned.events.find(e => e.type === "save" && e.targetId === "hero")).toMatchObject({ degree: 2 });
    const kept = playThrough(make, "witch", r => (r.roll === "save" ? failed : r.roll === "adjust" ? { done: false } : null));
    expect(kept.events.find(e => e.type === "save" && e.targetId === "hero")).toMatchObject({ degree: 1 });
  });

  test("null: the engine's own dice; and not asked where the system doesn't roll saves", () => {
    const own = playThrough(setUp([blast], ["save"]), "witch", () => null);
    expect(own.events.some(e => e.type === "save" && e.targetId === "hero")).toBe(true);
    expect(playThrough(setUp([blast], ["strike"]), "witch", () => null).requests.some(r => r.roll === "save")).toBe(false);
  });
});

describe("a spell's own card and its damage, the system's", () => {
  const answer = r => ({
    use: { card: "card-1" },
    damage: { damage: { byType: { fire: 30 } }, card: "dmg-1" },
    save: { degree: 2, natural: 15, total: 22 },
    apply: { lost: 14 }
  })[r.roll] ?? null;

  test("its card first, its damage rolled once, the save's share applied the system's way: what the sheet lost", () => {
    const { run, events, requests } = playThrough(setUp([blast], ["use", "damage", "save", "apply"]), "witch", answer);
    const asked = Object.fromEntries(requests.map(r => [r.roll, r]));
    expect(asked.use).toMatchObject({ unitId: "witch", targetId: "hero", action: { id: "blast", name: "Fire Blast" } });
    expect(asked.damage).toMatchObject({ unitId: "witch", card: "card-1", action: { id: "blast" } });
    expect(asked.apply).toMatchObject({ unitId: "witch", targetId: "hero", card: "dmg-1", multiplier: 0.5, amount: 15 });
    expect(requests.map(r => r.roll).indexOf("use")).toBeLessThan(requests.map(r => r.roll).indexOf("damage"));
    expect(events.find(e => e.type === "save" && e.targetId === "hero")).toMatchObject({ degree: 2, damage: 14 });
    expect(run.byId.get("hero").hp).toBe(86);
  });

  test("no roller for its damage: the engine's dice, nothing applied the system's way", () => {
    const { run, requests } = playThrough(setUp([blast], ["use", "save"]), "witch", answer);
    expect(requests.some(r => r.roll === "apply" || r.roll === "damage")).toBe(false);
    expect(run.byId.get("hero").hp).toBe(90); // (20, halved)
  });

  test("a strike or a maneuver shows no card of its own here: its roll's card does", () => {
    const { requests } = playThrough(setUp([demoralize], ["use", "check"]), "witch", answer);
    expect(requests.some(r => r.roll === "use")).toBe(false);
  });
});

describe("a check the system rolls", () => {
  test("a control check: the user's, at its target, for what and against which defense", () => {
    const { run, requests } = playThrough(setUp([demoralize], ["check"]), "witch", () => ({ degree: 3, natural: 20, total: 30 }));
    expect(requests.find(r => r.roll === "check")).toMatchObject({ kind: "check", unitId: "witch", targetId: "hero", purpose: "control", against: "will", action: { id: "demoralize" } });
    expect(run.byId.get("hero").conds.frightened).toBe(2);
  });

  test("a check with the attack trait says how many attacks came before it (a multiple attack penalty); one without, none", () => {
    const shove = { ...demoralize, id: "shove", name: "Shove", check: { mod: 10, against: "fortitude", attack: true }, oncePerTarget: false, melee: true, reach: 5, range: undefined };
    const first = playThrough(setUp([shove], ["check"]), "witch", () => ({ degree: 1, natural: 2, total: 12 })).requests.filter(r => r.roll === "check");
    expect(first[0]).toMatchObject({ purpose: "control", against: "fortitude", attackNumber: 0 });
    if ( first[1] ) expect(first[1].attackNumber).toBe(1);
    const scare = playThrough(setUp([demoralize], ["check"]), "witch", () => ({ degree: 1, natural: 2, total: 12 })).requests.find(r => r.roll === "check");
    expect(scare.attackNumber).toBeUndefined();
  });

  test("a failure the system rolled takes nothing", () => {
    const { run } = playThrough(setUp([demoralize], ["check"]), "witch", () => ({ degree: 1, natural: 2, total: 12 }));
    expect(run.byId.get("hero").conds.frightened ?? 0).toBe(0);
  });
});

test("a helper with no roller of its own rolls no saves or checks: the engine's dice", () => {
  const adapter = new SystemAdapter();
  expect(adapter.rollSave({}, { save: "reflex", dc: 20, action: { id: null, name: "" } })).toBeNull();
  expect(adapter.rollCheck({}, { purpose: "control", dc: 15, action: { id: "a", name: "A" } })).toBeNull();
});
