/**
 * The journals live battles are kept in, in the world (live-store.js decides what they are and what goes; this finds,
 * makes, writes and deletes them):
 *   - a transcript for each battle, a journal of its own (TRANSCRIPT_PREFIX and the encounter's number), written a turn
 *     at a time (live-battle.js keep);
 *   - while troubleshooting, the planner's last run (PLAN_JOURNAL);
 *   - all in one folder (TRANSCRIPT_FOLDER), seen by GMs only.
 * The troubleshooting setting decides how long they're kept: off, a transcript goes with its combat; on, for
 * KEEP_DAYS after its last keep. The old single store (the hidden liveStore setting named it) is moved out, a
 * transcript for each battle on it, when the active GM logs in, and deleted.
 */
import { MODULE_ID } from "../constants.js";
import { setting } from "../settings.js";
import { listAdapters } from "../api.js";
import { CORE_API_VERSION } from "../core-api.js";
import { encounterNumber } from "./persistence.js";
import { forgetUpdate } from "./live-keeping.js";
import {
  TRANSCRIPT_FOLDER, PLAN_JOURNAL, KEEP_DAYS, transcriptName, kindOf, lastKept, transcriptFor, whatGoes, moveOut, plainData, contextBlock
} from "./live-store.js";

const JournalEntry = () => foundry.documents.JournalEntry ?? globalThis.JournalEntry;
const ROOT = `flags.${MODULE_ID}`;

/* -------------------------------------------- */
/*  Trust                                       */
/* -------------------------------------------- */

/**
 * Why a journal can't be trusted with a battle (what a Rewind puts back, run with a GM's rights), or null when it can:
 * "player" (a player can see it) or "editor" (someone who isn't a GM changed it last). A player can make a journal no
 * other player sees, flag it, and fill it: such a one is never trusted. (Every client is sent every journal entry,
 * whatever its ownership: what's kept here isn't secret from a player who digs, only safe from one who would change it.)
 */
export function distrustOf(j) {
  if ( game.users.some(u => !u.isGM && j.testUserPermission(u, "LIMITED")) ) return "player";
  if ( !game.users.get(j._stats?.lastModifiedBy)?.isGM ) return "editor";
  return null;
}

/** When a journal was last kept (live-store.js lastKept). */
const keptOf = j => lastKept({ flags: j.flags?.[MODULE_ID], modifiedTime: j._stats?.modifiedTime });

/** The trusted journal flagged so (its flag `key` equal to `value`, and `also` true of it), the newest; or null. */
function trusted(key, value, also = () => true) {
  return game.journal.filter(j => j.getFlag(MODULE_ID, key) === value && !distrustOf(j) && also(j)).sort((a, b) => keptOf(b) - keptOf(a))[0] ?? null;
}

/**
 * A battle's transcript, by its flags (never its name): on this combat, and that battle's (by its id) when one's
 * given; or null.
 */
export const transcriptOf = (combatId, battleId = null) => trusted("liveBattle", combatId,
  j => transcriptFor({ kind: "transcript", flags: j.flags?.[MODULE_ID] }, combatId, battleId));

/**
 * The old single store, from before transcripts: the one the liveStore setting named, or one from before the setting
 * (the oldest a GM made), while trusted; else null. (Temporary: remove at 0.7.0 with
 * tests/temporary/live-single-store.test.js.)
 */
export function oldStore() {
  const ok = j => !!j?.getFlag(MODULE_ID, "liveStore") && !distrustOf(j);
  const named = game.journal.get(setting("liveStore"));
  if ( ok(named) ) return named;
  return game.journal.filter(j => ok(j) && game.users.get(j._stats?.createdBy)?.isGM)
    .sort((a, b) => (a._stats.createdTime ?? 0) - (b._stats.createdTime ?? 0))[0] ?? null;
}

/* -------------------------------------------- */
/*  Making them                                 */
/* -------------------------------------------- */

