/**
 * The GM's Battle Planner: roster and per-side settings on the left, results on the right.
 */
import {
  MODULE_ID, SIDES, TRAITS, ALLEGIANCE, HEAL_AGGRO, DOWNED_MODELS, STATUS, AFTERMATH, OPENING, NEUTRAL_PARTY, HOSTILE_GROUPS, GROUPS,
  traitBand, clamp, FUDGE_STEP
} from "../constants.js";
import { getAdapter } from "../api.js";
import { setting } from "../settings.js";
import { listJoin } from "../i18n.js";
import { getSetup, saveSetup, clearSetup, tokenSetup, planHolder } from "../foundry/persistence.js";
import {
  questionsContext, setTactic, togglePlaystyle, syncTacticsDom, isPlayerControlled, playersOnScene, tokensForUser, surveyStatus,
  requestSurveys, SURVEY_STATUS, playstyleSignature, tacticsFor
} from "../foundry/tactics.js";
import {
  gatherRoster, chosenSide, groupOf, proposeNeutralGroups, resolveAllegiances, simulate, swingFactors, replay, findSample, drawFight,
  approachFor, commandChains, commandGroup, ROLES, sideName, hostileGroupsIn, secretTeam, SECRET_TEAMS, LEANS
} from "../foundry/battle.js";
import { buildStory, STORY_STYLES } from "../story/story.js";
import { loadStoryTables } from "../story/tables.js";
import { sceneDistance } from "../foundry/terrain.js";
import { planMakeItSo, confirmMakeItSo, executeMakeItSo, undoMakeItSo, hasUndo, makingItSo } from "../foundry/make-it-so.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const TEMPLATE = `modules/${MODULE_ID}/templates/planner.hbs`;
const FUDGE_PARTIAL = `modules/${MODULE_ID}/templates/partials/fudge.hbs`;
const TACTICS_PARTIAL = `modules/${MODULE_ID}/templates/partials/tactics.hbs`;

const SIDE_ORDER = [SIDES.FRIENDLY, SIDES.HOSTILE, SIDES.NEUTRAL, SIDES.SECRET];
const SIDE_ICONS = { friendly: "fa-shield-heart", hostile: "fa-skull", neutral: "fa-scale-balanced", secret: "fa-user-secret" };
const RESULT_TABS = ["overview", "combatants", "swing", "resources", "sample"];
const SAMPLE_FILTERS = ["any", "typical", "partyWins", "partyLoses", "pcDies", "closeCall"];
const STAT_FUDGES = [["ac", 1], ["hp", 5], ["attack", 1], ["damage", 1]];

