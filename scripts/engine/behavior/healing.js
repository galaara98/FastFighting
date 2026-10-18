/**
 * Healing decisions: who to heal, and whether it is worth the resource.
 * PCs follow their GM-entered disposition; monsters scale with Tactical, but always consider healing they have.
 */
import { STATUS, TACTICAL, clamp } from "../../constants.js";
import { alliesOf, liveTier, liveTrait, dispositionOf, movesNeeded, canMove, refusesToHelp, behaviorOf } from "../battle-state.js";
import { hasUses, costOf, costUnits } from "./evaluate.js";
import { mainPool } from "../turn.js";
import { threats, isWary, addCosts } from "./reactions.js";
import { mind, levelOf } from "./desire.js";
import { bringsItself } from "./reluctance.js";
import { perceives } from "./senses.js";
import { meanPart } from "../dice.js";
import { castChanceOf } from "./casting.js";
import { specialtyWeight } from "./specialty.js";
import { outcomeWorth } from "./effects.js";
import { cutOff } from "./troubles.js";

const THRESHOLD = { conservative: 0.3, balanced: 0.45, aggressive: 0.6, allCosts: 0.8 };

/** A potion given to a friend (action.administer): the same potion, for one in reach. */
const GIVEN = new WeakMap();
function given(a) {
  let g = GIVEN.get(a);
  if ( !g ) GIVEN.set(a, g = { ...a, selfOnly: false, reach: a.reach ?? 5, administered: true });
  return g;
}

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

/** A heal's mean (a share of the target's own hit dice counted at a d6's), as often as its check works (DCC). */
const meanHeal = (action, u = null) => ((action.heal ?? []).reduce((s, p) => s + meanPart(p), 0) + (action.healDice ?? 0) * 3.5) * castChanceOf(u, action);
const perTurn = (rules, action) => Math.max(0.1, costUnits(rules, costOf(rules, action)));

/**
 * Moves needed before a heal reaches its target: none for heals with no range given (or no map), else what it takes
 * to come within touch (reach) or range, like an attack; never through the total cover of another creature's insides.
 */
export function healMoves(run, u, action, target) {
  if ( target === u || action.selfOnly ) return 0;
  if ( cutOff(run, u, target) ) return Infinity;
  if ( !action.range && action.reach === undefined ) return 0;
  return movesNeeded(run, u, target, action);
}

/** Does the system say heal `a` can't mend t (rules.usable: PF2e's vitality healing on one with void healing)? */
function refused(run, u, a, t) {
  const rules = run.prep.rules;
  return !a.firstAid && !!rules.usable && rules.usable(run, u, a, t) === false;
}

/**
 * How much each friend (or u itself) needs u's healing, as its healing logic weighs it: [{ally, score}] best first,
 * only those worth healing. These become u's desires to heal.
 */
