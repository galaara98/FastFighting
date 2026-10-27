/**
 * Waiting for the moment (behavior/waiting.js, API 33): Delay where the system has it (rules.delay), else a Strike
 * readied (rules.ready), instead of a turn gone by for nothing; neither where the system has no such rules.
 */
import { describe, expect, test } from "vitest";
import { replay, prepareBattle, beginRun, answerMove, playTurn } from "../scripts/engine/simulator.js";
import { turnFor } from "../scripts/engine/battle-state.js";
import { delayFor, moveInOrder, readyStep, takeReady, readyChance, readyStrike } from "../scripts/engine/behavior/waiting.js";
import { beginLive, liveTurn } from "../scripts/engine/live.js";
import { delayedInitiative } from "../scripts/foundry/live-battle.js";
import { buildStory } from "../scripts/story/story.js";
import { logLine } from "../scripts/story/log-lines.js";
import { storyTables } from "./foundry-i18n.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const delaying = { ...pf2eRules, delay: {} };
const readying = { ...pf2eRules, ready: { cost: { actions: 2 }, most: 1 } };
const both = { ...pf2eRules, delay: {}, ready: { cost: { actions: 2 }, most: 1 } };
const english = storyTables();
const tables = { get: k => english[k] };

/** A fighter far from a foe that acts after it and will come to it. */
function farApart(extra = {}) {
  return battle([
    creature({ id: "hero", name: "Hero", position: at(0), initiative: { mod: 100 }, hp: { value: 300, max: 300 }, ...extra }),
    creature({ id: "brute", name: "Brute", side: "hostile", position: at(60), initiative: { mod: -100 }, hp: { value: 300, max: 300 } })
  ], { positioning: true, maxRounds: 2 });
}

describe("Delay: waiting for a foe to come into reach", () => {
  test("one that can't reach a foe this turn waits for the foe coming to it, then has its whole turn for blows", () => {
    const r = replay(farApart(), delaying, 1);
    const delay = r.log.find(e => e.type === "delay");
    expect(delay).toMatchObject({ actorId: "hero", why: "reach", afterId: "brute", targetId: "brute" });
    // (The brute's turn comes between the delay and the hero's turn, in the same round.)
    const brute = r.log.findIndex(e => e.actorId === "brute" && e.type === "move");
    const back = r.log.findIndex((e, i) => i > brute && e.actorId === "hero" && e.type === "attack");
    expect(brute).toBeGreaterThan(r.log.indexOf(delay));
    expect(back).toBeGreaterThan(brute);
    expect(r.log[back].round ?? r.log.find(e => e.type === "delay").round).toBe(delay.round);
  });

  test("its place in the order is after the one it waited for, from then on", () => {
    const prep = prepareBattle(farApart(), delaying);
    const run = beginRun(prep, 1, { log: true });
    const hero = run.byId.get("hero");
    run.round = 1;
    expect(delayFor(run, hero)).toMatchObject({ why: "reach", afterId: "brute" });
    // (Moved after the brute: a round going through the order carries on from it.)
    moveInOrder(run.order, hero, run.byId.get("brute"));
    expect(run.order.map(u => u.id)).toEqual(["brute", "hero"]);
  });

  test("moving in place while a round goes through the order comes to no one twice and skips no one", () => {
    const order = ["a", "u", "b", "x", "c"].map(id => ({ id }));
    const seen = [];
    for ( const o of order ) {
      seen.push(o.id);
      if ( o.id === "x" ) moveInOrder(order, order[1], o);
    }
    expect(seen).toEqual(["a", "u", "b", "x", "c"]);
    expect(order.map(o => o.id)).toEqual(["a", "b", "x", "u", "c"]);
  });

  test("no reaction while it waits, where the system says so; back with its turn", () => {
    const r = replay(farApart(), { ...delaying, delay: { reactions: false } }, 1);
    expect(r.log.some(e => e.type === "delay")).toBe(true);
    const prep = prepareBattle(farApart(), { ...delaying, delay: { reactions: false } });
    const run = beginRun(prep, 1, { log: true });
    run.round = 1;
    const hero = run.byId.get("hero");
    hero.reactionsLeft = 1;
    playTurn(run, hero);
    expect(hero.delayed).toBeTruthy();
    expect(hero.reactionsLeft).toBe(0);
  });

  test("not without the system's Delay, nor for one with a shot, nor for a feral mind", () => {
    expect(replay(farApart(), pf2eRules, 1).log.some(e => e.type === "delay")).toBe(false);
    const archer = farApart({ actions: [strike({ id: "bow", name: "Bow", melee: false, range: { increment: 60, max: 360 } })] });
    expect(replay(archer, delaying, 1).log.some(e => e.type === "delay")).toBe(false);
    const feral = farApart({ traits: { tactical: { base: 5, fudge: 0 }, brave: { base: 60, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } } });
    expect(replay(feral, delaying, 1).log.some(e => e.type === "delay")).toBe(false);
  });

  test("not for a system that passes the turn some other way (a spotlight)", () => {
    const run = beginRun(prepareBattle(farApart(), { ...delaying, roundTurns: (r, order) => order }), 1, { log: true });
    run.round = 1;
    expect(delayFor(run, run.byId.get("hero"))).toBe(null);
  });

  test("told in the log and the story", () => {
    const r = replay(farApart(), delaying, 1);
    const delay = r.log.find(e => e.type === "delay");
    // (Its words the language file's: whom it waits for, named.)
    expect(logLine(delay)).toMatch(/Hero.*Brute/);
    const text = buildStory(r, farApart(), "roleplay", { tables, seed: 1 }).text;
    expect(english["event.delayReach"].some(l => text.includes(l.replace("{actor}", "Hero").replace("{target}", "Brute")))).toBe(true);
  });
});

