/**
 * What an action needs before it can be used (`action.requires`): something the creature sets up first (a grab, a hit,
 * two hits on the same foe), or a state of its own or of its target. Checked wherever the engine decides what a
 * creature can do: the options it weighs against a foe (targeting.js bestOptionVs, and the openings only another foe
 * allows), and a hazard's routine. The Statistics Engine also counts what an option sets up: a claw that would make a
 * Rend possible is worth more than its own damage (followUpWorth).
 *
 * `requires` is an object whose entries must all hold, or a list of such objects, any one of which will do:
 *  - holding: true           the target is one it holds: grabbed by it, or held by something it laid (restrained,
 *                            paralyzed, an effect an Escape breaks). PF2e Constrict, Blood Drain.
 *  - target: [keys]          the target has one of these conditions (the core's keys: CORE_CONDITIONS). "unconscious"
 *                            is also one down at 0 hit points; "grabbed", anyone's grab; "offGuard", however it's
 *                            exposed (prone, grabbed, flanked ...); "restrained", tied up too. PF2e Drink Blood.
 *  - lastHit: true | {with}  its last action was a Strike that hit; the target, the one it hit. `with`: only these
 *                            Strikes (their ids, or the id of the Strike a blow is built on: a multiattack's part has
 *                            it as `from`). PF2e Wicked Bite.
 *  - hits: {n, with}         its last n Strikes this turn hit the same foe (with these Strikes); the target, that foe.
 *                            Once used, it takes n fresh hits again. PF2e Rend.
 *  - self: [keys]            it has one of these conditions itself ("hidden": invisible too). PF2e Sudden Slices.
 *  - shieldRaised: true      its shield is raised.
 * A Strike counts toward lastHit and hits only on the creature's own turn. "Its last action" is the last thing it paid
 * for from its turn (a Stride, a shield raised, a word spoken: engine/turn.js counts them).
 * Pure: no Foundry globals.
 */
import { STATUS } from "../../constants.js";
import { degreeDistribution } from "../probability.js";
import { attackRoll, attackOptions, currentAc, boostBonus, isExposed } from "../battle-state.js";
import { costOf, normalizeCost, mainPool } from "../turn.js";
import { expectedDamage, hasUses, attacksIn } from "./evaluate.js";
import { controlDistribution, controlOutcome } from "./control.js";
import { withManeuver } from "../maneuvers.js";

/** The vocabulary, for anyone checking a spec (and the docs). */
export const REQUIRES = Object.freeze(["holding", "target", "lastHit", "hits", "self", "shieldRaised"]);

/** How much of what a follow-up would do counts toward the option that sets it up: the rest pays for its own action. */
export const SETUP_SHARE = 0.5;

/** The ways an action's requirement may be met: a list of alternatives (each one's entries all hold), or null for none. */
export function requirementsOf(action) {
  const r = action?.requires;
  if ( !r ) return null;
  const list = (Array.isArray(r) ? r : [r]).filter(x => x && typeof x === "object");
  return list.length ? list : null;
}

/** The ids a blow counts as: its own, and the Strike it's built on (`from`). */
const idsOf = action => [action.id, action.from].filter(x => x !== undefined && x !== null);

/** Is a blow (or an action about to be made) one of these Strikes (any, without a list)? */
const madeWith = (ids, list) => !list?.length || ids.some(id => list.includes(id));

/** A requirement's `with`, from lastHit: true or {with}. */
const withOf = x => (x && typeof x === "object" ? x.with ?? null : null);

/** Its own turn's Strikes, since this action last used them up (setupUsed); none outside its own turn. */
function freshBlows(run, u, action) {
  if ( run.acting !== u ) return [];
  return (u.blows ?? []).slice(u.setupSpent?.[action.id] ?? 0);
}

/** The count of what it has paid for from its turn (turn.js), or null outside its own turn. */
const actsNow = (run, u) => (run.acting === u && Number.isFinite(u.turn?.acts) ? u.turn.acts : null);

/** Does t have this condition, as `requires` reads it (`by`: the one asking, for offGuard)? */
export function hasCondition(run, t, key, by = null) {
  if ( !t ) return false;
  const on = k => Number(t.conds?.[k]) > 0 || t.conds?.[k] === true;
  switch ( key ) {
    case "prone": return !!t.prone;
    case "grabbed": return !!t.grabbedBy || on("grabbed");
    case "unconscious": return t.status === STATUS.DOWN || on("unconscious") || on("asleep");
    case "restrained": return on("restrained") || !!t.bound || !!t.boundBy || t.status === STATUS.BOUND;
    case "hidden": return on("hidden") || on("invisible");
    case "offGuard": return on("offGuard") || isExposed(run, t, by);
    default: return on(key);
  }
}

