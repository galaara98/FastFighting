/**
 * Which damage family an attack is told with (story/blocks.js DAMAGE_TYPES: how harm looks in the story). In order:
 *   1. the one its system's helper names for it (action.storyType: a laser rifle is a laser, whatever its damage);
 *   2. its name's, read from the language file's word lists, where that tells more than its damage does: a plain blow
 *      or plain magic ("Wind Blade" dealing slashing is wind), or a beam or a blast its system counts as fire or
 *      lightning ("Plasma Cannon" dealing fire is plasma). A name never overrides damage that has a look of its own:
 *      "Life Drain" dealing void is still void;
 *   3. its damage types, as its system maps them (rules.storyDamageType), the one that shows: magic or energy over
 *      the blow that carries it, then a blast, then gunfire, then the plain blows.
 * Pure: the word lists come in (foundry/story-words.js reads them).
 */
import { DAMAGE_TYPES } from "./blocks.js";

/** Which kind of harm shows when there are several (lower first; anything not listed is magic or energy: 0). */
const SHOWS = { explosive: 1, ballistic: 2, bludgeoning: 3, piercing: 3, slashing: 3, bleed: 4, untyped: 5 };

/** A system's damage type as one of the families ("lightning" -> electricity); one the story doesn't know is untyped. */
const familyOf = (type, mapType) => {
  const mapped = mapType ? mapType(type) : type;
  return DAMAGE_TYPES.includes(mapped) ? mapped : "untyped";
};

/** The family damage of these types is told with (rule 3). */
export function damageFamily(types = [], mapType = null) {
  const all = (types ?? []).filter(Boolean).map(t => familyOf(t, mapType));
  return all.sort((a, b) => (SHOWS[a] ?? 0) - (SHOWS[b] ?? 0))[0] ?? "untyped";
}

/** The families a name can tell, the most particular first ("Plasma Rifle" is plasma before it's a gun). */
export const NAMED_FAMILIES = Object.freeze([
  "plasma", "laser", "radiation", "gravity", "time", "explosive", "ballistic",
  "wind", "water", "earth", "plant", "radiant", "unholy", "void", "vitality", "mental", "spirit", "poison",
  "fire", "cold", "electricity", "acid", "sonic", "force"
]);

/** Damage a name may tell more of: plain blows, and plain magic. */
const PLAIN = new Set(["bludgeoning", "piercing", "slashing", "bleed", "untyped", "force"]);
/** What a name may make of fire or lightning: what its system counts as fire is often a beam or a blast. */
const BEAMS = new Set(["laser", "plasma", "explosive", "radiation"]);

/** Does the family a name tells say more than its damage does (rule 2)? */
export function refines(named, damage) {
  if ( !named || named === damage ) return false;
  if ( PLAIN.has(damage) ) return true;
  return (damage === "fire" || damage === "electricity") && BEAMS.has(named);
}

const escaped = w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The family a name tells: the first of NAMED_FAMILIES with one of its words in it, whole, in any case. Null if none.
 * @param {string} name
 * @param {Object<string, string[]>} lists   family -> words
 */
export function nameFamily(name, lists) {
  const text = String(name ?? "");
  if ( !text ) return null;
  for ( const family of NAMED_FAMILIES ) {
    const words = lists?.[family];
    if ( !words?.length ) continue;
    if ( new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escaped).join("|")})(?![\\p{L}\\p{N}])`, "iu").test(text) ) return family;
  }
  return null;
}

/**
 * The family an action is told with, where its helper named none (rules 1 and 2): its name's, where that says more than
 * its damage; null to leave it to its damage (rule 3, as it's told).
 */
export function storyTypeFor(action, lists, mapType = null) {
  if ( action?.storyType && DAMAGE_TYPES.includes(action.storyType) ) return action.storyType;
  const named = nameFamily(action?.name, lists);
  if ( !named ) return null;
  return refines(named, damageFamily((action.damage ?? []).map(p => p.type), mapType)) ? named : null;
}