describe("Delay where movement is its own (rules.movement \"feet\": 5e's move, its action kept)", () => {
  // (5e-style: an action and a move of 30 feet.)
  const feet = { ...pf2eRules, mainPool: "action", movement: "feet", actionsPerTurn: 1, turn: () => ({ action: 1, move: 30 }),
    costOf: a => (typeof a.cost === "object" ? a.cost : { action: 1 }), attackPenalty: () => 0, delay: {} };
  const apart = x => battle([
    creature({ id: "hero", name: "Hero", position: at(0), initiative: { mod: 100 }, speeds: { walk: 30 }, hp: { value: 300, max: 300 } }),
    creature({ id: "brute", name: "Brute", side: "hostile", position: at(x), initiative: { mod: -100 }, speeds: { walk: 30 }, hp: { value: 300, max: 300 } })
  ], { positioning: true, maxRounds: 2 });
  const planFor = x => {
    const run = beginRun(prepareBattle(apart(x), feet), 1, { log: true });
    run.round = 1;
    return delayFor(run, run.byId.get("hero"));
  };

  test("a foe it can walk to and strike this turn: no waiting; out of its move, it waits for one who can come (a move and a Dash)", () => {
    expect(planFor(35)).toBe(null);
    expect(planFor(60)).toMatchObject({ why: "reach", afterId: "brute" });
    // (Farther than the foe's move and Dash: nothing to wait for.)
    expect(planFor(80)).toBe(null);
  });
});

describe("Delay to the round's end (rules.delay.toEnd, API 35)", () => {
  /** farApart, with a friend of the hero's who acts last of all. */
  const withLast = () => {
    const spec = farApart();
    spec.combatants.push(creature({ id: "last", name: "Last", position: at(0, 10), initiative: { mod: -200 }, hp: { value: 300, max: 300 } }));
    return spec;
  };
  const toEnd = { ...pf2eRules, delay: { toEnd: true } };

  test("it comes back after everyone, whatever it waited for, and stays last", () => {
    const run = beginRun(prepareBattle(withLast(), toEnd), 1, { log: true });
    run.round = 1;
    expect(delayFor(run, run.byId.get("hero"))).toMatchObject({ why: "reach", afterId: null, forId: "brute" });
    const r = replay(withLast(), toEnd, 1);
    const delay = r.log.find(e => e.type === "delay");
    expect(delay).toMatchObject({ actorId: "hero", afterId: null });
    const last = r.log.findIndex(e => e.actorId === "last" && e.round === delay.round);
    const back = r.log.findIndex(e => e.actorId === "hero" && e.round === delay.round && e.type !== "delay");
    expect(last).toBeGreaterThan(-1);
    expect(back).toBeGreaterThan(last);
    expect(logLine(delay)).toMatch(/Hero/);
  });
});

describe("Delay: a standoff", () => {
  test("one that wouldn't talk waits for whoever after it may break the standoff", () => {
    const spec = battle([
      creature({ id: "guard", name: "Guard", initiative: { mod: 100 }, tactics: { talk: "never" } }),
      creature({ id: "hothead", name: "Hothead", side: "hostile", initiative: { mod: -100 }, playstyles: ["impatient"], tactics: { talk: "never" } })
    ]);
    const run = beginRun(prepareBattle(spec, delaying), 1, { log: true });
    run.round = 3;
    run.standoff = true;
    const guard = run.byId.get("guard");
    guard.tac = { talk: "never" };
    run.byId.get("hothead").tac = { talk: "never" };
    expect(delayFor(run, guard)).toMatchObject({ why: "standoff", afterId: "hothead" });
  });
});

