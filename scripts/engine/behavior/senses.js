/**
 * Senses: what a creature can tell about another, such as a friend in trouble or a foe weak enough to finish.
 *
 * spec.senses (from the system helper) lists what it has beyond plain sight and hearing:
 *   {type, range, dark?, blind?}   range in feet (null: as far as it goes); dark: works in darkness (darkvision,
 *                                  truesight); blind: needs no sight at all (blindsight, tremorsense, scent)
 * Everyone sees (in light, across the field; in darkness only 30 feet, by whatever light there is) and hears
 * (rules.hearingFeet, 60 feet by default). Sight needs a line of sight; hearing and the senses that need no sight
 * reach around corners, within their range. Blinded: no sight. Deafened: no hearing.
 *
 * In a crisis perception bends (helping a friend, keeping someone from dying, avenging a fallen friend): any sense
 * that could plausibly reach them will do, at twice its range, with no need for a line of sight or light.
 * Without positions everyone perceives everyone. Pure: no Foundry globals.
 */
import { edgeDistance, separation, approach } from "../battle-state.js";

/** Darkness from this level up (0 to 1, the scene's) needs darkvision to see far. */
const DARK = 0.7;
const SIGHT_IN_LIGHT = 1000;
const SIGHT_IN_DARK = 30;
const HEARING = 60;

/** The senses a creature has: plain sight and hearing, plus whatever its system gives it. */
function sensesOf(run, u) {
  if ( u.prep.senses ) return u.prep.senses;
  const extra = Array.isArray(u.spec.senses) ? u.spec.senses.filter(s => s && typeof s === "object") : [];
  const darkvision = u.spec.darkvision && !extra.some(s => s.dark) ? [{ type: "darkvision", range: 60, dark: true }] : [];
  u.prep.senses = [
    { type: "sight", range: null, sight: true },
    { type: "hearing", range: run.prep.rules.hearingFeet ?? HEARING, hearing: true },
    ...darkvision,
    ...extra.map(s => ({ ...s, range: Number.isFinite(Number(s.range)) && s.range !== null ? Number(s.range) : null, sight: !s.blind && s.type !== "hearing" }))
  ];
  return u.prep.senses;
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
  const key = `${u.id}|${t.id}|${crisis ? 1 : 0}`;
  const cached = run.senseCache.get(key);
  if ( cached !== undefined ) return cached;
  const feet = edgeDistance(u, t) ?? separation(run, u, t);
  const blind = (u.conds?.blinded ?? 0) > 0;
  const deaf = (u.conds?.deafened ?? 0) > 0;
  const dark = (run.prep.options.darkness ?? 0) >= DARK;
  const los = approach(run, u, t).los !== false || u.losGained?.has(t.id);
  let found = false;
  for ( const s of sensesOf(run, u) ) {
    let range = s.range ?? Infinity;
    if ( s.type === "sight" ) range = dark ? SIGHT_IN_DARK : SIGHT_IN_LIGHT;
    if ( crisis ) range *= 2;
    if ( feet > range ) continue;
    if ( s.hearing ) {
      if ( deaf ) continue;
    } else if ( s.sight ) {
      if ( blind ) continue;
      if ( !los && !crisis ) continue;
    }
    found = true;
    break;
  }
  run.senseCache.set(key, found);
  return found;
}

/** How hurt t looks to u: its real share of hit points if u can tell, else as if unhurt. */
export function apparentHealth(run, u, t) {
  const frac = t.maxHp > 0 ? t.hp / t.maxHp : 0;
  return perceives(run, u, t) ? frac : 1;
}
