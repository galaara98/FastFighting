/**
 * FastFighting's tab in the token windows (GM only): the tactics, playstyles and desires the players' survey asks.
 *  - A token on the map, linked or not: its own (an unlinked token's are its alone; a linked token shares its actor's).
 *  - The Prototype Token, opened from an actor: the actor's, where every new token of it starts.
 * Answers save as they change, as in the survey, and every open view of the same actor follows along.
 */
import { MODULE_ID } from "../constants.js";
import { getAdapter } from "../api.js";
import { cachedCharacterSpec, showsReactions } from "../foundry/sheet-watch.js";
import { localize } from "../i18n.js";
import { questionsContext, setTactic, togglePlaystyle, movePlaystyle, syncTacticsDom, playstyleSignature, reactionsSignature, listenTacticsSections } from "../foundry/tactics.js";
import { listenMenus } from "./menus.js";
import { HAZARD_MARKS, applyHazard } from "../foundry/battle.js";
import { ensureAutoConfig, resetAndAutoConfig } from "../foundry/auto-config.js";
import { HUNGER_MARKS, knowsFood } from "../foundry/food.js";

const TAB = "fastFighting";
const TEMPLATE = `modules/${MODULE_ID}/templates/token-tactics.hbs`;
const PARTIAL = `modules/${MODULE_ID}/templates/partials/tactics.hbs`;

/** Reading strikes and spells is slow: each window keeps what it read. */
const specs = new WeakMap();

/** The open token windows with this tab, each with its panel. */
function openTabs() {
  const out = [];
  for ( const app of foundry.applications.instances.values() ) {
    const panel = app.element?.querySelector?.(`.tab[data-tab="${TAB}"]`);
    if ( panel ) out.push([app, panel]);
  }
  return out;
}

/** The tab in every token window: the base class's render hook covers the Prototype Token and each system's own. */
export function registerTokenTactics() {
  Hooks.once("init", () => foundry.applications.handlebars.loadTemplates([TEMPLATE, PARTIAL]));
  // (A character's items or effects changed: its reactions read again, the tab drawn again if they're not the same.)
  showsReactions({
    shows: actor => openTabs().some(([app]) => actorOf(app)?.uuid === actor.uuid),
    async recheck(actor) {
      for ( const [app, panel] of openTabs() ) {
        if ( actorOf(app)?.uuid !== actor.uuid ) continue;
        const before = specs.get(app);
        const now = await readSpec(app, actor);
        if ( !now || reactionsSignature(before, actor) === reactionsSignature(now, actor) ) continue;
        specs.set(app, now);
        fill(app, panel);
      }
    }
  });
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

/** A window's character as it reads (read again only if it changed since: sheet-watch.js), or null. */
async function readSpec(app, actor) {
  try {
    return await cachedCharacterSpec(getAdapter(), app.isPrototype ? await actor.getTokenDocument() : app.document);
  } catch ( err ) {
    console.warn(`${MODULE_ID} | the token window could not read ${actor.name}`, err);
    return null;
  }
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
    spec = await readSpec(app, actor);
    if ( !spec ) return;
    specs.set(app, spec);
  }
  // Any token can be a hazard (the GM's mark), or not be one; a hazard has no tactics to set. (Not one a player owns: its
  // flags are the player's to write, so the mark wouldn't count.)
  const markable = !actor.hasPlayerOwner;
  const hazard = markable ? actor.getFlag(MODULE_ID, "hazard") ?? "" : "";
  const isHazard = !!applyHazard({ ...spec, flags: { ...spec.flags } }, hazard).hazard;
  // (Never set up, or its calculated answers out of date: set up by itself first.)
  if ( !isHazard ) await ensureAutoConfig(actor, spec);
  const html = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    appId: app.id,
    hint: localize("FASTFIGHTING.TokenTactics.Hint"),
    adhd: Math.round(Number(actor.getFlag(MODULE_ID, "adhd")) || 0),
    hazard,
    markable,
    hazardChoices: Object.fromEntries(HAZARD_MARKS.map(k => [k, localize(`FASTFIGHTING.TokenTactics.HazardMark.${k || "system"}`)])),
    // (Its name kept from the players in a live battle's story, however long they've seen it.)
    secretName: markable && !!actor.getFlag(MODULE_ID, "secretName"),
    // (Its hunger, the GM's word over FastFighting's roll: only where the system keeps food. foundry/food.js.)
    hungerMarks: markable && !isHazard && knowsFood(adapter) ? Object.fromEntries(HUNGER_MARKS.map(k => [k, localize(`FASTFIGHTING.TokenTactics.HungerMark.${k || "auto"}`)])) : null,
    hunger: markable ? actor.getFlag(MODULE_ID, "hunger") ?? "" : "",
    isHazard,
    // (No desires here: a desire names a creature someone can perceive on the battle map, which a token window can't tell.)
    tactics: isHazard ? null : questionsContext(spec, actor, `token-${app.id}`, { targets: null })
  });
  panel.innerHTML = html;
  panel.dataset.ffSignature = playstyleSignature(actor);
  // The token window's own form leaves these alone: no names to submit, no actions of its own to run.
  for ( const el of panel.querySelectorAll("[name]") ) el.removeAttribute("name");
  for ( const el of panel.querySelectorAll("[data-action]") ) {
    el.dataset.ffAction = el.dataset.action;
    delete el.dataset.action;
  }
}

