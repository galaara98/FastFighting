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
