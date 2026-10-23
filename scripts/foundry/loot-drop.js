/**
 * Goods dropped on the ground in a live battle, and picked up (engine/behavior/deals.js: a bribe or a payment made
 * apart). Where they lie: an Item Piles pile when that module is on (the GM put it there); else the system's own loot
 * pile (the helper's dropValuables: PF2e's loot actor); else nowhere, and the engine hands them over at once
 * (options.dropGoods, canDropGoods). Taking goods off a sheet and putting them on one are the helper's (API 26:
 * takeGoods, putGoods, goodsOf; goods {items, coins, money}: money, in the smallest coin, coins of the helper's
 * choosing, out of a team's purse). Each step leaves undo records, for Rewind.
 * The fallen, as the loot setting leaves them ("corpse", unless "none"): a creature's token, fallen, an Item Piles pile
 * itself (up again, itself again); a player's character dead, a loot token on top of it with a copy of all it has (an
 * Item Piles pile, else the system's, else the core's own). A pile is never in a battle (isPile).
 * And, at the bottom of FastFighting's settings: Item Piles recommended, where the system has no loot pile of its own.
 */
import { MODULE_ID } from "../constants.js";
import { localize } from "../i18n.js";
import { getAdapter } from "../api.js";
import { meatGoods, foodOf } from "./food.js";
import { positionOf } from "./terrain.js";

export const ITEM_PILES = "item-piles";

/**
 * Item Piles, on in this world and able to make a pile here: it knows this system, or the GM has told it what kind of
 * actor a pile is (its "actor class type" setting; without one, as for a system it doesn't know, it can't make one).
 */
export const itemPilesOn = () => !!game.modules.get(ITEM_PILES)?.active && typeof game.itempiles?.API?.createItemPile === "function" && !!game.itempiles.API.ACTOR_CLASS_TYPE;

/** The system's own loot pile, through its helper. */
export const systemPiles = adapter => typeof adapter?.dropValuables === "function";

/** Can the helper take goods off one sheet and put them on another? */
const movesGoods = adapter => typeof adapter?.takeGoods === "function" && typeof adapter?.putGoods === "function";

/** Can goods lie on the ground at this table (Item Piles, or the system's own pile)? */
export const canDropGoods = (adapter = getAdapter()) => movesGoods(adapter) && (itemPilesOn() || systemPiles(adapter));

/** Nothing in it. */
const emptyGoods = goods => !goods?.items?.length && !goods?.coins && !(goods?.money > 0);

/** The square under a point (canvas pixels): its top-left corner. */
function squareAt(scene, point) {
  const size = scene.grid?.size ?? canvas.dimensions.size;
  const at = scene.grid?.getTopLeftPoint?.(point);
  return at ? { x: at.x, y: at.y } : { x: Math.floor(point.x / size) * size, y: Math.floor(point.y / size) * size };
}

/**
 * The goods (concessions: money, items with a count) come off the giver's sheet and lie on the ground at `point` (canvas
 * pixels): an Item Piles pile, else the system's own. {records, pile: the pile token's uuid}; with no pile made, the
 * goods taken go to `receiverDoc` instead (handed over), and `pile` is null.
 */
export async function dropGoods({ scene, point, giverDoc, receiverDoc = null, goods, minted = 0, name = "" }) {
  const adapter = getAdapter();
  if ( !movesGoods(adapter) || !giverDoc ) return { records: [], pile: null };
  const taken = await adapter.takeGoods(giverDoc, goods);
  const records = [...(taken?.records ?? [])];
  // (Money out of its team's purse, on no sheet: dropped with the rest, `minted`, in the smallest coin.)
  if ( minted > 0 ) taken.goods = { items: taken.goods?.items ?? [], coins: taken.goods?.coins ?? null, money: minted };
  if ( emptyGoods(taken?.goods) ) return { records, pile: null };
  const made = await makePile(scene, squareAt(scene, point), taken.goods, { name });
  if ( made ) return { records: [...records, ...made.records], pile: made.pile };
  // (Nowhere to put them: handed over, as if they'd met.)
  if ( receiverDoc ) records.push(...((await adapter.putGoods(receiverDoc, taken.goods)) ?? []));
  return { records, pile: null };
}

/**
 * Goods ({items, coins, money}) lying on the ground at `at` (a square's top-left): an Item Piles pile, else the system's
 * own, else (given an actor `type`) the core's own. {records, pile: its token's uuid}, or null where none could be made.
 * `over`: the token's own data besides (to lie on top of another).
 */
