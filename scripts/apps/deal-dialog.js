/**
 * A player's deal, on their own turn in a live battle (engine/behavior/deals.js): opened from the card their turn brings
 * ("I want to bribe or extort"), in their browser. They pick whom (in talking range; whoever they target, first), what
 * (pay them to leave, pay them to keep away from us, or make them pay: an amount, nothing at all just to see them go),
 * the skill they make it with (every one their character has: the talking ones first, then the rest by name), and what
 * they give: their things, dragged into the offer (as many as they say, of a stack), and their money, coin by coin.
 *
 * Making it: the GM's browser, where the battle plays, says whether the two understand each other and what it takes
 * (foundry/live-battle.js answerDealRequest: "prepare"); the character rolls the skill the system's way (its helper's
 * rollCheck), and the roll goes back to the GM (`rolled`), whose review settles it.
 */
import { MODULE_ID } from "../constants.js";
import { getAdapter } from "../api.js";
import { localize } from "../i18n.js";
import { QUERIES } from "../foundry/tactics.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const loc = key => localize(key);

/** What a deal may be, as the dialog offers it: its kind and what it asks. */
const KINDS = Object.freeze([
  { value: "bribeLeave", kind: "bribe", ask: "leave" },
  { value: "bribeAvoid", kind: "bribe", ask: "avoid" },
  { value: "extort", kind: "extort", ask: "leave" }
]);
/** The talking skills first, in this order: persuading, deceiving, threatening. */
const TALK_ORDER = Object.freeze(["persuade", "deceive", "intimidate"]);
/** How far a creature makes itself heard (feet), where the system doesn't say (engine/behavior/deals.js TALK_RANGE). */
const TALK_RANGE = 30;

