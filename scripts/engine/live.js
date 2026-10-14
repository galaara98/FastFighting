/**
 * Live battles: a fight played a turn at a time on the table's own combat tracker. The players run their characters;
 * FastFighting plays everyone else, one turn when it comes up. Between turns the run lives on (and is kept, as a
 * snapshot, so a lost connection loses nothing):
 *   beginLive      the fight set up from the battle as it stands, with who the players run
 *   liveTurn       a simulated turn (an NPC's, or a character the GM lets FastFighting play)
 *   pcTurn         a player's turn, as it went: what was read of it (`observe`) and the sheets as they now are
 *   syncFromSheets the sheets are the truth for hit points, conditions, resources and where everyone stands
 *   applyFact      what the GM says came of the table's own rolls: a fear, a grudge, a talk, a surrender
 *   mindOf         what a creature wants and feels, for the GM
 *   snapshotRun / restoreRun
 *
 * Decisions that belong to people, not the engine: a player's reactions (spec.reactionPrefs[reactionId]: "always",
 * "ask" or "never"; asked by default) and its fate (spec.rerolls {self, team}: spent to save its own life, a
 * friend's); an NPC's reactions as the GM says (live.npcReactions: "calculated", the engine's own judgement, or "ask").
 * A question stops the turn (NeedsDecision); the turn is played again from its snapshot, the same dice and the answer.
 * A player's other resources (Luck and the like) are never spent by the engine.
 * Pure: no Foundry globals.
 */
import { STATUS, SWAY, NEUTRAL_PARTY, clamp } from "../constants.js";
import {
  prepareBattle, beginRun, beginRound, playTurn, afterTurn, endRun, startTurn, noteCommand, log, notice, settleSides,
  breakOnHarm, noteHarm, noteFall, noteHeal, captureUnit, strikeOutOfTurn, settleAftermath
} from "./simulator.js";
import { createRun, createUnit, isStanding, areEnemies, edgeDistance } from "./battle-state.js";
import { threats } from "./behavior/reactions.js";
import { createRng, deriveSeed } from "./rng.js";
import { prepareDoors } from "./behavior/doors.js";
import { recompute, applyOutcome } from "./behavior/effects.js";
import { reactionsPerRound } from "./behavior/reactions.js";
import { resolveTalk, applySway, aimOf, talkDC, stepsToConvince } from "./behavior/talk.js";
import { rankedDesires, desireBand, want } from "./behavior/desire.js";
import { joinSide, standAside, turnOn } from "./behavior/neutral.js";

/** A question the turn can't go on without: whether {unitId} uses {reactionId} because of {trigger} (by {byId}). */
export class NeedsDecision extends Error {
  constructor(request) {
    super(`FastFighting needs a decision: ${request.key}`);
    this.name = "NeedsDecision";
    this.request = request;
  }
}

/** What the system already does itself, for the creatures FastFighting plays (adapter liveOwnership). */
const SYSTEM_DEFAULTS = Object.freeze({ recovery: false, persistent: false, afflictions: false, repeatSaves: false });

/**
 * The live state's decisions and hooks (kept out of the snapshot: functions), on top of what it remembers.
 */
function attach(run, live) {
  run.live = live;
  live.decide = decide;
  live.mayReroll = mayReroll;
  live.systemOwns = (u, what) => live.players.has(u.id) || !!live.owns[what];
  return run;
}

/**
 * A live battle, from its spec as it stands (spec.options.initiativeOrder: the tracker's order).
 * @param {object} spec
 * @param {object} rules
 * @param {object} options
 * @param {number} options.seed
 * @param {Iterable<string>} [options.players]    ids of the characters the players run
 * @param {object} [options.owns]                 what the system does itself (SYSTEM_DEFAULTS' keys)
 * @param {string} [options.npcReactions]         "calculated" (default) or "ask"
 */
export function beginLive(spec, rules, { seed, players = [], owns = {}, npcReactions = "calculated" } = {}) {
  const run = beginRun(prepareBattle(spec, rules), seed, { log: true });
  attach(run, {
    seed, seq: 0, players: new Set(players), owns: { ...SYSTEM_DEFAULTS, ...owns }, npcReactions,
    answers: new Map(), asked: new Map(), gm: new Map(), facts: []
  });
  noteCommand(run, true);
  return run;
}

