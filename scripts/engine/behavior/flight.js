/**
 * Leaving of its own accord, as its turn begins (simulator.js; behavior/leaving.js carries it out):
 *  - Life over loot: a hostile NPC with nobody leading it, or led by one who'd rather run (its commander already going or
 *    out of it, one whose answer is to retreat once hurt, a flighty one: a Chicken), weighs its own life against what
 *    winning would bring it. Its life: how timid it is, by the danger it's in (hurt, outnumbered). The loot: how greedy it is,
 *    by how likely its side looks to win, the less where the foes carry nothing worth having (not the fearless, nor a
 *    feral mind). Its life much the heavier
 *    (more than twice), it may go, the likelier the heavier (lifeOverLoot). Only where leadership counts in the fight,
 *    and a creature alone is nobody's follower.
 *  - Off with the prize: an NPC that has taken something this fight (stolen, robbed off the fallen, picked up off the
 *    ground, paid to it) wants away to keep it: the bigger the haul against what it had of its own, the greedier, a
 *    Thief, or hurt, the likelier (prizeFlight). A scrap hardly tempts it; a dead boss's share of the team's cash does.
 * Pure: no Foundry globals.
 */
import { STATUS, HOSTILE_GROUPS, TACTICAL, clamp } from "../../constants.js";
import { isStanding, liveTrait, liveTier, commandOf, behaviorOf, enemiesOf, alliesOf, hpFraction } from "../battle-state.js";
import { remaining } from "./talk.js";
import { notDumb } from "../aptitudes.js";

/** The most a turn's chance of leaving of its own accord comes to. */
const MOST = Object.freeze({ life: 0.3, prize: 0.5 });
/** Its life must outweigh the loot this many times over before it thinks of going. */
const MUCH_MORE = 2;
/** What its life weighs unhurt and not outnumbered, before its timidity (the rest is the danger it's in). */
const LIFE_FLOOR = 0.2;
/** Off with the prize: the chance's parts (haul: at most, for a haul far beyond what it had; half that, for as much). */
const PRIZE = Object.freeze({ base: 0.04, haul: 0.24, selfish: 1 / 150, thief: 0.15, hurt: 0.15 });

/** An NPC that thinks for itself, on its feet and in the fight, not on its way already. */
const ownMind = u => u.spec.kind !== "pc" && !u.spec.hazard && !u.summoner && isStanding(u) && !u.leaving && !u.controlledBy && notDumb(u);

/**
 * Would its commander rather run, or is there nobody to lead it (where leadership counts in this fight: without it,
 * nobody leads anyone, and that's no reason)? Never so for the commander itself.
 */
function ledToRun(run, u) {
  if ( !run.prep.options.leadership ) return false;
  const cmd = commandOf(run, u);
  if ( !cmd ) return alliesOf(run, u).some(a => a !== u && a.active !== false && isStanding(a) && !a.spec.hazard);
  const c = cmd.unit;
  if ( c === u ) return false;
  return !!c.leaving || c.status !== STATUS.STANDING || c.tac?.retreat === "hurt" || (Number(behaviorOf(c).flighty) || 0) > 0;
}

/** How hard pressed u is, 0 to 1: badly hurt, or outnumbered by the foes on their feet. */
function pressed(run, u) {
  const hurt = clamp((0.6 - hpFraction(u)) / 0.5, 0, 1);
  const friends = alliesOf(run, u).filter(isStanding).length;
  const foes = enemiesOf(run, u).filter(o => o.active !== false && isStanding(o)).length;
  return Math.max(hurt, clamp((foes - friends) / Math.max(1, friends), 0, 1));
}

/** How likely u's side looks to win, 0 to 1: its standing hit points against its foes'. */
function odds(run, u) {
  const hp = list => list.filter(o => o.active !== false && isStanding(o)).reduce((s, o) => s + Math.max(0, o.hp), 0);
  const ours = hp(alliesOf(run, u));
  const theirs = hp(enemiesOf(run, u));
  return ours + theirs > 0 ? ours / (ours + theirs) : 0.5;
}

/**
 * Life over loot: the chance this turn that a hostile NPC, leaderless or led by one who'd rather run, leaves because
 * its life is worth more to it than what winning would bring. 0 when the loot weighs anything like as much.
 */
export function lifeOverLoot(run, u) {
  // (Weighing it takes a mind above a beast's; the fearless never do.)
  if ( !ownMind(u) || u.spec.flags?.fearless || liveTier(run, u) <= TACTICAL.FERAL || !HOSTILE_GROUPS.includes(u.side) || !ledToRun(run, u) ) return 0;
  const life = (100 - liveTrait(run, u, "brave")) / 100 * (LIFE_FLOOR + pressed(run, u));
  const rich = enemiesOf(run, u).some(o => { const v = remaining(o); return v.money > 0 || v.stowed.length > 0; });
  const loot = liveTrait(run, u, "selfish") / 100 * odds(run, u) * (rich ? 1 : 0.5);
  return life > MUCH_MORE * loot ? clamp((life - MUCH_MORE * loot) / 2, 0, MOST.life) : 0;
}

/** What u has taken this fight and still has (worth, in the smallest coin): stolen, looted, picked up, paid to it. */
export function prizeOf(run, u) {
  let worth = 0;
  for ( const o of run.units ) {
    for ( const c of o.concessions ?? [] ) {
      if ( c.to !== u.id || c.kept || c.returned || (c.drop && !c.picked) ) continue;
      worth += c.kind === "money" ? Number(c.amount) || 0 : (Number(c.item?.value) || 1) * (c.count ?? 1);
    }
  }
  return worth;
}

/** Off with the prize: the chance this turn that an NPC with something taken this fight leaves to keep it. */
export function prizeFlight(run, u) {
  const prize = ownMind(u) ? prizeOf(run, u) : 0;
  if ( !(prize > 0) ) return 0;
  const thief = (Number(behaviorOf(u).steal) || 0) > 0;
  // (How big a haul it is to u: against what it had of its own.)
  const haul = prize / (prize + Math.max(1, remaining(u).own));
  const chance = PRIZE.base + PRIZE.haul * haul + (liveTrait(run, u, "selfish") - 50) * PRIZE.selfish + (thief ? PRIZE.thief : 0)
    + (hpFraction(u) < 0.5 ? PRIZE.hurt : 0);
  return clamp(chance, 0, MOST.prize);
}

/** Whether u leaves of its own accord this turn, and why ("life", "prize"), or null. Never with morale off (or its side's). */
export function leavesOfItsOwn(run, u) {
  if ( run.prep.options.morale === false || run.prep.sides?.[u.side]?.morale === false ) return null;
  const prize = prizeFlight(run, u);
  if ( prize > 0 && run.rng.chance(prize) ) return "prize";
  const life = lifeOverLoot(run, u);
  if ( life > 0 && run.rng.chance(life) ) return "life";
  return null;
}
