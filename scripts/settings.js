/**
 * World settings. Every setting is a default: the Battle Planner can override any of them per battle.
 *
 * The settings window shows them in groups (SETTING_GROUPS, in that order), each under its heading: every setting in
 * SETTINGS and every menu in MENUS names its `group`, and shows there in its table's order, the group's settings before
 * its menus (groupSettings). A stored value is found by its key alone, so a setting can move to another group, or along
 * its own, and keep its value.
 */
import { PREDICTION_SECONDS } from "./engine/run-budget.js";
import { MODULE_ID, ALLEGIANCE, DOWNED_MODELS, HEAL_AGGRO, ALLY_DYING, AFTERMATH, OPENING, CONCEDE_LUCK, THEFT_LUCK, EXECUTE_LUCK, SWITCH_LUCK, TRAITOR_LUCK, TRAP_LUCK, IGNORE_TROUBLES, TAUNT_LUCK, STAND_GROUND, AVOID_KILLING, LEAVE_RESOLVE, ROLEPLAY_FORGETS, ADHD, NEUTRAL_REACH, MAX_ROUNDS, LORE_BOOST } from "./constants.js";

const choices = (keys, prefix) => Object.fromEntries(keys.map(k => [k, `FASTFIGHTING.${prefix}.${k}`]));

export const DEFAULT_SIDE_TRAITS = {
  friendly: { tactical: 60, brave: 70, selfish: 30, loyal: 75 },
  hostile: { tactical: 45, brave: 55, selfish: 50, loyal: 50 },
  neutral: { tactical: 40, brave: 40, selfish: 60, loyal: 30 },
  secret: { tactical: 60, brave: 50, selfish: 50, loyal: 50 }
};

/** The settings window's groups, in the order it shows them. Headings: FASTFIGHTING.Settings.Group.<id>. */
export const SETTING_GROUPS = Object.freeze(["live", "story", "planner", "behavior", "luck", "after", "troubleshooting", "generic"]);

