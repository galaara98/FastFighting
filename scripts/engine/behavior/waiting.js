/**
 * Waiting for the right moment, where the system has a way to (API 33): a creature that would let its turn, or what's
 * left of it, go by for nothing waits instead.
 *
 *   rules.delay   {reactions}: a creature may Delay as its turn begins (PF2e's Delay): it leaves the turn order and
 *                 comes back after another's turn later in the round, its turn then, and its place in the order from
 *                 then on. `reactions: false`: none while it waits (PF2e). API 34: `reasons`, which of the core's own
 *                 below it waits for (all where it doesn't say; [] none), and `waitFor(run, u, later)`, the system's
 *                 own reason, tried first: {why, afterId, forId} or null (DCC: a caster waiting to answer a foe's
 *                 spell, why "counter"). API 35: `toEnd`, it always comes back at the round's end, whatever it
 *                 waited for (5e's homebrew Delay), its place last from then on.
 *   rules.ready   {cost, most}: a creature may Ready (PF2e's Ready: {actions: 2}, an action of 1 at most): it spends
 *                 `cost` of its turn to Strike, as a reaction, at the first foe that comes within its reach before its
 *                 next turn begins, with the attack penalty it had when it readied.
 *
 * Neither for a system that passes the turn some other way (rules.roundTurns: Daggerheart's spotlight), nor in a
 * round of surprise. What each waits for:
 *   standoff   while a standoff holds, one that wouldn't talk in it waits for whoever after it might break it (its
 *              chance of breaking it, impatience, DELAY.standoff together at least): broken, it fights this round
 *   reach      one that thinks (competent and up, or Lazy) with no foe it could reach and strike this turn, and no
 *              shot, waits for the first foe after it who is likely to come to it (one who fights in melee, could get
 *              to it this turn, and has no nearer foe), then has its whole turn for blows
 *   aid        one that thinks waits for the first friend after it whose bolstering is worth more to it than its own
 *              blows (support.js aidScores, DELAY.aid at least)
 * Readying: one of the spare turn's steps (behavior/prepare.js spareBest, kit.ready), and one held back by its team's
 * head (a stance to wait) readies with the turn it doesn't use: worth its best everyday melee Strike's damage on
 * the foe most likely to come within its reach, as likely as some foe is to come (readyChance), less READY.reaction
 * where the reaction would have gone to a strike of its own anyway.
 * Pure: no Foundry globals.
 */
import { TACTICAL } from "../../constants.js";
import { areEnemies, isStanding, liveTier, edgeDistance, heldOff, behaviorOf, canMove } from "../battle-state.js";
import { expectedDamage, unitsPerTurn } from "./evaluate.js";
import { bestReactionStrike } from "./reactions.js";
import { prefersTalk, impatience } from "./standoff.js";
import { isNeutral } from "./neutral.js";
import { aidScores } from "./support.js";
import { speedOf } from "./prepare.js";
import { costOf, costUnits, normalizeCost } from "../turn.js";

/** Tuning: how likely a standoff's break must be to wait for it; how much a friend's bolstering must be worth. */
export const DELAY = Object.freeze({ standoff: 0.2, aid: 1 });
/**
 * Tuning: how likely a foe is to come within reach before the readier's next turn (one who fights in melee, one who
 * shoots), halved when the readier isn't its nearest foe; what a readied blow is worth where the reaction would have
 * struck anyway (an opportunity strike of its own).
 */
export const READY = Object.freeze({ melee: 0.6, ranged: 0.15, notNearest: 0.5, reaction: 0.8 });

/** Does the system have a turn order to wait in? */
const orderly = rules => !rules.roundTurns;

/** Those after u in the turn order this round, on their feet and in the conflict. */
export function laterThisRound(run, u) {
  const order = run.order ?? [];
  const at = order.indexOf(u);
  if ( at < 0 ) return [];
  return order.slice(at + 1).filter(o => isStanding(o) && o.active && !o.spec.hazard);
}

/** The foe on its feet nearest f (by its edges), and how far. */
function nearestFoe(run, f) {
  let best = null;
  let d = Infinity;
  for ( const o of run.units ) {
    if ( o === f || !isStanding(o) || !areEnemies(run, f, o) ) continue;
    const x = edgeDistance(f, o);
    if ( x !== null && x < d ) { d = x; best = o; }
  }
  return { foe: best, d };
}

const meleeOf = u => (u.prep?.offense ?? []).filter(a => a.melee);
const shoots = u => (u.prep?.offense ?? []).some(a => a.range && !a.melee);
const reachOf = u => Math.max(5, ...meleeOf(u).map(a => a.reach ?? 5));

