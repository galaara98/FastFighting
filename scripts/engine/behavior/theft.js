/**
 * Theft in the middle of a fight is rare: most creatures who want your things mean to take them off your body
 * afterwards. Only a Thief (the playstyle) or someone really good at it (the system's stealing skill well above
 * what's typical for their level) considers it, and only when it's safe: their side is clearly winning, or they're
 * still hidden and their mark is alone (no friends nearby, or the two of them off on their own, more than one
 * ordinary move from anyone else in the fight). Then they may spend an action robbing an adjacent foe of money or something stowed,
 * instead of hitting them.
 *
 *  - The roll is the thief's skill against the victim's DC to resist it (CombatantSpec.social.resist.steal, which
 *    the system supplies; PF2e: Perception DC), with whatever the rules add (PF2e: -5 in combat).
 *  - Against a player character it takes a success AND a d100 luck check under 30 (29 or less).
 *  - A failed attempt is noticed: the victim goes after the thief. A success isn't.
 *  - Whatever is taken comes back at the end if the thief is beaten (like anything given up).
 * Pure: no Foundry globals.
 */
import { THEFT_LUCK, clamp } from "../../constants.js";
import { isStanding, areEnemies, edgeDistance, checkRoll, typical, liveTrait, alliesOf, enemiesOf, behaviorOf } from "../battle-state.js";
import { rollCheck } from "../probability.js";
import { remaining, concession } from "./talk.js";

/** Skill this far above typical for the level makes someone a thief, playstyle or not. */
const SKILLED = 3;

/** Has t anything a thief could lift (money, or gear that isn't held or worn)? */
function worthRobbing(t) {
  const v = remaining(t);
  return v.money > 0 || v.stowed.length > 0;
}

/** Is u's side clearly winning: more of them standing, or the other side has lost noticeably more? */
function winning(run, u) {
  const allies = alliesOf(run, u).filter(a => a.active !== false);
  const foes = enemiesOf(run, u).filter(f => f.active !== false);
  if ( !foes.length ) return false;
  const up = list => list.filter(isStanding).length;
  if ( up(allies) > up(foes) ) return true;
  const lost = list => 1 - up(list) / Math.max(1, list.length);
  return lost(foes) - lost(allies) >= 0.25;
}

/** Is t on its own: no standing ally of its own adjacent or within 30 ft? (Without a map, any ally counts as near.) */
function alone(run, t) {
  return !alliesOf(run, t).some(a => a !== t && isStanding(a) && (t.adjacent.has(a.id) || (edgeDistance(a, t) ?? 0) <= 30));
}

/** One ordinary move on this battlefield: the average speed of everyone in it (feet). */
function oneMove(run) {
  const speeds = run.units.map(u => Math.max(0, ...Object.values(u.spec.speeds ?? {}))).filter(v => v > 0);
  return speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 25;
}

/**
 * Are thief and mark off on their own: nobody else still in the fight within one ordinary move of either of them?
 * Nobody to see it and nobody to help. Needs the map: without positions it can't be judged.
 */
function offOnTheirOwn(run, u, t) {
  if ( !u.pos || !t.pos ) return false;
  const far = oneMove(run);
  return !run.units.some(o => o !== u && o !== t && isStanding(o) && [u, t].some(x => (edgeDistance(o, x) ?? 0) <= far));
}

/** Still unseen: a hidden creature that hasn't given itself away. */
const hiding = u => !!u.spec.hidden && !u.revealed;

/**
 * How likely u is to try robbing `mark` this turn. Zero unless u is a Thief or very skilled, and it's safe:
 * u's side is winning, or u is hiding and the mark is alone (no friends near, or the two off on their own).
 */
export function stealChance(run, u, mark = null) {
  const skill = u.spec.theft;
  if ( !skill || typeof skill.mod !== "number" ) return 0;
  const edge = skill.mod - typical(run.prep.rules, "skill", u.spec.level ?? 0);
  const thief = !!behaviorOf(u).steal;
  if ( !thief && edge < SKILLED ) return 0;
  const safe = winning(run, u) || (!!mark && hiding(u) && (alone(run, mark) || offOnTheirOwn(run, u, mark)));
  if ( !safe ) return 0;
  let p = 0.08 + (thief ? 0.25 : 0) + Math.max(0, edge) * 0.02 + Math.max(0, liveTrait(run, u, "selfish") - 50) / 400;
  return clamp(p, 0, 0.5);
}

/** An adjacent foe worth robbing, the richest first. */
export function theftTarget(run, u) {
  const marks = run.units.filter(t => t !== u && isStanding(t) && areEnemies(run, u, t) && worthRobbing(t)
    && (u.adjacent.has(t.id) || (edgeDistance(u, t) ?? Infinity) <= 5));
  return marks.sort((a, b) => remaining(b).money - remaining(a).money)[0] ?? null;
}

/**
 * Try to rob t. Returns what happened: {stolen, noticed, luck}.
 * @param {(unit, text, data) => void} log
 */
export function attemptTheft(run, u, t, log) {
  const rules = run.prep.rules;
  const resist = t.spec.social?.resist?.steal;
  const dc = resist?.dc ?? typical(rules, "dc", t.spec.level ?? 0);
  const check = checkRoll(run, u, u.spec.theft.mod);
  const extra = rules.modifiers?.steal?.({ thief: u, target: t }) ?? {};
  const mod = check.mod + (extra.bonus ?? 0);
  const roll = rollCheck(rules, run.rng, mod, dc, { advantage: (check.advantage ?? 0) + (extra.advantage ?? 0), kind: "check" });
  const data = {
    type: "theft", target: t.spec.name, targetId: t.id, skill: u.spec.theft.skill ?? "theft", natural: roll.natural, mod, total: roll.total,
    dc, dcStat: resist?.label ?? "DC", degree: roll.degree, margin: roll.total - dc
  };
  if ( roll.degree < 2 ) {
    // Caught in the act: the victim wants the thief now, and the thief is no longer hidden.
    (t.grudges ??= new Map()).set(u.id, { provoked: true });
    u.revealed = true;
    log(u, `tries to rob ${t.spec.name} and is caught`, { ...data, noticed: true });
    return { stolen: null, noticed: true };
  }
  // Robbing a player character needs luck as well as skill.
  let luck = null;
  if ( t.spec.kind === "pc" ) {
    luck = run.rng.die(100);
    if ( luck >= THEFT_LUCK ) {
      log(u, `nearly robs ${t.spec.name}, but comes away empty-handed (luck ${luck})`, { ...data, luck, stolen: null });
      return { stolen: null, noticed: false, luck };
    }
  }
  const taken = concession(run, t, { itemLuck: false });
  if ( !taken ) return { stolen: null, noticed: false, luck };
  const record = { ...taken, how: "theft", to: u.id, toName: u.spec.name, round: run.round, luck: luck ?? undefined };
  (t.concessions ??= []).push(record);
  log(u, `steals ${taken.kind === "money" ? `${taken.percent}% of ${t.spec.name}'s money` : `${taken.item.name} from ${t.spec.name}`}`, { ...data, luck, stolen: record });
  return { stolen: record, noticed: false, luck };
}
