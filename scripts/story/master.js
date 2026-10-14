/**
 * The story's master list of maneuvers (what a creature does) and conditions (what it is), from
 * docs/story-maneuvers-conditions.md: each told by its own sentences (maneuver.<id>, condition.<id>, with .amazing and
 * .terrible), whatever a system calls it. And the reactions' triggers and effects, from docs/reaction-triggers.md. A helper maps its own onto them: an action's maneuver by its slug (an id
 * ending ".trip"), or outright (action.maneuver); a condition by its key, or rules.storyCondition(key).
 * Pure.
 */
export const MANEUVERS = Object.freeze([
  "move", "dash", "step", "retreat", "charge", "tumbleThrough", "leap", "climb", "swim", "fly", "burrow", "crawl",
  "dropProne", "standUp", "balance", "squeeze", "catchFall", "mount", "flee", "callForHelp", "callToArms",
  "noticeSight", "noticeSound", "noticeSmell", "noticeFeel", "noticeRadar", "takeCover", "raiseShield", "block", "defend", "avertGaze", "hide",
  "sneak", "search", "spot", "assess", "pointOut", "demoralize", "feint", "distract", "parley", "rally", "surrender", "aid",
  "ready", "gainGround", "grapple", "shove", "trip", "disarm", "reposition", "fling", "escape", "release",
  "constrict", "swallow", "engulf", "trample", "blindFoe", "drawWeapon", "reload", "useItem", "interact",
  "forceOpen", "steal", "disableDevice", "hack", "commandAnimal", "firstAid", "douseFlames", "fightOn", "aim",
  "suppressingFire"
]);

export const CONDITIONS = Object.freeze([
  "blinded", "dazzled", "deafened", "silenced", "concealed", "hidden", "invisible", "frightened", "fleeing",
  "shaken", "charmed", "fascinated", "confused", "controlled", "befuddled", "enraged", "weakened", "clumsy",
  "drained", "exhausted", "sickened", "poisoned", "bloodied", "maimed", "cursed", "bleeding", "burning", "corroding",
  "lingeringHarm", "suffocating", "lazy", "prone", "grabbed", "restrained", "immobilized", "swallowed", "engulfed",
  "inCover", "flanked", "offGuard", "pressed", "surprised", "marked", "slowed", "hastened", "reeling", "stunned",
  "paralyzed", "petrified", "unconscious", "dying", "dead", "disarmed", "gearBroken", "weaponJammed", "outOfAmmo",
  "overheated", "glitching", "suppressed", "adrift", "irradiated"
]);

/** Common names systems give the master list's conditions (a helper's storyCondition comes first). */
const SYNONYMS = Object.freeze({
  "off-guard": "offGuard", "flat-footed": "offGuard", grappled: "grabbed", enfeebled: "weakened", stupefied: "befuddled",
  fatigued: "exhausted", exhaustion: "exhausted", quickened: "hastened", hasted: "hastened", incapacitated: "stunned",
  dominated: "controlled", undetected: "hidden", unnoticed: "hidden", dazed: "reeling", nauseated: "sickened",
  "on-fire": "burning", ablaze: "burning", vulnerable: "offGuard", untethered: "adrift", "in-cover": "inCover"
});

/** Common names systems give the master list's maneuvers (their slugs), where they differ from its own. */
const MANEUVER_SYNONYMS = Object.freeze({
  "shield-block": "block", "reactive-shield": "raiseShield", "raise-a-shield": "raiseShield", "nimble-dodge": "defend",
  dodge: "defend", parry: "defend", seek: "search", "take-cover": "takeCover", "drop-prone": "dropProne", stand: "standUp",
  "point-out": "pointOut", "create-a-diversion": "distract", "administer-first-aid": "firstAid", "first-aid": "firstAid",
  "force-open": "forceOpen", "disable-device": "disableDevice", "command-an-animal": "commandAnimal", "tumble-through": "tumbleThrough",
  "high-jump": "leap", "long-jump": "leap", "leap": "leap", "escape": "escape", "interact": "interact", "steal": "steal"
});

/**
 * Reaction triggers (docs/reaction-triggers.md): every moment in a fight a reaction may answer, by group. A reaction's
 * `on` names one, or a list; a helper maps its system's reactions onto them. The engine checks those it knows the
 * moment of (responses.js, reactions.js); the rest are named here for helpers, and for the engine to grow into.
 */
