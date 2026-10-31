/**
 * The swing factors' statistics (engine/swing-stats.js) and how its fights are run (the pool's stream):
 *  - the main run's fights kept in a ledger beside its numbers (not saved with them);
 *  - the shift model gives the main run's odds back at no shift, and more with the margins moved up;
 *  - a test is negligible when the margins say the odds can't move 2.5 points, even with no wins to go by; it matters
 *    when they or the wins say they do; and odds stay between 0 and 1 (a party winning 1% loses 1 point at most);
 *  - the study gives each test its first fights, then the open ones, and stops asking once all are settled;
 *  - the stream hands chunks to whichever worker is free, a battle's spec to each worker once, here without workers.
 */
import { describe, expect, test } from "vitest";
import { runBatchSync } from "../scripts/engine/simulator.js";
import { openPool } from "../scripts/engine/batch-pool.js";
import { batchHost } from "../scripts/engine/batch-worker.js";
import {
  createLedger, shiftModel, ledgerModel, swingVerdict, swingPreview, createSwingStudy, resultMargin, SWING_MIN_FIGHTS, SWING_THRESHOLD
} from "../scripts/engine/swing-stats.js";
import { goldenBattles } from "./golden/battles.js";

const FIXTURE = { url: new URL("./fixtures/three-action-rules.js", import.meta.url).href, exportName: "pf2eRules" };

/** A fight's summary: each creature's status and HP left, who won. */
const fight = (units, won, rounds = 4) => ({
  outcome: "victory", winners: [won ? "friendly" : "hostile"], rounds,
  units: Object.fromEntries(Object.entries(units).map(([id, [hpFrac, fellRound = null]]) => [id, { status: hpFrac > 0 ? "standing" : "down", hpFrac, fellRound }]))
});
const party = [{ spec: { id: "hero", side: "friendly", hp: { max: 20 } } }, { spec: { id: "squire", side: "friendly", hp: { max: 10 } } }];
const foes = [{ spec: { id: "ogre", side: "hostile", hp: { max: 40 } } }, { spec: { id: "goblin", side: "hostile", hp: { max: 10 } } }];

/** The main run of a lopsided fight: the party wiped, the ogre hurt, two lucky wins in 200. */
function lopsided() {
  const ledger = createLedger([...party, ...foes]);
  for ( let i = 0; i < 200; i++ ) {
    const won = i < 2;
    ledger.add(fight(won ? { hero: [0.5], squire: [0.3], ogre: [0], goblin: [0] } : { hero: [0, 2], squire: [0, 1], ogre: [0.7 + (i % 5) * 0.02], goblin: [0.8] }, won));
  }
  return ledger.view();
}

/** A test's fights, as swingVerdict takes them: how many, won, the margins' sum and sum of squares. */
const tally = (margins, wins = 0) => ({ n: margins.length, wins, sum: margins.reduce((s, m) => s + m, 0), squares: margins.reduce((s, m) => s + m * m, 0) });

describe("the main run's ledger", () => {
  test("kept beside its numbers, a fight each, and not saved with them", () => {
    const b = goldenBattles()[0];
    const r = runBatchSync(b.spec, b.rules, { runs: 30, seed: 4 });
    expect(r.ledger.n).toBe(30);
    expect(r.ledger.won.reduce((s, w) => s + w, 0)).toBe(Math.round((r.sides.friendly?.pWin ?? 0) * 30));
    expect(JSON.parse(JSON.stringify(r)).ledger).toBeUndefined();
    expect(Object.keys(r)).not.toContain("ledger");
  });
});

