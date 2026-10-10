/**
 * The GM's Battle Planner: roster and per-side settings on the left, results on the right.
 */
import {
  MODULE_ID, SIDES, TRAITS, ALLEGIANCE, HEAL_AGGRO, DOWNED_MODELS, STATUS, AFTERMATH, OPENING,
  traitBand, fudged, clamp, FUDGE_STEP
} from "../constants.js";
import { getAdapter } from "../api.js";
import { setting } from "../settings.js";
import { getSetup, saveSetup, tokenSetup } from "../foundry/persistence.js";
import {
  questionsContext, setTactic, togglePlaystyle, syncTacticsDom, isPlayerControlled, playersOnScene, tokensForUser, surveyStatus,
  requestSurveys, SURVEY_STATUS, playstyleSignature, tacticsFor
} from "../foundry/tactics.js";
import { gatherRoster, chosenSide, resolveAllegiances, simulate, swingFactors, replay, findSample, drawFight, withPlaystyleLeaders, approachFor } from "../foundry/battle.js";
import { buildStory, STORY_STYLES } from "../story/story.js";
import { loadStoryTables } from "../story/tables.js";
import { planMakeItSo, confirmMakeItSo, executeMakeItSo, undoMakeItSo, hasUndo } from "../foundry/make-it-so.js";

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
      openSurvey: BattlePlanner.#onOpenSurvey,
      cancel: BattlePlanner.#onCancel
    }
  };

  static PARTS = {
    main: { template: TEMPLATE, templates: [FUDGE_PARTIAL, TACTICS_PARTIAL], scrollable: [".ff-roster-list", ".ff-results-body", ".ff-log"] }
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

  /** Forget everything about the previous scene (called when the GM views another scene). */
  resetForScene() {
    this.sceneId = canvas.scene?.id ?? null;
    this.setup = null;
    this.roster = null;
    this.approach = null;
    this.results = null;
    this.spec = null;
    this.swing = null;
    this.sample = null;
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
    this.setup = getSetup();
    this.roster = await gatherRoster(this.setup);
    for ( const e of this.roster ) tokenSetup(this.setup, e.token.id);
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
    if ( !row || !mySide ) return null;
    let best = null;
    for ( const other of this.roster ) {
      const side = resolved[other.token.id];
      if ( !side || side === mySide ) continue;
      const a = row[other.token.id];
      if ( !a ) continue;
      const moves = a.modes?.[a.mode]?.moveActions ?? Math.ceil((a.dist * a.mult) / Math.max(1, a.speed));
      if ( !best || moves < best.moves ) best = { moves, mode: a.mode, mult: a.mult, dist: a.dist, name: other.spec.name, meleeOk: a.meleeOk };
    }
    return best;
  }

  async _prepareContext(options) {
    if ( !this.roster ) await this.#loadRoster();
    this.storyTables = await loadStoryTables();
    const setup = this.setup;
    const adapter = getAdapter();
    const resolved = resolveAllegiances(this.roster, setup, this.results?.underdog ?? null);
    const sideDefaults = setting("sideDefaults");

    // Leader candidates per side (from current chosen sides)
    const bySide = {};
    for ( const e of this.roster ) {
      const side = resolved[e.token.id] ?? chosenSide(e, setup);
      (bySide[side] ??= []).push(e.spec);
    }

    const sides = SIDE_ORDER.map(id => {
      const s = setup.sides[id];
      const members = this.roster.filter(e => chosenSide(e, setup) === id);
      const defaults = sideDefaults[id] ?? sideDefaults.hostile;
      const leaders = withPlaystyleLeaders(adapter?.detectLeaders(members.map(m => m.spec)) ?? [],
        members.map(m => ({ id: m.spec.id, behavior: tacticsFor(m.token.actor, m.spec).playstyles.behavior })));
      const autoLeader = leaders[0] ? this.roster.find(e => e.token.id === leaders[0].id) : null;
      const leaderId = s.leaderId === "auto" ? leaders[0]?.id : s.leaderId;
      const leader = leaders.find(l => l.id === leaderId) ?? (leaderId && leaderId !== "none" ? { id: leaderId, bonus: { brave: 10, tacticalFloor: 40, attack: 0, ac: 0 }, reason: loc("FASTFIGHTING.Planner.ChosenLeader") } : null);
      const lf = s.leadershipFudge ?? {};
      return {
        id,
        label: loc(`FASTFIGHTING.Side.${id}`),
        icon: SIDE_ICONS[id],
        active: this.sideTab === id,
        count: members.filter(m => setup.tokens[m.token.id]?.include !== false).length,
        isUnaligned: id === SIDES.NEUTRAL || id === SIDES.SECRET,
        allegiance: s.allegiance,
        allegianceChoices: Object.fromEntries(Object.values(ALLEGIANCE).map(k => [k, `FASTFIGHTING.Allegiance.${k}`])),
        traits: TRAITS.map(k => this.#traitView(k, defaults[k] ?? 50, s.traitFudge?.[k] ?? 0, `sides.${id}.traitFudge.${k}`, loc("FASTFIGHTING.Planner.SideDefault"))),
        healAggro: s.healAggro,
        healChoices: Object.fromEntries(HEAL_AGGRO.map(k => [k, `FASTFIGHTING.HealAggro.${k}`])),
        morale: s.morale !== false,
        leaderChoices: {
          auto: autoLeader ? game.i18n.format("FASTFIGHTING.Planner.AutoLeader", { name: autoLeader.spec.name }) : loc("FASTFIGHTING.Planner.AutoLeaderNone"),
          none: loc("FASTFIGHTING.Planner.NoLeader"),
          ...Object.fromEntries(members.map(m => [m.token.id, m.spec.name]))
        },
        leaderId: s.leaderId ?? "auto",
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
      resolvedLabel: resolvedSide && resolvedSide !== chosenSide(e, setup) ? game.i18n.format("FASTFIGHTING.Planner.FightsWith", { side: loc(`FASTFIGHTING.Side.${resolvedSide}`) }) : (resolvedSide === null && ts.include !== false ? loc("FASTFIGHTING.Planner.SitsOut") : ""),
      traits: TRAITS.map(k => this.#traitView(k, s.traits[k]?.base ?? 50, fudge[k] ?? 0, `tokens.${e.token.id}.fudge.${k}`, s.traitReasons?.[k], shifts[k] ?? 0)),
      expanded: this.expanded.has(e.token.id),
      stats: STAT_FUDGES.map(([k, step]) => {
        const base = k === "ac" ? s.defenses.ac : k === "hp" ? s.hp.max : 0;
        return this.#statView(k, base, fudge[k] ?? 0, `tokens.${e.token.id}.fudge.${k}`, step);
      }),
      actions: s.actions.map(a => a.name).filter((n, i, arr) => arr.indexOf(n) === i).join(", "),
      speeds: Object.entries(s.speeds ?? {}).map(([k, v]) => `${loc(`FASTFIGHTING.Mode.${k}`)} ${v}`).join(", "),
      approach: approach ? game.i18n.format("FASTFIGHTING.Planner.Approach", {
        mode: loc(`FASTFIGHTING.Mode.${approach.mode ?? "walk"}`), moves: Number.isFinite(approach.moves) ? approach.moves : "∞", name: approach.name
      }) + (approach.mult > 1.05 ? ` · ${loc("FASTFIGHTING.Planner.Terrain")} ×${approach.mult.toFixed(2)}` : "") + (approach.meleeOk ? "" : ` · ${loc("FASTFIGHTING.Planner.OutOfReach")}`) : "",
      environment: [...(s.environment?.types ?? []), s.environment?.difficult ? loc("FASTFIGHTING.Planner.DifficultHere") : null, s.environment?.hazardous ? loc("FASTFIGHTING.Planner.HazardHere") : null].filter(Boolean).join(", "),
      ignoreTerrain: !!ts.ignoreTerrain,
      diesAtZero: ts.diesAtZero ?? s.diesAtZero,
      isPc,
      playerControlled,
      controllers,
      tactics: this.expanded.has(e.token.id) ? questionsContext(s, e.token.actor, `gm-${e.token.id}`, { questions: playerControlled }) : null,
      playstyleNames: playstyles.ids.map(id => loc(`FASTFIGHTING.Playstyle.${id}.Name`)).join(", ")
    };
  }

  #resultsContext() {
    const r = this.results;
    const spec = this.spec;
    const sideColor = { friendly: "var(--ff-friendly)", hostile: "var(--ff-hostile)", neutral: "var(--ff-neutral)", secret: "var(--ff-secret)" };
    const segments = Object.values(r.sides).filter(s => s.pWin > 0).map(s => ({
      label: s.label, pct: pct(s.pWin, 1), width: (s.pWin * 100).toFixed(2), color: sideColor[s.id] ?? "var(--ff-neutral)"
    }));
    if ( r.pStalemate > 0 ) segments.push({ label: loc("FASTFIGHTING.Results.Stalemate"), pct: pct(r.pStalemate, 1), width: (r.pStalemate * 100).toFixed(2), color: "var(--ff-muted)" });
    if ( r.pNone > 0 ) segments.push({ label: loc("FASTFIGHTING.Results.NoOne"), pct: pct(r.pNone, 1), width: (r.pNone * 100).toFixed(2), color: "var(--ff-dark)" });

    const maxHist = Math.max(...r.rounds.histogram, 0.0001);
    const histogram = r.rounds.histogram.map((p, round) => ({ round, p: pct(p), height: Math.round((p / maxHist) * 100) })).filter(h => h.round > 0);
    const combatants = Object.values(r.combatants).map(c => ({
      ...c,
      sideLabel: loc(`FASTFIGHTING.Side.${c.side}`),
      sideClass: c.side,
      bars: [
        { cls: "standing", w: (c.pStanding * 100).toFixed(1), label: `${loc("FASTFIGHTING.Results.Standing")} ${pct(c.pStanding)}` },
        { cls: "down", w: (c.pDown * 100).toFixed(1), label: `${loc("FASTFIGHTING.Results.Down")} ${pct(c.pDown)}` },
        { cls: "dead", w: (c.pDead * 100).toFixed(1), label: `${loc("FASTFIGHTING.Results.Dead")} ${pct(c.pDead)}` },
        { cls: "fled", w: (c.pFled * 100).toFixed(1), label: `${loc("FASTFIGHTING.Results.Fled")} ${pct(c.pFled)}` },
        { cls: "surrendered", w: (c.pSurrendered * 100).toFixed(1), label: `${loc("FASTFIGHTING.Status.surrendered")} ${pct(c.pSurrendered)}` },
        { cls: "stoodDown", w: (c.pStoodDown * 100).toFixed(1), label: `${loc("FASTFIGHTING.Status.stoodDown")} ${pct(c.pStoodDown)}` },
        { cls: "switched", w: (c.pSwitched * 100).toFixed(1), label: `${loc("FASTFIGHTING.Results.Switched")} ${pct(c.pSwitched)}` }
      ],
      talkedDown: c.pTalkedDown > 0.0005 ? pct(c.pTalkedDown, 1) : "",
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
        crossCheck: r.crossCheck ? { label: r.crossCheck.label, labelLoc: game.i18n.localize(`FASTFIGHTING.Difficulty.${r.crossCheck.label}`), xp: r.crossCheck.xp } : null,
        foes, atRisk, combatants, resources, swing, sample
      },
      sampleFilters: Object.fromEntries(SAMPLE_FILTERS.map(k => [k, `FASTFIGHTING.Sample.${k}`])),
      sampleFilter: this.sampleFilter,
      storyStyles: Object.fromEntries(STORY_STYLES.map(k => [k, `FASTFIGHTING.Story.Style.${k}`])),
      storyStyle: this.storyStyle
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
        labels: storyLabels(),
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
      outcome: result.outcome === "victory" ? result.winners.map(w => loc(`FASTFIGHTING.Side.${w}`)).join(" & ") : loc(`FASTFIGHTING.Sample.Outcome.${result.outcome}`),
      story: this.storyFor()?.html ?? "",
      totalRounds: result.rounds,
      finals: rows.map(r => ({ name: r.spec.name, side: r.spec.side, status: loc(`FASTFIGHTING.Status.${r.final.status}`), statusClass: r.final.status, lines: r.lines.join("; ") || loc("FASTFIGHTING.Sample.Unchanged") }))
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
    } else if ( name === "sampleFilter" ) {
      this.sampleFilter = value;
      return;
    } else {
      if ( name.startsWith("tokens.") ) tokenSetup(this.setup, name.split(".")[1]);
      foundry.utils.setProperty(this.setup, name, value === "" ? null : value);
      if ( name === "options.seed" ) this.setup.options.seed = Number.isFinite(Number.parseInt(value, 10)) ? Number.parseInt(value, 10) >>> 0 : null;
      await saveSetup(this.setup);
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
    await saveSetup(this.setup);
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
    this.roster = null;
    this.approach = null;
    this.stale = true;
    this.render();
  }

  static async #onRun() {
    if ( this.running ) return;
    if ( !getAdapter() ) return ui.notifications.warn(loc("FASTFIGHTING.Planner.NoAdapter"));
    this.running = true;
    this.progress = 0;
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
      if ( this.abort.signal.aborted ) ui.notifications.info(game.i18n.format("FASTFIGHTING.Planner.Stopped", { n: results.runs }));
    } catch ( err ) {
      console.error(`${MODULE_ID} | simulation failed`, err);
      ui.notifications.error(game.i18n.format("FASTFIGHTING.Planner.RunFailed", { error: err.message }));
    } finally {
      this.running = false;
      this.abort = null;
      this.render();
    }
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
      this.running = false;
      this.render();
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
      if ( this.sampleFilter === "any" ) found = drawFight(this.spec, this.results);
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
    if ( !this.sample || !this.spec ) return;
    if ( canvas.scene?.id !== this.sceneId ) return ui.notifications.warn(loc("FASTFIGHTING.Planner.SceneChanged"));
    try {
      const rows = planMakeItSo(this.spec, this.sample.result);
      if ( !rows.some(r => r.changed) ) return ui.notifications.info(loc("FASTFIGHTING.MakeItSo.Nothing"));
      const ok = await confirmMakeItSo(rows);
      if ( !ok ) return;
      await executeMakeItSo(rows, this.sample.result, { story: this.storyFor() });
      ui.notifications.info(loc("FASTFIGHTING.MakeItSo.Done"));
    } catch ( err ) {
      reportError(err);
    }
    this.roster = null;
    this.results = null;
    this.sample = null;
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

/** Localized words the Standard story uses. */
function storyLabels() {
  const l = key => loc(`FASTFIGHTING.Story.Labels.${key}`);
  return {
    hit: l("hit"), crit: l("crit"), miss: l("miss"), resisted: l("resisted"), talked: l("talked"), convincing: l("convincing"),
    healed: l("healed"), potion: l("potion"), firstAid: l("firstAid"), stabilized: l("stabilized"), moved: l("moved"), stayedOut: l("stayedOut"), nothing: l("nothing"),
    status: Object.fromEntries(["standing", "down", "dead", "fled", "surrendered", "stoodDown", "switched"].map(s => [s, loc(`FASTFIGHTING.Status.${s}`)]))
  };
}
