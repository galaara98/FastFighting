/**
 * Desires: what each character wants right now, and how badly. They're the character's reasoning made visible.
 *
 *   logic       what its tactical thinking concludes this turn: the foe it would go for (and the runners-up), the
 *               friend it would heal, the one it would talk to, the one it fears. Worked out afresh each turn.
 *   stated      what the GM or player says it wants (Tactics), at the stated level.
 *   memory      what the fight has stirred: whoever hurt it, whoever felled a friend. Cools a little every round.
 *   frustration what has thwarted it: a locked door that won't give, a target it can't reach, getting hurt on the
 *               way. It wears the desire down until the character moves on.
 *   social      what the others want: its leader's desires pull on it a medium amount, its team's (the average of
 *               its friends') a little. With nobody leading (none chosen, or the leader fallen), the team pulls
 *               together less: the team's pull and the wish to heal or guard each other dip (vengeance doesn't). Playstyles change that: a would-be leader who isn't the leader half ignores
 *               the leader, a chaotic one barely hears anyone, People-Pleasers and Enablers listen harder, and a
 *               contrarian (chaotic, or an instigator, who isn't leading) may lean away from what the leader wants.
 *
 * A desire's level is max(logic, stated) + memory + social - frustration, 0 to 100:
 *   {kind: "hurt" | "heal" | "protect" | "aid" | "talk" | "avoid", targetId, level}   (aid: bolster with a buff)
 *
 * The strongest desire leads. Much weaker ones (BLIND_GAP or more below it) don't cross the character's mind, and
 * an obsessed character (OBSESSED+) stops worrying about its own safety.
 */
import { STATUS } from "../../constants.js";
import { areEnemies, isStanding, liveTrait, enemiesOf } from "../battle-state.js";
import { perceives, apparentHealth } from "./senses.js";

/** A character's playstyle guide for desires (from its pills), or the neutral one. */
const NEUTRAL_STYLE = Object.freeze({ hurt: {}, avoid: {}, heal: 0, protect: 0, aid: 0, talk: 0, whim: 0, contrarian: 0, retaliate: 1, avenge: 1, cool: 1, frustration: 1, leader: 1, team: 1, doorPatience: 1 });
export const styleOf = u => u.spec?.desireStyle ?? NEUTRAL_STYLE;

export const DESIRE_KINDS = Object.freeze(["hurt", "heal", "protect", "aid", "talk", "avoid"]);
/** Desires a creature may have about itself: mending itself, bolstering itself. */
const SELF_KINDS = new Set(["heal", "aid"]);
/** Band floors: passing, wants, determined, driven, obsessed. */
export const DESIRE_BANDS = Object.freeze([0, 20, 40, 60, 80]);
export const DESIRE_BAND_KEYS = Object.freeze(["passing", "wants", "determined", "driven", "obsessed"]);
/** Where the foe a character's tactics pick lands (a clear choice reaches a little higher). */
export const CHOICE_LEVEL = 45;
/** Desires this far below the strongest one don't cross the character's mind. */
export const BLIND_GAP = 20;
export const OBSESSED = 80;

const clamp = v => Math.max(0, Math.min(100, v));
const keyOf = (kind, targetId) => `${kind}|${targetId}`;

/** 0 passing ... 4 obsessed. */
export function desireBand(level) {
  let band = 0;
  for ( let i = 0; i < DESIRE_BANDS.length; i++ ) if ( level >= DESIRE_BANDS[i] ) band = i;
  return band;
}

/** A unit's desires at the start of the fight: what it was told to want. */
export function initDesires(u) {
  u.desire = { stated: new Map(), memory: new Map(), frustration: new Map(), logic: new Map(), social: new Map(), style: new Map() };
  for ( const d of u.spec.desires ?? [] ) {
    if ( !DESIRE_KINDS.includes(d.kind) || !d.targetId || d.targetId === u.id ) continue;
    u.desire.stated.set(keyOf(d.kind, d.targetId), clamp(Number(d.level) || 0));
  }
}

