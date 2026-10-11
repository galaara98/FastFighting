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
 * gives something up (money or an item, then backs off), or (rarely, unless they were neutral) changes sides. An
 * enemy changing sides only stands aside (it takes no side now), and only on a d100 under the switch luck; otherwise
 * it's talked into one of the others.
 *
 * Those who take no side (behavior/neutral.js) are talked to as well: won over to join the talker's side (no luck
 * check; easier when joining gives them what they want, harder when it betrays it, and never by a side they've seen
 * cross them), talked round when they're confronting the talker's side, or, when they're the ones confronting
 * someone, talking that someone into making amends.
 * Player characters decide their own fate, so words can only make a PC give something up or back off and run; a
 * PC who would rather let weapons do the talking won't listen at all. In a standoff, giving something up or
 * running ends the whole conflict: the deal is struck and everyone walks away. Convincing a leader can make the rest of
 * their side stand down.
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
import { STATUS, SWAY, CONCEDE_LUCK, SWITCH_LUCK, TRAITOR_LUCK, TACTICAL, clamp } from "../../constants.js";
import { alliesOf, enemiesOf, isStanding, behaviorOf, typical, checkRoll, liveTier, liveTrait, studyBonus, boostBonus, chainOf, commandOf, groupKeyOf } from "../battle-state.js";
import { spendEdges, spendBoost } from "./effects.js";
import { degreeDistribution, rollCheck } from "../probability.js";
import { isNeutral, standsAside, appeal, offend, turnOn, standAside, joinSide, calm, settleTruce, seemsFoe, leanSide, fighting, dislikesViolence } from "./neutral.js";
import { prefersTalk } from "./standoff.js";
import { levelOf, allDesires } from "./desire.js";
import { standsGround, callRetreat } from "./morale.js";

/** The three kinds of pitch. Systems map their own skills onto these (CombatantSpec.social.pitches). */
export const TALK_KINDS = Object.freeze(["persuade", "intimidate", "deceive"]);
const VERB = { persuade: "reasons with", intimidate: "threatens", deceive: "bluffs" };
/** What a pitch is for, beyond talking an enemy down. */
const AIM_TEXT = { recruit: " to join them", dismiss: " to leave", calm: " to let it go", settle: " to make amends", extort: " to pay up", pacify: " to let it be", leave: " to leave" };

/**
 * What talking to t is for: "down" (an enemy: talk it out of the fight), "recruit" (someone taking no side: win it
 * over), "dismiss" (someone taking no side: talk it into leaving, for those who don't like killing and would rather
 * see it gone: behavior/neutral.js peaceDesires), "calm" (someone taking no side who's confronting the talker's
 * side: talk it round), "settle" (the talker takes no side and is confronting t's side: have it make amends), or
 * "extort" (the talker takes no side, and is squeezing the side it likes least for money: behavior/neutral.js
 * meddling). One calming a fight (talker.calming) talks the fighters into letting it be ("pacify": someone taking no
 * side, out of its quarrel; anyone in a standoff, into leaving the quarrel alone) or, once it's a fight, into leaving.
 */