/** A moment of the GM's own, outside anyone's turn (what the GM says came of the table's rolls): told on its own. */
export function gmMoment(run, id = null) {
  startTurn(run, id ? run.byId.get(id) ?? null : null);
}

/** A new round on the tracker. */
export function liveRound(run, round) {
  beginRound(run, round);
}

/** The dice for the next turn: its own, from the fight's seed and how many turns came before (the same on replay). */
function nextDice(run, salt = 0) {
  run.live.seq += 1;
  run.live.asked = new Map();
  // (A turn played again after a rewind: fresh dice, `salt` times over.)
  run.rng = createRng(deriveSeed(run.live.seed, run.live.seq + salt * 100003));
}

/**
 * A simulated turn. `answers`: what was asked and answered for it so far (key -> true/false), when it's played again.
 * Returns {events, ended}; throws NeedsDecision when someone must be asked first (restore the snapshot taken before
 * it, ask, and play it again with the answer). `salt`: played again after a rewind, with fresh dice.
 */
export function liveTurn(run, id, { answers = null, salt = 0 } = {}) {
  const u = run.byId.get(id);
  if ( !u ) throw new Error(`No creature ${id} in this battle`);
  nextDice(run, salt);
  spotlit(run, u);
  run.live.answers = new Map(answers ?? []);
  const from = run.log.length;
  const ended = playTurn(run, u);
  return { events: run.log.slice(from), ended };
}

/**
 * A player's turn, played at the table: what was read of it (events in the engine's own log shapes: attack, save,
 * auto, heal, talk, move, control, ...), then the sheets as they now are (`states`, as syncFromSheets takes them). A
 * creature the sheets show fallen fell to whoever harmed it this turn. `facts`: what the GM said came of it meanwhile
 * (applyFact's), told with it. Returns {events, ended, changes}. (Begun and ended apart, pcTurnBegin and pcTurnEnd,
 * when something happens in the middle of it: a foe's reaction.)
 */
export function pcTurn(run, id, events = [], states = null, facts = []) {
  const from = run.log.length;
  pcTurnBegin(run, id);
  const out = pcTurnEnd(run, id, events, states, facts);
  return { ...out, events: run.log.slice(from) };
}

/** A player's turn begins: its own dice, and what comes back to it (its reaction; being hurt now, if it was since). */
export function pcTurnBegin(run, id) {
  const u = run.byId.get(id);
  if ( !u ) throw new Error(`No creature ${id} in this battle`);
  nextDice(run);
  spotlit(run, u);
  noteCommand(run);
  startTurn(run, u);
  u.beingHurt = !!u.hurtSinceTurn;
  u.hurtSinceTurn = false;
  u.reactionsLeft = reactionsPerRound(run.prep.rules, u);
  u.disengaged = false;
}

/**
 * A player's turn ends: what was read of it, the sheets, the GM's facts (pcTurn's), and what comes after a turn.
 * Returns {events, ended, changes, synced}: `synced` everyone as the sheets had them, before what the engine made of
 * the turn (a death burst, a fact's consequences), for the sheets to be told.
 */
export function pcTurnEnd(run, id, events = [], states = null, facts = []) {
  const u = run.byId.get(id);
  if ( !u ) throw new Error(`No creature ${id} in this battle`);
  const from = run.log.length;
  const harmers = new Map();
  for ( const e of events ) observe(run, u, e, harmers);
  // (A spotlight system's hand-off, as the roll read says: Daggerheart's roll with Fear, or one that failed.)
  if ( events.some(e => e.handoff) ) u.handoff = true;
  const changes = states ? syncFromSheets(run, states) : [];
  // (Everyone as the sheets now have them: what the engine makes of the turn from here, a death burst, is its own.)
  const synced = captureAll(run);
  for ( const f of facts ) applyFact(run, f);
  for ( const c of changes ) {
    const t = run.byId.get(c.id);
    if ( t && c.fell ) noteFall(run, t, harmers.get(c.id) ?? null);
  }
  tickEffects(run, u);
  u.turnsTaken += 1;
  const ended = afterTurn(run, u);
  return { events: run.log.slice(from), ended, changes, synced };
}

/** Whose turn it was last, and when each had one (a spotlight system's next turn goes by it). */
function spotlit(run, u) {
  const spot = (run.live.spot ??= { last: null, up: {} });
  spot.last = u.id;
  spot.up[u.id] = run.live.seq;
  u.handoff = false; // (a spotlight's hand-off is this turn's own)
}

