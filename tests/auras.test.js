/**
 * Auras that make foes save (behavior/auras.js): coming inside one, starting a turn in one, immunity once saved, the
 * system's immunities and the senses an aura needs, off the map, what the Statistics Engine makes of walking in, and
 * whole fights told.
 */
import { describe, expect, test } from "vitest";
import { prepareBattle, replay, beginRun, answerMove, playTurn } from "../scripts/engine/simulator.js";
import { beginLive, liveRound, liveTurn, movedBeside, NeedsDecision, snapshotRun, restoreRun } from "../scripts/engine/live.js";
import { auraToll, aurasOf } from "../scripts/engine/behavior/auras.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { buildStory } from "../scripts/story/story.js";
import { logLine } from "../scripts/story/log-lines.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { storyTables } from "./foundry-i18n.js";
import { creature, strike, battle } from "./helpers.js";

const english = storyTables();
const tables = { get: k => english[k] };
const at = (x, y) => ({ x, y, size: 5 });

/** A presence that frightens: Will, once on coming in, immune after any save (a DC no one makes, unless said). */
const presence = (over = {}) => ({
  id: "presence", key: "frightful-presence", label: "Dread Presence", range: 30, save: { type: "will", dc: 50 }, when: "enter",
  immuneAfter: "save", immuneRounds: 10, traits: ["aura", "emotion", "fear", "mental"],
  byDegree: [
    { conditions: { frightened: 4 }, rounds: 4, label: "frightened 4" },
    { conditions: { frightened: 2 }, rounds: 2, label: "frightened 2" },
    { conditions: { frightened: 1 }, rounds: 1, label: "frightened 1" },
    null
  ],
  ...over
});

/** A reek that sickens: Fortitude, coming in or starting a turn inside, immune to every reek once saved well. */
const reek = (over = {}) => ({
  id: "reek", key: "stench", label: "Reek", range: 10, save: { type: "fortitude", dc: 50 }, when: "both",
  immuneAfter: "success", immuneAll: true, traits: ["aura", "olfactory"], needs: "smell",
  byDegree: [{ conditions: { sickened: 2 }, rounds: 10, label: "sickened 2" }, { conditions: { sickened: 1 }, rounds: 10, label: "sickened 1" }, null, null],
  ...over
});

/** A fight ready for its first turn, round 1. */
function ready(combatants, options = {}) {
  const run = beginRun(prepareBattle(battle(combatants, { positioning: true, ...options }), pf2eRules), 3, { log: true });
  run.round = 1;
  return run;
}

/** u walks to x (along the line), and the move is answered. */
function walk(run, u, x) {
  const from = { ...u.pos };
  u.pos.x = x;
  answerMove(run, u, { feet: Math.abs(x - from.x), from, to: { ...u.pos } });
}

const auraEvents = run => run.log.filter(e => e.type === "aura");

