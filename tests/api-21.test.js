/**
 * API 21: every heal and buff shows whom it went to, and what a player's character does to another the table may settle
 * itself.
 *  - An outcome that never lands on whoever laid it (`notSelf`: a heal's for another alone, PF2e Lay on Hands' +2 AC).
 *  - A heal of so many hit points, no dice, is a table roll all the same, so its card names whom it heals and how much.
 *  - In a turn FastFighting plays, a heal is shown as the system's healing card ("card") and applied the system's way
 *    ("apply" with `healing`): the one healed gains what its sheet gained.
 *  - A change set says which conditions an effect laid, and whose (`laid`); and leaves out what the table settles
 *    (`leaveToTable`): a player's character's heal, damage or effect at another, with Apply players' damage off.
 *  - The live side's card for that (settleCard): left with the system's own Apply, waiting in the Battle Vantage, nothing
 *    applied; with Apply players' damage on, applied.
 */
import { describe, expect, test } from "vitest";
import { CORE_API, CORE_API_VERSION } from "../scripts/core-api.js";
import { applyOutcome, outcomeWorth } from "../scripts/engine/behavior/effects.js";
import { beginLive, liveRound, liveTurn, NeedsDecision } from "../scripts/engine/live.js";
import { beginRun, beginRound, prepareBattle } from "../scripts/engine/simulator.js";
import { recordingRng, diceAt, tableRoll, takeRolls, rolledParts } from "../scripts/engine/table-rolls.js";
import { diffOutcome, leaveToTable } from "../scripts/engine/changes.js";
import { rollJson } from "../scripts/foundry/table-rolls.js";
import { tableSettles, settleCard, waitingAfter } from "../scripts/foundry/live-battle.js";
import { SystemAdapter } from "../scripts/adapters/adapter-base.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });

/** PF2e Lay on Hands as a helper builds it: 6 hit points by touch, and +2 AC for another alone; one focus point's worth. */
const layOnHands = {
  id: "champ.lay", name: "Lay on Hands", kind: "heal", cost: 1, uses: 1, heal: [parseFormula("6", "healing")], reach: 5,
  traits: ["healing", "vitality"], outcome: { mods: { ac: 2 }, rounds: 1, label: "+2 AC", notSelf: true }
};

test("the API is 21 or later, major.bug", () => {
  expect(CORE_API.major).toBeGreaterThanOrEqual(21);
  expect(CORE_API_VERSION).toBe(`${CORE_API.major}.${CORE_API.bug}`);
});

describe("an outcome for another alone (notSelf)", () => {
  const unit = id => ({ id, effects: [], conds: {}, baseConds: {}, spec: { id } });

  test("never on the one who laid it; on anyone else as any outcome", () => {
    const champ = unit("champ");
    const ally = unit("ally");
    expect(applyOutcome(champ, layOnHands.outcome, "champ", layOnHands)).toBeNull();
    expect(champ.effects).toEqual([]);
    const laid = applyOutcome(ally, layOnHands.outcome, "champ", layOnHands);
    expect(laid).toMatchObject({ key: "champ.lay", sourceId: "champ", mods: { ac: 2 } });
  });

  test("and worth nothing to it", () => {
    const run = beginRun(prepareBattle(battle([creature({ id: "champ", actions: [layOnHands] }), creature({ id: "ally" }), creature({ id: "foe", side: "hostile" })]), pf2eRules), 1);
    beginRound(run, 1);
    const champ = run.byId.get("champ");
    expect(outcomeWorth(run, champ, champ, layOnHands.outcome)).toBe(0);
    expect(outcomeWorth(run, champ, run.byId.get("ally"), layOnHands.outcome)).toBeGreaterThan(0);
  });
});

