/**
 * Setting a character up by itself, the first time FastFighting sees it (the planner opening on its token, its token's
 * FastFighting tab, a player's survey): its playstyles and the answers "Let this character decide" stands for.
 *
 * Kept on the actor (an unlinked token's own; a prototype's is its actor's), flags.fast-fighting.auto:
 *   {api, sig, lets, picked, scores, at}
 *   api      the core API it was worked out under
 *   sig      what it was worked out from (its level, its traits, what it can do, the world's defaults): a change
 *            means working the answers out again
 *   lets     the calculated answer to every tactics question (what "Let this character decide" stands for, before
 *            its playstyles' say): its system's answer where its helper has one, else the core's reading of its hidden
 *            scores
 *   why      a system's reason for an answer, where it gave one ({key: reason}: shown to the GM)
 *   picked   the playstyles picked for it, best first (once: see below); scores, the best few and their scores
 *   budget   the trait budget it was set up again under, its sheet read over it (see below)
 *
 * Playstyles are picked once: for a character that has never been set up and has none (up to four, best first:
 * engine/auto-playstyles.js), and never again, unless someone resets its FastFighting settings (then at once). Picks
 * someone has changed stay theirs.
 * The calculated answers are worked out again whenever they're missing or broken, the core API has moved on, or the
 * character has changed (a level, its traits, a new spell, the world's defaults). Answers someone gave stay as they are.
 * A character whose sheet reads over the trait budget (api.js keepTraitBudget: spec.overBudget) is set up again once,
 * from the traits it has within it: its answers only. Its playstyles stay as they are.
 */
import { MODULE_ID } from "../constants.js";
import { getAdapter } from "../api.js";
import { CORE_API_VERSION } from "../core-api.js";
import { TRAIT_BUDGET } from "../engine/trait-budget.js";
import { TRAITS, fudged, isPlain } from "../constants.js";
import { TACTIC_CHOICES, TACTIC_KEYS, suggestTactics } from "../engine/tactics.js";
import { scorePlaystyles, pickPlaystyles } from "../engine/auto-playstyles.js";
import { currentPlaystyles, currentPlaystyleMap } from "../engine/playstyles.js";
import { localize } from "../i18n.js";
import { biographyEffects } from "../engine/keywords.js";
import { keywords, currentKeywords } from "./keywords.js";
import { getStoredTactics, worldTacticDefaults } from "./tactics.js";

/** The longest reason a calculated answer may carry (a system's word or two of why). */
const WHY_LENGTH = 120;

/**
 * The actor's auto setup, or null: its known parts only, each of its kind. (Its owner can write the flag from the
 * console: the answers are checked where they're used, and a reason is a short text for an answer it has.)
 */
export const autoRecord = actor => {
  const r = actor?.getFlag?.(MODULE_ID, "auto");
  if ( !isPlain(r) ) return null;
  const lets = isPlain(r.lets) ? r.lets : {};
  const why = {};
  for ( const [k, v] of Object.entries(isPlain(r.why) ? r.why : {}) ) {
    if ( k in lets && typeof v === "string" && v.length <= WHY_LENGTH ) why[k] = v;
  }
  const scores = {};
  for ( const [k, v] of Object.entries(isPlain(r.scores) ? r.scores : {}) ) if ( Number.isFinite(v) ) scores[k] = v;
  return {
    api: typeof r.api === "string" ? r.api : "",
    sig: typeof r.sig === "string" ? r.sig : "",
    lets,
    why,
    picked: Array.isArray(r.picked) ? currentPlaystyles(r.picked).slice(0, 8) : [],
    scores,
    budget: Number(r.budget) || 0,
    at: Number(r.at) || 0
  };
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
  // (Its sheet read over the trait budget, and not set up again under it yet: its answers, once. Never its playstyles.)
  const rebudget = !!spec?.overBudget && record?.budget !== TRAIT_BUDGET;
  const pick = force || (!record && !(stored?.playstyles?.length));
  const lets = force || rebudget || !record || record.api !== api || record.sig !== sig || !validLets(record.lets, spec);
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
  // (A helper's hints with any renamed playstyle as it is now: engine/playstyles.js.)
  const hints = currentPlaystyleMap(ask("playstyleHints", () => adapter?.playstyleHints?.(actor, spec), {}));
  const bio = ask("biography", () => adapter?.biography?.(actor), "");
  return scorePlaystyles(spec, { rules: adapter?.rules ?? null, hints, words: biographyEffects(bio, words).playstyles });
}

/**
 * The calculated answer to every question: the core's reading (its hidden scores and what it can do), then its
 * system's, which is the truer source wherever its helper has an answer. A helper answers `{key: answer}` or
 * `{key: {value, why}}` (why: its reason, shown to the GM).
 * @returns {{lets: object, why: Record<string, string>}}
 */
export function autoLets(actor, spec) {
  const adapter = getAdapter();
  const lets = suggestTactics(spec, worldTacticDefaults(), adapter?.rules ?? null);
  const own = ask("tacticHints", () => adapter?.tacticHints?.(actor, spec, { ...lets }), {});
  return withWorldDefaults(withHints(lets, own, spec), spec, worldTacticDefaults());
}

