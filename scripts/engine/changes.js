/**
 * What one turn of a live battle changed on a creature, as plain data a system helper can write onto the sheet
 * (adapter.commitChanges): its state before the turn and after (simulator.js captureUnit), compared. Written once, a
 * change set says only what changed; written again, nothing more happens (the sheet already says it).
 *
 * {
 *   hp, temp, stamina, dying, wounded:  {from, to} when changed
 *   stable, prone:                      {from, to} when changed
 *   fell                                down (or dead) this turn, standing before
 *   died                                dead this turn
 *   revived                             back up this turn
 *   status                              {from, to}: a change of status (fled, surrendered, stood down, beaten ...)
 *   conditions: {set: {key: value}, cleared: [key]}  the engine's condition keys (prone apart)
 *   persistent: [{type, part}]          new persistent damage
 *   afflictions: {added: [...], changed: [...], ended: [id]}
 *   resources: {key: {from, to}}        spent (or gained)
 *   uses: {actionId: {from, to}}
 *   side: true                          its side changed (won over, taking no side, turned on someone)
 *   concessions: [...]                  given up this turn
 *   moved: {from, to}                   where it went (the core moves the token)
 * }
 * Pure.
 */
import { STATUS } from "../constants.js";

const changed = (a, b) => (a ?? null) !== (b ?? null);
const fromTo = (a, b) => (changed(a, b) ? { from: a ?? null, to: b ?? null } : undefined);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The change set from `before` to `after` (captureUnit shapes); null when nothing changed. */
export function diffOutcome(before, after) {
  if ( !before || !after ) return null;
  const out = {};
  for ( const k of ["hp", "temp", "stamina", "dying", "wounded", "stable", "prone"] ) {
    const c = fromTo(before[k], after[k]);
    if ( c ) out[k] = c;
  }
  const up = s => s === STATUS.STANDING;
  if ( up(before.status) && (after.status === STATUS.DOWN || after.status === STATUS.DEAD) ) out.fell = true;
  if ( before.status !== STATUS.DEAD && after.status === STATUS.DEAD ) out.died = true;
  if ( !up(before.status) && up(after.status) ) out.revived = true;
  if ( changed(before.status, after.status) ) out.status = { from: before.status, to: after.status };

  const set = {};
  const cleared = [];
  const was = before.conditions ?? {};
  const now = after.conditions ?? {};
  for ( const [k, v] of Object.entries(now) ) if ( (Number(v) || 0) > 0 && was[k] !== v ) set[k] = v;
  for ( const [k, v] of Object.entries(was) ) if ( (Number(v) || 0) > 0 && !((Number(now[k]) || 0) > 0) ) cleared.push(k);
  if ( Object.keys(set).length || cleared.length ) out.conditions = { set, cleared };

  const known = (before.persistent ?? []).map(p => JSON.stringify(p));
  const fresh = (after.persistent ?? []).filter(p => !known.includes(JSON.stringify(p)));
  if ( fresh.length ) out.persistent = fresh;

  const had = new Map((before.afflictions ?? []).map(a => [a.id, a]));
  const has = new Map((after.afflictions ?? []).map(a => [a.id, a]));
  const added = [...has.values()].filter(a => !had.has(a.id));
  const moved = [...has.values()].filter(a => had.has(a.id) && !sameJson(had.get(a.id), a));
  const ended = [...had.keys()].filter(id => !has.has(id));
  if ( added.length || moved.length || ended.length ) out.afflictions = { added, changed: moved, ended };

  for ( const key of ["resources", "uses"] ) {
    const diff = {};
    for ( const k of new Set([...Object.keys(before[key] ?? {}), ...Object.keys(after[key] ?? {})]) ) {
      const c = fromTo(before[key]?.[k], after[key]?.[k]);
      if ( c ) diff[k] = c;
    }
    if ( Object.keys(diff).length ) out[key] = diff;
  }

  if ( changed(before.side, after.side) || changed(before.swayed, after.swayed) || !sameJson(before.against ?? [], after.against ?? []) ) out.side = true;
  const gave = (after.concessions ?? []).slice((before.concessions ?? []).length);
  if ( gave.length ) out.concessions = gave;
  if ( before.position && after.position && (before.position.x !== after.position.x || before.position.y !== after.position.y) ) {
    out.moved = { from: before.position, to: after.position };
  }
  return Object.keys(out).length ? out : null;
}

/** Every creature's change set across a turn: {id: changes}, only those that changed. */
export function diffAll(before, after) {
  const out = {};
  for ( const [id, a] of Object.entries(after ?? {}) ) {
    const d = diffOutcome(before?.[id], a);
    if ( d ) out[id] = d;
  }
  return out;
}
