/**
 * World settings. Every setting is a default: the Battle Planner can override any of them per battle.
 */
import { MODULE_ID, ALLEGIANCE, DOWNED_MODELS, HEAL_AGGRO, ALLY_DYING, AFTERMATH } from "./constants.js";

const choices = (keys, prefix) => Object.fromEntries(keys.map(k => [k, `FASTFIGHTING.${prefix}.${k}`]));

export const DEFAULT_SIDE_TRAITS = {
  friendly: { tactical: 60, brave: 70, selfish: 30, loyal: 75 },
  hostile: { tactical: 45, brave: 55, selfish: 50, loyal: 50 },
  neutral: { tactical: 40, brave: 40, selfish: 60, loyal: 30 },
  secret: { tactical: 60, brave: 50, selfish: 50, loyal: 50 }
};

const SETTINGS = {
  genericFallback: { type: Boolean, default: false, requiresReload: false, onChange: () => ui.combat?.render() },
  runs: { type: Number, default: 2000, range: { min: 200, max: 20000, step: 100 } },
  maxRounds: { type: Number, default: 20, range: { min: 3, max: 100, step: 1 } },
  includeHidden: { type: Boolean, default: true },
  includeOtherLevels: { type: Boolean, default: false },
  neutralDefault: { type: String, default: ALLEGIANCE.EXCLUDE, choices: choices(Object.values(ALLEGIANCE), "Allegiance") },
  secretDefault: { type: String, default: ALLEGIANCE.HOSTILE, choices: choices(Object.values(ALLEGIANCE), "Allegiance") },
  downedModel: { type: String, default: DOWNED_MODELS.SIMULATE, choices: choices(Object.values(DOWNED_MODELS), "Downed") },
  aftermath: { type: String, default: AFTERMATH.TELL, choices: choices(Object.values(AFTERMATH), "Aftermath") },
  pcHealAggro: { type: String, default: "balanced", choices: choices(HEAL_AGGRO, "HealAggro") },
  pcAllyDying: { type: String, default: "rescue", choices: choices(ALLY_DYING, "AllyDying") },
  leadership: { type: Boolean, default: true },
  morale: { type: Boolean, default: true },
  talking: { type: Boolean, default: true },
  bystanders: { type: Boolean, default: true },
  positioning: { type: Boolean, default: true },
  surpriseDefault: { type: String, default: "tracker", choices: choices(["none", "tracker", "stealth"], "Surprise") },
  storyStyle: { type: String, default: "roleplay", choices: choices(["roleplay", "standard", "statistician"], "Story.Style") },
  storyMode: { type: String, default: "public", choices: choices(["public", "whisper"], "Story.Mode") },
  lootMode: { type: String, default: "corpse", choices: choices(["corpse", "pile", "none"], "Loot") },
  corpseMode: { type: String, default: "keep", choices: choices(["keep", "remove"], "Corpse") },
  fledMode: { type: String, default: "hide", choices: choices(["hide", "leave"], "Fled") }
};

export function registerSettings(DefaultsConfig, GenericPathsConfig, StoryTablesConfig) {
  if ( StoryTablesConfig ) {
    game.settings.registerMenu(MODULE_ID, "storyTablesMenu", {
      name: "FASTFIGHTING.Story.TablesMenuName",
      label: "FASTFIGHTING.Story.TablesMenuLabel",
      hint: "FASTFIGHTING.Story.TablesMenuHint",
      icon: "fa-solid fa-table-list",
      type: StoryTablesConfig,
      restricted: true
    });
  }
  game.settings.register(MODULE_ID, "genericPaths", { scope: "world", config: false, type: Object, default: {} });
  if ( GenericPathsConfig ) {
    game.settings.registerMenu(MODULE_ID, "genericPathsMenu", {
      name: "FASTFIGHTING.Generic.MenuName",
      label: "FASTFIGHTING.Generic.MenuLabel",
      hint: "FASTFIGHTING.Generic.MenuHint",
      icon: "fa-solid fa-route",
      type: GenericPathsConfig,
      restricted: true
    });
  }
  for ( const [key, data] of Object.entries(SETTINGS) ) {
    game.settings.register(MODULE_ID, key, {
      name: `FASTFIGHTING.Settings.${key}.Name`,
      hint: `FASTFIGHTING.Settings.${key}.Hint`,
      scope: "world",
      config: true,
      ...data
    });
  }
  game.settings.register(MODULE_ID, "sideDefaults", {
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULT_SIDE_TRAITS
  });
  if ( DefaultsConfig ) {
    game.settings.registerMenu(MODULE_ID, "sideDefaultsMenu", {
      name: "FASTFIGHTING.Settings.sideDefaults.Name",
      label: "FASTFIGHTING.Settings.sideDefaults.Label",
      hint: "FASTFIGHTING.Settings.sideDefaults.Hint",
      icon: "fa-solid fa-people-group",
      type: DefaultsConfig,
      restricted: true
    });
  }
}

export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}
