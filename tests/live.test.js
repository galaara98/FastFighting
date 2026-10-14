import { describe, expect, test } from "vitest";
import {
  beginLive, liveRound, liveTurn, pcTurn, syncFromSheets, applyFact, mindOf, snapshotRun, restoreRun, NeedsDecision, bandLevel
} from "../scripts/engine/live.js";
import { STATUS, SWAY } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { genericRules } from "../scripts/adapters/generic/rules.js";
import { parseFormula, part } from "../scripts/engine/dice.js";
import { creature, strike, battle, social as talkData } from "./helpers.js";
import { goldenOf } from "./golden/battles.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const minded = (tactical = 60) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 70, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 70, fudge: 0 } });
const social = (over = {}) => talkData({ diplomacy: 3, intimidation: 3, deception: 3, ...over });

/** Two PCs and three foes on a map. */
function skirmish(extra = {}) {
  return battle([
    creature({ id: "valeros", name: "Valeros", kind: "pc", diesAtZero: false, position: at(0), hp: { value: 40, max: 40 }, traits: minded(70), ...extra.valeros }),
    creature({ id: "kyra", name: "Kyra", kind: "pc", diesAtZero: false, position: at(0, 10), hp: { value: 30, max: 30 }, social: social({ diplomacy: 10 }), ...extra.kyra }),
    creature({ id: "orc", name: "Orc", side: "hostile", position: at(10), hp: { value: 35, max: 35 }, traits: minded(40), social: social(),
      actions: [strike({ id: "axe", name: "Greataxe", bonus: 10, damage: [parseFormula("1d12+4", "slashing")] })], ...extra.orc }),
    creature({ id: "goblin", name: "Goblin", side: "hostile", position: at(15, 5), hp: { value: 14, max: 14 }, traits: minded(30), social: social(), ...extra.goblin }),
    creature({ id: "boar", name: "Boar", side: "hostile", position: at(40), hp: { value: 20, max: 20 }, ...extra.boar })
  ], { positioning: true, maxRounds: 10 });
}

/** Play the NPCs' turns of `rounds` rounds (players' turns passed with nothing read). */
function playRounds(run, rounds, from = 1) {
  for ( let round = from; round < from + rounds; round++ ) {
    liveRound(run, round);
    for ( const u of run.order ) {
      if ( run.live.players.has(u.id) ) pcTurn(run, u.id, []);
      else if ( liveTurn(run, u.id).ended ) return true;
    }
  }
  return false;
}

