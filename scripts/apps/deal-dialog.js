/**
 * A player's deal, on their own turn in a live battle (engine/behavior/deals.js): opened from the card their turn brings
 * ("I want to bribe or extort"), in their browser. They pick whom (in talking range; whoever they target, first), what
 * (pay them to leave, pay them to keep away from us, or make them pay: an amount, nothing at all just to see them go;
 * and, for one that acted before all its foes or surprised them, ask them to pay for its going: a toll),
 * the skill they make it with (every one their character has: the talking ones first, then the rest by name), and what
 * they give: their things, dragged into the offer (as many as they say, of a stack), and their money, coin by coin.
 *
 * Whom: only those it perceives (seen, heard, or otherwise found), from where it stands, as the GM's browser tells it
 * (foundry/live-battle.js answerDealRequest: "targets").
 * Making it: the GM's browser, where the battle plays, says whether the two understand each other and what it takes
 * (foundry/live-battle.js answerDealRequest: "prepare"); the character rolls the skill the system's way (its helper's
 * rollCheck), and the roll goes back to the GM (`rolled`), whose review settles it.
 */
import { MODULE_ID } from "../constants.js";
import { getAdapter } from "../api.js";
import { localize } from "../i18n.js";
import { QUERIES } from "../foundry/tactics.js";
import { cardGm } from "../foundry/chat.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const loc = key => localize(key);

