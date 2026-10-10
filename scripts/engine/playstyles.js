/**
 * Playstyles: up to four labels per character (player-chosen for PCs, GM-chosen for NPCs) that predict how
 * they really fight. Each playstyle can
 *   - shift personality traits,
 *   - suggest tactics answers (what "Let them decide" means for this character),
 *   - switch on engine behaviors (finishing the downed, parleying first, studying a foe, ...).
 *
 * Two modifiers:
 *   stayTrue  ("stay mostly true to my calculated tactical level"): deviations from the calculated strategy are
 *             capped at 10%: trait shifts at ±10, and any answer or behavior that departs from the calculation
 *             only applies in ~10% of simulated fights.
 *   roleplay  ("roleplaying is very important to me"): playstyles weigh heavily: trait shifts doubled and
 *             behaviors much more likely.
 * Pure: no Foundry globals.
 */
import { clamp } from "../constants.js";

export const MAX_PLAYSTYLES = 4;
export const STAY_TRUE_CAP = 0.1;

/**
 * traits:    additive shifts on 0-100 traits
 * suggest:   tactics answers this playstyle implies (first selected playstyle wins on conflicts)
 * behavior:  engine hooks; numbers are base chances per opportunity (scaled by intensity)
 */
export const PLAYSTYLES = Object.freeze({
  scaredyCat: { icon: "fa-ghost", traits: { brave: -30, selfish: 10 }, suggest: { retreat: "hurt", style: "ranged", potionThreshold: "75" }, behavior: { lowProfile: 0.3 } },
  cruel: { icon: "fa-skull-crossbones", traits: { selfish: 20, loyal: -5 }, suggest: { target: "weakest" }, behavior: { finishDowned: 0.4 } },
  moralist: { icon: "fa-scale-balanced", traits: { selfish: -15, loyal: 10 }, suggest: { allyDying: "rescue" }, behavior: { spareDowned: 1 } },
  peoplePleaser: { icon: "fa-face-smile", traits: { selfish: -20, loyal: 15 }, suggest: { healAggro: "aggressive", target: "protect" }, behavior: { followFocus: 0.5 } },
  fragile: { icon: "fa-heart-crack", traits: { brave: -15 }, suggest: { retreat: "hurt", potionThreshold: "75", selfRevived: "healSelf" }, behavior: { lowProfile: 0.2 } },
  impatient: { icon: "fa-hourglass-end", traits: { tactical: -10 }, suggest: { resourceUse: "nova", target: "nearest", shield: "never" }, behavior: { rush: 0.5 } },
  brawler: { icon: "fa-hand-fist", traits: { brave: 15, tactical: -5 }, suggest: { style: "frontline", target: "nearest" }, behavior: { meleeBias: 0.3 } },
  skeptic: { icon: "fa-magnifying-glass", traits: { tactical: 10 }, suggest: { resourceUse: "conserve", healAggro: "conservative" }, behavior: {} },
  speedRunner: { icon: "fa-forward-fast", traits: { tactical: 5, brave: 5 }, suggest: { resourceUse: "nova", target: "weakest" }, behavior: { rush: 0.4 } },
  leader: { icon: "fa-flag", traits: { brave: 10, loyal: 10, tactical: 5 }, suggest: { target: "dangerous" }, behavior: { leads: 1 } },
  instigator: { icon: "fa-fire", traits: { brave: 10, selfish: 5 }, suggest: { style: "frontline", target: "dangerous" }, behavior: { drawAggro: 0.35, initiative: 2 } },
  diplomat: { icon: "fa-handshake", traits: { selfish: -10 }, suggest: { target: "dangerous" }, behavior: { parleyFirst: 0.6, spareDowned: 0.5 } },
  wallflower: { icon: "fa-user-ninja", traits: { brave: -10 }, suggest: { style: "ranged" }, behavior: { lowProfile: 0.45 } },
  martyr: { icon: "fa-cross", traits: { brave: 20, selfish: -30, loyal: 20 }, suggest: { allyDying: "rescue", retreat: "never", healAggro: "allCosts", style: "protector", target: "protect" }, behavior: { drawAggro: 0.3 } },
  mercenary: { icon: "fa-coins", traits: { selfish: 30, loyal: -20 }, suggest: { retreat: "losing", resourceUse: "conserve", allyDying: "fight" }, behavior: {} },
  enabler: { icon: "fa-hands-holding", traits: { selfish: -15, loyal: 10 }, suggest: { healAggro: "aggressive", target: "protect" }, behavior: { followFocus: 0.3 } },
  redeemSeeker: { icon: "fa-dove", traits: { brave: 15, selfish: -20 }, suggest: { allyDying: "rescue", retreat: "never", style: "frontline" }, behavior: { drawAggro: 0.15 } },
  loreCollector: { icon: "fa-book-open", traits: { tactical: 5 }, suggest: {}, behavior: { study: 0.5 } },
  puzzleManiac: { icon: "fa-puzzle-piece", traits: { tactical: 15 }, suggest: { target: "casters" }, behavior: { exploitWeakness: 0.5 } },
  wildcard: { icon: "fa-dice", traits: {}, suggest: {}, behavior: { random: 0.25 } }
});

