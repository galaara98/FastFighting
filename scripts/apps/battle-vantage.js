/**
 * The Battle Vantage: the GM's window on a live battle (foundry/live-battle.js). Whose turn it is and what
 * FastFighting is waiting for (Continue, Rewind Turn, Play it, Rewind This Encounter, Play to the end, how NPCs'
 * reactions are decided); and a map of minds (battle-network.js): every creature on the map, every desire, condition,
 * goal and way toward others as a line between two (a symbol on the creature, for what's its own), each with its
 * intensity to raise or lower (0 takes it away). Beside it, the creature in focus (clicked there, or its token
 * selected on the map): what it wants and what's on it, its conditions to put on (engine/conditions.js), and what came
 * of the table's own rolls, put in as the simulation would have it ("Kyra's Diplomacy at it: a success"). A player's
 * character FastFighting isn't playing shows no desires: its player decides; one with none of its players connected
 * shows the countdown until FastFighting plays it (foundry/away.js), ticking down beside Add. A token on the map not in
 * the battle can be brought into it.
 */
import { NEUTRAL_PARTY, MODULE_ID, SIDES, HOSTILE_GROUPS, GROUPS, SIDE_SETTLE_MS } from "../constants.js";

/** A side picked for a creature, not yet worked out (SIDE_SETTLE_MS): {id, side, group, timer}, or null. */
let pendingSide = null;
import { DESIRE_BAND_KEYS, DESIRE_KINDS, desireBand } from "../engine/behavior/desire.js";
import { mindOf, bandLevel, networkOf, playerRuns } from "../engine/live.js";
import { commandOf, groupKeyOf, SLOTS } from "../engine/battle-state.js";
import { stanceOf } from "../engine/behavior/stance.js";
import { PICKED_BONUS } from "../foundry/battle.js";
import { GM_RELATIONS, conditionMost } from "../engine/conditions.js";
import { getAdapter } from "../api.js";
import { roundsText, listJoin } from "../i18n.js";
import { feetOnScene } from "../foundry/terrain.js";
import { mountNetwork } from "./battle-network.js";
import { blink, keepTyping } from "./blink.js";
import { sceneEncounter, encounterNumber } from "../foundry/persistence.js";
import { clockText } from "../foundry/away.js";
import {
  liveBattle, continueBattle, rewind, rewindEncounter, beginEncounter, endEncounter, playCurrent, answerDamage, setApplyDamage, systemAppliesText, waitingReaction, endReaction, sheetNow, liveFact, dropHeldFact, setNpcReactions, setPlayThrough, finishReview,
  waitingDeals, openDealReview,
  waitingOnGm, suggestedSpotlight, spotlightNext, settleBattle, setAutomated, liveCondition, liveMind, bringIntoFight, tokenIdOf, fastFight, fastOffered, fastRunning
} from "../foundry/live-battle.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const loc = key => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const has = key => game.i18n.has(key);
/** An engine condition in words: the system's own (its helper's conditionLabel), else the core's, else its key. */
const conditionWords = (adapter, key) => adapter?.conditionLabel?.(key) || (has(`FASTFIGHTING.Condition.${key}`) ? loc(`FASTFIGHTING.Condition.${key}`) : key);

/** What the GM can say came of the table's rolls, each as engine/live.js applyFact takes it. */
const FACTS = Object.freeze({
  hurt: { who: true, how: "band", fact: (id, by, band) => ({ kind: "want", id, desire: "hurt", targetId: by, level: bandLevel(band) }) },
  protect: { who: true, how: "band", fact: (id, by, band) => ({ kind: "want", id, desire: "protect", targetId: by, level: bandLevel(band) }) },
  persuade: { who: true, how: "degree", fact: (id, by, degree) => ({ kind: "talk", id, byId: by, talk: "persuade", degree }) },
  intimidate: { who: true, how: "degree", fact: (id, by, degree) => ({ kind: "talk", id, byId: by, talk: "intimidate", degree }) },
  deceive: { who: true, how: "degree", fact: (id, by, degree) => ({ kind: "talk", id, byId: by, talk: "deceive", degree }) },
  insult: { who: true, fact: (id, by) => ({ kind: "insult", id, byId: by }) },
  waver: { fact: id => ({ kind: "waver", id, on: true }) },
  steady: { fact: id => ({ kind: "waver", id, on: false }) },
  flee: { fact: id => ({ kind: "flee", id }) },
  surrender: { fact: (id, by) => ({ kind: "surrender", id, byId: by || null }) },
  standDown: { fact: (id, by) => ({ kind: "standDown", id, byId: by || null }) },
  noSide: { fact: id => ({ kind: "side", id, side: NEUTRAL_PARTY }) }
});

/** Each line's and symbol's sign (Font Awesome): desires, conditions, relations, ways toward others, goals, things. */
const ICONS = Object.freeze({
  desire: { hurt: "hand-fist", heal: "heart-pulse", protect: "shield", aid: "hand-holding-heart", talk: "comments", avoid: "person-walking-arrow-loop-left", bind: "link", rob: "sack-dollar", bolstered: "hands-praying", breakFree: "unlock", free: "link-slash", rid: "fire-extinguisher", bribe: "coins", extort: "hand-holding-dollar", scare: "bullhorn", toll: "road-barrier" },
  condition: {
    prone: "person-falling", offGuard: "shield-halved", frightened: "face-surprise", sickened: "face-dizzy", slowed: "hourglass-half", stunned: "star",
    clumsy: "shoe-prints", enfeebled: "weight-hanging", exhaustion: "battery-quarter", blinded: "eye-slash", deafened: "ear-deaf", silenced: "comment-slash",
    hidden: "user-secret", invisible: "ghost", immobilized: "anchor", restrained: "link", grabbed: "hand-back-fist", paralyzed: "snowflake", petrified: "mountain",
    unconscious: "bed", asleep: "moon", incapacitated: "ban", confused: "question", dazed: "star-half-stroke", fleeing: "person-running",
    turned: "person-walking-arrow-right", bound: "hands-bound", poisoned: "skull-crossbones", vulnerable: "heart-crack", disarmed: "hand", controlled: "hat-wizard",
    charmed: "heart", dazzled: "sun", doomed: "skull", wounded: "droplet", drained: "droplet-slash", fatigued: "battery-quarter", stupefied: "brain",
    quickened: "bolt", concealed: "cloud", undetected: "user-secret", unnoticed: "user-secret", observed: "eye", encumbered: "weight-hanging", broken: "heart-crack",
    outlined: "lightbulb", fascinated: "eye", enraged: "face-angry", cursed: "book-skull", chilled: "temperature-low", frozen: "icicles", burning: "fire",
    bleeding: "droplet", corroding: "flask", diseased: "virus", unhealable: "heart-circle-xmark", hastened: "bolt", gearBroken: "screwdriver-wrench",
    glitching: "microchip", overheated: "temperature-high", suppressed: "person-rifle", irradiated: "radiation", infectious: "virus-covid",
    impregnated: "bug", suffocating: "lungs", adrift: "user-astronaut", swallowed: "worm", engulfed: "droplet", stasis: "clock", banished: "door-open",
    transformed: "paw"
  },
  relation: { grabbed: "hand-back-fist", goaded: "bullhorn", controlled: "hat-wizard", bound: "link", exposedTo: "crosshairs", marked: "bullseye", shuns: "comment-slash" },
  attitude: {
    wary: "ear-deaf", grudge: "face-angry", schemes: "user-ninja", follows: "flag", truce: "handshake", serves: "paw", summoned: "wand-sparkles",
    leans: "scale-unbalanced", against: "fire", swayed: "comments", holdsBack: "hand", contrarian: "arrows-turn-to-dots", meddles: "hand-sparkles"
  },
  goal: {
    openDoor: "door-open", avoidTrap: "triangle-exclamation", runAway: "person-running", closeDoor: "door-closed", lockDoor: "lock", pickUp: "hand-holding",
    reach: "location-dot", swim: "person-swimming", fly: "feather", climb: "mountain", hide: "user-secret", takeCover: "tree", escape: "person-walking-arrow-right", useObject: "gears"
  },
  thing: { door: "door-closed", item: "gem", place: "location-dot", object: "gears" },
  affliction: { poison: "skull-crossbones", disease: "virus", curse: "book-skull", radiation: "radiation", parasite: "bug", other: "biohazard" },
  status: { unaware: "person-circle-question", patrolling: "binoculars", searching: "magnifying-glass" }
});
const icon = (group, key) => `fa-solid fa-${ICONS[group]?.[key] ?? "circle-exclamation"}`;
/** An affliction's sign: by what it is (a poison, a disease, a curse ...), else the condition a simple one stands for. */
const afflictionIcon = a => {
  const kind = (a.traits ?? []).find(t => ICONS.affliction[t]);
  if ( kind ) return icon("affliction", kind);
  return a.simple && ICONS.condition[a.simple] ? icon("condition", a.simple) : icon("affliction", "other");
};

