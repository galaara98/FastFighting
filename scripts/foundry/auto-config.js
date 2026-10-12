/**
 * Setting a character up by itself, the first time FastFighting sees it (the planner opening on its token, its token's
 * FastFighting tab, a player's survey): its playstyles and the answers "Let it decide" stands for.
 *
 * Kept on the actor (an unlinked token's own; a prototype's is its actor's), flags.fast-fighting.auto:
 *   {api, sig, lets, picked, scores, at}
 *   api      the core API it was worked out under
 *   sig      what it was worked out from (its level, its traits, what it can do, the world's defaults): a change
 *            means working the answers out again
 *   lets     the calculated answer to every tactics question (what "Let it decide" shows, before its playstyles' say)
 *   picked   the playstyles picked for it, best first (once: see below); scores, the best few and their scores
 *
 * Playstyles are picked once: for a character that has never been set up and has none (up to four, best first:
 * engine/auto-playstyles.js), and never again, unless someone resets its FastFighting settings (then at once). Picks
 * someone has changed stay theirs.
 * The calculated answers are worked out again whenever they're missing or broken, the core API has moved on, or the
 * character has changed (a level, its traits, a new spell, the world's defaults). Answers someone gave stay as they are.
 */
import { MODULE_ID } from "../constants.js";
import { getAdapter } from "../api.js";
import { CORE_API_VERSION } from "../core-api.js";
import { TRAITS, fudged } from "../constants.js";
import { TACTIC_CHOICES, TACTIC_KEYS, suggestTactics } from "../engine/tactics.js";
import { scorePlaystyles, pickPlaystyles } from "../engine/auto-playstyles.js";
import { biographyEffects } from "../engine/keywords.js";
import { keywords, currentKeywords } from "./keywords.js";
import { getStoredTactics, worldTacticDefaults } from "./tactics.js";

/** The actor's auto setup, or null. */
export const autoRecord = actor => {
  const r = actor?.getFlag?.(MODULE_ID, "auto");
  return r && typeof r === "object" ? r : null;
};

/** Is this a fair answer to that question for this character? */
export function validLet(key, value, spec) {
  if ( key === "preferredAction" ) return value === "" || (spec?.actions ?? []).some(a => a.id === value);
  return (TACTIC_CHOICES[key] ?? []).includes(value);
}

/** Calculated answers that are whole and sound: one for every question, each a fair one. */
export function validLets(lets, spec) {
  if ( !lets || typeof lets !== "object" ) return false;
  return TACTIC_KEYS.every(k => k in lets && validLet(k, lets[k], spec));
}

/**
 * What the calculated answers are worked out from: its level, its traits, what it can do, the world's defaults (a
 * short hash).
 */
export function specSignature(spec, defaults = {}) {
  const traits = TRAITS.map(k => fudged(spec?.traits?.[k] ?? 50));
  const text = JSON.stringify([spec?.level ?? 0, spec?.kind ?? "", traits, (spec?.actions ?? []).map(a => a.id).sort(), !!spec?.shield, defaults]);
  let h = 5381;
  for ( let i = 0; i < text.length; i++ ) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * What to do for a character now: pick its playstyles (never set up and has none, or reset), and/or work its calculated
 * answers out (missing, broken, an older core API, the character changed, or reset).
 * @returns {{pick: boolean, lets: boolean}}
 */
export function autoPlan(stored, record, { api, sig, spec, force = false }) {
  const pick = force || (!record && !(stored?.playstyles?.length));
  const lets = force || !record || record.api !== api || record.sig !== sig || !validLets(record.lets, spec);
  return { pick, lets };
}

/** Something a system helper says, or nothing if it fails. */
function ask(what, fn, otherwise) {
  try {
    return fn() ?? otherwise;
  } catch ( err ) {
    console.warn(`${MODULE_ID} | auto setup: the system helper's ${what} failed`, err);
    return otherwise;
  }
}

/**
 * Every playstyle's score for this character: its numbers, its system's hints, its biography's words (keywords/:
 * engine/keywords.js).
 */
export function autoScores(actor, spec, words = currentKeywords()) {
  const adapter = getAdapter();
  const hints = ask("playstyleHints", () => adapter?.playstyleHints?.(actor, spec), {});
  const bio = ask("biography", () => adapter?.biography?.(actor), "");
  return scorePlaystyles(spec, { rules: adapter?.rules ?? null, hints, words: biographyEffects(bio, words).playstyles });
}

/** The calculated answer to every question: the core's reading of it, then its system's, where that knows better. */
export function autoLets(actor, spec) {
  const adapter = getAdapter();
  const out = { ...suggestTactics(spec, worldTacticDefaults(), adapter?.rules ?? null) };
  const own = ask("tacticHints", () => adapter?.tacticHints?.(actor, spec, { ...out }), {});
  for ( const [k, v] of Object.entries(own) ) if ( TACTIC_KEYS.includes(k) && validLet(k, v, spec) ) out[k] = v;
  return out;
}

/** (One at a time for each actor: the planner and a token window may both ask.) */
const running = new Map();

/**
 * Set a character up by itself where it needs it (see the top of this file). Only one who may write the actor's
 * flags does (the GM, or its owner). `force`: someone reset its settings (pick its playstyles again).
 * @returns {Promise<boolean>} whether anything was written
 */
export async function ensureAutoConfig(actor, spec, { force = false } = {}) {
  if ( !actor || !spec || !actor.isOwner || spec.hazard ) return false;
  const key = actor.uuid;
  while ( running.has(key) ) await running.get(key);
  const job = (async () => {
    const record = autoRecord(actor);
    const stored = getStoredTactics(actor);
    const sig = specSignature(spec, worldTacticDefaults());
    const plan = autoPlan(stored, record, { api: CORE_API_VERSION, sig, spec, force });
    if ( !plan.pick && !plan.lets ) return false;
    const next = { ...(record ?? {}), api: CORE_API_VERSION, sig, at: Date.now() };
    if ( plan.lets ) next.lets = autoLets(actor, spec);
    if ( plan.pick ) {
      const scored = autoScores(actor, spec, await keywords());
      next.picked = pickPlaystyles(scored);
      next.scores = Object.fromEntries(scored.slice(0, 8).map(s => [s.id, s.score]));
      if ( next.picked.length ) await actor.setFlag(MODULE_ID, "tactics", { ...(actor.getFlag(MODULE_ID, "tactics") ?? {}), playstyles: next.picked });
    }
    await actor.setFlag(MODULE_ID, "auto", next);
    return true;
  })();
  running.set(key, job);
  try {
    return await job;
  } catch ( err ) {
    console.warn(`${MODULE_ID} | auto setup failed for ${actor.name}`, err);
    return false;
  } finally {
    running.delete(key);
  }
}

/** Someone reset a character's FastFighting settings: they're cleared, and it's set up by itself again at once. */
export async function resetAndAutoConfig(actor, spec) {
  if ( !actor ) return;
  await actor.unsetFlag(MODULE_ID, "tactics");
  await actor.unsetFlag(MODULE_ID, "auto");
  await ensureAutoConfig(actor, spec, { force: true });
}
