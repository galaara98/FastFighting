import { describe, expect, test } from "vitest";
import { replay, beginRun, prepareBattle } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle } from "./helpers.js";

const isMinion = u => u.spec.creatureTraits?.includes("minion");
// (As FastFighting PF2e has it: a minion two actions, its master's one action to command it.)
const rules = { ...pf2eRules, turn: u => ({ actions: isMinion(u) ? 2 : 3 }), minionCommand: u => (isMinion(u) ? { actions: 1 } : null) };

const tough = { hp: { value: 400, max: 400, temp: 0 }, flags: { fearless: true } };
const master = (extra = {}) => creature({ id: "master", kind: "pc", diesAtZero: false, initiative: { mod: -20 }, ...tough, ...extra });
const minion = (extra = {}) => creature({ id: "pet", kind: "companion", creatureTraits: ["minion"], initiative: { mod: 30 }, ...tough, flags: { fearless: true, masterId: "master" }, ...extra });
const foe = () => creature({ id: "foe", side: "hostile", ...tough });

/** Each round's attacks by id: {round: count}. */
const attacksBy = (log, id) => log.filter(e => e.type === "attack" && e.actorId === id).reduce((n, e) => ({ ...n, [e.round]: (n[e.round] ?? 0) + 1 }), {});

describe("minions", () => {
  test("a minion goes right after its master, whatever its initiative", () => {
    const run = beginRun(prepareBattle(battle([minion(), foe(), master()]), rules), 1);
    const order = run.order.map(u => u.id);
    expect(order.indexOf("pet")).toBe(order.indexOf("master") + 1);
  });

  test("its master spends an action each turn to command it, and it acts with two", () => {
    for ( const seed of [1, 2, 3] ) {
      const { log } = replay(battle([master(), minion(), foe()], { maxRounds: 3 }), rules, seed);
      const commands = log.filter(e => e.type === "commandMinion");
      expect(commands.map(e => e.round)).toEqual([1, 2, 3]);
      expect(commands.every(e => e.actorId === "master" && e.targetId === "pet")).toBe(true);
      // (Two attacks at most for each: the master's third action went to the command.)
      for ( const n of Object.values(attacksBy(log, "master")) ) expect(n).toBeLessThanOrEqual(2);
      for ( const n of Object.values(attacksBy(log, "pet")) ) expect(n).toBeLessThanOrEqual(2);
      expect(Object.keys(attacksBy(log, "pet")).length).toBeGreaterThan(0);
    }
  });

  test("not commanded, it does nothing", () => {
    // (A master with no action to spare: slowed for the whole fight.)
    const { log } = replay(battle([master({ conditions: { slowed: 3 } }), minion(), foe()], { maxRounds: 3 }), rules, 1);
    expect(log.some(e => e.type === "commandMinion")).toBe(false);
    expect(log.some(e => e.actorId === "pet" && e.type === "attack")).toBe(false);
  });

  test("with no master in the fight, or no rule for it, it acts on its own", () => {
    const alone = replay(battle([minion(), foe(), creature({ id: "ally", ...tough })], { maxRounds: 2 }), rules, 1).log;
    expect(alone.some(e => e.actorId === "pet" && e.type === "attack")).toBe(true);
    const free = replay(battle([master(), minion(), foe()], { maxRounds: 2 }), pf2eRules, 1).log;
    expect(free.some(e => e.type === "commandMinion")).toBe(false);
    expect(free.some(e => e.actorId === "pet" && e.type === "attack")).toBe(true);
  });
});
