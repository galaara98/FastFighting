/**
 * Base class for system adapters. A helper module for another game system subclasses this and registers it:
 *
 *   Hooks.once("fastFighting.init", api => {
 *     api.registerAdapter("my-system", class extends api.SystemAdapter { ... }, { priority: 10 });
 *   });
 *
 * The adapter has two halves:
 *  - Foundry side (async, may read documents): build CombatantSpecs, derive personality traits, find leaders,
 *    cross-check difficulty, and write a live battle's turns onto the sheets (commitChanges).
 *  - Pure side: `rules`, a plain object the engine calls thousands of times. It must not touch Foundry.
 *
 * Recognising things: find a system's features, actions and spells by their slug or identifier (PF2e `slug`,
 * dnd5e `system.identifier`), never by name. Slugs are the same in every book, every edition of the free rules
 * and every language; names change with translations, reprints and homebrew copies. Use the name only as a fallback,
 * and prefer reading what an item does (its activities, effects, rule elements) over recognising it at all, so
 * content nobody has seen yet (paid books, homebrew) still works.
 */
import { CORE_CONDITIONS } from "../engine/conditions.js";
import { statusesOf, statusEntry, toggleStatus } from "../foundry/sheet-tools.js";
import { gearOf, startLoaded, reloads } from "../engine/gear.js";

/**
 * A spec's gear as its sheet had it when the spec was read (readLiveState's `gear`): what must be drawn first is out of
 * hand, what needs no draw in hand; what reloads, loaded as it says.
 */
export function gearOfSpec(spec) {
  const inHand = new Set();
  const out = new Set();
  const loaded = {};
  for ( const a of spec?.actions ?? [] ) {
    if ( a.drawCost !== undefined ) ((Number(a.drawCost) || 0) > 0 ? out : inHand).add(gearOf(a));
    if ( reloads(a) ) loaded[gearOf(a)] = startLoaded(a);
  }
  return { inHand: [...inHand].filter(k => !out.has(k)), out: [...out], loaded };
}

export class SystemAdapter {
  /** @type {string} */
  static systemId = "";

  /** Human-readable name shown in the GM window. */
  get label() {
    return this.constructor.name;
  }

  /** Pure rules object; see FastFighting PF2e (scripts/rules.js) or scripts/adapters/generic/rules.js for the expected shape. */
  get rules() {
    throw new Error(`${this.constructor.name} must provide rules`);
  }

  /**
   * Where the same rules can be imported on a background thread, so the planner's fights run on workers (API 22,
   * engine/batch-pool.js): the module's url (from the helper's own: `new URL("./rules.js", import.meta.url).href`), the
   * export that is the rules (or a function making them from `data`), and `data`, the settings those rules read, as
   * plain data (anything a structured clone copies). The module and everything it imports must load without Foundry's
   * globals, and the rules mustn't need them as they play (labels: a worker's game.i18n gives back each key). Null, as
   * here: the fights run on the main thread, as before.
   * @returns {{url: string, exportName?: string, data?: *}|null}
   */
  workerRules() {
    return null;
  }

  /** Whether this adapter can build a combatant from the token's actor. */
  canHandle(actor) {
    return !!actor;
  }

  /**
   * Build a CombatantSpec (see scripts/engine/battle-state.js) for a token.
   * @param {TokenDocument} tokenDoc
   * @returns {Promise<object|null>}
   */
  async toCombatantSpec(tokenDoc) {
    throw new Error(`${this.constructor.name} must implement toCombatantSpec`);
  }

  /**
   * Default personality for an actor: {tactical, brave, selfish, loyal} on 0-100, plus flags and the reasons
   * shown as tooltips in the GM window.
   */
  deriveTraits(actor) {
    return { traits: { tactical: 50, brave: 50, selfish: 40, loyal: 50 }, flags: {}, reasons: {} };
  }