/** A new turn: the reasoning starts over, and what the fight stirred cools a little. */
export function newTurn(u) {
  if ( !u.desire ) return;
  u.desire.logic.clear();
  u.desire.social.clear();
  u.desire.style.clear();
  const cool = 2 * styleOf(u).cool; // (a vengeful character's grudges never cool)
  for ( const [k, v] of u.desire.memory ) {
    if ( v <= cool ) u.desire.memory.delete(k);
    else u.desire.memory.set(k, v - cool);
  }
}

/** What the unit's tactics conclude this turn (the strongest reason for each kind and target wins). */
export function think(u, kind, targetId, level) {
  if ( !u.desire || !targetId || (targetId === u.id && !SELF_KINDS.has(kind)) ) return;
  const k = keyOf(kind, targetId);
  u.desire.logic.set(k, Math.max(u.desire.logic.get(k) ?? 0, clamp(level)));
}

/** The fight stirs something: want it more. */
export function want(u, kind, targetId, amount) {
  if ( !u.desire || !targetId || targetId === u.id || !(amount > 0) ) return;
  const k = keyOf(kind, targetId);
  u.desire.memory.set(k, clamp((u.desire.memory.get(k) ?? 0) + amount));
}

/** Something got in the way: the desire wears down (faster for the faint-hearted). */
export function thwart(run, u, kind, targetId, amount) {
  if ( !u.desire || !targetId ) return;
  const k = keyOf(kind, targetId);
  const brave = liveTrait(run, u, "brave");
  u.desire.frustration.set(k, (u.desire.frustration.get(k) ?? 0) + amount * (1.3 - brave / 100) * styleOf(u).frustration);
}

/** The obstacle is gone (the door gave way): most of the frustration with it. */
export function relieve(u, kind, targetId, share = 0.75) {
  const k = keyOf(kind, targetId);
  const f = u.desire?.frustration.get(k);
  if ( f ) u.desire.frustration.set(k, f * (1 - share));
}

/** How badly u wants this now. */
export function levelOf(u, kind, targetId) {
  const d = u.desire;
  if ( !d ) return 0;
  const k = keyOf(kind, targetId);
  return clamp(Math.max(d.logic.get(k) ?? 0, d.stated.get(k) ?? 0) + (d.style.get(k) ?? 0) + (d.memory.get(k) ?? 0) + (d.social.get(k) ?? 0) - (d.frustration.get(k) ?? 0));
}

/** Is a desire still something the unit can act on? (Healing itself counts: a potion when it's hurt.) */
function relevant(run, u, kind, t) {
  if ( !t || !t.active || (t === u && !SELF_KINDS.has(kind)) ) return false;
  if ( [STATUS.DEAD, STATUS.FLED].includes(t.status) ) return false;
  switch ( kind ) {
    case "hurt": return areEnemies(run, u, t) && t.status !== STATUS.SURRENDERED && t.status !== STATUS.STOOD_DOWN;
    case "avoid": return areEnemies(run, u, t) && isStanding(t);
    case "talk": return t.status === STATUS.STANDING;
    case "heal": return !areEnemies(run, u, t) && (t.status === STATUS.DOWN || t.hp < t.maxHp);
    case "protect": return !areEnemies(run, u, t);
    case "aid": return !areEnemies(run, u, t) && isStanding(t);
    default: return false;
  }
}

