/**
 * Talking resolution: de-escalate a fight at any point.
 *
 * A talker spends an action on a pitch at one enemy that shares a language with them. There are three kinds of
 * pitch, and each system says which skill makes them and which DC resists them (PF2e: Diplomacy, Intimidation and
 * Deception against Will or Perception DCs; 5e: Persuasion, Intimidation and Deception against Insight):
 *   persuade    reason, bargain, appeal
 *   intimidate  threaten (works better on the outnumbered; the brave resist it)
 *   deceive     bluff (backfires harder when it fails) Each success moves that enemy along a persuasion track; it takes several steps to
 * convince someone (2-6), unless they are very gullible (1). When the track fills, the enemy surrenders, flees,
 * stands down, or (rarely, unless they were neutral) changes sides. An enemy changing sides only stands aside (it
 * takes no side now), and only on a d100 at or under the switch luck; otherwise it's talked into one of the others.
 *
 * Those who take no side (behavior/neutral.js) are talked to as well: won over to join the talker's side (no luck
 * check; easier when joining gives them what they want, harder when it betrays it, and never by a side they've seen
 * cross them), talked round when they're confronting the talker's side, or, when they're the ones confronting
 * someone, talking that someone into making amends.
 * Player characters decide their own fate, so words can only scare a PC into backing off and running; a PC who would
 * rather let weapons do the talking won't listen at all. In a standoff, one talked into running ends the whole
 * conflict, and everyone walks away. Convincing a leader can make the rest of their side stand down.
 *
 * Grudges matter: anyone the talker has hurt, or has failed to convince before, is much harder to sway,
 * and a critical failure means that enemy will not listen to that talker again.
 *
 * Who talks:
 *  - Talkers (strong social skills, or Diplomat / People-Pleaser playstyles, heading their group, or a "talk first"
 *    answer) always get a chance to start swaying on their first turn.
 *  - Characters who are not very battle-worthy may spend two actions talking instead of attacking.
 *  - Anyone else may make one quip per turn when it looks promising and they would.
 * Pure: no Foundry globals.
 */
import { STATUS, SWAY, CONCEDE_LUCK, SWITCH_LUCK, TRAITOR_LUCK, TACTICAL, OPENING, clamp } from "../../constants.js";
import { alliesOf, enemiesOf, isStanding, behaviorOf, typical, checkRoll, liveTier, studyBonus, boostBonus, chainOf, commandOf, groupKeyOf, wish, wishWins, edgeDistance, areEnemies, systemRolled, hpFraction, dangerScore } from "../battle-state.js";
import { spendEdges, spendBoost } from "./effects.js";
import { degreeDistribution, rollCheck } from "../probability.js";
import { isNeutral, standsAside, appeal, offend, turnOn, standAside, joinSide, calm, settleTruce, seemsFoe, leanSide, fighting } from "./neutral.js";
import { shareLanguage, talksFirstAnswer } from "./standoff.js";
import { levelOf, allDesires } from "./desire.js";
import { perceives } from "./senses.js";
import { standsGround, callRetreat } from "./morale.js";
import { talkDamping } from "./specialty.js";
import { strain } from "./strain.js";
import { mayLeave, startLeaving, confronted } from "./leaving.js";

/** Only an argument: nobody runs. Talked round, a creature backs down (where it would run or yield). */
const arguing = run => run.prep.options.opening === OPENING.ARGUMENT;

/** The three kinds of pitch. Systems map their own skills onto these (CombatantSpec.social.pitches). */
export const TALK_KINDS = Object.freeze(["persuade", "intimidate", "deceive"]);

/**
 * What talking to t is for: "down" (an enemy: talk it out of the fight), "recruit" (someone taking no side: win it
 * over), "dismiss" (someone taking no side: talk it into leaving, for those who don't like killing and would rather
 * see it gone: behavior/neutral.js peaceDesires), "calm" (someone taking no side who's confronting the talker's
 * side: talk it round), or "settle" (the talker takes no side and is confronting t's side: have it make amends). One
 * calming a fight (talker.calming) talks the fighters into letting it be ("pacify": someone taking no side, out of its
 * quarrel; anyone in a standoff, into leaving the quarrel alone) or, once it's a fight, into leaving.
 */
export function aimOf(talker, t) {
  if ( talker.calming ) {
    if ( isNeutral(t) && t.against.size ) return "pacify";
    if ( !isNeutral(t) ) return talker.calming;
  }
  if ( isNeutral(talker) && talker.truce?.side === t.side && !talker.against.has(t.side) ) return "settle";
  if ( isNeutral(t) && !t.against.has(talker.side) ) {
    if ( t.truce?.side === talker.side ) return "calm";
    return talker.peace?.targetId === t.id && talker.peace.aim === "dismiss" ? "dismiss" : "recruit";
  }
  return "down";
}

