/**
 * Does this world's game system have a FastFighting helper? The core does nothing useful on its own: system
 * helper modules teach it how a system works. Without one, FastFighting greys out its settings and points
 * the GM at the list of supported systems (systems.md).
 */
import { MODULE_ID } from "./constants.js";
import { hasSystemAdapter } from "./api.js";

export const SYSTEMS_URL = "https://github.com/galaara98/FastFighting/blob/main/systems.md";

/** Helper modules we know about, by game system id (keep in sync with systems.md). */
export const KNOWN_HELPERS = Object.freeze({
  pf2e: { module: "fast-fighting-pf2e", title: "FastFighting PF2e", url: "https://github.com/galaara98/FastFighting-PF2e" },
  dnd5e: { module: "fast-fighting-dnd5e", title: "FastFighting D&D 5e", url: "https://github.com/galaara98/FastFighting-DnD5e" },
  dcc: { module: "fast-fighting-dcc", title: "FastFighting DCC", url: "https://github.com/galaara98/FastFighting-DCC" },
  "foundry-ironsworn": { module: "fast-fighting-ironsworn", title: "FastFighting Ironsworn", url: "https://github.com/galaara98/FastFighting-Ironsworn" }
});

/**
 * @returns {{systemId, systemTitle, specific: boolean, generic: boolean, ready: boolean, known: object|null,
 *           installed: boolean, enabled: boolean, reason: "ok"|"generic"|"disabled"|"notInstalled"|"unknown"}}
 */
export function helperStatus() {
  const systemId = game.system.id;
  const specific = hasSystemAdapter(systemId);
  const generic = !specific && !!game.settings.get(MODULE_ID, "genericFallback");
  const known = KNOWN_HELPERS[systemId] ?? null;
  const module = known ? game.modules.get(known.module) : null;
  let reason = "ok";
  if ( !specific ) {
    if ( generic ) reason = "generic";
    else if ( known && module && !module.active ) reason = "disabled";
    else if ( known ) reason = "notInstalled";
    else reason = "unknown";
  }
  return {
    systemId, systemTitle: game.system.title, specific, generic, ready: specific || generic,
    known, installed: !!module, enabled: !!module?.active, reason
  };
}

/** One sentence telling the GM what to do. */
export function helperMessage(status = helperStatus()) {
  const data = { system: status.systemTitle, module: status.known?.title ?? "", url: status.known?.url ?? SYSTEMS_URL, list: SYSTEMS_URL };
  return game.i18n.format(`FASTFIGHTING.Helper.${status.reason}`, data);
}

/** HTML notice with links, for the settings window and the Combat Tracker. */
export function helperNoticeHtml(status = helperStatus()) {
  const esc = s => foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s)) : String(s);
  const link = status.known
    ? `<a href="${status.known.url}" target="_blank" rel="noopener">${esc(status.known.title)}</a>`
    : `<a href="${SYSTEMS_URL}" target="_blank" rel="noopener">${esc(game.i18n.localize("FASTFIGHTING.Helper.ListLink"))}</a>`;
  return `<div class="ff-helper-notice ff-helper-${status.reason}">
    <i class="fa-solid fa-puzzle-piece"></i>
    <div><strong>${esc(game.i18n.format("FASTFIGHTING.Helper.Title", { system: status.systemTitle }))}</strong>
    <p>${esc(helperMessage(status))}</p>
    <p>${link} · <a href="${SYSTEMS_URL}" target="_blank" rel="noopener">${esc(game.i18n.localize("FASTFIGHTING.Helper.ListLink"))}</a></p></div>
  </div>`;
}
