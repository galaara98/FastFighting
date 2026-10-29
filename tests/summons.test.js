import { describe, expect, test } from "vitest";
import { replay, runBatchSync, beginRun, prepareBattle } from "../scripts/engine/simulator.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";
import { sustainSummons, callSummons } from "../scripts/engine/behavior/summons.js";
import { threats } from "../scripts/engine/behavior/reactions.js";
import { edgeDistance } from "../scripts/engine/battle-state.js";
import { beginLive, liveRound, liveTurn, snapshotRun, restoreRun } from "../scripts/engine/live.js";

const traits = (tactical = 70) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 20, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const wolf = { name: "Summoned Wolf", level: 1, hp: { value: 18, max: 18 }, defenses: { ac: 15, fortitude: 6, reflex: 7, will: 4 }, initiative: { mod: 5 }, speeds: { walk: 35 },
  actions: [strike({ id: "jaws", name: "Jaws", bonus: 7, damage: [parseFormula("1d6+2", "piercing")] })], iwr: {}, traits: traits(30), diesAtZero: true };
const druid = (summon, extra = {}) => creature({ id: "druid", kind: "pc", diesAtZero: false, hp: { value: 200, max: 200 }, traits: traits(70), resources: { slot: 2 },
  actions: [strike({ id: "staff", name: "Staff", bonus: 4, damage: [parseFormula("1d4", "bludgeoning")] }), summon], ...extra });
const ogre = (extra = {}) => creature({ id: "ogre", side: "hostile", hp: { value: 150, max: 150 }, defenses: { ac: 17, fortitude: 10, reflex: 5, will: 4 },
  actions: [strike({ id: "club", name: "Club", bonus: 10, damage: [parseFormula("2d8+5", "bludgeoning")] })], flags: { fearless: true }, traits: traits(40), ...extra });