/** The world settings for a party's defaults, by the question they answer. */
const WORLD_DEFAULTS = Object.freeze({ healAggro: "pcHealAggro", allyDying: "pcAllyDying" });

/**
 * A player character's answers with the GM's own defaults for the party over them, where the GM set one (not "auto":
 * let each character decide): a house rule outweighs what its system would guess. The setting's name is the reason.
 * @returns {{lets: object, why: object}}
 */
export function withWorldDefaults({ lets, why }, spec, defaults = {}) {
  if ( spec?.kind !== "pc" ) return { lets, why };
  const out = { lets: { ...lets }, why: { ...why } };
  for ( const [key, setting] of Object.entries(WORLD_DEFAULTS) ) {
    const v = defaults[key];
    if ( !v || v === "auto" || !validLet(key, v, spec) ) continue;
    out.lets[key] = v;
    out.why[key] = localize(`FASTFIGHTING.Settings.${setting}.Name`);
  }
  return out;
}

/**
 * The core's answers with a system's over them: each fair one taken (`answer` or `{value, why}`), with its reason.
 * (Anything else a helper says, such as an older helper's offer or expectation, is left out.)
 * @returns {{lets: object, why: Record<string, string>}}
 */
export function withHints(lets, hints, spec) {
  const out = { ...lets };
  const why = {};
  for ( const [hint, raw] of Object.entries(hints ?? {}) ) {
    const given = raw && typeof raw === "object" && "value" in raw ? raw : { value: raw };
    // (A helper's "I avoid killing", once an answer to whom it went for, is sparing the fallen now.)
    const old = hint === "target" && given.value === "avoidKilling";
    const k = old ? "fallen" : hint;
    const said = old ? { ...given, value: "spare" } : given;
    if ( !TACTIC_KEYS.includes(k) || !validLet(k, said.value, spec) ) continue;
    out[k] = said.value;
    if ( typeof said.why === "string" && said.why ) why[k] = said.why.slice(0, 120);
  }
  return { lets: out, why };
}

/** Are these the same calculated answers and reasons as the stored ones? */
export function sameAnswers(record, { lets, why }) {
  const sorted = o => JSON.stringify(Object.keys(o ?? {}).sort().map(k => [k, o[k]]));
  return sorted(record?.lets) === sorted(lets) && sorted(record?.why) === sorted(why);
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
    // (Worked out afresh each time: what its system's helper and the core make of it now, so an update to either shows
    // at once. Written only when it differs.)
    const fresh = autoLets(actor, spec);
    if ( record && !plan.lets && !sameAnswers(record, fresh) ) plan.lets = true;
    if ( !plan.pick && !plan.lets ) return false;
    const next = { ...(record ?? {}), api: CORE_API_VERSION, sig, at: Date.now() };
    if ( spec.overBudget ) next.budget = TRAIT_BUDGET;
    if ( plan.lets ) Object.assign(next, fresh);
    // (One write for both: each write redraws whatever shows the actor.)
    const changes = { [`flags.${MODULE_ID}.auto`]: next };
    if ( plan.pick ) {
      const scored = autoScores(actor, spec, await keywords());
      next.picked = pickPlaystyles(scored);
      next.scores = Object.fromEntries(scored.slice(0, 8).map(s => [s.id, s.score]));
      if ( next.picked.length ) changes[`flags.${MODULE_ID}.tactics.playstyles`] = next.picked;
    }
    await actor.update(changes);
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

/** The same playstyles, in the same order? */
const samePicks = (a, b) => (a ?? []).length === (b ?? []).length && (a ?? []).every((id, i) => id === b[i]);

/**
 * Its playstyles worked out again (the planner's Re-autocalculate playstyles): where they're still the ones picked for
 * it by itself, or it has none, picked afresh; where it has just one someone chose, that one kept first and the best
 * others after it; never fewer than two (engine/auto-playstyles.js AUTO_LEAST). Two or more someone chose stay theirs.
 * Only one who may write the actor's flags does. @returns {Promise<boolean>} whether they changed
 */
export async function recalcPlaystyles(actor, spec) {
  if ( !actor || !spec || !actor.isOwner || spec.hazard ) return false;
  const stored = getStoredTactics(actor).playstyles ?? [];
  const record = autoRecord(actor);
  const automatic = !stored.length || samePicks(stored, record?.picked);
  if ( !automatic && stored.length >= 2 ) return false;
  const scored = autoScores(actor, spec, await keywords());
  const picked = pickPlaystyles(scored, { keep: automatic ? [] : stored });
  if ( !picked.length || samePicks(picked, stored) ) return false;
  await actor.update({
    [`flags.${MODULE_ID}.tactics.playstyles`]: picked,
    [`flags.${MODULE_ID}.auto.picked`]: picked,
    [`flags.${MODULE_ID}.auto.scores`]: Object.fromEntries(scored.slice(0, 8).map(s => [s.id, s.score]))
  });
  return true;
}

/** Someone reset a character's FastFighting settings: they're cleared, and it's set up by itself again at once. */
export async function resetAndAutoConfig(actor, spec) {
  if ( !actor ) return;
  await actor.unsetFlag(MODULE_ID, "tactics");
  await actor.unsetFlag(MODULE_ID, "auto");
  await ensureAutoConfig(actor, spec, { force: true });
}
