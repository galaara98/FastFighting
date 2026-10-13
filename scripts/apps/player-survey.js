/**
 * The player's pre-battle survey: one spreadsheet-style tab per token they control on the battle map, and per character
 * of theirs with no token there (charactersForUser), and the Party tab last. Opened by the GM's "Prepare Players" (on
 * the Party tab, to vote on), by the GM's question about one character (on that character), or by the player any time
 * ("My tactics" in the Encounters tab). The party's questions are voted on only in the survey the GM sends everyone,
 * until the player locks its choices in (a swipe) or closes the survey; otherwise they're there to look at. A GM can
 * open one character's survey for every GM, to answer for a player who's away (that character only). Answers save as
 * they change and sync live between everyone who controls the same token or character.
 */
import { MODULE_ID } from "../constants.js";
import { getAdapter, characterSpec } from "../api.js";
import { localize, hasStat } from "../i18n.js";
import { sceneEncounter } from "../foundry/persistence.js";
import { ensureAutoConfig, resetAndAutoConfig } from "../foundry/auto-config.js";
import { partyContext, castVote, partyState, lockInParty } from "../foundry/party.js";
import {
  questionsContext, setTactic, togglePlaystyle, syncTacticsDom, charactersForUser, setOwnSurveyStatus, SURVEY_STATUS, playstyleSignature
} from "../foundry/tactics.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const loc = key => localize(key);
/** The Party tab's id among the survey's tabs. */
const PARTY_TAB = "party";

/**
 * Who a player can name in a desire: the creatures it perceives on the battle map (the scene it's looking at, with token
 * vision: not hidden, within its sight), so the survey never gives away what lurks in the dark. Where that can't be
 * told (another scene, no token vision), only the encounter's combatants there, not those hidden from the players; with
 * no encounter, nobody. Each by its name only where the player could read it on the map (its nameplate shown to all,
 * or its own token); else as someone, numbered.
 */
function nameable(scene) {
  if ( !scene ) return [];
  const tokens = canvas.scene?.id === scene.id && scene.tokenVision
    ? scene.tokens.filter(o => o.actor && !o.hidden && o.object?.isVisible)
    : (sceneEncounter(scene)?.combatants ?? []).filter(c => !c.hidden).map(c => c.token).filter(t => t?.actor && !t.hidden);
  const shown = [CONST.TOKEN_DISPLAY_MODES.ALWAYS, CONST.TOKEN_DISPLAY_MODES.HOVER];
  let unknown = 0;
  return tokens.map(o => ({ id: o.id, name: o.isOwner || shown.includes(o.displayName) ? o.name : localize("FASTFIGHTING.Desire.Unknown", { n: ++unknown }) }));
}

