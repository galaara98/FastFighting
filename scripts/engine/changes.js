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
 *   effects: {added: [...], ended: [...]}  buffs and debuffs (captureUnit's: bonuses, resistances, a mark) laid, ended
 *   laid: [{key, sourceId, label, conditions}]  effects that lay conditions alone, laid this turn, with whose they are
 *                                       (API 21: for a card naming who got what; the conditions are in `conditions` too)
 *   left: {hp, effects: [...], laid: [...]}  what a player's character did to another that the table settles itself
 *                                       (Apply players' damage off: foundry/live-battle.js leaveToTable): its hit points
 *                                       not written (hp true), its effects and conditions not laid, only named
 *   concessions: [...]                  given up this turn (or taken off it: robbed while down)
 *   bound: true | false                 tied up this turn (a prisoner: behavior/fallen.js), or no longer
 *   moved: {from, to}                   where it went (the core moves the token)
 *   system: {from, to}                  what only the system's rules keep (rules.capture), when it changed (API 24: 5e's
 *                                       death save tallies, a success changing nothing else)
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
  const tag = e => `${e.key}|${e.sourceId ?? ""}`;
  const hadFx = new Map((before.effects ?? []).map(e => [tag(e), e]));
  const hasFx = new Map((after.effects ?? []).map(e => [tag(e), e]));
  const laid = [...hasFx].filter(([k]) => !hadFx.has(k)).map(([, e]) => e);
  const lifted = [...hadFx].filter(([k]) => !hasFx.has(k)).map(([, e]) => e);
  if ( laid.length || lifted.length ) out.effects = { added: laid, ended: lifted };
  const hadLaid = new Set((before.laid ?? []).map(tag));
  const freshLaid = (after.laid ?? []).filter(e => !hadLaid.has(tag(e)));
  if ( freshLaid.length ) out.laid = freshLaid;
  if ( !before.bound !== !after.bound ) out.bound = !!after.bound;
  const gave = (after.concessions ?? []).slice((before.concessions ?? []).length);
  if ( gave.length ) out.concessions = gave;
  if ( before.position && after.position && (before.position.x !== after.position.x || before.position.y !== after.position.y) ) {
    out.moved = { from: before.position, to: after.position };
  }
  if ( !sameJson(before.system ?? null, after.system ?? null) ) out.system = { from: before.system ?? null, to: after.system ?? null };
  return Object.keys(out).length ? out : null;
}

/** The hit point keys of a change set, and the falls and returns that come of them. */
const HP_KEYS = ["hp", "temp", "stamina", "dying", "wounded", "stable", "fell", "died", "revived"];
/** The statuses hit points alone move a creature between. */
const BY_HP = new Set([STATUS.STANDING, STATUS.DOWN, STATUS.DEAD]);

/**
 * A change set with what the table settles itself taken out of it (API 21): a player's character's heal, damage, buff
 * or debuff at another player's character, while Apply players' damage is off (foundry/live-battle.js tableSettles).
 * Moved to `left`, so a helper can name it, not write it:
 *  - `hp`: the turn's hit points on it aren't written (its sheet keeps its own, and the next sync reads them back), with
 *    the falls, deaths, returns and statuses they made; `left.hp` says there were some.
 *  - `from`: the creatures (ids) whose effects on it wait: each it laid (`effects.added`, `laid`) moves to `left`, and
 *    the conditions those lay aren't set (their own, or `conditionsOf(e)`: the engine's effect's).
 * Pure. Null when nothing's left to write.
 */
export function leaveToTable(changes, { hp = false, from = [], conditionsOf = () => null } = {}) {
  if ( !changes ) return changes ?? null;
  const out = { ...changes };
  const left = { hp: false, effects: [], laid: [] };
  if ( hp ) {
    left.hp = HP_KEYS.some(k => out[k] !== undefined && out[k] !== false);
    for ( const k of HP_KEYS ) delete out[k];
    if ( out.status && BY_HP.has(out.status.from) && BY_HP.has(out.status.to) ) {
      left.hp = true;
      delete out.status;
    }
  }
  const waits = new Set(from ?? []);
  if ( waits.size ) {
    if ( out.effects ) {
      left.effects = (out.effects.added ?? []).filter(e => waits.has(e.sourceId));
      const added = (out.effects.added ?? []).filter(e => !waits.has(e.sourceId));
      if ( added.length || out.effects.ended?.length ) out.effects = { ...out.effects, added };
      else delete out.effects;
    }
    if ( out.laid ) {
      left.laid = out.laid.filter(e => waits.has(e.sourceId));
      const rest = out.laid.filter(e => !waits.has(e.sourceId));
      if ( rest.length ) out.laid = rest;
      else delete out.laid;
    }
    const keys = new Set([...left.effects, ...left.laid].flatMap(e => Object.keys(e.conditions ?? conditionsOf(e) ?? {})));
    if ( out.conditions && keys.size ) {
      const set = Object.fromEntries(Object.entries(out.conditions.set ?? {}).filter(([k]) => !keys.has(k)));
      if ( Object.keys(set).length || out.conditions.cleared?.length ) out.conditions = { ...out.conditions, set };
      else delete out.conditions;
    }
  }
  if ( left.hp || left.effects.length || left.laid.length ) out.left = left;
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

/**
 * Whose side a creature is on now, when words (or a quarrel) changed it: won over (switched sides), talked out of the
 * fight (it takes no side now), or one taking no side that turned on the party. Null when nothing changed.
 * @param {object} final   its state after (captureUnit)
 * @returns {"friendly"|"hostile"|"neutral"|null}
 */
export function sideAfter(final) {
  if ( final?.swayed === "switched" ) return final.side === "friendly" ? "friendly" : "hostile";
  if ( final?.side !== "neutralParty" || final.status === "dead" ) return null;
  if ( final.against?.includes("friendly") ) return "hostile";
  return final.swayed === "neutral" ? "neutral" : null;
}
