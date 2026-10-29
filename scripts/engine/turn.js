/**
 * A creature's turn budget, as the system's rules define it. The engine never assumes an action economy:
 *
 *   PF2e-style   { actions: 3 }                         moving costs an action per Stride
 *   5e-style     { action: 1, bonus: 1, move: 30 }      moving spends feet; Dash trades the action for more
 *
 * Costs are objects over the same pools ({ actions: 2 }, { action: 1 }, { bonus: 1 }, { move: 15 }). A plain number
 * is shorthand for the rules' main pool. Pure: no Foundry globals.
 */
import { readyUnits, reloadPerUse } from "./gear.js";

/** The pool a plain-number cost draws from, and the pool "how many actions are left" counts. */
export function mainPool(rules) {
  return rules.mainPool ?? "actions";
}

/** Normalize a cost: numbers draw from the main pool. */
export function normalizeCost(rules, cost) {
  if ( cost === undefined || cost === null ) return { [mainPool(rules)]: 1 };
  if ( typeof cost === "number" ) return { [mainPool(rules)]: cost };
  return cost;
}

/** Two costs together ({action: 1} + {bonus: 1} -> {action: 1, bonus: 1}). */
export function addCosts(a = {}, b = {}) {
  const out = { ...a };
  for ( const [k, v] of Object.entries(b ?? {}) ) out[k] = (out[k] ?? 0) + v;
  return out;
}

/**
 * What an action costs: the rules decide (PF2e: its action count; 5e: an action or a bonus action). For a creature
 * (`u`), what its gear needs first too (engine/gear.js): drawing it (PF2e's Interact), and a Reload where it's empty.
 */
export function costOf(rules, action, u = null) {
  // (fixedCost: a cost the rules have already set, a playstyle's taunt's: rules.tauntCost.)
  const base = action.fixedCost ? action.cost : rules.costOf ? rules.costOf(action, u) : action.cost;
  const cost = { ...normalizeCost(rules, base) };
  const ready = u ? readyUnits(u, action) : 0;
  if ( ready > 0 ) {
    const pool = mainPool(rules);
    cost[pool] = (cost[pool] ?? 0) + ready;
  }
  return cost;
}

/**
 * Main-pool units one use takes over the fight, for what it's worth per action: its cost, and every shot's Reload
 * (engine/gear.js reloadPerUse: a heavy crossbow's shot is three actions, though a loaded one fires with one).
 */
export const unitsPerUse = (rules, action) => costUnits(rules, costOf(rules, action)) + reloadPerUse(action);

/** Main-pool units a cost needs (for heuristics such as "damage per action"). */
export function costUnits(rules, cost) {
  const c = normalizeCost(rules, cost);
  const main = c[mainPool(rules)] ?? 0;
  // A bonus action or free movement is cheap, not free: count it as a fraction so options still compare.
  return main + (c.bonus ? 0.5 : 0) + (c.move ? 0.1 : 0);
}

/** A loss this big (rules.modifiers.actionsLost: 5e's paralyzed; the engine's incapacitated) takes the whole turn. */
export const ALL_LOST = 99;

/** What payForMove pays for, as limitedFits sees it. */
const STRIDE = Object.freeze({ kind: "stride" });

/** What leaveReach pays rules.disengage's cost for, as limitedFits sees it: the kind "disengage". */
export const DISENGAGE = Object.freeze({ limitedAs: "disengage" });

/**
 * Is this action one a turn's limited actions (rules.modifiers.limitedActions) may pay for: "strike", a single Strike
 * (one action, not an activity that makes Strikes: Flurry of Blows, Vicious Swing); "stride", a move (payForMove's,
 * a 5e Dash too); "disengage", rules.disengage's way out (DISENGAGE); any other, an action of one action whose
 * `limitedAs` names it (the helper's: 5e Haste's Hide, Utilize).
 */
export function limitedFits(kinds, action) {
  if ( !kinds?.size || !action ) return false;
  if ( action === STRIDE ) return kinds.has("stride");
  const one = () => (typeof action.cost === "number" ? action.cost : action.cost?.actions ?? 1) === 1;
  if ( action.limitedAs && kinds.has(action.limitedAs) ) return one();
  if ( !kinds.has("strike") || action.kind !== "strike" || action.sequence || action.classAction || action.charge ) return false;
  return one();
}

