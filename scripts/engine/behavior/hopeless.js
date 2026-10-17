/**
 * Desires it can't act on. On its turn, one it couldn't work on now (whoever it would hurt nowhere to be found or out of
 * its reach, a friend to heal with no healing left, words for one who couldn't understand them) sinks to the bottom of
 * what it wants, below everything else, and can't lead. Still out of reach on its next turn, it's given up, unless the
 * creature plans ahead (tactical or better): that one keeps it, at the bottom, until the chance comes. As soon as it can
 * act on it again, it's back where its strength puts it. What the GM holds it to stays.
 */
import { TACTICAL } from "../../constants.js";
import { movesNeeded, liveTier } from "../battle-state.js";
import { hasUses } from "./evaluate.js";
import { perceives } from "./senses.js";
import { canTalk, shareLanguage } from "./standoff.js";
import { keyOf } from "./desire.js";

/** The layers a desire given up comes out of (all but the GM's, and its controller's). */
/** Where an abandoned desire is let go of: everywhere but the GM's holds and a controller's wishes (theirs to keep). */
const LAYERS = ["stated", "memory", "frustration", "logic", "social", "style", "lean", "taunt", "cond"];

/** Something u can use, with a way to t from here. */
const reaches = (run, u, t, actions) => actions.some(a => hasUses(u, a) && Number.isFinite(movesNeeded(run, u, t, a)));

/** Could u work on this desire now: kind, toward t? */
export function canWorkOn(run, u, kind, t) {
  if ( !t ) return false;
  switch ( kind ) {
    case "hurt": return perceives(run, u, t) && reaches(run, u, t, u.prep.offense ?? []);
    case "heal": return (u.prep.healActions ?? []).some(a => hasUses(u, a)) && (t === u || perceives(run, u, t));
    case "aid": return (u.prep.buffActions ?? []).some(a => hasUses(u, a));
    case "talk": return !!run.prep.options?.talking && canTalk(u) && shareLanguage(u, t, run) && perceives(run, u, t);
    default: return true;
  }
}

/**
 * u's desires, as it thinks its turn over (simulator.js deliberate): those it can't work on now sunk (desire.sunk:
 * key -> the turn it sank), those sunk since its last turn and no nearer given up (unless it plans ahead).
 * @param {object[]} ranked   its desires (rankedDesires)
 */
export function sinkHopeless(run, u, ranked) {
  const d = u.desire;
  if ( !d ) return;
  u.mulls = (u.mulls ?? 0) + 1;
  const sunk = (d.sunk ??= new Map());
  const keeps = liveTier(run, u) >= TACTICAL.TACTICAL;
  const live = new Set();
  for ( const x of ranked ) {
    const k = keyOf(x.kind, x.targetId);
    live.add(k);
    if ( canWorkOn(run, u, x.kind, run.byId.get(x.targetId)) ) {
      sunk.delete(k);
      continue;
    }
    const since = sunk.get(k);
    if ( since === undefined ) sunk.set(k, u.mulls);
    else if ( since < u.mulls && !keeps && !d.gm?.has(k) ) {
      for ( const layer of LAYERS ) d[layer]?.delete(k);
      sunk.delete(k);
    }
  }
  // (One no longer wanted at all: nothing to keep sunk.)
  for ( const k of [...sunk.keys()] ) if ( !live.has(k) ) sunk.delete(k);
}
