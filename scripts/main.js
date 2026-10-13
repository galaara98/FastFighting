/**
 * FastFighting: estimate the outcome of a battle from the tokens on the scene.
 */
import { MODULE_ID } from "./constants.js";
import { registerSettings } from "./settings.js";
import { buildApi, registerAdapter, getAdapter } from "./api.js";
import { BattlePlanner } from "./apps/battle-planner.js";
import { DefaultsConfig } from "./apps/defaults-config.js";
import { GenericAdapter } from "./adapters/generic/index.js";
import { GenericPathsConfig } from "./apps/generic-paths-config.js";
import { StoryTablesConfig } from "./apps/story-tables-config.js";
import { invalidateStoryTables, installStoryTables } from "./story/tables.js";
import { PlayerSurvey } from "./apps/player-survey.js";
import { registerTokenTactics, syncTokenTactics } from "./apps/token-tactics.js";
import { SOCKET, SURVEY_STATUS, hasCharactersFor } from "./foundry/tactics.js";
import { helperStatus, helperMessage, helperNoticeHtml } from "./helpers.js";
import { invalidateApproach } from "./foundry/battle.js";
import { undoConcession, revealStory, ownCard } from "./foundry/make-it-so.js";
import { sceneUnit } from "./foundry/terrain.js";
import { planHolder } from "./foundry/persistence.js";
import { setDistanceUnit, setTermSource, localize } from "./i18n.js";
import { loadKeywords } from "./foundry/keywords.js";

Hooks.once("init", () => {
  registerSettings(DefaultsConfig, GenericPathsConfig, StoryTablesConfig);

  // System support comes from helper modules (FastFighting PF2e, ...). The generic adapter ("*") is the
  // fallback for systems nobody supports yet.
  registerAdapter("*", GenericAdapter, { priority: -100, source: MODULE_ID });
  // The game's words for armor class and hit points: its helper's, else FastFighting's generic ones.
  setTermSource(key => getAdapter()?.term?.(key));
  // Text in templates that says {AC} or {HP}.
  Handlebars.registerHelper("ffLocalize", (key, options) => localize(key, options?.hash));

  const api = buildApi({ openPlanner: () => openIfReady(), openSurvey: options => PlayerSurvey.open(options), installStoryTables, BattlePlanner, PlayerSurvey });
  game.modules.get(MODULE_ID).api = api;
  Hooks.callAll("fastFighting.init", api);

  game.keybindings.register(MODULE_ID, "openPlanner", {
    name: "FASTFIGHTING.Keybinding.Open",
    editable: [{ key: "KeyB", modifiers: ["Shift"] }],
    restricted: true,
    onDown: () => {
      openIfReady();
      return true;
    }
  });
});

/* The Battle Planner lives at the top of the Combat Tracker, for GMs, once an encounter has two tokens. */
function encounterReady() {
  const combat = ui.combat?.viewed;
  return !!combat && combat.combatants.filter(c => c.tokenId).length >= 2;
}

function openIfReady() {
  if ( !game.user.isGM ) return;
  const status = helperStatus();
  if ( !status.ready ) return ui.notifications.warn(helperMessage(status));
  if ( !encounterReady() ) return ui.notifications.info(game.i18n.localize("FASTFIGHTING.Tracker.NeedTwo"));
  BattlePlanner.open();
}

Hooks.on("renderCombatTracker", (app, element) => {
  if ( !game.user.isGM ) return myTacticsButton(element);
  const root = element instanceof HTMLElement ? element : element?.[0];
  const header = root?.querySelector(".combat-tracker-header") ?? root;
  if ( !header ) return;
  header.querySelector(".ff-tracker-open")?.remove();
  header.querySelector(".ff-helper-notice")?.remove();
  // Without a helper for this system, say so instead of offering the planner.
  const status = helperStatus();
  if ( !status.ready ) {
    header.insertAdjacentHTML("afterbegin", helperNoticeHtml(status));
    return;
  }
  const ready = encounterReady();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ff-tracker-open";
  button.disabled = !ready;
  button.dataset.tooltip = game.i18n.localize(ready ? "FASTFIGHTING.Tracker.OpenHint" : "FASTFIGHTING.Tracker.NeedTwo");
  button.innerHTML = `<i class="fa-solid fa-swords"></i> ${game.i18n.localize("FASTFIGHTING.Planner.Title")}`;
  button.addEventListener("click", event => {
    event.preventDefault();
    openIfReady();
  });
  header.prepend(button);
});

/**
 * A player who controls a token on the battle map, or owns a character, can open its own tactics any time from the
 * Encounters tab (in a fight or not, asked by the GM or not).
 */
