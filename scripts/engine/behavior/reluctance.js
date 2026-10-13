/**
 * Reluctance: a character who'd rather not use up consumables (potions, scrolls, alchemical bombs), or spells that cost
 * something (a spell slot, focus, a daily use), is far less willing to, until the moment demands it: a friend (or the
 * character itself) close to death, or, for a character whose playstyle is to help, a friend in a bad way.
 *
 * How readily it uses up consumables is its answer to Consumables (tactics.consumables): from "I don't like to use
 * consumables" (avoid) to "Consumables are here to get used" (freely, which values them more). Costly spells: the box
 * in Tactics (spec.avoidCostlySpells).
 */
import { STATUS } from "../../constants.js";
import { alliesOf, isStanding } from "../battle-state.js";

/** How willing a reluctant character is when nothing forces its hand. */
export const RELUCTANT = 0.1;

/** How willing each answer to Consumables is, when nothing forces its hand (above 1: it values them more). */
export const CONSUMABLE_WILL = Object.freeze({ avoid: RELUCTANT, sparing: 0.4, useful: 1, freely: 1.3 });

/** u's answer to Consumables (an older sheet's "I don't like to use consumables" box: avoid). */
export const consumablesAnswer = u => u.tac?.consumables ?? (u.spec.avoidConsumables ? "avoid" : "useful");

/** "consumable", "costlySpell", or null for what costs nothing to use. */
export function costKind(action) {
  if ( /^item:/.test(action.resource ?? "") ) return "consumable";
  const spell = (action.rank ?? 0) > 0 || !!action.spellId;
  if ( spell && (action.resource || Number.isFinite(action.uses)) ) return "costlySpell";
  return null;
}

/** How willing u is to use this action now: 1 means no qualms (above 1: it values it more). */
export function willingness(run, u, action) {
  const kind = costKind(action);
  if ( !kind ) return 1;
  const will = kind === "consumable" ? CONSUMABLE_WILL[consumablesAnswer(u)] ?? 1 : u.spec.avoidCostlySpells ? RELUCTANT : 1;
  if ( will >= 1 ) return will;
  const friends = alliesOf(run, u);
  // Someone's life at stake: a friend bleeding out, or itself nearly gone.
  if ( friends.some(a => a.status === STATUS.DOWN && !a.stable) || (u.maxHp > 0 && u.hp / u.maxHp < 0.25) ) return Math.max(will, 0.9);
  // A helper can't watch a friend suffer.
  if ( u.spec.behavior?.helps && friends.some(a => a !== u && isStanding(a) && a.maxHp > 0 && a.hp / a.maxHp < 0.5) ) return Math.max(will, 0.6);
  return will;
}

/**
 * Will u bring itself to use this (now, this round)? Decided once a round for each kind of cost, so a reluctant
 * character doesn't talk itself into it by asking again and again.
 */
export function bringsItself(run, u, action) {
  const w = willingness(run, u, action);
  if ( w >= 1 ) return true;
  const key = `${run.round}|${costKind(action)}|${w}`;
  u.willNow ??= new Map();
  if ( !u.willNow.has(key) ) u.willNow.set(key, run.rng.chance(w));
  return u.willNow.get(key);
}