describe("an aura that frightens", () => {
  test("a foe walking into it saves, as its bearer's: frightened by how it went; out and in again, immune", () => {
    const run = ready([creature({ id: "hero", name: "Hero", position: at(0, 0) }), creature({ id: "dragon", name: "Dragon", side: "hostile", position: at(100, 0), auras: [presence()] })]);
    const hero = run.byId.get("hero");
    walk(run, hero, 40); // (still 60 feet off)
    expect(auraEvents(run)).toEqual([]);
    walk(run, hero, 70);
    const [e] = auraEvents(run);
    expect(e).toMatchObject({ actorId: "dragon", targetId: "hero", cause: "enter", saveType: "will", dc: 50, took: true });
    expect(e.degree).toBeLessThanOrEqual(1);
    expect(hero.conds.frightened).toBe(e.degree === 0 ? 4 : 2);
    expect(hero.effects.find(x => x.key === "presence").sourceId).toBe("dragon");
    walk(run, hero, 0);
    run.round = 2;
    walk(run, hero, 75);
    expect(auraEvents(run)).toHaveLength(1);
  });

  test("its bearer coming close brings it onto them; a friend of the bearer's is left alone", () => {
    const run = ready([
      creature({ id: "hero", name: "Hero", position: at(0, 0) }),
      creature({ id: "dragon", name: "Dragon", side: "hostile", position: at(100, 0), auras: [presence()] }),
      creature({ id: "kobold", name: "Kobold", side: "hostile", position: at(40, 5) })
    ]);
    walk(run, run.byId.get("dragon"), 25);
    expect(auraEvents(run).map(e => e.targetId)).toEqual(["hero"]);
    expect(run.byId.get("kobold").conds.frightened).toBeUndefined();
  });

  test("inside it as the fight begins: it saves at the start of its first turn, before it does anything", () => {
    const run = ready([creature({ id: "hero", name: "Hero", position: at(0, 0) }), creature({ id: "dragon", name: "Dragon", side: "hostile", position: at(20, 0), auras: [presence()] })]);
    const hero = run.byId.get("hero");
    playTurn(run, hero);
    const mine = run.log.filter(e => e.turnOf === "hero");
    const first = mine.findIndex(e => e.type === "aura");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(mine[first].cause).toBe("enter");
    expect(mine.slice(0, first).some(e => ["attack", "move", "control"].includes(e.type))).toBe(false);
    // (Its next turn: checked already, and immune besides.)
    run.round = 2;
    playTurn(run, hero);
    expect(auraEvents(run)).toHaveLength(1);
  });

  test("the system's immunities: a mindless foe is untouched by a mental aura (logged, and nothing laid)", () => {
    const run = ready([creature({ id: "golem", name: "Golem", creatureTraits: ["construct", "mindless"], position: at(0, 0) }), creature({ id: "dragon", name: "Dragon", side: "hostile", position: at(100, 0), auras: [presence()] })]);
    const golem = run.byId.get("golem");
    walk(run, golem, 75);
    expect(auraEvents(run)).toMatchObject([{ targetId: "golem", immune: true, took: false }]);
    expect(golem.conds.frightened).toBeUndefined();
    expect(logLine(auraEvents(run)[0])).toContain("Golem");
  });

  test("a bonus against fear (spec.saveVs) counts against it", () => {
    const run = ready([
      creature({ id: "hero", name: "Hero", position: at(0, 0), saveVs: [{ bonus: 2, type: "circumstance", vs: ["fear"] }] }),
      creature({ id: "dragon", name: "Dragon", side: "hostile", position: at(100, 0), auras: [presence()] })
    ]);
    const hero = run.byId.get("hero");
    walk(run, hero, 75);
    expect(auraEvents(run)[0].mod).toBe(hero.spec.defenses.will + 2);
  });
});

describe("an aura that sickens", () => {
  test("coming in, and each turn it starts inside, until it saves well: then immune to every reek", () => {
    const run = ready([
      creature({ id: "hero", name: "Hero", position: at(0, 0) }),
      creature({ id: "ghast", name: "Ghast", side: "hostile", position: at(10, 0), auras: [reek()] }),
      creature({ id: "ghoul", name: "Ghoul", side: "hostile", position: at(-10, 0), auras: [reek({ id: "reek2", save: { type: "fortitude", dc: -20 } })] })
    ]);
    const hero = run.byId.get("hero");
    playTurn(run, hero);
    // (The ghast's, failed; the ghoul's, made: immune to both from then on.)
    expect(auraEvents(run).map(e => [e.actorId, e.cause, e.degree >= 2])).toEqual([["ghast", "turnStart", false], ["ghoul", "turnStart", true]]);
    expect(hero.conds.sickened).toBeGreaterThanOrEqual(1);
    run.round = 2;
    playTurn(run, hero);
    expect(auraEvents(run)).toHaveLength(2);
  });

  test("failing, it goes off again each turn it starts inside (once a round)", () => {
    const run = ready([creature({ id: "hero", name: "Hero", position: at(0, 0), actions: [] }), creature({ id: "ghast", name: "Ghast", side: "hostile", position: at(10, 0), actions: [], auras: [reek()] })]);
    const hero = run.byId.get("hero");
    playTurn(run, hero);
    walk(run, hero, 1); // (a step within it: nothing new)
    run.round = 2;
    playTurn(run, hero);
    expect(auraEvents(run).map(e => e.round)).toEqual([1, 2]);
  });

  test("one immune to it by its traits: told once, not every turn it starts inside", () => {
    const run = ready([creature({ id: "golem", name: "Golem", creatureTraits: ["mindless"], position: at(0, 0), actions: [] }),
      creature({ id: "ghast", name: "Ghast", side: "hostile", position: at(10, 0), actions: [], auras: [reek({ traits: ["aura", "mental"] })] })]);
    const golem = run.byId.get("golem");
    playTurn(run, golem);
    run.round = 2;
    playTurn(run, golem);
    expect(auraEvents(run).map(e => e.immune)).toEqual([true]);
  });

  test("one that can't smell is untouched by a reek", () => {
    const run = ready([creature({ id: "hero", name: "Hero", position: at(0, 0), senses: { smell: 0 } }), creature({ id: "ghast", name: "Ghast", side: "hostile", position: at(10, 0), auras: [reek()] })]);
    playTurn(run, run.byId.get("hero"));
    expect(auraEvents(run)).toEqual([]);
  });
});