/** Answers save as they change. */
function listen(app, panel) {
  listenMenus(panel);
  listenTacticsSections(panel);
  panel.addEventListener("change", async event => {
    const el = event.target;
    // Its name kept secret in the story: kept with its tactics.
    if ( el?.dataset?.ffSetting === "secretName" ) {
      event.stopPropagation();
      const actor = actorOf(app);
      if ( el.checked ) await actor.setFlag(MODULE_ID, "secretName", true);
      else await actor.unsetFlag(MODULE_ID, "secretName");
      return;
    }
    // Its hunger: kept with its tactics.
    if ( el?.dataset?.ffSetting === "hunger" ) {
      event.stopPropagation();
      const actor = actorOf(app);
      if ( HUNGER_MARKS.includes(el.value) && el.value ) await actor.setFlag(MODULE_ID, "hunger", el.value);
      else await actor.unsetFlag(MODULE_ID, "hunger");
      return;
    }
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
    const act = button.dataset.ffAction;
    if ( act === "togglePlaystyle" ) {
      if ( !await togglePlaystyle(actor, button.dataset.playstyle) ) ui.notifications.warn(localize("FASTFIGHTING.Playstyle.Max"));
    } else if ( act === "movePlaystyle" ) await movePlaystyle(actor, button.dataset.playstyle, Number(button.dataset.dir));
    // Its own ADHD, ten points at a time: kept with its tactics.
    else if ( act === "adhd" ) await setAdhd(actor, (Number(actor.getFlag(MODULE_ID, "adhd")) || 0) + 10 * Math.sign(Number(button.dataset.dir) || 0));
    else if ( act === "resetAll" ) {
      // (After asking: every answer back to "Let this character decide", the playstyles picked again.)
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.format("FASTFIGHTING.Survey.ResetTitle", { name: actor.name }) },
        content: `<p>${foundry.utils.escapeHTML(localize("FASTFIGHTING.Survey.ResetConfirm"))}</p>`
      });
      if ( !ok ) return;
      await resetAndAutoConfig(actor, specs.get(app));
    } else return;
    fill(app, panel);
  });
}

/**
 * A creature's own ADHD, 0 to 100% (its actor's flag; none at 0): a nudge to its Tactical, engine/battle-state.js. Set
 * from its token's FastFighting tab or the planner.
 */
export async function setAdhd(actor, value) {
  const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  if ( v ) await actor.setFlag(MODULE_ID, "adhd", v);
  else await actor.unsetFlag(MODULE_ID, "adhd");
}

/** Someone else changed this actor's answers: every open token window showing it follows along. */
export function syncTokenTactics(actor) {
  for ( const [app, panel] of openTabs() ) {
    if ( actorOf(app)?.uuid !== actor.uuid ) continue;
    // (A change to what shows, such as a playstyle: drawn again; anything else, patched in place.)
    if ( panel.dataset.ffSignature !== playstyleSignature(actor) ) fill(app, panel);
    else syncTacticsDom(panel, actor);
  }
}
