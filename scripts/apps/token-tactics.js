/**
 * FastFighting's tab in the token windows (GM only): the tactics, playstyles and desires the players' survey asks.
 *  - A token on the map, linked or not: its own (an unlinked token's are its alone; a linked token shares its actor's).
 *  - The Prototype Token, opened from an actor: the actor's, where every new token of it starts.
 * Answers save as they change, as in the survey, and every open view of the same actor follows along.
 */
import { MODULE_ID } from "../constants.js";
import { getAdapter } from "../api.js";
import { localize } from "../i18n.js";
import { questionsContext, setTactic, togglePlaystyle, syncTacticsDom } from "../foundry/tactics.js";
import { HAZARD_MARKS, applyHazard } from "../foundry/battle.js";

const TAB = "fastFighting";
const TEMPLATE = `modules/${MODULE_ID}/templates/token-tactics.hbs`;
const PARTIAL = `modules/${MODULE_ID}/templates/partials/tactics.hbs`;

/** Reading strikes and spells is slow: each window keeps what it read. */
const specs = new WeakMap();

/** The tab in every token window: the base class's render hook covers the Prototype Token and each system's own. */
export function registerTokenTactics() {
  Hooks.once("init", () => foundry.applications.handlebars.loadTemplates([TEMPLATE, PARTIAL]));
  Hooks.on("renderTokenApplication", (app, element) => {
    if ( game.user.isGM ) addTab(app, element);
  });
}

/** Whose answers a token window edits: the token's actor (its own when unlinked), or the prototype's actor. */
const actorOf = app => (app.isPrototype ? app.actor : app.document?.actor) ?? null;

function addTab(app, element) {
  const actor = actorOf(app);
  const nav = element.querySelector('[data-application-part="tabs"]');
  const tabs = [...element.querySelectorAll('.tab[data-group="sheet"]')];
  if ( !actor || !nav || !tabs.length ) return;
  const active = app.tabGroups?.sheet === TAB;
  // (A window's tabs come back on each render; the panel stays, and is filled once.)
  if ( !nav.querySelector(`[data-tab="${TAB}"]`) ) {
    const link = document.createElement("a");
    Object.assign(link.dataset, { action: "tab", group: "sheet", tab: TAB });
    link.classList.toggle("active", active);
    link.innerHTML = '<i class="fa-solid fa-swords" inert></i> <span></span>';
    link.querySelector("span").textContent = localize("FASTFIGHTING.TokenTactics.Tab");
    nav.append(link);
  }
  let panel = element.querySelector(`.tab[data-tab="${TAB}"]`);
  if ( panel ) return panel.classList.toggle("active", active);
  panel = document.createElement("div");
  panel.className = `tab scrollable fast-fighting ff-token-tactics${active ? " active" : ""}`;
  Object.assign(panel.dataset, { group: "sheet", tab: TAB });
  tabs.at(-1).after(panel);
  listen(app, panel);
  fill(app, panel);
}

/** The questions, as the survey asks them, for this window's actor. */
async function fill(app, panel) {
  const actor = actorOf(app);
  const adapter = getAdapter();
  if ( !actor || !adapter ) {
    panel.innerHTML = `<p class="hint"></p>`;
    panel.querySelector("p").textContent = localize("FASTFIGHTING.Planner.NoAdapter");
    return;
  }
  let spec = specs.get(app);
  if ( !spec ) {
    try {
      spec = await adapter.toCombatantSpec(app.isPrototype ? await actor.getTokenDocument() : app.document);
    } catch ( err ) {
      console.warn(`${MODULE_ID} | the token window could not read ${actor.name}`, err);
    }
    if ( !spec ) return;
    specs.set(app, spec);
  }
  // A desire can name another token on the same scene (a prototype has no scene to name one from).
  const scene = app.isPrototype ? null : app.document?.parent;
  const targets = scene?.tokens?.filter(o => o.actor && o.id !== app.document.id).map(o => ({ id: o.id, name: o.name })) ?? [];
  // Any token can be a hazard (the GM's mark), or not be one; a hazard has no tactics to set.
  const hazard = actor.getFlag(MODULE_ID, "hazard") ?? "";
  const isHazard = !!applyHazard({ ...spec, flags: { ...spec.flags } }, hazard).hazard;
  const html = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    hint: localize("FASTFIGHTING.TokenTactics.Hint"),
    hazard,
    hazardChoices: Object.fromEntries(HAZARD_MARKS.map(k => [k, localize(`FASTFIGHTING.TokenTactics.HazardMark.${k || "system"}`)])),
    isHazard,
    tactics: isHazard ? null : questionsContext(spec, actor, `token-${app.id}`, { targets })
  });
  panel.innerHTML = html;
  // The token window's own form leaves these alone: no names to submit, no actions of its own to run.
  for ( const el of panel.querySelectorAll("[name]") ) el.removeAttribute("name");
  for ( const el of panel.querySelectorAll("[data-action]") ) {
    el.dataset.ffAction = el.dataset.action;
    delete el.dataset.action;
  }
}

/** Answers save as they change. */
function listen(app, panel) {
  panel.addEventListener("change", async event => {
    const el = event.target;
    // Whether it's a hazard: kept with its tactics.
    if ( el?.dataset?.ffSetting === "hazard" ) {
      event.stopPropagation();
      const actor = actorOf(app);
      if ( HAZARD_MARKS.includes(el.value) && el.value ) await actor.setFlag(MODULE_ID, "hazard", el.value);
      else await actor.unsetFlag(MODULE_ID, "hazard");
      return fill(app, panel);
    }
    const key = el?.dataset?.tactic;
    if ( !key ) return;
    event.stopPropagation();
    const actor = actorOf(app);
    const value = el.type === "checkbox" ? el.checked : el.value;
    el.closest(".ff-q")?.classList.toggle("is-auto", value === "auto");
    await setTactic(actor, key, value);
    if ( el.type === "checkbox" ) fill(app, panel);
  });
  panel.addEventListener("click", async event => {
    const button = event.target.closest("[data-ff-action]");
    if ( !button ) return;
    event.preventDefault();
    event.stopPropagation();
    const actor = actorOf(app);
    if ( button.dataset.ffAction === "togglePlaystyle" ) {
      if ( !await togglePlaystyle(actor, button.dataset.playstyle) ) ui.notifications.warn(localize("FASTFIGHTING.Playstyle.Max"));
    } else if ( button.dataset.ffAction === "resetAll" ) await actor.unsetFlag(MODULE_ID, "tactics");
    fill(app, panel);
  });
}

/** Someone else changed this actor's answers: every open token window showing it follows along. */
export function syncTokenTactics(actor) {
  for ( const app of foundry.applications.instances.values() ) {
    const panel = app.element?.querySelector?.(`.tab[data-tab="${TAB}"]`);
    if ( panel && actorOf(app)?.uuid === actor.uuid ) syncTacticsDom(panel, actor);
  }
}
