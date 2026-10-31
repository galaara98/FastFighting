/**
 * The swing factors' statistics: whether leaving a creature out (or a rule off) moves the Friendly Team's odds of
 * winning by SWING_THRESHOLD or more, found with as few fights as it takes.
 *
 *  - A fight's margin: how close it came, for the Friendly Team (marginOf): the share of its strength still standing at
 *    the end less its foes' (each creature weighed by its most HP, its HP left if it's still in the fight, else
 *    nothing), from -1 to 1. A win or a loss says little in a lopsided fight (a party winning one fight in a hundred
 *    wins none in forty); the margin moves in every fight.
 *  - The shift model (shiftModel): a test's fights moved the margins by Δ (their mean less the main run's); the main
 *    run's own fights, each moved by Δ, would have won so many more or fewer. The win line is where the main run's wins
 *    sit among its margins, so it gives back the main run's odds at Δ = 0. Leaving a creature out, its own share is left
 *    out of the margins on both sides (the main run's and the test's), so taking it away doesn't move them by itself.
 *    It holds only for a lopsided fight (one side winning under LOPSIDED of them, in the main run and the test): in a
 *    close one, a change moves fights from a clear win to a clear loss rather than every margin a little, and it
 *    understates (a party at 75% without its fighter: 7 points down by the margins, 39 by the wins).
 *  - A verdict (swingVerdict): the change in odds and how far it could be, by the plain wins, test against main run
 *    (Agresti and Caffo's interval, at SWING_Z); in a lopsided fight, by the shift model where it agrees with them
 *    (Δ's standard error at SWING_Z, the shift model's odds at either end). It matters when that, or the wins, say the
 *    change is SWING_THRESHOLD or more; it's negligible when it's under that either way, or when it looks under it once
 *    the test has as many fights as the main run (no more fights could make it surer than the main run's own odds are);
 *    else it's still open. Odds stay between 0 and 1: a party winning 1% loses 1 point at most.
 *  - The study (createSwingStudy): every test gets SWING_MIN_FIGHTS first (those the main run hints matter most first),
 *    then the open ones get the fights, the fewest first; then those that matter, until each is within SWING_SETTLED.
 *    A test whose change has held within SWING_STEADY of where it is now over the second half of its fights (twice
 *    SWING_MIN_FIGHTS at least) is calculated: it matters or not by that change. Once every test is settled, it's
 *    over; otherwise it goes on until its time runs out (run-budget.js swingBudgetMs).
 *  - Before it runs (swingPreview): the main run's own fights, where a creature fell early and where it didn't, hint
 *    at what leaving it out would do (the margin against how much of the fight it missed, through the shift model). Its
 *    side going badly is often why it fell, so the hint overstates, by far (a fighter's 75 points against 14 measured):
 *    it orders the study, and shows only as likely or unlikely to matter.
 * Pure: no Foundry globals.
 */
import { STATUS, SIDES, HOSTILE_GROUPS, clamp } from "../constants.js";

/** The change in odds (a share, 0.025: 2.5 points) under which leaving something out isn't worth a GM's while. */
export const SWING_THRESHOLD = 0.025;
/** How sure: standard errors either way (about 99%, as the study looks again after every few fights). */
export const SWING_Z = 2.5;
/** The fights every test gets before it's judged. */
export const SWING_MIN_FIGHTS = 16;
/** A test that matters is measured enough when its odds are known to within this either way (2 points). */
export const SWING_SETTLED = 0.02;
/**
 * A test's change that has stayed within this (2 points) either way of where it is now, over the second half of its
 * fights, is calculated.
 */
export const SWING_STEADY = 0.02;
/** A fight is lopsided, for the shift model, when one side wins less than this share of it (or more than 1 less this). */
export const LOPSIDED = 0.1;
/** The main run's fights kept for the shift model and the hints (the first so many: each fight is like any other). */
export const LEDGER_MOST = 4000;

/** What's left of a creature at a fight's end: its share of its HP while it's still in the fight, else nothing. */
export const leftOf = r => (r && r.status === STATUS.STANDING && !r.swayed ? clamp(Number(r.hpFrac) || 0, 0, 1) : 0);

/** How much of the fight a creature missed: the share of its rounds from the one it fell in on (0 if it didn't). */
export const absentOf = (r, rounds) => (r?.fellRound && rounds > 0 ? clamp((rounds - r.fellRound + 1) / rounds, 0, 1) : 0);

/** The Friendly Team's win in a fight's summary. */
export const friendlyWon = result => result?.outcome === "victory" && (result.winners ?? []).includes(SIDES.FRIENDLY);