export class PlayerSurvey extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fast-fighting-survey",
    tag: "form",
    classes: ["fast-fighting", "ff-survey"],
    window: { title: "FASTFIGHTING.Survey.Title", icon: "fa-solid fa-clipboard-question", resizable: true },
    position: { width: 640, height: 640 },
    form: { handler: PlayerSurvey.#onChange, submitOnChange: true, closeOnSubmit: false },
    actions: { sheetTab: PlayerSurvey.#onTab, ready: PlayerSurvey.#onReady, resetAll: PlayerSurvey.#onResetAll, togglePlaystyle: PlayerSurvey.#onTogglePlaystyle, setMotive: PlayerSurvey.#onSetMotive, partyVote: PlayerSurvey.#onPartyVote }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/player-survey.hbs`,
      templates: [`modules/${MODULE_ID}/templates/partials/tactics.hbs`, `modules/${MODULE_ID}/templates/partials/party.hbs`],
      scrollable: [".ff-survey-sheet"]
    }
  };

  /**
   * Open (or focus) the survey for a scene.
   * @param {object} [options]
   * @param {string} [options.start]          the tab it opens on: "party", or a character's key
   * @param {string} [options.only]           that character alone (a GM's survey for it)
   */
  static async open({ sceneId, requestId, start, only } = {}) {
    let app = foundry.applications.instances.get("fast-fighting-survey");
    if ( !app ) app = new PlayerSurvey();
    app.sceneId = sceneId ?? app.sceneId ?? canvas.scene?.id;
    // (Opened by the player itself while the GM's request is still open: that request, as the GM asked it.)
    const pending = !game.user.isGM && !requestId ? game.user.getFlag(MODULE_ID, "survey") : null;
    const open = pending && [SURVEY_STATUS.REQUESTED, SURVEY_STATUS.ENTERING].includes(pending.status) && pending.sceneId === app.sceneId ? pending : null;
    app.requestId = requestId ?? open?.requestId ?? app.requestId ?? null;
    app.only = game.user.isGM ? only ?? null : null;
    const first = start ?? open?.start;
    if ( first ) app.activeTab = first;
    app.finished = false;
    app.specs.clear(); // re-read characters each time the survey opens
    await app.render({ force: true });
    app.bringToFront?.();
    if ( !game.user.isGM ) await setOwnSurveyStatus(SURVEY_STATUS.ENTERING, app.sceneId, app.requestId);
    return app;
  }

  constructor(options) {
    super(options);
    this.sceneId = null;
    this.requestId = null;
    this.activeTab = null;
    this.only = null;
    this.sawParty = false;
    this.finished = false;
    this.specs = new Map();
  }

  get scene() {
    return game.scenes.get(this.sceneId) ?? canvas.scene;
  }

  async _prepareContext() {
    const adapter = getAdapter();
    const scene = this.scene;
    const entries = charactersForUser(scene, game.user).filter(e => !this.only || e.key === this.only);
    this.entries = new Map(entries.map(e => [e.key, e]));
    const targets = nameable(scene);
    const sheets = [];
    for ( const e of entries ) {
      // Reading strikes and spells is slow; answers don't change them, so keep what was read at opening. (A character
      // with no token on the map is read as its token would be.)
      let spec = this.specs.get(e.key) ?? null;
      if ( !spec ) {
        try {
          spec = await characterSpec(adapter, e.token ?? await e.actor.getTokenDocument());
        } catch ( err ) {
          console.warn(`${MODULE_ID} | survey could not read ${e.name}`, err);
        }
        if ( !spec ) continue;
        this.specs.set(e.key, spec);
      }
      // (Never set up, or its calculated answers out of date: set up by itself first.)
      await ensureAutoConfig(e.actor, spec);
      const others = game.users.filter(u => u !== game.user && !u.isGM && e.actor.testUserPermission(u, "OWNER"));
      sheets.push({
        id: e.key,
        name: e.name,
        img: spec.img,
        hp: `${spec.hp.value}/${spec.hp.max}`,
        ac: spec.defenses.ac,
        showAc: hasStat("ac"),
        level: spec.level,
        sharedWith: others.map(u => u.name).join(", "),
        sharedOnline: others.some(u => u.active),
        tactics: questionsContext(spec, e.actor, e.key, { targets })
      });
    }
    // The last tab: the party's wishes, every player's vote on them (one vote per player, not per character). Not in a
    // GM's survey for one character.
    const partyTab = this.only ? null : { id: PARTY_TAB, name: loc("FASTFIGHTING.Party.Tab"), icon: "fa-solid fa-people-group", party: true };
    if ( partyTab && !game.user.isGM ) {
      // (Locked in: a green border. Left while the vote is open and not locked in: orange.)
      const state = partyState(game.user);
      partyTab.tooltip = loc(state.locked ? "FASTFIGHTING.Party.LockedIn" : "FASTFIGHTING.Party.NotLockedIn");
      partyTab.lock = state.locked ? "is-locked" : state.open && this.sawParty && this.activeTab !== PARTY_TAB ? "is-unlocked" : "";
    }
    if ( !(partyTab && this.activeTab === PARTY_TAB) && !sheets.some(s => s.id === this.activeTab) ) this.activeTab = sheets[0]?.id ?? (partyTab ? PARTY_TAB : null);
    const tabs = partyTab ? [...sheets, partyTab] : sheets;
    for ( const s of tabs ) s.active = s.id === this.activeTab;
    const onParty = !!partyTab && this.activeTab === PARTY_TAB;
    if ( onParty ) this.sawParty = true;
    return {
      sceneName: scene?.name,
      sheets: tabs,
      active: onParty ? null : sheets.find(s => s.active) ?? null,
      onParty,
      party: onParty ? partyContext() : null,
      empty: !sheets.length,
      intro: game.i18n.localize("FASTFIGHTING.Survey.Intro")
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    // A survey opened while the player's tab is in the background can be sized against a 0x0 viewport.
    if ( this.element.offsetWidth < 400 && window.innerWidth > 0 ) {
      const width = Math.min(640, window.innerWidth - 40);
      const height = Math.min(640, window.innerHeight - 80);
      this.setPosition({ width, height, left: (window.innerWidth - width) / 2, top: 60 });
    }
  }

  /**
   * Keep other people's edits flowing in without stealing focus. Playstyle changes alter what
   * "Let this character decide" means, so those re-render.
   */
  syncActor(actor) {
    if ( !this.rendered ) return;
    syncTacticsDom(this.element, actor);
    this.signatures ??= new Map();
    const sig = playstyleSignature(actor);
    const before = this.signatures.get(actor.uuid);
    this.signatures.set(actor.uuid, sig);
    if ( before !== undefined && before !== sig ) this.render();
  }

  static async #onChange(event) {
    const el = event?.target;
    // (The Lock-in swipe: all the way across locks the choices in; short of it, back it goes.)
    if ( el?.dataset?.swipe === "lockIn" ) {
      if ( Number(el.value) >= 95 ) await lockInParty();
      else el.value = 0;
      return this.render();
    }
    const key = el?.dataset?.tactic;
    if ( !key ) return;
    const actor = await fromUuid(el.dataset.actorUuid);
    const value = el.type === "checkbox" ? el.checked : el.value;
    el.closest(".ff-q")?.classList.toggle("is-auto", value === "auto");
    await setTactic(actor, key, value);
    if ( el.type === "checkbox" ) this.render();
  }

  static async #onTogglePlaystyle(event, target) {
    const actor = await fromUuid(target.dataset.actorUuid);
    const ok = await togglePlaystyle(actor, target.dataset.playstyle);
    if ( !ok ) ui.notifications.warn(loc("FASTFIGHTING.Playstyle.Max"));
    this.render();
  }

  /** What it offers, or expects: the kind (each shows fields of its own). */
  static async #onSetMotive(event, target) {
    const actor = await fromUuid(target.dataset.actorUuid);
    await setTactic(actor, `${target.dataset.motive}.kind`, target.dataset.kind);
    this.render();
  }

  /** A vote on how the party should act (the same again: taken back). Everyone's survey shows it at once. */
  static async #onPartyVote(event, target) {
    await castVote(target.dataset.question, target.dataset.answer);
    this.render();
  }

  /** Someone voted: the Party tab shows it. */
  syncParty() {
    // (Once, however many votes come in at once.)
    this.#redrawParty ??= foundry.utils.debounce(() => {
      if ( this.rendered && this.activeTab === PARTY_TAB ) this.render();
    }, 150);
    this.#redrawParty();
  }

  #redrawParty = null;

  static async #onTab(event, target) {
    this.activeTab = target.dataset.tab;
    this.render();
  }

  static async #onReady() {
    this.finished = true;
    // (Done: its party votes stand as they are until the GM sends everyone a new survey.)
    if ( !game.user.isGM ) await setOwnSurveyStatus(SURVEY_STATUS.DONE, this.sceneId, this.requestId, { partyOpen: false });
    ui.notifications.info(loc("FASTFIGHTING.Survey.Thanks"));
    await this.close();
  }

  static async #onResetAll(event, target) {
    const id = target.dataset.tokenId ?? this.activeTab;
    const actor = this.entries?.get(id)?.actor;
    if ( !actor ) return;
    await resetAndAutoConfig(actor, this.specs.get(id));
    this.render();
  }

  async _onClose(options) {
    await super._onClose?.(options);
    if ( !game.user.isGM && !this.finished ) await setOwnSurveyStatus(SURVEY_STATUS.CLOSED, this.sceneId, this.requestId, { partyOpen: false });
  }
}
