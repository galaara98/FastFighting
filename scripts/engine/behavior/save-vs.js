/**
 * Situational saves: what a creature has to its saves against only some effects, beyond what its sheet's own saves
 * already include (PF2e "+1 status to all saves vs. magic", "+2 circumstance to saves vs. fear"; 5e Magic Resistance,
 * advantage on saves against spells and other magic; Dwarven Resilience, advantage against poison).
 *
 * spec.saveVs: [{bonus, type, saves, vs, all, not, from, advantage}], each optional but bonus or advantage:
 *   bonus      added to the save (a penalty when negative: PF2e "-1 status to all saves vs. death")
 *   type       its kind, for stacking: "status" | "circumstance" | "item" | "untyped" (the default). Of each kind
 *              only the best bonus and the worst penalty count; untyped ones all add up (PF2e's rule)
 *   saves      which of the system's saves it's for (its own keys: "will", "con" ...); left out or "all", every one
 *   vs         the effect carries one of these tags (any of them); left out, any effect
 *   all        ... and every one of these
 *   not        ... and none of these
 *   from       the one who set it off has one of these creature traits (spec.creatureTraits: PF2e "origin:trait:x")
 *   advantage  +1 (or true): advantage on such saves; -1: disadvantage (5e)
 * An effect's tags (effectTags): its traits (action.traits, the system's own ids: "poison", "fear", "mental",
 * "emotion", "arcane" ...), and four of the engine's own: "magical" (a spell or anything magical: battle-state.js
 * isMagical), "spell" (a spell: one with a rank, a spell id or a spell check), "area" (an area or an aura) and
 * "damaging" (it deals damage), with "inflicts:<condition>" for each condition it may lay (the engine's keys:
 * "inflicts:frightened"). An effect a hazard sets off (its user's spec.hazard: a trap, a haunt) carries "hazard" and
 * "trap" too (API 29: DCC's Guardian Angel augur, PF2e's Trap Finder, 5e's Dungeon Delver). A helper puts the system's own tags on its actions as traits (PF2e: the spellcasting
 * entry's tradition on a spell, as PF2e's own roll options have it).
 * Bonuses already on the creature from effects (outcome.mods.saves) add to these as they always have: the engine
 * doesn't know their kind.
 * Pure: no Foundry globals.
 */
import { netAdvantage } from "../mods.js";
import { isMagical } from "../battle-state.js";

/** An effect's tags, worked out once per action (actions are the spec's own, and don't change in a fight). */
const TAGS = new WeakMap();

/** Every condition an action may lay: its degrees' outcomes, a buff's or an aura's, its riders'. */
function inflicted(action) {
  const out = new Set();
  const take = o => { if ( o && typeof o === "object" && !o.self ) for ( const [k, v] of Object.entries(o.conditions ?? {}) ) if ( v ) out.add(k); };
  for ( const o of [...(action.onSave ?? []), ...(action.onHit ?? []), ...(action.byDegree ?? []), ...(action.onDegree ?? [])] ) take(o);
  take(action.outcome);
  for ( const e of action.effects ?? [] ) {
    take(e);
    if ( e.kind === "prone" ) out.add("prone");
    if ( e.kind === "grabbed" ) out.add("grabbed");
    for ( const stage of e.stages ?? [] ) take(stage);
  }
  return out;
}

/**
 * The tags an incoming effect carries, for spec.saveVs: its traits, and the engine's own (magical, spell, area,
 * damaging, inflicts:<condition>). `magical`: the caller knows it's magical though the action doesn't say.
 * @returns {Set<string>}
 */
export function effectTags(action, { magical = false } = {}) {
  if ( !action || typeof action !== "object" ) return new Set(magical ? ["magical"] : []);
  let tags = TAGS.get(action);
  if ( !tags ) {
    tags = new Set((action.traits ?? []).filter(t => typeof t === "string").map(t => t.toLowerCase()));
    if ( isMagical(action) ) tags.add("magical");
    if ( action.rank !== undefined || action.spellId || action.casting || action.spell ) tags.add("spell");
    if ( action.area || action.aura ) tags.add("area");
    if ( action.damage?.length || action.effects?.some(e => e.damage?.length) ) tags.add("damaging");
    for ( const k of inflicted(action) ) tags.add(`inflicts:${k}`);
    TAGS.set(action, tags);
  }
  if ( magical && !tags.has("magical") ) return new Set([...tags, "magical"]);
  return tags;
}

/** Does one entry of spec.saveVs reach this save against this effect? */
export function saveVsApplies(entry, type, tags, from = null) {
  if ( !entry || typeof entry !== "object" ) return false;
  const saves = entry.saves;
  if ( saves && saves !== "all" && ![].concat(saves).includes(type) ) return false;
  const list = v => [].concat(v ?? []).filter(x => typeof x === "string").map(x => x.toLowerCase());
  const vs = list(entry.vs);
  if ( vs.length && !vs.some(t => tags.has(t)) ) return false;
  if ( !list(entry.all).every(t => tags.has(t)) ) return false;
  if ( list(entry.not).some(t => tags.has(t)) ) return false;
  const kin = list(entry.from);
  // (A hazard is a trap whatever its traits: one the GM marked in the token's tab too. API 29.)
  const theirs = [...(from?.spec?.creatureTraits ?? []), ...(from?.spec?.hazard ? ["hazard", "trap"] : [])];
  if ( kin.length && !theirs.some(t => kin.includes(String(t).toLowerCase())) ) return false;
  return true;
}

/**
 * What t's situational saves (spec.saveVs) add to this save, against this effect from `from`: {bonus, advantage}.
 * Of each kind of bonus only the best counts, and of each kind of penalty the worst; untyped ones add up.
 */
export function saveVsBonus(t, type, { action = null, from = null, magical = false } = {}) {
  const list = t?.spec?.saveVs;
  if ( !Array.isArray(list) || !list.length ) return { bonus: 0, advantage: 0 };
  const own = effectTags(action, { magical });
  const tags = from?.spec?.hazard ? new Set([...own, "hazard", "trap"]) : own;
  const best = {};
  const worst = {};
  let untyped = 0;
  const leans = [];
  for ( const e of list ) {
    if ( !saveVsApplies(e, type, tags, from) ) continue;
    const n = Number(e.bonus) || 0;
    const kind = ["status", "circumstance", "item"].includes(e.type) ? e.type : "untyped";
    if ( kind === "untyped" ) untyped += n;
    else if ( n > 0 ) best[kind] = Math.max(best[kind] ?? 0, n);
    else if ( n < 0 ) worst[kind] = Math.min(worst[kind] ?? 0, n);
    const adv = e.advantage === true ? 1 : Number(e.advantage) || 0;
    if ( adv ) leans.push(adv);
  }
  const sum = o => Object.values(o).reduce((s, v) => s + v, 0);
  return { bonus: untyped + sum(best) + sum(worst), advantage: leans.length ? netAdvantage(...leans) : 0 };
}
