/**
 * The stable surface FastFighting Core offers to system helper modules (such as FastFighting PF2e).
 * Helper modules import from here so they never depend on the core's internal file layout:
 *
 *   import { SystemAdapter, parseTypedFormula, STATUS } from "../../fast-fighting/scripts/core-api.js";
 *
 * Runtime registration goes through the API passed to the "fastFighting.init" hook.
 */
/**
 * The helper-facing API's version, major.bug. The major goes up when what a helper can use changes (something new it
 * may rely on, or something changed); the bug number when the core fixes something and nothing a helper uses changes.
 * Whether a helper works with a core is the helper's to say: it keeps the majors it knows it works with (its main.js),
 * and the core never refuses one, nor keeps a list of which fit it (helpers.js knows which exist, to recommend them).
 */
export const CORE_API = Object.freeze({ major: 30, bug: 4 });
export const CORE_API_VERSION = `${CORE_API.major}.${CORE_API.bug}`;

export { SystemAdapter } from "./adapters/adapter-base.js";
export { MODULE_ID, STATUS, SWAY, DOWNED_MODELS, TRAITS, TACTICAL, PC_BASELINE, clamp, fudged, tacticalTier } from "./constants.js";
export { APTITUDES, APTITUDE_MOST, APTITUDE_AVERAGE } from "./engine/aptitudes.js";
export { traitsFromParts, partsOf, signedNumber } from "./engine/trait-parts.js";
export { part, parseFormula, parseTypedFormula, samplePart, meanPart, maxPart, doubled, sampleDamage, meanDamage } from "./engine/dice.js";
export { formulaNumber, plainDice } from "./engine/arithmetic.js";
export { degreeDistribution, rollD20, rollCheck } from "./engine/probability.js";
export { rolledParts } from "./engine/table-rolls.js";
export { rollJson, AUDIENCE } from "./foundry/table-rolls.js";
export { damageApplied } from "./foundry/applied-cards.js";
export { TALK_KINDS } from "./engine/behavior/talk.js";
export { MORALE } from "./engine/behavior/morale.js";
export { dropCondition, applyOutcome, tauntProof, withoutTaunt } from "./engine/behavior/effects.js";
export { simpleAffliction } from "./engine/behavior/afflictions.js";
export { holderOf, cutOff } from "./engine/behavior/troubles.js";
export { CORE_CONDITIONS, CONDITION_SYNONYMS, coreKeyFor } from "./engine/conditions.js";
export { edgeDistance, behaviorOf, isStanding, coverOf, COVER_POINTS, areEnemies, systemRolled } from "./engine/battle-state.js";
export { SURPRISE, hiddenSides } from "./engine/behavior/surprise.js";
export { hiddenFrom } from "./engine/behavior/senses.js";
export { goadLuck } from "./engine/behavior/goad.js";
export { bestReactionStrike } from "./engine/behavior/reactions.js";
export { combineMods, describeMods, diceMean } from "./engine/mods.js";
export { localize, hasWords, fillIn, listJoin, listItems, language, outcomeLine, commonOutcome, sideChangeLine, stillLine, englishWords, listWords, wordList, saysWord, escapeHtml, inertHtml } from "./i18n.js";
export { sideAfter } from "./engine/changes.js";
export {
  statusesOf, statusEntry, toggleStatus, undoRecord, payFrom, handOverItem, englishName, englishDescription, DESCRIPTION_MOST, plainText,
  numberSetting, idFromUuid, tokenIdIn
} from "./foundry/sheet-tools.js";
