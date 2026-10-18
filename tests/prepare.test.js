/**
 * Getting ready (API 20): weapons in hand and loaded (engine/gear.js), and what a creature does with a turn it can't
 * spend on what it wants most (behavior/prepare.js): drawing, reloading, getting a potion out, moving into position.
 */
import { describe, expect, test } from "vitest";
import { replay, beginRun, prepareBattle } from "../scripts/engine/simulator.js";
import { costOf } from "../scripts/engine/turn.js";
import { gearOf, needsDraw, isLoaded, roundsLoaded, startLoaded, readyUnits, reloadPerUse, initGear, draw, load, fire, used, gearState, syncGear, usable } from "../scripts/engine/gear.js";
import { hasUses } from "../scripts/engine/behavior/evaluate.js";
import { coverOf, enemiesOf } from "../scripts/engine/battle-state.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const heavyCrossbow = (over = {}) => strike({ id: "xbow", name: "Heavy Crossbow", melee: false, reach: undefined, range: { increment: 120, max: 720 }, bonus: 9,
  damage: [parseFormula("1d10+2", "piercing")], reload: 2, hands: 2, ...over });
const fist = () => strike({ id: "fist", name: "Fist", bonus: 7, damage: [parseFormula("1d4+2", "bludgeoning")], hands: 0 });
/** A foe that stays where it is and does nothing to speak of. */
const post = (id, x, y = 0, over = {}) => creature({ id, name: id, side: "hostile", position: at(x, y), hp: { value: 80, max: 80 }, actions: [strike({ bonus: -50 })],
  conditions: { immobilized: 1 }, flags: { fearless: true }, ...over });
/** A creature's own events (not its thoughts), turn by turn: [[round, type, step]]. */
const mine = (r, id) => r.log.filter(e => e.actorId === id && e.type !== "thought" && e.turnOf === id).map(e => [e.round, e.type, e.step ?? null]);
const byRound = (r, id, round) => mine(r, id).filter(x => x[0] === round).map(x => (x[2] ? `${x[1]}:${x[2]}` : x[1]));

/** 5e-style rules: an action and movement in feet (no bonus action), from the three-action fixture's dice. */
const feetRules = { ...pf2eRules, mainPool: "action", movement: "feet", actionsPerTurn: 1, turn: () => ({ action: 1, move: 30 }), costOf: a => (typeof a.cost === "object" ? a.cost : { action: 1 }),
  attackPenalty: () => 0, disengage: () => ({ cost: { action: 1 }, label: "" }) };

describe("gear: in hand and loaded (engine/gear.js)", () => {
  test("a weapon's gear key, its draw and its Reload, and what a use costs", () => {
    const u = { drawn: new Set(), loaded: new Map() };
    const xbow = heavyCrossbow({ drawCost: 1, loaded: false });
    initGear(u, [xbow]);
    expect(gearOf(xbow)).toBe("xbow");
    expect(gearOf({ id: "a", gear: "w1" })).toBe("w1");
    expect(needsDraw(u, xbow)).toBe(true);
    expect(isLoaded(u, xbow)).toBe(false);
    expect(readyUnits(u, xbow)).toBe(3);
    expect(costOf(pf2eRules, xbow, u)).toEqual({ actions: 4 });
    expect(costOf(pf2eRules, xbow)).toEqual({ actions: 1 });
    expect(reloadPerUse(xbow)).toBe(2);
    draw(u, xbow);
    load(u, xbow);
    expect(costOf(pf2eRules, xbow, u)).toEqual({ actions: 1 });
    fire(u, xbow);
    expect(roundsLoaded(u, xbow)).toBe(0);
    expect(gearState(u)).toEqual({ inHand: ["xbow"], loaded: { xbow: 0 } });
    syncGear(u, { out: ["xbow"], loaded: { xbow: 1 } });
    expect(needsDraw(u, xbow)).toBe(true);
    expect(isLoaded(u, xbow)).toBe(true);
  });

  test("loaded unless it says otherwise; a capacity's rounds; a minute's Reload: its one shot, then none", () => {
    expect(startLoaded(heavyCrossbow())).toBe(1);
    expect(startLoaded(heavyCrossbow({ loaded: false }))).toBe(0);
    expect(startLoaded(heavyCrossbow({ capacity: 3, loaded: 2 }))).toBe(2);
    expect(startLoaded(heavyCrossbow({ capacity: 3 }))).toBe(3);
    const minute = heavyCrossbow({ id: "arb", reload: Infinity });
    const u = { drawn: new Set(), loaded: new Map(), resources: {}, uses: {} };
    initGear(u, [minute]);
    expect(hasUses(u, minute)).toBe(true);
    expect(readyUnits(u, minute)).toBe(0);
    used(u, minute);
    expect(usable(u, minute)).toBe(false);
    expect(hasUses(u, minute)).toBe(false);
    expect(reloadPerUse(minute)).toBe(0);
  });

  test("used: a potion drunk (drawEach) is gone from the hand", () => {
    const u = { drawn: new Set(["p"]), loaded: new Map() };
    used(u, { id: "p", drawCost: 1, drawEach: true });
    expect(u.drawn.has("p")).toBe(false);
  });
});