/**
 * Who u waits for as its turn begins, where the system lets it Delay (rules.delay): {why, afterId, forId} (it comes back
 * after `afterId`'s turn; `forId`, what it waits on: the foe, the friend), or null to take its turn now. Only for one
 * on its feet and able to act in the fight (the simulator's to say: `able`), that hasn't delayed this round. With
 * `rules.delay.toEnd` (API 35), it comes back at the round's end whatever it waits for (`afterId` null).
 */
export function delayFor(run, u, { able = true } = {}) {
  const plan = planDelay(run, u, able);
  return plan && run.prep.rules.delay?.toEnd ? { ...plan, afterId: null } : plan;
}

/** delayFor's reason to wait, and whom it comes back after. */
function planDelay(run, u, able) {
  const rules = run.prep.rules;
  if ( !rules.delay || !orderly(rules) || !able || !(run.round >= 1) || u.rejoined === run.round ) return null;
  if ( !isStanding(u) || u.spec.hazard || u.summoner || u.leaving || u.fetch || u.bound || u.boundBy ) return null;
  const later = laterThisRound(run, u);
  if ( !later.length ) return null;
  // (The system's own reason to wait, API 34: DCC's caster waiting to answer a foe's spell.)
  const own = rules.delay.waitFor?.(run, u, later) ?? null;
  if ( own?.afterId ) return { why: own.why ?? "system", afterId: own.afterId, forId: own.forId ?? null };
  const reasons = rules.delay.reasons ?? REASONS;
  const tier = liveTier(run, u);
  // A standoff it wouldn't talk in: after the last who might break it, if it's likely enough someone will.
  if ( run.standoff ) {
    if ( !reasons.includes("standoff") ) return null;
    if ( isNeutral(u) || prefersTalk(u) || tier < TACTICAL.INSTINCTIVE ) return null;
    const breakers = later.filter(o => !isNeutral(o) && o.side !== u.side);
    const keeps = breakers.reduce((p, o) => p * (1 - impatience(run, o)), 1);
    if ( !breakers.length || 1 - keeps < DELAY.standoff ) return null;
    return { why: "standoff", afterId: breakers.at(-1).id, forId: null };
  }
  const thinks = tier >= TACTICAL.COMPETENT || (Number(behaviorOf(u).slacks) || 0) > 0;
  if ( !thinks ) return null;
  return (reasons.includes("reach") ? waitForReach(run, u, later) : null) ?? (reasons.includes("aid") ? waitForAid(run, u, later) : null);
}

/** The core's own reasons to Delay (rules.delay.reasons narrows them: API 34). */
const REASONS = Object.freeze(["standoff", "reach", "aid"]);

/** No foe it can strike this turn, nor shoot: the first after it likely to come to it, if there's one. */
function waitForReach(run, u, later) {
  if ( !run.prep.options.positioning || !u.pos || !meleeOf(u).length || shoots(u) ) return null;
  const rules = run.prep.rules;
  const { d } = nearestFoe(run, u);
  // (As far as it could walk this turn and still strike: its reach alone, held where it is.)
  const walks = canMove(run, u) ? speedOf(u) * Math.max(0, unitsPerTurn(rules, u) - 1) : 0;
  if ( !Number.isFinite(d) || d <= walks + reachOf(u) ) return null;
  for ( const f of later ) {
    if ( !areEnemies(run, u, f) || heldOff(run, u, f) || f.leaving || !meleeOf(f).length || shoots(f) ) continue;
    const near = nearestFoe(run, f);
    const gap = edgeDistance(f, u);
    if ( near.foe !== u || gap === null || gap - reachOf(f) > speedOf(f) * unitsPerTurn(rules, f) ) continue;
    return { why: "reach", afterId: f.id, forId: f.id };
  }
  return null;
}

/** The first friend after it whose bolstering is worth waiting for. */
function waitForAid(run, u, later) {
  for ( const a of later ) {
    if ( a.side !== u.side || isNeutral(a) || !a.prep.buffActions?.length || a.conds?.incapacitated ) continue;
    const mine = aidScores(run, a).find(x => x.ally === u);
    if ( mine && mine.score >= DELAY.aid ) return { why: "aid", afterId: a.id, forId: a.id };
  }
  return null;
}

/**
 * Its place in the turn order once it comes back (from Delay): just after `after`'s, or (null) the round's last. The
 * order is changed in place: a round going through it carries on from `after`, and comes to no one twice.
 */
export function moveInOrder(order, u, after = null) {
  const from = order.indexOf(u);
  if ( from < 0 ) return;
  order.splice(from, 1);
  const at = after ? order.indexOf(after) : -1;
  order.splice(at >= 0 ? at + 1 : order.length, 0, u);
}

/* -------------------------------------------- */
/*  Ready                                       */
/* -------------------------------------------- */

