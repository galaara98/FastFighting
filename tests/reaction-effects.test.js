/**
 * A reaction's effects at any moment (behavior/reaction-effects.js): harm, afflict, boost, heal, recharge and strike,
 * weighed and played in one place; and the ownHit moment, its own blow that lands.
 */
import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { parseFormula, part } from "../scripts/engine/dice.js";
import { genericRules } from "../scripts/adapters/generic/rules.js";
import { beginLive, liveRound, liveTurn, NeedsDecision } from "../scripts/engine/live.js";
import { buildStory } from "../scripts/story/story.js";
import { logLine } from "../scripts/story/log-lines.js";
import { harmOf, effectsOf, setterOf, afflictionAt } from "../scripts/engine/behavior/reaction-effects.js";
import { STATUS } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { storyTables } from "./foundry-i18n.js";
import { creature, strike, battle } from "./helpers.js";

/** One reaction a round, nobody's opportunity strikes (they'd only muddy these tests). */
const rules = { ...genericRules, id: "test-reaction-effects", reactions: () => 1, onDropped(c) { c.status = c.spec.kind === "pc" ? STATUS.DOWN : STATUS.DEAD; c.stable = true; return c.status; } };
const traits = (tactical = 70) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 20, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const club = (over = {}) => strike({ id: "club", name: "Club", bonus: 6, damage: [parseFormula("10", "bludgeoning")], ...over });
const brute = (extra = {}) => creature({ id: "brute", name: "Brute", side: "hostile", hp: { value: 500, max: 500 }, defenses: { ac: 12, fortitude: 2, reflex: 2, will: 2 },
  actions: [club()], flags: { fearless: true }, traits: traits(40), ...extra });
const hero = (extra = {}) => creature({ id: "hero", name: "Hero", kind: "pc", diesAtZero: false, hp: { value: 400, max: 400 }, defenses: { ac: 13, fortitude: 2, reflex: 2, will: 2 },
  traits: traits(70), actions: [strike({ id: "staff", name: "Staff", bonus: 2, damage: [parseFormula("1d6", "bludgeoning")] })], ...extra });
const logs = (spec, ruleset = rules, seeds = 12) => {
  const out = [];
  for ( let s = 1; s <= seeds; s++ ) out.push(replay(spec, ruleset, s).log);
  return out;
};
/** The events a reaction of `actorId` set off on `trigger` (its own line, then what it did, up to the next turn's). */
const after = (log, i, n = 6) => log.slice(i + 1, i + 1 + n);

describe("one set of effects", () => {
  test("a reaction's older damage, save and move are its harm; the effects it has, in the order they play", () => {
    expect(harmOf({ damage: [parseFormula("2d6", "fire")], save: { type: "reflex", dc: 15 } })).toMatchObject({ save: { type: "reflex" } });
    expect(harmOf({ move: { kind: "push", feet: 10 } })).toMatchObject({ damage: [], move: { feet: 10 } });
    expect(harmOf({ ac: 2 })).toBe(null);
    expect(effectsOf({ strike: true, step: 5, heal: [parseFormula("5", "healing")], recharge: "breath", afflict: { outcome: {} } })).toEqual(["step", "strike", "afflict", "heal", "recharge"]);
    expect(afflictionAt({ save: { type: "will", dc: 15 }, outcome: { label: "x" } }, 1)).toMatchObject({ label: "x" });
    expect(afflictionAt({ save: { type: "will", dc: 15 }, outcome: { label: "x" } }, 2)).toBe(null);
    expect(afflictionAt({ onSave: [{ label: "a" }, { label: "b" }, null, null] }, 0)).toMatchObject({ label: "a" });
  });

  test("who set it off: the attacker or the one who hurt it; on its own blow, the one it hit; none for a friend's move", () => {
    const by = { id: "by" };
    const target = { id: "target" };
    expect(setterOf("hit", { by })).toBe(by);
    expect(setterOf("spell", { by })).toBe(by);
    expect(setterOf("ownHit", { target, by })).toBe(target);
    expect(setterOf("allyMoves", { ally: by })).toBe(null);
  });
});