/**
 * "Valeros's turn (Player 1)": whose turn it is, and for a player's character, its players by name (those here first;
 * none known, "the player's").
 */
function turnText(b, u, player) {
  if ( !player ) return fmt("FASTFIGHTING.Battle.Turn", { name: u.spec.name });
  const actor = b.scene.tokens.get(tokenIdOf(u))?.actor;
  const owners = actor ? game.users.filter(x => !x.isGM && actor.testUserPermission(x, "OWNER")) : [];
  const here = owners.filter(x => x.active);
  const names = (here.length ? here : owners).map(x => x.name);
  return names.length ? fmt("FASTFIGHTING.Battle.PlayerTurnOf", { name: u.spec.name, player: listJoin(names) }) : fmt("FASTFIGHTING.Battle.PlayerTurn", { name: u.spec.name });
}

/** A creature's hit points and status as shown: its sheet's, where a player's turn has changed it (sheetNow); else the engine's. */
const shownHp = u => sheetNow(u.id)?.hp ?? u.hp;
const shownStatus = u => {
  const s = sheetNow(u.id)?.status;
  return s === "dead" || s === "down" ? s : s === "standing" && (u.status === "dead" || u.status === "down") ? "standing" : u.status;
};

/** What happens to a creature's status on the map of minds: standing as it is, down greyed, out of it faded. */
const statusClass = status => (status === "standing" ? "" : status === "down" ? "is-down" : "is-out");