describe("an aura that burns", () => {
  test("a basic save against its damage: a critical failure takes double", () => {
    const heat = { id: "heat", key: "heat", label: "Heat", range: 10, save: { type: "reflex", dc: 50, basic: true }, damage: [parseFormula("2", "fire")], traits: ["fire"] };
    const run = ready([creature({ id: "hero", name: "Hero", position: at(0, 0) }), creature({ id: "efreet", name: "Efreet", side: "hostile", position: at(100, 0), auras: [heat] })]);
    const hero = run.byId.get("hero");
    walk(run, hero, 90);
    const [e] = auraEvents(run);
    expect(e.damage).toBe(e.degree === 0 ? 4 : 2);
    expect(hero.hp).toBe(20 - e.damage);
  });
});

describe("off the map", () => {
  test("everyone is inside every aura: each foe comes into it once, as its first turn starts", () => {
    const run = ready([creature({ id: "hero", name: "Hero" }), creature({ id: "dragon", name: "Dragon", side: "hostile", auras: [presence({ immuneAfter: null })] })], { positioning: false });
    const hero = run.byId.get("hero");
    playTurn(run, hero);
    run.round = 2;
    playTurn(run, hero);
    expect(auraEvents(run).map(e => e.cause)).toEqual(["enter"]);
  });
});

describe("the Statistics Engine", () => {
  test("walking into a foe's aura to strike it costs what the aura would; not a shot, not once immune", () => {
    const run = ready([creature({ id: "hero", name: "Hero", position: at(0, 0) }), creature({ id: "dragon", name: "Dragon", side: "hostile", position: at(100, 0), auras: [presence()] })]);
    const [hero, dragon] = [run.byId.get("hero"), run.byId.get("dragon")];
    const sword = strike();
    expect(auraToll(run, hero, dragon, sword, 10)).toBeLessThan(1);
    expect(auraToll(run, hero, dragon, strike({ melee: false, range: { increment: 100 } }), 10)).toBe(1);
    hero.auraImmune = new Map([["dragon|presence", Infinity]]);
    expect(auraToll(run, hero, dragon, sword, 10)).toBe(1);
  });

  test("an aura with no save, or nothing a save could come to, isn't one", () => {
    expect(aurasOf({ spec: { auras: [{ id: "a", range: 10, byDegree: [{ conditions: { sickened: 1 } }] }] } })).toEqual([]);
    expect(aurasOf({ spec: { auras: [{ id: "a", range: 10, save: { type: "will", dc: 20 } }] } })).toEqual([]);
    expect(aurasOf({ spec: { auras: [presence()] } })).toHaveLength(1);
  });
});