/** Every desire the unit can act on, strongest first: [{kind, targetId, level}]. */
export function rankedDesires(run, u) {
  const d = u.desire;
  if ( !d ) return [];
  const keys = new Set([...d.logic.keys(), ...d.stated.keys(), ...d.memory.keys(), ...d.social.keys(), ...d.style.keys()]);
  const out = [];
  for ( const k of keys ) {
    const [kind, targetId] = k.split("|");
    if ( !relevant(run, u, kind, run.byId.get(targetId)) ) continue;
    const level = levelOf(u, kind, targetId);
    if ( level <= 0 ) continue;
    // What's driving it: the tactics' own reasoning, or something stated or stirred on top of it.
    const logic = d.logic.get(k) ?? 0;
    const driven = (d.stated.get(k) ?? 0) > logic ? "stated" : (d.memory.get(k) ?? 0) >= 10 ? "memory" : (d.social.get(k) ?? 0) >= 10 ? "social" : "logic";
    out.push({ kind, targetId, level, driven });
  }
  return out.sort((a, b) => b.level - a.level);
}

/**
 * What's on the unit's mind: the leading desire, whether another desire is still in view (within BLIND_GAP of the
 * lead), and whether the lead is an obsession.
 */
export function mind(run, u) {
  const ranked = rankedDesires(run, u);
  const lead = ranked[0] ?? null;
  const floor = (lead?.level ?? 0) - BLIND_GAP;
  return {
    lead,
    ranked,
    // Only a desire stated, or stirred by the fight, blinds; the tactics' own reasoning (and the others' pull) weighs
    // everything.
    blinding: !!lead && (lead.driven === "stated" || lead.driven === "memory"),
    inView: (kind, targetId) => levelOf(u, kind, targetId) >= floor,
    kindInView: kind => ranked.some(d => d.kind === kind && d.level >= floor),
    obsessed: !!lead && lead.level >= OBSESSED
  };
}

/** Is u set on keeping away from t (a fear that's on its mind)? */
export function avoids(run, u, t) {
  const level = levelOf(u, "avoid", t.id);
  if ( level <= 0 ) return false;
  return level >= (rankedDesires(run, u)[0]?.level ?? 0) - BLIND_GAP;
}

/** No one leading this side: there never was a leader, or the leader is down, dead or gone. */
export function leaderless(run, side) {
  const leader = run.byId.get(run.prep.sides[side]?.leaderId);
  return !leader || !isStanding(leader);
}

/** A leaderless team pulls together a little less (vengeance aside). */
export const LEADERLESS = Object.freeze({ team: 0.7, cooperative: 6 });

/** How much the leader's and the team's desires pull on u (negative: it leans away). Playstyles shape it. */
export function influence(run, u) {
  const isLeader = run.prep.sides[u.side]?.leaderId === u.id;
  const style = styleOf(u);
  const loyal = Math.max(0, Math.min(1.6, liveTrait(run, u, "loyal") / 60));
  // Its pills say how much it listens: a would-be leader half ignores the leader, a people-pleaser hangs on every
  // word, a wildcard barely hears anyone.
  let leader = isLeader ? 0 : 0.35 * loyal * style.leader;
  // Without anyone leading, the team's wishes carry less.
  const team = 0.15 * loyal * style.team * (leaderless(run, u.side) ? LEADERLESS.team : 1);
  // A contrarian (an instigator, a wildcard) who isn't leading decides, once a fight, to go against its leader.
  if ( style.contrarian > 0 && !isLeader && !u.spec.behavior?.leads ) {
    u.contrarian ??= run.rng.chance(style.contrarian);
    if ( u.contrarian ) leader = -Math.max(leader, 0.15);
  }
  return { leader, team };
}

/**
 * The playstyle's say in what u wants this turn: points toward the foes and friends that suit its pills (the
 * nearest, the weakest, the most dangerous, casters, the fallen, their leader, a weakness to exploit; a friend to
 * heal or guard; someone to talk to; something to fear; a whim).
 * @param {{t, moves}[]} scored  The foes its tactics weighed
 */
