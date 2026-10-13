/**
 * The story tables' keys. The story writer rolls one entry from the table that matches each event, then (for attacks
 * and talks) appends a roll from the matching relationship table. Every entry is a whole sentence: the words live in
 * story/en.json (and any translation's story/<lang>.json) as key -> sentences, with only placeholders to fill (who,
 * to whom, with what, and to what effect), so a translator writes each sentence as their language says it.
 *
 * Table keys (also the names of the RollTables installed into a world, see story/tables.js):
 *   action.<delivery>.<damageType>.<tier>     delivery: melee | ranged | spell
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
export const DELIVERIES = ["melee", "ranged", "spell"];
/** Damage imagery families. Systems map their own damage types onto these (rules.storyDamageType). */
export const DAMAGE_TYPES = ["bludgeoning", "piercing", "slashing", "fire", "cold", "electricity", "acid", "sonic", "force", "vitality", "void", "poison", "bleed", "mental", "spirit", "untyped"];
export const TALK_KINDS = ["persuade", "intimidate", "deceive"];
export const RELATIONSHIPS = ["none", "enemyLeader", "talkingNemesis", "grudge", "avenger", "protector", "finishing", "rival"];
export const MOVE_MODES = ["walk", "fly", "swim", "climb", "burrow"];
export const MOVE_SITUATIONS = ["approach", "terrain", "flee", "hunt", "help"];

/** A table's name for a key, e.g. "Melee · Slashing · Minor Success" (in the reader's language). */
export function tableName(key) {
  return key.split(".").map(w => localize(`FASTFIGHTING.Story.Part.${w}`)).join(" · ");
}
