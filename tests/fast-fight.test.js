/**
 * Fast Fight (foundry/fast-fight.js, played by foundry/live-battle.js): offered where FastFighting plays every token;
 * the turns go on one after another with no GMs' card, each still kept for Rewind; it stops for the end, a player's
 * character, a GM wanted, the tracker, Stop, an error or a whole round with nothing changing; Dice So Nice's 3D dice are off while
 * it runs and as they were once it stops, however it stops, with nothing kept that a reload would have to put back.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  FAST_MOVE_SPEED, FAST_STOP_NOTES, QUIET_FLAGS, fastFightOffered, fastFightStop, fastTurnChange, fightMoment, stillSince, STILL_ROUNDS, STILL_AGAIN, hushDice, unhushDice, diceHushed, registerQuietDice
} from "../scripts/foundry/fast-fight.js";
import { afterTurn, keptTurns, goingBack } from "../scripts/foundry/live-battle.js";

describe("when the Battle Vantage offers it", () => {
  const begun = { started: true, ended: false, prepared: false };

  test("a battle begun where the players run no character, or don't run their characters at all", () => {
    expect(fastFightOffered({ ...begun, playersRun: true, players: [] })).toBe(true);
    expect(fastFightOffered({ ...begun, playersRun: false, players: [] })).toBe(true);
    // (Players run their characters off: FastFighting plays everyone, whatever the list says.)
    expect(fastFightOffered({ ...begun, playersRun: false, players: ["valeros"] })).toBe(true);
  });

  test("not while a player runs a character", () => {
    expect(fastFightOffered({ ...begun, playersRun: true, players: ["valeros"] })).toBe(false);
  });

  test("not before the encounter begins, nor once the battle is over", () => {
    expect(fastFightOffered({ ...begun, started: false, players: [] })).toBe(false);
    expect(fastFightOffered({ ...begun, prepared: true, players: [] })).toBe(false);
    expect(fastFightOffered({ ...begun, ended: true, players: [] })).toBe(false);
  });

  test("while it runs, always: it's the Stop", () => {
    expect(fastFightOffered({ running: true, ...begun, players: ["valeros"] })).toBe(true);
  });
});

describe("when it stops", () => {
  test("goes on while nothing says otherwise", () => {
    expect(fastFightStop({})).toBeNull();
    expect(fastFightStop({ players: ["wolf"], had: ["wolf"], change: "ours" })).toBeNull();
    expect(fastFightStop({ change: "same" })).toBeNull();
  });

  test("the battle over", () => {
    expect(fastFightStop({ ended: true })).toBe("ended");
  });

  test("a player's character to act: its turn, or one handed back to its player (the list gains one)", () => {
    expect(fastFightStop({ playerTurn: true })).toBe("player");
    expect(fastFightStop({ players: ["valeros"], had: [] })).toBe("player");
    // (One FastFighting now plays, taken off the list: it goes on.)
    expect(fastFightStop({ players: [], had: ["valeros"] })).toBeNull();
  });

  test("a GM wanted: a roll they settle, a question, a reaction's damage, a player's reaction, the spotlight", () => {
    for ( const asks of ["roll", "question", "damage", "player", "review", "spotlight"] ) expect(fastFightStop({ asks })).toBe("gm");
  });

  test("the tracker used, Stop pressed, something gone wrong", () => {
    expect(fastFightStop({ change: "theirs" })).toBe("tracker");
    expect(fastFightStop({ pressed: true })).toBe("pressed");
    expect(fastFightStop({ failed: true })).toBe("error");
  });

  test("two whole rounds with nothing changing: the GM asked whether it goes on (not a stop of its own)", () => {
    expect(STILL_ROUNDS).toBe(2);
    const wolf = { id: "wolf", hp: 12, status: "standing" };
    const at = fightMoment([wolf, { id: "kyra", hp: 20, status: "standing" }]);
    expect(fightMoment([{ ...wolf, hp: 11.6 }, { id: "kyra", hp: 20, status: "standing" }])).toBe(at);
    expect(fightMoment([{ ...wolf, hp: 9 }, { id: "kyra", hp: 20, status: "standing" }])).not.toBe(at);
    expect(fightMoment([wolf, { id: "kyra", hp: 20, status: "standing", swayOutcome: "neutral" }])).not.toBe(at);
    // (Last changed on the wolf's turn in round 3: still when the wolf's turn comes twice more, or three rounds on.)
    const since = { round: 3, id: "wolf" };
    expect(stillSince(since, 4, "wolf")).toBe(false);
    expect(stillSince(since, 5, "kyra")).toBe(false);
    expect(stillSince(since, 5, "wolf")).toBe(true);
    expect(stillSince(since, 6, "kyra")).toBe(true);
    expect(stillSince(null, 9, "wolf")).toBe(false);
    // (Never before the fight has played the system's fewest Max rounds, 6 in PF2e; past them, at once.)
    expect(stillSince(since, 6, "kyra", 6)).toBe(false);
    expect(stillSince(since, 7, "kyra", 6)).toBe(true);
    // (The GM said to go on, on the wolf's turn in round 7: not asked again for four more rounds.)
    expect(STILL_AGAIN).toBe(4);
    const after = { round: 7, id: "wolf" };
    const least = 7 - 1 + STILL_AGAIN;
    expect(stillSince(after, 9, "wolf", least)).toBe(false);
    expect(stillSince(after, 10, "kyra", least)).toBe(false);
    expect(stillSince(after, 11, "wolf", least)).toBe(true);
  });

  test("the first that holds is why; the GMs are told only what they didn't do themselves", () => {
    expect(fastFightStop({ pressed: true, ended: true, asks: "roll" })).toBe("pressed");
    expect(fastFightStop({ ended: true, playerTurn: true })).toBe("ended");
    expect(fastFightStop({ playerTurn: true, asks: "question" })).toBe("player");
    expect(FAST_STOP_NOTES).toEqual(["tracker", "player", "gm"]);
    expect(FAST_STOP_NOTES).not.toContain("pressed");
    expect(FAST_STOP_NOTES).not.toContain("ended");
  });
});

describe("its own moves on the tracker, and the GM's", () => {
  const at = (round, turn, combatantId) => ({ round, turn, combatantId });

  test("the move on it made itself, from where it was", () => {
    expect(fastTurnChange(at(2, 1, "b"), at(2, 1, "b"), at(2, 2, "c"))).toBe("ours");
    // (Over the round's end.)
    expect(fastTurnChange(at(2, 3, "d"), at(2, 3, "d"), at(3, 0, "a"))).toBe("ours");
  });

  test("the tracker moved with none of its own on the way, or from somewhere else: the GM's", () => {
    expect(fastTurnChange(null, at(2, 1, "b"), at(2, 2, "c"))).toBe("theirs");
    // (Previous Turn, while its own move waits.)
    expect(fastTurnChange(at(2, 2, "c"), at(2, 1, "b"), at(2, 0, "a"))).toBe("theirs");
  });

  test("the order changed in the same round (one joined, or left the tracker): nobody moved it", () => {
    // (The same combatant at another place: one before it left.)
    expect(fastTurnChange(null, at(2, 2, "c"), at(2, 1, "c"))).toBe("same");
    expect(fastTurnChange(at(2, 1, "b"), at(2, 3, "c"), at(2, 2, "c"))).toBe("same");
    // (Another at the same place: a bystander who noticed the fight rolled higher initiative.)
    expect(fastTurnChange(null, at(3, 0, "a"), at(3, 0, "z"))).toBe("same");
  });

  test("a spotlight handed back, then given again: both its own", () => {
    const nobody = at(4, null, null);
    expect(fastTurnChange(at(4, 0, "a"), at(4, 0, "a"), nobody)).toBe("ours");
    expect(fastTurnChange(nobody, nobody, at(4, 0, "a"))).toBe("ours");
  });
});

describe("after a turn: no card, still kept for Rewind", () => {
  const turn = (key, extra = {}) => ({ key, round: 1, combatantId: key, kind: "npc", records: [], messages: [`${key}-story`], snapshot: { of: key }, ...extra });

  test("a turn FastFighting played in a Fast Fight: on at once, no GMs' card", () => {
    expect(afterTurn({ kind: "npc", fast: true })).toBe("on");
    // (As with Play to the end; without either, the card and the wait.)
    expect(afterTurn({ kind: "npc", auto: true })).toBe("on");
    expect(afterTurn({ kind: "npc" })).toBe("card");
  });

  test("stopped, the card again; a player's turn waits as ever; the battle over, its end", () => {
    expect(afterTurn({ kind: "npc", fast: false })).toBe("card");
    expect(afterTurn({ kind: "pc", fast: true })).toBe("wait");
    expect(afterTurn({ kind: "npc", fast: true, ended: true })).toBe("end");
  });

  test("each turn kept as any other, snapshot and all, so Rewind takes them back one by one", () => {
    let turns = [];
    for ( const key of ["a", "b", "c"] ) turns = keptTurns(turns, turn(key), 12);
    expect(turns.map(t => t.key)).toEqual(["a", "b", "c"]);
    expect(turns.every(t => t.snapshot)).toBe(true);
    // (No card among a turn's messages: only what the turn itself told.)
    expect(turns.flatMap(t => t.messages)).toEqual(["a-story", "b-story", "c-story"]);
    // (Rewind from c's turn to b's: c taken back, b stands as it ended.)
    const order = ["a", "b", "c"];
    const { undo, own } = goingBack(turns, { round: 1, at: 1 }, "b", t => ({ round: t.round, at: order.indexOf(t.combatantId) }));
    expect(undo.map(t => t.key)).toEqual(["c"]);
    expect(own.key).toBe("b");
  });

  test("past the rewind depth, the oldest keep what they did, not the fight as it was", () => {
    let turns = [];
    for ( let i = 0; i < 5; i++ ) turns = keptTurns(turns, turn(`t${i}`), 3);
    expect(turns.map(t => !!t.snapshot)).toEqual([false, false, true, true, true]);
    expect(turns).toHaveLength(5);
  });
});

describe("the moves on the map", () => {
  test("still walked, only quicker than a turn's usual 10 squares a second", () => {
    expect(FAST_MOVE_SPEED).toBeGreaterThan(10);
  });
});

describe("Dice So Nice", () => {
  let hooks;
  const fire = (name, ...args) => (hooks[name] ?? []).forEach(fn => fn(...args));
  beforeEach(() => {
    hooks = {};
    globalThis.Hooks = { on: (name, fn) => (hooks[name] ??= []).push(fn), callAll: vi.fn() };
    globalThis.game.user = { id: "gm" };
    globalThis.game.modules = new Map([["dice-so-nice", { active: true }]]);
    globalThis.game.settings = { set: vi.fn(), get: vi.fn() };
  });
  afterEach(() => {
    unhushDice();
    delete globalThis.Hooks;
  });

  test("its 3D dice off while a Fast Fight runs, and as they were once it stops", () => {
    const dice3d = { messageHookDisabled: false };
    hushDice(dice3d);
    expect(diceHushed()).toBe(true);
    expect(dice3d.messageHookDisabled).toBe(true);
    unhushDice();
    expect(diceHushed()).toBe(false);
    expect(dice3d.messageHookDisabled).toBe(false);
  });

  test("off already (another module's doing): left off", () => {
    const dice3d = { messageHookDisabled: true };
    hushDice(dice3d);
    unhushDice();
    expect(dice3d.messageHookDisabled).toBe(true);
  });

  test("stopped twice (an error, then the battle let go): put back once, as it was", () => {
    const dice3d = { messageHookDisabled: false };
    hushDice(dice3d);
    // (Pressed again meanwhile: what it was before stays what's put back.)
    hushDice(dice3d);
    unhushDice();
    dice3d.messageHookDisabled = true;
    unhushDice();
    expect(dice3d.messageHookDisabled).toBe(true);
  });

  test("no setting written: a reload has Dice So Nice as it was, nothing to put back", () => {
    const dice3d = { messageHookDisabled: false };
    hushDice(dice3d);
    expect(game.settings.set).not.toHaveBeenCalled();
    unhushDice();
  });

  test("without Dice So Nice, nothing breaks", () => {
    expect(() => hushDice(null)).not.toThrow();
    expect(() => unhushDice()).not.toThrow();
  });

  test("each card made while it runs skips the 3D dice on every client; none after", () => {
    registerQuietDice();
    const message = { updateSource: vi.fn() };
    const options = {};
    hushDice({ messageHookDisabled: false });
    fire("preCreateChatMessage", message, {}, options, "gm");
    expect(message.updateSource).toHaveBeenCalledWith(QUIET_FLAGS);
    expect(QUIET_FLAGS).toEqual({ "flags.dice-so-nice.skip": true });
    unhushDice();
    const later = { updateSource: vi.fn() };
    fire("preCreateChatMessage", later, {}, {}, "gm");
    expect(later.updateSource).not.toHaveBeenCalled();
  });

  test("a roll made while it runs: whoever waits on Dice So Nice here is told its dice are done", () => {
    registerQuietDice();
    const options = {};
    hushDice({ messageHookDisabled: false });
    fire("preCreateChatMessage", { updateSource: () => {} }, {}, options, "gm");
    unhushDice();
    // (Made just before it stopped, arriving after: still told.)
    fire("createChatMessage", { id: "m1", isRoll: true }, options, "gm");
    expect(Hooks.callAll).toHaveBeenCalledWith("diceSoNiceRollComplete", "m1", []);
  });

  test("not for words alone, another user's card, a card made outside it, or without Dice So Nice", () => {
    registerQuietDice();
    const options = {};
    hushDice({ messageHookDisabled: false });
    fire("preCreateChatMessage", { updateSource: () => {} }, {}, options, "gm");
    fire("createChatMessage", { id: "words", isRoll: false }, options, "gm");
    fire("createChatMessage", { id: "theirs", isRoll: true }, options, "player");
    fire("createChatMessage", { id: "outside", isRoll: true }, {}, "gm");
    game.modules = new Map();
    fire("createChatMessage", { id: "noDsn", isRoll: true }, options, "gm");
    expect(Hooks.callAll).not.toHaveBeenCalled();
  });
});
