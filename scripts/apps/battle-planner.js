/**
 * The GM's Battle Planner. A top bar: where the plan stands, and the one thing to press now (Run, Stop, Go Live). On
 * the left, three views: the teams, each a card with its creatures; the encounter's options; the players and
 * their surveys. On the right, the last run's odds pinned over the tabs: a team's or a creature's Details, and the
 * results.
 */
import {
  MODULE_ID, SIDES, TRAITS, ALLEGIANCE, HEAL_AGGRO, DOWNED_MODELS, AFTERMATH, OPENING, NEUTRAL_PARTY, HOSTILE_GROUPS, GROUPS,
  traitBand, clamp, FUDGE_STEP, SIDE_SETTLE_MS, TEAM_SHORT
} from "../constants.js";
import { getAdapter } from "../api.js";
import { setting } from "../settings.js";
import { listJoin, listItems, localize, term, hasStat, brief, roundsText } from "../i18n.js";
import { placeLoot, openPile } from "../foundry/loot-drop.js";
import { setAdhd } from "./token-tactics.js";
import { getSetup, saveSetup, clearSetup, tokenSetup, planHolder, rememberPartyRole, sceneEncounter, encounterNumber } from "../foundry/persistence.js";
import {
  questionsContext, setTactic, togglePlaystyle, movePlaystyle, listenTacticsSections, syncTacticsDom, isPlayerControlled, playersOnScene, tokensForUser, surveyStatus,
  requestSurveys, requestCharacterSurvey, requestGmSurvey, SURVEY_STATUS, playstyleSignature, tacticsFor, reactionsSignature, preparePlayers
} from "../foundry/tactics.js";
import { cachedCharacterSpec, showsReactions } from "../foundry/sheet-watch.js";
import {
  gatherRoster, chosenSide, groupOf, proposeNeutralGroups, resolveAllegiances, simulate, swingFactors, typicalFight, fightThreads,
  approachFor, commandChains, commandGroup, seedCommand, clearRole, ROLES, sideName, hostileGroupsIn, secretTeam, SECRET_TEAMS, LEANS, predictionSeconds,
  battleFor, surpriseMode, systemSurprise, mainCoin, PURSE_TEAMS, readReinforcements } from "../foundry/battle.js";
import { SURPRISE } from "../engine/behavior/surprise.js";
import { buildStory, STORY_STYLES } from "../story/story.js";
import { loadStoryTables } from "../story/tables.js";
import { healthLookup } from "../foundry/health-estimate.js";
import { sceneDistance } from "../foundry/terrain.js";
import { planMakeItSo, makingItSo } from "../foundry/make-it-so.js";
import { ensureAutoConfig } from "../foundry/auto-config.js";
import { PlayerSurvey } from "./player-survey.js";
import { rememberRun, recallRun } from "../foundry/run-memory.js";
import { startLiveBattle, liveBattle, systemAppliesText } from "../foundry/live-battle.js";
import { savePlanRun } from "../foundry/live-journals.js";
import { BattleVantage } from "./battle-vantage.js";
import { listenMenus } from "./menus.js";
import { FOE_ENDS } from "../engine/aggregate.js";
import { blink, keepTyping } from "./blink.js";
import { expectedRuns, paceOf, ROUGH_RUNS, PREDICTION_SECONDS } from "../engine/run-budget.js";
import { signedNumber } from "../engine/trait-parts.js";
import { budgetFudges, traitTotal, TRAIT_BUDGET } from "../engine/trait-budget.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const TEMPLATES = `modules/${MODULE_ID}/templates/planner`;
const FUDGE_PARTIAL = `modules/${MODULE_ID}/templates/partials/fudge.hbs`;
const TACTICS_PARTIAL = `modules/${MODULE_ID}/templates/partials/tactics.hbs`;

const SIDE_ORDER = [SIDES.FRIENDLY, SIDES.HOSTILE, SIDES.NEUTRAL, SIDES.SECRET];
/** Each side's color, for its swatch (the color of its first team). */
const SIDE_SWATCH = { friendly: "F", hostile: "H1", neutral: "N1", secret: "S" };
const LEFT_VIEWS = ["teams", "encounter", "players"];
const RESULT_TABS = ["overview", "combatants", "swing", "resources", "sample"];
const STAT_FUDGES = [["ac", 1], ["hp", 5], ["attack", 1], ["damage", 1]];
/** The sections open at first (the GM's opening and closing them is kept while the planner is open). */
const OPEN_SECTIONS = ["howItPlays", "rules", "loot", "dResources", "dMembers", "dPersonality", "dLeader", "dTraits", "dTactics"];
/** A team's side: whose settings it has (hostile groups share the Hostile side's, neutral friend groups the Neutral's). */
const sideOfTeam = key => (key === SIDES.FRIENDLY || key === SIDES.SECRET ? key : key.startsWith(NEUTRAL_PARTY) ? SIDES.NEUTRAL : SIDES.HOSTILE);

const loc = key => localize(key);
/** A stat's name: the game's word for armor class and hit points (its helper's, or FastFighting's generic one). */
const statName = stat => (stat === "ac" || stat === "hp" ? term(stat) : loc(`FASTFIGHTING.Stat.${stat}`));
const pct = (p, d = 0) => `${(p * 100).toFixed(d)}%`;
/** Talks that collapse more often than this: the planner says why, most often (#collapseNote). */
const COLLAPSE_NOTE = 0.1;
/** Status key for a creature's end state ("conceded" stood down after giving something up). */
const statusOf = final => (final.swayed === "conceded" ? "conceded" : final.status);

/** How far a creature must travel to reach its nearest foe, terrain included, to the grid ("40 ft", "12 m"). */
function approachDistance(approach) {
  return sceneDistance(approach.dist * approach.mult);
}

/**
 * A roster row's chip: its level, where the system has levels ("Lv 3"); and its kind where that says something (a
 * hazard, a companion, a summon, a minion), never a PC or an NPC (the list is already by side). Empty: no chip.
 */
function kindChip(spec) {
  const level = hasStat("level") && Number.isFinite(Number(spec.level)) ? spec.level : null;
  const kind = ["pc", "npc"].includes(spec.kind) ? null : loc(`FASTFIGHTING.Kind.${spec.kind}`);
  if ( kind && level !== null ) return game.i18n.format("FASTFIGHTING.Planner.KindLevel", { kind, level });
  if ( level !== null ) return game.i18n.format("FASTFIGHTING.Planner.Level", { level });
  return kind ?? "";
}

/** How many fights a run has done, in the reader's numbers ("1,240 fights"). */
const fightCount = n => game.i18n.format("FASTFIGHTING.Planner.FightsRun", { n: (Number(n) || 0).toLocaleString(game.i18n.lang) });

/** A creature's traits as its sheet reads them (its sliders' starting points). */
const baseTraits = spec => Object.fromEntries(TRAITS.map(k => [k, spec?.traits?.[k]?.base ?? 50]));

