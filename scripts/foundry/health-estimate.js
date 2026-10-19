/**
 * How hurt a creature looks, for the story's health callouts (story/health.js), in the words of the Health Estimate
 * module where it's on: its estimation table for that creature (the world's own, by the creature's type and statuses,
 * in the GM's language), read at the share of hit points the battle has, so a planner's sample fight reads right too.
 * Called out from HE_THRESHOLD of its hit points down. A creature whose estimate the GM hides from players (Health
 * Estimate's hideEstimate), or whose token is hidden, is the GMs' alone.
 *
 * Without the module, or when anything about it fails, the core's bands (story/health.js coreHealth), the players
 * learning only what the core lets them (`playersKnow`).
 */
import { coreHealth } from "../story/health.js";

/** The module's id. */
export const HEALTH_ESTIMATE = "healthEstimate";
/** From this share of its most hit points down, Health Estimate's word is called out. */
export const HE_THRESHOLD = 0.437;

/** Health Estimate's API where the module is on and has getStage, else null. */
export function healthEstimate() {
  try {
    if ( !game.modules?.get(HEALTH_ESTIMATE)?.active ) return null;
    const api = game.healthEstimate;
    return typeof api?.getStage === "function" ? api : null;
  } catch ( err ) {
    return null;
  }
}

/**
 * A token as Health Estimate reads it: its placeable where the scene is drawn; else the document, as one (getStage reads
 * its actor; hideEstimate its document's and its actor's flags).
 */
const placeable = doc => doc.object ?? { document: doc, actor: doc.actor, name: doc.name };

/** Health Estimate's word for a token at this share of its hit points: {label, hidden}, or null (it has none). */
function estimateOf(api, doc, fraction) {
  const token = placeable(doc);
  if ( !token.actor ) return null;
  const label = api.getStage(token, fraction)?.estimate?.label;
  if ( typeof label !== "string" || !label.trim() ) return null;
  return { label: label.trim(), hidden: !!doc.hidden || !!api.hideEstimate?.(token) };
}

/** What a lookup gives back, or `fallback` where it fails. */
function safely(fn, fallback) {
  try {
    return fn();
  } catch ( err ) {
    return fallback;
  }
}

/**
 * The story's healthState option (story/health.js): (unitId, fraction) => {label, hidden} | null.
 * @param {object} options
 * @param {(unitId: string) => TokenDocument|null} options.tokenOf  the creature's token on the battle's scene
 * @param {(unitId: string) => boolean} [options.playersKnow]       without Health Estimate: may the players tell how it
 *                                                                  is (the core's rules; a hidden token, never)
 */
export function healthLookup({ tokenOf, playersKnow = () => true } = {}) {
  const api = healthEstimate();
  return (unitId, fraction) => {
    const doc = safely(() => tokenOf?.(unitId), null) ?? null;
    if ( api && doc ) {
      if ( !(fraction <= HE_THRESHOLD) ) return null;
      const said = safely(() => estimateOf(api, doc, fraction), null);
      if ( said ) return said;
    }
    const core = coreHealth(fraction);
    if ( !core ) return null;
    return { ...core, hidden: !!doc?.hidden || !safely(() => playersKnow(unitId), false) };
  };
}