/** The Strike u could ready (the system's `most` at most), or null. */
export function readyStrike(rules, u) {
  const strike = bestReactionStrike(u);
  if ( !strike ) return null;
  const most = rules.ready?.most ?? 1;
  return costUnits(rules, costOf(rules, strike, u)) <= most ? strike : null;
}

/** Is p within o's reach of `strike`, sizes and all (as simulator.js throughReach reckons it)? */
function inReachAt(u, o, p, strike) {
  const half = ((u.spec.position?.size ?? 5) + (o.spec.position?.size ?? 5)) / 2 - 5;
  return Math.max(5, Math.hypot(p.x - o.pos.x, p.y - o.pos.y) - half) <= (strike.reach ?? 5) + 0.5;
}

/**
 * How likely foes are to come within u's reach before its next turn: each one not there yet that could get there in
 * a turn, READY.melee if it fights in melee and has no shot, READY.ranged otherwise, halved where u isn't its nearest
 * foe; together, and the likeliest. {chance, foe}.
 */
export function readyChance(run, u, strike) {
  const rules = run.prep.rules;
  let miss = 1;
  let best = null;
  let bestP = 0;
  for ( const f of run.units ) {
    if ( f === u || !isStanding(f) || !f.active || !areEnemies(run, u, f) || heldOff(run, u, f) || f.leaving || !f.pos ) continue;
    if ( inReachAt(f, u, f.pos, strike) ) continue;
    const gap = edgeDistance(u, f);
    if ( gap === null || gap - (strike.reach ?? 5) > speedOf(f) * unitsPerTurn(rules, f) ) continue;
    let p = meleeOf(f).length && !shoots(f) ? READY.melee : READY.ranged;
    if ( nearestFoe(run, f).foe !== u ) p *= READY.notNearest;
    miss *= 1 - p;
    if ( p > bestP ) { bestP = p; best = f; }
  }
  return { chance: 1 - miss, foe: best };
}

/**
 * Readying a Strike with what's left of the turn, as a spare step (behavior/prepare.js spareBest), `attacks` made in it
 * so far (the readied blow's penalty): {step: "ready", cost, worth, action, target, attacks}, or null where the system
 * has no Ready, the turn can't pay for it, it has no reaction left, nothing to ready or no foe likely to come.
 */
export function readyStep(run, u, turn, { attacks = 0 } = {}) {
  const rules = run.prep.rules;
  if ( !rules.ready || !orderly(rules) || u.readied || !u.pos || !run.prep.options.positioning ) return null;
  const cost = normalizeCost(rules, rules.ready.cost ?? 2);
  if ( !turn.canAfford(cost) || !((u.reactionsLeft ?? 0) > 0) ) return null;
  const strike = readyStrike(rules, u);
  if ( !strike ) return null;
  const { chance, foe } = readyChance(run, u, strike);
  if ( !foe ) return null;
  // (Its reaction would have struck a foe coming close anyway, where it has an opportunity strike: worth less.)
  const opportunity = !!rules.opportunity?.(u, foe);
  const worth = chance * expectedDamage(run, u, strike, foe, attacks) * (opportunity ? READY.reaction : 1);
  return { step: "ready", cost, worth, action: strike, target: foe, attacks };
}

/** A Strike readied (readyStep's): paid for, and held until its next turn. Told. */
export function takeReady(run, u, turn, pick, say) {
  turn.spend(pick.cost);
  u.readied = { actionId: pick.action.id, round: run.round, attacks: pick.attacks ?? 0 };
  run.readying = true;
  say(u, { type: "ready", action: pick.action.name ?? "", target: pick.target?.spec.name ?? "", targetId: pick.target?.id ?? null });
}

/** What u readied, as its action (or null: none, or the action's gone). */
export function readiedAction(u) {
  if ( !u.readied ) return null;
  return (u.prep?.offense ?? []).find(a => a.id === u.readied.actionId) ?? null;
}

/**
 * The foes whose readied Strike a move of u's sets off: each on its feet, with its reaction, whose reach the move
 * came into (it began outside it; without places on the map, it came to blows with them). [{o, strike}].
 */
export function readiedAgainst(run, u, move) {
  if ( !run.readying || !isStanding(u) ) return [];
  const out = [];
  for ( const o of run.units ) {
    if ( o === u || !o.readied || !isStanding(o) || !((o.reactionsLeft ?? 0) > 0) || !areEnemies(run, o, u) || heldOff(run, o, u) ) continue;
    const strike = readiedAction(o);
    if ( !strike ) continue;
    const came = o.pos && u.pos && move?.from
      ? inReachAt(u, o, u.pos, strike) && !inReachAt(u, o, move.from, strike)
      : !u.pos && !!move?.reached && u.adjacent?.has(o.id);
    if ( came ) out.push({ o, strike });
  }
  return out;
}
