/**
 * Foes who fall: tying them up and robbing them, mid-fight and once it's over. (Finishing them off and sparing them:
 * targeting.js, battle-state.js holdsBack, simulator.js mercyOf and the aftermath.)
 *
 *  - Tying up: a foe that's down (dying, out cold, held at the edge by its regeneration) is tied up with whatever's to
 *    hand (there's always something: a rope, a strap, its own belt). It takes an action beside it (rules.bindCost; by
 *    default the system's basic action). Tied up, it's out of the fight for good: healed, or coming to, it's a
 *    prisoner (STATUS.BOUND), not a fighter. Its dying goes on as before; one who takes prisoners tends it after the
 *    fight, as one who spares the fallen does.
 *  - Robbing: a fallen foe's purse comes off it (whole; a share, where its side pools what it has), else something it
 *    carries, else (a creature's, not a player character's) what it was wielding or wearing. An action beside it
 *    (rules.lootCost; by default the basic action), once for each who robs it. A player character's things go only on
 *    the luck check a thief needs against one (theftLuck): the GM's secret, never told. Like anything taken, it comes
 *    back if the robber ends the fight beaten.
 *  - Freeing a friend tied up (or held as the system says a friend can break: behavior/holds.js): desire "free", acted
 *    on the same way, beside it (holds.js untieCost); untying takes no roll unless the system says so.
 *  - Who does it: whoever wants to (desires "bind" and "rob": its answer to "Foes who fall" and its party's, its
 *    pills, its leader, or a desire stated for it). Mid-fight it acts on it only when that leads its desires, at a
 *    fallen foe it can get to this turn. Its answer's wish is stronger than the foe its tactics would pick when there's
 *    no foe it could fight where it stands (on a map: none within reach); without a map, every foe is, and it waits for
 *    the fight to be over. After the fight, whoever ties them up ties up the fallen its side beat, and whoever robs
 *    them robs them.
 * Pure: no Foundry globals.
 */
import { STATUS, THEFT_LUCK } from "../../constants.js";
import { isStanding, enemiesOf, movesNeeded, canMove } from "../battle-state.js";
import { mind, think, styleOf, wantsKind } from "./desire.js";
import { remaining } from "./talk.js";
import { robbable } from "./theft.js";
import { perceives } from "./senses.js";
import { mainPool, normalizeCost } from "../turn.js";
import { isBound, freeable, untieCost, tryHold, release } from "./holds.js";
import { holderOf } from "./troubles.js";

/** An answer's wish for each fallen foe: a passing one while there's a foe it could fight where it stands ... */
export const FALLEN_LEVEL = 30;
/** ... and with none, stronger than the foe its tactics would pick (desire.js levelsFromScores: up to 60). */
const FALLEN_FREE = 32;
/** Pills this keen on tying up (or robbing) the fallen do it after a fight, with no answer of their own. */
const KEEN = 10;
/** Right beside it. */
const BESIDE = Object.freeze({ reach: 5 });

/** Its answer to "Foes who fall" in this fight (its own, or its party's: playstyles.js sampleRunTactics), or null. */
const answerOf = u => u.tac?.fallen ?? null;

/** What tying up (or robbing) costs from a turn. */
export const fallenCost = (rules, kind) => normalizeCost(rules, (kind === "bind" ? rules.bindCost : rules.lootCost) ?? rules.basicAction ?? 1);

/** Does u tie up the fallen once the fight is over? Its answer says; without one, its pills (if keen enough). */
export function takesPrisoners(u) {
  const said = answerOf(u);
  return said ? said === "tie" : (styleOf(u).bind ?? 0) >= KEEN;
}

/** Does u rob the fallen once the fight is over? */
export function robsTheFallen(u) {
  const said = answerOf(u);
  return said ? said === "rob" : (styleOf(u).rob ?? 0) >= KEEN;
}

/**
 * Its answer's wishes this turn (deliberate): to finish off, tie up or rob each fallen foe it can tell is there, as
 * strongly as it's free to.
 */
export function fallenWishes(run, u) {
  const kind = { finish: "hurt", tie: "bind", rob: "rob" }[answerOf(u)];
  if ( !kind || !u.desire ) return;
  // (Free: no foe standing that it could fight without going to it.)
  const free = !enemiesOf(run, u).some(e => e.active && isStanding(e) && movesNeeded(run, u, e, BESIDE) === 0);
  const level = FALLEN_LEVEL + (free ? FALLEN_FREE : 0);
  for ( const t of enemiesOf(run, u) ) {
    if ( !t.active || !perceives(run, u, t) ) continue;
    const fits = kind === "hurt" ? t.status === STATUS.DOWN && !t.stable
      : kind === "bind" ? t.status === STATUS.DOWN && !isBound(t)
        : (t.status === STATUS.DOWN || t.status === STATUS.BOUND) && robbable(t) && !u.robbedFrom?.has(t.id);
    if ( fits ) think(u, kind, t.id, level);
  }
}

/** What it may want of a fallen foe (or a friend held). */
const FALLEN_KINDS = Object.freeze(["bind", "rob", "free"]);

