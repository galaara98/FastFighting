/**
 * API 20: the engine's own dice shown as the system's cards. In a turn FastFighting plays, damage the engine rolls
 * itself (a Strike the system refused, a save's damage it didn't roll, persistent damage it ticks) is asked for as the
 * system's damage card (engine/live.js systemRoll "card", the table rolls waiting before it with it), then applied the
 * system's way ("apply"): the target takes what its sheet lost. The dice stay the engine's, exactly. Without the hook
 * (an older helper, another system), a plain table roll and the engine's sum. And the chat side (foundry/table-rolls.js
 * postRolls): each roll the helper's own card where it shows one, else a plain roll, in order; none shown twice.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { beginLive, liveRound, liveTurn, NeedsDecision } from "../scripts/engine/live.js";
import { rolledParts } from "../scripts/core-api.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { postRolls, AUDIENCE } from "../scripts/foundry/table-rolls.js";
import { SystemAdapter } from "../scripts/adapters/adapter-base.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const minded = n => ({ tactical: { base: n, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } });

/** The orc's turn played through its questions, each answered by `answer(request)`, from a fresh battle each pass. */
function playThrough(setUp, id, answer) {
  const answers = [];
  const requests = [];
  for ( let tries = 0; tries < 80; tries++ ) {
    const run = setUp();
    const before = run.byId.get("hero").hp;
    try {
      const result = liveTurn(run, id, { answers, nonce: 5 });
      return { run, result, requests, lost: before - run.byId.get("hero").hp };
    } catch ( err ) {
      if ( !(err instanceof NeedsDecision) ) throw err;
      requests.push(err.request);
      answers.push([err.request.key, answer(err.request)]);
    }
  }
  throw new Error("a turn that never stops asking");
}

const axe = strike({ id: "orc.axe", name: "Greataxe", bonus: 18, damage: [parseFormula("1d12+4", "slashing")] });

/** A hero and an orc beside it, the orc set on it; the system rolls `kinds`. */
function duel(kinds, { orc = {}, seed = 4 } = {}) {
  return () => {
    const run = beginLive(battle([
      creature({ id: "hero", name: "Valeros", kind: "pc", position: at(0), hp: { value: 200, max: 200 }, diesAtZero: false }),
      creature({ id: "orc", name: "Orc", side: "hostile", position: at(5), hp: { value: 200, max: 200 }, actions: [axe], traits: minded(40), flags: { fearless: true },
        desires: [{ kind: "hurt", targetId: "hero", level: 95 }], ...orc })
    ], { positioning: true, maxRounds: 5 }), pf2eRules, { seed, players: ["hero"], systemRolls: kinds });
    liveRound(run, 1);
    return run;
  };
}

/** The system's answers: no Strike of its own (refused), each damage card a message, each card applied for `lost`. */
function system({ lost = 3, card = true } = {}) {
  let n = 0;
  return r => {
    if ( r.roll === "strike" ) return null;
    if ( r.roll === "card" ) return card ? { card: `card${++n}` } : null;
    if ( r.roll === "apply" ) return { lost };
    return null;
  };
}

const hitsIn = events => events.filter(e => e.actorId === "orc" && e.type === "attack" && e.degree >= 2);
const diceOf = rolls => rolls.map(r => [r.kind, r.dice.map(d => d.result)]);