/** Who a talker might talk to: its enemies, and those who take no side that it could win over or talk round. */
function pitchTargets(run, talker) {
  // Calming a fight: whoever is in it, on either side.
  if ( talker.calming ) return run.units.filter(o => o !== talker && fighting(run, o));
  const out = enemiesOf(run, talker);
  if ( !run.neutral ) return out;
  if ( isNeutral(talker) ) {
    if ( talker.truce ) for ( const o of run.units ) if ( o.side === talker.truce.side && !out.includes(o) ) out.push(o);
    // Leaning toward a side, it may talk that side's enemies out of the fight (it wants its friends safe).
    for ( const o of opposedToLean(run, talker) ) if ( !out.includes(o) ) out.push(o);
    return out;
  }
  const knows = liveTier(run, talker) >= TACTICAL.TACTICAL;
  const wordsFirst = talksFirst(talker);
  for ( const n of run.units ) {
    if ( !isNeutral(n) || n.against.has(talker.side) ) continue;
    // Confronting the talker's side: anyone there can try to talk it round.
    if ( n.truce?.side === talker.side ) {
      out.push(n);
      continue;
    }
    // Won over only by a side it hasn't seen cross it (and player characters decide that for themselves).
    if ( n.crossedBy.has(talker.side) || n.spec.kind === "pc" ) continue;
    // Only a tactical talker knows it could be won over. Anyone else tries when it wants to talk to it, or when it
    // takes it for a foe and always tries words before blows (and may win it over by accident).
    if ( knows || levelOf(talker, "talk", n.id) >= 20 || (wordsFirst && seemsFoe(run, talker, n)) ) out.push(n);
  }
  return out;
}

/**
 * Those at odds with the side a neutral leans toward (hostiles, for one leaning toward the party; the party, for one
 * leaning toward its enemies): the ones it may talk out of the fight. None without a lean.
 */
export function opposedToLean(run, n) {
  const favored = isNeutral(n) && (n.leanLevel ?? 1) > 0 ? leanSide(run, n) : null;
  const sides = favored ? run.prep.sides[favored]?.enemies : null;
  return sides?.size ? run.units.filter(o => !isNeutral(o) && sides.has(o.side)) : [];
}

/** Always tries words before blows: "always prefers talking", a "talk first" answer, or a playstyle like the Diplomat. */
const talksFirst = u => wish(u.spec.alwaysTalk) >= 0.66 || talksFirstAnswer(u.tac?.talk) || !!behaviorOf(u).parleyFirst;

export { shareLanguage };

/**
 * What t still has to hand over (or have taken), after anything already lost this fight. (Money its side pools: after
 * what any of them paid.)
 */
export function remaining(t) {
  const v = t.spec.valuables ?? {};
  const given = (t.concessions ?? []).filter(c => !c.kept);
  const paid = (t.pool ?? [t]).flatMap(o => o.concessions ?? []).filter(c => !c.kept && c.kind === "money");
  // (What came out of its team's purse, not its own: concession.purse.)
  const spent = paid.reduce((s, c) => s + c.amount - (c.purseKey ? Number(c.purse) || 0 : 0), 0);
  // (Of a stack, as many as went: count, one if it doesn't say. The rest are still there.)
  const gone = new Map();
  for ( const c of given ) if ( c.kind === "item" ) gone.set(c.item.id, (gone.get(c.item.id) ?? 0) + (c.count ?? 1));
  const left = list => (list ?? []).flatMap(i => {
    const n = (i.quantity ?? 1) - (gone.get(i.id) ?? 0);
    return n <= 0 ? [] : [i.quantity === undefined || n === i.quantity ? i : { ...i, quantity: n }];
  });
  const own = Math.max(0, (v.money ?? 0) - spent);
  const purse = purseLeft(t);
  return {
    money: own + purse,
    own,
    purse,
    denominations: v.denominations ?? null,
    stowed: left(v.stowed),
    wielded: left(v.wielded)
  };
}

/** What's left of t's team's purse (the GM's, shared: battle-state.js createRun): its money, less all its members drew. */
export function purseLeft(t) {
  const p = t.purse;
  if ( !p ) return 0;
  let drawn = 0;
  for ( const o of p.members ) for ( const c of o.concessions ?? [] ) if ( !c.kept && c.purseKey === p.key ) drawn += Number(c.purse) || 0;
  return Math.max(0, p.money - drawn);
}

/** Something to hand over: money, an item carried but not wielded or worn, or ground to give (progress on its track). */
export function hasValuables(t) {
  const v = remaining(t);
  return v.money > 0 || v.stowed.length > 0 || t.spec.valuables?.progress > 0;
}

/**
 * Can this unit be talked out of the fight at all? PCs decide their own fate: words can only scare a PC into
 * backing off, and only if they're willing to listen.
 */
export function swayable(t) {
  if ( !isStanding(t) ) return false;
  if ( t.spec.hidden && !t.revealed ) return false; // you can't talk to an ambusher you haven't spotted
  const s = t.spec.social;
  if ( !s || s.mindless || !((s.languages?.length ?? 0) > 0) ) return false;
  if ( t.spec.kind === "pc" ) return t.tac?.talk !== "never";
  return true;
}

/** Not of t's own group (a side; a neutral friend group): someone whose words a wary creature (a Skeptic) distrusts. */
const outsider = (talker, t) => { const g = groupKeyOf(talker); return g === null || g !== groupKeyOf(t); };

/**
 * The foes standing against t that it knows of, for whether it's outnumbered: those in its senses, and any it has come
 * to blows with. (A third side it can't see, busy with others, doesn't press on it.)
 */
export const foesKnown = (run, t) => enemiesOf(run, t).filter(o => isStanding(o) && (perceives(run, t, o) || t.harmedBy.has(o.id) || o.harmedBy.has(t.id)));

/**
 * Has `talker` already won t over a step this turn of its own? One step a turn, from each talker: a second pitch at it
 * in the same turn gains nothing more (a critical success still counts twice).
 */