export class BattleVantage extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fast-fighting-battle",
    classes: ["fast-fighting", "ff-battle"],
    window: { title: "FASTFIGHTING.Battle.Title", icon: "fa-solid fa-chess-knight", resizable: true },
    position: { width: 980, height: 720 },
    actions: {
      continue: BattleVantage.#onContinue,
      rewind: BattleVantage.#onRewind,
      play: BattleVantage.#onPlay,
      rewindAll: BattleVantage.#onRewindAll,
      beginEncounter: BattleVantage.#onBeginEncounter,
      endEncounter: BattleVantage.#onEndEncounter,
      dropHeld: BattleVantage.#onDropHeld,
      npcReactions: BattleVantage.#onNpcReactions,
      tellIt: BattleVantage.#onTellIt,
      playThrough: BattleVantage.#onPlayThrough,
      fastFight: BattleVantage.#onFastFight,
      applyDamage: BattleVantage.#onApplyDamage,
      damage: BattleVantage.#onDamage,
      reaction: BattleVantage.#onReaction,
      dealReview: BattleVantage.#onDealReview,
      spotlight: BattleVantage.#onSpotlight,
      aftermath: BattleVantage.#onAftermath,
      automate: BattleVantage.#onAutomate,
      adjust: BattleVantage.#onAdjust,
      addLine: BattleVantage.#onAddLine,
      setSide: BattleVantage.#onSetSide,
      setRole: BattleVantage.#onSetRole,
      bringIn: BattleVantage.#onBringIn
    }
  };

  static PARTS = {
    main: { template: "modules/fast-fighting/templates/battle-vantage.hbs", scrollable: [".ff-battle-side"] }
  };

  /** Open it (GMs only), or bring it to the front. */
  static open() {
    if ( !game.user.isGM ) return null;
    const existing = foundry.applications.instances.get("fast-fighting-battle");
    if ( existing ) {
      existing.bringToFront?.();
      return existing.render({ force: true });
    }
    return new BattleVantage().render({ force: true });
  }

  /** Drawn again, if it's open. */
  static refresh() {
    foundry.applications.instances.get("fast-fighting-battle")?.render();
  }

  /** The creature (or token, or thing) in focus: its node's id. */
  #focus = null;
  /** The encounter it shows (by id): the scene's on screen, as the tracker views it. */
  #shownId = undefined;
  /** What the GM had picked in a player's turn under review, by battle, kept while another encounter is shown. */
  #drafts = new Map();
  #following = false;

  /** In the title bar: the scene, and which of its encounters, when it has more than one (the tracker's number). */
  get title() {
    const b = BattleVantage.shown();
    const scene = (b?.scene ?? canvas.scene)?.name;
    if ( !scene ) return loc("FASTFIGHTING.Battle.Title");
    const no = encounterNumber(b?.combat ?? sceneEncounter(canvas.scene));
    return no ? fmt("FASTFIGHTING.Battle.TitleAtEncounter", { scene, n: no.n }) : fmt("FASTFIGHTING.Battle.TitleAt", { scene });
  }

  /** The live battle, if it's on the encounter on screen (each scene, each encounter, its own). */
  static shown() {
    const b = liveBattle();
    return b && b.combat?.id === sceneEncounter(canvas.scene)?.id ? b : null;
  }

  /**
   * Another scene on screen, or another encounter viewed: what the GM had picked kept, the window blinks, and it shows
   * that encounter's battle (or that there's none).
   */
  async follow() {
    const now = sceneEncounter(canvas.scene)?.id ?? null;
    if ( !this.rendered || this.#following || this.#shownId === undefined || now === this.#shownId ) return;
    this.#following = true;
    try {
      keepTyping(this);
      this.#keepDraft();
      await blink(this);
      await this.render();
    } finally {
      this.#following = false;
    }
  }

  /** A player's turn under review: what the GM had ticked and picked, kept for when its battle is shown again. */
  #keepDraft() {
    const b = liveBattle();
    const review = this.element?.querySelector(".ff-battle-review");
    if ( !b || !review ) return;
    this.#drafts.set(b.data.id, [...review.querySelectorAll("[data-event]")].map(li => ({
      i: li.dataset.event, values: [...li.querySelectorAll("input, select")].map(f => (f.type === "checkbox" ? f.checked : f.value))
    })));
  }

  #restoreDraft(b) {
    const draft = b ? this.#drafts.get(b.data.id) : null;
    const review = this.element?.querySelector(".ff-battle-review");
    if ( !draft || !review ) return;
    this.#drafts.delete(b.data.id);
    for ( const { i, values } of draft ) {
      const fields = [...(review.querySelector(`[data-event="${i}"]`)?.querySelectorAll("input, select") ?? [])];
      fields.forEach((f, k) => {
        if ( !(k in values) ) return;
        if ( f.type === "checkbox" ) f.checked = !!values[k];
        else f.value = values[k];
      });
    }
  }
  /** The map of minds as the GM has laid it out and zoomed it, for this battle: {battleId, pinned, view}. */
  #layout = null;
  /** The map of minds being drawn, and what it's drawn from. */
  #network = null;
  #graph = null;
  /** Is the pointer over the window? The map's keys work only then (Delete elsewhere is the canvas's). */
  #hovering = false;
  /** The away countdown beside Add, ticking (#tick). */
  #ticking = null;

  /** Is the pointer over it (its keys are for it then)? */
  get hovering() {
    return this.#hovering && this.rendered;
  }

  _canRender() {
    return game.user.isGM;
  }

  /** Where the GM put the nodes and how far it's zoomed, for this battle (kept in this browser). */
  #layoutFor(battleId) {
    if ( this.#layout?.battleId === battleId ) return this.#layout;
    let kept = null;
    try {
      kept = JSON.parse(localStorage.getItem(`fast-fighting.network.${battleId}`) ?? "null");
    } catch ( err ) {
      kept = null;
    }
    this.#layout = { battleId, pinned: new Map(Array.isArray(kept?.pinned) ? kept.pinned : []), view: kept?.view ?? null };
    return this.#layout;
  }

  #keepLayout() {
    const l = this.#layout;
    if ( !l ) return;
    try {
      localStorage.setItem(`fast-fighting.network.${l.battleId}`, JSON.stringify({ pinned: [...l.pinned], view: l.view }));
    } catch ( err ) {
      // (Nowhere to keep it: it's laid out from the map again next time.)
    }
  }

  /** A token selected on the map: its creature in focus here (if it's on the battle's map). */
  focusToken(tokenId) {
    const b = liveBattle();
    if ( !b ) return;
    const u = b.run.units.find(x => (x.tokenId ?? x.spec.tokenId ?? x.id) === tokenId);
    const id = u ? u.id : b.scene.tokens.has(tokenId) ? `token:${tokenId}` : null;
    if ( !id || id === this.#focus ) return;
    this.#focus = id;
    this.render();
  }

  /** In focus here, and its token selected on the map. */
  #focusOn(id) {
    this.#focus = id;
    const tokenId = this.#tokenOf(id);
    const token = tokenId ? canvas.tokens?.get(tokenId) : null;
    if ( token && !token.controlled && canvas.scene?.id === liveBattle()?.scene.id ) token.control({ releaseOthers: true });
    this.render();
  }

  #tokenOf(id) {
    return tokenOf(liveBattle(), id);
  }

  async _prepareContext() {
    const b = BattleVantage.shown();
    this.#shownId = sceneEncounter(canvas.scene)?.id ?? null;
    const { context, graph, focus } = battleContext(b, this.#focus);
    this.#graph = graph;
    this.#focus = focus;
    return context;
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.element.addEventListener("pointerenter", () => { this.#hovering = true; });
    this.element.addEventListener("pointerleave", () => { this.#hovering = false; });
  }

  /**
   * One of the map of minds' keys (+ and -, whatever the keyboard; Configure Controls: lower, raise, next, previous),
   * with the pointer over the window: true if it was for the map.
   */
  netKey(action) {
    if ( !this.#hovering || !this.rendered ) return false;
    return this.#network?.act(action) ?? false;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    // (The title bar as the encounter shown now is.)
    if ( this.window?.title && this.window.title.textContent !== this.title ) this.window.title.textContent = this.title;
    this.#network?.destroy();
    this.#network = null;
    this.#tick();
    const root = this.element.querySelector(".ff-net");
    const b = BattleVantage.shown();
    this.#restoreDraft(b);
    if ( !root || !b || !this.#graph ) return;
    const state = this.#layoutFor(b.data.id);
    this.#network = mountNetwork(root, this.#graph, {
      state, focus: this.#graph.focus,
      onFocus: id => this.#focusOn(id),
      onAdjust: (adjust, step) => this.#adjust(adjust, step),
      onAdd: id => this.#addLine(id),
      onLayout: ({ redraw = false } = {}) => {
        this.#keepLayout();
        if ( redraw ) this.render();
      },
      words: {
        zoomIn: loc("FASTFIGHTING.Battle.Net.ZoomIn"), zoomOut: loc("FASTFIGHTING.Battle.Net.ZoomOut"), fit: loc("FASTFIGHTING.Battle.Net.Fit"), reset: loc("FASTFIGHTING.Battle.Net.Reset"),
        select: loc("FASTFIGHTING.Battle.Net.Select"), unselect: loc("FASTFIGHTING.Battle.Net.Unselect"), selectTeam: loc("FASTFIGHTING.Battle.Net.SelectTeam"), selectLeader: loc("FASTFIGHTING.Battle.Net.SelectLeader")
      }
    });
  }

  /**
   * The away countdown beside Add (the creature in focus has one), ticking down each second: only its own time is
   * written, not the window. At zero it's gone; the checkbox shows ticked once FastFighting plays the character.
   */
  #tick() {
    clearInterval(this.#ticking);
    this.#ticking = null;
    const clock = this.element?.querySelector(".ff-away-timer[data-deadline]");
    if ( !clock ) return;
    const deadline = Number(clock.dataset.deadline);
    const show = () => {
      const left = deadline - Date.now();
      if ( left > 0 && clock.isConnected ) {
        const time = clock.querySelector(".ff-away-left");
        if ( time ) time.textContent = clockText(left);
        return;
      }
      clock.remove();
      clearInterval(this.#ticking);
      this.#ticking = null;
    };
    show();
    if ( clock.isConnected ) this.#ticking = setInterval(show, 1000);
  }

  _onClose(options) {
    clearInterval(this.#ticking);
    this.#ticking = null;
    this.#network?.destroy();
    this.#network = null;
    settleSide();
    super._onClose?.(options);
  }

  /**
   * An intensity one step down or up (0 takes it away), on the map or in the panel: a desire or goal held there by the
   * GM (engine/live.js), a condition set on the sheet or kept, one toward someone taken off, a bystander who notices.
   */
  async #adjust(a, step) {
    const n = (Number(a.intensity) || 1) + step;
    const level = k => (k <= 0 ? 0 : bandLevel(Math.min(5, k) - 1));
    switch ( a.t ) {
      case "desire":
        return liveMind({ op: "desire", id: a.id, kind: a.kind, targetId: a.targetId, level: level(n) });
      case "goal":
        if ( a.kind === "runAway" ) return liveFact(n >= 2 ? { kind: "flee", id: a.id } : { kind: "waver", id: a.id, on: n >= 1 });
        return liveMind({ op: "goal", id: a.id, kind: a.kind, thingId: a.thingId ?? null, level: a.scale === "band" ? level(n) : Math.max(0, n) });
      case "cond":
        return liveCondition({ op: "set", id: a.id, key: a.key, value: Math.max(0, n), byId: a.byId ?? null });
      case "rel":
        return liveCondition({ op: "unrelate", id: a.id, kind: a.kind, byId: a.byId });
      case "affliction":
        return liveCondition({ op: "affliction", id: a.id, afflictionId: a.afflictionId, stage: Math.max(0, n) });
      case "attitude":
        return liveMind({ op: "attitude", id: a.id, kind: a.kind, byId: a.byId ?? null, side: a.side ?? null, level: Math.max(0, n) });
      case "notice":
        return liveFact({ kind: "notice", id: a.id });
      case "release":
        return liveMind(a.type === "goal" ? { op: "goal", id: a.id, kind: a.kind, thingId: a.thingId, level: null } : { op: "desire", id: a.id, kind: a.kind, targetId: a.targetId, level: null });
      default:
        return null;
    }
  }

  /**
   * A new line from a creature, as the GM picks it in a dialog: a desire toward someone (how badly), a condition
   * (how much, from whom, for how many rounds), or one toward someone (afraid of, grabbed by ...). Nothing is chosen at
   * first; once something is, only what it needs shows, and whom it's about is asked in its own words (Hurt whom,
   * Afraid of whom, Caused by whom).
   */
  async #addLine(id) {
    const b = liveBattle();
    const u = b?.run.byId.get(id);
    if ( !u ) return;
    const adapter = getAdapter();
    const doc = b.scene.tokens.get(tokenOf(b, id));
    const opt = (value, label, data = {}) => `<option value="${foundry.utils.escapeHTML(value)}" ${Object.entries(data).map(([k, v]) => `data-${k}="${foundry.utils.escapeHTML(String(v))}"`).join(" ")}>${foundry.utils.escapeHTML(label)}</option>`;
    // (What each choice asks: whom (required, or not), and in what words; how badly, how well, how much, how long.)
    const whomFor = what => fmt("FASTFIGHTING.Battle.Net.WhomFor", { what });
    const seen = new Set();
    const conditions = (adapter?.conditionChoices?.() ?? []).filter(c => c?.key && !seen.has(c.key) && seen.add(c.key))
      .map(c => ({ value: `cond:${c.key}`, label: `${conditionWords(adapter, c.key)} · ${loc(adapter?.sheetCarries?.(c.key, doc?.actor) ? "FASTFIGHTING.Battle.OnSheet" : "FASTFIGHTING.Battle.CoreOnly")}`,
        data: { whom: loc("FASTFIGHTING.Battle.Net.WhomCause"), fields: c.valued || (conditionMost(c.key) ?? 2) > 1 ? "who value rounds" : "who rounds" } }))
      .sort((a, c) => a.label.localeCompare(c.label, game.i18n.lang));
    const players = b.run.live.players.has(id);
    // (Not what it can only want of itself: getting loose, being rid of a burn.)
    const desires = players ? [] : DESIRE_KINDS.filter(k => !["bolstered", "breakFree", "rid", "leave"].includes(k)).map(k => ({ value: `desire:${k}`, label: loc(`FASTFIGHTING.Desire.Kind.${k}`),
      data: { whom: whomFor(loc(`FASTFIGHTING.Desire.Kind.${k}`)), fields: "who band", needs: "who" } }));
    const relations = GM_RELATIONS.filter(k => k !== "afraid" || !players).map(k => ({ value: `rel:${k}`, label: loc(`FASTFIGHTING.Battle.RelationPick.${k}`),
      data: { whom: loc(`FASTFIGHTING.Battle.Net.WhomRel.${k}`), fields: k === "afraid" ? "who band" : "who rounds", needs: "who" } }));
    const others = b.run.units.filter(o => o.id !== id);
    // (What happened at the table: what a want doesn't say already.)
    const facts = Object.keys(FACTS).filter(k => k !== "hurt" && k !== "protect").map(k => {
      const f = FACTS[k];
      const optional = k === "surrender" || k === "standDown";
      const fields = [f.who || optional ? "who" : "", f.how === "band" ? "band" : "", f.how === "degree" ? "degree" : ""].filter(Boolean).join(" ");
      const whom = optional ? loc(`FASTFIGHTING.Battle.Net.WhomRel.${k}`) : whomFor(loc(`FASTFIGHTING.Battle.Fact.${k}`));
      return { value: `fact:${k}`, label: loc(`FASTFIGHTING.Battle.Fact.${k}`), data: { whom, fields, needs: f.who && !optional ? "who" : "" } };
    });
    const content = `<div class="ff-add-line">
      <p class="hint">${foundry.utils.escapeHTML(fmt("FASTFIGHTING.Battle.Net.AddHint", { name: u.spec.name }))}</p>
      <div class="form-group"><label>${loc("FASTFIGHTING.Battle.Net.AddWhat")}</label><select name="what">
        <option value="" selected>—</option>
        ${desires.length ? `<optgroup label="${loc("FASTFIGHTING.Battle.Net.Wants")}">${desires.map(d => opt(d.value, d.label, d.data)).join("")}</optgroup>` : ""}
        <optgroup label="${loc("FASTFIGHTING.Battle.Conditions")}">${conditions.map(c => opt(c.value, c.label, c.data)).join("")}</optgroup>
        <optgroup label="${loc("FASTFIGHTING.Battle.Toward")}">${relations.map(r => opt(r.value, r.label, r.data)).join("")}</optgroup>
        <optgroup label="${loc("FASTFIGHTING.Battle.FactLabel")}">${facts.map(f => opt(f.value, f.label, f.data)).join("")}</optgroup>
      </select></div>
      <div class="form-group" data-field="who"><label class="ff-whom"></label><select name="who"><option value="">—</option>${others.map(o => opt(o.id, o.spec.name)).join("")}</select></div>
      <div class="form-group" data-field="band"><label>${loc("FASTFIGHTING.Desire.HowMuch")}</label><select name="band">${DESIRE_BAND_KEYS.map((k, i) => `<option value="${i}" ${i === 2 ? "selected" : ""}>${loc(`FASTFIGHTING.Desire.Level.${k}`)}</option>`).join("")}</select></div>
      <div class="form-group" data-field="degree"><label>${loc("FASTFIGHTING.Battle.HowWell")}</label><select name="degree">${[3, 2, 1, 0].map(d => `<option value="${d}" ${d === 2 ? "selected" : ""}>${loc(`FASTFIGHTING.Battle.Degree.${d}`)}</option>`).join("")}</select></div>
      <div class="form-group" data-field="value"><label>${loc("FASTFIGHTING.Battle.Value")}</label><input type="number" name="value" min="1" step="1" value="1"></div>
      <div class="form-group" data-field="rounds"><label>${loc("FASTFIGHTING.Battle.Rounds")}</label><input type="number" name="rounds" min="1" step="1" placeholder="${loc("FASTFIGHTING.Battle.Until")}"></div>
    </div>`;
    // (Shown as the choice needs: nothing but the choice itself until there is one.)
    const shape = root => {
      const chosen = root.querySelector('select[name="what"]')?.selectedOptions?.[0];
      const fields = new Set((chosen?.dataset.fields ?? "").split(" ").filter(Boolean));
      for ( const g of root.querySelectorAll("[data-field]") ) g.hidden = !fields.has(g.dataset.field);
      const whom = root.querySelector(".ff-whom");
      if ( whom ) whom.textContent = chosen?.dataset.whom ?? "";
      const apply = root.querySelector('button[data-action="ok"]');
      if ( apply ) apply.disabled = !chosen?.value;
    };
    const picked = await foundry.applications.api.DialogV2.prompt({
      window: { title: fmt("FASTFIGHTING.Battle.Net.AddTitle", { name: u.spec.name }) }, content,
      ok: { label: loc("FASTFIGHTING.Battle.Apply"), callback: (event, button) => Object.fromEntries(new FormData(button.form).entries()) },
      render: (event, dialog) => {
        const root = dialog.element;
        shape(root);
        root.querySelector('select[name="what"]')?.addEventListener("change", () => shape(root));
      },
      rejectClose: false
    });
    if ( !picked?.what ) return;
    const [kind, key] = [picked.what.slice(0, picked.what.indexOf(":")), picked.what.slice(picked.what.indexOf(":") + 1)];
    const byId = picked.who || null;
    const rounds = Number(picked.rounds) || null;
    const band = Number(picked.band ?? 2);
    if ( kind === "fact" ) {
      const f = FACTS[key];
      if ( !f ) return;
      if ( f.who && !byId && !["surrender", "standDown"].includes(key) ) return ui.notifications.warn(loc("FASTFIGHTING.Battle.PickWho"));
      return liveFact(f.fact(id, byId, f.how === "degree" ? Number(picked.degree ?? 2) : band));
    }
    if ( (kind === "desire" || kind === "rel") && !byId ) return ui.notifications.warn(loc("FASTFIGHTING.Battle.PickWho"));
    if ( kind === "desire" ) return liveMind({ op: "desire", id, kind: key, targetId: byId, level: bandLevel(band) });
    if ( kind === "rel" ) return liveCondition({ op: "relate", id, kind: key, byId, rounds, level: band });
    return liveCondition({ op: "set", id, key, value: Math.max(1, Number(picked.value) || 1), byId, rounds });
  }

  /**
   * Another side for the creature in focus, or another of its kind's groups (what it wants worked out again: engine/live.js
   * setSide), once the pick has stood SIDE_SETTLE_MS: picked back where it was meanwhile, nothing is worked out.
   */
  static async #onSetSide(event, target) {
    const id = target.closest("[data-creature]")?.dataset.creature;
    if ( !id || !target.dataset.side ) return;
    const side = target.dataset.side;
    const group = Number(target.dataset.group) || null;
    const u = liveBattle()?.run.byId.get(id);
    clearTimeout(pendingSide?.timer);
    pendingSide = null;
    // (Shown picked at once.)
    for ( const b of target.closest("[data-creature]")?.querySelectorAll("[data-action=setSide]") ?? [] ) b.classList.toggle("active", b === target);
    const where = u && u.side === side && (side !== NEUTRAL_PARTY || (u.friendGroup ?? null) === group);
    if ( !u || where ) return;
    pendingSide = { id, side, group, timer: setTimeout(() => settleSide(), SIDE_SETTLE_MS) };
  }

  /**
   * Its place in its group's chain of command (boss, leader, 1st or 2nd lieutenant; again, out of it): what it lends
   * those it leads, as its system ranks it (adapter.detectLeaders), else what a leader the GM picks lends.
   */
  static async #onSetRole(event, target) {
    const id = target.closest("[data-creature]")?.dataset.creature;
    const slot = target.dataset.role;
    const u = liveBattle()?.run.byId.get(id);
    if ( !u || !SLOTS.includes(slot) ) return;
    if ( target.classList.contains("active") ) return liveMind({ op: "role", id, slot: "none" });
    const ranked = getAdapter()?.detectLeaders?.([u.spec])?.find(r => r.id === id);
    const lends = Object.fromEntries(["brave", "tacticalFloor", "attack", "ac"].map(k => [k, ranked?.bonus?.[k] ?? PICKED_BONUS[k] ?? 0]));
    await liveMind({ op: "role", id, slot, leadership: lends });
  }

  static async #onAddLine(event, target) {
    await this.#addLine(target.closest("[data-creature]")?.dataset.creature);
  }

  /** A step from the panel (its rows have the map's steps). */
  static async #onAdjust(event, target) {
    try {
      await this.#adjust(JSON.parse(target.dataset.adjust), Number(target.dataset.step) || 0);
    } catch ( err ) {
      console.error("fast-fighting | an intensity step", err);
    }
  }

  static async #onContinue() {
    await continueBattle();
  }

  static async #onAutomate(event, target) {
    await setAutomated(target.closest("[data-creature]")?.dataset.creature, target.checked);
  }

  static async #onAftermath() {
    await settleBattle();
  }

  static async #onSpotlight() {
    await spotlightNext();
  }

  static async #onRewind() {
    await rewind();
  }

  static async #onPlay() {
    await playCurrent();
  }

  /** Begin Encounter: the battle prepared on it begins (or, one that has begun already, Foundry's own start). */
  static async #onBeginEncounter() {
    const b = liveBattle();
    if ( !b || b.combat.started ) return;
    if ( b.data.prepared ) await beginEncounter();
    else await b.combat.startCombat();
  }

  /** End Encounter: Foundry's own (it asks first). */
  static async #onEndEncounter() {
    await endEncounter();
  }

  static async #onRewindAll() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("FASTFIGHTING.MakeItSo.UndoTitle") }, content: `<p>${foundry.utils.escapeHTML(loc("FASTFIGHTING.Live.RewindAllConfirm"))}</p>`
    });
    if ( ok ) await rewindEncounter();
  }

  /** A token on the map brought into the fight. */
  static async #onBringIn(event, target) {
    await bringIntoFight(target.dataset.token);
  }

  static #onDropHeld(event, target) {
    dropHeldFact(Number(target.dataset.index));
  }

  /** The GM's review done: the events kept, a talk as the GM set it, all of them sure now. */
  static #onTellIt(event, target) {
    const b = liveBattle();
    if ( !b?.review ) return;
    const root = target.closest(".ff-battle-review");
    const events = [];
    b.review.events.forEach((e, i) => {
      const row = root.querySelector(`[data-event="${i}"]`);
      if ( row && !row.querySelector("[name=keep]")?.checked ) return;
      const kept = { ...e, sure: true };
      if ( e.type === "talk" && row ) {
        kept.kind = row.querySelector("[name=kind]")?.value ?? e.kind;
        kept.degree = Number(row.querySelector("[name=degree]")?.value ?? e.degree ?? 2);
        kept.targetId = row.querySelector("[name=target]")?.value || e.targetId;
        if ( !kept.targetId ) return; // (at no one: nothing to tell)
      } else if ( !e.targetId && row ) {
        // (A blow the cards put at no one: at whom the GM says.)
        kept.targetId = row.querySelector("[name=target]")?.value || null;
        if ( !kept.targetId && ["attack", "save", "auto"].includes(e.type) ) return;
      }
      events.push(kept);
    });
    finishReview(events);
  }

  static async #onNpcReactions(event, target) {
    await setNpcReactions(target.checked ? "ask" : "calculated");
  }

  static async #onPlayThrough(event, target) {
    await setPlayThrough(target.checked);
  }

  /** >> Fast Fight >>: the rest of the fight played at once; pressed again (Stop), it stops after the turn under way. */
  static async #onFastFight() {
    await fastFight();
  }

  /** A deal waiting on the GM's review: its window. */
  static #onDealReview(event, target) {
    openDealReview(target.dataset.key);
  }

  /** A player's reaction waiting: they've rolled it (read off their cards), or the battle goes on without it. */
  static #onReaction(event, target) {
    endReaction(target.dataset.key, target.dataset.how === "skip" ? "skip" : "done");
  }

  /** Apply players' damage, for this battle, from now on. */
  static async #onApplyDamage(event, target) {
    await setApplyDamage(target.checked);
  }

  /** A player's damage waiting on a GM: applied (whole, half or double; to the creature picked, where it had none) or dismissed. */
  static async #onDamage(event, target) {
    const line = target.closest("[data-key]");
    const picked = line?.querySelector("select[name='damageTarget']")?.value || null;
    await answerDamage(target.dataset.key, { multiplier: Number(target.dataset.multiplier) || 1, targetId: picked, dismiss: target.dataset.dismiss === "true" });
  }
}