/** Does u hold t: its grab, or a hold it laid (restrained, paralyzed, or anything an Escape breaks)? */
export function holds(u, t) {
  if ( !u || !t || u === t ) return false;
  if ( t.grabbedBy === u.id ) return true;
  return (t.effects ?? []).some(e => e.sourceId === u.id && !e.onlyVs
    && (e.escape || Number(e.conditions?.restrained) > 0 || Number(e.conditions?.grabbed) > 0 || Number(e.conditions?.paralyzed) > 0));
}

/** The foe its last action hit, if its last action was a Strike that hit (with these Strikes): its id, or null. */
function lastHitOn(run, u, action, list) {
  const now = actsNow(run, u);
  const blows = freshBlows(run, u, action);
  const last = blows.at(-1);
  if ( !last || now === null || last.act !== now - 1 || !last.hit || !madeWith(last.ids, list) ) return null;
  return last.targetId;
}

/** The foe its last n Strikes this turn all hit (with these Strikes), or null. */
function hitsOn(run, u, action, n, list) {
  const blows = freshBlows(run, u, action).slice(-Math.max(1, n));
  if ( blows.length < Math.max(1, n) ) return null;
  const foe = blows[0].targetId;
  return blows.every(b => b.hit && b.targetId === foe && madeWith(b.ids, list)) ? foe : null;
}

/** Does one alternative of a requirement hold for u using `action` against t? */
function holdsFor(run, u, action, t, r) {
  if ( r.holding && !holds(u, t) ) return false;
  if ( Array.isArray(r.target) && r.target.length && !r.target.some(k => hasCondition(run, t, k, u)) ) return false;
  if ( Array.isArray(r.self) && r.self.length && !r.self.some(k => hasCondition(run, u, k)) ) return false;
  if ( r.shieldRaised && !(u.shieldRaised && u.spec.shield) ) return false;
  if ( r.lastHit && lastHitOn(run, u, action, withOf(r.lastHit)) !== t?.id ) return false;
  if ( r.hits && hitsOn(run, u, action, Number(r.hits.n) || 2, r.hits.with ?? null) !== t?.id ) return false;
  return true;
}

/**
 * Can u use this action against t now, as its requirement says (true for an action with none)? Without a target, only
 * what it needs of itself is asked (self, shieldRaised).
 */
export function meets(run, u, action, t = null) {
  const list = requirementsOf(action);
  if ( !list ) return true;
  return list.some(r => (t ? holdsFor(run, u, action, t, r) : holdsFor(run, u, action, null, { self: r.self, shieldRaised: r.shieldRaised })));
}

/** A Strike u made on its own turn, for lastHit and hits (the simulator, as each attack roll lands or misses). */
export function noteBlow(run, u, action, target, degree) {
  if ( run.acting !== u || !target ) return;
  (u.blows ??= []).push({ ids: idsOf(action), targetId: target.id, hit: degree >= 2, crit: degree === 3, act: actsNow(run, u) ?? 0 });
}

/** A new turn: no Strikes yet, and nothing used up. */
export function freshTurn(u) {
  u.blows = null;
  u.setupSpent = null;
}

/** It used an action with a requirement: the Strikes that set it up count for it no more. */
export function setupUsed(u, action) {
  if ( !requirementsOf(action) ) return;
  (u.setupSpent ??= {})[action.id] = u.blows?.length ?? 0;
}

/* -------------------------------------------- */
/*  What an option sets up                      */
/* -------------------------------------------- */

/** The chance a Strike (or a multiattack's last part) hits t, made after `made` attacks this turn. */
function hitChance(run, u, action, t, made) {
  const strike = action.sequence?.length ? action.sequence.at(-1) : action;
  if ( !(strike.kind === "strike" || strike.kind === "spell-attack") ) return 0;
  const before = made + (action.sequence?.length ? action.sequence.length - 1 : 0);
  const r = attackRoll(run, u, t, strike, before);
  const ac = currentAc(run, t, u, strike);
  const opts = attackOptions(r);
  const dist = degreeDistribution(run.prep.rules, r.bonus + boostBonus(run.prep.rules, u, t, r.bonus, ac, opts), ac, opts);
  return dist[2] + dist[3];
}

/** Does an outcome lay this on its target (grabbed: a grab, or a hold that comes with one)? */
const laysKey = (o, key) => !!o && typeof o === "object" && !o.self
  && (key === "grabbed" ? !!o.grab || Number(o.conditions?.grabbed) > 0 || Number(o.conditions?.restrained) > 0 : Number(o.conditions?.[key]) > 0);

