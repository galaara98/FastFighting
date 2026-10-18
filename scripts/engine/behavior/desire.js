/**
 * Desires: what each character wants right now, and how badly. They're the character's reasoning made visible.
 *
 *   logic       what its tactical thinking concludes this turn: the foe it would go for (and the runners-up), the
 *               friend it would heal, the one it would talk to, the one it fears. Worked out afresh each turn.
 *   stated      what the GM or player says it wants (Tactics), at the stated level.
 *   lean        which way someone who takes no side leans (behavior/neutral.js): a pull, like its leader's and its
 *               friends' (social), added to what it wants: keeping that side's members safe more, hurting them less,
 *               their foes a little more, the stronger the lean the more. A friend group's pull on its own, the same.
 *   memory      what the fight has stirred: whoever hurt it, whoever felled a friend. Cools a little every round.
 *   frustration what has thwarted it: a locked door that won't give, a target it can't reach, getting hurt on the
 *               way. It wears the desire down until the character moves on.
 *   social      what the others want. Whoever commands its group (its boss or leader, or a lieutenant who stepped
 *               up: battle-state.js command) always counts a little: the topmost thing it wants that the follower can
 *               actually do pulls a share of its strength (LEADER_SWAY, by the follower's loyalty and ear, a boss's
 *               more), whatever the world's leader influence. And each turn the follower may take its lead outright,
 *               as readily as the world's leader influence, its loyalty and its pills say (a boss, several times as
 *               readily): then it takes that wish up in proportion (at least most of the leader's strength, all of it
 *               under a boss), so a leader's mild wish can still lose to the follower's own strong one; and its
 *               playstyle leans toward the commander's for the turn. With nobody able to lead, the wish to heal or
 *               guard each other dips (vengeance doesn't). Playstyles change how readily it follows: one who wants to
 *               lead (but doesn't) half ignores its commander, a chaotic one barely hears anyone, People-Pleasers and
 *               Enablers listen harder, and a contrarian (chaotic, or an instigator) may lean away from what its
 *               commander wants. The player party has wishes of its own too (partyWants): what its players voted for,
 *               majority rules, at the world's Party's sway.
 *   taunt       taunts on it (effects.js): it wants to go for whoever taunted it, at least as badly as the taunt
 *               says, while the taunt lasts and the taunter stands. It counts like a stated desire, and blinds like one.
 *   asked       friends asking it for a buff (their "bolstered" desires naming it): no roll, only that they can make
 *               themselves understood and that it's willing (see heed).
 *   gm          what the GM holds it to in a live battle (the Battle Vantage): that level and no other, whatever the
 *               rest would make of it (0: set aside), until the GM hands it back. It counts like a stated desire.
 *   puppet      under someone's control (a charm, domination: u.controlledBy), what its controller wants, worked out
 *               each turn (puppetWishes): those and nothing of its own, while the control lasts.
 *
 * A desire's level is max(logic, stated, taunt) + lean + memory + social - frustration, 0 to 100 (or the GM's hold):
 *   {kind: "hurt" | "heal" | "protect" | "aid" | "talk" | "avoid" | "bind" | "rob" | "bolstered" | "breakFree" | "free", targetId, level}
 *   (aid: bolster with a buff; bind: tie up a fallen foe, a prisoner; rob: take what a fallen foe carries
 *   (behavior/fallen.js); bolstered: to be bolstered by that friend. A request, not something it acts on itself: the
 *   friend hears it and, if willing, wants to aid it. breakFree: get loose of what holds it (itself: tied up, grabbed,
 *   a hold the system says an action breaks); free: get a friend loose (behavior/holds.js).)
 *
 * The strongest desire leads. Much weaker ones (BLIND_GAP or more below it) don't cross the character's mind, and
 * an obsessed character (OBSESSED+) stops worrying about its own safety.
 */
import { STATUS, TACTICAL, ADHD, clamp } from "../../constants.js";
import { areEnemies, isStanding, liveTrait, liveTier, enemiesOf, alliesOf, sizedUp, command, commandOf, refusesToHelp, movesNeeded, edgeDistance, canMove } from "../battle-state.js";
import { perceives, apparentHealth } from "./senses.js";
import { seemsFoe } from "./neutral.js";
import { robbable } from "./theft.js";
import { ownHolds, isBound, freeable, known, remediesOf, bears } from "./holds.js";
import { hasTrait, profiled } from "../conditions.js";
import { hasUses } from "./evaluate.js";

/** A character's playstyle guide for desires (from its pills), or the neutral one. */
const NEUTRAL_STYLE = Object.freeze({ hurt: {}, avoid: {}, heal: 0, protect: 0, aid: 0, talk: 0, bind: 0, rob: 0, free: 0, rid: 0, whim: 0, contrarian: 0, retaliate: 1, avenge: 1, cool: 1, frustration: 1, leader: 1, doorPatience: 1 });
export const styleOf = u => u.turnStyle ?? u.spec?.desireStyle ?? NEUTRAL_STYLE;
/** Its own pills' guide, whoever it follows this turn (worked out again without a pill it lost: dropAmbition). */
const ownStyle = u => u.ownDesireStyle ?? u.spec?.desireStyle ?? NEUTRAL_STYLE;

export const DESIRE_KINDS = Object.freeze(["hurt", "heal", "protect", "aid", "talk", "avoid", "bind", "rob", "bolstered", "breakFree", "free", "rid", "leave"]);
/**
 * Desires a creature may have about itself: mending itself, bolstering itself, getting loose, being rid of a burn,
 * leaving the fight (behavior/leaving.js).
 */
const SELF_KINDS = new Set(["heal", "aid", "breakFree", "rid", "leave"]);
/** Band floors: passing, wants, determined, driven, obsessed. */
export const DESIRE_BANDS = Object.freeze([0, 20, 40, 60, 80]);
export const DESIRE_BAND_KEYS = Object.freeze(["passing", "wants", "determined", "driven", "obsessed"]);
/** Where the foe a character's tactics pick lands (a clear choice reaches a little higher). */
export const CHOICE_LEVEL = 45;
/** Desires this far below the strongest one don't cross the character's mind. */
export const BLIND_GAP = 20;
export const OBSESSED = 80;

/** A desire's level: 0 to 100. */
const toLevel = v => clamp(v, 0, 100);
/** A desire's key, what each layer keeps it under: its kind and its target ("hurt|goblin1"). */
export const keyOf = (kind, targetId) => `${kind}|${targetId}`;
/**
 * A key's kind and target, read once (desires are ranked many times a turn); started over past PARSED_MOST, so a long
 * session's battles, each with creatures of their own, don't keep every key they ever had.
 */