  /**
   * Rank possible leaders on one side.
   * @param {object[]} specs   the side's CombatantSpecs
   * @returns {{id: string, score: number, reason: string, bonus: object}[]}
   */
  detectLeaders(specs) {
    return [];
  }

  /**
   * What a system-specific region behavior means for a fight (core behaviors are handled already). Optional.
   * @param {RegionBehavior} behavior
   * @returns {{types?: string[], difficult?: boolean, hazardous?: boolean}|null}
   *   types: environment tags such as "aquatic"; difficult: difficult terrain for walkers; hazardous: dangerous ground
   */
  describeRegionBehavior(behavior) {
    return null;
  }

  /**
   * The system's own word for a stat, for {AC}, {HP}, {SP} and {MONEY} in FastFighting's text (in the client's language).
   * @param {"ac"|"hp"|"sp"|"money"|"level"} key   ac: how hard a creature is to hit; hp: how much harm it can take; sp:
   *   stamina, spent before hit points (a spec's hp.stamina); money: what paying costs (coins; Ironsworn's Supply);
   *   level: how far along a creature is (the planner shows it beside each one)
   * @returns {string|null|false}  the word; null: FastFighting's generic one; false: the system has none (not shown)
   */
  term(key) {
    return null;
  }

  /**
   * The system's own settings for an encounter: a section of the planner (Ironsworn: one progress track for the
   * encounter, its rank, who keeps it). Each field's answer is kept with the plan (setup.system[key]).
   * @param {object} context   {roster, setup, resolved: side by token id, chains: who commands each group}
   * @returns {{title: string, hint?: string, fields: {key: string, label: string, hint?: string, type: "pills"|"select",
   *   value: string, choices: {value: string, label: string, hint?: string}[]}[]}|null}
   */
  plannerSettings(context) {
    return null;
  }

  /**
   * Apply the answers to the planner's system section to a battle (its combatants, spec.options.system for the real fight).
   * @param {object} spec       the BattleSpec, as built
   * @param {object} settings   setup.system
   * @param {object} context    {setup, roster, resolved}
   */
  applyPlannerSettings(spec, settings, context) {}

  /**
   * The encounter's own record, beyond each token's (Ironsworn: its progress track, kept on one character), for the
   * planner's summary of what a fight changes: {title, lines}, or null for none.
   */
  describeEncounter(spec, replay) {
    return null;
  }

  /**
   * The system's own kinds of item: its item categories, materials and rarities, each [{key, label}] in the system's
   * words. A CombatantSpec's valuables name each item's category, material and rarity by these keys. Empty lists: the
   * system has none of them. (Nothing in the core asks for it at present.)
   * @returns {{categories: {key: string, label: string}[], materials: {key: string, label: string}[], rarities: {key: string, label: string}[]}}
   */
  itemCatalog() {
    return { categories: [], materials: [], rarities: [] };
  }

  /**
   * Does its real fight leave loot (a lootable corpse, a pile of gear) and take a corpse away, as the lootMode and
   * corpseMode settings ask? Without, those settings aren't shown.
   */
  get supportsLoot() {
    return false;
  }

  /**
   * A readable name for a resource pool key (as used in CombatantSpec.resources), for the Resources tab.
   * Return null to fall back to the name of the action that spends it.
   */
  resourceLabel(key, spec) {
    return null;
  }

  /**
   * The playstyles its system says fit a character (its class, ancestry or heritage, kind of creature, alignment, gear,
   * role), for the one time FastFighting picks them itself (foundry/auto-config.js): {playstyleId: -1 to 1} (1, just
   * like it; -1, nothing like it). The core weighs these with what its numbers and actions say and its biography's
   * keywords. Optional.
   * @param {Actor} actor
   * @param {object} spec  its CombatantSpec
   * @returns {Record<string, number>}
   */
  playstyleHints(actor, spec) {
    return {};
  }

