/**
 * A stand-in for Foundry's game.i18n, for the tests. It holds no words: it reads languages/en.json, the one place the
 * module's words live, and builds the story tables from story/en.json, so the tests read what a GM would.
 *
 * `npm run test:reworded` runs every test with all those words reworded (accented, in ⟦brackets⟧, {placeholders} and
 * markup kept). The tests pass whatever the wording, so any string can be rewritten without touching them.
 */
import { readFileSync } from "fs";
import { fillIn } from "../scripts/i18n.js";

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

const ACCENT = { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" };
/** A string reworded (with FASTFIGHTING_REWORD set; as it is otherwise). An empty one stays empty: it means "say nothing". */
export const reword = s => (!process.env.FASTFIGHTING_REWORD || s === "" ? s
  : `⟦${String(s).split(/(\{[^}]+\}|<[^>]+>)/).map((part, i) => (i % 2 ? part : part.replace(/[aeiouAEIOU]/g, c => ACCENT[c]))).join("")}⟧`);
/** Every string in a language file, reworded. */
const rewordAll = o => (typeof o === "string" ? reword(o) : Array.isArray(o) ? o.map(rewordAll)
  : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, rewordAll(v)])) : o);

/** A nested language file as flat keys ("FASTFIGHTING.Words.List"). */
export function flatten(o, prefix = "", out = {}) {
  for ( const [k, v] of Object.entries(o) ) {
    if ( v && typeof v === "object" ) flatten(v, `${prefix}${k}.`, out);
    else out[`${prefix}${k}`] = v;
  }
  return out;
}

/** languages/en.json, flat. */
export const en = flatten(rewordAll(read("languages/en.json")));

/** The text languages/en.json has for a key (failing loudly when it has none, so a test can't pass on a missing key). */
export function text(key, data = null) {
  if ( !(key in en) ) throw new Error(`languages/en.json has no ${key}`);
  return fillIn(en[key], data);
}

/** game.i18n as Foundry sets it up in English, from languages/en.json (plus a helper's file, flat, when given). */
export function fakeI18n(more = {}) {
  const words = { ...en, ...more };
  return {
    lang: "en",
    has: key => key in words,
    localize: key => words[key] ?? key,
    format: (key, data) => fillIn(words[key] ?? key, data)
  };
}

/** story/en.json, as a Foundry client would fetch it (a fresh copy). */
export const storyFile = () => rewordAll(read("story/en.json"));

let tables = null;
/** The story tables, key -> entries: story/en.json. */
export function storyTables() {
  tables ??= storyFile();
  return tables;
}
