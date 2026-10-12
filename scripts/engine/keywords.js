/**
 * Keywords in a character's biography and description, and what each says of it (keywords/en.json, and a translation's
 * keywords/<lang>.json on top: see keywords/README.md). Each word or phrase raises or lowers playstyles (for setting a
 * character up by itself: engine/auto-playstyles.js) and traits (its personality, wherever it's read). A word preceded
 * by one of the file's negations ("never a coward") doesn't count. Pure: no Foundry globals.
 */
import { TRAITS, clamp } from "../constants.js";

/** The most the words found can raise or lower a playstyle (in keywords) and a trait (in points). */
export const PLAYSTYLE_WORD_CAP = 2;
export const TRAIT_WORD_CAP = 15;

/** How many words before a keyword a negation may stand ("not a coward", "never truly cruel"). */
const NEGATION_REACH = 3;

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const numbers = o => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).map(([k, v]) => [k, Number(v)]).filter(([, v]) => Number.isFinite(v) && v !== 0));

/**
 * One keyword file, made sound: its words in lower case, each with its playstyles and traits (numbers only), and its
 * negations.
 * @param {object} file   a keywords/<lang>.json, parsed
 * @returns {{words: Map<string, {playstyles, traits, whole}>, negations: string[]}}
 */
export function readKeywordFile(file) {
  const words = new Map();
  for ( const [raw, entry] of Object.entries(file?.words ?? {}) ) {
    const word = String(raw).trim().toLowerCase().replace(/’/g, "'");
    if ( !word || !entry || typeof entry !== "object" ) continue;
    words.set(word, { playstyles: numbers(entry.playstyles), traits: numbers(entry.traits), whole: entry.whole === true });
  }
  const negations = (Array.isArray(file?.negations) ? file.negations : []).map(n => String(n).trim().toLowerCase().replace(/’/g, "'")).filter(Boolean);
  return { words, negations };
}

/**
 * Several keyword files as one (English first, then a translation's): a later file's entry for the same word takes the
 * earlier one's place; every file's other words and negations add up.
 */
export function mergeKeywords(...files) {
  const words = new Map();
  const negations = new Set();
  for ( const f of files ) {
    if ( !f ) continue;
    for ( const [w, e] of f.words ?? [] ) words.set(w, e);
    for ( const n of f.negations ?? [] ) negations.add(n);
  }
  return { words, negations: [...negations] };
}

/** Is the text just before a keyword a negation of it (in the same sentence, a few words back)? */
function negated(before, negations) {
  if ( !negations.length ) return false;
  const sentence = before.split(/[.;:!?\n]/u).pop();
  const tail = ` ${sentence.split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean).slice(-NEGATION_REACH).join(" ")} `;
  return negations.some(n => tail.includes(` ${n} `));
}

/**
 * What a text's keywords say: each word or phrase found (as the start of a word, in any case; the whole word, for an
 * entry marked so), once however often, and not where a negation comes just before it.
 * @param {string} text
 * @param {{words: Map, negations: string[]}} keywords   (mergeKeywords)
 * @returns {{playstyles: Record<string, number>, traits: Record<string, number>, found: string[], byTrait: Record<string, string[]>}}
 *   playstyles: each one's sum (keywords' worth, at most PLAYSTYLE_WORD_CAP either way); traits: each one's sum in points
 *   (at most TRAIT_WORD_CAP either way); found: the words that counted; byTrait: those that moved each trait
 */
export function keywordEffects(text, keywords) {
  const out = { playstyles: {}, traits: {}, found: [], byTrait: {} };
  // (A curly apostrophe is a straight one: "wasn't" either way.)
  const hay = String(text ?? "").toLowerCase().replace(/’/g, "'");
  if ( !hay.trim() || !keywords?.words?.size ) return out;
  for ( const [word, entry] of keywords.words ) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}${entry.whole ? "(?![\\p{L}\\p{N}])" : ""}`, "gu");
    let counts = false;
    for ( const m of hay.matchAll(re) ) {
      if ( !negated(hay.slice(0, m.index), keywords.negations ?? []) ) { counts = true; break; }
    }
    if ( !counts ) continue;
    out.found.push(word);
    for ( const [id, n] of Object.entries(entry.playstyles) ) out.playstyles[id] = (out.playstyles[id] ?? 0) + n;
    for ( const [k, n] of Object.entries(entry.traits) ) {
      if ( !TRAITS.includes(k) ) continue;
      out.traits[k] = (out.traits[k] ?? 0) + n;
      (out.byTrait[k] ??= []).push(word);
    }
  }
  for ( const id of Object.keys(out.playstyles) ) out.playstyles[id] = clamp(out.playstyles[id], -PLAYSTYLE_WORD_CAP, PLAYSTYLE_WORD_CAP);
  for ( const k of Object.keys(out.traits) ) out.traits[k] = clamp(out.traits[k], -TRAIT_WORD_CAP, TRAIT_WORD_CAP);
  return out;
}

/** How much a story told about a character counts (its backstory: its words may be about anyone in it). */
export const STORY_WEIGHT = 0.25;

/**
 * What a biography's keywords say: what's said of the character itself in full; a story told about it (a backstory,
 * campaign notes) at STORY_WEIGHT, since its words may be about anyone in it (the bandits it fought, the tyrant it
 * fled). Held in as keywordEffects is.
 * @param {string|{about?: string, story?: string}} bio   a string is all about the character itself
 * @param {{words: Map, negations: string[]}} keywords
 * @returns {{playstyles, traits, found, byTrait}} as keywordEffects
 */
export function biographyEffects(bio, keywords) {
  const { about = "", story = "" } = typeof bio === "string" ? { about: bio } : (bio ?? {});
  const own = keywordEffects(about, keywords);
  const told = keywordEffects(story, keywords);
  const blend = (a, b, cap) => {
    const out = {};
    for ( const k of new Set([...Object.keys(a), ...Object.keys(b)]) ) {
      const n = clamp((a[k] ?? 0) + (b[k] ?? 0) * STORY_WEIGHT, -cap, cap);
      if ( n ) out[k] = n;
    }
    return out;
  };
  const byTrait = {};
  for ( const fx of [own, told] ) for ( const [k, list] of Object.entries(fx.byTrait) ) byTrait[k] = [...new Set([...(byTrait[k] ?? []), ...list])];
  return {
    playstyles: blend(own.playstyles, told.playstyles, PLAYSTYLE_WORD_CAP),
    traits: blend(own.traits, told.traits, TRAIT_WORD_CAP),
    found: [...new Set([...own.found, ...told.found])],
    byTrait
  };
}