export const movedThisTurn = (t, talker) => t.swayTurn?.get(talker.id) === talker.turnsTaken;

/**
 * Successful pitches needed to convince t (2-6, or 1 if very gullible). With `run`, the situation counts:
 * a badly hurt or outnumbered enemy is one step easier to talk down.
 */
export function stepsToConvince(t, run = null, talker = null) {
  const s = t.spec.social ?? {};
  // (A system's own number: Ironsworn's, by the encounter's rank, as the fight has left it.)
  const fixed = t.convinceSteps ?? s.steps;
  if ( Number.isFinite(fixed) ) return Math.max(1, Math.round(fixed));
  // How strong-willed it is compared with a typical creature of its level (the system works that out).
  const delta = s.resolve ?? 0;
  const loyal = t.prep.traits.loyal;
  const brave = t.prep.traits.brave;
  const selfish = t.prep.traits.selfish;
  if ( s.gullible || delta <= -5 ) return 1; // VERY gullible
  let steps = 3;
  if ( delta >= 3 ) steps += 1;
  if ( delta <= -3 ) steps -= 1;
  if ( loyal >= 70 ) steps += 1;
  if ( brave >= 80 ) steps += 1;
  if ( selfish >= 70 ) steps -= 1;
  if ( t.spec.flags?.fearless ) steps += 1;
  if ( standsAside(t) ) steps -= 1;
  if ( t.spec.kind === "pc" ) steps += 2; // a player character does not fold easily
  if ( t.scheming ) steps -= 2; // (scheming against its own leaders: half way there already)
  // Wary of outsiders' words (a Skeptic): a step more for anyone not of its own group.
  if ( talker && (behaviorOf(t).wary ?? 0) >= 0.5 && outsider(talker, t) ) steps += 1;
  // Letting a quarrel be is a smaller thing to ask than giving up the fight.
  const aim = talker ? aimOf(talker, t) : null;
  if ( aim === "pacify" ) steps -= 1;
  // Winning someone over: a step quicker if joining gives it something it wants, slower if it betrays it.
  if ( run && aim === "recruit" ) {
    const { fulfils, betrays } = appeal(run, t, talker.side);
    if ( (fulfils?.level ?? 0) >= 40 ) steps -= 1;
    if ( (betrays?.level ?? 0) >= 40 ) steps += 1;
    if ( (betrays?.level ?? 0) >= 70 ) steps += 1;
  }
  if ( run ) {
    if ( t.maxHp > 0 && t.hp / t.maxHp < 0.5 ) steps -= 1;
    else if ( foesKnown(run, t).length > alliesOf(run, t).filter(isStanding).length ) steps -= 1;
  }
  return clamp(steps, 2, t.spec.kind === "pc" ? 8 : 6);
}

/**
 * The DC t sets against `talker` for one kind of pitch, including grudges and circumstances. (`shared`: what doesn't
 * depend on the kind, talkDCShared, worked out once for all three.)
 */
export function talkDC(run, talker, t, kind, shared = talkDCShared(run, talker, t)) {
  const s = t.spec.social ?? {};
  let dc = s.resist?.[kind]?.dc ?? typical(run.prep.rules, "dc", t.spec.level ?? 0);
  dc += shared.dc;
  if ( shared.outnumbered ) dc -= kind === "intimidate" ? 3 : 2;
  if ( kind === "intimidate" ) dc += shared.bold;
  if ( shared.aside ) dc -= kind === "persuade" ? 4 : 2;
  return dc;
}

/**
 * What t's DC against `talker` comes to whatever the kind of pitch: grudges, circumstances, personality, what the talk
 * is for. And what the kind changes: outnumbered (threats work better), its boldness (against threats), standing aside.
 */
function talkDCShared(run, talker, t) {
  let dc = 0;
  // Grudges: harm done by this talker, earlier failures, harm to their friends.
  const harm = t.harmedBy.get(talker.id) ?? 0;
  if ( harm > 0 ) dc += 5 + Math.round(10 * Math.min(1, harm / Math.max(1, t.maxHp)));
  dc += 3 * (t.rebuffed.get(talker.id) ?? 0);
  for ( const ally of alliesOf(run, t) ) {
    if ( ally !== t && (ally.harmedBy.get(talker.id) ?? 0) > 0 ) dc += 1;
  }

  // Circumstances: wounds, wavering, being outnumbered, a fallen leader.
  const frac = t.maxHp > 0 ? t.hp / t.maxHp : 1;
  if ( frac < 0.25 ) dc -= 4;
  else if ( frac < 0.5 ) dc -= 2;
  if ( t.wavering ) dc -= 2;
  const theirs = alliesOf(run, t).filter(isStanding).length;
  const ours = foesKnown(run, t).length;
  // (Its leaders all down, or none of them able to lead: nobody holding it together.)
  if ( chainOf(run, groupKeyOf(t))?.length && !commandOf(run, t) ) dc -= 2;

  // Personality: loyal and brave hold out, selfish take a deal; neutrals are easy to talk to.
  dc += Math.round((t.prep.traits.loyal - 50) / 25) - Math.round((t.prep.traits.selfish - 50) / 25);
  if ( t.scheming ) dc -= 4; // (it's looking for a way out from under its leaders)
  // A Peacekeeper's word is trusted: up to 2 easier.
  const keeper = behaviorOf(talker).peacekeeping ?? 0;
  if ( keeper > 0 ) dc -= Math.round(2 * keeper);
  // Wary of outsiders' words (a Skeptic): up to 4 harder, by how much of a Skeptic it is.
  const wary = behaviorOf(t).wary ?? 0;
  if ( wary > 0 && outsider(talker, t) ) dc += Math.round(4 * wary);
  const aim = aimOf(talker, t);
  // Winning someone over: what joining would mean to it, by what it wants.
  if ( aim === "recruit" ) {
    const { fulfils, betrays } = appeal(run, t, talker.side);
    dc += Math.round((betrays?.level ?? 0) / 10) - Math.round((fulfils?.level ?? 0) / 10);
  }
  // Talking it into leaving: the more it cares about someone still here, and the bolder it is, the harder.
  if ( aim === "dismiss" ) {
    const care = Math.max(0, ...allDesires(t).filter(d => d.kind !== "hurt" && d.kind !== "avoid" && run.byId.get(d.targetId)?.status === STATUS.STANDING).map(d => d.level));
    dc += Math.round(care / 10) + Math.round((t.prep.traits.brave - 50) / 20);
  }
  return { dc, outnumbered: ours > theirs, bold: Math.round((t.prep.traits.brave - 50) / 20), aside: standsAside(t) };
}