describe("harm", () => {
  test("hit: at the attacker once the blow is done, a save for half; told after the attack and the answer", () => {
    const spines = { id: "spines", label: "Spines", on: "hit", melee: true, harm: { damage: [parseFormula("2d6", "piercing")], save: { type: "reflex", dc: 30, basic: true } } };
    let seen = 0;
    for ( const log of logs(battle([hero({ reactions: [spines] }), brute()], { maxRounds: 3 })) ) {
      log.forEach((e, i) => {
        if ( e.type !== "reaction" || e.reaction !== "Spines" ) return;
        seen += 1;
        expect(e.trigger).toBe("hit");
        expect(log[i - 1]).toMatchObject({ type: "attack", actorId: "brute", targetId: "hero" });
        expect(after(log, i).find(x => x.type === "auto" && x.reaction)).toMatchObject({ actorId: "hero", targetId: "brute" });
      });
    }
    expect(seen).toBeGreaterThan(3);
  });

  test("attacked: what it does comes first, and an attacker it fells never makes the attack", () => {
    const lash = { id: "lash", label: "Lash", on: "attacked", harm: { damage: [parseFormula("50", "fire")] } };
    const frail = brute({ hp: { value: 30, max: 30 } });
    for ( const log of logs(battle([hero({ reactions: [lash] }), frail], { maxRounds: 3 }), rules, 6) ) {
      const i = log.findIndex(e => e.type === "reaction" && e.reaction === "Lash");
      expect(i).toBeGreaterThanOrEqual(0);
      expect(log[i]).toMatchObject({ trigger: "attacked", actorId: "hero", targetId: "brute" });
      // (Burned to nothing before its swing: no attack of its at the hero after it.)
      expect(log.slice(i).some(e => e.type === "attack" && e.actorId === "brute")).toBe(false);
    }
  });

  test("missed: any miss, a ranged one where the reaction says so", () => {
    const sting = { id: "sting", label: "Sting", on: "missed", ranged: true, harm: { damage: [parseFormula("3", "acid")] } };
    const archer = brute({ actions: [strike({ id: "bow", name: "Bow", melee: false, reach: undefined, bonus: -4, range: { increment: 60, max: 120 }, damage: [parseFormula("1d6", "piercing")] })] });
    const told = logs(battle([hero({ reactions: [sting] }), archer], { maxRounds: 4 })).flat().filter(e => e.type === "reaction" && e.reaction === "Sting");
    expect(told.length).toBeGreaterThan(3);
    // (A melee miss is no ranged one.)
    expect(logs(battle([hero({ reactions: [sting] }), brute({ actions: [club({ bonus: -4 })] })], { maxRounds: 4 })).flat().some(e => e.reaction === "Sting")).toBe(false);
  });

  test("damaged: only what hurt it with those types (damageTypes)", () => {
    const quench = { id: "quench", label: "Quench", on: "damaged", damageTypes: ["fire"], harm: { damage: [parseFormula("4", "cold")] } };
    expect(logs(battle([hero({ reactions: [quench] }), brute()], { maxRounds: 3 })).flat().some(e => e.reaction === "Quench")).toBe(false);
    const torch = brute({ actions: [club({ damage: [parseFormula("10", "fire")] })] });
    expect(logs(battle([hero({ reactions: [quench] }), torch], { maxRounds: 3 })).flat().filter(e => e.reaction === "Quench").length).toBeGreaterThan(3);
  });
});

