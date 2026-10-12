/**
 * Specialties: what sets a character apart from anyone with a weapon and a tongue. Spells and other magic, its class's,
 * kind's or creature's own abilities (a fighter's Action Surge, a dragon's breath, a domain card, a Jammer's
 * Disrespect). The "Magic and specialties" answer says how strongly it reaches for them over the ordinary: a weapon's
 * blow, the moves anyone can make (Trip, Shove, Help, Hide, first aid), talking, gear. An Un-Mundane character leans
 * on them (its playstyle's suggestion).
 *
 * What counts: what the system marks (an action's `special`, true or false); else magic (a spell's rank, a casting, a
 * spell id); else an ability with uses of its own, or a resource that's the character's own (not an item's: gear is
 * ordinary, and so are a taunt, first aid and the moves of the system's that anyone makes).
 * Pure: no Foundry globals.
 */
import { isMagical } from "../battle-state.js";
import { hasUses } from "./evaluate.js";

/** How much likelier a specialty is, by the answer: none (as it would anyway), some, strong, always (nearly only them). */
export const SPECIALTY_WEIGHT = Object.freeze({ none: 1, some: 1.5, strong: 3, always: 10 });

/** Is this one of the character's specialties (magic, a feature of its own), or something anyone could do? */
export function isSpecial(action) {
  if ( !action ) return false;
  if ( typeof action.special === "boolean" ) return action.special;
  if ( action.consumable || action.firstAid || action.goad || action.traitMove || /^item:/.test(action.resource ?? "") ) return false;
  if ( isMagical(action) ) return true;
  return !!action.resource || Number.isFinite(action.uses) || !!action.feature;
}

/** The weight of its answer: 1 for none (or unanswered). */
const weightOf = u => SPECIALTY_WEIGHT[u?.tac?.specialty] ?? 1;

/** Does it still have a specialty it could use (anything with uses left)? */
export function hasSpecialties(u) {
  const p = u?.prep;
  if ( !p ) return false;
  return [...(p.offense ?? []), ...(p.buffActions ?? []), ...(p.healActions ?? []), ...(p.summonActions ?? [])].some(a => isSpecial(a) && hasUses(u, a));
}

/** Among its attacks: a specialty counts its answer's weight more. */
export function specialtyWeight(u, action) {
  const w = weightOf(u);
  return w > 1 && isSpecial(action) ? w : 1;
}

/**
 * Weighed against attacking (a buff, a summoning): a specialty its answer's weight more; something ordinary that much
 * less, while it has a specialty to use instead.
 */
export function specialtyLean(u, action) {
  const w = weightOf(u);
  if ( w <= 1 ) return 1;
  if ( isSpecial(action) ) return w;
  return hasSpecialties(u) ? 1 / w : 1;
}

/** How much less it talks when it might (while it has a specialty to use instead). */
export function talkDamping(u) {
  const w = weightOf(u);
  return w > 1 && hasSpecialties(u) ? 1 / w : 1;
}