/** The talker's best pitch at t: {kind, skill, mod, advantage, dc, dcLabel, pSuccess}. */
export function bestPitch(run, talker, t) {
  const rules = run.prep.rules;
  const s = talker.spec.social ?? {};
  let best = null;
  // A PC can only be scared off; reasoning or bluffing gets nowhere.
  const scareOnly = t.spec.kind === "pc";
  const aim = aimOf(talker, t);
  // (What doesn't depend on the kind of pitch, worked out once.)
  let shared = null;
  let study = null;
  for ( const kind of TALK_KINDS ) {
    const pitch = s.pitches?.[kind];
    if ( typeof pitch?.mod !== "number" ) continue;
    if ( scareOnly && kind !== "intimidate" && aim === "down" ) continue;
    if ( (aim === "recruit" || aim === "pacify") && kind === "intimidate" ) continue; // nobody is threatened into friendship (or peace)
    if ( kind === "intimidate" && (behaviorOf(talker).peacekeeping ?? 0) >= 0.5 ) continue; // (a Peacekeeper never threatens)
    study ??= studyBonus(talker, t, { words: true });
    const { mod: base, advantage, dice } = checkRoll(run, talker, pitch.mod + study, t, { purpose: "talk", skill: pitch.skill ?? kind });
    shared ??= talkDCShared(run, talker, t);
    const dc = talkDC(run, talker, t, kind, shared);
    // (A Lore-Collector that sized it up: about 2.5 times as likely to get through.)
    const lift = boostBonus(rules, talker, t, base, dc, { advantage, dice, kind: "check", roller: talker });
    const mod = base + lift;
    const dist = degreeDistribution(rules, mod, dc, { advantage, dice, kind: "check", roller: talker });
    // A bluff backfires harder, so it needs to be clearly better.
    const p = dist[2] + dist[3] - (kind === "deceive" ? dist[0] * 0.5 : 0);
    if ( !best || p > best.pSuccess ) {
      best = { kind, aim, skill: pitch.skill ?? kind, mod, boost: lift || null, advantage, dice, dc, dcLabel: t.spec.social?.resist?.[kind]?.label ?? "DC", pSuccess: Math.max(0, p) };
    }
  }
  return best;
}

/** A boss in a fight is talked out of it only under this share of its hit points (it surrenders). */
const BOSS_GIVES_UP = 0.25;

/** How much more one its answer to "Who to pursue first" picks is worth talking round. */
const PURSUED = 1.25;

/**
 * Who its answer to "Who to pursue first" picks among those it could talk to (nearest, weakest, most dangerous,
 * spellcasters and healers, whoever is attacking its friends), or null with no answer.
 */
function pursued(run, talker, targets) {
  const aim = talker.tac?.target;
  if ( !aim || !targets.length ) return null;
  const pick = (score, low = false) => [targets.reduce((a, b) => ((low ? score(b) < score(a) : score(b) > score(a)) ? b : a))];
  switch ( aim ) {
    case "nearest": return run.prep.options.positioning ? new Set(pick(t => edgeDistance(talker, t), true)) : null;
    case "weakest": return new Set(pick(hpFraction, true));
    case "dangerous": return new Set(pick(dangerScore));
    case "casters": return new Set(targets.filter(t => t.prep?.isCaster || t.prep?.isHealer));
    case "protect": return new Set(targets.filter(t => { const at = run.byId.get(t.targetId); return at && at !== talker && at.side === talker.side && areEnemies(run, at, t); }));
    default: return null;
  }
}

/**
 * Choose who to talk to: likely to work, few steps left, and worth taking out of the fight (or bringing in); and,
 * a little more, the one it would go after anyway (its answer to "Who to pursue first").
 */
