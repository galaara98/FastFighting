/**
 * Keywords in a character's biography and description, and what each says of it (keywords/en.json, and a translation's
 * keywords/<lang>.json on top: see keywords/README.md). Each word or phrase raises or lowers playstyles (for setting a
 * character up by itself: engine/auto-playstyles.js) and traits (its personality, wherever it's read). A word preceded
 * by one of the file's negations ("never a coward") doesn't count; one preceded by one of its reversals ("despises
 * cowards", "hates violence") counts the other way. Pure: no Foundry globals.
 */
import { TRAITS, clamp } from "../constants.js";

/** The most the words found can raise or lower a playstyle (in keywords) and a trait (in points). */
export const PLAYSTYLE_WORD_CAP = 2;
export const TRAIT_WORD_CAP = 15;

/** How many words before a keyword a negation or a reversal may stand ("not a coward", "despises all cowards"). */
const NEGATION_REACH = 3;

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const numbers = o => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).map(([k, v]) => [k, Number(v)]).filter(([, v]) => Number.isFinite(v) && v !== 0));

/**
 * One keyword file, made sound: its words in lower case, each with its playstyles and traits (numbers only), its
 * negations and its reversals.
 * @param {object} file   a keywords/<lang>.json, parsed
 * @returns {{words: Map<string, {playstyles, traits, whole}>, negations: string[], reversals: string[]}}
 */
export function readKeywordFile(file) {
  const words = new Map();
  for ( const [raw, entry] of Object.entries(file?.words ?? {}) ) {
    const word = String(raw).trim().toLowerCase().replace(/’/g, "'");
    if ( !word || !entry || typeof entry !== "object" ) continue;
    words.set(word, { playstyles: numbers(entry.playstyles), traits: numbers(entry.traits), whole: entry.whole === true });
  }
  const list = l => (Array.isArray(l) ? l : []).map(n => String(n).trim().toLowerCase().replace(/’/g, "'")).filter(Boolean);
  return { words, negations: list(file?.negations), reversals: list(file?.reversals) };
}

/**
 * Several keyword files as one (English first, then a translation's): a later file's entry for the same word takes the
 * earlier one's place; every file's other words, negations and reversals add up.
 */
export function mergeKeywords(...files) {
  const words = new Map();
  const negations = new Set();
  const reversals = new Set();
  for ( const f of files ) {
    if ( !f ) continue;
    for ( const [w, e] of f.words ?? [] ) words.set(w, e);
    for ( const n of f.negations ?? [] ) negations.add(n);
    for ( const r of f.reversals ?? [] ) reversals.add(r);
  }
  return { words, negations: [...negations], reversals: [...reversals] };
}

/**
 * How the text just before a keyword (in the same sentence, a few words back) takes it: 0, a negation cancels it ("never
 * cruel"); -1, a reversal turns it around ("despises cowards"); 1, as it is.
 */
function takenAs(before, { negations = [], reversals = [] }) {
  if ( !negations.length && !reversals.length ) return 1;
  const sentence = before.split(/[.;:!?\n]/u).pop();
  const tail = ` ${sentence.split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean).slice(-NEGATION_REACH).join(" ")} `;
  if ( negations.some(n => tail.includes(` ${n} `)) ) return 0;
  return reversals.some(r => tail.includes(` ${r} `)) ? -1 : 1;
}

/** What an entry says, as one string: entries rated exactly alike (a word and its synonyms) count once together. */
const ratingOf = entry => JSON.stringify([Object.entries(entry.playstyles ?? {}).sort(), Object.entries(entry.traits ?? {}).sort()]);

/**
 * What a text's keywords say. Each word or phrase is found as the start of a word, in any case (the whole word, for an
 * entry marked so); not where a negation comes just before it, and the other way where a reversal does. Then:
 *  - where entries overlap in the text, the longest counts ("cowardly" is `cowardly`, not `coward` as well);
 *  - each entry counts once, however often it's found ("hateful, hateful, hateful" is one), as it's first taken;
 *  - entries rated exactly alike count once together ("hateful ... full of hate ... hatred": a word and its synonyms).
 * @param {string} text
 * @param {{words: Map, negations: string[], reversals: string[]}} keywords   (mergeKeywords)
 * @returns {{playstyles: Record<string, number>, traits: Record<string, number>, found: string[], byTrait: Record<string, string[]>}}
 *   playstyles: each one's sum (keywords' worth, at most PLAYSTYLE_WORD_CAP either way); traits: each one's sum in points
 *   (at most TRAIT_WORD_CAP either way); found: the words that counted; byTrait: those that moved each trait
 */