/** The folder they're kept in: found by its flag, made the first time it's needed (once, however many ask at once). */
let folderMade = null;
function transcriptFolder() {
  const found = game.folders.find(f => f.type === "JournalEntry" && f.getFlag(MODULE_ID, "transcripts"));
  if ( found ) return found;
  const Folder = foundry.documents.Folder ?? globalThis.Folder;
  folderMade ??= Folder.create({ name: TRANSCRIPT_FOLDER, type: "JournalEntry", flags: { [MODULE_ID]: { transcripts: true } } })
    // (No folder: the journal is made at the top, and works the same.)
    .catch(err => console.warn(`${MODULE_ID} | making the live battles' folder`, err))
    .finally(() => { folderMade = null; });
  return folderMade;
}

/** A journal of ours: in the folder, seen by GMs only. */
async function makeJournal(name, flags) {
  const folder = await transcriptFolder();
  return JournalEntry().create({
    name, folder: folder?.id ?? null, ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE }, flags: { [MODULE_ID]: flags }
  });
}

/**
 * A new transcript for a battle on this combat: named for the encounter's number (the tracker's, as the planner and
 * the Battle Vantage show it; 1 when its scene has only one, or it's gone), `_2` and on while that name is taken.
 * `flags`: what it holds from the start (a battle moved off the old store).
 */
export function newTranscript(combatId, flags = {}) {
  const n = encounterNumber(game.combats.get(combatId) ?? null)?.n ?? 1;
  const name = transcriptName(n, new Set(game.journal.map(j => j.name)));
  return makeJournal(name, { ...flags, liveBattle: combatId, encounter: n });
}

/* -------------------------------------------- */
/*  What they are                               */
/* -------------------------------------------- */

/** Every journal of FastFighting's, as live-store.js reads them (its header). */
export function journalFacts() {
  const store = oldStore();
  return game.journal.map(j => {
    const flags = j.flags?.[MODULE_ID];
    const kind = kindOf(flags, { oldStore: j === store });
    if ( !kind ) return null;
    const distrust = distrustOf(j);
    const stats = j._stats ?? {};
    return {
      id: j.id, name: j.name, kind, trusted: !distrust, distrust, flags,
      createdTime: stats.createdTime ?? null, modifiedTime: stats.modifiedTime ?? null, createdBy: stats.createdBy ?? null, lastModifiedBy: stats.lastModifiedBy ?? null
    };
  }).filter(Boolean);
}

/** The combats still there. */
export const combatsHere = () => new Set(game.combats.map(c => c.id));

/** Each combat's live battle, as its flag names it (null: none). */
export const liveBattlesHere = () => new Map(game.combats.map(c => [c.id, c.getFlag(MODULE_ID, "live")?.id ?? null]));

/**
 * What the world runs, for an export's context and the planner's last run: the world, Foundry, the system, every active
 * FastFighting module (the core, and each helper: by its id, or by the adapters registered), and the core API.
 */
export function worldFacts() {
  const sources = new Set(listAdapters().flatMap(a => a.adapters.map(x => x.source)));
  const ours = m => m.id === MODULE_ID || m.id.startsWith(`${MODULE_ID}-`) || sources.has(m.id);
  return {
    world: game.world?.id ?? null,
    foundry: { version: game.version ?? null, generation: game.release?.generation ?? null, build: game.release?.build ?? null },
    system: { id: game.system?.id ?? null, version: game.system?.version ?? null },
    modules: game.modules.filter(m => m.active && ours(m)).map(m => ({ id: m.id, version: m.version ?? null })),
    coreApi: CORE_API_VERSION
  };
}

/** Delete these journals (those still there). */
export async function deleteJournals(ids) {
  const here = ids.filter(id => game.journal.has(id));
  if ( here.length ) await JournalEntry().deleteDocuments(here);
  return here;
}

/* -------------------------------------------- */
/*  When they go                                */
/* -------------------------------------------- */

