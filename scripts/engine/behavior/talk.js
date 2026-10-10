/**
 * Talking resolution: de-escalate a fight at any point.
 *
 * A talker spends an action on a pitch (Diplomacy, Intimidation or Deception) at one enemy that shares a
 * language with them. Each success moves that enemy along a persuasion track; it takes several steps to
 * convince someone (2-6), unless they are very gullible (1). When the track fills, the enemy surrenders,
 * flees, or (rarely, unless they were neutral) switches sides. Convincing a leader can make the rest of
 * their side stand down.
 *
 * Grudges matter: anyone the talker has hurt, or has failed to convince before, is much harder to sway,
 * and a critical failure means that enemy will not listen to that talker again.
 *
 * Who talks:
 *  - Talkers (strong social skills, or Diplomat / Leader / People-Pleaser playstyles, or a "talk first"
 *    answer) always get a chance to start swaying on their first turn.
 *  - Characters who are not very battle-worthy may spend two actions talking instead of attacking.
 *  - Anyone else may make one quip per turn when it looks promising and they would.
 * Pure: no Foundry globals.
 */
import { STATUS, SWAY, clamp } from "../../constants.js";
import { alliesOf, enemiesOf, isStanding, behaviorOf, leaderStanding } from "../battle-state.js";
import { degreeDistribution } from "../probability.js";

const SKILLS = ["diplomacy", "intimidation", "deception"];

export function shareLanguage(a, b) {
  const la = a.spec.social?.languages ?? [];
  const lb = b.spec.social?.languages ?? [];
  return la.some(l => lb.includes(l));
}

/** Can this unit be talked out of the fight at all? (PCs decide for themselves.) */
export function swayable(t) {
  if ( !isStanding(t) || t.spec.kind === "pc" ) return false;
  if ( t.spec.hidden && !t.revealed ) return false; // you can't talk to an ambusher you haven't spotted
  const s = t.spec.social;
  return !!s && !s.mindless && (s.languages?.length ?? 0) > 0;
}

/** Expected Will modifier for a level (moderate NPC guideline). */
const expectedWill = level => Math.round(level * 1.15 + 5);

/**
 * Successful pitches needed to convince t (2-6, or 1 if very gullible). With `run`, the situation counts:
 * a badly hurt or outnumbered enemy is one step easier to talk down.
 */
export function stepsToConvince(t, run = null) {
  const s = t.spec.social ?? {};
  const will = t.spec.defenses?.will ?? expectedWill(t.spec.level);
  const delta = will - expectedWill(t.spec.level);
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
  if ( t.spec.originSide === "neutral" ) steps -= 1;
  if ( run ) {
    if ( t.maxHp > 0 && t.hp / t.maxHp < 0.5 ) steps -= 1;
    else if ( enemiesOf(run, t).filter(isStanding).length > alliesOf(run, t).filter(isStanding).length ) steps -= 1;
  }
  return clamp(steps, 2, 6);
}

/** The DC t sets against `talker` for one skill, including grudges and circumstances. */
export function talkDC(run, talker, t, skill) {
  const s = t.spec.social ?? {};
  const level = t.spec.level ?? 0;
  let dc = skill === "deception" ? (s.perceptionDC ?? level + 15) : (s.willDC ?? level + 15);

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
  if ( ours > theirs ) dc -= skill === "intimidation" ? 3 : 2;
  const side = run.prep.sides[t.side];
  if ( side?.leaderId && side.leaderId !== t.id && !leaderStanding(run, t.side) ) dc -= 2;

  // Personality: loyal and brave hold out, selfish take a deal; neutrals are easy to talk to.
  dc += Math.round((t.prep.traits.loyal - 50) / 25) - Math.round((t.prep.traits.selfish - 50) / 25);
  if ( skill === "intimidation" ) dc += Math.round((t.prep.traits.brave - 50) / 20);
  if ( t.spec.originSide === "neutral" ) dc -= skill === "diplomacy" ? 4 : 2;
  return dc;
}

