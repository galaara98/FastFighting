/**
 * Healing decisions: who to heal, and whether it is worth the resource.
 * PCs follow their GM-entered disposition; monsters scale with Tactical, but always consider healing they have.
 */
import { STATUS, TACTICAL, clamp } from "../../constants.js";
import { alliesOf, liveTier, liveTrait, dispositionOf, movesNeeded, canMove } from "../battle-state.js";
import { hasUses, costOf, costUnits } from "./evaluate.js";
import { mainPool } from "../turn.js";
import { threats, isWary, addCosts } from "./reactions.js";
import { meanPart } from "../dice.js";

const THRESHOLD = { conservative: 0.3, balanced: 0.45, aggressive: 0.6, allCosts: 0.8 };

export function healAggroOf(run, u) {
  const disposition = dispositionOf(u);
  if ( u.spec.kind === "pc" || disposition.healAggro ) {
    return disposition.healAggro ?? run.prep.sides[u.side].healAggro ?? "balanced";
  }
  const tier = liveTier(run, u);
  if ( tier <= TACTICAL.FERAL ) return "conservative";
  if ( tier === TACTICAL.INSTINCTIVE ) return "conservative";
  if ( tier === TACTICAL.COMPETENT ) return "balanced";
  return "aggressive";
}

const meanHeal = action => (action.heal ?? []).reduce((s, p) => s + meanPart(p), 0);
const perTurn = (rules, action) => Math.max(0.1, costUnits(rules, costOf(rules, action)));

/**
 * Moves needed before a heal reaches its target: none for heals with no range given (or no map), else what it takes
 * to come within touch (reach) or range, like an attack.
 */
export function healMoves(run, u, action, target) {
  if ( target === u || action.selfOnly || (!action.range && action.reach === undefined) ) return 0;
  return movesNeeded(run, u, target, action);
}

/**
 * @param {object} run
 * @param {object} u
 * @param {Turn} turn   What's left of u's turn
 * @returns {{action: object, target: object}|null}
 */
