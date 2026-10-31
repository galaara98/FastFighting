/**
 * API 22: the planner's fights on background workers (engine/batch-pool.js, engine/batch-worker.js).
 *  - A helper opens its rules to the workers: adapter.workerRules() -> {url, exportName, data}; null by default.
 *  - A batch split among workers, each with an interleaved share of the fight indices, and put back in index order,
 *    gives exactly what runBatchSync gives for that seed and that many fights: however the fights come back, out of
 *    order or not, and when the time runs out or Stop ends it part way (fights 0 to N - 1, N what was done in order).
 *  - Without workers, rules to give them, or once they fail: the main thread's runBatch, as before.
 * In-process stand-ins for the workers (each running batch-worker.js's own batchHost, its messages copied as a
 * browser copies them and handed back late, each worker at its own pace), and real threads (node's worker_threads).
 */
import { afterAll, describe, expect, test } from "vitest";
import { Worker as NodeWorker } from "node:worker_threads";
import { CORE_API, CORE_API_VERSION } from "../scripts/core-api.js";
import { SystemAdapter } from "../scripts/adapters/adapter-base.js";
import { GenericAdapter } from "../scripts/adapters/generic/index.js";
import { runBatchSync } from "../scripts/engine/simulator.js";
import { openPool, poolSize, poolThreads, onWorkers, MOST_WORKERS, THREAD_SHARE } from "../scripts/engine/batch-pool.js";
import { batchHost, loadRules } from "../scripts/engine/batch-worker.js";
import { expectedRuns, paceOf, fightMs, budgetMs } from "../scripts/engine/run-budget.js";
import { goldenBattles } from "./golden/battles.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { genericRules } from "../scripts/adapters/generic/rules.js";
import { fightThreads } from "../scripts/foundry/battle.js";

const FIXTURE = { url: new URL("./fixtures/three-action-rules.js", import.meta.url).href, exportName: "pf2eRules" };
const GENERIC = new GenericAdapter().workerRules();
const refOf = rules => (rules === genericRules ? GENERIC : FIXTURE);

/** What a batch's numbers are (its seed and aggregate), whatever ran it. */
const sameAs = (pooled, runs, spec, rules, seed) => expect(pooled).toEqual(runBatchSync(spec, rules, { runs, seed }));

/**
 * A worker in this thread, like a browser's: its messages copied (structuredClone, so a function in a spec fails as
 * postMessage fails), each handed on after `delay` ms, in order (a worker's messages come in the order it posts them).
 */
function standIn({ delay = () => 0, flushMs = 0, arrived = [] } = {}) {
  let last = 0;
  const w = { onmessage: null, onerror: null, onmessageerror: null, ended: false, got: [] };
  const handle = batchHost(message => {
    const copy = structuredClone(message);
    last = Math.max(last, Date.now()) + delay(message);
    setTimeout(() => {
      if ( w.ended ) return;
      for ( const f of copy.fights ?? [] ) arrived.push(f.i);
      w.onmessage?.({ data: copy });
    }, Math.max(0, last - Date.now()));
  }, { flushMs });
  w.postMessage = message => {
    const copy = structuredClone(message);
    w.got.push(copy);
    setTimeout(() => !w.ended && handle(copy), 0);
  };
  w.terminate = () => { w.ended = true; };
  return w;
}

/** A pool of stand-ins, the first slowest: their fights come back far out of order. */
function standIns(size, { flushMs = 0 } = {}) {
  const made = [];
  const arrived = [];
  let k = 0;
  const makeWorker = () => {
    const pace = size - (k++ % size);
    const w = standIn({ flushMs, arrived, delay: m => (m.type === "fights" ? 3 * pace + (m.fights[0]?.i ?? 0) % 3 : 1) });
    made.push(w);
    return w;
  };
  return { makeWorker, made, arrived };
}

