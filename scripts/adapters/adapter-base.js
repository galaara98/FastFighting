/**
 * Base class for system adapters. A helper module for another game system subclasses this and registers it:
 *
 *   Hooks.once("fastFighting.init", api => {
 *     api.registerAdapter("my-system", class extends api.SystemAdapter { ... }, { priority: 10 });
 *   });
 *
 * The adapter has two halves:
 *  - Foundry side (async, may read documents): build CombatantSpecs, derive personality traits, find leaders,
 *    cross-check difficulty, and commit a chosen outcome back to the tokens ("Make it So").
 *  - Pure side: `rules`, a plain object the engine calls thousands of times. It must not touch Foundry.
 *
 * Recognising things: find a system's features, actions and spells by their slug or identifier (PF2e `slug`,
 * dnd5e `system.identifier`), never by name. Slugs are the same in every book, every edition of the free rules
 * and every language; names change with translations, reprints and homebrew copies. Use the name only as a fallback,
 * and prefer reading what an item does (its activities, effects, rule elements) over recognising it at all, so
 * content nobody has seen yet (paid books, homebrew) still works.
 */
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
   * (commitOutcome's options.effectSource(id) finds the action that laid a lingering effect, final.effects, so the
   * helper can leave it on the creature, from the action's own effectRef.)
   *
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
   * Apply the answers to the planner's system section to a battle (its combatants, spec.options.system for Make it So).
   * @param {object} spec       the BattleSpec, as built
   * @param {object} settings   setup.system
   * @param {object} context    {setup, roster, resolved}
   */
  applyPlannerSettings(spec, settings, context) {}

  /**
   * The encounter's own record, beyond each token's (Ironsworn: its progress track, kept on one character), for Make it
   * So's confirmation: {title, lines}, or null for none.
   */
  describeEncounter(spec, replay) {
    return null;
  }

  /** Write the encounter's own record (describeEncounter's); returns undo records. */
  async commitEncounter(spec, replay, options) {
    return [];
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
   * Commit one simulated outcome to a token ("Make it So").
   * @param {TokenDocument} tokenDoc
   * @param {object} spec        The CombatantSpec used in the simulation
   * @param {object} final       Captured end state from the engine
   * @param {object} options     {lootMode, corpseMode, fledMode}
   * @returns {Promise<object>}  Undo record: {tokenUuid, actorUuid, actorUpdate, itemUpdates, createdItems, deletedItems,
   *   createdEffects, tokenUpdate, createdActors, createdTokens, deletedTokens, statuses, combatant}
   */
  async commitOutcome(tokenDoc, spec, final, options) {
    throw new Error(`${this.constructor.name} does not support Make it So`);
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
   * The system's own answers to the tactics questions, where it knows better than the core's reading of the numbers
   * (a class that fights from afar, a creature that never runs): {question: answer}, any of TACTIC_KEYS, each one of the
   * question's choices (preferredAction: one of its actions' ids). What "Let it decide" stands for. Optional.
   * @param {Actor} actor
   * @param {object} spec   its CombatantSpec
   * @param {object} calc   the core's answers, to build on
   * @returns {Record<string, string>}
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

  /** Describe the changes commitOutcome would make, for the confirmation dialog. */
  describeOutcome(spec, final) {
    return [];
  }
}
