/**
 * FastFighting: estimate the outcome of a battle from the tokens on the scene.
 */
import { MODULE_ID } from "./constants.js";
import { registerSettings } from "./settings.js";
import { buildApi, registerAdapter } from "./api.js";
import { BattlePlanner } from "./apps/battle-planner.js";
import { DefaultsConfig } from "./apps/defaults-config.js";
import { GenericAdapter } from "./adapters/generic/index.js";
import { GenericPathsConfig } from "./apps/generic-paths-config.js";
import { StoryTablesConfig } from "./apps/story-tables-config.js";
import { invalidateStoryTables, installStoryTables } from "./story/tables.js";
import { PlayerSurvey } from "./apps/player-survey.js";
import { SOCKET, SURVEY_STATUS } from "./foundry/tactics.js";
import { helperStatus, helperMessage, helperNoticeHtml } from "./helpers.js";
import { invalidateApproach } from "./foundry/battle.js";
import { undoConcession, revealStory } from "./foundry/make-it-so.js";

Hooks.once("init", () => {
  registerSettings(DefaultsConfig, GenericPathsConfig, StoryTablesConfig);

  // System support comes from helper modules (FastFighting PF2e, ...). The generic adapter ("*") is the
  // fallback for systems nobody supports yet.
  registerAdapter("*", GenericAdapter, { priority: -100, source: MODULE_ID });

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
  if ( !game.user.isGM ) return;
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
  // Tell the GM once if this system has no helper module yet.
  const status = helperStatus();
  if ( game.user.isGM && !status.specific ) ui.notifications[status.ready ? "info" : "warn"](helperMessage(status), { permanent: !status.ready });
  // The GM's "Prepare Players" request opens the survey on the chosen players' screens. Foundry passes the
  // sender's user id; only a GM may open surveys on someone else's screen.
  game.socket.on(SOCKET, (data, senderId) => {
    if ( !game.users.get(senderId)?.isGM ) return;
    if ( data?.action === "openSurvey" && data.userIds?.includes(game.user.id) ) {
      PlayerSurvey.open({ sceneId: data.sceneId, requestId: data.requestId });
    }
  });
  // A player who was asked while offline (or reloads mid-survey) gets it on login.
  if ( !game.user.isGM ) {
    const s = game.user.getFlag(MODULE_ID, "survey");
    if ( s && [SURVEY_STATUS.REQUESTED, SURVEY_STATUS.ENTERING].includes(s.status) && game.scenes.get(s.sceneId) ) {
      PlayerSurvey.open({ sceneId: s.sceneId, requestId: s.requestId });
    }
  }
});

/* Live sync: answers are actor flags, so every open planner and survey patches itself in place. */
function syncOpenViews(actor) {
  if ( !actor ) return;
  foundry.applications.instances.get("fast-fighting-survey")?.syncActor(actor);
  foundry.applications.instances.get("fast-fighting-planner")?.syncActor(actor);
}

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
});
Hooks.on("userConnected", () => {
  if ( game.user.isGM ) refreshPlanner();
});

// The planner belongs to the scene on screen: viewing another scene starts it afresh.
Hooks.on("canvasReady", () => {
  const app = foundry.applications.instances.get("fast-fighting-planner");
  if ( app?.rendered && app.sceneId !== canvas.scene?.id && !app.running ) {
    app.resetForScene();
    app.render();
  }
});

// Walls and regions change the paths tokens take.
for ( const hook of ["createWall", "updateWall", "deleteWall", "createRegion", "updateRegion", "deleteRegion",
  "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"] ) {
  Hooks.on(hook, () => invalidateApproach());
}

// A GM-only story: the GM can show it to everyone.
Hooks.on("renderChatMessageHTML", (message, html) => {
  const button = html.querySelector?.("[data-ff-reveal]");
  if ( !button ) return;
  if ( !game.user.isGM || !message.getFlag(MODULE_ID, "revealable") ) {
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
  if ( !game.user.isGM || message.getFlag(MODULE_ID, "concession")?.undone ) {
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
