/**
 * A turn told as things done (story/story.js): it opens on its own creature, never on the one it's done to ("The
 * cutthroat listens ..." needs whoever it listens to first); and each thing it does is a paragraph of its own, what
 * comes of it with it.
 */
import { describe, expect, test } from "vitest";
import { storyBeats, thingsDone } from "../scripts/story/story.js";
import { storyTables } from "./foundry-i18n.js";
import { creature, battle } from "./helpers.js";

const english = storyTables();
const at = (x, y) => ({ x, y, size: 5 });
const spec = battle([
  creature({ id: "jirelle", name: "Jirelle", kind: "pc", position: at(0, 0) }),
  creature({ id: "a", name: "Cutthroat", side: "hostile", position: at(10, 0) }),
  creature({ id: "b", name: "Brute", side: "hostile", position: at(30, 0) })
], { positioning: true });
spec.approach = null;
const by = (actor, actorId, data) => ({ round: 1, turn: 1, turnOf: "jirelle", actor, actorId, side: actorId === "jirelle" ? "friendly" : "hostile", ...data });
// (Jirelle's turn, as it was played: a request the cutthroat gives in to, a door, a Demoralize and its threat.)
const log = [
  by("Jirelle", "jirelle", { type: "talk", kind: "persuade", target: "Cutthroat", targetId: "a", degree: 3, margin: 13, progress: 2, steps: 2 }),
  by("Cutthroat", "a", { type: "sway", outcome: "surrendered", by: "Jirelle", byId: "jirelle" }),
  by("Jirelle", "jirelle", { type: "door", method: "open", success: true, doorId: "d1", target: "Brute", targetId: "b" }),
  by("Jirelle", "jirelle", { type: "control", maneuver: "demoralize", action: "Demoralize", target: "Brute", targetId: "b", roll: "check", degree: 1, margin: -6, conditions: [] }),
  by("Jirelle", "jirelle", { type: "talk", kind: "intimidate", target: "Brute", targetId: "b", degree: 1, margin: -6, progress: 0, steps: 2 })
];
const units = { jirelle: { final: { status: "standing" } }, a: { final: { status: "surrendered" } }, b: { final: { status: "standing" } } };

describe("a turn told", () => {
  test("it opens on its own creature, not on the one it's done to", () => {
    const listens = "{target} listens, nodding slowly, as {actor} lays out an unanswerable case.";
    const own = { "talk.persuade.criticalSuccess": [listens], "talk.persuade.opening": ["{actor} speaks to {target}."] };
    const tables = { get: k => own[k] ?? english[k] };
    const beat = storyBeats({ log, units }, spec, "roleplay", { tables, seed: 1 }).find(b => b.actorId === "jirelle");
    expect(beat.text.startsWith("Jirelle speaks to")).toBe(true);
    expect(beat.text).toContain("Cutthroat listens");
    // (Opening on its own creature already: no opener.)
    const plain = { get: k => (k === "talk.persuade.criticalSuccess" ? ["{actor} reasons with {target}."] : own[k] ?? english[k]) };
    const told = storyBeats({ log, units }, spec, "roleplay", { tables: plain, seed: 1 }).find(b => b.actorId === "jirelle");
    expect(told.text).not.toContain("speaks to");
  });

  test("each thing it does, a paragraph: the request and its answer, the door, the Demoralize and its threat", () => {
    const groups = thingsDone(log.map((e, i) => ({ text: String(i), e })), "jirelle");
    expect(groups.map(g => g.map(x => x.text))).toEqual([["0", "1"], ["2"], ["3", "4"]]);
    const beat = storyBeats({ log, units }, spec, "roleplay", { tables: { get: k => english[k] }, seed: 1 }).find(b => b.actorId === "jirelle");
    expect((beat.html.match(/<p>/g) ?? []).length).toBeGreaterThan(1);
  });

  test("its thoughts go with what follows; a move toward its foe, with the blow", () => {
    const parts = [
      { text: "t", e: by("Jirelle", "jirelle", { type: "thought" }) },
      { text: "m", e: by("Jirelle", "jirelle", { type: "move", towardId: "b" }) },
      { text: "s", e: by("Jirelle", "jirelle", { type: "attack", targetId: "b" }) }
    ];
    expect(thingsDone(parts, "jirelle").map(g => g.map(x => x.text))).toEqual([["t", "m", "s"]]);
    // (A reload between two shots at the same foe: one thing.)
    const shots = [
      { text: "1", e: by("Jirelle", "jirelle", { type: "attack", targetId: "b" }) },
      { text: "r", e: by("Jirelle", "jirelle", { type: "reload" }) },
      { text: "2", e: by("Jirelle", "jirelle", { type: "attack", targetId: "b" }) }
    ];
    expect(thingsDone(shots, "jirelle").map(g => g.map(x => x.text))).toEqual([["1", "r", "2"]]);
  });
});
