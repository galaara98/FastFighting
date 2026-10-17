/**
 * The GM's Battle Planner: roster and per-side settings on the left, results on the right.
 */
import {
  MODULE_ID, SIDES, TRAITS, ALLEGIANCE, HEAL_AGGRO, DOWNED_MODELS, AFTERMATH, OPENING, NEUTRAL_PARTY, HOSTILE_GROUPS, GROUPS,
  traitBand, clamp, FUDGE_STEP, SIDE_SETTLE_MS
} from "../constants.js";
import { getAdapter } from "../api.js";
import { setting } from "../settings.js";
import { listJoin, listItems, localize, term, hasStat, brief, roundsText } from "../i18n.js";
import { setAdhd } from "./token-tactics.js";
import { getSetup, saveSetup, clearSetup, tokenSetup, planHolder, rememberPartyRole, sceneEncounter, encounterNumber } from "../foundry/persistence.js";
import {
  questionsContext, setTactic, togglePlaystyle, syncTacticsDom, isPlayerControlled, playersOnScene, tokensForUser, surveyStatus,
  requestSurveys, requestCharacterSurvey, requestGmSurvey, SURVEY_STATUS, playstyleSignature, tacticsFor, reactionsSignature, preparePlayers
} from "../foundry/tactics.js";
import { cachedCharacterSpec, showsReactions } from "../foundry/sheet-watch.js";
import {
  gatherRoster, chosenSide, groupOf, proposeNeutralGroups, resolveAllegiances, simulate, swingFactors, typicalFight,
  approachFor, commandChains, commandGroup, seedCommand, clearRole, ROLES, sideName, hostileGroupsIn, secretTeam, SECRET_TEAMS, LEANS, predictionSeconds,
  battleFor
} from "../foundry/battle.js";
import { buildStory, STORY_STYLES } from "../story/story.js";
import { loadStoryTables } from "../story/tables.js";
import { sceneDistance } from "../foundry/terrain.js";
import {
  planMakeItSo, undoMakeItSo, hasUndo, makingItSo, unfinishedPlayback, rewindPlayback
} from "../foundry/make-it-so.js";
import { ensureAutoConfig } from "../foundry/auto-config.js";
import { PlayerSurvey } from "./player-survey.js";
import { rememberRun, recallRun } from "../foundry/run-memory.js";
import { startLiveBattle, liveBattle, systemAppliesText } from "../foundry/live-battle.js";
import { BattleVantage } from "./battle-vantage.js";
import { blink, keepTyping } from "./blink.js";
import { expectedRuns, paceOf, ROUGH_RUNS } from "../engine/run-budget.js";
import { signedNumber } from "../engine/trait-parts.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const TEMPLATE = `modules/${MODULE_ID}/templates/planner.hbs`;
const FUDGE_PARTIAL = `modules/${MODULE_ID}/templates/partials/fudge.hbs`;
const TACTICS_PARTIAL = `modules/${MODULE_ID}/templates/partials/tactics.hbs`;

const SIDE_ORDER = [SIDES.FRIENDLY, SIDES.HOSTILE, SIDES.NEUTRAL, SIDES.SECRET];
const SIDE_ICONS = { friendly: "fa-shield-heart", hostile: "fa-skull", neutral: "fa-scale-balanced", secret: "fa-user-secret" };
const RESULT_TABS = ["overview", "combatants", "swing", "resources", "sample"];
const STAT_FUDGES = [["ac", 1], ["hp", 5], ["attack", 1], ["damage", 1]];

const loc = key => localize(key);
/** A stat's name: the game's word for armor class and hit points (its helper's, or FastFighting's generic one). */
const statName = stat => (stat === "ac" || stat === "hp" ? term(stat) : loc(`FASTFIGHTING.Stat.${stat}`));
const pct = (p, d = 0) => `${(p * 100).toFixed(d)}%`;
/** Status key for a creature's end state ("conceded" stood down after giving something up). */
const statusOf = final => (final.swayed === "conceded" ? "conceded" : final.status);

