/**
 * Reactions: a free swing at a foe who walks out of reach (5e opportunity attacks, PF2e Reactive Strike).
 *
 * One idea for every system that has them; the system's rules decide the rest:
 *   rules.opportunity(reactor, mover)  the melee strike the reactor makes, or null if it can't (in PF2e only some
 *                                      creatures can; in 5e anyone with a melee attack)
 *   rules.reactions(u)                 reactions a round (default 1), regained at the start of the creature's turn
 *   rules.disengage(u)                 how to leave safely, {cost, label} (5e Disengage, PF2e Step)
 *
 * Thinking combatants have a healthy respect for it: tactical minds always weigh it, competent ones half the time,
 * feral and instinctive ones never. A character played for the story (the "roleplaying is very important" box)
 * forgets about it half the time.
 */
import { TACTICAL } from "../../constants.js";
import { areEnemies, isStanding, liveTier, edgeDistance, heldOff } from "../battle-state.js";
import { meanPart } from "../dice.js";
import { mind } from "./desire.js";

/** Reactions u has each round: none in a system without opportunity attacks. */
export function reactionsPerRound(rules, u) {
  if ( !rules.opportunity && !u.spec.reactions?.length ) return 0;
  return rules.reactions ? rules.reactions(u) : 1;
}

/**
 * Foes beside u that would strike as it walks away (all but `keep`, the one it's walking toward), each with the
 * strike it would make.
 */
export function threats(run, u, keep = null) {
  const rules = run.prep.rules;
  if ( !rules.opportunity || !run.prep.options.positioning ) return [];
  const out = [];
  for ( const { e, d } of nearbyFoes(run, u) ) {
    if ( e === keep || !e.active || !isStanding(e) || (e.reactionsLeft ?? 0) <= 0 || e.conds.incapacitated ) continue;
    const strike = rules.opportunity(e, u);
    if ( strike && d <= (strike.reach ?? 5) + 0.5 ) out.push({ e, strike });
  }
  return out;
}

/**
 * Foes close enough to matter (engaged, or within 15 feet), with how far. Asked often while choosing targets, so
 * kept until someone moves (run.geo), u's engagements change, or someone changes sides.
 */
function nearbyFoes(run, u) {
  const key = `${run.geo ?? 0}|${u.adjacent.size}|${run.standoff ? 1 : 0}`;
  if ( u.nearbyKey === key ) return u.nearby;
  const list = [];
  for ( const e of run.units ) {
    if ( e === u || !areEnemies(run, u, e) || heldOff(run, u, e) ) continue; // (not across a standoff)
    // Beside it: engaged in melee, or on the map within reach.
    const d = u.adjacent.has(e.id) ? 0 : edgeDistance(e, u);
    if ( d !== null && d <= 15.5 ) list.push({ e, d });
  }
  u.nearbyKey = key;
  u.nearby = list;
  return list;
}

/** Does u think about opportunity attacks this round? (Decided once a round, so it doesn't flicker mid-turn.) */
export function isWary(run, u) {
  if ( u.waryRound === run.round ) return u.wary;
  const tier = liveTier(run, u);
  let p = tier >= TACTICAL.TACTICAL ? 1 : tier === TACTICAL.COMPETENT ? 0.5 : 0;
  if ( mind(run, u).obsessed ) p = 0; // an obsession leaves no room for caution
  if ( u.spec.roleplay ) p *= 0.5;
  u.waryRound = run.round;
  u.wary = p >= 1 || (p > 0 && run.rng.chance(p));
  return u.wary;
}

/** Two costs together ({action: 1} + {bonus: 1} -> {action: 1, bonus: 1}). */
export function addCosts(a = {}, b = {}) {
  const out = { ...a };
  for ( const [k, v] of Object.entries(b ?? {}) ) out[k] = (out[k] ?? 0) + v;
  return out;
}

/**
 * Does u take the safe way out before walking off? The wary do when they can afford it and still do what they're
 * moving for (`need`); a way out that leaves the turn's main actions alone (5e Nimble Escape, Cunning Action) is
 * second nature to anything that isn't feral.
 */
export function takesSafeWay(run, u, safe, turn, need = null) {
  if ( !safe || !turn || !turn.canAfford(addCosts(safe.cost, need)) ) return false;
  if ( isWary(run, u) ) return true;
  const main = run.prep.rules.mainPool ?? "actions";
  const cheap = !(safe.cost?.[main] > 0);
  return cheap && liveTier(run, u) >= TACTICAL.INSTINCTIVE && (!u.spec.roleplay || run.rng.chance(0.5));
}

/**
 * The best everyday melee strike a creature could react with (no Multiattack, nothing with limited uses): what a
 * system's `opportunity` usually returns once it has decided the creature can react at all.
 */
export function bestReactionStrike(u) {
  let best = null;
  let bestScore = -Infinity;
  for ( const a of u.prep?.offense ?? [] ) {
    if ( a.kind !== "strike" || !a.melee || a.sequence || a.resource || Number.isFinite(a.uses) ) continue;
    const score = (a.damage ?? []).reduce((s, p) => s + meanPart(p), 0) + (a.bonus ?? 0) * 0.5;
    if ( score > bestScore ) { bestScore = score; best = a; }
  }
  return best;
}
