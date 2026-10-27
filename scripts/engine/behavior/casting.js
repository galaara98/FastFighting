/**
 * Spell checks whose result picks the effect (DCC): the caster rolls its casting die plus its spell check, and the
 * total says what the spell does: nothing below the lowest tier, more the higher it goes.
 *
 *   action.casting: {mod, faces?, fumbleOn?, lostOnFail?, disapproval?, label?}
 *     faces        the die (default: the creature's action die, else a d20)
 *     fumbleOn     a natural this low fails, whatever the total (default 1)
 *     lostOnFail   a failed check loses the spell for the rest of the fight (a DCC wizard loses it for the day)
 *     disapproval  a natural this low or lower fails outright, and every failure widens it by one (a DCC cleric)
 *   action.tiers: [{min, max?, ...fields}]: what the action does at totals from `min` up; a tier's fields replace the
 *     action's own (damage, save, onSave, outcome, heal, healDice, area, repeat, rounds ...), its kind stays the same
 *   action.castChance: how often a check succeeds (the helper works it out). The action's own fields are what a
 *     success most often does: what behavior weighs, times this chance.
 * Luck (or the like) may be burned on a check that falls short (see luck.js).
 * Pure: no Foundry globals.
 */
import { rollCheck } from "../probability.js";
import { systemRolled, actionKey } from "../battle-state.js";
import { boost } from "./luck.js";

/** The action as it is at each tier, lowest first (worked out once a batch). */
export function tierActionsOf(prep, action) {
  prep.tierActions ??= new Map();
  let list = prep.tierActions.get(actionKey(action));
  if ( !list ) {
    list = (action.tiers ?? [])
      .map((t, i) => ({ ...action, ...t, id: `${action.id}@${i}`, name: action.name, casting: null, tiers: null, castChance: 1, min: Number(t.min), max: Number.isFinite(Number(t.max)) ? Number(t.max) : Infinity }))
      .filter(t => Number.isFinite(t.min))
      .sort((a, b) => a.min - b.min);
    prep.tierActions.set(actionKey(action), list);
  }
  return list;
}

/** How often u's check for this action succeeds now: the action's own chance, less a cleric's widened disapproval. */
export function castChanceOf(u, action) {
  if ( !action.casting ) return 1;
  const base = action.castChance ?? 1;
  const from = action.casting.disapproval;
  if ( !from || !u?.disapproval ) return base;
  return Math.max(0, base - Math.max(0, u.disapproval - from) / (action.casting.faces ?? 20));
}

/**
 * Roll u's check for an action with tiers. Success: {action: what it does at that total, roll}. Failure: {action:
 * null, roll, fumble, disapproved, lost}, with the spell lost or the disapproval widened as the action says.
 * @param {object} run
 * @param {object} u
 * @param {object} action
 * @param {object} [options]
 * @param {number} [options.stakes]   how much rides on it (0..1), for burning Luck on a check that falls short
 * @param {Function} [options.log]    (unit, data): the run's log
 */
export function cast(run, u, action, { stakes = 0.5, log = null } = {}) {
  const c = action.casting;
  const rules = run.prep.rules;
  const faces = c.faces ?? rules.actionDie?.(u, u.actsThisTurn ?? 0) ?? 20;
  const tiers = tierActionsOf(run.prep, action);
  const lowest = tiers[0]?.min ?? Infinity;
  // (A live battle's, the system's own spell check where it makes checks: its total finds the tier, as the engine's.)
  const rolled = Number.isFinite(lowest) ? systemRolled(run, u, "check", { dc: lowest, purpose: "cast", action }) : null;
  let roll = rollCheck(rules, run.rng, Number(c.mod) || 0, lowest, { kind: "check", faces, roller: c.faces ? null : u, rolled, by: u, label: c.label || action.name || "", what: "cast" });
  // (What the roll means beyond the spell, by the system: DCC's Fleeting Luck.)
  rules.afterRoll?.(run, u, roll, { kind: "cast", action, faces });
  const range = c.disapproval ? (u.disapproval ?? c.disapproval) : 0;
  // (A cleric's natural 1 is disapproval, not a fumble: it's inside the range.)
  const fumble = !range && roll.natural <= (c.fumbleOn ?? 1);
  const disapproved = !!range && roll.natural <= range;
  if ( !fumble && !disapproved && roll.total < lowest ) roll = boost(run, u, roll, lowest, { kind: "cast", stakes, options: { faces } }, log);
  const ok = !fumble && !disapproved && roll.total >= lowest;
  if ( ok ) {
    let tier = tiers[0];
    for ( const t of tiers ) if ( roll.total >= t.min ) tier = t;
    return { action: tier, roll, faces };
  }
  if ( c.lostOnFail ) (u.lost ??= new Set()).add(action.id);
  if ( c.disapproval ) u.disapproval = range + 1;
  return { action: null, roll, faces, fumble, disapproved, lost: !!c.lostOnFail };
}