  /**
   * The system's own answers to the tactics questions: the truest source of what a character would most likely do (its
   * class and subclass, features, spells, gear, alignment, kind of creature), over the core's reading of its hidden
   * scores. What "Let this character decide" stands for, kept with the character and shown to the GM with its reason.
   * {question: answer} or {question: {value, why}} (why: the reason the GM sees, in the reader's language: a class's or
   * feature's own name), any of TACTIC_KEYS, each one of the question's choices (preferredAction: one of its actions'
   * ids). Anything else is left out (API 14's `offer` and `expect` among them). Optional.
   * @param {Actor} actor
   * @param {object} spec   its CombatantSpec
   * @param {object} calc   the core's answers, to build on
   * @returns {Record<string, string|object>}
   */
  tacticHints(actor, spec, calc) {
    return {};
  }

  /**
   * Its biography and description, as plain text, for its keywords (keywords/en.json: what they say of its playstyles
   * and traits). A string is all about the character; or `{about, story, against}`: what's said of the character itself
   * (its description, personality, beliefs, appearance), counted in full; a story told about it (a backstory, campaign
   * notes: its words may be about anyone in it), counted a little; and what it's against (its dislikes, its anathema),
   * counted the other way ("dislikes cowards": a bolder one). Leave out what's about others (its allies, its enemies).
   * Optional.
   */
  biography(actor) {
    return "";
  }

  /** What a fight changes on a creature (its end state, final), for the planner's summary of a fight. */
  describeOutcome(spec, final) {
    return [];
  }

  /* -------------------------------------------- */
  /*  Live battles                                */
  /* -------------------------------------------- */

  /**
   * Can it play a live battle (the players run their characters, FastFighting the rest, a turn at a time)? Only a
   * helper whose commitChanges writes one turn's changes safely, mid-fight; without, Do it For Real Now can't be done
   * (the planner says the helper needs updating).
   */
  get supportsLive() {
    return false;
  }

  /**
   * A token as its sheet stands now, mid-fight, for the engine (engine/live.js syncFromSheets): {hp, temp, stamina,
   * maxHp, dying, wounded, doomed, stable, status ("standing" | "down" | "dead"), conditions {engineKey: value},
   * persistent [DamagePart], resources {key: n}, shieldRaised, gear: {inHand, out, loaded} (API 20: its weapons and things
   * in hand or not, by gear key, and the rounds loaded in what reloads: engine/gear.js)}. Positions the core reads
   * itself. By default, from a fresh CombatantSpec (its actions' drawCost and loaded); a helper may read only what
   * changes, more cheaply.
   * @param {TokenDocument} tokenDoc
   * @returns {Promise<object|null>}
   */
  // (context: {spec, unit}, the battle's spec and the creature as the engine has it: what the battle set up that its
  // sheet alone doesn't say, such as Ironsworn's one track for the encounter.)
  async readLiveState(tokenDoc, context = {}) {
    const spec = await this.toCombatantSpec(tokenDoc);
    if ( !spec ) return null;
    // (Its statuses as its effects carry them too: a system such as dcc leaves actor.statuses empty.)
    const dead = statusesOf(tokenDoc.actor).has("dead") || (spec.hp.value <= 0 && spec.diesAtZero);
    return {
      hp: spec.hp.value, temp: spec.hp.temp ?? 0, stamina: spec.hp.stamina?.value, maxHp: spec.hp.max, dying: spec.dying ?? 0,
      wounded: spec.wounded ?? 0, doomed: spec.doomed ?? 0, status: dead ? "dead" : spec.hp.value > 0 ? "standing" : "down",
      conditions: { ...(spec.conditions ?? {}) }, persistent: spec.persistent ?? [], resources: { ...(spec.resources ?? {}) },
      gear: gearOfSpec(spec)
    };
  }

