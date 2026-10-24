/**
 * Accumulates per-run summaries into batch statistics.
 */
import { STATUS, SIDES, NEUTRAL_PARTY, HOSTILE_GROUPS } from "../constants.js";

/** How a foe of the party ends a fight, for the planner's Overview (the first that fits, in this order). */
export const FOE_ENDS = Object.freeze(["slain", "down", "captured", "fled", "gaveUp", "talked", "standing"]);

/** A foe the party can loot once it has won: there, and out of it. (Anyone else's, only its body.) */
const LOOTABLE = new Set([STATUS.DEAD, STATUS.DOWN, STATUS.BOUND, STATUS.SURRENDERED, STATUS.BEATEN]);

/**
 * What the party finds on one it searches after a win (`partyWon`): a foe out of it, or anyone else's body, that a
 * player's character saw in the fight (`seen`: simulator.js summarize); its coin, its gear and the share of its team's
 * purse it fell with (`worth`). A fight in a room no one of the party ever looked into leaves its bodies unsearched.
 */
export function lootFound(r, { partyWon, foe, friend }) {
  if ( !partyWon || friend || r.seen === false ) return 0;
  return (r.status === STATUS.DEAD || (foe && LOOTABLE.has(r.status))) ? (r.worth ?? 0) : 0;
}

/** Goods changing hands in a deal. */
const DEALS = new Set(["bribe", "extort"]);

/** A PC out of it at the end: the party is wiped when every PC is. (Fled or talked out of it isn't.) */
const PC_OUT = new Set([STATUS.DEAD, STATUS.DOWN, STATUS.BOUND, STATUS.SURRENDERED, STATUS.BEATEN]);

/** How a foe ended (FOE_ENDS): talked over, else by its status. */
export function foeEnd(r) {
  if ( r.swayed ) return "talked";
  switch ( r.status ) {
    case STATUS.DEAD: return "slain";
    case STATUS.DOWN: return "down";
    case STATUS.BOUND: return "captured";
    case STATUS.FLED: return "fled";
    case STATUS.SURRENDERED: case STATUS.BEATEN: case STATUS.STOOD_DOWN: return "gaveUp";
    default: return "standing";
  }
}

