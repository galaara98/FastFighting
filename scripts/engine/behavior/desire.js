/**
 * Desires: what each character wants right now, and how badly. They're the character's reasoning made visible.
 *
 *   logic       what its tactical thinking concludes this turn: the foe it would go for (and the runners-up), the
 *               friend it would heal, the one it would talk to, the one it fears. Worked out afresh each turn.
 *   stated      what the GM or player says it wants (Tactics), at the stated level.
 *   lean        which way someone who takes no side leans: the members of the side it would rather see safe
 *               (behavior/neutral.js). It counts like a stated desire, but it doesn't blind.
 *   memory      what the fight has stirred: whoever hurt it, whoever felled a friend. Cools a little every round.
 *   frustration what has thwarted it: a locked door that won't give, a target it can't reach, getting hurt on the
 *               way. It wears the desire down until the character moves on.
 *   social      what the others want. Each turn it may take its lead from whoever commands its group (its boss or
 *               leader, or a lieutenant who stepped up: battle-state.js command), as readily as the world's leader
 *               influence, its loyalty and its pills say (a boss, several times as readily): then it wants the
 *               topmost thing its commander wants that it can actually do, and its playstyle leans toward the
 *               commander's for the turn. Its team's wishes (the average of its friends') pull a little, always.
 *               With nobody able to lead, the team pulls together less: the team's pull and the wish to heal or guard
 *               each other dip (vengeance doesn't). Playstyles change how readily it follows: one who wants to lead
 *               (but doesn't) half ignores its commander, a chaotic one barely hears anyone, People-Pleasers and
 *               Enablers listen harder, and a contrarian (chaotic, or an instigator) may lean away from what its
 *               commander wants.
 *   asked       friends asking it for a buff (their "bolstered" desires naming it): no roll, only that they can make
 *               themselves understood and that it's willing (see heed).
 *
 * A desire's level is max(logic, stated) + memory + social - frustration, 0 to 100:
 *   {kind: "hurt" | "heal" | "protect" | "aid" | "talk" | "avoid" | "bolstered", targetId, level}
 *   (aid: bolster with a buff; bolstered: to be bolstered by that friend. A request, not something it acts on itself:
 *   the friend hears it and, if willing, wants to aid it.)
 *
 * The strongest desire leads. Much weaker ones (BLIND_GAP or more below it) don't cross the character's mind, and
 * an obsessed character (OBSESSED+) stops worrying about its own safety.
 */
import { STATUS } from "../../constants.js";
import { areEnemies, isStanding, liveTrait, enemiesOf, alliesOf, sizedUp, command, commandOf, refusesToHelp } from "../battle-state.js";
import { perceives, apparentHealth } from "./senses.js";
import { seemsFoe } from "./neutral.js";

/** A character's playstyle guide for desires (from its pills), or the neutral one. */
const NEUTRAL_STYLE = Object.freeze({ hurt: {}, avoid: {}, heal: 0, protect: 0, aid: 0, talk: 0, whim: 0, contrarian: 0, retaliate: 1, avenge: 1, cool: 1, frustration: 1, leader: 1, team: 1, doorPatience: 1 });
export const styleOf = u => u.turnStyle ?? u.spec?.desireStyle ?? NEUTRAL_STYLE;
/** Its own pills' guide, whoever it follows this turn (worked out again without a pill it lost: dropAmbition). */
const ownStyle = u => u.ownDesireStyle ?? u.spec?.desireStyle ?? NEUTRAL_STYLE;

export const DESIRE_KINDS = Object.freeze(["hurt", "heal", "protect", "aid", "talk", "avoid", "bolstered"]);
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
/** A key's kind and target, read once (desires are ranked many times a turn). */
const PARSED = new Map();
function parseKey(k) {
  let p = PARSED.get(k);
  if ( !p ) {
    const at = k.indexOf("|");
    PARSED.set(k, p = [k.slice(0, at), k.slice(at + 1)]);
  }
  return p;
}
/** Every key u has a desire under, once each. */
function desireKeys(d) {
  const keys = new Set(d.logic.keys());
  for ( const m of [d.stated, d.lean, d.memory, d.social, d.style] ) for ( const k of m.keys() ) keys.add(k);
  return keys;
}