  /**
   * A live battle (API 20): a step a creature FastFighting plays took to get ready (behavior/prepare.js), carried out on
   * its sheet the system's way, as it happens in the turn (before the system's next roll): `step` "draw" (the action's
   * weapon in hand, `hands` of them), "retrieve" (an item got out: a potion), "reload" (loaded) or "stand" (up off the
   * ground); `actionId`, `gear` (its gear key) and `item` (its name) say what. Its cards are the system's own (PF2e's
   * Interact card, its Stand). Returns {records: undo records, about this token's and actor's sheet only (Rewind puts
   * them back)}, or null (nothing done: the turn's change set has what it can say, a stand's prone).
   * @param {TokenDocument} tokenDoc
   * @param {object} step   {step, actionId, gear, item, hands, secret}
   * @returns {Promise<object|null>}
   */
  async readyGear(tokenDoc, step) {
    return null;
  }

  /**
   * Write one turn's change set (engine/changes.js) onto a token, mid-fight: only what changed, so writing it twice
   * changes nothing more. Every helper that plays live battles (supportsLive) has its own.
   * @param {TokenDocument} tokenDoc
   * @param {object} spec      its CombatantSpec, as read at the turn's start
   * @param {object} changes   what the turn changed (changes.js)
   * @param {object} final     its state after the turn (captureUnit)
   * @param {object} options   {lootMode, corpseMode, fledMode, live}
   * @returns {Promise<object>} an undo record: {tokenUuid, actorUuid, actorUpdate, itemUpdates, createdItems,
   *   deletedItems, createdEffects, tokenUpdate, createdActors, createdTokens, deletedTokens, statuses, combatant}
   */
  // (options.before: the creature as the turn found it, captureUnit's shape, for what the change set leaves out;
  // options.effectSource(key): the action (or reaction) that laid a buff or debuff, and whose spec, for a helper to put its
  // effect on. API 21: options.tokenOf(id), a creature's token by its id in the run (an effect's `sourceId`), and
  // options.audience(id), who sees that creature's cards ("public" or "gm": table-rolls.js audienceFor), for a card it
  // posts naming who got what (PF2e's); every card it posts as it writes is the turn's, taken back with it. The change
  // set's `laid` (conditions an effect laid, whose) and `left` (what the table settles itself: name it, don't write it):
  // engine/changes.js.)
  async commitChanges(tokenDoc, spec, changes, final, options) {
    throw new Error(`${this.constructor.name} does not support live battles`);
  }

  /**
   * A live battle: a creature tied up (a prisoner: engine/behavior/fallen.js), or no longer, marked on its sheet. By
   * default, the system's status for being restrained (its "restrained", or Foundry's "restrain"); a helper whose
   * system has a better way may do it its own. Returns an undo record, or null.
   * @param {TokenDocument} tokenDoc
   * @param {boolean} bound
   */
  async commitBound(tokenDoc, bound) {
    const actor = tokenDoc?.actor;
    const id = ["restrained", "restrain", "bound"].find(s => statusEntry(s));
    if ( !actor || !id ) return null;
    const undo = { tokenUuid: tokenDoc.uuid, actorUuid: actor.uuid, statuses: [] };
    return (await toggleStatus(actor, id, bound, undo)) ? undo : null;
  }

  /**
   * A live battle: whether this system's sheets carry one of the engine's conditions (by its key): its commitChanges
   * writes it there (changes.conditions set and cleared) and its readLiveState reads it back as that key. One they
   * carry, the sheet says whether it's still there; one they don't (PF2e has nothing for losing a turn to Command), the
   * core keeps itself, between turns and in the Battle Vantage. By default, none: a helper says which. Given the
   * creature's actor, for that one's sheet (an Ironsworn foe has no debilities); without, for any.
   * @param {string} key
   * @param {Actor} [actor]
   */
  sheetCarries(key, actor) {
    return false;
  }

  /**
   * The system's own word for one of the engine's conditions (by its key), for the Battle Vantage; null for the
   * core's own.
   * @param {string} key
   * @returns {string|null}
   */
  conditionLabel(key) {
    return null;
  }

