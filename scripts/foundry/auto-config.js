/**
 * Setting a character up by itself, the first time FastFighting sees it (the planner opening on its token, its token's
 * FastFighting tab, a player's survey): its playstyles and the answers "Let this character decide" stands for.
 *
 * Kept on the actor (an unlinked token's own; a prototype's is its actor's), flags.fast-fighting.auto:
 *   {api, sig, lets, picked, scores, at}
 *   api      the core API it was worked out under
 *   sig      what it was worked out from (its level, its traits, what it can do, the world's defaults): a change
 *            means working the answers out again
 *   lets     the calculated answer to every tactics question, and what it offers and expects (what "Let this character
 *            decide" stands for, before its playstyles' say): its system's answer where its helper has one, else the
 *            core's reading of its hidden scores
 *   why      a system's reason for an answer, where it gave one ({key: reason}: shown to the GM)
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
import { cleanMotive, suggestMotives, AUTO } from "./motives.js";

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

/** Is this a fair calculated offer or expectation (a kind the survey has, not "Let this character decide")? */
export function validMotive(which, m) {
  const clean = cleanMotive(which, m);
  return !!clean && clean.kind !== undefined && clean.kind !== AUTO;
}

/** Calculated answers that are whole and sound: one for every question, each a fair one, and an offer and expectation. */
export function validLets(lets, spec) {
  if ( !lets || typeof lets !== "object" ) return false;
  return TACTIC_KEYS.every(k => k in lets && validLet(k, lets[k], spec)) && validMotive("offer", lets.offer) && validMotive("expect", lets.expect);
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

/**
 * The calculated answer to every question, and what it offers and expects: the core's reading (its hidden scores and
 * what it can do), then its system's, which is the truer source wherever its helper has an answer. A helper answers
 * `{key: answer}` or `{key: {value, why}}` (why: its reason, shown to the GM), and an offer or expectation as the
 * survey stores one.
 * @returns {{lets: object, why: Record<string, string>}}
 */
export function autoLets(actor, spec) {
  const adapter = getAdapter();
  const lets = { ...suggestTactics(spec, worldTacticDefaults(), adapter?.rules ?? null), ...suggestMotives(spec) };
  const own = ask("tacticHints", () => adapter?.tacticHints?.(actor, spec, { ...lets }), {});
  return withHints(lets, own, spec);
}

/**
 * The core's answers with a system's over them: each fair one taken (`answer` or `{value, why}`; an offer or
 * expectation as the survey stores one), with its reason.
 * @returns {{lets: object, why: Record<string, string>}}
 */
export function withHints(lets, hints, spec) {
  const out = { ...lets };
  const why = {};
  for ( const [k, raw] of Object.entries(hints ?? {}) ) {
    const said = raw && typeof raw === "object" && "value" in raw ? raw : { value: raw };
    const motive = ["offer", "expect"].includes(k);
    if ( !(motive ? validMotive(k, said.value) : TACTIC_KEYS.includes(k) && validLet(k, said.value, spec)) ) continue;
    out[k] = motive ? cleanMotive(k, said.value) : said.value;
    if ( typeof said.why === "string" && said.why ) why[k] = said.why.slice(0, 120);
  }
  return { lets: out, why };
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
    if ( plan.lets ) Object.assign(next, autoLets(actor, spec));
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
