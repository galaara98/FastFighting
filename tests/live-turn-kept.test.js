/**
 * What a live battle keeps of a turn whatever happens to it (foundry/live-battle.js): a summons' token found by its
 * creature, a turn FastFighting played that failed partway taken back whole, a player's turn kept as far as its
 * closing got, and the doors foes opened answering a player's move kept with that turn.
 */
import { describe, expect, test } from "vitest";
import { unitTokenId, failedTurnUndo, closedTurn, doorsWith } from "../scripts/foundry/live-battle.js";

describe("a creature's token", () => {
  test("a summons': the token made for it, not its id; one not in the fight: its id", () => {
    const run = { byId: new Map([["pc1", { id: "pc1", spec: { tokenId: "tokA" } }], ["summon1", { id: "summon1", tokenId: "tokZ", spec: {} }]]) };
    expect(unitTokenId(run, "pc1")).toBe("tokA");
    expect(unitTokenId(run, "summon1")).toBe("tokZ");
    expect(unitTokenId(run, "gone")).toBe("gone");
  });
});

describe("a turn FastFighting played that failed partway", () => {
  const stage = { records: [{ actorUuid: "Actor.a" }], messages: ["roll1"], doorsOpened: new Map([["w1", { id: "w1", uuid: "Scene.s.Wall.w1", ds: 0 }]]) };
  const startedAt = [{ uuid: "Scene.s.Token.t1", x: 0, y: 0 }];

  test("before it had a turn: what its rolls wrote and showed, its doors, everyone where they stood", () => {
    expect(failedTurnUndo(null, stage, startedAt)).toEqual({ records: stage.records, messages: ["roll1"], doors: [{ id: "w1", uuid: "Scene.s.Wall.w1", ds: 0 }], moves: startedAt });
  });

  test("once it had one: all the turn wrote and told, past its rolls'", () => {
    const turn = { records: [...stage.records, { tokenUuid: "Scene.s.Token.t1" }], messages: ["roll1", "story1"] };
    const undo = failedTurnUndo(turn, stage, startedAt);
    expect(undo.records).toHaveLength(2);
    expect(undo.messages).toEqual(["roll1", "story1"]);
    // (A copy: what's taken back isn't changed by the turn after.)
    turn.records.push({});
    expect(undo.records).toHaveLength(2);
  });
});

describe("a player's turn closed", () => {
  test("kept as far as it got: what reactions wrote, the rolls shown in it, where it began, the doors foes opened", () => {
    const pc = { combatantId: "c1", id: "pc1", round: 2, records: [{ n: 1 }], rollCards: ["r1"], messages: ["mine"], startAt: { uuid: "Scene.s.Token.t1", x: 5, y: 5 },
      doors: [{ id: "w1", uuid: "Scene.s.Wall.w1", ds: 0 }], snapshot: { units: {} }, from: 9, facts: [], applied: ["dmg"] };
    const turn = closedTurn(pc, 3);
    expect(turn).toMatchObject({ key: "2.c1", at: 3, kind: "pc", records: [{ n: 1 }], messages: ["r1"], cards: ["mine"], moves: [pc.startAt], doors: pc.doors, snapshot: pc.snapshot, applied: ["dmg"] });
    // (Its own lists: what the closing adds isn't the open turn's.)
    turn.records.push({ n: 2 });
    turn.messages.push("told");
    expect(pc.records).toHaveLength(1);
    expect(pc.rollCards).toEqual(["r1"]);
  });
});

describe("doors opened in a player's turn", () => {
  test("each once, as it was first found", () => {
    const shut = { id: "w1", uuid: "Scene.s.Wall.w1", ds: 0 };
    const locked = { id: "w2", uuid: "Scene.s.Wall.w2", ds: 2 };
    expect(doorsWith(undefined, [shut])).toEqual([shut]);
    expect(doorsWith([shut], [{ ...shut, ds: 1 }, locked])).toEqual([shut, locked]);
    expect(doorsWith([shut], new Map([["w2", locked]]).values())).toEqual([shut, locked]);
  });
});