  /**
   * The conditions the GM can put on a creature here: the core's (engine/conditions.js), and any of the system's own
   * that its rules give meaning to, as engine keys: [{key, valued}]. A helper adds its system's to the core's.
   * @returns {{key: string, valued?: boolean}[]}
   */
  conditionChoices() {
    return [...CORE_CONDITIONS];
  }

  /**
   * A live battle: creatures a summoning called, onto the scene at `places` (top-left corners), on the summoner's side.
   * By default each from the creature its CombatantSpec came from (spec.sourceUuid), brought into the world from its
   * compendium if it's there (once: the same one is used again). A helper whose system summons (dnd5e) does it the
   * system's way. Returns {tokens: [TokenDocument], records: [undo record]}, the tokens in the order of `creatures`.
   * @param {Scene} scene
   * @param {TokenDocument} summonerDoc
   * @param {object} action        the summoning (an action of kind "summon")
   * @param {object[]} creatures   their CombatantSpecs
   * @param {{x: number, y: number}[]} places
   */
  async placeSummons(scene, summonerDoc, action, creatures, places) {
    const data = [];
    const createdActors = [];
    for ( const [i, c] of creatures.entries() ) {
      const source = c.sourceUuid ? await fromUuid(c.sourceUuid) : null;
      if ( !source || !places[i] ) continue;
      let actor = source;
      if ( source.pack ) {
        actor = game.actors.find(a => a._stats?.compendiumSource === source.uuid) ?? null;
        if ( !actor ) {
          actor = await Actor.implementation.create(game.actors.fromCompendium(source));
          if ( actor ) createdActors.push(actor.uuid);
        }
      }
      if ( !actor ) continue;
      const token = await actor.getTokenDocument({ x: places[i].x, y: places[i].y, elevation: summonerDoc.elevation ?? 0, disposition: summonerDoc.disposition, actorLink: false });
      data.push(token.toObject());
    }
    const tokens = data.length ? await scene.createEmbeddedDocuments("Token", data) : [];
    return { tokens, records: [{ createdTokens: tokens.map(t => t.uuid), createdActors }] };
  }

  /**
   * A live battle: whether a card a player's character made is it lowering its guard in a foe's reach (a ranged attack,
   * a manipulate action), for the foes' opportunity strikes where the system's rules.opportunityOn names "foeOpening".
   * @param {ChatMessage} message
   * @param {string} tokenId   the character's token
   */
  liveOpening(message, tokenId) {
    return false;
  }

  /**
   * How a live battle's turns come: "initiative" (the tracker's order, Next Turn) or "spotlight" (no initiative: the GM
   * gives the spotlight to whoever acts, as Daggerheart's tracker does; FastFighting can suggest whom).
   */
  get liveTurns() {
    return "initiative";
  }

  /**
   * A spotlight system: the spotlight given to a combatant, or handed back (null), the system's own way (its tracker may
   * do more than set the turn). By default, the combat's turn set to it, or cleared.
   * @param {Combat} combat
   * @param {Combatant|null} combatant
   */
  async giveSpotlight(combat, combatant) {
    const at = combatant ? combat.turns.findIndex(c => c.id === combatant.id) : -1;
    return combat.update({ turn: at >= 0 ? at : null });
  }

  /**
   * Pools the world keeps for everyone, not on any sheet (Daggerheart's Fear), as they stand now: {key: n} for the
   * engine's shared pools, read before each turn it plays. Null: none.
   */
  livePools() {
    return null;
  }

  /**
   * What one live turn did to what the encounter keeps beyond each token (Daggerheart's Fear, Ironsworn's encounter
   * track): written, with undo records returned. `before`, `after`: every creature as the turn found and left it
   * (captureUnit's shape); options.spec the battle's, options.events the turn's log.
   */
  async commitTurn(before, after, options) {
    return [];
  }

  /**
   * What the system already does itself for the creatures FastFighting plays, so the engine leaves it be: {recovery,
   * persistent, afflictions, repeatSaves}, each true or false (default: FastFighting does it all).
   */
  liveOwnership() {
    return {};
  }

