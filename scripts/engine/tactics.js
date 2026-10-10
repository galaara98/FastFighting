/**
 * Player-chosen tactics. Every question defaults to "auto": what this character would probably do, worked out
 * from its CombatantSpec. Pure, so the engine, the GM planner and the player survey all agree.
 */
import { clamp, tacticalTier, fudged, TACTICAL } from "../constants.js";
import { meanPart } from "./dice.js";

export const TACTIC_CHOICES = Object.freeze({
  style: ["frontline", "skirmisher", "ranged", "caster", "protector"],
  target: ["nearest", "weakest", "dangerous", "casters", "protect"],
  resourceUse: ["conserve", "balanced", "nova"],
  healAggro: ["conservative", "balanced", "aggressive", "allCosts"],
  potionThreshold: ["never", "25", "50", "75"],
  allyDying: ["rescue", "fight", "retreat", "protectSelf"],
  selfRevived: ["rejoin", "healSelf", "retreat"],
  retreat: ["never", "hurt", "losing"],
  shield: ["always", "spare", "never"]
});

/** Question keys in survey order. `preferredAction` and `notes` are special (dynamic choices, free text). */
export const TACTIC_KEYS = Object.freeze(["preferredAction", "style", "target", "resourceUse", "healAggro", "potionThreshold", "allyDying", "selfRevived", "retreat", "shield", "notes"]);

const isOffense = a => a.kind !== "heal";
const usesResource = a => !!a.resource || Number.isFinite(a.uses);

/** Rough expected damage per action of `action` against a same-level foe. */
export function typicalValue(action, level) {
  const dmg = (action.damage ?? []).reduce((s, p) => s + Math.max(0, meanPart(p)) * (p.persistent ? 2.5 : 1), 0);
  const targets = action.area ? Math.max(1, action.area.targets ?? 2) : 1;
  let chance;
  if ( action.kind === "auto" ) chance = 1;
  else if ( action.kind === "save" ) chance = 0.6;
  else {
    const ac = 15 + level;
    chance = clamp((21 - (ac - (action.bonus ?? 0))) / 20, 0.05, 0.95) + 0.05;
  }
  return (dmg * chance * targets) / Math.max(1, action.cost ?? 1);
}

/**
 * What the character would probably choose for every question.
 * @param {object} spec      CombatantSpec
 * @param {object} [defaults] {healAggro, allyDying} world defaults
 * @returns {Record<string, string>}
 */
export function suggestTactics(spec, defaults = {}) {
  const offense = (spec.actions ?? []).filter(isOffense);
  const free = offense.filter(a => !usesResource(a));
  const pool = free.length ? free : offense;
  let best = null;
  for ( const a of pool ) {
    const v = typicalValue(a, spec.level ?? 1) * (a.drawCost ? 0.95 : 1);
    if ( !best || v > best.v ) best = { a, v };
  }
  const bestAction = best?.a ?? null;
  const heals = (spec.actions ?? []).filter(a => a.kind === "heal");
  const hasPotions = heals.some(a => a.selfOnly);
  const sneaky = offense.some(a => a.bonusDamage?.some(b => b.when === "offGuard"));
  const tactical = fudged(spec.traits?.tactical ?? 50);
  const brave = fudged(spec.traits?.brave ?? 50);
  const tier = tacticalTier(tactical);

  let style = "frontline";
  if ( bestAction && ["save", "spell-attack", "auto"].includes(bestAction.kind) ) style = "caster";
  else if ( bestAction?.range && !bestAction.melee ) style = "ranged";
  else if ( sneaky ) style = "skirmisher";
  else if ( spec.shield ) style = "protector";

  let target = "dangerous";
  if ( tier <= TACTICAL.INSTINCTIVE ) target = "nearest";
  else if ( tier === TACTICAL.COMPETENT ) target = "weakest";
  else if ( style === "protector" ) target = "protect";

  return {
    preferredAction: bestAction?.id ?? "",
    style,
    target,
    resourceUse: "balanced",
    healAggro: defaults.healAggro ?? (heals.some(a => !a.selfOnly) ? "balanced" : "conservative"),
    potionThreshold: hasPotions ? "50" : "never",
    allyDying: defaults.allyDying ?? (heals.some(a => !a.selfOnly) ? "rescue" : "fight"),
    selfRevived: "rejoin",
    retreat: brave >= 70 ? "never" : "hurt",
    shield: spec.shield ? "spare" : "never",
    notes: ""
  };
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