const SETTINGS = {
  playOnMap: { group: "live", type: Boolean, default: true },
  // Live: the players run their own characters (FastFighting plays everyone else).
  playersRunPCs: { group: "live", type: Boolean, default: true },
  // Live: a player who leaves gives each character of theirs with none of its players left a countdown of this many
  // seconds (shown in the Battle Vantage); when it runs out, FastFighting plays it (foundry/away.js, live-battle.js).
  // Off: no countdowns, and those running stop.
  autoPlayAbsent: { group: "live", type: Boolean, default: true },
  autoPlayAbsentSeconds: { group: "live", type: Number, default: 120, range: { min: 30, max: 600, step: 30 } },
  // Live: a player's damage card against a creature FastFighting runs, applied at once (off: a GM is asked).
  applyPlayerDamage: { group: "live", type: Boolean, default: false },
  // Live: the Battle Vantage's Next Turn held this many seconds while a player's turn or reaction waits on the GM (0:
  // never; the last stop, 61: until nothing waits). apps/battle-vantage.js holdOf.
  waitHold: { group: "live", type: Number, default: 10, range: { min: 0, max: 61, step: 1 } },

  storyStyle: { group: "story", type: String, default: "roleplay", choices: choices(["roleplay", "standard", "statistician"], "Story.Style") },
  storyMode: { group: "story", type: String, default: "public", choices: choices(["public", "whisper"], "Story.Mode") },
  storyOdds: { group: "story", type: Boolean, default: false },

  // How long a prediction runs (seconds): fight after fight until it's up (engine/run-budget.js).
  predictionTime: { group: "planner", type: Number, default: PREDICTION_SECONDS.default, range: { min: PREDICTION_SECONDS.min, max: PREDICTION_SECONDS.max, step: 1 } },
  maxRounds: { group: "planner", type: Number, default: MAX_ROUNDS.default, range: { min: MAX_ROUNDS.min, max: MAX_ROUNDS.max, step: 1 } },
  includeHidden: { group: "planner", type: Boolean, default: true },
  includeOtherLevels: { group: "planner", type: Boolean, default: false },
  bystanders: { group: "planner", type: Boolean, default: true },
  neutralDefault: { group: "planner", type: String, default: ALLEGIANCE.NEUTRAL, choices: choices(Object.values(ALLEGIANCE), "Lean") },
  // (Read when the planner opens, to propose friend groups for neutrals: a world setting, not per plan.)
  neutralReach: { group: "planner", type: Number, default: NEUTRAL_REACH, range: { min: 1, max: 20, step: 1 } },
  surpriseDefault: { group: "planner", type: String, default: "system", choices: choices(["system", "none", "friendlySurprised", "friendlySurprise"], "Surprise") },
  opening: { group: "planner", type: String, default: OPENING.AUTO, choices: choices(Object.values(OPENING), "Opening") },
  positioning: { group: "planner", type: Boolean, default: true },
  downedModel: { group: "planner", type: String, default: DOWNED_MODELS.SIMULATE, choices: choices(Object.values(DOWNED_MODELS), "Downed") },

  leadership: { group: "behavior", type: Boolean, default: true },
  // How readily followers take their commander's lead (0-100; 50 the usual), and how much more readily a boss's.
  leaderInfluence: { group: "behavior", type: Number, default: 50, range: { min: 0, max: 100, step: 5 } },
  bossInfluence: { group: "behavior", type: Number, default: 2, range: { min: 1.25, max: 3, step: 0.05 } },
  morale: { group: "behavior", type: Boolean, default: true },
  talking: { group: "behavior", type: Boolean, default: true },
  ignoreLanguages: { group: "behavior", type: Boolean, default: false },
  // (A party's own default, or "auto": let each character decide.)
  pcHealAggro: { group: "behavior", type: String, default: "auto", choices: choices(["auto", ...HEAL_AGGRO], "HealAggro") },
  pcAllyDying: { group: "behavior", type: String, default: "auto", choices: choices(["auto", ...ALLY_DYING], "AllyDying") },
  // How much the player party's wishes (its players' votes in the survey's Party tab) sway the friendly side (%).
  partySway: { group: "behavior", type: Number, default: 3, range: { min: 1, max: 20, step: 1 } },
  // How much less those not on the friendly side focus fire (0-100: at 100, half as much; behavior/focus.js).
  focusDampener: { group: "behavior", type: Number, default: 0, range: { min: 0, max: 100, step: 1 } },
  // A Lore-Collector's payoff for sizing a foe up (engine/simulator.js sizeUp): the system's, by its helper
  // (settingDefaults: its default, and its own name and hint, naming the system's skill for it).
  loreBoost: { group: "behavior", type: Number, default: LORE_BOOST.default, range: { min: LORE_BOOST.min, max: LORE_BOOST.max, step: LORE_BOOST.step } },

  // (Not shown: nothing rolls it at present, since no deal or theft lets a PC keep an item it gives up. Kept for when one
  // does: behavior/talk.js concession.)
  concedeLuck: { group: "luck", type: Number, default: CONCEDE_LUCK, range: { min: 0, max: 100, step: 1 }, config: false },
  theftLuck: { group: "luck", type: Number, default: THEFT_LUCK, range: { min: 0, max: 100, step: 1 } },
  executeLuck: { group: "luck", type: Number, default: EXECUTE_LUCK, range: { min: 0, max: 100, step: 1 } },
  traitorLuck: { group: "luck", type: Number, default: TRAITOR_LUCK, range: { min: 0, max: 100, step: 1 } },
  switchLuck: { group: "luck", type: Number, default: SWITCH_LUCK, range: { min: 0, max: 100, step: 1 } },
  trapLuck: { group: "luck", type: Number, default: TRAP_LUCK, range: { min: 0, max: 100, step: 1 } },
  // How readily a playstyle's taunt takes hold (only the playstyles': a game system's taunts go by their own rules).
  tauntLuck: { group: "luck", type: Number, default: TAUNT_LUCK, range: { min: 0, max: 100, step: 1 } },
  // How readily the selfless bear what holds or hurts them, rather than trying to be rid of it.
  ignoreTroubles: { group: "luck", type: Number, default: IGNORE_TROUBLES, range: { min: 0, max: 100, step: 1 } },
  standGround: { group: "luck", type: Number, default: STAND_GROUND, range: { min: 50, max: 90, step: 1 } },
  avoidKilling: { group: "luck", type: Number, default: AVOID_KILLING, range: { min: 50, max: 90, step: 1 } },
  // How often a creature set on leaving the fight keeps going when struck or spoken to (behavior/leaving.js).
  leaveResolve: { group: "luck", type: Number, default: LEAVE_RESOLVE, range: { min: 0, max: 100, step: 1 } },
  roleplayForgets: { group: "luck", type: Number, default: ROLEPLAY_FORGETS, range: { min: 0, max: 100, step: 1 } },
  // How often a creature's mind jumps from what it's doing to the strongest thing it wants (behavior/desire.js).
  adhd: { group: "luck", type: Number, default: ADHD, range: { min: 0, max: 100, step: 1 } },

  aftermath: { group: "after", type: String, default: AFTERMATH.TELL, choices: choices(Object.values(AFTERMATH), "Aftermath") },
  lootMode: { group: "after", type: String, default: "corpse", choices: choices(["corpse", "pile", "none"], "Loot") },
  corpseMode: { group: "after", type: String, default: "keep", choices: choices(["keep", "remove"], "Corpse") },
  // Whether a dead player character's loot token gets its meat too (foundry/food.js, loot-drop.js remainsOf).
  pcMeat: { group: "after", type: Boolean, default: false },
  fledMode: { group: "after", type: String, default: "hide", choices: choices(["hide", "leave"], "Fled") },

  // Troubleshooting: live battles' transcripts kept for 30 days, and the planner's last run with them (off: a transcript
  // goes with its combat; foundry/live-journals.js). A world setting: only a GM changes it.
  troubleshooting: { group: "troubleshooting", type: Boolean, default: false },
  // The planner's fights on background workers (engine/batch-pool.js), where the browser and the system's helper allow.
  // Off: on the main thread, as before. Workers that fail fall back by themselves, for the session: this is for tracking
  // a problem down.
  plannerWorkers: { group: "troubleshooting", type: Boolean, default: true },

  genericFallback: { group: "generic", type: Boolean, default: false, requiresReload: false, onChange: () => ui.combat?.render() }
};

