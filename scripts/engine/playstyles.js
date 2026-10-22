/**
 * Playstyles: up to four labels per character (player-chosen for PCs, GM-chosen for NPCs) that predict how
 * they really fight. Each playstyle can
 *   - shift personality traits,
 *   - suggest tactics answers (what "Let this character decide" means for this character),
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
/** Pills count in the order they were picked: the first in full, each later one less than the one before. */
export const ORDER_WEIGHTS = Object.freeze([1, 0.75, 0.55, 0.4]);
export const STAY_TRUE_CAP = 0.1;

/**
 * traits:    additive shifts on 0-100 traits
 * suggest:   tactics answers this playstyle implies (first selected playstyle wins on conflicts)
 * behavior:  engine hooks; numbers are base chances per opportunity (scaled by intensity). kite: how much it minds
 *             ending its turn in a foe's reach, and keeps its distance (a Kiter; behavior/prepare.js). medic: heals
 *             earlier, keeps what heals for healing, bolsters before it attacks, gives friends its potions, keeps close
 *             (healing.js, targeting.js, support.js, prepare.js). dps: its most damaging option, spent freely, support
 *             and control less (targeting.js, support.js, healing.js). enable: bolsters and gives its friends an edge
 *             before it heals or attacks (support.js, targeting.js, prepare.js). hinders: how much it
 *             likes locking foes down, harassing and debuffing them (control actions count for up to 2.5 times more);
 *             trapWary: a trap avoider, how watchful (the share of the Trap avoiders luck it gets: Thief all of it, then
 *             Puzzle-Maniac, Skeptic, Lore-Collector, Chicken, Wallflower; behavior/traps.js); taunt: a taunter, its share
 *             of the Taunting setting (Tank all of it, then Instigator, Martyr, Brawler, Redeem-Seeker; behavior/goad.js);
 *             tauntProof: how readily it shrugs off any taunt (Relentless most, then Skeptic, Peacekeeper, Puzzle-Maniac,
 *             Diplomat, Chicken, Wallflower, Lazy; effects.js tauntProof)
 * patrol:    how it looks for a foe when it knows of none in the fight (behavior/patrol.js; the reasons are in
 *             CODING_README): "spread" (a patroller: out to 20 to 30 feet from its friends, searching as it goes),
 *             "near" (stays by its friends), "hold" (searches from where it stands), "hide" (keeps out of sight);
 *             none, as its nature has it
 * desire:    how the character picks up desires (see engine/behavior/desire.js), added up across its pills:
 *   hurt      points toward foes that suit it: nearest, far (two moves or more away), weakest, dangerous, casters,
 *             healers, downed, leader (theirs), weakness (foes its attacks exploit), unstudied (foes it hasn't sized
 *             up), current (the one it's on), slow (foes that can't follow it: held still, prone, slowed, slower than
 *             it, or struggling through the ground to get at it), softest (the foe its blows would hurt most)
 *   heal, protect, aid, talk   points toward healing hurt friends, guarding the weakest friend, bolstering a friend
 *             with a buff (its leader, for those who look to one; else whoever is doing the most fighting), talking
 *   bind, rob points toward tying up a fallen foe (a prisoner: behavior/fallen.js), and robbing one
 *   avoid     fear: of the most dangerous foe, of whoever is hurting it once it's hurt (attacker), of the nearest
 *   whim      a random foe now and then catches its eye
 *   focus     focus fire (behavior/focus.js): how much more it goes for the foes its team has already hit, added to what
 *             its Tactical gives it (0 to 1 in all), whatever its Tactical or its wits
 *   ×1 multipliers: retaliate (hitting back), avenge (a fallen friend's killer), cool (how fast the fight's grudges
 *             fade), frustration (how fast obstacles wear desires down), leader (how much it listens to its leader),
 *             doorPatience (how long it keeps at a locked door); contrarian: the chance it goes against its leader
 */
