/**
 * Medic, DPS and Enabler: three playstyles about what a creature reaches for first. A medic heals early and keeps its
 * healing for healing; a DPS spends its most damaging options until they're gone, and sets up its sneak attacks; an
 * Enabler bolsters, then gives its friends an edge, heals only after those, and hurts last. Weights, not rules.
 */
import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";
import { scorePlaystyles, pickPlaystyles } from "../scripts/engine/auto-playstyles.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
/** A creature with these pills: their traits' shifts left out, their behavior, desires and suggested answers in. */
const styled = (ids, over = {}) => {
  const p = combinePlaystyles(ids);
  return creature({ playstyles: ids, behavior: p.behavior, desireStyle: p.desire, ...over, tactics: { ...p.suggest, ...(over.tactics ?? {}) } });
};
/** A foe that stands there and takes it. */
const dummy = (over = {}) => creature({ id: "dummy", name: "Dummy", side: "hostile", hp: { value: 300, max: 300 }, flags: { fearless: true }, actions: [strike({ bonus: -50 })], ...over });
const heal = (over = {}) => ({ id: "cure", name: "Cure", kind: "heal", cost: 2, range: { increment: 30, max: 30 }, heal: [parseFormula("2d8+8", "healing")], rank: 1, spellId: "cure", resource: "slots:1", ...over });
const bless = () => ({ id: "bless", name: "Bless", kind: "buff", cost: 2, aura: 30, rank: 1, spellId: "bless", resource: "slots:1", outcome: { mods: { attack: 1 }, rounds: 10, label: "Bless" } });
/** What a creature did on its first turn: its own events, in order. */
const firstTurn = (r, id) => r.log.filter(e => e.actorId === id && e.round === 1 && e.turnOf === id && !["thought", "prepare"].includes(e.type));
const many = (spec, rules, seeds, f) => { for ( const seed of seeds ) f(replay(spec, rules, seed), seed); };

describe("Medic", () => {
  test("heals a friend at 70% where another wouldn't", () => {
    const team = medic => battle([
      medic ? styled(["medic"], { id: "doc", position: at(0), actions: [strike(), heal()], resources: { "slots:1": 3 } })
        : creature({ id: "doc", position: at(0), actions: [strike(), heal()], resources: { "slots:1": 3 } }),
      creature({ id: "friend", position: at(10), hp: { value: 21, max: 30 }, conditions: { immobilized: 1 } }),
      dummy({ position: at(5, 5) })
    ], { positioning: true, maxRounds: 1, initiativeOrder: ["doc", "friend", "dummy"] });
    many(team(true), pf2eRules, [1, 2, 3], r => expect(firstTurn(r, "doc").some(e => e.type === "heal" && e.targetId === "friend")).toBe(true));
    many(team(false), pf2eRules, [1, 2, 3], r => expect(firstTurn(r, "doc").some(e => e.type === "heal")).toBe(false));
  });

  test("bolsters before it attacks when nobody's hurt", () => {
    const spec = battle([
      styled(["medic"], { id: "doc", position: at(0), actions: [strike(), heal(), bless()], resources: { "slots:1": 3 } }),
      creature({ id: "friend", position: at(10), conditions: { immobilized: 1 } }),
      dummy({ position: at(5, 5) })
    ], { positioning: true, maxRounds: 1, initiativeOrder: ["doc", "friend", "dummy"] });
    many(spec, pf2eRules, [1, 2, 3], r => {
      const own = firstTurn(r, "doc");
      expect(own[0].type).toBe("buff");
      expect(own.some(e => e.type === "heal")).toBe(false);
    });
  });

  test("gives a friend its own potion where the system allows (administer); another keeps it for itself", () => {
    const potion = { id: "potion", name: "Healing Potion", kind: "heal", cost: 1, heal: [parseFormula("3d8+5", "healing")], selfOnly: true, administer: true, reach: 5, resource: "item:potion", consumable: true };
    const team = medic => battle([
      (medic ? styled : (ids, o) => creature(o))(["medic"], { id: "doc", position: at(0), actions: [strike(), potion], resources: { "item:potion": 2 }, tactics: { consumables: "freely" } }),
      creature({ id: "friend", position: at(5), hp: { value: 12, max: 30 }, conditions: { immobilized: 1 } }),
      dummy({ position: at(0, 30), conditions: { immobilized: 1 } })
    ], { positioning: true, maxRounds: 1, initiativeOrder: ["doc", "friend", "dummy"] });
    many(team(true), pf2eRules, [1, 2, 3], r => expect(r.log.find(e => e.actorId === "doc" && e.type === "heal")).toMatchObject({ targetId: "friend", given: true }));
    many(team(false), pf2eRules, [1, 2, 3], r => expect(r.log.some(e => e.actorId === "doc" && e.type === "heal" && e.targetId === "friend")).toBe(false));
  });

  test("doesn't burn its healing slots on attacks", () => {
    const blast = { id: "blast", name: "Blast", kind: "save", cost: 2, rank: 1, spellId: "blast", resource: "slots:1", save: { type: "reflex", dc: 30, basic: true }, damage: [parseFormula("4d6", "fire")] };
    const team = medic => battle([
      (medic ? styled : (ids, o) => creature(o))(["medic"], { id: "doc", position: at(0), actions: [strike({ bonus: 5 }), heal(), blast], resources: { "slots:1": 3 }, tactics: { resourceUse: "nova" } }),
      dummy({ position: at(5) })
    ], { positioning: true, maxRounds: 2 });
    const spent = medic => { let n = 0; many(team(medic), pf2eRules, [1, 2, 3, 4], r => { n += r.log.filter(e => e.actorId === "doc" && e.action === "Blast").length; }); return n; };
    expect(spent(false)).toBeGreaterThan(0);
    expect(spent(true)).toBe(0);
  });
});