/**
 * What the Battle Vantage shows of a battle (whichever browser plays it), with `focusId` in focus: {context (the
 * template's), graph (the map of minds: battle-network.js), focus (still there, or null)}.
 */
export function battleContext(b, focusId = null) {
  if ( !b ) return { context: { none: true }, graph: null, focus: null };
  const run = b.run;
  const combatant = b.combat.combatant;
  const current = combatant ? run.units.find(u => tokenIdOf(u) === combatant.tokenId) ?? null : null;
  const name = id => run.byId.get(id)?.spec.name ?? "";
  const played = !!current && waitingOnGm();
  const player = !!current && run.live.players.has(current.id);
  const started = !!b.combat.started;
  const fast = b === liveBattle() && fastRunning();
  const state = !started ? "unstarted" : b.data.ended ? "ended" : b.pc ? "player" : played ? "waiting" : b.data.spotlight && !current ? "spotlight" : "ready";
  // (A spotlight system: whom FastFighting would give it to next.)
  const next = state === "waiting" || state === "spotlight" ? suggestedSpotlight() : null;
  const view = networkView(b, current, focusId, name);
  // A player's turn waiting on the GM: what was read of it, to keep or drop (and a talk set right).
  const review = b.review ? {
    title: fmt("FASTFIGHTING.Battle.ReviewTitle", { name: name(b.review.id) }),
    events: b.review.events.map((e, i) => ({
      i, unsure: e.sure === false, talk: e.type === "talk", pick: e.type !== "talk" && !e.targetId,
      text: fmt(`FASTFIGHTING.Battle.Read.${has(`FASTFIGHTING.Battle.Read.${e.type}`) ? e.type : "other"}`, {
        actor: name(b.review.id), target: name(e.targetId), action: e.action || e.skill || "", damage: e.damage ?? 0, amount: e.amount ?? 0,
        degree: Number.isFinite(e.degree) ? loc(`FASTFIGHTING.Battle.Degree.${e.degree}`) : "", kind: e.kind ? loc(`FASTFIGHTING.Battle.Talk.${e.kind}`) : ""
      }),
      kinds: ["persuade", "intimidate", "deceive"].map(k => ({ value: k, label: loc(`FASTFIGHTING.Battle.Talk.${k}`), selected: e.kind === k })),
      targets: [{ value: "", label: "—", selected: !e.targetId }, ...run.units.filter(u => u.id !== b.review.id).map(u => ({ value: u.id, label: u.spec.name, selected: e.targetId === u.id }))],
      degrees: [3, 2, 1, 0].map(d => ({ value: d, label: loc(`FASTFIGHTING.Battle.Degree.${d}`), selected: (e.degree ?? 2) === d }))
    }))
  } : null;
  const context = {
    review,
    round: b.data.spotlight ? run.round : b.combat.round, started,
    spotlight: next ? fmt("FASTFIGHTING.Battle.Spotlight", { name: next.spec.name }) : "",
    turn: current ? turnText(b, current, player) : "",
    state, stateText: fmt(`FASTFIGHTING.Battle.State.${state}`, { name: current?.spec.name ?? "" }),
    // (Next Turn whenever the encounter is going, as the tracker's own: a player's turn, it ends it.)
    canContinue: started && state !== "ended", canPlay: state === "ready" && !player && !fast, canRewind: !!b.data.turns.at(-1)?.snapshot,
    canSettle: state === "ended" && !b.data.settled,
    // (Fast Fight, beside Next Turn, where FastFighting plays every token; its Stop while it runs.)
    fastFight: fastOffered(b), fastRunning: fast,
    // (Foundry's encounter: Begin Encounter until it has, glowing while it waits; then End Encounter.)
    canBegin: !started, canEnd: started,
    npcAsk: run.live.npcReactions === "ask", playThrough: !!b.data.auto,
    // (A player rolling a reaction: the battle waits on them.)
    reaction: (() => {
      const w = waitingReaction();
      return w ? { key: w.key, text: fmt("FASTFIGHTING.Battle.WaitingReaction", { name: w.name }) } : null;
    })(),
    // (Deals waiting on the GM's review: engine/behavior/deals.js.)
    deals: waitingDeals(),
    // (Players' damage: applied at once, or waiting here; greyed out while the system applies it itself.)
    applyDamage: !!b.data.applyDamage, systemApplies: systemAppliesText(),
    // (A player's turn's own, and those the table settles: a player's character's at another, Apply players' damage off.)
    damage: [...(b.pc?.damage ?? []), ...(b.data.waiting ?? [])].map(d => ({
      key: d.key, save: d.save, needsTarget: !d.targetId,
      text: fmt(d.healing ? "FASTFIGHTING.Battle.HealingLine" : "FASTFIGHTING.Battle.DamageLine", { by: d.by, target: d.targetId ? name(d.targetId) : loc("FASTFIGHTING.Battle.DamageNoTarget"), amount: d.amount }),
      targets: d.targetId ? [] : run.units.filter(u => !run.live.players.has(u.id)).map(u => ({ value: u.id, label: u.spec.name }))
    })),
    held: (b.pc?.facts ?? []).map((f, i) => ({ i, text: factText(f, name) })),
    focus: view.panel
  };
  return { context, graph: view.graph, focus: view.graph.focus };
}