describe("a heal of so many hit points, no dice", () => {
  test("a table roll all the same: its number, whom it heals", () => {
    const run = { rng: recordingRng({ die: () => 1, next: () => 0.5 }) };
    const mark = diceAt(run);
    const roll = tableRoll(run, mark, { by: "champ", target: "ally", kind: "healing", label: "Lay on Hands", action: "champ.lay", parts: layOnHands.heal, total: 6 });
    expect(roll).toMatchObject({ by: "champ", target: "ally", kind: "healing", total: 6, action: "champ.lay", dice: [] });
    expect(rolledParts(roll)).toEqual([{ type: "healing", category: null, dice: [], flat: 6 }]);
    expect(takeRolls(run)).toEqual([roll]);
    // (The plain card's roll: its number alone.)
    expect(rollJson(roll)).toMatchObject({ formula: "6", total: 6 });
  });

  test("but no damage, nor a heal of nothing: those are the rules' arithmetic, not a roll", () => {
    const run = { rng: recordingRng({ die: () => 1, next: () => 0.5 }) };
    expect(tableRoll(run, diceAt(run), { by: "a", kind: "damage", parts: [parseFormula("3", "fire")], total: 3 })).toBeNull();
    expect(tableRoll(run, diceAt(run), { by: "a", kind: "healing", parts: [parseFormula("0", "healing")], total: 0 })).toBeNull();
  });
});

/** The champion's turn played through its questions, each answered by `answer(request)`, from a fresh battle each pass. */
function playThrough(setUp, answer) {
  const answers = [];
  const requests = [];
  for ( let tries = 0; tries < 80; tries++ ) {
    const run = setUp();
    try {
      const result = liveTurn(run, "champ", { answers, nonce: 5 });
      return { run, result, requests };
    } catch ( err ) {
      if ( !(err instanceof NeedsDecision) ) throw err;
      requests.push(err.request);
      answers.push([err.request.key, answer(err.request)]);
    }
  }
  throw new Error("a turn that never stops asking");
}

/** A champion FastFighting plays, a fighter beside it, a foe far off; `champ` and `fighter` hit points. */
function party(kinds, { champ = 30, fighter = 30 } = {}) {
  return () => {
    const run = beginLive(battle([
      creature({ id: "champ", name: "Seelah", kind: "pc", position: at(0), hp: { value: champ, max: 30, temp: 0 }, actions: [layOnHands] }),
      creature({ id: "fighter", name: "Lem", kind: "pc", position: at(5), hp: { value: fighter, max: 30, temp: 0 } }),
      creature({ id: "foe", name: "Goblin", side: "hostile", position: at(600), actions: [] })
    ], { positioning: true, maxRounds: 3 }), pf2eRules, { seed: 3, players: ["fighter"], systemRolls: kinds });
    liveRound(run, 1);
    return run;
  };
}

