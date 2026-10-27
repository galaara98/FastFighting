/**
 * The GM a player's browser asks about a battle's card (foundry/chat.js cardGm): the one whose browser plays the battle,
 * its card's author, while they're here; with two GMs on, never just whichever Foundry calls the active GM.
 */
import { describe, expect, test } from "vitest";
import { cardGm } from "../scripts/foundry/chat.js";

const users = list => ({ get: id => list.find(u => u.id === id), activeGM: list.find(u => u.isGM && u.active && u.first) ?? null });

describe("the GM asked", () => {
  test("the card's author, a GM still here; else the active GM", () => {
    const playing = { id: "gm2", isGM: true, active: true };
    const other = { id: "gm1", isGM: true, active: true, first: true };
    expect(cardGm(users([other, playing]), "gm2")).toBe(playing);
    expect(cardGm(users([other, { ...playing, active: false }]), "gm2")).toBe(other);
    expect(cardGm(users([other]), null)).toBe(other);
    // (A card a player wrote isn't the battle's: its author isn't asked.)
    expect(cardGm(users([other, { id: "pat", isGM: false, active: true }]), "pat")).toBe(other);
    expect(cardGm(users([]), "gm2")).toBeNull();
  });
});
