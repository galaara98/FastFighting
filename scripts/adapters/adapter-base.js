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
   * @param {object[]} entries  [{spec, actor}]
   * @returns {{id: string, score: number, reason: string, bonus: object}[]}
   */
  detectLeaders(entries) {
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
   * @param {"ac"|"hp"|"sp"|"money"} key   ac: how hard a creature is to hit; hp: how much harm it can take; sp:
   *   stamina, spent before hit points (a spec's hp.stamina); money: what paying costs (coins; Ironsworn's Supply)
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
   * The kinds of thing a character can ask for in a standoff (never a particular item): the system's own item
   * categories, materials and rarities, each [{key, label}] in the system's words. A CombatantSpec's valuables name
   * each item's category, material and rarity by these keys. Empty lists: the system has none of them.
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
   * ids); and `offer` and `expect` (API 14: what it puts on the table to end an argument and what it wants, as the
   * survey stores them: {kind: "" | "money" | "noHarm" | "passage" | "leave", amount, coin}). Optional.
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
   * persistent [DamagePart], resources {key: n}, shieldRaised}. Positions the core reads itself. By default, from a
   * fresh CombatantSpec; a helper may read only what changes, more cheaply.
   * @param {TokenDocument} tokenDoc
   * @returns {Promise<object|null>}
   */
  // (context: {spec, unit}, the battle's spec and the creature as the engine has it: what the battle set up that its
  // sheet alone doesn't say, such as Ironsworn's one track for the encounter.)
  async readLiveState(tokenDoc, context = {}) {
    const spec = await this.toCombatantSpec(tokenDoc);
    if ( !spec ) return null;
    // (Its statuses as its effects carry them too: a system such as dcc leaves actor.statuses empty.)
    const actor = tokenDoc.actor;
    const marked = id => actor?.statuses?.has?.(id) || [...(actor?.effects ?? [])].some(e => !e.disabled && e.statuses?.has?.(id));
    const dead = marked("dead") || (spec.hp.value <= 0 && spec.diesAtZero);
    return {
      hp: spec.hp.value, temp: spec.hp.temp ?? 0, stamina: spec.hp.stamina?.value, maxHp: spec.hp.max, dying: spec.dying ?? 0,
      wounded: spec.wounded ?? 0, doomed: spec.doomed ?? 0, status: dead ? "dead" : spec.hp.value > 0 ? "standing" : "down",
      conditions: { ...(spec.conditions ?? {}) }, persistent: spec.persistent ?? [], resources: { ...(spec.resources ?? {}) }
    };
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
  // options.effectSource(key): the action that laid a buff or debuff, and whose spec, for a helper to put its effect on.)
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
    // (Foundry keeps them as a list; a system may keep its own by id, as PF2e does.)
    const all = Array.isArray(CONFIG.statusEffects) ? CONFIG.statusEffects : Object.values(CONFIG.statusEffects ?? {});
    const id = ["restrained", "restrain", "bound"].find(s => all.some(e => e?.id === s));
    if ( !actor || !id ) return null;
    const has = actor.statuses?.has?.(id) || [...(actor.effects ?? [])].some(e => !e.disabled && e.statuses?.has?.(id));
    if ( has === bound ) return null;
    await actor.toggleStatusEffect(id, { active: bound });
    return { tokenUuid: tokenDoc.uuid, actorUuid: actor.uuid, statuses: [{ id, active: !bound }] };
  }

  /**
   * A live battle: whether this system's sheets carry one of the engine's conditions (by its key): its commitChanges
   * writes it there (changes.conditions set and cleared) and its readLiveState reads it back as that key. One they
   * carry, the sheet says whether it's still there; one they don't (PF2e has nothing for losing a turn to Command), the
   * core keeps itself, between turns and in the Battle Interface. By default, none: a helper says which. Given the
   * creature's actor, for that one's sheet (an Ironsworn foe has no debilities); without, for any.
   * @param {string} key
   * @param {Actor} [actor]
   */
  sheetCarries(key, actor) {
    return false;
  }

  /**
   * The system's own word for one of the engine's conditions (by its key), for the Battle Interface; null for the
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
}