/** Node's worker_threads running batch-worker.js (tests/fixtures/batch-thread.js), shaped like a browser's Worker. */
const threads = [];
function thread() {
  const t = new NodeWorker(new URL("./fixtures/batch-thread.js", import.meta.url));
  threads.push(t);
  const w = { onmessage: null, onerror: null, onmessageerror: null };
  t.on("message", data => w.onmessage?.({ data }));
  t.on("error", err => w.onerror?.({ message: err.message }));
  t.on("messageerror", err => w.onmessageerror?.(err));
  w.postMessage = message => t.postMessage(message);
  w.terminate = () => { t.terminate(); };
  return w;
}
afterAll(async () => { await Promise.all(threads.map(t => t.terminate())); });

test("the API is 22 or later, major.bug", () => {
  expect(CORE_API.major).toBeGreaterThanOrEqual(22);
  expect(CORE_API_VERSION).toBe(`${CORE_API.major}.${CORE_API.bug}`);
});

describe("the world's Planner: background workers setting", () => {
  test("on (the default): the planner's fights on the workers; off: on this thread", () => {
    const had = { Worker: globalThis.Worker, settings: game.settings };
    globalThis.Worker = function Worker() {};
    try {
      for ( const [on, threads] of [[true, poolSize()], [false, 1]] ) {
        game.settings = { get: (module, key) => (key === "plannerWorkers" ? on : undefined) };
        expect(fightThreads(new GenericAdapter())).toBe(threads);
      }
    } finally {
      globalThis.Worker = had.Worker;
      game.settings = had.settings;
    }
  });
});

describe("where a helper's rules are, for the workers (adapter.workerRules)", () => {
  test("none by default: the main thread, as before", () => {
    expect(new SystemAdapter().workerRules()).toBeNull();
    expect(onWorkers(null, () => ({}))).toBe(false);
    expect(poolThreads(null)).toBe(1);
  });

  test("the generic adapter's: its own rules module, imported as a worker imports it", async () => {
    expect(GENERIC).toEqual({ url: new URL("../scripts/adapters/generic/rules.js", import.meta.url).href, exportName: "genericRules" });
    expect((await loadRules(GENERIC)).id).toBe(genericRules.id);
  });

  test("an export that's a function makes the rules from the data (the settings they read)", async () => {
    const url = `data:text/javascript,${encodeURIComponent("export const make = data => ({ id: 'made', boost: data.boost });")}`;
    expect(await loadRules({ url, exportName: "make", data: { boost: 1.8 } })).toEqual({ id: "made", boost: 1.8 });
    await expect(loadRules({ url, exportName: "nothing" })).rejects.toThrow();
  });

  test("how many: a share of the threads (35% by default), a GB each, sixteen at most, one at least", () => {
    expect(MOST_WORKERS).toBe(16);
    expect(THREAD_SHARE).toEqual({ min: 0.1, max: 0.5, default: 0.35 });
    // (35% of the threads, rounded: room to go up to half, about the real cores where each counts twice.)
    expect([1, 2, 3, 4, 5, 8, 12, 16, 32, 64].map(n => poolSize(n, undefined))).toEqual([1, 1, 1, 1, 2, 3, 4, 6, 11, 16]);
    // (The share the settings give, kept to 10% to 50%: less of the computer for the fights.)
    expect([0.1, 0.25, 0.5, 0.9, 0, "half"].map(s => poolSize(32, undefined, s))).toEqual([3, 8, 16, 16, 3, 11]);
    expect(poolSize(8, undefined, 0.1)).toBe(1);
    // (Where the browser doesn't say: two threads, one worker.)
    expect([0, "many", null].map(n => poolSize(n, undefined))).toEqual([1, 1, 1]);
    // (A worker for each GB of memory at most, where the browser says; one at least.)
    expect([32, 8, 4, 2, 0.5, 0, "lots"].map(gb => poolSize(32, gb))).toEqual([11, 8, 4, 2, 1, 11, 11]);
    expect(poolThreads(FIXTURE, { size: 3, makeWorker: () => ({}) })).toBe(3);
  });

  test("the estimate and this computer's pace count the threads (each thread's pace)", () => {
    expect(expectedRuns(16, 10, 2, 1)).toBe(expectedRuns(16, 10, 2));
    expect(expectedRuns(16, 10, 2, 4)).toBe(Math.floor(4 * budgetMs(10) / (fightMs(16) * 2)));
    expect(paceOf(16, 10, 400, 4)).toBeCloseTo(paceOf(16, 10, 100), 9);
    expect(expectedRuns(16, 10, paceOf(16, 10, 400, 4), 4)).toBe(400);
  });
});

