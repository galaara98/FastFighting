/**
 * Afflictions (behavior/afflictions.js): PF2e's staged ones honoured (a stage's length, virulent, which exposures
 * worsen it), simple ones for systems without stages (a hex, a disease: one condition, its value the stage), 5e's
 * counted saves; healing over time an effect gives; temporary hit points.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, endOfTurn, exposeToAffliction, prepareBattle } from "../scripts/engine/simulator.js";
import { simpleAffliction, stageMove } from "../scripts/engine/behavior/afflictions.js";
import { applyOutcome } from "../scripts/engine/behavior/effects.js";
import { regenOf } from "../scripts/engine/battle-state.js";
import { networkOf, setCondition, setAffliction } from "../scripts/engine/live.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

/** Its saves: hopeless (every save a critical failure) or sure (a critical success). */
const fort = n => ({ defenses: { ac: 16, fortitude: n, reflex: 7, will: 7 } });
const hag = () => creature({ id: "hag", name: "Hag", actions: [strike({ bonus: -50 })] });
const victim = (extra = {}) => creature({ id: "victim", name: "Victim", side: "hostile", hp: { value: 100, max: 100 }, actions: [strike({ bonus: -50 })], ...fort(-100), ...extra });

function fight(list, rules = pf2eRules) {
  const run = beginRun(prepareBattle(battle(list, { maxRounds: 10, aftermath: "none" }), rules), 3, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}
const turns = (run, u, n) => { for ( let i = 0; i < n; i++ ) endOfTurn(run, u); };
const sting = (extra = {}) => ({ kind: "affliction", id: "sting", name: "Sting", traits: ["poison"], save: { type: "fortitude", dc: 16 },
  stages: [1, 2, 3].map(n => ({ damage: [parseFormula(String(n), "poison")], conditions: { enfeebled: n } })), ...extra });

describe("staged afflictions, as PF2e has them", () => {
  test("a save only at the end of a stage: a two-round stage waits a round", () => {
    const worsens = { ...pf2eRules, afflictionStep: (d, phase) => (phase === "exposure" ? 1 : 1) };
    const run = fight([hag(), victim()], worsens);
    const v = run.byId.get("victim");
    exposeToAffliction(run, run.byId.get("hag"), v, sting({ stages: sting().stages.map(s => ({ ...s, duration: 2 })) }));
    expect(v.afflictions[0].stage).toBe(1);
    turns(run, v, 1);
    expect(v.afflictions[0].stage).toBe(1);
    turns(run, v, 1);
    expect(v.afflictions[0].stage).toBe(2);
    expect(v.conds.enfeebled).toBe(2);
  });

  test("virulent: two saves in a row to ease it a stage; a critical success eases it only one", () => {
    const a = { spec: { virulent: true } };
    expect(stageMove(pf2eRules, a, 2)).toBe(0);
    expect(stageMove(pf2eRules, a, 2)).toBe(-1);
    expect(stageMove(pf2eRules, a, 2)).toBe(0);
    expect(stageMove(pf2eRules, a, 1)).toBe(1); // (a failure breaks the run)
    expect(stageMove(pf2eRules, a, 2)).toBe(0);
    expect(stageMove(pf2eRules, a, 3)).toBe(-1);
    expect(stageMove(pf2eRules, { spec: { traits: ["virulent"] } }, 3)).toBe(-1);
    expect(stageMove(pf2eRules, { spec: {} }, 3)).toBe(-2);
  });

  test("exposed again: a poison worsens (without lasting longer); a disease or a curse doesn't", () => {
    const run = fight([hag(), victim()]);
    const [h, v] = ["hag", "victim"].map(id => run.byId.get(id));
    exposeToAffliction(run, h, v, sting({ maxDuration: 6 }));
    turns(run, v, 1);
    const rounds = v.afflictions[0].rounds;
    exposeToAffliction(run, h, v, sting({ maxDuration: 6 }));
    expect(v.afflictions[0].stage).toBe(3);
    expect(v.afflictions[0].rounds).toBe(rounds);
    const rot = { ...sting(), id: "rot", name: "Rot", traits: ["disease"] };
    exposeToAffliction(run, h, v, rot);
    const stage = v.afflictions.find(a => a.spec.id === "rot").stage;
    const saves = run.log.filter(e => e.type === "afflictionSave" && e.name === "Rot").length;
    exposeToAffliction(run, h, v, rot);
    expect(v.afflictions.find(a => a.spec.id === "rot").stage).toBe(stage);
    expect(run.log.filter(e => e.type === "afflictionSave" && e.name === "Rot").length).toBe(saves);
  });
});

describe("simple afflictions, for systems without stages", () => {
  test("he gave it a disease: one condition, its value the stage, worse on a failed save; a line from him; the GM moves it", () => {
    const run = fight([hag(), victim()]);
    const [h, v] = ["hag", "victim"].map(id => run.byId.get(id));
    const rot = simpleAffliction({ id: "rot", name: "Rot", key: "diseased", most: 4, save: { type: "fortitude", dc: 16 } });
    exposeToAffliction(run, h, v, rot);
    expect(v.conds.diseased).toBe(2); // (a critical failure: two stages, PF2e's)
    turns(run, v, 1);
    expect(v.conds.diseased).toBe(4);
    const line = networkOf(run).links.find(l => l.type === "affliction" && l.to === "victim");
    expect(line).toMatchObject({ from: "hag", afflictionId: "rot", intensity: 4, most: 4, simple: "diseased" });
    // (Its condition isn't shown twice: the affliction stands for it.)
    expect(networkOf(run).marks.some(m => m.type === "condition" && m.key === "diseased")).toBe(false);
    setCondition(run, "victim", { key: "diseased", value: 1 });
    expect(v.afflictions[0].stage).toBe(1);
    setAffliction(run, "victim", { afflictionId: "rot", stage: 0 });
    expect(v.afflictions).toHaveLength(0);
    expect(v.conds.diseased).toBeUndefined();
  });

  test("he hexed it: no save, it simply takes hold, and stays until it's taken off", () => {
    const run = fight([hag(), victim(fort(100))]);
    const [h, v] = ["hag", "victim"].map(id => run.byId.get(id));
    exposeToAffliction(run, h, v, simpleAffliction({ id: "hex", name: "Hex", key: "cursed", most: 1 }));
    expect(run.log.some(e => e.type === "afflicted" && e.name === "Hex")).toBe(true);
    turns(run, v, 5);
    expect(v.conds.cursed).toBe(1);
  });

  test("5e's counted saves: three successes end it, three failures settle it", () => {
    const contagion = () => simpleAffliction({ id: "contagion", name: "Contagion", key: "poisoned", most: 1, save: { type: "fortitude", dc: 16 }, tally: { cure: 3, keep: 3 } });
    const run = fight([hag(), victim()]);
    const [h, v] = ["hag", "victim"].map(id => run.byId.get(id));
    exposeToAffliction(run, h, v, contagion());
    turns(run, v, 3);
    expect(v.afflictions[0].settled).toBe(true);
    const saves = run.log.filter(e => e.type === "afflictionSave").length;
    turns(run, v, 2);
    expect(run.log.filter(e => e.type === "afflictionSave").length).toBe(saves);
    const cured = fight([hag(), victim()]);
    const w = cured.byId.get("victim");
    exposeToAffliction(cured, cured.byId.get("hag"), w, contagion());
    w.spec.defenses.fortitude = 100;
    turns(cured, w, 3);
    expect(w.afflictions).toHaveLength(0);
    expect(cured.log.some(e => e.type === "afflictionEnd" && e.name === "Contagion")).toBe(true);
  });
});

describe("healing over time, lent", () => {
  const hero = (extra = {}) => creature({ id: "hero", name: "Hero", hp: { value: 10, max: 50 }, actions: [strike({ bonus: -50 })], ...extra });
  const orc = () => creature({ id: "orc", name: "Orc", side: "hostile", actions: [strike({ bonus: -50 })] });

  test("fast healing an effect gives: hit points at the start of each of its turns; not while its wounds won't close", () => {
    const run = fight([hero(), orc()]);
    const h = run.byId.get("hero");
    applyOutcome(h, { fastHealing: 5, rounds: 3, label: "Mending" });
    takeTurn(run, h);
    expect(run.log.find(e => e.type === "regen" && e.actorId === "hero")).toMatchObject({ amount: 5 });
    applyOutcome(h, { conditions: { unhealable: 1 }, rounds: 3, label: "Rot" });
    const before = h.hp;
    takeTurn(run, h);
    expect(h.hp).toBe(before);
  });

  test("regeneration lent: the better of its own and the lent; while it works, it can't be killed", () => {
    const run = fight([creature({ id: "knight", actions: [strike({ bonus: 50, damage: [parseFormula("60", "slashing")] })] }), orc()]);
    const o = run.byId.get("orc");
    applyOutcome(o, { regen: { amount: 10, stoppedBy: ["fire"] }, rounds: 5, label: "Regenerate" });
    expect(regenOf(o)).toMatchObject({ amount: 10 });
    takeTurn(run, run.byId.get("knight"));
    expect(o.status).not.toBe("dead");
  });
});

describe("temporary hit points", () => {
  test("they never add up (the better stays) and they're hit first", () => {
    const run = fight([creature({ id: "brute", actions: [strike({ bonus: 50, cost: 3, damage: [parseFormula("4", "slashing")] })] }), creature({ id: "hero", side: "hostile", hp: { value: 30, max: 30 }, actions: [strike({ bonus: -50 })] })]);
    const h = run.byId.get("hero");
    applyOutcome(h, { tempHp: 10 });
    applyOutcome(h, { tempHp: 6 });
    expect(h.temp).toBe(10);
    applyOutcome(h, { tempHp: 15 });
    expect(h.temp).toBe(15);
    takeTurn(run, run.byId.get("brute"));
    expect(h.hp).toBe(30);
    expect(h.temp).toBeLessThan(15);
  });
});