/**
 * A ledger of the fights, for the shift model and the hints: each creature's weight (its most HP) and team (1 the
 * Friendly Team, -1 its foes, 0 anyone else), and each fight's win and each creature's left and absent, LEDGER_MOST
 * fights at most. `add(result)` as the aggregator takes each fight; `view()` what it holds.
 */
export function createLedger(combatants) {
  const ids = combatants.map(c => c.spec.id);
  const size = ids.length;
  const weight = Float64Array.from(combatants, c => Math.max(1, Number(c.spec.hp?.max) || 1));
  const team = Int8Array.from(combatants, c => (c.spec.side === SIDES.FRIENDLY ? 1 : HOSTILE_GROUPS.includes(c.spec.side) ? -1 : 0));
  let room = 64;
  let left = new Float32Array(room * size);
  let absent = new Float32Array(room * size);
  let won = new Uint8Array(room);
  let n = 0;
  const grow = () => {
    room = Math.min(LEDGER_MOST, room * 2);
    const more = (old, Kind, width) => {
      const a = new Kind(room * width);
      a.set(old);
      return a;
    };
    left = more(left, Float32Array, size);
    absent = more(absent, Float32Array, size);
    won = more(won, Uint8Array, 1);
  };
  return {
    add(result) {
      if ( n >= LEDGER_MOST ) return;
      if ( n >= room ) grow();
      won[n] = friendlyWon(result) ? 1 : 0;
      for ( let c = 0; c < size; c++ ) {
        const r = result.units?.[ids[c]];
        left[n * size + c] = leftOf(r);
        absent[n * size + c] = absentOf(r, result.rounds);
      }
      n += 1;
    },
    view: () => ({ ids, size, weight, team, n, won: won.subarray(0, n), left: left.subarray(0, n * size), absent: absent.subarray(0, n * size) })
  };
}

/**
 * A fight's margin for the Friendly Team (-1 to 1), from what's left of each creature (`leftAt(c)`, by its place in
 * the ledger), leaving out the one at `skip` (-1: none).
 */
function margin(ledger, leftAt, skip) {
  let friends = 0;
  let friendsMost = 0;
  let foes = 0;
  let foesMost = 0;
  for ( let c = 0; c < ledger.size; c++ ) {
    if ( c === skip || !ledger.team[c] ) continue;
    const w = ledger.weight[c];
    if ( ledger.team[c] > 0 ) {
      friends += w * leftAt(c);
      friendsMost += w;
    } else {
      foes += w * leftAt(c);
      foesMost += w;
    }
  }
  return (friendsMost ? friends / friendsMost : 0) - (foesMost ? foes / foesMost : 0);
}

/** The margin of the ledger's fight i, leaving out the creature at `skip`. */
export const ledgerMargin = (ledger, i, skip = -1) => margin(ledger, c => ledger.left[i * ledger.size + c], skip);

/** The margin of a fight's summary, weighed as the ledger weighs its creatures, leaving out the one at `skip`. */
export const resultMargin = (ledger, result, skip = -1) => margin(ledger, c => leftOf(result.units?.[ledger.ids[c]]), skip);

/** Mean and variance (n - 1) of some numbers. */
function spread(values) {
  const n = values.length;
  let sum = 0;
  for ( const v of values ) sum += v;
  const mean = n ? sum / n : 0;
  let sq = 0;
  for ( const v of values ) sq += (v - mean) ** 2;
  return { n, mean, variance: n > 1 ? sq / (n - 1) : 0 };
}

/**
 * The shift model from the main run's fights (their margins and wins): `odds(Δ)`, the share of them that would have
 * won with each margin moved by Δ (the win line where the main run's wins sit among its margins: `odds(0)` is the
 * main run's odds, ties aside), and the margins' mean and variance. Null with no fights.
 */
export function shiftModel(margins, wins) {
  const n = margins.length;
  if ( !n ) return null;
  const sorted = Float64Array.from(margins).sort();
  let k = 0;
  for ( const w of wins ) k += w ? 1 : 0;
  // (The line: between the k-th highest margin and the next, k the wins; past either end with none won, or all.)
  const high = i => sorted[n - 1 - i];
  const line = k <= 0 ? high(0) + 1e-9 : k >= n ? high(n - 1) - 1e-9 : (high(k - 1) + high(k)) / 2;
  // (How many margins are over x: by halving.)
  const over = x => {
    let lo = 0;
    let hi = n;
    while ( lo < hi ) {
      const mid = (lo + hi) >> 1;
      if ( sorted[mid] > x ) hi = mid;
      else lo = mid + 1;
    }
    return n - lo;
  };
  return { ...spread(margins), odds: shift => over(line - shift) / n };
}

