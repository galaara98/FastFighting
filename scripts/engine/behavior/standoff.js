/**
 * Standoffs: encounters that open with words instead of weapons.
 *
 * A standoff opens when every side's voice would rather talk (its leader, or most of its members when it has
 * none), or when almost everyone present would. Nobody attacks or advances while it lasts: talkers make their
 * pitches and everyone else holds. It ends one of two ways:
 *  - words win: the other side is persuaded to stand down (or threatened into yielding), and no blow is struck;
 *  - someone gets upset and attacks, and from that turn on it is a battle.
 *
 * Someone taking no side may come to blows with one of the sides meanwhile (behavior/neutral.js): the two fight it
 * out, and the standoff holds. The blood wears on everyone's patience, and whoever is hurt or insulted by one who
 * seems to be with the other side may blame that side (annoyed), and break it.
 *
 * What upsets people: an insulting pitch (a critical failure aimed at them), failed pitches piling up, rounds
 * dragging on, a quarrel beside the standoff, being unable to follow the talk at all (beasts, the mindless, no shared language), and an
 * impatient personality. A leader who wants to talk holds their side back; being half-persuaded calms anyone; a smart
 * creature (TACTICAL and up) won't wreck it unless its side is losing the talk.
 * Pure: no Foundry globals.
 */
import { TACTICAL, OPENING, NEUTRAL_PARTY, clamp } from "../../constants.js";
import { waiting } from "./bargain.js";
import { isStanding, areEnemies, liveTrait, liveTier, behaviorOf, typical, command, commandOf, wish, wishWins } from "../battle-state.js";
import { isNeutral, feud, annoyedBy } from "./neutral.js";

/** Tuning: chance per turn to lose patience, before personality. */
const BASE = 0.05;
const PER_ROUND = 0.03;   // every round of talk wears on everyone
const PER_REBUFF = 0.04;  // every failed pitch aimed at this creature
const CANT_FOLLOW = 0.35; // a beast, or anyone who shares no language with the talk
const FRAY = 0.04;        // every blow struck in a quarrel beside the standoff
const FRAY_MAX = 0.2;
const MAX_CHANCE = 0.85;
const UNMET = 0.25;       // every turn (or failed haggle) it has waited on what it expects, up to 4
/**
 * Only an argument: what would break a standoff collapses the talks this often (insults, impatience, blame): with no
 * blows to come to, it falls apart somewhat less often than a standoff that could come to blows.
 */
const ARGUMENT_BREAKS = 0.75;

/** Playstyles that make someone quicker (above 1) or slower (below 1) to lose patience. */
const TEMPER = { impatient: 2.5, cruel: 2, instigator: 2, brawler: 1.8, speedRunner: 1.5, moralist: 0.6, chicken: 0.5, peoplePleaser: 0.5, diplomat: 0.3, peacekeeper: 0.3 };

/** Can this creature take part in a conversation at all? */
export function canTalk(u) {
  const s = u.spec.social;
  return !!s && !s.mindless && (s.languages?.length ?? 0) > 0;
}

/** Would this creature rather settle things with words? Its own answer wins; otherwise its knack for it. */
export function prefersTalk(u) {
  if ( !canTalk(u) ) return false;
  if ( wish(u.spec.alwaysTalk) >= 1 ) return true; // "always talk unless I'm being hurt": a vote for words, always
  const answer = u.tac?.talk;
  if ( answer === "never" ) return false;
  if ( answer === "first" ) return true;
  return (u.prep.talkAffinity ?? 0) >= 0.6 || !!behaviorOf(u).parleyFirst;
}

/** Present and visible: hidden ambushers aren't part of the conversation. */
const present = u => isStanding(u) && !(u.spec.hidden && !u.revealed);
/** Present, and on one of the sides at odds (those who take no side don't open or hold up a standoff). */
const party = u => present(u) && u.side !== NEUTRAL_PARTY && !u.spec.hazard; // (a hazard has no say)

/**
 * Does this fight open as a standoff?
 * @param {object} run
 * @returns {boolean}
 */
