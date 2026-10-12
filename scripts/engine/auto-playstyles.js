/**
 * The playstyles a character most likely has, picked once for one nobody has set up (foundry/auto-config.js), best
 * first. Each playstyle is scored from three things:
 *  - its numbers and what it can do, as any system's helper reads it: its traits (tactical, brave, selfish, loyal),
 *    whether it's mindless, fearless or a beast, its weapons (close or far), magic and specialties, healing and help
 *    for friends, ways to hamper a foe, a shield or a hard hide, skill at theft, lore and talk;
 *  - what its system's helper reads in it (hints: its class, ancestry, kind of creature, alignment, gear), -1 to 1 each;
 *  - words in its biography and description (each playstyle's keywords, from the language files: words).
 * The picks: those that score at least AUTO_FLOOR, best first, never two that pull against each other (a Chicken and a
 * Martyr), at most four. Pure: no Foundry globals.
 */
import { PLAYSTYLES, MAX_PLAYSTYLES } from "./playstyles.js";
import { fudged, PC_BASELINE } from "../constants.js";
import { typical } from "./battle-state.js";
import { isSpecial } from "./behavior/specialty.js";

/** The least score a playstyle needs to be picked. */
export const AUTO_FLOOR = 30;
/**
 * What the numbers alone can make of a playstyle, at most (so its system's "nothing like it" can still rule it out);
 * what a helper's hint of 1 is worth; a keyword found in the biography (at most two count).
 */
export const NUMBERS_CAP = 60;
export const HINT_WEIGHT = 40;
export const WORD_WEIGHT = 15;

/** Playstyles that pull against each other: never both. */
export const CLASHES = Object.freeze([
  ["chicken", "martyr"], ["chicken", "tank"], ["chicken", "relentless"], ["chicken", "instigator"], ["chicken", "redeemSeeker"],
  ["cruel", "moralist"], ["cruel", "peacekeeper"], ["cruel", "enabler"], ["cruel", "martyr"],
  ["brawler", "diplomat"], ["brawler", "peacekeeper"], ["instigator", "peacekeeper"], ["instigator", "diplomat"],
  ["lazy", "speedRunner"], ["lazy", "relentless"], ["lazy", "martyr"], ["lazy", "tank"],
  ["wallflower", "tank"], ["wallflower", "instigator"], ["wallflower", "brawler"],
  ["mercenary", "martyr"], ["mercenary", "peoplePleaser"], ["mercenary", "redeemSeeker"], ["mercenary", "moralist"],
  ["fragile", "tank"], ["fragile", "martyr"], ["fragile", "relentless"]
]);
const clashes = (a, b) => CLASHES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

const pos = n => Math.max(0, n);

export { PC_BASELINE };

/**
 * What a spec says about the character, as the scores need it. A player character's traits are read against the usual
 * player character's (PC_BASELINE: where the systems start one), so only what sets it apart counts, and at half weight
 * (its player says who it is more than its numbers do); anyone else's as they are.
 */
export function readSpec(spec, rules = null) {
  const trait = k => {
    const v = fudged(spec.traits?.[k] ?? 50);
    return spec.kind === "pc" ? Math.max(0, Math.min(100, 50 + (v - PC_BASELINE[k]) / 2)) : v;
  };
  const level = Number(spec.level) || 0;
  const skill = typical(rules, "skill", level);
  const actions = spec.actions ?? [];
  const offense = actions.filter(a => !["heal", "buff", "summon"].includes(a.kind) && !a.goad);
  const weapons = offense.filter(a => a.kind === "strike" && !isSpecial(a));
  const specials = actions.filter(a => isSpecial(a));
  const melee = offense.filter(a => a.melee).length;
  const ranged = offense.filter(a => a.range && !a.melee).length;
  const pitch = k => Number(spec.social?.pitches?.[k]?.mod);
  const edge = v => (Number.isFinite(v) ? v - skill : -99);
  return {
    tactical: trait("tactical"), brave: trait("brave"), selfish: trait("selfish"), loyal: trait("loyal"),
    mindless: !!(spec.flags?.mindless || spec.social?.mindless),
    fearless: !!spec.flags?.fearless,
    beast: !!spec.flags?.beast,
    pc: spec.kind === "pc",
    melee, ranged,
    // (Its specialties against its everyday weapons: the share of what it would do that's its own.)
    special: specials.length / Math.max(1, specials.length + weapons.length),
    heals: actions.some(a => a.kind === "heal" && !a.selfOnly && !a.firstAid && !a.consumable),
    helps: actions.some(a => a.kind === "buff" && a.targets !== "self" && a.includeSelf !== false && isSpecial(a)),
    hampers: actions.some(a => a.kind === "control" && !a.goad),
    shield: !!spec.shield,
    // (A hard hide or good armor: its AC against what's typical at its level.)
    armor: Number.isFinite(Number(spec.defenses?.ac)) ? Number(spec.defenses.ac) - typical(rules, "ac", level) : 0,
    theft: edge(Number(spec.theft?.mod) - (Number(spec.theft?.faces) > 0 ? (20 - spec.theft.faces) / 2 : 0)),
    lore: edge(Number(spec.sizeUp?.mod)),
    persuade: edge(pitch("persuade")),
    threaten: edge(pitch("intimidate")),
    deceive: edge(pitch("deceive")),
    talks: (spec.social?.languages?.length ?? 1) > 0 && !(spec.flags?.mindless || spec.social?.mindless)
  };
}