describe("the engine's damage as the system's damage card, in a turn FastFighting plays", () => {
  test("a Strike the system refused: its damage shown as the system's card, the attack before it, then applied the system's way", () => {
    const { result, requests, lost } = playThrough(duel(["strike", "card", "apply"]), "orc", system({ lost: 3 }));
    const cards = requests.filter(r => r.roll === "card");
    const hits = hitsIn(result.events);
    expect(hits.length).toBeGreaterThan(0);
    expect(cards.length).toBe(hits.length);
    // (Its first: the attack roll and its damage, the damage last; by the orc, at the hero, the Strike's own id.)
    const [first] = cards;
    expect(first).toMatchObject({ kind: "card", unitId: "orc", targetId: "hero", action: { id: "orc.axe", name: "Greataxe" } });
    expect(first.table.map(r => r.kind)).toEqual(["attack", "damage"]);
    expect(first.table[0]).toMatchObject({ by: "orc", target: "hero", action: "orc.axe", dc: 16 });
    const damage = first.table.at(-1);
    expect(damage).toMatchObject({ by: "orc", target: "hero", action: "orc.axe", source: "attack", label: "Greataxe" });
    // (Its parts as they fell: the type, the die and the modifier, for the system's own instance of it.)
    // (A critical hit's doubled, as the rules double it: every die twice over, the modifier too.)
    const [p] = rolledParts(damage);
    const times = damage.crit ? 2 : 1;
    expect(p).toMatchObject({ type: "slashing", category: null, flat: 4 * times });
    expect(p.dice).toEqual([{ faces: 12, results: [damage.dice[0].result], sign: 1, mult: times }]);
    // (Each card applied once, the system's way; the hero took what its sheet lost, not the engine's sum.)
    const applies = requests.filter(r => r.roll === "apply");
    expect(applies.map(r => r.card)).toEqual(cards.map((r, i) => `card${i + 1}`));
    expect(applies[0]).toMatchObject({ unitId: "orc", targetId: "hero" });
    expect(lost).toBe(3 * hits.length);
    expect(hits.every(e => e.damage === 3)).toBe(true);
    // (Shown already: the turn's own rolls up to its last damage, never posted again.)
    const lastDamage = result.rolls.map(r => r.kind).lastIndexOf("damage");
    expect(result.rolls.slice(0, lastDamage + 1).every(r => r.shown)).toBe(true);
    expect(result.rolls.filter(r => r.kind === "damage").map(r => r.card)).toEqual(cards.map((r, i) => `card${i + 1}`));
  });

  test("the dice stay the engine's: the same rolls as without the hook, only shown and applied otherwise", () => {
    const shown = playThrough(duel(["strike", "card", "apply"]), "orc", system({ lost: 3 }));
    const plain = playThrough(duel(["strike", "apply"]), "orc", system());
    expect(diceOf(shown.result.rolls)).toEqual(diceOf(plain.result.rolls));
    // (Without it: nothing asked as a card, nothing applied the system's way, nothing marked shown; the engine's sum.)
    expect(plain.requests.some(r => r.roll === "card" || r.roll === "apply")).toBe(false);
    expect(plain.result.rolls.some(r => r.shown)).toBe(false);
    const sums = hitsIn(plain.result.events).reduce((s, e) => s + e.damage, 0);
    expect(plain.lost).toBe(sums);
    expect(sums).toBeGreaterThan(0);
  });

  test("no card made (a battle played through to the end, its rolls on the GMs' card): the engine's sum, the rolls shown with the turn", () => {
    const { result, requests, lost } = playThrough(duel(["strike", "card", "apply"]), "orc", system({ card: false }));
    expect(requests.some(r => r.roll === "card")).toBe(true);
    expect(requests.some(r => r.roll === "apply")).toBe(false);
    expect(result.rolls.some(r => r.shown)).toBe(false);
    expect(lost).toBe(hitsIn(result.events).reduce((s, e) => s + e.damage, 0));
  });

  test("a card made, but none the system could make of it (null): every roll shown already, the engine's sum", () => {
    const { result, requests, lost } = playThrough(duel(["strike", "card", "apply"]), "orc", r => (r.roll === "card" ? { card: null } : r.roll === "apply" ? { lost: 1 } : null));
    expect(requests.some(r => r.roll === "apply")).toBe(false);
    const lastDamage = result.rolls.map(r => r.kind).lastIndexOf("damage");
    expect(result.rolls.slice(0, lastDamage + 1).every(r => r.shown && !r.card)).toBe(true);
    expect(lost).toBe(hitsIn(result.events).reduce((s, e) => s + e.damage, 0));
  });

  test("a save's damage the system didn't roll: its card, the save before it, applied with the save's share", () => {
    const blast = { id: "orc.blast", name: "Fire Blast", kind: "save", cost: 2, rank: 1, save: { type: "reflex", dc: 40, basic: true },
      damage: [parseFormula("4d6", "fire")], range: { increment: 60, max: 60, noPenalty: true }, melee: false };
    const { requests, result } = playThrough(duel(["card", "apply"], { orc: { actions: [blast], position: at(30) } }), "orc", system({ lost: 5 }));
    const card = requests.find(r => r.roll === "card");
    expect(card.table.map(r => r.kind)).toEqual(["save", "damage"]);
    expect(card.table[0]).toMatchObject({ by: "hero", target: "orc", stat: "reflex", dc: 40, action: "orc.blast" });
    expect(card.table[1]).toMatchObject({ source: "save", action: "orc.blast" });
    expect(rolledParts(card.table[1])[0]).toMatchObject({ type: "fire", flat: 0 });
    expect(rolledParts(card.table[1])[0].dice[0].results.length).toBe(4);
    // (A failed basic save: the whole of it; the system applies the share it's told.)
    const apply = requests.find(r => r.roll === "apply");
    expect(apply).toMatchObject({ card: "card1", targetId: "hero" });
    const save = result.events.find(e => e.type === "save" && e.targetId === "hero");
    expect(apply.multiplier).toBe([2, 1, 0.5, 0][save.degree]);
  });

  test("persistent damage the engine ticks itself: its card, applied the system's way", () => {
    const burning = { ...parseFormula("2d6", "fire"), persistent: true };
    let ticked = 0;
    for ( const seed of [1, 2, 3, 4, 5, 6] ) {
      // (Unless a try at putting it out came first and worked: nothing to tick.)
      const { requests, run } = playThrough(duel(["card", "apply"], { seed, orc: { persistent: [burning], actions: [] } }), "orc", system({ lost: 2 }));
      const card = requests.find(r => r.roll === "card");
      if ( !card ) continue;
      ticked += 1;
      expect(card).toMatchObject({ unitId: "orc", targetId: "orc" });
      expect(card.table.at(-1)).toMatchObject({ kind: "damage", what: "persistent", by: "orc", target: "orc" });
      expect(requests.find(r => r.roll === "apply")).toMatchObject({ card: "card1", targetId: "orc" });
      expect(run.byId.get("orc").hp).toBe(198);
    }
    expect(ticked).toBeGreaterThan(0);
  });

  test("an adapter shows no table roll its system's way unless it says so", () => {
    expect(new SystemAdapter().showTableRoll({ kind: "damage" }, {})).toBeNull();
  });
});