describe("afflict", () => {
  const scare = (extra = {}) => ({ id: "scare", label: "Ghastly Wail", on: "damaged", ...extra,
    afflict: { save: { type: "will", dc: 40 }, onSave: [{ conditions: { frightened: 2 }, rounds: 2, label: "frightened 2" }, { conditions: { frightened: 1 }, rounds: 1, label: "frightened 1" }, null, null], traits: ["fear"] } });

  test("damaged: its save, and what that degree lays on the one who hurt it", () => {
    let laid = 0;
    for ( const log of logs(battle([hero({ reactions: [scare()] }), brute()], { maxRounds: 3 })) ) {
      log.forEach((e, i) => {
        if ( e.type !== "reaction" || e.reaction !== "Ghastly Wail" ) return;
        const next = after(log, i, 3);
        expect(next[0]).toMatchObject({ type: "riderSave", actorId: "brute", name: "Ghastly Wail", saveType: "will", dc: 40 });
        if ( next[0].degree <= 1 ) {
          laid += 1;
          expect(next[1]).toMatchObject({ type: "condition", actorId: "brute", effect: expect.stringMatching(/frightened/) });
        }
      });
    }
    expect(laid).toBeGreaterThan(3);
  });

  test("one that can't be frightened: nothing laid, and not worth using", () => {
    const fearless = brute({ iwr: { immune: ["frightened", "fear"] } });
    expect(logs(battle([hero({ reactions: [scare()] }), fearless], { maxRounds: 3 })).flat().some(e => e.reaction === "Ghastly Wail")).toBe(false);
  });

  test("no save: its outcome simply lands; with its harm's save, one roll for both", () => {
    const grip = { id: "grip", label: "Clinging Ooze", on: "hit", afflict: { outcome: { conditions: { slowed: 1 }, rounds: 1, label: "slowed 1" } } };
    const told = logs(battle([hero({ reactions: [grip] }), brute()], { maxRounds: 3 })).flat();
    expect(told.some(e => e.type === "condition" && e.actorId === "brute" && e.effect === "slowed 1")).toBe(true);
    expect(told.some(e => e.type === "riderSave" && e.name === "Clinging Ooze")).toBe(false);

    let saves = 0;
    const counting = { ...rules, afterRoll(run, u, roll, ctx) { if ( ctx.kind === "save" && u.id === "brute" ) saves += 1; } };
    const both = { id: "both", label: "Searing Blood", on: "damaged", harm: { damage: [parseFormula("2d6", "fire")], save: { type: "reflex", dc: 40, basic: true } },
      afflict: { onSave: [{ conditions: { sickened: 2 }, rounds: 1, label: "sickened 2" }, { conditions: { sickened: 1 }, rounds: 1, label: "sickened 1" }, null, null] } };
    const log = replay(battle([hero({ reactions: [both] }), brute()], { maxRounds: 2 }), counting, 3).log;
    const used = log.filter(e => e.reaction === "Searing Blood" && e.type === "reaction").length;
    expect(used).toBeGreaterThan(0);
    expect(saves).toBe(used);
    expect(log.some(e => e.type === "riderSave" && e.name === "Searing Blood")).toBe(false);
  });
});