async function makePile(scene, at, goods, { name = "", over = {}, type = null } = {}) {
  const adapter = getAdapter();
  if ( itemPilesOn() ) {
    try {
      // (Each thing with an id of its own: Item Piles sorts what it's given by id, and things with none would be one.)
      const items = (goods.items ?? []).map(i => ({ ...i, _id: i._id || foundry.utils.randomID() }));
      const made = await game.itempiles.API.createItemPile({ position: at, sceneId: scene.id, items, tokenOverrides: { ...over, ...(name ? { name } : {}), flags: { [MODULE_ID]: { pile: true } } } });
      const token = made?.tokenUuid ? await fromUuid(made.tokenUuid) : null;
      if ( token ) {
        const records = [{ createdTokens: [token.uuid] }];
        if ( goods.coins || goods.money ) records.push(...((await adapter.putGoods(token, { items: [], coins: goods.coins, money: goods.money ?? 0 })) ?? []));
        return { records, pile: token.uuid };
      }
    } catch ( err ) {
      console.warn(`${MODULE_ID} | Item Piles couldn't make a pile`, err);
    }
  }
  if ( systemPiles(adapter) ) {
    try {
      const made = await adapter.dropValuables(scene, at, goods, { name });
      if ( made?.tokenUuid ) return { records: made.records ?? [], pile: made.tokenUuid };
    } catch ( err ) {
      console.warn(`${MODULE_ID} | the system couldn't make a pile`, err);
    }
  }
  if ( type && typeof adapter?.putGoods === "function" ) {
    try {
      return await corePile(scene, at, goods, { name, over, type });
    } catch ( err ) {
      console.warn(`${MODULE_ID} | couldn't make a pile`, err);
    }
  }
  return null;
}

/**
 * The core's own pile, where the system has none and Item Piles can't make one: an actor of `type` (the one it's
 * copied from's own, so its things fit), FastFighting's (kept out of battles: isPile; taken away by Rewind), everyone
 * able to look in, and its token at `at`.
 */
async function corePile(scene, at, goods, { name, over, type }) {
  const actor = await Actor.create({
    name, type, img: "icons/containers/bags/sack-leather-brown.webp",
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    flags: { [MODULE_ID]: { pile: true } }
  });
  const [token] = await scene.createEmbeddedDocuments("Token", [{
    ...(await actor.getTokenDocument({ x: at.x, y: at.y, ...over })).toObject(),
    actorLink: true,
    disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL
  }]);
  const records = [{ createdActors: [actor.uuid], createdTokens: [token.uuid] }];
  records.push(...((await getAdapter().putGoods(token, goods)) ?? []));
  return { records, pile: token.uuid };
}

/**
 * Whoever the goods were dropped for picks up the pile: what's in it goes onto its sheet, and the pile goes (its token,
 * and its own actor where FastFighting made one). Undo records.
 */
export async function pickUpGoods({ pileUuid, receiverDoc }) {
  const token = typeof pileUuid === "string" ? await fromUuid(pileUuid) : null;
  if ( !token || !receiverDoc ) return [];
  const adapter = getAdapter();
  const records = [];
  const goods = await adapter.goodsOf?.(token);
  if ( !emptyGoods(goods) && movesGoods(adapter) ) records.push(...((await adapter.putGoods(receiverDoc, goods)) ?? []));
  // (Its own actor, one FastFighting made for it: gone with it. Item Piles' shared pile actor stays.)
  const own = token.actorLink && token.actor?.getFlag(MODULE_ID, "pile") ? token.actor : null;
  records.push({ deletedTokens: [{ parentUuid: token.parent.uuid, data: token.toObject() }], ...(own ? { deletedActors: [own.toObject()] } : {}) });
  await token.delete();
  if ( own ) await own.delete();
  return records;
}

/**
 * What a creature took from a pile, or ate, in a live battle (behavior/forage.js `foraged`): off the pile (or, meat
 * eaten off a body, off the dead creature's sheet), and onto the taker's (eaten: gone). Undo records.
 */