  /**
   * A character's reactions, for its player to say always use / ask me / never: [{id, label}], each id as its
   * CombatantSpec's reactions have it (and "opportunity" for the opportunity strike, where the system has one). A
   * reaction marked `passive` (always on, like a brawler's Toughness) is no one's choice and isn't listed.
   * @param {object} spec   its CombatantSpec
   */
  reactionsOf(spec) {
    // (A passive one, always on, isn't a choice.)
    const out = (spec?.reactions ?? []).filter(r => !r.passive).map(r => ({ id: r.id, label: r.label ?? r.name ?? r.id }));
    if ( this.rules?.opportunity ) out.push({ id: "opportunity", label: null });
    return out;
  }

  /** The system's resource that buys a reroll (PF2e Hero Points, 5e Heroic Inspiration), by its word, or null. */
  rerollResource() {
    return null;
  }

  /**
   * What a player did on their turn, read from the chat cards the turn made (the system's rolls): events in the
   * engine's own log shapes (attack, save, heal, talk, control ...), each with a `sure` flag (false: the GM should
   * look). Optional: by default nothing is read, and the core goes by the sheets.
   * @param {ChatMessage[]} messages
   * @param {object} context   {actorId, tokenId, ids: {tokenId: combatant id in the battle}}
   * @returns {object[]}
   */
  readTurn(messages, context) {
    return [];
  }

  /**
   * API 19. A chat card's damage, if it is one (a player's damage roll in a live battle, for the core to apply or to
   * ask a GM to): {amount, kind: "damage"|"healing", targets: [tokenId], save (the target rolls a save first, so a GM
   * decides how much lands)}, or null. Optional: by default null, and the core goes by the sheets at the turn's end.
   * @param {ChatMessage} message
   * @param {object} context   {ids: {tokenId: unit id in the battle}}
   */
  damageCard(message, context) {
    return null;
  }

  /**
   * API 19. Apply a damage card to one token through the system's own damage handling (its resistances, weaknesses,
   * temporary hit points and dying rules), times `multiplier` (0.5 half, 2 double). Also used for the damage of a
   * strike rolled with rollStrike, in a turn FastFighting plays: then the options may name a reaction the system's own
   * application does (a reaction's `applies` in its spec, true here: PF2e's `shieldBlock`, 5e's `halve`), and `amount`
   * is the engine's own sum, after the target's resistances and its share (for a system whose application has no
   * resistances of its own: DCC's stat lines). Returns undo records (sheet-tools undoRecord, the values as they were) for
   * Rewind. API 21: with "card", a heal's healing card too (showTableRoll's), applied as healing.
   * @param {ChatMessage} message
   * @param {TokenDocument} token
   * @returns {Promise<object[]>}
   */
  async applyDamageCard(message, token, { multiplier = 1, amount = null } = {}) {
    return [];
  }

  /**
   * API 21. A damage or healing card of FastFighting's own (rollStrike's, rollDamage's, showTableRoll's) that it won't
   * apply after all: the table settles it itself (a player's character's at another, Apply players' damage off). Put
   * the system's own Apply back on it, where a helper took it off (PF2e: its mark, cards.js). Optional.
   * @param {ChatMessage} message
   */
  async leaveToTable(message) {
    return null;
  }