/**
 * The map of minds in words (engine/live.js networkOf): its nodes, lines and symbols, each line and symbol with the
 * steps its intensity has; and the panel for the one in focus. `name`: a creature's name, by its id (battleContext's).
 */
function networkView(b, current, focusId, name) {
  const run = b.run;
  const net = networkOf(run);
  const adapter = getAdapter();
  const sideLabel = side => b.spec.sides?.[side]?.label ?? (has(`FASTFIGHTING.Side.${side}`) ? loc(`FASTFIGHTING.Side.${side}`) : side);
  const docOf = id => b.scene.tokens.get(tokenOf(b, id));
  const condLabel = key => conditionWords(adapter, key);
  const choices = new Map();
  for ( const c of adapter?.conditionChoices?.() ?? [] ) if ( c?.key && !choices.has(c.key) ) choices.set(c.key, c);
  const valuedHere = new Set([...choices.values()].filter(c => c.valued).map(c => c.key));
  // (An affliction in words: its name (a simple one's, its condition's), its stage of its last, and what that lays.)
  const afflictionWords = a => {
    const what = Object.entries(a.conditions ?? {}).filter(([k]) => k !== a.simple).map(([k, v]) => `${condLabel(k)}${Number(v) > 1 ? ` ${v}` : ""}`);
    return [fmt("FASTFIGHTING.Battle.Net.Affliction", { name: a.name || condLabel(a.simple ?? ""), stage: a.stage, most: a.most }),
      ...(what.length ? [listJoin(what)] : []),
      ...(a.onset > 0 ? [fmt("FASTFIGHTING.Battle.Net.Onset", { n: a.onset })] : []),
      ...(a.settled ? [loc("FASTFIGHTING.Battle.Net.Settled")] : [])].join(" · ");
  };
  const band = level => loc(`FASTFIGHTING.Desire.Level.${DESIRE_BAND_KEYS[desireBand(level)]}`);
  const things = new Map(net.things.map(t => [t.id, t]));
  const thingName = id => {
    const t = things.get(id);
    return t ? (t.name || loc(`FASTFIGHTING.Thing.${has(`FASTFIGHTING.Thing.${t.type}`) ? t.type : "object"}`)) : name(id);
  };
  const nodeId = (l, end) => (l.type === "goal" && things.has(l[end]) ? `thing:${l[end]}` : l[end]);
  const held = gm => (gm ? ` · ${loc("FASTFIGHTING.Battle.Net.Held")}` : "");
  const lasts = rounds => (rounds ? ` · ${roundsText(rounds)}` : "");
  // (Where a condition is kept: on the sheet, if its system's sheet shows it; else by FastFighting.)
  const kept = (key, id) => loc(adapter?.sheetCarries?.(key, docOf(id)?.actor) ? "FASTFIGHTING.Battle.OnSheet" : "FASTFIGHTING.Battle.CoreOnly");
  // One less and one more, in words: none past its most, nothing below 0 (which takes it away).
  const stepsOf = (intensity, most, { remove = "FASTFIGHTING.Battle.Remove", less = "FASTFIGHTING.Battle.Less", more = "FASTFIGHTING.Battle.More" } = {}) => ({
    lower: loc(intensity <= 1 ? remove : less),
    raise: most === null || intensity < most ? loc(more) : null
  });
  const shown = n => (n.most === 1 ? "" : String(n.intensity));

  const edges = [];
  const marks = new Map();
  const markOn = (id, m) => {
    if ( !marks.has(id) ) marks.set(id, []);
    marks.get(id).push(m);
  };
  // (Its words without whose they are, for that one's own panel: "Hurt Valeros", not "Goblin: Hurt Valeros".)
  const push = (l, e) => {
    const subject = [name(l.from), name(l.to)].find(nm => nm && e.tip?.startsWith(`${nm}: `));
    edges.push({ id: `${l.type}:${l.kind ?? l.key}:${l.from}>${l.to}`, from: nodeId(l, "from"), to: nodeId(l, "to"), link: l, short: subject ? e.tip.slice(subject.length + 2) : e.tip, ...e });
  };

  for ( const l of net.links ) {
    if ( l.type === "desire" ) {
      const what = l.kind === "talk" && has(`FASTFIGHTING.Battle.Pitch.${l.pitch}`) ? loc(`FASTFIGHTING.Battle.Pitch.${l.pitch}`) : loc(`FASTFIGHTING.Desire.Kind.${l.kind}`);
      push(l, {
        cls: `is-desire d-${l.kind} w-${l.intensity}`, icon: icon("desire", l.kind), text: shown(l),
        tip: `${name(l.from)}: ${fmt("FASTFIGHTING.Battle.Desire", { what, who: name(l.to), how: band(l.level) })}${held(l.gm)}`,
        adjust: { t: "desire", id: l.from, kind: l.kind, targetId: l.to, intensity: l.intensity },
        ...stepsOf(l.intensity, l.most, { remove: "FASTFIGHTING.Battle.Net.SetAside" })
      });
    } else if ( l.type === "condition" ) {
      const valued = l.valued || valuedHere.has(l.key);
      const most = valued ? l.most ?? null : 1;
      push(l, {
        cls: `is-condition w-${Math.min(5, l.intensity)}`, icon: icon("condition", l.key), text: valued ? String(l.value) : "",
        tip: `${name(l.to)}: ${condLabel(l.key)}${valued ? ` ${l.value}` : ""} · ${fmt("FASTFIGHTING.Battle.From", { name: name(l.from) })}${lasts(l.rounds)} · ${kept(l.key, l.to)}`,
        adjust: { t: "cond", id: l.to, key: l.key, byId: l.from, intensity: valued ? l.value : 1 },
        ...stepsOf(valued ? l.value : 1, most)
      });
    } else if ( l.type === "affliction" ) {
      push(l, {
        cls: `is-condition is-affliction w-${Math.min(5, l.intensity)}`, icon: afflictionIcon(l), text: String(l.stage),
        tip: `${name(l.to)}: ${afflictionWords(l)} · ${fmt("FASTFIGHTING.Battle.From", { name: name(l.from) })}`,
        adjust: { t: "affliction", id: l.to, afflictionId: l.afflictionId, intensity: l.stage },
        ...stepsOf(l.stage, l.most)
      });
    } else if ( l.type === "relation" ) {
      // (Won't listen to: the one who won't, toward the other. The rest: the one it's on, by whoever did it.)
      const on = l.kind === "shuns" ? l.from : l.to;
      const by = l.kind === "shuns" ? l.to : l.from;
      push(l, {
        cls: `is-relation r-${l.kind}`, icon: icon("relation", l.kind), text: "",
        tip: `${name(on)}: ${fmt(`FASTFIGHTING.Battle.Relation.${l.kind}`, { name: name(by) })}${lasts(l.rounds)}${held(l.gm)}`,
        adjust: { t: "rel", id: on, kind: l.kind, byId: by, intensity: 1 },
        ...stepsOf(1, 1)
      });
    } else if ( l.type === "attitude" ) {
      const key = l.kind === "grudge" && l.provoked ? "grudgeProvoked" : l.kind;
      push(l, {
        cls: `is-relation r-${l.kind}`, icon: icon("attitude", l.kind), text: l.most === 1 ? "" : String(l.intensity),
        tip: `${name(l.from)}: ${fmt(`FASTFIGHTING.Battle.Attitude.${key}`, { name: name(l.to), n: l.intensity })}`,
        ...(l.fixed ? {} : { adjust: { t: "attitude", id: l.from, kind: l.kind, byId: l.to, intensity: l.intensity }, ...stepsOf(l.intensity, l.most) })
      });
    } else if ( l.type === "goal" ) {
      const words = fmt(`FASTFIGHTING.Goal.${l.kind}`, { thing: thingName(l.thingId), name: l.via ? name(l.via) : name(l.to) });
      push(l, {
        cls: `is-goal g-${l.kind} ${l.played ? "" : "is-stub"} w-${Math.min(5, l.intensity)}`, icon: icon("goal", l.kind), text: shown(l),
        tip: `${name(l.from)}: ${words}${l.most === 5 ? ` (${band(l.level)})` : ""}${held(l.gm)}${l.played ? "" : ` · ${loc("FASTFIGHTING.Goal.NotYet")}`}`,
        adjust: { t: "goal", id: l.from, kind: l.kind, thingId: l.thingId, scale: l.most === 5 ? "band" : "count", intensity: l.intensity },
        ...stepsOf(l.intensity, l.most, { remove: "FASTFIGHTING.Battle.Net.SetAside" })
      });
    }
  }

  for ( const m of net.marks ) {
    if ( m.type === "condition" ) {
      const valued = m.valued || valuedHere.has(m.key);
      markOn(m.on, {
        id: `c:${m.key}`, cls: `is-condition ${m.sheet ? "is-sheet" : ""}`, icon: icon("condition", m.key), text: valued ? String(m.value) : "",
        tip: `${condLabel(m.key)}${valued ? ` ${m.value}` : ""} · ${kept(m.key, m.on)}`,
        adjust: { t: "cond", id: m.on, key: m.key, byId: null, intensity: valued ? m.value : 1 },
        ...stepsOf(valued ? m.value : 1, valued ? m.most ?? null : 1)
      });
    } else if ( m.type === "affliction" ) {
      markOn(m.on, {
        id: `af:${m.afflictionId}`, cls: "is-condition is-affliction", icon: afflictionIcon(m), text: String(m.stage),
        tip: afflictionWords(m),
        adjust: { t: "affliction", id: m.on, afflictionId: m.afflictionId, intensity: m.stage },
        ...stepsOf(m.stage, m.most)
      });
    } else if ( m.type === "status" && m.key !== "unaware" ) {
      // (What it's at with no foe it knows of: behavior/patrol.js. Only shown.)
      markOn(m.on, { id: `s:${m.key}`, cls: "is-status", icon: icon("status", m.key), text: "", tip: loc(m.key === "patrolling" ? "FASTFIGHTING.Battle.Net.Patrolling" : "FASTFIGHTING.Battle.Net.Searching") });
    } else if ( m.type === "status" ) {
      markOn(m.on, { id: `s:${m.key}`, cls: "is-status", icon: icon("status", m.key), text: "", tip: loc("FASTFIGHTING.Battle.Net.Unaware"), adjust: { t: "notice", id: m.on, intensity: 1 }, lower: loc("FASTFIGHTING.Battle.Net.Notices"), raise: null });
    } else if ( m.type === "goal" ) {
      const running = m.kind === "runAway";
      markOn(m.on, {
        id: `g:${m.kind}`, cls: `is-goal g-${m.kind} ${m.played ? "" : "is-stub"}`, icon: icon("goal", m.kind), text: running || m.most === 1 ? "" : String(m.intensity),
        tip: `${fmt(`FASTFIGHTING.Goal.${m.kind}`, { thing: "", name: "" })}${m.most === 5 ? ` (${band(m.level)})` : ""}${held(m.gm)}${m.played ? "" : ` · ${loc("FASTFIGHTING.Goal.NotYet")}`}`,
        adjust: { t: "goal", id: m.on, kind: m.kind, thingId: null, scale: m.most === 5 ? "band" : "count", intensity: m.intensity },
        ...(running
          ? { lower: loc("FASTFIGHTING.Battle.Net.Steady"), raise: m.intensity < 2 ? loc("FASTFIGHTING.Battle.Net.RunNow") : null }
          : stepsOf(m.intensity, m.most, { remove: "FASTFIGHTING.Battle.Net.SetAside" }))
      });
    } else if ( m.type === "desire" ) {
      markOn(m.on, {
        id: `d:${m.kind}`, cls: `is-desire d-${m.kind}`, icon: icon("desire", m.kind), text: String(m.intensity),
        tip: `${fmt("FASTFIGHTING.Battle.Desire", { what: loc(`FASTFIGHTING.Desire.Kind.${m.kind}`), who: loc("FASTFIGHTING.Battle.Net.Itself"), how: band(m.level) })}${held(m.gm)}`,
        adjust: { t: "desire", id: m.on, kind: m.kind, targetId: m.on, intensity: m.intensity },
        ...stepsOf(m.intensity, m.most, { remove: "FASTFIGHTING.Battle.Net.SetAside" })
      });
    } else if ( m.type === "attitude" ) {
      const words = m.kind === "swayed" ? fmt("FASTFIGHTING.Battle.Persuaded", { side: sideLabel(m.side), n: m.intensity, steps: m.steps })
        : fmt(`FASTFIGHTING.Battle.Attitude.${m.kind}`, { side: sideLabel(m.side), how: m.how ? loc(`FASTFIGHTING.Battle.Attitude.how.${m.how}`) : "" });
      markOn(m.on, {
        id: `a:${m.kind}:${m.side ?? ""}`, cls: `is-relation r-${m.kind}`, icon: icon("attitude", m.kind), text: m.most === 1 ? "" : String(m.intensity),
        tip: m.kind === "leans" ? `${words} (${band(m.level)})` : words,
        ...(m.fixed ? {} : { adjust: { t: "attitude", id: m.on, kind: m.kind, side: m.side ?? null, intensity: m.intensity }, ...stepsOf(m.intensity, m.most) })
      });
    }
  }

  // The nodes: every creature in the battle, every token on its map that isn't, and what goals are about.
  const nodes = [];
  for ( const c of net.creatures ) {
    const u = run.byId.get(c.id);
    const doc = docOf(c.id);
    const feet = doc ? feetOnScene(b.scene, doc) : c.pos;
    nodes.push({
      id: c.id, type: "creature", name: u.spec.name, img: doc?.texture?.src ?? u.spec.img ?? "icons/svg/mystery-man.svg",
      cls: [u.side, statusClass(shownStatus(u)), current?.id === c.id ? "is-current" : "", c.hazard ? "is-hazard" : ""].join(" "),
      status: shownStatus(u) === "standing" ? (c.hazard ? "" : `${shownHp(u)}/${u.maxHp}`) : loc(`FASTFIGHTING.Status.${shownStatus(u)}`),
      tip: [u.spec.name, sideLabel(u.side), c.player ? loc("FASTFIGHTING.Battle.PlayerRuns") : "", c.id === focusId ? loc("FASTFIGHTING.Battle.Net.NodeHint") : ""].filter(Boolean).join(" · "),
      x: feet?.x ?? 0, y: feet?.y ?? 0, marks: marks.get(c.id) ?? [],
      team: u.side, leaderId: (() => { const cmd = commandOf(run, u)?.unit; return cmd && cmd !== u ? cmd.id : null; })()
    });
  }
  const inBattle = new Set(run.units.map(tokenIdOf));
  const elsewhere = b.scene.tokens.filter(t => t.actor && !inBattle.has(t.id));
  for ( const t of elsewhere ) {
    const feet = feetOnScene(b.scene, t);
    nodes.push({ id: `token:${t.id}`, type: "elsewhere", name: t.name, img: t.texture?.src ?? "icons/svg/mystery-man.svg", cls: "", status: loc("FASTFIGHTING.Battle.NotInFight"), tip: `${t.name} · ${loc("FASTFIGHTING.Battle.Net.NotInBattle")}`, x: feet.x, y: feet.y, marks: [] });
  }
  for ( const t of net.things ) {
    const owner = net.links.find(l => l.type === "goal" && l.thingId === t.id);
    const near = owner ? nodes.find(n => n.id === owner.from) : null;
    const placed = t.x || t.y;
    nodes.push({
      id: `thing:${t.id}`, type: "thing", name: thingName(t.id), icon: `fa-solid fa-${t.locked ? "lock" : ICONS.thing[t.type] ?? "gears"}`, cls: "",
      tip: thingName(t.id), x: placed ? t.x : (near?.x ?? 0) + 10, y: placed ? t.y : (near?.y ?? 0) + 10, marks: []
    });
  }
  const focus = nodes.some(n => n.id === focusId) ? focusId : null;
  return { graph: { nodes, edges, focus }, panel: panelOf(b, net, nodes, edges, focus, { name, docOf, sideLabel }) };
}