describe("a weapon not in hand or not loaded: drawn and loaded now, for next turn", () => {
  const harsk = (over = {}) => creature({ id: "harsk", name: "Harsk", kind: "pc", position: at(0), hp: { value: 40, max: 40 }, speeds: { walk: 20 },
    actions: [heavyCrossbow({ drawCost: 1, loaded: false }), fist()], tactics: { style: "ranged" }, ...over });
  const field = (over = {}) => battle([harsk(over), post("mage", 85), post("kobold", 75, 10)], { positioning: true, maxRounds: 3 });

  test("Harsk: an unheld, unloaded heavy crossbow, the kobolds in range: turn 1 Draw and Reload, turn 2 a shot and a Reload", () => {
    for ( const seed of [1, 2, 3] ) {
      const r = replay(field(), pf2eRules, seed);
      expect(byRound(r, "harsk", 1)).toEqual(["prepare:draw", "draw", "prepare:reload", "reload"]);
      expect(byRound(r, "harsk", 2)).toEqual(["attack", "prepare:reload", "reload"]);
      expect(r.log.filter(e => e.actorId === "harsk" && e.type === "lazy")).toEqual([]);
      // (Told why: the desire it serves, at whom.)
      const why = r.log.find(e => e.actorId === "harsk" && e.type === "prepare");
      expect(why).toMatchObject({ desire: "hurt", item: "Heavy Crossbow" });
      expect(why.worth).toBeGreaterThan(0);
    }
  });

  test("loaded across turns: a loaded crossbow (reload 1) shoots at once; the turn's last action reloads it", () => {
    const spec = battle([
      creature({ id: "archer", position: at(0), actions: [heavyCrossbow({ id: "light", name: "Crossbow", reload: 1 }), fist()], tactics: { style: "ranged" } }),
      post("target", 60)
    ], { positioning: true, maxRounds: 2 });
    const r = replay(spec, pf2eRules, 1);
    // (Shot, Reload and shot again, then Reload with the last action: loaded for the next turn.)
    expect(byRound(r, "archer", 1)).toEqual(["attack", "reload", "attack"]);
    expect(byRound(r, "archer", 2)).toEqual(["reload", "attack", "prepare:reload", "reload"]);
  });

  test("a melee creature too far away moves toward its target, not idle", () => {
    const spec = battle([creature({ id: "brute", position: at(0) }), post("far", 200)], { positioning: true, maxRounds: 1 });
    const r = replay(spec, pf2eRules, 1);
    expect(r.log.filter(e => e.actorId === "brute" && e.type === "move").length).toBeGreaterThan(0);
    expect(r.log.filter(e => e.actorId === "brute" && e.type === "lazy")).toEqual([]);
  });

  test("a Lazy creature still slacks now and then", () => {
    const pill = combinePlaystyles(["lazy"]);
    let slacked = 0;
    let readied = 0;
    for ( let seed = 1; seed <= 30; seed++ ) {
      const r = replay(field({ behavior: pill.behavior, playstyles: ["lazy"] }), pf2eRules, seed);
      slacked += r.log.filter(e => e.actorId === "harsk" && e.type === "lazy" && e.chose).length;
      readied += r.log.filter(e => e.actorId === "harsk" && e.type === "prepare").length;
    }
    expect(slacked).toBeGreaterThan(0);
    expect(readied).toBeGreaterThan(slacked);
  });
});