describe("boost, heal, recharge", () => {
  test("boost: a resistance at once, softening this very blow, told with its answer", () => {
    const stone = { id: "stone", label: "Stone Skin", on: "hit", boost: { iwr: { resist: { bludgeoning: 10 } }, rounds: 1, label: "stone skin" } };
    let seen = 0;
    for ( const log of logs(battle([hero({ reactions: [stone] }), brute()], { maxRounds: 3 })) ) {
      log.forEach((e, i) => {
        if ( e.type !== "reaction" || e.reaction !== "Stone Skin" ) return;
        seen += 1;
        // (The club's 10, halved by the generic rules' resistance; 20 on a critical hit.)
        expect([5, 10]).toContain(log[i - 1].damage);
        expect(log[i + 1]).toMatchObject({ type: "buff", actorId: "hero", self: true, effect: "stone skin", reaction: true });
      });
    }
    expect(seen).toBeGreaterThan(3);
  });

  test("heal: hit points back once it's hurt, as much as it's missing at most", () => {
    const mend = { id: "mend", label: "Blood Rush", on: ["damaged", "missed"], heal: [parseFormula("6", "healing")] };
    let healed = 0;
    for ( const log of logs(battle([hero({ reactions: [mend] }), brute()], { maxRounds: 3 })) ) {
      log.forEach((e, i) => {
        if ( e.type !== "reaction" || e.reaction !== "Blood Rush" ) return;
        healed += 1;
        expect(log[i + 1]).toMatchObject({ type: "heal", actorId: "hero", targetId: "hero", self: true });
        expect(log[i + 1].amount).toBeGreaterThan(0);
        expect(log[i + 1].amount).toBeLessThanOrEqual(6);
      });
    }
    expect(healed).toBeGreaterThan(3);
    // (Unhurt, there's nothing to mend: never used on a miss.)
    const run = replay(battle([hero({ reactions: [mend] }), brute({ actions: [club({ bonus: -20 })] })], { maxRounds: 2 }), rules, 1);
    const hurt = run.log.findIndex(e => e.type === "attack" && e.actorId === "brute" && e.damage > 0);
    const before = hurt < 0 ? run.log : run.log.slice(0, hurt);
    expect(before.some(e => e.type === "attack" && e.actorId === "brute")).toBe(true);
    expect(before.some(e => e.reaction === "Blood Rush")).toBe(false);
  });

  test("recharge: a critical hit brings its spent breath back (ownHit, crit, free)", () => {
    const breath = { id: "breath", name: "Breath", kind: "save", cost: 2, save: { type: "reflex", dc: 30, basic: true }, damage: [parseFormula("10d6", "fire")],
      uses: 1, cooldown: { n: 1, faces: 4 }, range: { increment: 30, max: 30, noPenalty: true }, melee: false };
    const momentum = { id: "momentum", label: "Momentum", on: "ownHit", crit: true, free: true, passive: true, recharge: ["breath"] };
    // (Its jaws crit the knight every time, and are a nibble beside its breath.)
    const dragon = creature({ id: "dragon", name: "Dragon", side: "hostile", level: 10, hp: { value: 900, max: 900 }, traits: traits(70), flags: { fearless: true },
      actions: [strike({ id: "jaws", name: "Jaws", bonus: 30, damage: [parseFormula("1d4", "piercing")] }), breath], reactions: [momentum] });
    const knight = hero({ hp: { value: 2000, max: 2000 }, defenses: { ac: 18, fortitude: 10, reflex: 10, will: 10 } });
    let back = 0;
    let again = 0;
    for ( const log of logs(battle([knight, dragon], { maxRounds: 5 }), pf2eRules, 8) ) {
      log.forEach((e, i) => {
        if ( e.type !== "reaction" || e.reaction !== "Momentum" ) return;
        back += 1;
        expect(e).toMatchObject({ trigger: "ownHit", actorId: "dragon", targetId: "hero" });
        expect(log.slice(0, i).reverse().find(x => x.type === "attack" && x.actorId === "dragon")).toMatchObject({ crit: true });
        expect(log[i + 1]).toMatchObject({ type: "recharge", actorId: "dragon", action: "Breath", reaction: true });
        // (And breathed again, sooner than its cooldown would have let it.)
        if ( log.slice(i).some(x => x.type === "save" && x.actorId === "dragon" && x.action === "Breath") ) again += 1;
      });
    }
    expect(back).toBeGreaterThan(2);
    expect(again).toBeGreaterThan(1);
  });
});

