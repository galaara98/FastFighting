/**
 * What a live battle takes from the players' side only as far as it's theirs (live-battle.js): a damage card applied
 * as the GM saw it; the chat a turn takes (and its Rewind deletes) only its own.
 */
import { describe, expect, test } from "vitest";
import { damageStill, turnCard, strayCards } from "../scripts/foundry/live-battle.js";

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