describe("DPS", () => {
  test("spends its best damaging spell slots first, then the next, then what costs nothing", () => {
    const spell = (id, rank, dice, resource) => ({ id, name: id, kind: "save", cost: 2, rank, spellId: id, resource, save: { type: "reflex", dc: 30, basic: true }, damage: [parseFormula(dice, "fire")] });
    const spec = battle([
      styled(["dps"], { id: "mage", position: at(0), resources: { "slots:3": 1, "slots:1": 2 },
        actions: [spell("big", 3, "6d6", "slots:3"), spell("small", 1, "3d6", "slots:1"), { ...spell("cantrip", 0, "2d4", undefined), rank: 0, resource: undefined }] }),
      dummy({ position: at(30), hp: { value: 2000, max: 2000 } })
    ], { positioning: true, maxRounds: 5 });
    many(spec, pf2eRules, [1, 2], r => {
      // (Holding nothing back, told: once a turn it spends something on a blow.)
      expect(r.log.filter(e => e.actorId === "mage" && e.type === "allOut" && e.round === 1)).toHaveLength(1);
      const casts = r.log.filter(e => e.actorId === "mage" && e.type === "save").map(e => e.action);
      expect(casts.slice(0, 3)).toEqual(["big", "small", "small"]);
      expect(casts.slice(3).every(n => n === "cantrip")).toBe(true);
    });
  });

  test("a DPS rogue goes in beside a friend, flanking, for its sneak attack", () => {
    const sneak = [{ when: "offGuard", parts: [parseFormula("2d6", "precision")] }];
    const spec = battle([
      styled(["dps"], { id: "rogue", position: at(-20, 0), traits: { tactical: { base: 70, fudge: 0 }, brave: { base: 60, fudge: 0 }, selfish: { base: 40, fudge: 0 }, loyal: { base: 60, fudge: 0 } },
        actions: [strike({ id: "rapier", name: "Rapier", bonus: 9, damage: [parseFormula("1d6+3", "piercing")], bonusDamage: sneak }),
          strike({ id: "bow", name: "Shortbow", melee: false, reach: undefined, range: { increment: 60, max: 360 }, bonus: 9, damage: [parseFormula("1d6+2", "piercing")], bonusDamage: sneak })] }),
      creature({ id: "fighter", position: at(5, 0), conditions: { immobilized: 1 }, actions: [strike({ bonus: -50 })] }),
      dummy({ position: at(10, 0) })
    ], { positioning: true, maxRounds: 1, initiativeOrder: ["fighter", "rogue", "dummy"] });
    many(spec, pf2eRules, [1, 2, 3], r => {
      const own = firstTurn(r, "rogue");
      expect(own.find(e => e.type === "move")).toBeTruthy();
      expect(own.find(e => e.type === "attack")?.action).toBe("Rapier");
    });
  });
});

