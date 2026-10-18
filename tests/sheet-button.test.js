/**
 * FastFighting on a character sheet's title bar: for its owner who can't open its token windows, never a GM, only a
 * character the helper reads; it opens the survey on that character's tab (its token on the scene, else the actor's).
 */
import { describe, expect, test } from "vitest";
import { wantsButton, surveyTabFor } from "../scripts/foundry/sheet-button.js";

describe("the sheet's FastFighting button", () => {
  test("its owner without a token button sees it; a GM, someone else's sheet, or a token button there: not", () => {
    expect(wantsButton({ isOwner: true, handled: true })).toBe(true);
    expect(wantsButton({ isOwner: true, handled: true, tokenButton: true })).toBe(false);
    expect(wantsButton({ isGM: true, isOwner: true, handled: true })).toBe(false);
    expect(wantsButton({ isOwner: false, handled: true })).toBe(false);
    expect(wantsButton({ isOwner: true, handled: false })).toBe(false);
  });

  test("the survey opens on the sheet's token, else on its actor's tab", () => {
    const characters = [
      { key: "tok1", token: { id: "tok1" }, actor: { id: "amiri" } },
      { key: "actor-lem", token: null, actor: { id: "lem" } }
    ];
    expect(surveyTabFor(characters, { tokenId: "tok1", actorId: "amiri" }).key).toBe("tok1");
    expect(surveyTabFor(characters, { actorId: "amiri" }).key).toBe("tok1");
    expect(surveyTabFor(characters, { actorId: "lem" }).key).toBe("actor-lem");
    expect(surveyTabFor(characters, { actorId: "nobody" })).toBeNull();
  });
});