describe("the shift model", () => {
  test("the main run's odds at no shift; more as the margins move up, all or none at the ends", () => {
    const m = shiftModel([-0.9, -0.8, -0.7, -0.6, 0.5, 0.6], [0, 0, 0, 0, 1, 1]);
    expect(m.odds(0)).toBeCloseTo(2 / 6, 9);
    expect(m.odds(0.4)).toBeCloseTo(2 / 6, 9);
    expect(m.odds(0.6)).toBeCloseTo(3 / 6, 9);
    expect(m.odds(5)).toBe(1);
    expect(m.odds(-5)).toBe(0);
    expect(shiftModel([], [])).toBeNull();
  });

  test("a creature left out: its own share left out of the margins", () => {
    const ledger = lopsided();
    const all = ledgerModel(ledger);
    const noOgre = ledgerModel(ledger, ledger.ids.indexOf("ogre"));
    // (A loss without the ogre: the party gone, the goblin's 0.8 all that's left of the foes.)
    expect(noOgre.margins[10]).toBeCloseTo(-0.8, 6);
    expect(all.margins[10]).toBeCloseTo(-(40 * 0.7 + 10 * 0.8) / 50, 6);
    expect(resultMargin(ledger, fight({ hero: [1], squire: [1], goblin: [0] }, true), ledger.ids.indexOf("ogre"))).toBeCloseTo(1, 9);
  });
});

describe("a test's verdict", () => {
  const ledger = lopsided();
  const model = ledgerModel(ledger, ledger.ids.indexOf("squire"));
  const base = { runs: 200, pWin: 0.01 };

  test("negligible by the margins, with no wins to go by: the party still wiped every time", () => {
    const margins = Array.from({ length: 20 }, (_, i) => -0.7 - (i % 5) * 0.02);
    const v = swingVerdict(tally(margins), model, base);
    expect(v.status).toBe("negligible");
    expect(v.settled).toBe(true);
    expect(Math.abs(v.estimate)).toBeLessThan(SWING_THRESHOLD);
  });

  test("it matters when the margins move far enough, or the wins do", () => {
    const v = swingVerdict(tally(Array.from({ length: 20 }, () => 0.2), 12), model, base);
    expect(v.status).toBe("matters");
    expect(v.estimate).toBeGreaterThan(0.5);
    expect(swingVerdict(tally(Array.from({ length: 40 }, () => -0.75), 30), model, base).status).toBe("matters");
  });

  test("open with too few fights; odds between 0 and 1: a party winning 1% loses 1 point at most", () => {
    expect(swingVerdict(tally([-0.7, -0.72], 0), model, base).status).toBe("open");
    const v = swingVerdict(tally(Array.from({ length: 30 }, () => -1)), model, base);
    expect(v.lo).toBeGreaterThanOrEqual(-0.01);
    expect(v.estimate).toBeGreaterThanOrEqual(-0.01);
  });

  test("without the main run's ledger: by the wins alone", () => {
    const v = swingVerdict(tally(Array(SWING_MIN_FIGHTS).fill(0), 0), null, base);
    expect(v.estimate).toBeCloseTo(-0.01, 9);
    expect(v.status).not.toBe("matters");
  });
});

describe("the hints from the main run", () => {
  test("an ally whose falling early goes with losing: a cost; one that never fell, nothing to say", () => {
    const ledger = createLedger([...party, ...foes]);
    for ( let i = 0; i < 120; i++ ) {
      const early = i % 3 === 0;
      const won = !early && i % 2 === 0;
      ledger.add(fight({ hero: [won ? 0.6 : 0, early ? 1 : null], squire: [won ? 0.5 : 0.2], ogre: [won ? 0 : 0.5], goblin: [won ? 0 : 0.6] }, won));
    }
    const hints = swingPreview(ledger.view(), ["hero", "squire"]);
    expect(hints.hero).toBeLessThan(0);
    expect(hints.squire).toBeUndefined();
  });
});

