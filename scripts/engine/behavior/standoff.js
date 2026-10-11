/**
 * Standoffs: encounters that open with words instead of weapons.
 *
 * A standoff opens when every side's voice would rather talk (its leader, or most of its members when it has
 * none), or when almost everyone present would. Nobody attacks or advances while it lasts: talkers make their
 * pitches and everyone else holds. It ends one of two ways:
 *  - words win: the other side is persuaded to stand down (or threatened into yielding), and no blow is struck;
 *  - someone gets upset and attacks, and from that turn on it is a battle.
 *
 * What upsets people: an insulting pitch (a critical failure aimed at them), failed pitches piling up, rounds
 * dragging on, being unable to follow the talk at all (beasts, the mindless, no shared language), and an
 * impatient personality. A leader who wants to talk holds their side back; being half-persuaded calms anyone; a smart
 * creature (TACTICAL and up) won't wreck it unless its side is losing the talk.
 * Pure: no Foundry globals.
 */
import { TACTICAL, OPENING, NEUTRAL_PARTY, clamp } from "../../constants.js";
import { isStanding, areEnemies, liveTrait, liveTier, behaviorOf, typical } from "../battle-state.js";

/** Tuning: chance per turn to lose patience, before personality. */
const BASE = 0.05;
const PER_ROUND = 0.03;   // every round of talk wears on everyone
const PER_REBUFF = 0.04;  // every failed pitch aimed at this creature
const CANT_FOLLOW = 0.35; // a beast, or anyone who shares no language with the talk
const MAX_CHANCE = 0.85;

/** Playstyles that make someone quicker (above 1) or slower (below 1) to lose patience. */
const TEMPER = { impatient: 2.5, cruel: 2, instigator: 2, brawler: 1.8, speedRunner: 1.5, moralist: 0.6, chicken: 0.5, peoplePleaser: 0.5, diplomat: 0.3 };

/** Can this creature take part in a conversation at all? */
export function canTalk(u) {
  const s = u.spec.social;
  return !!s && !s.mindless && (s.languages?.length ?? 0) > 0;
}

/** Would this creature rather settle things with words? Its own answer wins; otherwise its knack for it. */
export function prefersTalk(u) {
  if ( !canTalk(u) ) return false;
  if ( u.spec.alwaysTalk ) return true; // "always prefers talking to fighting": a vote for words, always
  const answer = u.tac?.talk;
  if ( answer === "never" ) return false;
  if ( answer === "first" ) return true;
  return (u.prep.talkAffinity ?? 0) >= 0.6 || !!behaviorOf(u).parleyFirst;
}

/** Present and visible: hidden ambushers aren't part of the conversation. */
const present = u => isStanding(u) && !(u.spec.hidden && !u.revealed);
/** Present, and on one of the sides at odds (those who take no side don't open or hold up a standoff). */
const party = u => present(u) && u.side !== NEUTRAL_PARTY;

/**
 * Does this fight open as a standoff?
 * @param {object} run
 * @returns {boolean}
 */
export function opensWithTalk(run) {
  const o = run.prep.options;
  if ( !o.talking || o.opening === OPENING.FIGHT ) return false;
  if ( o.opening === OPENING.TALK ) return true;
  if ( o.surpriseSide ) return false; // an ambush is not a conversation
  const here = run.units.filter(party);
  const sides = [...new Set(here.map(u => u.side))];
  if ( sides.length < 2 ) return false;
  // Each side's voice: its leader if it has one here, otherwise the majority of its members.
  const voices = sides.map(side => {
    const members = here.filter(u => u.side === side);
    const leader = members.find(u => u.id === run.prep.sides[side]?.leaderId);
    return leader ? prefersTalk(leader) : members.filter(prefersTalk).length > members.length / 2;
  });
  const share = here.filter(prefersTalk).length / here.length;
  return voices.every(Boolean) || share >= 0.75;
}