describe("the chat: each roll its system's card where the helper shows one", () => {
  const was = { foundry: globalThis.foundry, game: globalThis.game, CONFIG: globalThis.CONFIG };
  let created;
  beforeEach(() => {
    created = [];
    class Roll {
      static fromData(json) { return { json }; }
    }
    class ChatMessage {
      static getSpeaker({ token }) { return { token: token?.id ?? null }; }
      static async create(data) {
        const id = `plain${created.length + 1}`;
        created.push({ id, ...data });
        return { id };
      }
    }
    globalThis.foundry = { documents: { ChatMessage }, dice: { Roll } };
    globalThis.game = { ...globalThis.game, users: [{ id: "gm", isGM: true }, { id: "p", isGM: false }] };
    globalThis.CONFIG = { sounds: { dice: "dice.wav" } };
  });
  afterEach(() => {
    globalThis.foundry = was.foundry;
    globalThis.game = was.game;
    globalThis.CONFIG = was.CONFIG;
  });

  const roll = (kind, extra = {}) => ({
    by: "orc", target: "hero", kind, label: "Greataxe", what: null, mod: 0, total: 7, dc: null, natural: null, degree: null,
    dice: [{ faces: 12, result: 3 }], groups: [{ faces: 12, results: [3], sign: 1, mult: 1, keep: null, roll: 0 }], ...extra
  });
  const docs = { orc: { id: "tOrc" }, hero: { id: "tHero" } };
  const options = extra => ({
    scene: null, docOf: id => docs[id] ?? null, unitOf: () => null, flags: { battle: "b1", turn: "1.k" },
    audiences: new Map([["orc", AUDIENCE.GM]]), ...extra
  });

  test("shown the helper's way, one roll to a card, in order; one it leaves is a plain roll of its own; the battle's flags on all", async () => {
    const asked = [];
    const show = async (r, o) => {
      asked.push([r.kind, o]);
      return r.kind === "recharge" ? null : [`sys-${r.kind}`];
    };
    const cards = new Map();
    const rolls = [roll("attack", { dc: 16 }), roll("damage"), roll("recharge")];
    const ids = await postRolls(rolls, options({ show, cards }));
    expect(ids).toEqual(["sys-attack", "sys-damage", "plain1"]);
    expect([...cards.values()]).toEqual([["sys-attack"], ["sys-damage"]]);
    expect(cards.get(rolls[1])).toEqual(["sys-damage"]);
    // (What the helper hears: who rolled, at whom, who sees it, the core's words without the DC, the battle's flags.)
    const [, o] = asked[0];
    expect(o).toMatchObject({ token: docs.orc, target: docs.hero, audience: AUDIENCE.GM, flags: { "fast-fighting": { live: { battle: "b1", turn: "1.k", rolls: true } } } });
    expect(o.flavor).not.toContain("16");
    // (The plain one: its own message, to the GMs, the battle's flags.)
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ speaker: { token: "tOrc" }, whisper: ["gm"], flags: { "fast-fighting": { live: { battle: "b1", rolls: true } } } });
    expect(created[0].rolls).toHaveLength(1);
  });

  test("a helper that fails or shows nothing: the plain roll; without one, each creature's rolls together as before", async () => {
    const failing = async () => {
      throw new Error("no");
    };
    const quiet = await postRolls([roll("attack"), roll("damage")], options({ show: failing }));
    expect(quiet).toEqual(["plain1", "plain2"]);
    created.length = 0;
    const together = await postRolls([roll("attack"), roll("damage")], options());
    expect(together).toEqual(["plain1"]);
    expect(created[0].rolls).toHaveLength(2);
  });
});
