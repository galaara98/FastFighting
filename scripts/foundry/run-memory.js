/**
 * The planner's last runs, kept in the GM's own browser (never in the world, where players could read the odds): for
 * each plan (an encounter's, a scene's), the results of its last run and a signature of the battle they were for.
 * Opening the planner on a battle that hasn't changed since (the same creatures, sheets, answers, positions, party
 * wishes and plan) shows them again instead of nothing.
 */
import { MODULE_ID } from "../constants.js";

const KEY = `${MODULE_ID}.lastRuns`;
/** How many plans' last runs are kept (the newest). */
export const KEEP_RUNS = 5;

/** A battle's signature: a hash of everything in its spec (what the simulation reads), and its length. */
export function battleSignature(spec) {
  const text = JSON.stringify(spec ?? null);
  let h = 0x811c9dc5;
  for ( let i = 0; i < text.length; i++ ) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(36)}.${text.length.toString(36)}`;
}

/** What's kept, as read (nothing, when the browser keeps nothing or what it kept is broken). */
function read(storage) {
  try {
    const list = JSON.parse(storage?.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter(e => e && typeof e === "object" && typeof e.holder === "string") : [];
  } catch ( err ) {
    return [];
  }
}

/**
 * Keep a plan's run: its results and the battle's signature.
 * @param {string} holder      the plan's holder (its encounter's or scene's uuid)
 * @param {object} spec        the battle that was simulated
 * @param {object} results     the run's results
 */
export function rememberRun(holder, spec, results, storage = globalThis.localStorage) {
  if ( !holder || !results ) return;
  const entry = { holder, sig: battleSignature(spec), results, at: Date.now() };
  const list = [entry, ...read(storage).filter(e => e.holder !== holder)].slice(0, KEEP_RUNS);
  try {
    storage?.setItem(KEY, JSON.stringify(list));
  } catch ( err ) {
    // (The browser is out of room, or keeps nothing: the planner just runs again next time.)
    try { storage?.setItem(KEY, JSON.stringify([entry])); } catch ( again ) { /* nothing kept */ }
  }
}

/** Has the planner run this plan at least once (its last run kept, whatever has changed since)? */
export function hasRun(holder, storage = globalThis.localStorage) {
  return !!holder && read(storage).some(e => e.holder === holder && e.results);
}

/** A plan's last run, if it was for this very battle: {results, at}; else null. */
export function recallRun(holder, spec, storage = globalThis.localStorage) {
  const entry = read(storage).find(e => e.holder === holder);
  return entry && entry.sig === battleSignature(spec) && entry.results ? entry : null;
}