describe("the study", () => {
  const ledger = lopsided();
  const baseline = { runs: 200, sides: { friendly: { pWin: 0.01 } }, ledger };
  const tests = ["hero", "squire", "ogre"].map(id => ({ id, slot: id, label: id, spec: { id } }));

  test("each test its first fights; then the open ones; nothing more once all are settled", () => {
    const study = createSwingStudy(tests, baseline);
    const asked = new Set();
    for ( let i = 0; i < 3 * SWING_MIN_FIGHTS; i++ ) asked.add(study.pick().key);
    expect([...asked].sort()).toEqual(["hero", "ogre", "squire"]);
    // (Back: the party wiped without hero or squire; without the ogre, it wins.)
    const lost = () => fight({ hero: [0, 1], squire: [0, 1], ogre: [0.7], goblin: [0.8] }, false);
    const wins = () => fight({ hero: [0.8], squire: [0.6], goblin: [0] }, true);
    for ( let i = 0; i < SWING_MIN_FIGHTS; i++ ) {
      study.heard("hero", [lost()]);
      study.heard("squire", [lost()]);
      study.heard("ogre", [wins()]);
    }
    const rows = study.rows();
    expect(rows[0].id).toBe("ogre");
    expect(rows[0].status).toBe("matters");
    expect(rows.filter(r => r.status === "negligible").map(r => r.id).sort()).toEqual(["hero", "squire"]);
    // (The ogre matters, but isn't known closely yet: it gets the fights, until its change holds steady.)
    expect(study.settled).toBe(false);
    expect(study.pick().key).toBe("ogre");
    for ( let i = 0; i < SWING_MIN_FIGHTS && !study.settled; i++ ) study.heard("ogre", [wins()]);
    expect(study.rows()[0].steady).toBe(true);
    expect(study.settled).toBe(true);
    expect(study.pick()).toBeNull();
  });
});

/** A worker in this thread, like the pool tests': its messages copied, each handed on a moment later. */
function standIn() {
  const w = { onmessage: null, onerror: null, onmessageerror: null, ended: false, got: [] };
  const handle = batchHost(message => {
    const copy = structuredClone(message);
    setTimeout(() => !w.ended && w.onmessage?.({ data: copy }), 1);
  });
  w.postMessage = message => {
    const copy = structuredClone(message);
    w.got.push(copy);
    setTimeout(() => !w.ended && handle(copy), 0);
  };
  w.terminate = () => { w.ended = true; };
  return w;
}

describe("the pool's stream", () => {
  const [a, b] = goldenBattles();

  /** A study-like picker: so many chunks of each battle, in turn. */
  function picker(chunks) {
    const left = { a: chunks, b: chunks };
    const heard = { a: 0, b: 0 };
    return {
      heard,
      pick: () => {
        const key = left.a >= left.b ? "a" : "b";
        if ( left[key] <= 0 ) return null;
        left[key] -= 1;
        return { key, spec: key === "a" ? a.spec : b.spec };
      },
      tell: (key, fights) => { heard[key] += fights.length; }
    };
  }

  test("chunks to whichever worker is free; each battle's spec to each worker once", async () => {
    const made = [];
    const pool = openPool(FIXTURE, { size: 3, makeWorker: () => { const w = standIn(); made.push(w); return w; } });
    const p = picker(6);
    await pool.stream(a.rules, { pick: p.pick, heard: p.tell, chunkMs: 0, seed: 5 });
    pool.close();
    expect(p.heard.a).toBe(6);
    expect(p.heard.b).toBe(6);
    expect(made).toHaveLength(3);
    for ( const w of made ) {
      for ( const key of ["a", "b"] ) {
        const sent = w.got.filter(m => m.key === key);
        if ( sent.length ) expect(sent.filter(m => m.spec).length).toBe(1);
      }
    }
  });

  test("the deadline: nothing more handed out once it has passed", async () => {
    const pool = openPool(FIXTURE, { size: 2, makeWorker: standIn });
    const p = picker(10000);
    const start = Date.now();
    await pool.stream(a.rules, { pick: p.pick, heard: p.tell, chunkMs: 5, deadline: performance.timeOrigin + performance.now() + 80 });
    pool.close();
    expect(Date.now() - start).toBeLessThan(3000);
    expect(p.heard.a + p.heard.b).toBeGreaterThan(0);
  });

  test("without workers: here, a chunk at a time", async () => {
    const pool = openPool(null);
    const p = picker(3);
    await pool.stream(a.rules, { pick: p.pick, heard: p.tell, chunkMs: 0 });
    expect(p.heard).toEqual({ a: 3, b: 3 });
    expect(pool.used).toBe(1);
  });
});
