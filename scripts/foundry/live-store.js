/**
 * The journals FastFighting keeps live battles in, as plain data: what each one is, how old and how big, what goes and
 * when (the troubleshooting setting's effect, and the one-month cleanup), the export file, and the move from the old
 * single store. Pure: no Foundry globals. Each journal comes in as its facts (foundry/live-journals.js journalFacts):
 *   {id, name, kind, trusted, distrust, flags (the module's own), createdTime, modifiedTime, createdBy, lastModifiedBy}
 * Its kind:
 *   transcript  one battle's, a journal of its own (flags.liveBattle: its combat's id; flags.encounter: its number; the
 *               battle as kept, flags.battles.<combat id>, says which battle: its `id`)
 *   plan        the planner's last run (flags.planRun), kept only while troubleshooting
 *   store       the old single store (flags.liveStore), from before transcripts: its battles move out on login
 *   leftover    any other journal flagged liveStore (a store no longer trusted, made again elsewhere)
 *               (store and leftover: temporary, remove at 0.7.0 with tests/temporary/live-single-store.test.js)
 */
import { KEPT_PARTS } from "./live-keeping.js";

/** A transcript's name: this, then the encounter's number (an identifier, like a file name: never translated). */
export const TRANSCRIPT_PREFIX = "FF_FF_LiveBattle_Transcript_";
/** The journal folder they're all kept in. */
export const TRANSCRIPT_FOLDER = "FF_FF_LiveBattle_Transcripts";
/** The planner's last run, while troubleshooting. */
export const PLAN_JOURNAL = "FF_FF_BattlePlan_LastRun";
/** How long a journal is kept after its last keep, for troubleshooting and by the cleanup (days). */
export const KEEP_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

/** What the file Export makes says it is. */
export const EXPORT_FORMAT = "fastfighting-live-battles";
export const EXPORT_VERSION = 1;

/**
 * A new transcript's name: the encounter's number, and `_2`, `_3` ... after it while that name is taken (the number
 * is the tracker's for its scene, so another scene's encounter, or a later one on the same scene, has it too).
 * @param {number} n           The encounter's number
 * @param {Set<string>} taken  The names the world's journals have
 */
export function transcriptName(n, taken = new Set()) {
  const base = `${TRANSCRIPT_PREFIX}${n}`;
  if ( !taken.has(base) ) return base;
  for ( let i = 2; ; i++ ) if ( !taken.has(`${base}_${i}`) ) return `${base}_${i}`;
}

/** A flagged journal's kind (see the header), or null for one that isn't FastFighting's. `oldStore`: it's the old store. */
export function kindOf(flags, { oldStore = false } = {}) {
  if ( flags?.liveBattle ) return "transcript";
  if ( flags?.planRun ) return "plan";
  // (Temporary: remove at 0.7.0 with tests/temporary/live-single-store.test.js.)
  if ( flags?.liveStore ) return oldStore ? "store" : "leftover";
  return null;
}

/**
 * When a journal was last kept: its own `keptAt`, written with every keep; else (the old store, and a journal kept
 * before keptAt was) when it was last changed, the most conservative guess (no keep in it is later than that).
 */
export const lastKept = j => Number(j?.flags?.keptAt) || Number(j?.modifiedTime) || 0;

/** Is it older than `days` (last kept that long ago)? */
export const isOld = (j, now, days = KEEP_DAYS) => now - lastKept(j) > days * DAY;

/** The combat ids a journal holds battles for: a transcript's own, and every battle on a store. */
export function combatIdsOf(j) {
  const ids = new Set(Object.keys(j?.flags?.battles ?? {}));
  if ( j?.flags?.liveBattle ) ids.add(j.flags.liveBattle);
  return [...ids];
}

/** Is it this battle's transcript (on this combat; and, given a battle's id, that battle's)? */
export const transcriptFor = (j, combatId, battleId = null) => j?.kind === "transcript" && j.flags?.liveBattle === combatId
  && (!battleId || j.flags.battles?.[combatId]?.id === battleId);