/** How far a creature must travel to reach its nearest foe, terrain included, to the grid ("40 ft", "12 m"). */
function approachDistance(approach) {
  return sceneDistance(approach.dist * approach.mult);
}

function simulatedDifficulty(results) {
  const win = results.sides.friendly?.pWin ?? 0;
  const death = results.pAnyPcDead;
  if ( win >= 0.99 && death < 0.005 ) return "trivial";
  if ( win >= 0.95 && death < 0.02 ) return "low";
  if ( win >= 0.85 && death < 0.06 ) return "moderate";
  if ( win >= 0.65 && death < 0.15 ) return "severe";
  return "extreme";
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
      sideTab: BattlePlanner.#onSideTab,
      resultTab: BattlePlanner.#onResultTab,
      toggleRow: BattlePlanner.#onToggleRow,
      panToken: BattlePlanner.#onPanToken,
      swing: BattlePlanner.#onSwing,
      makeItSo: BattlePlanner.#onMakeItSo,
      undo: BattlePlanner.#onUndo,
      rewindPlayback: BattlePlanner.#onRewindPlayback,
      preparePlayers: BattlePlanner.#onPreparePlayers,
      togglePlaystyle: BattlePlanner.#onTogglePlaystyle,
      setMotive: BattlePlanner.#onSetMotive,
      setSystem: BattlePlanner.#onSetSystem,
      setGroup: BattlePlanner.#onSetGroup,
      setTeam: BattlePlanner.#onSetTeam,
      setRole: BattlePlanner.#onSetRole,
      openSurvey: BattlePlanner.#onOpenSurvey,
      surveyCharacter: BattlePlanner.#onSurveyCharacter,
      surveyCharacterGm: BattlePlanner.#onSurveyCharacterGm,
      cancel: BattlePlanner.#onCancel
    }
  };

  static PARTS = {
    main: { template: TEMPLATE, templates: [FUDGE_PARTIAL, TACTICS_PARTIAL], scrollable: [".ff-roster-list", ".ff-results-body"] }
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
    this.sideTab = SIDES.FRIENDLY;
    this.resultTab = "overview";
    this.expanded = new Set();
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
    // (Told when a character's reactions may have changed: sheet-watch.js. Only an open row shows them.)
    this.unwatchReactions = showsReactions({
      shows: actor => this.rendered && !!this.roster?.some(e => e.token.actor?.uuid === actor.uuid && this.expanded.has(e.token.id)),
      recheck: actor => this.recheckReactions(actor)
    });
  }

  /**
   * A character's items or effects changed while its row is open: the planner reads the tokens again if the reactions it
   * shows aren't the same (as its Refresh button does).
   */
  async recheckReactions(actor) {
    for ( const e of this.roster ?? [] ) {
      if ( e.token.actor?.uuid !== actor.uuid || !this.expanded.has(e.token.id) ) continue;
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
    this.roster = await gatherRoster(this.setup);
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
    // (How many hostile groups fight, for their names: "Hostile" alone, or numbered.)
    this.hostileGroups = hostileGroupsIn(this.roster.filter(e => setup.tokens[e.token.id]?.include !== false).map(e => resolved[e.token.id]));
    const sideDefaults = setting("sideDefaults");

    // Chains of command, by group: who holds which role (the GM's pick, or the automatic one).
    const chains = setup.options.leadership !== false ? commandChains(this.roster.filter(e => resolved[e.token.id] && setup.tokens[e.token.id]?.include !== false), setup, resolved, adapter) : {};
    this.roles = new Map();
    for ( const [key, chain] of Object.entries(chains) ) for ( const c of chain ) this.roles.set(c.id, { ...c, key });

    const sides = SIDE_ORDER.map(id => {
      const s = setup.sides[id];
      const members = this.roster.filter(e => chosenSide(e, setup) === id);
      const defaults = sideDefaults[id] ?? sideDefaults.hostile;
      // Who heads this tab's groups (the first of them, for its leadership numbers).
      const heads = members.map(m => this.roles.get(m.token.id)).filter(r => r && (r.slot === "boss" || r.slot === "leader"));
      const head = heads[0] ?? null;
      const headName = id => this.roster.find(e => e.token.id === id)?.spec.name ?? "";
      const leader = head ? { id: head.id, bonus: Object.fromEntries(Object.entries(head.leadership).map(([k, v]) => [k, v.base])), reason: head.reason || loc("FASTFIGHTING.Planner.ChosenLeader") } : null;
      const lf = s.leadershipFudge ?? {};
      return {
        id,
        label: loc(`FASTFIGHTING.Side.${id}`),
        icon: SIDE_ICONS[id],
        active: this.sideTab === id,
        count: members.filter(m => setup.tokens[m.token.id]?.include !== false).length,
        // Neutrals only lean (they take no side until something crosses them). (A Secret token is on the team its row says.)
        lean: id === SIDES.NEUTRAL ? s.allegiance : null,
        leanChoices: id === SIDES.NEUTRAL ? Object.fromEntries(Object.values(ALLEGIANCE).map(k => [k, `FASTFIGHTING.Lean.${k}`])) : null,
        traits: TRAITS.map(k => this.#traitView(k, defaults[k] ?? 50, s.traitFudge?.[k] ?? 0, `sides.${id}.traitFudge.${k}`)),
        healAggro: s.healAggro,
        healChoices: Object.fromEntries(HEAL_AGGRO.map(k => [k, `FASTFIGHTING.HealAggro.${k}`])),
        morale: s.morale !== false,
        leaderChoices: {
          auto: heads.length ? game.i18n.format("FASTFIGHTING.Planner.AutoLeaders", { names: heads.map(h => `${headName(h.id)} (${loc(`FASTFIGHTING.Planner.Role.${h.slot}.Name`)})`).join(", ") }) : loc("FASTFIGHTING.Planner.AutoLeaderNone"),
          none: loc("FASTFIGHTING.Planner.NoLeader")
        },
        leaderId: s.leaderId === "none" ? "none" : "auto",
        leaderReason: brief(leader?.reason ?? ""),
        leadership: leader ? [
          this.#statView("leadBrave", leader.bonus.brave, lf.brave ?? 0, `sides.${id}.leadershipFudge.brave`, 5),
          this.#statView("leadTactical", leader.bonus.tacticalFloor, lf.tacticalFloor ?? 0, `sides.${id}.leadershipFudge.tacticalFloor`, 5),
          this.#statView("leadAttack", leader.bonus.attack, lf.attack ?? 0, `sides.${id}.leadershipFudge.attack`, 1),
          // (A system with no armor class has no armor class bonus.)
          ...(hasStat("ac") ? [this.#statView("leadAc", leader.bonus.ac, lf.ac ?? 0, `sides.${id}.leadershipFudge.ac`, 1)] : [])
        ] : [],
        members: members.map(e => this.#rowContext(e, resolved))
      };
    });

    const context = {
      // The game system's own settings for this encounter (its helper's: Ironsworn's track and its rank).
      systemSection: this.#systemSection(adapter, resolved, chains),
      adapterLabel: adapter?.label ?? loc("FASTFIGHTING.Planner.NoAdapter"),
      // (The system, or a module, applies players' damage itself: FastFighting's own toggle greyed out, saying so.)
      systemApplies: systemAppliesText(adapter),
      hasAdapter: !!adapter,
      // (Its helper can play a battle live, a turn at a time: the toggle for who runs the characters. One that can't
      // is too old to do it for real at all.)
      live: !!adapter?.supportsLive,
      options: setup.options,
      // (So many creatures that few fights fit the prediction's time.)
      runsNote: this.#runsNote(resolved),
      downedChoices: Object.fromEntries(Object.values(DOWNED_MODELS).map(k => [k, `FASTFIGHTING.Downed.${k}`])),
      aftermathChoices: Object.fromEntries(Object.values(AFTERMATH).map(k => [k, `FASTFIGHTING.Aftermath.${k}`])),
      openingChoices: Object.fromEntries(Object.values(OPENING).map(k => [k, `FASTFIGHTING.Opening.${k}`])),
      surpriseChoices: {
        none: "FASTFIGHTING.Surprise.none",
        tracker: "FASTFIGHTING.Surprise.tracker",
        stealth: "FASTFIGHTING.Surprise.stealth",
        friendly: "FASTFIGHTING.Surprise.friendly",
        hostile: "FASTFIGHTING.Surprise.hostile"
      },
      sides,
      activeSide: sides.find(s => s.active),
      running: this.running,
      progress: Math.round(this.progress * 100),
      // (The fights run: by tens while a run goes, then how many there were.)
      fightCount: this.abort && Number.isFinite(this.counted) ? fightCount(this.counted) : (this.results && !this.stale ? fightCount(this.results.runs) : null),
      stale: this.stale && !!this.results,
      // (Shown again from the last run: when it ran.)
      restored: this.restoredAt && this.results && !this.stale ? game.i18n.format("FASTFIGHTING.Results.Restored", { when: new Date(this.restoredAt).toLocaleString(game.i18n.lang) }) : null,
      resultTabs: RESULT_TABS.map(id => ({ id, label: loc(`FASTFIGHTING.Results.Tab.${id}`), active: this.resultTab === id })),
      resultTab: this.resultTab,
      hasResults: !!this.results,
      canUndo: hasUndo(),
      playback: this.#playbackContext(),
      players: this.#playersContext()
    };
    if ( this.results ) Object.assign(context, this.#resultsContext());
    return context;
  }

  #rowContext(e, resolved) {
    const setup = this.setup;
    const ts = setup.tokens[e.token.id] ?? tokenSetup({ tokens: {} }, e.token.id); // rendering never edits the setup
    const s = e.spec;
    const fudge = ts.fudge ?? {};
    const isPc = s.kind === "pc";
    const playerControlled = isPlayerControlled(s, e.token.actor);
    const { playstyles } = tacticsFor(e.token.actor, s);
    const shifts = playstyles.traits;
    const owners = game.users.filter(u => !u.isGM && e.token.actor?.testUserPermission(u, "OWNER"));
    const controllers = owners.map(u => u.name).join(", ");
    const approach = this.#nearestEnemyApproach(e, resolved);
    const resolvedSide = resolved[e.token.id];
    const chosen = chosenSide(e, setup);
    // (A hostile token in another group fights as that group: the pills say so.)
    const moved = resolvedSide && resolvedSide !== chosen && !(chosen === SIDES.HOSTILE && HOSTILE_GROUPS.includes(resolvedSide));
    const grouped = chosen === SIDES.HOSTILE || chosen === SIDES.NEUTRAL;
    const team = secretTeam(e, setup);
    const lean = setup.sides[SIDES.NEUTRAL]?.allegiance;
    const group = grouped ? groupOf(e, setup) : null;
    return {
      id: e.token.id,
      actorId: e.token.actor?.id,
      name: s.name,
      img: s.img,
      kind: s.kind,
      kindLabel: kindChip(s),
      bystander: s.inEncounter === false,
      level: s.level,
      hp: `${s.hp.value + (fudge.hp ?? 0)}/${s.hp.max + (fudge.hp ?? 0)}`,
      hpName: term("hp"),
      // Stamina, where the system has it: spent before hit points.
      stamina: s.hp.stamina ? `${s.hp.stamina.value}/${s.hp.stamina.max}` : null,
      staminaName: term("sp"),
      ac: s.defenses.ac + (fudge.ac ?? 0),
      showAc: hasStat("ac"),
      acName: term("ac"),
      hidden: s.hidden,
      // (A friendly character's survey: its players asked about it; or every GM, to answer for a player who's away.)
      survey: chosen === SIDES.FRIENDLY && !s.hazard ? {
        players: owners.length > 0,
        playersHint: brief(game.i18n.format("FASTFIGHTING.Survey.AskPlayers", { names: listJoin(owners.map(u => u.name)) }))
      } : null,
      include: ts.include !== false,
      side: ts.side ?? e.baseSide,
      sideChoices: Object.fromEntries(SIDE_ORDER.map(k => [k, `FASTFIGHTING.Side.${k}`])),
      // A Secret token's team, as pills: any hostile group or neutral team (an unused number: one of its own). It's always
      // on one: hostile group 1 until the GM picks another.
      teams: team ? ["hostile", "neutral"].map(kind => ({
        kind,
        label: loc(`FASTFIGHTING.Side.${kind}`),
        pills: GROUPS.map(n => ({ n, team: `${kind}${n}`, name: game.i18n.format(`FASTFIGHTING.Side.${kind}Group`, { n }), active: team.side === kind && team.group === n }))
      })) : null,
      groupKind: chosen === SIDES.NEUTRAL ? "neutral" : "hostile",
      // (Neutrals, and Secret tokens on a neutral team, lean as the Neutral tab says: nowhere, when it leaves them out.)
      resolvedLabel: resolvedSide === NEUTRAL_PARTY ? loc(`FASTFIGHTING.Planner.TakesNoSide.${LEANS.has(lean) ? lean : ALLEGIANCE.NEUTRAL}`)
        : moved ? game.i18n.format("FASTFIGHTING.Planner.FightsWith", { side: sideName(resolvedSide, this.hostileGroups) }) : (resolvedSide === null && ts.include !== false ? loc("FASTFIGHTING.Planner.SitsOut") : ""),
      // Which group (1 2 3): hostile groups fight each other too; a neutral's friend group was proposed when the planner opened.
      groups: grouped ? GROUPS.map(n => ({ n, active: n === group, auto: chosen === SIDES.NEUTRAL && ts.group == null })) : null,
      // Its role in its group's chain of command: boss (never in the party), leader, 1st or 2nd lieutenant.
      roles: setup.options.leadership !== false && setup.sides[chosen]?.leaderId !== "none" && resolvedSide && !s.hazard ? ROLES.filter(r => r !== "boss" || chosen !== SIDES.FRIENDLY).map(r => {
        const held = this.roles?.get(e.token.id);
        const active = held?.slot === r;
        return { key: r, short: loc(`FASTFIGHTING.Planner.Role.${r}.Short`), label: loc(`FASTFIGHTING.Planner.Role.${r}.Name`), active, auto: active && held.auto };
      }) : null,
      roleHint: game.i18n.format("FASTFIGHTING.Planner.RoleHint", { boss: setting("bossInfluence") }),
      groupHint: loc(chosen === SIDES.NEUTRAL ? "FASTFIGHTING.Planner.NeutralGroupHint" : "FASTFIGHTING.Planner.HostileGroupHint"),
      traits: [...TRAITS.map(k => this.#traitView(k, s.traits[k]?.base ?? 50, fudge[k] ?? 0, `tokens.${e.token.id}.fudge.${k}`, s.traitReasons?.[k], shifts[k] ?? 0)),
        this.#adhdView(e.token.actor?.getFlag(MODULE_ID, "adhd") ?? 0, `tokens.${e.token.id}.fudge.adhd`)],
      expanded: this.expanded.has(e.token.id),
      stats: STAT_FUDGES.filter(([k]) => hasStat(k)).map(([k, step]) => {
        const base = k === "ac" ? s.defenses.ac : k === "hp" ? s.hp.max : 0;
        return this.#statView(k, base, fudge[k] ?? 0, `tokens.${e.token.id}.fudge.${k}`, step);
      }),
      actions: s.actions.map(a => a.name).filter((n, i, arr) => arr.indexOf(n) === i).join(", "),
      speeds: Object.entries(s.speeds ?? {}).map(([k, v]) => `${loc(`FASTFIGHTING.Mode.${k}`)} ${v}`).join(", "),
      approach: approach ? game.i18n.format("FASTFIGHTING.Planner.Approach", {
        mode: loc(`FASTFIGHTING.Mode.${approach.mode ?? "walk"}`), name: approach.name,
        distance: Number.isFinite(approach.moves) ? approachDistance(approach) : "∞"
      }) +(approach.mult > 1.05 ? ` · ${loc(approach.throughWall ? "FASTFIGHTING.Planner.ThroughWall" : approach.blocked ? "FASTFIGHTING.Planner.AroundWalls" : "FASTFIGHTING.Planner.Terrain")} ×${approach.mult.toFixed(2)}` : "") + (approach.meleeOk ? "" : ` · ${loc("FASTFIGHTING.Planner.OutOfReach")}`) : "",
      environment: [...(s.environment?.types ?? []), s.environment?.difficult ? loc("FASTFIGHTING.Planner.DifficultHere") : null, s.environment?.hazardous ? loc("FASTFIGHTING.Planner.HazardHere") : null].filter(Boolean).join(", "),
      ignoreTerrain: !!ts.ignoreTerrain,
      diesAtZero: ts.diesAtZero ?? s.diesAtZero,
      isPc,
      playerControlled,
      controllers,
      tactics: this.expanded.has(e.token.id) ? questionsContext(s, e.token.actor, `gm-${e.token.id}`, { questions: true, targets: this.roster.map(r => ({ id: r.token.id, name: r.spec.name })) }) : null,
      playstyleNames: playstyles.ids.map(id => loc(`FASTFIGHTING.Playstyle.${id}.Name`)).join(", ")
    };
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
        const action = cs?.actions.find(a => a.resource === key);
        // The system names its own pools (focus points, spell slots, ki ...); otherwise the action that uses it.
        const label = adapter?.resourceLabel?.(key, cs) ?? action?.name ?? key;
        resources.push({ name: c.name, label, used: used.toFixed(2), start, width: start ? Math.min(100, (used / start) * 100).toFixed(1) : 0 });
      }
    }

    const sim = simulatedDifficulty(r);
    const swing = this.swing?.map(s => ({
      ...s, deltaLabel: `${s.delta >= 0 ? "+" : ""}${(s.delta * 100).toFixed(1)}%`, width: Math.min(50, Math.abs(s.delta) * 100).toFixed(1), positive: s.delta >= 0
    })) ?? null;

    const sample = this.sample ? this.#sampleContext() : null;

    return {
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
        rounds: r.rounds,
        histogram,
        simulated: loc(`FASTFIGHTING.Difficulty.${sim}`),
        simulatedClass: sim,
        // (A fight's difficulty means nothing for an argument.)
        argument: this.setup.options.opening === OPENING.ARGUMENT,
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
        conditionType: getAdapter()?.rules?.storyCondition?.bind(getAdapter().rules) ?? null
      }));
    }
    return this.storyCache.get(key);
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

  /**
   * A fight the old whole-fight playback left unfinished on this scene (a crash, a lost connection, before live
   * battles): it's rewound before anything else is done for real here.
   */
  #playbackContext() {
    return unfinishedPlayback(canvas.scene) ? { note: loc("FASTFIGHTING.Playback.Unfinished") } : null;
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

  /**
   * The system's section: what its helper asks of this encounter (adapter.plannerSettings), each field as pills or a
   * list, its answers kept with the plan (setup.system).
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
    return {
      title: section.title ?? adapter.label,
      hint: section.hint ?? "",
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

  /** What it offers, or expects: the kind (each shows fields of its own). */
  static async #onSetMotive(event, target) {
    const actor = await fromUuid(target.dataset.actorUuid);
    await setTactic(actor, `${target.dataset.motive}.kind`, target.dataset.kind);
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
   * So many creatures that few fights fit the prediction's time (the odds will be rough); or nothing. How many did, once
   * it has run (this computer's speed); before, about how many will, at the pace its last prediction ran (runPace).
   */
  #runsNote(resolved) {
    const creatures = this.roster.filter(e => resolved[e.token.id] && this.setup.tokens[e.token.id]?.include !== false).length;
    const seconds = predictionSeconds(this.setup);
    const runs = this.results && !this.stale ? this.results.runs : expectedRuns(creatures, seconds, setting("runPace"));
    return runs < ROUGH_RUNS ? game.i18n.format("FASTFIGHTING.Planner.ManyCreatures", { creatures, runs, seconds }) : null;
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
    // Keep the window at least 1000x600 while letting it grow.
    const el = this.element;
    el.style.minWidth = "1000px";
    el.style.minHeight = "600px";
    // A slider (the prediction time, the most rounds) shows its value as it moves (it's saved when let go).
    for ( const slider of el.querySelectorAll('.ff-slider input[type="range"]') ) {
      slider.addEventListener("input", () => {
        const shown = slider.parentElement.querySelector(".ff-slider-value");
        if ( shown ) shown.textContent = slider.value;
      });
    }
    // Right-click on a role pill: back to the automatic pick.
    for ( const pills of el.querySelectorAll(".ff-roles") ) {
      pills.addEventListener("contextmenu", async event => {
        event.preventDefault();
        const id = pills.closest("[data-token-id]")?.dataset.tokenId;
        if ( !id || !this.setup.tokens[id] ) return;
        clearRole(this.setup.tokens[id]);
        // (A party member's role from earlier fights is forgotten too.)
        const me = this.roster.find(e => e.token.id === id);
        if ( me && commandGroup(me, this.setup, resolveAllegiances(this.roster, this.setup)) === SIDES.FRIENDLY ) await rememberPartyRole(me.token.actor?.id, null);
        await saveSetup(this.setup, this.holder);
        this.stale = true;
        this.render();
      });
    }
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
    await saveSetup(this.setup, this.holder);
    this.stale = true;
    this.render();
  }

  /**
   * A role pill: give this token that role in its group (taking it from whoever had it; a boss and a leader are the one
   * place at the head), or, clicked again, keep it out of command. Right-click leaves it to the automatic pick.
   */
  static async #onSetRole(event, target) {
    const id = target.closest("[data-token-id]")?.dataset.tokenId;
    const role = target.dataset.role;
    if ( !id || !ROLES.includes(role) ) return;
    const ts = tokenSetup(this.setup, id);
    const resolved = resolveAllegiances(this.roster, this.setup);
    const me = this.roster.find(e => e.token.id === id);
    const key = me ? commandGroup(me, this.setup, resolved) : null;
    // (The GM's pick now, not the automatic one.)
    delete ts.roleAuto;
    delete ts.roleWhy;
    if ( target.classList.contains("active") ) ts.role = "none";
    else {
      const head = role === "boss" || role === "leader" ? ["boss", "leader"] : [role];
      for ( const e of this.roster ) {
        const other = this.setup.tokens[e.token.id];
        if ( e.token.id === id || !other || !head.includes(other.role) ) continue;
        if ( commandGroup(e, this.setup, resolved) === key ) clearRole(other);
      }
      ts.role = role;
    }
    // (The party's roles carry over to its next fights.)
    if ( key === SIDES.FRIENDLY ) await rememberPartyRole(me.token.actor?.id, ts.role);
    await saveSetup(this.setup, this.holder);
    this.stale = true;
    this.render();
  }

  static async #onSetGroup(event, target) {
    const id = target.closest("[data-token-id]")?.dataset.tokenId;
    const group = Number(target.dataset.group);
    if ( !id || !GROUPS.includes(group) ) return;
    tokenSetup(this.setup, id).group = group;
    await saveSetup(this.setup, this.holder);
    this.stale = true;
    this.render();
  }

  /** A Secret token onto another team (it's always on one). */
  static async #onSetTeam(event, target) {
    const id = target.closest("[data-token-id]")?.dataset.tokenId;
    const team = target.dataset.team;
    if ( !id || !SECRET_TEAMS.includes(team) || target.classList.contains("active") ) return;
    // (Worked out once it has stood a moment, settleSides, in case it was a slip.)
    this.#holdSide(id);
    tokenSetup(this.setup, id).team = team;
    for ( const b of target.parentElement?.querySelectorAll("[data-team]") ?? [] ) b.classList.toggle("active", b === target);
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
   * The sides and teams picked meanwhile, worked out (at once, before a run or Do it For Real Now, or as the planner
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

  static #onSideTab(event, target) {
    this.sideTab = target.dataset.side;
    this.render();
  }

  static #onResultTab(event, target) {
    this.resultTab = target.dataset.tab;
    this.render();
  }

  static #onToggleRow(event, target) {
    const id = target.closest("[data-token-id]")?.dataset.tokenId;
    if ( !id ) return;
    if ( this.expanded.has(id) ) this.expanded.delete(id);
    else this.expanded.add(id);
    this.render();
  }

  static #onPanToken(event, target) {
    const id = target.closest("[data-token-id]")?.dataset.tokenId;
    const token = canvas.tokens.get(id);
    if ( !token ) return;
    token.control({ releaseOthers: true });
    canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
  }

  static async #onRefresh() {
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
    this.sample = null;
    this.abort = new AbortController();
    await this.render();
    try {
      // Re-read tokens so HP and positions are current.
      this.roster = await gatherRoster(this.setup);
      let lastPaint = 0;
      const { spec, results, approach } = await simulate(this.roster, this.setup, {
        signal: this.abort.signal,
        onProgress: (p, done = 0) => {
          this.progress = p;
          // (The fights run so far, by tens: the true number once the time's up.)
          this.counted = Math.floor(done / 10) * 10;
          const bar = this.element?.querySelector(".ff-progress > span");
          const count = this.element?.querySelector(".ff-fight-count");
          const now = performance.now();
          if ( now - lastPaint > 50 ) {
            if ( bar ) bar.style.width = `${Math.round(p * 100)}%`;
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
      // The sample shown: the most typical fight. (Do it For Real Now plays a new one.)
      this.sample = typicalFight(spec, results);
        this.restoredAt = null;
      if ( this.abort.signal.aborted ) ui.notifications.info("FASTFIGHTING.Planner.Stopped", { format: { n: results.runs } });
      else {
        // (Kept, to show again if the planner opens on this same battle: a run cut short isn't. And this computer's
        // pace, for the next estimate.)
        rememberRun(this.holderUuid, spec, results);
        const pace = paceOf(spec.combatants.length, predictionSeconds(this.setup), results.runs);
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
      && (!combat || combat.uuid === this.holderUuid) && !unfinishedPlayback(canvas.scene) && !!getAdapter()?.supportsLive && !liveBattle();
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

  /** The tracker's Vantage button: the battle prepared as Do it For Real Now would, waiting for the encounter to begin. */
  async openVantage() {
    await this.#goLive({ begin: false });
    if ( liveBattle() ) BattleVantage.open();
  }

  /**
   * The plan played for real (Do it For Real Now), or prepared for the Battle Vantage to begin (`begin` false: it waits
   * for Begin Encounter, the Vantage's or Foundry's own).
   */
  async #goLive({ begin, began = false }) {
    await this.settleSides();
    if ( !this.results || !this.spec ) return;
    if ( canvas.scene?.id !== this.sceneId ) return ui.notifications.warn(loc("FASTFIGHTING.Planner.SceneChanged"));
    if ( unfinishedPlayback(canvas.scene) || liveBattle() ) return;
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
      playing = startLiveBattle(this.spec, { style: this.storyStyle, odds, players, begin, began, combatId, applyDamage: this.setup.options.applyPlayerDamage === true });
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

  /** Rewind a fight cut short: everything it did so far, chat cards included. */
  static async #onRewindPlayback() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("FASTFIGHTING.MakeItSo.UndoTitle") },
      content: `<p>${loc("FASTFIGHTING.Playback.RewindConfirm")}</p>`
    });
    if ( !ok ) return;
    try {
      await rewindPlayback(canvas.scene);
      ui.notifications.info(loc("FASTFIGHTING.MakeItSo.Undone"));
    } catch ( err ) {
      reportError(err);
    }
    this.roster = null;
    this.render();
  }

  static async #onUndo() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("FASTFIGHTING.MakeItSo.UndoTitle") },
      content: `<p>${loc("FASTFIGHTING.MakeItSo.UndoConfirm")}</p>`
    });
    if ( !ok ) return;
    try {
      await undoMakeItSo();
      ui.notifications.info(loc("FASTFIGHTING.MakeItSo.Undone"));
    } catch ( err ) {
      reportError(err);
    }
    this.roster = null;
    this.render();
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
