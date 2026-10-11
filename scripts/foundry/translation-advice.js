/**
 * A game system's translation, recommended: a FastFighting helper module (PF2e, D&D 5e ...) says, at the bottom of its
 * settings, when the reader's language isn't English and the system's translation isn't on in this world, naming the
 * last translation module we knew of for that language (installed but off: enable it; not installed: get it). With it,
 * the system's own words (its actions, conditions, skills and compendiums) read in that language in FastFighting too.
 * Helpers register through the core API: api.adviseTranslation(moduleId, systemTitle, {lang: {id, title, url}}).
 */
import { localize } from "../i18n.js";

const advised = new Map();
let hooked = false;

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));

/**
 * @param {string} moduleId   the helper module ("fast-fighting-pf2e")
 * @param {string} system     the game system's title ("Pathfinder Second Edition")
 * @param {Record<string, {id: string, title: string, url?: string}>} known  the last known translation module, by language
 */
export function adviseTranslation(moduleId, system, known = {}) {
  advised.set(moduleId, { system, known });
  if ( hooked ) return;
  hooked = true;
  Hooks.on("renderSettingsConfig", (app, element) => {
    const root = element instanceof HTMLElement ? element : element?.[0];
    for ( const id of advised.keys() ) {
      const section = root?.querySelector(`section.tab[data-category="${id}"]`);
      if ( !section ) continue;
      section.querySelector(".ff-translation-advice")?.remove();
      const html = translationAdvice(id);
      if ( !html ) continue;
      const note = document.createElement("p");
      note.className = "ff-translation-advice notes";
      note.innerHTML = html;
      section.append(note);
    }
  });
}

/**
 * What to tell the GM about a helper's system translation (HTML), or null: English, the translation is on, or none is
 * known for this language.
 */
export function translationAdvice(moduleId) {
  const entry = advised.get(moduleId);
  const lang = game.i18n.lang;
  const known = entry?.known?.[lang];
  if ( !entry || lang === "en" || !known?.id ) return null;
  const installed = game.modules.get(known.id);
  if ( installed?.active ) return null;
  const data = {
    system: esc(entry.system),
    language: esc(CONFIG.supportedLanguages?.[lang] ?? lang),
    title: esc(known.title ?? known.id),
    id: esc(known.id),
    link: known.url ? `, <a href="${esc(known.url)}" target="_blank" rel="noopener">${esc(known.url)}</a>` : ""
  };
  return installed
    ? localize("FASTFIGHTING.Translation.Disabled", "<strong>{system}</strong> isn't translated into your language ({language}) in this world, so its own words (its actions, conditions, skills and compendiums) stay in English. The last known translation module, <strong>{title}</strong> (<code>{id}</code>), is installed but not enabled: enable it in Manage Modules.", data)
    : localize("FASTFIGHTING.Translation.Missing", "<strong>{system}</strong> isn't translated into your language ({language}) in this world, so its own words (its actions, conditions, skills and compendiums) stay in English. The last known translation module was <strong>{title}</strong> (<code>{id}</code>{link}): install it in Add-on Modules, and enable it in this world.", data);
}