export function styleWants(run, u, scored, { canHeal = false, canTalk = false, talkTarget = null, canAid = false } = {}) {
  const s = styleOf(u);
  if ( !u.desire || s === NEUTRAL_STYLE ) return;
  const add = (kind, id, points) => {
    if ( !points || !id || (id === u.id && !SELF_KINDS.has(kind)) ) return;
    const k = keyOf(kind, id);
    u.desire.style.set(k, (u.desire.style.get(k) ?? 0) + points);
  };
  const frac = t => (t.maxHp > 0 ? t.hp / t.maxHp : 1);
  // How hurt they look: friends in trouble are noticed by any sense; a foe's weakness only when it can really tell.
  const looks = t => (areEnemies(run, u, t) ? apparentHealth(run, u, t) : perceives(run, u, t, { crisis: true }) ? frac(t) : 1);
  const danger = t => (Number(t.spec.level) || 0) * 2 + (t.damageDealt ?? 0) / 5;
  const h = s.hurt ?? {};
  const foes = scored.map(x => x.t);
  const min = scored.length ? Math.min(...scored.map(x => x.moves)) : 0;
  const weakest = foes.length ? foes.reduce((a, b) => (looks(b) < looks(a) ? b : a)) : null;
  const dangerous = foes.length ? foes.reduce((a, b) => (danger(b) > danger(a) ? b : a)) : null;
  const mine = new Set((u.prep.offense ?? []).flatMap(a => (a.damage ?? []).map(p => p.type)));
  for ( const x of scored ) {
    const t = x.t;
    let points = 0;
    if ( h.nearest && x.moves === min ) points += h.nearest;
    if ( h.far && x.moves >= 2 ) points += h.far;
    if ( h.weakest && t === weakest ) points += h.weakest;
    if ( h.dangerous && t === dangerous ) points += h.dangerous;
    if ( h.casters && t.prep?.isCaster ) points += h.casters;
    if ( h.healers && t.prep?.isHealer ) points += h.healers;
    if ( h.leader && run.prep.sides[t.side]?.leaderId === t.id ) points += h.leader;
    if ( h.weakness && Object.keys(t.spec.iwr?.weak ?? {}).some(k => mine.has(k)) ) points += h.weakness;
    if ( h.unstudied && !u.studied?.has(t.id) ) points += h.unstudied;
    if ( h.current && t.id === u.targetId ) points += h.current;
    add("hurt", t.id, points);
  }
  // The fallen: some can't resist finishing them, some never would.
  if ( h.downed ) for ( const t of enemiesOf(run, u) ) if ( t.active && t.status === STATUS.DOWN && !t.stable && perceives(run, u, t) ) add("hurt", t.id, h.downed);
  // Friends: one to mend, one to guard.
  const friends = run.units.filter(a => a !== u && a.side === u.side && a.active && ![STATUS.DEAD, STATUS.FLED].includes(a.status));
  if ( canHeal && s.heal ) for ( const a of friends ) if ( perceives(run, u, a, { crisis: true }) && (a.status === STATUS.DOWN || frac(a) < 0.75) ) add("heal", a.id, s.heal);
  if ( s.protect ) add("protect", friends.filter(isStanding).sort((a, b) => looks(a) - looks(b))[0]?.id, s.protect);
  // Bolstering: the friend doing the most fighting (its leader, for those who look to one).
  if ( canAid && s.aid ) {
    const leaderId = run.prep.sides[u.side]?.leaderId;
    const chief = friends.find(a => a.id === leaderId && isStanding(a));
    const fighter = friends.filter(isStanding).sort((a, b) => (b.damageDealt ?? 0) - (a.damageDealt ?? 0))[0];
    add("aid", (s.leader > 1 ? chief : null)?.id ?? fighter?.id, s.aid);
  }
  if ( canTalk && s.talk ) add("talk", talkTarget, s.talk);
  // Fear: of the most dangerous foe, of whoever is hurting it once it's hurt, of whatever comes close.
  const avoid = s.avoid ?? {};
  if ( avoid.dangerous ) add("avoid", dangerous?.id, avoid.dangerous);
  if ( avoid.attacker && frac(u) < 0.6 ) add("avoid", u.lastAttackerId, avoid.attacker);
  if ( avoid.nearest ) add("avoid", scored.find(x => x.moves === min)?.t.id, avoid.nearest);
  // A whim: some foe catches its eye.
  if ( s.whim && foes.length && run.rng.chance(0.3) ) add("hurt", run.rng.pick(foes).id, s.whim);
}