export function decideHeal(run, u, turn) {
  const rules = run.prep.rules;
  const potionAt = u.tac?.potionThreshold;
  const ownFrac = u.maxHp > 0 ? u.hp / u.maxHp : 0;
  const heals = u.prep.healActions.filter(a => {
    if ( !turn.canAfford(costOf(rules, a)) || !hasUses(u, a) ) return false;
    // Players decide when to drink their own potions.
    if ( a.selfOnly && potionAt ) return potionAt !== "never" && ownFrac < Number(potionAt) / 100;
    return true;
  });
  if ( !heals.length ) return null;

  const aggro = healAggroOf(run, u);
  const threshold = THRESHOLD[aggro] ?? 0.45;
  const selfish = liveTrait(run, u, "selfish");
  const tier = liveTier(run, u);
  const allyDying = dispositionOf(u).allyDying ?? (selfish >= 70 ? "protectSelf" : "rescue");

  let best = null;
  let bestScore = 0;
  for ( const ally of alliesOf(run, u) ) {
    if ( [STATUS.DEAD, STATUS.FLED, STATUS.SURRENDERED, STATUS.STOOD_DOWN].includes(ally.status) ) continue;
    const isSelf = ally === u;
    if ( !isSelf && (allyDying === "protectSelf" || allyDying === "retreat") ) continue;
    if ( !isSelf && tier <= TACTICAL.FERAL ) continue; // feral healers only tend themselves
    const frac = ally.maxHp > 0 ? ally.hp / ally.maxHp : 0;
    let score = 0;
    if ( ally.status === STATUS.DOWN ) {
      score = allyDying === "rescue" ? 3 : (allyDying === "fight" ? 1.2 : 0.5);
      if ( ally.dying >= 2 ) score += 1;
    } else if ( frac < threshold ) {
      score = 1 - frac;
      if ( aggro === "conservative" && frac >= 0.25 ) score = 0;
    }
    if ( isSelf && potionAt && potionAt !== "never" && frac < Number(potionAt) / 100 && heals.some(a => a.selfOnly) ) {
      score = Math.max(score, 1 - frac);
    }
    if ( isSelf && u.wasDowned && dispositionOf(u).selfRevived === "healSelf" && frac < 0.75 ) score += 1;
    if ( score <= 0 ) continue;
    score *= isSelf ? (1 + selfish / 50) : clamp(1 - selfish / 200, 0.2, 1);
    if ( score > bestScore ) { bestScore = score; best = ally; }
  }
  if ( !best ) return null;

  // Prefer free (unlimited) healing unless going all out or someone is dying.
  const urgent = best.status === STATUS.DOWN || aggro === "allCosts";
  // Out of reach: it can still be done this turn if there's movement (or actions) to get there first.
  const speed = run.prep.approachOf(u.id, best.id).speed;
  const reachable = a => {
    const moves = healMoves(run, u, a, best);
    if ( !moves ) return { a, moves: 0, units: 0 };
    if ( !Number.isFinite(moves) || !canMove(run, u) ) return null;
    const units = turn.unitsForMoves(moves, speed);
    const cost = { ...costOf(rules, a) };
    const pool = mainPool(rules);
    cost[pool] = (cost[pool] ?? 0) + units;
    if ( !turn.canAfford(cost) ) return null;
    // Walking off from a foe invites a free swing. The wary get clear first if the turn still allows the heal, or
    // take the risk for a friend who is down; they won't for a scratch.
    if ( !u.disengaged && threats(run, u, best).length && isWary(run, u) ) {
      const safe = rules.disengage?.(u);
      const safely = safe && turn.canAfford(addCosts(cost, safe.cost));
      if ( !safely && best.status !== STATUS.DOWN ) return null;
    }
    return { a, moves, units };
  };
  // Healing for what it costs from the turn, the walk there included: a bonus-action heal from afar (5e Healing Word)
  // leaves the action to fight with; a touch spell (Cure Wounds) heals more but means getting there and using the
  // action. Anyone down is back up with any heal, so for them the cheapest way wins.
  const value = o => (best.status === STATUS.DOWN ? 1 + meanHeal(o.a) / 100 : meanHeal(o.a)) / (perTurn(rules, o.a) + o.units);
  const options = heals
    .filter(a => !a.oncePerTarget || !u.healedTargets.has(`${a.id}|${best.id}`))
    .filter(a => !a.selfOnly || best === u)
    .filter(a => !a.targetTrait || best.spec.creatureTraits?.includes(a.targetTrait))
    .map(reachable).filter(Boolean)
    .sort((x, y) => value(y) - value(x));
  const usable = options.map(o => o.a);
  const unlimited = usable.filter(a => !a.resource && !Number.isFinite(a.uses));
  const action = urgent ? usable[0] : (unlimited[0] ?? (aggro === "conservative" ? null : usable[0]));
  if ( !action ) return null;
  return { action, target: best, moves: options.find(o => o.a === action)?.moves ?? 0 };
}

/**
 * After the fight: how u can help a dying ally with what's left of its turn. Free help first (unlimited healing
 * such as a medicine feat, then first aid), and only then spells, focus or items. Returns a heal action,
 * "firstAid", or null.
 */
export function rescueOption(run, u, target, turn) {
  const rules = run.prep.rules;
  const fits = a => turn.canAfford(costOf(rules, a)) && hasUses(u, a) && !a.selfOnly
    && (!a.oncePerTarget || !u.healedTargets.has(`${a.id}|${target.id}`))
    && (!a.targetTrait || target.spec.creatureTraits?.includes(a.targetTrait));
  const heals = u.prep.healActions.filter(fits);
  const free = heals.find(a => !a.resource && !Number.isFinite(a.uses));
  if ( free ) return free;
  if ( u.spec.firstAid && rules.firstAidDC && rules.firstAid && turn.canAfford(rules.firstAidCost ?? rules.basicAction ?? 1) ) return "firstAid";
  return heals[0] ?? null;
}