/**
 * A combat's transcripts, gone as `moment` says (live-store.js whatGoes): "rewound" (Rewind This Encounter: that
 * battle's, by its id) or "combatDeleted". A battle still on the old store, not yet moved, goes from it too.
 */
export async function dropTranscripts(moment, combatId, battleId = null) {
  const troubleshooting = !!setting("troubleshooting");
  const { remove } = whatGoes(moment, journalFacts(), { troubleshooting, now: Date.now(), combatIds: combatsHere(), combatId, battleId });
  await deleteJournals(remove.map(j => j.id));
  const store = oldStore();
  if ( (moment === "rewound" || !troubleshooting) && store?.getFlag(MODULE_ID, `battles.${combatId}`) ) await store.update(forgetUpdate(combatId, ROOT));
}

/**
 * The old single store moved out: each battle on it into a transcript of its own (unless it has one already, newer),
 * and once every one is, the store deleted and the setting that named it cleared. (Cut short, the store stays as it
 * was, and the next login goes on from there.) (Temporary: remove at 0.7.0 with
 * tests/temporary/live-single-store.test.js.)
 */
export async function moveOldStore() {
  const store = oldStore();
  if ( store ) {
    const flags = store.toObject().flags?.[MODULE_ID] ?? {};
    // (When each battle on it was last kept is unknown; no later than the store's last change, the most conservative.)
    const keptAt = store._stats?.modifiedTime ?? Date.now();
    for ( const id of Object.keys(flags.battles ?? {}) ) {
      if ( !transcriptOf(id) && !(await newTranscript(id, moveOut(flags, id, { keptAt }))) ) return;
    }
    await store.delete();
  }
  if ( setting("liveStore") ) await game.settings.set(MODULE_ID, "liveStore", "");
}

/**
 * The active GM logs in: the old store moved out, then what goes at login (live-store.js whatGoes): troubleshooting
 * off, every transcript whose combat is gone, quietly; on, those older than KEEP_DAYS, the GM told if any went.
 */
export async function tidyOnLogin() {
  if ( !game.user.isActiveGM ) return;
  try {
    await moveOldStore();
  } catch ( err ) {
    console.error(`${MODULE_ID} | moving live battles off the old store`, err);
  }
  const troubleshooting = !!setting("troubleshooting");
  const { remove } = whatGoes("login", journalFacts(), { troubleshooting, now: Date.now(), combatIds: combatsHere(), liveOn: liveBattlesHere() });
  const gone = await deleteJournals(remove.map(j => j.id));
  if ( troubleshooting && gone.length ) ui.notifications.info("FASTFIGHTING.LiveData.Pruned", { format: { n: gone.length, days: KEEP_DAYS } });
}

/* -------------------------------------------- */
/*  The planner's last run                      */
/* -------------------------------------------- */

/**
 * While troubleshooting, the planner's last run, kept in its journal (PLAN_JOURNAL, made the first time), in place of
 * the one before. `makeRun()` gives it ({scene, encounter, holder, setup, spec, results, seed, sample: {seed, log},
 * stopped}), kept as plain data; it's only asked for while the setting's on. A failure only warns in the console, and
 * never stops the planner.
 */
export async function savePlanRun(makeRun) {
  try {
    if ( !game.user.isGM || !setting("troubleshooting") ) return;
    const at = Date.now();
    const run = plainData(makeRun()) ?? {};
    const combat = run.encounter?.id ? [run.encounter.id] : [];
    const flags = { ...run, planRun: true, keptAt: at, ranAt: at, context: contextBlock(worldFacts(), { at, combats: combat, existing: combatsHere() }) };
    const doc = trusted("planRun", true);
    // (The run before it replaced whole: nothing of it left behind.)
    if ( doc ) await doc.update({ flags: { [MODULE_ID]: foundry.data.operators.ForcedReplacement.create(flags) } });
    else await makeJournal(PLAN_JOURNAL, flags);
  } catch ( err ) {
    console.warn(`${MODULE_ID} | keeping the planner's last run for troubleshooting`, err);
  }
}
