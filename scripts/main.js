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

Hooks.once("init", () => {
  registerSettings(DefaultsConfig, GenericPathsConfig);

  // Built-in adapters register at priority 0 so helper modules can replace them.
  // The generic adapter ("*") is the fallback for systems nobody supports yet.
  registerAdapter("pf2e", Pf2eAdapter, { priority: 0, source: MODULE_ID });
  registerAdapter("*", GenericAdapter, { priority: -100, source: MODULE_ID });

  const api = buildApi({ openPlanner: () => BattlePlanner.open(), BattlePlanner });
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
  const api = game.modules.get(MODULE_ID).api;
  if ( game.user.isGM && !api.getAdapter() ) {
    console.warn(`${MODULE_ID} | no adapter for system "${game.system.id}". Install a FastFighting helper module for this system.`);
  }
});
