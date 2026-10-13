/**
 * Accumulates per-run summaries into batch statistics.
 */
import { STATUS, NEUTRAL_PARTY, SIDES } from "../constants.js";

/** The most seeds kept of each kind of fight the planner can show (a party win, a PC's death...). */
const PICKS = 64;

function percentile(sorted, p) {
  if ( !sorted.length ) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

export function createAggregator(prep) {
  const sideIds = Object.keys(prep.sides).filter(id => id !== NEUTRAL_PARTY); // (those who take no side never win)
  const wins = Object.fromEntries(sideIds.map(id => [id, 0]));
  const units = {};
  for ( const c of prep.combatants ) {
    units[c.spec.id] = {
      standing: 0, down: 0, dead: 0, fled: 0, surrendered: 0, stoodDown: 0, beaten: 0, conceded: 0, switched: 0, neutral: 0, talkedDown: 0, atMercy: 0, downed: 0, involved: 0,
      hpFrac: 0, damage: 0, healing: 0, firstToFall: 0, resources: {}
    };
  }
  const rounds = [];
  const samples = [];
  let runs = 0;
  let stalemate = 0;
  let none = 0;
  let anyPcDead = 0;
  let anyPcDowned = 0;
  let swayedRuns = 0;
  let peacefulRuns = 0;
  let collapsedRuns = 0; // (only an argument: the talks collapsed)
  const pcIds = prep.combatants.filter(c => c.spec.kind === "pc").map(c => c.spec.id);

  return {
    add(result, seed) {
      runs += 1;
      rounds.push(result.rounds);
      if ( result.outcome === "stalemate" ) stalemate += 1;
      else if ( result.outcome === "none" ) none += 1;
      else for ( const w of result.winners ) wins[w] += 1;
      const sample = { seed, rounds: result.rounds, key: result.outcome === "victory" ? result.winners.join("+") : result.outcome };
      samples.push(sample);

      let pcDead = false;
      let anySwayed = false;
      let pcDowned = false;
      for ( const [id, r] of Object.entries(result.units) ) {
        const u = units[id];
        if ( !u ) continue;
        if ( r.involved !== false ) u.involved += 1;
        if ( r.status === STATUS.STANDING ) u.standing += 1;
        else if ( r.status === STATUS.DOWN ) u.down += 1;
        else if ( r.status === STATUS.DEAD ) u.dead += 1;
        else if ( r.status === STATUS.FLED ) u.fled += 1;
        else if ( r.status === STATUS.SURRENDERED ) u.surrendered += 1;
        else if ( r.status === STATUS.STOOD_DOWN ) u.stoodDown += 1;
        else if ( r.status === STATUS.BEATEN ) u.beaten += 1;
        if ( r.conceded ) u.conceded += 1;
        if ( r.swayed ) {
          u.talkedDown += 1;
          if ( r.swayed === "switched" ) u.switched += 1;
          if ( r.swayed === "neutral" ) u.neutral += 1;
          anySwayed = true;
        }
        if ( r.atMercy ) u.atMercy += 1;
        if ( r.wasDowned ) u.downed += 1;
        u.hpFrac += r.hpFrac;
        u.damage += r.damage;
        u.healing += r.healing;
        for ( const [k, v] of Object.entries(r.resourcesUsed) ) u.resources[k] = (u.resources[k] ?? 0) + v;
        if ( pcIds.includes(id) ) {
          if ( r.status === STATUS.DEAD ) pcDead = true;
          if ( r.wasDowned ) pcDowned = true;
        }
      }
      if ( result.firstFallen && units[result.firstFallen] ) units[result.firstFallen].firstToFall += 1;
      if ( pcDead ) anyPcDead += 1;
      if ( anySwayed ) swayedRuns += 1;
      if ( result.peaceful ) peacefulRuns += 1;
      if ( result.collapsed ) collapsedRuns += 1;
      if ( pcDowned ) anyPcDowned += 1;
      sample.won = result.outcome === "victory" && result.winners.includes(SIDES.FRIENDLY);
      sample.pcDead = pcDead;
      sample.pcDowned = pcDowned;
    },

    finish() {
      const n = Math.max(1, runs);
      const sorted = [...rounds].sort((a, b) => a - b);
      const histogram = [];
      for ( const r of rounds ) histogram[r] = (histogram[r] ?? 0) + 1;
      for ( let i = 0; i < histogram.length; i++ ) histogram[i] = (histogram[i] ?? 0) / n;

      // Representative fight: the most common outcome, with the median length for that outcome.
      const byKey = {};
      for ( const s of samples ) (byKey[s.key] ??= []).push(s);
      const modal = Object.values(byKey).sort((a, b) => b.length - a.length)[0] ?? [];
      modal.sort((a, b) => a.rounds - b.rounds);
      const representative = modal[Math.floor(modal.length / 2)] ?? null;
      // Seeds of each kind of fight the planner can be asked to show, to replay one rather than search for one.
      const pick = test => samples.filter(test).slice(0, PICKS).map(s => s.seed);
      const picks = {
        partyWins: pick(s => s.won),
        partyLoses: pick(s => !s.won),
        pcDies: pick(s => s.pcDead),
        closeCall: pick(s => s.won && s.pcDowned)
      };

      const combatants = {};
      for ( const c of prep.combatants ) {
        const u = units[c.spec.id];
        combatants[c.spec.id] = {
          id: c.spec.id,
          name: c.spec.name,
          side: c.spec.side,
          kind: c.spec.kind,
          pStanding: u.standing / n,
          pDown: u.down / n,
          pDead: u.dead / n,
          pFled: u.fled / n,
          pSurrendered: u.surrendered / n,
          pStoodDown: u.stoodDown / n,
          pBeaten: u.beaten / n,
          pConceded: u.conceded / n,
          pSwitched: u.switched / n,
          pNeutral: u.neutral / n,
          pTalkedDown: u.talkedDown / n,
          pInvolved: u.involved / n,
          bystander: c.spec.inEncounter === false,
          pAtMercy: u.atMercy / n,
          pDowned: u.downed / n,
          meanHpFrac: u.hpFrac / n,
          meanDamage: u.damage / n,
          meanHealing: u.healing / n,
          pFirstToFall: u.firstToFall / n,
          resources: Object.fromEntries(Object.entries(u.resources).map(([k, v]) => [k, v / n]))
        };
      }
      return {
        runs,
        sides: Object.fromEntries(sideIds.map(id => [id, { id, label: prep.sides[id].label, pWin: wins[id] / n }])),
        pStalemate: stalemate / n,
        pNone: none / n,
        pAnyPcDead: anyPcDead / n,
        pAnyPcDowned: anyPcDowned / n,
        pAnySwayed: swayedRuns / n,
        pPeaceful: peacefulRuns / n,
        pCollapsed: collapsedRuns / n,
        rounds: {
          mean: rounds.reduce((s, r) => s + r, 0) / n,
          median: percentile(sorted, 0.5),
          p10: percentile(sorted, 0.1),
          p90: percentile(sorted, 0.9),
          histogram
        },
        combatants,
        representativeSeed: representative?.seed ?? null,
        picks
      };
    }
  };
}
