/**
 * The story's word lists, for telling an attack's family from its name where its system says nothing more
 * (story/families.js): FASTFIGHTING.StoryWords.<family>, a comma-separated list in each language file. Read in the
 * reader's language and in English too, since a sheet or a book is often in English whatever the table reads.
 */
import { hasWords, listWords, englishWords } from "../i18n.js";
import { NAMED_FAMILIES } from "../story/families.js";

const listed = listWords;
const english = englishWords;

let lists = null;

/** Family -> words, for every family a name can tell. */
export function storyWordLists() {
  lists ??= Object.fromEntries(NAMED_FAMILIES.map(family => {
    const key = `FASTFIGHTING.StoryWords.${family}`;
    return [family, [...new Set([...(hasWords(key) ? listed(globalThis.game.i18n.localize(key)) : []), ...listed(english(key))])]];
  }));
  return lists;
}