export function choosePitch(run, talker, { only = null } = {}) {
  let best = null;
  const targets = pitchTargets(run, talker);
  const favored = pursued(run, talker, targets.filter(t => isStanding(t)));
  for ( const t of targets ) {
    if ( !swayable(t) || !shareLanguage(talker, t, run) ) continue;
    if ( t.offendedBy.has(talker.id) ) continue;
    // (Already won a step from it this turn: the next pitch goes elsewhere, or none.)
    if ( movedThisTurn(t, talker) ) continue;
    if ( only && !only(t) ) continue;
    const pitch = bestPitch(run, talker, t);
    if ( !pitch || pitch.pSuccess <= 0.05 - 0.04 * wish(talker.spec.alwaysTalk) ) continue;
    // A boss can't be talked into leaving, nor, in a fight, out of it until it's badly hurt.
    if ( t.isBoss && (pitch.aim === "leave" || (pitch.aim === "down" && !run.standoff && hpFraction(t) >= BOSS_GIVES_UP)) ) continue;
    const remaining = Math.max(1, stepsToConvince(t, run, talker) - (t.sway.get(talker.side) ?? 0));
    const cmd = commandOf(run, t);
    const commands = cmd?.unit === t ? (cmd.boss ? 2.5 : 1.5) : 0;
    const health = 1 + t.hp / Math.max(1, t.maxHp);
    // An enemy out of the fight (its commander, its side with it; or a fighter off the field); a new friend (a weak one
    // counts for less); a new enemy prevented; a quarrel settled or let be.
    const value = { down: (1 + commands) * health, leave: (1 + commands) * health, recruit: 0.8 * health * (t.prep.lowBattleWorth ? 0.5 : 1), dismiss: 0.9 * health, calm: 1.2 * health, pacify: 1.3 * health, settle: 1.5 }[pitch.aim];
    const score = pitch.pSuccess * value / remaining * (favored?.has(t) ? PURSUED : 1);
    if ( !best || score > best.score ) best = { target: t, ...pitch, remaining, score };
  }
  return best;
}

/**
 * How many actions u spends talking this turn (0, 1 or 2), and the first pitch it would make (so the turn
 * doesn't weigh every enemy twice).
 * @returns {{count: number, pitch: object|null}}
 */
export function talkActionsThisTurn(run, u, actions) {
  const none = { count: 0, pitch: null };
  if ( !run.prep.options.talking || actions <= 0 ) return none;
  const tactic = u.tac?.talk;
  if ( tactic === "never" ) return none;
  const affinity = u.prep.talkAffinity ?? 0;
  if ( affinity <= 0 && !talksFirstAnswer(tactic) ) return none;
  const pitch = choosePitch(run, u);
  if ( !pitch ) return none;
  // "Always talk unless I am currently being hurt" (and not staying true to the calculated tactics): the whole turn; an
  // answer that leans less that way, as often as it leans.
  const devoted = !u.spec.stayTrue && !u.beingHurt && wishWins(run, u.spec.alwaysTalk);
  const talker = affinity >= 0.75 || talksFirstAnswer(tactic) || !!behaviorOf(u).parleyFirst || devoted;
  if ( devoted ) return { count: actions, pitch };
  // The less battle-worthy, and skilled talkers with a promising pitch, put their whole voice into it.
  const max = Math.min(actions, (u.prep.lowBattleWorth || (talker && pitch.pSuccess >= 0.5)) ? 2 : 1);
  // Talkers always get to start swaying on their first turn. (One that spent its turn sizing up whoever it meant to
  // talk to gets to the talking now.)
  if ( u.talkPending ) {
    u.talkPending = false;
    return { count: talker ? max : 1, pitch };
  }
  if ( talker && u.turnsTaken === 0 ) return { count: max, pitch };
  if ( tactic === "first" && pitch.pSuccess >= 0.2 ) return { count: max, pitch };
  // (One that would rather use its magic and specialties talks when it might that much less: its answer's weight.)
  const chance = affinity * (0.2 + pitch.pSuccess) * (u.prep.lowBattleWorth ? 1.5 : 1) * talkDamping(u);
  if ( !run.rng.chance(clamp(chance, 0, 0.95)) ) return none;
  return { count: (u.prep.lowBattleWorth && pitch.pSuccess >= 0.35) ? max : 1, pitch };
}

/**
 * Decide how a convinced enemy leaves the fight. Before any blow is struck (a standoff), reasoning or a bluff
 * talks them into standing down; threats still make them yield or run.
 */