/** The battle a transcript keeps: its id, or null. */
export const battleOf = j => j?.flags?.battles?.[j?.flags?.liveBattle]?.id ?? null;

/**
 * A battle in it still in play (not ended) on a combat that's still there: that combat's id, or null. With `liveOn`
 * (combat id -> the battle its flag names, or null), only the battle its combat still names: one rewound or replaced
 * isn't in play, whatever it says of itself.
 */
export function inPlayOn(j, combatIds, liveOn = null) {
  for ( const [id, data] of Object.entries(j?.flags?.battles ?? {}) ) {
    if ( combatIds.has(id) && data && !data.ended && (!liveOn || liveOn.get(id) === data.id) ) return id;
  }
  return null;
}

/**
 * What goes, and what's held back, at each moment (the troubleshooting setting's effect):
 *   combatDeleted  off: that combat's transcripts. On: nothing (kept for KEEP_DAYS).
 *   rewound        Rewind This Encounter: that battle's transcript, either way (the battle is undone; one played
 *                  before it on the same combat stays).
 *   login          the active GM logs in. Off: every transcript whose combat is gone, or (`liveOn` given) whose battle
 *                  its combat no longer names (rewound, or another begun on it), whatever its age. On: transcripts and
 *                  the planner's last run older than KEEP_DAYS.
 *   cleanup        the GM's Clean up: every one of FastFighting's journals older than KEEP_DAYS, whatever it is.
 * Only trusted transcripts and runs go by themselves; a store, a leftover or an untrusted journal only by the GM's
 * Clean up, which shows them first. Never a battle still in play on a combat that's still there, however old (but a
 * rewound one, which is undone): held back, with why.
 * @param {"combatDeleted"|"rewound"|"login"|"cleanup"} moment
 * @param {object[]} journals   Their facts (the header)
 * @param {object} options
 * @param {boolean} [options.troubleshooting]  The setting
 * @param {number} [options.now]               The time now (ms)
 * @param {Set<string>} [options.combatIds]    The combats that are still there (without one being deleted)
 * @param {string|null} [options.combatId]     The combat deleted or rewound ...
 * @param {string|null} [options.battleId]     ... and the battle rewound
 * @param {Map<string,string|null>} [options.liveOn]  Each combat's battle, as its flag names it (none given: unknown)
 * @returns {{remove: object[], keep: object[]}}  `keep`: those that would go but are held back (`why`, `combatId`)
 */
export function whatGoes(moment, journals, { troubleshooting = false, now = 0, combatIds = new Set(), combatId = null, battleId = null, days = KEEP_DAYS, liveOn = null } = {}) {
  const transcript = j => j.trusted && j.kind === "transcript";
  const its = j => j.trusted && transcriptFor(j, combatId, moment === "rewound" ? battleId : null);
  const goes = {
    combatDeleted: j => !troubleshooting && its(j),
    rewound: its,
    login: j => (troubleshooting ? (transcript(j) || (j.trusted && j.kind === "plan")) && isOld(j, now, days)
      : transcript(j) && (!combatIds.has(j.flags.liveBattle) || (!!liveOn && liveOn.get(j.flags.liveBattle) !== battleOf(j)))),
    cleanup: j => !!j.kind && isOld(j, now, days)
  }[moment] ?? (() => false);
  // (A combat deleted isn't there, whatever the list says.)
  const there = moment === "combatDeleted" ? new Set([...combatIds].filter(id => id !== combatId)) : combatIds;
  const remove = [];
  const keep = [];
  for ( const j of journals ) {
    if ( !goes(j) ) continue;
    const playing = moment === "rewound" ? null : inPlayOn(j, there, liveOn);
    if ( playing ) keep.push({ ...j, why: "inPlay", combatId: playing });
    else remove.push(j);
  }
  return { remove, keep };
}

/** How big a value is kept (its JSON, in bytes). */
export const sizeOf = value => new TextEncoder().encode(JSON.stringify(value ?? null)).length;