/**
 * A spotlight system's next turn (no initiative: the GM gives the spotlight): whom FastFighting would give it to, as
 * the rules say (rules.nextSpotlight(run, {last, up}): `up` each one's last turn, by turn number), else the next able
 * creature in order after the last to act. Null: no one.
 */
export function nextSpotlight(run) {
  const spot = run.live.spot ?? { last: null, up: {} };
  const last = spot.last ? run.byId.get(spot.last) ?? null : null;
  const rules = run.prep.rules;
  if ( rules.nextSpotlight ) return rules.nextSpotlight(run, { last, up: spot.up }) ?? null;
  const able = run.order.filter(u => u.active && u.status === STATUS.STANDING);
  if ( !able.length ) return null;
  const at = last ? run.order.indexOf(last) : -1;
  return able.find(u => run.order.indexOf(u) > at) ?? able[0];
}

/** An engine-only effect's rounds run down at the end of its bearer's turn (the system keeps its own conditions). */
function tickEffects(run, u) {
  if ( !u.effects?.length ) return;
  for ( const e of u.effects ) e.rounds -= 1;
  const before = u.effects.length;
  u.effects = u.effects.filter(e => e.rounds > 0);
  if ( u.effects.length !== before ) {
    recompute(u);
    settleSides(run);
  }
}

const say = run => (unit, data) => log(run, unit, data);

/**
 * One thing a player's character did, as the engine would have seen it: told in its own shape, and what it sets
 * going (a foe's grudge, its friends' vengeance, a neutral's view of it, a talk's persuasion). Hit points and
 * conditions come from the sheets, not from here. ({type: "handoff"}: a roll that told nothing but that the spotlight
 * goes to the GM.)
 */
export function observe(run, u, e, harmers = new Map()) {
  const t = e.targetId ? run.byId.get(e.targetId) : null;
  const named = t ? { target: t.spec.name, targetId: t.id } : {};
  switch ( e.type ) {
    case "attack":
    case "save":
    case "auto": {
      if ( !t ) return;
      if ( !t.active ) notice(run, t, "attacked", u);
      t.lastAttackerId = u.id;
      const held = t.grudges?.get(u.id);
      if ( held && !held.provoked ) {
        held.provoked = true; // they took from me, and now this
        want(t, "hurt", u.id, 60);
      }
      u.revealed = true;
      run.blood = true;
      log(run, u, { ...e, ...named });
      if ( e.melee ) {
        u.adjacent.add(t.id);
        t.adjacent.add(u.id);
      }
      if ( e.damage > 0 ) {
        breakOnHarm(run, u, t, e.damageTypes ?? (e.damageType ? [e.damageType] : null));
        noteHarm(run, u, t, e.damage);
        harmers.set(t.id, u);
      }
      return;
    }
    case "heal":
      if ( !t ) return;
      noteHeal(run, u, t, Math.max(0, Number(e.amount) || 0), !!e.revived, { action: e.action ?? "", potion: !!e.potion, check: e.check ?? null });
      return;
    case "talk": {
      if ( !t || !["persuade", "intimidate", "deceive"].includes(e.kind) ) return;
      const s = u.spec.social?.pitches?.[e.kind];
      const pitch = {
        target: t, kind: e.kind, aim: aimOf(u, t, run), skill: e.skill ?? s?.skill ?? e.kind, mod: e.mod ?? s?.mod ?? 0,
        dc: e.dc ?? talkDC(run, u, t, e.kind), dcLabel: e.dcStat ?? t.spec.social?.resist?.[e.kind]?.label ?? "DC"
      };
      resolveTalk(run, u, pitch, { degree: clamp(Math.round(Number(e.degree) || 0), 0, 3), natural: e.natural ?? null, total: e.total ?? null }, say(run));
      return;
    }
    case "handoff":
      return; // (only the spotlight's hand-off: pcTurnEnd marks it)
    default:
      // (Anything else in the engine's own shape, told as it is: a move, a raised shield, a maneuver, a buff.)
      log(run, u, { ...e, ...named });
  }
}

/** Statuses only the engine knows (the sheets can't say a creature ran or gave up). */
const ENGINE_STATUSES = new Set([STATUS.FLED, STATUS.SURRENDERED, STATUS.STOOD_DOWN, STATUS.BEATEN]);