export function opensWithTalk(run) {
  const o = run.prep.options;
  if ( o.opening === OPENING.ARGUMENT ) return true; // (only an argument: talk, whatever else)
  if ( !o.talking || o.opening === OPENING.FIGHT ) return false;
  if ( o.opening === OPENING.TALK ) return true;
  if ( o.surpriseSide ) return false; // an ambush is not a conversation
  const here = run.units.filter(party);
  const sides = [...new Set(here.map(u => u.side))];
  if ( sides.length < 2 ) return false;
  // Each side's voice: its leader if it has one here, otherwise the majority of its members.
  const voices = sides.map(side => {
    const members = here.filter(u => u.side === side);
    const head = command(run, side)?.unit;
    const leader = head && members.includes(head) ? head : null;
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

  // A Peacekeeper there holds everyone back, whichever side they're on (by how much of one it is).
  let keeper = 0;
  for ( const o of run.units ) if ( o !== u && present(o) ) keeper = Math.max(keeper, behaviorOf(o).peacekeeping ?? 0);
  if ( keeper > 0 ) p *= 1 - 0.5 * keeper;

  // Waiting on what it expects, with nothing meeting it, wears on it (the longer, the more).
  if ( waiting(u) ) p *= 1 + UNMET * Math.min(4, u.unmet);
  // Talk that goes nowhere wears on everyone; pitches that fail on you wear on you most.
  const rebuffs = [...u.rebuffed.values()].reduce((s, n) => s + n, 0);
  p += PER_ROUND * Math.max(0, run.round - since) + PER_REBUFF * rebuffs;
  // Blood spilled beside the standoff (someone taking no side, fighting one of the sides) frays everyone's nerves.
  if ( run.standoff ) p += Math.min(FRAY_MAX, FRAY * (run.fray ?? 0));

  // A smart creature doesn't wreck a standoff its side is in, unless the talk is going against its side anyway; then
  // it would rather strike first (and being half-persuaded doesn't calm it: it sees where this is going).
  const smart = u.side !== NEUTRAL_PARTY && liveTier(run, u) >= TACTICAL.TACTICAL;
  const losing = smart && losingTalk(run, u.side);
  if ( smart ) p *= losing ? 1.5 : 0.25;

  // Half-persuaded people calm down; a leader who wants to talk holds their side back.
  const progress = Math.max(0, ...u.sway.values());
  if ( !losing ) p *= Math.max(0.2, 1 - 0.25 * progress);
  // (A boss who'd rather talk holds its side back harder.)
  const cmd = commandOf(run, u);
  if ( cmd && cmd.unit !== u && prefersTalk(cmd.unit) && canTalk(u) ) p *= cmd.boss ? 0.2 : 0.4;
  const master = run.byId.get(u.spec.flags?.masterId);
  if ( master && isStanding(master) && prefersTalk(master) ) p *= 0.3; // a companion waits on its master
  return clamp(p, 0, MAX_CHANCE);
}

/**
 * Does u (on one of the standoff's sides) break the standoff on its turn? Returns why ("insulted", "annoyed": blaming
 * the other side for what someone who seems to be with them did, "unmet": tired of waiting on what it expects,
 * "impatient", or "beast" for a creature that can't follow the talk), or null to keep talking. Only an argument: less
 * often (ARGUMENT_BREAKS).
 */
export function breaksStandoff(run, u, say = () => {}) {
  const cause = breakCause(run, u, say);
  if ( !cause || run.prep.options.opening !== OPENING.ARGUMENT ) return cause;
  return run.rng.chance(ARGUMENT_BREAKS) ? cause : null;
}

function breakCause(run, u, say) {
  const argument = run.prep.options.opening === OPENING.ARGUMENT;
  if ( !run.units.some(o => party(o) && areEnemies(run, u, o)) ) return null;
  // Insults are answered at once, more often than not: one from someone taking no side starts a quarrel with it (the
  // standoff holds, unless u blames the other side for it); one from the other side ends the standoff.
  if ( u.offendedBy.size > (u.insultsAnswered ?? 0) ) {
    const fresh = [...u.offendedBy].slice(u.insultsAnswered ?? 0).map(id => run.byId.get(id)).filter(Boolean);
    u.insultsAnswered = u.offendedBy.size;
    for ( const n of fresh.filter(isNeutral) ) {
      // (Only an argument: a quarrel would end the talks, so somewhat less often.)
      if ( !run.rng.chance(argument ? 0.7 * ARGUMENT_BREAKS : 0.7) ) continue;
      feud(run, u, n, say);
      annoyedBy(run, u, n);
    }
    if ( fresh.some(o => !isNeutral(o)) && run.rng.chance(0.7) ) return "insulted";
  }
  if ( u.annoyed ) {
    u.annoyed = null;
    return "annoyed";
  }
  if ( !run.rng.chance(impatience(run, u)) ) return null;
  return !canTalk(u) ? "beast" : waiting(u) ? "unmet" : "impatient";
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
  const leader = command(run, side)?.unit;
  if ( !leader || leader.spec.kind === "pc" || !isStanding(leader) || !canTalk(leader) ) return null;
  const best = Math.max(...Object.values(leader.spec.social?.pitches ?? {}).map(p => p?.mod ?? -99));
  const edge = best - typical(run.prep.rules, "skill", leader.spec.level ?? 0);
  return edge >= 2 ? { leader, edge } : null;
}

/** How many pitches u makes on a standoff turn: talkers press their case, others chime in. */
export function standoffPitches(run, u, actions) {
  if ( !run.prep.options.talking || !canTalk(u) || u.tac?.talk === "never" ) return 0;
  // (Its whole turn: as likely as its answer leans to always talking.)
  if ( !u.spec.stayTrue && wishWins(run, u.spec.alwaysTalk) ) return actions;
  if ( prefersTalk(u) ) return Math.min(2, actions);
  return (u.prep.talkAffinity ?? 0) > 0 ? Math.min(1, actions) : 0;
}
