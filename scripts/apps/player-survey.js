/**
 * The player's pre-battle survey: one spreadsheet-style tab per token they control on the battle map.
 * Answers save as they change and sync live between everyone who controls the same token.
 */
import { MODULE_ID } from "../constants.js";
import { getAdapter } from "../api.js";
import {
  questionsContext, setTactic, togglePlaystyle, syncTacticsDom, tokensForUser, setOwnSurveyStatus, SURVEY_STATUS, playstyleSignature
} from "../foundry/tactics.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const loc = key => game.i18n.localize(key);

export class PlayerSurvey extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fast-fighting-survey",
    tag: "form",
    classes: ["fast-fighting", "ff-survey"],
    window: { title: "FASTFIGHTING.Survey.Title", icon: "fa-solid fa-clipboard-question", resizable: true },
    position: { width: 640, height: 640 },
    form: { handler: PlayerSurvey.#onChange, submitOnChange: true, closeOnSubmit: false },
    actions: { sheetTab: PlayerSurvey.#onTab, ready: PlayerSurvey.#onReady, resetAll: PlayerSurvey.#onResetAll, togglePlaystyle: PlayerSurvey.#onTogglePlaystyle }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/player-survey.hbs`,
      templates: [`modules/${MODULE_ID}/templates/partials/tactics.hbs`],
      scrollable: [".ff-survey-sheet"]
    }
  };

  /** Open (or focus) the survey for a scene. */
  static async open({ sceneId, requestId } = {}) {
    let app = foundry.applications.instances.get("fast-fighting-survey");
    if ( !app ) app = new PlayerSurvey();
    app.sceneId = sceneId ?? app.sceneId ?? canvas.scene?.id;
    app.requestId = requestId ?? app.requestId ?? null;
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
    this.finished = false;
    this.specs = new Map();
  }

  get scene() {
    return game.scenes.get(this.sceneId) ?? canvas.scene;
  }

  async _prepareContext() {
    const adapter = getAdapter();
    const scene = this.scene;
    const tokens = tokensForUser(scene, game.user);
    const sheets = [];
    for ( const t of tokens ) {
      // Reading strikes and spells is slow; answers don't change them, so keep what was read at opening.
      let spec = this.specs.get(t.id) ?? null;
      if ( !spec ) {
        try {
          spec = await adapter.toCombatantSpec(t);
        } catch ( err ) {
          console.warn(`${MODULE_ID} | survey could not read ${t.name}`, err);
        }
        if ( !spec ) continue;
        this.specs.set(t.id, spec);
      }
      const others = game.users.filter(u => u !== game.user && !u.isGM && t.actor.testUserPermission(u, "OWNER"));
      sheets.push({
        id: t.id,
        name: t.name,
        img: spec.img,
        hp: `${spec.hp.value}/${spec.hp.max}`,
        ac: spec.defenses.ac,
        level: spec.level,
        sharedWith: others.map(u => u.name).join(", "),
        sharedOnline: others.some(u => u.active),
        tactics: questionsContext(spec, t.actor, t.id)
      });
    }
    if ( !sheets.some(s => s.id === this.activeTab) ) this.activeTab = sheets[0]?.id ?? null;
    for ( const s of sheets ) s.active = s.id === this.activeTab;
    return {
      sceneName: scene?.name,
      sheets,
      active: sheets.find(s => s.active) ?? null,
      empty: !sheets.length,
      intro: game.i18n.format("FASTFIGHTING.Survey.Intro", { scene: scene?.name ?? "" })
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
   * "Let them decide" means, so those re-render unless someone is typing.
   */
  syncActor(actor) {
    if ( !this.rendered ) return;
    syncTacticsDom(this.element, actor);
    this.signatures ??= new Map();
    const sig = playstyleSignature(actor);
    const before = this.signatures.get(actor.uuid);
    this.signatures.set(actor.uuid, sig);
    const typing = this.element.contains(document.activeElement) && document.activeElement?.tagName === "TEXTAREA";
    if ( before !== undefined && before !== sig && !typing ) this.render();
  }

  static async #onChange(event) {
    const el = event?.target;
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

  static #onTab(event, target) {
    this.activeTab = target.dataset.tab;
    this.render();
  }

  static async #onReady() {
    this.finished = true;
    if ( !game.user.isGM ) await setOwnSurveyStatus(SURVEY_STATUS.DONE, this.sceneId, this.requestId);
    ui.notifications.info(loc("FASTFIGHTING.Survey.Thanks"));
    await this.close();
  }

  static async #onResetAll(event, target) {
    const id = target.dataset.tokenId ?? this.activeTab;
    const token = this.scene?.tokens.get(id);
    if ( !token?.actor ) return;
    await token.actor.unsetFlag(MODULE_ID, "tactics");
    this.render();
  }

  async _onClose(options) {
    await super._onClose?.(options);
    if ( !game.user.isGM && !this.finished ) await setOwnSurveyStatus(SURVEY_STATUS.CLOSED, this.sceneId, this.requestId);
  }
}
