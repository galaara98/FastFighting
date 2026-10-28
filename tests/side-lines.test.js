/**
 * The lines a system posts by itself as FastFighting writes a sheet (foundry/side-lines.js: foundry-ironsworn's change
 * log): marked as the battle's while a turn is written, so a Rewind takes them; not made at all while a Rewind takes
 * FastFighting's writes back. Only this browser's, without dice, not FastFighting's own, speaking for a creature in the
 * battle.
 */
import { describe, expect, test } from "vitest";
import { sideLine } from "../scripts/foundry/side-lines.js";
import { MODULE_ID } from "../scripts/constants.js";

const actors = new Set(["kara", "brand"]);
const writing = { actors, drop: false };
const rewinding = { actors, drop: true };
const line = (over = {}) => ({ rolls: [], flags: {}, speaker: { actor: "kara" }, ...over });

describe("a system's own line about FastFighting's write", () => {
  test("written in a turn: the battle's; taken back by a Rewind: not made", () => {
    expect(sideLine(line(), writing, true)).toBe("mark");
    expect(sideLine(line({ speaker: { actor: "brand", token: "t1" } }), rewinding, true)).toBe("drop");
  });

  test("nothing else: outside a write, another user's, a card with dice, FastFighting's own, or for someone not in the battle", () => {
    expect(sideLine(line(), null, true)).toBeNull();
    expect(sideLine(line(), writing, false)).toBeNull();
    expect(sideLine(line({ rolls: [{ formula: "1d6" }] }), rewinding, true)).toBeNull();
    expect(sideLine(line({ flags: { [MODULE_ID]: { story: true } } }), rewinding, true)).toBeNull();
    expect(sideLine(line({ speaker: { actor: "stranger" } }), rewinding, true)).toBeNull();
    expect(sideLine(line({ speaker: { alias: "Gamemaster" } }), rewinding, true)).toBeNull();
  });
});

describe("a line typed in the chat while FastFighting writes", () => {
  test("marked as typed: never a side line, in character or not; outside a write, left as it is", async () => {
    const { typedLine } = await import("../scripts/foundry/side-lines.js");
    const typed = typedLine({ speaker: { actor: "kara" }, user: "gm" }, rewinding);
    expect(typed.flags[MODULE_ID].typed).toBe(true);
    expect(sideLine({ ...line(), flags: typed.flags }, rewinding, true)).toBeNull();
    expect(sideLine({ ...line(), flags: typed.flags }, writing, true)).toBeNull();
    expect(typedLine({ speaker: { actor: "kara" } }, null)).toEqual({ speaker: { actor: "kara" } });
    expect(typedLine({ flags: { other: { x: 1 } } }, writing).flags).toEqual({ other: { x: 1 }, [MODULE_ID]: { typed: true } });
  });
});

describe("what a system tells of a turn's start as FastFighting moves the tracker (PF2e's Current Conditions)", () => {
  test("the move's scope while it moves and until it settles; a write's first; then none", async () => {
    const { scopeAt } = await import("../scripts/foundry/side-lines.js");
    const move = { actors, drop: false, open: 1, until: 0 };
    expect(scopeAt(null, move, 5000)).toBe(move);
    const settled = { ...move, open: 0, until: 4000 };
    expect(scopeAt(null, settled, 4000)).toBe(settled);
    expect(scopeAt(null, settled, 4001)).toBeNull();
    expect(scopeAt(writing, move, 5000)).toBe(writing);
    expect(scopeAt(null, null, 5000)).toBeNull();
    const { startLine } = await import("../scripts/foundry/side-lines.js");
    // (The turn it tells of the start of, with the move's number; none once FastFighting plays that turn: its own card.)
    expect(startLine({ round: 2, combatantId: "c1" }, { ...move, seq: 7, playing: null })).toEqual({ round: 2, combatantId: "c1", move: 7 });
    expect(startLine({ round: 2, combatantId: "c1" }, { ...move, seq: 7, playing: "c1" })).toBeNull();
    expect(startLine({ round: 2, combatantId: "c1" }, { ...move, seq: 7, playing: "c2" })).toEqual({ round: 2, combatantId: "c1", move: 7 });
    expect(startLine(null, { ...move, seq: 7 })).toBeNull();
    expect(sideLine(line(), scopeAt(null, move, 5000), true)).toBe("mark");
  });

  test("a line the GM types meanwhile is theirs, never the battle's", async () => {
    const { scopeAt, typedLine } = await import("../scripts/foundry/side-lines.js");
    const move = { actors, drop: false, open: 0, until: 4000 };
    const typed = typedLine({ speaker: { actor: "kara" } }, scopeAt(null, move, 3000));
    expect(sideLine({ ...line(), flags: typed.flags }, move, true)).toBeNull();
  });

  test("Rewind takes those of turns after the one it goes back to; that one keeps its own", async () => {
    const { startedAfter } = await import("../scripts/foundry/side-lines.js");
    const at = id => ["a", "b", "c"].indexOf(id);
    const card = (id, round, combatantId, battle = "b1") => ({ id, flags: { [MODULE_ID]: { live: { battle, line: id, start: { round, combatantId } } } } });
    const messages = [
      card("1a", 1, "a"), card("1b", 1, "b"), card("1c", 1, "c"), card("2a", 2, "a"), card("other", 1, "c", "b2"), card("gone", 1, "x"),
      { id: "typed", flags: { [MODULE_ID]: { typed: true } } },
      { id: "side", flags: { [MODULE_ID]: { live: { battle: "b1", line: "s" } } } }
    ];
    const ids = now => startedAfter(messages, "b1", now, at).map(m => m.id);
    expect(ids({ round: 1, at: 1 })).toEqual(["1c", "2a"]);
    expect(ids({ round: 2, at: 0 })).toEqual([]);
    expect(ids({ round: 1, at: -1 })).toEqual(["1a", "1b", "1c", "2a"]);
  });

  test("told of a turn again (a Rewind went back to it): the new one takes the place of the battle's older ones for it, not of those of its own move", async () => {
    const { startedBefore } = await import("../scripts/foundry/side-lines.js");
    const card = (id, round, combatantId, move, battle = "b1") => ({ id, flags: { [MODULE_ID]: { live: { battle, line: id, start: { round, combatantId, move } } } } });
    const old = card("old", 1, "a", 1);
    const again = card("again", 1, "a", 3);
    const messages = [old, card("same-move", 1, "a", 3), card("next", 1, "b", 2), card("later", 2, "a", 2), card("other", 1, "a", 1, "b2"), again];
    expect(startedBefore(messages, again).map(m => m.id)).toEqual(["old"]);
    expect(startedBefore(messages, { id: "plain", flags: { [MODULE_ID]: { live: { battle: "b1", line: "s" } } } })).toEqual([]);
    expect(startedBefore(messages, { id: "theirs", flags: {} })).toEqual([]);
  });
});