describe("its own blow lands (ownHit)", () => {
  const twin = (extra = {}) => ({ id: "twin", label: "Twin Bite", on: "ownHit", strike: true, free: true, ...extra });
  const biter = (extra = {}) => brute({ actions: [club({ id: "jaws", name: "Jaws", bonus: 10, damage: [parseFormula("4", "piercing")] })], ...extra });

  test("another strike at the one it hit, and none again from that strike", () => {
    let seen = 0;
    for ( const log of logs(battle([hero(), biter({ reactions: [twin()] })], { maxRounds: 3 })) ) {
      log.forEach((e, i) => {
        if ( e.type !== "reaction" || e.reaction !== "Twin Bite" ) return;
        seen += 1;
        expect(e).toMatchObject({ trigger: "ownHit", actorId: "brute", targetId: "hero" });
        expect(log[i - 1]).toMatchObject({ type: "attack", actorId: "brute", targetId: "hero" });
        expect(log[i - 1].degree).toBeGreaterThanOrEqual(2);
        expect(log[i + 1]).toMatchObject({ type: "attack", actorId: "brute", targetId: "hero" });
        // (Its answer's own strike sets off nothing more.)
        expect(log[i + 2]?.type === "reaction" && log[i + 2]?.reaction === "Twin Bite").toBe(false);
      });
    }
    expect(seen).toBeGreaterThan(3);
  });

  test("filters: a critical hit only; one of its strikes only (by id); melee or ranged", () => {
    const crits = logs(battle([hero(), biter({ reactions: [twin({ crit: true })] })], { maxRounds: 4 }), pf2eRules).flat();
    crits.forEach((e, i) => {
      if ( e.type === "reaction" && e.reaction === "Twin Bite" ) expect(crits.slice(0, i).reverse().find(x => x.type === "attack" && x.actorId === "brute")).toMatchObject({ crit: true });
    });
    expect(crits.some(e => e.reaction === "Twin Bite")).toBe(true);
    expect(logs(battle([hero(), biter({ reactions: [twin({ actions: ["claw"] })] })], { maxRounds: 3 })).flat().some(e => e.reaction === "Twin Bite")).toBe(false);
    expect(logs(battle([hero(), biter({ reactions: [twin({ actions: ["jaws"] })] })], { maxRounds: 3 })).flat().some(e => e.reaction === "Twin Bite")).toBe(true);
    expect(logs(battle([hero(), biter({ reactions: [twin({ ranged: true })] })], { maxRounds: 3 })).flat().some(e => e.reaction === "Twin Bite")).toBe(false);
  });

  test("the one it hit is the one that's near or far: a reaction's range is measured to it", () => {
    const at = (x, y = 0) => ({ x, y, size: 5 });
    const venom = { id: "venom", label: "Venom", on: "ownHit", free: true, range: 10, afflict: { outcome: { conditions: { sickened: 1 }, rounds: 1, label: "sickened 1" } } };
    const shooter = brute({ position: at(0), speeds: { walk: 0 }, reactions: [venom],
      actions: [strike({ id: "spit", name: "Spit", melee: false, reach: undefined, bonus: 12, range: { increment: 60, max: 120 }, damage: [parseFormula("3", "acid")] })] });
    const archer = over => hero({ speeds: { walk: 0 }, actions: [strike({ id: "bow", name: "Bow", melee: false, reach: undefined, bonus: 2, range: { increment: 60, max: 120 }, damage: [parseFormula("1d6", "piercing")] })], ...over });
    const far = logs(battle([archer({ position: at(40) }), shooter], { positioning: true, maxRounds: 3 })).flat();
    expect(far.some(e => e.type === "attack" && e.actorId === "brute" && e.degree >= 2)).toBe(true);
    expect(far.some(e => e.reaction === "Venom")).toBe(false);
    const close = logs(battle([archer({ position: at(10) }), shooter], { positioning: true, maxRounds: 3 })).flat();
    expect(close.some(e => e.type === "reaction" && e.reaction === "Venom" && e.targetId === "hero")).toBe(true);
  });
});

describe("a foe casts", () => {
  test("not only a counterspell: harm at the caster as it casts", () => {
    const hold = { id: "hold", name: "Hold", kind: "control", rank: 2, cost: 1, save: { type: "will", dc: 30 }, range: { increment: 90 },
      onSave: [{ conditions: { incapacitated: 1 }, rounds: 3, label: "held" }, { conditions: { incapacitated: 1 }, rounds: 3, label: "held" }, null, null], resource: "slot", traits: [] };
    const mage = brute({ id: "mage", name: "Mage", actions: [hold, club({ bonus: 0, damage: [parseFormula("1", "bludgeoning")] })], resources: { slot: 3 }, traits: traits(90), initiative: { mod: 20 } });
    const backlash = { id: "backlash", label: "Spell Bite", on: "foeCasts", harm: { damage: [parseFormula("2d6", "force")] } };
    const told = logs(battle([hero({ reactions: [backlash] }), mage], { maxRounds: 3 })).flat();
    const i = told.findIndex(e => e.type === "reaction" && e.reaction === "Spell Bite");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(told[i]).toMatchObject({ trigger: "spell", actorId: "hero", targetId: "mage" });
    expect(told[i + 1]).toMatchObject({ type: "auto", actorId: "hero", targetId: "mage", reaction: true });
  });
});