describe("live battles: the engine a turn at a time", () => {
  test("the same seed plays the same fight, turn by turn", () => {
    const a = beginLive(skirmish(), pf2eRules, { seed: 11, players: ["valeros", "kyra"] });
    const b = beginLive(skirmish(), pf2eRules, { seed: 11, players: ["valeros", "kyra"] });
    playRounds(a, 3);
    playRounds(b, 3);
    expect(goldenOf({ log: b.log, units: {} })).toEqual(goldenOf({ log: a.log, units: {} }));
    expect(a.log.some(e => e.type === "attack" && e.actorId === "orc")).toBe(true);
  });

  test("kept and brought back, it goes on exactly as if it had never stopped", () => {
    for ( const seed of [3, 5, 8] ) {
      const straight = beginLive(skirmish(), pf2eRules, { seed, players: ["kyra"] });
      playRounds(straight, 2);
      const kept = JSON.parse(JSON.stringify(snapshotRun(straight)));
      const mark = straight.log.length;
      playRounds(straight, 2, 3);
      const back = restoreRun(skirmish(), pf2eRules, kept);
      expect(back.log.length).toBe(mark);
      playRounds(back, 2, 3);
      expect(goldenOf({ log: back.log.slice(mark), units: {} })).toEqual(goldenOf({ log: straight.log.slice(mark), units: {} }));
      for ( const u of straight.units ) {
        const v = back.byId.get(u.id);
        expect([v.hp, v.status, [...v.harmedBy], [...v.desire.memory]]).toEqual([u.hp, u.status, [...u.harmedBy], [...u.desire.memory]]);
      }
    }
  });

  test("a player's blow, read from the table, stirs what the engine's own would: a grudge, a friend's vengeance", () => {
    const run = beginLive(skirmish(), pf2eRules, { seed: 2, players: ["valeros", "kyra"] });
    liveRound(run, 1);
    const blow = { type: "attack", targetId: "goblin", action: "Longsword", degree: 2, damage: 14, damageType: "slashing", natural: 15, total: 24, dc: 16, melee: true };
    const { events } = pcTurn(run, "valeros", [blow], { goblin: { hp: 0, status: "dead" } });
    const goblin = run.byId.get("goblin");
    expect(goblin.status).toBe(STATUS.DEAD);
    expect(goblin.harmedBy.get("valeros")).toBe(14);
    expect(events.find(e => e.type === "attack")).toMatchObject({ actorId: "valeros", target: "Goblin", damage: 14 });
    expect(events.find(e => e.type === "death" || e.type === "down")).toMatchObject({ actorId: "goblin", byId: "valeros" });
    // (The orc saw its friend fall: Valeros is someone to settle with now.)
    expect(run.byId.get("orc").desire.memory.get("hurt|valeros")).toBeGreaterThan(0);
  });

  test("a player's reaction comes back at the start of its turn, and the sheets say where everyone stands", () => {
    const run = beginLive(skirmish(), pf2eRules, { seed: 2, players: ["valeros", "kyra"] });
    const valeros = run.byId.get("valeros");
    valeros.reactionsLeft = 0;
    liveRound(run, 1);
    pcTurn(run, "valeros", [], { valeros: { position: { x: 35, y: 0 }, conditions: { frightened: 1, prone: true } } });
    expect(valeros.reactionsLeft).toBeGreaterThan(0);
    expect(valeros.prone).toBe(true);
    expect(valeros.conds.frightened).toBe(1);
    // (Beside the boar now, and away from the orc.)
    expect(valeros.adjacent.has("boar")).toBe(true);
    expect(valeros.adjacent.has("orc")).toBe(false);
  });

  test("a player's reaction is the player's: asked (the turn waits, then plays again the same with the answer), always, never", () => {
    const block = { id: "block", label: "Shield Block", on: "hit", reduce: part([], 5, "untyped"), physical: true };
    const valeros = pref => ({ valeros: { reactions: [block], reactionPrefs: pref ? { block: pref } : undefined, hp: { value: 400, max: 400 }, position: at(0) }, orc: { desires: [{ kind: 'hurt', targetId: 'valeros', level: 95 }] }, kyra: { position: at(0, 300) }, goblin: { position: at(300) }, boar: { position: at(300, 300) } });
    // Asked: it stops at the question; played again from the snapshot with the answer, it goes on.
    let asked = 0;
    let used = 0;
    for ( const seed of [1, 2, 3, 4, 5, 6] ) {
      const run = beginLive(skirmish(valeros(null)), pf2eRules, { seed, players: ["valeros", "kyra"] });
      liveRound(run, 1);
      const before = snapshotRun(run);
      let result;
      try {
        result = liveTurn(run, "orc");
      } catch ( err ) {
        expect(err).toBeInstanceOf(NeedsDecision);
        expect(err.request).toMatchObject({ unitId: "valeros", reactionId: "block", trigger: "hit", byId: "orc", player: true });
        asked += 1;
        const again = restoreRun(skirmish(valeros(null)), pf2eRules, before);
        result = liveTurn(again, "orc", { answers: [[err.request.key, true]] });
        used += result.events.filter(e => e.type === "reaction" && e.reaction === "Shield Block").length;
      }
      expect(result.ended).toBe(false);
    }
    expect(asked).toBeGreaterThan(0);
    expect(used).toBe(asked);
    // Never: never used. Always: used whenever it comes up, without asking.
    for ( const pref of ["never", "always"] ) {
      let n = 0;
      for ( const seed of [1, 2, 3, 4, 5, 6] ) {
        const run = beginLive(skirmish(valeros(pref)), pf2eRules, { seed, players: ["valeros", "kyra"] });
        liveRound(run, 1);
        n += liveTurn(run, "orc").events.filter(e => e.type === "reaction").length;
      }
      if ( pref === "never" ) expect(n).toBe(0);
      else expect(n).toBeGreaterThan(0);
    }
  });

  test("an NPC's reactions: as the engine judges, unless the GM wants to be asked", () => {
    const block = { id: "orcblock", label: "Shield Block", on: "hit", reduce: part([], 5, "untyped"), physical: true };
    const spec = () => skirmish({ orc: { reactions: [block], hp: { value: 400, max: 400 } }, valeros: { actions: [strike({ bonus: 20 })], desires: [{ kind: 'hurt', targetId: 'orc', level: 95 }] }, kyra: { position: at(0, 300) }, goblin: { position: at(300) }, boar: { position: at(300, 300) } });
    // (Kyra is FastFighting's to play here, so the orc is hit on a simulated turn.)
    let asked = 0;
    for ( const seed of [1, 2, 3, 4, 5, 6, 7, 8] ) {
      const run = beginLive(spec(), pf2eRules, { seed, players: ["kyra"], npcReactions: "ask" });
      liveRound(run, 1);
      try {
        liveTurn(run, "valeros");
      } catch ( err ) {
        expect(err.request).toMatchObject({ unitId: "orc", player: false, reactionId: "orcblock" });
        asked += 1;
      }
    }
    expect(asked).toBeGreaterThan(0);
  });

  test("a player's fate is spent only as its player said; its Luck never", () => {
    const run = beginLive(skirmish({ valeros: { resources: { fate: 2 }, rerolls: { self: true, team: false } }, kyra: { resources: { fate: 1 } } }), pf2eRules, { seed: 1, players: ["valeros", "kyra"] });
    const [valeros, kyra, orc] = ["valeros", "kyra", "orc"].map(id => run.byId.get(id));
    expect(run.live.mayReroll(run, valeros, valeros)).toBe(true);
    expect(run.live.mayReroll(run, valeros, kyra)).toBe(false);
    expect(run.live.mayReroll(run, kyra, kyra)).toBe(false); // (it said nothing: never)
    expect(run.live.mayReroll(run, orc, orc)).toBe(true);
  });

  test("what the GM says: a fear, taken back; a talk at the table; a surrender", () => {
    const run = beginLive(skirmish(), pf2eRules, { seed: 4, players: ["valeros", "kyra"] });
    liveRound(run, 1);
    expect(applyFact(run, { kind: "want", id: "goblin", desire: "avoid", targetId: "valeros", level: bandLevel(3) })).toBe(true);
    const mind = mindOf(run, "goblin");
    expect(mind.desires.find(d => d.kind === "avoid" && d.targetId === "valeros")).toMatchObject({ level: 70, gm: true });
    expect(mind.gm).toEqual([{ kind: "avoid", targetId: "valeros", level: 70 }]);
    applyFact(run, { kind: "forget", id: "goblin", desire: "avoid", targetId: "valeros" });
    expect(mindOf(run, "goblin").gm).toEqual([]);
    // A Diplomacy success at the table: one step along the persuasion track, as the engine's own would.
    applyFact(run, { kind: "talk", byId: "kyra", id: "orc", talk: "persuade", degree: 2 });
    expect(run.byId.get("orc").sway.get("friendly")).toBe(1);
    expect(run.log.at(-1)).toMatchObject({ type: "talk", actorId: "kyra", targetId: "orc", degree: 2 });
    // A critical failure: it won't listen to Kyra again.
    applyFact(run, { kind: "talk", byId: "kyra", id: "goblin", talk: "deceive", degree: 0 });
    expect(mindOf(run, "goblin").offendedBy).toContain("kyra");
    applyFact(run, { kind: "surrender", id: "boar", byId: "kyra" });
    expect(run.byId.get("boar").status).toBe(STATUS.SURRENDERED);
    expect(run.live.facts.map(f => f.kind)).toEqual(["want", "forget", "talk", "talk", "surrender"]);
  });

  test("the GM's fear changes what the creature does: afraid of Valeros close by, it runs", () => {
    let ran = 0;
    for ( const seed of [1, 2, 3, 4, 5, 6] ) {
      const run = beginLive(skirmish(), pf2eRules, { seed, players: ["valeros", "kyra"] });
      liveRound(run, 1);
      applyFact(run, { kind: "want", id: "orc", desire: "avoid", targetId: "valeros", level: bandLevel(4) });
      const { events } = liveTurn(run, "orc");
      if ( events.some(e => e.type === "flee" || (e.type === "move" && e.actorId === "orc")) ) ran += 1;
      expect(events.some(e => e.type === "attack" && e.actorId === "orc" && e.targetId === "valeros")).toBe(false);
    }
    expect(ran).toBeGreaterThan(0);
  });

  test("what the system already does, the engine leaves be: an NPC's persistent damage, when the system owns it", () => {
    const burning = { orc: { persistent: [{ ...parseFormula("2d6", "fire"), persistent: true }], hp: { value: 300, max: 300 } } };
    const engine = beginLive(skirmish(burning), genericRules, { seed: 1, players: ["valeros", "kyra"] });
    const system = beginLive(skirmish(burning), genericRules, { seed: 1, players: ["valeros", "kyra"], owns: { persistent: true } });
    liveRound(engine, 1);
    liveRound(system, 1);
    expect(liveTurn(engine, "orc").events.some(e => e.type === "persistent")).toBe(true);
    expect(liveTurn(system, "orc").events.some(e => e.type === "persistent")).toBe(false);
  });

  test("syncing the sheets says what changed that the engine didn't do", () => {
    const run = beginLive(skirmish(), pf2eRules, { seed: 1, players: ["valeros", "kyra"] });
    const changes = syncFromSheets(run, { goblin: { hp: 0, status: "down" }, kyra: { hp: 22 }, boar: { position: { x: 45, y: 0 } } });
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "goblin", fell: true, hp: -14 }), expect.objectContaining({ id: "kyra", hp: -8 }), expect.objectContaining({ id: "boar", moved: true })
    ]));
    // (Gone for good is the engine's to say: a creature that ran stays gone whatever its sheet says.)
    run.byId.get("orc").status = STATUS.FLED;
    syncFromSheets(run, { orc: { hp: 35, status: "standing" } });
    expect(run.byId.get("orc").status).toBe(STATUS.FLED);
    expect(SWAY.SURRENDER).toBe("surrendered");
  });
});
