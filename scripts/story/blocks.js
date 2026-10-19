/**
 * The story tables' keys. The story writer rolls one entry from the table that matches each event, then (for attacks
 * and talks) appends a roll from the matching relationship table. Every entry is a whole sentence: the words live in
 * story/en.json (and any translation's story/<lang>.json) as key -> sentences, with only placeholders to fill (who,
 * to whom, with what, and to what effect), so a translator writes each sentence as their language says it.
 *
 * Table keys (also the names of the RollTables installed into a world, see story/tables.js):
 *   action.<damageType>.<tier>                what an attack does: one sentence for any weapon, natural attack or spell
 *   distance.<near|far>                       now and then, before a creature's first attack of its turn: up close, or
 *                                             from afar (a melee or a ranged attack)
 *   talk.<kind>.<tier>                        kind: persuade | intimidate | deceive (systems map their skills onto these)
 *   relationship.<kind>.<polarity>            kind: none | enemyLeader | talkingNemesis | grudge | avenger |
 *                                                   protector | finishing | rival      polarity: success | failure
 *   move.<mode>.<situation>                   mode: walk | fly | swim | climb | burrow
 *                                             situation: approach | terrain | flee | hunt | help
 *   event.<name>                              everything else (falls, heals, notices, surrenders, ...)
 *   desire.intensity.<band> / desire.verb.<kind> / desire.self.<kind>   a character's moments of thought
 *
 * Placeholders: {actor} {target} {weapon} {effect} {amount} {region} {by} {stage} {affliction} ...
 * Pure apart from reading Foundry's translations for table names (../i18n.js).
 */
import { localize } from "../i18n.js";

export const TIERS = ["criticalSuccess", "majorSuccess", "success", "minorSuccess", "minorFailure", "failure", "majorFailure", "criticalFailure"];
/**
 * The story's damage families: how harm looks when it's told. Each system maps its own damage types onto them
 * (rules.storyDamageType: 5e lightning reads as electricity, necrotic as void), or names one for an attack outright
 * (action.storyType: a laser rifle that deals fire damage is told as a laser). The story never names the type itself.
 *   physical          bludgeoning, piercing, slashing, ballistic (gunfire), explosive (blasts, shrapnel), bleed, untyped
 *   energy            fire, cold, electricity, acid, sonic, force, laser, plasma, radiation, gravity, time
 *   the elements      wind, water, earth (stone), plant (thorns, vines); fire and cold are above
 *   life and death    vitality (life energy), void (necrotic, withering), radiant (holy light), unholy (profane)
 *   mind and soul     mental (psychic), spirit
 *   other             poison
 * (story/families.js picks an attack's: by its helper's word, its name, or its damage.)
 */
export const DAMAGE_TYPES = [
  "bludgeoning", "piercing", "slashing", "ballistic", "explosive", "bleed",
  "fire", "cold", "electricity", "acid", "sonic", "force", "laser", "plasma", "radiation", "gravity", "time",
  "wind", "water", "earth", "plant",
  "vitality", "void", "radiant", "unholy", "mental", "spirit", "poison", "untyped"
];
export { TALK_KINDS } from "../engine/behavior/talk.js";
export const RELATIONSHIPS = ["none", "enemyLeader", "talkingNemesis", "grudge", "avenger", "protector", "finishing", "rival"];
export { MOVE_MODES } from "../constants.js";
export const MOVE_SITUATIONS = ["approach", "terrain", "flee", "hunt", "help"];

/** A table's name for a key, e.g. "Melee · Slashing · Minor Success" (in the reader's language). */
export function tableName(key) {
  return key.split(".").map(w => localize(`FASTFIGHTING.Story.Part.${w}`)).join(" · ");
}