/** How well each playstyle fits from the numbers alone: {id: score}. */
export function numbersFit(s) {
  const { tactical: T, brave: B, selfish: S, loyal: L } = s;
  const out = {
    chicken: pos(45 - B) * 2,
    cruel: S > 60 ? (S - 60) * 1.5 + pos(55 - L) * 0.5 : 0,
    moralist: pos(45 - S) * 0.8 + pos(L - 60) * 0.8 + (s.heals ? 12 : 0),
    peacekeeper: s.talks ? pos(35 - S) * 0.8 + pos(s.persuade) * 5 : 0,
    peoplePleaser: pos(L - 65) * 0.8 + pos(45 - S) * 0.5,
    fragile: pos(45 - B) * 0.8 + (s.ranged && !s.melee ? 8 : 0),
    impatient: pos(50 - T) * 0.6 + pos(B - 55) * 0.6,
    brawler: (s.melee && !s.ranged && s.special < 0.3 ? 15 : 0) + pos(B - 60) * 0.6 + pos(50 - T) * 0.5 + (s.beast ? 20 : 0),
    skeptic: pos(T - 60) * 0.6 + pos(50 - L) * 0.6,
    speedRunner: pos(T - 60) * 0.5 + pos(B - 55) * 0.5 + pos(S - 50) * 0.3,
    leader: s.talks ? pos(T - 55) * 0.4 + pos(B - 55) * 0.4 + pos(L - 55) * 0.3 + pos(s.persuade) * 2 : 0,
    instigator: pos(B - 60) * 0.6 + pos(S - 50) * 0.4 + (s.hampers ? 12 : 0) + pos(s.threaten) * 2,
    diplomat: s.talks ? pos(s.persuade) * 8 + pos(T - 50) * 0.3 : 0,
    wallflower: (s.ranged && !s.melee ? 20 : 0) + pos(50 - B) * 0.8,
    martyr: pos(B - 65) * 0.8 + pos(L - 65) * 0.8 + pos(35 - S) * 0.8,
    tank: s.melee ? (s.shield ? 25 : 0) + pos(s.armor) * 4 + pos(B - 60) * 0.5 + pos(L - 50) * 0.3 : 0,
    mercenary: S > 55 && L < 50 ? (S - 55) + (50 - L) : 0,
    enabler: (s.helps ? 25 : 0) + (s.heals ? 25 : 0) + pos(45 - S) * 0.5,
    redeemSeeker: 0,
    loreCollector: pos(s.lore) * 6 + pos(T - 60) * 0.4,
    puzzleManiac: pos(T - 70) + (s.hampers || s.special >= 0.5 ? 10 : 0),
    wildcard: 0,
    thief: pos(s.theft) * 8,
    vengeful: pos(S - 50) * 0.4 + pos(B - 60) * 0.4 + pos(50 - T) * 0.2,
    relentless: (s.mindless ? 35 : 0) + (s.fearless ? 15 : 0) + pos(B - 75) * 0.8,
    lazy: pos(40 - T) * 0.8 + pos(45 - B) * 0.5,
    unmundane: s.special >= 0.5 ? s.special * 50 : 0
  };
  // (The mindless don't talk, scheme or care: no talker's, schemer's or carer's pill.)
  if ( s.mindless ) for ( const id of ["peacekeeper", "diplomat", "peoplePleaser", "leader", "moralist", "skeptic", "mercenary", "loreCollector", "puzzleManiac", "thief"] ) out[id] = 0;
  return out;
}

/**
 * Every playstyle's score: its numbers' fit, the helper's hints (each -1 to 1, so many HINT_WEIGHT), and keywords found
 * in its biography (words: {id: how many}, WORD_WEIGHT each, two at most).
 * @returns {{id: string, score: number, numbers: number, hint: number, words: number}[]} best first
 */
export function scorePlaystyles(spec, { rules = null, hints = {}, words = {} } = {}) {
  const fit = numbersFit(readSpec(spec, rules));
  return Object.keys(PLAYSTYLES).map(id => {
    const numbers = Math.round(Math.min(NUMBERS_CAP, fit[id] ?? 0));
    const hint = Math.round(Math.max(-1, Math.min(1, Number(hints[id]) || 0)) * HINT_WEIGHT);
    const said = Math.min(2, Math.max(0, Number(words[id]) || 0)) * WORD_WEIGHT;
    return { id, score: numbers + hint + said, numbers, hint, words: said };
  }).sort((a, b) => b.score - a.score);
}

/** The picks: best first, at least AUTO_FLOOR, none pulling against one already picked, at most four. */
export function pickPlaystyles(scored, { max = MAX_PLAYSTYLES, floor = AUTO_FLOOR } = {}) {
  const out = [];
  for ( const s of scored ) {
    if ( out.length >= max || s.score < floor ) break;
    if ( out.some(id => clashes(id, s.id)) ) continue;
    out.push(s.id);
  }
  return out;
}

/** How many of each playstyle's keywords a text holds (each keyword matches as the start of a word, any case). */
export function keywordHits(text, keywords) {
  const out = {};
  const hay = String(text ?? "").toLowerCase();
  if ( !hay.trim() ) return out;
  for ( const [id, list] of Object.entries(keywords ?? {}) ) {
    let n = 0;
    for ( const raw of list ?? [] ) {
      const word = String(raw).trim().toLowerCase();
      if ( !word ) continue;
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if ( new RegExp(`(?<![\\p{L}\\p{N}])${escaped}`, "u").test(hay) ) n += 1;
    }
    if ( n ) out[id] = n;
  }
  return out;
}
