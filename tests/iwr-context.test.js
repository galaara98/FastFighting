/**
 * API 20: what a blow's damage reaches rules.applyIwr with beside its types (evaluate.js iwrContext): how much of it is
 * precision or splash (sampleDamage's byCategory), whether it's an area's, a critical hit, magical, its materials, and
 * the action; a critical hit on one the system makes immune to its doubling (rules.critImmune) dealing a normal hit's
 * damage; and the Statistics Engine's estimate counting what a use adds (a sneak attack) against resistances too.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, prepareBattle, takeTurn } from "../scripts/engine/simulator.js";
import { expectedDamage, meanDamageVs } from "../scripts/engine/behavior/evaluate.js";
import { parseFormula, part, sampleDamage } from "../scripts/engine/dice.js";
import { createRng } from "../scripts/engine/rng.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

/** The fixture's rules, each applyIwr call's arguments noted. */
function spying(extra = {}) {
  const calls = [];
  const rules = { ...pf2eRules, ...extra, applyIwr(iwr, byType, target, ctx) {
    calls.push({ byType: { ...byType }, target, ctx });
    return (extra.applyIwr ?? pf2eRules.applyIwr).call(this, iwr, byType, target, ctx);
  } };
  return { rules, calls };
}

function fight(rules, a, b) {
  const run = beginRun(prepareBattle(battle([a, b]), rules), 1, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}

const target = (over = {}) => creature({ id: "target", side: "hostile", hp: { value: 900, max: 900 }, flags: { fearless: true }, ...over });

describe("sampleDamage: how much of each type each category is", () => {
  test("a sneak attack's precision and a bomb's splash, part of their type's amount", () => {
    const rolled = sampleDamage([part([], 5, "piercing"), part([], 3, "piercing", { category: "precision" }), part([], 1, "fire", { category: "splash" })], createRng(1));
    expect(rolled.byType).toEqual({ piercing: 8, fire: 1 });
    expect(rolled.byCategory).toEqual({ precision: { piercing: 3 }, splash: { fire: 1 } });
  });
});

describe("what applyIwr hears with a blow", () => {
  test("its precision, a critical hit, the action's materials and traits, the action itself", () => {
    const { rules, calls } = spying();
    const knife = strike({ id: "knife", bonus: 60, damage: [parseFormula("4", "piercing"), part([], 2, "piercing", { category: "precision" })], materials: ["silver"], traits: ["finesse"] });
    const run = fight(rules, creature({ id: "rogue", actions: [knife] }), target());
    calls.length = 0;
    takeTurn(run, run.byId.get("rogue"));
    // (Its estimates hear the same, a normal hit's and a critical's; bonus 60, every blow a critical hit.)
    const heard = calls.filter(c => c.target?.id === "target" && c.ctx?.action?.id === "knife");
    expect(heard.length).toBeGreaterThan(0);
    for ( const { ctx } of heard ) {
      expect(ctx.materials).toEqual(["silver"]);
      expect(ctx.traits).toEqual(["finesse"]);
      expect(ctx.area).toBe(false);
      expect(ctx.magical).toBe(false);
    }
    const crits = heard.filter(c => c.ctx.crit);
    expect(crits.length).toBeGreaterThan(0);
    for ( const { ctx, byType } of crits ) {
      // (The precision doubled with the rest.)
      expect(ctx.byCategory.precision.piercing).toBe(4);
      expect(byType.piercing).toBe(12);
    }
    const hits = run.log.filter(e => e.type === "attack" && e.actorId === "rogue" && e.degree === 3);
    expect(hits.length).toBeGreaterThan(0);
    for ( const e of hits ) expect(e.damage).toBe(12);
  });

  test("an area's: area; a save's critical failure isn't a critical hit", () => {
    const { rules, calls } = spying();
    const blast = { id: "blast", name: "Fireball", kind: "save", cost: 2, rank: 3, damage: [parseFormula("6", "fire")], save: { type: "reflex", dc: 60, basic: true }, area: { targets: 3 }, range: { increment: 500, max: 500 } };
    const run = fight(rules, creature({ id: "mage", actions: [blast] }), target());
    calls.length = 0;
    takeTurn(run, run.byId.get("mage"));
    const hits = calls.filter(c => c.ctx?.action?.id === "blast");
    expect(hits.length).toBeGreaterThan(0);
    for ( const { ctx } of hits ) {
      expect(ctx.area).toBe(true);
      expect(ctx.magical).toBe(true);
      expect(ctx.crit).toBe(false);
    }
  });

  test("the Statistics Engine's estimate hears the same", () => {
    const { rules, calls } = spying();
    const knife = strike({ id: "knife2", damage: [parseFormula("4", "piercing"), part([], 2, "piercing", { category: "precision" })], materials: ["cold-iron"] });
    const run = fight(rules, creature({ id: "rogue", actions: [knife] }), target());
    calls.length = 0;
    meanDamageVs(run, knife, run.byId.get("target"));
    const normal = calls.find(c => !c.ctx.crit);
    const crit = calls.find(c => c.ctx.crit);
    expect(normal.ctx.byCategory.precision.piercing).toBe(2);
    expect(crit.ctx.byCategory.precision.piercing).toBe(4);
    expect(normal.ctx.materials).toEqual(["cold-iron"]);
  });
});

describe("a critical hit on one immune to its doubling (rules.critImmune)", () => {
  const immuneRules = { ...pf2eRules, critImmune: t => !!t.spec.iwr?.immune?.includes("critical-hits") };
  const blow = () => strike({ id: "maul", bonus: 60, damage: [parseFormula("4", "bludgeoning")] });

  test("a normal hit's damage, though the hit is critical", () => {
    const run = fight(immuneRules, creature({ id: "brute", actions: [blow()] }), target({ iwr: { immune: ["critical-hits"] } }));
    takeTurn(run, run.byId.get("brute"));
    const hits = run.log.filter(e => e.type === "attack" && e.actorId === "brute" && e.degree === 3);
    expect(hits.length).toBeGreaterThan(0);
    for ( const e of hits ) expect(e.damage).toBe(4);
  });

  test("one not immune takes it doubled; the estimate tells them apart", () => {
    const run = fight(immuneRules, creature({ id: "brute", actions: [blow()] }), target());
    takeTurn(run, run.byId.get("brute"));
    for ( const e of run.log.filter(x => x.type === "attack" && x.actorId === "brute" && x.degree === 3) ) expect(e.damage).toBe(8);
    const immune = fight(immuneRules, creature({ id: "brute", actions: [blow()] }), target({ iwr: { immune: ["critical-hits"] } }));
    expect(meanDamageVs(immune, blow(), immune.byId.get("target")).critical).toBe(4);
    expect(meanDamageVs(run, blow(), run.byId.get("target")).critical).toBe(8);
  });
});

describe("the estimate counts what a use adds against resistances", () => {
  test("a sneak attack's precision against one that takes none: not counted", () => {
    // (Rules that take precision off one immune to it: what PF2e does.)
    const noPrecision = (iwr, byType, t, ctx) => pf2eRules.applyIwr(iwr, Object.fromEntries(Object.entries(byType)
      .map(([k, v]) => [k, iwr?.immune?.includes("precision") ? v - (ctx?.byCategory?.precision?.[k] ?? 0) : v])), t, ctx);
    const rules = { ...pf2eRules, applyIwr: noPrecision };
    const knife = strike({ id: "shiv", bonus: 9, damage: [parseFormula("4", "piercing")], bonusDamage: [{ when: "always", parts: [part([], 6, "piercing", { category: "precision" })] }] });
    const plain = strike({ id: "shiv-plain", bonus: 9, damage: [parseFormula("4", "piercing")] });
    const vsImmune = fight(rules, creature({ id: "rogue", actions: [knife] }), target({ iwr: { immune: ["precision"] } }));
    const [r1, t1] = ["rogue", "target"].map(id => vsImmune.byId.get(id));
    expect(expectedDamage(vsImmune, r1, knife, t1)).toBeCloseTo(expectedDamage(vsImmune, r1, plain, t1), 6);
    const vsOther = fight(rules, creature({ id: "rogue", actions: [knife] }), target());
    const [r2, t2] = ["rogue", "target"].map(id => vsOther.byId.get(id));
    expect(expectedDamage(vsOther, r2, knife, t2)).toBeGreaterThan(expectedDamage(vsOther, r2, plain, t2) + 3);
  });
});
