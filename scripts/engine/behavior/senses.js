/**
 * Senses: what a creature can tell about another, such as a friend in trouble or a foe weak enough to finish.
 *
 * spec.senses (from the system helper) says how far each of six senses reaches, in feet (null: as far as it goes;
 * 0: it hasn't that sense; left out: as an ordinary creature's). The helper sorts its system's senses into them:
 *   sight     seeing in good light (ordinary: across the field)
 *   lowlight  seeing in the dark: darkvision, infravision, truesight ... (ordinary: none; only 30 feet, by whatever
 *             light there is)
 *   hearing   hearing well enough to tell how someone is doing (ordinary: rules.hearingFeet, 60 feet)
 *   smell     scent, a keen nose (ordinary: none)
 *   feel      any other sense of its own, one that needs no sight: blindsight, tremorsense, lifesense ... (the
 *             farthest; ordinary: none)
 *   radar     tech sensing of any kind: radar, sonar, scanners, motion trackers ... (ordinary: none)
 * Sight needs a line of sight; smell, no wall between; hearing, feel and radar reach through walls and around corners,
 * within their range. Blinded: no sight. Deafened: no hearing. Radar is a device's: neither stops it.
 *
 * In a crisis perception bends (helping a friend, keeping someone from dying, avenging a fallen friend): any sense
 * that could plausibly reach them will do, at twice its range, with no need for a line of sight or light (a smell
 * still doesn't pass a wall).
 * Without positions everyone perceives everyone. Pure: no Foundry globals.
 */
import { edgeDistance, separation, approach } from "../battle-state.js";
import { wallsKnown, lineOfSight } from "./space.js";

/** Darkness from this level up (0 to 1, the scene's) needs seeing in the dark to see far. */
export const DARK = 0.7;
const SIGHT_IN_LIGHT = 1000;
export const SIGHT_IN_DARK = 30;
const HEARING = 60;

/** A sense's reach in feet, as the helper gave it (left out: the ordinary one). */
function reach(v, ordinary) {
  if ( v === undefined ) return ordinary;
  if ( v === null ) return Infinity;
  const n = Number(v);
  return Number.isNaN(n) ? ordinary : Math.max(0, n);
}

/**
 * How far a creature's six senses reach, in feet, from its spec (the helper's spec.senses, ordinary where it says
 * nothing).
 * @param {object} spec
 * @param {number} [hearingFeet]  The system's ordinary hearing (rules.hearingFeet)
 * @returns {{sight: number, lowlight: number, hearing: number, smell: number, feel: number, radar: number}}
 */
export function senseReach(spec, hearingFeet = HEARING) {
  const s = spec?.senses && typeof spec.senses === "object" && !Array.isArray(spec.senses) ? spec.senses : {};
  return {
    sight: reach(s.sight, SIGHT_IN_LIGHT),
    lowlight: reach(s.lowlight, 0),
    hearing: reach(s.hearing, hearingFeet),
    smell: reach(s.smell, 0),
    feel: reach(s.feel, 0),
    radar: reach(s.radar, 0)
  };
}

/** How far it sees, in the light or the dark (seeing in the dark needs eyes: no sight, none). */
export const sightReach = (r, dark) => dark ? Math.min(r.sight, Math.max(SIGHT_IN_DARK, r.lowlight)) : r.sight;

function sensesOf(run, u) {
  return u.prep.senses ??= senseReach(u.spec, run.prep.rules.hearingFeet ?? HEARING);
}

/** Can u tell how t is doing (hurt, dying, nearly done for)? */
export function perceives(run, u, t, { crisis = false } = {}) {
  if ( u === t || !run.prep.options.positioning || !u.pos || !t.pos ) return true;
  if ( u.adjacent?.has(t.id) ) return true;
  if ( run.senseGeo !== run.geo || run.senseRound !== run.round ) {
    run.senseGeo = run.geo;
    run.senseRound = run.round;
    run.senseCache = new Map();
  }
  const blind = (u.conds?.blinded ?? 0) > 0;
  const deaf = (u.conds?.deafened ?? 0) > 0;
  // (Kept by who looks, as long as it's no more or less blind or deaf than it was, then at whom: [as things are, in a
  // crisis].)
  let kept = run.senseCache.get(u);
  if ( !kept || kept.blind !== blind || kept.deaf !== deaf ) run.senseCache.set(u, kept = { blind, deaf, seen: new Map() });
  let pair = kept.seen.get(t);
  if ( !pair ) kept.seen.set(t, pair = [undefined, undefined]);
  const slot = crisis ? 1 : 0;
  if ( pair[slot] !== undefined ) return pair[slot];
  const feet = edgeDistance(u, t) ?? separation(run, u, t);
  const r = sensesOf(run, u);
  const k = crisis ? 2 : 1;
  const dark = (run.prep.options.darkness ?? 0) >= DARK;
  // (A line of sight: on a map with its walls, from where it stands now; else as the approach said, once moved toward.)
  const sees = () => !blind && feet <= sightReach(r, dark) * k
    && (crisis || (wallsKnown(run) && u.pos && t.pos ? lineOfSight(run, u, t) : approach(run, u, t).los !== false || !!u.losGained?.has(t.id)));
  const smells = () => feet <= r.smell * k && approach(run, u, t).blocked !== true;
  const found = (!deaf && feet <= r.hearing * k) || feet <= Math.max(r.feel, r.radar) * k || smells() || sees();
  pair[slot] = found;
  return found;
}

/**
 * Does u know t is there: in its senses now, seen before (desire.js seenFoes: it knows where it went), or come to
 * blows with it, either way. A foe out of sight it has never met is no one it plans around.
 */
export const knowsOf = (run, u, t) => perceives(run, u, t) || !!u.seenFoes?.has(t.id) || !!u.harmedBy?.has(t.id) || !!t.harmedBy?.has(u.id);

/** How hurt t looks to u: its real share of hit points if u can tell, else as if unhurt. */
export function apparentHealth(run, u, t) {
  const frac = t.maxHp > 0 ? t.hp / t.maxHp : 0;
  return perceives(run, u, t) ? frac : 1;
}
