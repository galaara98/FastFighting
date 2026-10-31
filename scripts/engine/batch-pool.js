/**
 * The planner's fights on background threads, so the screen never freezes for a fight and more fights fit its time.
 *
 * A pool of module Web Workers (engine/batch-worker.js), up to MOST_WORKERS (a share of the computer's threads:
 * poolSize). Each worker builds its own prepareBattle and runs an interleaved share of the fight indices,
 * fight i with deriveSeed(seed, i) as runBatch does: worker w of n runs w, w + n, w + 2n ... This thread feeds the
 * aggregator in index order, so a batch of N fights gives exactly what runBatch and runBatchSync give for N fights with
 * that seed. When the time is up (`maxMs`), each worker finishes the fight under way and starts no other; the fights
 * done past the first one missing are left out, so the batch is still fights 0 to N - 1. Stop (`signal`) ends the
 * workers at once, with the fights in order so far (fight 0 at least: here, if none came back yet).
 *
 * The rules: the workers import them from the module the system's helper names (adapter.workerRules, API 22:
 * {url, exportName, data}). Without one, without Web Workers, or once the workers have failed with those rules this
 * session (a module that won't load there, a spec that can't be sent), the batch runs on this thread (runBatch), as
 * before: the same fights, only fewer. Hooks and modifiers stay here, before and after (foundry/battle.js simulate).
 * Pure: no Foundry globals.
 */
import { MODULE_ID } from "../constants.js";
import { prepareBattle, runOne, runBatch } from "./simulator.js";
import { createAggregator } from "./aggregate.js";
import { deriveSeed, randomSeed } from "./rng.js";
import { clock } from "./batch-worker.js";

/** The most workers a batch runs on. */
export const MOST_WORKERS = 16;

/**
 * The share of the computer's threads the planner's workers take, as the settings allow it (a computer's own setting,
 * Background worker share): half at most, about the real cores where each counts twice (hyperthreading), so no core
 * runs two fights at once and one is left for the screen.
 */
export const THREAD_SHARE = Object.freeze({ min: 0.1, max: 0.5, default: 0.5 });

/**
 * How many workers: `share` of the threads the browser says the computer has (THREAD_SHARE's bounds), rounded; no more
 * than one for each GB of memory, where the browser says (a fight on a big map takes 100 to 200 MB); MOST_WORKERS at
 * most, one at least (on two threads or one, a worker still keeps the screen free). Two threads where the browser
 * doesn't say. (Measured on a big map, 24 cores and 32 threads: 4 workers 84 fights, 8 144, 12 164, 16 180, 23 195.)
 */
export function poolSize(cores = globalThis.navigator?.hardwareConcurrency, memory = globalThis.navigator?.deviceMemory, share = THREAD_SHARE.default) {
  const n = Math.floor(Number(cores));
  const threads = n > 0 ? n : 2;
  const part = Number.isFinite(Number(share)) ? Math.min(THREAD_SHARE.max, Math.max(THREAD_SHARE.min, Number(share))) : THREAD_SHARE.default;
  let size = Math.round(threads * part);
  const gb = Number(memory);
  if ( gb > 0 ) size = Math.min(size, Math.floor(gb));
  return Math.max(1, Math.min(MOST_WORKERS, size));
}

/**
 * How long past the prediction's time the workers may take to say they're done (ms) before they're taken for stuck: the
 * batch then runs here. (A fight under way is finished first; even a very big one takes a second or two.)
 */
export const GRACE_MS = 20000;

/** The worker's script, beside this one: Foundry serves both under the module's own path, whatever its route prefix. */
const WORKER_URL = new URL("./batch-worker.js", import.meta.url);

/** A module Web Worker running engine/batch-worker.js. */
export const webWorker = () => new Worker(WORKER_URL, { type: "module", name: `${MODULE_ID}-fights` });

/** The rules (by their url) whose workers failed this session: those batches run on this thread from then on. */
const failed = new Set();

/**
 * Does a batch with these rules (adapter.workerRules) run on workers? Where there are rules to give them, workers to
 * make (this browser's, or `makeWorker`), and they haven't failed with those rules.
 */
export function onWorkers(ref, makeWorker = null) {
  return !!ref?.url && !failed.has(ref.url) && (!!makeWorker || typeof globalThis.Worker === "function");
}

/** The threads a batch with these rules runs on: its workers, or this one. */
export const poolThreads = (ref, { size = poolSize(), makeWorker = null } = {}) => (onWorkers(ref, makeWorker) ? size : 1);

/**
 * A pool of workers for one of the planner's runs (a prediction, the swing factors' tests), its batches one after
 * another; close it when the run is over (the workers are made as the first batch needs them, and kept until then).
 * @param {{url: string, exportName?: string, data?: *}|null} ref   where the workers import the system's rules from
 * @param {object} [opts]
 * @param {number} [opts.size]          the most workers (poolSize)
 * @param {() => object} [opts.makeWorker]   a worker like a browser's (postMessage, terminate, onmessage, onerror,
 *   onmessageerror), running batch-worker.js's batchHost; a browser's module Web Worker by default
 * @param {string} [opts.lang]          the reader's language, for the workers' stand-in words
 * @param {number} [opts.graceMs]       how long past the time the workers may take to be done (GRACE_MS)
 */