/**
 * An effect whose only lasting part is conditions the sheet now carries (written there after the turn it landed):
 * the sheet keeps it from here on. One with anything only the engine knows (a taunt, a mark, against one foe only,
 * ending on harm, a repeated save, bonuses) stays.
 */
const sheetOwned = e => Object.keys(e.conditions ?? {}).length > 0 && !e.conditions.controlled && !e.taunt && !e.mark?.length && !e.onlyVs
  && !e.endsOnHarm && !e.endsOnDamage && !e.repeatSave && !e.mods && !e.iwr && !e.boost && !e.vs && !e.vsSort && !e.uses;

/**
 * The sheets as they now are, by creature id: {hp, temp, stamina, maxHp, dying, wounded, doomed, stable, status
 * ("standing" | "down" | "dead"), conditions {key: value}, persistent [DamagePart], resources {key: n}, position
 * {x, y} (feet), shieldRaised}; anything left out stays as the engine has it. Returns what changed that the engine
 * didn't do: [{id, fell, died, revived, hp (the change), moved}].
 */
export function syncFromSheets(run, states) {
  const changes = [];
  const moved = [];
  for ( const [id, s] of Object.entries(states ?? {}) ) {
    const u = run.byId.get(id);
    if ( !u || !s ) continue;
    const c = { id, fell: false, died: false, revived: false, hp: 0, moved: false };
    if ( Number.isFinite(s.hp) ) {
      c.hp = s.hp - u.hp;
      u.hp = s.hp;
    }
    for ( const k of ["temp", "stamina", "maxHp", "dying", "wounded", "doomed"] ) if ( Number.isFinite(s[k]) ) u[k] = s[k];
    if ( typeof s.stable === "boolean" ) u.stable = s.stable;
    if ( s.status && !ENGINE_STATUSES.has(u.status) ) {
      const was = u.status;
      let now = s.status === "dead" ? STATUS.DEAD : s.status === "down" ? STATUS.DOWN : STATUS.STANDING;
      // (Dead stays dead unless the sheet has it up again: a sheet that only says "down" hasn't brought it back.)
      if ( was === STATUS.DEAD && now === STATUS.DOWN ) now = STATUS.DEAD;
      if ( was === STATUS.STANDING && now !== STATUS.STANDING ) {
        c.fell = true;
        u.wasDowned = true;
      }
      if ( now === STATUS.DEAD && was !== STATUS.DEAD ) c.died = true;
      if ( was !== STATUS.STANDING && now === STATUS.STANDING ) c.revived = true;
      u.status = now;
    }
    if ( s.conditions ) {
      const conds = { ...s.conditions };
      u.prone = !!conds.prone;
      delete conds.prone;
      u.baseConds = Object.fromEntries(Object.entries(conds).map(([k, v]) => [k, v === true ? 1 : Number(v) || 0]).filter(([, v]) => v > 0));
      // The sheet says what it has; the engine remembers why (who frightened it, whose spell holds it, who has it in
      // its grip): a system's condition often can't say. An effect of the engine's whose conditions the sheet still
      // shows stays, at no more than the sheet's value, for as long as the sheet shows it (the system, or the table,
      // ends it); one the sheet no longer shows is gone.
      const shown = u.baseConds;
      u.effects = (u.effects ?? []).flatMap(e => {
        if ( !sheetOwned(e) ) return [e];
        const keys = Object.keys(e.conditions).filter(k => (shown[k] ?? 0) > 0);
        if ( !keys.length ) return [];
        const conditions = Object.fromEntries(keys.map(k => [k, Math.min(e.conditions[k] === true ? 1 : Number(e.conditions[k]) || 1, shown[k])]));
        return [{ ...e, conditions, rounds: Infinity, sheetHeld: true }];
      });
      recompute(u);
    }
    if ( Array.isArray(s.persistent) ) {
      // (Who set each burning, where the engine knows it: kept, for whoever gets the credit for what it does.)
      const known = new Map((u.persistent ?? []).map(p => [JSON.stringify(p.part), p.sourceId]));
      u.persistent = s.persistent.map(part => ({ part, sourceId: known.get(JSON.stringify(part)) ?? null }));
    }
    if ( s.resources ) Object.assign(u.resources, s.resources);
    if ( typeof s.shieldRaised === "boolean" ) u.shieldRaised = s.shieldRaised;
    if ( s.position && Number.isFinite(s.position.x) && Number.isFinite(s.position.y) && (!u.pos || u.pos.x !== s.position.x || u.pos.y !== s.position.y) ) {
      u.pos = { x: s.position.x, y: s.position.y };
      c.moved = true;
      moved.push(u);
    }
    if ( c.fell || c.died || c.revived || c.hp || c.moved ) changes.push(c);
  }
  if ( moved.length ) {
    run.geo = (run.geo ?? 0) + 1;
    for ( const u of moved ) engage(run, u);
  }
  settleSides(run);
  return changes;
}

