/**
 * The keywords read in characters' biographies and descriptions (engine/keywords.js): keywords/en.json always, and the
 * reader's language's keywords/<lang>.json on top when there is one (a translation's words add to the English ones,
 * since a biography may be written in either). Loaded once, at startup; anything that reads a character waits for them.
 * What a biography's words say of a character's traits is added to its spec here, with the words in its reasons.
 */
import { MODULE_ID, TRAITS, clamp } from "../constants.js";
import { localize, listItems, listJoin, language } from "../i18n.js";
import { readKeywordFile, mergeKeywords, biographyEffects } from "../engine/keywords.js";
import { signedNumber } from "../engine/trait-parts.js";

let loaded = mergeKeywords();
let loading = null;

/** A keyword file from this module's keywords/ folder, or nothing if there isn't one. */
async function fetchFile(lang) {
  try {
    const response = await fetch(`modules/${MODULE_ID}/keywords/${lang}.json`);
    return response.ok ? readKeywordFile(await response.json()) : null;
  } catch ( err ) {
    return null;
  }
}

/** Read the keywords (once; called at startup). */
export function loadKeywords() {
  loading ??= (async () => {
    const lang = language();
    const english = await fetchFile("en");
    if ( !english ) console.warn(`${MODULE_ID} | the keywords (keywords/en.json) could not be read`);
    loaded = mergeKeywords(english, lang && lang !== "en" ? await fetchFile(lang) : null);
    return loaded;
  })();
  return loading;
}

/** The keywords, once they're read. */
export async function keywords() {
  return loadKeywords();
}

/** The keywords as they are now (nothing, before they're read). */
export const currentKeywords = () => loaded;

/** (For tests: these keywords, as if read.) */
export function useKeywords(merged) {
  loaded = merged;
  loading = Promise.resolve(merged);
}

/**
 * What a character's biography and description say of its traits, added to its spec: each trait moved by the words
 * that speak to it (at most TRAIT_WORD_CAP either way), and those words in the trait's reason. Not for a hazard or the
 * mindless (what they are is all there is to them).
 * @param {object} spec   a CombatantSpec, its traits {k: {base, fudge}}
 * @param {string|{about?: string, story?: string}} bio   its biography and description (adapter.biography): what's said of it
 *        in full, a story told about it a little (engine/keywords.js: biographyEffects)
 * @param {object} [words]   the keywords (default: those read)
 * @returns {object} the spec
 */
export function applyBiography(spec, bio, words = loaded) {
  if ( !spec?.traits || spec.hazard || spec.flags?.mindless || !bio ) return spec;
  const fx = biographyEffects(bio, words);
  for ( const k of TRAITS ) {
    const n = Math.round(fx.traits[k] ?? 0);
    if ( !n || !spec.traits[k] ) continue;
    spec.traits[k].base = clamp(Math.round((spec.traits[k].base ?? 50) + n), 0, 100);
    const why = localize("FASTFIGHTING.Words.Biography", { words: listJoin(fx.byTrait[k] ?? []) });
    spec.traitReasons ??= {};
    spec.traitReasons[k] = listItems([spec.traitReasons[k], localize("FASTFIGHTING.Words.Part", { why, n: signedNumber(n) })].filter(Boolean));
  }
  return spec;
}
