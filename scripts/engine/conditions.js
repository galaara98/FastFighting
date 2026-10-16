/**
 * The conditions the core can put on a creature, in any system: their engine keys, and which are counted (frightened
 * 2). What each one does is the engine's (battle-state.js, simulator.js: unable to act, can't move, can't see ...)
 * and the system's rules' (conditionMods, conditionWeight, modifiers). A helper adds its system's own
 * (adapter.conditionChoices), names them in the system's words (adapter.conditionLabel), and says which its sheets
 * carry (adapter.sheetCarries): those go on the sheet; the rest the core keeps.
 *
 * And the ones toward another creature (RELATIONS): afraid of it, grabbed by it, goaded by it, controlled by it, tied
 * up by it, off guard to it alone, marked by it (live.js setRelation).
 * Pure: no Foundry globals.
 */

/** {key, valued}: valued ones have a number (frightened 2); the rest are on or off. */
export const CORE_CONDITIONS = Object.freeze([
  { key: "prone" },
  { key: "offGuard" },
  { key: "frightened", valued: true },
  { key: "sickened", valued: true },
  { key: "slowed", valued: true },
  { key: "stunned", valued: true },
  { key: "clumsy", valued: true },
  { key: "enfeebled", valued: true },
  { key: "exhaustion", valued: true },
  { key: "blinded" },
  { key: "deafened" },
  { key: "silenced" },
  { key: "hidden" },
  { key: "invisible" },
  { key: "immobilized" },
  { key: "restrained" },
  { key: "grabbed" },
  { key: "paralyzed" },
  { key: "petrified" },
  { key: "unconscious" },
  { key: "asleep" },
  { key: "incapacitated" },
  { key: "confused" },
  { key: "dazed" },
  { key: "fleeing" },
  { key: "turned" },
  { key: "poisoned" },
  { key: "vulnerable" },
  { key: "disarmed" },
  { key: "bound" }
].map(Object.freeze));

/** Conditions toward another creature: who it's afraid of, grabbed by, goaded by, controlled by, tied up by, off guard to, marked by. */
export const RELATIONS = Object.freeze(["afraid", "grabbed", "goaded", "controlled", "bound", "exposedTo", "marked"]);

/** Those the GM can put on (marked: a power's own, only taken off). */
export const GM_RELATIONS = Object.freeze(RELATIONS.filter(k => k !== "marked" && k !== "bound"));

/** Is this a condition key worth taking (a short identifier)? */
export const validConditionKey = key => typeof key === "string" && /^[a-zA-Z][\w-]{0,40}$/.test(key);
