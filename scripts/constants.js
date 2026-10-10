/**
 * Shared constants. This file must stay free of Foundry globals so the engine can import it in Node tests.
 */

export const MODULE_ID = "fast-fighting";

/** Side ids mirror CONST.TOKEN_DISPOSITIONS, plus room for GM-created third parties. */
export const SIDES = Object.freeze({
  FRIENDLY: "friendly",
  NEUTRAL: "neutral",
  HOSTILE: "hostile",
  SECRET: "secret"
});

/** Map from Foundry disposition value to side id. */
export const DISPOSITION_SIDES = Object.freeze({
  1: SIDES.FRIENDLY,
  0: SIDES.NEUTRAL,
  [-1]: SIDES.HOSTILE,
  [-2]: SIDES.SECRET
});

/** How an unaligned side (Neutral / Secret) is resolved for a run. */
export const ALLEGIANCE = Object.freeze({
  EXCLUDE: "exclude",
  FRIENDLY: "friendly",
  HOSTILE: "hostile",
  CLOSEST: "closest",
  UNDERDOG: "underdog",
  OWN: "own" // fights as its own side, hostile to everyone
});

export const TRAITS = Object.freeze(["tactical", "brave", "selfish", "loyal"]);

/** Named bands for every 0-100 trait. Lower bound inclusive. */
export const TRAIT_BANDS = Object.freeze({
  tactical: [[0, "feral"], [20, "instinctive"], [40, "competent"], [60, "tactical"], [80, "mastermind"]],
  brave: [[0, "craven"], [20, "skittish"], [40, "steady"], [60, "bold"], [80, "fearless"]],
  selfish: [[0, "devoted"], [20, "selfless"], [40, "pragmatic"], [60, "selfish"], [80, "ruthless"]],
  loyal: [[0, "treacherous"], [20, "wavering"], [40, "dependable"], [60, "loyal"], [80, "unshakable"]]
});

export const TACTICAL = Object.freeze({ FERAL: 0, INSTINCTIVE: 1, COMPETENT: 2, TACTICAL: 3, MASTERMIND: 4 });

export const HEAL_AGGRO = Object.freeze(["conservative", "balanced", "aggressive", "allCosts"]);
export const ALLY_DYING = Object.freeze(["rescue", "fight", "retreat", "protectSelf"]);

/**
 * After the last blow: TELL settles the fallen (first aid, recovery checks) and the story narrates it; QUIET
 * settles them but the story ends at the last blow; NONE leaves everyone as the fight left them.
 */
export const AFTERMATH = Object.freeze({ TELL: "tell", QUIET: "quiet", NONE: "none" });

export const DOWNED_MODELS = Object.freeze({ SIMULATE: "simulate", OUT: "out", DEAD: "dead" });

/** Combatant end states. */
export const STATUS = Object.freeze({
  STANDING: "standing",
  DOWN: "down",
  DEAD: "dead",
  FLED: "fled",
  SURRENDERED: "surrendered",
  STOOD_DOWN: "stoodDown" // persuaded to let it go: out of the conflict, but nobody's prisoner
});

/** How a talked-down combatant leaves the fight. */
export const SWAY = Object.freeze({ SURRENDER: "surrendered", FLEE: "fled", SWITCH: "switched", STAND_DOWN: "stoodDown", CONCEDE: "conceded" });

/** A PC hands over an item only when this d100 luck check comes up under it (39 or less). */
export const CONCEDE_LUCK = 40;

/** Robbing a PC takes a successful check and this d100 luck check coming up under it (29 or less). */
export const THEFT_LUCK = 30;

/** How an encounter opens: decided by who would rather talk, always with words, or straight into battle. */
export const OPENING = Object.freeze({ AUTO: "auto", TALK: "talk", FIGHT: "fight" });

export const FUDGE_STEP = Object.freeze({ trait: 5, bonus: 1, multiplier: 0.25 });

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Effective value of a fudgeable {base, fudge} pair (or a bare number). */
export function fudged(value, min = 0, max = 100) {
  if ( typeof value === "number" ) return clamp(value, min, max);
  return clamp((value?.base ?? 0) + (value?.fudge ?? 0), min, max);
}

export function traitBand(trait, value) {
  const bands = TRAIT_BANDS[trait];
  let band = bands[0][1];
  for ( const [min, name] of bands ) if ( value >= min ) band = name;
  return band;
}

export function tacticalTier(value) {
  return clamp(Math.floor(value / 20), 0, 4);
}
