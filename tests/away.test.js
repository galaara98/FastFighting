/**
 * Players who leave a live battle and come back (foundry/away.js): a countdown for each character left with none of
 * its players connected, FastFighting playing it once that runs out; a player back stops theirs at once, and once
 * they've stayed BACK_AFTER_MS, every character of theirs FastFighting plays is handed back. The setting off, no
 * countdowns. A player not connected as the battle begins counts as gone since then.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BACK_AFTER_MS, awayTimers, stillAway, dueTimers, handBack, clockText, deadlineClocks, joinWaits } from "../scripts/foundry/away.js";

const NOW = Date.UTC(2026, 9, 19, 20);
const MS = 120 * 1000;

/**
 * Ann plays Harsk and his wolf (summoned: its summoner's player owns it too); Ann and Bo share Kyra; Cy plays Seelah;
 * nobody plays the goblin.
 */
const UNITS = [
  { id: "harsk", owners: ["ann"] },
  { id: "wolf", owners: ["ann"] },
  { id: "kyra", owners: ["ann", "bo"] },
  { id: "seelah", owners: ["cy"] },
  { id: "goblin", owners: [] }
];
const PCS = ["harsk", "wolf", "kyra", "seelah"];
const set = (...xs) => new Set(xs);

describe("a player leaves", () => {
  test("a countdown for each of their characters with none of its players left, the setting's length", () => {
    const timers = awayTimers({ units: UNITS, connected: set("bo", "cy"), players: set(...PCS), user: "ann", from: NOW, ms: MS });
    // (Kyra still has Bo; Seelah isn't Ann's.)
    expect(timers).toEqual({ harsk: NOW + MS, wolf: NOW + MS });
  });

  test("the last of a shared character's players leaving starts its countdown; a running one keeps its deadline", () => {
    const first = awayTimers({ units: UNITS, connected: set("bo", "cy"), players: set(...PCS), user: "ann", from: NOW, ms: MS });
    const later = awayTimers({ units: UNITS, connected: set("cy"), players: set(...PCS), timers: first, user: "bo", from: NOW + 5000, ms: MS });
    expect(later).toEqual({ harsk: NOW + MS, wolf: NOW + MS, kyra: NOW + 5000 + MS });
  });

  test("none for a character FastFighting plays already (a GM's tick, or the players not running theirs)", () => {
    const timers = awayTimers({ units: UNITS, connected: set(), players: set("kyra", "seelah"), user: "ann", from: NOW, ms: MS });
    expect(timers).toEqual({ kyra: NOW + MS });
  });

  test("the setting off: no countdowns, and those running stop", () => {
    expect(awayTimers({ units: UNITS, connected: set(), players: set(...PCS), user: "ann", from: NOW, ms: MS, on: false })).toEqual({});
    expect(awayTimers({ units: UNITS, connected: set(), players: set(...PCS), timers: { seelah: NOW }, user: "ann", from: NOW, ms: MS, on: false })).toEqual({});
  });
});

describe("as the battle begins", () => {
  test("a player who was never connected: their characters' countdowns run from the battle's start", () => {
    const began = NOW - 30000;
    const timers = awayTimers({ units: UNITS, connected: set("ann"), players: set(...PCS), from: began, ms: MS });
    expect(timers).toEqual({ seelah: began + MS });
    // (Already over by the time it's looked at: it runs out at once.)
    expect(dueTimers({ units: UNITS, connected: set("ann"), players: set(...PCS), timers, now: began + MS }).automate).toEqual(["seelah"]);
  });
});

describe("a player comes back", () => {
  const timers = { harsk: NOW + MS, wolf: NOW + MS, kyra: NOW + MS, seelah: NOW + MS };

  test("their characters' countdowns stop at once", () => {
    expect(stillAway({ units: UNITS, connected: set("ann"), timers })).toEqual({ seelah: NOW + MS });
    expect(stillAway({ units: UNITS, connected: set("bo"), timers })).toEqual({ harsk: NOW + MS, wolf: NOW + MS, seelah: NOW + MS });
  });

  test("handed back: every character of theirs FastFighting plays, whoever had it ticked, and not another's", () => {
    // (Harsk taken over when his time ran out; Kyra ticked by a GM; Seelah, Cy's, ticked too.)
    expect(handBack({ units: UNITS, players: set("wolf"), user: "ann" })).toEqual(["harsk", "kyra"]);
    expect(handBack({ units: UNITS, players: set(...PCS), user: "ann" })).toEqual([]);
  });
});