describe("Ready: a Strike for a foe that comes within reach", () => {
  /** One that can't move, a foe coming at it. */
  const stuck = () => battle([
    creature({ id: "post", name: "Post", position: at(0), initiative: { mod: 100 }, conditions: { immobilized: 1 }, hp: { value: 300, max: 300 } }),
    creature({ id: "brute", name: "Brute", side: "hostile", position: at(30), initiative: { mod: -100 }, hp: { value: 300, max: 300 } })
  ], { positioning: true, maxRounds: 1 });

  test("with what's left of a turn it can't use, it readies, and strikes as the foe comes within reach", () => {
    const r = replay(stuck(), readying, 1);
    const ready = r.log.find(e => e.type === "ready");
    expect(ready).toMatchObject({ actorId: "post", targetId: "brute" });
    const readied = r.log.find(e => e.type === "readied");
    expect(readied).toMatchObject({ actorId: "post", targetId: "brute" });
    const strike = r.log[r.log.indexOf(readied) + 1];
    expect(strike).toMatchObject({ type: "attack", actorId: "post", targetId: "brute" });
    expect(logLine(ready)).toMatch(/Post.*Longsword/);
  });

  test("not without the system's Ready", () => {
    const r = replay(stuck(), pf2eRules, 1);
    expect(r.log.some(e => e.type === "ready" || e.type === "readied")).toBe(false);
  });

  test("what it's worth: its blow at the likeliest foe, as likely as some foe is to come", () => {
    const run = beginRun(prepareBattle(stuck(), readying), 1, { log: true });
    const post = run.byId.get("post");
    const s = readyStrike(readying, post);
    expect(readyChance(run, post, s)).toMatchObject({ chance: 0.6, foe: run.byId.get("brute") });
    const step = readyStep(run, post, turnFor(run, post));
    expect(step).toMatchObject({ step: "ready", cost: { actions: 2 } });
    expect(step.worth).toBeGreaterThan(0);
    // (Too little of the turn left: none.)
    const turn = turnFor(run, post);
    turn.spend({ actions: 2 });
    expect(readyStep(run, post, turn)).toBe(null);
  });

  test("set off by a move that comes into its reach, once, and gone as its next turn begins", () => {
    const run = beginRun(prepareBattle(stuck(), readying), 1, { log: true });
    run.round = 1;
    const post = run.byId.get("post");
    const brute = run.byId.get("brute");
    const turn = turnFor(run, post);
    takeReady(run, post, turn, readyStep(run, post, turn), (u, e) => run.log.push({ ...e, actorId: u.id }));
    expect(post.readied).toMatchObject({ round: 1 });
    // (A move that stays out of reach: nothing.)
    const from = { ...brute.pos };
    brute.pos.x = 20;
    answerMove(run, brute, { feet: 10, from, to: { ...brute.pos } });
    expect(run.log.some(e => e.type === "readied")).toBe(false);
    const from2 = { ...brute.pos };
    brute.pos.x = 5;
    answerMove(run, brute, { feet: 15, from: from2, to: { ...brute.pos } });
    expect(run.log.filter(e => e.type === "readied")).toHaveLength(1);
    expect(post.readied).toBe(null);
    expect(post.reactionsLeft).toBe(0);
  });

  test("a readied blow keeps the attack penalty it had when it was readied", () => {
    const run = beginRun(prepareBattle(stuck(), readying), 1, { log: true });
    run.round = 1;
    const post = run.byId.get("post");
    const brute = run.byId.get("brute");
    const turn = turnFor(run, post);
    const step = readyStep(run, post, turn, { attacks: 1 });
    expect(step.attacks).toBe(1);
    expect(step.worth).toBeLessThan(readyStep(run, post, turn).worth);
    takeReady(run, post, turn, step, (u, e) => run.log.push({ ...e, actorId: u.id }));
    const from = { ...brute.pos };
    brute.pos.x = 5;
    answerMove(run, brute, { feet: 25, from, to: { ...brute.pos } });
    expect(run.log.find(e => e.type === "attack" && e.actorId === "post")).toMatchObject({ mod: 4 });
  });

  test("Delay comes first, where the system has both; Ready where there's no one to wait for", () => {
    const r = replay(stuck(), both, 1);
    // (Immobilized: no foe in reach this turn, and the brute is coming. It waits for it, then strikes it.)
    expect(r.log.find(e => e.type === "delay")).toMatchObject({ actorId: "post", why: "reach" });
  });
});

describe("live battles", () => {
  test("a creature that delays comes back on its turn after the one it waited for, in its new place", () => {
    const spec = { ...farApart(), options: { ...farApart().options, initiativeOrder: ["hero", "brute"] } };
    const run = beginLive(spec, delaying, { seed: 3 });
    run.round = 1;
    const first = liveTurn(run, "hero");
    expect(first.events.map(e => e.type)).toEqual(["delay"]);
    expect(run.byId.get("hero").delayed).toMatchObject({ afterId: "brute" });
    liveTurn(run, "brute");
    const back = liveTurn(run, "hero");
    expect(back.events.some(e => e.type === "delay")).toBe(false);
    expect(run.byId.get("hero").delayed).toBe(null);
    expect(run.order.map(u => u.id)).toEqual(["brute", "hero"]);
  });

  test("its initiative on the tracker: between the one it waited for and the next, or the round's last", () => {
    expect(delayedInitiative({ after: 20, next: 10 })).toBe(15);
    expect(delayedInitiative({ after: 20, next: null })).toBe(19);
    expect(delayedInitiative({ after: 20, next: 20 })).toBeCloseTo(19.999);
    expect(delayedInitiative({ after: null, lowest: 4 })).toBe(3);
    expect(delayedInitiative({})).toBe(null);
  });
});