export const PLAYSTYLES = Object.freeze({
  // Afraid: of the most dangerous foe above all; gives up easily, hits back half-heartedly.
  chicken: { icon: "fa-ghost", traits: { brave: -30, selfish: 10 }, suggest: { retreat: "hurt", style: "ranged", potionThreshold: "75" }, behavior: { lowProfile: 0.3, flighty: 1, trapWary: 0.5, tauntProof: 0.35 }, patrol: "hide",
    desire: { avoid: { dangerous: 35 }, frustration: 1.5, retaliate: 0.5, rid: 15 } },
  // Picks on the weak and the fallen.
  cruel: { icon: "fa-skull-crossbones", traits: { selfish: 20, loyal: -5 }, suggest: { target: "weakest", beyond: "hunt", fallen: "finish" }, behavior: { finishDowned: 0.4, hinders: 0.25, shoves: 0.4 }, patrol: "spread",
    desire: { hurt: { weakest: 15, downed: 25 }, rob: 10, retaliate: 1.3, focus: 0.6 } },
  // Never the fallen; the weakest friend comes first.
  moralist: { icon: "fa-scale-balanced", traits: { selfish: -15, loyal: 10 }, suggest: { allyDying: "rescue", fallen: "spare" }, behavior: { spareDowned: 1, helps: 1 }, patrol: "near",
    desire: { hurt: { downed: -100 }, heal: 10, protect: 10, aid: 5, bind: 15, rob: -30, free: 15 } },
  // Does what the others want: its leader's wishes pull hard.
  peoplePleaser: { icon: "fa-face-smile", traits: { selfish: -20, loyal: 15 }, suggest: { healAggro: "aggressive", target: "protect", talk: "opportune" }, behavior: { followFocus: 0.5, helps: 1 }, patrol: "near",
    desire: { talk: 10, aid: 10, leader: 2, focus: 0.4 } },
  // Fine until hurt; then it wants to mend itself (mend: healing itself, once hurt) and get away from whoever is
  // hurting it. (Not a coward: that's the Chicken. It doesn't shift bravery.)
  fragile: { icon: "fa-heart-crack", traits: {}, suggest: { retreat: "hurt", potionThreshold: "75", selfRevived: "healSelf" }, behavior: { lowProfile: 0.2, flighty: 0.6 }, patrol: "hold",
    desire: { avoid: { attacker: 30 }, mend: 25, frustration: 1.3, rid: 15 } },
  // The nearest foe, now; no patience for obstacles (or locked doors).
  impatient: { icon: "fa-hourglass-end", traits: { tactical: -10 }, suggest: { resourceUse: "nova", target: "nearest", shield: "never" }, behavior: { rush: 0.5 }, patrol: "spread",
    desire: { hurt: { nearest: 15 }, bind: -15, rob: -10, frustration: 2, doorPatience: 0.5, rid: 10 } },
  // Up close and personal: the nearest foe, hits back hard, no talking.
  brawler: { icon: "fa-hand-fist", traits: { brave: 15, tactical: -5 }, suggest: { style: "frontline", target: "nearest", talk: "never" }, behavior: { meleeBias: 0.3, taunt: 0.4, shoves: 0.5 }, patrol: "spread",
    desire: { hurt: { nearest: 20 }, talk: -40, aid: -10, bind: -10, retaliate: 1.5, rid: -10 } },
  // Trusts its own judgment over anyone's, and isn't talked into things: an outsider's words (anyone not of its own
  // group) get a step further to go and up to 4 harder (wary, by the pill's place).
  skeptic: { icon: "fa-magnifying-glass", traits: { tactical: 10 }, suggest: { resourceUse: "conserve", healAggro: "conservative" }, behavior: { wary: 1, trapWary: 0.75, tauntProof: 0.6 },
    desire: { talk: -15, leader: 0.5, frustration: 0.8 } },
  // Wants to lead (whether or not it does: that's its group's chain of command): goes for the biggest threat, looks
  // after its people, and half ignores whoever commands it instead.
  // Not chosen, it may brood (ambition: a turn's chance, by the pill's place); with a treacherous streak (Cruel, Wildcard,
  // Mercenary, Instigator), it schemes against whoever leads instead (desire.js scheme).
  leader: { icon: "fa-flag", traits: { brave: 10, loyal: 10, tactical: 5 }, suggest: { target: "dangerous" }, behavior: { hinders: 0.15, ambition: 0.25, rally: 0.25 }, patrol: "spread",
    desire: { hurt: { dangerous: 10 }, protect: 10, aid: 10, talk: 5, bind: 10, free: 15, leader: 0.4, focus: 0.3 } },
  // Starts trouble and spoils everyone else's plans: locks foes down, harasses and debuffs them (more than anyone),
  // goes for the most dangerous foe and their leader, and may defy its own leader.
  instigator: { icon: "fa-fire", traits: { brave: 10, selfish: 5 }, suggest: { style: "frontline", target: "dangerous" }, behavior: { drawAggro: 0.35, initiative: 2, hinders: 1, taunt: 0.75, shoves: 0.3 }, patrol: "spread",
    desire: { hurt: { dangerous: 15, leader: 15 }, retaliate: 1.2, contrarian: 0.5 } },
  // Keeps the peace, between anyone (peacekeeping): everyone in a standoff with it loses patience half as fast, either
  // side; it calms any quarrel it sees; foes it talks round stand down (a truce, even mid-fight: never a surrender, a
  // payoff or a rout); it's trusted for it (its words 2 easier to accept) and never threatens; it spares the fallen.
  peacekeeper: { icon: "fa-hand-peace", traits: { selfish: -10, brave: 5 }, suggest: { talk: "first", allyDying: "rescue", fallen: "spare" }, behavior: { peacekeeping: 1, spareDowned: 1, tauntProof: 0.5 }, patrol: "near",
    desire: { talk: 20, protect: 10, hurt: { downed: -100 }, bind: 20, rob: -20, free: 10 } },
  // Talks first, and spares the fallen.
  diplomat: { icon: "fa-handshake", traits: { selfish: -10 }, suggest: { talk: "first", target: "dangerous", fallen: "tie" }, behavior: { parleyFirst: 0.6, spareDowned: 0.5, tauntProof: 0.35 }, patrol: "hold",
    desire: { talk: 30, hurt: { downed: -50 }, bind: 15 } },
  // Keeps its distance: strikes from where its foes can't answer and slips away again (a ranged one at the edge of its
  // first range increment, beyond a foe's move and reach; a melee one in, a blow, and out), would rather go for foes that
  // can't follow, falls back toward its friends, and minds ending its turn in reach far more than most (kite:
  // behavior/prepare.js). Cornered, it fights.
  kiter: { icon: "fa-person-running", traits: { tactical: 10 }, suggest: {}, behavior: { kite: 1 },
    desire: { hurt: { slow: 15 }, frustration: 0.8 } },
  // Keeps its distance and out of the crowd.
  wallflower: { icon: "fa-user-ninja", traits: { brave: -10 }, suggest: { style: "ranged" }, behavior: { lowProfile: 0.45, hinders: 0.25, flighty: 0.3, trapWary: 0.35, tauntProof: 0.3 }, patrol: "hide",
    desire: { hurt: { nearest: -10 }, avoid: { nearest: 15 } } },
  // Shields the weakest friend, avenges the fallen, fears nothing.
  martyr: { icon: "fa-cross", traits: { brave: 20, selfish: -30, loyal: 20 }, suggest: { allyDying: "rescue", retreat: "never", healAggro: "allCosts", style: "protector", target: "protect" }, behavior: { drawAggro: 0.3, helps: 1, rally: 0.2, taunt: 0.55 }, patrol: "near",
    desire: { protect: 25, heal: 15, aid: 5, rob: -10, free: 25, avenge: 2, avoid: { dangerous: -50, attacker: -50 }, rid: -25 } },
  // Stands in front and takes the blows: taunts foes off its friends (all of the Taunting setting, as its first pick),
  // draws attacks, guards the weakest friend, fears nothing, keeps its shield up, never retreats, and doesn't take
  // getting hit personally (it minds the blows it draws half as much: effects.js tauntGain).
  tank: { icon: "fa-shield-halved", traits: { brave: 20, selfish: -20, loyal: 10 }, suggest: { style: "protector", target: "protect", retreat: "never", shield: "always", allyDying: "rescue" }, behavior: { taunt: 1, drawAggro: 0.35, helps: 1 }, patrol: "spread",
    desire: { protect: 20, hurt: { dangerous: 10 }, avoid: { dangerous: -40, attacker: -40 }, free: 10, retaliate: 0.7, frustration: 0.7, rid: -15 } },
  // In it for itself: easy pickings, little loyalty, gives up when it gets hard.
  mercenary: { icon: "fa-coins", traits: { selfish: 30, loyal: -20 }, suggest: { retreat: "losing", resourceUse: "conserve", allyDying: "fight", fallen: "rob" }, behavior: { flighty: 0.6 },
    desire: { hurt: { weakest: 10 }, aid: -10, bind: 10, rob: 20, avenge: 0.3, frustration: 1.3, focus: 0.4 } },
  // Makes its friends better, in this order: bolsters them (its buffs before anything: enable), then gives them an edge
  // over their foes (Aid, a foe knocked down, grabbed, made off guard or shaken; a flank for a friend), then heals,
  // and hurts last. A dying friend still comes first, and with nothing to give it fights.
  enabler: { icon: "fa-hands-holding", traits: { selfish: -15, loyal: 10 }, suggest: { target: "protect" }, behavior: { followFocus: 0.3, helps: 1, enable: 1 }, patrol: "near",
    desire: { aid: 30, protect: 10, heal: 5, free: 15, leader: 1.3, focus: 0.3 } },
  // Heals first, and earlier than most (a friend at three quarters is reason enough: medic), the downed and dying
  // before anyone; keeps its healing for healing (no slot, focus or potion its heals use spent on a blow); bolsters its
  // friends when nobody needs mending; gives a friend its own potion; keeps close to its friends. It still fights
  // when nobody needs it.
  medic: { icon: "fa-kit-medical", traits: { selfish: -15, loyal: 10 }, suggest: { healAggro: "aggressive", allyDying: "rescue" }, behavior: { medic: 1, helps: 1 }, patrol: "near",
    desire: { heal: 30, aid: 10, protect: 5, free: 10, hurt: { downed: -20 } } },
  // Damage above all: its most damaging option every time, spending what it takes (slots, focus, consumables) until
  // it's gone, then the next; foes its blows hurt most (a weakness, a soft defense, off guard); flanking and hiding for
  // a sneak attack; support and control only when a friend is about to die. Impatient with talk (dps).
  dps: { icon: "fa-burst", traits: { brave: 5 }, suggest: { resourceUse: "nova", consumables: "freely", specialty: "some" }, behavior: { dps: 1 },
    desire: { hurt: { weakness: 15, softest: 15 }, aid: -10, bind: -15, rob: -10, talk: -10, frustration: 1.2 } },
  // Out to prove itself: takes on the biggest threat and won't quit.
  redeemSeeker: { icon: "fa-dove", traits: { brave: 15, selfish: -20 }, suggest: { allyDying: "rescue", retreat: "never", style: "frontline" }, behavior: { drawAggro: 0.15, helps: 1, taunt: 0.3 }, patrol: "spread",
    desire: { hurt: { dangerous: 20 }, protect: 10, bind: 10, rob: -15, free: 10, frustration: 0.6 } },
  // Curious: drawn to foes it hasn't sized up yet, and sizes them up before it deals with them (in a standoff, its
  // first turn most likely goes into watching the other side). It may tell its friends what it learned (more readily
  // leading its side, or as one who'd rather talk than fight).
  loreCollector: { icon: "fa-book-open", traits: { tactical: 5 }, suggest: { fallen: "tie" }, behavior: { study: 0.5, observe: 0.85, share: 0.9, trapWary: 0.6 }, patrol: "spread",
    desire: { hurt: { unstudied: 10 }, bind: 10, frustration: 0.8 } },
  // Loves a weakness to exploit (and a lock to crack).
  puzzleManiac: { icon: "fa-puzzle-piece", traits: { tactical: 15 }, suggest: { target: "casters", specialty: "some" }, behavior: { exploitWeakness: 0.5, hinders: 0.3, trapWary: 0.9, tauntProof: 0.4 }, patrol: "spread",
    desire: { hurt: { weakness: 20, casters: 10 }, frustration: 0.7, doorPatience: 2 } },
  // Unpredictable: something random catches its eye, nobody's voice counts for much, may defy its leader.
  wildcard: { icon: "fa-dice", traits: {}, suggest: {}, behavior: { random: 0.25 }, patrol: "spread",
    desire: { whim: 25, leader: 0.3, contrarian: 0.5 } },
  // Light fingers: a lock is an invitation.
  thief: { icon: "fa-mask", traits: { selfish: 10 }, suggest: { fallen: "rob" }, behavior: { steal: 1, trapWary: 1 },
    desire: { hurt: { weakest: 5 }, rob: 30, doorPatience: 1.5 } },
  // Never forgets: hits back twice as hard, avenges the fallen, and its grudges never cool.
  vengeful: { icon: "fa-bolt", traits: { brave: 5, selfish: 5 }, suggest: {}, behavior: {}, patrol: "spread",
    desire: { retaliate: 2, avenge: 2.5, cool: 0, rid: -5 } },
  // Single-minded: sticks with its target, shrugs off setbacks, keeps at a locked door, and doesn't care to hear an
  // outsider's reasons (a little wary).
  relentless: { icon: "fa-crosshairs", traits: { brave: 10 }, suggest: {}, behavior: { wary: 0.5, tauntProof: 0.75 }, patrol: "spread",
    desire: { hurt: { current: 15 }, frustration: 0.4, doorPatience: 1.5, rid: -15 } },
  // As little as it can get away with: whatever's nearest, no long walks, not much help for anyone, gives up fast,
  // and can't be bothered to hold a grudge; and now and then, with nobody on top of it, it just doesn't (slacks).
  lazy: { icon: "fa-couch", traits: { tactical: -5, brave: -5 }, suggest: { resourceUse: "conserve" }, behavior: { flighty: 0.4, tauntProof: 0.25, slacks: 0.15 }, patrol: "hold",
    desire: { hurt: { nearest: 15, far: -20 }, heal: -10, protect: -10, aid: -10, bind: -15, free: -10, frustration: 1.6, doorPatience: 0.4, cool: 1.5, rid: -10 } },

  // Un-Mundane: would rather use what sets it apart (its magic, its class's and kind's own abilities, a monster's
  // powers) than fight or talk as anyone would; spends what that takes freely; goes for the foes its powers find a weak
  // spot in. (It talks less only for want of a specialty that helps it talk: behavior/specialty.js talkDamping.)
  unmundane: { icon: "fa-wand-sparkles", traits: {}, suggest: { specialty: "strong", resourceUse: "nova" }, behavior: {},
    desire: { hurt: { weakness: 10 } } }
});

