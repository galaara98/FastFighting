/**
 * The story's master list of maneuvers (what a creature does) and conditions (what it is), from
 * docs/story-maneuvers-conditions.md: each told by its own sentences (maneuver.<id>, condition.<id>, with .amazing and
 * .terrible), whatever a system calls it. A helper maps its own onto them: an action's maneuver by its slug (an id
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

const lower = new Map([...MANEUVERS, ...CONDITIONS].map(id => [id.toLowerCase(), id]));

/** The master list's condition for a system's condition key, or null. */
export function conditionOf(key, map = null) {
  if ( !key ) return null;
  const mapped = map?.(key);
  if ( mapped && CONDITIONS.includes(mapped) ) return mapped;
  const k = String(key).toLowerCase();
  const id = SYNONYMS[k] ?? lower.get(k) ?? lower.get(k.replace(/-(w)/g, (m, c) => c));
  return id && CONDITIONS.includes(id) ? id : null;
}

/** The master list's maneuver an action is: named outright, or its id's last part ("abc.trip"); null if neither. */
export function maneuverOf(action) {
  if ( action?.maneuver && MANEUVERS.includes(action.maneuver) ) return action.maneuver;
  const last = String(action?.id ?? "").split(".").pop().toLowerCase();
  const id = lower.get(last) ?? lower.get(last.replace(/-(w)/g, (m, c) => c));
  return id && MANEUVERS.includes(id) ? id : null;
}
