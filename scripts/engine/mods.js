/**
 * The numbers a buff or a debuff changes: the engine's own vocabulary, the same in every system. A system's helper
 * reads its spells, songs, skills and features into it; anything it can't express it simply leaves out.
 *
 *   attack, ac, saves, checks, damage   flat bonuses (+) or penalties (-) to rolls, AC and each damaging hit
 *   attackDie, saveDie                  a die rolled with every attack or save (5e Bless 4 = +1d4; Bane -4 = -1d4)
 *   adv                                 its own attacks: +1 advantage, -1 disadvantage
 *   defAdv                              attacks against it: +1 advantage (Faerie Fire), -1 disadvantage (Blur, Dodge)
 *   saveAdv                             its saves: +1 advantage, -1 disadvantage
 *   speed                               feet (+10 Longstrider, -10 Ray of Frost)
 *   actions                             main-pool units each turn (+1 Haste or quickened, -1 Slow)
 *
 * Bonuses of one kind don't add up: the best bonus and the worst penalty count, which is close to both PF2e's typed
 * bonuses and 5e's "the same spell doesn't stack". Any advantage and any disadvantage cancel. Unknown keys and
 * values that aren't numbers are ignored. Pure: no imports, no Foundry.
 */

export const FLAT_MODS = Object.freeze(["attack", "ac", "saves", "checks", "damage", "speed", "actions"]);
export const DIE_MODS = Object.freeze(["attackDie", "saveDie"]);
export const SIGN_MODS = Object.freeze(["adv", "defAdv", "saveAdv"]);
const KNOWN = new Set([...FLAT_MODS, ...DIE_MODS, ...SIGN_MODS]);

/** Combine several mods objects into one: {attack: 1, attackDie: [4, -4], adv: 1, ...}; empty when nothing applies. */
export function combineMods(list) {
  const best = {};
  const worst = {};
  for ( const m of list ?? [] ) {
    if ( !m || typeof m !== "object" ) continue;
    for ( const [k, raw] of Object.entries(m) ) {
      if ( !KNOWN.has(k) ) continue;
      const v = Number(raw);
      if ( !Number.isFinite(v) || !v ) continue;
      if ( v > 0 ) best[k] = Math.max(best[k] ?? 0, v);
      else worst[k] = Math.min(worst[k] ?? 0, v);
    }
  }
  const out = {};
  for ( const k of FLAT_MODS ) {
    const v = (best[k] ?? 0) + (worst[k] ?? 0);
    if ( v ) out[k] = v;
  }
  for ( const k of DIE_MODS ) {
    const dice = [best[k], worst[k]].filter(Boolean).map(f => Math.sign(f) * Math.max(2, Math.round(Math.abs(f))));
    if ( dice.length ) out[k] = dice;
  }
  for ( const k of SIGN_MODS ) {
    const v = (best[k] ? 1 : 0) - (worst[k] ? 1 : 0);
    if ( v ) out[k] = v;
  }
  return out;
}

/** Mean of signed dice ([4] = +1d4 = 2.5; [4, -4] = 0). */
export function diceMean(dice) {
  let total = 0;
  for ( const f of dice ?? [] ) total += Math.sign(f) * (Math.abs(f) + 1) / 2;
  return total;
}

/** Net advantage from several sources (each -1, 0 or +1): any of each cancel out. */
export function netAdvantage(...values) {
  const adv = values.some(v => v > 0);
  const dis = values.some(v => v < 0);
  return adv === dis ? 0 : adv ? 1 : -1;
}

/** A word for how bonuses and penalties leave whoever has them, for the story ("{target} is weakened"). */
export function describeMods(mods = {}, { tempHp = 0 } = {}) {
  const sign = k => Math.sign(Array.isArray(mods[k]) ? mods[k][0] : Number(mods[k]) || 0);
  if ( sign("actions") > 0 ) return "hastened";
  if ( sign("actions") < 0 ) return "slowed";
  if ( sign("attack") > 0 || sign("attackDie") > 0 ) return "emboldened";
  if ( sign("attack") < 0 || sign("attackDie") < 0 ) return "weakened";
  if ( sign("ac") > 0 || sign("defAdv") < 0 ) return "shielded";
  if ( sign("ac") < 0 || sign("defAdv") > 0 ) return "exposed";
  if ( sign("saves") > 0 || sign("saveDie") > 0 ) return "steeled";
  if ( sign("saves") < 0 || sign("saveDie") < 0 ) return "shaken";
  if ( sign("damage") > 0 ) return "empowered";
  if ( sign("damage") < 0 ) return "enfeebled";
  if ( sign("adv") < 0 ) return "rattled";
  if ( sign("speed") > 0 ) return "fleet-footed";
  if ( sign("speed") < 0 ) return "slowed";
  if ( sign("checks") > 0 ) return "inspired";
  if ( tempHp > 0 ) return "bolstered";
  return "affected";
}
