/**
 * Does this world's game system have a FastFighting helper? The core does nothing useful on its own: system
 * helper modules teach it how a system works. Without one, FastFighting greys out its settings and points
 * the GM at the list of supported systems (systems.md).
 */
import { MODULE_ID } from "./constants.js";
import { escapeHtml as esc } from "./i18n.js";
import { hasSystemAdapter } from "./api.js";

export const SYSTEMS_URL = "https://github.com/galaara98/FastFighting/blob/main/systems.md";

/** The optional performance survey: how many fights the planner runs, on what (linked at the foot of the settings). */
export const SURVEY_URL = "https://tally.so/r/vXjzAv";

/** The survey's link, for the foot of FastFighting's settings. */
export function surveyHtml() {
  return `<p class="ff-perf-survey"><i class="fa-solid fa-gauge-high"></i>
    <a href="${SURVEY_URL}" target="_blank" rel="noopener">${esc(game.i18n.localize("FASTFIGHTING.Settings.Survey.Link"))}</a>
    <span class="hint">${esc(game.i18n.localize("FASTFIGHTING.Settings.Survey.Hint"))}</span></p>`;
}

/** Helper modules we know about, by game system id (keep in sync with systems.md). Their titles: FASTFIGHTING.Helper.Module. */
export const KNOWN_HELPERS = Object.freeze({
  pf2e: { module: "fast-fighting-pf2e", url: "https://github.com/galaara98/FastFighting-PF2e" },
  dnd5e: { module: "fast-fighting-dnd5e", url: "https://github.com/galaara98/FastFighting-DnD5e" },
  dcc: { module: "fast-fighting-dcc", url: "https://github.com/galaara98/FastFighting-DCC" },
  "foundry-ironsworn": { module: "fast-fighting-ironsworn", url: "https://github.com/galaara98/FastFighting-Ironsworn" },
  daggerheart: { module: "fast-fighting-daggerheart", url: "https://github.com/galaara98/FastFighting-Daggerheart" }
});

/**
 * @returns {{systemId, systemTitle, specific: boolean, generic: boolean, ready: boolean, known: object|null,
 *           installed: boolean, enabled: boolean, reason: "ok"|"generic"|"disabled"|"notInstalled"|"unknown"}}
 */
export function helperStatus() {
  const systemId = game.system.id;
  const specific = hasSystemAdapter(systemId);
  const generic = !specific && !!game.settings.get(MODULE_ID, "genericFallback");
  const known = KNOWN_HELPERS[systemId] ? { ...KNOWN_HELPERS[systemId], title: game.i18n.localize(`FASTFIGHTING.Helper.Module.${systemId}`) } : null;
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