describe("whole fights, replayed and told", () => {
  /** A dragon whose critical hits bring its breath back, against a knight whose blood burns and scares. */
  const fight = () => {
    const breath = { id: "breath", name: "Breath", kind: "save", cost: 2, save: { type: "reflex", dc: 24, basic: true }, damage: [parseFormula("4d6", "fire")],
      uses: 1, cooldown: { n: 1, faces: 4 }, range: { increment: 30, max: 30, noPenalty: true }, melee: false };
    const dragon = creature({ id: "dragon", name: "Dragon", side: "hostile", level: 6, hp: { value: 140, max: 140 }, traits: traits(70), flags: { fearless: true },
      actions: [strike({ id: "jaws", name: "Jaws", bonus: 18, damage: [parseFormula("2d8+6", "piercing")] }), strike({ id: "claw", name: "Claw", bonus: 18, traits: ["agile"], maps: [0, -4, -8], damage: [parseFormula("2d6+6", "slashing")] }), breath],
      reactions: [
        { id: "momentum", label: "Momentum", on: "ownHit", crit: true, free: true, passive: true, recharge: ["breath"] },
        { id: "tail", label: "Tail Snap", on: "ownHit", actions: ["jaws"], strike: "claw" }
      ] });
    const knight = creature({ id: "knight", name: "Knight", kind: "pc", diesAtZero: false, level: 6, hp: { value: 110, max: 110 }, defenses: { ac: 24, fortitude: 14, reflex: 12, will: 12 },
      traits: traits(70), actions: [strike({ id: "sword", name: "Sword", bonus: 16, damage: [parseFormula("2d8+5", "slashing")] })],
      reactions: [{ id: "blood", label: "Burning Blood", on: "damaged", harm: { damage: [parseFormula("2d6", "fire")], save: { type: "reflex", dc: 22, basic: true } },
        afflict: { onSave: [{ conditions: { frightened: 2 }, rounds: 2, label: "frightened 2" }, { conditions: { frightened: 1 }, rounds: 1, label: "frightened 1" }, null, null] } }] });
    return battle([knight, dragon], { maxRounds: 8 });
  };

  test("the same seed tells the same fight; the reactions answer, and are told in the log and the story", () => {
    const tables = new Map(Object.entries(storyTables()));
    let reacted = new Set();
    for ( let seed = 1; seed <= 10; seed++ ) {
      const a = replay(fight(), pf2eRules, seed);
      const b = replay(fight(), pf2eRules, seed);
      expect(b.log).toEqual(a.log);
      for ( const e of a.log ) if ( e.type === "reaction" ) reacted.add(`${e.reaction}|${e.trigger}`);
      for ( const e of a.log.filter(x => x.type === "reaction" || x.reaction) ) expect(logLine(e)).toBeTruthy();
      const story = buildStory(a, fight(), "roleplay", { tables: { get: k => tables.get(k) }, seed });
      expect(story.text.length).toBeGreaterThan(50);
    }
    expect([...reacted]).toEqual(expect.arrayContaining(["Burning Blood|damaged", "Tail Snap|ownHit"]));
  });

  test("a feral creature answers carelessly, but never with what does nothing", () => {
    const spines = { id: "spines", label: "Spines", on: "hit", harm: { damage: [parseFormula("1d4", "piercing")] }, uses: 1 };
    const wild = hero({ traits: traits(5), reactions: [spines], kind: "npc", side: "friendly" });
    const told = logs(battle([wild, brute()], { maxRounds: 3 })).flat().filter(e => e.reaction === "Spines" && e.type === "reaction");
    expect(told.length).toBeGreaterThan(3);
  });
});