function outcomeFor(run, t, kind, aim = "down", { noSwitch = false, peace = false } = {}) {
  const rng = run.rng;
  // Talked round by a Peacekeeper: a truce, it stands down (a player character still only backs off).
  if ( peace && aim === "down" && !t.isBoss && t.spec.kind !== "pc" ) return SWAY.STAND_DOWN;
  // A boss isn't talked out of anything lightly: in a standoff it's talked round (and takes its group); in a fight,
  // only badly hurt does it give up (choosePitch doesn't try sooner). It never stands aside.
  if ( t.isBoss && aim === "down" ) return run.standoff ? SWAY.STAND_DOWN : SWAY.SURRENDER;
  if ( aim === "recruit" ) return SWAY.SWITCH;
  if ( aim === "dismiss" ) return SWAY.FLEE;
  if ( aim === "calm" ) return "calm";
  if ( aim === "pacify" ) return "pacified";
  if ( aim === "leave" ) return SWAY.FLEE;
  // Satisfaction for a quarrel: an apology.
  if ( aim === "settle" ) return "amends";
  // A player character scheming against the leader it wasn't chosen to be may turn (only on the traitor luck: below).
  if ( t.spec.kind === "pc" && t.scheming && aim === "down" && !noSwitch ) return SWAY.NEUTRAL;
  // Words can only make a PC back off: threats send it running.
  if ( t.spec.kind === "pc" ) return SWAY.FLEE;
  const selfish = t.prep.traits.selfish;
  const loyal = t.prep.traits.loyal;
  // Changing sides: an enemy can only be talked into standing aside (taking no side), from where it can be won over.
  // (Scheming against its own leaders: far likelier.)
  const switchChance = noSwitch ? 0 : standsAside(t) ? 0.6 : clamp(0.03 + (selfish - 50) / 500 + (50 - loyal) / 500 + (t.scheming ? 0.5 : 0), 0, t.scheming ? 0.7 : 0.12);
  if ( rng.chance(switchChance) ) return SWAY.NEUTRAL;
  if ( run.standoff && kind !== "intimidate" ) return SWAY.STAND_DOWN;
  const hurt = t.maxHp > 0 && t.hp / t.maxHp < 0.5;
  // (One who doesn't like to flee mostly gives up where it stands instead.)
  if ( !hurt && selfish >= 55 && !standsGround(run, t) ) return SWAY.FLEE;
  if ( hurt && t.prep.traits.brave < 40 && rng.chance(0.5) && !standsGround(run, t) ) return SWAY.FLEE;
  return SWAY.SURRENDER;
}

/**
 * What a creature hands over when it gives something up (or has it lifted: behavior/theft.js): 1-10% of its money;
 * failing that an item it carries but isn't wielding or wearing (a PC keeps it unless a d100 luck check comes up under
 * 40, with `itemLuck`); failing that, an NPC gives up something it's wielding. Returns null when there's nothing at all.
 */
export function concession(run, t, { itemLuck = true } = {}) {
  const v = remaining(t);
  const rng = run.rng;
  if ( v.own > 0 ) {
    const percent = rng.die(10);
    return { kind: "money", amount: Math.max(1, Math.round(v.own * percent / 100)), percent, denominations: v.denominations ?? null };
  }
  if ( v.stowed.length ) {
    const item = rng.pick(v.stowed);
    if ( t.spec.kind === "pc" && itemLuck ) {
      const luck = rng.die(100);
      const needed = run.prep.options.concedeLuck ?? CONCEDE_LUCK;
      return { kind: "item", item, luck, needed, kept: luck > needed };
    }
    return { kind: "item", item };
  }
  if ( t.spec.kind !== "pc" && v.wielded.length ) return { kind: "item", item: rng.pick(v.wielded), wielded: true };
  // (Nothing to hand over, but ground to give: progress marked on its own track, the winner's reward.)
  if ( t.spec.valuables?.progress > 0 ) return { kind: "progress", amount: t.spec.valuables.progress };
  return null;
}

/**
 * In a standoff, an enemy talked into running settles the whole thing, for the talker's side (a neutral talking for
 * the side it leans toward: for that side).
 */
function settle(run, talker, outcome) {
  const side = isNeutral(talker) ? leanSide(run, talker) : talker.side;
  if ( !side || !run.standoff || run.resolved || outcome !== SWAY.FLEE ) return;
  // (Only an argument: backing down, where it would have run.)
  run.resolved = { side, outcome: arguing(run) ? SWAY.STAND_DOWN : outcome };
}

function applyOutcome(run, talker, t, outcome, log, aim = "down", luck = null) {
  const by = { by: talker.spec.name, byId: talker.id };
  // A quarrel settled with words (the talker takes no side): an apology.
  if ( outcome === "amends" ) {
    settleTruce(talker, t.side);
    log(t, { type: "neutral", what: "amends", ...by });
    return;
  }
  // Talked into letting a quarrel be: someone taking no side lets the sides it was fighting be; anyone else holds back
  // from it (until it's hurt again).
  if ( outcome === "pacified" ) {
    if ( isNeutral(t) ) {
      for ( const side of [...t.against] ) calm(t, side);
      t.targetId = null;
      run.geo = (run.geo ?? 0) + 1;
      log(t, { type: "neutral", what: "calmed", ...by });
    } else {
      t.holdsBack = true;
      log(t, { type: "neutral", what: "holds", ...by });
    }
    return;
  }
  // Someone taking no side, confronting the talker's side, talked round.
  if ( outcome === "calm" ) {
    settleTruce(t, talker.side);
    log(t, { type: "neutral", what: "calmed", ...by });
    return;
  }
  if ( aim === "down" ) settle(run, talker, outcome);
  // Only an argument: nobody runs or yields; talked round, it backs down.
  if ( arguing(run) && (outcome === SWAY.FLEE || outcome === SWAY.SURRENDER) ) outcome = SWAY.STAND_DOWN;
  // Won over: it joins the talker's side.
  if ( outcome === SWAY.SWITCH ) {
    joinSide(run, t, talker.side, log);
    t.swayOutcome = SWAY.SWITCH;
    const sideLabel = run.prep.sides[talker.side]?.label ?? talker.side;
    log(t, { type: "sway", outcome, recruit: true, sideLabel, ...by });
    return;
  }
  for ( const id of t.adjacent ) run.byId.get(id)?.adjacent.delete(t.id);
  t.adjacent.clear();
  // An enemy talked into changing sides stands aside (one who had turned on the talker's side lets it be again).
  if ( outcome === SWAY.NEUTRAL ) {
    const again = isNeutral(t);
    if ( again ) calm(t, talker.side);
    else standAside(run, t);
    t.swayOutcome = SWAY.NEUTRAL;
    log(t, {
      type: "sway", outcome, again, luck: luck?.roll ?? null, needed: luck?.needed ?? null, ...by
    });
    return;
  }
  t.swayOutcome = outcome;
  if ( outcome === SWAY.FLEE ) runOff(run, t, talker);
  else {
    t.status = outcome === SWAY.STAND_DOWN ? STATUS.STOOD_DOWN : STATUS.SURRENDERED;
    t.fellRound ??= run.round;
  }
  log(t, { type: "sway", outcome, by: talker.spec.name, byId: talker.id });
}