describe("a heal in a turn FastFighting plays: the system's healing card, applied its way", () => {
  test("a friend hurt: the card names it and the amount, then it's applied; the friend gains what its sheet gained, and +2 AC", () => {
    const { run, requests } = playThrough(party(["use", "card", "apply"], { fighter: 5 }), r => (r.roll === "use" ? { card: "use1" } : r.roll === "card" ? { card: "heal1" } : r.roll === "apply" ? { gained: 6 } : null));
    const card = requests.find(r => r.roll === "card");
    expect(card).toMatchObject({ unitId: "champ", targetId: "fighter", action: { id: "champ.lay", name: "Lay on Hands" } });
    expect(card.table.at(-1)).toMatchObject({ kind: "healing", by: "champ", target: "fighter", total: 6, action: "champ.lay" });
    expect(requests.find(r => r.roll === "apply")).toMatchObject({ unitId: "champ", targetId: "fighter", card: "heal1", healing: true, multiplier: 1 });
    // (The spell's own card first, then the heal's.)
    expect(requests.findIndex(r => r.roll === "use")).toBeLessThan(requests.findIndex(r => r.roll === "card"));
    const fighter = run.byId.get("fighter");
    expect(fighter.hp).toBe(11);
    expect(fighter.effects.find(e => e.key === "champ.lay")).toMatchObject({ sourceId: "champ", mods: { ac: 2 } });
  });

  test("what the system gave stands, not the engine's own number (at full health, nothing)", () => {
    const { run } = playThrough(party(["card", "apply"], { fighter: 5 }), r => (r.roll === "card" ? { card: "heal1" } : r.roll === "apply" ? { gained: 2 } : null));
    expect(run.byId.get("fighter").hp).toBe(7);
  });

  test("the table settles it (apply answered null): the engine's own heal stands for the turn", () => {
    const { run, requests } = playThrough(party(["card", "apply"], { fighter: 5 }), r => (r.roll === "card" ? { card: "heal1" } : null));
    expect(requests.some(r => r.roll === "apply")).toBe(true);
    expect(run.byId.get("fighter").hp).toBe(11);
    expect(run.byId.get("fighter").effects.some(e => e.key === "champ.lay")).toBe(true);
  });

  test("itself hurt, its friend not: it heals itself, and lays no AC on itself", () => {
    const { run, requests } = playThrough(party(["card", "apply"], { champ: 5 }), r => (r.roll === "card" ? { card: "heal1" } : r.roll === "apply" ? { gained: 6 } : null));
    expect(requests.find(r => r.roll === "apply")).toMatchObject({ unitId: "champ", targetId: "champ", healing: true });
    const champ = run.byId.get("champ");
    expect(champ.hp).toBe(11);
    expect(champ.effects.some(e => e.key === "champ.lay")).toBe(false);
  });

  test("no one hurt: it isn't spent on a buff for itself", () => {
    const { run, requests } = playThrough(party(["card", "apply"]), () => null);
    expect(requests.some(r => r.roll === "card" || r.roll === "apply")).toBe(false);
    expect(run.byId.get("champ").effects.some(e => e.key === "champ.lay")).toBe(false);
  });
});

describe("a change set: conditions an effect laid, and what the table settles", () => {
  test("laid: the conditions an effect lays alone, with whose it is, once", () => {
    const before = { hp: 10, conditions: {} };
    const after = { hp: 10, conditions: { frightened: 1 }, laid: [{ key: "bard.dirge", sourceId: "bard", label: "frightened 1", conditions: { frightened: 1 } }] };
    expect(diffOutcome(before, after).laid).toEqual(after.laid);
    expect(diffOutcome(after, after)).toBeNull();
  });

  test("leaveToTable: its hit points and the falls they made not written; the effects the other laid named, not laid", () => {
    const changes = {
      hp: { from: 5, to: 11 }, revived: true, status: { from: "down", to: "standing" }, dying: { from: 1, to: 0 },
      effects: { added: [{ key: "champ.lay", sourceId: "champ", label: "+2 AC" }, { key: "bard.anthem", sourceId: "bard", label: "+1 attack" }], ended: [] },
      conditions: { set: { quickened: 1, frightened: 1 }, cleared: [] }, resources: { focus: { from: 1, to: 0 } }
    };
    const out = leaveToTable(changes, { hp: true, from: ["champ"], conditionsOf: e => (e.key === "champ.lay" ? { quickened: 1 } : null) });
    for ( const k of ["hp", "revived", "status", "dying"] ) expect(out[k]).toBeUndefined();
    expect(out.effects.added.map(e => e.key)).toEqual(["bard.anthem"]);
    expect(out.conditions.set).toEqual({ frightened: 1 });
    expect(out.resources).toEqual(changes.resources);
    expect(out.left).toEqual({ hp: true, effects: [changes.effects.added[0]], laid: [] });
  });

  test("nothing left to write, none at all; nothing the table's, as it was", () => {
    expect(leaveToTable({ hp: { from: 5, to: 11 } }, { hp: true })).toEqual({ left: { hp: true, effects: [], laid: [] } });
    const plain = { hp: { from: 5, to: 11 } };
    expect(leaveToTable(plain, {})).toEqual(plain);
  });
});

