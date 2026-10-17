/**
 * What every system helper does on a sheet the same way (core-api): an actor's statuses as its effects carry them, a
 * status in the token palette (a list or a map), a status put on or taken off with how to put it back, an empty undo
 * record (make-it-so.js revertRecord takes it back), a purse paid from, an item handed over, an item's name and
 * description as the English books have them (Babele's originals), a sheet's HTML as plain text, a world setting that
 * is a number within bounds. Each helper keeps only what its system does its own way.
 */
import { clamp } from "../constants.js";

/** An actor's statuses, read from its effects too: a system such as dcc applies them its own way, actor.statuses empty. */
export function statusesOf(actor) {
  const out = new Set(actor?.statuses ?? []);
  for ( const e of actor?.effects ?? [] ) if ( !e.disabled ) for ( const s of e.statuses ?? [] ) out.add(s);
  return out;
}

/**
 * The token palette's status with this id (CONFIG.statusEffects: Foundry's list, or a system's own by id), or null.
 * Walked through, not looked up: a palette can hold an id twice (XCC's), and making a map of it throws.
 */
export function statusEntry(id) {
  const all = globalThis.CONFIG?.statusEffects;
  if ( !all || !id ) return null;
  for ( const s of Array.isArray(all) ? all : Object.values(all) ) if ( s?.id === id ) return s;
  return null;
}

/**
 * A status put on or taken off, and how to put it back in the undo record (statuses: [{id, active, overlay}]). Nothing
 * when it's as asked already. `skip(actor, id, active)`: a system's own way to tell (dnd5e: one only part of another,
 * Incapacitated with Stunned, isn't its to take off).
 */
export async function toggleStatus(actor, id, active, undo, { overlay = false, skip = null } = {}) {
  if ( !actor || !id ) return false;
  if ( skip ? skip(actor, id, active) : statusesOf(actor).has(id) === active ) return false;
  await actor.toggleStatusEffect(id, { active, overlay });
  undo?.statuses?.push({ id, active: !active, overlay });
  return true;
}

/**
 * An undo record with nothing in it yet, for a token's actor (make-it-so.js revertRecord: every field may be left out).
 * `statusesBefore`: the statuses it has now, so whatever the system lays on along the way comes off too.
 */
export function undoRecord(tokenDoc, actor, { statusesBefore = true } = {}) {
  return {
    tokenUuid: tokenDoc?.uuid ?? null, actorUuid: actor?.uuid ?? null, actorUpdate: {}, itemUpdates: [], createdItems: [], deletedItems: [],
    createdEffects: [], deletedEffects: [], tokenUpdate: null, createdActors: [], createdTokens: [], deletedTokens: [], statuses: [],
    ...(statusesBefore && actor ? { statusesBefore: [...statusesOf(actor)] } : {})
  };
}

/**
 * `amount` (in the smallest coin) paid from a purse: small coins first, breaking a bigger coin (and taking change) when
 * that's what it takes. Null when the purse can't pay it.
 * @param {Record<string, number>} purse   coins by key
 * @param {number} amount
 * @param {[string, number][]} coins      each coin's key and worth in the smallest, smallest first (5e: cp 1 ... pp 1000)
 * @returns {Record<string, number>|null}  the purse after
 */
export function payFrom(purse, amount, coins) {
  const out = Object.fromEntries(coins.map(([k]) => [k, Number(purse?.[k]) || 0]));
  let owed = amount;
  for ( const [k, v] of coins ) {
    const n = Math.min(out[k], Math.floor(owed / v));
    out[k] -= n;
    owed -= n * v;
  }
  if ( owed > 0 ) {
    const coin = coins.find(([k, v]) => out[k] > 0 && v >= owed);
    if ( !coin ) return null;
    out[coin[0]] -= 1;
    let change = coin[1] - owed;
    for ( const [k, v] of [...coins].reverse() ) {
      if ( v >= coin[1] ) continue;
      const n = Math.floor(change / v);
      out[k] += n;
      change -= n * v;
    }
  }
  return out;
}