describe("split among workers and put back in order: what runBatchSync gives", () => {
  for ( const b of goldenBattles() ) {
    test(`${b.name}: every fight, coming back out of order`, async () => {
      const { makeWorker, made, arrived } = standIns(3);
      const pool = openPool(refOf(b.rules), { size: 3, makeWorker });
      const done = [];
      const r = await pool.run(b.spec, b.rules, { runs: 40, seed: 7, onProgress: (p, n) => done.push(n) });
      pool.close();
      expect(made).toHaveLength(3);
      expect(pool.used).toBe(3);
      // (They came back out of order: fight 1 or 2 before fight 0, ...)
      expect(arrived).toHaveLength(40);
      expect(arrived).not.toEqual([...arrived].sort((x, y) => x - y));
      sameAs(r, 40, b.spec, b.rules, 7);
      // (Each worker its interleaved share: 0, 3, 6 ...; 1, 4, 7 ...; 2, 5, 8 ...)
      expect(made.map(w => [w.got[0].first, w.got[0].step])).toEqual([[0, 3], [1, 3], [2, 3]]);
      for ( let i = 1; i < done.length; i++ ) expect(done[i]).toBeGreaterThanOrEqual(done[i - 1]);
      expect(done.at(-1)).toBe(40);
    });
  }

  test("a pool kept for several batches (the swing factors' tests): each its own", async () => {
    const { makeWorker, made } = standIns(4);
    const pool = openPool(FIXTURE, { size: 4, makeWorker });
    const [a, b] = goldenBattles();
    sameAs(await pool.run(a.spec, a.rules, { runs: 30, seed: 99 }), 30, a.spec, a.rules, 99);
    sameAs(await pool.run(b.spec, b.rules, { runs: 9, seed: 3 }), 9, b.spec, b.rules, 3);
    pool.close();
    expect(made).toHaveLength(4);
    expect(made.every(w => w.ended)).toBe(true);
  });

  test("fewer fights than workers: no more workers than fights", async () => {
    const { makeWorker, made } = standIns(4);
    const b = goldenBattles()[0];
    const pool = openPool(FIXTURE, { size: 4, makeWorker });
    sameAs(await pool.run(b.spec, b.rules, { runs: 2, seed: 5 }), 2, b.spec, b.rules, 5);
    pool.close();
    expect(made).toHaveLength(2);
  });

  test("the time up: fights 0 to N - 1 (always fight 0), nothing past the first missing", async () => {
    const b = goldenBattles().find(g => g.name === "positions");
    for ( const maxMs of [0.001, 15, 60] ) {
      const { makeWorker } = standIns(3, { flushMs: 5 });
      const pool = openPool(FIXTURE, { size: 3, makeWorker });
      const r = await pool.run(b.spec, b.rules, { runs: 20000, seed: 11, maxMs });
      pool.close();
      expect(r.runs).toBeGreaterThanOrEqual(1);
      expect(r.runs).toBeLessThan(20000);
      sameAs(r, r.runs, b.spec, b.rules, 11);
    }
  });

  test("Stop: the workers ended at once, and the fights in order so far (fight 0 at least)", async () => {
    const b = goldenBattles().find(g => g.name === "skirmish");
    const { makeWorker, made } = standIns(3);
    const pool = openPool(FIXTURE, { size: 3, makeWorker });
    const stop = new AbortController();
    const r = await pool.run(b.spec, b.rules, { runs: 300, seed: 2, signal: stop.signal, onProgress: (p, n) => { if ( n >= 25 ) stop.abort(); } });
    expect(made.every(w => w.ended)).toBe(true);
    expect(r.runs).toBeGreaterThanOrEqual(25);
    expect(r.runs).toBeLessThan(300);
    sameAs(r, r.runs, b.spec, b.rules, 2);
    // (Stopped before any came back: fight 0, here.)
    const early = new AbortController();
    early.abort();
    const pool2 = openPool(FIXTURE, { size: 3, makeWorker: standIns(3).makeWorker });
    const one = await pool2.run(b.spec, b.rules, { runs: 20000, seed: 2, signal: early.signal });
    sameAs(one, 1, b.spec, b.rules, 2);
  });
});