function percentile(sorted, p) {
  if ( !sorted.length ) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * Only an argument: the most common reason the talks collapsed, `{cause, share (of the collapses), by: [ids]}` (the
 * creatures that most often broke them for it, at most three, most often first), or null (none collapsed).
 */
function topCollapse(collapses, total) {
  let top = null;
  for ( const [cause, c] of collapses ) if ( !top || c.n > top[1].n ) top = [cause, c];
  if ( !top || !total ) return null;
  const by = [...top[1].by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
  return { cause: top[0], share: top[1].n / total, by };
}

export function createAggregator(prep) {
  const sideIds = Object.keys(prep.sides).filter(id => id !== NEUTRAL_PARTY); // (those who take no side never win)
  const wins = Object.fromEntries(sideIds.map(id => [id, 0]));
  const units = {};
  for ( const c of prep.combatants ) {
    units[c.spec.id] = {
      standing: 0, down: 0, dead: 0, fled: 0, surrendered: 0, stoodDown: 0, beaten: 0, bound: 0, conceded: 0, switched: 0, neutral: 0, talkedDown: 0, downed: 0, involved: 0,
      hpFrac: 0, damage: 0, healing: 0, firstToFall: 0, downedWins: 0, resources: {}
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
  const collapses = new Map(); // (why they collapsed: cause -> {n, by: id -> n})
  const pcIds = prep.combatants.filter(c => c.spec.kind === "pc").map(c => c.spec.id);
  // (For the Overview: the party's lot, how the party's foes end, who joins from outside the encounter, reinforcements
  // arriving, and a foe's head falling.)
  const party = { wiped: 0, downed: 0, dead: 0, hp: 0, lostGoods: 0, costlyWins: 0 };
  const losses = []; // (each fight's PCs down, for the worst tenth)
  // (Money, in the smallest coin: what the party's side gains, and loses; fights with a deal struck.)
  const friendIds = new Set(prep.combatants.filter(c => c.spec.side === SIDES.FRIENDLY).map(c => c.spec.id));
  const money = { gained: 0, lost: 0, deals: 0, looted: 0 };
  const foeIds = new Set(prep.combatants.filter(c => HOSTILE_GROUPS.includes(c.spec.side)).map(c => c.spec.id));
  const foeEnds = Object.fromEntries(FOE_ENDS.map(k => [k, 0]));
  let foesSeen = 0;
  const bystanderIds = new Set(prep.combatants.filter(c => c.spec.inEncounter === false && !c.spec.hazard).map(c => c.spec.id));
  let joinedRuns = 0;
  let reinforcedRuns = 0;
  const foeHeads = HOSTILE_GROUPS.map(key => prep.command?.[key]?.[0]?.id).filter(id => id && units[id]);
  let headFellRuns = 0;

  return {
    add(result, seed) {
      runs += 1;
      rounds.push(result.rounds);
      if ( result.outcome === "stalemate" ) stalemate += 1;
      else if ( result.outcome === "none" ) none += 1;
      else for ( const w of result.winners ) wins[w] += 1;
      samples.push({ seed, rounds: result.rounds, key: result.outcome === "victory" ? result.winners.join("+") : result.outcome });

      let pcDead = false;
      let anySwayed = false;
      let pcDowned = false;
      let pcsOut = 0;
      let pcsDowned = 0;
      let pcsDead = 0;
      let lostGoods = false;
      const partyWon = result.outcome === "victory" && result.winners.includes(SIDES.FRIENDLY);
      let joined = false;
      let reinforced = false;
      let dealt = false;
      for ( const [id, r] of Object.entries(result.units) ) {
        for ( const g of r.gave ?? [] ) {
          if ( DEALS.has(g.how) ) dealt = true;
          const fromFriend = friendIds.has(id);
          if ( fromFriend && !friendIds.has(g.to) ) money.lost += g.value;
          else if ( !fromFriend && friendIds.has(g.to) && g.got ) money.gained += g.value;
        }
        money.looted += lootFound(r, { partyWon, foe: foeIds.has(id), friend: friendIds.has(id) });
        if ( id.startsWith("reinforce~") ) reinforced = true;
        const u = units[id];
        if ( !u ) continue;
        if ( foeIds.has(id) && r.involved !== false ) {
          foeEnds[foeEnd(r)] += 1;
          foesSeen += 1;
        }
        if ( bystanderIds.has(id) && r.involved !== false ) joined = true;
        if ( r.involved !== false ) u.involved += 1;
        if ( r.status === STATUS.STANDING ) u.standing += 1;
        else if ( r.status === STATUS.DOWN ) u.down += 1;
        else if ( r.status === STATUS.DEAD ) u.dead += 1;
        else if ( r.status === STATUS.FLED ) u.fled += 1;
        else if ( r.status === STATUS.SURRENDERED ) u.surrendered += 1;
        else if ( r.status === STATUS.STOOD_DOWN ) u.stoodDown += 1;
        else if ( r.status === STATUS.BEATEN ) u.beaten += 1;
        else if ( r.status === STATUS.BOUND ) u.bound += 1;
        if ( r.conceded ) u.conceded += 1;
        if ( r.swayed ) {
          u.talkedDown += 1;
          if ( r.swayed === "switched" ) u.switched += 1;
          if ( r.swayed === "neutral" ) u.neutral += 1;
          anySwayed = true;
        }
        if ( r.wasDowned ) u.downed += 1;
        if ( r.wasDowned && partyWon ) u.downedWins += 1;
        u.hpFrac += r.hpFrac;
        u.damage += r.damage;
        u.healing += r.healing;
        for ( const [k, v] of Object.entries(r.resourcesUsed) ) u.resources[k] = (u.resources[k] ?? 0) + v;
        if ( pcIds.includes(id) ) {
          if ( r.status === STATUS.DEAD ) {
            pcDead = true;
            pcsDead += 1;
          }
          if ( r.wasDowned ) {
            pcDowned = true;
            pcsDowned += 1;
          }
          if ( PC_OUT.has(r.status) ) pcsOut += 1;
          if ( r.conceded ) lostGoods = true;
          party.hp += Math.min(1, Math.max(0, r.hpFrac));
        }
      }
      if ( result.firstFallen && units[result.firstFallen] ) units[result.firstFallen].firstToFall += 1;
      if ( pcDead ) anyPcDead += 1;
      if ( anySwayed ) swayedRuns += 1;
      if ( result.peaceful ) peacefulRuns += 1;
      if ( result.collapsed ) {
        collapsedRuns += 1;
        const why = result.collapseCause?.cause ?? "impatient";
        if ( !collapses.has(why) ) collapses.set(why, { n: 0, by: new Map() });
        const c = collapses.get(why);
        c.n += 1;
        const who = result.collapseCause?.by;
        if ( who ) c.by.set(who, (c.by.get(who) ?? 0) + 1);
      }
      if ( pcDowned ) anyPcDowned += 1;
      if ( pcIds.length && pcsOut === pcIds.length ) party.wiped += 1;
      party.downed += pcsDowned;
      party.dead += pcsDead;
      losses.push(pcsDowned);
      if ( dealt ) money.deals += 1;
      // (A costly win: a PC dead, or half the PCs or more gone down.)
      if ( partyWon && pcIds.length && (pcsDead > 0 || pcsDowned * 2 >= pcIds.length) ) party.costlyWins += 1;
      if ( lostGoods ) party.lostGoods += 1;
      if ( joined ) joinedRuns += 1;
      if ( reinforced ) reinforcedRuns += 1;
      if ( foeHeads.some(id => result.units[id] && foeEnd(result.units[id]) !== "standing") ) headFellRuns += 1;
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
          pBound: u.bound / n,
          pConceded: u.conceded / n,
          pSwitched: u.switched / n,
          pNeutral: u.neutral / n,
          pTalkedDown: u.talkedDown / n,
          pInvolved: u.involved / n,
          bystander: c.spec.inEncounter === false,
          pDowned: u.downed / n,
          meanHpFrac: u.hpFrac / n,
          meanDamage: u.damage / n,
          meanHealing: u.healing / n,
          pFirstToFall: u.firstToFall / n,
          // (On the party's side: its odds of winning in the fights where this one went down, and where it didn't; null
          // where it never did, or always did.)
          ...(c.spec.side === SIDES.FRIENDLY ? {
            pWinIfDowned: u.downed ? u.downedWins / u.downed : null,
            pWinIfUp: runs - u.downed ? ((wins[SIDES.FRIENDLY] ?? 0) - u.downedWins) / (runs - u.downed) : null
          } : {}),
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
        collapseCause: topCollapse(collapses, collapsedRuns),
        // The party's lot (null with no PC): wiped (every PC down, dead or taken), PCs down and dead on average, the HP
        // they're left with (a share of their most), a PC robbed or paying up.
        party: pcIds.length ? {
          pcs: pcIds.length, pWiped: party.wiped / n, meanDowned: party.downed / n, meanDead: party.dead / n,
          meanHp: party.hp / (n * pcIds.length), pLostGoods: party.lostGoods / n,
          // Of the party's wins, the costly ones (null: no wins); and the PCs down in the worst tenth of fights.
          pCostlyWin: wins[SIDES.FRIENDLY] ? party.costlyWins / wins[SIDES.FRIENDLY] : null,
          worstDowned: percentile([...losses].sort((a, b) => a - b), 0.9)
        } : null,
        // Money, in the smallest coin, on average: what the party's side gains (handed or taken to it, and, when it
        // wins, what's on the foes it has beaten), and loses (handed or taken from it); a deal struck (bribe, extortion).
        money: { gained: money.gained / n, lost: money.lost / n, looted: money.looted / n, pDeal: money.deals / n },
        // How the party's foes end (shares of every foe in every fight it took part in, FOE_ENDS), null with none.
        foesEnd: foesSeen ? Object.fromEntries(FOE_ENDS.map(k => [k, foeEnds[k] / foesSeen])) : null,
        // Someone from outside the encounter joining in; reinforcements arriving; a foe's boss or leader falling (or
        // fleeing, giving up, talked over). Each null where there's none to.
        pBystandersJoin: bystanderIds.size ? joinedRuns / n : null,
        pReinforced: prep.reinforcements?.size ? reinforcedRuns / n : null,
        pFoeHeadFalls: foeHeads.length ? headFellRuns / n : null,
        rounds: {
          mean: rounds.reduce((s, r) => s + r, 0) / n,
          median: percentile(sorted, 0.5),
          p10: percentile(sorted, 0.1),
          p90: percentile(sorted, 0.9),
          histogram
        },
        combatants,
        representativeSeed: representative?.seed ?? null
      };
    }
  };
}
