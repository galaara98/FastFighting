/**
 * What a live battle takes from the players' side only as far as it's theirs (live-battle.js): a damage card applied
 * as the GM saw it; the chat a turn takes (and its Rewind deletes) only its own; a spotlight a player gives only to their own;
 * the cards it applied itself known by the ids it noted, never by a flag.
 */
import { describe, expect, test } from "vitest";
import { damageStill, turnCard, strayCards, spotlightGiven, appliedIn } from "../scripts/foundry/live-battle.js";
import { damageApplied, notedBy } from "../scripts/foundry/applied-cards.js";

describe("players' damage a GM approves", () => {
  const line = { amount: 7, healing: false };

  test("is applied only while its card still says what the GM was shown", () => {
    expect(damageStill(line, { amount: 7, kind: "damage" })).toBe(true);
    // (The player changed their card since: more, less, healing now, or no damage card at all.)
    expect(damageStill(line, { amount: 70, kind: "damage" })).toBe(false);
    expect(damageStill(line, { amount: 1, kind: "damage" })).toBe(false);
    expect(damageStill(line, { amount: 7, kind: "healing" })).toBe(false);
    expect(damageStill(line, null)).toBe(false);
    expect(damageStill({ amount: 4, healing: true }, { amount: 4, kind: "healing" })).toBe(true);
  });
});

describe("the chat a roll in a turn takes with it", () => {
  const msg = (author, speaker = {}) => ({ author: { id: author }, speaker });
  const who = { me: "gm", players: new Set(["pat"]), token: "valeros", actor: "valerosActor" };

  test("is this browser's own, and its player's speaking for the character it was asked of", () => {
    expect(turnCard(msg("gm"), who)).toBe(true);
    expect(turnCard(msg("pat", { token: "valeros" }), who)).toBe(true);
    expect(turnCard(msg("pat", { actor: "valerosActor" }), who)).toBe(true);
  });

  test("never anyone else's, nor the player's own words, as themselves or for another", () => {
    // (Another player's chat in the minute a save waits on its player.)
    expect(turnCard(msg("lin", { token: "valeros" }), who)).toBe(false);
    expect(turnCard(msg("lin"), who)).toBe(false);
    // (Another GM's.)
    expect(turnCard(msg("gm2", { token: "valeros" }), who)).toBe(false);
    // (The player, as themselves, or for another of theirs.)
    expect(turnCard(msg("pat"), who)).toBe(false);
    expect(turnCard(msg("pat", { token: "kyra" }), who)).toBe(false);
    // (Not asked of the player: a roll made here.)
    expect(turnCard(msg("pat", { token: "valeros" }), { ...who, players: new Set() })).toBe(false);
    expect(turnCard({ speaker: { token: "valeros" } }, who)).toBe(false);
  });

  test("Rewind This Encounter's sweep leaves a card whose author couldn't speak for its creature", () => {
    const owners = { valeros: "pat" };
    const card = (id, author, token) => ({ id, timestamp: 2000, author: { id: author, isGM: author === "gm" }, speaker: { token }, rolls: [{}] });
    const messages = [card("gm", "gm", "goblin"), card("own", "pat", "valeros"), card("forged", "lin", "valeros"), card("forgedFoe", "lin", "goblin")];
    const rightful = m => m.author.isGM || owners[m.speaker.token] === m.author.id;
    const gone = strayCards(messages, { since: 1000, tokens: new Set(["valeros", "goblin"]), rightful });
    expect(gone.map(m => m.id)).toEqual(["gm", "own"]);
  });
});

describe("damage cards FastFighting applied itself", () => {
  // (Kept turns, one a player's reaction rolled on their screen applied in; the player's turn going, their own card.)
  const data = { turns: [{ key: "1.a", messages: ["attack"] }, { key: "1.b", applied: ["reaction"] }] };
  const pc = { id: "valeros", applied: ["own"] };

  test("are the ids the battle noted with the turn that applied them, or the player's turn going", () => {
    expect(appliedIn(data, pc, "reaction")).toBe(true);
    expect(appliedIn(data, pc, "own")).toBe(true);
    // (A turn's other cards, any other card, or nothing to go by.)
    expect(appliedIn(data, pc, "attack")).toBe(false);
    expect(appliedIn(data, pc, "other")).toBe(false);
    expect(appliedIn(data, null, "own")).toBe(false);
    expect(appliedIn(data, pc, null)).toBe(false);
    expect(appliedIn(null, null, "reaction")).toBe(false);
  });

  test("a helper asks by the message (or its id), never by a flag on it", () => {
    try {
      notedBy(id => appliedIn(data, pc, id));
      expect(damageApplied({ id: "reaction" })).toBe(true);
      expect(damageApplied("own")).toBe(true);
      // (A player's card flagged as if it were FastFighting's own counts for nothing.)
      expect(damageApplied({ id: "forged", flags: { "fast-fighting": { applied: true }, "fast-fighting-pf2e": { rolled: { times: 1 } } } })).toBe(false);
      expect(damageApplied(null)).toBe(false);
      // (No battle in this browser: none.)
      notedBy(null);
      expect(damageApplied("reaction")).toBe(false);
      // (A test that throws: none.)
      notedBy(() => {
        throw new Error("no battle");
      });
      expect(damageApplied("reaction")).toBe(false);
    } finally {
      notedBy(null);
    }
  });
});

describe("a spotlight system's spotlight", () => {
  const mine = new Set(["valeros"]);
  const owns = id => mine.has(id);
  const at = combatantId => ({ round: 3, turn: combatantId ? 1 : null, combatantId });

  test("a GM gives to anyone", () => {
    expect(spotlightGiven({ byGM: true, prior: at("valeros"), current: at("dragon"), owns: () => false })).toBe(true);
  });

  test("a player only to a character of their own, or back from one", () => {
    expect(spotlightGiven({ byGM: false, prior: at(null), current: at("valeros"), owns })).toBe(true);
    expect(spotlightGiven({ byGM: false, prior: at("kyra"), current: at("valeros"), owns })).toBe(true);
    expect(spotlightGiven({ byGM: false, prior: at("valeros"), current: at(null), owns })).toBe(true);
    // (To a creature FastFighting plays, or another's character; or taken from one that isn't theirs.)
    expect(spotlightGiven({ byGM: false, prior: at("valeros"), current: at("dragon"), owns })).toBe(false);
    expect(spotlightGiven({ byGM: false, prior: at(null), current: at("kyra"), owns })).toBe(false);
    expect(spotlightGiven({ byGM: false, prior: at("dragon"), current: at(null), owns })).toBe(false);
  });
});