/**
 * Whether u ties up or robs a fallen foe (or frees a friend) now, the next step of its turn: when that's what it most
 * wants, at one it can get to this turn. {kind, target, moves, cost, hold}, or null.
 */
export function decideFallen(run, u, turn) {
  // (Wanting none of these, none of them leads: no need to ask its mind, every step of every turn.)
  if ( !wantsKind(u, FALLEN_KINDS) ) return null;
  const lead = mind(run, u).lead;
  if ( lead?.kind !== "bind" && lead?.kind !== "rob" && lead?.kind !== "free" ) return null;
  const t = run.byId.get(lead.targetId);
  if ( !t || (lead.kind === "rob" && u.robbedFrom?.has(t.id)) ) return null;
  const rules = run.prep.rules;
  const hold = lead.kind === "free" ? freeable(run, t) : null;
  if ( lead.kind === "free" && !hold ) return null;
  const cost = hold ? untieCost(rules, u, t, hold) : fallenCost(rules, lead.kind);
  // (One held inside another, a corpse to cut open: the work's done beside the one holding it.)
  const moves = movesNeeded(run, u, hold ? holderOf(run, t) ?? t : t, BESIDE);
  if ( !moves ) return turn.canAfford(cost) ? { kind: lead.kind, target: t, moves: 0, cost, hold } : null;
  if ( !Number.isFinite(moves) || moves > 1 || !canMove(run, u) ) return null;
  // (Getting there and doing it, this turn.)
  const pool = mainPool(rules);
  const units = turn.unitsForMoves(moves, run.prep.approachOf(u.id, t.id).speed);
  return turn.canAfford({ ...cost, [pool]: (cost[pool] ?? 0) + units }) ? { kind: lead.kind, target: t, moves, cost, hold } : null;
}

/** u ties t up. */
export function bind(run, u, t, say, { aftermath = false } = {}) {
  t.bound = true;
  t.boundBy = u.id;
  t.boundRound = run.round;
  say(u, { type: "bind", target: t.spec.name, targetId: t.id, aftermath });
}

/** What comes off a fallen foe: its purse (a share, where its side pools it), else something it carries, else (a creature's) what it held or wore. */
function loot(run, t) {
  const v = remaining(t);
  // (What's on it: its team's purse isn't.)
  if ( v.own > 0 ) {
    const pooled = (t.pool?.length ?? 1) > 1;
    const percent = pooled ? run.rng.die(10) : 100;
    return { kind: "money", amount: pooled ? Math.max(1, Math.round(v.own * percent / 100)) : v.own, percent, denominations: v.denominations ?? null };
  }
  if ( v.stowed.length ) return { kind: "item", item: run.rng.pick(v.stowed) };
  // (Fallen, a creature's weapon or armor is there for the taking: the only time what it wields or wears changes hands.)
  const gear = [...v.wielded, ...v.worn];
  if ( t.spec.kind !== "pc" && gear.length ) return { kind: "item", item: run.rng.pick(gear) };
  return null;
}

/** u robs t (once: what's on it is either found or it isn't). */
export function rob(run, u, t, say, { aftermath = false } = {}) {
  (u.robbedFrom ??= new Set()).add(t.id);
  const taken = loot(run, t);
  if ( !taken ) return say(u, { type: "rob", target: t.spec.name, targetId: t.id, stolen: null, aftermath });
  const record = { ...taken, how: "loot", to: u.id, toName: u.spec.name, round: run.round };
  // (A player character's things: only on a thief's luck check against one, the GM's secret.)
  if ( t.spec.kind === "pc" ) {
    record.luck = run.rng.die(100);
    record.needed = run.prep.options.theftLuck ?? THEFT_LUCK;
    record.kept = record.luck > record.needed;
  }
  (t.concessions ??= []).push(record);
  say(u, { type: "rob", target: t.spec.name, targetId: t.id, stolen: record.kept ? null : record, aftermath });
}

/**
 * A tied-up creature that comes to (healed, recovered, regenerated, or so its sheet says): still tied up, a prisoner,
 * out of the fight. True when it was.
 */
export function stayBound(run, u, say) {
  if ( !isBound(u) || u.status !== STATUS.STANDING ) return false;
  u.status = STATUS.BOUND;
  say?.(u, { type: "bound", by: run.byId.get(u.boundBy)?.spec.name ?? "", byId: u.boundBy ?? null });
  return true;
}

/** A roll's numbers for the log (what a try at a hold rolled, if it rolled). */
export const rollOf = got => Object.fromEntries(["natural", "mod", "total", "dc", "degree"].filter(k => got?.[k] !== undefined).map(k => [k, got[k]]));

/** u frees t of a hold (untying it, or as the system says), or tries to. */
export function freeFriend(run, u, t, hold, say) {
  const got = tryHold(run, u, hold, { freeing: true, held: t });
  if ( got.success ) release(run, t, hold);
  say(u, { type: "free", target: t.spec.name, targetId: t.id, hold: hold.key, success: got.success, ...rollOf(got), ...(got.said?.text ? { said: got.said.text } : {}) });
}
