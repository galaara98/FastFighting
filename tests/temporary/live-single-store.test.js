/**
 * Temporary: live battles were kept in one single journal (the hidden liveStore setting named it) in 0.3.0 and 0.4.0,
 * before each battle had a transcript of its own. The active GM's next login moves each battle on it out and deletes
 * it. These tests keep that move working for the releases that carry it, and fail once the core reaches REMOVE_AT, so
 * it doesn't live on unnoticed. Then remove:
 *  - the setting (settings.js liveStore),
 *  - the move (foundry/live-journals.js oldStore, moveOldStore and their calls: journalFacts, dropTranscripts,
 *    tidyOnLogin; live-store.js moveOut, and kindOf's "store" and "leftover", with whatever reads them: combatIdsOf,
 *    whatGoes, the export's kinds, apps/live-data.js whyOf, CODING_README's Live battles' journals),
 *  - the read from it (foundry/live-battle.js kept's fallback),
 *  - the old store's cases in tests/live-store.test.js, and this file.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { kindOf, moveOut } from "../../scripts/foundry/live-store.js";
import { KEPT_PARTS } from "../../scripts/foundry/live-keeping.js";
import { moveOldStore, oldStore } from "../../scripts/foundry/live-journals.js";

const ROOT = path.join(import.meta.dirname, "..", "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8")).version;
/** The release this file, and the move off the old store, go with. */
const REMOVE_AT = "0.7.0";
const older = (a, b) => {
  const [x, y] = [a, b].map(v => String(v).split(".").map(n => Number(n) || 0));
  for ( let i = 0; i < 3; i++ ) if ( (x[i] ?? 0) !== (y[i] ?? 0) ) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
};

/** A world with these journals ({id: {flags, by, modifiedTime}}), a GM and a player, and the liveStore setting. */
function world(journals, { liveStore = "" } = {}) {
  const users = [{ id: "gm", isGM: true }, { id: "pat", isGM: false }];
  users.get = id => users.find(u => u.id === id);
  const all = new Map();
  const list = () => [...all.values()];
  const collection = { get: id => all.get(id), has: id => all.has(id), filter: f => list().filter(f), map: f => list().map(f), find: f => list().find(f) };
  const settings = { liveStore };
  let made = 0;
  const add = (id, flags, { by = "gm", modifiedTime = 1000, createdTime = 1 } = {}) => {
    const j = {
      id, name: id, flags: { "fast-fighting": flags }, _stats: { createdBy: by, lastModifiedBy: by, createdTime, modifiedTime },
      getFlag: (scope, key) => j.flags[scope]?.[key],
      testUserPermission: () => false,
      toObject: () => JSON.parse(JSON.stringify({ flags: j.flags })),
      delete: async () => all.delete(id)
    };
    all.set(id, j);
    return j;
  };
  for ( const [id, j] of Object.entries(journals) ) add(id, j.flags, j);
  globalThis.game = {
    ...globalThis.game, users, journal: collection,
    settings: { get: (scope, key) => settings[key], set: async (scope, key, v) => { settings[key] = v; } },
    combats: { get: () => null, combats: [] },
    folders: { find: f => [{ type: "JournalEntry", getFlag: () => true, id: "folder" }].find(f) }
  };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0 } };
  globalThis.foundry = { documents: { JournalEntry: { create: async data => add(`made${++made}`, data.flags["fast-fighting"], { modifiedTime: 5000 }) } } };
  return { all, settings };
}

const was = { foundry: globalThis.foundry, CONST: globalThis.CONST };
beforeEach(() => {
  was.foundry = globalThis.foundry;
  was.CONST = globalThis.CONST;
});
afterEach(() => {
  globalThis.foundry = was.foundry;
  globalThis.CONST = was.CONST;
});

describe("temporary: the old single store of live battles", () => {
  test(`expires at ${REMOVE_AT}`, () => {
    expect(older(VERSION, REMOVE_AT), `FastFighting ${VERSION} has reached ${REMOVE_AT}: remove the old single store's move (see tests/temporary/live-single-store.test.js's header) and this file`).toBe(true);
  });

  test("its kinds: the store the setting names (or the oldest a GM made), and any other flagged so, a leftover", () => {
    expect(kindOf({ liveStore: true }, { oldStore: true })).toBe("store");
    expect(kindOf({ liveStore: true })).toBe("leftover");
    expect(kindOf({ liveBattle: "c1", liveStore: true })).toBe("transcript");
  });

  test("a battle moved off it: every part of it, nobody else's, and the store's last change as its last keep", () => {
    const store = Object.fromEntries(KEPT_PARTS.map(part => [part, { c1: { part }, c2: { part } }]));
    const out = moveOut(store, "c1", { keptAt: 123 });
    expect(out.keptAt).toBe(123);
    for ( const part of KEPT_PARTS ) expect(out[part]).toEqual({ c1: { part } });
  });

  test("the active GM's login: each battle on it into a transcript of its own (not one that has one), then it's gone", async () => {
    const parts = id => Object.fromEntries(KEPT_PARTS.map(part => [part, { [id]: { part } }]));
    const store = { liveStore: true, battles: { c1: { id: "b1" }, c2: { id: "b2" } }, turns: { ...parts("c1").turns, ...parts("c2").turns } };
    const { all, settings } = world({
      store: { flags: store, modifiedTime: 777 },
      // (c2 already has a transcript: it isn't made again.)
      t2: { flags: { liveBattle: "c2", encounter: 1, battles: { c2: { id: "b2" } } }, modifiedTime: 900 }
    }, { liveStore: "store" });
    expect(oldStore()?.id).toBe("store");
    await moveOldStore();
    expect(all.has("store")).toBe(false);
    expect(settings.liveStore).toBe("");
    const made = [...all.values()].filter(j => j.id.startsWith("made"));
    expect(made).toHaveLength(1);
    expect(made[0].flags["fast-fighting"]).toMatchObject({ liveBattle: "c1", keptAt: 777, battles: { c1: { id: "b1" } }, turns: { c1: { part: "turns" } } });
    expect(made[0].flags["fast-fighting"].turns.c2).toBeUndefined();
  });

  test("a store a player last changed isn't trusted: not read, not moved, and left for the GM to see", async () => {
    const { all } = world({ store: { flags: { liveStore: true, battles: { c1: { id: "b1" } } }, by: "pat" } }, { liveStore: "store" });
    expect(oldStore()).toBeNull();
    await moveOldStore();
    expect(all.has("store")).toBe(true);
    expect([...all.keys()]).toEqual(["store"]);
  });
});
