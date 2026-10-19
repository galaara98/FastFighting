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
import { LiveDataConfig } from "./apps/live-data.js";
import { invalidateStoryTables, installStoryTables } from "./story/tables.js";
import { PlayerSurvey } from "./apps/player-survey.js";
import { registerTokenTactics, syncTokenTactics } from "./apps/token-tactics.js";
import { QUERIES, SURVEY_STATUS, hasCharactersFor, preparePlayers } from "./foundry/tactics.js";
import { helperStatus, helperMessage, helperNoticeHtml, surveyHtml } from "./helpers.js";
import { invalidateApproach, systemSurprise } from "./foundry/battle.js";
import { revealStory, ownCard } from "./foundry/make-it-so.js";
import { sceneUnit, registerGroundField } from "./foundry/terrain.js";
import { planHolder, sceneEncounter } from "./foundry/persistence.js";
import { hasRun } from "./foundry/run-memory.js";
import { setDistanceUnit, setTermSource, localize } from "./i18n.js";
import { loadKeywords } from "./foundry/keywords.js";
import { registerLiveBattles, liveBattle, followPlayersSay, systemAppliesText } from "./foundry/live-battle.js";
import { registerSheetWatch } from "./foundry/sheet-watch.js";
import { registerSheetButton } from "./foundry/sheet-button.js";
import { migratePlaystyles } from "./foundry/migrate-playstyles.js";
import { BattleVantage, registerBattleVantage } from "./apps/battle-vantage.js";

Hooks.once("init", () => {
  registerSettings(DefaultsConfig, GenericPathsConfig, StoryTablesConfig, LiveDataConfig);
  registerLiveBattles();
  registerBattleVantage();
  registerGroundField();
  // The GM's "Prepare Players" request opens the survey on the chosen players' screens (a player's survey never on a
  // GM's); one character's for the GMs on theirs. Foundry says who asks: only a GM may.
  CONFIG.queries[QUERIES.openSurvey] = (data, { user }) => {
    if ( !user?.isGM || game.user.isGM ) return false;
    PlayerSurvey.open({ sceneId: data?.sceneId, requestId: data?.requestId, start: data?.start });
    return true;
  };
  CONFIG.queries[QUERIES.openGmSurvey] = (data, { user }) => {
    if ( !user?.isGM || !game.user.isGM ) return false;
    // (One character's survey, or the survey of those away: their characters, and a Party tab for each of them.)
    const ids = v => (Array.isArray(v) ? v.filter(x => typeof x === "string") : undefined);
    PlayerSurvey.open({ sceneId: data?.sceneId, start: typeof data?.start === "string" ? data.start : data?.key, only: data?.key, keys: ids(data?.keys), proxies: ids(data?.proxies) });
    return true;
  };
  Hooks.on("fastFighting.liveBattleStarted", () => BattleVantage.open());
  // (A player's damage waiting on a GM: the Battle Vantage opens on it.)
  Hooks.on("fastFighting.damageWaits", () => BattleVantage.open());

  // System support comes from helper modules (FastFighting PF2e, ...). The generic adapter ("*") is the
  // fallback for systems nobody supports yet.
  registerAdapter("*", GenericAdapter, { priority: -100, source: MODULE_ID });
  // The game's words for armor class and hit points: its helper's, else FastFighting's generic ones.
  setTermSource(key => getAdapter()?.term?.(key));
  // Text in templates that says {AC} or {HP}.
  Handlebars.registerHelper("ffLocalize", (key, options) => localize(key, options?.hash));

  const api = buildApi({ openPlanner: () => openIfReady(), openBattleVantage: () => BattleVantage.open(), openSurvey: options => PlayerSurvey.open(options), installStoryTables, BattlePlanner, PlayerSurvey });
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
  const root = element;
  const header = root?.querySelector(".combat-tracker-header") ?? root;
  if ( !header ) return;
  header.querySelector(".ff-tracker-row")?.remove();
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
  button.innerHTML = `<i class="fa-solid fa-swords"></i><span>${game.i18n.localize("FASTFIGHTING.Tracker.Planner")}</span>`;
  button.addEventListener("click", event => {
    event.preventDefault();
    openIfReady();
  });
  // (One row: the planner, the Battle Vantage, and the players' survey. The Vantage while a live battle is on this
  // combat, or once the planner has run this encounter at least once: opened then, the battle is prepared from that
  // run, and waits for the encounter to begin. No encounter, or one never planned: no Vantage.)
  const row = document.createElement("div");
  row.className = "ff-tracker-row";
  row.append(button);
  header.querySelector(".ff-battle-open")?.remove();
  // (Each by the encounter's id: a scene can hold several, and the battle is on one of them.)
  const planner = foundry.applications.instances.get("fast-fighting-planner");
  const live = !!app.viewed && liveBattle()?.combat?.id === app.viewed.id;
  const planned = !!app.viewed && app.viewed.id === sceneEncounter(canvas.scene)?.id && !liveBattle() && !!getAdapter()?.supportsLive
    && (planner?.readyForVantage?.(app.viewed) || hasRun(app.viewed.uuid));
  if ( live || planned ) {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "ff-tracker-open ff-battle-open";
    open.dataset.tooltip = game.i18n.localize("FASTFIGHTING.Battle.Title");
    open.innerHTML = `<i class="fa-solid fa-chess-knight"></i><span>${game.i18n.localize("FASTFIGHTING.Tracker.Vantage")}</span>`;
    open.addEventListener("click", async event => {
      event.preventDefault();
      if ( liveBattle() ) return BattleVantage.open();
      // (From the plan's last run, as the planner recalls it: opened for it, if it isn't open.)
      const plan = foundry.applications.instances.get("fast-fighting-planner") ?? await BattlePlanner.open();
      if ( plan?.readyForVantage?.(ui.combat.viewed) ) return plan.openVantage();
      ui.notifications.info(game.i18n.localize("FASTFIGHTING.Tracker.RunFirst"));
    });
    row.append(open);
  }
  // Prepare Players without a conflict: every player with a character on the scene asked about it.
  const survey = document.createElement("button");
  survey.type = "button";
  survey.className = "ff-tracker-open ff-survey-open";
  survey.dataset.tooltip = game.i18n.localize("FASTFIGHTING.Tracker.SurveyHint");
  survey.innerHTML = `<i class="fa-solid fa-feather-pointed"></i><span>${game.i18n.localize("FASTFIGHTING.Tracker.Survey")}</span>`;
  survey.addEventListener("click", event => {
    event.preventDefault();
    preparePlayers(canvas.scene, options => PlayerSurvey.open(options));
  });
  row.append(survey);
  header.prepend(row);
});


