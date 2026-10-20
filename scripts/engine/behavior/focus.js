/**
 * Focus fire: a desire to go for the foes its team has already hit. Nothing until one of them has been: then, whenever
 * it wants to hurt someone, a foe already hit is far likelier to be the one.
 *
 * Who has it (focusFire, 0 to 1): any creature with a pack bonus (flags.packTactics), fully; otherwise one with live
 * Tactical from FOCUS.from (a leader's tactical floor counts), as strongly as its Tactical, if it isn't dumb (aptitudes.js
 * notDumb); and on top of either, what its playstyles say (their desire guide's `focus`: a Cruel one piles onto the
 * bleeding whatever its Tactical or its wits). Never a hazard.
 *
 * How (the focus layer, behavior/desire.js; worked out each turn by focusWants, after its party's wishes and before its
 * leader's): each foe it could go for that its team has hit (alreadyHit: the foe's harmedBy has one of u's team, u
 * itself too) gets up to strength × FOCUS.points on its wish to hurt it, the most hurt the most. It's capped at FOCUS.over
 * past the strongest wish to hurt it had, so focus fire changes whom it hurts, not whether it hurts rather than heals or
 * talks; and never past a wish to hurt another that it's taunted into, told to want, or held to by the GM. One that plans ahead (Tactical tier and up) orders its agenda by strength, so that settles it; one that keeps
 * at what it's doing switches to a foe already hit as readily as it focuses (focusAgenda), when it's working on hurting
 * one that isn't and wants that one more.
 *
 * A leader who wants it (its top wish a foe already hit) sways its followers half as much again for that wish
 * (FOCUS.leader, desire.js listen: leaderFocus); a boss's own multiplier on top.
 *
 * The world's Non Player Focus Fire Dampener (options.focusDampener, 0 to 100) takes some of it from everyone not on
 * the friendly side: their strength, and a leader's extra sway, times 1 - FOCUS.damp × dampener / 100 (at 100, half).
 */
import { TACTICAL, STATUS, SIDES } from "../../constants.js";
import { liveTrait, liveTier, isStanding, groupKeyOf } from "../battle-state.js";
import { notDumb } from "../aptitudes.js";
import { keyOf, parseKey, levelOf, rankedDesires, styleOf } from "./desire.js";
import { apparentHealth } from "./senses.js";

/**
 * from: the least Tactical; points: what full strength adds; over: how far past its strongest wish to hurt; leader: a
 * leader's sway for it; damp: what the dampener takes at 100.
 */
export const FOCUS = Object.freeze({ from: 40, points: 50, over: 10, leader: 1.5, damp: 0.5 });

/** What the world's dampener leaves of u's focus fire: 1 on the friendly side; down to 1 - FOCUS.damp elsewhere. */
export function focusKept(run, u) {
  if ( u.side === SIDES.FRIENDLY ) return 1;
  const d = Math.max(0, Math.min(100, Number(run.prep.options?.focusDampener) || 0));
  return 1 - FOCUS.damp * d / 100;
}

/** How much more a commander's sway counts for its top wish (`top`), as one who focuses fire: FOCUS.leader, dampened; else 1. */
export function leaderFocus(run, leader, top) {
  if ( top?.kind !== "hurt" || !(focusFire(run, leader) > 0) || !alreadyHit(run, leader, run.byId.get(top.targetId)) ) return 1;
  return 1 + (FOCUS.leader - 1) * focusKept(run, leader);
}

/** Is a on u's team (its side; one standing aside, its friend group), u itself too? */
export const sameTeam = (u, a) => a === u || (!!a && groupKeyOf(u) !== null && groupKeyOf(a) === groupKeyOf(u));

/** Has u's team hit t (harmed it) already this fight? */
export function alreadyHit(run, u, t) {
  if ( !t?.harmedBy?.size ) return false;
  for ( const [id, harm] of t.harmedBy ) if ( harm > 0 && sameTeam(u, run.byId.get(id)) ) return true;
  return false;
}

/** How much u wants to focus fire, 0 to 1. */
export function focusFire(run, u) {
  if ( !u?.spec || u.spec.hazard ) return 0;
  if ( u.spec.flags?.packTactics ) return focusKept(run, u);
  const tactical = liveTrait(run, u, "tactical");
  const own = tactical >= FOCUS.from && notDumb(u) ? tactical / 100 : 0;
  return Math.max(0, Math.min(1, own + (Number(styleOf(u).focus) || 0))) * focusKept(run, u);
}

/**
 * This turn's focus layer: the foes it could go for (scored: its tactics' {t}) that its team has hit, each up to
 * strength × FOCUS.points the more hurt it looks (the most hurt all of it, the least half), capped FOCUS.over past the
 * strongest wish to hurt it had.
 */
export function focusWants(run, u, scored) {
  const d = u.desire;
  if ( !d ) return;
  d.focus ??= new Map();
  d.focus.clear();
  const strength = focusFire(run, u);
  if ( !(strength > 0) ) return;
  const hit = scored.filter(x => x.t.status === STATUS.STANDING && alreadyHit(run, u, x.t)).map(x => ({ t: x.t, hurt: 1 - apparentHealth(run, u, x.t) }));
  if ( !hit.length ) return;
  let best = 0;
  for ( const x of scored ) best = Math.max(best, levelOf(u, "hurt", x.t.id));
  // (What it's taunted into, told to want, or held to by the GM, focus fire never lifts another foe past.)
  const held = [];
  for ( const m of [d.taunt, d.stated, d.gm] ) {
    for ( const k of m?.keys() ?? [] ) {
      const [kind, id] = parseKey(k);
      if ( kind === "hurt" ) held.push({ id, level: levelOf(u, "hurt", id) });
    }
  }
  const most = Math.max(...hit.map(x => x.hurt));
  for ( const { t, hurt } of hit ) {
    const points = strength * FOCUS.points * (0.5 + 0.5 * (most > 0 ? hurt / most : 1));
    const ceiling = Math.min(best + FOCUS.over, ...held.filter(x => x.id !== t.id).map(x => x.level - 1));
    const room = ceiling - levelOf(u, "hurt", t.id);
    const add = Math.min(points, Math.max(0, room));
    if ( add > 0 ) d.focus.set(keyOf("hurt", t.id), add);
  }
}

/**
 * One that keeps at what it's doing (below Tactical tier): working on hurting a foe its team hasn't hit, with a wish to
 * hurt one it has that's stronger, it switches to that one as readily as it focuses. Call after orderAgenda.
 */
export function focusAgenda(run, u) {
  const top = u.agenda?.[0];
  if ( !top || !u.desire?.focus?.size || liveTier(run, u) >= TACTICAL.TACTICAL ) return;
  const ranked = rankedDesires(run, u);
  const lead = ranked.find(x => keyOf(x.kind, x.targetId) === top);
  if ( !lead || lead.sunk || lead.kind !== "hurt" || alreadyHit(run, u, run.byId.get(lead.targetId)) ) return;
  const rival = ranked.find(x => x.kind === "hurt" && !x.sunk && x.level > lead.level && u.desire.focus.has(keyOf(x.kind, x.targetId)));
  if ( !rival || !isStanding(run.byId.get(rival.targetId)) || !run.rng.chance(focusFire(run, u)) ) return;
  const k = keyOf(rival.kind, rival.targetId);
  u.agenda = [k, ...u.agenda.filter(x => x !== k)];
}
