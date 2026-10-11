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
   * The system's own word for a stat, for {AC} and {HP} in FastFighting's text (in the client's language).
   * @param {"ac"|"hp"} key   ac: how hard a creature is to hit; hp: how much harm it can take
   * @returns {string|null|false}  the word; null: FastFighting's generic one; false: the system has none (not shown)
   */
  term(key) {
    return null;
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

  /** Describe the changes commitOutcome would make, for the confirmation dialog. */
  describeOutcome(spec, final) {
    return [];
  }
}
