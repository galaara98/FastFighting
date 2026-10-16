/**
 * The stable surface FastFighting Core offers to system helper modules (such as FastFighting PF2e).
 * Helper modules import from here so they never depend on the core's internal file layout:
 *
 *   import { SystemAdapter, parseTypedFormula, STATUS } from "../../fast-fighting/scripts/core-api.js";
 *
 * Runtime registration goes through the API passed to the "fastFighting.init" hook.
 */
/** Bumped when the helper-facing API changes incompatibly. */
export const CORE_API_VERSION = 15;

export { SystemAdapter } from "./adapters/adapter-base.js";
export { MODULE_ID, STATUS, SWAY, DOWNED_MODELS, TRAITS, TACTICAL, PC_BASELINE, clamp, fudged, tacticalTier } from "./constants.js";
export { traitsFromParts, signedNumber } from "./engine/trait-parts.js";
export { part, parseFormula, parseTypedFormula, samplePart, meanPart, maxPart, doubled, sampleDamage, meanDamage } from "./engine/dice.js";
export { degreeDistribution, rollD20 } from "./engine/probability.js";
export { TALK_KINDS } from "./engine/behavior/talk.js";
export { MORALE } from "./engine/behavior/morale.js";
export { dropCondition, applyOutcome, tauntProof, withoutTaunt } from "./engine/behavior/effects.js";
export { simpleAffliction } from "./engine/behavior/afflictions.js";
export { CORE_CONDITIONS, CONDITION_SYNONYMS, coreKeyFor } from "./engine/conditions.js";
export { edgeDistance, behaviorOf, isStanding } from "./engine/battle-state.js";
export { goadLuck } from "./engine/behavior/goad.js";
export { bestReactionStrike } from "./engine/behavior/reactions.js";
export { combineMods, describeMods, diceMean } from "./engine/mods.js";
export { localize, hasWords, fillIn, listJoin, listItems, language, outcomeLine, commonOutcome, sideChangeLine, stillLine } from "./i18n.js";