/** Who u is trading blows with now it stands where it does: the foes beside it (and none it left). */
function engage(run, u) {
  for ( const id of [...u.adjacent] ) {
    const o = run.byId.get(id);
    const d = o ? edgeDistance(u, o) : null;
    if ( !o || d === null || d > 5.5 ) {
      u.adjacent.delete(id);
      o?.adjacent.delete(u.id);
    }
  }
  for ( const o of run.units ) {
    if ( o === u || !isStanding(o) || !areEnemies(run, u, o) ) continue;
    const d = edgeDistance(u, o);
    if ( d !== null && d <= 5.5 ) {
      u.adjacent.add(o.id);
      o.adjacent.add(u.id);
    }
  }
}

/**
 * The foes whose reach a creature leaves by moving (in a live battle, a player's token, from where the engine has it to
 * \`to\`, in feet): each that could strike as it goes, with the strike it would make.
 */
export function leavingReach(run, id, to) {
  const u = run.byId.get(id);
  if ( !u?.pos || !to ) return [];
  const near = threats(run, u);
  const from = u.pos;
  u.pos = { x: to.x, y: to.y };
  const out = near.filter(({ e, strike }) => (edgeDistance(e, u) ?? 0) > (strike.reach ?? 5) + 0.5).map(({ e, strike }) => ({ reactorId: e.id, strike }));
  u.pos = from;
  return out;
}

/**
 * Foes whose opportunity strikes answer a player's character lowering its guard in their reach, where the system says
 * so (rules.opportunityOn: "foeOpening", a ranged attack or a manipulate action, PF2e): [{reactorId, strike}].
 */
export function openingFor(run, id, trigger = "foeOpening") {
  const u = run.byId.get(id);
  if ( !u ) return [];
  return threats(run, u, null, trigger).map(({ e, strike }) => ({ reactorId: e.id, strike }));
}

/**
 * A foe's reaction to what a player did, now (its turn's dice): the strike as the player's character leaves its reach,
 * or (`trigger`) at another moment its opportunity strikes answer. Returns the events it made.
 */
export function reactNow(run, reactorId, targetId, strike, trigger = null) {
  const e = run.byId.get(reactorId);
  const t = run.byId.get(targetId);
  if ( !e || !t || !strike ) return [];
  const from = run.log.length;
  e.reactionsLeft = Math.max(0, (e.reactionsLeft ?? 1) - 1);
  log(run, e, { type: "opportunity", target: t.spec.name, targetId: t.id, action: strike.name, ...(trigger && trigger !== "foeLeavesReach" ? { trigger } : {}) });
  strikeOutOfTurn(run, e, strike, t);
  return run.log.slice(from);
}

/** How each creature could reach each other one, worked out again from the map (foundry/battle.js approachFor). */
export function setApproach(run, approach) {
  run.prep.spec.approach = approach;
  run.geo = (run.geo ?? 0) + 1;
}

/* -------------------------------------------- */
/*  Decisions                                   */
/* -------------------------------------------- */

/**
 * Does u use this reaction? A player's character as its player said (always, never, or ask: asked by default); an
 * NPC as the engine judges, unless the GM wants to be asked. `would` is the engine's own judgement.
 */
function decide(run, u, { reaction, trigger, by = null, ally = null, would }) {
  if ( reaction?.passive ) return !!would; // (always on: no one chooses it)
  const live = run.live;
  const player = live.players.has(u.id);
  const id = reaction?.id ?? "";
  const pref = player ? (u.spec.reactionPrefs?.[id] ?? "ask") : (live.npcReactions === "ask" ? "ask" : "calculated");
  if ( pref === "never" ) return false;
  if ( pref === "always" ) return true;
  if ( pref !== "ask" ) return !!would;
  // (Asked once per time it comes up: the same key when the turn is played again, so the answer finds its place.)
  const base = [u.id, id, trigger, by?.id ?? "", ally?.id ?? ""].join("|");
  const n = (live.asked.get(base) ?? 0) + 1;
  live.asked.set(base, n);
  const key = `${base}#${n}`;
  if ( live.answers.has(key) ) return !!live.answers.get(key);
  throw new NeedsDecision({
    key, unitId: u.id, player, reactionId: id, reaction: reaction?.label ?? "", trigger, byId: by?.id ?? null, allyId: ally?.id ?? null, would: !!would
  });
}

