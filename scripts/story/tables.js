/**
 * Story tables: where the story writer's sentences come from.
 *
 * Lookup order for each table key:
 *   1. A RollTable in this world flagged with that key (GMs install and edit these: see installStoryTables).
 *   2. The module's tables for the client language, from story/<lang>.json if a translation ships one.
 *   3. Built-in tables for the client language (none ship today; see BUILT_IN).
 *   4. The built-in English tables (story/tables-en.js).
 *
 * A locale file is JSON: { "<table key>": ["entry 1", ..., "entry 5"], ... }. Missing keys fall back to English.
 */
import { MODULE_ID } from "../constants.js";
import { buildEnglishTables, tableName } from "./tables-en.js";
import { language } from "../i18n.js";

/**
 * Languages the module tells its stories in itself, by code: {build() → tables, possessive?(weapon) → the word for
 * {su} before a weapon's name, for a language whose possessive agrees with it}. None ship today.
 */
const BUILT_IN = {};
let builtIn = null;
let builtInLang = null;

/** The module's own tables in a language (null: none, English does). */
function builtInTables(lang) {
  if ( builtInLang !== lang ) {
    builtInLang = lang;
    builtIn = BUILT_IN[lang]?.build() ?? null;
  }
  return builtIn;
}

let english = null;
let locale = null;
let localeLang = null;
let worldCache = null;
let resolved = null; // the tables object handed out until something changes

function englishTables() {
  english ??= buildEnglishTables();
  return english;
}

async function localeTables() {
  const lang = game.i18n.lang;
  // (English, or a language the module tells its stories in itself: nothing to fetch.)
  if ( lang === "en" || BUILT_IN[lang] ) return null;
  if ( localeLang === lang ) return locale;
  localeLang = lang;
  resolved = null;
  try {
    const response = await fetch(`modules/${MODULE_ID}/story/${lang}.json`);
    locale = response.ok ? await response.json() : null;
  } catch ( err ) {
    locale = null;
  }
  return locale;
}

/** Plain text of a result: GMs edit these in the rich-text editor, so drop markup and decode entities. */
function resultText(result) {
  const html = String(result.description || result.name || "");
  if ( !/[<&]/.test(html) ) return html.trim();
  // DOMParser builds an inert document: no scripts run and no images load.
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** A table players can edit could put words in the GM's story, so only GM-controlled tables count. */
function gmControlled(table) {
  return !game.users.some(u => !u.isGM && table.testUserPermission(u, "OWNER"));
}

function worldTables() {
  if ( worldCache ) return worldCache;
  worldCache = {};
  for ( const table of game.tables ?? [] ) {
    const key = table.getFlag(MODULE_ID, "storyKey");
    if ( !key || !gmControlled(table) ) continue;
    const entries = table.results.contents.filter(r => r.type === "text").map(resultText);
    if ( entries.length ) worldCache[key] = entries;
  }
  return worldCache;
}

/** Forget cached world tables (after a GM edits one). */
export function invalidateStoryTables() {
  worldCache = null;
  resolved = null;
}

/**
 * Resolve all tables (async because a translation may need fetching). The same object comes back until a table
 * or the language changes, so callers can cache what they built from it.
 */
export async function loadStoryTables() {
  const base = englishTables();
  const loc = await localeTables();
  if ( resolved ) return resolved;
  const world = worldTables();
  const lang = language();
  const own = builtInTables(lang);
  resolved = {
    lang: own || loc ? lang : "en",
    possessive: BUILT_IN[lang]?.possessive ?? null,
    get(key) {
      return world[key] ?? loc?.[key] ?? own?.[key] ?? base[key] ?? null;
    }
  };
  return resolved;
}

/** Every key the story writer can use, with its English entries (for installing and translating). */
export function allStoryKeys() {
  return Object.keys(englishTables());
}

function groupOf(key) {
  const [kind, a] = key.split(".");
  if ( kind === "action" ) return `Action · ${tableName(a)}`;
  return tableName(kind);
}

/**
 * Create (or refresh) editable RollTables for every story table in a "FastFighting Story" folder.
 * Existing tables with the same key are left alone unless `overwrite` is true, so GM edits survive.
 * @returns {Promise<{created: number, kept: number}>}
 */
export async function installStoryTables({ overwrite = false } = {}) {
  const loc = await localeTables();
  const base = englishTables();
  const own = builtInTables(language());
  const FolderCls = foundry.documents.Folder ?? globalThis.Folder;
  const TableCls = foundry.documents.RollTable ?? globalThis.RollTable;
  const rootName = game.i18n.localize("FASTFIGHTING.Story.TablesFolder");
  let root = game.folders.find(f => f.type === "RollTable" && f.getFlag(MODULE_ID, "storyRoot"));
  root ??= await FolderCls.create({ name: rootName, type: "RollTable", flags: { [MODULE_ID]: { storyRoot: true } } });

  const existing = new Map(game.tables.filter(t => t.getFlag(MODULE_ID, "storyKey")).map(t => [t.getFlag(MODULE_ID, "storyKey"), t]));
  const folders = new Map();
  const toCreate = [];
  const toDelete = [];
  let kept = 0;
  for ( const key of Object.keys(base) ) {
    const entries = loc?.[key] ?? own?.[key] ?? base[key];
    const prior = existing.get(key);
    if ( prior && !overwrite ) { kept += 1; continue; }
    const group = groupOf(key);
    if ( !folders.has(group) ) {
      let folder = game.folders.find(f => f.type === "RollTable" && f.folder?.id === root.id && f.name === group);
      folder ??= await FolderCls.create({ name: group, type: "RollTable", folder: root.id });
      folders.set(group, folder);
    }
    const data = {
      name: tableName(key),
      folder: folders.get(group).id,
      formula: `1d${entries.length}`,
      replacement: true,
      displayRoll: false,
      flags: { [MODULE_ID]: { storyKey: key } },
      results: entries.map((text, i) => ({ type: "text", name: text.slice(0, 60), description: text, weight: 1, range: [i + 1, i + 1] }))
    };
    if ( prior ) toDelete.push(prior.id);
    toCreate.push(data);
  }
  for ( let i = 0; i < toDelete.length; i += 100 ) await TableCls.deleteDocuments(toDelete.slice(i, i + 100));
  for ( let i = 0; i < toCreate.length; i += 50 ) await TableCls.createDocuments(toCreate.slice(i, i + 50));
  invalidateStoryTables();
  return { created: toCreate.length, kept };
}