/** The side picked in the Battle Vantage, worked out now (its time is up, or the window closes). */
async function settleSide() {
  const p = pendingSide;
  pendingSide = null;
  if ( !p ) return;
  clearTimeout(p.timer);
  await liveMind({ op: "side", id: p.id, side: p.side, group: p.group });
}

/** The one in focus, beside the map: who it is, what it wants, what's on it, and what the GM can put on it. */
function panelOf(b, net, nodes, edges, focus, { name, docOf, sideLabel }) {
  if ( !focus ) return { none: true };
  const node = nodes.find(n => n.id === focus);
  if ( node.type === "elsewhere" ) return { elsewhere: true, name: node.name, img: node.img, tokenId: focus.slice(6) };
  // (Each line or symbol as a row: its sign, its words, its steps.)
  const row = (e, own = true) => ({
    icon: e.icon, text: own ? (e.short ?? e.tip) : e.tip, cls: e.link?.played === false || e.cls?.includes("is-stub") ? "is-stub" : "",
    steps: e.adjust ? [e.lower ? { dir: -1, tip: e.lower, adjust: JSON.stringify(e.adjust), icon: "fa-minus" } : null, e.raise ? { dir: 1, tip: e.raise, adjust: JSON.stringify(e.adjust), icon: "fa-plus" } : null].filter(Boolean) : []
  });
  if ( node.type === "thing" ) {
    return { thing: true, name: node.name, icon: node.icon, rows: edges.filter(e => e.to === focus).map(e => row(e, false)) };
  }
  const run = b.run;
  const u = run.byId.get(focus);
  const doc = docOf(focus);
  const mind = mindOf(run, focus);
  const players = run.live.players;
  const playable = u.spec.kind === "pc" || (b.data.players ?? []).includes(u.id) || !!doc?.actor?.hasPlayerOwner;
  const mine = e => e.from === focus && ["desire", "goal", "attitude"].includes(e.link.type) || (e.link.type === "relation" && e.link.kind === "shuns" && e.from === focus);
  const onIt = e => e.to === focus && ["condition", "relation"].includes(e.link.type) && e.link.kind !== "shuns";
  const wantsMe = e => e.to === focus && e.link.type === "desire";
  const symbols = node.marks ?? [];
  const setAside = net.setAside.filter(s => s.id === focus).map(s => ({
    icon: s.type === "goal" ? icon("goal", s.kind) : icon("desire", s.kind),
    text: s.type === "goal" ? fmt(`FASTFIGHTING.Goal.${s.kind}`, { thing: s.thingId ?? "", name: name(s.thingId) }) : `${loc(`FASTFIGHTING.Desire.Kind.${s.kind}`)} ${name(s.targetId)}`,
    adjust: JSON.stringify({ t: "release", type: s.type, id: focus, kind: s.kind, targetId: s.targetId ?? null, thingId: s.thingId ?? null })
  }));
  const held = mind.gm.filter(g => g.level > 0).map(g => ({
    icon: icon("desire", g.kind), text: `${loc(`FASTFIGHTING.Desire.Kind.${g.kind}`)} ${name(g.targetId)}`,
    adjust: JSON.stringify({ t: "release", type: "desire", id: focus, kind: g.kind, targetId: g.targetId })
  }));
  const decides = playerRuns(run, u);
  // Its team: a neutral friend group (1 2 3), a hostile group (1 2 3), or the party (F); and its place in its group's
  // chain of command (B L 1 2; the party, no boss), as the planner has them.
  const picked = pendingSide?.id === focus ? pendingSide : null;
  const pill = (side, group, label, name, active) => ({
    side, group, label, name, active: picked ? picked.side === side && (side !== NEUTRAL_PARTY || picked.group === group) : active
  });
  const teams = [
    { kind: "neutral", label: loc("FASTFIGHTING.Side.neutral"), pills: GROUPS.map(n => pill(NEUTRAL_PARTY, n, n, fmt("FASTFIGHTING.Side.neutralGroup", { n }), u.side === NEUTRAL_PARTY && u.friendGroup === n)) },
    { kind: "hostile", label: loc("FASTFIGHTING.Side.hostile"), pills: HOSTILE_GROUPS.map((side, i) => pill(side, null, i + 1, fmt("FASTFIGHTING.Side.hostileGroup", { n: i + 1 }), u.side === side)) },
    { kind: "friendly", label: loc("FASTFIGHTING.Side.friendly"), pills: [pill(SIDES.FRIENDLY, null, loc("FASTFIGHTING.Battle.Net.FriendlyShort"), loc("FASTFIGHTING.Side.friendly"), u.side === SIDES.FRIENDLY)] }
  ];
  const key = groupKeyOf(u);
  const place = key ? (run.prep.command?.[key] ?? []).find(c => c.id === u.id)?.slot ?? null : null;
  const roles = key && run.prep.options.leadership !== false && !u.spec.hazard
    ? SLOTS.filter(s => s !== "boss" || u.side !== SIDES.FRIENDLY).map(s => ({ key: s, short: loc(`FASTFIGHTING.Planner.Role.${s}.Short`), label: loc(`FASTFIGHTING.Planner.Role.${s}.Name`), active: place === s }))
    : null;
  const controller = u.controlledBy ? run.byId.get(u.controlledBy) : null;
  // (Its team's view of the fight, through its head: behavior/stance.js. Whether it goes along with it.)
  const team = key ? run.stance?.[key] : null;
  const stance = team ? `${fmt(`FASTFIGHTING.Battle.Net.Stance.${team.kind}`, { target: run.prep.sides[team.target]?.label ?? sideLabel(team.target ?? "") })}${stanceOf(run, u) ? "" : ` ${loc("FASTFIGHTING.Battle.Net.Stance.notWith")}`}` : "";
  // (None of its players connected: the time left until FastFighting plays it.)
  const deadline = Object.fromEntries(b.data.awayTimers ?? [])[focus];
  const away = Number.isFinite(deadline) && deadline > Date.now() && players.has(focus) ? { deadline, left: clockText(deadline - Date.now()) } : null;
  return {
    creature: true, id: focus, name: u.spec.name, img: node.img, side: sideLabel(u.side), status: loc(`FASTFIGHTING.Status.${shownStatus(u)}`), hp: `${shownHp(u)}/${u.maxHp}`,
    player: players.has(focus), playable, automated: playable && !players.has(focus), away, decides, waiting: !u.active && u.status === "standing",
    wants: decides ? [] : [...edges.filter(mine), ...symbols.filter(m => ["is-desire", "is-goal", "is-relation"].some(c => m.cls.includes(c)))].map(e => row(e)),
    on: [...edges.filter(onIt), ...symbols.filter(m => m.cls.includes("is-condition") || m.cls.includes("is-status"))].map(e => row(e)),
    wantedBy: edges.filter(wantsMe).map(e => row(e, false)),
    setAside: decides ? [] : setAside, held: decides ? [] : held,
    teams, roles, stance, controlled: controller ? fmt("FASTFIGHTING.Battle.Net.Controlled", { name: controller.spec.name }) : ""
  };
}