describe("no workers: the main thread, as before (the same fights)", () => {
  const b = goldenBattles()[0];

  test("no Web Workers here, or no rules to give them", async () => {
    expect(typeof globalThis.Worker).toBe("undefined");
    for ( const ref of [FIXTURE, null] ) {
      const pool = openPool(ref, { size: 4 });
      expect(pool.threads).toBe(1);
      sameAs(await pool.run(b.spec, b.rules, { runs: 12, seed: 4 }), 12, b.spec, b.rules, 4);
      expect(pool.used).toBe(1);
      pool.close();
    }
  });

  test("workers that fail (can't be made, a module that won't load, a spec that can't be sent, no answer): here, and here from then on", async () => {
    const quiet = console.warn;
    console.warn = () => {};
    try {
      const cases = [
        [{ ...FIXTURE, url: `${FIXTURE.url}#cannot-make` }, () => { throw new Error("no workers"); }, b.spec],
        [{ url: new URL("./fixtures/no-such-rules.js", import.meta.url).href, exportName: "rules" }, () => standIn(), b.spec],
        [{ ...FIXTURE, url: `${FIXTURE.url}#unsendable` }, () => standIn(), { ...b.spec, options: { ...b.spec.options, note: () => 1 } }],
        // (Workers that never answer: here, once the time and its grace are up.)
        [{ ...FIXTURE, url: `${FIXTURE.url}#silent` }, () => ({ postMessage() {}, terminate() {} }), b.spec, 30]
      ];
      for ( const [ref, makeWorker, spec, maxMs = null] of cases ) {
        const pool = openPool(ref, { size: 3, makeWorker, graceMs: 20 });
        expect(pool.threads).toBe(3);
        const r = await pool.run(spec, b.rules, { runs: 10, seed: 6, maxMs });
        // (In the time left: all ten, or with none left, fight 0.)
        expect(r.runs).toBe(maxMs ? 1 : 10);
        sameAs(r, r.runs, spec, b.rules, 6);
        expect(pool.used).toBe(1);
        expect(pool.threads).toBe(1);
        pool.close();
      }
    } finally {
      console.warn = quiet;
    }
  });
});

describe("on real threads (node's worker_threads, as a browser's Web Workers)", () => {
  test("each golden battle, its rules imported on each thread: what runBatchSync gives", async () => {
    const pool = openPool(FIXTURE, { size: 4, makeWorker: thread });
    for ( const b of goldenBattles() ) {
      const p = b.rules === genericRules ? openPool(GENERIC, { size: 3, makeWorker: thread }) : pool;
      sameAs(await p.run(b.spec, b.rules, { runs: 60, seed: 13 }), 60, b.spec, b.rules, 13);
      if ( p !== pool ) p.close();
    }
    pool.close();
  }, 60000);

  test("the time up on real threads: fights 0 to N - 1", async () => {
    const b = goldenBattles().find(g => g.name === "positions");
    const pool = openPool(FIXTURE, { size: 4, makeWorker: thread });
    const r = await pool.run(b.spec, b.rules, { runs: 20000, seed: 21, maxMs: 400 });
    pool.close();
    expect(pool.used).toBe(4);
    // (However few fit: on a busy machine, the threads' start takes most of the time.)
    expect(r.runs).toBeGreaterThanOrEqual(1);
    expect(r.runs).toBeLessThan(20000);
    sameAs(r, r.runs, b.spec, b.rules, 21);
  }, 60000);
});