/** What a deal may be, as the dialog offers it: its kind and what it asks. */
const KINDS = Object.freeze([
  { value: "bribeLeave", kind: "bribe", ask: "leave" },
  { value: "bribeAvoid", kind: "bribe", ask: "avoid" },
  { value: "extort", kind: "extort", ask: "leave" },
  // (Only for one that acted before all its foes, or surprised them: its turn's card says.)
  { value: "toll", kind: "toll", ask: "leave", toll: true }
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
    position: { width: 480, height: "auto" },
    form: { handler: DealDialog.#onChange, submitOnChange: true, closeOnSubmit: false },
    actions: { offer: DealDialog.#onOffer, add: DealDialog.#onAdd, remove: DealDialog.#onRemove }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/deal-dialog.hbs`, scrollable: [".ff-deal-goods"] }
  };

  /**
   * @param {TokenDocument} token  the player's character's token
   * @param {object} [options]     {toll: it may ask a toll; names: what the story calls those whose names the players
   *                               haven't learned, by token id; gmId: the GM whose browser plays the battle, its deal
   *                               card's author}, and the application's own
   */
  constructor(token, { toll = false, names = null, gmId = null, ...options } = {}) {
    super(options);
    this.token = token;
    this.gmId = gmId;
    this.names = names && typeof names === "object" ? names : null;
    // (Those it perceives, by token id, once the GM's browser has said: null till then, or with no answer.)
    this.perceived = null;
    this.asked = false;
    this.kinds = KINDS.filter(k => !k.toll || toll);
    this.adapter = getAdapter();
    const targeted = [...(game.user.targets ?? [])].map(t => t.document).find(t => t && t !== token);
    this.pick = { target: targeted?.id ?? null, kind: "bribeLeave", skill: null, money: {}, offer: new Map(), busy: false };
  }

  /**
   * Those it could make a deal with: on the map, shown, perceived (as the GM's browser says, where it answered), not of
   * its side, in talking range (by the grid's own measure).
   */
  get targets() {
    const from = this.token.object?.center;
    const range = Number(this.adapter?.rules?.talkRange) > 0 ? Number(this.adapter.rules.talkRange) : TALK_RANGE;
    const shown = [CONST.TOKEN_DISPLAY_MODES.ALWAYS, CONST.TOKEN_DISPLAY_MODES.HOVER];
    let unknown = 0;
    // (Not its own side's: a neutral, or a foe.)
    const own = this.token.disposition;
    const NEUTRAL = CONST.TOKEN_DISPOSITIONS.NEUTRAL;
    const perceived = t => !this.perceived || this.perceived.has(t.id);
    return (this.token.parent?.tokens ?? []).filter(t => t !== this.token && t.actor && !t.hidden && t.object?.isVisible && perceived(t) && (t.disposition !== own || own === NEUTRAL)).map(t => {
      const to = t.object?.center;
      const feet = from && to ? canvas.grid.measurePath([from, to]).distance : Infinity;
      // (As the story calls it, where the card says: someone, numbered, till the party learns its name. Else by its
      // nameplate, numbered here.)
      const told = this.names ? (typeof this.names[t.id] === "string" ? this.names[t.id] : t.name) : null;
      const name = t.isOwner || shown.includes(t.displayName) ? t.name : told ?? localize("FASTFIGHTING.Desire.Unknown", { n: ++unknown });
      return { id: t.id, feet, name };
    }).filter(t => t.feet <= range).sort((a, b) => a.feet - b.feet);
  }

  /** The GM asked: the one playing the battle, while they're here (cardGm). */
  get gm() {
    return cardGm(game.users, this.gmId);
  }

  /** Its skills: the talking ones first (persuading, deceiving, threatening), then the rest by name. */
  get skills() {
    const all = this.adapter?.skillsOf?.(this.token.actor) ?? [];
    const talk = all.filter(s => s.talk).sort((a, b) => TALK_ORDER.indexOf(a.talk) - TALK_ORDER.indexOf(b.talk));
    const rest = all.filter(s => !s.talk).sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
    return [...talk, ...rest];
  }

  async _prepareContext() {
    // (Whom it perceives from where it stands, and what the story calls them: the GM's browser's say, asked once.)
    if ( !this.asked ) {
      this.asked = true;
      const said = await this.gm?.query(QUERIES.liveDeal, { stage: "targets", pcToken: this.token.uuid }, { timeout: 10000 }).catch(() => null);
      if ( said?.ok && Array.isArray(said.ids) ) {
        this.perceived = new Set(said.ids);
        if ( said.names && typeof said.names === "object" ) this.names = said.names;
      }
    }
    const kind = this.kinds.find(k => k.value === this.pick.kind) ?? this.kinds[0];
    const goods = this.adapter?.giveables?.(this.token.actor) ?? { money: 0, denominations: [], items: [] };
    const skills = this.skills;
    // (The skill it'd make it with, unless they pick another: persuading for a bribe, threatening for a demand.)
    const fit = skills.find(s => s.talk === (kind.kind === "bribe" ? "persuade" : "intimidate"));
    this.pick.skill ??= fit?.key ?? skills[0]?.key ?? null;
    const targets = this.targets;
    if ( !targets.some(t => t.id === this.pick.target) ) this.pick.target = targets[0]?.id ?? null;
    const offered = [...this.pick.offer.entries()].map(([id, count]) => {
      const item = goods.items.find(i => i.id === id);
      return item ? { ...item, count: Math.min(count, item.quantity) } : null;
    }).filter(Boolean);
    return {
      name: this.token.name,
      targets: targets.map(t => ({ ...t, selected: t.id === this.pick.target })),
      kinds: this.kinds.map(k => ({ value: k.value, label: loc(`FASTFIGHTING.Deal.Kind.${k.value}`), selected: k.value === kind.value })),
      bribe: kind.kind === "bribe",
      toll: kind.kind === "toll",
      skills: skills.map(s => ({ ...s, mod: s.mod >= 0 ? `+${s.mod}` : `${s.mod}`, selected: s.key === this.pick.skill, talking: !!s.talk })),
      denominations: (goods.denominations ?? []).map(d => ({ ...d, value: Number(this.pick.money[d.key]) || 0 })),
      items: goods.items.filter(i => !this.pick.offer.has(i.id)),
      offered,
      purse: goods.money,
      canOffer: !!this.pick.target && !!this.pick.skill && !this.pick.busy
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
    this.pick.offer.set(id, Math.max(1, Math.min(item.quantity, Math.round(Number(count) || 1))));
    this.render();
  }

  static #onAdd(event, target) {
    this.#put(target.dataset.id, 1);
  }

  static #onRemove(event, target) {
    this.pick.offer.delete(target.dataset.id);
    this.render();
  }

  static async #onChange(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    if ( data.target ) this.pick.target = data.target;
    if ( data.kind && data.kind !== this.pick.kind ) {
      this.pick.kind = data.kind;
      this.pick.skill = null;
    } else if ( data.skill ) this.pick.skill = data.skill;
    for ( const [k, v] of Object.entries(data.money ?? {}) ) this.pick.money[k] = Math.max(0, Math.round(Number(v) || 0));
    for ( const [id, v] of Object.entries(data.count ?? {}) ) if ( this.pick.offer.has(id) ) this.#put(id, v);
    this.render();
  }

  /** The deal made: asked of the GM, rolled the system's way, the roll sent back. */
  static async #onOffer() {
    const gm = this.gm;
    const kind = this.kinds.find(k => k.value === this.pick.kind) ?? this.kinds[0];
    const goods = this.adapter?.giveables?.(this.token.actor) ?? { denominations: [] };
    const money = (goods.denominations ?? []).reduce((s, d) => s + (Number(this.pick.money[d.key]) || 0) * d.value, 0);
    const items = kind.kind === "bribe" ? [...this.pick.offer.entries()].map(([id, count]) => ({ id, count })) : [];
    const target = this.token.parent?.tokens.get(this.pick.target);
    if ( !gm || !target ) return ui.notifications.warn(loc("FASTFIGHTING.Deal.NoGm"));
    this.pick.busy = true;
    this.render();
    try {
      const deal = { pcToken: this.token.uuid, targetToken: target.uuid, kind: kind.kind, ask: kind.ask, money, items: kind.kind === "bribe" ? items : [], skill: this.pick.skill };
      const prep = await gm.query(QUERIES.liveDeal, { stage: "prepare", deal }, { timeout: 60000 });
      if ( !prep?.ok ) {
        if ( prep?.reason ) ui.notifications.info(loc(`FASTFIGHTING.Deal.Why.${prep.reason}`));
        return this.close();
      }
      const skill = this.skills.find(s => s.key === this.pick.skill);
      const before = new Set(game.messages.keys());
      let roll = await this.adapter?.rollCheck?.(this.token, {
        purpose: prep.purpose, skill: this.pick.skill, dc: prep.dc, action: { id: null, name: prep.purpose }, target, deal: { kind: prep.purpose, ask: kind.ask, wordless: prep.wordless }
      }).catch(() => null);
      // (No roller of the system's: the core's own d20, its card in the chat.)
      if ( !roll ) {
        const r = await new Roll("1d20 + @mod", { mod: Number(skill?.mod) || 0 }).evaluate();
        await r.toMessage({ speaker: ChatMessage.getSpeaker({ token: this.token }), flavor: skill?.label ?? "" });
        roll = { natural: r.dice[0]?.total ?? null, total: r.total };
      }
      // (Its roll's cards: the GM's browser reads them for this deal only, not as the turn's.)
      const cards = game.messages.contents.filter(m => !before.has(m.id) && m.author?.id === game.user.id).map(m => m.id);
      await gm.query(QUERIES.liveDeal, { stage: "rolled", key: prep.key, roll: { degree: roll.degree ?? null, natural: roll.natural ?? null, total: roll.total ?? null }, cards }, { timeout: 600000 });
      this.close();
    } catch ( err ) {
      console.warn(`${MODULE_ID} | a deal`, err);
      this.pick.busy = false;
      this.render();
    }
  }
}
