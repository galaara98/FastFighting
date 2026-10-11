/**
 * The stable surface FastFighting Core offers to system helper modules (such as FastFighting PF2e).
 * Helper modules import from here so they never depend on the core's internal file layout:
 *
 *   import { SystemAdapter, parseTypedFormula, STATUS } from "../../fast-fighting/scripts/core-api.js";
 *
 * Runtime registration goes through the API passed to the "fastFighting.init" hook.
 */
/** Bumped when the helper-facing API changes incompatibly. */
export const CORE_API_VERSION = 7;

export { SystemAdapter } from "./adapters/adapter-base.js";
export { MODULE_ID, STATUS, SWAY, DOWNED_MODELS, TRAITS, TACTICAL, clamp, fudged, tacticalTier } from "./constants.js";
export { part, parseFormula, parseTypedFormula, samplePart, meanPart, maxPart, doubled, sampleDamage, meanDamage } from "./engine/dice.js";
export { degreeDistribution, rollD20 } from "./engine/probability.js";
export { TALK_KINDS } from "./engine/behavior/talk.js";
export { bestReactionStrike } from "./engine/behavior/reactions.js";
export { combineMods, describeMods, diceMean } from "./engine/mods.js";
