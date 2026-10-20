/**
 * A batch's fights on a background thread: the module Web Worker engine/batch-pool.js starts, a few at once, each with
 * an interleaved share of the fight indices (first, first + step, ...). Each builds its own prepareBattle from the
 * BattleSpec and the game system's rules, imported from the module its helper names (adapter.workerRules, API 22), runs
 * fight i with deriveSeed(seed, i) as runBatch does, and posts each fight's summary back, a few at a time. The pool puts
 * them in order. Pure: no Foundry globals here, and none in the rules either.
 *
 * In:  {type: "batch", id, rules: {url, exportName, data}, spec, seed, first, step, runs, deadline, lang}
 *        deadline: the time (ms since the epoch, as clock() has it) no fight starts after but fight 0; null for none.
 * Out: {type: "fights", id, fights: [{i, result}]} (runOne's summary), then {type: "done", id};
 *      or {type: "error", id, message}.
 *
 * The words: a fight's summary holds none, so labels the rules and the engine make for the log are left as their keys
 * (i18n.js localize does that without Foundry; standIn gives a helper's own unguarded game.i18n the same).
 */
import { prepareBattle, runOne } from "./simulator.js";
import { deriveSeed } from "./rng.js";

/** How often a worker posts the fights it has done so far (ms), for the pool's progress. */
export const FLUSH_MS = 25;

/** The time, ms since the epoch: the same clock in every thread (each has a performance of its own). */
export const clock = () => performance.timeOrigin + performance.now();

/**
 * The rules a batch names (adapter.workerRules): the export of that module, or, where the export is a function, what it
 * makes of the data (the settings those rules read, as plain data).
 * @param {{url: string, exportName?: string, data?: *}} ref
 */
export async function loadRules({ url, exportName = "default", data = null } = {}) {
  const made = (await import(url))[exportName];
  const rules = typeof made === "function" ? await made(data) : made;
  if ( !rules || typeof rules !== "object" ) throw new Error(`FastFighting | no rules at ${url} (${exportName})`);
  return rules;
}

/** No Foundry here: a helper's rules asking game.i18n for a label get its key, as the engine's own localize does. */
function standIn(lang) {
  globalThis.game ??= { i18n: { lang: lang ?? "en", has: () => false, localize: key => key, format: key => key } };
}

/** One worker's share of a batch: its fights, posted as they're done, then done (or what went wrong). */
async function runShare({ id, rules: ref, spec, seed, first, step, runs, deadline = null, lang }, post, flushMs) {
  try {
    standIn(lang);
    const prep = prepareBattle(spec, await loadRules(ref));
    let fights = [];
    let flushed = clock();
    for ( let i = first; i < runs; i += step ) {
      // (As runBatch: no fight starts once the time is up, but there's always fight 0; the one under way is finished.)
      if ( deadline && i > 0 && clock() >= deadline ) break;
      fights.push({ i, result: runOne(prep, deriveSeed(seed, i)) });
      if ( clock() - flushed >= flushMs ) {
        post({ type: "fights", id, fights });
        fights = [];
        flushed = clock();
      }
    }
    post({ type: "fights", id, fights });
    post({ type: "done", id });
  } catch ( err ) {
    post({ type: "error", id, message: String(err?.stack ?? err?.message ?? err) });
  }
}

/**
 * A worker's side: give it each message as it comes, and it runs the batches one after another, posting what they do
 * through `post`. (A browser's Worker is wired below; a test wires node's worker_threads the same way.)
 * @param {(message: object) => void} post
 * @param {object} [opts]
 * @param {number} [opts.flushMs]   how often it posts the fights done so far (0: each as it's done)
 */
export function batchHost(post, { flushMs = FLUSH_MS } = {}) {
  let queue = Promise.resolve();
  return message => {
    if ( message?.type !== "batch" ) return;
    queue = queue.then(() => runShare(message, post, flushMs));
  };
}

// In a Web Worker of its own: its messages come and go through its global scope.
if ( typeof WorkerGlobalScope === "function" && globalThis instanceof WorkerGlobalScope ) {
  const handle = batchHost(message => globalThis.postMessage(message));
  globalThis.onmessage = event => handle(event.data);
}