/** a falls back with leader (a retreat it called, or answered): off the field. */
function fallBack(run, a, leader, log) {
  runOff(run, a, null);
  log(a, { type: "flee", retreat: true, with: leader.spec.name, withId: leader.id, leads: a === leader, ...(a.leaving ? { leaving: true, feet: 0 } : {}) });
}

/**
 * t runs off, talked into it by `by` (or falling back with its group): on a map, it sets out for the edge, still in the
 * fight until it's off, its quarrel with `by`'s side laid down (behavior/leaving.js); without one, it's gone at once.
 */
function runOff(run, t, by) {
  if ( mayLeave(run, t) ) {
    startLeaving(run, t, { by, why: by ? "talked" : "retreat" });
    return;
  }
  for ( const id of t.adjacent ) run.byId.get(id)?.adjacent.delete(t.id);
  t.adjacent.clear();
  t.status = STATUS.FLED;
  t.fellRound ??= run.round;
  t.ranRound = run.round;
}

/**
 * Make one pitch. Returns true if the target was convinced.
 * @param {(unit, text) => void} log
 */
export function attemptTalk(run, talker, pitch, log) {
  // (A live battle's, the system's own roll where it makes checks: battle-state.js systemRolled.)
  const rolled = systemRolled(run, talker, "check", { dc: pitch.dc, target: pitch.target ?? null, purpose: "talk", skill: pitch.skill ?? pitch.kind ?? null, label: pitch.kind ?? "" });
  const roll = rollCheck(run.prep.rules, run.rng, pitch.mod, pitch.dc, { advantage: pitch.advantage ?? 0, dice: pitch.dice ?? null, kind: "check", roller: talker, rolled, what: pitch.kind ?? "talk", target: pitch.target ?? null });
  return resolveTalk(run, talker, pitch, roll, log);
}

/**
 * What a pitch's roll comes to (the engine's own, or in a live battle a player's real one: {degree, natural, total,
 * note, faces, challenge}): the persuasion track, the grudges, the strain, the system's say, and, convinced, the
 * outcome. Returns true if the target was convinced.
 */
