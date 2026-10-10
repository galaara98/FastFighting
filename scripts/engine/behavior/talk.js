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
 * gives something up (money or an item, then backs off), or (rarely, unless they were neutral) switches sides.
 * Player characters decide their own fate, so words can only make a PC give something up or back off and run; a
 * PC who would rather let weapons do the talking won't listen at all. In a standoff, giving something up or
 * running ends the whole conflict: the deal is struck and everyone walks away. Convincing a leader can make the rest of
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
import { STATUS, SWAY, CONCEDE_LUCK, clamp } from "../../constants.js";
import { alliesOf, enemiesOf, isStanding, behaviorOf, leaderStanding, typical, checkRoll } from "../battle-state.js";
import { degreeDistribution, rollCheck } from "../probability.js";

/** The three kinds of pitch. Systems map their own skills onto these (CombatantSpec.social.pitches). */
export const TALK_KINDS = Object.freeze(["persuade", "intimidate", "deceive"]);
const VERB = { persuade: "reasons with", intimidate: "threatens", deceive: "bluffs" };

export function shareLanguage(a, b) {
  const la = a.spec.social?.languages ?? [];
  const lb = b.spec.social?.languages ?? [];
  return la.some(l => lb.includes(l));
}

/** What t still has to hand over, after anything already given up this fight. */
function remaining(t) {
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

/**
 * Successful pitches needed to convince t (2-6, or 1 if very gullible). With `run`, the situation counts:
 * a badly hurt or outnumbered enemy is one step easier to talk down.
 */
export function stepsToConvince(t, run = null) {
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
  if ( t.spec.originSide === "neutral" ) steps -= 1;
  if ( t.spec.kind === "pc" ) steps += 2; // a player character does not fold easily
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
  const side = run.prep.sides[t.side];
  if ( side?.leaderId && side.leaderId !== t.id && !leaderStanding(run, t.side) ) dc -= 2;

  // Personality: loyal and brave hold out, selfish take a deal; neutrals are easy to talk to.
  dc += Math.round((t.prep.traits.loyal - 50) / 25) - Math.round((t.prep.traits.selfish - 50) / 25);
  if ( kind === "intimidate" ) dc += Math.round((t.prep.traits.brave - 50) / 20);
  if ( t.spec.originSide === "neutral" ) dc -= kind === "persuade" ? 4 : 2;
  return dc;
}

/** The talker's best pitch at t: {kind, skill, mod, advantage, dc, dcLabel, pSuccess}. */
export function bestPitch(run, talker, t) {
  const rules = run.prep.rules;
  const s = talker.spec.social ?? {};
  let best = null;
  // A PC with nothing to hand over can only be scared off; reasoning or bluffing gets nowhere.
  const scareOnly = t.spec.kind === "pc" && !hasValuables(t);
  for ( const kind of TALK_KINDS ) {
    const pitch = s.pitches?.[kind];
    if ( typeof pitch?.mod !== "number" ) continue;
    if ( scareOnly && kind !== "intimidate" ) continue;
    const { mod, advantage } = checkRoll(run, talker, pitch.mod);
    const dc = talkDC(run, talker, t, kind);
    const dist = degreeDistribution(rules, mod, dc, { advantage, kind: "check" });
    // A bluff backfires harder, so it needs to be clearly better.
    const p = dist[2] + dist[3] - (kind === "deceive" ? dist[0] * 0.5 : 0);
    if ( !best || p > best.pSuccess ) {
      best = { kind, skill: pitch.skill ?? kind, mod, advantage, dc, dcLabel: t.spec.social?.resist?.[kind]?.label ?? "DC", pSuccess: Math.max(0, p) };
    }
  }
  return best;
}

/** Choose who to talk to: likely to work, few steps left, and worth taking out of the fight. */
export function choosePitch(run, talker, { only = null } = {}) {
  let best = null;
  for ( const t of enemiesOf(run, talker) ) {
    if ( !swayable(t) || !shareLanguage(talker, t) ) continue;
    if ( t.offendedBy.has(talker.id) ) continue;
    if ( only && !only(t) ) continue;
    const pitch = bestPitch(run, talker, t);
    if ( !pitch || pitch.pSuccess <= (talker.spec.alwaysTalk ? 0.01 : 0.05) ) continue;
    const remaining = Math.max(1, stepsToConvince(t, run) - (t.sway.get(talker.side) ?? 0));
    const isLeader = run.prep.sides[t.side]?.leaderId === t.id;
    const value = (1 + (isLeader ? 1.5 : 0)) * (1 + t.hp / Math.max(1, t.maxHp));
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
  // Talkers always get to start swaying on their first turn.
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
function outcomeFor(run, t, kind) {
  const rng = run.rng;
  // Words can only make a PC pay up or back off: threats may send them running (the only way, if they have nothing).
  if ( t.spec.kind === "pc" ) {
    if ( !hasValuables(t) ) return SWAY.FLEE;
    if ( kind === "intimidate" && rng.chance(clamp(0.5 - (t.prep.traits.brave - 50) / 100, 0.1, 0.8)) ) return SWAY.FLEE;
    return SWAY.CONCEDE;
  }
  const selfish = t.prep.traits.selfish;
  const loyal = t.prep.traits.loyal;
  const switchChance = t.spec.originSide === "neutral" ? 0.6 : clamp(0.03 + (selfish - 50) / 500 + (50 - loyal) / 500, 0, 0.12);
  if ( rng.chance(switchChance) ) return SWAY.SWITCH;
  // Paying them off: rarer than backing down, likelier under threat or when badly hurt; the greedy hate it.
  const hurt = t.maxHp > 0 && t.hp / t.maxHp < 0.5;
  const concedeChance = clamp(0.12 + (kind === "intimidate" ? 0.15 : 0) + (hurt ? 0.1 : 0) - (selfish - 50) / 400, 0.03, 0.45);
  if ( rng.chance(concedeChance) ) return SWAY.CONCEDE;
  if ( run.standoff && kind !== "intimidate" ) return SWAY.STAND_DOWN;
  if ( !hurt && selfish >= 55 ) return SWAY.FLEE;
  if ( hurt && t.prep.traits.brave < 40 && rng.chance(0.5) ) return SWAY.FLEE;
  return SWAY.SURRENDER;
}

/**
 * What a creature hands over when it gives something up: 1-10% of its money; failing that an item it carries but
 * isn't wielding or wearing (a PC keeps it unless a d100 luck check comes up under 40); failing that, an NPC gives
 * up something it's wielding. Returns null when there's nothing at all (an NPC then lies and runs).
 */
function concession(run, t) {
  const v = remaining(t);
  const rng = run.rng;
  if ( v.money > 0 ) {
    const percent = rng.die(10);
    return { kind: "money", amount: Math.max(1, Math.round(v.money * percent / 100)), percent, denominations: v.denominations ?? null };
  }
  if ( v.stowed.length ) {
    const item = rng.pick(v.stowed);
    if ( t.spec.kind === "pc" ) {
      const luck = rng.die(100);
      return { kind: "item", item, luck, kept: luck >= CONCEDE_LUCK };
    }
    return { kind: "item", item };
  }
  if ( t.spec.kind !== "pc" && v.wielded.length ) return { kind: "item", item: rng.pick(v.wielded), wielded: true };
  return null;
}

/** In a standoff, giving something up or running settles the whole thing: everyone walks away. */
function settle(run, talker, outcome) {
  if ( run.standoff && !run.resolved && [SWAY.CONCEDE, SWAY.FLEE].includes(outcome) ) run.resolved = { side: talker.side, outcome };
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

function applyOutcome(run, talker, t, outcome, log) {
  settle(run, talker, outcome === SWAY.CONCEDE && !hasValuables(t) && t.spec.kind !== "pc" ? SWAY.FLEE : outcome);
  if ( outcome === SWAY.CONCEDE ) return concede(run, talker, t, log);
  for ( const id of t.adjacent ) run.byId.get(id)?.adjacent.delete(t.id);
  t.adjacent.clear();
  t.swayOutcome = outcome;
  if ( outcome === SWAY.SWITCH ) {
    t.side = talker.side;
    t.targetId = null;
    t.wavering = false;
    log(t, `is won over and switches sides`, { type: "sway", outcome, by: talker.spec.name, byId: talker.id });
    return;
  }
  t.status = { [SWAY.FLEE]: STATUS.FLED, [SWAY.STAND_DOWN]: STATUS.STOOD_DOWN }[outcome] ?? STATUS.SURRENDERED;
  t.fellRound ??= run.round;
  const text = { [SWAY.FLEE]: "is talked into leaving and flees", [SWAY.STAND_DOWN]: "agrees to stand down" }[outcome] ?? "lays down arms and surrenders";
  log(t, text, { type: "sway", outcome, by: talker.spec.name, byId: talker.id });
}

/**
 * Make one pitch. Returns true if the target was convinced.
 * @param {(unit, text) => void} log
 */
export function attemptTalk(run, talker, pitch, log) {
  const t = pitch.target;
  const rules = run.prep.rules;
  const roll = rollCheck(rules, run.rng, pitch.mod, pitch.dc, { advantage: pitch.advantage ?? 0, kind: "check" });
  const steps = stepsToConvince(t, run);
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
  if ( run.log ) log(talker, `${verb} ${t.spec.name} (${pitch.skill} ${roll.total} vs DC ${pitch.dc}): ${result} [${Math.min(progress, steps)}/${steps}]`, {
    type: "talk", kind: pitch.kind, skill: pitch.skill, target: t.spec.name, targetId: t.id, natural: roll.natural, mod: pitch.mod, total: roll.total,
    dc: pitch.dc, dcStat: pitch.dcLabel, degree: roll.degree, margin: roll.total - pitch.dc,
    progress: Math.min(progress, steps), steps, offended: roll.degree === 0
  });
  // Only a successful pitch closes the deal, even if circumstances have made them easier to convince.
  if ( roll.degree < 2 || progress < steps ) return false;

  const outcome = outcomeFor(run, t, pitch.kind);
  applyOutcome(run, talker, t, outcome, log);

  // A convinced leader can take their side with them.
  const side = run.prep.sides[t.spec.side];
  if ( side?.leaderId === t.id ) {
    for ( const f of run.units ) {
      if ( f === t || f.side !== t.spec.side || f.spec.kind === "pc" || !swayable(f) ) continue;
      const p = 0.4 + (100 - f.prep.traits.brave) / 250 + (f.sway.get(talker.side) ?? 0) * 0.1;
      const follows = [SWAY.STAND_DOWN, SWAY.CONCEDE].includes(outcome) ? SWAY.STAND_DOWN : SWAY.SURRENDER;
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
  if ( ps.has("peoplePleaser") ) a += 0.2;
  if ( ps.has("leader") ) a += 0.15;
  if ( ps.has("instigator") || ps.has("cruel") ) a += 0.1;
  if ( ps.has("brawler") || ps.has("impatient") || ps.has("speedRunner") ) a -= 0.25;
  if ( (traits?.tactical ?? 50) < 20 ) a -= 0.3;
  if ( spec.tactics?.talk === "first" ) a = Math.max(a, 0.8);
  if ( spec.roleplay && (ps.has("diplomat") || ps.has("peoplePleaser")) ) a += 0.15;
  // "Always prefers talking to fighting": much keener, however unskilled; only a little when staying true.
  if ( spec.alwaysTalk ) a = spec.stayTrue ? a + 0.1 : Math.max(a + 0.4, 0.85);
  return clamp(a, 0, 1);
}

