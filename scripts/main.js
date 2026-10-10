/**
 * FastFighting: estimate the outcome of a battle from the tokens on the scene.
 */
import { MODULE_ID } from "./constants.js";
import { registerSettings } from "./settings.js";
import { buildApi, registerAdapter } from "./api.js";
import { Pf2eAdapter } from "./adapters/pf2e/index.js";
import { BattlePlanner } from "./apps/battle-planner.js";
import { DefaultsConfig } from "./apps/defaults-config.js";
import { GenericAdapter } from "./adapters/generic/index.js";
import { GenericPathsConfig } from "./apps/generic-paths-config.js";
import { PlayerSurvey } from "./apps/player-survey.js";
import { SOCKET, SURVEY_STATUS } from "./foundry/tactics.js";

Hooks.once("init", () => {
  registerSettings(DefaultsConfig, GenericPathsConfig);

  // Built-in adapters register at priority 0 so helper modules can replace them.
  // The generic adapter ("*") is the fallback for systems nobody supports yet.
  registerAdapter("pf2e", Pf2eAdapter, { priority: 0, source: MODULE_ID });
  registerAdapter("*", GenericAdapter, { priority: -100, source: MODULE_ID });

  const api = buildApi({ openPlanner: () => BattlePlanner.open(), openSurvey: options => PlayerSurvey.open(options), BattlePlanner, PlayerSurvey });
  game.modules.get(MODULE_ID).api = api;
  Hooks.callAll("fastFighting.init", api);

  game.keybindings.register(MODULE_ID, "openPlanner", {
    name: "FASTFIGHTING.Keybinding.Open",
    editable: [{ key: "KeyB", modifiers: ["Shift"] }],
    restricted: true,
    onDown: () => {
      if ( game.user.isGM ) BattlePlanner.open();
      return true;
    }
  });
});

Hooks.on("getSceneControlButtons", controls => {
  if ( !game.user?.isGM || !controls.tokens ) return;
  controls.tokens.tools.fastFighting = {
    name: "fastFighting",
    title: "FASTFIGHTING.Planner.Title",
    icon: "fa-solid fa-swords",
    order: Object.keys(controls.tokens.tools).length,
    button: true,
    visible: game.user.isGM,
    onChange: () => BattlePlanner.open()
  };
});

Hooks.on("renderTokenHUD", (hud, element) => {
  if ( !game.user.isGM ) return;
  const column = element.querySelector(".col.right") ?? element.querySelector(".col.left");
  if ( !column || column.querySelector(".ff-hud") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon ff-hud";
  button.dataset.tooltip = game.i18n.localize("FASTFIGHTING.Planner.Title");
  button.innerHTML = `<i class="fa-solid fa-swords"></i>`;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    BattlePlanner.open();
  });
  column.append(button);
});

Hooks.once("ready", () => {
  // The GM's "Prepare Players" request opens the survey on the chosen players' screens.
  game.socket.on(SOCKET, data => {
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