/** Chance that u loses patience this turn (the talk began in round `since`). */
export function impatience(run, u, since = 1) {
  const talker = prefersTalk(u);
  let p = canTalk(u) ? BASE : CANT_FOLLOW;
  if ( talker ) p *= 0.3;
  if ( u.tac?.talk === "never" ) p *= 4;
  p *= 1 + (liveTrait(run, u, "brave") - 50) / 100;   // the bold strike first
  p *= 1 + (liveTrait(run, u, "selfish") - 50) / 150;
  if ( liveTier(run, u) <= TACTICAL.FERAL ) p *= 2;
  for ( const id of u.spec.playstyles ?? [] ) p *= TEMPER[id] ?? 1;

  // Talk that goes nowhere wears on everyone; pitches that fail on you wear on you most.
  const rebuffs = [...u.rebuffed.values()].reduce((s, n) => s + n, 0);
  p += PER_ROUND * Math.max(0, run.round - since) + PER_REBUFF * rebuffs;

  // A smart creature doesn't wreck a standoff its side is in, unless the talk is going against its side anyway; then
  // it would rather strike first (and being half-persuaded doesn't calm it: it sees where this is going).
  const smart = u.side !== NEUTRAL_PARTY && liveTier(run, u) >= TACTICAL.TACTICAL;
  const losing = smart && losingTalk(run, u.side);
  if ( smart ) p *= losing ? 1.5 : 0.25;

  // Half-persuaded people calm down; a leader who wants to talk holds their side back.
  const progress = Math.max(0, ...u.sway.values());
  if ( !losing ) p *= Math.max(0.2, 1 - 0.25 * progress);
  const leader = run.byId.get(run.prep.sides[u.side]?.leaderId);
  if ( leader && leader !== u && isStanding(leader) && prefersTalk(leader) && canTalk(u) ) p *= 0.4;
  const master = run.byId.get(u.spec.flags?.masterId);
  if ( master && isStanding(master) && prefersTalk(master) ) p *= 0.3; // a companion waits on its master
  return clamp(p, 0, MAX_CHANCE);
}

/**
 * Does u break the standoff on its turn? Returns why ("insulted", "impatient", or "beast" for a creature that
 * can't follow the talk), or null to keep talking.
 */
export function breaksStandoff(run, u) {
  if ( !run.units.some(o => present(o) && areEnemies(run, u, o)) ) return null;
  // An insult is answered at once, more often than not.
  if ( u.offendedBy.size > (u.insultsAnswered ?? 0) ) {
    u.insultsAnswered = u.offendedBy.size;
    if ( run.rng.chance(0.7) ) return "insulted";
  }
  if ( !run.rng.chance(impatience(run, u)) ) return null;
  return canTalk(u) ? "impatient" : "beast";
}

/**
 * Is `side` losing the talk: are the others further toward talking its members down than it is toward theirs?
 */
export function losingTalk(run, side) {
  let ours = 0;
  let theirs = 0;
  for ( const o of run.units ) {
    if ( !isStanding(o) ) continue;
    if ( o.side === side ) {
      for ( const [s, n] of o.sway ) if ( s !== side ) theirs += n;
    } else if ( run.prep.sides[side]?.enemies.has(o.side) ) ours += o.sway.get(side) ?? 0;
  }
  return theirs > ours + 1;
}

/** A side's leader who isn't a PC and has a way with words: may take the last word before a standoff breaks. */
export function charismaticLeader(run, side) {
  const leader = run.byId.get(run.prep.sides[side]?.leaderId);
  if ( !leader || leader.spec.kind === "pc" || !isStanding(leader) || !canTalk(leader) ) return null;
  const best = Math.max(...Object.values(leader.spec.social?.pitches ?? {}).map(p => p?.mod ?? -99));
  const edge = best - typical(run.prep.rules, "skill", leader.spec.level ?? 0);
  return edge >= 2 ? { leader, edge } : null;
}

/** How many pitches u makes on a standoff turn: talkers press their case, others chime in. */
export function standoffPitches(run, u, actions) {
  if ( !run.prep.options.talking || !canTalk(u) || u.tac?.talk === "never" ) return 0;
  if ( u.spec.alwaysTalk && !u.spec.stayTrue ) return actions;
  if ( prefersTalk(u) ) return Math.min(2, actions);
  return (u.prep.talkAffinity ?? 0) > 0 ? Math.min(1, actions) : 0;
}
