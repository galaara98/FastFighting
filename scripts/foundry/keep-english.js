/**
 * Words a system helper keeps in English for now, whatever the reader's language. A helper's hardcoded-toEN.json
 * lists keys of its languages/en.json (or groups of keys, "FFDND5E.Skill") whose translation would contradict a game
 * system that isn't translated yet: a skill or condition named one way in FastFighting's story and another on the
 * system's own sheets. In a language other than English, those keys read as their English: Foundry's translation of
 * each is replaced with it, so the code, the templates and the settings all agree.
 *
 *   { "lastUpdated": "2026-10-11", "keys": ["FFDND5E.Skill", "FFDND5E.Cond.frightened"] }
 *
 * Helpers ask for it through the core API, in their fastFighting.init hook: api.keepEnglish(moduleId).
 */

/** A nested language file's entries as [flat key, text]. */
function entries(o, prefix = "", out = []) {
  for ( const [k, v] of Object.entries(o ?? {}) ) {
    const key = prefix ? `${prefix}.${k}` : k;
    if ( v && typeof v === "object" ) entries(v, key, out);
    else if ( typeof v === "string" ) out.push([key, v]);
  }
  return out;
}

/**
 * The English for each key a list names: key -> text. Pure.
 * @param {object} list      hardcoded-toEN.json ({lastUpdated, keys})
 * @param {object} english   the module's languages/en.json
 */
export function keptEnglish(list, english) {
  const refs = (Array.isArray(list?.keys) ? list.keys : []).filter(r => typeof r === "string" && r.trim()).map(r => r.trim());
  if ( !refs.length ) return {};
  return Object.fromEntries(entries(english).filter(([key]) => refs.some(r => key === r || key.startsWith(`${r}.`))));
}

/** Set a dotted key in a nested object. */
function put(target, key, value) {
  const parts = key.split(".");
  let o = target;
  for ( const p of parts.slice(0, -1) ) o = (o[p] && typeof o[p] === "object") ? o[p] : (o[p] = {});
  o[parts.at(-1)] = value;
}

async function readJson(path) {
  try {
    const response = await fetch(path);
    return response.ok ? await response.json() : null;
  } catch ( err ) {
    return null;
  }
}

/**
 * Read a module's list and put its English in place of the reader's language. Nothing to do in English.
 * @returns {Promise<string[]>} the keys kept in English
 */
export async function applyKeptEnglish(moduleId, i18n = game.i18n) {
  if ( !i18n || i18n.lang === "en" ) return [];
  const list = await readJson(`modules/${moduleId}/hardcoded-toEN.json`);
  if ( !list?.keys?.length ) return [];
  const kept = keptEnglish(list, await readJson(`modules/${moduleId}/languages/en.json`));
  for ( const [key, text] of Object.entries(kept) ) put(i18n.translations, key, text);
  return Object.keys(kept);
}

/** For a helper's fastFighting.init hook: keep its listed words in English once Foundry has loaded the translations. */
export function keepEnglish(moduleId) {
  Hooks.once("i18nInit", () => applyKeptEnglish(moduleId));
}