/** May this creature's fate be spent on victim's life? A player's, only as its player said; an NPC's, as ever. */
function mayReroll(run, spender, victim) {
  if ( !run.live.players.has(spender.id) ) return true;
  const said = spender.spec.rerolls ?? {};
  return spender === victim ? !!said.self : !!said.team;
}

/* -------------------------------------------- */
/*  What the GM says                            */
/* -------------------------------------------- */

/** A desire's band as a level (the middle of it: 10, 30, 50, 70, 90). */
export const bandLevel = band => clamp(Math.round(Number(band) || 0), 0, 4) * 20 + 10;

/**
 * What the GM says came of the table's own rolls, as the simulation would have it:
 *   {kind: "want", id, desire: "hurt"|"protect"|"heal"|"avoid"|"talk"|"aid", targetId, level}  ("avoid": a fear)
 *   {kind: "forget", id, desire, targetId}                      the GM's want taken back
 *   {kind: "talk", byId, id, talk: "persuade"|"intimidate"|"deceive", degree (0-3)}   a talk at the table
 *   {kind: "sway", byId, id, outcome: SWAY.*}                   talked into it (surrender, flee, stand down, ...)
 *   {kind: "taunt", byId, id, level?, rounds?, label?}           goaded into going for byId
 *   {kind: "insult", byId, id}                                  won't listen to byId again
 *   {kind: "waver", id, on}                                     shaken (or steady again)
 *   {kind: "flee" | "surrender" | "standDown", id, byId?}       done with the fight
 *   {kind: "side", id, side}                                    takes no side (NEUTRAL_PARTY) or joins one
 *   {kind: "turnOn", id, byId}                                  one taking no side turns on byId's side
 * Returns true if it was applied.
 */
export function applyFact(run, fact) {
  const u = run.byId.get(fact.id);
  const by = fact.byId ? run.byId.get(fact.byId) : null;
  if ( !u ) return false;
  const tell = say(run);
  switch ( fact.kind ) {
    case "want": {
      const t = run.byId.get(fact.targetId);
      if ( !t || !u.desire || t === u ) return false;
      const key = `${fact.desire}|${t.id}`;
      const mem = `${u.id}|${key}`;
      // (What it had stated before, so taking the GM's word back leaves it as it was.)
      if ( !run.live.gm.has(mem) ) run.live.gm.set(mem, u.desire.stated.has(key) ? u.desire.stated.get(key) : null);
      u.desire.stated.set(key, clamp(Number(fact.level) || 0, 0, 100));
      break;
    }
    case "forget": {
      const key = `${fact.desire}|${fact.targetId}`;
      const mem = `${u.id}|${key}`;
      if ( !run.live.gm.has(mem) || !u.desire ) return false;
      const before = run.live.gm.get(mem);
      if ( before === null ) u.desire.stated.delete(key);
      else u.desire.stated.set(key, before);
      run.live.gm.delete(mem);
      break;
    }
    case "talk": {
      if ( !by ) return false;
      observe(run, by, { type: "talk", targetId: u.id, kind: fact.talk, degree: fact.degree });
      break;
    }
    case "sway":
      if ( !by || !Object.values(SWAY).includes(fact.outcome) ) return false;
      applySway(run, by, u, fact.outcome, tell, "down");
      break;
    case "taunt":
      if ( !by ) return false;
      applyOutcome(u, { taunt: fact.level ?? true, rounds: fact.rounds ?? 1, label: fact.label ?? "" }, by.id, { id: "gm-taunt", name: fact.label ?? "" });
      break;
    case "insult":
      if ( !by ) return false;
      u.offendedBy.add(by.id);
      break;
    case "waver":
      u.wavering = !!fact.on;
      break;
    case "flee":
    case "surrender":
    case "standDown": {
      const status = { flee: STATUS.FLED, surrender: STATUS.SURRENDERED, standDown: STATUS.STOOD_DOWN }[fact.kind];
      if ( by ) {
        applySway(run, by, u, { flee: SWAY.FLEE, surrender: SWAY.SURRENDER, standDown: SWAY.STAND_DOWN }[fact.kind], tell, "down");
        break;
      }
      u.status = status;
      u.fellRound ??= run.round;
      if ( status === STATUS.FLED ) u.ranRound = run.round;
      for ( const id of [...u.adjacent] ) run.byId.get(id)?.adjacent.delete(u.id);
      u.adjacent.clear();
      log(run, u, fact.kind === "flee" ? { type: "flee", why: "gm" } : { type: "sway", outcome: status === STATUS.SURRENDERED ? SWAY.SURRENDER : SWAY.STAND_DOWN });
      break;
    }
    case "side":
      if ( fact.side === NEUTRAL_PARTY ) standAside(run, u);
      else if ( run.prep.sides[fact.side] ) joinSide(run, u, fact.side, tell);
      else return false;
      settleSides(run);
      break;
    case "turnOn":
      if ( !by || u.side !== NEUTRAL_PARTY ) return false;
      turnOn(run, u, by, "gm", tell);
      break;
    default:
      return false;
  }
  run.live.facts.push({ ...fact, round: run.round });
  return true;
}