/** A node's token on the map: a creature's, or one that isn't in the battle ("token:<id>"). */
export function tokenOf(b, id) {
  if ( !b || !id ) return null;
  if ( id.startsWith("token:") ) return id.slice(6);
  const u = b.run.byId.get(id);
  return u ? tokenIdOf(u) : null;
}

/** A held fact, in a few words: "Kyra: Was persuaded by (success)". */
function factText(f, name) {
  const who = name(f.id);
  const key = f.kind === "want" ? { hurt: "hurt", protect: "protect" }[f.desire] : f.kind === "talk" ? f.talk : f.kind === "waver" ? (f.on ? "waver" : "steady") : f.kind === "side" ? "noSide" : f.kind;
  const label = has(`FASTFIGHTING.Battle.Fact.${key}`) ? loc(`FASTFIGHTING.Battle.Fact.${key}`) : key;
  const by = f.byId ?? f.targetId;
  return [who, label, by ? name(by) : "", f.kind === "talk" ? `(${loc(`FASTFIGHTING.Battle.Degree.${f.degree}`)})` : ""].filter(Boolean).join(" ");
}

/**
 * Drawn again whenever the battle changes, and when hit points or the tracker do; a single token the GM selects on
 * the map, in focus.
 */
export function registerBattleVantage() {
  Hooks.on("fastFighting.liveBattle", () => BattleVantage.refresh());
  // (Its encounter ended: no battle left to show, so it closes.)
  Hooks.on("deleteCombat", () => setTimeout(() => {
    if ( !liveBattle() ) foundry.applications.instances.get("fast-fighting-battle")?.close();
  }, 0));
  // (Another scene on screen, or another encounter viewed on the tracker: it follows, showing that one's battle.)
  const follow = () => foundry.applications.instances.get("fast-fighting-battle")?.follow?.();
  Hooks.on("canvasReady", follow);
  Hooks.on("renderCombatTracker", follow);
  let soon = null;
  const later = () => {
    clearTimeout(soon);
    soon = setTimeout(() => BattleVantage.refresh(), 250);
  };
  for ( const hook of ["updateCombat", "updateActor", "updateToken"] ) Hooks.on(hook, later);
  // The map of minds' keys: on what the GM points at (or stepped to), with the pointer over the Battle Vantage;
  // anywhere else, the keys are the canvas's. + and - are the characters typed, wherever a keyboard has them (Foundry's
  // bindings go by a key's place: the key right of 0 is + on some keyboards, - or ö on others); the bindings in
  // Configure Controls (the number pad's, by default, and whatever else the GM sets) work too.
  const KEYS = {
    networkLower: { action: "lower", editable: [{ key: "NumpadSubtract" }] },
    networkRaise: { action: "raise", editable: [{ key: "NumpadAdd" }] },
    networkNext: { action: "next", editable: [{ key: "Tab" }] },
    networkPrevious: { action: "previous", editable: [{ key: "Tab", modifiers: ["Shift"] }] }
  };
  for ( const [name, { action, editable }] of Object.entries(KEYS) ) {
    game.keybindings.register(MODULE_ID, name, {
      name: `FASTFIGHTING.Keybinding.${name}`, hint: `FASTFIGHTING.Keybinding.${name}Hint`, editable, restricted: true,
      precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
      onDown: () => foundry.applications.instances.get("fast-fighting-battle")?.netKey?.(action) ?? false
    });
  }
  // (Ahead of Foundry's keys: + and - as typed, unless a binding of ours has that key already; and Delete over the
  // window never reaches the canvas, where the creature in focus has its token selected.)
  const bound = () => new Set(["networkRaise", "networkLower"].flatMap(n => game.keybindings.get(MODULE_ID, n) ?? []).map(b => b.key));
  window.addEventListener("keydown", event => {
    const app = foundry.applications.instances.get("fast-fighting-battle");
    if ( !game.user?.isGM || !app?.hovering || event.isComposing ) return;
    if ( event.target?.closest?.("input, textarea, select, [contenteditable]") ) return;
    if ( event.key === "Delete" || event.key === "Backspace" ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if ( event.ctrlKey || event.metaKey || event.altKey || bound().has(event.code) ) return;
    const action = event.key === "+" || event.key === "=" ? "raise" : event.key === "-" || event.key === "_" ? "lower" : null;
    if ( action && app.netKey(action) ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, { capture: true });
  Hooks.on("controlToken", (token, controlled) => {
    if ( !controlled || !game.user.isGM || canvas.tokens?.controlled.length !== 1 ) return;
    const app = foundry.applications.instances.get("fast-fighting-battle");
    if ( app?.rendered ) app.focusToken(token.document.id);
  });
}
