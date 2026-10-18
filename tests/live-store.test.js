/**
 * The journals live battles are kept in (foundry/live-store.js): what goes and what stays at each moment, with the
 * troubleshooting setting off and on; the GM's one-month cleanup; the export file; and the move off the old store.
 */
import { describe, expect, test } from "vitest";
import {
  TRANSCRIPT_PREFIX, KEEP_DAYS, EXPORT_FORMAT, transcriptName, kindOf, lastKept, inPlayOn, transcriptFor, whatGoes, sizeOf, moveOut,
  plainData, exportData, exportFileName
} from "../scripts/foundry/live-store.js";
import { keepUpdate, KEPT_PARTS } from "../scripts/foundry/live-keeping.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 18, 12);
const ago = days => NOW - days * DAY;
/** The combats still there. */
const HERE = new Set(["cLive", "cEnded", "cYoung", "cRewound"]);

/** A battle's transcript: on that combat, last kept so long ago, ended or not. */
const transcript = (id, combat, days, { ended = false, trusted = true } = {}) => ({
  id, name: `${TRANSCRIPT_PREFIX}${id}`, kind: "transcript", trusted, distrust: trusted ? null : "player",
  flags: { liveBattle: combat, encounter: 1, keptAt: ago(days), battles: { [combat]: { id: `b-${id}`, ended } } }, modifiedTime: ago(days)
});

const J = {
  oldEnded: transcript("oldEnded", "cEnded", 40, { ended: true }),
  oldOrphan: transcript("oldOrphan", "cGone", 40),
  oldInPlay: transcript("oldInPlay", "cLive", 40),
  young: transcript("young", "cYoung", 2, { ended: true }),
  youngOrphan: transcript("youngOrphan", "cGone2", 1),
  untrustedOrphan: transcript("untrustedOrphan", "cGone3", 40, { trusted: false }),
  rewound: transcript("rewound", "cRewound", 1),
  // (A battle played before it on the same combat, its own transcript.)
  earlier: transcript("earlier", "cRewound", 3, { ended: true }),
  plan: { id: "plan", name: "plan", kind: "plan", trusted: true, distrust: null, flags: { planRun: true, keptAt: ago(31) }, modifiedTime: ago(31) },
  youngPlan: { id: "youngPlan", name: "youngPlan", kind: "plan", trusted: true, distrust: null, flags: { planRun: true, keptAt: ago(3) }, modifiedTime: ago(3) },
  // (A store a player was given, made again elsewhere: no keptAt, its last change.)
  stray: { id: "stray", name: "stray", kind: "leftover", trusted: false, distrust: "player", flags: { liveStore: true }, modifiedTime: ago(40) },
  // (The old single store, kept before keptAt: its last change stands for each battle's last keep.)
  legacy: { id: "legacy", name: "legacy", kind: "store", trusted: true, distrust: null, flags: { liveStore: true, battles: { cGone4: { ended: false } } }, modifiedTime: ago(45) },
  legacyYoung: { id: "legacyYoung", name: "legacyYoung", kind: "store", trusted: true, distrust: null, flags: { liveStore: true, battles: { cEnded: { ended: true } } }, modifiedTime: ago(10) },
  legacyInPlay: { id: "legacyInPlay", name: "legacyInPlay", kind: "leftover", trusted: true, distrust: null, flags: { liveStore: true, battles: { cLive: { ended: false } } }, modifiedTime: ago(60) }
};
const ALL = Object.values(J);
const ids = list => list.map(j => j.id).sort();
const goes = (moment, options) => whatGoes(moment, ALL, { now: NOW, combatIds: HERE, ...options });