/** What a playstyle's `patrol` may say (behavior/patrol.js). */
export const PATROL_STYLES = Object.freeze(["spread", "near", "hold", "hide"]);

/**
 * How a character's pills say it patrols (behavior/patrol.js): each pill's `patrol` a vote as heavy as its place
 * (ORDER_WEIGHTS), the heaviest winning (a tie, the earlier pick's); null where none of them says.
 */
export function patrolStyle(ids = []) {
  const votes = new Map();
  for ( const [i, id] of currentPlaystyles(ids).slice(0, MAX_PLAYSTYLES).entries() ) {
    const how = PLAYSTYLES[id].patrol;
    if ( PATROL_STYLES.includes(how) ) votes.set(how, (votes.get(how) ?? 0) + ORDER_WEIGHTS[i]);
  }
  let best = null;
  for ( const [how, w] of votes ) if ( !best || w > best.w ) best = { how, w };
  return best?.how ?? null;
}

/** Desire keys that add up across pills, and those that multiply (a playstyle's ×1 is "no change"). */
const DESIRE_MULTIPLIERS = ["retaliate", "avenge", "cool", "frustration", "leader", "doorPatience"];

/** The combined desire guide of a character's pills (roleplay leans on it harder; staying true halves it). */
function combineDesires(chosen, { stayTrue, roleplay }) {
  const base = roleplay ? 1.5 : stayTrue ? 0.5 : 1;
  const out = { hurt: {}, avoid: {}, heal: 0, mend: 0, protect: 0, aid: 0, talk: 0, bind: 0, rob: 0, free: 0, rid: 0, whim: 0, focus: 0, contrarian: 0 };
  for ( const m of DESIRE_MULTIPLIERS ) out[m] = 1;
  for ( const [i, id] of chosen.entries() ) {
    const scale = base * ORDER_WEIGHTS[i];
    const d = PLAYSTYLES[id].desire ?? {};
    for ( const group of ["hurt", "avoid"] ) for ( const [k, v] of Object.entries(d[group] ?? {}) ) out[group][k] = (out[group][k] ?? 0) + v * scale;
    for ( const k of ["heal", "mend", "protect", "aid", "talk", "bind", "rob", "free", "rid", "whim", "focus"] ) out[k] += (d[k] ?? 0) * scale;
    for ( const m of DESIRE_MULTIPLIERS ) if ( d[m] !== undefined ) out[m] *= 1 + (d[m] - 1) * scale;
    if ( d.contrarian ) out.contrarian = Math.min(1, Math.max(out.contrarian, d.contrarian * scale));
  }
  for ( const m of DESIRE_MULTIPLIERS ) out[m] = Math.max(0, out[m]);
  return out;
}