/** The settings window's menus, each a window of its own (scripts/apps/), GMs only unless it says `restricted: false`. */
const MENUS = {
  storyTablesMenu: { group: "story", name: "FASTFIGHTING.Story.TablesMenuName", label: "FASTFIGHTING.Story.TablesMenuLabel", hint: "FASTFIGHTING.Story.TablesMenuHint", icon: "fa-solid fa-table-list" },
  sideDefaultsMenu: { group: "luck", name: "FASTFIGHTING.Settings.sideDefaults.Name", label: "FASTFIGHTING.Settings.sideDefaults.Label", hint: "FASTFIGHTING.Settings.sideDefaults.Hint", icon: "fa-solid fa-people-group" },
  // Live battles' transcripts: what's kept, exported for a bug report, and cleaned up (GMs only).
  liveDataMenu: { group: "troubleshooting", name: "FASTFIGHTING.LiveData.MenuName", label: "FASTFIGHTING.LiveData.MenuLabel", hint: "FASTFIGHTING.LiveData.MenuHint", icon: "fa-solid fa-box-archive" },
  genericPathsMenu: { group: "generic", name: "FASTFIGHTING.Generic.MenuName", label: "FASTFIGHTING.Generic.MenuLabel", hint: "FASTFIGHTING.Generic.MenuHint", icon: "fa-solid fa-route" }
};

/**
 * What the settings window shows in each group, in order: [{group, keys}], keys as Foundry names a setting or a menu
 * (`fast-fighting.<key>`), its settings in SETTINGS' order (but those `config: false`), then its menus in MENUS'.
 */
export function settingsLayout() {
  const rows = [...Object.entries(SETTINGS), ...Object.entries(MENUS)];
  const shown = rows.filter(([, data]) => data.config !== false);
  return SETTING_GROUPS.map(group => ({ group, keys: shown.filter(([, data]) => data.group === group).map(([key]) => `${MODULE_ID}.${key}`) }));
}

/**
 * FastFighting's tab of the settings window in its groups (main.js, renderSettingsConfig): each group a fieldset under
 * its heading, in settingsLayout's order. One this user isn't shown is skipped, and a group with none shown left out.
 */
export function groupSettings(section) {
  if ( section.querySelector(".ff-settings-group") ) return;
  for ( const { group, keys } of settingsLayout() ) {
    const rows = keys.map(id => section.querySelector(`[name="${id}"], [data-key="${id}"]`)?.closest(".form-group")).filter(Boolean);
    if ( !rows.length ) continue;
    section.append(groupSection(group, game.i18n.localize(`FASTFIGHTING.Settings.Group.${group}`), rows));
  }
}