  /**
   * API 19. A strike rolled with the system's own roller, as a player would roll it, its cards in the chat: the attack
   * (`action`: the engine's strike, {id, name}, at `target`, a TokenDocument) and, a hit, its damage. Every strike in a
   * turn FastFighting plays in a live battle (the token's moves before it are on the map already), and a reaction's.
   * `attackNumber`: the attacks it has made this turn before this one (0 for a reaction), for a multiple attack
   * penalty. `secret`: for the GMs' eyes only (the GM keeps its name secret). Returns {attack: {degree: 0-3, natural,
   * total, dice}, damage: {byType: {type: amount}} | null} (damage as rolled, before resistances; a critical's as the
   * system doubles it; `dice`, optional numbers, the system's own dice for rules.asRolled), or null where it can't (the
   * engine rolls it). Its damage card, the first of the cards it made that
   * damageCard reads as damage, is applied with applyDamageCard; or the one `card` names (a message id), where the
   * result has it: `card: null` where no one card holds all of the blow (DCC: a critical's table damage). API 20:
   * `records`, undo records for what the roll changed on the striker's own sheet beyond its cards (PF2e: ammunition
   * loaded and spent), kept with the turn for Rewind; taken even from a result that says no degree (`{records}`: the
   * engine rolls it). Optional.
   */
  rollStrike(token, { action, target, attackNumber = 0, secret = false }) {
    return null;
  }

  /**
   * API 19. An action's own card, as its user would show it from the sheet (a spell's, a breath's, a blast's), in a
   * turn FastFighting plays: nothing rolled, spent or applied (FastFighting does those). `action`: {id, name}, the
   * action's id as the helper gave it; `targets`: TokenDocuments it's aimed at (the user's targets may be set for the
   * card); `secret`: for the GMs' eyes only. Returns {card: message id} (its damage is rolled from it: rollDamage), or
   * null where there's none to show (a card its strike or check roll shows already). Optional.
   */
  useAction(token, { action, targets = [], secret = false }) {
    return null;
  }

  /**
   * API 19. The damage of an action that isn't an attack (one a save resists, or that simply lands), rolled with the
   * system's own roller once for all it catches, its card in the chat; FastFighting applies each target's share
   * through applyDamageCard, with its save's multiplier. `action`: {id, name, strikeOf} (`strikeOf`: the id of the
   * Strike whose damage it deals with no roll of its own, where the helper's action named one: PF2e's Rend); `card`:
   * useAction's card, where it made one; `target`: the TokenDocument it's aimed at first, or null; `secret`. Returns
   * {damage: {byType: {type: amount}}, card: message id} (as rolled, before resistances), or null (the engine rolls
   * it, and shows its dice: engine/table-rolls.js). Optional.
   */
  rollDamage(token, { action, card = null, secret = false, target = null }) {
    return null;
  }

  /**
   * API 19. A save rolled with the system's own roller, as its player would roll it, its card in the chat: every save in
   * a turn FastFighting plays in a live battle (on its player's screen, where a player's character makes it and they're
   * here). `save`: the save's key as the helper's rules name it; `dc`; `action`: what it's against ({id, name}: an
   * action's id as the helper gave it, else null and a name: a condition, a sickness); `from`: the TokenDocument of
   * whoever made it save, or null; `secret`: for the GMs' eyes only. Returns {degree: 0-3, natural, total, dice, card}
   * (`card`, optional: its message id, for a change the rules make to it: adjustRolled); or
   * {gm: true} where the system's roll needs a GM's judgment the helper's code can't make (a GM says how it went); or
   * null (the engine rolls it). Optional.
   */
  rollSave(token, { save, dc, action, from = null, secret = false }) {
    return null;
  }

  /**
   * API 19. A change the helper's rules made to a roll the system made (rules.adjustRoll with ctx.rolled true, asking
   * run.live.roll for kind "adjust"), carried out on that roll's card the system's way, as its player would from the
   * card (Ironsworn: momentum burned). `card`: the message id the roll's result named (rollSave's or rollCheck's
   * `card`); `adjust`: what the rules made of it (the helper's own word: "burnMomentum"); `secret`. Returns {done: true},
   * or null where it couldn't (the rules keep the roll as it fell). Optional.
   */
  adjustRolled(token, { card, adjust, secret = false }) {
    return null;
  }

