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
/** How far back (in characters) a negation or a reversal is looked for: well past NEGATION_REACH words. */
const NEGATION_WINDOW = 200;

/**
 * The most of one text that's read (in characters): a biography, a description, a page of notes. Past it, a long text
 * says no more of a character than its start did, and reading it would only slow the GM's table.
 */
export const TEXT_CAP = 20000;

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
const ratings = new WeakMap();
const ratingOf = entry => {
  let r = ratings.get(entry);
  if ( r === undefined ) {
    r = JSON.stringify([Object.entries(entry.playstyles ?? {}).sort(), Object.entries(entry.traits ?? {}).sort()]);
    ratings.set(entry, r);
  }
  return r;
};

/**
 * A text as it reads, without Foundry's markup for links and rolls: a link (`@UUID[...]{Goblin Chief}`, `@Check[...]`)
 * is its label or nothing, an inline roll (`[[/r 1d6]]`) is its label or nothing. ("fortitude" in a save's markup isn't
 * the character's fortitude.) Nothing is followed or looked up.
 */
export function withoutMarkup(text) {
  return String(text ?? "")
    .replace(/\[\[[\s\S]*?\]\]\]*(?:\{([^{}]*)\})?/g, (m, label) => ` ${label ?? ""} `)
    .replace(/@[A-Za-z]+\[[^\]]*\](?:\{([^{}]*)\})?/g, (m, label) => ` ${label ?? ""} `);
}

/** A letter or a digit, the one at `i` in `s` (a pair of surrogates read as one). */
const WORD_CHAR = /^[\p{L}\p{N}]/u;
const wordCharAt = (s, i) => i >= 0 && i < s.length && WORD_CHAR.test(String.fromCodePoint(s.codePointAt(i)));
/** Is the character just before `i` a letter or a digit? */
function wordCharBefore(s, i) {
  if ( i <= 0 ) return false;
  const c = s.charCodeAt(i - 1);
  return wordCharAt(s, (c >= 0xDC00 && c <= 0xDFFF && i >= 2) ? i - 2 : i - 1);
}
/** The rest of the word a keyword is found at the start of. */
const REST_OF_WORD = /[\p{L}\p{N}'-]*/uy;

/**
 * A keyword set's words by how they start (their first two characters, or the one of a word of one), made once per set:
 * at each word in a text, only the keywords that could start there are tried.
 */
const indexes = new WeakMap();
function indexOf(words) {
  let index = indexes.get(words);
  if ( !index ) {
    index = new Map();
    for ( const [word, entry] of words ) {
      const key = word.slice(0, 2);
      if ( !index.has(key) ) index.set(key, []);
      index.get(key).push([word, entry]);
    }
    indexes.set(words, index);
  }
  return index;
}

/**
 * What a text's keywords say. Each word or phrase is found as the start of a word, in any case (the whole word, for an
 * entry marked so); not where a negation comes just before it, and the other way where a reversal does. Then:
 *  - where entries overlap in the text, the longest counts ("cowardly" is `cowardly`, not `coward` as well);
 *  - each entry counts once, however often it's found ("hateful, hateful, hateful" is one), as it's first taken;
 *  - entries rated exactly alike count once together ("hateful ... full of hate ... hatred": a word and its synonyms).
 * @param {string} text
 * @param {{words: Map, negations: string[], reversals: string[]}} keywords   (mergeKeywords)
 * @returns {{playstyles: Record<string, number>, traits: Record<string, number>, found: string[], byTrait: Record<string, {word: string, sign: number}[]>}}
 *   playstyles: each one's sum (keywords' worth, at most PLAYSTYLE_WORD_CAP either way); traits: each one's sum in points
 *   (at most TRAIT_WORD_CAP either way); found: the words that counted; byTrait: those that moved each trait, and which way they were taken (-1: turned around)
 */
export function keywordEffects(text, keywords) {
  const out = { playstyles: {}, traits: {}, found: [], byTrait: {} };
  // (Its start only, as it reads without links' markup; a curly apostrophe is a straight one: "wasn't" either way.)
  const hay = withoutMarkup(String(text ?? "").slice(0, TEXT_CAP * 2)).slice(0, TEXT_CAP).toLowerCase().replace(/’/g, "'");
  if ( !hay.trim() || !keywords?.words?.size ) return out;

  // Every place an entry is found (at the start of a word) and taken (as it is, or the other way), to the end of the
  // word it's in.
  const index = indexOf(keywords.words);
  const hits = [];
  const tryAt = (candidates, i) => {
    for ( const [word, entry] of candidates ?? [] ) {
      if ( !hay.startsWith(word, i) || (entry.whole && wordCharAt(hay, i + word.length)) ) continue;
      const sign = takenAs(hay.slice(Math.max(0, i - NEGATION_WINDOW), i), keywords);
      if ( !sign ) continue;
      REST_OF_WORD.lastIndex = i + word.length;
      hits.push({ word, entry, sign, start: i, end: i + word.length + (REST_OF_WORD.exec(hay)?.[0].length ?? 0) });
    }
  };
  for ( let i = 0; i < hay.length; i++ ) {
    if ( wordCharBefore(hay, i) ) continue;
    const two = hay.slice(i, i + 2);
    tryAt(index.get(two), i);
    if ( two.length === 2 ) tryAt(index.get(hay[i]), i);
  }

  // Where entries overlap, the longest; then each entry, and each rating, once, as first found.
  hits.sort((a, b) => b.word.length - a.word.length || a.start - b.start);
  const claimed = new Uint8Array(hay.length + 1);
  const kept = hits.filter(h => {
    for ( let j = h.start; j < h.end; j++ ) if ( claimed[j] ) return false;
    claimed.fill(1, h.start, h.end);
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
      (out.byTrait[k] ??= []).push({ word, sign });
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
  for ( const [fx, w] of parts ) {
    for ( const [k, list] of Object.entries(fx.byTrait) ) {
      for ( const { word, sign } of list ) {
        const taken = sign * Math.sign(w);
        if ( !(byTrait[k] ??= []).some(x => x.word === word && x.sign === taken) ) byTrait[k].push({ word, sign: taken });
      }
    }
  }
  return {
    playstyles: blend("playstyles", PLAYSTYLE_WORD_CAP),
    traits: blend("traits", TRAIT_WORD_CAP),
    found: [...new Set(parts.flatMap(([fx]) => fx.found))],
    byTrait
  };
}