export const REACTION_TRIGGERS = Object.freeze({
  atSelf: Object.freeze([
    "attacked", "underFire", "inBlastArea", "hit", "missed", "wouldTakeDamage", "damaged", "badlyHurt", "wouldDrop",
    "slain", "mustSave", "wouldGainCondition", "touched", "maneuvered", "grabbed", "knockedDown", "forcedMovement",
    "falling"
  ]),
  atAlly: Object.freeze([
    "allyTargeted", "allyHit", "allyDamaged", "allyWouldDrop", "allyDown", "allyRolls", "allyStrikes", "allyActs",
    "commanded", "allyMoves", "allyAfflicted", "wardInPeril", "rideTargeted", "rideHurt"
  ]),
  foeAction: Object.freeze([
    "foeOpening", "foeRolls", "foeFails", "heldFoeStruggles", "foeSpotted", "aboutToBeFound", "foeGoesForWeapon",
    "breachAttempt"
  ]),
  movement: Object.freeze([
    "foeApproaches", "foeMovesInReach", "foeLeavesReach", "inItsSpace", "foeMovesInOpen", "pursuerCloses"
  ]),
  magic: Object.freeze([
    "foeCasts", "spellTargets", "magicNearby", "concentrationJolted"
  ]),
  tech: Object.freeze([
    "lockedOn", "missileIncoming", "shieldsFailing", "gearBreaking", "overload", "aboutToBlow", "hacked"
  ]),
  social: Object.freeze([
    "pressed", "deceived", "taunted", "speech", "ruleBroken"
  ]),
  fear: Object.freeze([
    "suddenScare", "horrorSeen", "strained", "breakingPoint", "allyPanics", "leaderFalls"
  ]),
  turnRound: Object.freeze([
    "fightStarts", "ownTurnStarts", "ownTurnEnds", "otherTurnStarts", "otherTurnEnds", "betweenTurns",
    "readiedTrigger", "countdownEnds"
  ]),
  environment: Object.freeze([
    "airFails", "bigImpact", "lightsOut", "alarmRaised", "disturbance", "environmentTurns"
  ]),
  hazard: Object.freeze([
    "entersArea", "approachesHazard", "touchesObject", "disableAttempt", "hazardDamaged", "lingers", "hazardSensed"
  ]),
  other: Object.freeze([
    "ownRoll", "ownRollFails", "ownRollSucceeds", "specialRoll", "ownHit", "ownMiss", "dropsFoe", "ownAction",
    "deathNearby", "runsDry", "pointSpent", "complication"
  ])
});
export const TRIGGERS = Object.freeze(Object.values(REACTION_TRIGGERS).flat());

/** What a reaction does (docs/reaction-triggers.md), for helpers mapping their system's reactions. */
export const REACTION_EFFECTS = Object.freeze([
  "acBonus", "negate", "halve", "reduce", "shrugOff", "heal", "stayUp", "resist", "bolsterRoll", "helpAlly",
  "guardAlly", "letAllyAct", "takeTheBlow", "rescue", "strike", "harmSource", "areaBurst", "redirectAttack", "rider",
  "afflict", "spoilRoll", "trip", "moveFoe", "grab", "disarm", "disrupt", "counter", "taunt", "bluff", "move",
  "takeCover", "standUp", "fallSafely", "escape", "hide", "actNow", "gainPoint", "boost", "useAbility", "create",
  "transform", "learn", "alert", "investigate", "changeScene", "flashback", "panic", "freeze", "scream", "flee",
  "lashOut", "strain", "pointDefense", "damageControl", "bailOut", "counterHack", "seal", "throwBack"
]);

/** The engine's older names for its triggers. */
const TRIGGER_SYNONYMS = Object.freeze({ spell: "foeCasts", leaveReach: "foeLeavesReach", opportunity: "foeLeavesReach" });
const TRIGGER_SET = new Set(TRIGGERS);

/** A trigger as the master list names it (an older name, "spell", is "foeCasts"), or null. */
export function triggerOf(key) {
  if ( !key ) return null;
  const id = TRIGGER_SYNONYMS[key] ?? key;
  return TRIGGER_SET.has(id) ? id : null;
}

const listening = new WeakMap();
/** The master triggers a reaction answers: its `on`, one or a list. */
export function triggersOf(reaction) {
  if ( !reaction || typeof reaction !== "object" ) return [];
  let out = listening.get(reaction);
  if ( !out ) {
    out = (Array.isArray(reaction.on) ? reaction.on : [reaction.on]).map(triggerOf).filter(Boolean);
    listening.set(reaction, out);
  }
  return out;
}

/** Does this reaction answer this trigger (either named as the master list names it, or by an older name)? */
export const answersTo = (reaction, trigger) => triggersOf(reaction).includes(triggerOf(trigger));

const lower = new Map([...MANEUVERS, ...CONDITIONS].map(id => [id.toLowerCase(), id]));

/** The master list's condition for a system's condition key, or null. */
export function conditionOf(key, map = null) {
  if ( !key ) return null;
  const mapped = map?.(key);
  if ( mapped && CONDITIONS.includes(mapped) ) return mapped;
  const k = String(key).toLowerCase();
  const id = SYNONYMS[k] ?? lower.get(k) ?? lower.get(k.replace(/-/g, ""));
  return id && CONDITIONS.includes(id) ? id : null;
}

/** The master list's maneuver an action is: named outright, or its id's last part ("abc.trip"); null if neither. */
export function maneuverOf(action) {
  if ( action?.maneuver && MANEUVERS.includes(action.maneuver) ) return action.maneuver;
  const last = String(action?.id ?? "").split(".").pop().toLowerCase();
  const id = MANEUVER_SYNONYMS[last] ?? lower.get(last) ?? lower.get(last.replace(/-/g, ""));
  return id && MANEUVERS.includes(id) ? id : null;
}
