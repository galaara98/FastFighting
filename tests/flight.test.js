/**
 * Leaving of its own accord (behavior/flight.js): a hostile with nobody to lead it, or led by one who'd rather run,
 * weighs its life against the loot; an NPC with something taken this fight makes off with it.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, prepareBattle, takeTurn } from "../scripts/engine/simulator.js";
import { lifeOverLoot, prizeFlight, prizeOf, leavesOfItsOwn } from "../scripts/engine/behavior/flight.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const traits = (t = {}) => Object.fromEntries(["tactical", "brave", "selfish", "loyal"].map(k => [k, { base: t[k] ?? 50, fudge: 0 }]));
const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
const hero = (extra = {}) => creature({ id: "hero", kind: "pc", hp: { value: 100, max: 100 }, actions: [strike({ bonus: -50 })], valuables: { money: 500, stowed: [], wielded: [] }, ...at(0), ...extra });
const goblin = (id, extra = {}) => creature({ id, name: id, side: "hostile", traits: traits({ brave: 20, selfish: 30 }), hp: { value: 30, max: 30 }, actions: [strike({ bonus: -50 })], ...at(30), ...extra });
const chain = (...ids) => ids.map((id, i) => ({ id, role: i ? "lieutenant" : "leader", leadership: { brave: 0, tacticalFloor: 40, attack: 0, ac: 0 } }));

function fight(list, { options = {}, command = null, seed = 3 } = {}) {
  const spec = battle(list, { maxRounds: 6, positioning: true, aftermath: "none", opening: "fight", leadership: true, ...options });
  spec.bounds = { x0: -200, y0: -100, x1: 200, y1: 100 };
  if ( command ) spec.command = command;
  const run = beginRun(prepareBattle(spec, pf2eRules), seed, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}

describe("life over loot", () => {
  test("leaderless, a timid one badly hurt and losing weighs its life the heavier; led by a steady leader, or brave and greedy, it doesn't", () => {
    const run = fight([hero(), goblin("a"), goblin("b", { traits: traits({ brave: 90, selfish: 90 }) })]);
    const [a, b] = [run.byId.get("a"), run.byId.get("b")];
    a.hp = 5;
    expect(lifeOverLoot(run, a)).toBeGreaterThan(0.1);
    expect(lifeOverLoot(run, b)).toBe(0);
    const led = fight([hero(), goblin("boss", { traits: traits({ brave: 90 }), tactics: { retreat: "never" } }), goblin("a")], { command: { hostile: chain("boss") } });
    led.byId.get("a").hp = 5;
    expect(lifeOverLoot(led, led.byId.get("a"))).toBe(0);
    // (Its leader on its way out: as good as none.)
    led.byId.get("boss").leaving = { why: "breaks" };
    expect(lifeOverLoot(led, led.byId.get("a"))).toBeGreaterThan(0.1);
  });

  test("never the fearless, a feral mind, a player's character, one alone, or without leadership in the fight; never with morale off", () => {
    const run = fight([hero(), goblin("a", { flags: { fearless: true } }), goblin("b", { traits: traits({ brave: 20, tactical: 0 }) }), goblin("c")]);
    for ( const id of ["a", "b"] ) run.byId.get(id).hp = 5;
    expect(lifeOverLoot(run, run.byId.get("a"))).toBe(0);
    expect(lifeOverLoot(run, run.byId.get("b"))).toBe(0);
    const alone = fight([hero(), goblin("a")]);
    alone.byId.get("a").hp = 5;
    expect(lifeOverLoot(alone, alone.byId.get("a"))).toBe(0);
    const unled = fight([hero(), goblin("a"), goblin("b")], { options: { leadership: false } });
    unled.byId.get("a").hp = 5;
    expect(lifeOverLoot(unled, unled.byId.get("a"))).toBe(0);
    const calm = fight([hero(), goblin("a"), goblin("b")], { options: { morale: false } });
    calm.byId.get("a").hp = 5;
    calm.rng = { ...calm.rng, chance: () => true };
    expect(leavesOfItsOwn(calm, calm.byId.get("a"))).toBe(null);
  });

  test("in its turn: it sets off for the edge, alone", () => {
    const run = fight([hero(), goblin("a"), goblin("b", { ...at(40) })]);
    const a = run.byId.get("a");
    a.hp = 4;
    // (Yes to that chance alone: nothing else sends it.)
    const p = lifeOverLoot(run, a);
    const rng = run.rng;
    run.rng = { ...rng, chance: q => q === p, die: n => rng.die(n), d20: () => rng.d20(), next: () => rng.next(), pick: x => rng.pick(x), shuffle: x => rng.shuffle(x) };
    takeTurn(run, a);
    expect(run.log.find(e => e.type === "flee" && e.actorId === "a")).toMatchObject({ why: "life" });
    expect(run.log.some(e => e.type === "retreat")).toBe(false);
    expect(a.leaving || a.status === "fled").toBeTruthy();
  });
});

describe("off with the prize", () => {
  test("something taken this fight and still had: it wants away, the more so greedy, a Thief, or hurt", () => {
    const run = fight([hero(), goblin("a", { traits: traits({ selfish: 50 }) }), goblin("b", { traits: traits({ selfish: 95 }) })]);
    const [h, a, b] = [run.byId.get("hero"), run.byId.get("a"), run.byId.get("b")];
    expect(prizeFlight(run, a)).toBe(0);
    h.concessions = [{ kind: "money", amount: 40, how: "theft", to: "a" }, { kind: "money", amount: 40, how: "loot", to: "b" }, { kind: "money", amount: 9, how: "bribe", to: "a", drop: { id: 1 } }];
    expect(prizeOf(run, a)).toBe(40);
    expect(prizeFlight(run, a)).toBeGreaterThan(0);
    expect(prizeFlight(run, b)).toBeGreaterThan(prizeFlight(run, a));
    a.hp = 5;
    expect(prizeFlight(run, a)).toBeGreaterThan(0.2);
    // (Given back, or taken off it: no prize.)
    h.concessions[0].returned = true;
    expect(prizeOf(run, a)).toBe(0);
  });

  test("the bigger the haul against what it had of its own, the likelier it goes", () => {
    const even = { traits: traits({ selfish: 50 }), valuables: { money: 100 } };
    const run = fight([hero(), goblin("a", even), goblin("b", even)]);
    const [h, a, b] = [run.byId.get("hero"), run.byId.get("a"), run.byId.get("b")];
    h.concessions = [{ kind: "money", amount: 2, how: "loot", to: "a" }, { kind: "money", amount: 8000, how: "loot", to: "b" }];
    // (A scrap barely tempts it; a fortune nearly the most the haul adds.)
    expect(prizeFlight(run, b) - prizeFlight(run, a)).toBeGreaterThan(0.2);
    expect(prizeFlight(run, a)).toBeLessThan(0.1);
  });

  test("in its turn: it makes off, alone; one that stands its ground stays", () => {
    const run = fight([hero(), goblin("a", { traits: traits({ selfish: 95 }) }), goblin("b", { ...at(40) })]);
    run.byId.get("hero").concessions = [{ kind: "money", amount: 40, how: "theft", to: "a" }];
    const p = prizeFlight(run, run.byId.get("a"));
    const rng = run.rng;
    run.rng = { ...rng, chance: q => q === p, die: n => rng.die(n), d20: () => rng.d20(), next: () => rng.next(), pick: x => rng.pick(x), shuffle: x => rng.shuffle(x) };
    takeTurn(run, run.byId.get("a"));
    expect(run.log.find(e => e.type === "flee" && e.actorId === "a")).toMatchObject({ why: "prize" });
  });
});