/** The talker's best pitch at t: {skill, mod, dc, pSuccess}. */
export function bestPitch(run, talker, t) {
  const rules = run.prep.rules;
  const s = talker.spec.social ?? {};
  let best = null;
  for ( const skill of SKILLS ) {
    const mod = s[skill];
    if ( typeof mod !== "number" ) continue;
    const dc = talkDC(run, talker, t, skill);
    const dist = degreeDistribution(rules, mod, dc);
    // Deception backfires harder, so it needs to be clearly better.
    const p = dist[2] + dist[3] - (skill === "deception" ? dist[0] * 0.5 : 0);
    if ( !best || p > best.pSuccess ) best = { skill, mod, dc, pSuccess: Math.max(0, p) };
  }
  return best;
}

/** Choose who to talk to: likely to work, few steps left, and worth taking out of the fight. */
export function choosePitch(run, talker) {
  let best = null;
  for ( const t of enemiesOf(run, talker) ) {
    if ( !swayable(t) || !shareLanguage(talker, t) ) continue;
    if ( t.offendedBy.has(talker.id) ) continue;
    const pitch = bestPitch(run, talker, t);
    if ( !pitch || pitch.pSuccess <= 0.05 ) continue;
    const remaining = Math.max(1, stepsToConvince(t, run) - (t.sway.get(talker.side) ?? 0));
    const isLeader = run.prep.sides[t.side]?.leaderId === t.id;
    const value = (1 + (isLeader ? 1.5 : 0)) * (1 + t.hp / Math.max(1, t.maxHp));
    const score = pitch.pSuccess * value / remaining;
    if ( !best || score > best.score ) best = { target: t, ...pitch, remaining, score };
  }
  return best;
}

/** How many actions u spends talking this turn (0, 1 or 2). */
export function talkActionsThisTurn(run, u, actions) {
  if ( !run.prep.options.talking || actions <= 0 ) return 0;
  const tactic = u.tac?.talk;
  if ( tactic === "never" ) return 0;
  const affinity = u.prep.talkAffinity ?? 0;
  if ( affinity <= 0 && tactic !== "first" ) return 0;
  const pitch = choosePitch(run, u);
  if ( !pitch ) return 0;
  const talker = affinity >= 0.75 || tactic === "first" || !!behaviorOf(u).parleyFirst;
  // The less battle-worthy, and skilled talkers with a promising pitch, put their whole voice into it.
  const max = Math.min(actions, (u.prep.lowBattleWorth || (talker && pitch.pSuccess >= 0.5)) ? 2 : 1);
  // Talkers always get to start swaying on their first turn.
  if ( talker && u.turnsTaken === 0 ) return max;
  if ( tactic === "first" && pitch.pSuccess >= 0.2 ) return max;
  const chance = affinity * (0.2 + pitch.pSuccess) * (u.prep.lowBattleWorth ? 1.5 : 1);
  if ( !run.rng.chance(clamp(chance, 0, 0.95)) ) return 0;
  return (u.prep.lowBattleWorth && pitch.pSuccess >= 0.35) ? max : 1;
}

/** Decide how a convinced enemy leaves the fight. */
function outcomeFor(run, t) {
  const rng = run.rng;
  const selfish = t.prep.traits.selfish;
  const loyal = t.prep.traits.loyal;
  const switchChance = t.spec.originSide === "neutral" ? 0.6 : clamp(0.03 + (selfish - 50) / 500 + (50 - loyal) / 500, 0, 0.12);
  if ( rng.chance(switchChance) ) return SWAY.SWITCH;
  const hurt = t.maxHp > 0 && t.hp / t.maxHp < 0.5;
  if ( !hurt && selfish >= 55 ) return SWAY.FLEE;
  if ( hurt && t.prep.traits.brave < 40 && rng.chance(0.5) ) return SWAY.FLEE;
  return SWAY.SURRENDER;
}