describe("what the table settles itself (tableSettles)", () => {
  const pc = id => ({ id, pc: true });
  const npc = id => ({ id, pc: false });

  test("a player's character's at another, with Apply players' damage off: the table's", () => {
    expect(tableSettles({ applyDamage: false, by: pc("seelah"), target: pc("lem") })).toBe(true);
  });

  test("Apply players' damage on, players not running their characters, a creature on either side, itself: FastFighting's", () => {
    expect(tableSettles({ applyDamage: true, by: pc("seelah"), target: pc("lem") })).toBe(false);
    expect(tableSettles({ applyDamage: false, playersRun: false, by: pc("seelah"), target: pc("lem") })).toBe(false);
    expect(tableSettles({ applyDamage: false, by: npc("cleric"), target: pc("lem") })).toBe(false);
    expect(tableSettles({ applyDamage: false, by: pc("seelah"), target: npc("goblin") })).toBe(false);
    expect(tableSettles({ applyDamage: false, by: pc("seelah"), target: pc("seelah") })).toBe(false);
  });

  test("a turn taken back takes its waiting cards with it", () => {
    const waiting = [{ key: "a", turn: "1.x" }, { key: "b", turn: "2.y" }, { key: "c" }];
    expect(waitingAfter(waiting, new Set(["2.y"])).map(l => l.key)).toEqual(["a", "c"]);
  });
});

describe("a card in a turn FastFighting plays: applied, or left to the table (settleCard)", () => {
  /** The live battle's parts, faked: Seelah's heal of Lem, its card `heal1`; `applyDamage` the battle's toggle. */
  function liveIo({ applyDamage }) {
    const units = { seelah: { id: "seelah", pc: true }, lem: { id: "lem", pc: true } };
    const io = {
      hp: 5, applied: [], unmarked: [], waiting: [],
      unit: id => units[id] ?? null,
      doc: id => (units[id] ? { id: `t-${id}` } : null),
      message: id => (id === "heal1" ? { id } : null),
      settles: (by, target) => tableSettles({ applyDamage, by: units[by], target: units[target] }),
      standing: async () => io.hp,
      apply: async (message, doc, options) => {
        io.applied.push({ message: message.id, doc: doc.id, options });
        io.hp += 6;
        return [{ undo: message.id }];
      },
      unmark: async message => { io.unmarked.push(message.id); },
      readCard: () => ({ amount: 6, kind: "healing", targets: ["t-lem"], save: false }),
      hpOf: async () => io.hp,
      nameOf: id => ({ seelah: "Seelah", lem: "Lem" })[id] ?? "",
      randomKey: () => "k1",
      wait: async line => { io.waiting.push(line); }
    };
    return io;
  }
  const request = { unitId: "seelah", targetId: "lem", card: "heal1", healing: true, multiplier: 1 };

  test("Apply players' damage off, a player's character healing another: the card left with its Apply, waiting in the Battle Vantage, nothing applied", async () => {
    const io = liveIo({ applyDamage: false });
    const stage = { key: "1.seelah", records: [], applied: ["heal1"] };
    expect(await settleCard(request, stage, io)).toBeNull();
    expect(io.applied).toEqual([]);
    expect(io.hp).toBe(5);
    expect(io.unmarked).toEqual(["heal1"]);
    expect(stage.applied).toEqual([]);
    expect(io.waiting).toEqual([{ key: "k1", messageId: "heal1", targetId: "lem", amount: 6, save: false, healing: true, by: "Seelah", hpAt: 5, turn: "1.seelah" }]);
  });

  test("Apply players' damage on: applied the system's way, the sheet's gain the engine's", async () => {
    const io = liveIo({ applyDamage: true });
    const stage = { key: "1.seelah", records: [], applied: [] };
    expect(await settleCard(request, stage, io)).toEqual({ gained: 6 });
    expect(io.applied).toEqual([{ message: "heal1", doc: "t-lem", options: { multiplier: 1 } }]);
    expect(stage.records).toEqual([{ undo: "heal1" }]);
    expect(stage.applied).toEqual(["heal1"]);
    expect(io.waiting).toEqual([]);
  });

  test("an adapter has nothing to put back by default", async () => {
    expect(await new SystemAdapter().leaveToTable({ id: "m" })).toBeNull();
  });
});
