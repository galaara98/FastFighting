/**
 * Surprise as a fight starts (engine/behavior/surprise.js): no one; the party, or everyone against it, with a round of
 * its own first; or the system's own rule: who rolls Stealth for initiative, who loses its first turn (and can't react
 * until it's gone by), who rolls initiative at a disadvantage, who starts hidden. A system with no rule: no one.
 */
import { describe, expect, test } from "vitest";
import { replay, beginRun, prepareBattle } from "../scripts/engine/simulator.js";
import { resolveSurprise, SURPRISE } from "../scripts/engine/behavior/surprise.js";
import { surpriseMode } from "../scripts/foundry/battle.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const sides = { friendly: { label: "Party", enemies: ["hostile", "hostile2"] }, hostile: { label: "Bandits", enemies: ["friendly", "hostile2"] }, hostile2: { label: "Wolves", enemies: ["friendly", "hostile"] } };
const fighter = (id, side, over = {}) => creature({ id, side, kind: side === "friendly" ? "pc" : "npc", diesAtZero: side !== "friendly", hp: { value: 200, max: 200 }, actions: [strike({ bonus: 8 })], ...over });
const fight = (surprise, rules = pf2eRules, extra = {}) => battle([fighter("hero", "friendly"), fighter("bandit", "hostile"), fighter("wolf", "hostile2"), ...(extra.more ?? [])], { maxRounds: 2, talking: false, surprise }, sides);
const rulesWith = surprise => ({ ...pf2eRules, surprise });
const firstMoves = log => log.filter(e => e.round === 0 && e.actorId && !["thought", "initiative", "surprise"].includes(e.type)).map(e => e.actorId);

describe("surprise as the plan has it", () => {
  test("no one: no round of anyone's own first", () => {
    const r = replay(fight(SURPRISE.NONE), pf2eRules, 3);
    expect(r.log.some(e => e.type === "surprise")).toBe(false);
    expect(firstMoves(r.log)).toEqual([]);
  });

  test("the party surprises the others: a round of its own first, only the party acting in it", () => {
    const r = replay(fight(SURPRISE.PARTY_SURPRISES), pf2eRules, 3);
    expect(r.log.filter(e => e.type === "surprise").map(e => e.sideLabel)).toEqual(["Party"]);
    expect(new Set(firstMoves(r.log))).toEqual(new Set(["hero"]));
  });

  test("the party is surprised: every side against it gets that round (both hostile groups), the party none", () => {
    const r = replay(fight(SURPRISE.PARTY_SURPRISED), pf2eRules, 3);
    expect(r.log.filter(e => e.type === "surprise").map(e => e.sideLabel).sort()).toEqual(["Bandits", "Wolves"]);
    expect(firstMoves(r.log)).not.toContain("hero");
  });
});

describe("the system's own rule (Follow System)", () => {
  test("none where the system has no rule; whatever it says where it has one, odd data left out", () => {
    const plain = beginRun(prepareBattle(fight(SURPRISE.SYSTEM), pf2eRules), 1);
    expect(plain.surprise).toEqual({ by: [], round: false, stealthSides: [], surprised: [], disadvantage: [], hidden: [] });
    const said = beginRun(prepareBattle(fight(SURPRISE.SYSTEM), rulesWith(() => ({ by: ["hostile"], round: true, stealthSides: ["hostile"], surprised: ["hero", 7], hidden: ["bandit"] }))), 1);
    expect(said.surprise).toEqual({ by: ["hostile"], round: true, stealthSides: ["hostile"], surprised: ["hero"], disadvantage: [], hidden: ["bandit"] });
    // (A round of their own only for those it names.)
    expect(resolveSurprise({ ...said, prep: { ...said.prep, rules: rulesWith(() => ({ round: true })) } }).round).toBe(false);
  });

  test("surprised: its first turn goes by (it can't react until then); after, it fights as anyone", () => {
    const r = replay(fight(SURPRISE.SYSTEM, rulesWith(() => ({ surprised: ["hero"] }))), rulesWith(() => ({ surprised: ["hero"] })), 4);
    const heroRound1 = r.log.filter(e => e.round === 1 && e.actorId === "hero" && e.turnOf === "hero" && e.type !== "thought").map(e => e.type);
    expect(heroRound1).toEqual(["surprised"]);
    expect(r.log.some(e => e.round === 2 && e.actorId === "hero" && e.type === "attack")).toBe(true);
    const run = beginRun(prepareBattle(fight(SURPRISE.SYSTEM, rulesWith(() => ({ surprised: ["hero"] }))), rulesWith(() => ({ surprised: ["hero"] }))), 4);
    expect(run.byId.get("hero").reactionsLeft).toBe(0);
  });

  test("at a disadvantage on initiative: later in the order, more often than not", () => {
    const order = rules => {
      let late = 0;
      for ( let seed = 1; seed <= 200; seed++ ) {
        const run = beginRun(prepareBattle(fight(SURPRISE.SYSTEM, rules), rules), seed);
        if ( run.order.findIndex(u => u.id === "hero") === run.order.length - 1 ) late += 1;
      }
      return late;
    };
    expect(order(rulesWith(() => ({ disadvantage: ["hero"] })))).toBeGreaterThan(order(pf2eRules) + 20);
  });

  test("starting hidden: hidden from the start, until what it does gives it away", () => {
    const run = beginRun(prepareBattle(fight(SURPRISE.SYSTEM, rulesWith(() => ({ hidden: ["bandit"] }))), rulesWith(() => ({ hidden: ["bandit"] }))), 1);
    expect(run.byId.get("bandit").conds.hidden).toBeGreaterThan(0);
    expect(run.byId.get("hero").conds.hidden ?? 0).toBe(0);
  });
});

describe("the planner's Surprise", () => {
  const helper = surprise => ({ rules: surprise ? { surprise: () => null } : {} });
  test("Follow System where the system has rules; no one where it hasn't", () => {
    expect(surpriseMode("system", helper(true))).toBe("system");
    expect(surpriseMode("system", helper(false))).toBe("none");
    expect(surpriseMode(undefined, helper(true))).toBe("system");
    expect(surpriseMode("none", helper(true))).toBe("none");
  });
});
