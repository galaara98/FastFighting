/**
 * A live battle kept a part at a time (foundry/live-keeping.js): whatever happens to it (turns played, a card added to
 * the last, runs dropped past Rewind Turn's reach, turns rewound and played again), what's read back from the store is
 * the battle as it is, and each keep writes only what's changed: never the whole fight again.
 */
import { describe, expect, test } from "vitest";
import { keepUpdate, keptBattle, KEPT_LAYOUT } from "../scripts/foundry/live-keeping.js";

const ROOT = "flags.ff";
const clone = v => JSON.parse(JSON.stringify(v));

/** Foundry's document update, as far as the store needs it: `==` replaces, `-=` deletes, paths made as they go. */
function apply(doc, update) {
  for ( const [path, value] of Object.entries(update) ) {
    const parts = path.split(".");
    const last = parts.pop();
    let at = doc;
    for ( const p of parts ) at = (at[p] ??= {});
    if ( last.startsWith("==") ) at[last.slice(2)] = clone(value);
    else if ( last.startsWith("-=") ) delete at[last.slice(2)];
    else at[last] = clone(value);
  }
}
const getter = doc => path => path.split(".").reduce((o, k) => o?.[k], doc.flags?.ff);

/** A battle being played: its data (turns kept the way live-battle.js keepTurn keeps them) and its log. */
function battle() {
  const b = { data: { id: "b1", spec: "{\"combatants\":[]}", turns: [], told: 0, snapshot: { units: {}, logLength: 0 } }, log: [], kept: null, keptSpec: null };
  b.keep = doc => {
    b.data.snapshot = { units: { n: b.log.length }, logLength: b.log.length };
    const { update, kept } = keepUpdate(b.kept, "c1", b.data, { log: b.log, pack: (from, to) => clone(b.log.slice(from, to)), root: ROOT, keptSpec: b.keptSpec });
    apply(doc, update);
    b.kept = kept;
    b.keptSpec = b.data.spec;
    return JSON.stringify(update).length;
  };
  b.turn = (n, depth = 3) => {
    for ( let i = 0; i < 4; i++ ) b.log.push({ turn: n, type: "attack", amount: i, feet: i * 10 });
    const turns = [...b.data.turns, { key: `1.${n}`, round: 1, records: [{ n }], messages: [`m${n}`], moves: [{ uuid: `t${n}`, x: n, y: 0 }], snapshot: { units: { at: n }, logLength: b.log.length - 4 } }];
    for ( const t of turns.slice(0, -depth) ) delete t.snapshot;
    b.data.turns = turns;
  };
  b.rewind = () => {
    const last = b.data.turns.at(-1);
    b.log = b.log.slice(0, last.snapshot.logLength);
    b.data.turns = b.data.turns.slice(0, -1);
  };
  return b;
}

/** What the store has of the battle, against the battle as it is. */
function matches(doc, b) {
  const back = keptBattle(getter(doc), "c1");
  expect(back.layout).toBe(KEPT_LAYOUT);
  expect(back.turns).toEqual(clone(b.data.turns));
  expect(back.log).toEqual(clone(b.log));
  expect(back.spec).toBe(b.data.spec);
  expect(back.snapshot).toEqual(b.data.snapshot);
}

describe("a live battle kept a part at a time", () => {
  test("turns played, a card added to the last, runs dropped past reach, rewound and played again: read back as it is", () => {
    // (Left on the store by an earlier battle on the same combat: replaced by this one's first keep.)
    const doc = { flags: { ff: { turns: { c1: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i, { key: `old${i}` }])) }, logs: { c1: { 0: { from: 0, entries: [{ old: true }] }, 7: { from: 99, entries: [] } } } } } };
    const b = battle();
    b.keep(doc);
    matches(doc, b);
    for ( let n = 1; n <= 8; n++ ) {
      b.turn(n);
      b.keep(doc);
      matches(doc, b);
    }
    // (A card told after the turn: the last turn written again, nothing else.)
    b.data.turns.at(-1).messages.push("late");
    b.keep(doc);
    matches(doc, b);
    // (Two turns rewound, one played again; then three more.)
    b.rewind();
    b.rewind();
    b.keep(doc);
    matches(doc, b);
    b.turn(9);
    b.keep(doc);
    matches(doc, b);
    b.rewind();
    b.turn(10);
    b.keep(doc);
    matches(doc, b);
    for ( let n = 11; n <= 13; n++ ) {
      b.turn(n);
      b.keep(doc);
      matches(doc, b);
    }
    // (Only the last turns have their runs: the rest dropped from the store.)
    expect(Object.keys(doc.flags.ff.snaps.c1).map(Number).sort((x, y) => x - y)).toEqual([b.data.turns.length - 3, b.data.turns.length - 2, b.data.turns.length - 1]);
  });

  test("each keep writes what's new, about the same however long the fight has gone on", () => {
    const doc = { flags: {} };
    const b = battle();
    b.keep(doc);
    const sizes = [];
    for ( let n = 1; n <= 60; n++ ) {
      b.turn(n);
      sizes.push(b.keep(doc));
    }
    matches(doc, b);
    expect(sizes.at(-1)).toBeLessThan(sizes[5] * 1.5);
    // (The spec written once, until it changes.)
    b.data.spec = "{\"combatants\":[1]}";
    b.turn(61);
    b.keep(doc);
    matches(doc, b);
  });

  test("a battle kept the old way (its turns and its log in its own key): read as it was kept", () => {
    const doc = { flags: { ff: { battles: { c1: { id: "b1", turns: [{ key: "1.a", snapshot: { units: {} } }], snapshot: { units: {}, log: [{ turn: 1 }] } } }, specs: { c1: "{}" } } } };
    const back = keptBattle(getter(doc), "c1");
    expect(back.turns).toEqual([{ key: "1.a", snapshot: { units: {} } }]);
    expect(back.snapshot.log).toEqual([{ turn: 1 }]);
    expect(back.log).toBeUndefined();
    expect(back.spec).toBe("{}");
  });
});