/** The shift model of the main run (its ledger) with the creature at `skip` left out (-1: none). */
export function ledgerModel(ledger, skip = -1) {
  if ( !ledger?.n ) return null;
  const margins = new Float64Array(ledger.n);
  for ( let i = 0; i < ledger.n; i++ ) margins[i] = ledgerMargin(ledger, i, skip);
  return { ...shiftModel(margins, ledger.won), margins };
}

/**
 * How a test stands: the change in the Friendly Team's odds (`estimate`) and how far it could be (`lo`, `hi`), by the
 * shift model where there is one, else by the wins alone; the wins' own change (`raw`); and its `status`: "matters",
 * "negligible" or "open" (too few fights yet, or not clear). `settled`: no more fights would change what's shown.
 * @param {{n: number, wins: number, sum: number, squares: number}} test   its fights: how many, won, margins' sum and
 *   sum of squares
 * @param {object|null} model   the main run's shift model (ledgerModel), with the same creature left out
 * @param {{runs: number, pWin: number}} base   the main run's fights and the Friendly Team's odds in them
 */
export function swingVerdict(test, model, base, { threshold = SWING_THRESHOLD, z = SWING_Z, least = SWING_MIN_FIGHTS } = {}) {
  const n = test.n;
  const p0 = clamp(Number(base.pWin) || 0, 0, 1);
  const n0 = Math.max(1, Number(base.runs) || 1);
  const bound = d => clamp(d, -p0, 1 - p0);
  // (The wins alone, Agresti and Caffo: a win and a loss added to each.)
  const raw = n ? test.wins / n - p0 : 0;
  const pt = (test.wins + 1) / (n + 2);
  const pb = (p0 * n0 + 1) / (n0 + 2);
  const rawSe = Math.sqrt(pt * (1 - pt) / (n + 2) + pb * (1 - pb) / (n0 + 2));
  const rawLo = bound(pt - pb - z * rawSe);
  const rawHi = bound(pt - pb + z * rawSe);
  let estimate = raw;
  let lo = rawLo;
  let hi = rawHi;
  let byMargins = false;
  // (The margins, where the fight is lopsided in the main run and in the test alike, and they agree with the wins.)
  const tail = p => (p0 < LOPSIDED && p < LOPSIDED) || (p0 > 1 - LOPSIDED && p > 1 - LOPSIDED);
  if ( model && n > 1 && tail(n ? test.wins / n : p0) ) {
    const mean = test.sum / n;
    const variance = Math.max(0, (test.squares - n * mean * mean) / (n - 1));
    const shift = mean - model.mean;
    const se = Math.sqrt(variance / n + model.variance / model.n);
    const at0 = model.odds(0);
    const mLo = bound(model.odds(shift - z * se) - at0);
    const mHi = bound(model.odds(shift + z * se) - at0);
    if ( mLo <= rawHi && mHi >= rawLo ) {
      estimate = bound(model.odds(shift) - at0);
      lo = mLo;
      hi = mHi;
      byMargins = true;
    }
  }
  let status = "open";
  if ( n >= least ) {
    if ( lo >= threshold || hi <= -threshold || rawLo >= threshold || rawHi <= -threshold ) status = "matters";
    else if ( (lo > -threshold && hi < threshold) || (n >= n0 && Math.abs(estimate) < threshold) ) status = "negligible";
  }
  // (Measured enough: negligible; or it matters, known to within SWING_SETTLED, or as sure as the main run is.)
  const settled = status === "negligible" || (status === "matters" && ((hi - lo) / 2 <= SWING_SETTLED || n >= n0));
  return { estimate, lo, hi, raw, status, settled, byMargins };
}

/**
 * What the main run's fights hint leaving each creature out would do, before the study runs: {id: change in odds},
 * for those that fell early in enough of them (and stayed in in enough) to say; an overstatement, as its side going
 * badly is often why it fell. Empty without the main run's ledger.
 */
export function swingPreview(ledger, ids, { least = 5 } = {}) {
  const out = {};
  if ( !ledger?.n ) return out;
  for ( const id of ids ) {
    const c = ledger.ids.indexOf(id);
    if ( c < 0 ) continue;
    const model = ledgerModel(ledger, c);
    let out1 = 0;
    let in1 = 0;
    let sa = 0;
    let sm = 0;
    for ( let i = 0; i < ledger.n; i++ ) {
      const a = ledger.absent[i * ledger.size + c];
      if ( a > 0.5 ) out1 += 1;
      else in1 += 1;
      sa += a;
      sm += model.margins[i];
    }
    if ( out1 < least || in1 < least ) continue;
    const ma = sa / ledger.n;
    const mm = sm / ledger.n;
    let cov = 0;
    let va = 0;
    for ( let i = 0; i < ledger.n; i++ ) {
      const a = ledger.absent[i * ledger.size + c] - ma;
      cov += a * (model.margins[i] - mm);
      va += a * a;
    }
    if ( va <= 0 ) continue;
    // (Out of the whole fight against in all of it: the margin's slope on how much it missed.)
    out[id] = model.odds(cov / va) - model.odds(0);
  }
  return out;
}

