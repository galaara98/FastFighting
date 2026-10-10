/**
 * A creature's turn budget, as the system's rules define it. The engine never assumes an action economy:
 *
 *   PF2e-style   { actions: 3 }                         moving costs an action per Stride
 *   5e-style     { action: 1, bonus: 1, move: 30 }      moving spends feet; Dash trades the action for more
 *
 * Costs are objects over the same pools ({ actions: 2 }, { action: 1 }, { bonus: 1 }, { move: 15 }). A plain number
 * is shorthand for the rules' main pool. Pure: no Foundry globals.
 */

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

/** What an action costs: the rules decide (PF2e: its action count; 5e: an action or a bonus action). */
export function costOf(rules, action, u = null) {
  const base = rules.costOf ? rules.costOf(action, u) : action.cost;
  const cost = { ...normalizeCost(rules, base) };
  // Drawing an unready weapon the first time (PF2e Interact) adds to the main pool.
  if ( u && action.drawCost && !u.drawn?.has(action.id) ) {
    const pool = mainPool(rules);
    cost[pool] = (cost[pool] ?? 0) + action.drawCost;
  }
  return cost;
}

/** Main-pool units a cost needs (for heuristics such as "damage per action"). */
export function costUnits(rules, cost) {
  const c = normalizeCost(rules, cost);
  const main = c[mainPool(rules)] ?? 0;
  // A bonus action or free movement is cheap, not free: count it as a fraction so options still compare.
  return main + (c.bonus ? 0.5 : 0) + (c.move ? 0.1 : 0);
}

export class Turn {
  /**
   * @param {object} rules
   * @param {object} u      Unit taking the turn
   * @param {number} lost   Main-pool units lost to conditions (stunned, slowed, ...)
   */
  constructor(rules, u, lost = 0) {
    this.rules = rules;
    this.unit = u;
    const budget = rules.turn ? rules.turn(u) : { actions: rules.actionsPerTurn ?? 1 };
    this.pools = { ...budget };
    const pool = mainPool(rules);
    if ( lost ) this.pools[pool] = Math.max(0, (this.pools[pool] ?? 0) - lost);
    this.feetMovement = rules.movement === "feet";
  }

  /** Main-pool units left (PF2e actions; 5e: 1 until the action is used). */
  get left() {
    return this.pools[mainPool(this.rules)] ?? 0;
  }

  /** Anything left worth trying this turn? */
  get any() {
    return this.left > 0 || (this.pools.bonus ?? 0) > 0;
  }

  canAfford(cost) {
    const c = normalizeCost(this.rules, cost);
    return Object.entries(c).every(([k, v]) => (this.pools[k] ?? 0) >= v);
  }

  spend(cost) {
    const c = normalizeCost(this.rules, cost);
    for ( const [k, v] of Object.entries(c) ) this.pools[k] = (this.pools[k] ?? 0) - v;
  }

  /** How many times this cost could be paid from what's left. */
  howMany(cost) {
    const c = normalizeCost(this.rules, cost);
    let n = Infinity;
    for ( const [k, v] of Object.entries(c) ) if ( v > 0 ) n = Math.min(n, Math.floor((this.pools[k] ?? 0) / v));
    return Number.isFinite(n) ? n : 0;
  }

  /** Give up the main pool (end the turn's real actions; bonus actions may remain). */
  spendAll() {
    this.pools[mainPool(this.rules)] = 0;
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
      if ( this.left < 1 ) return 0;
      this.pools[mainPool(this.rules)] -= 1;
      return speed;
    }
    if ( (this.pools.move ?? 0) <= 0.5 ) {
      if ( this.left < 1 ) return 0;
      this.pools[mainPool(this.rules)] -= 1; // Dash
      this.pools.move = (this.pools.move ?? 0) + speed;
    }
    return this.pools.move;
  }

  /** Movement actually used after a step (5e only: feet come off the pool). */
  usedMove(feet) {
    if ( this.feetMovement ) this.pools.move = Math.max(0, (this.pools.move ?? 0) - feet);
  }
}