describe("healing it can't give this turn", () => {
  test("a potion it can't drink this turn: got out now, drunk next turn", () => {
    const potion = { id: "drinker.item.p", name: "Healing Potion", kind: "heal", cost: 1, heal: [parseFormula("3d8+10", "healing")], selfOnly: true, resource: "item:p",
      drawCost: 1, drawEach: true, hands: 1 };
    const spec = battle([
      creature({ id: "drinker", position: at(0), hp: { value: 6, max: 40 }, conditions: { slowed: 2 }, resources: { "item:p": 2 }, tactics: { potionThreshold: "50", consumables: "freely" },
        actions: [strike(), potion] }),
      post("foe", 60)
    ], { positioning: true, maxRounds: 2 });
    const r = replay(spec, pf2eRules, 1);
    expect(byRound(r, "drinker", 1)).toEqual(["prepare:retrieve", "draw"]);
    expect(byRound(r, "drinker", 2)).toEqual(["heal"]);
  });

  test("a healer too far from a dying friend ends its turn beside them, and heals them the next", () => {
    const touch = { id: "healer.lay", name: "Lay on Hands", kind: "heal", cost: 2, reach: 5, heal: [parseFormula("2d8+8", "healing")] };
    const spec = battle([
      creature({ id: "healer", position: at(0), actions: [strike(), touch], tactics: { healAggro: "aggressive", allyDying: "rescue" } }),
      creature({ id: "friend", position: at(65), hp: { value: 0, max: 30 }, dying: 1, stable: false, diesAtZero: false, kind: "pc" }),
      post("foe", 200)
    ], { positioning: true, maxRounds: 2 });
    const r = replay(spec, pf2eRules, 2);
    const first = r.log.filter(e => e.actorId === "healer" && e.round === 1);
    expect(first.some(e => e.type === "prepare" && e.step === "tend" && e.targetId === "friend")).toBe(true);
    expect(first.filter(e => e.type === "move").length).toBeGreaterThan(0);
    const healed = r.log.find(e => e.actorId === "healer" && e.type === "heal");
    expect(healed?.round).toBe(2);
    expect(healed.targetId).toBe("friend");
  });
});