export class DealDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ff-deal-dialog",
    tag: "form",
    classes: ["fast-fighting", "ff-deal-dialog"],
    window: { title: "FASTFIGHTING.Deal.DialogTitle", icon: "fa-solid fa-coins", resizable: true },
    position: { width: 520, height: "auto" },
    form: { handler: DealDialog.#onChange, submitOnChange: true, closeOnSubmit: false },
    actions: { offer: DealDialog.#onOffer, add: DealDialog.#onAdd, remove: DealDialog.#onRemove }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/deal-dialog.hbs`, scrollable: [".ff-deal-goods"] }
  };

  /** @param {TokenDocument} token  the player's character's token */
  constructor(token, options = {}) {
    super(options);
    this.token = token;
    this.adapter = getAdapter();
    const targeted = [...(game.user.targets ?? [])].map(t => t.document).find(t => t && t !== token);
    this.state = { target: targeted?.id ?? null, kind: "bribeLeave", skill: null, money: {}, offer: new Map(), busy: false };
  }

  /** Those it could make a deal with: on the map, seen, not itself, in talking range (by the grid's own measure). */
  get targets() {
    const from = this.token.object?.center;
    const range = Number(this.adapter?.rules?.talkRange) > 0 ? Number(this.adapter.rules.talkRange) : TALK_RANGE;
    const shown = [CONST.TOKEN_DISPLAY_MODES.ALWAYS, CONST.TOKEN_DISPLAY_MODES.HOVER];
    let unknown = 0;
    return (this.token.parent?.tokens ?? []).filter(t => t !== this.token && t.actor && !t.hidden && t.object?.isVisible).map(t => {
      const to = t.object?.center;
      const feet = from && to ? canvas.grid.measurePath([from, to]).distance : Infinity;
      return { id: t.id, feet, name: t.isOwner || shown.includes(t.displayName) ? t.name : localize("FASTFIGHTING.Desire.Unknown", { n: ++unknown }) };
    }).filter(t => t.feet <= range).sort((a, b) => a.feet - b.feet);
  }

  /** Its skills: the talking ones first (persuading, deceiving, threatening), then the rest by name. */
  get skills() {
    const all = this.adapter?.skillsOf?.(this.token.actor) ?? [];
    const talk = all.filter(s => s.talk).sort((a, b) => TALK_ORDER.indexOf(a.talk) - TALK_ORDER.indexOf(b.talk));
    const rest = all.filter(s => !s.talk).sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
    return [...talk, ...rest];
  }

  async _prepareContext() {
    const kind = KINDS.find(k => k.value === this.state.kind) ?? KINDS[0];
    const goods = this.adapter?.giveables?.(this.token.actor) ?? { money: 0, denominations: [], items: [] };
    const skills = this.skills;
    // (The skill it'd make it with, unless they pick another: persuading for a bribe, threatening for a demand.)
    const fit = skills.find(s => s.talk === (kind.kind === "bribe" ? "persuade" : "intimidate"));
    this.state.skill ??= fit?.key ?? skills[0]?.key ?? null;
    const targets = this.targets;
    if ( !targets.some(t => t.id === this.state.target) ) this.state.target = targets[0]?.id ?? null;
    const offered = [...this.state.offer.entries()].map(([id, count]) => {
      const item = goods.items.find(i => i.id === id);
      return item ? { ...item, count: Math.min(count, item.quantity) } : null;
    }).filter(Boolean);
    return {
      name: this.token.name,
      targets: targets.map(t => ({ ...t, selected: t.id === this.state.target })),
      kinds: KINDS.map(k => ({ value: k.value, label: loc(`FASTFIGHTING.Deal.Kind.${k.value}`), selected: k.value === kind.value })),
      bribe: kind.kind === "bribe",
      skills: skills.map(s => ({ ...s, mod: s.mod >= 0 ? `+${s.mod}` : `${s.mod}`, selected: s.key === this.state.skill, talking: !!s.talk })),
      denominations: (goods.denominations ?? []).map(d => ({ ...d, value: Number(this.state.money[d.key]) || 0 })),
      items: goods.items.filter(i => !this.state.offer.has(i.id)),
      offered,
      purse: goods.money,
      canOffer: !!this.state.target && !!this.state.skill && !this.state.busy
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    // (Their things, dragged into the offer.)
    for ( const row of this.element.querySelectorAll("[data-item]") ) {
      row.addEventListener("dragstart", event => event.dataTransfer?.setData("text/plain", row.dataset.item));
    }
    const box = this.element.querySelector(".ff-deal-offer");
    box?.addEventListener("dragover", event => event.preventDefault());
    box?.addEventListener("drop", event => {
      event.preventDefault();
      const id = event.dataTransfer?.getData("text/plain");
      if ( id ) this.#put(id, 1);
    });
  }

  #put(id, count) {
    const item = (this.adapter?.giveables?.(this.token.actor)?.items ?? []).find(i => i.id === id);
    if ( !item ) return;
    this.state.offer.set(id, Math.max(1, Math.min(item.quantity, Math.round(Number(count) || 1))));
    this.render();
  }

  static #onAdd(event, target) {
    this.#put(target.dataset.id, 1);
  }

  static #onRemove(event, target) {
    this.state.offer.delete(target.dataset.id);
    this.render();
  }

  static async #onChange(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    if ( data.target ) this.state.target = data.target;
    if ( data.kind && data.kind !== this.state.kind ) {
      this.state.kind = data.kind;
      this.state.skill = null;
    } else if ( data.skill ) this.state.skill = data.skill;
    for ( const [k, v] of Object.entries(data.money ?? {}) ) this.state.money[k] = Math.max(0, Math.round(Number(v) || 0));
    for ( const [id, v] of Object.entries(data.count ?? {}) ) if ( this.state.offer.has(id) ) this.#put(id, v);
    this.render();
  }

  /** The deal made: asked of the GM, rolled the system's way, the roll sent back. */
  static async #onOffer() {
    const gm = game.users.activeGM;
    const kind = KINDS.find(k => k.value === this.state.kind) ?? KINDS[0];
    const goods = this.adapter?.giveables?.(this.token.actor) ?? { denominations: [] };
    const money = (goods.denominations ?? []).reduce((s, d) => s + (Number(this.state.money[d.key]) || 0) * d.value, 0);
    const items = kind.kind === "bribe" ? [...this.state.offer.entries()].map(([id, count]) => ({ id, count })) : [];
    const target = this.token.parent?.tokens.get(this.state.target);
    if ( !gm || !target ) return ui.notifications.warn(loc("FASTFIGHTING.Deal.NoGm"));
    this.state.busy = true;
    this.render();
    try {
      const deal = { pcToken: this.token.uuid, targetToken: target.uuid, kind: kind.kind, ask: kind.ask, money, items: kind.kind === "bribe" ? items : [], skill: this.state.skill };
      const prep = await gm.query(QUERIES.liveDeal, { stage: "prepare", deal }, { timeout: 60000 });
      if ( !prep?.ok ) {
        if ( prep?.reason ) ui.notifications.info(loc(`FASTFIGHTING.Deal.Why.${prep.reason}`));
        return this.close();
      }
      const skill = this.skills.find(s => s.key === this.state.skill);
      let roll = await this.adapter?.rollCheck?.(this.token, {
        purpose: prep.purpose, skill: this.state.skill, dc: prep.dc, action: { id: null, name: prep.purpose }, target, deal: { kind: prep.purpose, ask: kind.ask, wordless: prep.wordless }
      }).catch(() => null);
      // (No roller of the system's: the core's own d20, its card in the chat.)
      if ( !roll ) {
        const r = await new Roll("1d20 + @mod", { mod: Number(skill?.mod) || 0 }).evaluate();
        await r.toMessage({ speaker: ChatMessage.getSpeaker({ token: this.token }), flavor: skill?.label ?? "" });
        roll = { natural: r.dice[0]?.total ?? null, total: r.total };
      }
      await gm.query(QUERIES.liveDeal, { stage: "rolled", key: prep.key, roll: { degree: roll.degree ?? null, natural: roll.natural ?? null, total: roll.total ?? null } }, { timeout: 600000 });
      this.close();
    } catch ( err ) {
      console.warn(`${MODULE_ID} | a deal`, err);
      this.state.busy = false;
      this.render();
    }
  }
}
