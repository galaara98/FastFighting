/**
 * What has changed on a character since FastFighting last read it, so nothing is read again for nothing:
 *  - A count of changes for each actor (its sheet, its token, its items and their effects; a world setting counts for
 *    everyone). A character read again with its count unchanged is the read before (cachedCharacterSpec): a window
 *    opened and closed over and over reads nothing anew.
 *  - The reactions a window shows for its player to choose about (always, ask, never), checked again when the
 *    character's items or effects change: once things settle (SETTLE_MS), and at most once every RECHECK_MS for a
 *    character, however often its sheet is changed. Each window then redraws only if the list it shows really changed
 *    (tactics.js reactionsSignature).
 */
import { MODULE_ID } from "../constants.js";
import { characterSpec } from "../api.js";

/** How long a character's items and effects are left to settle before its reactions are checked again. */
const SETTLE_MS = 400;
/** The least time between two checks of one character's reactions. */
const RECHECK_MS = 2000;
/** The most characters' reads kept (the least recently read let go first). */
const SPECS_MOST = 64;

let epoch = 0;
const counts = new Map();
const specs = new Map();
const pending = new Map();
const checked = new Map();
/** The windows that show reactions: each {shows(actor) -> boolean, recheck(actor) -> Promise}. */
const views = new Set();

/** The actor a document belongs to (an item's, an effect's: on the actor or on one of its items). */
function actorOf(doc) {
  if ( !doc ) return null;
  if ( doc.documentName === "Actor" ) return doc;
  const parent = doc.parent;
  if ( parent?.documentName === "Actor" ) return parent;
  return parent?.documentName === "Item" ? parent.parent ?? null : null;
}

/** One more change to an actor. */
function changed(actor) {
  if ( actor?.uuid ) counts.set(actor.uuid, (counts.get(actor.uuid) ?? 0) + 1);
}

/**
 * Where an actor's reads stand: changed since, they're read again. An unlinked token's actor counts its base actor's
 * changes too: what the token doesn't change of it, it has from there.
 */
export const changesTo = (actor, base = actor?.isToken ? actor.token?.baseActor ?? null : null) => {
  const own = `${epoch}.${counts.get(actor?.uuid) ?? 0}`;
  return base?.uuid && base.uuid !== actor?.uuid ? `${own}.${counts.get(base.uuid) ?? 0}` : own;
};

/**
 * A character read as characterSpec reads it, or its read before when nothing about it has changed since (changesTo). A
 * copy each time: whoever asks may change it. `fresh`: read again whatever, and kept (the planner's Refresh).
 * @param {SystemAdapter} adapter
 * @param {TokenDocument} tokenDoc   its token (or its prototype's, not on a scene)
 * @param {object} [options]
 * @param {boolean} [options.fresh]
 */
export async function cachedCharacterSpec(adapter, tokenDoc, { fresh = false } = {}) {
  const actor = tokenDoc?.actor ?? null;
  if ( !actor ) return characterSpec(adapter, tokenDoc);
  const key = `${tokenDoc.parent ? tokenDoc.uuid : "prototype"}|${actor.uuid}`;
  const at = changesTo(actor, actor.isToken ? tokenDoc.baseActor ?? actor.token?.baseActor ?? null : null);
  const kept = specs.get(key);
  if ( !fresh && kept?.at === at && kept.adapter === adapter ) {
    // (Read last: kept longest.)
    specs.delete(key);
    specs.set(key, kept);
    return foundry.utils.deepClone(kept.spec);
  }
  const spec = await characterSpec(adapter, tokenDoc);
  if ( !spec ) return spec;
  specs.delete(key);
  specs.set(key, { at, adapter, spec: foundry.utils.deepClone(spec) });
  while ( specs.size > SPECS_MOST ) specs.delete(specs.keys().next().value);
  return spec;
}

/**
 * A window that shows reactions: told when one of its characters' may have changed. `shows(actor)`: does it show that
 * one's? `recheck(actor)`: read it again, and redraw if its list changed. Returns how to stop.
 */
export function showsReactions(view) {
  views.add(view);
  return () => views.delete(view);
}

/** A character's items or effects changed: its reactions checked again soon, where a window shows them. */
function recheckSoon(actor) {
  const uuid = actor?.uuid;
  if ( !uuid || pending.has(uuid) ) return;
  const watching = [...views].filter(v => {
    try {
      return v.shows(actor);
    } catch ( err ) {
      return false;
    }
  });
  if ( !watching.length ) return;
  const wait = Math.max(SETTLE_MS, RECHECK_MS - (Date.now() - (checked.get(uuid) ?? 0)));
  pending.set(uuid, setTimeout(async () => {
    pending.delete(uuid);
    checked.set(uuid, Date.now());
    for ( const v of views ) {
      try {
        if ( v.shows(actor) ) await v.recheck(actor);
      } catch ( err ) {
        console.warn(`${MODULE_ID} | checking reactions again`, err);
      }
    }
  }, wait));
}

/** The hooks that count changes and send reactions to be checked again. */
export function registerSheetWatch() {
  Hooks.on("updateActor", actor => changed(actor));
  Hooks.on("updateToken", tokenDoc => changed(tokenDoc.actor));
  Hooks.on("updateActorDelta", delta => changed(delta.parent?.actor));
  Hooks.on("deleteActor", actor => counts.delete(actor.uuid));
  for ( const kind of ["Item", "ActiveEffect"] ) {
    for ( const when of ["create", "update", "delete"] ) {
      Hooks.on(`${when}${kind}`, doc => {
        const actor = actorOf(doc);
        if ( !actor ) return;
        changed(actor);
        recheckSoon(actor);
      });
    }
  }
  // (A world setting can change how any character reads.)
  for ( const hook of ["createSetting", "updateSetting"] ) Hooks.on(hook, () => { epoch++; });
}
