/**
 * Food and meat, as the system's helper says (API 27). Its hooks are all optional: a system that keeps no food of its
 * own has none of them, and then nothing is food and no one hungers.
 *   appetite(actor, spec) -> {diet: "meat" | "any" | "plants" | null, hunger: 0..1, cannibal}: what it eats (null:
 *     nothing, a construct or a robot) and how likely it is to come to a fight hungry, by the helper's own scoring.
 *   meatFor(actor, spec) -> {item: item data (its quantity set), quantity: portions} or null: what its body leaves
 *     when it dies (null: no flesh).
 *   isFood(item) -> {portions, meat} or null: whether a thing it carries, or that lies in a pile, can be eaten.
 * The GM's word on a creature's hunger, on its token's FastFighting tab (flags.fast-fighting.hunger), beats the roll
 * (engine/behavior/hunger.js).
 */
import { MODULE_ID, clamp } from "../constants.js";
import { getAdapter } from "../api.js";

/** The GM's marks for a creature's hunger: FastFighting decides (""), famished, hungry, or not hungry ("sated"). */
export const HUNGER_MARKS = Object.freeze(["", "famished", "hungry", "sated"]);

/** Diets the engine knows. */
const DIETS = new Set(["meat", "any", "plants"]);

/** Does the helper speak of food at all (its system keeps food)? */
export const knowsFood = (adapter = getAdapter()) => typeof adapter?.appetite === "function";

/**
 * What the engine needs of a creature's hunger and body, for its spec: {diet, hunger, cannibal, hungry (the GM's
 * mark, or null), meat (portions its body would leave)}. Nothing where the helper doesn't say.
 */
export function appetiteOf(actor, spec, adapter = getAdapter()) {
  const out = {};
  let said = null;
  let meat = null;
  try {
    said = knowsFood(adapter) ? adapter.appetite(actor, spec) : null;
    meat = typeof adapter?.meatFor === "function" ? adapter.meatFor(actor, spec) : null;
  } catch ( err ) {
    console.warn(`${MODULE_ID} | ${actor?.name}'s appetite`, err);
  }
  if ( said ) {
    out.diet = DIETS.has(said.diet) ? said.diet : null;
    out.hunger = clamp(Number(said.hunger) || 0, 0, 1);
    out.cannibal = !!said.cannibal;
    // (Not one a player owns: its flags are the player's to write.)
    const mark = actor?.hasPlayerOwner ? "" : actor?.getFlag?.(MODULE_ID, "hunger") ?? "";
    out.hungry = HUNGER_MARKS.includes(mark) && mark ? mark : null;
  }
  const portions = Math.max(0, Math.round(Number(meat?.quantity) || 0));
  if ( meat?.item && portions ) out.meat = portions;
  return out;
}

/** The meat a creature's body leaves, as goods to put on a sheet or in a pile ({items}), or null. */
export function meatGoods(actor, spec, adapter = getAdapter()) {
  if ( typeof adapter?.meatFor !== "function" ) return null;
  try {
    const meat = adapter.meatFor(actor, spec);
    return meat?.item && Number(meat.quantity) > 0 ? { items: [foundry.utils.deepClone(meat.item)], coins: null } : null;
  } catch ( err ) {
    console.warn(`${MODULE_ID} | ${actor?.name}'s meat`, err);
    return null;
  }
}

/** Whether a thing can be eaten, the helper's say: {portions, meat} or null. */
export function foodOf(item, adapter = getAdapter()) {
  if ( typeof adapter?.isFood !== "function" || !item ) return null;
  try {
    const said = adapter.isFood(item);
    return said && Number(said.portions) > 0 ? { portions: Math.round(Number(said.portions)), meat: !!said.meat } : null;
  } catch {
    return null;
  }
}
