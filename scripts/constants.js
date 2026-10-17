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
  OWN: "own", // fights as its own side, hostile to everyone
  NEUTRAL: "neutral" // on the field, taking no side until something crosses it
});

/**
 * The side, in a fight, of everyone who has taken no side: neutral tokens (leaning one way, or not at all) and
 * enemies talked out of the fight. Nobody fights them and they fight no one, until something crosses them.
 */
export const NEUTRAL_PARTY = "neutralParty";

/**
 * Hostile tokens fight in up to three groups, each a side of its own: every group is the others' enemy as much as
 * the party's. Group 1 is the hostile side itself.
 */
export const HOSTILE_GROUPS = Object.freeze([SIDES.HOSTILE, "hostile2", "hostile3"]);
/** Friend groups, for hostile and neutral tokens alike. */
export const GROUPS = Object.freeze([1, 2, 3]);
/** How near (in squares) a neutral must be to a friend group, for the planner to put it in that group. */
export const NEUTRAL_REACH = 3;

export const TRAITS = Object.freeze(["tactical", "brave", "selfish", "loyal"]);

/**
 * The usual player character's traits: bold, loyal, unselfish, a good head. Where a system helper starts one before its
 * own numbers move it (engine/trait-parts.js), and what setting one up by itself reads its traits against.
 */
export const PC_BASELINE = Object.freeze({ tactical: 65, brave: 75, selfish: 25, loyal: 80 });

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
  STOOD_DOWN: "stoodDown", // persuaded to let it go: out of the conflict, but nobody's prisoner
  BEATEN: "beaten", // out of the fight, alive, however the table decides (Ironsworn: its track complete)
  BOUND: "bound" // tied up and awake: a prisoner, out of the fight (one tied up while down stays down: u.boundBy)
});

/** How a talked-down combatant leaves the fight. */
export const SWAY = Object.freeze({ SURRENDER: "surrendered", FLEE: "fled", SWITCH: "switched", STAND_DOWN: "stoodDown", CONCEDE: "conceded", NEUTRAL: "neutral" });

/**
 * Luck checks that protect player characters, as the highest d100 roll that goes against the PC (world settings
 * "concedeLuck" and "theftLuck" override these defaults).
 */
export const CONCEDE_LUCK = 39; // a PC talked into giving up an item loses it only on 39 or less
export const THEFT_LUCK = 29;   // a thief who beats a PC's defenses still needs 29 or less
export const EXECUTE_LUCK = 39; // a creature that wants to finish off a PC at 0 HP goes ahead only on 39 or less
export const TRAP_LUCK = 59;    // a trap avoider spots a hazard only on 59 or less
/**
 * A fully selfless creature, held fast or hurting, bears it this turn (doesn't try to be rid of it) on a d100 at or under
 * this; the more self-serving or calculating it is, the less of it ("ignoreTroubles": behavior/holds.js bears).
 */
export const IGNORE_TROUBLES = 29;
/** A playstyle's taunt that gets through takes hold only on a d100 at or under this times its share ("tauntLuck"). */
export const TAUNT_LUCK = 42;
/** An enemy talked into changing sides (standing aside) goes through with it only on a d100 under this ("switchLuck"). */
export const SWITCH_LUCK = 69;
/** A player character scheming against the leader it wasn't chosen to be turns on its side only on a d100 under this ("traitorLuck"). */
export const TRAITOR_LUCK = 9;
/**
 * Someone who doesn't like to flee ignores the urge to run, when running is its own choice, this often (percent:
 * the "standGround" world setting, 50 to 90).
 */
export const STAND_GROUND = 90;
/** How often a creature that has set out to leave the fight keeps going when struck or spoken to (behavior/leaving.js), %. */
export const LEAVE_RESOLVE = 79;
/** How often a creature's mind jumps from what it's doing to the strongest thing it wants (behavior/desire.js orderAgenda), %. */
export const ADHD = 20;

/**
 * Someone who avoids killing ("I avoid killing") holds back this often (percent: the "avoidKilling" world setting, 50
 * to 90): a blow that would kill knocks out instead, it leaves the fallen be, and after the fight it spares them.
 */
export const AVOID_KILLING = 90;

/**
 * How an encounter opens: decided by who would rather talk (AUTO), always with words (TALK), straight into battle
 * (FIGHT), or only an argument, talk and nothing else (ARGUMENT: what would come to blows ends it).
 */
export const OPENING = Object.freeze({ AUTO: "auto", TALK: "talk", FIGHT: "fight", ARGUMENT: "argument" });

export const FUDGE_STEP = Object.freeze({ trait: 5 });

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** A plain object (as stored JSON gives one): not null, not an array. For checking what players' flags hold. */
export const isPlain = v => !!v && typeof v === "object" && !Array.isArray(v);

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

/** The most rounds a planned battle is simulated for, before it counts as a stalemate: the setting's bounds and default. */
export const MAX_ROUNDS = Object.freeze({ default: 12, min: 4, max: 12 });