describe("the one-month cleanup (the GM's Clean up)", () => {
  const { remove, keep } = goes("cleanup");

  test("old and ended, old and orphaned, an old stray store, an old plan, the legacy store by its last change: deleted", () => {
    expect(ids(remove)).toEqual(ids([J.oldEnded, J.oldOrphan, J.untrustedOrphan, J.plan, J.stray, J.legacy]));
  });

  test("still in play on a combat that's there, however old: kept, and said why", () => {
    expect(keep.map(j => [j.id, j.why, j.combatId]).sort()).toEqual([["legacyInPlay", "inPlay", "cLive"], ["oldInPlay", "inPlay", "cLive"]]);
  });

  test("young ones aren't asked about at all", () => {
    for ( const j of [J.young, J.youngOrphan, J.youngPlan, J.legacyYoung, J.rewound, J.earlier] ) {
      expect([...remove, ...keep].map(x => x.id)).not.toContain(j.id);
    }
  });

  test("a journal with no keptAt is as old as its last change; with one, its last keep", () => {
    expect(lastKept(J.legacy)).toBe(ago(45));
    expect(lastKept({ flags: { keptAt: ago(3) }, modifiedTime: ago(1) })).toBe(ago(3));
    expect(ids(whatGoes("cleanup", [J.legacy], { now: ago(45 - KEEP_DAYS + 1), combatIds: HERE }).remove)).toEqual([]);
  });

  test("a battle in play needs its combat still there", () => {
    expect(inPlayOn(J.oldInPlay, HERE)).toBe("cLive");
    expect(inPlayOn(J.oldOrphan, HERE)).toBeNull();
    expect(inPlayOn(J.oldEnded, HERE)).toBeNull();
  });
});

describe("the troubleshooting setting: what goes at each moment", () => {
  for ( const troubleshooting of [false, true] ) {
    test(`Rewind This Encounter: that battle's transcript, in play or not (troubleshooting ${troubleshooting ? "on" : "off"})`, () => {
      expect(ids(goes("rewound", { troubleshooting, combatId: "cRewound", battleId: "b-rewound" }).remove)).toEqual(["rewound"]);
      expect(ids(goes("rewound", { troubleshooting, combatId: "cLive", battleId: "b-oldInPlay" }).remove)).toEqual(["oldInPlay"]);
      // (Another battle's, on the same combat or another, stays.)
      expect(ids(goes("rewound", { troubleshooting, combatId: "cRewound", battleId: "b-elsewhere" }).remove)).toEqual([]);
    });

    test(`the manual cleanup is the same either way (troubleshooting ${troubleshooting ? "on" : "off"})`, () => {
      expect(ids(goes("cleanup", { troubleshooting }).remove)).toEqual(ids(goes("cleanup").remove));
    });
  }

  test("off, a combat deleted: its trusted transcript goes with it", () => {
    const here = new Set([...HERE].filter(id => id !== "cEnded"));
    expect(ids(whatGoes("combatDeleted", ALL, { troubleshooting: false, now: NOW, combatIds: here, combatId: "cEnded" }).remove)).toEqual(["oldEnded"]);
    // (Every battle's on it.)
    expect(ids(goes("combatDeleted", { troubleshooting: false, combatId: "cRewound" }).remove)).toEqual(["earlier", "rewound"]);
    // (One a player could have planted isn't deleted by itself.)
    expect(ids(goes("combatDeleted", { troubleshooting: false, combatId: "cGone3" }).remove)).toEqual([]);
  });

  test("on, a combat deleted: nothing goes", () => {
    expect(goes("combatDeleted", { troubleshooting: true, combatId: "cEnded" })).toEqual({ remove: [], keep: [] });
  });

  test("off, the active GM logs in: every trusted transcript whose combat is gone, of any age; nothing else", () => {
    const { remove, keep } = goes("login", { troubleshooting: false });
    expect(ids(remove)).toEqual(["oldOrphan", "youngOrphan"]);
    expect(keep).toEqual([]);
  });

  test("off, the active GM logs in: a transcript whose battle its combat no longer names goes too (rewound, or replaced)", () => {
    const flags = { liveBattle: "cLive", battles: { cLive: { id: "b-stale", ended: false } } };
    const stale = { id: "stale", name: "stale", kind: "transcript", trusted: true, flags, modifiedTime: NOW };
    const current = { ...stale, id: "current", flags: { liveBattle: "cLive", battles: { cLive: { id: "b-now", ended: false } } } };
    const liveOn = new Map([["cLive", "b-now"]]);
    expect(ids(whatGoes("login", [stale, current], { troubleshooting: false, now: NOW, combatIds: HERE, liveOn }).remove)).toEqual(["stale"]);
    // (Its combat names no battle at all: rewound.)
    expect(ids(whatGoes("login", [stale], { troubleshooting: false, now: NOW, combatIds: HERE, liveOn: new Map([["cLive", null]]) }).remove)).toEqual(["stale"]);
    // (Not knowing what the combats name: as before, only those whose combat is gone.)
    expect(ids(whatGoes("login", [stale], { troubleshooting: false, now: NOW, combatIds: HERE }).remove)).toEqual([]);
    expect(inPlayOn(stale, HERE, liveOn)).toBeNull();
    expect(inPlayOn(current, HERE, liveOn)).toBe("cLive");
  });

  test("on, the active GM logs in: trusted transcripts and the planner's run older than a month, never one in play", () => {
    const { remove, keep } = goes("login", { troubleshooting: true });
    expect(ids(remove)).toEqual(["oldEnded", "oldOrphan", "plan"]);
    expect(keep.map(j => j.id)).toEqual(["oldInPlay"]);
  });

  test("an unknown moment deletes nothing", () => {
    expect(goes("whenever")).toEqual({ remove: [], keep: [] });
  });
});