function applyOutcome(run, talker, t, outcome, log) {
  for ( const id of t.adjacent ) run.byId.get(id)?.adjacent.delete(t.id);
  t.adjacent.clear();
  t.swayOutcome = outcome;
  t.swayedBy = talker.id;
  if ( outcome === SWAY.SWITCH ) {
    t.side = talker.side;
    t.targetId = null;
    t.wavering = false;
    log(t, `is won over and switches sides`, { type: "sway", outcome, by: talker.spec.name, byId: talker.id });
    return;
  }
  t.status = outcome === SWAY.FLEE ? STATUS.FLED : STATUS.SURRENDERED;
  t.fellRound ??= run.round;
  log(t, outcome === SWAY.FLEE ? "is talked into leaving and flees" : "lays down arms and surrenders", { type: "sway", outcome, by: talker.spec.name, byId: talker.id });
}

/**
 * Make one pitch. Returns true if the target was convinced.
 * @param {(unit, text) => void} log
 */
export function attemptTalk(run, talker, pitch, log) {
  const t = pitch.target;
  const rules = run.prep.rules;
  const roll = rules.roll(run.rng, pitch.mod, pitch.dc);
  const steps = stepsToConvince(t, run);
  let progress = t.sway.get(talker.side) ?? 0;
  const verb = { diplomacy: "reasons with", intimidation: "threatens", deception: "bluffs" }[pitch.skill];
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
  talker.talkAttempts = (talker.talkAttempts ?? 0) + 1;
  const result = ["critical failure: they won't hear another word", "unmoved", "wavering", "badly shaken"][roll.degree];
  log(talker, `${verb} ${t.spec.name} (${pitch.skill} ${roll.total} vs DC ${pitch.dc}): ${result} [${Math.min(progress, steps)}/${steps}]`, {
    type: "talk", skill: pitch.skill, target: t.spec.name, targetId: t.id, natural: roll.natural, mod: pitch.mod, total: roll.total,
    dc: pitch.dc, dcStat: pitch.skill === "deception" ? "perception" : "will", degree: roll.degree, margin: roll.total - pitch.dc,
    progress: Math.min(progress, steps), steps, offended: roll.degree === 0
  });
  // Only a successful pitch closes the deal, even if circumstances have made them easier to convince.
  if ( roll.degree < 2 || progress < steps ) return false;

  applyOutcome(run, talker, t, outcomeFor(run, t), log);
  talker.talkSuccesses = (talker.talkSuccesses ?? 0) + 1;

  // A convinced leader can take their side with them.
  const side = run.prep.sides[t.spec.side];
  if ( side?.leaderId === t.id ) {
    for ( const f of run.units ) {
      if ( f === t || f.side !== t.spec.side || !swayable(f) ) continue;
      const p = 0.4 + (100 - f.prep.traits.brave) / 250 + (f.sway.get(talker.side) ?? 0) * 0.1;
      if ( run.rng.chance(clamp(p, 0, 0.9)) ) applyOutcome(run, talker, f, SWAY.SURRENDER, log);
    }
  }
  return true;
}

/**
 * Talk affinity 0-1: how readily a unit reaches for words over weapons.
 * Social skill relative to level, playstyles, intelligence and tactics answers.
 */
export function talkAffinity(spec, traits) {
  const s = spec.social;
  if ( !s || s.mindless || !(s.languages?.length) ) return 0;
  const best = Math.max(...SKILLS.map(k => (typeof s[k] === "number" ? s[k] : -99)));
  if ( best <= -99 ) return 0;
  const rel = best - ((spec.level ?? 0) + 4);
  let a = 0.35 + rel * 0.08;
  const ps = new Set(spec.playstyles ?? []);
  if ( ps.has("diplomat") ) a += 0.45;
  if ( ps.has("peoplePleaser") ) a += 0.2;
  if ( ps.has("leader") ) a += 0.15;
  if ( ps.has("instigator") || ps.has("cruel") ) a += 0.1;
  if ( ps.has("brawler") || ps.has("impatient") || ps.has("speedRunner") ) a -= 0.25;
  if ( (traits?.tactical ?? 50) < 20 ) a -= 0.3;
  if ( spec.tactics?.talk === "first" ) a = Math.max(a, 0.8);
  if ( spec.roleplay && (ps.has("diplomat") || ps.has("peoplePleaser")) ) a += 0.15;
  return clamp(a, 0, 1);
}

