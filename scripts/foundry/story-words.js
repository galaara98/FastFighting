/**
 * The story's word lists, for telling an attack's family from its name where its system says nothing more
 * (story/families.js): FASTFIGHTING.StoryWords.<family>, a comma-separated list in each language file. Read in the
 * reader's language and in English too, since a sheet or a book is often in English whatever the table reads.
 */
import { hasWords } from "../i18n.js";
import { NAMED_FAMILIES } from "../story/families.js";

/** A list's words: split at commas, trimmed of anything but letters and digits at either end, in lower case. */
const listed = text => String(text ?? "").split(",").map(w => w.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase()).filter(Boolean);

/** Foundry's English for a key (its fallback), when the reader's language is another; null when there's none. */
const english = key => {
  const text = globalThis.foundry?.utils?.getProperty?.(globalThis.game?.i18n?._fallback ?? {}, key);
  return typeof text === "string" ? text : null;
};

let lists = null;

/** Family -> words, for every family a name can tell. */
export function storyWordLists() {
  lists ??= Object.fromEntries(NAMED_FAMILIES.map(family => {
    const key = `FASTFIGHTING.StoryWords.${family}`;
    return [family, [...new Set([...(hasWords(key) ? listed(globalThis.game.i18n.localize(key)) : []), ...listed(english(key))])]];
  }));
  return lists;
}
