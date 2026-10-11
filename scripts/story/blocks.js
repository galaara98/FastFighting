/**
 * Story tables from building blocks. The story writer rolls one entry from the table that matches each event, then (for
 * attacks and talks) appends a roll from the matching relationship table. The words live in story/en.json (and any
 * translation's story/<lang>.json) as building blocks, combined here into finished tables.
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
 * The building blocks (story/en.json):
 *   damage.<type>.{hit, wound, graze, miss, crit, botch}   what each outcome looks like for each damage type
 *   delivery.<delivery>.{verb, aim}                        how each delivery is described
 *   shapes.<delivery>.<tier>      sentences with {aim} {hit} {wound} {graze} {miss} {crit} {botch} from the above
 *   talk.<kind>.{verb, good, bad} and talkShapes.<tier>   the same for talking: {verb} {good} {bad}
 *   relationship, move, event, desire.{intensity, self, verb}   finished entries, used as they are
 * The n-th shape takes the n-th phrase of each block (wrapping round), so a list can have any number of entries.
 *
 * Placeholders: {actor} {target} {weapon} {damage} {region} {by} {stage} {affliction}
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

function fill(template, parts) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (parts[k] !== undefined ? parts[k] : m));
}

/** The i-th phrase of a block, wrapping round (an empty block leaves its placeholder, and the sentence is dropped). */
const nth = (list, i) => (list?.length ? list[i % list.length] : undefined);

/** A building block's place in a sentence shape, left unfilled. */
const BLOCK_SLOT = /\{(aim|hit|wound|graze|miss|crit|botch|verb|good|bad)\}/;

/** Is this a file of building blocks (story/en.json), rather than finished tables (key -> entries)? */
export const isBlocks = data => !!data && typeof data === "object" && !Array.isArray(data) && "shapes" in data;

/** Build every table from building blocks: key -> entries. */
export function buildTables(blocks) {
  const tables = {};
  for ( const delivery of DELIVERIES ) {
    for ( const type of DAMAGE_TYPES ) {
      const t = blocks.damage?.[type] ?? {};
      const aim = blocks.delivery?.[delivery]?.aim;
      for ( const tier of TIERS ) {
        tables[`action.${delivery}.${type}.${tier}`] = (blocks.shapes?.[delivery]?.[tier] ?? []).map((shape, i) => fill(shape, {
          aim: nth(aim, i),
          hit: nth(t.hit, i), wound: nth(t.wound, i + 1), graze: nth(t.graze, i),
          miss: nth(t.miss, i), crit: nth(t.crit, i), botch: nth(t.botch, i)
        }));
      }
    }
  }
  for ( const kind of TALK_KINDS ) {
    const talk = blocks.talk?.[kind] ?? {};
    for ( const tier of TIERS ) {
      tables[`talk.${kind}.${tier}`] = (blocks.talkShapes?.[tier] ?? []).map((shape, i) => fill(shape, {
        verb: nth(talk.verb, i), good: nth(talk.good, i), bad: nth(talk.bad, i)
      }));
    }
  }
  for ( const kind of RELATIONSHIPS ) {
    for ( const polarity of ["success", "failure"] ) tables[`relationship.${kind}.${polarity}`] = blocks.relationship?.[kind]?.[polarity] ?? [];
  }
  for ( const mode of MOVE_MODES ) {
    for ( const situation of MOVE_SITUATIONS ) tables[`move.${mode}.${situation}`] = blocks.move?.[mode]?.[situation] ?? [];
  }
  for ( const [name, entries] of Object.entries(blocks.event ?? {}) ) tables[`event.${name}`] = entries;
  for ( const [band, entries] of Object.entries(blocks.desire?.intensity ?? {}) ) tables[`desire.intensity.${band}`] = entries;
  for ( const [kind, entries] of Object.entries(blocks.desire?.verb ?? {}) ) tables[`desire.verb.${kind}`] = entries;
  for ( const [kind, entries] of Object.entries(blocks.desire?.self ?? {}) ) tables[`desire.self.${kind}`] = entries;
  // A file that leaves a block out (a translation part done) leaves those sentences, and empty tables, to English.
  for ( const [key, entries] of Object.entries(tables) ) {
    const whole = (Array.isArray(entries) ? entries : []).filter(e => typeof e === "string" && !BLOCK_SLOT.test(e));
    if ( whole.length ) tables[key] = whole;
    else delete tables[key];
  }
  return tables;
}

/** A table's name for a key, e.g. "Melee · Slashing · Minor Success" (in the reader's language). */
export function tableName(key) {
  return key.split(".").map(w => localize(`FASTFIGHTING.Story.Part.${w}`)).join(" · ");
}