/**
 * A swing study: its tests ({slot, spec, ...what the planner shows}; `slot` names it), measured against the main run
 * (its results, with their ledger where it has one: battle.js simulate). `pick()`: the next test to give fights to
 * ({key: its slot, spec}), or null
 * when none needs more; `heard(key, fights)`: fights' summaries come back; `rows()`: each test as it stands (its
 * verdict, `runs`, `wins`, `pWin`, and `noise`: not shown to matter). `inFlight`: chunks out at a test, for `pick`.
 */
export function createSwingStudy(tests, baseline) {
  const ledger = baseline.ledger ?? null;
  const base = { runs: baseline.runs, pWin: baseline.sides?.[SIDES.FRIENDLY]?.pWin ?? 0 };
  const hints = swingPreview(ledger, tests.filter(t => t.id).map(t => t.id));
  const state = tests.map(t => {
    const skip = ledger && t.id ? ledger.ids.indexOf(t.id) : -1;
    return {
      test: t, skip, model: ledger ? ledgerModel(ledger, skip) : null, hint: hints[t.id] ?? null,
      n: 0, wins: 0, sum: 0, squares: 0, chunks: 0, inFlight: 0, verdict: null, seen: []
    };
  });
  const byKey = new Map(state.map(s => [s.test.slot, s]));
  // (First: those the main run hints move the odds most, then the rules, then the rest.)
  const first = s => (s.hint !== null ? 1 + Math.abs(s.hint) : s.test.id ? 0 : 0.5);
  const order = [...state].sort((a, b) => first(b) - first(a));
  // (Its change as each chunk came back; steady once it has stayed within SWING_STEADY of where it is now since it had
  // half its fights.)
  const steady = (s, now) => {
    if ( s.n < 2 * SWING_MIN_FIGHTS ) return false;
    const since = s.seen.filter(([n]) => n >= s.n / 2).map(([, d]) => d);
    return since.length > 1 && since.every(d => Math.abs(d - now) <= SWING_STEADY);
  };
  const judge = s => {
    const v = swingVerdict(s, s.model, base);
    s.seen.push([s.n, v.estimate]);
    if ( !v.settled && steady(s, v.estimate) ) {
      v.status = v.status === "open" ? (Math.abs(v.estimate) >= SWING_THRESHOLD ? "matters" : "negligible") : v.status;
      v.settled = true;
      v.steady = true;
    }
    s.verdict = v;
  };
  for ( const s of state ) judge(s);
  // (Fights coming for a test: those back, and about as many as a chunk brings for each chunk out.)
  const coming = s => s.n + s.inFlight * Math.max(1, s.chunks ? s.n / s.chunks : 1);
  const fewest = list => list.reduce((best, s) => (!best || coming(s) < coming(best) ? s : best), null);
  return {
    pick() {
      const chosen = order.find(s => coming(s) < SWING_MIN_FIGHTS)
        ?? fewest(state.filter(s => s.verdict.status === "open"))
        ?? fewest(state.filter(s => !s.verdict.settled));
      if ( !chosen ) return null;
      chosen.inFlight += 1;
      return { key: chosen.test.slot, spec: chosen.test.spec };
    },
    heard(key, fights) {
      const s = byKey.get(key);
      if ( !s ) return;
      s.inFlight = Math.max(0, s.inFlight - 1);
      s.chunks += 1;
      for ( const f of fights ) {
        s.n += 1;
        if ( friendlyWon(f) ) s.wins += 1;
        if ( ledger ) {
          const m = resultMargin(ledger, f, s.skip);
          s.sum += m;
          s.squares += m * m;
        }
      }
      judge(s);
    },
    /** Every test settled: no fight would change what's shown. */
    get settled() {
      return state.every(s => s.verdict.settled);
    },
    /** The fights run so far, every test's. */
    get fights() {
      return state.reduce((sum, s) => sum + s.n, 0);
    },
    rows: () => state.map(s => {
      const { test, verdict } = s;
      const { spec, slot, ...shown } = test;
      return {
        ...shown, ...verdict, delta: verdict.estimate, runs: s.n, wins: s.wins, hint: s.hint,
        pWin: clamp(base.pWin + verdict.estimate, 0, 1), noise: verdict.status !== "matters"
      };
    }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  };
}
