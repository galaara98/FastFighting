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

  /** The system's own difficulty estimate for the encounter, or null. */
  difficultyCrossCheck(friendly, hostile) {
    return null;
  }

  /**
   * Commit one simulated outcome to a token ("Make it So").
   * @param {TokenDocument} tokenDoc
   * @param {object} spec        The CombatantSpec used in the simulation
   * @param {object} final       Captured end state from the engine
   * @param {object} options     {lootMode, corpseMode, fledMode}
   * @returns {Promise<object>}  Undo record
   */
  async commitOutcome(tokenDoc, spec, final, options) {
    throw new Error(`${this.constructor.name} does not support Make it So`);
  }

  /** Describe the changes commitOutcome would make, for the confirmation dialog. */
  describeOutcome(spec, final) {
    return [];
  }
}
