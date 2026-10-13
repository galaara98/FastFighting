/**
 * Player-chosen tactics. Every question defaults to "auto" ("Let this character decide"): what this character would
 * probably do, worked out from its CombatantSpec: what it can do, and its hidden scores (tactical, brave, selfish,
 * loyal), every answer one of the question's own choices. A system helper has the last word where it knows better
 * (adapter.tacticHints: foundry/auto-config.js), and its playstyles after that (foundry/tactics.js). Pure, so the
 * engine, the GM planner and the player survey all agree.
 */
import { clamp, tacticalTier, fudged, TACTICAL } from "../constants.js";
import { meanPart } from "./dice.js";
import { talkAffinity } from "./behavior/talk.js";
import { typical } from "./battle-state.js";
import { costOf, costUnits } from "./turn.js";
import { isSpecial } from "./behavior/specialty.js";

export const TACTIC_CHOICES = Object.freeze({
  style: ["frontline", "skirmisher", "ranged", "caster", "protector"],
  target: ["nearest", "weakest", "dangerous", "casters", "protect", "avoidKilling"],
  resourceUse: ["conserve", "balanced", "nova"],
  // (Potions, scrolls, bombs: from "I don't like to use consumables" to "Consumables are here to get used": reluctance.js.)
  consumables: ["avoid", "sparing", "useful", "freely"],
  // (How strongly it reaches for magic and its own specialties over the ordinary: behavior/specialty.js.)
  specialty: ["none", "some", "strong", "always"],
  healAggro: ["conservative", "balanced", "aggressive", "allCosts"],
  potionThreshold: ["never", "25", "50", "75"],
  allyDying: ["rescue", "fight", "retreat", "protectSelf"],
  selfRevived: ["rejoin", "healSelf", "retreat"],
  retreat: ["never", "hurt", "losing"],
  shield: ["always", "spare", "never"],
  talk: ["always", "first", "opportune", "never"],
  beyond: ["stay", "seekHelp", "hunt"]
});

/**
 * How strongly an answer carries the wish its question took over from an old tick-box (0 to 1): the strongest answer
 * as if the box were ticked, the others less, down to none for the opposite.
 *  - talk: always talking (unless being hurt), "always prefers talking to fighting";
 *  - target: avoiding killing, "I avoid killing";
 *  - retreat: not liking to flee, "I don't like to flee".
 * "Let this character decide" carries none, as an unticked box did.
 */
export const TACTIC_WISHES = Object.freeze({
  talk: Object.freeze({ always: 1, first: 0.66, opportune: 0.33, never: 0 }),
  target: Object.freeze({ avoidKilling: 1, protect: 0.66, nearest: 0.33, dangerous: 0.33, casters: 0.33, weakest: 0 }),
  retreat: Object.freeze({ never: 1, losing: 0.5, hurt: 0 })
});

/** Question keys in survey order. `preferredAction` is special (its choices are the character's own actions). */
export const TACTIC_KEYS = Object.freeze(["preferredAction", "style", "target", "resourceUse", "specialty", "consumables", "talk", "healAggro", "potionThreshold", "allyDying", "selfRevived", "retreat", "shield", "beyond"]);

const isOffense = a => a.kind !== "heal" && a.kind !== "buff";
const usesResource = a => !!a.resource || Number.isFinite(a.uses);

/** Rough expected damage per action of `action` against a same-level foe (the system says what's typical). */
export function typicalValue(action, level, rules = null) {
  const units = rules ? Math.max(0.1, costUnits(rules, costOf(rules, action))) : Math.max(1, action.cost ?? 1);
  if ( action.sequence?.length ) {
    return action.sequence.reduce((s, strike) => s + typicalValue({ ...strike, cost: 1 }, level, null), 0) / units;
  }
  const dmg = (action.damage ?? []).reduce((s, p) => s + Math.max(0, meanPart(p)) * (p.persistent ? 2.5 : 1), 0);
  const targets = action.area ? Math.max(1, action.area.targets ?? 2) : 1;
  let chance;
  if ( action.kind === "auto" ) chance = 1;
  else if ( action.kind === "save" ) chance = 0.6;
  else {
    const ac = typical(rules, "ac", level);
    chance = clamp((21 - (ac - (action.bonus ?? 0))) / 20, 0.05, 0.95) + 0.05;
  }
  return (dmg * chance * targets * (action.castChance ?? 1)) / units;
}

