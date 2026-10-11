/**
 * Playstyle taunts: the Tank, the taunt perk (its share of the Taunting setting) and the playstyles that shrug taunts
 * off. A playstyle's taunt is talking: an action as dear as the rules say, its best of threats and mockery against the
 * foe's resistance, then the luck check.
 */
import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { prepareBattle, createRun } from "../scripts/engine/battle-state.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";
import { goadLuck } from "../scripts/engine/behavior/goad.js";
import { isImmune } from "../scripts/engine/behavior/control.js";
import { costOf } from "../scripts/engine/turn.js";
import { TAUNT_LUCK } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle, social } from "./helpers.js";

const tactical = { tactical: { base: 70, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
const wizard = () => creature({ id: "wiz", kind: "pc", diesAtZero: false, hp: { value: 400, max: 400 }, defenses: { ac: 12, fortitude: 4, reflex: 4, will: 8 }, actions: [strike({ bonus: -20 })] });
const tank = (extra = {}) => creature({ id: "tank", kind: "pc", diesAtZero: false, hp: { value: 400, max: 400 }, defenses: { ac: 24, fortitude: 10, reflex: 6, will: 6 }, traits: tactical,
  actions: [strike({ bonus: -20 })], behavior: { taunt: 1 }, social: social({ intimidation: 14, deception: 4 }), ...extra });
const brute = (extra = {}) => creature({ id: "brute", side: "hostile", hp: { value: 400, max: 400 }, flags: { fearless: true }, social: social({ willDC: 14 }),
  desires: [{ kind: "hurt", targetId: "wiz", level: 50 }], actions: [strike({ id: "maul", bonus: 12, damage: [parseFormula("2d8+6", "bludgeoning")] })], ...extra });
const fights = (combatants, options, n = 20) => {
  const out = { atWizard: 0, goads: 0, took: 0, shrugged: 0, luck: [] };
  for ( let seed = 1; seed <= n; seed++ ) {
    const log = replay(battle(combatants(), { maxRounds: 4, ...options }), pf2eRules, seed).log;
    out.atWizard += log.filter(e => e.type === "attack" && e.actorId === "brute" && e.targetId === "wiz").length;
    const goads = log.filter(e => e.type === "control" && e.goad);
    out.goads += goads.length;
    out.took += goads.filter(e => e.took).length;
    out.shrugged += goads.filter(e => e.shrugged).length;
    out.luck.push(...goads.filter(e => e.luck !== null).map(e => e.needed));
  }
  return out;
};

describe("playstyle taunts", () => {
  test("the Tank taunts with all of the setting as its first pick; the others less, and less further down", () => {
    expect(combinePlaystyles(["tank"]).behavior.taunt).toBe(1);
    expect(combinePlaystyles(["instigator"]).behavior.taunt).toBe(0.75);
    expect(combinePlaystyles(["martyr"]).behavior.taunt).toBe(0.55);
    expect(combinePlaystyles(["brawler"]).behavior.taunt).toBe(0.4);
    expect(combinePlaystyles(["redeemSeeker"]).behavior.taunt).toBe(0.3);
    expect(combinePlaystyles(["skeptic", "tank"]).behavior).toMatchObject({ taunt: 0.75, tauntProof: 0.6 });
    expect(combinePlaystyles(["tank"], { stayTrue: true }).behavior.taunt).toBe(0.1);
    expect(combinePlaystyles(["relentless"]).behavior.tauntProof).toBe(0.75);
  });

  test("a taunter has a taunt: an action as dear as the rules say, its talking, the setting times its share", () => {
    const prep = prepareBattle(battle([tank({ behavior: { taunt: 0.75 } }), brute()]), pf2eRules);
    const goad = prep.byId.get("tank").offense.find(a => a.goad);
    expect(goad).toMatchObject({ kind: "control", goad: 0.75, pitches: ["intimidate", "deceive"], cost: { actions: 1 }, fixedCost: true });
    const run = createRun(prep);
    expect(goadLuck(run, goad)).toBe(Math.round(TAUNT_LUCK * 0.75));
    run.prep.options.tauntLuck = 80;
    expect(goadLuck(run, goad)).toBe(60);
    // (The mindless pay it no heed.)
    expect(isImmune(run, { ...run.byId.get("brute"), spec: { ...run.byId.get("brute").spec, social: { mindless: true } } }, { ...goad, id: null })).toBe(true);
    // No taunt without the playstyle, a voice, or talking.
    expect(prepareBattle(battle([tank({ behavior: {} }), brute()]), pf2eRules).byId.get("tank").offense.some(a => a.goad)).toBe(false);
    expect(prepareBattle(battle([tank({ social: undefined }), brute()]), pf2eRules).byId.get("tank").offense.some(a => a.goad)).toBe(false);
    expect(prepareBattle(battle([tank(), brute()], { talking: false }), pf2eRules).byId.get("tank").offense.some(a => a.goad)).toBe(false);
  });

  test("its cost is the rules' for a taunt, whatever their costs for actions would make of it", () => {
    const rules = { mainPool: "action", costOf: () => ({ action: 1 }) };
    expect(costOf(rules, { goad: 1, fixedCost: true, cost: { bonus: 1 } })).toEqual({ bonus: 1 });
    expect(costOf(rules, { cost: { bonus: 1 } })).toEqual({ action: 1 });
  });

  test("in a fight: the Tank's taunts draw the brute off the wizard; at 0 they never take hold", () => {
    const without = fights(() => [wizard(), tank({ behavior: {} }), brute()]);
    const taunting = fights(() => [wizard(), tank(), brute()], { tauntLuck: 100 });
    expect(taunting.took).toBeGreaterThan(0);
    expect(taunting.atWizard).toBeLessThan(without.atWizard * 0.8);
    expect(new Set(taunting.luck)).toEqual(new Set([100]));
    const never = fights(() => [wizard(), tank(), brute()], { tauntLuck: 0 });
    expect(never.took).toBe(0);
  });

  test("a Relentless foe shrugs most taunts off", () => {
    const stubborn = fights(() => [wizard(), tank(), brute({ behavior: { tauntProof: 0.9 } })], { tauntLuck: 100 });
    const plain = fights(() => [wizard(), tank(), brute()], { tauntLuck: 100 });
    expect(stubborn.shrugged).toBeGreaterThan(0);
    expect(stubborn.atWizard).toBeGreaterThan(plain.atWizard);
  });
});
