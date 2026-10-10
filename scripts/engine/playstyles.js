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
 * desire:    how the character picks up desires (see engine/behavior/desire.js), added up across its pills:
 *   hurt      points toward foes that suit it: nearest, far (two moves or more away), weakest, dangerous, casters,
 *             healers, downed, leader (theirs), weakness (foes its attacks exploit), unstudied (foes it hasn't sized
 *             up), current (the one it's on)
 *   heal, protect, talk   points toward healing hurt friends, guarding the weakest friend, talking
 *   avoid     fear: of the most dangerous foe, of whoever is hurting it once it's hurt (attacker), of the nearest
 *   whim      a random foe now and then catches its eye
 *   ×1 multipliers: retaliate (hitting back), avenge (a fallen friend's killer), cool (how fast the fight's grudges
 *             fade), frustration (how fast obstacles wear desires down), leader, team (how much it listens),
 *             doorPatience (how long it keeps at a locked door); contrarian: the chance it goes against its leader
 */
export const PLAYSTYLES = Object.freeze({
  // Afraid: of the most dangerous foe above all; gives up easily, hits back half-heartedly.
  scaredyCat: { icon: "fa-ghost", traits: { brave: -30, selfish: 10 }, suggest: { retreat: "hurt", style: "ranged", potionThreshold: "75" }, behavior: { lowProfile: 0.3 },
    desire: { avoid: { dangerous: 35 }, frustration: 1.5, retaliate: 0.5 } },
  // Picks on the weak and the fallen.
  cruel: { icon: "fa-skull-crossbones", traits: { selfish: 20, loyal: -5 }, suggest: { target: "weakest", beyond: "hunt" }, behavior: { finishDowned: 0.4 },
    desire: { hurt: { weakest: 15, downed: 25 }, retaliate: 1.3 } },
  // Never the fallen; the weakest friend comes first.
  moralist: { icon: "fa-scale-balanced", traits: { selfish: -15, loyal: 10 }, suggest: { allyDying: "rescue" }, behavior: { spareDowned: 1, helps: 1 },
    desire: { hurt: { downed: -100 }, heal: 10, protect: 10 } },
  // Does what the others want: the leader's and the team's wishes pull hard.
  peoplePleaser: { icon: "fa-face-smile", traits: { selfish: -20, loyal: 15 }, suggest: { healAggro: "aggressive", target: "protect", talk: "opportune" }, behavior: { followFocus: 0.5, helps: 1 },
    desire: { talk: 10, leader: 2, team: 2.5 } },
  // Fine until hurt; then it wants to mend itself and get away from whoever is hurting it.
  fragile: { icon: "fa-heart-crack", traits: { brave: -15 }, suggest: { retreat: "hurt", potionThreshold: "75", selfRevived: "healSelf" }, behavior: { lowProfile: 0.2 },
    desire: { avoid: { attacker: 30 }, heal: 10, frustration: 1.3 } },
  // The nearest foe, now; no patience for obstacles (or locked doors).
  impatient: { icon: "fa-hourglass-end", traits: { tactical: -10 }, suggest: { resourceUse: "nova", target: "nearest", shield: "never" }, behavior: { rush: 0.5 },
    desire: { hurt: { nearest: 15 }, frustration: 2, doorPatience: 0.5 } },
  // Up close and personal: the nearest foe, hits back hard, no talking.
  brawler: { icon: "fa-hand-fist", traits: { brave: 15, tactical: -5 }, suggest: { style: "frontline", target: "nearest", talk: "never" }, behavior: { meleeBias: 0.3 },
    desire: { hurt: { nearest: 20 }, talk: -40, retaliate: 1.5 } },
  // Trusts its own judgment over anyone's, and isn't talked into things.
  skeptic: { icon: "fa-magnifying-glass", traits: { tactical: 10 }, suggest: { resourceUse: "conserve", healAggro: "conservative" }, behavior: {},
    desire: { talk: -15, leader: 0.5, team: 0.5, frustration: 0.8 } },
  // Ends it fast: the quickest kills.
  speedRunner: { icon: "fa-forward-fast", traits: { tactical: 5, brave: 5 }, suggest: { resourceUse: "nova", target: "weakest" }, behavior: { rush: 0.4 },
    desire: { hurt: { weakest: 20 }, frustration: 1.3 } },
  // Leads: goes for the biggest threat and looks after its people; follows nobody else's lead.
  leader: { icon: "fa-flag", traits: { brave: 10, loyal: 10, tactical: 5 }, suggest: { target: "dangerous" }, behavior: { leads: 1 },
    desire: { hurt: { dangerous: 10 }, protect: 10, talk: 5, leader: 0.4 } },
  // Starts trouble: the most dangerous foe and their leader; may defy its own leader.
  instigator: { icon: "fa-fire", traits: { brave: 10, selfish: 5 }, suggest: { style: "frontline", target: "dangerous" }, behavior: { drawAggro: 0.35, initiative: 2 },
    desire: { hurt: { dangerous: 15, leader: 15 }, retaliate: 1.2, contrarian: 0.5 } },
  // Talks first, and spares the fallen.
  diplomat: { icon: "fa-handshake", traits: { selfish: -10 }, suggest: { talk: "first", target: "dangerous" }, behavior: { parleyFirst: 0.6, spareDowned: 0.5 },
    desire: { talk: 30, hurt: { downed: -50 } } },
  // Keeps its distance and out of the crowd.
  wallflower: { icon: "fa-user-ninja", traits: { brave: -10 }, suggest: { style: "ranged" }, behavior: { lowProfile: 0.45 },
    desire: { hurt: { nearest: -10 }, avoid: { nearest: 15 }, team: 0.7 } },
  // Shields the weakest friend, avenges the fallen, fears nothing.
  martyr: { icon: "fa-cross", traits: { brave: 20, selfish: -30, loyal: 20 }, suggest: { allyDying: "rescue", retreat: "never", healAggro: "allCosts", style: "protector", target: "protect" }, behavior: { drawAggro: 0.3, helps: 1 },
    desire: { protect: 25, heal: 15, avenge: 2, avoid: { dangerous: -50, attacker: -50 } } },
  // In it for itself: easy pickings, little loyalty, gives up when it gets hard.
  mercenary: { icon: "fa-coins", traits: { selfish: 30, loyal: -20 }, suggest: { retreat: "losing", resourceUse: "conserve", allyDying: "fight" }, behavior: {},
    desire: { hurt: { weakest: 10 }, avenge: 0.3, team: 0.5, frustration: 1.3 } },
  // Support first: heals and guards friends, backs the leader.
  enabler: { icon: "fa-hands-holding", traits: { selfish: -15, loyal: 10 }, suggest: { healAggro: "aggressive", target: "protect" }, behavior: { followFocus: 0.3, helps: 1 },
    desire: { heal: 25, protect: 15, leader: 1.3 } },
  // Out to prove itself: takes on the biggest threat and won't quit.
  redeemSeeker: { icon: "fa-dove", traits: { brave: 15, selfish: -20 }, suggest: { allyDying: "rescue", retreat: "never", style: "frontline" }, behavior: { drawAggro: 0.15, helps: 1 },
    desire: { hurt: { dangerous: 20 }, protect: 10, frustration: 0.6 } },
  // Curious: drawn to foes it hasn't sized up yet.
  loreCollector: { icon: "fa-book-open", traits: { tactical: 5 }, suggest: {}, behavior: { study: 0.5 },
    desire: { hurt: { unstudied: 10 }, frustration: 0.8 } },
  // Loves a weakness to exploit (and a lock to crack).
  puzzleManiac: { icon: "fa-puzzle-piece", traits: { tactical: 15 }, suggest: { target: "casters" }, behavior: { exploitWeakness: 0.5 },
    desire: { hurt: { weakness: 20, casters: 10 }, frustration: 0.7, doorPatience: 2 } },
  // Unpredictable: something random catches its eye, nobody's voice counts for much, may defy its leader.
  wildcard: { icon: "fa-dice", traits: {}, suggest: {}, behavior: { random: 0.25 },
    desire: { whim: 25, leader: 0.3, team: 0.3, contrarian: 0.5 } },
  // Light fingers: a lock is an invitation.
  thief: { icon: "fa-mask", traits: { selfish: 10 }, suggest: {}, behavior: { steal: 1 },
    desire: { hurt: { weakest: 5 }, doorPatience: 1.5 } },
  // Never forgets: hits back twice as hard, avenges the fallen, and its grudges never cool.
  vengeful: { icon: "fa-bolt", traits: { brave: 5, selfish: 5 }, suggest: {}, behavior: {},
    desire: { retaliate: 2, avenge: 2.5, cool: 0 } },
  // Single-minded: sticks with its target, shrugs off setbacks, keeps at a locked door.
  relentless: { icon: "fa-crosshairs", traits: { brave: 10 }, suggest: {}, behavior: {},
    desire: { hurt: { current: 15 }, frustration: 0.4, doorPatience: 1.5 } },
  // As little as it can get away with: whatever's nearest, no long walks, not much help for anyone, gives up fast,
  // and can't be bothered to hold a grudge.
  lazy: { icon: "fa-couch", traits: { tactical: -5, brave: -5 }, suggest: { resourceUse: "conserve" }, behavior: {},
    desire: { hurt: { nearest: 15, far: -20 }, heal: -10, protect: -10, frustration: 1.6, doorPatience: 0.4, cool: 1.5 } }
});

/** Desire keys that add up across pills, and those that multiply (a playstyle's ×1 is "no change"). */
const DESIRE_MULTIPLIERS = ["retaliate", "avenge", "cool", "frustration", "leader", "team", "doorPatience"];

/** The combined desire guide of a character's pills (roleplay leans on it harder; staying true halves it). */
function combineDesires(chosen, { stayTrue, roleplay }) {
  const scale = roleplay ? 1.5 : stayTrue ? 0.5 : 1;
  const out = { hurt: {}, avoid: {}, heal: 0, protect: 0, talk: 0, whim: 0, contrarian: 0 };
  for ( const m of DESIRE_MULTIPLIERS ) out[m] = 1;
  for ( const id of chosen ) {
    const d = PLAYSTYLES[id].desire ?? {};
    for ( const group of ["hurt", "avoid"] ) for ( const [k, v] of Object.entries(d[group] ?? {}) ) out[group][k] = (out[group][k] ?? 0) + v * scale;
    for ( const k of ["heal", "protect", "talk", "whim"] ) out[k] += (d[k] ?? 0) * scale;
    for ( const m of DESIRE_MULTIPLIERS ) if ( d[m] !== undefined ) out[m] *= 1 + (d[m] - 1) * scale;
    if ( d.contrarian ) out.contrarian = Math.min(1, Math.max(out.contrarian, d.contrarian * scale));
  }
  for ( const m of DESIRE_MULTIPLIERS ) out[m] = Math.max(0, out[m]);
  return out;
}

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
  return { ids: chosen, traits, suggest, behavior, desire: combineDesires(chosen, { stayTrue, roleplay }) };
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
