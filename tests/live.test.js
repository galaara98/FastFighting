import { describe, expect, test } from "vitest";
import {
  beginLive, liveRound, liveTurn, pcTurn, pcTurnBegin, pcTurnEnd, leavingReach, reactNow, syncFromSheets, applyFact, mindOf, snapshotRun, restoreRun,
  NeedsDecision, bandLevel, captureAll, packLog
} from "../scripts/engine/live.js";
import { STATUS, SWAY } from "../scripts/constants.js";
import { applyOutcome, recompute } from "../scripts/engine/behavior/effects.js";
import { diffAll } from "../scripts/engine/changes.js";
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

/**
 * A live turn played through its questions, as the live side plays it: each answered by `answer(request)` (null: the
 * engine's own dice), the turn played again from a fresh `setUp()` each time. Returns {run, events, requests}.
 */
function playThrough(setUp, id, answer = () => null) {
  const answers = [];
  const requests = [];
  for ( let tries = 0; tries < 60; tries++ ) {
    const run = setUp();
    try {
      const { events } = liveTurn(run, id, { answers });
      return { run, events, requests };
    } catch ( err ) {
      if ( !(err instanceof NeedsDecision) ) throw err;
      requests.push(err.request);
      answers.push([err.request.key, answer(err.request)]);
    }
  }
  throw new Error("a turn that never stops asking");
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
  test("a turn played on the fight as it stands goes as it does played again from its snapshot (no caches carried)", () => {
    // (The live side plays a turn again from its snapshot for every roll and answer: the first pass, on the fight as it
    // stands with the round's caches warm, must choose as the passes after it do.)
    for ( const seed of [1, 2, 3, 4, 5, 6] ) {
      const spec = skirmish({ orc: { flags: { fearless: true } }, goblin: { flags: { fearless: true } } });
      const run = beginLive(spec, pf2eRules, { seed, players: [] });
      for ( let round = 1; round <= 3; round++ ) {
        liveRound(run, round);
        for ( const u of [...run.order] ) {
          if ( !u.active ) continue;
          const kept = snapshotRun(run, { log: false });
          const again = restoreRun(spec, pf2eRules, kept, { log: run.log });
          const fresh = liveTurn(again, u.id, { nonce: 11 + round }).events;
          const warm = liveTurn(run, u.id, { nonce: 11 + round }).events;
          expect(JSON.stringify(warm)).toBe(JSON.stringify(fresh));
        }
      }
    }
  });

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

  test("kept with its log apart, a piece at a time (as a live battle keeps it): brought back the same", () => {
    const straight = beginLive(skirmish(), pf2eRules, { seed: 5, players: ["kyra"] });
    const pieces = [JSON.parse(JSON.stringify(packLog(straight, 0)))]; // (what's told as it begins)
    for ( let round = 1; round <= 3; round++ ) {
      const from = straight.log.length;
      playRounds(straight, 1, round);
      pieces.push(JSON.parse(JSON.stringify(packLog(straight, from))));
    }
    const snap = JSON.parse(JSON.stringify(snapshotRun(straight, { log: false })));
    const whole = restoreRun(skirmish(), pf2eRules, JSON.parse(JSON.stringify(snapshotRun(straight))));
    const back = restoreRun(skirmish(), pf2eRules, { ...snap, log: pieces.flat() });
    expect(back.log).toEqual(whole.log);
    expect(back.log.length).toBe(straight.log.length);
    playRounds(whole, 1, 4);
    playRounds(back, 1, 4);
    expect(goldenOf({ log: back.log, units: {} })).toEqual(goldenOf({ log: whole.log, units: {} }));
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

  test("a passive reaction (always on, like a brawler's Toughness) is no one's choice: never asked, always used", () => {
    const toughness = { id: "toughness", label: "Toughness", on: "hit", reduce: part([], 2, "untyped"), melee: true, passive: true };
    let n = 0;
    for ( const seed of [1, 2, 3, 4, 5, 6] ) {
      const run = beginLive(skirmish({ valeros: { reactions: [toughness], hp: { value: 400, max: 400 }, position: at(0) }, orc: { desires: [{ kind: 'hurt', targetId: 'valeros', level: 95 }] }, kyra: { position: at(0, 300) }, goblin: { position: at(300) }, boar: { position: at(300, 300) } }), pf2eRules, { seed, players: ["valeros", "kyra"] });
      liveRound(run, 1);
      n += liveTurn(run, "orc").events.filter(e => e.type === "reaction").length;
    }
    expect(n).toBeGreaterThan(0);
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

  test("a player's turn begun and ended apart: a foe's reaction in the middle of it is part of it", () => {
    const run = beginLive(skirmish({ orc: { flags: { fearless: true, reactiveStrike: true }, hp: { value: 300, max: 300 } }, valeros: { position: at(5) } }), pf2eRules, { seed: 6, players: ["valeros", "kyra"] });
    liveRound(run, 1);
    pcTurnBegin(run, "valeros");
    // Valeros walks away from the orc beside him: it may strike as he goes.
    const leaving = leavingReach(run, "valeros", { x: 0, y: 60 });
    expect(leaving.map(l => l.reactorId)).toEqual(["orc"]);
    expect(leavingReach(run, "valeros", { x: 15, y: 0 })).toEqual([]); // (round to its other side: still beside it)
    const turn = run.turn;
    const struck = reactNow(run, "orc", "valeros", leaving[0].strike);
    expect(struck[0]).toMatchObject({ type: "opportunity", actorId: "orc", targetId: "valeros", turn, turnOf: "valeros" });
    expect(struck.some(e => e.type === "attack" && e.actorId === "orc")).toBe(true);
    expect(run.byId.get("orc").reactionsLeft).toBe(0);
    const { events } = pcTurnEnd(run, "valeros", [], { valeros: { position: { x: 0, y: 60 } } });
    expect(events.every(e => e.turn === turn)).toBe(true);
    expect(run.byId.get("valeros").adjacent.has("orc")).toBe(false);
  });

  test("a foe's reaction the system rolled: its roll and its damage, not the engine's dice", () => {
    for ( const [degree, natural, total, slashing] of [[3, 20, 31, 17], [2, 12, 23, 9], [0, 1, 4, 0]] ) {
      const run = beginLive(skirmish({ orc: { flags: { fearless: true, reactiveStrike: true }, hp: { value: 300, max: 300 } }, valeros: { position: at(5), hp: { value: 400, max: 400 } } }), pf2eRules, { seed: 6, players: ["valeros", "kyra"] });
      liveRound(run, 1);
      pcTurnBegin(run, "valeros");
      const [leaving] = leavingReach(run, "valeros", { x: 0, y: 60 });
      run.live.forced = { unitId: "orc", targetId: "valeros", attack: { degree, natural, total }, damage: slashing ? { byType: { slashing } } : null };
      const hp = run.byId.get("valeros").hp;
      const attack = reactNow(run, "orc", "valeros", leaving.strike).find(e => e.type === "attack" && e.actorId === "orc");
      expect(attack).toMatchObject({ degree, natural, total });
      expect(hp - run.byId.get("valeros").hp).toBe(slashing);
      expect(run.live.forced).toBeNull();
    }
  });

  test("a player's reaction in a foe's turn, where the system rolls strikes: asked to be rolled, then played with that roll", () => {
    // (Its player rolls it, read off their cards: readsRolls; or the system rolls it: systemRolls. Asked to be rolled either way.)
    for ( const flags of [{ systemRolls: ["strike"] }, { readsRolls: true }] ) {
      const setUp = () => {
        const run = beginLive(skirmish({ valeros: { position: at(5), reactionPrefs: { opportunity: "always" }, flags: { reactiveStrike: true }, actions: [strike({ id: "sword", name: "Longsword", bonus: 9, damage: [parseFormula("1d8+4", "slashing")] })] },
          kyra: { position: at(70) }, orc: { desires: [{ kind: "hurt", targetId: "kyra", level: 95 }], flags: { fearless: true }, traits: minded(5) } }), pf2eRules, { seed: 4, players: ["valeros", "kyra"], ...flags });
        liveRound(run, 1);
        return run;
      };
      // (The orc's own strikes, where the system rolls them too, left to the engine's dice here.)
      const { events, requests } = playThrough(setUp, "orc", r => (r.roll ? null : { use: true, roll: { attack: { degree: 2, natural: 15, total: 24 }, damage: { byType: { slashing: 11 } } } }));
      expect(requests[0]).toMatchObject({ unitId: "valeros", decided: true, strike: { id: "sword" } });
      const blow = events.find(e => e.type === "attack" && e.actorId === "valeros");
      expect(blow).toMatchObject({ degree: 2, natural: 15, total: 24 });
    }
  });

  /** The orc beside Kyra, set on her, in a live battle where the system makes these kinds of roll itself. */
  const besideKyra = (kinds, kyra = {}) => () => {
    const run = beginLive(skirmish({ valeros: { position: at(60) }, kyra: { position: at(5), hp: { value: 300, max: 300 }, ...kyra },
      orc: { desires: [{ kind: "hurt", targetId: "kyra", level: 95 }], flags: { fearless: true }, traits: minded(5) } }), pf2eRules, { seed: 4, players: ["valeros", "kyra"], systemRolls: kinds });
    liveRound(run, 1);
    return run;
  };
  const hitFor = (slashing, card = null) => ({ attack: { degree: 2, natural: 14, total: 24 }, damage: { byType: { slashing } }, card });

  test("a turn FastFighting plays, where the system rolls strikes: each strike asked for (its attacks before it counted), and played with that roll", () => {
    const { run, events, requests } = playThrough(besideKyra(["strike"]), "orc", r => hitFor(10));
    const strikes = requests.filter(r => r.roll === "strike");
    expect(strikes.length).toBeGreaterThan(0);
    expect(strikes[0]).toMatchObject({ kind: "strike", unitId: "orc", targetId: "kyra", action: { id: "axe", name: "Greataxe" }, attackNumber: 0 });
    expect(strikes.map(r => r.attackNumber)).toEqual(strikes.map((_, i) => i));
    expect(new Set(requests.map(r => r.key)).size).toBe(requests.length);
    // (Its damage as rolled, through the target's resistances as the engine has them: none.)
    const blows = events.filter(e => e.type === "attack" && e.actorId === "orc");
    expect(blows.length).toBe(strikes.length);
    for ( const b of blows ) expect(b).toMatchObject({ degree: 2, natural: 14, total: 24, mod: 10, damage: 10 });
    expect(run.byId.get("kyra").hp).toBe(300 - 10 * blows.length);
  });

  test("a strike's damage card the system applies itself: asked to apply it, and the target takes what it lost by it", () => {
    const { run, events, requests } = playThrough(besideKyra(["strike", "apply"]), "orc", r => (r.roll === "strike" ? hitFor(10, `card-${r.attackNumber}`) : { lost: 7 }));
    const strikes = requests.filter(r => r.roll === "strike");
    const applied = requests.filter(r => r.roll === "apply");
    expect(applied.map(r => r.card)).toEqual(strikes.map(r => `card-${r.attackNumber}`));
    expect(applied[0]).toMatchObject({ unitId: "orc", targetId: "kyra", amount: 10, applies: null });
    for ( const b of events.filter(e => e.type === "attack" && e.actorId === "orc") ) expect(b.damage).toBe(7);
    expect(run.byId.get("kyra").hp).toBe(300 - 7 * strikes.length);
  });

  test("a reaction that lessens the blow: applied the system's way with it where the system does it (Shield Block), else the engine's sum", () => {
    const block = applies => ({ reactions: [{ id: "kyra.shield-block", label: "Shield Block", on: "hit", physical: true, reduce: part([], 4), applies }], reactionPrefs: { "kyra.shield-block": "always" } });
    // (The system's own: applied with it, and what she lost by it is what she takes.)
    const own = playThrough(besideKyra(["strike", "apply"], block("shieldBlock")), "orc", r => (r.roll === "strike" ? hitFor(10, "card") : { lost: 6 }));
    expect(own.requests.find(r => r.roll === "apply")).toMatchObject({ applies: [{ key: "shieldBlock" }], card: "card" });
    expect(own.events.find(e => e.type === "attack" && e.actorId === "orc")).toMatchObject({ damage: 6, lessened: 4 });
    // (One it doesn't: not applied its way; the engine's 10 less 4.)
    const engine = playThrough(besideKyra(["strike", "apply"], block(undefined)), "orc", r => (r.roll === "strike" ? hitFor(10, "card") : { lost: 99 }));
    const first = engine.events.find(e => e.type === "attack" && e.actorId === "orc");
    expect(first).toMatchObject({ damage: 6, lessened: 4 });
    expect(engine.requests.filter(r => r.roll === "apply").length).toBe(engine.requests.filter(r => r.roll === "strike").length - 1);
    // (Halved, by one the system halves itself (5e's Uncanny Dodge): applied its way, with it.)
    const halving = { reactions: [{ id: "kyra.uncanny-dodge", label: "Uncanny Dodge", on: "hit", halve: true, applies: "halve" }], reactionPrefs: { "kyra.uncanny-dodge": "always" } };
    const halved = playThrough(besideKyra(["strike", "apply"], halving), "orc", r => (r.roll === "strike" ? hitFor(10, "card") : { lost: 5 }));
    expect(halved.requests.find(r => r.roll === "apply")).toMatchObject({ applies: [{ key: "halve" }] });
    expect(halved.events.find(e => e.type === "attack" && e.actorId === "orc")).toMatchObject({ damage: 5, lessened: 5 });
  });

  test("the system's rolls are only asked for in a turn FastFighting plays: a foe's reaction in a player's turn, a planned fight, roll their own", () => {
    const run = beginLive(skirmish({ orc: { flags: { fearless: true, reactiveStrike: true }, hp: { value: 300, max: 300 } }, valeros: { position: at(5) } }), pf2eRules, { seed: 6, players: ["valeros", "kyra"], systemRolls: ["strike", "apply"] });
    liveRound(run, 1);
    pcTurnBegin(run, "valeros");
    const [leaving] = leavingReach(run, "valeros", { x: 0, y: 60 });
    expect(reactNow(run, "orc", "valeros", leaving.strike).some(e => e.type === "attack" && e.actorId === "orc")).toBe(true);
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
    // (Dead stays dead while the sheet only says down: up again is the sheet's to show.)
    run.byId.get("goblin").status = STATUS.DEAD;
    syncFromSheets(run, { goblin: { hp: 0, status: "down" } });
    expect(run.byId.get("goblin").status).toBe(STATUS.DEAD);
    syncFromSheets(run, { goblin: { hp: 5, status: "standing" } });
    expect(run.byId.get("goblin").status).toBe(STATUS.STANDING);
  });

  test("the sheet says what it has, the engine remembers why: who frightened it stays known while the sheet shows it", () => {
    const run = beginLive(skirmish(), pf2eRules, { seed: 1, players: ["valeros", "kyra"] });
    const valeros = run.byId.get("valeros");
    applyOutcome(valeros, { conditions: { frightened: 2 }, rounds: 2, label: "Demoralize" }, "orc", { id: "orc.demoralize", name: "Demoralize" });
    // The system wore it down to 1, and can only say "frightened 1": still the orc's doing.
    syncFromSheets(run, { valeros: { conditions: { frightened: 1 } } });
    const held = valeros.effects.find(e => e.sourceId === "orc");
    expect(held).toMatchObject({ conditions: { frightened: 1 }, sheetHeld: true });
    expect(valeros.conds.frightened).toBe(1);
    // It lasts as long as the sheet shows it, and is kept with the turn.
    const again = restoreRun(skirmish(), pf2eRules, snapshotRun(run));
    expect(again.byId.get("valeros").effects.find(e => e.sourceId === "orc")).toMatchObject({ conditions: { frightened: 1 }, rounds: 2 });
    // Gone from the sheet: gone.
    syncFromSheets(run, { valeros: { conditions: {} } });
    expect(valeros.effects.some(e => e.sourceId === "orc")).toBe(false);
    expect(valeros.conds.frightened ?? 0).toBe(0);
  });

  test("one it laid that the sheet shows, it answers for: its own rounds run out, and the turn clears it for the sheet", () => {
    const run = beginLive(skirmish(), pf2eRules, { seed: 1, players: ["valeros", "kyra"] });
    const valeros = run.byId.get("valeros");
    applyOutcome(valeros, { conditions: { frightened: 2 }, rounds: 1, label: "Demoralize" }, "orc", { id: "orc.demoralize", name: "Demoralize" });
    // Written to the sheet, read back: the orc's effect answers for it (the sheet's own record of it is its).
    syncFromSheets(run, { valeros: { conditions: { frightened: 2 } } });
    expect(valeros.baseConds.frightened).toBeUndefined();
    expect(valeros.conds.frightened).toBe(2);
    const before = captureAll(run);
    pcTurnBegin(run, "valeros");
    pcTurnEnd(run, "valeros", []);
    expect(valeros.conds.frightened ?? 0).toBe(0);
    expect(diffAll(before, captureAll(run)).valeros?.conditions?.cleared).toEqual(["frightened"]);
    // One with a life of its own (ending on a repeated save) answers for it too: shaken off, cleared for the sheet.
    applyOutcome(valeros, { conditions: { paralyzed: 1 }, rounds: 10, repeatSave: { type: "will", dc: 1 } }, "orc", { id: "orc.hold", name: "Hold" });
    syncFromSheets(run, { valeros: { conditions: { paralyzed: 1 } } });
    expect(valeros.baseConds.paralyzed).toBeUndefined();
    valeros.effects = valeros.effects.filter(e => !e.repeatSave);
    recompute(valeros);
    expect(valeros.conds.paralyzed ?? 0).toBe(0);
    // More on the sheet than it laid (from elsewhere): that stays the sheet's.
    applyOutcome(valeros, { conditions: { frightened: 1 }, rounds: 1, label: "Demoralize" }, "orc", { id: "orc.demoralize", name: "Demoralize" });
    syncFromSheets(run, { valeros: { conditions: { frightened: 3 } } });
    expect(valeros.baseConds.frightened).toBe(3);
  });

  test("what a sheet can't carry (PF2e has no condition for losing a turn to Command), the engine keeps, for its own rounds", () => {
    const run = beginLive(skirmish(), pf2eRules, { seed: 1, players: ["valeros", "kyra"] });
    const valeros = run.byId.get("valeros");
    applyOutcome(valeros, { conditions: { incapacitated: 1 }, rounds: 1, label: "Command" }, "orc", { id: "orc.command", name: "Command" });
    syncFromSheets(run, { valeros: { conditions: {}, carries: k => k !== "incapacitated" } });
    expect(valeros.effects.find(e => e.sourceId === "orc")).toMatchObject({ conditions: { incapacitated: 1 }, rounds: 1 });
    expect(valeros.conds.incapacitated).toBe(1);
    // (Where the sheet can carry it and doesn't show it, it was ended at the table.)
    syncFromSheets(run, { valeros: { conditions: {} } });
    expect(valeros.effects.some(e => e.sourceId === "orc")).toBe(false);
  });

  test("someone joins mid-fight (a player's summons): the battle grows, everyone else as they were, the newcomer in it", () => {
    const spec = skirmish();
    const run = beginLive(spec, pf2eRules, { seed: 4, players: ["valeros", "kyra"] });
    playRounds(run, 1);
    const before = Object.fromEntries(run.units.map(u => [u.id, [u.hp, u.status]]));
    const wolf = creature({ id: "wolfToken", name: "Wolf", kind: "npc", position: at(5, 5), hp: { value: 18, max: 18 }, tokenId: "wolfToken" });
    const grown = { ...spec, combatants: [...spec.combatants, wolf] };
    const again = restoreRun(grown, pf2eRules, snapshotRun(run, { log: false }), { log: run.log });
    expect(Object.fromEntries(again.units.filter(u => u.id !== "wolfToken").map(u => [u.id, [u.hp, u.status]]))).toEqual(before);
    const joined = again.byId.get("wolfToken");
    expect(joined).toMatchObject({ side: "friendly", hp: 18 });
    expect(again.live.players.has("valeros")).toBe(true);
    // (It takes a turn like anyone.)
    joined.active = true;
    again.order.push(joined);
    liveRound(again, 2);
    expect(liveTurn(again, "wolfToken").events.some(e => e.actorId === "wolfToken")).toBe(true);
  });
});