/**
 * Let the others' desires pull on u: its leader's (a medium amount), its team's (a little), as far as u can act on
 * them (a leader's wish to heal someone means nothing to a creature that can't heal).
 */
export function listen(run, u, { canHeal = false, canTalk = false, canAid = false } = {}) {
  if ( !u.desire ) return;
  const { leader, team } = influence(run, u);
  const fits = kind => kind === "hurt" || kind === "avoid" || kind === "protect" || (kind === "heal" && canHeal) || (kind === "talk" && canTalk) || (kind === "aid" && canAid);
  const pull = (kind, targetId, amount) => {
    if ( !fits(kind) || targetId === u.id || !amount ) return;
    const k = keyOf(kind, targetId);
    u.desire.social.set(k, (u.desire.social.get(k) ?? 0) + amount);
  };
  // Leaderless, the team is less coordinated: wanting to mend or guard each other dips a little. (Vengeance doesn't:
  // a fallen leader is a reason to settle scores, not to stop caring.)
  if ( leaderless(run, u.side) ) {
    for ( const k of new Set([...u.desire.logic.keys(), ...u.desire.style.keys(), ...u.desire.stated.keys()]) ) {
      const [kind, targetId] = k.split("|");
      if ( (kind === "heal" || kind === "protect" || kind === "aid") && targetId !== u.id ) u.desire.social.set(k, (u.desire.social.get(k) ?? 0) - LEADERLESS.cooperative);
    }
  }
  const leaderUnit = run.byId.get(run.prep.sides[u.side]?.leaderId);
  if ( leader && leaderUnit && leaderUnit !== u && isStanding(leaderUnit) ) {
    for ( const d of leaderUnit.lastDesires ?? [] ) pull(d.kind, d.targetId, leader * d.level);
  }
  if ( team ) {
    const friends = run.units.filter(o => o !== u && o.side === u.side && isStanding(o) && o.lastDesires?.length);
    if ( friends.length ) {
      const sums = new Map();
      for ( const f of friends ) for ( const d of f.lastDesires ) sums.set(keyOf(d.kind, d.targetId), (sums.get(keyOf(d.kind, d.targetId)) ?? 0) + d.level);
      for ( const [k, sum] of sums ) {
        const [kind, targetId] = k.split("|");
        pull(kind, targetId, team * sum / friends.length);
      }
    }
  }
}

/** Remember what's on u's mind, for its friends and followers to hear next. */
export function remember(run, u) {
  u.lastDesires = rankedDesires(run, u).slice(0, 5).map(d => ({ kind: d.kind, targetId: d.targetId, level: d.level }));
}

/** The thoughts worth telling: the two strongest things on the unit's mind, with the targets' names. */
export function thoughts(run, u) {
  return rankedDesires(run, u).slice(0, 2).map(d => ({ ...d, level: Math.round(d.level), target: run.byId.get(d.targetId)?.spec.name ?? "" }));
}

/**
 * Levels for a ranked list of reasons of one kind (targets scored by the unit's tactics): the clear favorite lands
 * a little above CHOICE_LEVEL, the runners-up below it in proportion.
 * @param {{id: string, score: number}[]} scored  Best first
 */
export function levelsFromScores(scored) {
  if ( !scored.length ) return [];
  const best = Math.max(1e-9, scored[0].score);
  const second = scored[1] ? Math.max(0, scored[1].score) : 0;
  const lead = CHOICE_LEVEL + 15 * Math.max(0, 1 - second / best);
  return scored.map((s, i) => ({ id: s.id, level: i === 0 ? lead : Math.max(5, CHOICE_LEVEL * Math.max(0, s.score) / best) }));
}
