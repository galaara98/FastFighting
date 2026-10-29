/**
 * Reactions: a free swing at a foe who walks out of reach (5e opportunity attacks, PF2e Reactive Strike).
 *
 * One idea for every system that has them; the system's rules decide the rest:
 *   rules.opportunity(reactor, mover)  the melee strike the reactor makes, or null if it can't (in PF2e only some
 *                                      creatures can; in 5e anyone with a melee attack)
 *   rules.opportunityOn                the moments it answers, from the master list (default ["foeLeavesReach"]; PF2e's
 *                                      Reactive Strike also "foeOpening", a ranged attack or a manipulate action in
 *                                      reach, and "foeMovesInReach", standing up there or walking a square or
 *                                      more into a reach weapon's reach: simulator.js throughReach)
 *   rules.reactions(u)                 reactions a round (default 1), regained at the start of the creature's turn
 *   spec.reactions                     a creature's own reaction on foeLeavesReach or foeMovesInReach with `strike`
 *                                      (the strike it names, or its best): struck as an opportunity strike is, at
 *                                      those moments, whatever the system's own (ownMoveStrike); its uses spent
 *   rules.disengage(u)                 how to leave safely, {cost, label, check?} (5e Disengage, PF2e Step; check:
 *                                      {mod, dc, dcMany}, a roll it has to make, harder against several foes: XCC's
 *                                      acrobatics)
 *
 * Thinking combatants have a healthy respect for it: tactical minds always weigh it, competent ones half the time,
 * feral and instinctive ones never. A character played for the story (the "roleplaying is very important" box)
 * forgets about it as often as the "roleplayForgets" setting says (a third of the time, by default).
 */
import { TACTICAL, ROLEPLAY_FORGETS, clamp } from "../../constants.js";
import { areEnemies, isStanding, liveTier, edgeDistance, heldOff, behaviorOf } from "../battle-state.js";
import { meanPart } from "../dice.js";
import { mind } from "./desire.js";
import { cutOff } from "./troubles.js";
import { answersTo } from "../../story/master.js";
import { addCosts, DISENGAGE } from "../turn.js";
import { needsDraw, isLoaded } from "../gear.js";

/** Reactions u has each round: none in a system without opportunity attacks or Ready (behavior/waiting.js). */
export function reactionsPerRound(rules, u) {
  if ( !rules.opportunity && !rules.ready && !u.spec.reactions?.length ) return 0;
  return rules.reactions ? rules.reactions(u) : 1;
}

/** The moments a creature's own reaction may strike a foe at, as an opportunity strike is (spec.reactions with strike). */
const MOVE_STRIKES = Object.freeze(["foeLeavesReach", "foeMovesInReach"]);

/**
 * Foes beside u that would strike as it walks away (all but `keep`, the one it's walking toward), or at another
 * moment the system's opportunity strikes answer (`trigger`), each with the strike it would make. A foe's own reaction
 * that strikes at a foe leaving its reach or moving in it (spec.reactions on foeLeavesReach or foeMovesInReach, with
 * `strike`: PF2e's tail that lashes at whoever moves in its reach) counts too, where the system's opportunity strike
 * doesn't: {e, strike, reaction}.
 */
export function threats(run, u, keep = null, trigger = "foeLeavesReach") {
  const rules = run.prep.rules;
  if ( !run.prep.options.positioning ) return [];
  // ("provoked": an action that lays its user open whatever the system's moments are, API 29.)
  const system = !!rules.opportunity && (trigger === "provoked" || (rules.opportunityOn ?? ["foeLeavesReach"]).includes(trigger));
  const own = MOVE_STRIKES.includes(trigger) && hasMoveStrikers(run);
  if ( !system && !own ) return [];
  const out = [];
  for ( const { e, d } of nearbyFoes(run, u) ) {
    if ( e === keep || !e.active || !isStanding(e) || (e.reactionsLeft ?? 0) <= 0 || e.conds.incapacitated ) continue;
    const strike = system ? rules.opportunity(e, u) : null;
    const mine = !strike && own ? ownMoveStrike(e, trigger) : null;
    const swing = strike ?? mine?.strike;
    if ( swing && d <= (swing.reach ?? 5) + 0.5 ) out.push({ e, strike: swing, ...(mine ? { reaction: mine.reaction } : {}) });
  }
  return out;
}

/** Has anyone in the fight a reaction of its own that strikes a foe moving in or out of its reach? (Once a fight.) */
export function hasMoveStrikers(run) {
  run.moveStrikers ??= run.units.some(o => (o.spec.reactions ?? []).some(r => r.strike && MOVE_STRIKES.some(t => answersTo(r, t))));
  return run.moveStrikers;
}

/**
 * A reaction of u's own that strikes a foe at this moment (on foeLeavesReach or foeMovesInReach, with `strike`), ready
 * (its uses or its resource), and the strike: the one it names (an action id, or the best of a list), else its best
 * everyday melee strike. {reaction, strike} or null.
 */