export function aimOf(talker, t) {
  if ( talker.calming ) {
    if ( isNeutral(t) && t.against.size ) return "pacify";
    if ( !isNeutral(t) ) return talker.calming;
  }
  if ( isNeutral(talker) && talker.truce?.side === t.side && !talker.against.has(t.side) ) return "settle";
  if ( isNeutral(talker) && talker.meddling?.how === "extort" && talker.meddling.against.includes(t.side) && !talker.against.has(t.side) && hasValuables(t) ) return "extort";
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
const talksFirst = u => !!u.spec.alwaysTalk || u.tac?.talk === "first" || !!behaviorOf(u).parleyFirst;

/**
 * Can a and b understand each other? A language in common; or, with languages set aside (options.ignoreLanguages),
 * any language at all on both sides.
 */
export function shareLanguage(a, b, run = null) {
  const la = a.spec.social?.languages ?? [];
  const lb = b.spec.social?.languages ?? [];
  if ( run?.prep.options.ignoreLanguages ) return la.length > 0 && lb.length > 0;
  return la.some(l => lb.includes(l));
}

/** What t still has to hand over (or have taken), after anything already lost this fight. */
export function remaining(t) {
  const v = t.spec.valuables ?? {};
  const given = (t.concessions ?? []).filter(c => !c.kept);
  const spent = given.filter(c => c.kind === "money").reduce((s, c) => s + c.amount, 0);
  const gone = new Set(given.filter(c => c.kind === "item").map(c => c.item.id));
  return {
    money: Math.max(0, (v.money ?? 0) - spent),
    denominations: v.denominations ?? null,
    stowed: (v.stowed ?? []).filter(i => !gone.has(i.id)),
    wielded: (v.wielded ?? []).filter(i => !gone.has(i.id))
  };
}

/** Something to hand over: money, or an item carried but not wielded or worn. */
export function hasValuables(t) {
  const v = remaining(t);
  return v.money > 0 || v.stowed.length > 0;
}

/**
 * Can this unit be talked out of the fight at all? PCs decide their own fate: words can only talk a PC into
 * giving something up or backing off, and only if they're willing to listen.
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
 * Successful pitches needed to convince t (2-6, or 1 if very gullible). With `run`, the situation counts:
 * a badly hurt or outnumbered enemy is one step easier to talk down.
 */
export function stepsToConvince(t, run = null, talker = null) {
  const s = t.spec.social ?? {};
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
  if ( talker && aimOf(talker, t) === "pacify" ) steps -= 1;
  // Winning someone over: a step quicker if joining gives it something it wants, slower if it betrays it.
  if ( run && talker && aimOf(talker, t) === "recruit" ) {
    const { fulfils, betrays } = appeal(run, t, talker.side);
    if ( (fulfils?.level ?? 0) >= 40 ) steps -= 1;
    if ( (betrays?.level ?? 0) >= 40 ) steps += 1;
    if ( (betrays?.level ?? 0) >= 70 ) steps += 1;
  }
  if ( run ) {
    if ( t.maxHp > 0 && t.hp / t.maxHp < 0.5 ) steps -= 1;
    else if ( enemiesOf(run, t).filter(isStanding).length > alliesOf(run, t).filter(isStanding).length ) steps -= 1;
  }
  return clamp(steps, 2, t.spec.kind === "pc" ? 8 : 6);
}

/** The DC t sets against `talker` for one kind of pitch, including grudges and circumstances. */
export function talkDC(run, talker, t, kind) {
  const s = t.spec.social ?? {};
  const level = t.spec.level ?? 0;
  let dc = s.resist?.[kind]?.dc ?? typical(run.prep.rules, "dc", level);

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
  const ours = enemiesOf(run, t).filter(isStanding).length;
  if ( ours > theirs ) dc -= kind === "intimidate" ? 3 : 2;
  // (Its leaders all down, or none of them able to lead: nobody holding it together.)
  if ( chainOf(run, groupKeyOf(t))?.length && !commandOf(run, t) ) dc -= 2;

  // Personality: loyal and brave hold out, selfish take a deal; neutrals are easy to talk to.
  dc += Math.round((t.prep.traits.loyal - 50) / 25) - Math.round((t.prep.traits.selfish - 50) / 25);
  if ( kind === "intimidate" ) dc += Math.round((t.prep.traits.brave - 50) / 20);
  if ( standsAside(t) ) dc -= kind === "persuade" ? 4 : 2;
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
  return dc;
}

/** The talker's best pitch at t: {kind, skill, mod, advantage, dc, dcLabel, pSuccess}. */
export function bestPitch(run, talker, t) {
  const rules = run.prep.rules;
  const s = talker.spec.social ?? {};
  let best = null;
  // A PC with nothing to hand over can only be scared off; reasoning or bluffing gets nowhere.
  const scareOnly = t.spec.kind === "pc" && !hasValuables(t);
  const aim = aimOf(talker, t);
  for ( const kind of TALK_KINDS ) {
    const pitch = s.pitches?.[kind];
    if ( typeof pitch?.mod !== "number" ) continue;
    if ( scareOnly && kind !== "intimidate" && aim === "down" ) continue;
    if ( (aim === "recruit" || aim === "pacify") && kind === "intimidate" ) continue; // nobody is threatened into friendship (or peace)
    if ( kind === "intimidate" && (behaviorOf(talker).peacekeeping ?? 0) >= 0.5 ) continue; // (a Peacekeeper never threatens)
    const { mod: base, advantage, dice } = checkRoll(run, talker, pitch.mod + studyBonus(talker, t, { words: true }), t);
    const dc = talkDC(run, talker, t, kind);
    // (A Lore-Collector that sized it up: about 2.5 times as likely to get through.)
    const lift = boostBonus(rules, talker, t, base, dc, { advantage, dice, kind: "check" });
    const mod = base + lift;
    const dist = degreeDistribution(rules, mod, dc, { advantage, dice, kind: "check" });
    // A bluff backfires harder, so it needs to be clearly better.
    const p = dist[2] + dist[3] - (kind === "deceive" ? dist[0] * 0.5 : 0);
    if ( !best || p > best.pSuccess ) {
      best = { kind, aim, skill: pitch.skill ?? kind, mod, boost: lift || null, advantage, dice, dc, dcLabel: t.spec.social?.resist?.[kind]?.label ?? "DC", pSuccess: Math.max(0, p) };
    }
  }
  return best;
}

/** Choose who to talk to: likely to work, few steps left, and worth taking out of the fight (or bringing in). */
export function choosePitch(run, talker, { only = null } = {}) {
  let best = null;
  for ( const t of pitchTargets(run, talker) ) {
    if ( !swayable(t) || !shareLanguage(talker, t, run) ) continue;
    if ( t.offendedBy.has(talker.id) ) continue;
    if ( only && !only(t) ) continue;
    const pitch = bestPitch(run, talker, t);
    if ( !pitch || pitch.pSuccess <= (talker.spec.alwaysTalk ? 0.01 : 0.05) ) continue;
    // A boss can't be talked into leaving; in a standoff, only paid to (by a side with something to pay it).
    if ( t.isBoss && (pitch.aim === "leave" || (pitch.aim === "down" && run.standoff && !bribeFrom(run, talker))) ) continue;
    const remaining = Math.max(1, stepsToConvince(t, run, talker) - (t.sway.get(talker.side) ?? 0));
    const cmd = commandOf(run, t);
    const commands = cmd?.unit === t ? (cmd.boss ? 2.5 : 1.5) : 0;
    const health = 1 + t.hp / Math.max(1, t.maxHp);
    // An enemy out of the fight (its commander, its side with it; or a fighter off the field); a new friend (a weak one
    // counts for less); a new enemy prevented; a quarrel settled or let be; money.
    const value = { down: (1 + commands) * health, leave: (1 + commands) * health, recruit: 0.8 * health * (t.prep.lowBattleWorth ? 0.5 : 1), dismiss: 0.9 * health, calm: 1.2 * health, pacify: 1.3 * health, settle: 1.5, extort: 1.2 }[pitch.aim];
    const score = pitch.pSuccess * value / remaining;
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
  if ( affinity <= 0 && tactic !== "first" ) return none;
  const pitch = choosePitch(run, u);
  if ( !pitch ) return none;
  // "Always prefers talking to fighting" (unless they also stay true to their calculated tactics): the whole turn.
  const devoted = !!u.spec.alwaysTalk && !u.spec.stayTrue;
  const talker = affinity >= 0.75 || tactic === "first" || !!behaviorOf(u).parleyFirst || devoted;
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
  const chance = affinity * (0.2 + pitch.pSuccess) * (u.prep.lowBattleWorth ? 1.5 : 1);
  if ( !run.rng.chance(clamp(chance, 0, 0.95)) ) return none;
  return { count: (u.prep.lowBattleWorth && pitch.pSuccess >= 0.35) ? max : 1, pitch };
}

/**
 * Decide how a convinced enemy leaves the fight. Before any blow is struck (a standoff), reasoning or a bluff
 * talks them into standing down; threats still make them yield or run.
 */
function outcomeFor(run, t, kind, aim = "down", { noSwitch = false, peace = false } = {}) {
  const rng = run.rng;
  // Talked round by a Peacekeeper: a truce, it stands down (a player character still only pays up or backs off).
  if ( peace && aim === "down" && !t.isBoss && t.spec.kind !== "pc" ) return SWAY.STAND_DOWN;
  // A boss isn't talked out of anything: in a standoff it can be paid to go (and takes its group); in a fight, only
  // badly hurt does it give up, or else it buys its way out of the argument (and fights on). It never stands aside.
  if ( t.isBoss && aim === "down" ) {
    if ( run.standoff ) return "bribed";
    return t.maxHp > 0 && t.hp / t.maxHp < 0.25 ? SWAY.SURRENDER : SWAY.CONCEDE;
  }
  if ( aim === "recruit" ) return SWAY.SWITCH;
  if ( aim === "dismiss" ) return SWAY.FLEE;
  if ( aim === "calm" ) return "calm";
  if ( aim === "pacify" ) return "pacified";
  if ( aim === "extort" ) return "paid";
  if ( aim === "leave" ) return SWAY.FLEE;
  // Satisfaction for a quarrel: something handed over, or an apology.
  if ( aim === "settle" ) return hasValuables(t) ? SWAY.CONCEDE : "amends";
  // A player character scheming against the leader it wasn't chosen to be may turn (only on the traitor luck: below).
  if ( t.spec.kind === "pc" && t.scheming && aim === "down" && !noSwitch ) return SWAY.NEUTRAL;
  // Words can only make a PC pay up or back off: threats may send them running (the only way, if they have nothing).
  if ( t.spec.kind === "pc" ) {
    if ( !hasValuables(t) ) return SWAY.FLEE;
    if ( kind === "intimidate" && rng.chance(clamp(0.5 - (t.prep.traits.brave - 50) / 100, 0.1, 0.8)) && !standsGround(run, t) ) return SWAY.FLEE;
    return SWAY.CONCEDE;
  }
  const selfish = t.prep.traits.selfish;
  const loyal = t.prep.traits.loyal;
  // Changing sides: an enemy can only be talked into standing aside (taking no side), from where it can be won over.
  // (Scheming against its own leaders: far likelier.)
  const switchChance = noSwitch ? 0 : standsAside(t) ? 0.6 : clamp(0.03 + (selfish - 50) / 500 + (50 - loyal) / 500 + (t.scheming ? 0.5 : 0), 0, t.scheming ? 0.7 : 0.12);
  if ( rng.chance(switchChance) ) return SWAY.NEUTRAL;
  // Paying them off: rarer than backing down, likelier under threat or when badly hurt; the greedy hate it.
  const hurt = t.maxHp > 0 && t.hp / t.maxHp < 0.5;
  const concedeChance = clamp(0.12 + (kind === "intimidate" ? 0.15 : 0) + (hurt ? 0.1 : 0) - (selfish - 50) / 400, 0.03, 0.45);
  if ( rng.chance(concedeChance) ) return SWAY.CONCEDE;
  if ( run.standoff && kind !== "intimidate" ) return SWAY.STAND_DOWN;
  // (One who doesn't like to flee mostly gives up where it stands instead.)
  if ( !hurt && selfish >= 55 && !standsGround(run, t) ) return SWAY.FLEE;
  if ( hurt && t.prep.traits.brave < 40 && rng.chance(0.5) && !standsGround(run, t) ) return SWAY.FLEE;
  return SWAY.SURRENDER;
}

/**
 * What a creature hands over when it gives something up: 1-10% of its money; failing that an item it carries but
 * isn't wielding or wearing (a PC keeps it unless a d100 luck check comes up under 40); failing that, an NPC gives
 * up something it's wielding. Returns null when there's nothing at all (an NPC then lies and runs).
 */
export function concession(run, t, { itemLuck = true } = {}) {
  const v = remaining(t);
  const rng = run.rng;
  if ( v.money > 0 ) {
    const percent = rng.die(10);
    return { kind: "money", amount: Math.max(1, Math.round(v.money * percent / 100)), percent, denominations: v.denominations ?? null };
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
  return null;
}

/** Playstyles that would pay to be spared the trouble (more talk, a fight), and those that never would. */
const PAYS = new Set(["peacekeeper", "diplomat", "peoplePleaser", "moralist", "enabler", "chicken", "lazy", "fragile", "wallflower"]);
const WONT_PAY = new Set(["brawler", "instigator", "cruel", "vengeful", "relentless", "mercenary", "thief", "redeemSeeker"]);

/**
 * Would u pay to be spared the trouble of more talk, or a fight? A bribe isn't a shakedown: its first pill that has a
 * say decides (a Diplomat or a Chicken would; a Brawler or a Mercenary never); without one, one who can't abide
 * violence would, and so would an unselfish one who'd rather talk or isn't very bold.
 */
export function willingToPay(run, u) {
  for ( const p of u.spec.playstyles ?? [] ) {
    if ( PAYS.has(p) ) return true;
    if ( WONT_PAY.has(p) ) return false;
  }
  if ( dislikesViolence(u) ) return true;
  return liveTrait(run, u, "selfish") < 50 && (prefersTalk(u) || liveTrait(run, u, "brave") < 60);
}

/**
 * Who would pay a boss off for the talker's side: of those willing to (willingToPay), whoever has the most money, else
 * something to give.
 */
function bribeFrom(run, talker) {
  const side = isNeutral(talker) ? leanSide(run, talker) : talker.side;
  const payers = run.units.filter(o => (o === talker || (o.side === side && !isNeutral(o))) && isStanding(o) && hasValuables(o) && willingToPay(run, o));
  return payers.sort((a, b) => remaining(b).money - remaining(a).money)[0] ?? null;
}

/** What it takes to pay a boss off: 11-30% of the payer's money, or else something it carries. */
function bribe(run, payer) {
  const v = remaining(payer);
  if ( v.money > 0 ) {
    const percent = 10 + run.rng.die(20);
    return { kind: "money", amount: Math.max(1, Math.round(v.money * percent / 100)), percent, denominations: v.denominations ?? null, bribe: true };
  }
  return v.stowed.length ? { kind: "item", item: run.rng.pick(v.stowed), bribe: true } : null;
}

/** In a standoff, giving something up or running settles the whole thing: everyone walks away. */
/**
 * In a standoff, an enemy talked into paying up or running settles the whole thing, for the talker's side (a neutral
 * talking for the side it leans toward: for that side).
 */
function settle(run, talker, outcome) {
  const side = isNeutral(talker) ? leanSide(run, talker) : talker.side;
  if ( side && run.standoff && !run.resolved && [SWAY.CONCEDE, SWAY.FLEE].includes(outcome) ) run.resolved = { side, outcome };
}

/**
 * Giving something up. In a standoff it settles everything and the giver backs off. In the thick of a fight it's
 * personal: the giver stays in, won't listen to the taker again, and fears them, until the taker attacks them, when
 * the taker becomes the one they most want to hit.
 */
function concede(run, talker, t, log) {
  const given = concession(run, t);
  if ( !given && t.spec.kind !== "pc" ) {
    // Nothing to give: they swear they have nothing and run.
    for ( const id of t.adjacent ) run.byId.get(id)?.adjacent.delete(t.id);
    t.adjacent.clear();
    t.swayOutcome = SWAY.FLEE;
    t.status = STATUS.FLED;
    t.fellRound ??= run.round;
    t.ranRound = run.round;
    log(t, "swears they have nothing and runs", { type: "sway", outcome: SWAY.FLEE, lie: true, by: talker.spec.name, byId: talker.id });
    return;
  }
  const record = given ? { ...given, to: talker.id, toName: talker.spec.name, round: run.round } : null;
  if ( record ) (t.concessions ??= []).push(record);
  const what = !given ? "nothing" : given.kind === "money" ? `${given.percent}% of their money` : given.item.name;
  const data = { type: "sway", outcome: SWAY.CONCEDE, by: talker.spec.name, byId: talker.id, concession: record };
  if ( run.standoff ) {
    for ( const id of t.adjacent ) run.byId.get(id)?.adjacent.delete(t.id);
    t.adjacent.clear();
    t.swayOutcome = SWAY.CONCEDE;
    t.status = STATUS.STOOD_DOWN; // paid up, and the matter is settled
    t.fellRound ??= run.round;
    log(t, given?.kept ? `agrees to hand over ${what}, but keeps it (luck ${given.luck})` : `gives up ${what} to ${talker.spec.name}`, data);
    return;
  }
  // Mid-fight: still in it, but bitter and wary of whoever made them pay.
  t.conceded = true;
  t.offendedBy.add(talker.id);
  t.sway.set(talker.side, 0);
  (t.grudges ??= new Map()).set(talker.id, { provoked: false });
  log(t, given?.kept ? `agrees to hand over ${what}, but keeps it (luck ${given.luck}), and fights on` : `gives up ${what} to ${talker.spec.name}, bitterly, and fights on`, data);
}

function applyOutcome(run, talker, t, outcome, log, aim = "down", luck = null) {
  const by = { by: talker.spec.name, byId: talker.id };
  // A quarrel settled with words (the talker takes no side): an apology, or something handed over.
  if ( outcome === "amends" ) {
    settleTruce(talker, t.side);
    log(t, `makes amends with ${talker.spec.name}`, { type: "neutral", what: "amends", ...by });
    return;
  }
  // A boss paid to go: the talker's side pays (whoever has the most), and the boss leaves with its whole group. That
  // settles the standoff for the talker's side.
  if ( outcome === "bribed" ) {
    const payer = bribeFrom(run, talker);
    const given = payer ? bribe(run, payer) : null;
    const record = given ? { ...given, to: t.id, toName: t.spec.name, round: run.round } : null;
    if ( record ) (payer.concessions ??= []).push(record);
    const group = groupKeyOf(t);
    for ( const f of run.units ) {
      if ( (f !== t && groupKeyOf(f) !== group) || !isStanding(f) || f.spec.kind === "pc" ) continue;
      for ( const id of f.adjacent ) run.byId.get(id)?.adjacent.delete(f.id);
      f.adjacent.clear();
      f.swayOutcome = SWAY.STAND_DOWN;
      f.status = STATUS.STOOD_DOWN;
      f.fellRound ??= run.round;
    }
    settle(run, talker, SWAY.CONCEDE);
    const what = !given ? "nothing" : given.kind === "money" ? `${given.percent}% of ${payer.spec.name}'s money` : given.item.name;
    log(t, `is paid ${what} to go, and leaves with its people`, { type: "sway", outcome: "bribed", concession: record, payer: payer?.spec.name ?? null, payerId: payer?.id ?? null, ...by });
    return;
  }
  // Paid off: someone taking no side squeezes the side it likes least, which pays it to keep out of it (and it does).
  if ( outcome === "paid" ) {
    const given = concession(run, t);
    const record = given ? { ...given, to: talker.id, toName: talker.spec.name, round: run.round } : null;
    if ( record ) (t.concessions ??= []).push(record);
    if ( talker.meddling ) talker.meddling.how = null;
    const what = !given ? "" : given.kind === "money" ? `${given.percent}% of their money` : given.item.name;
    const text = !given ? `has nothing to pay ${talker.spec.name} with` : given.kept ? `agrees to pay ${talker.spec.name} off with ${what}, but keeps it (luck ${given.luck})` : `pays ${talker.spec.name} off with ${what}`;
    log(t, text, { type: "sway", outcome: SWAY.CONCEDE, paidOff: true, concession: record, ...by });
    return;
  }
  // Talked into letting a quarrel be: someone taking no side lets the sides it was fighting be; anyone else holds back
  // from it (until it's hurt again).
  if ( outcome === "pacified" ) {
    if ( isNeutral(t) ) {
      for ( const side of [...t.against] ) calm(t, side);
      t.targetId = null;
      run.geo = (run.geo ?? 0) + 1;
      log(t, `lets it go, talked round by ${talker.spec.name}`, { type: "neutral", what: "calmed", ...by });
    } else {
      t.holdsBack = true;
      log(t, `agrees to let it be, talked round by ${talker.spec.name}`, { type: "neutral", what: "holds", ...by });
    }
    return;
  }
  // Someone taking no side, confronting the talker's side, talked round.
  if ( outcome === "calm" ) {
    settleTruce(t, talker.side);
    log(t, `lets it go, talked round by ${talker.spec.name}`, { type: "neutral", what: "calmed", ...by });
    return;
  }
  if ( aim === "down" ) settle(run, talker, outcome === SWAY.CONCEDE && !hasValuables(t) && t.spec.kind !== "pc" ? SWAY.FLEE : outcome);
  if ( outcome === SWAY.CONCEDE ) {
    concede(run, talker, t, log);
    if ( aim === "settle" ) settleTruce(talker, t.side);
    return;
  }
  // Won over: it joins the talker's side.
  if ( outcome === SWAY.SWITCH ) {
    joinSide(run, t, talker.side);
    t.swayOutcome = SWAY.SWITCH;
    const sideLabel = run.prep.sides[talker.side]?.label ?? talker.side;
    log(t, `is won over and joins ${sideLabel}`, { type: "sway", outcome, recruit: true, sideLabel, ...by });
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
    log(t, again ? "calms down and stands aside again" : "is talked out of the fight and stands aside", {
      type: "sway", outcome, again, luck: luck?.roll ?? null, needed: luck?.needed ?? null, ...by
    });
    return;
  }
  t.swayOutcome = outcome;
  t.status = { [SWAY.FLEE]: STATUS.FLED, [SWAY.STAND_DOWN]: STATUS.STOOD_DOWN }[outcome] ?? STATUS.SURRENDERED;
  t.fellRound ??= run.round;
  if ( outcome === SWAY.FLEE ) t.ranRound = run.round;
  const text = { [SWAY.FLEE]: "is talked into leaving and flees", [SWAY.STAND_DOWN]: "agrees to stand down" }[outcome] ?? "lays down arms and surrenders";
  log(t, text, { type: "sway", outcome, by: talker.spec.name, byId: talker.id });
}

/** a falls back with leader (a retreat it called, or answered): off the field. */
function fallBack(run, a, leader, log) {
  for ( const id of a.adjacent ) run.byId.get(id)?.adjacent.delete(a.id);
  a.adjacent.clear();
  a.status = STATUS.FLED;
  a.fellRound ??= run.round;
  a.ranRound = run.round;
  log(a, a === leader ? "leads the retreat" : `falls back with ${leader.spec.name}`, { type: "flee", retreat: true, with: leader.spec.name, withId: leader.id, leads: a === leader });
}

/**
 * Make one pitch. Returns true if the target was convinced.
 * @param {(unit, text) => void} log
 */
export function attemptTalk(run, talker, pitch, log) {
  const t = pitch.target;
  const rules = run.prep.rules;
  const roll = rollCheck(rules, run.rng, pitch.mod, pitch.dc, { advantage: pitch.advantage ?? 0, dice: pitch.dice ?? null, kind: "check" });
  spendEdges(talker, "check", t.id);
  spendBoost(talker, t);
  const steps = stepsToConvince(t, run, talker);
  const aim = pitch.aim ?? aimOf(talker, t);
  let progress = t.sway.get(talker.side) ?? 0;
  const verb = VERB[pitch.kind] ?? "talks to";
  switch ( roll.degree ) {
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
  const result = ["critical failure: they won't hear another word", "unmoved", "wavering", "badly shaken"][roll.degree];
  // Winning someone over, the talker makes the case by what it wants (keeping someone safe, hurting someone).
  const pull = aim === "recruit" ? appeal(run, t, talker.side).fulfils : null;
  const pullName = pull ? run.byId.get(pull.targetId)?.spec.name ?? "" : "";
  const why = pull ? ` (${pull.kind === "hurt" ? `a chance at ${pullName}` : `to keep ${pullName} safe`})` : "";
  // (Against challenge dice rather than a DC: Ironsworn.)
  const versus = roll.challenge ? roll.challenge.join(", ") : `DC ${pitch.dc}`;
  const aimText = t.isBoss && aim === "down" && run.standoff ? " to take payment and go" : AIM_TEXT[aim] ?? "";
  if ( run.log ) log(talker, `${verb} ${t.spec.name}${aimText}${why} (${pitch.skill} ${roll.total} vs ${versus}): ${result} [${Math.min(progress, steps)}/${steps}]`, {
    type: "talk", kind: pitch.kind, skill: pitch.skill, target: t.spec.name, targetId: t.id, natural: roll.natural, mod: pitch.mod, boost: pitch.boost ?? null, total: roll.total,
    dc: pitch.dc, dcStat: pitch.dcLabel, degree: roll.degree, margin: roll.total - pitch.dc, challenge: roll.challenge ?? null,
    progress: Math.min(progress, steps), steps, offended: roll.degree === 0,
    aim, appeal: pull ? { kind: pull.kind, target: pullName, targetId: pull.targetId } : null
  });
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
  // An enemy changing sides goes through with it only on a d100 under the switch luck (one scheming against its own
  // leaders, more readily; a player character, only under the traitor luck); otherwise it's talked into something else.
  let luck = null;
  if ( outcome === SWAY.NEUTRAL && aim === "down" ) {
    const pc = t.spec.kind === "pc";
    const needed = pc ? run.prep.options.traitorLuck ?? TRAITOR_LUCK : Math.min(100, (run.prep.options.switchLuck ?? SWITCH_LUCK) + (t.scheming ? 20 : 0));
    luck = { roll: run.rng.die(100), needed, traitor: pc };
    if ( luck.needed < 100 && luck.roll >= luck.needed ) { // (100: always)
      log(t, `almost comes over, but won't turn on their own (luck ${luck.roll})`, {
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
  if ( outcome === SWAY.FLEE && t.status === STATUS.FLED && !run.standoff ) {
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
      const follows = [SWAY.STAND_DOWN, SWAY.CONCEDE, SWAY.NEUTRAL].includes(outcome) ? SWAY.STAND_DOWN : SWAY.SURRENDER;
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
  if ( ps.has("brawler") || ps.has("impatient") || ps.has("speedRunner") ) a -= 0.25;
  if ( (traits?.tactical ?? 50) < 20 ) a -= 0.3;
  if ( spec.tactics?.talk === "first" ) a = Math.max(a, 0.8);
  if ( spec.roleplay && (ps.has("diplomat") || ps.has("peoplePleaser")) ) a += 0.15;
  // "Always prefers talking to fighting": much keener, however unskilled; only a little when staying true.
  if ( spec.alwaysTalk ) a = spec.stayTrue ? a + 0.1 : Math.max(a + 0.4, 0.85);
  return clamp(a, 0, 1);
}