/**
 * What the character would probably choose for every question: what it can do (its best attack, its healing, a
 * shield, potions), and its hidden scores. A middle-of-the-road character (every score 50) answers as most would; the
 * scores move it from there:
 *  - style: what its best attack is; a shield and the loyalty to use it, a protector; the timid keep their distance;
 *  - target: a poor head, the nearest; a fair one, the weakest; a good one, the most dangerous; a mastermind, the
 *    spellcasters and healers; a protector, whoever attacks its friends; the self-serving, easy prey;
 *  - resourceUse and consumables: the bold and rash spend freely; planners and the self-serving hold on;
 *  - specialty: a good head leans on its tricks, where it has both tricks and the ordinary;
 *  - healAggro, allyDying: the loyal and selfless rescue and keep friends up; the self-serving look after themselves;
 *    the timid get out (a world's own default for player characters, if the GM set one);
 *  - potionThreshold, selfRevived, retreat: nerve, loyalty and self-interest;
 *  - shield: the timid keep it up; the bold and rash don't bother;
 *  - talk: its words, and the timid would rather talk;
 *  - beyond: the bold and self-serving hunt down whoever's near; a good head runs for help.
 * @param {object} spec      CombatantSpec
 * @param {object} [defaults] {healAggro, allyDying} the world's defaults for player characters ("auto": let each character decide)
 * @param {object} [rules]    The system's rules (for what counts as typical at this level)
 * @returns {Record<string, string>} an answer, one of its own choices, for every question
 */
export function suggestTactics(spec, defaults = {}, rules = null) {
  const offense = (spec.actions ?? []).filter(isOffense);
  const free = offense.filter(a => !usesResource(a));
  const pool = free.length ? free : offense;
  let best = null;
  for ( const a of pool ) {
    const v = typicalValue(a, spec.level ?? 1, rules) * (a.drawCost ? 0.95 : 1);
    if ( !best || v > best.v ) best = { a, v };
  }
  const bestAction = best?.a ?? null;
  const heals = (spec.actions ?? []).filter(a => a.kind === "heal");
  const healsOthers = heals.some(a => !a.selfOnly);
  const hasPotions = heals.some(a => a.selfOnly);
  const hasRanged = offense.some(a => a.range && !a.melee);
  const specials = offense.filter(isSpecial).length;
  const sneaky = offense.some(a => a.bonusDamage?.some(b => [b.when].flat().some(w => ["offGuard", "exposed", "advantage"].includes(w))));
  const T = fudged(spec.traits?.tactical ?? 50);
  const B = fudged(spec.traits?.brave ?? 50);
  const S = fudged(spec.traits?.selfish ?? 50);
  const L = fudged(spec.traits?.loyal ?? 50);
  const tier = tacticalTier(T);
  // (A world's default for player characters, if the GM set one.)
  const worldSays = key => (spec.kind === "pc" && defaults[key] && defaults[key] !== "auto" ? defaults[key] : null);

  let style = "frontline";
  if ( bestAction && ["save", "spell-attack", "auto"].includes(bestAction.kind) ) style = "caster";
  else if ( bestAction?.range && !bestAction.melee ) style = "ranged";
  else if ( sneaky ) style = "skirmisher";
  else if ( spec.shield && L >= 40 && B >= 35 && S < 65 ) style = "protector";
  else if ( B < 35 && hasRanged ) style = "ranged";
  else if ( B < 35 ) style = "skirmisher";

  let target = "dangerous";
  if ( tier <= TACTICAL.INSTINCTIVE ) target = "nearest";
  else if ( style === "protector" || (L >= 90 && S <= 15) ) target = "protect";
  else if ( tier === TACTICAL.COMPETENT || S >= 70 ) target = "weakest";
  else if ( tier >= TACTICAL.MASTERMIND ) target = "casters";

  let resourceUse = "balanced";
  if ( B >= 70 && T < 50 ) resourceUse = "nova";
  else if ( T >= 70 || S >= 65 ) resourceUse = "conserve";

  let consumables = "useful";
  if ( S >= 70 ) consumables = "avoid";
  else if ( S >= 55 || T >= 75 ) consumables = "sparing";
  else if ( (B >= 75 && T < 50) || (L >= 85 && S <= 20) ) consumables = "freely";

  const specialty = specials && specials < offense.length && T >= 70 ? "some" : "none";

  let healAggro = "conservative";
  if ( healsOthers ) {
    if ( L >= 90 && S <= 10 ) healAggro = "allCosts";
    else if ( L >= 75 && S <= 30 ) healAggro = "aggressive";
    else if ( S >= 60 || L < 40 ) healAggro = "conservative";
    else healAggro = "balanced";
  }

  let potionThreshold = "never";
  if ( hasPotions ) potionThreshold = B < 40 || S >= 70 ? "75" : B >= 80 && S < 40 ? "25" : "50";

  let allyDying = "fight";
  if ( healsOthers ? L >= 50 && S < 65 && B >= 35 : L >= 75 && B >= 60 ) allyDying = "rescue";
  else if ( B < 35 ) allyDying = "retreat";
  else if ( S >= 70 && L < 50 ) allyDying = "protectSelf";

  let selfRevived = "rejoin";
  if ( B < 40 || (S >= 70 && B < 60) ) selfRevived = "retreat";
  else if ( heals.length && T >= 60 && B < 80 ) selfRevived = "healSelf";

  let retreat = "hurt";
  if ( B >= 70 ) retreat = "never";
  else if ( S < 70 && ((L >= 70 && B >= 50) || T >= 70) ) retreat = "losing";

  let shield = "never";
  if ( spec.shield ) shield = B < 45 || (style === "protector" && L >= 75 && T >= 60) ? "always" : B >= 80 && T < 50 ? "never" : "spare";

  let beyond = "stay";
  if ( B >= 70 && (S >= 55 || T < 45) ) beyond = "hunt";
  else if ( T >= 60 && L >= 60 && B < 70 ) beyond = "seekHelp";

  return {
    preferredAction: bestAction?.id ?? "",
    style,
    target,
    resourceUse,
    consumables,
    specialty,
    healAggro: worldSays("healAggro") ?? healAggro,
    potionThreshold,
    allyDying: worldSays("allyDying") ?? allyDying,
    selfRevived,
    retreat,
    shield,
    talk: suggestTalk(spec, rules, B),
    beyond
  };
}