describe("a countdown runs out", () => {
  test("FastFighting plays the character: still none of its players back; the rest keep running", () => {
    const timers = { harsk: NOW, wolf: NOW - 1, kyra: NOW + 1000 };
    expect(dueTimers({ units: UNITS, connected: set(), players: set(...PCS), timers, now: NOW })).toEqual({ automate: ["harsk", "wolf"], timers: { kyra: NOW + 1000 } });
  });

  test("one whose player is back, or that FastFighting plays already, only stops", () => {
    const timers = { harsk: NOW, seelah: NOW };
    expect(dueTimers({ units: UNITS, connected: set("ann"), players: set("harsk"), timers, now: NOW })).toEqual({ automate: [], timers: {} });
  });
});

describe("the clocks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  test("one timeout for each deadline, run out in turn; a countdown stopped never runs out", () => {
    const due = [];
    const clocks = deadlineClocks({ due: id => due.push(id) });
    clocks.arm({ harsk: NOW + MS, kyra: NOW + 2 * MS, seelah: NOW + MS });
    expect(clocks.size).toBe(3);
    clocks.arm({ harsk: NOW + MS, kyra: NOW + 2 * MS });
    vi.advanceTimersByTime(MS);
    expect(due).toEqual(["harsk"]);
    vi.advanceTimersByTime(MS);
    expect(due).toEqual(["harsk", "kyra"]);
    expect(clocks.size).toBe(0);
  });

  test("a deadline already past runs out at once; clear stops them all", () => {
    const due = [];
    const clocks = deadlineClocks({ due: id => due.push(id) });
    clocks.arm({ harsk: NOW - 1000, kyra: NOW + MS });
    vi.advanceTimersByTime(0);
    expect(due).toEqual(["harsk"]);
    clocks.clear();
    vi.advanceTimersByTime(MS);
    expect(due).toEqual(["harsk"]);
  });

  test("joined and still here 12 seconds later: handed back", () => {
    const settled = [];
    const joins = joinWaits({ settled: user => settled.push(user) });
    expect(BACK_AFTER_MS).toBe(12000);
    joins.joined("ann");
    vi.advanceTimersByTime(BACK_AFTER_MS - 1);
    expect(settled).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(settled).toEqual(["ann"]);
    expect(joins.waiting("ann")).toBe(false);
  });

  test("the whole way: Ann leaves, her time runs out, FastFighting plays hers; she's back 12 seconds, they're hers again", () => {
    let players = set(...PCS);
    let connected = set("bo", "cy");
    let timers = awayTimers({ units: UNITS, connected, players, user: "ann", from: Date.now(), ms: MS });
    const clocks = deadlineClocks({
      due: () => {
        const out = dueTimers({ units: UNITS, connected, players, timers, now: Date.now() });
        timers = out.timers;
        players = new Set([...players].filter(id => !out.automate.includes(id)));
      }
    });
    clocks.arm(timers);
    vi.advanceTimersByTime(MS);
    expect([...players]).toEqual(["kyra", "seelah"]);
    expect(timers).toEqual({});
    // (A GM ticks Kyra too, Bo or no Bo.)
    players.delete("kyra");
    const joins = joinWaits({ settled: user => { for ( const id of handBack({ units: UNITS, players, user }) ) players.add(id); } });
    connected = set("ann", "bo", "cy");
    joins.joined("ann");
    vi.advanceTimersByTime(BACK_AFTER_MS);
    expect([...players].sort()).toEqual(["harsk", "kyra", "seelah", "wolf"]);
  });

  test("gone again within the 12 seconds: nothing handed back; joining again starts the wait over", () => {
    const settled = [];
    const joins = joinWaits({ settled: user => settled.push(user) });
    joins.joined("ann");
    vi.advanceTimersByTime(8000);
    joins.left("ann");
    vi.advanceTimersByTime(BACK_AFTER_MS);
    expect(settled).toEqual([]);
    joins.joined("ann");
    vi.advanceTimersByTime(8000);
    joins.joined("ann");
    vi.advanceTimersByTime(8000);
    expect(settled).toEqual([]);
    vi.advanceTimersByTime(4000);
    expect(settled).toEqual(["ann"]);
  });
});

test("the time left, as a clock", () => {
  expect(clockText(120000)).toBe("2:00");
  expect(clockText(65000)).toBe("1:05");
  expect(clockText(4001)).toBe("0:05");
  expect(clockText(0)).toBe("0:00");
  expect(clockText(-5)).toBe("0:00");
});