describe("in a live battle", () => {
  const at = (x, y = 0) => ({ x, y, size: 5 });
  const minded = n => ({ tactical: { base: n, fudge: 0 }, brave: { base: 60, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
  /** The NPC's turn played through its questions, each answered by `answer(request)`. */
  function playThrough(setUp, id, answer) {
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
  const venom = { id: "witch.venom", label: "Venom Kiss", on: "ownHit", free: true,
    harm: { damage: [parseFormula("6", "poison")], save: { type: "fortitude", dc: 20, basic: true } },
    afflict: { onSave: [{ conditions: { sickened: 2 }, rounds: 2, label: "sickened 2" }, { conditions: { sickened: 1 }, rounds: 1, label: "sickened 1" }, null, null] } };
  const setUp = kinds => () => {
    const run = beginLive(battle([
      creature({ id: "hero", kind: "pc", position: at(0), hp: { value: 100, max: 100 }, diesAtZero: false }),
      creature({ id: "witch", side: "hostile", position: at(5), hp: { value: 100, max: 100 }, traits: minded(60), flags: { fearless: true },
        actions: [strike({ id: "witch.nails", name: "Nails", bonus: 40, damage: [parseFormula("5", "slashing")] })], reactions: [venom] })
    ], { positioning: true, maxRounds: 5 }), pf2eRules, { seed: 2, players: ["hero"], systemRolls: kinds });
    liveRound(run, 1);
    return run;
  };
  const answer = r => ({
    use: { card: "venom-card" },
    damage: { damage: { byType: { poison: 10 } }, card: "venom-damage" },
    save: { degree: 1, natural: 4, total: 12 },
    apply: { lost: 9 }
  })[r.roll] ?? null;

  test("its card, its damage rolled the system's way, the save the system's, the share applied its way; what it lays, the engine's", () => {
    const { run, events, requests } = playThrough(setUp(["use", "damage", "save", "apply"]), "witch", answer);
    // (Its damage applied the system's way: asked with the card its damage roll made.)
    const asked = requests.filter(r => r.action?.id === "witch.venom" || r.card === "venom-damage");
    const kinds = asked.map(r => r.roll);
    expect(kinds).toEqual(expect.arrayContaining(["use", "damage", "save", "apply"]));
    expect(kinds.indexOf("use")).toBeLessThan(kinds.indexOf("damage"));
    expect(asked.find(r => r.roll === "use")).toMatchObject({ unitId: "witch", targetId: "hero", action: { name: "Venom Kiss" } });
    expect(asked.find(r => r.roll === "damage")).toMatchObject({ unitId: "witch", card: "venom-card" });
    expect(asked.find(r => r.roll === "save")).toMatchObject({ unitId: "hero", targetId: "witch", save: "fortitude", dc: 20 });
    expect(asked.find(r => r.roll === "apply")).toMatchObject({ unitId: "witch", targetId: "hero", card: "venom-damage", multiplier: 1 });
    // (One save for its harm and what it lays: a failure, sickened 1 by the reaction, its effect keyed by the reaction for
    // the helper's effectRef.)
    expect(asked.filter(r => r.roll === "save").length).toBe(asked.filter(r => r.roll === "use").length);
    expect(events.find(e => e.type === "auto" && e.reaction)).toMatchObject({ damage: 9, targetId: "hero" });
    const hero = run.byId.get("hero");
    expect(hero.conds.sickened).toBe(1);
    expect(hero.effects.some(e => e.key === "witch.venom" && e.sourceId === "witch")).toBe(true);
  });

  test("no system roller: the engine's dice", () => {
    const { requests, events } = playThrough(setUp([]), "witch", answer);
    expect(requests.length).toBe(0);
    expect(events.some(e => e.type === "reaction" && e.reaction === "Venom Kiss")).toBe(true);
  });
});