export const PLAYSTYLE_IDS = Object.freeze(Object.keys(PLAYSTYLES));
/** Whether an id is a playstyle (its own key: never "constructor" and the like). */
export const isPlaystyle = id => typeof id === "string" && Object.hasOwn(PLAYSTYLES, id);
/** Playstyles renamed since, by their old ids: answers saved under an old id still count. */
export const RENAMED_PLAYSTYLES = Object.freeze({});

/** A playstyle id as it is now: a renamed one's new id (RENAMED_PLAYSTYLES), anything else as it was. */
export const currentPlaystyle = id => (typeof id === "string" && Object.hasOwn(RENAMED_PLAYSTYLES, id) ? RENAMED_PLAYSTYLES[id] : id);

/**
 * Playstyle ids read from anywhere they're kept (a character's flags, a helper's hints, a keyword file): each as it is
 * now, the ones that aren't playstyles dropped, each once, in their order.
 */
export const currentPlaystyles = ids => [...new Set((Array.isArray(ids) ? ids : []).map(currentPlaystyle).filter(isPlaystyle))];

/** A map by playstyle id (hints, keyword points) with renamed ids as they are now, their values added together. */
export function currentPlaystyleMap(map) {
  const out = {};
  for ( const [id, v] of Object.entries(map ?? {}) ) {
    const now = currentPlaystyle(id);
    if ( isPlaystyle(now) && Number.isFinite(Number(v)) ) out[now] = (out[now] ?? 0) + Number(v);
  }
  return out;
}