export function openPool(ref, { size = poolSize(), makeWorker = null, lang = "en", graceMs = GRACE_MS } = {}) {
  let workers = [];
  let batches = 0;
  const end = () => {
    for ( const w of workers ) w.terminate();
    workers = [];
  };
  const pool = {
    /** The threads its next batch runs on. */
    get threads() {
      return poolThreads(ref, { size, makeWorker });
    },
    /** The threads its last batch ran on (for this computer's pace: run-budget.js paceOf). */
    used: 1,
    /**
     * A batch, as runBatch runs it and with what it returns: `{...aggregate, seed}`.
     * @param {object} spec     the BattleSpec
     * @param {object} rules    the system's rules, as this thread has them (for the aggregate, and runBatch)
     * @param {object} [opts]   runBatch's: {runs, seed, onProgress(fraction, done), signal, maxMs}
     */
    run(spec, rules, { runs = 2000, seed = randomSeed(), onProgress, signal, maxMs = null } = {}) {
      const here = remaining => {
        pool.used = 1;
        return runBatch(spec, rules, { runs, seed, onProgress, signal, maxMs: remaining });
      };
      if ( !onWorkers(ref, makeWorker) ) return here(maxMs);
      const start = clock();
      const n = Math.max(1, Math.min(size, Math.floor(runs) || 1));
      try {
        while ( workers.length < n ) workers.push((makeWorker ?? webWorker)());
      } catch ( err ) {
        failed.add(ref.url);
        console.warn(`${MODULE_ID} | no background workers for the fights: they run here`, err);
        end();
        return here(maxMs);
      }
      const crew = workers.slice(0, n);
      const id = ++batches;
      pool.used = n;
      return new Promise((resolve, reject) => {
        const waiting = new Map(); // (fights come back out of order: by index, until those before them are in)
        let next = 0;
        let done = 0;
        let settled = false;
        let agg = null;
        let prep = null;
        let watchdog = null;
        const finish = () => {
          settled = true;
          clearTimeout(watchdog);
          signal?.removeEventListener?.("abort", stop);
          onProgress?.(1, next);
          resolve({ ...agg.finish(), seed });
        };
        // (Workers that failed: the batch here instead, in the time it has left; with these rules, here from now on.)
        const fail = why => {
          if ( settled ) return;
          settled = true;
          clearTimeout(watchdog);
          signal?.removeEventListener?.("abort", stop);
          failed.add(ref.url);
          console.warn(`${MODULE_ID} | the fights on background workers failed: they run here`, why);
          end();
          Promise.resolve(here(maxMs ? Math.max(1, start + maxMs - clock()) : null)).then(resolve, reject);
        };
        // (Stop: the workers ended at once, and the fights in order so far kept; fight 0 at least, as runBatch has it.)
        const stop = () => {
          if ( settled ) return;
          end();
          if ( !next ) {
            agg.add(runOne(prep, deriveSeed(seed, 0)), deriveSeed(seed, 0));
            next = 1;
          }
          finish();
        };
        const heard = message => {
          if ( settled || message?.id !== id ) return;
          if ( message.type === "error" ) return fail(message.message);
          if ( message.type === "fights" ) {
            for ( const f of message.fights ) waiting.set(f.i, f.result);
            while ( waiting.has(next) ) {
              agg.add(waiting.get(next), deriveSeed(seed, next));
              waiting.delete(next);
              next += 1;
            }
            onProgress?.(maxMs ? Math.min(1, (clock() - start) / maxMs) : next / runs, next);
          } else if ( message.type === "done" && ++done === crew.length ) finish();
        };
        const deadline = maxMs ? start + maxMs : null;
        try {
          crew.forEach((w, first) => {
            w.onmessage = event => heard(event.data);
            w.onerror = event => fail(event?.message || event);
            w.onmessageerror = event => fail(event);
            // (The spec as it is now, copied to each: before this thread prepares its own.)
            w.postMessage({ type: "batch", id, rules: ref, spec, seed, first, step: crew.length, runs, deadline, lang });
          });
        } catch ( err ) {
          // (A spec or rules data that can't be sent to a worker: a function in it, say.)
          return fail(err);
        }
        try {
          prep = prepareBattle(spec, rules);
          agg = createAggregator(prep);
        } catch ( err ) {
          // (A battle that can't be prepared: as runBatch would have failed.)
          settled = true;
          end();
          return reject(err);
        }
        if ( deadline ) watchdog = setTimeout(() => fail("no answer from the workers"), maxMs + graceMs);
        if ( signal?.aborted ) stop();
        else signal?.addEventListener?.("abort", stop, { once: true });
      });
    },
    /** The run is over: its workers ended. */
    close: end
  };
  return pool;
}