/** The next point the GM clicks on the map (canvas pixels), or null (Escape, or a right-click). */
function pickPoint() {
  return new Promise(resolve => {
    const done = point => {
      canvas.stage.off("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
      resolve(point);
    };
    const onDown = event => {
      if ( event.button === 2 ) return done(null);
      const p = event.getLocalPosition(canvas.stage);
      done({ x: p.x, y: p.y });
    };
    const onKey = event => {
      if ( event.key === "Escape" ) done(null);
    };
    canvas.stage.on("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
  });
}

export class BattlePlanner extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fast-fighting-planner",
    tag: "form",
    classes: ["fast-fighting", "ff-planner"],
    window: { title: "FASTFIGHTING.Planner.Title", icon: "fa-solid fa-swords", resizable: true },
    position: { width: 1160, height: 720 },
    form: { handler: BattlePlanner.#onSubmit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      run: BattlePlanner.#onRun,
      refresh: BattlePlanner.#onRefresh,
      clearPlan: BattlePlanner.#onClearPlan,
      fudge: BattlePlanner.#onFudge,
      leftView: BattlePlanner.#onLeftView,
      sideFilter: BattlePlanner.#onSideFilter,
      showTeam: BattlePlanner.#onShowTeam,
      showCreature: BattlePlanner.#onShowCreature,
      toggleTeam: BattlePlanner.#onToggleTeam,
      resultTab: BattlePlanner.#onResultTab,
      panToken: BattlePlanner.#onPanToken,
      swing: BattlePlanner.#onSwing,
      makeItSo: BattlePlanner.#onMakeItSo,
      preparePlayers: BattlePlanner.#onPreparePlayers,
      togglePlaystyle: BattlePlanner.#onTogglePlaystyle,
      movePlaystyle: BattlePlanner.#onMovePlaystyle,
      setSystem: BattlePlanner.#onSetSystem,
      setSide: BattlePlanner.#onSetSide,
      setTeam: BattlePlanner.#onSetTeam,
      setRole: BattlePlanner.#onSetRole,
      autoRole: BattlePlanner.#onAutoRole,
      openSurvey: BattlePlanner.#onOpenSurvey,
      surveyCharacter: BattlePlanner.#onSurveyCharacter,
      surveyCharacterGm: BattlePlanner.#onSurveyCharacterGm,
      placeLoot: BattlePlanner.#onPlaceLoot,
      chooseReinforcement: BattlePlanner.#onChooseReinforcement,
      clearReinforcement: BattlePlanner.#onClearReinforcement,
      cancel: BattlePlanner.#onCancel
    }
  };

  static PARTS = {
    topbar: { template: `${TEMPLATES}/topbar.hbs` },
    left: { template: `${TEMPLATES}/left.hbs`, scrollable: [".ff-roster", ".ff-left-scroll"] },
    right: { template: `${TEMPLATES}/right.hbs`, templates: [`${TEMPLATES}/details.hbs`, FUDGE_PARTIAL, TACTICS_PARTIAL], scrollable: [".ff-results-body"] }
  };

  /** Singleton access. */
  static open() {
    if ( !game.user.isGM ) return null;
    const existing = foundry.applications.instances.get("fast-fighting-planner");
    if ( existing ) {
      existing.bringToFront?.();
      return existing.render({ force: true });
    }
    return new BattlePlanner().render({ force: true });
  }

  constructor(options) {
    super(options);
    this.leftView = "teams";
    this.sideFilter = "all";
    this.rosterFilter = "";
    this.resultTab = "overview";
    // (The team cards opened to show their creatures; Details shows a team, the party at first, or a creature.)
    this.expandedTeams = new Set();
    this.detail = { kind: "team", key: SIDES.FRIENDLY };
    this.openSections = new Set(OPEN_SECTIONS);
    this.previousResults = null;
    this.setup = null;
    this.roster = null;
    this.results = null;
    this.spec = null;
    this.swing = null;
    this.sample = null;
    this.running = false;
    this.progress = 0;
    this.stale = false;
    this.restoredAt = null;
    this.storyStyle = setting("storyStyle");
    this.storyTables = null;
    this.storyCache = new Map();
    this.sceneId = canvas.scene?.id ?? null;
    this.abort = null;
  }

  /** The planner reads and writes game data, so it is the GM's alone. */
  _canRender() {
    if ( !game.user.isGM ) return false;
  }

  /** The fight is read off the map, so the game pauses while the GM plans (and goes on when the planner closes). */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    if ( !game.paused ) {
      game.togglePause(true, { broadcast: true });
      this.pausedGame = true;
    }
    // (Unpaused by hand meanwhile: closing the planner leaves the game as the GM has it.)
    this.pauseHook = Hooks.on("pauseGame", paused => { if ( !paused ) this.pausedGame = false; });
    // (The encounter begun with Foundry's own button, the Sample fight ready: FastFighting takes it up, as Do it For
    // Real Now would, and plays its first turn if that's FastFighting's.)
    this.combatHook = Hooks.on("updateCombat", (combat, changes, options, userId) => {
      if ( combat.started && "round" in changes && this.readyForVantage(combat) ) this.#goLive({ begin: true, began: true });
    });
    // (Told when a character's reactions may have changed: sheet-watch.js. Only the creature in Details shows them.)
    this.unwatchReactions = showsReactions({
      shows: actor => this.rendered && !!this.roster?.some(e => e.token.actor?.uuid === actor.uuid && this.#isShown(e.token.id)),
      recheck: actor => this.recheckReactions(actor)
    });
    // (Kept at least this big, while it can grow.)
    this.element.style.minWidth = "1000px";
    this.element.style.minHeight = "600px";
    this.#listen();
  }

  /** Is this token's creature the one in Details? */
  #isShown(id) {
    return this.detail?.kind === "creature" && this.detail.id === id;
  }

  /**
   * What the window listens for, once (its parts drawn again keep it): a creature dropped on a team's reinforcements;
   * a slider's value as it moves; the roster's filter as it's typed; a section opened or closed; its menus (menus.js).
   */
  #listen() {
    const el = this.element;
    el.addEventListener("dragover", event => {
      if ( event.target.closest?.("[data-reinforce-drop]") ) event.preventDefault();
    });
    el.addEventListener("drop", event => {
      const slot = event.target.closest?.("[data-reinforce-drop]");
      if ( !slot ) return;
      event.preventDefault();
      this.#dropReinforcement(slot.dataset.reinforceDrop, event);
    });
    el.addEventListener("input", event => {
      const t = event.target;
      if ( t.matches?.('.ff-slider input[type="range"]') ) {
        const shown = t.parentElement?.querySelector(".ff-slider-value");
        if ( shown ) shown.textContent = t.value;
      } else if ( t.matches?.(".ff-roster-filter") ) {
        this.rosterFilter = t.value;
        this.#filterRoster();
      }
    });
    // (A section's open state doesn't bubble: caught on the way down.)
    el.addEventListener("toggle", event => {
      const t = event.target;
      if ( !t.matches?.("details[data-section]") ) return;
      if ( t.open ) this.openSections.add(t.dataset.section);
      else this.openSections.delete(t.dataset.section);
    }, true);
    listenMenus(el);
    listenTacticsSections(el);
  }

  /** The roster as filtered by name: the creatures that match, in their cards (opened while filtering), the rest hidden. */
  #filterRoster() {
    const list = this.element?.querySelector(".ff-roster");
    if ( !list ) return;
    const q = (this.rosterFilter ?? "").trim().toLocaleLowerCase(game.i18n.lang);
    list.classList.toggle("is-filtering", !!q);
    for ( const row of list.querySelectorAll(".ff-member") ) row.hidden = !!q && !row.dataset.name?.includes(q);
    for ( const card of list.querySelectorAll(".ff-card") ) card.hidden = !!q && !card.querySelector(".ff-member:not([hidden])");
  }

  /**
   * A character's items or effects changed while it's shown in Details: the planner reads the tokens again if the
   * reactions it shows aren't the same (as its Refresh button does).
   */
  async recheckReactions(actor) {
    for ( const e of this.roster ?? [] ) {
      if ( e.token.actor?.uuid !== actor.uuid || !this.#isShown(e.token.id) ) continue;
      const now = await cachedCharacterSpec(getAdapter(), e.token.document ?? e.token);
      if ( now && reactionsSignature(e.spec, actor) !== reactionsSignature(now, actor) ) return this.rereadRoster();
    }
  }

  _onClose(options) {
    super._onClose(options);
    this.unwatchReactions?.();
    this.settleSides();
    if ( this.pauseHook ) Hooks.off("pauseGame", this.pauseHook);
    this.pauseHook = null;
    if ( this.combatHook ) Hooks.off("updateCombat", this.combatHook);
    this.combatHook = null;
    // (Its Sample fight no longer offers the Battle Vantage: the tracker's button goes.)
    if ( this.offeredVantage ) ui.combat?.render();
    this.offeredVantage = false;
    const resume = this.pausedGame;
    this.pausedGame = false;
    if ( !resume ) return;
    // (Closed while a turn is still being written onto the map: the game goes on once it's done.)
    Promise.resolve(makingItSo()).then(() => {
      if ( game.paused ) game.togglePause(false, { broadcast: true });
    });
  }

  /** Forget everything about the previous plan (called when the GM views another scene, or another encounter). */
  resetForScene() {
    this.sceneId = canvas.scene?.id ?? null;
    this.holderUuid = planHolder()?.uuid ?? null;
    this.setup = null;
    this.roster = null;
    this.approach = null;
    this.results = null;
    this.spec = null;
    this.swing = null;
    this.sample = null;
    this.stale = false;
    this.restoredAt = null;
    this.previousResults = null;
    this.detail = { kind: "team", key: SIDES.FRIENDLY };
    this.expandedTeams.clear();
    this.storyCache.clear();
  }

  /** In the title bar: the scene, and which of its encounters, when it has more than one (the tracker's number). */
  get title() {
    const scene = canvas.scene?.name;
    if ( !scene ) return loc("FASTFIGHTING.Planner.Title");
    const no = this.#encounterNo();
    return no ? game.i18n.format("FASTFIGHTING.Planner.TitleAtEncounter", { scene, n: no.n }) : game.i18n.format("FASTFIGHTING.Planner.TitleAt", { scene });
  }

  /* -------------------------------------------- */
  /*  Data                                        */
  /* -------------------------------------------- */

  /** Characters are being set up by themselves (their writes don't each redraw the planner). */
  #settingUp = false;

  /**
   * The last run's results again, when nothing about this battle has changed since it ran (the same creatures, sheets,
   * answers, positions, party wishes and plan), with its most typical fight to show.
   */
  #recallRun() {
    try {
      const { spec, approach } = battleFor(this.roster, this.setup);
      const saved = recallRun(this.holderUuid, spec);
      if ( !saved ) return;
      this.spec = spec;
      this.results = saved.results;
      if ( approach ) this.approach = approach;
      this.sample = typicalFight(spec, saved.results);
        this.restoredAt = saved.at;
      this.stale = false;
    } catch ( err ) {
      console.warn(`${MODULE_ID} | the last run could not be shown again`, err);
    }
  }

  async #loadRoster() {
    // The plan of the encounter it's tied to (or the scene's, with none): read and saved there.
    this.holder = planHolder();
    this.holderUuid = this.holder?.uuid ?? null;
    this.setup = getSetup(this.holder);
    // (Each character as last read unless it has changed since; after Refresh, every one read again.)
    const fresh = this.freshRead;
    this.freshRead = false;
    this.roster = await gatherRoster(this.setup, getAdapter(), { fresh });
    // Anyone FastFighting hasn't seen before is set up by itself now (its playstyles, its calculated answers), and anyone
    // whose calculated answers are missing, broken or out of date has them worked out again.
    // (All at once; the planner draws itself once they're done, not once for each.)
    this.#settingUp = true;
    try {
      if ( game.user.isGM ) await Promise.all(this.roster.map(e => ensureAutoConfig(e.token.actor, e.spec)));
    } finally {
      this.#settingUp = false;
    }
    for ( const e of this.roster ) tokenSetup(this.setup, e.token.id);
    proposeNeutralGroups(this.roster, this.setup); // friend groups for the neutrals, as the map stands now
    // A new plan, or one just cleared: who commands each group, picked once (after that, only the GM changes it).
    if ( !this.setup.commandSeeded && this.roster.length && game.user.isGM ) {
      seedCommand(this.roster, this.setup);
      await saveSetup(this.setup, this.holder);
    }
    try {
      this.approach = approachFor(this.roster, this.setup);
    } catch ( err ) {
      console.warn(`${MODULE_ID} | approach preview failed`, err);
      this.approach = null;
    }
    // The last run's results again, if nothing about the battle has changed since.
    if ( !this.results && this.roster.length ) this.#recallRun();
  }

  /**
   * A fudgeable trait. `shift` is the playstyle adjustment, in its value but not editable here. Its tooltip says what the
   * trait does, and why it's so where there's a reason.
   */
  #traitView(trait, base, fudge, path, reason, shift = 0) {
    // (Shown in whole points: a trait worked out from its sheet can fall between them.)
    const value = clamp(Math.round(base + fudge + shift), 0, 100);
    return {
      trait, label: loc(`FASTFIGHTING.Trait.${trait}`), value, base, fudge, path, step: FUDGE_STEP.trait,
      band: loc(`FASTFIGHTING.Band.${traitBand(trait, value)}`),
      fudgeLabel: fudge ? signedNumber(fudge) : "",
      tooltip: brief(reason ? game.i18n.format("FASTFIGHTING.Planner.TraitWhy", { what: loc(`FASTFIGHTING.TraitTip.${trait}`), why: reason }) : loc(`FASTFIGHTING.TraitTip.${trait}`))
    };
  }

  /**
   * The four traits' sliders (`bases` and the GM's nudges), kept within the trait budget (engine/trait-budget.js) as a
   * fight would have them; `shifts`, its playstyles', come on top.
   */
  #traitViews(bases, fudges, pathOf, reasons = null, shifts = {}) {
    const kept = budgetFudges(bases, fudges ?? {});
    return TRAITS.map(k => this.#traitView(k, bases[k] ?? 50, kept[k], pathOf(k), reasons?.[k], shifts?.[k] ?? 0));
  }

  /** How much of the trait budget the sliders use: "{total}/{budget}", and what the budget is. */
  #budgetView(bases, fudges) {
    const kept = budgetFudges(bases, fudges ?? {});
    const total = Math.round(traitTotal(Object.fromEntries(TRAITS.map(k => [k, clamp((bases[k] ?? 50) + kept[k], 0, 100)]))));
    return { text: game.i18n.format("FASTFIGHTING.Planner.TraitBudget", { total, budget: TRAIT_BUDGET }), hint: game.i18n.format("FASTFIGHTING.Planner.TraitBudgetHint", { budget: TRAIT_BUDGET }) };
  }

  /**
   * A creature's own ADHD, 0 to 100%: a nudge to its Tactical (engine/battle-state.js prepareCombatant). Kept with the
   * creature (its actor's flag), as its token's FastFighting tab has it.
   */
  #adhdView(value, path) {
    const v = clamp(Math.round(Number(value) || 0), 0, 100);
    return { trait: "adhd", label: loc("FASTFIGHTING.Trait.adhd"), value: `${v}%`, base: 0, fudge: v, path, step: 10, band: "", fudgeLabel: "", tooltip: brief(loc("FASTFIGHTING.TraitTip.adhd")) };
  }

  #statView(stat, base, fudge, path, step) {
    return {
      trait: stat, label: statName(stat), value: base + fudge, base, fudge, path, step,
      fudgeLabel: fudge ? (fudge > 0 ? `+${fudge}` : `${fudge}`) : "",
      tooltip: localize(`FASTFIGHTING.StatTip.${stat}`)
    };
  }

  #nearestEnemyApproach(entry, resolved) {
    if ( !this.approach ) return null;
    const mySide = resolved[entry.token.id];
    const row = this.approach[entry.token.id];
    if ( !row || !mySide || mySide === NEUTRAL_PARTY ) return null;
    let best = null;
    for ( const other of this.roster ) {
      const side = resolved[other.token.id];
      if ( !side || side === mySide || side === NEUTRAL_PARTY ) continue;
      const a = row[other.token.id];
      if ( !a ) continue;
      const moves = a.modes?.[a.mode]?.moveActions ?? Math.ceil((a.dist * a.mult) / Math.max(1, a.speed));
      if ( !best || moves < best.moves ) best = { moves, mode: a.mode, mult: a.mult, dist: a.dist, name: other.spec.name, meleeOk: a.meleeOk, blocked: a.blocked, throughWall: a.throughWall };
    }
    return best;
  }

  async _prepareContext(options) {
    if ( !this.roster ) await this.#loadRoster();
    this.storyTables = await loadStoryTables();
    const setup = this.setup;
    const adapter = getAdapter();
    const resolved = resolveAllegiances(this.roster, setup);
    const included = e => setup.tokens[e.token.id]?.include !== false;
    // (How many hostile groups fight, for their names: "Hostile" alone, or numbered.)
    this.hostileGroups = hostileGroupsIn(this.roster.filter(included).map(e => resolved[e.token.id]));
    this.coin = mainCoin(adapter, this.roster);
    this.partyCash = Math.floor(this.roster.filter(e => e.spec.kind === "pc" && chosenSide(e, setup) === SIDES.FRIENDLY && included(e))
      .reduce((n, e) => n + (Number(e.spec.valuables?.money) || 0), 0) / this.coin.value);

    // Chains of command, by group: who holds which role (the GM's pick, or the automatic one).
    const chains = setup.options.leadership !== false ? commandChains(this.roster.filter(e => resolved[e.token.id] && included(e)), setup, resolved, adapter) : {};
    this.roles = new Map();
    for ( const [key, chain] of Object.entries(chains) ) for ( const c of chain ) this.roles.set(c.id, { ...c, key });

    // (What Details shows: still on the map, else the party.)
    if ( this.detail.kind === "creature" && !this.roster.some(e => e.token.id === this.detail.id) ) this.detail = { kind: "team", key: SIDES.FRIENDLY };
    if ( this.detail.kind === "team" && this.detail.key !== SIDES.FRIENDLY && !this.roster.some(e => this.#teamKey(e) === this.detail.key) ) this.detail = { kind: "team", key: SIDES.FRIENDLY };

    const bySide = id => this.roster.filter(e => chosenSide(e, setup) === id);
    const sides = SIDE_ORDER.filter(id => this.sideFilter === "all" || this.sideFilter === id).map(id => {
      const members = bySide(id);
      if ( !members.length ) return null;
      const keys = id === SIDES.FRIENDLY || id === SIDES.SECRET ? [id] : id === SIDES.HOSTILE ? HOSTILE_GROUPS : GROUPS.map(n => `${NEUTRAL_PARTY}#${n}`);
      const teams = keys.map(key => this.#teamCard(key, members.filter(e => this.#teamKey(e) === key), resolved)).filter(Boolean);
      return { id, label: loc(`FASTFIGHTING.Side.${id}`), swatch: SIDE_SWATCH[id], count: members.filter(included).length, teams };
    }).filter(Boolean);

    const live = !!adapter?.supportsLive;
    const players = this.#playersContext();
    const ready = players.filter(p => p.status === SURVEY_STATUS.DONE).length;
    const teamCount = new Set(this.roster.filter(included).map(e => this.#fightsFor(e))).size;
    const context = {
      // (The top bar.)
      adapterLabel: adapter?.label ?? loc("FASTFIGHTING.Planner.NoAdapter"),
      hasAdapter: !!adapter,
      counts: this.roster.length ? game.i18n.format("FASTFIGHTING.Planner.Counts", { creatures: this.roster.filter(included).length, teams: teamCount }) : "",
      running: this.running,
      progress: Math.round(this.progress * 100),
      // (The fights run: by tens while a run goes, then how many there were.)
      fightCount: this.abort && Number.isFinite(this.counted) ? fightCount(this.counted) : (this.results && !this.stale ? fightCount(this.results.runs) : null),
      stale: this.stale && !!this.results,
      // (Shown again from the last run: when it ran.)
      restored: this.restoredAt && this.results && !this.stale ? game.i18n.format("FASTFIGHTING.Results.Restored", { when: new Date(this.restoredAt).toLocaleString(game.i18n.lang) }) : null,
      // (So many creatures that few fights fit the prediction's time.)
      runsNote: this.#runsNote(resolved),
      playersChip: players.length ? game.i18n.format("FASTFIGHTING.Planner.PlayersReady", { n: ready, m: players.length }) : "",
      paused: !!this.pausedGame && game.paused,
      ...this.#actions(adapter),
      // (The left pane.)
      leftView: this.leftView,
      views: LEFT_VIEWS.map(id => ({ id, label: loc(`FASTFIGHTING.Planner.View.${id}`), active: this.leftView === id, badge: id === "players" && players.length ? `${ready}/${players.length}` : "" })),
      filters: ["all", ...SIDE_ORDER].map(id => ({
        id, label: id === "all" ? loc("FASTFIGHTING.Planner.AllSides") : loc(`FASTFIGHTING.Side.${id}`), swatch: SIDE_SWATCH[id] ?? "",
        count: (id === "all" ? this.roster : bySide(id)).filter(included).length, active: this.sideFilter === id
      })),
      rosterFilter: this.rosterFilter,
      sides,
      // (The encounter's options: by section, each saying what it's set to when it's closed.)
      options: setup.options,
      live,
      systemApplies: systemAppliesText(adapter),
      open: Object.fromEntries([...this.openSections].map(k => [k, true])),
      sums: this.#sectionSums(),
      systemSection: this.#systemSection(adapter, resolved, chains),
      secondsRange: PREDICTION_SECONDS,
      downedChoices: Object.fromEntries(Object.values(DOWNED_MODELS).map(k => [k, `FASTFIGHTING.Downed.${k}`])),
      aftermathChoices: Object.fromEntries(Object.values(AFTERMATH).map(k => [k, `FASTFIGHTING.Aftermath.${k}`])),
      openingChoices: Object.fromEntries(Object.values(OPENING).map(k => [k, `FASTFIGHTING.Opening.${k}`])),
      // (Follow System greyed out where the system has no surprise rules: no one surprised, then.)
      surpriseChoices: Object.values(SURPRISE).map(value => ({
        value, label: loc(`FASTFIGHTING.Surprise.${value}`), selected: value === surpriseMode(setup.options.surprise),
        disabled: value === SURPRISE.SYSTEM && !systemSurprise()
      })),
      players,
      away: this.#awayCharacters(),
      // (The right pane.)
      detail: this.detail.kind === "creature" ? { creature: this.#creatureDetail(this.roster.find(e => e.token.id === this.detail.id), resolved) } : { team: this.#teamDetail(this.detail.key, resolved, chains) },
      resultTab: this.resultTab,
      resultTabs: RESULT_TABS.map(id => ({ id, label: loc(`FASTFIGHTING.Results.Tab.${id}`), active: this.resultTab === id, disabled: !this.results && id !== "overview" })),
      hasResults: !!this.results
    };
    if ( this.results ) Object.assign(context, this.#resultsContext());
    return context;
  }

  /**
   * The top bar's buttons, as the plan stands: the one to press now (primary) and the one beside it. Running: Stop.
   * Results to go on, and a helper that plays live: Go Live, with Run beside it. The plan changed since:
   * Run, and Go Live held back, saying why. Nothing run yet: Run.
   */
  #actions(adapter) {
    const run = { action: "run", icon: "fa-dice-d20", label: loc("FASTFIGHTING.Planner.Run") };
    const live = { action: "makeItSo", icon: "fa-gavel", label: loc("FASTFIGHTING.MakeItSo.Button") };
    if ( this.running ) {
      return this.abort ? { primary: { action: "cancel", icon: "fa-stop", label: loc("FASTFIGHTING.Planner.Cancel") }, secondary: null }
        : { primary: { ...run, icon: "fa-spinner fa-spin", disabled: true }, secondary: null };
    }
    if ( !adapter ) return { primary: { ...run, disabled: true, tooltip: loc("FASTFIGHTING.Planner.NoAdapter") }, secondary: null };
    if ( !this.results || !this.sample ) return { primary: run, secondary: null };
    if ( this.stale ) return { primary: { ...run, attention: true }, secondary: { ...live, disabled: true, tooltip: loc("FASTFIGHTING.MakeItSo.RunAgain") } };
    if ( !adapter.supportsLive ) return { primary: run, secondary: { ...live, disabled: true, tooltip: loc("FASTFIGHTING.MakeItSo.NeedsUpdate") } };
    return { primary: { ...live, tooltip: loc("FASTFIGHTING.MakeItSo.Hint") }, secondary: run };
  }

  /** What each of the encounter's sections is set to, for when it's closed. */
  #sectionSums() {
    const o = this.setup.options;
    const on = keys => game.i18n.format("FASTFIGHTING.Planner.OnCount", { n: keys.filter(k => !!o[k]).length, m: keys.length });
    return {
      howItPlays: [loc(`FASTFIGHTING.Downed.${o.downedModel}`), loc(`FASTFIGHTING.Opening.${o.opening}`)].filter(t => !t.startsWith("FASTFIGHTING.")).join(" · "),
      rules: on(["positioning", "morale", "leadership", "talking", "ignoreLanguages"]),
      participants: on(["bystanders", "includeHidden"]),
      live: on(["playersRunPCs", "applyPlayerDamage"]),
      prediction: game.i18n.format("FASTFIGHTING.Planner.PredictionSum", { seconds: o.seconds, rounds: o.maxRounds, seed: o.seed ?? loc("FASTFIGHTING.Planner.Random") })
    };
  }

  /** The card a token sits on, as the plan stands: the party; a hostile group; a neutral friend group; or Secret. */
  #teamKey(e) {
    const side = chosenSide(e, this.setup);
    if ( side === SIDES.FRIENDLY || side === SIDES.SECRET ) return side;
    const g = groupOf(e, this.setup);
    return side === SIDES.HOSTILE ? HOSTILE_GROUPS[g - 1] : `${NEUTRAL_PARTY}#${g}`;
  }

  /** The team a token fights for: its card's; a Secret token, the one picked in its row. */
  #fightsFor(e) {
    const team = secretTeam(e, this.setup);
    if ( !team ) return this.#teamKey(e);
    return team.side === "hostile" ? HOSTILE_GROUPS[team.group - 1] : `${NEUTRAL_PARTY}#${team.group}`;
  }

  /** A team's name: the party; Hostile (or Hostile 1, 2, 3, with more than one group); Neutral 1, 2, 3; Secret. */
  #teamName(key) {
    if ( key === SIDES.FRIENDLY ) return loc("FASTFIGHTING.Party.Tab");
    if ( key === SIDES.SECRET ) return loc("FASTFIGHTING.Side.secret");
    if ( key.startsWith(NEUTRAL_PARTY) ) return game.i18n.format("FASTFIGHTING.Side.neutralGroup", { n: key.split("#")[1] });
    return sideName(key, this.hostileGroups);
  }

  /** A team's badge: its short name (F, H1 ... N3; Secret's "?") and its color. */
  #badge(key) {
    const short = TEAM_SHORT[key] ?? "S";
    return { short, label: loc(`FASTFIGHTING.Planner.Team.${short}`), name: this.#teamName(key) };
  }

  /** "1 creature", "5 creatures". */
  #countText(n) {
    return n === 1 ? loc("FASTFIGHTING.Planner.MembersOne") : game.i18n.format("FASTFIGHTING.Planner.MembersMany", { n });
  }

  /** Who heads a team (its boss, else its leader): {name, img, short, roleName, auto, text, reason}, or null. */
  #headOf(key) {
    const role = [...(this.roles?.values() ?? [])].find(r => r.key === key && (r.slot === "boss" || r.slot === "leader"));
    if ( !role ) return null;
    const e = this.roster.find(x => x.token.id === role.id);
    const name = e?.spec.name ?? "";
    return {
      id: role.id, name, img: e?.spec.img, auto: !!role.auto, reason: brief(role.reason ?? ""),
      short: loc(`FASTFIGHTING.Planner.Role.${role.slot}.Short`), roleName: loc(`FASTFIGHTING.Planner.Role.${role.slot}.Name`),
      text: game.i18n.format("FASTFIGHTING.Planner.LedBy", { name })
    };
  }

  /** The Secret tokens fighting for a team. */
  #secretOn(key) {
    return key === SIDES.FRIENDLY || key === SIDES.SECRET ? [] : this.roster.filter(e => chosenSide(e, this.setup) === SIDES.SECRET && this.#fightsFor(e) === key);
  }

  /** A team's card on the left: its badge, name and head, and a line of what it has; its creatures, when opened. */
  #teamCard(key, members, resolved) {
    if ( !members.length ) return null;
    const badge = this.#badge(key);
    const parts = [this.#countText(members.length)];
    const secret = this.#secretOn(key).length;
    if ( secret ) parts.push(game.i18n.format("FASTFIGHTING.Planner.SecretMembers", { n: secret }));
    const cash = key === SIDES.FRIENDLY ? this.partyCash : Number(this.setup.options.purses?.[key]) || 0;
    if ( cash && key !== SIDES.SECRET ) parts.push(`${cash} ${this.coin.label}`.trim());
    const r = this.setup.options.reinforcements?.[key];
    if ( r?.name && key !== SIDES.SECRET ) parts.push(game.i18n.format("FASTFIGHTING.Planner.ReinforcementsShort", { name: r.name, n: Number(r.count) || 0 }));
    return {
      key, ...badge, head: key === SIDES.SECRET ? null : this.#headOf(key), summary: parts.join(" · "),
      selected: this.detail.kind === "team" && this.detail.key === key,
      expanded: this.expandedTeams.has(key),
      toggleLabel: game.i18n.format("FASTFIGHTING.Planner.ShowMembers", { team: badge.name }),
      members: members.map(e => this.#rowContext(e, resolved))
    };
  }

  /**
   * A team in Details: its badge, side and head (and its odds, once run); its cash and reinforcements; its creatures;
   * and its side's settings (personality, leaders, healing, routing; a neutral's lean), shared with its side's other
   * teams (they're kept by side).
   */
  #teamDetail(key, resolved, chains) {
    const setup = this.setup;
    const side = sideOfTeam(key);
    const badge = this.#badge(key);
    const members = this.roster.filter(e => this.#teamKey(e) === key);
    const secret = this.#secretOn(key);
    const r = setup.options.reinforcements?.[key] ?? null;
    const known = r?.uuid ? this.roster?.reinforcementSpecs?.[r.uuid] : undefined;
    const cash = key === SIDES.FRIENDLY ? this.partyCash : Number(setup.options.purses?.[key]) || 0;
    const win = this.results && !this.stale ? this.results.sides?.[key]?.pWin : null;
    // (The side's other teams on the map, sharing its settings.)
    const order = Object.keys(TEAM_SHORT);
    const sharing = side === SIDES.HOSTILE || side === SIDES.NEUTRAL
      ? [...new Set(this.roster.filter(e => chosenSide(e, setup) === side).map(e => this.#teamKey(e)))].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(k => this.#teamName(k)) : [];
    return {
      key, ...badge, sideLabel: loc(`FASTFIGHTING.Side.${side}`), countText: this.#countText(members.length),
      head: key === SIDES.SECRET ? null : this.#headOf(key),
      win: Number.isFinite(win) ? pct(win, 1) : "", winLabel: game.i18n.format("FASTFIGHTING.Planner.TeamWins", { team: badge.name }),
      resources: key === SIDES.SECRET ? null : {
        party: key === SIDES.FRIENDLY, partyCash: this.partyCash, coin: this.coin.label,
        purse: { name: `options.purses.${key}`, value: Number(setup.options.purses?.[key]) || 0 },
        reinforcement: { key, name: r?.name ?? "", img: r?.img ?? "", count: Number(r?.count) || 0, countName: `options.reinforcements.${key}.count`, unreadable: !!r?.uuid && known === null },
        sum: [cash ? `${cash} ${this.coin.label}`.trim() : null, r?.name ? game.i18n.format("FASTFIGHTING.Planner.ReinforcementsShort", { name: r.name, n: Number(r.count) || 0 }) : loc("FASTFIGHTING.Planner.ReinforcementsClear")].filter(Boolean).join(" · ")
      },
      members: members.map(e => ({
        id: e.token.id, name: e.spec.name, img: e.spec.img, include: setup.tokens[e.token.id]?.include !== false,
        team: key === SIDES.SECRET ? this.#badge(this.#fightsFor(e)) : null
      })),
      secretNote: secret.length ? game.i18n.format("FASTFIGHTING.Planner.SecretOnTeam", { names: listJoin(secret.map(e => e.spec.name)) }) : "",
      secret: key === SIDES.SECRET,
      shared: sharing.length > 1 ? game.i18n.format("FASTFIGHTING.Planner.Shared", { side: loc(`FASTFIGHTING.Side.${side}`), teams: listJoin(sharing) }) : "",
      side: this.#sideSettings(side, key)
    };
  }

  /**
   * A side's settings (the planner keeps them by side: a team shows its side's): its personality and how far it's
   * from the trait budget, its healing and routing, its leaders (and the leadership bonus of `key`'s head, else the
   * side's first), a neutral's lean.
   */
  #sideSettings(id, key) {
    const setup = this.setup;
    const s = setup.sides[id];
    if ( !s ) return null;
    const defaults = setting("sideDefaults")[id] ?? setting("sideDefaults").hostile;
    const members = this.roster.filter(e => chosenSide(e, setup) === id);
    const heads = members.map(m => this.roles.get(m.token.id)).filter(r => r && (r.slot === "boss" || r.slot === "leader"));
    const head = heads.find(h => h.key === key) ?? heads[0] ?? null;
    const headName = hid => this.roster.find(e => e.token.id === hid)?.spec.name ?? "";
    const bonus = head ? Object.fromEntries(Object.entries(head.leadership).map(([k, v]) => [k, v.base])) : null;
    const lf = s.leadershipFudge ?? {};
    const auto = heads.length ? game.i18n.format("FASTFIGHTING.Planner.AutoLeaders", { names: heads.map(h => `${headName(h.id)} (${loc(`FASTFIGHTING.Planner.Role.${h.slot}.Name`)})`).join(", ") }) : loc("FASTFIGHTING.Planner.AutoLeaderNone");
    return {
      id,
      // Neutrals only lean (they take no side until something crosses them).
      lean: id === SIDES.NEUTRAL ? s.allegiance : null,
      leanChoices: id === SIDES.NEUTRAL ? Object.fromEntries(Object.values(ALLEGIANCE).map(k => [k, `FASTFIGHTING.Lean.${k}`])) : null,
      traits: this.#traitViews(defaults, s.traitFudge, k => `sides.${id}.traitFudge.${k}`),
      budget: this.#budgetView(defaults, s.traitFudge),
      healAggro: s.healAggro,
      healChoices: Object.fromEntries(HEAL_AGGRO.map(k => [k, `FASTFIGHTING.HealAggro.${k}`])),
      morale: s.morale !== false,
      fightsSum: [loc(`FASTFIGHTING.HealAggro.${s.healAggro ?? "auto"}`), s.morale !== false ? loc("FASTFIGHTING.Planner.SideMorale") : null].filter(t => t && !t.startsWith("FASTFIGHTING.")).join(" · "),
      leaderChoices: { auto, none: loc("FASTFIGHTING.Planner.NoLeader") },
      leaderId: s.leaderId === "none" ? "none" : "auto",
      leaderSum: s.leaderId === "none" ? loc("FASTFIGHTING.Planner.NoLeader") : listJoin(heads.map(h => headName(h.id))) || loc("FASTFIGHTING.Planner.AutoLeaderNone"),
      leaderNames: listJoin(heads.map(h => headName(h.id))),
      leadership: bonus ? [
        this.#statView("leadBrave", bonus.brave, lf.brave ?? 0, `sides.${id}.leadershipFudge.brave`, 5),
        this.#statView("leadTactical", bonus.tacticalFloor, lf.tacticalFloor ?? 0, `sides.${id}.leadershipFudge.tacticalFloor`, 5),
        this.#statView("leadAttack", bonus.attack, lf.attack ?? 0, `sides.${id}.leadershipFudge.attack`, 1),
        // (A system with no armor class has no armor class bonus.)
        ...(hasStat("ac") ? [this.#statView("leadAc", bonus.ac, lf.ac ?? 0, `sides.${id}.leadershipFudge.ac`, 1)] : [])
      ] : []
    };
  }

  /** Friendly characters whose players are all away: a GM can answer their surveys for them. */
  #awayCharacters() {
    return this.roster.filter(e => chosenSide(e, this.setup) === SIDES.FRIENDLY && e.spec.kind === "pc").map(e => {
      const owners = game.users.filter(u => !u.isGM && e.token.actor?.testUserPermission(u, "OWNER"));
      if ( !owners.length || owners.some(u => u.active) ) return null;
      return { id: e.token.id, name: e.spec.name, img: e.spec.img, owners: listJoin(owners.map(u => u.name)) };
    }).filter(Boolean);
  }

  /**
   * A creature's row in its team's card: who it is (a click shows it in Details), its marks, its role (a menu), its
   * team (a menu, where it can change), whether it takes part, and a menu of the rest (its side, its survey, its token).
   */
  #rowContext(e, resolved) {
    const setup = this.setup;
    const id = e.token.id;
    const ts = setup.tokens[id] ?? tokenSetup({ tokens: {} }, id); // rendering never edits the setup
    const s = e.spec;
    const chosen = chosenSide(e, setup);
    const resolvedSide = resolved[id];
    const owners = game.users.filter(u => !u.isGM && e.token.actor?.testUserPermission(u, "OWNER"));
    const moved = resolvedSide && resolvedSide !== chosen && !(chosen === SIDES.HOSTILE && HOSTILE_GROUPS.includes(resolvedSide));
    const lean = setup.sides[SIDES.NEUTRAL]?.allegiance;
    // Its role in its group's chain of command: boss (never in the party), leader, 1st or 2nd lieutenant; out of
    // command; or left to the automatic pick.
    const held = this.roles?.get(id);
    const canLead = setup.options.leadership !== false && setup.sides[chosen]?.leaderId !== "none" && !!resolvedSide && !s.hazard;
    const roleLabel = held ? (held.auto ? game.i18n.format("FASTFIGHTING.Planner.RoleAutoPicked", { role: loc(`FASTFIGHTING.Planner.Role.${held.slot}.Name`) }) : loc(`FASTFIGHTING.Planner.Role.${held.slot}.Name`))
      : loc(ts.role === "none" ? "FASTFIGHTING.Planner.RoleNone" : "FASTFIGHTING.Planner.NoRole");
    const role = canLead ? {
      short: held ? loc(`FASTFIGHTING.Planner.Role.${held.slot}.Short`) : "–", label: roleLabel, cls: held ? (held.auto ? "is-auto" : "") : "is-none",
      aria: game.i18n.format("FASTFIGHTING.Planner.RoleMenu", { role: roleLabel }),
      items: [
        ...ROLES.filter(r => r !== "boss" || chosen !== SIDES.FRIENDLY).map(r => ({
          action: "setRole", key: r, short: loc(`FASTFIGHTING.Planner.Role.${r}.Short`), label: loc(`FASTFIGHTING.Planner.Role.${r}.Name`), cls: "", active: ts.role === r && !ts.roleAuto
        })),
        { action: "setRole", key: "none", short: "–", label: loc("FASTFIGHTING.Planner.RoleNone"), cls: "is-none", active: ts.role === "none" },
        { action: "autoRole", key: "auto", icon: "fa-rotate-left", label: loc("FASTFIGHTING.Planner.RoleAuto"), active: !ts.role || !!ts.roleAuto }
      ]
    } : null;
    // Its team: a hostile group or a neutral friend group (a Secret token, either); the party has one.
    const fights = this.#fightsFor(e);
    const badge = this.#badge(fights);
    const item = (value, key) => ({ value, ...this.#badge(key), active: key === fights });
    const items = chosen === SIDES.HOSTILE ? GROUPS.map(n => item(`hostile${n}`, HOSTILE_GROUPS[n - 1]))
      : chosen === SIDES.NEUTRAL ? GROUPS.map(n => item(`neutral${n}`, `${NEUTRAL_PARTY}#${n}`))
        : chosen === SIDES.SECRET ? [...GROUPS.map(n => item(`hostile${n}`, HOSTILE_GROUPS[n - 1])), ...GROUPS.map(n => item(`neutral${n}`, `${NEUTRAL_PARTY}#${n}`))] : null;
    return {
      id,
      name: s.name,
      findName: s.name.toLocaleLowerCase(game.i18n.lang),
      img: s.img,
      sub: kindChip(s),
      hidden: s.hidden,
      bystander: s.inEncounter === false,
      include: ts.include !== false,
      includeLabel: game.i18n.format("FASTFIGHTING.Planner.IncludeName", { name: s.name }),
      moreLabel: game.i18n.format("FASTFIGHTING.Planner.RowMenu", { name: s.name }),
      selected: this.#isShown(id),
      fudged: Object.values(ts.fudge ?? {}).some(v => Number(v)),
      controllers: owners.map(u => u.name).join(", "),
      // (Neutrals, and Secret tokens on a neutral team, lean as the Neutral side says: nowhere, when it leaves them out.)
      note: resolvedSide === NEUTRAL_PARTY ? loc(`FASTFIGHTING.Planner.TakesNoSide.${LEANS.has(lean) ? lean : ALLEGIANCE.NEUTRAL}`)
        : moved ? game.i18n.format("FASTFIGHTING.Planner.FightsWith", { side: sideName(resolvedSide, this.hostileGroups) }) : (resolvedSide === null && ts.include !== false ? loc("FASTFIGHTING.Planner.SitsOut") : ""),
      role,
      team: { ...badge, aria: game.i18n.format("FASTFIGHTING.Planner.TeamPick", { team: badge.name }), items },
      sideItems: SIDE_ORDER.map(k => ({ id: k, label: loc(`FASTFIGHTING.Side.${k}`), swatch: SIDE_SWATCH[k], active: chosen === k })),
      // (A friendly character's survey: its players asked about it; or every GM, to answer for a player who's away.)
      survey: chosen === SIDES.FRIENDLY && !s.hazard ? {
        players: owners.length > 0,
        playersHint: brief(game.i18n.format("FASTFIGHTING.Survey.AskPlayers", { names: listJoin(owners.map(u => u.name)) }))
      } : null
    };
  }

  /** A creature in Details: everything about it for this battle, its odds once run, and its team (a click shows it). */
  #creatureDetail(e, resolved) {
    if ( !e ) return null;
    const setup = this.setup;
    const ts = setup.tokens[e.token.id] ?? tokenSetup({ tokens: {} }, e.token.id); // rendering never edits the setup
    const s = e.spec;
    const fudge = ts.fudge ?? {};
    const playerControlled = isPlayerControlled(s, e.token.actor);
    const { playstyles } = tacticsFor(e.token.actor, s);
    const owners = game.users.filter(u => !u.isGM && e.token.actor?.testUserPermission(u, "OWNER"));
    const approach = this.#nearestEnemyApproach(e, resolved);
    const row = this.#rowContext(e, resolved);
    const fights = this.#fightsFor(e);
    const c = this.results && !this.stale ? Object.values(this.results.combatants ?? {}).find(x => (x.tokenId ?? x.id) === e.token.id) : null;
    const stats = STAT_FUDGES.filter(([k]) => hasStat(k)).map(([k, step]) => {
      const base = k === "ac" ? s.defenses.ac : k === "hp" ? s.hp.max : 0;
      return this.#statView(k, base, fudge[k] ?? 0, `tokens.${e.token.id}.fudge.${k}`, step);
    });
    return {
      id: e.token.id,
      name: s.name,
      img: s.img,
      sub: kindChip(s),
      hidden: s.hidden,
      role: row.role,
      teamChip: { key: chosenSide(e, setup) === SIDES.SECRET ? SIDES.SECRET : fights, ...this.#badge(fights) },
      hp: `${s.hp.value + (fudge.hp ?? 0)}/${s.hp.max + (fudge.hp ?? 0)}`,
      hpName: term("hp"),
      // Stamina, where the system has it: spent before hit points.
      stamina: s.hp.stamina ? `${s.hp.stamina.value}/${s.hp.stamina.max}` : null,
      staminaName: term("sp"),
      ac: s.defenses.ac + (fudge.ac ?? 0),
      showAc: hasStat("ac"),
      acName: term("ac"),
      controllers: owners.map(u => u.name).join(", "),
      resolvedLabel: row.note,
      approach: approach ? game.i18n.format("FASTFIGHTING.Planner.Approach", {
        mode: loc(`FASTFIGHTING.Mode.${approach.mode ?? "walk"}`), name: approach.name,
        distance: Number.isFinite(approach.moves) ? approachDistance(approach) : "∞"
      }) + (approach.mult > 1.05 ? ` · ${loc(approach.throughWall ? "FASTFIGHTING.Planner.ThroughWall" : approach.blocked ? "FASTFIGHTING.Planner.AroundWalls" : "FASTFIGHTING.Planner.Terrain")} ×${approach.mult.toFixed(2)}` : "") + (approach.meleeOk ? "" : ` · ${loc("FASTFIGHTING.Planner.OutOfReach")}`) : "",
      fate: c ? {
        bars: [["standing", c.pStanding], ["down", c.pDown], ["dead", c.pDead], ["fled", c.pFled]].map(([cls, p]) => ({ cls, w: (p * 100).toFixed(1), label: `${loc(`FASTFIGHTING.Results.${cls === "standing" ? "Standing" : cls === "down" ? "Down" : cls === "dead" ? "Dead" : "Fled"}`)} ${pct(p)}` })),
        standing: pct(c.pStanding), downed: pct(c.pDowned), dead: pct(c.pDead), fled: pct(c.pFled)
      } : null,
      traits: [...this.#traitViews(baseTraits(s), fudge, k => `tokens.${e.token.id}.fudge.${k}`, s.traitReasons, playstyles.traits),
        this.#adhdView(e.token.actor?.getFlag(MODULE_ID, "adhd") ?? 0, `tokens.${e.token.id}.fudge.adhd`)],
      budget: this.#budgetView(baseTraits(s), fudge),
      playstyleNames: playstyles.ids.map(id => loc(`FASTFIGHTING.Playstyle.${id}.Name`)).join(", "),
      stats,
      statsSum: stats.map(v => `${v.label} ${v.value}`).join(" · "),
      ignoreTerrain: !!ts.ignoreTerrain,
      diesAtZero: ts.diesAtZero ?? s.diesAtZero,
      playerControlled,
      // (Its playstyles and answers; the hidden scores aren't shown again: its steppers show them, with the GM's nudges.)
      tactics: questionsContext(s, e.token.actor, `gm-${e.token.id}`, { questions: true, hidden: false, targets: this.roster.map(r => ({ id: r.token.id, name: r.spec.name })) }),
      actions: s.actions.map(a => a.name).filter((n, i, arr) => arr.indexOf(n) === i).join(", "),
      speeds: Object.entries(s.speeds ?? {}).map(([k, v]) => `${loc(`FASTFIGHTING.Mode.${k}`)} ${v}`).join(", "),
      environment: [...(s.environment?.types ?? []), s.environment?.difficult ? loc("FASTFIGHTING.Planner.DifficultHere") : null, s.environment?.hazardous ? loc("FASTFIGHTING.Planner.HazardHere") : null].filter(Boolean).join(", ")
    };
  }

  /**
   * The Overview's numbers, from a run's results (and the run before, for each one's change): the party's lot, how its
   * foes end, and the fight's shape. A number a run before this one didn't keep has no change shown.
   */
  #overview(r, prev, combatants) {
    const delta = (now, then, goodUp) => {
      if ( !prev || !Number.isFinite(then) ) return null;
      const d = Math.round((now - then) * 100);
      return { text: d ? `${d > 0 ? "+" : "−"}${Math.abs(d)}` : "±0", cls: !d ? "" : (d > 0) === goodUp ? "is-better" : "is-worse" };
    };
    const kpi = (key, p, then, goodUp, cls = "", hint = false) => ({
      label: loc(`FASTFIGHTING.Results.${key}`), value: pct(p, 1), cls, hint: hint ? loc(`FASTFIGHTING.Results.${key}Hint`) : null, delta: delta(p, then, goodUp)
    });
    const ifAny = (p, make) => (p > 0 ? [make()] : []);
    const pt = r.party;
    const spent = this.#partySpent(r);
    const party = [
      kpi("PartyWins", r.sides.friendly?.pWin ?? 0, prev?.sides?.friendly?.pWin ?? 0, true),
      kpi("PcDeath", r.pAnyPcDead, prev?.pAnyPcDead, false, "danger"),
      kpi("PcDowned", r.pAnyPcDowned, prev?.pAnyPcDowned, false, "warn"),
      ...(pt ? [
        kpi("PartyWiped", pt.pWiped, prev?.party?.pWiped, false, "danger", true),
        { label: loc("FASTFIGHTING.Results.PcsDowned"), value: localize("FASTFIGHTING.Results.OfN", { n: pt.meanDowned.toFixed(1), m: pt.pcs }), cls: "warn", hint: loc("FASTFIGHTING.Results.PcsDownedHint"), delta: null },
        kpi("PartyHp", pt.meanHp, prev?.party?.meanHp, true, "", true)
      ] : []),
      ...(spent === null ? [] : [kpi("PartySpent", spent, prev ? this.#partySpent(prev) ?? NaN : NaN, false, "", true)])
    ];
    // What a strategist weighs before committing: what winning costs, the ally whose fall costs most, the bad tail.
    const stakes = [
      ...(Number.isFinite(pt?.pCostlyWin) ? [kpi("CostlyWins", pt.pCostlyWin, prev?.party?.pCostlyWin, false, "warn", true)] : []),
      ...this.#linchpin(r).map(l => ({
        label: localize("FASTFIGHTING.Results.IfDown", { name: l.name }), value: pct(l.down, 1), cls: "danger",
        hint: localize("FASTFIGHTING.Results.IfDownHint", { name: l.name, up: pct(l.up, 1) }), delta: null
      })),
      ...(Number.isFinite(pt?.worstDowned) ? [{
        label: loc("FASTFIGHTING.Results.WorstTenth"), value: localize("FASTFIGHTING.Results.OfN", { n: pt.worstDowned, m: pt.pcs }), cls: "warn",
        hint: loc("FASTFIGHTING.Results.WorstTenthHint"), delta: null
      }] : [])
    ];
    // Money, in the system's main coin: what the party's side gains and loses on average, a deal struck, a PC robbed
    // or paying up. (Only where anything changes hands.)
    const m = r.money;
    const coins = (key, now, then, goodUp) => ({
      label: loc(`FASTFIGHTING.Results.${key}`), value: this.#coinText(now), cls: "", hint: loc(`FASTFIGHTING.Results.${key}Hint`),
      delta: prev && Number.isFinite(then) && Math.round(now / this.coin.value) !== Math.round(then / this.coin.value)
        ? { text: `${now > then ? "+" : "−"}${this.#coinText(Math.abs(now - then))}`, cls: (now > then) === goodUp ? "is-better" : "is-worse" } : null
    });
    const money = m && (m.gained > 0 || m.lost > 0 || m.pDeal > 0 || pt?.pLostGoods > 0) ? [
      ...ifAny(m.gained, () => coins("Spoils", m.gained, prev?.money?.gained, true)),
      ...ifAny(m.lost, () => coins("Losses", m.lost, prev?.money?.lost, false)),
      ...ifAny(m.pDeal, () => kpi("DealStruck", m.pDeal, prev?.money?.pDeal, true, "talk", true)),
      ...ifAny(pt?.pLostGoods, () => kpi("PcLosesGoods", pt.pLostGoods, prev?.party?.pLostGoods, false, "warn", true))
    ] : [];
    const fe = r.foesEnd;
    const foesEnd = fe ? FOE_ENDS.filter(k => fe[k] >= 0.005).map(k => ({ cls: k, w: (fe[k] * 100).toFixed(1), label: loc(`FASTFIGHTING.Results.FoeEnd.${k}`), pct: pct(fe[k]) })) : [];
    const foes = [
      ...ifAny(r.pFoeHeadFalls, () => kpi("FoeHeadFalls", r.pFoeHeadFalls, prev?.pFoeHeadFalls, true, "", true)),
      ...ifAny(r.pAnySwayed, () => kpi("Swayed", r.pAnySwayed, prev?.pAnySwayed, true, "talk")),
      ...ifAny(r.pPeaceful, () => kpi("Peaceful", r.pPeaceful, prev?.pPeaceful, true, "talk")),
      ...((r.pCollapsed ?? 0) > 0 || this.setup.options.opening === OPENING.ARGUMENT ? [kpi("Collapsed", r.pCollapsed ?? 0, prev?.pCollapsed, false, "warn")] : [])
    ];
    const first = [...combatants].sort((a, b) => b.pFirstToFall - a.pFirstToFall)[0];
    const fight = [
      ...ifAny(first?.pFirstToFall, () => ({ label: localize("FASTFIGHTING.Results.FallsFirst", { name: first.name }), value: pct(first.pFirstToFall, 1), cls: "", hint: null, delta: null })),
      ...ifAny(r.pBystandersJoin, () => kpi("BystandersJoin", r.pBystandersJoin, prev?.pBystandersJoin, false, "", true)),
      ...ifAny(r.pReinforced, () => kpi("Reinforced", r.pReinforced, prev?.pReinforced, false, "", true))
    ];
    return {
      party, stakes, money, foes, fight, foesEnd,
      foesEndLabel: `${loc("FASTFIGHTING.Results.FoesEnd")}: ${foesEnd.map(f => `${f.label} ${f.pct}`).join(", ")}`
    };
  }

  /**
   * The linchpin: the creature on the party's side whose going down costs the party most, by its odds of winning in
   * the fights where it went down against those where it didn't; [] where none went down (or stayed up) in enough of
   * them to tell, or none costs anything.
   */
  #linchpin(r) {
    const enough = Math.max(10, 0.05 * r.runs);
    const best = Object.values(r.combatants)
      .filter(c => Number.isFinite(c.pWinIfDowned) && Number.isFinite(c.pWinIfUp) && c.pDowned * r.runs >= enough && (1 - c.pDowned) * r.runs >= enough)
      .map(c => ({ name: c.name, down: c.pWinIfDowned, up: c.pWinIfUp, cost: c.pWinIfUp - c.pWinIfDowned }))
      .sort((a, b) => b.cost - a.cost)[0];
    return best && best.cost >= 0.005 ? [best] : [];
  }

  /** An amount in the smallest coin, in the system's main coin ("23 gp"; a tenth below 10). */
  #coinText(amount) {
    const n = amount / this.coin.value;
    const shown = n.toLocaleString(game.i18n.lang, { maximumFractionDigits: n < 10 ? 1 : 0 });
    return this.coin.label ? localize("FASTFIGHTING.Log.Money", { n: shown, coin: this.coin.label }) : shown;
  }

  /** How much of the PCs' limited resources a fight spends, on average: each pool's share spent, averaged (null: none). */
  #partySpent(r) {
    const shares = [];
    for ( const cs of this.spec?.combatants ?? [] ) {
      if ( cs.kind !== "pc" ) continue;
      for ( const [key, start] of Object.entries(cs.resources ?? {}) ) {
        if ( !(start > 0) ) continue;
        shares.push(Math.min(1, (r.combatants?.[cs.id]?.resources?.[key] ?? 0) / start));
      }
    }
    return shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : null;
  }

  #resultsContext() {
    const r = this.results;
    const spec = this.spec;
    const sideColor = { friendly: "var(--ff-friendly)", hostile: "var(--ff-hostile)", hostile2: "var(--ff-hostile2)", hostile3: "var(--ff-hostile3)", neutral: "var(--ff-neutral)", secret: "var(--ff-secret)" };
    const segments = Object.values(r.sides).filter(s => s.pWin > 0).map(s => ({
      label: s.label, pct: pct(s.pWin, 1), width: (s.pWin * 100).toFixed(2), color: sideColor[s.id] ?? "var(--ff-neutral)"
    }));
    if ( r.pStalemate > 0 ) segments.push({ label: loc("FASTFIGHTING.Results.Stalemate"), pct: pct(r.pStalemate, 1), width: (r.pStalemate * 100).toFixed(2), color: "var(--ff-muted)" });
    if ( r.pNone > 0 ) segments.push({ label: loc("FASTFIGHTING.Results.NoOne"), pct: pct(r.pNone, 1), width: (r.pNone * 100).toFixed(2), color: "var(--ff-dark)" });

    const maxHist = Math.max(...r.rounds.histogram, 0.0001);
    const histogram = r.rounds.histogram.map((p, round) => ({ round, p: pct(p), height: Math.round((p / maxHist) * 100) })).filter(h => h.round > 0);
    const combatants = Object.values(r.combatants).map(c => ({
      ...c,
      tokenId: spec?.combatants?.find(x => x.id === c.id)?.tokenId ?? (this.roster?.some(e => e.token.id === c.id) ? c.id : null),
      sideLabel: this.spec?.sides?.[c.side]?.label ?? sideName(c.side, this.hostileGroups),
      sideClass: c.side,
      bars: [
        { cls: "standing", w: (c.pStanding * 100).toFixed(1), label: `${loc("FASTFIGHTING.Results.Standing")} ${pct(c.pStanding)}` },
        { cls: "down", w: (c.pDown * 100).toFixed(1), label: `${loc("FASTFIGHTING.Results.Down")} ${pct(c.pDown)}` },
        { cls: "dead", w: (c.pDead * 100).toFixed(1), label: `${loc("FASTFIGHTING.Results.Dead")} ${pct(c.pDead)}` },
        { cls: "fled", w: (c.pFled * 100).toFixed(1), label: `${loc("FASTFIGHTING.Results.Fled")} ${pct(c.pFled)}` },
        { cls: "surrendered", w: (c.pSurrendered * 100).toFixed(1), label: `${loc("FASTFIGHTING.Status.surrendered")} ${pct(c.pSurrendered)}` },
        { cls: "stoodDown", w: (c.pStoodDown * 100).toFixed(1), label: `${loc("FASTFIGHTING.Status.stoodDown")} ${pct(c.pStoodDown)}` },
        { cls: "beaten", w: ((c.pBeaten ?? 0) * 100).toFixed(1), label: `${loc("FASTFIGHTING.Status.beaten")} ${pct(c.pBeaten ?? 0)}` },
        { cls: "bound", w: ((c.pBound ?? 0) * 100).toFixed(1), label: `${loc("FASTFIGHTING.Status.bound")} ${pct(c.pBound ?? 0)}` },
        { cls: "switched", w: (c.pSwitched * 100).toFixed(1), label: `${loc("FASTFIGHTING.Results.Switched")} ${pct(c.pSwitched)}` },
        { cls: "neutral", w: ((c.pNeutral ?? 0) * 100).toFixed(1), label: `${loc("FASTFIGHTING.Results.Neutral")} ${pct(c.pNeutral ?? 0)}` }
      ],
      talkedDown: c.pTalkedDown > 0.0005 ? pct(c.pTalkedDown, 1) : "",
      conceded: c.pConceded > 0.0005 ? pct(c.pConceded, 1) : "",
      standing: pct(c.pStanding), dead: pct(c.pDead), downed: pct(c.pDowned), fled: pct(c.pFled),
      hpLeft: pct(c.meanHpFrac), damage: c.meanDamage.toFixed(1), healing: c.meanHealing.toFixed(1), first: pct(c.pFirstToFall)
    }));
    const foes = combatants.filter(c => c.side !== SIDES.FRIENDLY).sort((a, b) => b.meanDamage - a.meanDamage).slice(0, 3);
    const atRisk = combatants.filter(c => c.side === SIDES.FRIENDLY).sort((a, b) => b.pDowned - a.pDowned).slice(0, 3);

    const resources = [];
    const adapter = getAdapter();
    for ( const c of Object.values(r.combatants) ) {
      const cs = spec.combatants.find(x => x.id === c.id);
      for ( const [key, used] of Object.entries(c.resources) ) {
        if ( used <= 0.005 ) continue;
        const start = cs?.resources?.[key] ?? 0;
        const action = cs?.actions.find(a => a.resource === key || a.ammo === key);
        // The system names its own pools (focus points, spell slots, ki ...); otherwise the action that uses it (or
        // shoots it).
        const label = adapter?.resourceLabel?.(key, cs) ?? action?.name ?? key;
        resources.push({ name: c.name, label, used: used.toFixed(2), start, width: start ? Math.min(100, (used / start) * 100).toFixed(1) : 0 });
      }
    }

    const swing = this.swing?.map(s => ({
      ...s, deltaLabel: `${s.delta >= 0 ? "+" : ""}${(s.delta * 100).toFixed(1)}%`, width: Math.min(50, Math.abs(s.delta) * 100).toFixed(1), positive: s.delta >= 0
    })) ?? null;

    const sample = this.sample ? this.#sampleContext() : null;

    // The win bar stays over the tabs; the Overview has the rest, each with its change since the run before (in points).
    const summary = { label: segments.map(s => `${s.label} ${s.pct}`).join(", ") };
    const overview = this.#overview(r, this.previousResults, combatants);

    return {
      summary,
      overview,
      results: {
        runs: r.runs,
        seed: r.seed,
        segments,
        partyWin: pct(r.sides.friendly?.pWin ?? 0, 1),
        pcDeath: pct(r.pAnyPcDead, 1),
        pcDowned: pct(r.pAnyPcDowned, 1),
        swayed: pct(r.pAnySwayed ?? 0, 1),
        peaceful: pct(r.pPeaceful ?? 0, 1),
        peacefulAny: (r.pPeaceful ?? 0) > 0,
        // (Only an argument: how often the talks collapsed.)
        collapsed: pct(r.pCollapsed ?? 0, 1),
        collapsedAny: (r.pCollapsed ?? 0) > 0 || this.setup.options.opening === OPENING.ARGUMENT,
        collapseNote: this.#collapseNote(r),
        rounds: r.rounds,
        histogram,
        foes, atRisk, combatants, resources, swing, sample
      },
      storyStyles: Object.fromEntries(STORY_STYLES.map(k => [k, `FASTFIGHTING.Story.Style.${k}`])),
      storyStyle: this.storyStyle,
      storyOdds: setting("storyOdds")
    };
  }

  /** The story of the current sample fight in the chosen style (the same text Make it So posts). */
  storyFor(style = this.storyStyle, fight = this.sample) {
    if ( !fight || !this.storyTables ) return null;
    if ( this.storyCache.tables !== this.storyTables ) {
      this.storyCache.clear();
      this.storyCache.tables = this.storyTables;
    }
    const key = `${fight.seed}|${style}`;
    if ( !this.storyCache.has(key) ) {
      this.storyCache.set(key, buildStory(fight.result, this.spec, style, {
        tables: this.storyTables,
        seed: fight.seed,
        title: game.i18n.format("FASTFIGHTING.Story.Title", { scene: canvas.scene?.name ?? "" }),
        damageType: getAdapter()?.rules?.storyDamageType?.bind(getAdapter().rules) ?? null,
        conditionType: getAdapter()?.rules?.storyCondition?.bind(getAdapter().rules) ?? null,
        // (How hurt a creature looks after a harm, by its token on the scene: in Health Estimate's words where it's on.)
        healthState: healthLookup({ tokenOf: id => canvas.scene?.tokens.get(this.spec.combatants.find(c => c.id === id)?.tokenId ?? id) ?? null })
      }));
    }
    return this.storyCache.get(key);
  }

  /**
   * Talks that collapsed in more than a tenth of the battles: the most common reason, and the creatures that most often
   * broke them for it ("Talks collapsed in 96% of battles. Most often: the River Drake couldn't follow the talk"), or null.
   */
  #collapseNote(r) {
    const top = r.collapseCause;
    if ( !((r.pCollapsed ?? 0) > COLLAPSE_NOTE) || !top ) return null;
    const why = ["beast", "impatient", "insulted", "annoyed", "blood", "fray"].includes(top.cause) ? top.cause : "impatient";
    const names = (top.by ?? []).map(id => r.combatants?.[id]?.name).filter(Boolean);
    const reason = localize(`FASTFIGHTING.Results.CollapseWhy.${why}`, { names: names.length ? listJoin(names) : localize("FASTFIGHTING.Results.CollapseSomeone") });
    return localize("FASTFIGHTING.Results.CollapseTop", { pct: pct(r.pCollapsed, 0), why: reason, share: pct(top.share, 0) });
  }

  #sampleContext() {
    const { seed, result } = this.sample;
    const rows = planMakeItSo(this.spec, result);
    // (Only an argument that broke up before it came to blows: nobody won, and nobody fell.)
    const collapsed = (result.log ?? []).some(e => e.type === "end" && e.resolved === "collapsed");
    return {
      seed,
      outcome: result.outcome === "victory" ? listJoin(result.winners.map(w => this.spec?.sides?.[w]?.label ?? sideName(w, this.hostileGroups)))
        : loc(`FASTFIGHTING.Sample.Outcome.${collapsed ? "collapsed" : result.outcome}`),
      story: this.storyFor()?.html ?? "",
      totalRounds: roundsText(result.rounds ?? 0),
      finals: rows.map(r => ({ name: r.spec.name, side: r.spec.side, status: loc(`FASTFIGHTING.Status.${statusOf(r.final)}`), statusClass: statusOf(r.final), lines: r.lines.join("; ") || loc("FASTFIGHTING.Sample.Unchanged") }))
    };
  }

  #playersContext() {
    const scene = canvas.scene;
    return playersOnScene(scene).map(u => {
      let { status } = surveyStatus(u, scene);
      if ( status === SURVEY_STATUS.REQUESTED && u.active ) status = SURVEY_STATUS.REQUESTED;
      else if ( status === SURVEY_STATUS.REQUESTED && !u.active ) status = "offline";
      else if ( status === SURVEY_STATUS.ENTERING && !u.active ) status = SURVEY_STATUS.CLOSED;
      return {
        id: u.id,
        name: u.name,
        color: u.color?.css ?? u.color,
        active: u.active,
        status,
        statusLabel: loc(`FASTFIGHTING.Survey.Status.${status}`),
        entering: status === SURVEY_STATUS.ENTERING,
        tokens: brief(listItems(tokensForUser(scene, u).map(t => t.name))),
        chars: tokensForUser(scene, u).map(t => ({ name: t.name, img: t.texture?.src ?? t.actor?.img })),
        openLabel: loc(status === SURVEY_STATUS.NONE ? "FASTFIGHTING.Survey.OpenFirst" : "FASTFIGHTING.Survey.Reopen")
      };
    });
  }

  /** Called by hooks when someone edits an actor's answers. */
  syncActor(actor) {
    if ( !this.rendered ) return;
    syncTacticsDom(this.element, actor);
    if ( this.results ) this.stale = true;
    this.signatures ??= new Map();
    const sig = playstyleSignature(actor);
    const before = this.signatures.get(actor.uuid);
    this.signatures.set(actor.uuid, sig);
    const typing = this.element.contains(document.activeElement) && ["TEXTAREA", "INPUT"].includes(document.activeElement?.tagName) && document.activeElement.type !== "checkbox";
    if ( before !== sig && !typing && !this.running && !this.#settingUp ) this.render();
  }

  static async #onTogglePlaystyle(event, target) {
    const actor = await fromUuid(target.dataset.actorUuid);
    const ok = await togglePlaystyle(actor, target.dataset.playstyle);
    if ( !ok ) ui.notifications.warn(loc("FASTFIGHTING.Playstyle.Max"));
    this.stale = true;
    this.render();
  }

  /** A picked playstyle one place earlier or later (the first counts most). */
  static async #onMovePlaystyle(event, target) {
    const actor = await fromUuid(target.dataset.actorUuid);
    if ( !await movePlaystyle(actor, target.dataset.playstyle, Number(target.dataset.dir)) ) return;
    this.stale = true;
    this.render();
  }

  /**
   * The GM puts loot on the map: a chest or a bag (loot-drop.js placeLoot), where they click next (Escape, or a click
   * outside the map, leaves it), then its own window opens to fill it.
   */
  static async #onPlaceLoot(event, target) {
    const kind = target.dataset.kind === "bag" ? "bag" : "chest";
    if ( !canvas?.ready || !canvas.scene ) return;
    ui.notifications.info(loc("FASTFIGHTING.Planner.PlaceLootClick"));
    await this.minimize?.();
    const point = await pickPoint();
    await this.maximize?.();
    if ( !point ) return;
    const made = await placeLoot(canvas.scene, point, kind);
    if ( !made ) return ui.notifications.warn(loc("FASTFIGHTING.Planner.PlaceLootFailed"));
    await openPile(made);
  }

  /**
   * A team's reinforcements (engine/behavior/reinforce.js): one creature, dropped from a compendium or the Actors
   * directory (or chosen: #onChooseReinforcement), and how many of it can come; one to start with, or as many as before.
   * The party's too (they come only when FastFighting plays it, or the GM calls them in the Battle Vantage).
   */
  async #setReinforcement(key, actor) {
    if ( actor?.documentName !== "Actor" ) return;
    const was = this.setup.options.reinforcements?.[key];
    this.setup.options.reinforcements = { ...(this.setup.options.reinforcements ?? {}), [key]: { uuid: actor.uuid, name: actor.name, img: actor.img, count: Number(was?.count) || 1 } };
    await saveSetup(this.setup, this.holder);
    if ( this.roster ) this.roster.reinforcementSpecs = await readReinforcements(this.setup, getAdapter(), this.roster.reinforcementSpecs ?? {});
    this.stale = true;
    this.render();
  }

  /** A creature dropped on a team's reinforcements. */
  async #dropReinforcement(key, event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if ( data?.type !== "Actor" || typeof data.uuid !== "string" ) return ui.notifications.warn(loc("FASTFIGHTING.Planner.ReinforcementsActorOnly"));
    await this.#setReinforcement(key, await fromUuid(data.uuid));
  }

  /** A team's reinforcements chosen from the world's actors, without dragging: a list to filter, a click to pick. */
  static async #onChooseReinforcement(event, target) {
    const key = target.dataset.team;
    const esc = foundry.utils.escapeHTML;
    const actors = game.actors.contents.filter(a => a.isOwner).sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    const content = `<div class="ff-pick-actor">
      <input type="search" placeholder="${esc(loc("FASTFIGHTING.Planner.FindCreature"))}" aria-label="${esc(loc("FASTFIGHTING.Planner.FindCreature"))}">
      <ul>${actors.map(a => `<li data-name="${esc(a.name.toLocaleLowerCase(game.i18n.lang))}"><button type="button" data-uuid="${esc(a.uuid)}"><img src="${esc(a.img)}" alt=""> ${esc(a.name)}</button></li>`).join("")}</ul>
      <p class="hint">${esc(loc("FASTFIGHTING.Planner.FromCompendium"))}</p></div>`;
    let picked = null;
    await foundry.applications.api.DialogV2.wait({
      window: { title: loc("FASTFIGHTING.Planner.ChooseReinforcement") }, classes: ["fast-fighting", "ff-pick-dialog"], content, rejectClose: false,
      buttons: [{ action: "cancel", label: loc("Cancel"), default: true }],
      render: (ev, dialog) => {
        const root = dialog.element;
        const find = root.querySelector('input[type="search"]');
        find?.addEventListener("input", () => {
          const q = find.value.trim().toLocaleLowerCase(game.i18n.lang);
          for ( const li of root.querySelectorAll("li[data-name]") ) li.hidden = !!q && !li.dataset.name.includes(q);
        });
        root.addEventListener("click", e => {
          const b = e.target.closest("[data-uuid]");
          if ( !b ) return;
          picked = b.dataset.uuid;
          dialog.close();
        });
        find?.focus();
      }
    });
    if ( picked ) await this.#setReinforcement(key, await fromUuid(picked));
  }

  static async #onClearReinforcement(event, target) {
    const key = target.dataset.team;
    const rest = { ...(this.setup.options.reinforcements ?? {}) };
    delete rest[key];
    this.setup.options.reinforcements = rest;
    await saveSetup(this.setup, this.holder);
    this.stale = true;
    this.render();
  }

  /**
   * The system's section: what its helper asks of this encounter (adapter.plannerSettings), each field as pills or a
   * list, its answers kept with the plan (setup.system); and what they're set to, for when it's closed.
   */
  #systemSection(adapter, resolved, chains) {
    let section = null;
    try {
      const roster = this.roster.filter(e => this.setup.tokens[e.token.id]?.include !== false);
      section = adapter?.plannerSettings?.({ roster, setup: this.setup, resolved, chains }) ?? null;
    } catch ( err ) {
      console.error(`${MODULE_ID} | the system's settings for this encounter failed`, err);
    }
    if ( !section?.fields?.length ) return null;
    const choiceOf = f => (f.choices ?? []).find(c => String(c.value) === String(f.value))?.label ?? "";
    return {
      title: section.title ?? adapter.label,
      hint: section.hint ?? "",
      summary: section.fields.map(choiceOf).filter(Boolean).join(" · "),
      fields: section.fields.map(f => ({
        ...f,
        name: `system.${f.key}`,
        isPills: f.type === "pills",
        choices: (f.choices ?? []).map(c => ({ ...c, active: String(c.value) === String(f.value) }))
      }))
    };
  }

  /** A pill in the system's section. */
  static async #onSetSystem(event, target) {
    const { key, value } = target.dataset;
    if ( !key ) return;
    (this.setup.system ??= {})[key] = value;
    await saveSetup(this.setup, this.holder);
    this.stale = true;
    this.render();
  }

  static async #onPreparePlayers() {
    if ( await preparePlayers(canvas.scene, options => PlayerSurvey.open(options)) ) this.render();
  }

  static async #onOpenSurvey(event, target) {
    const user = game.users.get(target.dataset.userId);
    if ( !user ) return;
    await requestSurveys([user]);
    if ( !user.active ) ui.notifications.info("FASTFIGHTING.Survey.WillOpen", { format: { name: user.name } });
    this.render();
  }

  /**
   * Too few fights for the prediction's time (fewer than ROUGH_RUNS: the odds will be rough), with what makes a battle
   * slow to simulate: its creatures, their actions, the map's tiles and walls; or nothing. How many fights did, once it
   * has run (this computer's speed); before, about how many will, at the pace its last prediction ran on each thread
   * (runPace), on the threads it will run on (its background workers: fightThreads).
   * {text, size}.
   */
  #runsNote(resolved) {
    const taking = this.roster.filter(e => resolved[e.token.id] && this.setup.tokens[e.token.id]?.include !== false);
    const creatures = taking.length;
    const seconds = predictionSeconds(this.setup);
    const runs = this.results && !this.stale ? this.results.runs : expectedRuns(creatures, seconds, setting("runPace"), fightThreads());
    if ( runs >= ROUGH_RUNS ) return null;
    const actions = taking.reduce((n, e) => n + (e.spec.actions?.length ?? 0), 0);
    const { sceneRect, size } = canvas.dimensions ?? {};
    const tiles = size ? Math.round((sceneRect.width / size) * (sceneRect.height / size)) : 0;
    return {
      text: game.i18n.format("FASTFIGHTING.Planner.FewFights", { least: ROUGH_RUNS }),
      size: game.i18n.format("FASTFIGHTING.Planner.BattleSize", { creatures, actions, tiles, walls: canvas.scene?.walls?.size ?? 0 })
    };
  }

  /** Ask a friendly character's players about it: its survey, on that character. */
  static async #onSurveyCharacter(event, target) {
    const token = canvas.scene?.tokens.get(target.closest("[data-token-id]")?.dataset.tokenId);
    if ( !token ) return;
    const players = await requestCharacterSurvey(token);
    if ( !players?.length ) return;
    ui.notifications.info("FASTFIGHTING.Survey.AskedPlayers", { format: { names: listJoin(players.map(u => u.name)), name: token.name } });
    for ( const u of players.filter(p => !p.active) ) ui.notifications.info("FASTFIGHTING.Survey.WillOpen", { format: { name: u.name } });
    this.render();
  }

  /** A friendly character's survey for every GM logged in (that character alone), to answer for a player who's away. */
  static async #onSurveyCharacterGm(event, target) {
    const token = canvas.scene?.tokens.get(target.closest("[data-token-id]")?.dataset.tokenId);
    if ( !token ) return;
    await requestGmSurvey(token, canvas.scene, options => PlayerSurvey.open(options));
    ui.notifications.info("FASTFIGHTING.Survey.AskedGms", { format: { name: token.name } });
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender?.(context, options);
    // (The title bar as the plan now is: its encounter known only once the plan is read.)
    if ( this.window?.title && this.window.title.textContent !== this.title ) this.window.title.textContent = this.title;
    // (The Sample fight ready, or no longer: the tracker's Vantage button comes or goes with it.)
    const ready = this.readyForVantage();
    if ( ready !== !!this.offeredVantage ) {
      this.offeredVantage = ready;
      ui.combat?.render();
    }
    this.#filterRoster();
  }

  /* -------------------------------------------- */
  /*  Form & actions                              */
  /* -------------------------------------------- */

  static async #onSubmit(event, form, formData) {
    const target = event?.target;
    const name = target?.name;
    if ( !name ) return;
    let value = target.type === "checkbox" ? target.checked : (target.dataset.dtype === "Number" || target.type === "number") ? Number(target.value) : target.value;
    if ( target.type === "number" ) {
      // Typed values ignore the field's min/max, so enforce them here.
      const min = target.min === "" ? -Infinity : Number(target.min);
      const max = target.max === "" ? Infinity : Number(target.max);
      value = Number.isFinite(value) ? clamp(Math.round(value), min, max) : (Number.isFinite(min) ? min : 0);
      target.value = String(value);
    }
    if ( target.dataset.tactic ) {
      const actor = await fromUuid(target.dataset.actorUuid);
      const tacticValue = target.type === "checkbox" ? target.checked : target.value;
      target.closest(".ff-q")?.classList.toggle("is-auto", tacticValue === "auto");
      await setTactic(actor, target.dataset.tactic, tacticValue);
      this.stale = true;
      if ( target.type === "checkbox" ) this.render();
      return; // selects: no re-render, keep focus; the actor update hook syncs other views
    } else if ( name === "storyStyle" ) {
      this.storyStyle = value;
    } else if ( name === "storyOdds" ) {
      await game.settings.set(MODULE_ID, "storyOdds", !!value); // remembered for the next fight too
      return;
    } else {
      if ( name.startsWith("tokens.") ) tokenSetup(this.setup, name.split(".")[1]);
      // (A side picked: worked out once it has stood a moment, settleSides, in case it was a slip.)
      const side = /^tokens\.([^.]+)\.side$/.exec(name);
      if ( side ) this.#holdSide(side[1]);
      foundry.utils.setProperty(this.setup, name, value === "" ? null : value);
      if ( side ) return;
      if ( name === "options.seed" ) this.setup.options.seed = Number.isFinite(Number.parseInt(value, 10)) ? Number.parseInt(value, 10) >>> 0 : null;
      await saveSetup(this.setup, this.holder);
      this.stale = true;
    }
    this.render();
  }

  static async #onFudge(event, target) {
    const { path, step, dir } = target.dataset;
    if ( path.startsWith("tokens.") ) tokenSetup(this.setup, path.split(".")[1]);
    const current = foundry.utils.getProperty(this.setup, path) ?? 0;
    // (Its own ADHD: kept with the creature, as on its token's FastFighting tab, not with this encounter.)
    if ( path.endsWith(".fudge.adhd") ) {
      const actor = this.roster?.find(e => e.token.id === path.split(".")[1])?.token.actor;
      if ( actor ) await setAdhd(actor, Number(dir) === 0 ? 0 : (Number(actor.getFlag(MODULE_ID, "adhd")) || 0) + Number(dir) * Number(step || 10));
      this.stale = true;
      this.render();
      return;
    }
    const next = Number(dir) === 0 ? 0 : current + Number(dir) * Number(step || 1);
    foundry.utils.setProperty(this.setup, path, next);
    // (A trait raised past the trait budget: the highest of the others comes down.)
    if ( next > current ) this.#keepBudget(path);
    await saveSetup(this.setup, this.holder);
    this.stale = true;
    this.render();
  }

  /**
   * After a trait was raised (its slider's path): the sliders kept within the trait budget, the excess off the highest
   * of the other traits (engine/trait-budget.js), their nudges lowered.
   */
  #keepBudget(path) {
    const token = /^tokens\.([^.]+)\.fudge\.(\w+)$/.exec(path);
    const side = /^sides\.([^.]+)\.traitFudge\.(\w+)$/.exec(path);
    const raised = (token ?? side)?.[2];
    if ( !TRAITS.includes(raised) ) return;
    let bases;
    let fudges;
    if ( token ) {
      const e = this.roster?.find(x => x.token.id === token[1]);
      if ( !e ) return;
      bases = baseTraits(e.spec);
      fudges = tokenSetup(this.setup, token[1]).fudge;
    } else {
      const defaults = setting("sideDefaults");
      bases = defaults[side[1]] ?? defaults.hostile;
      fudges = (this.setup.sides[side[1]].traitFudge ??= {});
    }
    const kept = budgetFudges(bases, fudges, { raised });
    for ( const k of TRAITS ) if ( k !== raised && kept[k] !== (fudges[k] ?? 0) ) fudges[k] = kept[k];
  }

  /**
   * A role from a creature's role menu: that role in its group (taken from whoever had it; a boss and a leader are the
   * one place at the head), or out of command ("none").
   */
  static async #onSetRole(event, target) {
    const id = target.closest("[data-token-id]")?.dataset.tokenId;
    const role = target.dataset.role;
    if ( !id || !(ROLES.includes(role) || role === "none") ) return;
    const ts = tokenSetup(this.setup, id);
    const resolved = resolveAllegiances(this.roster, this.setup);
    const me = this.roster.find(e => e.token.id === id);
    const key = me ? commandGroup(me, this.setup, resolved) : null;
    // (The GM's pick now, not the automatic one.)
    delete ts.roleAuto;
    delete ts.roleWhy;
    if ( role !== "none" ) {
      const head = role === "boss" || role === "leader" ? ["boss", "leader"] : [role];
      for ( const e of this.roster ) {
        const other = this.setup.tokens[e.token.id];
        if ( e.token.id === id || !other || !head.includes(other.role) ) continue;
        if ( commandGroup(e, this.setup, resolved) === key ) clearRole(other);
      }
    }
    ts.role = role;
    // (The party's roles carry over to its next fights.)
    if ( key === SIDES.FRIENDLY ) await rememberPartyRole(me.token.actor?.id, ts.role);
    await saveSetup(this.setup, this.holder);
    this.stale = true;
    this.render();
  }

  /** Back to the automatic pick (a party member's role from earlier fights forgotten too). */
  static async #onAutoRole(event, target) {
    const id = target.closest("[data-token-id]")?.dataset.tokenId;
    if ( !id || !this.setup.tokens[id] ) return;
    clearRole(this.setup.tokens[id]);
    const me = this.roster.find(e => e.token.id === id);
    if ( me && commandGroup(me, this.setup, resolveAllegiances(this.roster, this.setup)) === SIDES.FRIENDLY ) await rememberPartyRole(me.token.actor?.id, null);
    await saveSetup(this.setup, this.holder);
    this.stale = true;
    this.render();
  }

  /** Another side for a creature (worked out once it has stood a moment, settleSides, in case it was a slip). */
  static #onSetSide(event, target) {
    const id = target.closest("[data-token-id]")?.dataset.tokenId;
    const side = target.dataset.side;
    if ( !id || !SIDE_ORDER.includes(side) ) return;
    const ts = tokenSetup(this.setup, id);
    if ( (ts.side ?? this.roster.find(e => e.token.id === id)?.baseSide) === side ) return;
    this.#holdSide(id);
    ts.side = side;
    this.stale = true;
    this.render();
  }

  /**
   * Another team for a creature: a hostile group or a neutral friend group (its side's), or, for a Secret token, any of
   * them (worked out once it has stood a moment, settleSides).
   */
  static #onSetTeam(event, target) {
    const id = target.closest("[data-token-id]")?.dataset.tokenId;
    const team = target.dataset.team;
    const me = this.roster?.find(e => e.token.id === id);
    if ( !me || !SECRET_TEAMS.includes(team) ) return;
    const chosen = chosenSide(me, this.setup);
    const n = Number(team.slice(-1));
    this.#holdSide(id);
    const ts = tokenSetup(this.setup, id);
    if ( chosen === SIDES.SECRET ) ts.team = team;
    else if ( (chosen === SIDES.HOSTILE && team.startsWith("hostile")) || (chosen === SIDES.NEUTRAL && team.startsWith("neutral")) ) ts.group = n;
    else return;
    this.stale = true;
    this.render();
  }

  /** Each token whose side or team was picked meanwhile: where it was before (its side, team and group). */
  #sidesBefore = null;
  #sideTimer = null;

  /** A side or team picked for a token: worked out SIDE_SETTLE_MS after the last pick (settleSides). */
  #holdSide(id) {
    this.#sidesBefore ??= new Map();
    if ( !this.#sidesBefore.has(id) ) {
      const ts = tokenSetup(this.setup, id);
      this.#sidesBefore.set(id, { side: ts.side, team: ts.team, key: this.#groupOf(id) });
    }
    clearTimeout(this.#sideTimer);
    this.#sideTimer = setTimeout(() => this.settleSides(), SIDE_SETTLE_MS);
  }

  /** The group a token commands in (or is commanded in) as the plan stands: its side's, or its team's. */
  #groupOf(id) {
    const me = this.roster?.find(e => e.token.id === id);
    return me ? commandGroup(me, this.setup, resolveAllegiances(this.roster, this.setup)) : null;
  }

  /**
   * The sides and teams picked meanwhile, worked out (at once, before a run or Go Live, or as the planner
   * closes). A token picked back where it was: nothing. Moved to another side, it starts in that side's first group (a
   * neutral, in the one proposed for it). In another group, its role there is given up, and remembered
   * (ts.formerRoles, by group); back in a group it had one in, it takes it again (whoever has it now gives it up).
   */
  async settleSides() {
    clearTimeout(this.#sideTimer);
    this.#sideTimer = null;
    const before = this.#sidesBefore;
    this.#sidesBefore = null;
    if ( !before?.size ) return;
    let moved = false;
    for ( const [id, was] of before ) {
      const ts = tokenSetup(this.setup, id);
      if ( (ts.side ?? null) !== (was.side ?? null) ) {
        ts.group = null;
        delete ts.team;
      }
      const key = this.#groupOf(id);
      if ( key === was.key ) continue;
      moved = true;
      if ( was.key && ts.role && ts.role !== "none" ) (ts.formerRoles ??= {})[was.key] = { role: ts.role, roleAuto: ts.roleAuto, roleWhy: ts.roleWhy };
      clearRole(ts);
      const back = key ? ts.formerRoles?.[key] : null;
      if ( !back ) continue;
      delete ts.formerRoles[key];
      if ( !Object.keys(ts.formerRoles).length ) delete ts.formerRoles;
      const resolved = resolveAllegiances(this.roster, this.setup);
      const head = back.role === "boss" || back.role === "leader" ? ["boss", "leader"] : [back.role];
      for ( const e of this.roster ?? [] ) {
        const other = this.setup.tokens[e.token.id];
        if ( e.token.id === id || !other || !head.includes(other.role) ) continue;
        if ( commandGroup(e, this.setup, resolved) === key ) clearRole(other);
      }
      Object.assign(ts, Object.fromEntries(Object.entries(back).filter(([, v]) => v !== undefined)));
    }
    await saveSetup(this.setup, this.holder);
    // (Picked back where it was: nothing to draw again.)
    if ( !moved ) return;
    this.stale = true;
    if ( this.rendered ) this.render();
  }

  /** The left pane's view: the teams, the encounter's options, or the players. */
  static #onLeftView(event, target) {
    if ( !LEFT_VIEWS.includes(target.dataset.view) ) return;
    this.leftView = target.dataset.view;
    this.render({ parts: ["left"] });
  }

  /** The teams of one side only (or all). */
  static #onSideFilter(event, target) {
    this.sideFilter = target.dataset.side ?? "all";
    this.render({ parts: ["left"] });
  }

  /** A team in Details. */
  static #onShowTeam(event, target) {
    const key = target.dataset.team;
    if ( !key ) return;
    this.detail = { kind: "team", key };
    this.resultTab = "details";
    this.render({ parts: ["left", "right"] });
  }

  /** A creature in Details (its team's card opened, to show where it is). */
  static #onShowCreature(event, target) {
    const id = target.dataset.tokenId ?? target.closest("[data-token-id]")?.dataset.tokenId;
    const e = this.roster?.find(x => x.token.id === id);
    if ( !e ) return;
    this.detail = { kind: "creature", id };
    this.expandedTeams.add(this.#teamKey(e));
    this.resultTab = "details";
    this.render({ parts: ["left", "right"] });
  }

  /** A team's card opened or closed (its creatures shown or not): at once, with nothing drawn again. */
  static #onToggleTeam(event, target) {
    const key = target.dataset.team;
    if ( !key ) return;
    const open = !this.expandedTeams.has(key);
    if ( open ) this.expandedTeams.add(key);
    else this.expandedTeams.delete(key);
    target.closest(".ff-card")?.classList.toggle("is-open", open);
    target.setAttribute("aria-expanded", String(open));
  }

  static #onResultTab(event, target) {
    this.resultTab = target.dataset.tab;
    this.render({ parts: ["right"] });
  }

  static #onPanToken(event, target) {
    const id = target.closest("[data-token-id]")?.dataset.tokenId;
    const token = canvas.tokens.get(id);
    if ( !token ) return;
    token.control({ releaseOthers: true });
    canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
  }

  static async #onRefresh() {
    this.freshRead = true;
    this.rereadRoster();
  }

  /**
   * Read the tokens again (someone joined or left the encounter, a token came or went), keeping the GM's plan as it
   * stands. While a run is going, as soon as it ends.
   */
  rereadRoster() {
    if ( this.running ) {
      this.rosterChanged = true;
      return;
    }
    this.rosterChanged = false;
    this.roster = null;
    this.approach = null;
    this.stale = true;
    this.render();
  }

  /** Clear the plan, after asking: every choice made here goes back to the defaults. */
  static async #onClearPlan() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("FASTFIGHTING.Planner.ClearTitle") },
      content: `<p>${loc("FASTFIGHTING.Planner.ClearConfirm")}</p>`
    });
    if ( !ok ) return;
    await clearSetup(this.holder ?? planHolder());
    this.resetForScene();
    this.render();
  }

  static async #onRun() {
    if ( this.running ) return;
    await this.settleSides();
    if ( !getAdapter() ) return ui.notifications.warn(loc("FASTFIGHTING.Planner.NoAdapter"));
    // The battle is read off the map: there has to be one on the canvas (there isn't right after a reload).
    if ( !canvas.ready || !canvas.scene ) return ui.notifications.warn(loc("FASTFIGHTING.Planner.NoScene"));
    this.running = true;
    this.progress = 0;
    this.counted = 0;
    this.swing = null;
    // (The last run's results, for the change since: none from a plan of another battle.)
    if ( this.results ) this.previousResults = this.results;
    this.sample = null;
    this.abort = new AbortController();
    await this.render();
    try {
      // The tokens again, so HP and positions are current (a character read again where it changed: sheet-watch.js).
      this.roster = await gatherRoster(this.setup);
      let lastPaint = 0;
      const { spec, results, approach, threads } = await simulate(this.roster, this.setup, {
        signal: this.abort.signal,
        onProgress: (p, done = 0) => {
          this.progress = p;
          // (The fights run so far, by tens: the true number once the time's up.)
          this.counted = Math.floor(done / 10) * 10;
          const bar = this.element?.querySelector(".ff-progress > span");
          const fill = this.element?.querySelector(".ff-btn-fill");
          const count = this.element?.querySelector(".ff-fight-count");
          const now = performance.now();
          if ( now - lastPaint > 50 ) {
            if ( bar ) bar.style.width = `${Math.round(p * 100)}%`;
            if ( fill ) fill.style.width = `${Math.round(p * 100)}%`;
            if ( count ) count.textContent = fightCount(this.counted);
            lastPaint = now;
          }
        }
      });
      this.spec = spec;
      this.results = results;
      this.approach = approach;
      this.stale = false;
      this.storyCache.clear();
      // The sample shown: the most typical fight. (Go Live plays a new one.)
      this.sample = typicalFight(spec, results);
        this.restoredAt = null;
      // (Troubleshooting: this run kept in the world, in place of the last; not waited for.)
      const stopped = this.abort.signal.aborted;
      savePlanRun(() => this.#runForTroubleshooting(spec, results, stopped));
      if ( this.abort.signal.aborted ) ui.notifications.info("FASTFIGHTING.Planner.Stopped", { format: { n: results.runs } });
      else {
        // (Kept, to show again if the planner opens on this same battle: a run cut short isn't. And this computer's
        // pace, for the next estimate.)
        rememberRun(this.holderUuid, spec, results);
        const pace = paceOf(spec.combatants.length, predictionSeconds(this.setup), results.runs, threads);
        if ( pace ) Promise.resolve().then(() => game.settings.set(MODULE_ID, "runPace", pace)).catch(err => console.warn(`${MODULE_ID} | keeping the pace`, err));
      }
    } catch ( err ) {
      console.error(`${MODULE_ID} | simulation failed`, err);
      ui.notifications.error("FASTFIGHTING.Planner.RunFailed", { format: { error: err.message } });
    } finally {
      this.abort = null;
      this.#doneRunning();
    }
  }

  /**
   * A run as it's kept for troubleshooting (live-journals.js savePlanRun): the scene and encounter, the plan with its
   * options, the battle, the results, the seed, and the sample shown (its seed and log).
   */
  #runForTroubleshooting(spec, results, stopped) {
    const combat = this.#holderCombat();
    return {
      scene: { id: canvas.scene?.id ?? null, name: canvas.scene?.name ?? null },
      encounter: combat ? { id: combat.id, n: encounterNumber(combat)?.n ?? 1 } : null,
      holder: this.holderUuid ?? null,
      setup: this.setup, spec, results, seed: results?.seed ?? null,
      sample: this.sample ? { seed: this.sample.seed, log: this.sample.result?.log ?? [] } : null,
      stopped
    };
  }

  /** A run (or a swing study) is over: take in anyone who joined or left meanwhile, and show it. */
  #doneRunning() {
    this.running = false;
    // (Another scene or encounter shown meanwhile: its plan now.)
    if ( !this.showsCurrent ) this.followScene();
    else if ( this.rosterChanged ) this.rereadRoster();
    else this.render();
  }

  static #onCancel() {
    this.abort?.abort();
  }

  static async #onSwing(event, target) {
    if ( !this.results || this.running ) return;
    this.running = true;
    this.progress = 0;
    await this.render();
    try {
      this.swing = await swingFactors(this.spec, this.results, {
        seconds: predictionSeconds(this.setup),
        onProgress: p => {
          const bar = this.element?.querySelector(".ff-progress > span");
          if ( bar ) bar.style.width = `${Math.round(p * 100)}%`;
        }
      });
    } catch ( err ) {
      reportError(err);
    } finally {
      this.#doneRunning();
    }
  }

  static async #onMakeItSo() {
    await this.#goLive({ begin: true });
  }

  /**
   * Can the Battle Vantage be opened on this plan (the tracker's Vantage button): its Sample fight ready, as Do it For
   * Real Now needs it, on the scene it was planned on, with no battle already going. With `combat`: and this plan is
   * that encounter's (by its id: a scene can hold several).
   */
  readyForVantage(combat = null) {
    return !!(this.results && this.spec && this.sample && !this.running && !this.abort) && canvas.scene?.id === this.sceneId
      && (!combat || combat.uuid === this.holderUuid) && !!getAdapter()?.supportsLive && !liveBattle();
  }

  /** This plan's encounter by the tracker's number for it, when the scene has more than one: {n, hint}, or null. */
  #encounterNo() {
    const no = encounterNumber(this.#holderCombat());
    this.shownEncounter = no ? `${no.n}/${no.count}` : null;
    return no;
  }

  /** The encounter this plan is for (none: the scene's own plan). */
  #holderCombat() {
    return (game.combats ?? []).find(c => c.uuid === this.holderUuid) ?? null;
  }

  /** Is this the plan of the scene on screen and its encounter (each encounter has a plan of its own)? */
  get showsCurrent() {
    return this.sceneId === (canvas.scene?.id ?? null) && this.holderUuid === (planHolder()?.uuid ?? null);
  }

  /**
   * Another scene on screen, or another encounter viewed (or one begun or ended): what the GM was typing kept, in the
   * plan it was typed for; the window blinks, and shows the new one's plan. (During a run, once it's done.)
   */
  async followScene() {
    if ( !this.rendered || this.running || this.following ) return;
    // (The same plan, but an encounter added to the scene or ended: its number drawn again.)
    if ( this.showsCurrent ) {
      const no = encounterNumber(this.#holderCombat());
      if ( (no ? `${no.n}/${no.count}` : null) !== (this.shownEncounter ?? null) ) this.render();
      return;
    }
    this.following = true;
    try {
      keepTyping(this);
      await this.settleSides();
      await blink(this);
      if ( !this.rendered || this.showsCurrent ) return;
      this.resetForScene();
      await this.render();
    } finally {
      this.following = false;
    }
  }

  /** The tracker's Vantage button: the battle prepared as Go Live would, waiting for the encounter to begin. */
  async openVantage() {
    await this.#goLive({ begin: false });
    if ( liveBattle() ) BattleVantage.open();
  }

  /**
   * The plan played for real (Go Live), or prepared for the Battle Vantage to begin (`begin` false: it waits
   * for Begin Encounter, the Vantage's or Foundry's own).
   */
  async #goLive({ begin, began = false }) {
    await this.settleSides();
    if ( !this.results || !this.spec ) return;
    // (The plan changed since it was run: the battle it would play is the old one. Run it again first.)
    if ( this.stale ) return ui.notifications.warn(loc("FASTFIGHTING.MakeItSo.RunAgain"));
    if ( canvas.scene?.id !== this.sceneId ) return ui.notifications.warn(loc("FASTFIGHTING.Planner.SceneChanged"));
    // (A battle on already, begun or waiting for Begin Encounter: its Battle Vantage, where it goes on.)
    if ( liveBattle() ) return BattleVantage.open();
    // The sample is only a sample: what's done for real is one more fight, that nobody has seen, so a 70% win is a
    // loss three times in ten, as it should be. The planner closes, so the GM can watch it play out with the table.
    let playing;
    try {
      const odds = setting("storyOdds") ? oddsText(this.results) : null;
      // The battle on the tracker, the players running their own characters (or, with the toggle off, FastFighting
      // playing everyone), a turn at a time. (A system helper too old for it: it says so, and nothing's done.)
      if ( !getAdapter()?.supportsLive ) return ui.notifications.warn(loc("FASTFIGHTING.MakeItSo.NeedsUpdate"));
      const players = this.setup.options.playersRunPCs === false ? []
        : this.spec.combatants.filter(c => isPlayerControlled(c, canvas.scene.tokens.get(c.tokenId ?? c.id)?.actor)).map(c => c.id);
      // (On this plan's own encounter, by its id.)
      const combatId = this.holder?.documentName === "Combat" ? this.holder.id : null;
      playing = startLiveBattle(this.spec, { style: this.storyStyle, odds, players, playersRun: this.setup.options.playersRunPCs !== false, begin, began, combatId, applyDamage: this.setup.options.applyPlayerDamage === true });
    } catch ( err ) {
      return reportError(err);
    }
    // (From now on the battle keeps the game paused or going, by whose turn it is: closing doesn't un-pause it.)
    this.pausedGame = false;
    this.close();
    try {
      await playing;
    } catch ( err ) {
      reportError(err);
    }
  }

}

function reportError(err) {
  console.error(`${MODULE_ID} |`, err);
  ui.notifications.error("FASTFIGHTING.Planner.ActionFailed", { format: { error: err.message } });
}

/** "Before it began, the odds stood at Party 97% · Goblins 3%": each side's chance of winning, then a stalemate's. */
function oddsText(results) {
  if ( !results ) return null;
  const parts = Object.values(results.sides ?? {}).filter(s => s.pWin > 0).sort((a, b) => b.pWin - a.pWin)
    .map(s => `${s.label} ${Math.round(s.pWin * 100)}%`);
  if ( (results.pStalemate ?? 0) >= 0.005 ) parts.push(`${loc("FASTFIGHTING.Sample.Outcome.stalemate")} ${Math.round(results.pStalemate * 100)}%`);
  return parts.length ? game.i18n.format("FASTFIGHTING.Story.Odds", { odds: parts.join(" · ") }) : null;
}