/** 0 passing ... 4 obsessed. */
export function desireBand(level) {
  let band = 0;
  for ( let i = 0; i < DESIRE_BANDS.length; i++ ) if ( level >= DESIRE_BANDS[i] ) band = i;
  return band;
}

/** A unit's desires at the start of the fight: what it was told to want. */
export function initDesires(u) {
  u.desire = { stated: new Map(), memory: new Map(), frustration: new Map(), logic: new Map(), social: new Map(), style: new Map(), lean: new Map() };
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
  return clamp(Math.max(d.logic.get(k) ?? 0, d.stated.get(k) ?? 0, d.lean.get(k) ?? 0) + (d.style.get(k) ?? 0) + (d.memory.get(k) ?? 0) + (d.social.get(k) ?? 0) - (d.frustration.get(k) ?? 0));
}

/** Point a lean (behavior/neutral.js) at these: [[kind, targetId, level]], in place of the last one. */
export function setLean(u, entries) {
  if ( !u.desire ) return;
  u.desire.lean.clear();
  for ( const [kind, id, level] of entries ) {
    if ( !id || id === u.id || !(level > 0) ) continue;
    const k = keyOf(kind, id);
    u.desire.lean.set(k, Math.max(u.desire.lean.get(k) ?? 0, clamp(level)));
  }
}

/**
 * Everything u wants, whether or not it can act on it now (someone who takes no side still wants its friends safe
 * and its enemies hurt): [{kind, targetId, level}], strongest first.
 */
export function allDesires(u) {
  const d = u.desire;
  if ( !d ) return [];
  const out = [];
  for ( const k of desireKeys(d) ) {
    const [kind, targetId] = parseKey(k);
    const level = levelOf(u, kind, targetId);
    if ( level > 0 ) out.push({ kind, targetId, level });
  }
  return out.sort((a, b) => b.level - a.level);
}

/** Is a desire still something the unit can act on? (Healing itself counts: a potion when it's hurt.) */
function relevant(run, u, kind, t) {
  if ( !t || !t.active || (t === u && !SELF_KINDS.has(kind)) ) return false;
  if ( [STATUS.DEAD, STATUS.FLED].includes(t.status) ) return false;
  switch ( kind ) {
    case "hurt": return (areEnemies(run, u, t) || seemsFoe(run, u, t)) && t.status !== STATUS.SURRENDERED && t.status !== STATUS.STOOD_DOWN;
    case "avoid": return areEnemies(run, u, t) && isStanding(t);
    case "talk": return t.status === STATUS.STANDING;
    case "heal": return !areEnemies(run, u, t) && (t.status === STATUS.DOWN || t.hp < t.maxHp) && !refusesToHelp(run, u, t);
    case "protect": return !areEnemies(run, u, t) && !refusesToHelp(run, u, t);
    case "aid": return !areEnemies(run, u, t) && isStanding(t) && !refusesToHelp(run, u, t);
    // (Wanting a friend's buff is for the friend to act on: see heed.)
    default: return false;
  }
}

