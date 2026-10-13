import { afterEach, describe, expect, test } from "vitest";
import { cardUndoState, UNDO_REACH } from "../scripts/foundry/make-it-so.js";

const realGame = globalThis.game;
afterEach(() => { globalThis.game = realGame; });

/** A scene whose undo stack holds these entries (newest first), and a chat of `after` messages after the card. */
function world(stack, after = 0) {
  const scene = { getFlag: (scope, key) => (key === "undo" ? { stack } : null) };
  const card = { timestamp: 100, getFlag: (scope, key) => (key === "undoFight" ? { sceneId: "s1", id: "fight" } : null) };
  const later = Array.from({ length: after }, (_, i) => ({ timestamp: 101 + i }));
  globalThis.game = { ...realGame, scenes: { get: id => (id === "s1" ? scene : null) }, messages: { contents: [{ timestamp: 50 }, card, ...later] } };
  return card;
}

describe("a Make it So summary's Undo", () => {
  test("works for the latest on its scene, a few messages back", () => {
    expect(cardUndoState(world([{ id: "fight" }, { id: "older" }], 3))).toBe("ok");
  });

  test("does nothing for one a later Make it So stands on", () => {
    expect(cardUndoState(world([{ id: "newer" }, { id: "fight" }]))).toBe("later");
  });

  test(`does nothing past ${UNDO_REACH} messages back in the chat`, () => {
    expect(cardUndoState(world([{ id: "fight" }], UNDO_REACH))).toBe("ok");
    expect(cardUndoState(world([{ id: "fight" }], UNDO_REACH + 1))).toBe("buried");
  });

  test("is gone once it's undone, or no longer kept", () => {
    expect(cardUndoState(world([{ id: "other" }]))).toBe("gone");
    expect(cardUndoState(world([]))).toBe("gone");
  });
});