describe("Enabler", () => {
  const aid = { id: "aid", name: "Aid", kind: "buff", cost: 1, reach: 30, check: { mod: 10, dc: 15 },
    onDegree: [null, null, { mods: { attack: 1, checks: 1 }, uses: 1, vsFocus: true, rounds: 1 }, { mods: { attack: 2, checks: 2 }, uses: 1, vsFocus: true, rounds: 1 }] };
  // (Its friend has had a turn already, and is set on the dummy: what an edge for it is for.)
  const team = (actions, { hurt = true } = {}) => battle([
    styled(["enabler"], { id: "helper", position: at(0), actions, resources: { "slots:1": 3 }, tactics: { healAggro: "aggressive" } }),
    creature({ id: "friend", position: at(10), hp: { value: hurt ? 16 : 30, max: 30 }, actions: [strike({ bonus: 12 })] }),
    dummy({ position: at(5) })
  ], { positioning: true, maxRounds: 1, initiativeOrder: ["friend", "helper", "dummy"] });
  const first = (actions, opts) => {
    const out = [];
    many(team(actions, opts), pf2eRules, [1, 2, 3], r => out.push(firstTurn(r, "helper")[0]?.type));
    return out;
  };

  test("with a buff and a heal, and a friend at half: it bolsters", () => {
    expect(first([strike(), heal(), bless()])).toEqual(["buff", "buff", "buff"]);
  });

  test("with no buff but Aid, it gives its friend the edge", () => {
    expect(first([strike(), heal(), aid])).toEqual(["buff", "buff", "buff"]);
  });

  test("with neither, it heals", () => {
    expect(first([strike(), heal()])).toEqual(["heal", "heal", "heal"]);
  });

  test("with nothing to give, it fights", () => {
    expect(first([strike()], { hurt: false })).toEqual(["attack", "attack", "attack"]);
  });
});

describe("set up by itself", () => {
  const picks = spec => pickPlaystyles(scorePlaystyles(spec, { rules: pf2eRules }));

  test("a healing cleric is a Medic; a striker is a DPS", () => {
    const cleric = creature({ level: 3, actions: [strike({ bonus: 7, damage: [parseFormula("1d6+1", "bludgeoning")] }), heal(), heal({ id: "cure2", rank: 2, resource: "slots:2" }), bless()],
      traits: { tactical: { base: 50, fudge: 0 }, brave: { base: 50, fudge: 0 }, selfish: { base: 35, fudge: 0 }, loyal: { base: 60, fudge: 0 } } });
    expect(picks(cleric)).toContain("medic");
    const striker = creature({ level: 3, actions: [strike({ id: "greatsword", name: "Greatsword", bonus: 12, damage: [parseFormula("2d12+6", "slashing")] })] });
    expect(picks(striker)).toContain("dps");
    // (A plain creature is neither.)
    const plain = picks(creature({ level: 3 }));
    expect(plain).not.toContain("dps");
    expect(plain).not.toContain("medic");
  });
});