/**
 * One battle off the old store, as its transcript's flags: each part of it kept there (live-keeping.js), and `keptAt`
 * (the store's last change: when that battle was last kept is unknown, and no later). (Temporary: remove at 0.7.0
 * with tests/temporary/live-single-store.test.js.)
 */
export function moveOut(storeFlags, id, { keptAt = null } = {}) {
  const out = { keptAt };
  for ( const part of KEPT_PARTS ) if ( storeFlags?.[part]?.[id] !== undefined ) out[part] = { [id]: storeFlags[part][id] };
  return out;
}

/**
 * A value as plain data for a journal's flags or a file: Maps as `{$map: [[key, value]]}`, Sets as arrays, numbers that
 * aren't finite as strings ("Infinity"), functions and undefined left out (null in a list), and a loop back into itself
 * as null.
 */
export function plainData(v, seen = new WeakSet()) {
  if ( v === null ) return null;
  if ( typeof v === "number" ) return Number.isFinite(v) ? v : String(v);
  if ( v === undefined || typeof v === "function" || typeof v === "symbol" ) return undefined;
  if ( typeof v === "bigint" ) return String(v);
  if ( typeof v !== "object" ) return v;
  if ( seen.has(v) ) return null;
  seen.add(v);
  let out;
  if ( v instanceof Map ) out = { $map: [...v].map(([k, x]) => [plainData(k, seen), plainData(x, seen) ?? null]) };
  else if ( v instanceof Set ) out = [...v].map(x => plainData(x, seen) ?? null);
  else if ( v instanceof Date ) out = v.toISOString();
  else if ( Array.isArray(v) ) out = v.map(x => plainData(x, seen) ?? null);
  else {
    out = {};
    for ( const [k, x] of Object.entries(v) ) {
      const p = plainData(x, seen);
      if ( p !== undefined ) out[k] = p;
    }
  }
  seen.delete(v);
  return out;
}

/**
 * The context an export (and the planner's last run) carries, so a file can be read without the world.
 * @param {object} env   What the world runs: {world, foundry: {version, generation, build}, system: {id, version},
 *                       modules: [{id, version}] (FastFighting's, active: the core and its helpers), coreApi}
 * @param {object} options
 * @param {number} options.at              When (ms)
 * @param {string[]} [options.combats]     The combat ids it speaks of ...
 * @param {Set<string>} [options.existing] ... and those still there
 */
export function contextBlock(env, { at, combats = [], existing = new Set() }) {
  return {
    at: new Date(at).toISOString(),
    world: env?.world ?? null,
    foundry: env?.foundry ?? null,
    system: env?.system ?? null,
    modules: env?.modules ?? [],
    coreApi: env?.coreApi ?? null,
    combats: Object.fromEntries([...new Set(combats)].map(id => [id, existing.has(id)]))
  };
}

/**
 * The export file: what it is, its context, and each journal whole (its facts and every flag FastFighting keeps on
 * it). Nothing is changed by it.
 */
export function exportData(journals, env, { at, existing = new Set() }) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    context: contextBlock(env, { at, combats: journals.flatMap(combatIdsOf), existing }),
    journals: journals.map(j => ({
      id: j.id, name: j.name, kind: j.kind, trusted: !!j.trusted, distrust: j.distrust ?? null,
      createdTime: j.createdTime ?? null, modifiedTime: j.modifiedTime ?? null, createdBy: j.createdBy ?? null,
      lastModifiedBy: j.lastModifiedBy ?? null, lastKept: lastKept(j) || null, size: sizeOf(j.flags), flags: j.flags ?? {}
    }))
  };
}

/** A date as yyyy-mm-dd, in the GM's own time. */
const dayOf = at => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** Safe in a file name on any computer. */
const fileSafe = s => String(s ?? "").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "world";

/** The export file's name: fastfighting-live-battles-<world>-<yyyy-mm-dd>.json, one journal's name after the date. */
export function exportFileName(world, at, one = null) {
  return `fastfighting-live-battles-${fileSafe(world)}-${dayOf(at)}${one ? `-${fileSafe(one)}` : ""}.json`;
}