export class Turn {
  /**
   * @param {object} rules
   * @param {object} u      Unit taking the turn
   * @param {number} lost   Main-pool units lost to conditions (stunned, slowed, ...); ALL_LOST or more: every pool
   */
  constructor(rules, u, lost = 0) {
    this.rules = rules;
    this.unit = u;
    const budget = rules.turn ? rules.turn(u) : { actions: rules.actionsPerTurn ?? 1 };
    this.pools = { ...budget };
    const pool = mainPool(rules);
    if ( lost >= ALL_LOST ) for ( const k of Object.keys(this.pools) ) this.pools[k] = 0; // (no bonus action, no move)
    else if ( lost ) this.pools[pool] = Math.max(0, (this.pools[pool] ?? 0) - lost);
    this.feetMovement = rules.movement === "feet";
    // (What it has paid for so far this turn, an action, a Stride, a bonus action each: for "its last action was ...",
    // behavior/requires.js.)
    this.acts = 0;
    // (Main-pool units only some actions may use: PF2e's quickened, a Strike or a Stride. Counted in the pool, and
    // kept for those: anything else is paid from the rest.)
    const limited = lost >= ALL_LOST ? null : rules.modifiers?.limitedActions?.(u) ?? null;
    this.limited = Math.max(0, Math.min(this.pools[pool] ?? 0, Math.floor(Number(limited?.n) || 0)));
    this.limitedKinds = new Set(this.limited ? limited.for ?? [] : []);
  }

  /** Main-pool units left (PF2e actions; 5e: 1 until the action is used). */
  get left() {
    return this.pools[mainPool(this.rules)] ?? 0;
  }

  /** Anything left worth trying this turn? */
  get any() {
    return this.left > 0 || (this.pools.bonus ?? 0) > 0;
  }

  /**
   * The main-pool units this action may use: the rest, and one limited unit more where it fits them (a Strike or a
   * Stride is one action: what comes before it, a draw, is paid from the rest).
   */
  #open(action) {
    const rest = Math.max(0, this.left - this.limited);
    return limitedFits(this.limitedKinds, action) ? rest + Math.min(this.limited, 1) : rest;
  }

  /** Could it pay this cost, for this action (without one: as an action the limited units can't pay for)? */
  canAfford(cost, action = null) {
    const c = normalizeCost(this.rules, cost);
    const main = mainPool(this.rules);
    return Object.entries(c).every(([k, v]) => (k === main ? this.#open(action) : (this.pools[k] ?? 0)) >= v);
  }

  /** Pay this cost, for this action: a limited unit first where it fits, else from the rest. */
  spend(cost, action = null) {
    const c = normalizeCost(this.rules, cost);
    const main = mainPool(this.rules);
    for ( const [k, v] of Object.entries(c) ) this.pools[k] = (this.pools[k] ?? 0) - v;
    if ( this.limited && (c[main] ?? 0) > 0 ) this.#useLimited(limitedFits(this.limitedKinds, action) ? 1 : 0);
    this.acts += 1;
  }

  /** The limited units after a payment: `used` of them, and never more than the pool has left. */
  #useLimited(used) {
    this.limited = Math.max(0, Math.min(this.limited - used, this.left));
  }

  /** How many times this cost could be paid from what's left, for this action. */
  howMany(cost, action = null) {
    const c = normalizeCost(this.rules, cost);
    const main = mainPool(this.rules);
    let n = Infinity;
    for ( const [k, v] of Object.entries(c) ) if ( v > 0 ) n = Math.min(n, Math.floor((k === main ? this.#open(action) : (this.pools[k] ?? 0)) / v));
    return Number.isFinite(n) ? n : 0;
  }

  /** Give up the main pool (end the turn's real actions; bonus actions may remain). */
  spendAll() {
    this.pools[mainPool(this.rules)] = 0;
    this.limited = 0;
  }

  /** Main-pool units needed to make `steps` moves of a full speed each (5e: what remains of the move is free). */
  unitsForMoves(steps, speed) {
    if ( !(steps > 0) ) return 0;
    if ( !this.feetMovement ) return steps;
    const free = speed > 0 ? (this.pools.move ?? 0) / speed : 0;
    return Math.max(0, Math.ceil(steps - free - 1e-9));
  }

  /**
   * Pay for one move toward something: returns the feet available for this step, or 0 if nothing can be paid.
   * PF2e: one action buys a Stride of `speed` feet. 5e: spend remaining movement; when it's gone, Dash.
   */
  payForMove(speed) {
    if ( !this.feetMovement ) {
      if ( this.#open(STRIDE) < 1 ) return 0;
      this.pools[mainPool(this.rules)] -= 1;
      if ( this.limited ) this.#useLimited(limitedFits(this.limitedKinds, STRIDE) ? 1 : 0);
      this.acts += 1;
      return speed;
    }
    if ( (this.pools.move ?? 0) <= 0.5 ) {
      // (Dash: a limited unit first where a move fits it, 5e Haste's; never one that can't pay for a move.)
      if ( this.#open(STRIDE) < 1 ) return 0;
      this.pools[mainPool(this.rules)] -= 1;
      if ( this.limited ) this.#useLimited(limitedFits(this.limitedKinds, STRIDE) ? 1 : 0);
      this.pools.move = (this.pools.move ?? 0) + speed;
      this.acts += 1;
    }
    return this.pools.move;
  }

  /** Movement actually used after a step (5e only: feet come off the pool). */
  usedMove(feet) {
    if ( this.feetMovement ) this.pools.move = Math.max(0, (this.pools.move ?? 0) - feet);
  }
}