export function resolveTalk(run, talker, pitch, roll, log) {
  const t = pitch.target;
  // (Spoken to on its way off the map: it may stop to answer: behavior/leaving.js.)
  if ( t.leaving ) confronted(run, t, talker, "talk", log);
  spendEdges(talker, "check", t.id);
  spendBoost(talker, t);
  const steps = stepsToConvince(t, run, talker);
  const aim = pitch.aim ?? aimOf(talker, t);
  let progress = t.sway.get(talker.side) ?? 0;
  // (One step a turn from each talker: a second success this turn wins nothing more, movedThisTurn.)
  const moved = roll.degree >= 2 && movedThisTurn(t, talker);
  if ( roll.degree >= 2 && !moved ) t.swayTurn.set(talker.id, talker.turnsTaken);
  switch ( moved ? -1 : roll.degree ) {
    case -1: break;
    case 3: progress += 2; break;
    case 2: progress += 1; break;
    case 1:
      t.rebuffed.set(talker.id, (t.rebuffed.get(talker.id) ?? 0) + 1);
      break;
    default:
      t.rebuffed.set(talker.id, (t.rebuffed.get(talker.id) ?? 0) + 2);
      t.offendedBy.add(talker.id);
      progress = Math.max(0, progress - 1);
  }
  t.sway.set(talker.side, progress);
  // Winning someone over, the talker makes the case by what it wants (keeping someone safe, hurting someone).
  const pull = aim === "recruit" ? appeal(run, t, talker.side).fulfils : null;
  const pullName = pull ? run.byId.get(pull.targetId)?.spec.name ?? "" : "";
  if ( run.log ) log(talker, {
    type: "talk", kind: pitch.kind, skill: pitch.skill, target: t.spec.name, targetId: t.id, natural: roll.natural, mod: pitch.mod, boost: pitch.boost ?? null, total: roll.total, note: roll.note ?? null, faces: roll.faces ?? null,
    dc: pitch.dc, dcStat: pitch.dcLabel, degree: roll.degree, margin: roll.total - pitch.dc, challenge: roll.challenge ?? null,
    progress: Math.min(progress, steps), steps, offended: roll.degree === 0,
    aim, appeal: pull ? { kind: pull.kind, target: pullName, targetId: pull.targetId } : null
  });
  // Words that wear a creature down (behavior/strain.js): whoever lost the exchange pays.
  if ( roll.degree >= 2 ) strain(run, t, talker, roll.degree === 3, log);
  else strain(run, talker, t, roll.degree === 0, log);
  // What the pitch's result gives or costs the talker, by the system (Ironsworn: Compel's momentum, a miss's price).
  const said = run.prep.rules.afterTalk?.(run, talker, t, roll, { aim, kind: pitch.kind });
  if ( said?.text && run.log ) log(talker, { type: "endure", text: said.text, ...said.data });
  // Insulted by a botched pitch: someone taking no side turns on the talker's side (one already confronting the
  // talker turns on its side).
  if ( roll.degree === 0 ) {
    if ( aim === "recruit" || aim === "dismiss" || aim === "calm" || (aim === "pacify" && isNeutral(t)) ) offend(run, t, talker, "insulted", log);
    else if ( aim === "settle" ) turnOn(run, talker, t, "insulted", log);
  }
  // Only a successful pitch closes the deal, even if circumstances have made them easier to convince.
  if ( roll.degree < 2 || progress < steps ) return false;

  // (A Peacekeeper's success is a truce: by how much of one it is.)
  const peace = (behaviorOf(talker).peacekeeping ?? 0) > 0 && run.rng.chance(behaviorOf(talker).peacekeeping);
  let outcome = outcomeFor(run, t, pitch.kind, aim, { peace });
  // An enemy changing sides goes through with it only on a d100 at or under the switch luck (one scheming against its own
  // leaders, more readily; a player character, only at or under the traitor luck); otherwise it's talked into something else.
  let luck = null;
  if ( outcome === SWAY.NEUTRAL && aim === "down" ) {
    const pc = t.spec.kind === "pc";
    const needed = pc ? run.prep.options.traitorLuck ?? TRAITOR_LUCK : Math.min(100, (run.prep.options.switchLuck ?? SWITCH_LUCK) + (t.scheming ? 20 : 0));
    luck = { roll: run.rng.die(100), needed, traitor: pc };
    if ( luck.needed < 100 && luck.roll > luck.needed ) { // (100: always)
      log(t, {
        type: "neutral", what: "luck", luck: luck.roll, needed: luck.needed, by: talker.spec.name, byId: talker.id
      });
      outcome = outcomeFor(run, t, pitch.kind, aim, { noSwitch: true, peace });
    }
  }
  // (Whoever commanded its group, before it's talked out of it.)
  const group = groupKeyOf(t);
  const commanded = commandOf(run, t)?.unit === t;
  applyOutcome(run, talker, t, outcome, log, aim, luck);

  // Talked into running (in a fight), it tries to take its group with it (behavior/morale.js callRetreat).
  if ( outcome === SWAY.FLEE && (t.status === STATUS.FLED || t.leaving) && !run.standoff ) {
    const retreat = callRetreat(run, t, log);
    const leader = retreat.commander ?? t;
    for ( const a of retreat.followers ) if ( isStanding(a) ) fallBack(run, a, leader, log);
    return true;
  }
  // A convinced commander can take their group with them.
  if ( aim === "down" && commanded ) {
    for ( const f of run.units ) {
      if ( f === t || groupKeyOf(f) !== group || f.spec.kind === "pc" || !swayable(f) ) continue;
      const p = 0.4 + (100 - f.prep.traits.brave) / 250 + (f.sway.get(talker.side) ?? 0) * 0.1;
      const follows = [SWAY.STAND_DOWN, SWAY.NEUTRAL].includes(outcome) ? SWAY.STAND_DOWN : SWAY.SURRENDER;
      if ( run.rng.chance(clamp(p, 0, 0.9)) ) applyOutcome(run, talker, f, follows, log);
    }
  }
  return true;
}

/**
 * Talk affinity 0-1: how readily a unit reaches for words over weapons.
 * Social skill relative to level, playstyles, intelligence and tactics answers.
 */
export function talkAffinity(spec, traits, rules = null) {
  const s = spec.social;
  if ( !s || s.mindless || !(s.languages?.length) ) return 0;
  const best = Math.max(...TALK_KINDS.map(k => (typeof s.pitches?.[k]?.mod === "number" ? s.pitches[k].mod : -99)));
  if ( best <= -99 ) return 0;
  // How much better than a typical creature of its level it is with words.
  const rel = best - typical(rules, "skill", spec.level ?? 0);
  let a = 0.35 + rel * 0.08;
  const ps = new Set(spec.playstyles ?? []);
  if ( ps.has("diplomat") ) a += 0.45;
  if ( ps.has("peacekeeper") ) a += 0.3;
  if ( ps.has("peoplePleaser") ) a += 0.2;
  if ( ps.has("instigator") || ps.has("cruel") ) a += 0.1;
  if ( ps.has("brawler") || ps.has("impatient") || ps.has("dps") ) a -= 0.25;
  if ( (traits?.tactical ?? 50) < 20 ) a -= 0.3;
  if ( talksFirstAnswer(spec.tactics?.talk) ) a = Math.max(a, 0.8);
  if ( spec.roleplay && (ps.has("diplomat") || ps.has("peoplePleaser")) ) a += 0.15;
  // Always talking: much keener, however unskilled (as much as its answer leans that way); only a little when staying true.
  const keen = wish(spec.alwaysTalk);
  if ( keen ) a = spec.stayTrue ? a + 0.1 * keen : Math.max(a + 0.4 * keen, 0.85 * keen);
  return clamp(a, 0, 1);
}


/** The talk outcomes, for a live battle: what the GM says a talk came to (an SWAY outcome), applied as the engine would. */
export { applyOutcome as applySway, outcomeFor };