  /**
   * API 19. A check rolled with the system's own roller, its card in the chat: every check in a turn FastFighting plays
   * in a live battle (a maneuver, a taunt or a threat, words, first aid, an escape, a theft, a spell check). `purpose`:
   * what it's for ("control", "talk", "aid", "heal", "firstAid", "escape", "theft", "disengage", "cast"; or one the
   * helper's own rules ask for through systemRolled, PF2e's "flat" and "tumble"); `skill`: the
   * skill the spec names, where it names one; `against`: the defense it's rolled against (a control check's);
   * `attackNumber`: for a check with the attack trait, the attacks made this turn before it (a multiple attack penalty;
   * else null); `standoff` (API 20): true while a standoff holds, no blows struck yet (PF2e's words: Make an Impression,
   * not Request); `dc`; `action` ({id, name}); `target`: the TokenDocument it's aimed at, or null; `secret`. Returns as
   * rollSave does. Optional.
   */
  rollCheck(token, { purpose, skill = null, against = null, attackNumber = null, standoff = false, dc, action, target = null, secret = false }) {
    return null;
  }

  /**
   * API 20. A table roll the engine made with its own dice in a live battle (engine/table-rolls.js: `roll`, {by, target,
   * kind, label, what, action, stat, source, mod, total, dc, natural, degree, dice, groups, multiplier, crit}), shown as
   * the system's own card: its check card for an attack, a save, a check or a flat check (the target, the DC, the
   * outcome, the engine's die and modifier), its damage card for damage and healing (`rolledParts(roll)`, core-api: each
   * part's type and dice as they fell), and so on. Styling only: the engine's result stands, its dice exactly, and
   * nothing the system does with the card may change it. `token`: the roller's TokenDocument (null: no one's); `target`:
   * the one it was at, or null; `audience`: "public" or "gm" (the GMs only: table-rolls.js rollAudience); `flavor`: the
   * core's words for it, no DC; `flags`: FastFighting's own, to put on every message it makes (so it's never read as a
   * player's card, and Rewind finds it); `scene`. A damage card made here may be applied with applyDamageCard (in a turn
   * FastFighting plays, damage the engine rolled: the "card" roll then "apply"), so mark it as one the system's own
   * buttons mustn't apply again. Returns its messages' ids, a damage roll's damage card first; or null, for the core's
   * plain roll. Optional: without it, every table roll is a plain Foundry Roll. API 21: a heal is a table roll even with
   * no dice (so many hit points: its parts' numbers), and its card names whom it heals (`target`) and how much.
   */
  showTableRoll(roll, { token = null, target = null, audience = "public", flavor = "", flags = {}, scene = null } = {}) {
    return null;
  }

  /**
   * API 19. An area laid on the map in a live battle, as the system lays its own: `data` is the shape FastFighting made
   * (Foundry's region shape data: {type: "cone"|"line"|"circle", x, y, radius|length, angle, width, rotation}, in
   * pixels), `area` the action's ({shape, feet}). Return it as the system draws that area (PF2e: a cone is a quarter
   * turn wide), or null to leave it. Who's in it is tested against this shape, walls blocking.
   */
  areaShape(data, { area } = {}) {
    return null;
  }

  /**
   * API 19. Does a critical hit from a foe's reaction disrupt what the player's character did (the card `message` that
   * opened it up)? PF2e: a manipulate action, against Reactive Strike. Default no.
   */
  disruptsAction(message) {
    return false;
  }

  /**
   * API 19. Does the system let token nameplates decide whether players learn an NPC's name (PF2e's Tokens Determine
   * NPC Name Visibility)? Then a live battle's story names a creature only where its nameplate shows to everyone, as
   * the system's own cards do. Default false: the story names it once a player's character has seen it.
   */
  namesFollowNameplates() {
    return false;
  }

  /**
   * API 19. The system's (or a module's) own setting that already applies players' damage, while it's on: its name, as
   * the GM sees it in the settings; else null. While it is, FastFighting's own is greyed out and applies nothing.
   */
  appliesPlayerDamage() {
    return null;
  }
}
