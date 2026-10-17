/**
 * Animalistic creatures: those that fight as real animals do (spec.animalistic, the helper's call: an animal or a
 * beast by the system's own labels, or a creature of animal wits, very low to middling, with no language). Modeled on
 * a hyena (a pack scavenger), a tiger (a lone stalker) and an alligator (one that keeps to its water), in the engine's
 * own terms:
 *   - It reads the fight; it doesn't plan one: never more than instinctive (battle-state.js liveTier).
 *   - Prey drive: whatever it can make out that isn't its own is prey, bystanders too (preysOn, neutral.js seemsFoe),
 *     and the prey it picks is the nearest, the hurt, the small and the lone (targeting.js), unless what just hurt it is
 *     close: that, it turns on.
 *   - Self-preservation: hurt, it breaks off (retreat "hurt"), unless nothing frightens it (fearless). A pack holds its
 *     nerve together; a pack animal alone breaks the sooner (morale.js).
 *   - It eats what it brings down (fallen "finish") and, the fight done, goes after whatever else it can catch (beyond
 *     "hunt"), unless it keeps to its own ground: a swimmer slower ashore, or a burrower (beyond "stay").
 *   - No words and no hands for a latch: it never talks or parleys, picks no lock, and a closed door is one it can
 *     only break (simulator.js workTheDoor, doors.js doorPlan).
 * Its answers give way to the GM's and its playstyles' (animalTactics fills only what they leave).
 * Pure: no Foundry globals.
 */
import { TACTICAL } from "../../constants.js";

/** Is it animalistic? Its spec's say; an older helper's flags.beast, the same. */
export const isAnimalistic = u => !!(u?.spec?.animalistic ?? u?.spec?.flags?.beast);

/** Keeps to its own ground rather than roam after prey: a swimmer slower ashore (an alligator), or a burrower. */
export function keepsGround(spec) {
  const s = spec?.speeds ?? {};
  return (Number(s.swim) || 0) > (Number(s.walk) || 0) || (Number(s.burrow) || 0) > 0;
}

/** The tactics answers an animal fights by, where nothing else answered (the GM's, its playstyles'). */
export function animalTactics(spec) {
  return {
    style: "frontline",
    fallen: "finish",
    resourceUse: "nova",
    consumables: "avoid",
    talk: "never",
    healAggro: "conservative",
    allyDying: "fight",
    selfRevived: "retreat",
    retreat: spec?.flags?.fearless ? "never" : "hurt",
    shield: "never",
    beyond: keepsGround(spec) ? "stay" : "hunt"
  };
}

/**
 * How readily each kind of creature takes a bystander for fair game, as a chance a round: an animal's prey drive and a
 * feral mind, nearly always; a dim instinctive one now and then; and, at any wits, the Cruel, the Wildcard and the
 * Instigator as their natures run. Several, each its own chance.
 */
export const BYSTANDER_URGE = Object.freeze({ animal: 0.9, feral: 0.9, instinctive: 0.3, cruel: 0.5, wildcard: 0.35, instigator: 0.25 });

/** Its chance a round of taking a bystander for fair game (BYSTANDER_URGE), 0 to 1. */
export function bystanderUrge(u, tier) {
  let miss = 1;
  const take = chance => { miss *= 1 - chance; };
  if ( isAnimalistic(u) ) take(BYSTANDER_URGE.animal);
  else if ( tier <= TACTICAL.FERAL ) take(BYSTANDER_URGE.feral);
  else if ( tier === TACTICAL.INSTINCTIVE ) take(BYSTANDER_URGE.instinctive);
  for ( const style of ["cruel", "wildcard", "instigator"] ) if ( u.spec.playstyles?.includes(style) ) take(BYSTANDER_URGE[style]);
  return 1 - miss;
}

/** Does u take bystanders for fair game this round (bystanderUrge)? Decided once a round, so it doesn't flicker. */
export function preysOn(run, u, tier) {
  if ( u.preyRound === run.round ) return u.preys;
  const chance = bystanderUrge(u, tier);
  u.preyRound = run.round;
  u.preys = chance >= 1 || (chance > 0 && !!run.rng?.chance(chance));
  return u.preys;
}

/** What a pack does to a pack animal's nerve: its pack about it, steadier; alone, shakier (morale.js). */
export const PACK_NERVE = Object.freeze({ each: 6, most: 18, alone: 20, near: 30 });