/** Which groups this browser keeps open (a convenience, nothing more: none kept, the defaults). */
const OPEN_KEY = `${MODULE_ID}.settingsOpen`;

/** The groups open: as left last time, else none but the system's helper's. */
function openGroups() {
  try {
    const kept = JSON.parse(globalThis.localStorage?.getItem(OPEN_KEY) ?? "null");
    if ( Array.isArray(kept) ) return new Set(kept);
  } catch ( err ) { /* nothing kept */ }
  return new Set(["helper"]);
}

/** A group opened or closed: kept for next time. */
function keepOpen(group, open) {
  const groups = openGroups();
  if ( open ) groups.add(group);
  else groups.delete(group);
  try {
    globalThis.localStorage?.setItem(OPEN_KEY, JSON.stringify([...groups]));
  } catch ( err ) { /* not kept */ }
}

/**
 * A group of FastFighting's tab as one of its sections (as the planner's): a heading, its name with how many settings
 * it holds, that opens and closes (kept for next time), and its rows.
 */
function groupSection(group, title, rows) {
  const details = document.createElement("details");
  details.className = "ff-section ff-settings-group";
  details.dataset.group = group;
  details.open = openGroups().has(group);
  const summary = document.createElement("summary");
  const chevron = document.createElement("i");
  chevron.className = "fa-solid fa-chevron-right ff-chevron";
  chevron.ariaHidden = "true";
  const name = document.createElement("span");
  name.className = "ff-section-title";
  name.textContent = title;
  const count = document.createElement("span");
  count.className = "ff-count";
  count.textContent = String(rows.length);
  summary.append(chevron, name, count);
  const body = document.createElement("div");
  body.className = "ff-section-body ff-settings-rows";
  body.append(...rows);
  details.append(summary, body);
  details.addEventListener?.("toggle", () => {
    if ( !details.dataset.searching ) keepOpen(group, details.open);
  });
  return details;
}

/**
 * A search in the settings window (its filter) opens every group, so no match hides in a closed one; cleared, each is
 * as it was.
 */
export function openForSearch(section, query) {
  for ( const details of section.querySelectorAll(".ff-settings-group") ) {
    if ( query ) {
      if ( !details.dataset.searching ) details.dataset.searching = details.open ? "open" : "closed";
      details.open = true;
    } else if ( details.dataset.searching ) {
      details.open = details.dataset.searching === "open";
      delete details.dataset.searching;
    }
  }
}

/**
 * The core settings a system's helper may make its own (settingDefaults, API 28), and the bounds it may give them:
 * Max rounds, when a fight in its system counts as a stalemate; the Lore-Collector's advantage, by its system's skill.
 */
const SYSTEM_SETTINGS = Object.freeze({
  maxRounds: { floor: 1, ceiling: 60, fallback: MAX_ROUNDS },
  loreBoost: { floor: 1.05, ceiling: 5, fallback: LORE_BOOST }
});

/**
 * The settings that are the game system's, once its helper is known (main.js, ready): for each in SYSTEM_SETTINGS
 * the helper's settingDefaults() gives, its default, by the setting's kind (a checkbox's true or false; a list's one of
 * its choices; a number's, held to its range, which the helper may set too, min and max within the bounds), and its own
 * name and hint (its own words, naming its system's skill or rule). A world's own value, where a GM set one, stands
 * (a number's held to the range: rangeOf).
 */
export function systemDefaults(adapter, settings = SYSTEM_SETTINGS) {
  const given = adapter?.settingDefaults?.() ?? {};
  for ( const [key, { floor, ceiling } = {}] of Object.entries(settings) ) {
    const g = given[key];
    const config = game.settings.settings.get(`${MODULE_ID}.${key}`);
    if ( !g || !config ) continue;
    if ( config.type === Boolean ) {
      if ( typeof g.default === "boolean" ) config.default = g.default;
    } else if ( config.choices ) {
      if ( Object.hasOwn(config.choices, g.default) ) config.default = g.default;
    } else if ( config.range ) {
      const min = Number(g.min);
      const max = Number(g.max);
      if ( min >= floor && max <= ceiling && max >= min ) config.range = { ...config.range, min, max };
      const wanted = Number(g.default);
      const keep = Number.isFinite(wanted) ? wanted : Number(config.default);
      config.default = Math.min(config.range.max, Math.max(config.range.min, keep));
    }
    if ( typeof g.name === "string" && g.name ) config.name = g.name;
    if ( typeof g.hint === "string" && g.hint ) config.hint = g.hint;
  }
}

