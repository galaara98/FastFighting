/**
 * Story tables: where the story writer's sentences come from.
 *
 * Lookup order for each table key:
 *   1. A RollTable in this world flagged with that key (GMs install and edit these: see installStoryTables).
 *   2. The module's tables for the client language, from story/<lang>.json if a translation ships one.
 *   3. The English tables, built from story/en.json.
 *
 * A story file is JSON, key -> sentences: { "<table key>": ["sentence 1", ...], ... }. Missing keys fall back to
 * English.
 */
import { MODULE_ID } from "../constants.js";
import { tableName } from "./blocks.js";
import { language } from "../i18n.js";

let english = null; // (a promise of them)
let locale = null;
let localeLang = null;
let worldCache = null;
let resolved = null; // the tables object handed out until something changes

/** A story file's tables (null: none): key -> sentences. */
async function fetchTables(lang) {
  try {
    const response = await fetch(`modules/${MODULE_ID}/story/${lang}.json`);
    const data = response.ok ? await response.json() : null;
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch ( err ) {
    return null;
  }
}

function englishTables() {
  english ??= fetchTables("en").then(tables => tables ?? {});
  return english;
}

async function localeTables() {
  const lang = game.i18n.lang;
  // (English: nothing more to fetch.)
  if ( lang === "en" ) return null;
  if ( localeLang === lang ) return locale;
  localeLang = lang;
  resolved = null;
  locale = await fetchTables(lang);
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

/** Forget cached tables (after a GM edits one): the world's, and the story files, read again when next needed. */
export function invalidateStoryTables() {
  worldCache = null;
  resolved = null;
  english = null;
  locale = null;
  localeLang = null;
}

/**
 * Resolve all tables (async because a translation may need fetching). The same object comes back until a table
 * or the language changes, so callers can cache what they built from it.
 */
export async function loadStoryTables() {
  const base = await englishTables();
  const loc = await localeTables();
  if ( resolved ) return resolved;
  const world = worldTables();
  resolved = {
    lang: loc ? language() : "en",
    get(key) {
      return world[key] ?? loc?.[key] ?? base[key] ?? null;
    },
    /** Every table's lines, as they're told (the story weighs which words are common). */
    *values() {
      for ( const key of new Set([...Object.keys(base), ...Object.keys(loc ?? {}), ...Object.keys(world)]) ) yield this.get(key);
    }
  };
  return resolved;
}

/** Every key the story writer can use (for installing and translating). */
export async function allStoryKeys() {
  return Object.keys(await englishTables());
}

function groupOf(key) {
  const [kind, a] = key.split(".");
  if ( kind === "action" ) return tableName(`${kind}.${a}`);
  return tableName(kind);
}

/**
 * Create (or refresh) editable RollTables for every story table in a "FastFighting Story" folder.
 * Existing tables with the same key are left alone unless `overwrite` is true, so GM edits survive.
 * @returns {Promise<{created: number, kept: number}>}
 */
export async function installStoryTables({ overwrite = false } = {}) {
  const loc = await localeTables();
  const base = await englishTables();
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
    const entries = loc?.[key] ?? base[key];
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
