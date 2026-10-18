/**
 * The tracker gone back (Previous Turn, Previous Round, Rewind): the kept turns after where it is now are taken back,
 * the latest first; the one it's on stays as it ended (one FastFighting played), or is opened again (a player's).
 */
import { describe, expect, test } from "vitest";
import { goingBack, undoEntries } from "../scripts/foundry/live-battle.js";

// (The order on the tracker: a, b, c, d.)
const order = ["a", "b", "c", "d"];
const place = t => ({ round: t.round, at: order.indexOf(t.combatantId) });
const turn = (round, combatantId, kind = "npc", extra = {}) => ({ key: `${round}.${combatantId}`, round, combatantId, kind, snapshot: {}, ...extra });

describe("going back on the tracker", () => {
  const played = [turn(1, "a"), turn(1, "b"), turn(1, "c"), turn(1, "d"), turn(2, "a"), turn(2, "b")];

  test("one back: the turn it left is taken back; the one it's on stays as it ended", () => {
    // (On 2.b, played: back to 2.a.)
    const { undo, own, reopen } = goingBack(played, { round: 2, at: 0 }, "2.a", place);
    expect(undo.map(t => t.key)).toEqual(["2.b"]);
    expect(own.key).toBe("2.a");
    expect(reopen).toBeNull();
  });

  test("back past a round: every turn after it, and only those", () => {
    // (Previous Round from 2.b: the last of round 1, d.)
    const { undo, own } = goingBack(played, { round: 1, at: 3 }, "1.d", place);
    expect(undo.map(t => t.key)).toEqual(["2.a", "2.b"]);
    expect(own.key).toBe("1.d");
  });

  test("the turn it left not played yet (rewound, or a player's under way): nothing of its to take back", () => {
    const { undo, own } = goingBack(played.slice(0, 5), { round: 2, at: 0 }, "2.a", place);
    expect(undo).toEqual([]);
    expect(own.key).toBe("2.a");
  });

  test("back to a player's turn: theirs again, so it's taken back too, to be read again", () => {
    const turns = [turn(1, "a"), turn(1, "b", "pc", { from: 1000, cards: ["m1", "m2"] }), turn(1, "c")];
    const { undo, own, reopen } = goingBack(turns, { round: 1, at: 1 }, "1.b", place);
    expect(undo.map(t => t.key)).toEqual(["1.b", "1.c"]);
    expect(reopen).toBe(own);
    expect(reopen.cards).toEqual(["m1", "m2"]);
  });

  test("a player's turn kept before it knew its cards: it stays as it ended", () => {
    const turns = [turn(1, "a"), turn(1, "b", "pc"), turn(1, "c")];
    const { undo, reopen } = goingBack(turns, { round: 1, at: 1 }, "1.b", place);
    expect(undo.map(t => t.key)).toEqual(["1.c"]);
    expect(reopen).toBeNull();
  });

  test("on one with no turn kept (one that was down): nothing of its own", () => {
    const turns = [turn(1, "a"), turn(1, "c")];
    const { undo, own } = goingBack(turns, { round: 1, at: 1 }, "1.b", place);
    expect(undo.map(t => t.key)).toEqual(["1.c"]);
    expect(own).toBeNull();
  });
});

describe("what going back deletes", () => {
  test("a player's turn taken back whole takes its player's own cards with it; the one reopened keeps them", () => {
    const pc1 = turn(1, "b", "pc", { from: 1000, cards: ["m1", "m2"], messages: ["story1"] });
    const pc2 = turn(2, "b", "pc", { from: 2000, cards: ["m3"], messages: [] });
    const npc = turn(2, "c", "npc", { messages: ["story2"] });
    // (Rewind This Encounter: everything goes, the players' cards too.)
    expect(undoEntries([pc1, npc, pc2]).flatMap(t => t.messages)).toEqual(["story1", "m1", "m2", "story2", "m3"]);
    // (Back to 1.b, reopened: its cards stay, read again when it ends; the later player's turn goes whole.)
    const entries = undoEntries([pc1, npc, pc2], pc1);
    expect(entries[0].messages).toEqual(["story1"]);
    expect(entries[2].messages).toEqual(["m3"]);
    // (The turns themselves are left as they were.)
    expect(pc2.messages).toEqual([]);
  });
});