describe("summoning", () => {
  test("in a live battle: called on the summoner's turn, kept with the turn and made again when it's restored, acting on turns of their own", () => {
    const summon = { id: "summon-animal", name: "Summon Animal", kind: "summon", cost: 3, resource: "slot", creatures: [wolf, wolf], rounds: 10 };
    const npc = creature({ id: "druid", side: "hostile", hp: { value: 200, max: 200 }, traits: traits(70), resources: { slot: 2 },
      actions: [strike({ id: "staff", name: "Staff", bonus: 4, damage: [parseFormula("1d4", "bludgeoning")] }), summon] });
    const hero = ogre({ id: "hero", side: "friendly", kind: "pc" });
    const spec = () => battle([npc, hero], { maxRounds: 4 });
    let called = 0;
    for ( const seed of [1, 2, 3, 4] ) {
      const run = beginLive(spec(), pf2eRules, { seed, players: ["hero"] });
      liveRound(run, 1);
      for ( const u of run.units ) u.active = true;
      const { events } = liveTurn(run, "druid");
      const summoned = events.find(e => e.type === "summon");
      if ( !summoned ) continue;
      called += 1;
      const wolves = run.units.filter(u => u.summoner === "druid");
      expect(wolves).toHaveLength(2);
      // (A token for each, as the battle places them.)
      wolves.forEach((w, i) => { w.tokenId = `wolfToken${i}`; });
      // Kept, and made again: the same wolves, still the druid's, with their tokens.
      const again = restoreRun(spec(), pf2eRules, snapshotRun(run));
      const back = again.units.filter(u => u.summoner === "druid");
      expect(back.map(w => [w.id, w.tokenId, w.summonedBy, w.spec.name])).toEqual(wolves.map(w => [w.id, w.tokenId, w.summonedBy, w.spec.name]));
      expect(again.order.map(u => u.id)).toEqual(run.order.map(u => u.id));
      // Each takes a turn of its own.
      const turn = liveTurn(again, back[0].id);
      expect(turn.events.some(e => e.actorId === back[0].id)).toBe(true);
    }
    expect(called).toBeGreaterThan(0);
  });

  test("the summoner calls its creatures, they act right after it, and they aren't in the results", () => {
    const summon = { id: "summon-animal", name: "Summon Animal", kind: "summon", cost: 3, resource: "slot", creatures: [wolf, wolf], rounds: 10 };
    const r = replay(battle([druid(summon), ogre()], { maxRounds: 4 }), pf2eRules, 3);
    const called = r.log.find(e => e.type === "summon");
    expect(called).toBeDefined();
    expect(called.names).toEqual(["Summoned Wolf", "Summoned Wolf"]);
    const wolfActs = r.log.filter(e => called.ids.includes(e.actorId) && e.type === "attack");
    expect(wolfActs.length).toBeGreaterThan(0);
    expect(Object.keys(r.units)).toEqual(expect.arrayContaining(["druid", "ogre"]));
    expect(Object.keys(r.units).some(id => called.ids.includes(id))).toBe(false);
    // A batch works with them around, and the druid's side does better for them.
    const weak = { hp: { value: 50, max: 50 } };
    const without = runBatchSync(battle([druid({ ...summon, creatures: [] }), ogre(weak)], { maxRounds: 6 }), pf2eRules, { runs: 150, seed: 2 });
    const withThem = runBatchSync(battle([druid(summon), ogre(weak)], { maxRounds: 6 }), pf2eRules, { runs: 150, seed: 2 });
    expect(withThem.combatants.ogre.pDown + withThem.combatants.ogre.pDead).toBeGreaterThan(without.combatants.ogre.pDown + without.combatants.ogre.pDead);
  });

  test("called onto the map beside a foe: that foe knows at once they're there (who could strike it as it walks off)", () => {
    const biter = { ...wolf, flags: { reactiveStrike: true } };
    const call = { id: "summon-animal", name: "Summon Animal", kind: "summon", cost: 3, resource: "slot", creatures: [biter], rounds: 10, range: 30 };
    const spec = battle([druid(call, { position: { x: 0, y: 0, size: 5 } }), ogre({ position: { x: 20, y: 0, size: 5 } })], { positioning: true, maxRounds: 4 });
    const run = beginRun(prepareBattle(spec, pf2eRules), 1);
    const [d, o] = ["druid", "ogre"].map(id => run.byId.get(id));
    expect(threats(run, o)).toEqual([]);
    const [w] = callSummons(run, d, call);
    w.active = true;
    expect(edgeDistance(w, o)).toBeLessThanOrEqual(5.5);
    expect(threats(run, o).map(x => x.e)).toContain(w);
  });

  test("they go when their time is up", () => {
    const summon = { id: "brief", name: "Brief Call", kind: "summon", cost: 2, resource: "slot", creatures: [wolf], rounds: 1 };
    const harmless = [strike({ id: "poke", name: "Poke", bonus: -10, damage: [parseFormula("1", "bludgeoning")] })];
    const r = replay(battle([druid(summon, { resources: { slot: 1 } }), ogre({ hp: { value: 900, max: 900 }, actions: harmless })], { maxRounds: 5 }), pf2eRules, 1);
    const called = r.log.find(e => e.type === "summon");
    const gone = r.log.find(e => e.type === "vanish" && called.ids.includes(e.actorId));
    expect(gone).toBeDefined();
    expect(gone.round).toBe(called.round + 2);
    expect(r.log.filter(e => called.ids.includes(e.actorId) && e.type === "attack" && e.round > gone.round)).toHaveLength(0);
  });

  test("sustained (PF2e): an action each turn, or they're gone", () => {
    const summon = { id: "summon-animal", name: "Summon Animal", kind: "summon", cost: 3, resource: "slot", creatures: [wolf], rounds: 10, sustain: { actions: 1 }, sustainOrEnd: true };
    const r = replay(battle([druid(summon), ogre({ hp: { value: 900, max: 900 } })], { maxRounds: 4 }), pf2eRules, 4);
    const called = r.log.find(e => e.type === "summon");
    const sustains = r.log.filter(e => e.type === "sustain" && e.actorId === "druid");
    expect(sustains.length).toBeGreaterThan(0);
    for ( const s of sustains ) expect(s.round).toBeGreaterThan(called.round);
    // It acts only in rounds its summoner sustained it.
    for ( const e of r.log.filter(x => x.type === "attack" && called.ids.includes(x.actorId) && x.round > called.round) ) {
      expect(sustains.some(x => x.round === e.round)).toBe(true);
    }
  });

  test("withSummoner (PF2e): no place in the order, its turn right after its summoner's, in it; sustained, or idle", () => {
    const summon = { id: "summon-animal", name: "Summon Animal", kind: "summon", cost: 3, resource: "slot", creatures: [wolf], rounds: 10, sustain: { actions: 1 }, sustainOrEnd: true, withSummoner: true };
    const spec = battle([druid(summon), ogre({ hp: { value: 900, max: 900 } })], { maxRounds: 4 });
    const run = beginRun(prepareBattle(spec, pf2eRules), 4, { log: true });
    const d = run.byId.get("druid");
    const [w] = callSummons(run, d, d.spec.actions.find(a => a.kind === "summon"));
    expect(w.withSummoner).toBe(true);
    expect(run.order).not.toContain(w);
    const r = replay(spec, pf2eRules, 4);
    const called = r.log.find(e => e.type === "summon");
    expect(called).toBeDefined();
    // (The wolf acts between its summoner's last entry of the turn and the ogre's: in the druid's turn, never in a turn of its own.)
    const wolfActs = r.log.filter(e => called.ids.includes(e.actorId) && e.type === "attack");
    expect(wolfActs.length).toBeGreaterThan(0);
    for ( const e of wolfActs ) {
      const i = r.log.indexOf(e);
      const before = r.log.slice(0, i).reverse().find(x => x.actorId === "druid" || x.actorId === "ogre");
      expect(before?.actorId).toBe("druid");
    }
    const sustains = r.log.filter(e => e.type === "sustain" && e.actorId === "druid");
    for ( const e of wolfActs.filter(x => x.round > called.round) ) expect(sustains.some(x => x.round === e.round)).toBe(true);
  });

  test("a summoner who can't sustain loses what it called", () => {
    const action = { id: "sa", name: "Summon Animal", kind: "summon", sustain: { actions: 1 }, sustainOrEnd: true };
    const summoner = { id: "d", prep: { summonActions: [action] }, conds: {}, status: "standing" };
    const wolfUnit = { id: "w", summoner: "d", summonedBy: "sa", status: "standing" };
    const run = { round: 2, units: [summoner, wolfUnit] };
    const broke = { canAfford: () => false, spend: () => {} };
    expect(sustainSummons(run, summoner, broke)).toEqual({ kept: [], gone: [wolfUnit] });
    let spent = 0;
    const flush = { canAfford: () => true, spend: () => { spent += 1; } };
    expect(sustainSummons(run, summoner, flush).kept).toEqual([action]);
    expect(spent).toBe(1);
    expect(wolfUnit.sustainedRound).toBe(2);
  });

  test("something nobody can attack: never a target, and it can't hold the field alone", () => {
    const weapon = { ...wolf, name: "Spiritual Weapon", untargetable: true, hp: { value: 1, max: 1 }, actions: [strike({ id: "blade", name: "Spectral Blade", bonus: 7, damage: [parseFormula("1d8+3", "force")] })] };
    const summon = { id: "spiritual-weapon", name: "Spiritual Weapon", kind: "summon", cost: 1, resource: "slot", creatures: [weapon], rounds: 10 };
    for ( let s = 1; s <= 8; s++ ) {
      const r = replay(battle([druid(summon, { hp: { value: 30, max: 30 } }), ogre()], { maxRounds: 10 }), pf2eRules, s);
      const called = r.log.find(e => e.type === "summon");
      if ( !called ) continue;
      expect(r.log.some(e => e.type === "attack" && called.ids.includes(e.targetId))).toBe(false);
      const end = r.log.find(e => e.type === "end");
      if ( r.units.druid.status !== "standing" && r.units.ogre.status === "standing" ) expect(end.winners).toEqual(["hostile"]);
    }
  });
});