const PARSED = new Map();
const PARSED_MOST = 20000;
export function parseKey(k) {
  let p = PARSED.get(k);
  if ( !p ) {
    if ( PARSED.size >= PARSED_MOST ) PARSED.clear();
    const at = k.indexOf("|");
    PARSED.set(k, p = [k.slice(0, at), k.slice(at + 1)]);
  }
  return p;
}
/** Every key u has a desire under, once each. */
function desireKeys(d) {
  const keys = new Set(d.logic.keys());
  // (In this order, the layers that have any: the order desires of the same strength rank in.)
  const add = m => { if ( m?.size ) for ( const k of m.keys() ) keys.add(k); };
  add(d.stated);
  add(d.lean);
  add(d.taunt);
  add(d.memory);
  add(d.social);
  add(d.style);
  add(d.gm);
  add(d.puppet);
  add(d.cond);
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
  u.desire = { stated: new Map(), memory: new Map(), frustration: new Map(), logic: new Map(), social: new Map(), style: new Map(), lean: new Map(), taunt: new Map(), gm: new Map(), cond: new Map() };
  for ( const d of u.spec.desires ?? [] ) {
    if ( !DESIRE_KINDS.includes(d.kind) || !d.targetId || d.targetId === u.id ) continue;
    u.desire.stated.set(keyOf(d.kind, d.targetId), toLevel(Number(d.level) || 0));
  }
}

/** A new turn: the reasoning starts over, and what the fight stirred cools a little. */
export function newTurn(u) {
  if ( !u.desire ) return;
  u.desire.logic.clear();
  u.desire.social.clear();
  u.desire.style.clear();
  u.desire.cond?.clear();
  u.desire.puppet?.clear();
  const cool = 2 * styleOf(u).cool; // (a vengeful character's grudges never cool)
  for ( const [k, v] of u.desire.memory ) {
    if ( v <= cool ) u.desire.memory.delete(k);
    else u.desire.memory.set(k, v - cool);
  }
}

/** What a condition on it makes it want this turn (the cond layer: levelOf leaves it out without `conditions`). */
function feel(u, kind, targetId, level) {
  if ( !u.desire || !targetId || targetId === u.id ) return;
  const m = (u.desire.cond ??= new Map());
  const k = keyOf(kind, targetId);
  m.set(k, Math.max(m.get(k) ?? 0, toLevel(level)));
}

/** What the unit's tactics conclude this turn (the strongest reason for each kind and target wins). */
export function think(u, kind, targetId, level) {
  if ( !u.desire || !targetId || (targetId === u.id && !SELF_KINDS.has(kind)) ) return;
  const k = keyOf(kind, targetId);
  u.desire.logic.set(k, Math.max(u.desire.logic.get(k) ?? 0, toLevel(level)));
}