export async function writeForaged(scene, takerDoc, f, sourceDoc) {
  const adapter = getAdapter();
  if ( !movesGoods(adapter) || !sourceDoc?.actor || !takerDoc ) return [];
  let goods;
  if ( f.money > 0 ) goods = [{ kind: "money", amount: f.money }];
  else if ( f.item?.id ) goods = [{ kind: "item", item: { id: f.item.id }, count: f.count ?? 1, how: "loot" }];
  else {
    // (Meat off a body: a portion of what its sheet holds that's meat.)
    const meat = sourceDoc.actor.items.find(i => foodOf(i, adapter)?.meat);
    if ( !meat ) return [];
    goods = [{ kind: "item", item: { id: meat.id }, count: f.count ?? 1, how: "loot" }];
  }
  const taken = await adapter.takeGoods(sourceDoc, goods);
  const records = [...(taken?.records ?? [])];
  if ( !f.eaten && !emptyGoods(taken?.goods) ) records.push(...((await adapter.putGoods(takerDoc, taken.goods)) ?? []));
  return records;
}

/* -------------------------------------------- */
/*  The fallen                                  */
/* -------------------------------------------- */

/** The token flag of one FastFighting made a pile as it fell: how its token was, to put back. */
const FALLEN = "fallenPile";

/**
 * A pile of goods, not a creature, never in a battle: FastFighting's own (or the system's, that it made), or Item
 * Piles' (but a creature it made one of as it fell).
 */
export function isPile(doc) {
  if ( !doc ) return false;
  if ( doc.getFlag?.(MODULE_ID, "pile") || doc.actor?.getFlag?.(MODULE_ID, "pile") ) return true;
  if ( doc.getFlag?.(MODULE_ID, FALLEN) ) return false;
  return !!game.modules.get(ITEM_PILES)?.active && !!game.itempiles?.API?.isValidItemPile?.(doc);
}

/**
 * The piles on the scene, as the engine sees them (behavior/forage.js, spec.piles): each pile token's place (feet),
 * name, money and things (value each, how many, food: foundry/food.js), through the helper's pileContents (API 27).
 * None where the helper can't say what a pile holds. Only those on the canvas's scene.
 */
export function pilesOn(adapter = getAdapter()) {
  if ( typeof adapter?.pileContents !== "function" || !canvas?.scene ) return [];
  const out = [];
  for ( const token of canvas.tokens?.placeables ?? [] ) {
    const doc = token.document;
    if ( !isPile(doc) || doc.hidden || !doc.actor ) continue;
    try {
      const held = adapter.pileContents(doc);
      if ( !held ) continue;
      const items = (held.items ?? []).filter(i => i?.id && Number(i.quantity) > 0).map(i => ({
        id: i.id, name: i.name ?? "", value: Math.max(0, Number(i.value) || 0), quantity: Number(i.quantity), food: foodOf(doc.actor.items.get(i.id), adapter)
      }));
      const money = Math.max(0, Number(held.money) || 0);
      if ( !items.length && !money ) continue;
      const at = positionOf(token);
      out.push({ id: doc.id, name: doc.name, x: at.x, y: at.y, size: at.size, money, items });
    } catch ( err ) {
      console.warn(`${MODULE_ID} | reading the pile ${doc.name}`, err);
    }
  }
  return out;
}

/** Can a dead player's character leave its things' copy on the ground (lootOnFall), as the loot setting says? */
export const leavesRemains = (mode, adapter = getAdapter()) => mode !== "none" && typeof adapter?.goodsOf === "function" && typeof adapter?.putGoods === "function";

/**
 * What the loot setting (`mode`) makes of a creature's fall, this turn's change set `ch` (engine/changes.js): a
 * creature's token (not a player character's, a hazard's or a summoned one's), fallen, an Item Piles pile itself, as
 * "corpse" asks; up again, itself again. A player's character dead: a loot token on top of it with a copy of all it
 * has (its sheet is its player's: nothing comes off it). "none": neither. {records, remains: the loot token's uuid}.
 */
export async function lootOnFall(doc, unit, ch, mode) {
  const none = { records: [], remains: null };
  if ( !doc || !unit || !ch || mode === "none" ) return none;
  if ( unit.spec.kind === "pc" ) return ch.died && leavesRemains(mode) ? remainsOf(doc) : none;
  if ( mode !== "corpse" || unit.spec.hazard || unit.summoner ) return none;
  if ( ch.fell || ch.died ) return { records: await fallenPile(doc), remains: null };
  if ( ch.revived ) return { records: await risenFromPile(doc), remains: null };
  return none;
}

/**
 * A player's character dead: a loot token on top of it, a copy of all it has; and its meat, where the GM's setting
 * says so (Dead player characters leave meat). {records, remains}.
 */