/** The chance a control action lays this on t, as its roll goes (behavior/control.js). */
function controlLays(run, u, action, t, key, attacksMade = 0) {
  return controlDistribution(run, u, t, action, attacksMade).reduce((s, p, d) => s + (laysKey(controlOutcome(action, d), key) ? p : 0), 0);
}

/**
 * The chance a Strike's hit lays this on its target, by its riders: a grab, a knockdown (sure); a maneuver of its own
 * (kind "control": PF2e's Improved Grab), as its roll goes.
 */
function riderLays(run, u, action, t, key) {
  let p = 0;
  for ( const e of (action.sequence?.length ? action.sequence.at(-1) : action).effects ?? [] ) {
    if ( e.kind === key ) return 1;
    if ( e.kind === "control" && e.control && !e.critOnly ) p = Math.max(p, controlLays(run, u, withManeuver(e.control), t, key));
  }
  return p;
}

/** The ids an option's blow would count as (a multiattack: its last part's). */
const blowIds = action => idsOf(action.sequence?.length ? action.sequence.at(-1) : action);

/** Its actions with a requirement (kept once per creature). */
const followUpsOf = u => (u.prep.followUps ??= (u.prep.offense ?? []).filter(a => requirementsOf(a)));

/**
 * What an option against t is worth beyond its own damage, for what it sets up this turn (or, for a hold, from now on):
 * the chance it brings a follow-up's requirement about, times what the follow-up would then do (its own expected worth:
 * its damage, a maneuver's control; SETUP_SHARE of it), as long as the turn left can pay for both.
 *  - lastHit: a Strike that would make its last action a hit with one of the listed Strikes (PF2e's Grab after it).
 *  - hits: a Strike that would make the run of hits on t one longer (all of it, if the turn has room for the rest).
 *  - holding, or a target condition it lays (grabbed, prone): a Strike whose hit grabs t or knocks it down (a rider, or
 *    a maneuver rider as its roll goes), or a maneuver that would (a control action, even one that needs something
 *    first itself: PF2e's Grab, setting up a Constrict).
 * @param {object} [turn]  what's left of the turn (Turn); without one, a whole turn is assumed
 */
export function followUpWorth(run, u, action, t, attacksMade = 0, turn = null) {
  const followUps = followUpsOf(u);
  if ( !followUps.length ) return 0;
  const blow = action.kind === "strike" || action.kind === "spell-attack";
  const control = action.kind === "control";
  // (What needs a blow first sets nothing up by its own blow: Rend wants fresh hits. A maneuver may lay what another needs.)
  if ( !(control || (blow && !requirementsOf(action))) ) return 0;
  const rules = run.prep.rules;
  const main = mainPool(rules);
  const units = cost => normalizeCost(rules, cost)[main] ?? 0;
  const left = turn ? turn.left : (rules.turn ? rules.turn(u)?.[main] : rules.actionsPerTurn) ?? 1;
  const own = units(costOf(rules, action, u));
  const made = attacksMade + (control ? attacksIn(action) : (action.sequence?.length ?? 1));
  let best = 0;
  let p = null;
  const chance = () => (p ??= hitChance(run, u, action, t, attacksMade));
  const lays = key => {
    if ( control ) return controlLays(run, u, action, t, key, attacksMade);
    const sure = riderLays(run, u, action, t, key);
    return sure > 0 ? chance() * sure : 0;
  };
  for ( const f of followUps ) {
    if ( f === action || !hasUses(u, f) ) continue;
    const fCost = units(costOf(rules, f, u));
    for ( const r of requirementsOf(f) ) {
      let odds = 0;
      let room = own + fCost <= left;
      if ( blow && r.lastHit && madeWith(blowIds(action), withOf(r.lastHit)) ) odds = chance();
      else if ( blow && r.hits && madeWith(blowIds(action), r.hits.with ?? null) ) {
        const n = Math.max(1, Number(r.hits.n) || 2);
        const blows = freshBlows(run, u, f);
        let have = 0;
        for ( let i = blows.length - 1; i >= 0 && blows[i].hit && blows[i].targetId === t.id && madeWith(blows[i].ids, r.hits.with ?? null); i-- ) have += 1;
        const missing = Math.max(1, n - have);
        room = own * missing + fCost <= left;
        odds = chance() ** missing / missing;
      } else if ( (r.holding || r.target?.includes("grabbed")) && !t.grabbedBy ) {
        odds = lays("grabbed");
        room = true; // (a hold lasts: what it sets up can wait for its next turn)
      } else if ( r.target?.includes("prone") && !t.prone ) odds = lays("prone");
      if ( !(odds > 0) || !room ) continue;
      best = Math.max(best, odds * SETUP_SHARE * expectedDamage(run, u, f, t, made));
    }
  }
  return best;
}