/** The fight stirs something: want it more. */
export function want(u, kind, targetId, amount) {
  if ( !u.desire || !targetId || targetId === u.id || !(amount > 0) ) return;
  const k = keyOf(kind, targetId);
  u.desire.memory.set(k, toLevel((u.desire.memory.get(k) ?? 0) + amount));
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

/**
 * How badly u wants this now. Without `conditions`, leaving out what its conditions alone make it want (keeping away
 * from whoever frightened it: the game's rule while it lasts, not its own wish to run).
 */
export function levelOf(u, kind, targetId, { conditions = true } = {}) {
  const d = u.desire;
  if ( !d ) return 0;
  return levelOfKey(d, keyOf(kind, targetId), conditions);
}

/** levelOf, by the desire's key (kind|targetId) in its desires `d`. */
function levelOfKey(d, k, conditions = true) {
  if ( d.gm?.size ) {
    const held = d.gm.get(k);
    if ( held !== undefined ) return held;
  }
  if ( d.puppet?.size ) return d.puppet.get(k) ?? 0;
  return toLevel(Math.max(d.logic.get(k) ?? 0, d.stated.get(k) ?? 0, d.taunt.get(k) ?? 0, conditions ? d.cond?.get(k) ?? 0 : 0) + (d.lean.get(k) ?? 0) + (d.style.get(k) ?? 0) + (d.memory.get(k) ?? 0) + (d.social.get(k) ?? 0) - (d.frustration.get(k) ?? 0));
}

/**
 * Does u want anything of these kinds at all (whether or not it can act on it now)? Without, none of them can lead
 * its mind: a quick look before asking mind() what does.
 */
export function wantsKind(u, kinds) {
  const d = u.desire;
  if ( !d || u.spec.hazard ) return false;
  for ( const k of desireKeys(d) ) {
    const [kind] = parseKey(k);
    if ( kinds.includes(kind) && levelOfKey(d, k) > 0 ) return true;
  }
  return false;
}

/**
 * Under someone's control (u.controlledBy: a charm, domination), it wants what its controller wants: each of the
 * controller's desires (none toward itself), as strongly, and nothing of its own. A controller wanting nothing leaves
 * it to its own (fighting for its controller's side, as it is now). Call last in its deliberation.
 */
export function puppetWishes(run, u) {
  if ( !u.desire ) return;
  const c = u.controlledBy ? run.byId.get(u.controlledBy) : null;
  const wants = new Map();
  if ( c && c !== u && c.desire ) for ( const d of rankedDesires(run, c) ) if ( d.targetId !== u.id ) wants.set(keyOf(d.kind, d.targetId), d.level);
  if ( wants.size ) u.desire.puppet = wants;
  else u.desire.puppet?.clear();
}

/**
 * Its side changed: what it wanted of others that no longer fits goes (harm toward its new friends, care for its new
 * foes), in every layer but the GM's; and the same of everyone else's toward it. What it wants now is worked out on
 * its next turn (or at once: simulator.js rethink).
 */
export function forgetSides(run, u) {
  const HARM = new Set(["hurt", "avoid", "bind", "rob"]);
  const CARE = new Set(["heal", "protect", "aid", "free", "bolstered"]);
  const unfit = (a, kind, t) => !!t && t !== a && (HARM.has(kind) ? !areEnemies(run, a, t) : CARE.has(kind) ? areEnemies(run, a, t) : false);
  pruneDesires(u, (kind, targetId) => unfit(u, kind, run.byId.get(targetId)));
  for ( const o of run.units ) if ( o !== u ) pruneDesires(o, (kind, targetId) => targetId === u.id && unfit(o, kind, u));
}

/**
 * The layers a quarrel is in, and what a change of heart prunes: everything but the GM's holds and its conditions'
 * wishes (which come and go with the GM and the conditions).
 */
export const QUARREL_LAYERS = Object.freeze(["stated", "memory", "frustration", "logic", "social", "style", "lean", "taunt", "puppet"]);

/** u's desires that drop(kind, targetId) says to, taken out of these layers. */
export function pruneDesires(u, drop, layers = QUARREL_LAYERS) {
  if ( !u?.desire ) return;
  for ( const layer of layers ) {
    const m = u.desire[layer];
    if ( !m ) continue;
    for ( const k of [...m.keys()] ) {
      const [kind, targetId] = parseKey(k);
      if ( drop(kind, targetId) ) m.delete(k);
    }
  }
}

/** The GM holds u's desire at this level (0: set aside) until handing it back. */
export function holdDesire(u, kind, targetId, level) {
  if ( !u.desire || !targetId ) return;
  (u.desire.gm ??= new Map()).set(keyOf(kind, targetId), toLevel(Math.round(Number(level) || 0)));
  if ( Number(level) > 0 ) placeDesire(u, kind, targetId, "top");
}

/** The GM's hold on it, handed back: the engine works it out again. */
export function releaseDesire(u, kind, targetId) {
  u.desire?.gm?.delete(keyOf(kind, targetId));
}

/**
 * The taunts on u this turn (effects with a taunt, effects.js): each makes it want to go for its taunter, at least as
 * badly as the taunt says. Only a taunter still standing, and still its foe, counts. Call after newTurn.
 */
export function goaded(run, u) {
  if ( !u.desire ) return;
  u.desire.taunt.clear();
  for ( const e of u.effects ?? [] ) {
    if ( !(e.taunt > 0) || !e.sourceId ) continue;
    const by = run.byId.get(e.sourceId);
    if ( !by || !isStanding(by) || !areEnemies(run, u, by) ) continue;
    const k = keyOf("hurt", by.id);
    u.desire.taunt.set(k, Math.max(u.desire.taunt.get(k) ?? 0, toLevel(e.taunt)));
    placeDesire(u, "hurt", by.id, "top"); // (a taunt takes its attention, for as long as it lasts)
  }
}

/** Point a lean's pull (behavior/neutral.js) at these: [[kind, targetId, amount]] (less of it, below 0), in place of the last. */
export function setLean(u, entries) {
  if ( !u.desire ) return;
  u.desire.lean.clear();
  for ( const [kind, id, amount] of entries ) {
    if ( !id || id === u.id || !amount ) continue;
    const k = keyOf(kind, id);
    u.desire.lean.set(k, Math.max(-100, Math.min(100, (u.desire.lean.get(k) ?? 0) + amount)));
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
  if ( [STATUS.DEAD, STATUS.FLED, STATUS.BEATEN].includes(t.status) ) return false;
  // (A prisoner, tied up and awake, is out of it: there's only what it carries, its getting loose, and its friends'.)
  if ( t.status === STATUS.BOUND && kind !== "rob" && kind !== "breakFree" && kind !== "free" && kind !== "rid" ) return false;
  const foe = () => !t.spec.untargetable && !t.spec.hazard && (areEnemies(run, u, t) || seemsFoe(run, u, t));
  switch ( kind ) {
    // (Nobody can attack what's untargetable: a hazard, a Spiritual Weapon.)
    case "hurt": return !t.spec.untargetable && !hasTrait(t, "untouchable") && (areEnemies(run, u, t) || seemsFoe(run, u, t)) && t.status !== STATUS.SURRENDERED && t.status !== STATUS.STOOD_DOWN;
    case "avoid": return areEnemies(run, u, t) && isStanding(t);
    case "talk": return t.status === STATUS.STANDING;
    case "heal": return !areEnemies(run, u, t) && (t.status === STATUS.DOWN || t.hp < t.maxHp) && !refusesToHelp(run, u, t);
    case "protect": return !areEnemies(run, u, t) && !refusesToHelp(run, u, t);
    case "aid": return !areEnemies(run, u, t) && isStanding(t) && !refusesToHelp(run, u, t);
    // A fallen foe not tied up yet; one down (or tied up) with something on it to take.
    case "bind": return t.status === STATUS.DOWN && !isBound(t) && foe();
    // Loose of what holds it (itself), or a friend loose of what holds it.
    case "breakFree": return t === u && (t.status === STATUS.STANDING || t.status === STATUS.BOUND) && ownHolds(run, t).length > 0;
    case "rid": return t === u && t.status === STATUS.STANDING && remediesOf(run, t).length > 0;
    // (Off the map: while it means to go.)
    case "leave": return t === u && t.status === STATUS.STANDING && !!u.leaving;
    case "free": return t !== u && !areEnemies(run, u, t) && !refusesToHelp(run, u, t) && !!freeable(run, t);
    case "rob": return (t.status === STATUS.DOWN || t.status === STATUS.BOUND) && foe() && robbable(t) && !u.robbedFrom?.has(t.id);
    // (Wanting a friend's buff is for the friend to act on: see heed.)
    default: return false;
  }
}

/** Every desire the unit can act on, strongest first: [{kind, targetId, level}]. */
export function rankedDesires(run, u) {
  const d = u.desire;
  // (A hazard wants nothing: it goes off at whoever's in its reach, simulator.js hazardTurn.)
  if ( !d || u.spec.hazard ) return [];
  const out = [];
  const sunk = d.sunk?.size ? d.sunk : null;
  for ( const k of desireKeys(d) ) {
    const [kind, targetId] = parseKey(k);
    if ( !relevant(run, u, kind, run.byId.get(targetId)) ) continue;
    const level = levelOfKey(d, k);
    if ( level <= 0 ) continue;
    // What's driving it: the tactics' own reasoning, or something stated, taunted or stirred on top of it.
    const logic = d.logic.get(k) ?? 0;
    const stated = d.stated.get(k) ?? 0;
    const driven = d.gm?.has(k) ? "stated" : (d.taunt.get(k) ?? 0) > Math.max(logic, stated) ? "taunted" : stated > logic ? "stated" : (d.memory.get(k) ?? 0) >= 10 ? "memory" : (d.social.get(k) ?? 0) >= 10 ? "social" : "logic";
    const x = { kind, targetId, level, driven };
    if ( sunk?.has(k) ) x.sunk = true;
    out.push(x);
  }
  // (What it can't work on now sinks below everything else, however strong: behavior/hopeless.js.)
  return out.sort((a, b) => (Number(!!a.sunk) - Number(!!b.sunk)) || (b.level - a.level));
}

/**
 * What's on the unit's mind: the leading desire, whether another desire is still in view (within BLIND_GAP of the
 * lead), and whether the lead is an obsession.
 */
export function mind(run, u) {
  const ranked = rankedDesires(run, u);
  // (The top of its agenda, what it's working on: orderAgenda. Never one it can't work on now: behavior/hopeless.js.)
  const lead = agendaLead(u, ranked) ?? ranked.find(d => !d.sunk) ?? null;
  const floor = (lead?.level ?? 0) - BLIND_GAP;
  // (What comes next on its agenda, its second and third, is in view however strong.)
  const next = new Set((u.agenda ?? []).slice(0, 3));
  const near = (k, level) => next.has(k) || level >= floor;
  return {
    lead,
    ranked,
    // Only a desire stated, taunted, or stirred by the fight, blinds; the tactics' own reasoning (and the others' pull)
    // weighs everything.
    blinding: !!lead && (lead.driven === "stated" || lead.driven === "taunted" || lead.driven === "memory"),
    inView: (kind, targetId) => !u.desire?.sunk?.has(keyOf(kind, targetId)) && near(keyOf(kind, targetId), levelOf(u, kind, targetId)),
    kindInView: kind => ranked.some(d => d.kind === kind && !d.sunk && near(keyOf(d.kind, d.targetId), d.level)),
    obsessed: !!lead && lead.level >= OBSESSED
  };
}

/* -------------------------------------------- */
/*  The agenda: what it means to do, in order   */
/* -------------------------------------------- */

/**
 * Where a desire goes in u's agenda when it next thinks its turn over (orderAgenda): "top" (what it works on now:
 * setting out to leave, whatever stops it on the way, a taunt, the GM's say, a fear past bearing) or "second" (going
 * again, once that's dealt with). Unplaced, a new one goes to the bottom, unless it suits the creature (agendaFit).
 */
export function placeDesire(u, kind, targetId, where) {
  if ( !u.desire || !targetId ) return;
  (u.desire.place ??= new Map()).set(keyOf(kind, targetId), where);
}

/** The top of u's agenda, as it stands among its desires (ranked), or null. */
function agendaLead(u, ranked) {
  for ( const k of u.agenda ?? [] ) {
    const d = ranked.find(x => keyOf(x.kind, x.targetId) === k);
    if ( d && !d.sunk ) return d;
  }
  return null;
}

/**
 * How well a desire suits what the creature likes to do: 2, so well it goes first (its pills pull it there strongly,
 * or its answers say so: finishing the fallen, tying them up, robbing them, always talking); 1, next after what it's on
 * (a lesser pull: talking first, healing aggressively); 0, not especially. A Cruel one whose foe goes down: finishing
 * it, first.
 */
function agendaFit(run, u, x) {
  const t = run.byId.get(x.targetId);
  const tac = u.tac ?? {};
  const style = u.desire.style.get(keyOf(x.kind, x.targetId)) ?? 0;
  let fit = style >= 25 ? 2 : style >= 10 ? 1 : 0;
  if ( x.kind === "hurt" && t?.status === STATUS.DOWN && (tac.fallen === "finish" || behaviorOfUnit(u).finishDowned) ) fit = 2;
  // (A protective one, and a foe at a friend: first if it can get at them this turn, next if not.)
  if ( x.kind === "hurt" && t && isStanding(t) && protective(u) ) {
    const prey = t.targetId ? run.byId.get(t.targetId) : null;
    if ( prey && prey !== u && !areEnemies(run, u, prey) && (t.adjacent?.has(prey.id) || prey.targetedBy === t.id) ) fit = Math.max(fit, doableNow(run, u, x) ? 2 : 1);
  }
  if ( x.kind === "protect" && protective(u) ) fit = Math.max(fit, 1);
  // (A damage-dealer, and a foe it has only now caught sight of: next.)
  // (Its first look at the fight: nobody is newly seen yet.)
  if ( x.kind === "hurt" && t && isStanding(t) && dealsDamage(u) && u.seenFoes && !u.seenFoes.has(t.id) && perceives(run, u, t) ) fit = Math.max(fit, 1);
  if ( (x.kind === "bind" && tac.fallen === "tie") || (x.kind === "rob" && tac.fallen === "rob") ) fit = 2;
  if ( x.kind === "talk" ) fit = Math.max(fit, tac.talk === "always" ? 2 : tac.talk === "first" ? 1 : 0);
  if ( x.kind === "heal" ) {
    fit = Math.max(fit, tac.healAggro === "allCosts" ? 2 : tac.healAggro === "aggressive" ? 1 : 0);
    // (A friend down: first, for one who answered that it rescues a dying friend; next, for anyone else.)
    if ( t && t !== u && t.status === STATUS.DOWN ) fit = Math.max(fit, tac.allyDying === "rescue" ? 2 : 1);
    // (Itself, past where it said it reaches for a potion: first.)
    const at = Number(tac.potionThreshold);
    if ( t === u && at > 0 && u.maxHp > 0 && u.hp / u.maxHp < at / 100 ) fit = 2;
  }
  return fit;
}
const behaviorOfUnit = u => u.turnBehavior ?? u.ownBehavior ?? u.spec.behavior ?? {};
/** One who looks after its friends: its style or its target the protector's, or its pills (Tank, Martyr, Enabler, Moralist). */
const PROTECTORS = new Set(["tank", "martyr", "enabler", "moralist"]);
export const protective = u => u.tac?.style === "protector" || u.tac?.target === "protect" || (u.spec.playstyles ?? []).some(p => PROTECTORS.has(p));
/** One whose job is damage: up front, skirmishing or shooting, or its pills (Brawler, Speed-Runner, Impatient, Cruel). */
const STRIKERS = new Set(["brawler", "speedRunner", "impatient", "cruel"]);
const dealsDamage = u => ["frontline", "skirmisher", "ranged"].includes(u.tac?.style) || (u.spec.playstyles ?? []).some(p => STRIKERS.has(p));
/** How many places a desire climbs toward second each turn, by how intense it is: obsessed, all the way. */
const climb = level => (level >= 80 ? Infinity : level >= 60 ? 3 : level >= 40 ? 2 : level >= 20 ? 1 : 0);

/** Could u do this now, this very turn (whoever it would hurt within a move of a blow; anything else it can work on)? */
function doableNow(run, u, x) {
  const t = run.byId.get(x.targetId);
  if ( !t ) return false;
  if ( x.kind === "hurt" ) return perceives(run, u, t) && (u.prep.offense ?? []).some(a => hasUses(u, a) && movesNeeded(run, u, t, a) <= 1);
  return !u.desire.sunk?.has(keyOf(x.kind, x.targetId));
}

/**
 * What u means to do, in order (u.agenda: its desires' keys; its top, what it works on: mind's lead), as it thinks its
 * turn over:
 *  - what it no longer wants comes off; what it can't work on now goes to the bottom (behavior/hopeless.js);
 *  - a new desire goes where it was placed (placeDesire), else first or second if it suits the creature (agendaFit),
 *    else at the bottom; one that has come to suit it since (a foe it's fighting fallen, for a Cruel one) moves up so;
 *  - one that plans ahead (tactical or better) orders it all by what matters most, as a soldier would: the strongest
 *    first;
 *  - the rest keep at what they were doing, but the mind jumps: now and then (the ADHD setting, 20% by default) the
 *    strongest of the others takes the top, twice as readily when it could be done this very turn, three times for the
 *    least thoughtful.
 */
export function orderAgenda(run, u) {
  const d = u.desire;
  if ( !d ) return;
  const ranked = rankedDesires(run, u);
  const byKey = new Map(ranked.map(x => [keyOf(x.kind, x.targetId), x]));
  let list = (u.agenda ?? []).filter(k => byKey.has(k));
  const fits = (d.fits ??= new Map());
  const places = new Map(d.place ?? []);
  for ( const x of ranked ) {
    const k = keyOf(x.kind, x.targetId);
    const fit = agendaFit(run, u, x);
    const was = fits.get(k) ?? 0;
    fits.set(k, fit);
    if ( places.has(k) || fit <= was ) {
      if ( !list.includes(k) && !places.has(k) ) list.push(k);
      continue;
    }
    places.set(k, fit === 2 ? "top" : "second");
  }
  for ( const k of [...fits.keys()] ) if ( !byKey.has(k) ) fits.delete(k);
  // (Where they were placed: the first places, then the second.)
  for ( const where of ["top", "second"] ) {
    for ( const [k, w] of places ) {
      if ( w !== where || !byKey.has(k) ) continue;
      list = list.filter(x => x !== k);
      list.splice(where === "top" ? 0 : Math.min(1, list.length), 0, k);
    }
  }
  d.place?.clear();
  // (What it can't work on now: at the bottom.)
  list = [...list.filter(k => !byKey.get(k).sunk), ...list.filter(k => byKey.get(k).sunk)];
  // (Everything climbs toward second place, the faster the more intense, an obsession all the way at once: past what it
  // wants less, never past what it wants as much or more, nor past what was put where it is this turn.)
  for ( let i = 2; i < list.length; i++ ) {
    const x = byKey.get(list[i]);
    if ( x.sunk ) continue;
    let to = i;
    for ( let steps = climb(x.level); steps > 0 && to > 1; steps-- ) {
      const above = byKey.get(list[to - 1]);
      if ( places.has(list[to - 1]) || above.level >= x.level ) break;
      to--;
    }
    if ( to < i ) list.splice(to, 0, ...list.splice(i, 1));
  }
  u.seenFoes = new Set([...(u.seenFoes ?? []), ...enemiesOf(run, u).filter(o => isStanding(o) && perceives(run, u, o)).map(o => o.id)]);
  const tier = liveTier(run, u);
  if ( tier >= TACTICAL.TACTICAL ) {
    list.sort((a, b) => (Number(!!byKey.get(a).sunk) - Number(!!byKey.get(b).sunk)) || (byKey.get(b).level - byKey.get(a).level));
  } else if ( list.length > 1 ) {
    const top = byKey.get(list[0]);
    const rival = ranked.find(x => !x.sunk && keyOf(x.kind, x.targetId) !== list[0]);
    if ( rival && !top.sunk && rival.level > top.level ) {
      const share = Math.min(100, Math.max(0, Number(run.prep.options?.adhd ?? ADHD))) / 100;
      const chance = share * (doableNow(run, u, rival) ? (tier <= TACTICAL.INSTINCTIVE ? 3 : 2) : 1);
      if ( run.rng.chance(Math.min(1, chance)) ) {
        const k = keyOf(rival.kind, rival.targetId);
        list = [k, ...list.filter(x => x !== k)];
      }
    }
  }
  u.agenda = list;
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

/** A leaderless group looks after each other a little less (vengeance aside). */
export const LEADERLESS = Object.freeze({ cooperative: 6 });

/** A leader's steady sway: the share of its top wish a typical follower takes up every turn, followed or not. */
export const LEADER_SWAY = 0.15;

/**
 * How readily u, at the world's usual leader influence (50), takes its lead from its commander on a turn (a loyal
 * follower half its turns), and how much of the leader's wish it takes up then: adopt, plus the rest as readily as it
 * follows (a typical follower about four fifths, under a boss all of it).
 */
export const FOLLOW = Object.freeze({ chance: 0.5, adopt: 0.6, lean: 0.6, max: 0.95 });

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
  for ( const k of ["heal", "mend", "protect", "aid", "talk", "bind", "rob", "free", "rid", "whim"] ) out[k] = mix(own[k], lead[k]);
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
    if ( h.weakness && Object.keys({ ...t.spec.iwr?.weak, ...t.spec.iwr?.exploit }).some(k => mine.has(k)) ) points += h.weakness;
    if ( h.unstudied && !sizedUp(u, t) ) points += h.unstudied;
    if ( h.current && t.id === u.targetId ) points += h.current;
    if ( h.slow && cantFollow(run, u, t) ) points += h.slow;
    add("hurt", t.id, points);
  }
  // The fallen: some can't resist finishing them, some never would; some would rather take them prisoner, some
  // would rather go through their pockets.
  if ( h.downed ) for ( const t of enemiesOf(run, u) ) if ( t.active && t.status === STATUS.DOWN && !t.stable && perceives(run, u, t) ) add("hurt", t.id, h.downed);
  if ( s.bind ) for ( const t of enemiesOf(run, u) ) if ( relevant(run, u, "bind", t) && perceives(run, u, t) ) add("bind", t.id, s.bind);
  if ( s.rob ) for ( const t of enemiesOf(run, u) ) if ( relevant(run, u, "rob", t) && perceives(run, u, t) ) add("rob", t.id, s.rob);
  // Friends: one to mend, one to guard.
  const friends = run.units.filter(a => a !== u && a.side === u.side && a.active && ![STATUS.DEAD, STATUS.FLED].includes(a.status));
  if ( canHeal && s.heal ) for ( const a of friends ) if ( perceives(run, u, a, { crisis: true }) && (a.status === STATUS.DOWN || frac(a) < 0.75) ) add("heal", a.id, s.heal);
  // Itself, once hurt (the Fragile).
  if ( canHeal && s.mend && frac(u) < 0.75 ) add("heal", u.id, s.mend);
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
 * Can t not follow u (a Kiter's favourite foe): held where it is, on the ground, slowed, slower than u, or struggling
 * through the ground to get at it.
 */
function cantFollow(run, u, t) {
  if ( !canMove(run, t) || t.prone || (Number(t.conds?.slowed) || 0) > 0 ) return true;
  const fastest = x => Math.max(0, ...Object.values(x.spec.speeds ?? { walk: 25 }).map(Number).filter(Number.isFinite)) + (x.mods?.speed ?? 0);
  if ( fastest(t) < fastest(u) ) return true;
  const way = run.prep.approachOf?.(t.id, u.id);
  return Number.isFinite(way?.mult) && way.mult > 1.05;
}

/**
 * Let its commander's desires pull on u (the topmost thing its commander wants that it can actually do: a wish to heal
 * someone means nothing to a creature that can't heal, so the next one counts): always a little (LEADER_SWAY), and on
 * a turn it follows, in proportion to how strongly the commander wants it and how readily u follows. A contrarian leans
 * away from its commander's top wish.
 */
export function listen(run, u, { canHeal = false, canTalk = false, canAid = false } = {}) {
  if ( !u.desire ) return;
  const fits = kind => kind === "hurt" || kind === "avoid" || kind === "protect" || kind === "bind" || kind === "rob" || (kind === "heal" && canHeal) || (kind === "talk" && canTalk) || (kind === "aid" && canAid);
  const pull = (kind, targetId, amount) => {
    if ( !fits(kind) || targetId === u.id || !amount ) return;
    const k = keyOf(kind, targetId);
    u.desire.social.set(k, (u.desire.social.get(k) ?? 0) + amount);
  };
  // Leaderless, the team is less coordinated: wanting to mend or guard each other dips a little. (Vengeance doesn't:
  // a fallen leader is a reason to settle scores, not to stop caring.)
  if ( leaderless(run, u) ) {
    for ( const k of new Set([...u.desire.logic.keys(), ...u.desire.style.keys(), ...u.desire.stated.keys()]) ) {
      const [kind, targetId] = parseKey(k);
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
    if ( top && u.contrarian ) pull(top.kind, top.targetId, -0.15 * top.level);
    else if ( top ) {
      // Always a little: whatever the world's leader influence, a leader counts.
      const loyal = Math.max(0, Math.min(1.6, liveTrait(run, u, "loyal") / 60));
      const boss = cmd.boss ? Number(run.prep.options?.bossInfluence) || 2 : 1;
      pull(top.kind, top.targetId, LEADER_SWAY * loyal * (ownStyle(u).leader ?? 1) * boss * top.level);
      // Following it this turn: it takes the wish up in proportion, at least that share of the leader's strength (most
      // of it as a typical follower, all of it under a boss), so a mild wish can lose to a strong one of its own.
      if ( u.following ) {
        const adopt = Math.min(1, FOLLOW.adopt + (1 - FOLLOW.adopt) * u.following.raw);
        const short = adopt * top.level - levelOf(u, top.kind, top.targetId);
        if ( short > 0 ) pull(top.kind, top.targetId, short);
      }
    }
  }
}

/** How strongly the party's wishes pull, at a Party's sway of 100%: so many points (the desire scale is 0 to 100). */
export const PARTY_POINTS = 100;

/**
 * Fear of whoever frightened it (the core's own reading, where the system doesn't say): so much, and so much more for
 * each step of the fright, at most this. What a condition makes it want is the game's rule while the condition lasts
 * (the cond layer: it keeps away, it doesn't go for them), never its own wish to run or leave the fight: that's its
 * nerve (morale.js), which a fright shakes.
 */
const FRIGHT = Object.freeze({ base: 20, step: 15, most: 65, brave: 0.3 });
/** Whoever sent it fleeing (or turned it): the strongest keeping away. */
const FLEE_FROM = 80;
/** The conditions the core reads as fear, where the system doesn't say what they mean. */
const FEARS = new Set(["frightened", "fleeing", "turned"]);
/** Its own wish to get away, once frightened often enough: enough to run from one close at hand (simulator.js). */
const RUN_FROM = 75;
/**
 * How afraid a set of conditions makes it, in steps: frightened by its value; sent fleeing or turned (a critical fright),
 * two; another of the system's fears (rules.fearConditions), its value.
 */
/**
 * How afraid u is now, as its conditions stand (the system lowering them, or letting them lapse: less, or none): as the
 * system counts it (rules.fearValued: PF2e's frightened 2), or, where a fear is only there or not, as it has built.
 */
export function fearNow(run, u) {
  const now = fearOn(u.conds, new Set([...FEARS, ...(run.prep.rules.fearConditions ?? [])]));
  return run.prep.rules.fearValued || !now ? now : Math.max(now, u.fearBuilt ?? 0);
}

/**
 * Where a fear is only there or not (a system that doesn't count its steps: no rules.fearValued), how bad it has got,
 * kept hidden: each fear that lands a step more (a new one, or one laid on again), each that lapses a step less, and
 * none at all once no fear is left. (u.fearBuilt; each fear known by its effect, or the sheet's own.)
 */
function fearBuilt(run, u, fears) {
  let built = u.fearBuilt ?? 0;
  const before = u.fearKnown ?? [];
  const now = [];
  for ( const e of u.effects ?? [] ) {
    if ( !fearOn(e.conditions, fears) ) continue;
    if ( !e.fearId ) {
      e.fearId = (u.fearIds = (u.fearIds ?? 0) + 1);
      built += 1;
    }
    now.push({ id: e.fearId, key: e.key ?? null, src: e.sourceId ?? null });
  }
  // (Afraid on its sheet, with nothing here to say why: one fear.)
  if ( !now.length && fearOn(u.conds, fears) > 0 ) {
    if ( !before.some(f => f.id === "sheet") ) built += 1;
    now.push({ id: "sheet", key: null, src: null });
  }
  // (Lapsed: a step less. One laid on again in its place hasn't lapsed.)
  for ( const f of before ) if ( !now.some(x => x.id === f.id || (x.key === f.key && x.src === f.src)) ) built -= 1;
  u.fearBuilt = now.length ? Math.max(0, built) : 0;
  u.fearKnown = now;
}

function fearOn(c, fears) {
  let most = 0;
  for ( const key of fears ) {
    const v = c?.[key];
    if ( !(Number(v) > 0 || v === true) ) continue;
    most = Math.max(most, key === "fleeing" || key === "turned" ? 2 : Number(v) || 1);
  }
  return most;
}
/** How afraid it has to be for that (fearOn's steps): three, two for the timid, four for the brave. */
const fearToRun = (run, u) => Math.min(4, Math.max(2, Math.round(3 + (liveTrait(run, u, "brave") - 50) / 40)));
/** Whoever holds it: set on, to break free. */
const HELD = 50;

/**
 * What its conditions make it want, by who caused them and how bad they are. A fear is the system's to say
 * (rules.conditionWishes(run, u, {key, value, by}): [{kind, targetId, level}], what that condition makes it want, [] for
 * nothing, or null for the core's reading): by default, whoever frightened it, it would rather keep away from (the
 * worse the fright, the more: frightened 2 or worse, enough not to go for them while it has anything else to do), and
 * whoever sent it fleeing or turned it, more. All of it only while the condition lasts, and never a reason to run or
 * leave the fight (cond). Whoever holds it, it's set on, to break free. (Who goads it: the taunt layer, goaded; who
 * controls it: its side, settleAllegiance.)
 */
export function conditionWishes(run, u) {
  if ( !u.desire ) return;
  const rules = run.prep.rules;
  const fears = new Set([...FEARS, ...(rules.fearConditions ?? [])]);
  const sources = new Set();
  let fear = fearOn(u.conds, fears);
  for ( const e of u.effects ?? [] ) {
    const by = e.sourceId && !e.onlyVs ? run.byId.get(e.sourceId) : null;
    const c = e.conditions;
    if ( !by || by === u || !c || !isStanding(by) || !areEnemies(run, u, by) ) continue;
    const here = fearOn(c, fears);
    if ( here > 0 ) sources.add(by);
    fear = Math.max(fear, here);
    let coreFear = true;
    for ( const [key, value] of Object.entries(c) ) {
      if ( !(Number(value) > 0 || value === true) ) continue;
      const said = rules.conditionWishes?.(run, u, { key, value: Number(value) || 1, by }) ?? null;
      if ( !Array.isArray(said) ) continue;
      if ( fears.has(key) ) coreFear = false;
      for ( const w of said ) if ( w?.kind && w.targetId ) feel(u, w.kind, w.targetId, Number(w.level) || 0);
    }
    if ( !coreFear ) continue;
    if ( (c.fleeing ?? 0) > 0 || (c.turned ?? 0) > 0 ) feel(u, "avoid", by.id, FLEE_FROM);
    // (Frightened: the more so, the more it shrinks from them; less for the bold.)
    else if ( (c.frightened ?? 0) > 0 ) feel(u, "avoid", by.id, Math.min(FRIGHT.most, FRIGHT.base + FRIGHT.step * c.frightened) + (50 - liveTrait(run, u, "brave")) * FRIGHT.brave);
  }
  // How afraid it is now, in any system, as the system has it (lowered, or lapsed: less, or none): it wears on its nerve
  // (morale.js). Where a fear is only there or not, it builds (fearBuilt). Its fear made worse and worse, past what its
  // nerve bears: a wish of its own to get away from whoever frightens it, apart from the condition, a reason to run as
  // good as any (not talked into it, nor paid); only while the fear is that bad, gone with it.
  fearBuilt(run, u, fears);
  if ( !rules.fearValued && fear > 0 ) fear = Math.max(fear, u.fearBuilt ?? 0);
  u.fearSeen = fear;
  const keys = fear >= fearToRun(run, u) ? [...sources].map(by => keyOf("avoid", by.id)) : [];
  for ( const k of u.fearRun ?? [] ) if ( !keys.includes(k) ) u.desire.memory.delete(k);
  for ( const k of keys ) {
    if ( !(u.fearRun ?? []).includes(k) ) u.desire.place = new Map([...(u.desire.place ?? []), [k, "top"]]);
    u.desire.memory.set(k, Math.max(u.desire.memory.get(k) ?? 0, RUN_FROM));
  }
  u.fearRun = keys.length ? keys : null;
  const holder = u.grabbedBy ? run.byId.get(u.grabbedBy) : null;
  if ( holder && isStanding(holder) && areEnemies(run, u, holder) ) think(u, "hurt", holder.id, HELD * styleOf(u).retaliate);
  // (In a rage: the nearest foe, and nothing else.)
  if ( hasTrait(u, "rage") ) {
    const nearest = enemiesOf(run, u).filter(o => isStanding(o) && !hasTrait(o, "untouchable"))
      .map(o => ({ o, d: u.adjacent?.has(o.id) ? 0 : edgeDistance(u, o) ?? 30 })).sort((a, b) => a.d - b.d)[0]?.o;
    if ( nearest ) think(u, "hurt", nearest.id, RAGE);
  }
  // (Swallowed, engulfed: whoever has it, from inside.)
  for ( const [key, , p] of profiled(u) ) {
    const by = p.hold?.bySource ? (u.effects ?? []).filter(e => e.conditions?.[key] && e.sourceId).map(e => run.byId.get(e.sourceId)).find(Boolean) : null;
    if ( by && isStanding(by) && areEnemies(run, u, by) ) think(u, "hurt", by.id, HELD * styleOf(u).retaliate);
  }
}
/** How badly a creature in a rage wants the nearest foe. */
const RAGE = 80;

/**
 * Held fast, it wants to break free: tied up with nothing it could do from its bonds, badly (BREAK_FREE.bound); able to
 * do what it wants as it is (a spell with no gesture at a foe in range, a word: holds.js needsHands), it may bear them
 * (BREAK_FREE.bearable), the more readily the braver it is, as its pills say (style.rid); held otherwise, the more so
 * with no foe beside it to fight where it is (free to go, it can't). Whatever else bothers it that an action ends (a
 * burn, a bleed, the system's remedies: holds.js remediesOf): to be rid of the worst of it ("rid"), as badly as it
 * bothers it, more for the fearful, as its pills say. A selfless one may bear all of it this turn (holds.js bears: the
 * world's slider); tied up with nothing else it could do, it struggles all the same. A grab with nothing to go on (no system way, no escape of
 * its own: holds.js known) is left to the turn's start, as the engine always had it. A friend held (one it can free:
 * tied up, or what the system says a friend can break), and it can tell: to free it, as loyal as it is (FREE), its
 * pills' word (style.free), its own answer to "When an ally is dying" (rescue, or look after itself), the more so with
 * no foe beside it; a friend lying down, tied, less. About even, for an ordinarily loyal one, with the foe its tactics
 * would pick across the room (desire.js levelsFromScores: up to 60): its answers, its pills and its party's wishes
 * (partyWants) tip it.
 */
export const BREAK_FREE = Object.freeze({ bound: 85, bearable: 45, brave: 0.5, grabbed: 45, other: 55, open: 20, hazard: 20, swallowed: 75, engulfed: 75, impregnated: 30, growing: 10 });

/** Tied up, could it still do something from its bonds: a blow or a spell that needs no hands at a foe in reach as it lies, or a word? */
export function actsHeld(run, u) {
  const foes = enemiesOf(run, u).filter(e => e.active && isStanding(e) && perceives(run, u, e));
  if ( !foes.length ) return false;
  if ( (u.prep.talkAffinity ?? 0) > 0 && u.spec.social ) return true;
  return u.prep.offense.some(a => hasUses(u, a) && foes.some(e => movesNeeded(run, u, e, a) === 0));
}
export const FREE = Object.freeze({ base: 25, loyal: 0.4, open: 10, down: 0.5, allyDying: Object.freeze({ rescue: 15, fight: 0, retreat: -5, protectSelf: -15 }) });
export function holdWishes(run, u) {
  if ( !u.desire ) return;
  const engaged = [...(u.adjacent ?? [])].some(id => {
    const e = run.byId.get(id);
    return e && isStanding(e) && areEnemies(run, u, e);
  });
  let most = 0;
  const fear = (50 - liveTrait(run, u, "brave")) * BREAK_FREE.brave;
  const style = styleOf(u).rid ?? 0;
  const bearing = !!run.prep?.options && bears(run, u);
  for ( const h of ownHolds(run, u) ) {
    if ( h.key === "grabbed" && !known(run, u, h) ) continue;
    // (A hazard's hold: it's still in the hazard's reach, the worse for that.)
    const level = h.key === "bound" ? (actsHeld(run, u) ? (bearing ? 0 : BREAK_FREE.bearable + fear + style) : BREAK_FREE.bound)
      : bearing ? 0 : (BREAK_FREE[h.key] ?? BREAK_FREE.other) + (engaged ? 0 : BREAK_FREE.open) + (h.hazard ? BREAK_FREE.hazard : 0) + style
        // (Something growing in it: the nearer it comes to tearing free, the more.)
        + (h.worsens ? BREAK_FREE.growing * (Number(u.conds?.[h.key]) || 1) : 0);
    most = Math.max(most, level);
  }
  if ( most > 0 ) think(u, "breakFree", u.id, most);
  // Whatever else bothers it that it can do something about: the worst of it.
  u.ridOf = null;
  if ( !bearing && u.status === STATUS.STANDING ) {
    const worst = remediesOf(run, u).map(r => ({ r, level: r.annoyance + fear + style })).sort((a, b) => b.level - a.level)[0];
    if ( worst?.level > 0 ) {
      u.ridOf = worst.r.key;
      think(u, "rid", u.id, worst.level);
    }
  }
  if ( u.status !== STATUS.STANDING ) return;
  const allies = new Set(alliesOf(run, u));
  for ( const a of run.units ) {
    if ( a === u || !a.active || areEnemies(run, u, a) ) continue;
    // (A friend; or anyone it wants safe, as much as it does.)
    const cares = allies.has(a) ? Infinity : levelOf(u, "protect", a.id);
    if ( !(cares > 0) || !freeable(run, a) || !perceives(run, u, a) ) continue;
    const answer = FREE.allyDying[u.tac?.allyDying] ?? 0;
    const level = (FREE.base + liveTrait(run, u, "loyal") * FREE.loyal + (styleOf(u).free ?? 0) + answer + (engaged ? 0 : FREE.open)) * (a.status === STATUS.DOWN ? FREE.down : 1);
    think(u, "free", a.id, Math.min(level, cares));
  }
}

/**
 * The player party's wishes (its players' votes, majority rules: the side's party, battle-state.js), for each member of
 * that side each turn, at the world's Party's sway: who to go after first (the nearest, the weakest, the most
 * dangerous, spellcasters and healers, their leader), the fallen (finish them, tie them up, rob them), and each other (heal the hurt, guard
 * the weakest, or each for themselves: less of both). How the party wants them to act (talking, resources, when to pull
 * out) sways their tactics instead (playstyles.js sampleRunTactics), and sparing the fallen their wish to (battle.js).
 * @param {{t, moves}[]} scored  The foes its tactics weighed
 */
export function partyWants(run, u, scored, { canHeal = false } = {}) {
  const party = run.prep.sides?.[u.side]?.party;
  if ( !u.desire || !party?.sway ) return;
  const points = PARTY_POINTS * party.sway;
  const add = (kind, id, n) => {
    if ( !n || !id || id === u.id ) return;
    const k = keyOf(kind, id);
    u.desire.social.set(k, (u.desire.social.get(k) ?? 0) + n);
  };
  const frac = t => (t.maxHp > 0 ? t.hp / t.maxHp : 1);
  const looks = t => (areEnemies(run, u, t) ? apparentHealth(run, u, t) : frac(t));
  const foes = scored.map(x => x.t);
  if ( foes.length && party.target ) {
    const min = Math.min(...scored.map(x => x.moves));
    const danger = t => (Number(t.spec.level) || 0) * 2 + (t.damageDealt ?? 0) / 5;
    const pick = {
      nearest: () => scored.filter(x => x.moves === min).map(x => x.t),
      weakest: () => [foes.reduce((a, b) => (looks(b) < looks(a) ? b : a))],
      dangerous: () => [foes.reduce((a, b) => (danger(b) > danger(a) ? b : a))],
      casters: () => foes.filter(t => t.prep?.isCaster || t.prep?.isHealer),
      leader: () => foes.filter(t => commandOf(run, t)?.unit === t)
    }[party.target];
    for ( const t of pick?.() ?? [] ) add("hurt", t.id, points);
  }
  if ( party.fallen === "finish" ) {
    for ( const t of enemiesOf(run, u) ) if ( t.active && t.status === STATUS.DOWN && !t.stable && perceives(run, u, t) ) add("hurt", t.id, points);
  }
  const fallenKind = { tie: "bind", rob: "rob" }[party.fallen];
  if ( fallenKind ) for ( const t of enemiesOf(run, u) ) if ( relevant(run, u, fallenKind, t) && perceives(run, u, t) ) add(fallenKind, t.id, points);
  const friends = run.units.filter(a => a !== u && a.side === u.side && a.active && ![STATUS.DEAD, STATUS.FLED].includes(a.status));
  // (Healing the hurt or guarding the weakest, a friend held fast is worth getting loose: half the wish.)
  if ( party.care === "heal" || party.care === "guard" ) {
    for ( const a of friends ) if ( freeable(run, a) && perceives(run, u, a) ) add("free", a.id, points / 2);
  }
  if ( party.care === "heal" && canHeal ) {
    for ( const a of friends ) if ( perceives(run, u, a, { crisis: true }) && (a.status === STATUS.DOWN || frac(a) < 0.75) ) add("heal", a.id, points);
  } else if ( party.care === "guard" ) {
    add("protect", friends.filter(isStanding).sort((a, b) => looks(a) - looks(b))[0]?.id, points);
  } else if ( party.care === "self" ) {
    for ( const k of new Set([...u.desire.logic.keys(), ...u.desire.style.keys()]) ) {
      const [kind, targetId] = parseKey(k);
      if ( (kind === "heal" || kind === "protect" || kind === "aid" || kind === "free") && targetId !== u.id ) add(kind, targetId, -points);
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