/**
 * A player who controls a token on the battle map, or owns a character, can open its own tactics any time from the
 * Encounters tab (in a fight or not, asked by the GM or not).
 */
function myTacticsButton(element) {
  const root = element;
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

Hooks.once("ready", () => {
  // (The keywords read in characters' biographies: English, and the reader's language's on top.)
  loadKeywords();
  // (Playstyles stored under an id that's gone, brought up to date once: temporary, remove at 0.7.0 with
  // tests/temporary/speedrunner-to-dps.test.js.)
  migratePlaystyles();
  // Tell the GM once if this system has no helper module yet.
  const status = helperStatus();
  if ( game.user.isGM && !status.specific ) ui.notifications[status.ready ? "info" : "warn"](helperMessage(status), { permanent: !status.ready });
  // A player who was asked while offline (or reloads mid-survey) gets it on login.
  if ( !game.user.isGM ) {
    const s = game.user.getFlag(MODULE_ID, "survey");
    if ( s && [SURVEY_STATUS.REQUESTED, SURVEY_STATUS.ENTERING].includes(s.status) && game.scenes.get(s.sceneId) ) {
      PlayerSurvey.open({ sceneId: s.sceneId, requestId: s.requestId, start: s.start });
    }
  }
});

/* Live sync: answers are actor flags, so every open planner and survey patches itself in place. */
function syncOpenViews(actor) {
  if ( !actor ) return;
  // (A live battle under way: what its player says of its reactions, from now on.)
  followPlayersSay(actor);
  foundry.applications.instances.get("fast-fighting-survey")?.syncActor(actor);
  foundry.applications.instances.get("fast-fighting-planner")?.syncActor(actor);
  syncTokenTactics(actor);
}

// FastFighting's tab in the token windows (GM only): a token's tactics, playstyles and desires, or its prototype's.
registerTokenTactics();
// FastFighting on a character sheet, for its owner who can't open its token windows (sheet-button.js).
registerSheetButton();

// What's changed on each character: an unchanged one isn't read again, and the reactions a window shows follow its sheet.
registerSheetWatch();

const touchesTactics = changes => foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)
  || foundry.utils.hasProperty(changes, `delta.flags.${MODULE_ID}`);