describe("names and kinds", () => {
  test("a transcript is named for its encounter's number, then _2, _3 while that's taken", () => {
    expect(transcriptName(3)).toBe(`${TRANSCRIPT_PREFIX}3`);
    expect(transcriptName(3, new Set([`${TRANSCRIPT_PREFIX}3`]))).toBe(`${TRANSCRIPT_PREFIX}3_2`);
    expect(transcriptName(3, new Set([`${TRANSCRIPT_PREFIX}3`, `${TRANSCRIPT_PREFIX}3_2`, `${TRANSCRIPT_PREFIX}1`]))).toBe(`${TRANSCRIPT_PREFIX}3_3`);
  });

  test("a battle's transcript: by its combat, and by the battle when it's asked for", () => {
    expect(transcriptFor(J.rewound, "cRewound")).toBe(true);
    expect(transcriptFor(J.rewound, "cRewound", "b-rewound")).toBe(true);
    expect(transcriptFor(J.earlier, "cRewound", "b-rewound")).toBe(false);
    expect(transcriptFor(J.rewound, "cLive")).toBe(false);
    expect(transcriptFor(J.legacyInPlay, "cLive")).toBe(false);
  });

  test("a journal's kind from its flags", () => {
    expect(kindOf({ liveBattle: "c1" })).toBe("transcript");
    expect(kindOf({ planRun: true })).toBe("plan");
    expect(kindOf({ liveStore: true }, { oldStore: true })).toBe("store");
    expect(kindOf({ liveStore: true })).toBe("leftover");
    expect(kindOf({ setup: {} })).toBeNull();
    expect(kindOf(undefined)).toBeNull();
  });
});

