/**
 * API 20, ammunition (an action's `ammo`: the key of the rounds its shots come from, `ammoCost` a shot): with none left
 * the shot can't be made, each shot spends it (a reaction's too), and nobody saves it up as they would a resource.
 * And a strike roll's undo records (rollStrike's `records`), kept only for the striker's own sheet.
 */
import { describe, expect, test } from "vitest";
import { beginRun, prepareBattle, runBatchSync } from "../scripts/engine/simulator.js";
import { hasAmmo, shotsLeft, spendAmmo, spendUse, limited } from "../scripts/engine/behavior/evaluate.js";
import { costKind } from "../scripts/engine/behavior/reluctance.js";
import { strikeBack } from "../scripts/engine/behavior/responses.js";
import { rollRecords } from "../scripts/foundry/live-battle.js";
import { parseFormula, part } from "../scripts/engine/dice.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const bow = (over = {}) => strike({ id: "bow", name: "Heavy Crossbow", melee: false, reach: undefined, range: { increment: 120, max: 720 }, bonus: 12,
  damage: [parseFormula("1d10+6", "piercing")], ammo: "ammo:bow", ...over });
const fist = () => strike({ id: "fist", name: "Fist", bonus: 2, damage: [parseFormula("1d4", "bludgeoning")] });

describe("a shot's ammunition", () => {
  test("its shots left (ammoCost a shot), none without; one that takes none has no end of them; spent a shot at a time", () => {
    const u = { resources: { "ammo:bow": 5 }, uses: {} };
    expect(shotsLeft(u, bow())).toBe(5);
    expect(shotsLeft(u, bow({ ammoCost: 2 }))).toBe(2);
    expect(shotsLeft(u, fist())).toBe(Infinity);
    expect(hasAmmo({ resources: {} }, bow())).toBe(false);
    spendAmmo(u, bow({ ammoCost: 2 }));
    spendUse(u, bow());
    spendAmmo(u, fist());
    expect(u.resources).toEqual({ "ammo:bow": 2 });
  });

  test("nothing saved up: no consumable, no costly spell, not limited", () => {
    expect(costKind(bow())).toBeNull();
    expect(limited(bow())).toBe(false);
  });

  test("in a fight: it shoots while its bolts last, then not at all; a shot that takes two, half as often", () => {
    const shooter = (rounds, over = {}) => creature({ id: "harsk", actions: [bow(over), fist()], resources: { "ammo:bow": rounds } });
    const dummy = () => creature({ id: "dummy", side: "hostile", hp: { value: 400, max: 400 }, actions: [strike({ bonus: -50 })], flags: { fearless: true } });
    const used = (rounds, over) => runBatchSync(battle([shooter(rounds, over), dummy()], { maxRounds: 5 }), pf2eRules, { runs: 40, seed: 3 }).combatants.harsk.resources["ammo:bow"] ?? 0;
    expect(used(2)).toBeCloseTo(2, 5);
    expect(used(0)).toBe(0);
    expect(used(3, { ammoCost: 2 })).toBeCloseTo(2, 5);
    // (Plenty: a shot every action it has, none held back.)
    expect(used(40)).toBeGreaterThan(10);
  });

  test("a reaction's shot (strikeRanged) only with the ammunition for it", () => {
    const setUp = rounds => {
      const run = beginRun(prepareBattle(battle([
        creature({ id: "seelah", position: at(0), actions: [strike({ id: "sword" }), bow()], resources: { "ammo:bow": rounds },
          reactions: [{ id: "seelah.reprisal", label: "Reprisal", on: "allyHit", range: 30, reduce: part([], 3), strike: true, strikeRanged: true }] }),
        creature({ id: "scout", side: "hostile", position: at(20), flags: { fearless: true } })
      ], { positioning: true, maxRounds: 2 }), pf2eRules), 1, { log: true });
      return { run, by: id => run.byId.get(id) };
    };
    const loaded = setUp(1);
    const r = loaded.by("seelah").spec.reactions[0];
    expect(strikeBack(loaded.run, loaded.by("seelah"), loaded.by("scout"), r)).toMatchObject({ strike: { id: "bow" } });
    const empty = setUp(0);
    expect(strikeBack(empty.run, empty.by("seelah"), empty.by("scout"), r)).toBeNull();
    expect(strikeBack(empty.run, empty.by("seelah"), empty.by("scout"), { ...r, strike: "bow" })).toBeNull();
  });
});

describe("a strike roll's undo records (rollStrike's records)", () => {
  const doc = { uuid: "Scene.s.Token.t1", actor: { uuid: "Scene.s.Token.t1.Actor.a1" } };

  test("the striker's own: its token's or its actor's, their sheet's part only", () => {
    const records = [
      { tokenUuid: doc.uuid, actorUuid: doc.actor.uuid, itemUpdates: [{ id: "bolts", update: { "system.quantity": 20 } }], createdItems: [], deletedItems: [], createdTokens: ["Scene.s.Token.t9"] },
      { actorUuid: doc.actor.uuid, deletedItems: [{ _id: "bolts" }], setting: { namespace: "pf2e", key: "x", value: 1 } }
    ];
    expect(rollRecords({ attack: { degree: 2 }, records }, doc)).toEqual([
      { tokenUuid: doc.uuid, actorUuid: doc.actor.uuid, itemUpdates: [{ id: "bolts", update: { "system.quantity": 20 } }], createdItems: [], deletedItems: [] },
      { tokenUuid: null, actorUuid: doc.actor.uuid, deletedItems: [{ _id: "bolts" }] }
    ]);
    // (Taken where the result says no degree too: the engine rolls the strike, and the sheet is still put back.)
    expect(rollRecords({ records: records.slice(1) }, doc)).toHaveLength(1);
  });

  test("none about anyone else, none naming no one, and nothing from odd data", () => {
    const theirs = { tokenUuid: "Scene.s.Token.t2", actorUuid: doc.actor.uuid, itemUpdates: [] };
    expect(rollRecords({ records: [theirs, { itemUpdates: [] }, null, "x", { actorUuid: "Actor.other" }] }, doc)).toEqual([]);
    expect(rollRecords({ records: "x" }, doc)).toEqual([]);
    expect(rollRecords(null, doc)).toEqual([]);
    expect(rollRecords({ records: [{ actorUuid: doc.actor.uuid }] }, null)).toEqual([]);
  });
});