export const PLAYSTYLE_IDS = Object.freeze(Object.keys(PLAYSTYLES));

/** How strongly playstyles act: 1 normally, heavier for roleplay. */
export function intensity({ roleplay = false } = {}) {
  return roleplay ? 1.8 : 1;
}

/**
 * Aggregate a character's playstyles.
 * @param {string[]} ids
 * @param {{stayTrue?: boolean, roleplay?: boolean}} flags
 * @returns {{ids: string[], traits: object, suggest: object, behavior: object}}
 */
export function combinePlaystyles(ids = [], { stayTrue = false, roleplay = false } = {}) {
  const chosen = ids.filter(id => PLAYSTYLES[id]).slice(0, MAX_PLAYSTYLES);
  const k = intensity({ roleplay });
  const traits = {};
  const suggest = {};
  const behavior = {};
  for ( const id of chosen ) {
    const p = PLAYSTYLES[id];
    for ( const [t, v] of Object.entries(p.traits) ) traits[t] = (traits[t] ?? 0) + v * (roleplay ? 2 : 1);
    for ( const [key, v] of Object.entries(p.suggest) ) suggest[key] ??= v; // first-listed playstyle wins
    for ( const [b, v] of Object.entries(p.behavior) ) {
      const scaled = b === "initiative" ? v * k : clamp(v * k, 0, 1);
      behavior[b] = Math.max(behavior[b] ?? 0, scaled);
    }
  }
  for ( const t of Object.keys(traits) ) {
    traits[t] = stayTrue ? clamp(traits[t], -10, 10) : clamp(traits[t], -60, 60);
  }
  if ( stayTrue ) {
    // Any behavior that departs from the calculated strategy may only show up ~10% of the time.
    for ( const b of Object.keys(behavior) ) {
      behavior[b] = b === "initiative" ? Math.min(behavior[b], 1) : Math.min(behavior[b], STAY_TRUE_CAP);
    }
  }
  return { ids: chosen, traits, suggest, behavior };
}

/**
 * Per-fight tactics for one combatant. Answers that differ from the calculated strategy apply with
 * probability 1, or only 10% of the time when the character stays true to their calculated tactics.
 * @param {object} spec   CombatantSpec with tactics / tacticsCalc / stayTrue
 * @param {object} rng
 */
export function sampleRunTactics(spec, rng) {
  if ( !spec.tactics ) return null;
  if ( !spec.stayTrue || !spec.tacticsCalc ) return spec.tactics;
  const out = {};
  for ( const [key, value] of Object.entries(spec.tactics) ) {
    const calc = spec.tacticsCalc[key];
    out[key] = (calc === undefined || calc === value || rng.next() < STAY_TRUE_CAP) ? value : calc;
  }
  return out;
}