describe("keeping and moving", () => {
  test("every keep writes when it was kept", () => {
    const data = { id: "b1", spec: "{}", turns: [], told: 0 };
    const { update } = keepUpdate(null, "c1", data, { pack: () => [], root: "flags.ff", keptAt: NOW });
    expect(update["flags.ff.keptAt"]).toBe(NOW);
    expect("flags.ff.keptAt" in keepUpdate(null, "c1", data, { pack: () => [], root: "flags.ff" }).update).toBe(false);
  });

  test("a battle moved off the old store: every part of it, nobody else's, and the store's last change as its last keep", () => {
    const store = Object.fromEntries(KEPT_PARTS.map(part => [part, { c1: { part, mine: true }, c2: { part } }]));
    store.liveStore = true;
    const out = moveOut(store, "c1", { keptAt: ago(5) });
    expect(out.keptAt).toBe(ago(5));
    for ( const part of KEPT_PARTS ) expect(out[part]).toEqual({ c1: { part, mine: true } });
    expect(out.liveStore).toBeUndefined();
    // (A part it never had is left out.)
    expect(Object.keys(moveOut({ battles: { c3: {} } }, "c3"))).toEqual(["keptAt", "battles"]);
  });

  test("the planner's run as plain data: maps, sets, odd numbers, functions and loops", () => {
    const loop = { a: 1 };
    loop.self = loop;
    expect(plainData({ m: new Map([["k", 1]]), s: new Set([1, 2]), inf: Infinity, nan: NaN, f: () => 1, u: undefined, list: [1, undefined, () => 1], loop }))
      .toEqual({ m: { $map: [["k", 1]] }, s: [1, 2], inf: "Infinity", nan: "NaN", list: [1, null, null], loop: { a: 1, self: null } });
    // (The same object twice, not a loop: kept both times.)
    const shared = { x: 1 };
    expect(plainData([shared, shared])).toEqual([{ x: 1 }, { x: 1 }]);
  });

  test("a size is the JSON's bytes", () => {
    expect(sizeOf({ a: "é" })).toBe(new TextEncoder().encode(JSON.stringify({ a: "é" })).length);
    expect(sizeOf(null)).toBe(4);
  });
});

describe("the export file", () => {
  const env = {
    world: "my-world", foundry: { version: "14.369", generation: 14, build: 369 }, system: { id: "pf2e", version: "7.0.0" },
    modules: [{ id: "fast-fighting", version: "0.4.0" }, { id: "fast-fighting-pf2e", version: "0.4.0" }], coreApi: "20.0"
  };
  const deepFreeze = o => { if ( o && typeof o === "object" ) { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
  const journals = deepFreeze([structuredClone(J.oldInPlay), structuredClone(J.oldOrphan), structuredClone(J.legacy)]);
  const file = exportData(journals, env, { at: NOW, existing: HERE });

  test("what it is, and its context", () => {
    expect(file.format).toBe(EXPORT_FORMAT);
    expect(file.version).toBe(1);
    expect(Object.keys(file.context).sort()).toEqual(["at", "combats", "coreApi", "foundry", "modules", "system", "world"]);
    expect(file.context.at).toBe(new Date(NOW).toISOString());
    expect(file.context.world).toBe("my-world");
    expect(file.context.foundry).toEqual(env.foundry);
    expect(file.context.system).toEqual(env.system);
    expect(file.context.modules).toEqual(env.modules);
    expect(file.context.coreApi).toBe("20.0");
    // (Each combat it speaks of, and whether it's still there.)
    expect(file.context.combats).toEqual({ cLive: true, cGone: false, cGone4: false });
  });

  test("each journal whole: its facts and its flags as they are", () => {
    expect(file.journals.map(j => j.id)).toEqual(["oldInPlay", "oldOrphan", "legacy"]);
    for ( const [i, j] of file.journals.entries() ) {
      expect(Object.keys(j).sort()).toEqual(["createdBy", "createdTime", "distrust", "flags", "id", "kind", "lastKept", "lastModifiedBy", "modifiedTime", "name", "size", "trusted"]);
      expect(j.flags).toEqual(journals[i].flags);
      expect(j.size).toBe(sizeOf(journals[i].flags));
    }
    expect(file.journals[2].lastKept).toBe(ago(45));
    expect(JSON.parse(JSON.stringify(file))).toEqual(file);
  });

  test("its name: the world and the day, and one journal's name after it", () => {
    const at = new Date(2026, 9, 18, 9).getTime();
    expect(exportFileName("my-world", at)).toBe("fastfighting-live-battles-my-world-2026-10-18.json");
    expect(exportFileName("my-world", at, `${TRANSCRIPT_PREFIX}2_3`)).toBe(`fastfighting-live-battles-my-world-2026-10-18-${TRANSCRIPT_PREFIX}2_3.json`);
    expect(exportFileName("a world/with:odd*chars", at)).toBe("fastfighting-live-battles-a-world-with-odd-chars-2026-10-18.json");
  });
});