function myTacticsButton(element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  const header = root?.querySelector(".combat-tracker-header") ?? root;
  if ( !header ) return;
  header.querySelector(".ff-my-tactics")?.remove();
  // (The players' survey: a GM answers for a character from the planner.)
  if ( game.user.isGM || !helperStatus().ready || !hasCharactersFor(canvas.scene, game.user) ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ff-tracker-open ff-my-tactics";
  button.dataset.tooltip = game.i18n.localize("FASTFIGHTING.Survey.MyTacticsHint");
  button.innerHTML = `<i class="fa-solid fa-clipboard-question"></i> ${game.i18n.localize("FASTFIGHTING.Survey.MyTactics")}`;
  button.addEventListener("click", event => {
    event.preventDefault();
    PlayerSurvey.open({ sceneId: canvas.scene?.id });
  });
  header.prepend(button);
}

// A player's characters on the map change: its button comes and goes.
const refreshMyTactics = foundry.utils.debounce(() => { if ( !game.user.isGM ) ui.combat?.render(); }, 300);
for ( const hook of ["createToken", "deleteToken", "canvasReady", "createActor", "deleteActor"] ) Hooks.on(hook, () => refreshMyTactics());
Hooks.on("updateActor", (actor, changes) => { if ( "ownership" in changes ) refreshMyTactics(); });

// Encounter changes re-read the roster in an open planner.
const refreshRoster = foundry.utils.debounce(() => {
  const app = foundry.applications.instances.get("fast-fighting-planner");
  if ( app?.rendered && !app.running ) {
    app.roster = null;
    app.render();
  }
}, 200);
for ( const hook of ["createCombatant", "deleteCombatant", "createCombat", "deleteCombat", "combatStart"] ) {
  Hooks.on(hook, () => { if ( game.user.isGM ) refreshRoster(); });
}

Hooks.once("ready", () => {
  // (The keywords read in characters' biographies: English, and the reader's language's on top.)
  loadKeywords();
  // Tell the GM once if this system has no helper module yet.
  const status = helperStatus();
  if ( game.user.isGM && !status.specific ) ui.notifications[status.ready ? "info" : "warn"](helperMessage(status), { permanent: !status.ready });
  // The GM's "Prepare Players" request opens the survey on the chosen players' screens. Foundry passes the
  // sender's user id; only a GM may open surveys on someone else's screen.
  game.socket.on(SOCKET, (data, senderId) => {
    if ( !game.users.get(senderId)?.isGM || !data?.userIds?.includes(game.user.id) ) return;
    // (A player's survey never opens on a GM's screen; one character's for the GMs only on theirs.)
    if ( data.action === "openSurvey" && !game.user.isGM ) {
      PlayerSurvey.open({ sceneId: data.sceneId, requestId: data.requestId, start: data.start, partyReadOnly: data.partyReadOnly });
    }
    if ( data.action === "openGmSurvey" && game.user.isGM ) PlayerSurvey.open({ sceneId: data.sceneId, start: data.key, only: data.key });
  });
  // A player who was asked while offline (or reloads mid-survey) gets it on login.
  if ( !game.user.isGM ) {
    const s = game.user.getFlag(MODULE_ID, "survey");
    if ( s && [SURVEY_STATUS.REQUESTED, SURVEY_STATUS.ENTERING].includes(s.status) && game.scenes.get(s.sceneId) ) {
      PlayerSurvey.open({ sceneId: s.sceneId, requestId: s.requestId, start: s.start, partyReadOnly: s.partyReadOnly });
    }
  }
});

/* Live sync: answers are actor flags, so every open planner and survey patches itself in place. */
function syncOpenViews(actor) {
  if ( !actor ) return;
  foundry.applications.instances.get("fast-fighting-survey")?.syncActor(actor);
  foundry.applications.instances.get("fast-fighting-planner")?.syncActor(actor);
  syncTokenTactics(actor);
}

// FastFighting's tab in the token windows (GM only): a token's tactics, playstyles and desires, or its prototype's.
registerTokenTactics();

const touchesTactics = changes => foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)
  || foundry.utils.hasProperty(changes, `delta.flags.${MODULE_ID}`);

Hooks.on("updateActor", (actor, changes) => {
  if ( touchesTactics(changes) ) syncOpenViews(actor);
});
Hooks.on("updateToken", (tokenDoc, changes) => {
  if ( touchesTactics(changes) ) syncOpenViews(tokenDoc.actor);
});
Hooks.on("updateActorDelta", (delta, changes) => {
  if ( touchesTactics(changes) ) syncOpenViews(delta.parent?.actor);
});

// Survey status changes and players connecting refresh the GM's indicators.
const refreshPlanner = foundry.utils.debounce(() => {
  const app = foundry.applications.instances.get("fast-fighting-planner");
  if ( app?.rendered && !app.running ) app.render();
}, 150);
Hooks.on("updateUser", (user, changes) => {
  if ( game.user.isGM && (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) || "active" in changes) ) refreshPlanner();
  // (A player voted on the party's wishes: every open survey's Party tab shows it.)
  if ( foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.party`) || foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.-=party`) ) {
    foundry.applications.instances.get("fast-fighting-survey")?.syncParty?.();
  }
});
Hooks.on("userConnected", () => {
  if ( game.user.isGM ) refreshPlanner();
});