/* -------------------------------------------- */
/*  For the GM to see                           */
/* -------------------------------------------- */

/**
 * What a creature wants and feels: its strongest desires (kind, at whom, how badly, its band, what drives it, and
 * whether the GM set it), the persuasion each side has made on it, who it won't listen to, whether it's shaken, the
 * taunts on it, who has hurt it, and where it stands.
 */
export function mindOf(run, id, { top = 5 } = {}) {
  const u = run.byId.get(id);
  if ( !u ) return null;
  const gm = new Set([...run.live?.gm?.keys() ?? []].filter(k => k.startsWith(`${u.id}|`)).map(k => k.slice(u.id.length + 1)));
  return {
    id: u.id, status: u.status, side: u.side, homeSide: u.homeSide, against: [...(u.against ?? [])],
    desires: rankedDesires(run, u).slice(0, top).map(d => ({ ...d, band: desireBand(d.level), gm: gm.has(`${d.kind}|${d.targetId}`) })),
    gm: [...gm].map(k => {
      const [kind, targetId] = k.split("|");
      return { kind, targetId, level: u.desire?.stated.get(k) ?? 0 };
    }),
    sway: [...(u.sway ?? [])].map(([side, progress]) => ({ side, progress, steps: stepsToConvince(u, run) })),
    offendedBy: [...(u.offendedBy ?? [])],
    rebuffed: Object.fromEntries(u.rebuffed ?? []),
    harmedBy: Object.fromEntries(u.harmedBy ?? []),
    wavering: !!u.wavering,
    taunts: (u.effects ?? []).filter(e => e.taunt > 0 && e.sourceId).map(e => ({ byId: e.sourceId, level: e.taunt, rounds: e.rounds })),
    swayed: u.swayOutcome ?? null
  };
}

/** Every creature as it stands (simulator.js captureUnit), by id: before and after a turn, for what it changed (changes.js). */
export const captureAll = run => Object.fromEntries(run.units.map(u => [u.id, captureUnit(u, run.prep.rules)]));

/** The fight over: who won, and what came of it (the aftermath only when the GM says so: `settle`). */
export function endLive(run, { ended = true, settle = false } = {}) {
  return endRun(run, ended, { capture: true, settle });
}

/** The aftermath of a live battle that's over, when the GM says (simulator.js settleAftermath). */
export function liveAftermath(run) {
  settleAftermath(run);
}

/* -------------------------------------------- */
/*  Keeping it                                  */
/* -------------------------------------------- */

/** A creature's state that's only a convenience (worked out again as needed) or the battle itself (its spec). */
const UNIT_SKIP = new Set(["prep", "spec", "turn", "nearby", "nearbyKey", "pool", "sharedPools"]);
/** The run's own: the battle, the creatures (kept apart), the dice and anything worked out again as needed. */
const RUN_SKIP = new Set(["prep", "units", "byId", "rng", "logTo", "trapLog", "acting", "live"]);
const CACHE = /(Cache|CacheInner|Round|Geo|Depth)$/;