describe("spare movement, after the turn's main action", () => {
  test("a melee creature that has spent its action, its target out of reach, ends its turn closer", () => {
    const spec = battle([
      creature({ id: "runner", position: at(0), actions: [strike({ id: "axe", name: "Axe", bonus: 30, damage: [parseFormula("40", "slashing")] })] }),
      creature({ id: "mook", side: "hostile", position: at(5), hp: { value: 5, max: 5 }, actions: [strike({ bonus: -50 })], flags: { fearless: true } }),
      post("boss", 90)
    ], { positioning: true, maxRounds: 1 });
    const r = replay(spec, feetRules, 1);
    const own = r.log.filter(e => e.actorId === "runner" && e.round === 1 && e.type !== "thought");
    expect(own[0].type).toBe("attack");
    const moved = own.find(e => e.type === "move");
    expect(moved?.to.x).toBeGreaterThan(20);
  });

  test("a protective tank attacks, then steps in between a foe and the fragile friend it guards", () => {
    const tank = combinePlaystyles(["tank"]);
    const spec = battle([
      creature({ id: "tank", name: "Tank", position: at(20, 25), playstyles: ["tank"], behavior: tank.behavior, desireStyle: tank.desire, tactics: { style: "protector", target: "protect" },
        hp: { value: 60, max: 60 }, actions: [strike({ id: "javelin", name: "Javelin", melee: false, reach: undefined, range: { increment: 30, max: 120 }, thrown: true })] }),
      creature({ id: "wizard", name: "Wizard", position: at(0), hp: { value: 12, max: 30 }, conditions: { immobilized: 1 },
        actions: [strike({ id: "ray", name: "Ray", kind: "spell-attack", melee: false, reach: undefined, range: { increment: 60, max: 60 }, bonus: -50 })] }),
      creature({ id: "brute", name: "Brute", side: "hostile", position: at(30), hp: { value: 80, max: 80 }, flags: { fearless: true },
        actions: [strike({ id: "club", name: "Club", bonus: 12, damage: [parseFormula("2d8+6", "bludgeoning")] })] })
    ], { positioning: true, maxRounds: 1, initiativeOrder: ["tank", "wizard", "brute"] });
    const r = replay(spec, feetRules, 1);
    const own = r.log.filter(e => e.actorId === "tank" && e.type !== "thought");
    // (It attacks with its action: the move is what's spare.)
    expect(own[0].type).toBe("attack");
    const why = own.find(e => e.type === "prepare");
    expect(why?.step).toBe("guard");
    const to = own.find(e => e.type === "move").to;
    // (Across the brute's way to the wizard: nearer the brute than the wizard is, and close to the line between them.)
    expect(Math.hypot(to.x - 30, to.y)).toBeLessThan(25);
    expect(Math.abs(to.y)).toBeLessThanOrEqual(10);
  });

  test("a Chicken strikes, then gets out of its foe's reach with the movement it has left", () => {
    const chicken = combinePlaystyles(["chicken"]);
    const spec = battle([
      creature({ id: "chicken", name: "Chicken", position: at(0), playstyles: ["chicken"], behavior: chicken.behavior, desireStyle: chicken.desire, hp: { value: 30, max: 30 },
        traits: { tactical: { base: 60, fudge: 0 }, brave: { base: 30, fudge: 0 }, selfish: { base: 60, fudge: 0 }, loyal: { base: 40, fudge: 0 } },
        tactics: { retreat: "never" }, avoidFleeing: 1, actions: [strike({ id: "dagger", name: "Dagger" })] }),
      creature({ id: "friend", name: "Friend", position: at(-30, 0), hp: { value: 40, max: 40 }, conditions: { immobilized: 1 }, actions: [strike({ bonus: -50 })] }),
      creature({ id: "ogre", name: "Ogre", side: "hostile", position: at(5), hp: { value: 80, max: 80 }, flags: { fearless: true },
        actions: [strike({ id: "club", name: "Club", bonus: 12, damage: [parseFormula("2d10+7", "bludgeoning")] })] })
    ], { positioning: true, maxRounds: 1, morale: false, initiativeOrder: ["chicken", "friend", "ogre"] });
    const r = replay(spec, feetRules, 1);
    const own = r.log.filter(e => e.actorId === "chicken" && e.type !== "thought" && e.round === 1);
    expect(own[0].type).toBe("attack");
    expect(own.find(e => e.type === "prepare")?.step).toBe("fallBack");
    const to = own.find(e => e.type === "move").to;
    // (Out of the ogre's reach, and more than a move and a swing away.)
    expect(Math.hypot(to.x - 5, to.y)).toBeGreaterThan(30);
  });

  test("a hider with movement and no action left makes for cover, and hides from there", () => {
    const wallflower = combinePlaystyles(["wallflower"]);
    // (A rogue's: Hide a bonus action, only from cover, and hidden worth something.)
    const rogueRules = { ...feetRules, turn: () => ({ action: 1, bonus: 1, move: 30 }),
      usable: (run, u, a) => !a.hide || enemiesOf(run, u).every(o => coverOf(run, u, o) !== "none"),
      conditionMods: (k, v) => (k === "hidden" ? { ac: 4, attack: 1 } : pf2eRules.conditionMods?.(k, v) ?? null) };
    const hide = { id: "sneak.hide", name: "Hide", kind: "buff", targets: "self", cost: { bonus: 1 }, hide: true, setup: true, leans: ["lowProfile"], maneuver: "hide",
      check: { mod: 12, against: "perception" }, onDegree: [null, null, { conditions: { hidden: 1 }, rounds: 1 }, { conditions: { hidden: 1 }, rounds: 1 }] };
    const spec = battle([
      creature({ id: "sneak", name: "Sneak", position: at(0), playstyles: ["wallflower"], behavior: wallflower.behavior, desireStyle: wallflower.desire, hp: { value: 30, max: 30 },
        actions: [strike({ id: "bow", name: "Shortbow", melee: false, reach: undefined, range: { increment: 60, max: 360 }, bonusDamage: [{ when: "offGuard", parts: [parseFormula("2d6", "piercing")] }] }), hide] }),
      creature({ id: "archer", name: "Archer", side: "hostile", position: at(60), hp: { value: 80, max: 80 }, flags: { fearless: true }, conditions: { immobilized: 1 },
        actions: [strike({ id: "longbow", name: "Longbow", melee: false, reach: undefined, range: { increment: 100, max: 600 }, bonus: 10, damage: [parseFormula("1d8+4", "piercing")] })] })
    ], { positioning: true, maxRounds: 2, initiativeOrder: ["sneak", "archer"] });
    spec.walls = [{ a: [10, 3], b: [10, 40], s: 20 }];
    const r = replay(spec, rogueRules, 1);
    const first = r.log.filter(e => e.actorId === "sneak" && e.round === 1 && e.type !== "thought");
    expect(first[0].type).toBe("attack");
    expect(first.find(e => e.type === "prepare")?.step).toBe("cover");
    const second = r.log.filter(e => e.actorId === "sneak" && e.round === 2 && e.type !== "thought");
    expect(second.some(e => e.type === "buff" && e.maneuver === "hide")).toBe(true);
  });
});