/**
 * One of an item handed from one creature to another (talked out of it, or stolen): one fewer on the giver (gone, if it
 * was the last), one more on the receiver (none, if there's no one to have it). `prepare(data, item)`: what the
 * system resets on the copy (dnd5e: not equipped, out of its container). Returns undo records.
 */
export async function handOverItem(giverDoc, receiverDoc, itemId, { prepare = null } = {}) {
  const giver = giverDoc?.actor;
  const item = giver?.items.get(itemId);
  if ( !item ) return [];
  const data = item.toObject();
  delete data._id;
  if ( data.system && "quantity" in data.system ) data.system.quantity = 1;
  prepare?.(data, item);
  const records = [];
  const giverUndo = undoRecord(giverDoc, giver);
  const quantity = Number(item.system?.quantity ?? 1) || 1;
  if ( quantity > 1 ) {
    giverUndo.itemUpdates.push({ id: item.id, update: { "system.quantity": quantity } });
    await item.update({ "system.quantity": quantity - 1 });
  } else {
    giverUndo.deletedItems.push(item.toObject());
    await item.delete();
  }
  records.push(giverUndo);
  const receiver = receiverDoc?.actor;
  if ( receiver ) {
    const receiverUndo = undoRecord(receiverDoc, receiver);
    const [created] = await receiver.createEmbeddedDocuments("Item", [data]);
    if ( created ) receiverUndo.createdItems.push(created.id);
    records.push(receiverUndo);
  }
  return records;
}

/**
 * The most of a description read: twice the longest the books have (about 10,000 characters). A description is item
 * data a player can write, and the GM's client reads it.
 */
export const DESCRIPTION_MOST = 20000;

/** An item's name as the English books have it (Babele keeps the original of a translated compendium's). */
export const englishName = item => item?.flags?.babele?.originalName ?? item?.name ?? "";

/** An item's description as the English books have it (up to DESCRIPTION_MOST). */
export function englishDescription(item) {
  const original = item?.flags?.babele?.originalPayload?.description;
  const text = typeof original === "string" && original ? original : item?.system?.description?.value ?? "";
  return typeof text === "string" ? text.slice(0, DESCRIPTION_MOST) : "";
}

/**
 * Text from a sheet's HTML: tags out, the usual entities read, spaces single. `bold: false`: what's in bold left out too
 * (Daggerheart's own questions on a character, so only what was written counts).
 */
export function plainText(html, { bold = true } = {}) {
  let s = String(html ?? "");
  if ( !bold ) s = s.replace(/<strong[^>]*>[\s\S]*?<\/strong>/gi, " ");
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ").trim();
}

/**
 * A world setting of a helper's that is a number within bounds: registered (on init), and read within them (its
 * default when it can't be read, or isn't a number).
 * @param {string} moduleId
 * @param {string} key
 * @param {{min: number, max: number, step?: number, default: number, name: string, hint: string}} o   name, hint: the
 *   helper's string keys
 * @returns {{register: () => void, read: () => number}}
 */
export function numberSetting(moduleId, key, { min, max, step = null, default: fallback, name, hint }) {
  return {
    register: () => game.settings.register(moduleId, key, {
      name, hint, scope: "world", config: true, type: Number, range: { min, max, ...(step ? { step } : {}) }, default: fallback
    }),
    read() {
      let v;
      try {
        v = Number(game.settings.get(moduleId, key));
      } catch ( err ) {
        return fallback;
      }
      return Number.isFinite(v) ? clamp(v, min, max) : fallback;
    }
  };
}

/**
 * The id of the token a uuid names or is inside ("Scene.s.Token.t", or an unlinked token's actor "Scene.s.Token.t.Actor.a":
 * "t"), or null when it names none (a world actor's).
 */
export const tokenIdIn = uuid => (typeof uuid === "string" && uuid.includes("Token.") ? uuid.split("Token.").pop().split(".")[0] : null);

/** The id at the end of a uuid ("Scene.x.Token.y": "y"), or the id itself; null for none. */
export const idFromUuid = ref => (typeof ref === "string" && ref ? ref.split(".").pop() : null);
