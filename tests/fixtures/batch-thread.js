/**
 * Test fixture: engine/batch-worker.js on a thread of node's worker_threads, as a browser's module Web Worker runs it
 * (engine/batch-pool.js webWorker). `workerData.hooks`: a module resolve hook to register first (a helper's tests:
 * its rules import the core as Foundry serves it, ../../fast-fighting/scripts/).
 */
import { parentPort, workerData } from "node:worker_threads";
import { register } from "node:module";

if ( workerData?.hooks ) register(workerData.hooks);
const { batchHost } = await import("../../scripts/engine/batch-worker.js");
const handle = batchHost(message => parentPort.postMessage(message), { flushMs: workerData?.flushMs ?? 25 });
parentPort.on("message", handle);
