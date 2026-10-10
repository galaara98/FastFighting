/**
 * Story tables: where the story writer's sentences come from.
 *
 * Lookup order for each table key:
 *   1. A RollTable in this world flagged with that key (GMs install and edit these: see installStoryTables).
 *   2. The module's tables for the client language, from story/<lang>.json if a translation ships one.
 *   3. The built-in English tables (story/tables-en.js).
 *
 * A locale file is JSON: { "<table key>": ["entry 1", ..., "entry 5"], ... }. Missing keys fall back to English.
 */
import { MODULE_ID } from "../constants.js";
import { buildEnglishTables, tableName } from "./tables-en.js";

let english = null;
let locale = null;
let localeLang = null;
let worldCache = null;

function englishTables() {
  english ??= buildEnglishTables();
  return english;
}

async function localeTables() {
  const lang = game.i18n.lang;
  if ( lang === "en" ) return null;
  if ( localeLang === lang ) return locale;
  localeLang = lang;
  try {
    const response = await fetch(`modules/${MODULE_ID}/story/${lang}.json`);
    locale = response.ok ? await response.json() : null;
  } catch ( err ) {
    locale = null;
  }
  return locale;
}

function resultText(result) {
  return String(result.description || result.name || "").replace(/<\/?p>/g, "").trim();
}

function worldTables() {
  if ( worldCache ) return worldCache;
  worldCache = {};
  for ( const table of game.tables ?? [] ) {
    const key = table.getFlag(MODULE_ID, "storyKey");
    if ( !key ) continue;
    const entries = table.results.contents.filter(r => r.type === "text").map(resultText);
    if ( entries.length ) worldCache[key] = entries;
  }
  return worldCache;
}

/** Forget cached world tables (after a GM edits one). */
export function invalidateStoryTables() {
  worldCache = null;
}

/** Resolve all tables once per story (async because a translation may need fetching). */
export async function loadStoryTables() {
  const base = englishTables();
  const loc = await localeTables();
  const world = worldTables();
  return {
    get(key) {
      return world[key] ?? loc?.[key] ?? base[key] ?? null;
    }
  };
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
  const FolderCls = foundry.documents.Folder ?? globalThis.Folder;
  const TableCls = foundry.documents.RollTable ?? globalThis.RollTable;
  const rootName = game.i18n.localize("FASTFIGHTING.Story.TablesFolder");
  let root = game.folders.find(f => f.type === "RollTable" && f.getFlag(MODULE_ID, "storyRoot"));
  root ??= await FolderCls.create({ name: rootName, type: "RollTable", flags: { [MODULE_ID]: { storyRoot: true } } });

  const existing = new Map(game.tables.filter(t => t.getFlag(MODULE_ID, "storyKey")).map(t => [t.getFlag(MODULE_ID, "storyKey"), t]));
  const folders = new Map();
  const toCreate = [];
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
    if ( prior ) await prior.delete();
    toCreate.push(data);
  }
  for ( let i = 0; i < toCreate.length; i += 50 ) await TableCls.createDocuments(toCreate.slice(i, i + 50));
  invalidateStoryTables();
  return { created: toCreate.length, kept };
}
