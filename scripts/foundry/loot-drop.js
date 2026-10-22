/**
 * Goods dropped on the ground in a live battle, and picked up (engine/behavior/deals.js: a bribe or a payment made
 * apart). Where they lie: an Item Piles pile when that module is on (the GM put it there); else the system's own loot
 * pile (the helper's dropValuables: PF2e's loot actor); else nowhere, and the engine hands them over at once
 * (options.dropGoods, canDropGoods). Taking goods off a sheet and putting them on one are the helper's (API 26:
 * takeGoods, putGoods, goodsOf; goods {items, coins, money}: money, in the smallest coin, coins of the helper's
 * choosing, out of a team's purse). Each step leaves undo records, for Rewind.
 * And, at the bottom of FastFighting's settings: Item Piles recommended, where the system has no loot pile of its own.
 */
import { MODULE_ID } from "../constants.js";
import { localize } from "../i18n.js";
import { getAdapter } from "../api.js";

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
  const at = squareAt(scene, point);
  if ( itemPilesOn() ) {
    try {
      const made = await game.itempiles.API.createItemPile({ position: at, sceneId: scene.id, items: taken.goods.items ?? [], tokenOverrides: { flags: { [MODULE_ID]: { pile: true } } } });
      const token = made?.tokenUuid ? await fromUuid(made.tokenUuid) : null;
      if ( token ) {
        records.push({ createdTokens: [token.uuid] });
        if ( taken.goods.coins || taken.goods.money ) records.push(...((await adapter.putGoods(token, { items: [], coins: taken.goods.coins, money: taken.goods.money ?? 0 })) ?? []));
        return { records, pile: token.uuid };
      }
    } catch ( err ) {
      console.warn(`${MODULE_ID} | Item Piles couldn't make a pile`, err);
    }
  }
  if ( systemPiles(adapter) ) {
    try {
      const made = await adapter.dropValuables(scene, at, taken.goods, { name });
      if ( made?.tokenUuid ) return { records: [...records, ...(made.records ?? [])], pile: made.tokenUuid };
    } catch ( err ) {
      console.warn(`${MODULE_ID} | the system couldn't make a pile`, err);
    }
  }
  // (Nowhere to put them: handed over, as if they'd met.)
  if ( receiverDoc ) records.push(...((await adapter.putGoods(receiverDoc, taken.goods)) ?? []));
  return { records, pile: null };
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