/** How strongly playstyles act: 1 normally, heavier for roleplay. */
export function intensity({ roleplay = false } = {}) {
  return roleplay ? 1.8 : 1;
}

/**
 * Aggregate a character's playstyles.
 * @param {string[]} ids
 * @param {{stayTrue?: boolean, roleplay?: boolean}} flags
 * @returns {{ids: string[], traits: object, suggest: object, mix: object, behavior: object, desire: object}}
 *   suggest: the most likely answer to each tactics question; mix: every pill's vote for it, by weight, so each
 *   simulated fight can draw one (the first pick most often, the later ones now and then)
 */
export function combinePlaystyles(ids = [], { stayTrue = false, roleplay = false, fits = null } = {}) {
  const chosen = ids.filter(isPlaystyle).slice(0, MAX_PLAYSTYLES);
  const k = intensity({ roleplay });
  const traits = {};
  const mix = {};
  const behavior = {};
  for ( const [i, id] of chosen.entries() ) {
    const p = PLAYSTYLES[id];
    const w = ORDER_WEIGHTS[i]; // the first pick counts most
    for ( const [t, v] of Object.entries(p.traits) ) traits[t] = (traits[t] ?? 0) + v * w * (roleplay ? 2 : 1);
    for ( const [key, v] of Object.entries(p.suggest) ) {
      // (Only an answer the character can follow: a Chicken with nothing to shoot doesn't keep its distance to shoot.)
      if ( fits && !fits(key, v) ) continue;
      const votes = mix[key] ??= [];
      const vote = votes.find(x => x.value === v);
      if ( vote ) vote.weight += w;
      else votes.push({ value: v, weight: w });
    }
    for ( const [b, v] of Object.entries(p.behavior) ) {
      const scaled = b === "initiative" ? v * k * w : clamp(v * k * w, 0, 1);
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
  // The most likely answer to each question (ties go to the earlier pick).
  const suggest = {};
  for ( const [key, votes] of Object.entries(mix) ) suggest[key] = votes.reduce((best, v) => (v.weight > best.weight ? v : best)).value;
  for ( const key of Object.keys(mix) ) if ( mix[key].length < 2 ) delete mix[key];
  return { ids: chosen, traits, suggest, mix, behavior, desire: combineDesires(chosen, { stayTrue, roleplay }) };
}

/**
 * How often each answer to a question left to the character comes up in a fight, as sampleRunTactics draws them: its
 * pills' votes by their place (or its one suggestion, or its calculated answer); and, staying true to the calculated
 * answer, any other only that much of the time (STAY_TRUE_CAP).
 * @param {string} key          the question
 * @param {*} calc              its calculated answer
 * @param {object} combined     combinePlaystyles' result
 * @param {boolean} [stayTrue]
 * @returns {[*, number][]}     [answer, chance], the likeliest first
 */
export function answerChances(key, calc, combined, stayTrue = false) {
  const suggested = combined?.suggest?.[key];
  const votes = combined?.mix?.[key] ?? [{ value: suggested !== undefined ? suggested : calc, weight: 1 }];
  const total = votes.reduce((s, v) => s + v.weight, 0) || 1;
  const out = new Map();
  const add = (value, p) => out.set(value, (out.get(value) ?? 0) + p);
  for ( const v of votes ) {
    const p = v.weight / total;
    if ( stayTrue && calc !== undefined && v.value !== calc ) {
      add(v.value, p * STAY_TRUE_CAP);
      add(calc, p * (1 - STAY_TRUE_CAP));
    } else add(v.value, p);
  }
  return [...out].sort((a, b) => b[1] - a[1]);
}

/**
 * Per-fight tactics for one combatant. Answers that differ from the calculated strategy apply with
 * probability 1, or only 10% of the time when the character stays true to their calculated tactics.
 * @param {object} spec   CombatantSpec with tactics / tacticsCalc / stayTrue
 * @param {object} rng
 */
export function sampleRunTactics(spec, rng) {
  if ( !spec.tactics ) return null;
  let tactics = spec.tactics;
  // Where its pills disagree, each one's answer gets its chance, in proportion to its place in the order.
  if ( spec.tacticsMix ) {
    tactics = { ...tactics };
    for ( const [key, votes] of Object.entries(spec.tacticsMix) ) {
      const total = votes.reduce((s, v) => s + v.weight, 0);
      let r = rng.next() * total;
      for ( const v of votes ) {
        r -= v.weight;
        if ( r <= 0 ) { tactics[key] = v.value; break; }
      }
    }
  }
  const out = {};
  for ( const [key, value] of Object.entries(tactics) ) {
    const calc = spec.tacticsCalc?.[key];
    out[key] = (!spec.stayTrue || calc === undefined || calc === value || rng.next() < STAY_TRUE_CAP) ? value : calc;
  }
  // The player party's say (its players' votes): in that share of fights, its answer to a question the character left
  // to itself.
  if ( spec.partyTactics && spec.partySway > 0 ) {
    for ( const [key, value] of Object.entries(spec.partyTactics) ) if ( rng.next() < spec.partySway ) out[key] = value;
  }
  return out;
}