// Hostile and neutral pills in the system's disposition colors (the token borders), with text that reads on them.
Hooks.once("ready", () => {
  const colors = CONFIG.Canvas?.dispositionColors ?? {};
  const root = document.documentElement.style;
  for ( const [key, name] of [["HOSTILE", "hostile"], ["NEUTRAL", "neutral"]] ) {
    if ( !Number.isFinite(colors[key]) ) continue;
    const r = (colors[key] >> 16) & 255, g = (colors[key] >> 8) & 255, b = colors[key] & 255;
    root.setProperty(`--ff-disposition-${name}`, `rgb(${r}, ${g}, ${b})`);
    root.setProperty(`--ff-disposition-${name}-text`, (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#222" : "#fff");
  }
});

// Distances read in the viewed scene's units (metres on a metric map; the engine counts feet).
const useSceneUnits = () => setDistanceUnit(canvas.scene ? sceneUnit(canvas.scene) : null);
Hooks.on("canvasReady", useSceneUnits);
Hooks.on("updateScene", (scene, changes) => {
  if ( scene.id === canvas.scene?.id && "grid" in changes ) useSceneUnits();
});

// The planner belongs to the scene on screen, and to its encounter: each encounter has a plan of its own, so viewing
// another scene, or another encounter (or one starting or ending), starts it on that one.
const followPlan = () => {
  const app = foundry.applications.instances.get("fast-fighting-planner");
  if ( !app?.rendered || app.running ) return;
  if ( app.sceneId === canvas.scene?.id && app.holderUuid === (planHolder()?.uuid ?? null) ) return;
  app.resetForScene();
  app.render();
};
Hooks.on("canvasReady", followPlan);
for ( const hook of ["createCombat", "deleteCombat", "updateCombat"] ) Hooks.on(hook, () => followPlan());

// Someone joins (or leaves) the planner's encounter, or a token comes or goes on its scene: the planner takes them in,
// keeping the GM's plan as it stands (only the encounter ending, or the GM clearing the plan, starts it afresh).
const rereadRoster = foundry.utils.debounce(() => {
  const app = foundry.applications.instances.get("fast-fighting-planner");
  if ( app?.rendered ) app.rereadRoster(); // (during a run, as soon as it ends)
}, 150);
Hooks.on("createCombatant", combatant => { if ( combatant.parent?.uuid === planHolder()?.uuid ) rereadRoster(); });
Hooks.on("deleteCombatant", combatant => { if ( combatant.parent?.uuid === planHolder()?.uuid ) rereadRoster(); });
for ( const hook of ["createToken", "deleteToken"] ) Hooks.on(hook, token => { if ( token.parent?.id === canvas.scene?.id ) rereadRoster(); });

// Walls and regions change the paths tokens take.
for ( const hook of ["createWall", "updateWall", "deleteWall", "createRegion", "updateRegion", "deleteRegion",
  "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"] ) {
  Hooks.on(hook, () => invalidateApproach());
}

// A GM-only story: the GM can show it to everyone.
Hooks.on("renderChatMessageHTML", (message, html) => {
  const button = html.querySelector?.("[data-ff-reveal]");
  if ( !button ) return;
  if ( !game.user.isGM || !ownCard(message) || !message.getFlag(MODULE_ID, "revealable") ) {
    button.remove();
    return;
  }
  button.addEventListener("click", async event => {
    event.preventDefault();
    button.disabled = true;
    await revealStory(message);
  });
});

// A PC's loss card: its Undo puts back just that hand-over (GMs only).
Hooks.on("renderChatMessageHTML", (message, html) => {
  const button = html.querySelector?.("[data-ff-undo-concession]");
  if ( !button ) return;
  if ( !game.user.isGM || !ownCard(message) || message.getFlag(MODULE_ID, "concession")?.undone ) {
    button.remove();
    return;
  }
  button.addEventListener("click", async event => {
    event.preventDefault();
    button.disabled = true;
    await undoConcession(message);
  });
});

// Edited story tables take effect immediately.
for ( const hook of ["createRollTable", "updateRollTable", "deleteRollTable", "createTableResult", "updateTableResult", "deleteTableResult"] ) {
  Hooks.on(hook, () => invalidateStoryTables());
}

/* Without a helper the settings are greyed out, with a notice pointing at the supported systems. */
Hooks.on("renderSettingsConfig", (app, element) => {
  const root = element instanceof HTMLElement ? element : element?.[0];
  const section = root?.querySelector(`section[data-category="${MODULE_ID}"]`);
  if ( !section ) return;
  section.querySelector(".ff-helper-notice")?.remove();
  // (Only the settings the system's helper acts on: leaving loot, taking a corpse away, only some do.)
  if ( !getAdapter()?.supportsLoot ) {
    for ( const key of ["lootMode", "corpseMode"] ) section.querySelector(`[name="${MODULE_ID}.${key}"]`)?.closest(".form-group")?.remove();
  }
  const status = helperStatus();
  if ( status.specific ) return;
  section.insertAdjacentHTML("afterbegin", helperNoticeHtml(status));
  if ( status.generic ) return; // the GM opted into the generic adapter: everything stays usable
  for ( const el of section.querySelectorAll("input, select, textarea, button, file-picker, range-picker") ) {
    if ( el.name === `${MODULE_ID}.genericFallback` || el.closest(".ff-helper-notice") ) continue;
    el.disabled = true;
    el.closest(".form-group")?.classList.add("ff-disabled");
  }
});