export function keywordEffects(text, keywords) {
  const out = { playstyles: {}, traits: {}, found: [], byTrait: {} };
  // (A curly apostrophe is a straight one: "wasn't" either way.)
  const hay = String(text ?? "").toLowerCase().replace(/’/g, "'");
  if ( !hay.trim() || !keywords?.words?.size ) return out;

  // Every place an entry is found and taken (as it is, or the other way), to the end of the word it's in.
  const hits = [];
  for ( const [word, entry] of keywords.words ) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}${entry.whole ? "(?![\\p{L}\\p{N}])" : ""}`, "gu");
    for ( const m of hay.matchAll(re) ) {
      const sign = takenAs(hay.slice(0, m.index), keywords);
      if ( !sign ) continue;
      const rest = hay.slice(m.index + word.length).match(/^[\p{L}\p{N}'-]*/u)[0];
      hits.push({ word, entry, sign, start: m.index, end: m.index + word.length + rest.length });
    }
  }

  // Where entries overlap, the longest; then each entry, and each rating, once, as first found.
  hits.sort((a, b) => b.word.length - a.word.length || a.start - b.start);
  const claimed = [];
  const kept = hits.filter(h => {
    if ( claimed.some(([s, e]) => h.start < e && s < h.end) ) return false;
    claimed.push([h.start, h.end]);
    return true;
  }).sort((a, b) => a.start - b.start);
  const words = new Set();
  const ratings = new Set();
  for ( const { word, entry, sign } of kept ) {
    const rating = `${ratingOf(entry)}${sign}`;
    if ( words.has(word) || ratings.has(rating) ) continue;
    words.add(word);
    ratings.add(rating);
    out.found.push(word);
    for ( const [id, n] of Object.entries(entry.playstyles) ) out.playstyles[id] = (out.playstyles[id] ?? 0) + n * sign;
    for ( const [k, n] of Object.entries(entry.traits) ) {
      if ( !TRAITS.includes(k) ) continue;
      out.traits[k] = (out.traits[k] ?? 0) + n * sign;
      (out.byTrait[k] ??= []).push(word);
    }
  }
  for ( const id of Object.keys(out.playstyles) ) out.playstyles[id] = clamp(out.playstyles[id], -PLAYSTYLE_WORD_CAP, PLAYSTYLE_WORD_CAP);
  for ( const k of Object.keys(out.traits) ) out.traits[k] = clamp(out.traits[k], -TRAIT_WORD_CAP, TRAIT_WORD_CAP);
  return out;
}

/** How much a story told about a character counts (its backstory: its words may be about anyone in it). */
export const STORY_WEIGHT = 0.25;
/** How much what a character is against counts, the other way (its dislikes, its anathema): "dislikes fighting" says it likes peace. */
export const AGAINST_WEIGHT = 1;

/**
 * What a biography's keywords say: what's said of the character itself in full; a story told about it (a backstory,
 * campaign notes) at STORY_WEIGHT, since its words may be about anyone in it (the bandits it fought, the tyrant it
 * fled); what it's against (its dislikes, its anathema) the other way, in full ("dislikes fighting": one who likes peace; "dislikes cowards and
 * liars": a bolder, more honest one). Held in as keywordEffects is.
 * @param {string|{about?: string, story?: string, against?: string}} bio   a string is all about the character itself
 * @param {{words: Map, negations: string[]}} keywords
 * @returns {{playstyles, traits, found, byTrait}} as keywordEffects
 */
export function biographyEffects(bio, keywords) {
  const { about = "", story = "", against = "" } = typeof bio === "string" ? { about: bio } : (bio ?? {});
  const parts = [[keywordEffects(about, keywords), 1], [keywordEffects(story, keywords), STORY_WEIGHT], [keywordEffects(against, keywords), -AGAINST_WEIGHT]];
  const blend = (key, cap) => {
    const out = {};
    for ( const [fx, w] of parts ) for ( const [k, n] of Object.entries(fx[key]) ) out[k] = (out[k] ?? 0) + n * w;
    for ( const k of Object.keys(out) ) {
      out[k] = clamp(out[k], -cap, cap);
      if ( !out[k] ) delete out[k];
    }
    return out;
  };
  const byTrait = {};
  for ( const [fx] of parts ) for ( const [k, list] of Object.entries(fx.byTrait) ) byTrait[k] = [...new Set([...(byTrait[k] ?? []), ...list])];
  return {
    playstyles: blend("playstyles", PLAYSTYLE_WORD_CAP),
    traits: blend("traits", TRAIT_WORD_CAP),
    found: [...new Set(parts.flatMap(([fx]) => fx.found))],
    byTrait
  };
}