async function remainsOf(doc) {
  const goods = await getAdapter().goodsOf(doc);
  const meat = game.settings.get(MODULE_ID, "pcMeat") ? meatGoods(doc.actor, null) : null;
  if ( meat ) goods.items = [...(goods?.items ?? []), ...meat.items];
  if ( !doc.parent || emptyGoods(goods) ) return { records: [], remains: null };
  const over = { elevation: doc.elevation, sort: (doc.sort ?? 0) + 1 };
  const name = localize("FASTFIGHTING.Loot.Belongings", { name: doc.name });
  const made = await makePile(doc.parent, { x: doc.x, y: doc.y }, goods, { name, over, type: doc.actor?.type ?? null });
  return { records: made?.records ?? [], remains: made?.pile ?? null };
}

/** A fallen creature's token, an Item Piles pile (never emptied away). Undo records. */
async function fallenPile(doc) {
  const api = game.itempiles?.API;
  if ( !itemPilesOn() || doc.getFlag(MODULE_ID, FALLEN) || api.isValidItemPile?.(doc) ) return [];
  const was = { name: doc.name, texture: { src: doc.texture.src, scaleX: doc.texture.scaleX, scaleY: doc.texture.scaleY } };
  try {
    const done = await api.turnTokensIntoItemPiles([doc], { pileSettings: { deleteWhenEmpty: false }, tokenSettings: { flags: { [MODULE_ID]: { [FALLEN]: was } } } });
    return done ? [{ tokenUuid: doc.uuid, itemPile: { made: true } }] : [];
  } catch ( err ) {
    console.warn(`${MODULE_ID} | Item Piles couldn't make ${doc.name} a pile`, err);
    return [];
  }
}

/** Up again: the pile FastFighting made of it, its token again, as it was. Undo records. */
async function risenFromPile(doc) {
  const was = doc.getFlag(MODULE_ID, FALLEN);
  if ( !was || !itemPilesOn() ) return [];
  await unPile(doc, was);
  return [{ tokenUuid: doc.uuid, itemPile: { made: false, was } }];
}

const unPile = (doc, was) => game.itempiles.API.revertTokensFromItemPiles([doc], { tokenSettings: { name: was.name, texture: was.texture, flags: { [MODULE_ID]: { [FALLEN]: null } } } });

/**
 * Rewind of an `itemPile` record (make-it-so.js revertRecord), on `doc`, its token on the battle's scene: one made a pile
 * as it fell, itself again (only one FastFighting made so); one that rose, a pile again.
 */
export async function revertItemPile(r, doc) {
  if ( !doc || !r || !itemPilesOn() ) return;
  if ( r.made ) {
    const was = doc.getFlag(MODULE_ID, FALLEN);
    if ( was ) await unPile(doc, was);
  } else if ( r.was && typeof r.was === "object" && !doc.getFlag(MODULE_ID, FALLEN) ) {
    const was = { name: String(r.was.name ?? doc.name), texture: { src: r.was.texture?.src ?? doc.texture.src, scaleX: Number(r.was.texture?.scaleX) || 1, scaleY: Number(r.was.texture?.scaleY) || 1 } };
    await game.itempiles.API.turnTokensIntoItemPiles([doc], { pileSettings: { deleteWhenEmpty: false }, tokenSettings: { flags: { [MODULE_ID]: { [FALLEN]: was } } } });
  }
}

/* -------------------------------------------- */
/*  Item Piles, recommended                     */
/* -------------------------------------------- */

/**
 * What to tell the GM about Item Piles at the bottom of FastFighting's settings (HTML), or null: Item Piles is on, or
 * the system has a loot pile of its own (or there's no helper to ask).
 */
export function lootAdvice(adapter = getAdapter()) {
  if ( !adapter || systemPiles(adapter) || itemPilesOn() ) return null;
  const installed = game.modules.get(ITEM_PILES);
  // (On, but it doesn't know this system: its own settings say what a pile is.)
  if ( installed?.active ) return localize("FASTFIGHTING.Loot.ItemPilesUnset");
  return localize(installed ? "FASTFIGHTING.Loot.ItemPilesDisabled" : "FASTFIGHTING.Loot.ItemPilesMissing");
}

/** Shows lootAdvice at the bottom of FastFighting's settings, as the settings window opens. */
export function registerLootAdvice() {
  Hooks.on("renderSettingsConfig", (app, element) => {
    const section = element?.querySelector(`section.tab[data-category="${MODULE_ID}"]`);
    if ( !section ) return;
    section.querySelector(".ff-loot-advice")?.remove();
    const html = lootAdvice();
    if ( !html ) return;
    const note = document.createElement("p");
    note.className = "ff-loot-advice notes";
    note.innerHTML = html;
    section.append(note);
  });
}