/** A system setting's range and default (SYSTEM_SETTINGS): the system's, once its helper is known, else the core's. */
export function rangeOf(key) {
  const config = game.settings?.settings?.get?.(`${MODULE_ID}.${key}`);
  const fallback = SYSTEM_SETTINGS[key]?.fallback ?? {};
  return { min: config?.range?.min ?? fallback.min, max: config?.range?.max ?? fallback.max, default: config?.default ?? fallback.default };
}

/** Max rounds' range and default (rangeOf). */
export const roundsRange = () => rangeOf("maxRounds");

/**
 * The system's helper's own settings (and menus), at the foot of FastFighting's tab under the helper's name: every one
 * it shows in the settings window, moved out of its own tab, whose button then goes. Nothing when the helper has none.
 * @param {object} app           the settings window (SettingsConfig)
 * @param {HTMLElement} root     its element
 * @param {HTMLElement} section  FastFighting's tab
 * @param {string|null} helperId the helper's module (api.js helperModule)
 */
export function helperGroup(app, root, section, helperId) {
  if ( !helperId || helperId === MODULE_ID || section.querySelector('.ff-settings-group[data-group="helper"]') ) return;
  const theirs = root.querySelector(`section[data-category="${helperId}"]`);
  const rows = [...(theirs?.querySelectorAll(".form-group") ?? [])];
  if ( !rows.length ) return;
  section.append(groupSection("helper", game.modules.get(helperId)?.title ?? helperId, rows));
  root.querySelector(`nav [data-group="categories"][data-tab="${helperId}"]`)?.setAttribute("hidden", "");
  // (Its tab open when the window drew: FastFighting's instead, where its settings now are.)
  if ( theirs.classList.contains("active") ) app?.changeTab?.(MODULE_ID, "categories");
}

/** Who else in this browser follows a setting as it changes, by key (followSetting). */
const following = {};

/** `then(value)` each time the setting changes, in this browser (live-battle.js: the away countdowns). */
export function followSetting(key, then) {
  (following[key] ??= []).push(then);
}

export function registerSettings(DefaultsConfig, GenericPathsConfig, StoryTablesConfig, LiveDataConfig) {
  game.settings.register(MODULE_ID, "genericPaths", { scope: "world", config: false, type: Object, default: {} });
  // The party's roles the GM gave in earlier fights, by actor: {actorId: "leader" | "lt1" | "lt2"}.
  game.settings.register(MODULE_ID, "partyCommand", { scope: "world", config: false, type: Object, default: {} });
  // This computer's pace, from its last prediction (engine/run-budget.js paceOf): the planner's estimate goes by it.
  game.settings.register(MODULE_ID, "runPace", { scope: "client", config: false, type: Number, default: 1 });
  // What this GM's swing studies test (the planner's pills): each part on unless false.
  game.settings.register(MODULE_ID, "swingScope", { scope: "client", config: false, type: Object, default: {} });
  game.settings.register(MODULE_ID, "sideDefaults", {
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULT_SIDE_TRAITS
  });
  for ( const [key, { group, ...data }] of Object.entries(SETTINGS) ) {
    game.settings.register(MODULE_ID, key, {
      name: `FASTFIGHTING.Settings.${key}.Name`,
      hint: `FASTFIGHTING.Settings.${key}.Hint`,
      scope: "world",
      config: true,
      ...data,
      onChange: value => {
        data.onChange?.(value);
        for ( const then of following[key] ?? [] ) then(value);
      }
    });
  }
  const windows = { storyTablesMenu: StoryTablesConfig, sideDefaultsMenu: DefaultsConfig, liveDataMenu: LiveDataConfig, genericPathsMenu: GenericPathsConfig };
  for ( const [key, { group, ...data }] of Object.entries(MENUS) ) {
    game.settings.registerMenu(MODULE_ID, key, { restricted: true, ...data, type: windows[key] });
  }
}

export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}