/** Would this character open with words, try them when they might work, or never bother? (The timid would rather talk.) */
function suggestTalk(spec, rules, brave = 50) {
  const affinity = talkAffinity(spec, { tactical: fudged(spec.traits?.tactical ?? 50) }, rules);
  if ( affinity <= 0 ) return "never";
  const leaning = affinity + (brave < 40 ? (40 - brave) / 100 : 0);
  if ( leaning >= 0.75 ) return "first";
  if ( leaning >= 0.3 ) return "opportune";
  return "never";
}

/** Merge stored answers over suggestions; "auto" (or missing) means "use the suggestion". */
export function resolveTactics(stored = {}, suggested = {}) {
  const out = {};
  for ( const key of TACTIC_KEYS ) {
    const v = stored[key];
    out[key] = (v === undefined || v === null || v === "" || v === "auto") ? suggested[key] : v;
  }
  // A preferred action that no longer exists falls back to the suggestion.
  return out;
}

/** Style weight applied to an action's value when choosing what to do. */
export function styleWeight(tactics, action) {
  if ( !tactics ) return 1;
  let w = 1;
  const ranged = !!action.range && !action.melee;
  const spell = ["save", "spell-attack", "auto"].includes(action.kind);
  switch ( tactics.style ) {
    case "frontline": if ( action.melee ) w *= 1.2; break;
    case "ranged": w *= ranged ? 1.3 : 0.7; break;
    case "caster": if ( spell ) w *= 1.3; break;
    case "skirmisher": if ( action.melee ) w *= 1.1; break;
    case "protector": if ( action.melee ) w *= 1.1; break;
  }
  if ( tactics.preferredAction && action.id === tactics.preferredAction ) w *= 1.35;
  return w;
}