export function ownMoveStrike(u, trigger) {
  for ( const r of u.spec.reactions ?? [] ) {
    if ( !r.strike || !answersTo(r, trigger) ) continue;
    if ( r.resource ? (u.resources[r.resource] ?? 0) < (r.amount ?? 1) : Number.isFinite(r.uses) && (u.reactionUses?.[r.id] ?? r.uses) <= 0 ) continue;
    const named = typeof r.strike === "string" ? [r.strike] : Array.isArray(r.strike) ? r.strike : null;
    const strike = named ? (u.prep?.offense ?? []).filter(a => a.kind === "strike" && a.melee && named.includes(a.id) && reactsWith(u, a))
      .sort((a, b) => (b.damage ?? []).reduce((s, p) => s + meanPart(p), 0) - (a.damage ?? []).reduce((s, p) => s + meanPart(p), 0))[0] ?? null : bestReactionStrike(u);
    if ( strike ) return { reaction: r, strike };
  }
  return null;
}

/** What striking with its own reaction (ownMoveStrike's) spends beside the reaction itself: its uses, its resource. */
export function spendOwnStrike(u, reaction) {
  if ( !reaction ) return;
  if ( reaction.resource ) u.resources[reaction.resource] -= (reaction.amount ?? 1);
  else if ( Number.isFinite(reaction.uses) ) (u.reactionUses ??= {})[reaction.id] = (u.reactionUses[reaction.id] ?? reaction.uses) - 1;
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
    // (Not across a standoff, nor into or out of another creature: one inside goes where it goes.)
    if ( e === u || !areEnemies(run, u, e) || heldOff(run, u, e) || cutOff(run, u, e) ) continue;
    // Beside it: engaged in melee, or on the map within reach.
    const d = u.adjacent.has(e.id) ? 0 : edgeDistance(e, u);
    if ( d !== null && d <= 15.5 ) list.push({ e, d });
  }
  u.nearbyKey = key;
  u.nearby = list;
  return list;
}

/** How often u, played for the story, forgets opportunity attacks (0 to 1; 0 for anyone else). */
const forgets = (run, u) => (u.spec.roleplay ? clamp((run.prep.options.roleplayForgets ?? ROLEPLAY_FORGETS) / 100, 0, 1) : 0);

/** Does u think about opportunity attacks this round? (Decided once a round, so it doesn't flicker mid-turn.) */
export function isWary(run, u) {
  if ( u.waryRound === run.round ) return u.wary;
  const tier = liveTier(run, u);
  let p = tier >= TACTICAL.TACTICAL ? 1 : tier === TACTICAL.COMPETENT ? 0.5 : 0;
  if ( mind(run, u).obsessed ) p = 0; // an obsession leaves no room for caution
  p *= 1 - forgets(run, u);
  // (A Daredevil doesn't care for the blow it invites, as often as its pills say.)
  p *= 1 - clamp(Number(behaviorOf(u).reckless) || 0, 0, 1);
  u.waryRound = run.round;
  u.wary = p >= 1 || (p > 0 && run.rng.chance(p));
  return u.wary;
}

/**
 * Does u take the safe way out before walking off? The wary do when they can afford it and still do what they're
 * moving for (`need`); a way out that leaves the turn's main actions alone (5e Nimble Escape, Cunning Action) is
 * second nature to anything that isn't feral.
 */
export function takesSafeWay(run, u, safe, turn, need = null) {
  if ( !safe || !turn || !turn.canAfford(addCosts(safe.cost, need), DISENGAGE) ) return false;
  // In a hurry (Impatient), it doesn't stop to get clear: it takes the free swings.
  const rush = behaviorOf(u).rush ?? 0;
  if ( rush > 0 && run.rng.chance(rush) ) return false;
  if ( isWary(run, u) ) return true;
  const main = run.prep.rules.mainPool ?? "actions";
  const cheap = !(safe.cost?.[main] > 0);
  const forget = forgets(run, u);
  return cheap && liveTier(run, u) >= TACTICAL.INSTINCTIVE && (!forget || !run.rng.chance(forget));
}

/**
 * Can u strike with it as a reaction: one plain blow (not an activity of several actions, a class action's, Vicious
 * Swing), with its weapon in hand and loaded (a reaction has no time to draw it: engine/gear.js)?
 */
export function reactsWith(u, a) {
  if ( a.classAction || a.oncePerTurn || a.charge ) return false;
  const cost = typeof a.cost === "number" ? a.cost : Math.max(0, ...Object.values(a.cost ?? {}).map(Number).filter(Number.isFinite));
  return !(cost > 1) && !needsDraw(u, a) && isLoaded(u, a);
}

/**
 * The best everyday melee strike a creature could react with (no Multiattack, nothing with limited uses, only what it
 * can strike with now: reactsWith): what a system's `opportunity` usually returns once it has decided the creature can
 * react at all.
 */
export function bestReactionStrike(u) {
  let best = null;
  let bestScore = -Infinity;
  for ( const a of u.prep?.offense ?? [] ) {
    if ( a.kind !== "strike" || !a.melee || a.sequence || a.resource || Number.isFinite(a.uses) || !reactsWith(u, a) ) continue;
    const score = (a.damage ?? []).reduce((s, p) => s + meanPart(p), 0) + (a.bonus ?? 0) * 0.5;
    if ( score > bestScore ) { bestScore = score; best = a; }
  }
  return best;
}