Hooks.on("updateActor", (actor, changes) => {
  // (Its owners changed: whose My Tactics button shows.)
  if ( "ownership" in changes ) refreshMyTactics();
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
// (What the GM was typing is kept first, in the plan it was typed for, and the window blinks before it changes. The
// Battle Vantage follows the same way: battle-vantage.js.)
const followPlan = () => foundry.applications.instances.get("fast-fighting-planner")?.followScene?.();
Hooks.on("canvasReady", followPlan);
for ( const hook of ["createCombat", "deleteCombat", "updateCombat"] ) Hooks.on(hook, () => followPlan());
// (Another encounter viewed on the tracker: no document changes, only the tracker drawn again.)
Hooks.on("renderCombatTracker", () => followPlan());

// Someone joins (or leaves) the planner's encounter, it starts, or a token comes or goes on its scene: the planner takes
// them in, keeping the GM's plan as it stands (only the encounter ending, or the GM clearing the plan, starts it afresh).
const rereadRoster = foundry.utils.debounce(() => {
  const app = foundry.applications.instances.get("fast-fighting-planner");
  if ( app?.rendered ) app.rereadRoster(); // (during a run, as soon as it ends)
}, 150);
Hooks.on("createCombatant", combatant => { if ( combatant.parent?.uuid === planHolder()?.uuid ) rereadRoster(); });
Hooks.on("combatStart", combat => { if ( combat.uuid === planHolder()?.uuid ) rereadRoster(); });
Hooks.on("deleteCombatant", combatant => { if ( combatant.parent?.uuid === planHolder()?.uuid ) rereadRoster(); });
for ( const hook of ["createToken", "deleteToken"] ) Hooks.on(hook, token => { if ( token.parent?.id === canvas.scene?.id ) rereadRoster(); });

// Walls and regions change the paths tokens take.
for ( const hook of ["createWall", "updateWall", "deleteWall", "createRegion", "updateRegion", "deleteRegion",
  "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"] ) {
  Hooks.on(hook, () => invalidateApproach());
}

// (Players' damage applied by the system, or a module, itself: FastFighting's setting greyed out, saying so.)
Hooks.on("renderSettingsConfig", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const input = root?.querySelector(`[name="${MODULE_ID}.applyPlayerDamage"]`);
  const says = input ? systemAppliesText() : null;
  if ( !says ) return;
  input.disabled = true;
  const group = input.closest(".form-group");
  group?.classList.add("is-disabled");
  const hint = group?.querySelector(".hint");
  if ( hint ) hint.textContent = says;
});

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

// Edited story tables take effect immediately.
for ( const hook of ["createRollTable", "updateRollTable", "deleteRollTable", "createTableResult", "updateTableResult", "deleteTableResult"] ) {
  Hooks.on(hook, () => invalidateStoryTables());
}

/* Without a helper the settings are greyed out, with a notice pointing at the supported systems. */
Hooks.on("renderSettingsConfig", (app, element) => {
  const root = element;
  const section = root?.querySelector(`section[data-category="${MODULE_ID}"]`);
  if ( !section ) return;
  section.querySelector(".ff-helper-notice")?.remove();
  // (At its foot, the optional performance survey.)
  section.querySelector(".ff-survey")?.remove();
  section.insertAdjacentHTML("beforeend", surveyHtml());
  // (Follow System, greyed out where the system has no surprise rules: no one surprised, then.)
  const surprise = section.querySelector(`[name="${MODULE_ID}.surpriseDefault"]`);
  if ( surprise && !systemSurprise() ) {
    const follow = surprise.querySelector('option[value="system"]');
    if ( follow ) follow.disabled = true;
    if ( surprise.value === "system" ) surprise.value = "none";
  }
  // (Only the settings the system's helper acts on: leaving loot, taking a corpse away, only some do.)
  if ( !getAdapter()?.supportsLoot ) {
    for ( const key of ["lootMode", "corpseMode"] ) section.querySelector(`[name="${MODULE_ID}.${key}"]`)?.closest(".form-group")?.remove();
  }
  const status = helperStatus();
  if ( status.specific ) return;
  section.insertAdjacentHTML("afterbegin", helperNoticeHtml(status));
  if ( status.generic ) return; // the GM opted into the generic adapter: everything stays usable
  for ( const el of section.querySelectorAll("input, select, textarea, button, file-picker, range-picker") ) {
    // (Live battles' journals, from before the helper went: still the GM's to export and clean up.)
    if ( el.name === `${MODULE_ID}.genericFallback` || el.dataset?.key === `${MODULE_ID}.liveDataMenu` || el.closest(".ff-helper-notice") ) continue;
    el.disabled = true;
    el.closest(".form-group")?.classList.add("ff-disabled");
  }
});