describe("a whole fight", () => {
  const spec = () => battle([
    creature({ id: "amiri", name: "Amiri", kind: "pc", diesAtZero: false, position: at(0, 0), actions: [strike({ name: "Bastard Sword" })] }),
    creature({ id: "kyra", name: "Kyra", kind: "pc", diesAtZero: false, position: at(0, 10), actions: [strike({ name: "Scimitar" })] }),
    creature({ id: "dragon", name: "Dragon", side: "hostile", level: 3, hp: { value: 60, max: 60, temp: 0 }, position: at(60, 0), creatureTraits: ["dragon"],
      actions: [strike({ name: "Jaws", bonus: 12, damage: [parseFormula("2d8+5", "piercing")] })], auras: [presence({ save: { type: "will", dc: 40 } })] })
  ], { positioning: true });

  test("the dragon's presence frightens someone, and it's told every way", () => {
    const s = spec();
    const result = replay(s, pf2eRules, 5);
    const frightened = result.log.filter(e => e.type === "aura" && e.took);
    expect(frightened.length).toBeGreaterThan(0);
    expect(frightened[0].conditions).toEqual(["frightened"]);
    expect(frightened[0].actorId).toBe("dragon");
    for ( const style of ["roleplay", "standard", "statistician"] ) {
      const story = buildStory(result, s, style, { tables, seed: 5, title: "Test" });
      expect(story.text, style).not.toMatch(/\{\w+\}|FASTFIGHTING\./);
    }
    const stats = buildStory(result, s, "statistician", { tables, seed: 5 }).text;
    expect(stats).toContain(logLine(frightened[0]));
  });
});

describe("in a live battle", () => {
  const spec = () => battle([
    creature({ id: "hero", name: "Hero", kind: "pc", position: at(0, 0), hp: { value: 100, max: 100 }, diesAtZero: false }),
    creature({ id: "dragon", name: "Dragon", side: "hostile", position: at(100, 0), hp: { value: 100, max: 100 }, flags: { fearless: true }, auras: [presence()] })
  ], { positioning: true, maxRounds: 5 });
  const begin = () => {
    const run = beginLive(spec(), pf2eRules, { seed: 3, players: ["hero"], systemRolls: ["save"] });
    liveRound(run, 1);
    return run;
  };
  const step = run => {
    const hero = run.byId.get("hero");
    const from = { ...hero.pos };
    hero.pos = { x: 75, y: 0 };
    return from;
  };

  test("a player's character walking into it: its save is the system's, asked of it, and played with how it went", () => {
    const run = begin();
    let asked = null;
    try {
      movedBeside(run, "hero", step(run), { nonce: 7 });
    } catch ( err ) {
      asked = err;
    }
    expect(asked).toBeInstanceOf(NeedsDecision);
    expect(asked.request).toMatchObject({ roll: "save", unitId: "hero", targetId: "dragon", save: "will", dc: 50, action: { id: "presence", name: "Dread Presence" } });
    const again = begin();
    const events = movedBeside(again, "hero", step(again), { nonce: 7, answers: [[asked.request.key, { degree: 2, natural: 15, total: 52 }]] });
    expect(events.find(e => e.type === "aura")).toMatchObject({ targetId: "hero", degree: 2, natural: 15, total: 52, conditions: ["frightened"] });
    expect(again.byId.get("hero").conds.frightened).toBe(1);
    expect(again.live.playing).toBe(false);
  });

  test("kept with the battle: where it is, what it's been checked against and is immune to", () => {
    const run = begin();
    const events = movedBeside(run, "hero", step(run), { nonce: 7, answers: [["roll|save|hero|dragon|presence#1", { degree: 1, natural: 8, total: 15 }]] });
    expect(events.some(e => e.type === "aura")).toBe(true);
    const back = restoreRun(spec(), pf2eRules, snapshotRun(run));
    const hero = back.byId.get("hero");
    expect(back.auraReady).toBe(true);
    expect(hero.auraIn.has("dragon|presence")).toBe(true);
    expect(hero.auraImmune.get("dragon|presence")).toBe(11);
  });

  test("the dragon's own turn, coming close: the save is asked as any save in a turn FastFighting plays", () => {
    const requests = [];
    const answers = [];
    let events = null;
    for ( let tries = 0; tries < 40 && !events; tries++ ) {
      const run = begin();
      try {
        events = liveTurn(run, "dragon", { answers }).events;
      } catch ( err ) {
        if ( !(err instanceof NeedsDecision) ) throw err;
        requests.push(err.request);
        answers.push([err.request.key, err.request.roll === "save" ? { degree: 0, natural: 1, total: 8 } : false]);
      }
    }
    expect(requests.find(r => r.roll === "save")).toMatchObject({ unitId: "hero", targetId: "dragon", action: { id: "presence" } });
    expect(events.find(e => e.type === "aura")).toMatchObject({ actorId: "dragon", targetId: "hero", degree: 0, conditions: ["frightened"] });
  });
});