function encode(v, units) {
  if ( v === null || v === undefined ) return v ?? null;
  if ( typeof v === "function" ) return undefined;
  if ( typeof v === "number" ) return Number.isFinite(v) ? v : { $num: String(v) };
  if ( typeof v !== "object" ) return v;
  if ( units.has(v) ) return { $unit: v.id };
  if ( v instanceof Map ) return { $map: [...v].map(([k, x]) => [encode(k, units), encode(x, units)]) };
  if ( v instanceof Set ) return { $set: [...v].map(x => encode(x, units)) };
  if ( Array.isArray(v) ) return v.map(x => encode(x, units) ?? null);
  const out = {};
  for ( const [k, x] of Object.entries(v) ) {
    const e = encode(x, units);
    if ( e !== undefined ) out[k] = e;
  }
  return out;
}

function decode(v, byId) {
  if ( v === null || typeof v !== "object" ) return v;
  if ( Array.isArray(v) ) return v.map(x => decode(x, byId));
  if ( "$unit" in v ) return byId.get(v.$unit) ?? null;
  if ( "$num" in v ) return Number(v.$num);
  if ( "$map" in v ) return new Map(v.$map.map(([k, x]) => [decode(k, byId), decode(x, byId)]));
  if ( "$set" in v ) return new Set(v.$set.map(x => decode(x, byId)));
  const out = {};
  for ( const [k, x] of Object.entries(v) ) out[k] = decode(x, byId);
  return out;
}

/**
 * Everything the fight remembers, as plain data (for JSON): the creatures, the fight's own state, the log, the live
 * state. Without `log`, only how long the log was (a turn's snapshot: the log itself is kept once, with the battle).
 */
export function snapshotRun(run, { log = true } = {}) {
  const units = new Set(run.units);
  const unitData = {};
  for ( const u of run.units ) {
    const out = {};
    for ( const [k, v] of Object.entries(u) ) {
      if ( UNIT_SKIP.has(k) ) continue;
      const e = encode(v, units);
      if ( e !== undefined ) out[k] = e;
    }
    unitData[u.id] = out;
  }
  const runData = {};
  for ( const [k, v] of Object.entries(run) ) {
    if ( RUN_SKIP.has(k) || CACHE.test(k) || k === "log" ) continue;
    const e = encode(v, units);
    if ( e !== undefined ) runData[k] = e;
  }
  const { decide: _d, mayReroll: _m, systemOwns: _s, ...live } = run.live ?? {};
  return { units: unitData, run: runData, ...(log ? { log: encode(run.log ?? [], units) } : { logLength: run.log?.length ?? 0 }), live: encode(live, units) };
}

/**
 * The fight as it was kept, on its battle (the same spec and rules it began with): ready for its next turn. A snapshot
 * kept without its log takes `log` (the battle's, cut back to where it was). Creatures summoned mid-fight are made
 * again from their summoning (summonOf), then given what was kept of them.
 */
export function restoreRun(spec, rules, snap, { log = null } = {}) {
  const run = createRun(prepareBattle(spec, rules));
  // (The scene's doors, as a fight begun has them: their states are kept with the run.)
  run.prep.doors ??= prepareDoors(run.prep.spec, run.prep.rules);
  const called = [...(run.prep.summons?.values() ?? [])].flat();
  for ( const [id, data] of Object.entries(snap.units ?? {}) ) {
    if ( run.byId.has(id) || typeof data.summonOf !== "string" ) continue;
    const p = called.find(c => c.spec.id === data.summonOf);
    if ( !p ) continue;
    const s = createUnit(run.prep, p);
    s.id = id;
    run.units.push(s);
    run.byId.set(id, s);
  }
  for ( const [id, data] of Object.entries(snap.units ?? {}) ) {
    const u = run.byId.get(id);
    if ( !u ) continue;
    for ( const [k, v] of Object.entries(data) ) u[k] = decode(v, run.byId);
  }
  for ( const [k, v] of Object.entries(snap.run ?? {}) ) run[k] = decode(v, run.byId);
  for ( const u of run.units ) {
    u.sharedPools = run.sharedPools;
    recompute(u);
  }
  run.log = snap.log ? decode(snap.log, run.byId) : [...(log ?? [])].slice(0, snap.logLength ?? Infinity);
  run.trapLog = (unit, data) => log(run, unit, data);
  return attach(run, decode(snap.live ?? {}, run.byId));
}