const loc = key => game.i18n.localize(key);
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
      rollSample: BattlePlanner.#onRollSample,
      makeItSo: BattlePlanner.#onMakeItSo,
      undo: BattlePlanner.#onUndo,
      preparePlayers: BattlePlanner.#onPreparePlayers,
      togglePlaystyle: BattlePlanner.#onTogglePlaystyle,
      setGroup: BattlePlanner.#onSetGroup,
      setTeam: BattlePlanner.#onSetTeam,
      setRole: BattlePlanner.#onSetRole,
      openSurvey: BattlePlanner.#onOpenSurvey,
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
    this.drawn = null;
    this.sampleFilter = "any";
    this.running = false;
    this.progress = 0;
    this.stale = false;
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
  }

  _onClose(options) {
    super._onClose(options);
    if ( this.pauseHook ) Hooks.off("pauseGame", this.pauseHook);
    this.pauseHook = null;
    const resume = this.pausedGame;
    this.pausedGame = false;
    if ( !resume ) return;
    // (Closed while Make it So is still writing the fight onto the map: the game goes on once it's done.)
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
    this.drawn = null;
    this.stale = false;
    this.storyCache.clear();
  }

  get title() {
    return `${loc("FASTFIGHTING.Planner.Title")}: ${canvas.scene?.name ?? ""}`;
  }

  /* -------------------------------------------- */
  /*  Data                                        */
  /* -------------------------------------------- */

  async #loadRoster() {
    // The plan of the encounter it's tied to (or the scene's, with none): read and saved there.
    this.holder = planHolder();
    this.holderUuid = this.holder?.uuid ?? null;
    this.setup = getSetup(this.holder);
    this.roster = await gatherRoster(this.setup);
    for ( const e of this.roster ) tokenSetup(this.setup, e.token.id);
    proposeNeutralGroups(this.roster, this.setup); // friend groups for the neutrals, as the map stands now
    try {
      this.approach = approachFor(this.roster, this.setup);
    } catch ( err ) {
      console.warn(`${MODULE_ID} | approach preview failed`, err);
      this.approach = null;
    }
  }

  /** A fudgeable trait. `shift` is the playstyle adjustment, shown but not editable here. */
  #traitView(trait, base, fudge, path, reason, shift = 0) {
    const value = clamp(base + fudge + shift, 0, 100);
    const signed = n => (n > 0 ? `+${n}` : `${n}`);
    return {
      trait, label: loc(`FASTFIGHTING.Trait.${trait}`), value, base, fudge, path, step: FUDGE_STEP.trait,
      band: loc(`FASTFIGHTING.Band.${traitBand(trait, value)}`),
      fudgeLabel: fudge ? signed(fudge) : "",
      tooltip: `${loc(`FASTFIGHTING.Trait.${trait}`)}: ${base}${fudge ? ` ${signed(fudge)} ${loc("FASTFIGHTING.Planner.Fudge")}` : ""}${shift ? ` ${signed(shift)} ${loc("FASTFIGHTING.Playstyle.Label")}` : ""}${reason ? ` (${reason})` : ""}`
    };
  }

  #statView(stat, base, fudge, path, step) {
    return {
      trait: stat, label: loc(`FASTFIGHTING.Stat.${stat}`), value: base + fudge, base, fudge, path, step,
      fudgeLabel: fudge ? (fudge > 0 ? `+${fudge}` : `${fudge}`) : "",
      tooltip: `${loc(`FASTFIGHTING.Stat.${stat}`)}: ${base}${fudge ? ` ${fudge > 0 ? "+" : ""}${fudge}` : ""}`
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
        traits: TRAITS.map(k => this.#traitView(k, defaults[k] ?? 50, s.traitFudge?.[k] ?? 0, `sides.${id}.traitFudge.${k}`, loc("FASTFIGHTING.Planner.SideDefault"))),
        healAggro: s.healAggro,
        healChoices: Object.fromEntries(HEAL_AGGRO.map(k => [k, `FASTFIGHTING.HealAggro.${k}`])),
        morale: s.morale !== false,
        leaderChoices: {
          auto: heads.length ? game.i18n.format("FASTFIGHTING.Planner.AutoLeaders", { names: heads.map(h => `${headName(h.id)} (${loc(`FASTFIGHTING.Planner.Role.${h.slot}.Name`)})`).join(", ") }) : loc("FASTFIGHTING.Planner.AutoLeaderNone"),
          none: loc("FASTFIGHTING.Planner.NoLeader")
        },
        leaderId: s.leaderId === "none" ? "none" : "auto",
        leaderReason: leader?.reason ?? "",
        leadership: leader ? [
          this.#statView("leadBrave", leader.bonus.brave, lf.brave ?? 0, `sides.${id}.leadershipFudge.brave`, 5),
          this.#statView("leadTactical", leader.bonus.tacticalFloor, lf.tacticalFloor ?? 0, `sides.${id}.leadershipFudge.tacticalFloor`, 5),
          this.#statView("leadAttack", leader.bonus.attack, lf.attack ?? 0, `sides.${id}.leadershipFudge.attack`, 1),
          this.#statView("leadAc", leader.bonus.ac, lf.ac ?? 0, `sides.${id}.leadershipFudge.ac`, 1)
        ] : [],
        members: members.map(e => this.#rowContext(e, resolved))
      };
    });

    const context = {
      sceneName: canvas.scene?.name,
      adapterLabel: adapter?.label ?? loc("FASTFIGHTING.Planner.NoAdapter"),
      hasAdapter: !!adapter,
      options: setup.options,
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
      stale: this.stale && !!this.results,
      resultTabs: RESULT_TABS.map(id => ({ id, label: loc(`FASTFIGHTING.Results.Tab.${id}`), active: this.resultTab === id })),
      resultTab: this.resultTab,
      hasResults: !!this.results,
      canUndo: hasUndo(),
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
    const controllers = game.users.filter(u => !u.isGM && e.token.actor?.testUserPermission(u, "OWNER")).map(u => u.name).join(", ");
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
      kindLabel: loc(`FASTFIGHTING.Kind.${s.kind}`),
      bystander: s.inEncounter === false,
      level: s.level,
      hp: `${s.hp.value + (fudge.hp ?? 0)}/${s.hp.max + (fudge.hp ?? 0)}`,
      ac: s.defenses.ac + (fudge.ac ?? 0),
      hidden: s.hidden,
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
      roles: setup.options.leadership !== false && setup.sides[chosen]?.leaderId !== "none" && resolvedSide ? ROLES.filter(r => r !== "boss" || chosen !== SIDES.FRIENDLY).map(r => {
        const held = this.roles?.get(e.token.id);
        const active = held?.slot === r;
        return { key: r, short: loc(`FASTFIGHTING.Planner.Role.${r}.Short`), label: loc(`FASTFIGHTING.Planner.Role.${r}.Name`), active, auto: active && held.auto };
      }) : null,
      roleHint: game.i18n.format("FASTFIGHTING.Planner.RoleHint", { boss: setting("bossInfluence") }),
      groupHint: loc(chosen === SIDES.NEUTRAL ? "FASTFIGHTING.Planner.NeutralGroupHint" : "FASTFIGHTING.Planner.HostileGroupHint"),
      traits: TRAITS.map(k => this.#traitView(k, s.traits[k]?.base ?? 50, fudge[k] ?? 0, `tokens.${e.token.id}.fudge.${k}`, s.traitReasons?.[k], shifts[k] ?? 0)),
      expanded: this.expanded.has(e.token.id),
      stats: STAT_FUDGES.map(([k, step]) => {
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
      tactics: this.expanded.has(e.token.id) ? questionsContext(s, e.token.actor, `gm-${e.token.id}`, { questions: playerControlled, targets: this.roster.map(r => ({ id: r.token.id, name: r.spec.name })) }) : null,
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
        rounds: r.rounds,
        histogram,
        simulated: loc(`FASTFIGHTING.Difficulty.${sim}`),
        simulatedClass: sim,
        foes, atRisk, combatants, resources, swing, sample
      },
      sampleFilters: Object.fromEntries(SAMPLE_FILTERS.map(k => [k, `FASTFIGHTING.Sample.${k}`])),
      sampleFilter: this.sampleFilter,
      storyStyles: Object.fromEntries(STORY_STYLES.map(k => [k, `FASTFIGHTING.Story.Style.${k}`])),
      storyStyle: this.storyStyle,
      storyOdds: setting("storyOdds")
    };
  }

  /** The story of the current sample fight in the chosen style (the same text Make it So posts). */
  storyFor(style = this.storyStyle) {
    if ( !this.sample || !this.storyTables ) return null;
    if ( this.storyCache.tables !== this.storyTables ) {
      this.storyCache.clear();
      this.storyCache.tables = this.storyTables;
    }
    const key = `${this.sample.seed}|${style}`;
    if ( !this.storyCache.has(key) ) {
      this.storyCache.set(key, buildStory(this.sample.result, this.spec, style, {
        tables: this.storyTables,
        seed: this.sample.seed,
        title: game.i18n.format("FASTFIGHTING.Story.Title", { scene: canvas.scene?.name ?? "" }),
        damageType: getAdapter()?.rules?.storyDamageType?.bind(getAdapter().rules) ?? null
      }));
    }
    return this.storyCache.get(key);
  }

  #sampleContext() {
    const { seed, result } = this.sample;
    const rows = planMakeItSo(this.spec, result);
    return {
      seed,
      how: this.sample.how ? loc(`FASTFIGHTING.Sample.How.${this.sample.how}`) : "",
      preview: this.sample !== this.drawn,
      outcome: result.outcome === "victory" ? listJoin(result.winners.map(w => this.spec?.sides?.[w]?.label ?? sideName(w, this.hostileGroups))) : loc(`FASTFIGHTING.Sample.Outcome.${result.outcome}`),
      story: this.storyFor()?.html ?? "",
      totalRounds: result.rounds,
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
        tokens: tokensForUser(scene, u).map(t => t.name).join(", "),
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
    if ( before !== sig && !typing && !this.running ) this.render();
  }

  static async #onTogglePlaystyle(event, target) {
    const actor = await fromUuid(target.dataset.actorUuid);
    const ok = await togglePlaystyle(actor, target.dataset.playstyle);
    if ( !ok ) ui.notifications.warn(loc("FASTFIGHTING.Playstyle.Max"));
    this.stale = true;
    this.render();
  }

  static async #onPreparePlayers() {
    const players = playersOnScene(canvas.scene);
    if ( !players.length ) return ui.notifications.warn(loc("FASTFIGHTING.Survey.NoPlayers"));
    await requestSurveys(players);
    ui.notifications.info(game.i18n.format("FASTFIGHTING.Survey.Sent", { n: players.length }));
    this.render();
  }

  static async #onOpenSurvey(event, target) {
    const user = game.users.get(target.dataset.userId);
    if ( !user ) return;
    await requestSurveys([user]);
    if ( !user.active ) ui.notifications.info(game.i18n.format("FASTFIGHTING.Survey.WillOpen", { name: user.name }));
    this.render();
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender?.(context, options);
    // Keep the window at least 1000x600 while letting it grow.
    const el = this.element;
    el.style.minWidth = "1000px";
    el.style.minHeight = "600px";
    // Right-click on a role pill: back to the automatic pick.
    for ( const pills of el.querySelectorAll(".ff-roles") ) {
      pills.addEventListener("contextmenu", async event => {
        event.preventDefault();
        const id = pills.closest("[data-token-id]")?.dataset.tokenId;
        if ( !id || !this.setup.tokens[id] ) return;
        delete this.setup.tokens[id].role;
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
      return; // selects and notes: no re-render, keep focus; the actor update hook syncs other views
    } else if ( name === "storyStyle" ) {
      this.storyStyle = value;
    } else if ( name === "storyOdds" ) {
      await game.settings.set(MODULE_ID, "storyOdds", !!value); // remembered for the next fight too
      return;
    } else if ( name === "sampleFilter" ) {
      this.sampleFilter = value;
      return;
    } else {
      if ( name.startsWith("tokens.") ) tokenSetup(this.setup, name.split(".")[1]);
      foundry.utils.setProperty(this.setup, name, value === "" ? null : value);
      // A token moved to another side starts in that side's first group (a neutral, in the one proposed for it).
      if ( /^tokens\.[^.]+\.side$/.test(name) ) {
        this.setup.tokens[name.split(".")[1]].group = null;
        delete this.setup.tokens[name.split(".")[1]].team;
        delete this.setup.tokens[name.split(".")[1]].role; // (its role was in the group it left)
      }
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
    if ( target.classList.contains("active") ) ts.role = "none";
    else {
      const resolved = resolveAllegiances(this.roster, this.setup);
      const me = this.roster.find(e => e.token.id === id);
      const key = me ? commandGroup(me, this.setup, resolved) : null;
      const head = role === "boss" || role === "leader" ? ["boss", "leader"] : [role];
      for ( const e of this.roster ) {
        const other = this.setup.tokens[e.token.id];
        if ( e.token.id === id || !other || !head.includes(other.role) ) continue;
        if ( commandGroup(e, this.setup, resolved) === key ) delete other.role;
      }
      ts.role = role;
    }
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
    const ts = tokenSetup(this.setup, id);
    ts.team = team;
    delete ts.role; // (its role was in the team it left)
    await saveSetup(this.setup, this.holder);
    this.stale = true;
    this.render();
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
    if ( !getAdapter() ) return ui.notifications.warn(loc("FASTFIGHTING.Planner.NoAdapter"));
    // The battle is read off the map: there has to be one on the canvas (there isn't right after a reload).
    if ( !canvas.ready || !canvas.scene ) return ui.notifications.warn(loc("FASTFIGHTING.Planner.NoScene"));
    this.running = true;
    this.progress = 0;
    this.swing = null;
    this.sample = null;
    this.drawn = null;
    this.abort = new AbortController();
    await this.render();
    try {
      // Re-read tokens so HP and positions are current.
      this.roster = await gatherRoster(this.setup);
      let lastPaint = 0;
      const { spec, results, approach } = await simulate(this.roster, this.setup, {
        signal: this.abort.signal,
        onProgress: p => {
          this.progress = p;
          const bar = this.element?.querySelector(".ff-progress > span");
          const now = performance.now();
          if ( bar && now - lastPaint > 50 ) { bar.style.width = `${Math.round(p * 100)}%`; lastPaint = now; }
        }
      });
      this.spec = spec;
      this.results = results;
      this.approach = approach;
      this.stale = false;
      this.storyCache.clear();
      // The fight Make it So commits is drawn at random from the simulated fights, so a 70% win is a loss
      // three times in ten, as it should be.
      this.sample = drawFight(spec, results);
      this.drawn = this.sample; // the only fight Make it So will commit (until the next run)
      if ( this.abort.signal.aborted ) ui.notifications.info(game.i18n.format("FASTFIGHTING.Planner.Stopped", { n: results.runs }));
    } catch ( err ) {
      console.error(`${MODULE_ID} | simulation failed`, err);
      ui.notifications.error(game.i18n.format("FASTFIGHTING.Planner.RunFailed", { error: err.message }));
    } finally {
      this.abort = null;
      this.#doneRunning();
    }
  }

  /** A run (or a swing study) is over: take in anyone who joined or left meanwhile, and show it. */
  #doneRunning() {
    this.running = false;
    if ( this.rosterChanged ) this.rereadRoster();
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

  static async #onRollSample() {
    if ( !this.spec || !this.results ) return;
    try {
      const rules = getAdapter().rules;
      const pcIds = new Set(this.spec.combatants.filter(c => c.kind === "pc").map(c => c.id));
      const predicates = {
        partyWins: r => r.outcome === "victory" && r.winners.includes(SIDES.FRIENDLY),
        partyLoses: r => !(r.outcome === "victory" && r.winners.includes(SIDES.FRIENDLY)),
        pcDies: r => Object.entries(r.units).some(([id, u]) => pcIds.has(id) && u.status === STATUS.DEAD),
        closeCall: r => r.outcome === "victory" && r.winners.includes(SIDES.FRIENDLY)
          && Object.entries(r.units).filter(([id]) => pcIds.has(id)).some(([, u]) => u.wasDowned)
      };
      let found;
      if ( this.sampleFilter === "any" ) {
        found = drawFight(this.spec, this.results);
        if ( found ) found.how = "another"; // another fair draw: to look at, not to commit
      }
      else if ( this.sampleFilter === "typical" ) {
        const seed = this.results.representativeSeed;
        found = seed === null ? null : { seed, result: replay(this.spec, rules, seed), how: "typical" };
      } else {
        found = findSample(this.spec, rules, predicates[this.sampleFilter], { start: Math.floor(Math.random() * 1e9), tries: 600 });
        if ( found ) found.how = "chosen";
      }
      if ( !found ) ui.notifications.info(loc("FASTFIGHTING.Sample.NotFound"));
      else this.sample = found;
    } catch ( err ) {
      reportError(err);
    }
    this.render();
  }

  static async #onMakeItSo() {
    if ( !this.drawn || !this.spec ) return;
    if ( canvas.scene?.id !== this.sceneId ) return ui.notifications.warn(loc("FASTFIGHTING.Planner.SceneChanged"));
    // Only the fight the simulation drew can be committed: a preview (another draw, the most typical fight, one a
    // filter chose) is put aside, and the GM confirms the real one.
    if ( this.sample !== this.drawn ) {
      this.sample = this.drawn;
      await this.render();
      ui.notifications.info(loc("FASTFIGHTING.MakeItSo.BackToDrawn"));
    }
    try {
      const rows = planMakeItSo(this.spec, this.sample.result);
      if ( !rows.some(r => r.changed) && !Object.keys(this.sample.result.doors ?? {}).length ) return ui.notifications.info(loc("FASTFIGHTING.MakeItSo.Nothing"));
      const ok = await confirmMakeItSo(rows, this.sample.result);
      if ( !ok ) return;
      // The Statistician's account is for the GM (who can show it to the table); everyone else gets the plain one.
      const stories = this.storyStyle === "statistician"
        ? { everyone: this.storyFor("standard"), gm: this.storyFor("statistician") }
        : { everyone: this.storyFor() };
      await executeMakeItSo(rows, this.sample.result, { stories, odds: setting("storyOdds") ? oddsText(this.results) : null });
      ui.notifications.info(loc("FASTFIGHTING.MakeItSo.Done"));
    } catch ( err ) {
      reportError(err);
    }
    this.roster = null;
    this.results = null;
    this.sample = null;
    this.drawn = null;
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
  ui.notifications.error(game.i18n.format("FASTFIGHTING.Planner.ActionFailed", { error: err.message }));
}

/** "Before it began, the odds stood at Party 97% · Goblins 3%": each side's chance of winning, then a stalemate's. */
function oddsText(results) {
  if ( !results ) return null;
  const parts = Object.values(results.sides ?? {}).filter(s => s.pWin > 0).sort((a, b) => b.pWin - a.pWin)
    .map(s => `${s.label} ${Math.round(s.pWin * 100)}%`);
  if ( (results.pStalemate ?? 0) >= 0.005 ) parts.push(`${loc("FASTFIGHTING.Sample.Outcome.stalemate")} ${Math.round(results.pStalemate * 100)}%`);
  return parts.length ? game.i18n.format("FASTFIGHTING.Story.Odds", { odds: parts.join(" · ") }) : null;
}