/** Every desire the unit can act on, strongest first: [{kind, targetId, level}]. */
export function rankedDesires(run, u) {
  const d = u.desire;
  if ( !d ) return [];
  const out = [];
  for ( const k of desireKeys(d) ) {
    const [kind, targetId] = parseKey(k);
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
  return level >= leadLevel(run, u) - BLIND_GAP;
}

/** How strong the desire on top of u's mind is (rankedDesires' first, without ranking them all). */
function leadLevel(run, u) {
  const d = u.desire;
  if ( !d ) return 0;
  let best = 0;
  for ( const k of desireKeys(d) ) {
    const [kind, targetId] = parseKey(k);
    const level = levelOf(u, kind, targetId);
    if ( level > best && relevant(run, u, kind, run.byId.get(targetId)) ) best = level;
  }
  return best;
}

/** No one leading this group (a unit's, or a side by its id): there never was a leader, or no one in its chain can lead now. */
export function leaderless(run, unitOrSide) {
  return !(typeof unitOrSide === "string" ? command(run, unitOrSide) : commandOf(run, unitOrSide));
}

/** A leaderless team pulls together a little less (vengeance aside). */
export const LEADERLESS = Object.freeze({ team: 0.7, cooperative: 6 });

/**
 * How readily u, at the world's usual leader influence (50), takes its lead from its commander on a turn: a loyal
 * follower half its turns.
 */
export const FOLLOW = Object.freeze({ chance: 0.5, pull: 0.7, lean: 0.6, max: 0.95 });

/**
 * How readily u takes its lead from whoever commands its group this turn: {cmd, raw, chance}, or null (nobody leads
 * it, or it leads). raw: the world's leader influence (50 the usual) times its loyalty and its pills' ear for a leader
 * (a would-be leader's half, a people-pleaser's double), a boss's many times over; chance: that, at most 95%. A
 * contrarian leaning against its commander doesn't follow (see listen).
 */
export function followChance(run, u) {
  const cmd = commandOf(run, u);
  if ( !cmd || cmd.unit === u ) return null;
  const opts = run.prep.options ?? {};
  const style = ownStyle(u);
  const loyal = Math.max(0, Math.min(1.6, liveTrait(run, u, "loyal") / 60));
  const scale = (Number.isFinite(opts.leaderInfluence) ? opts.leaderInfluence : 50) / 50;
  const raw = FOLLOW.chance * scale * loyal * style.leader * (cmd.boss ? (Number(opts.bossInfluence) || 2) : 1);
  return { cmd, raw: Math.max(0, raw), chance: Math.min(FOLLOW.max, Math.max(0, raw)) };
}

/**
 * Does u take its lead from its commander this turn? If so (u.following), its playstyle leans toward the commander's
 * for the turn: its pills' guide to desires (u.turnStyle) and its quirks (u.turnBehavior), as much as it follows (a
 * typical follower about a third of the way, under a boss more). Call before its desires are worked out.
 */
export function follow(run, u) {
  u.following = null;
  u.turnStyle = null;
  u.turnBehavior = null;
  const f = followChance(run, u);
  // (Scheming against its leaders, it takes no lead from them.)
  if ( !f || u.scheming || isContrarian(run, u, f.cmd) || !run.rng.chance(f.chance) ) return null;
  const share = Math.min(FOLLOW.lean, FOLLOW.lean * f.raw);
  const leader = f.cmd.unit;
  u.following = { id: leader.id, name: leader.spec.name, boss: f.cmd.boss, raw: f.raw, chance: f.chance, share };
  u.turnStyle = blendStyle(ownStyle(u), ownStyle(leader), share);
  u.turnBehavior = blendBehavior(u.ownBehavior ?? u.spec.behavior ?? {}, leader.ownBehavior ?? leader.spec.behavior ?? {}, share);
  return u.following;
}

/** Playstyles with a treacherous streak: with these, one who wants to lead, and doesn't, may scheme instead of brood. */
export const TREACHEROUS = Object.freeze(["cruel", "wildcard", "mercenary", "instigator"]);

/**
 * One who wants to lead (a playstyle) and doesn't command its group may brood over it this turn: a chance by where that
 * pill is among its others (its ambition: a quarter as its first pick, less further down; more with roleplay, at most
 * a tenth staying true). Only one with a treacherous streak (Cruel, Wildcard, Mercenary, Instigator) makes anything of
 * it: it thinks how it could be rid of its commander (u.scheming). Scheming, this turn it refuses its leaders any
 * help (no healing, bolstering, guarding or following them, no answering their requests), and it's far easier to
 * talk into changing sides (talk.js; a player character only on the traitor luck). Changing sides, the ambition goes
 * (battle-state.js dropAmbition). Call before its desires are worked out.
 */
export function scheme(run, u) {
  u.scheming = null;
  const ids = u.spec.playstyles ?? [];
  if ( u.ambitionGone || !ids.includes("leader") ) return null;
  const chance = (u.ownBehavior ?? u.spec.behavior ?? {}).ambition ?? 0;
  const cmd = commandOf(run, u);
  if ( !(chance > 0) || !cmd || cmd.unit === u ) return null; // (it leads, or there's no one to resent)
  if ( !run.rng.chance(chance) ) return null;
  if ( !ids.some(id => TREACHEROUS.includes(id)) ) return null; // (it wonders, and lets it go)
  u.scheming = { against: cmd.unit.id, name: cmd.unit.spec.name, boss: cmd.boss, round: run.round };
  return u.scheming;
}

/** A contrarian (an instigator, a wildcard) who isn't leading decides, once a fight, to go against its commander. */
function isContrarian(run, u, cmd) {
  const style = ownStyle(u);
  if ( !(style.contrarian > 0) || cmd.unit === u ) return false;
  u.contrarian ??= run.rng.chance(style.contrarian);
  return u.contrarian;
}

/** Desire guides blended: `own` leaning toward `lead` by `share` (how much it listens stays its own). */
function blendStyle(own, lead, share) {
  const mix = (a, b) => (a ?? 0) * (1 - share) + (b ?? 0) * share;
  const out = { ...own, hurt: {}, avoid: {} };
  for ( const group of ["hurt", "avoid"] ) {
    for ( const k of new Set([...Object.keys(own[group] ?? {}), ...Object.keys(lead[group] ?? {})]) ) out[group][k] = mix(own[group]?.[k], lead[group]?.[k]);
  }
  for ( const k of ["heal", "protect", "aid", "talk", "whim"] ) out[k] = mix(own[k], lead[k]);
  for ( const k of ["retaliate", "avenge", "cool", "frustration", "doorPatience"] ) out[k] = (own[k] ?? 1) * (1 - share) + (lead[k] ?? 1) * share;
  return out;
}

/** Quirks blended the same way. */
function blendBehavior(own, lead, share) {
  const out = { ...own };
  for ( const k of new Set([...Object.keys(own), ...Object.keys(lead)]) ) {
    const v = (Number(own[k]) || 0) * (1 - share) + (Number(lead[k]) || 0) * share;
    if ( v ) out[k] = v;
  }
  return out;
}

/** How much the team's desires pull on u: a little, less without anyone to lead them. Playstyles shape it. */
export function influence(run, u) {
  const style = ownStyle(u);
  const loyal = Math.max(0, Math.min(1.6, liveTrait(run, u, "loyal") / 60));
  const team = 0.15 * loyal * style.team * (leaderless(run, u) ? LEADERLESS.team : 1);
  return { team };
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
    if ( h.leader && commandOf(run, t)?.unit === t ) points += h.leader;
    if ( h.weakness && Object.keys(t.spec.iwr?.weak ?? {}).some(k => mine.has(k)) ) points += h.weakness;
    if ( h.unstudied && !sizedUp(u, t) ) points += h.unstudied;
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
    // (Whoever commands its group now.)
    const lead = commandOf(run, u)?.unit;
    const chief = lead && lead !== u ? friends.find(a => a === lead) : null;
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
 * Let the others' desires pull on u: its commander's, on a turn it follows (the topmost thing its commander wants
 * that it can actually do: a wish to heal someone means nothing to a creature that can't heal, so the next one counts),
 * and its team's (a little), as far as u can act on them. A contrarian leans away from its commander's top wish.
 */
export function listen(run, u, { canHeal = false, canTalk = false, canAid = false } = {}) {
  if ( !u.desire ) return;
  const { team } = influence(run, u);
  const fits = kind => kind === "hurt" || kind === "avoid" || kind === "protect" || (kind === "heal" && canHeal) || (kind === "talk" && canTalk) || (kind === "aid" && canAid);
  const pull = (kind, targetId, amount) => {
    if ( !fits(kind) || targetId === u.id || !amount ) return;
    const k = keyOf(kind, targetId);
    u.desire.social.set(k, (u.desire.social.get(k) ?? 0) + amount);
  };
  // Leaderless, the team is less coordinated: wanting to mend or guard each other dips a little. (Vengeance doesn't:
  // a fallen leader is a reason to settle scores, not to stop caring.)
  if ( leaderless(run, u) ) {
    for ( const k of new Set([...u.desire.logic.keys(), ...u.desire.style.keys(), ...u.desire.stated.keys()]) ) {
      const [kind, targetId] = k.split("|");
      if ( (kind === "heal" || kind === "protect" || kind === "aid") && targetId !== u.id ) u.desire.social.set(k, (u.desire.social.get(k) ?? 0) - LEADERLESS.cooperative);
    }
  }
  const cmd = commandOf(run, u);
  const leaderUnit = cmd?.unit !== u ? cmd?.unit : null;
  if ( leaderUnit ) {
    // What it can actually do: the kinds it has the means for, at someone it can act on.
    const can = d => fits(d.kind) && d.targetId !== u.id && relevant(run, u, d.kind, run.byId.get(d.targetId))
      && (d.kind !== "hurt" || (u.prep.offense?.length ?? 0) > 0);
    const top = (leaderUnit.lastDesires ?? []).find(can);
    if ( top && u.following ) pull(top.kind, top.targetId, FOLLOW.pull * top.level * (u.following.raw > u.following.chance ? u.following.raw / u.following.chance : 1));
    else if ( top && u.contrarian ) pull(top.kind, top.targetId, -0.15 * top.level);
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

/**
 * How willing u is to take up a friend's request for a buff (0 to 1): the loyal gladly, the selfish grudgingly,
 * helpers (Enablers, Moralists, Martyrs ...) more than most; a contrarian defying its commander, not for the commander.
 */
export function willingness(run, u, asker) {
  if ( u.contrarian && commandOf(run, u)?.unit === asker ) return 0;
  if ( refusesToHelp(run, u, asker) ) return 0; // (scheming against its leaders)
  const loyal = liveTrait(run, u, "loyal");
  const selfish = liveTrait(run, u, "selfish");
  const w = 0.5 + (loyal - 50) / 100 - (selfish - 50) / 100 + (u.spec.behavior?.helps ? 0.25 : 0);
  return Math.max(0, Math.min(1, w));
}
/** Below this, a request goes unheeded. */
export const UNWILLING = 0.2;

/**
 * Friends asking u for a buff (their "bolstered" desires naming u). No roll: only that they can make themselves
 * understood (`understands`: a language in common, minds that follow it) and that u is willing. Each request u takes
 * up becomes a wish to aid that friend, as strong as the asking times the willingness; u.heard keeps who asked.
 * Nothing comes of it for a character with no buff to give.
 */
export function heed(run, u, { canAid = false, understands = () => true } = {}) {
  u.heard = null;
  if ( !u.desire || !canAid ) return;
  for ( const a of alliesOf(run, u) ) {
    if ( a === u || !isStanding(a) ) continue;
    const asked = levelOf(a, "bolstered", u.id);
    if ( asked <= 0 || !understands(a, u) ) continue;
    const willing = willingness(run, u, a);
    if ( willing < UNWILLING ) continue;
    const k = keyOf("aid", a.id);
    u.desire.social.set(k, (u.desire.social.get(k) ?? 0) + asked * willing);
    (u.heard ??= new Set()).add(a.id);
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