export function healScores(run, u, heals = u.prep.healActions) {
  if ( !heals?.length ) return [];
  // (First aid alone mends nobody: it's for a friend who's dying.)
  const mends = heals.some(a => !a.firstAid);
  const potionAt = u.tac?.potionThreshold;
  const aggro = healAggroOf(run, u);
  // (A medic acts on a friend at three quarters of its hit points; one who'd rather bolster or hit, only when it must.)
  const lean = behaviorOf(u);
  const medic = Number(lean.medic) || 0;
  const threshold = Math.max(THRESHOLD[aggro] ?? 0.45, medic > 0 ? 0.6 + 0.15 * Math.min(1, medic) : 0);
  const other = (1 - 0.5 * (Number(lean.enable) || 0)) * (1 - 0.6 * (Number(lean.dps) || 0));
  const selfish = liveTrait(run, u, "selfish");
  const tier = liveTier(run, u);
  const allyDying = dispositionOf(u).allyDying ?? (selfish >= 70 ? "protectSelf" : "rescue");
  const out = [];
  for ( const ally of alliesOf(run, u) ) {
    if ( [STATUS.DEAD, STATUS.FLED, STATUS.SURRENDERED, STATUS.STOOD_DOWN, STATUS.BEATEN].includes(ally.status) ) continue;
    const isSelf = ally === u;
    if ( !mends && (isSelf || !(ally.status === STATUS.DOWN && !ally.stable)) ) continue;
    if ( !isSelf && (allyDying === "protectSelf" || allyDying === "retreat") ) continue;
    if ( !isSelf && !perceives(run, u, ally, { crisis: true }) ) continue; // it has to be able to tell
    if ( !isSelf && cutOff(run, u, ally) ) continue; // (inside another creature, or it inside one: out of reach)
    if ( !isSelf && tier <= TACTICAL.FERAL ) continue; // feral healers only tend themselves
    if ( refusesToHelp(run, u, ally) ) continue; // (scheming against its leaders)
    if ( heals.every(a => refused(run, u, a, ally)) ) continue; // (the system says none of its heals mends this one)
    const frac = ally.maxHp > 0 ? ally.hp / ally.maxHp : 0;
    let score = 0;
    if ( ally.status === STATUS.DOWN ) {
      score = allyDying === "rescue" ? 3 : (allyDying === "fight" ? 1.2 : 0.5);
      if ( ally.dying >= 2 ) score += 1;
    } else if ( frac < threshold ) {
      score = 1 - frac;
      if ( aggro === "conservative" && frac >= 0.25 && !medic ) score = 0;
      if ( !isSelf ) score *= other;
    }
    if ( isSelf && potionAt && potionAt !== "never" && frac < Number(potionAt) / 100 && heals.some(a => a.selfOnly) ) {
      score = Math.max(score, 1 - frac);
    }
    if ( isSelf && u.wasDowned && dispositionOf(u).selfRevived === "healSelf" && frac < 0.75 ) score += 1;
    if ( score <= 0 ) continue;
    score *= isSelf ? (1 + selfish / 50) : clamp(1 - selfish / 200, 0.2, 1);
    out.push({ ally, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Whether u heals someone now, whom, and with what.
 * @param {object} run
 * @param {object} u
 * @param {Turn} turn   What's left of u's turn
 * @returns {{action: object, target: object}|null}
 */
export function decideHeal(run, u, turn) {
  const rules = run.prep.rules;
  const potionAt = u.tac?.potionThreshold;
  const ownFrac = u.maxHp > 0 ? u.hp / u.maxHp : 0;
  // (A medic gives a friend its own potion where the system lets it: action.administer, PF2e's.)
  const gives = (Number(behaviorOf(u).medic) || 0) > 0;
  const heals = u.prep.healActions.flatMap(a => (gives && a.selfOnly && a.administer ? [a, given(a)] : [a])).filter(a => {
    if ( !turn.canAfford(costOf(rules, a, u)) || !hasUses(u, a) ) return false;
    // Players decide when to drink their own potions.
    if ( a.selfOnly && potionAt ) return potionAt !== "never" && ownFrac < Number(potionAt) / 100;
    return true;
  }).filter(a => bringsItself(run, u, a)); // reluctant to use up a potion or a slot: only now and then, unless a life is at stake
  if ( !heals.length ) return null;
  const aggro = healAggroOf(run, u);

  // What u wants decides: a friend it's set on healing comes first; with something else far stronger on its
  // mind, healing doesn't cross it at all.
  const thoughts = mind(run, u);
  if ( thoughts.blinding && thoughts.lead.kind !== "heal" && !thoughts.kindInView("heal") ) return null;
  const scored = healScores(run, u, heals);
  let best = scored[0]?.ally ?? null;
  if ( thoughts.lead?.kind === "heal" ) best = run.byId.get(thoughts.lead.targetId) ?? best;
  else if ( scored.length > 1 ) best = scored.reduce((b, x) => (levelOf(u, "heal", x.ally.id) > levelOf(u, "heal", b.ally.id) ? x : b), scored[0]).ally;
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
    const cost = { ...costOf(rules, a, u) };
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
  // (And what it lays on them besides, as any outcome is weighed: Regenerate's hit point a turn.)
  const lent = a => (a.outcome ? Math.max(0, outcomeWorth(run, u, best, a.outcome)) : 0);
  const value = o => (o.a.firstAid ? 0.5 : best.status === STATUS.DOWN ? 1 + (meanHeal(o.a, u) + lent(o.a)) / 100 : meanHeal(o.a, u) + lent(o.a)) / (perTurn(rules, o.a) + o.units) * specialtyWeight(u, o.a);
  const options = heals
    .filter(a => !a.firstAid || (best !== u && best.status === STATUS.DOWN && !best.stable && (rules.canFirstAid?.(best) ?? true)))
    // (What the system says it can't do now: PF2e's sickened, who can't drink a potion.)
    .filter(a => !rules.usable || rules.usable(run, u, a, best))
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
  const fits = a => !a.firstAid && turn.canAfford(costOf(rules, a)) && hasUses(u, a) && !a.selfOnly
    && (!a.oncePerTarget || !u.healedTargets.has(`${a.id}|${target.id}`))
    && (!a.targetTrait || target.spec.creatureTraits?.includes(a.targetTrait))
    && (!rules.usable || rules.usable(run, u, a, target) !== false);
  const heals = u.prep.healActions.filter(fits);
  const free = heals.find(a => !a.resource && !Number.isFinite(a.uses));
  if ( free ) return free;
  if ( u.spec.firstAid && rules.firstAidDC && rules.firstAid && (rules.canFirstAid?.(target) ?? true) && turn.canAfford(rules.firstAidCost ?? rules.basicAction ?? 1) ) return "firstAid";
  return heals[0] ?? null;
}
