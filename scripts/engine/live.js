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
import { STATUS, SWAY, NEUTRAL_PARTY, HOSTILE_GROUPS, GROUPS, clamp } from "../constants.js";
import {
  prepareBattle, beginRun, beginRound, playTurn, afterTurn, endRun, startTurn, noteCommand, log, notice, settleSides,
  breakOnHarm, noteHarm, noteFall, noteHeal, captureUnit, strikeOutOfTurn, settleAftermath, rethink
} from "./simulator.js";
import { createRun, createUnit, isStanding, areEnemies, edgeDistance, groupKeyOf, leadershipOf, SLOTS, headsUp } from "./battle-state.js";
import { threats } from "./behavior/reactions.js";
import { createRng, deriveSeed } from "./rng.js";
import { prepareDoors } from "./behavior/doors.js";
import { recompute, applyOutcome } from "./behavior/effects.js";
import { reactionsPerRound } from "./behavior/reactions.js";
import { resolveTalk, applySway, aimOf, talkDC, stepsToConvince, bestPitch } from "./behavior/talk.js";
import { expectOf } from "./behavior/bargain.js";
import { rankedDesires, desireBand, want, levelOf, holdDesire, releaseDesire, forgetSides, styleOf } from "./behavior/desire.js";
import { validConditionKey, CORE_CONDITIONS, conditionMost } from "./conditions.js";
import { GOALS, holdGoal, goalsOf } from "./behavior/goals.js";
import { isBound, release } from "./behavior/holds.js";
import { afflictionFor } from "./behavior/afflictions.js";
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

/**
 * The dice for the next turn: its own, from the fight's seed and how many turns came before (the same on replay), and
 * `nonce`, drawn fresh as the turn begins (a live battle's: what's kept of the battle, which any player's client is sent,
 * never says what the next turn's dice will be).
 */
function nextDice(run, salt = 0, nonce = 0) {
  run.live.seq += 1;
  run.live.asked = new Map();
  const base = nonce ? deriveSeed(run.live.seed, nonce) : run.live.seed;
  // (A turn played again after a rewind: fresh dice, `salt` times over.)
  run.rng = createRng(deriveSeed(base, run.live.seq + salt * 100003));
}

/**
 * A simulated turn. `answers`: what was asked and answered for it so far (key -> true/false), when it's played again.
 * Returns {events, ended}; throws NeedsDecision when someone must be asked first (restore the snapshot taken before
 * it, ask, and play it again with the answer). `salt`: played again after a rewind, with fresh dice.
 */
export function liveTurn(run, id, { answers = null, salt = 0, nonce = 0 } = {}) {
  const u = run.byId.get(id);
  if ( !u ) throw new Error(`No creature ${id} in this battle`);
  nextDice(run, salt, nonce);
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
export function pcTurnBegin(run, id, { nonce = 0 } = {}) {
  const u = run.byId.get(id);
  if ( !u ) throw new Error(`No creature ${id} in this battle`);
  nextDice(run, 0, nonce);
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
        want(t, "hurt", u.id, 60 * styleOf(t).retaliate);
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
const ENGINE_STATUSES = new Set([STATUS.FLED, STATUS.SURRENDERED, STATUS.STOOD_DOWN, STATUS.BEATEN, STATUS.BOUND]);

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
 * didn't do: [{id, fell, died, revived, bound, hp (the change), moved}].
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
    // (A prisoner stays one, unless its sheet has it dead.)
    if ( s.status && (!ENGINE_STATUSES.has(u.status) || (u.status === STATUS.BOUND && s.status === "dead")) ) {
      const was = u.status;
      let now = s.status === "dead" ? STATUS.DEAD : s.status === "down" ? STATUS.DOWN : STATUS.STANDING;
      // (Dead stays dead unless the sheet has it up again: a sheet that only says "down" hasn't brought it back.)
      if ( was === STATUS.DEAD && now === STATUS.DOWN ) now = STATUS.DEAD;
      // (Tied up and up again: a prisoner, not back in the fight.)
      if ( now === STATUS.STANDING && isBound(u) ) now = STATUS.BOUND;
      if ( was === STATUS.STANDING && now !== STATUS.STANDING ) {
        c.fell = true;
        u.wasDowned = true;
      }
      if ( now === STATUS.DEAD && was !== STATUS.DEAD ) c.died = true;
      if ( was !== STATUS.STANDING && now === STATUS.STANDING ) c.revived = true;
      if ( now === STATUS.BOUND && was !== STATUS.BOUND ) c.bound = true;
      u.status = now;
    }
    if ( s.conditions ) {
      const conds = { ...s.conditions };
      u.prone = !!conds.prone;
      delete conds.prone;
      u.baseConds = Object.fromEntries(Object.entries(conds).map(([k, v]) => [k, v === true ? 1 : Number(v) || 0]).filter(([, v]) => v > 0));
      // The sheet says what it has; the engine remembers why (who frightened it, whose spell holds it, who has it in
      // its grip): a system's condition often can't say. An effect of the engine's whose conditions the sheet still
      // shows stays, at no more than the sheet's value, until its own rounds run out or the sheet stops showing it (the
      // system, or the table, ended it); one the sheet no longer shows is gone. While it holds, it answers for what the
      // sheet shows of it: when it ends, the turn's change set clears it, and the helper takes it off the sheet (a
      // creature FastFighting plays never clears its own). What the sheet shows beyond it (more of it, from elsewhere)
      // stays the sheet's. What a sheet can't carry at all (s.carries(key) false: PF2e has no condition for losing the
      // turn to Command) the engine keeps as it was, for its own rounds.
      const shown = { ...u.baseConds };
      const carried = k => (typeof s.carries === "function" ? s.carries(k) : true);
      const answered = new Map();
      u.effects = (u.effects ?? []).flatMap(e => {
        if ( !sheetOwned(e) ) return [e];
        const own = Object.keys(e.conditions).filter(k => !carried(k));
        const held = Object.keys(e.conditions).filter(k => carried(k) && (shown[k] ?? 0) > 0);
        if ( !own.length && !held.length ) return [];
        const conditions = Object.fromEntries([
          ...own.map(k => [k, e.conditions[k]]),
          ...held.map(k => [k, Math.min(e.conditions[k] === true ? 1 : Number(e.conditions[k]) || 1, shown[k])])
        ]);
        return [own.length ? { ...e, conditions } : { ...e, conditions, sheetHeld: true }];
      });
      // (Any effect of the engine's answers for what the sheet shows of it: one with a life of its own too, ending on a
      // repeated save or when harmed. Not one toward a single creature: that's never the sheet's.)
      for ( const e of u.effects ) {
        if ( e.onlyVs ) continue;
        for ( const [k, v] of Object.entries(e.conditions ?? {}) ) {
          if ( carried(k) && (shown[k] ?? 0) > 0 ) answered.set(k, Math.max(answered.get(k) ?? 0, v === true ? 1 : Number(v) || 0));
        }
      }
      for ( const [k, v] of answered ) if ( (shown[k] ?? 0) <= v ) delete u.baseConds[k];
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
    if ( c.fell || c.died || c.revived || c.bound || c.hp || c.moved ) changes.push(c);
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
 *   {kind: "notice", id}                                        a bystander notices the fight (and joins it next round)
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
      // (Held there, whatever else it would want, until the GM hands it back: 0 sets it aside.)
      run.live.gm.set(`${u.id}|${fact.desire}|${t.id}`, true);
      holdDesire(u, fact.desire, t.id, clamp(Number(fact.level) || 0, 0, 100));
      break;
    }
    case "forget": {
      const mem = `${u.id}|${fact.desire}|${fact.targetId}`;
      if ( !run.live.gm.has(mem) || !u.desire ) return false;
      releaseDesire(u, fact.desire, fact.targetId);
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
    case "notice":
      if ( u.active || u.aware || u.status !== STATUS.STANDING ) return false;
      notice(run, u, "gm");
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
/*  Conditions, as the GM sets them             */
/* -------------------------------------------- */

/** How long the GM's word holds: so many rounds, or until it's taken off (by the GM, or the sheet). */
const lasting = rounds => (Number(rounds) > 0 ? Math.round(Number(rounds)) : Infinity);

/** A condition taken off a creature everywhere: its sheet's, and every effect's (one with nothing else to it goes). */
function lift(u, key) {
  if ( key === "prone" ) {
    u.prone = false;
    return;
  }
  if ( u.baseConds ) delete u.baseConds[key];
  u.effects = (u.effects ?? []).flatMap(e => {
    if ( !(key in (e.conditions ?? {})) ) return [e];
    const conditions = { ...e.conditions };
    delete conditions[key];
    const rest = Object.keys(conditions).length || e.mods || e.mark?.length || e.iwr || e.boost || e.taunt || e.uses || e.fastHealing || e.regen;
    return rest ? [{ ...e, conditions }] : [];
  });
}

/**
 * The GM moves an affliction on a creature to another stage (behavior/afflictions.js), or (0) ends it: {afflictionId,
 * stage}. A simple one is its condition's value too (setCondition moves it).
 */
export function setAffliction(run, id, { afflictionId, stage } = {}) {
  const u = run.byId.get(id);
  const a = u?.afflictions?.find(x => x.spec.id === afflictionId);
  if ( !a ) return false;
  const n = Math.max(0, Math.round(Number(stage) || 0));
  if ( n <= 0 ) u.afflictions = u.afflictions.filter(x => x !== a);
  else {
    a.stage = Math.min(a.spec.stages.length, n);
    a.inStage = 0;
    a.onsetLeft = 0;
  }
  recompute(u);
  settleSides(run);
  run.live?.facts.push({ kind: "affliction", id, afflictionId, stage: n, round: run.round });
  return true;
}

/**
 * The GM puts a condition on a creature, changes its value, or (0) takes it off: {key, value, byId, rounds}. Whatever
 * gave it before gives way to the GM's word. `byId`: who caused it, remembered (frightened by whom); `rounds`: how long
 * (none: until the GM takes it off, or its sheet does). What the system's sheets can show, the caller writes there
 * (changes.js, the helper); the rest the engine keeps, as a condition of its own (engine/conditions.js).
 */
export function setCondition(run, id, { key, value = 1, byId = null, rounds = null } = {}) {
  const u = run.byId.get(id);
  if ( !u || !validConditionKey(key) ) return false;
  const n = Math.max(0, Math.round(Number(value) || 0));
  // (Tied up: on it, no one needed; who did it, if the GM says, only for the story.)
  if ( key === "bound" ) {
    if ( n > 0 ) {
      u.bound = true;
      u.boundBy = byId && run.byId.has(byId) && byId !== u.id ? byId : null;
      u.boundRound = run.round;
      if ( u.status === STATUS.STANDING ) u.status = STATUS.BOUND;
    } else if ( isBound(u) ) release(run, u, { key: "bound" });
    settleSides(run);
    run.live?.facts.push({ kind: "condition", id, key, value: n, byId, rounds, round: run.round });
    return true;
  }
  // (One a simple affliction stands for, he gave it a disease: its stage moves with it.)
  const a = afflictionFor(u, key);
  if ( a ) return setAffliction(run, id, { afflictionId: a.spec.id, stage: n });
  lift(u, key);
  if ( key === "prone" ) u.prone = n > 0;
  else if ( n > 0 ) {
    const source = byId && run.byId.has(byId) && byId !== u.id ? byId : null;
    u.effects.push({ key: `gm:${key}`, conditions: { [key]: n }, sourceId: source, rounds: lasting(rounds), label: "", gm: true });
  }
  recompute(u);
  settleSides(run);
  run.live?.facts.push({ kind: "condition", id, key, value: n, byId, rounds, round: run.round });
  return true;
}

/**
 * The GM puts a condition toward another creature on one (engine/conditions.js RELATIONS): {kind, byId, rounds,
 * level}. Afraid of it (a fear: the desire to keep away, `level` its band), grabbed by it, goaded by it (for
 * `rounds`, 1 by default), controlled by it (fighting for its side), tied up by it (a prisoner), off guard to it alone.
 */
export function setRelation(run, id, { kind, byId, rounds = null, level = 2 } = {}) {
  const u = run.byId.get(id);
  const by = run.byId.get(byId);
  if ( !u || !by || by === u ) return false;
  switch ( kind ) {
    case "afraid":
      return applyFact(run, { kind: "want", id, desire: "avoid", targetId: by.id, level: bandLevel(level) });
    case "grabbed":
      u.grabbedBy = by.id;
      u.effects = u.effects.filter(e => e.key !== "gm:grabbed");
      u.effects.push({ key: "gm:grabbed", conditions: { grabbed: 1 }, sourceId: by.id, rounds: lasting(rounds), label: "", gm: true });
      break;
    case "goaded":
      return applyFact(run, { kind: "taunt", id, byId: by.id, rounds: Number(rounds) > 0 ? Math.round(rounds) : 1 });
    case "controlled":
      u.effects = u.effects.filter(e => !(e.gm && e.conditions?.controlled));
      u.effects.push({ key: "gm:controlled", conditions: { controlled: 1 }, sourceId: by.id, rounds: lasting(rounds), label: "", gm: true });
      break;
    case "bound":
      u.bound = true;
      u.boundBy = by.id;
      u.boundRound = run.round;
      if ( u.status === STATUS.STANDING ) u.status = STATUS.BOUND;
      break;
    case "exposedTo":
      u.effects = u.effects.filter(e => !(e.onlyVs && e.sourceId === by.id && e.gm));
      u.effects.push({ key: `gm:exposedTo:${by.id}`, conditions: { offGuard: 1 }, onlyVs: true, sourceId: by.id, rounds: lasting(rounds), label: "", gm: true });
      break;
    default:
      return false;
  }
  recompute(u);
  settleSides(run);
  run.live?.facts.push({ kind: "relation", id, relation: kind, byId, rounds, round: run.round });
  return true;
}

/**
 * Is it the players' to run? A player's character (run.live.players), or one under a player's character's control (a
 * charm, domination): the player decides for it as long as the control lasts.
 */
export function playerRuns(run, u) {
  const players = run.live?.players;
  if ( !players || !u ) return false;
  return players.has(u.id) || (!!u.controlledBy && players.has(u.controlledBy));
}

/**
 * The GM moves a creature to another side (or to none, NEUTRAL_PARTY): it joins it (neutral.js joinSide, standAside),
 * its leader is its new side's, and what it wants is worked out again: what no longer fits goes (desire.js
 * forgetSides), its own and everyone's toward it, and each creature in the fight thinks again (simulator.js rethink).
 * One under someone's control fights for its controller's side whatever the GM says, and wants what its controller
 * wants (desire.js puppetWishes). Taking no side, `group` is its friend group (1 to 3; none, on its own). A hostile
 * group the fight doesn't have yet (the 2nd, the 3rd) joins it, every side's enemy but those taking no side.
 */
export function setSide(run, id, side, { group = null } = {}) {
  const u = run.byId.get(id);
  if ( !u ) return false;
  const friends = side === NEUTRAL_PARTY && GROUPS.includes(Number(group)) ? Number(group) : null;
  if ( u.side === side && (side !== NEUTRAL_PARTY || (u.friendGroup ?? null) === friends) ) return false;
  if ( side !== NEUTRAL_PARTY && !run.prep.sides[side] ) {
    if ( !HOSTILE_GROUPS.includes(side) ) return false;
    editPrep(run, { kind: "side", key: side });
  }
  if ( u.side !== side && !applyFact(run, { kind: "side", id, side }) ) return false;
  if ( side === NEUTRAL_PARTY ) u.friendGroup = friends;
  // (Its place in the chain of the group it left: given up.)
  for ( const [key, chain] of Object.entries(run.prep.command ?? {}) ) {
    if ( key !== groupKeyOf(u) && chain.some(c => c.id === id) ) editPrep(run, { kind: "command", key, chain: chain.filter(c => c.id !== id) });
  }
  forgetSides(run, u);
  for ( const o of run.units ) rethink(run, o);
  return true;
}

/**
 * The GM gives a creature its place in its group's chain of command (SLOTS: boss, leader, 1st or 2nd lieutenant; the
 * boss or the leader is the one at the head, never both), or ("none") takes it out of the chain: `leadership`, what it
 * lends those it leads ({brave, tacticalFloor, attack, ac}, as the helper ranks it). Whoever had that place gives it up.
 * The group's side follows its new head. Everyone thinks again (leaders sway what their followers want).
 */
export function setRole(run, id, slot, leadership = null) {
  const u = run.byId.get(id);
  const key = u ? groupKeyOf(u) : null;
  if ( !key || u.spec.hazard || (slot !== "none" && !SLOTS.includes(slot)) ) return false;
  if ( slot === "boss" && u.side === "friendly" ) return false; // (the party never has a boss)
  const head = s => s === "boss" || s === "leader";
  let chain = (run.prep.command?.[key] ?? []).filter(c => c.id !== id && !(head(slot) ? head(c.slot) : c.slot === slot));
  if ( slot !== "none" ) {
    const lends = leadershipOf(leadership ?? {});
    chain.push({ id, slot, role: slot === "boss" ? "boss" : slot === "leader" ? "leader" : "lieutenant", leadership: lends });
  }
  chain = chain.sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
  editPrep(run, { kind: "command", key, chain });
  for ( const o of run.units ) rethink(run, o);
  run.live?.facts.push({ kind: "role", id, slot, round: run.round });
  return true;
}

/**
 * A change to the fight itself (its sides, its chains of command) the GM made: done now, and kept (run.prepEdits) so a
 * battle kept and restored, built afresh from its spec, has it again (restoreRun replays them).
 */
function editPrep(run, e, { keep = true } = {}) {
  const prep = run.prep;
  if ( e.kind === "side" ) {
    if ( prep.sides[e.key] ) return;
    const like = prep.sides.hostile ?? Object.values(prep.sides).find(s => !s.neutral) ?? {};
    const side = {
      id: e.key, label: e.key, enemies: new Set(), traits: { ...(like.traits ?? {}) }, leaderId: null,
      leadership: leadershipOf({}), healAggro: like.healAggro ?? "balanced", morale: like.morale ?? true, party: null
    };
    for ( const s of Object.values(prep.sides) ) {
      if ( s.neutral ) continue;
      side.enemies.add(s.id);
      s.enemies.add(e.key);
    }
    prep.sides[e.key] = side;
  } else if ( e.kind === "command" ) {
    prep.command ??= {};
    // (Its head finds its words more readily; the one it had, as it was.)
    const was = prep.command[e.key]?.[0]?.id ?? null;
    if ( e.chain.length ) prep.command[e.key] = e.chain.map(c => ({ ...c }));
    else delete prep.command[e.key];
    const now = prep.command[e.key]?.[0]?.id ?? null;
    if ( was !== now ) {
      headsUp(prep.byId.get(was), false);
      headsUp(prep.byId.get(now));
    }
    // (A side's own leader: whoever heads its chain now.)
    const side = prep.sides[e.key];
    if ( side ) {
      side.leaderId = prep.command[e.key]?.[0]?.id ?? null;
      side.leadership = prep.command[e.key]?.[0]?.leadership ?? leadershipOf({});
    }
  }
  if ( keep ) (run.prepEdits ??= []).push(e);
}

/**
 * The GM's word on one of a creature's goals (behavior/goals.js): {kind, thingId, level}. 0 sets it aside: a door given
 * up on, a trap forgotten, steady again (no longer thinking of running). A trap's other level is knowing it's there;
 * running's, thinking of it (1) or running now (2). Any other goal is held at that level until handed back (level null).
 */
export function setGoal(run, id, { kind, thingId = null, level = null } = {}) {
  const u = run.byId.get(id);
  if ( !u || !Object.hasOwn(GOALS, kind) ) return false;
  const n = level === null || level === undefined ? null : Math.max(0, Math.round(Number(level) || 0));
  switch ( kind ) {
    case "avoidTrap": {
      const h = run.byId.get(thingId);
      if ( !h?.spec.hazard || n === null ) return false;
      if ( n > 0 ) {
        (u.spottedTraps ??= new Set()).add(h.id);
        run.trapsSpotted = true;
      } else u.spottedTraps?.delete(h.id);
      break;
    }
    case "runAway":
      if ( n === null ) return false;
      return n >= 2 ? applyFact(run, { kind: "flee", id }) : applyFact(run, { kind: "waver", id, on: n === 1 });
    default:
      holdGoal(u, kind, thingId, n ?? undefined);
  }
  run.live?.facts.push({ kind: "goal", id, goal: kind, thingId, level: n, round: run.round });
  return true;
}

/** The GM takes a condition toward another creature off (whatever put it there: a power, the fight, the GM). */
export function clearRelation(run, id, { kind, byId } = {}) {
  const u = run.byId.get(id);
  if ( !u ) return false;
  const from = e => e.sourceId === byId;
  switch ( kind ) {
    case "afraid": {
      const key = `avoid|${byId}`;
      run.live?.gm?.delete(`${u.id}|${key}`);
      for ( const layer of ["stated", "logic", "memory", "social", "style", "gm", "cond"] ) u.desire?.[layer]?.delete(key);
      u.grudges?.delete(byId);
      break;
    }
    case "grabbed":
      if ( u.grabbedBy === byId ) u.grabbedBy = null;
      u.effects = u.effects.filter(e => !(e.key === "gm:grabbed" && from(e)));
      break;
    case "goaded":
      u.effects = u.effects.filter(e => !(e.taunt > 0 && from(e)));
      u.desire?.taunt?.delete(`hurt|${byId}`);
      break;
    case "controlled":
      u.effects = u.effects.filter(e => !(e.conditions?.controlled && from(e)));
      break;
    case "bound":
      if ( !isBound(u) ) return false;
      release(run, u, { key: "bound" });
      break;
    case "exposedTo":
      u.effects = u.effects.filter(e => !(e.onlyVs && from(e)));
      break;
    case "marked":
      u.effects = u.effects.filter(e => !(e.mark?.length && from(e)));
      break;
    // (It won't listen to byId any more: talked round to hearing it out again.)
    case "shuns":
      if ( !u.offendedBy?.delete(byId) ) return false;
      break;
    default:
      return false;
  }
  recompute(u);
  settleSides(run);
  run.live?.facts.push({ kind: "unrelate", id, relation: kind, byId, round: run.round });
  return true;
}

/**
 * Every condition a creature has, for the GM to see and change: each with its value, whether its sheet shows it, and
 * where it came from (who caused it, for how long, whether the GM set it); and every one toward another creature.
 */
export function conditionsOf(run, id) {
  const u = run.byId.get(id);
  if ( !u ) return null;
  const rounds = e => (Number.isFinite(e.rounds) ? e.rounds : null);
  const conds = Object.entries(u.conds ?? {}).filter(([, v]) => (Number(v) || 0) > 0);
  if ( u.prone ) conds.unshift(["prone", 1]);
  // (Tied up: on it, from no one.)
  if ( isBound(u) ) conds.unshift(["bound", 1]);
  // (What an affliction's stage lays: the affliction's, shown as that.)
  const staged = a => (a.onsetLeft > 0 ? {} : a.spec.stages[a.stage - 1]?.conditions ?? {});
  const conditions = conds.map(([key, value]) => {
    const sources = (u.effects ?? []).filter(e => !e.onlyVs && (e.conditions?.[key] ?? 0) > 0)
      .map(e => ({ byId: e.sourceId ?? null, rounds: rounds(e), gm: !!e.gm, label: e.label || "" }));
    const sheet = (u.baseConds?.[key] ?? 0) > 0 || (u.effects ?? []).some(e => e.sheetHeld && e.conditions?.[key]);
    const afflicted = (u.afflictions ?? []).filter(a => (Number(staged(a)[key]) || (staged(a)[key] === true ? 1 : 0)) > 0).map(a => a.spec.id);
    return { key, value: Number(value) || 1, sheet, sources, afflicted, onlyAffliction: afflicted.length > 0 && !sources.length && !sheet };
  });
  const afflictions = (u.afflictions ?? []).map(a => ({
    id: a.spec.id, name: a.spec.name ?? "", stage: a.stage, most: a.spec.stages.length, byId: a.sourceId && run.byId.has(a.sourceId) ? a.sourceId : null,
    onset: a.onsetLeft > 0 ? a.onsetLeft : 0, simple: a.spec.simple?.key ?? null, traits: [...(a.spec.traits ?? [])], conditions: { ...staged(a) }, settled: !!a.settled
  }));
  const relations = [];
  const add = (kind, byId, extra = {}) => { if ( byId && run.byId.has(byId) ) relations.push({ kind, byId, ...extra }); };
  // (Afraid of: wanting to keep away from it, however it came about: the GM, a grudge, its pills, its fears.)
  const fears = new Set();
  for ( const layer of ["stated", "logic", "memory", "social", "style", "gm"] ) for ( const k of u.desire?.[layer]?.keys() ?? [] ) if ( k.startsWith("avoid|") ) fears.add(k.slice(6));
  for ( const byId of fears ) {
    const level = levelOf(u, "avoid", byId);
    if ( level > 0 ) add("afraid", byId, { level, band: desireBand(level), gm: !!run.live?.gm?.has(`${u.id}|avoid|${byId}`) });
  }
  add("grabbed", u.grabbedBy);
  for ( const e of u.effects ?? [] ) {
    if ( e.taunt > 0 ) add("goaded", e.sourceId, { rounds: rounds(e), gm: e.key === "gm-taunt" });
    if ( e.conditions?.controlled > 0 ) add("controlled", e.sourceId, { rounds: rounds(e), gm: !!e.gm });
    if ( e.onlyVs ) add("exposedTo", e.sourceId, { rounds: rounds(e), gm: !!e.gm });
    if ( e.mark?.length ) add("marked", e.sourceId, { rounds: rounds(e) });
  }
  return { id: u.id, status: u.status, conditions, relations, afflictions };
}

/* -------------------------------------------- */
/*  For the GM to see                           */
/* -------------------------------------------- */

/**
 * What a creature wants and feels: its strongest desires (kind, at whom, how badly, its band, what drives it, and
 * whether the GM set it), the persuasion each side has made on it, who it won't listen to, whether it's shaken, who
 * has hurt it, and where it stands. (Its conditions, and who goads it: conditionsOf.)
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
      return { kind, targetId, level: u.desire?.gm?.get(k) ?? 0 };
    }),
    sway: [...(u.sway ?? [])].map(([side, progress]) => ({ side, progress, steps: stepsToConvince(u, run) })),
    offendedBy: [...(u.offendedBy ?? [])],
    rebuffed: Object.fromEntries(u.rebuffed ?? []),
    harmedBy: Object.fromEntries(u.harmedBy ?? []),
    wavering: !!u.wavering,
    swayed: u.swayOutcome ?? null
  };
}

/** The core's counted conditions (frightened 2): the rest are on or off. */
const VALUED = new Set(CORE_CONDITIONS.filter(c => c.valued).map(c => c.key));
/** A desire's intensity: its band, 1 (passing) to 5 (obsessed). */
const bandIntensity = level => desireBand(level) + 1;
/** Conditions that stand for a relation (grabbed by, controlled by): told as that. */
const AS_RELATION = new Set(["grabbed", "controlled"]);

/**
 * Everything the Battle Vantage's map of minds shows, in the engine's terms (the interface puts it in words). Each
 * line and symbol has an intensity and its most (null: no most; 1: only on or off, a hidden 1):
 *   creatures  [{id, status, side, active, pos, hazard, player}]
 *   links      what's between two: from -> to
 *     {type: "desire", kind, from (who wants), to, level, intensity, most: 5, gm}
 *     {type: "condition", key, from (who caused it), to (who has it), value, valued, intensity, most, rounds, gm, sheet}
 *     {type: "affliction", afflictionId, name, from (who gave it), to, stage, intensity (its stage), most (its last),
 *       onset (rounds before it takes hold), simple (the condition a simple one stands for), traits, conditions (what
 *       its stage lays), settled}
 *     {type: "relation", kind, from, to, intensity: 1, most: 1, rounds, gm}   grabbed/goaded/controlled/bound/exposedTo/
 *       marked: from the one who did it to the one it's on; shuns (won't listen to): from the one who won't to the other
 *     {type: "goal", kind, from, to (a thing's id, or a hazard's), level, intensity, most, played, gm, via}
 *   marks      what a creature has on its own: {type: "condition"|"status"|"goal"|"desire", on, key|kind, ...}
 *   things     what goals are about, while they're wanted: [{id, type, x, y, name, locked}]
 *   setAside   what the GM set aside (held at 0), to hand back: [{type: "desire"|"goal", id, kind, targetId|thingId}]
 * A player's character FastFighting isn't playing shows no desires or goals (the player decides what it wants), only
 * what's on it; nor does a bystander not in the fight yet (what it wants shows once it joins).
 */
export function networkOf(run) {
  const creatures = [];
  const links = [];
  const marks = [];
  const things = new Map();
  const setAside = [];
  for ( const u of run.units ) {
    const player = playerRuns(run, u);
    creatures.push({ id: u.id, status: u.status, side: u.side, active: !!u.active, aware: !!u.aware, pos: u.pos ? { x: u.pos.x, y: u.pos.y } : null, hazard: !!u.spec.hazard, player, controlledBy: u.controlledBy ?? null });
    // (A bystander's wants, its lean toward a side among them, show once it joins the fight: until then it hasn't.)
    const minded = !player && !!u.active;
    // What it wants of others (and of itself).
    if ( minded ) {
      for ( const d of rankedDesires(run, u) ) {
        const at = { kind: d.kind, level: d.level, intensity: bandIntensity(d.level), most: 5, gm: u.desire?.gm?.has(`${d.kind}|${d.targetId}`) ?? false };
        if ( d.targetId === u.id ) marks.push({ type: "desire", on: u.id, ...at });
        else {
          // (Talk: the way it would put it to them now, its best pitch: persuade, intimidate, deceive.)
          if ( d.kind === "talk" ) {
            const t = run.byId.get(d.targetId);
            const pitch = t ? bestPitch(run, u, t) : null;
            if ( pitch ) Object.assign(at, { pitch: pitch.kind, aim: pitch.aim ?? null });
          }
          links.push({ type: "desire", from: u.id, to: d.targetId, ...at });
        }
      }
      attitudesOf(run, u, links, marks);
      for ( const [k, v] of u.desire?.gm ?? [] ) {
        if ( v > 0 ) continue;
        const [kind, targetId] = k.split("|");
        setAside.push({ type: "desire", id: u.id, kind, targetId });
      }
      for ( const g of goalsOf(run, u) ) {
        const at = { kind: g.kind, level: g.level, intensity: g.scale === "band" ? bandIntensity(g.level) : g.level, most: g.scale === "band" ? 5 : (g.most ?? 1), played: g.played, gm: g.gm, via: g.via };
        if ( g.thing ) {
          things.set(g.thing.id, { ...g.thing });
          links.push({ type: "goal", from: u.id, to: g.thing.id, thingId: g.thing.id, ...at });
        } else if ( g.targetId ) links.push({ type: "goal", from: u.id, to: g.targetId, thingId: g.targetId, ...at });
        else marks.push({ type: "goal", on: u.id, ...at });
      }
      for ( const [k, v] of u.goalHeld ?? [] ) {
        if ( v > 0 ) continue;
        const at = k.indexOf("|");
        setAside.push({ type: "goal", id: u.id, kind: k.slice(0, at), thingId: k.slice(at + 1) === "self" ? null : k.slice(at + 1) });
      }
    }
    // What's on it: each condition from whoever caused it (a line), or its own (a symbol).
    const has = conditionsOf(run, u.id);
    for ( const c of has.conditions ) {
      if ( AS_RELATION.has(c.key) && has.relations.some(r => r.kind === c.key) ) continue;
      if ( c.onlyAffliction ) continue; // (its affliction's, shown below)
      const valued = VALUED.has(c.key) || c.value > 1;
      const at = { key: c.key, value: c.value, valued, intensity: valued ? c.value : 1, most: valued ? conditionMost(c.key) : 1, sheet: c.sheet };
      const by = [...new Set(c.sources.map(x => x.byId).filter(id => id && id !== u.id && run.byId.has(id)))];
      for ( const id of by ) {
        const src = c.sources.find(x => x.byId === id);
        links.push({ type: "condition", from: id, to: u.id, rounds: src.rounds, gm: src.gm, ...at });
      }
      if ( !by.length || c.sheet || c.sources.some(x => !x.byId) ) marks.push({ type: "condition", on: u.id, ...at });
    }
    // Its afflictions: from whoever gave it (a line), or its own (a symbol); the stage its intensity, up to its last.
    for ( const a of has.afflictions ) {
      const at = { afflictionId: a.id, name: a.name, stage: a.stage, intensity: a.stage, most: a.most, onset: a.onset, simple: a.simple, traits: a.traits, conditions: a.conditions, settled: a.settled };
      if ( a.byId && a.byId !== u.id ) links.push({ type: "affliction", from: a.byId, to: u.id, ...at });
      else marks.push({ type: "affliction", on: u.id, ...at });
    }
    for ( const r of has.relations ) {
      if ( r.kind === "afraid" ) continue; // (a fear is its desire to keep away: shown as that)
      links.push({ type: "relation", kind: r.kind, from: r.byId, to: u.id, intensity: 1, most: 1, rounds: r.rounds ?? null, gm: !!r.gm });
    }
    for ( const id of u.offendedBy ?? [] ) {
      if ( run.byId.has(id) ) links.push({ type: "relation", kind: "shuns", from: u.id, to: id, intensity: 1, most: 1, rounds: null, gm: false });
    }
    // Not in the fight yet: it hasn't noticed it.
    if ( !u.active && !u.aware && u.status === STATUS.STANDING && !u.spec.hazard ) marks.push({ type: "status", on: u.id, key: "unaware", intensity: 1, most: 1 });
  }
  return { creatures, links, marks, things: [...things.values()], setAside };
}

/**
 * What a creature keeps toward others outside its desires, as lines (from it) and symbols (on it): who it's wary of
 * hearing (rebuffed, each time harder), whom it bears a grudge (afraid of them until they go for it, then out for
 * them), whom it schemes against and whom it follows (this turn), a truce it keeps; whose companion it is and who
 * summoned it; which side a neutral leans to and which it has turned on, how far it's been talked round, a quarrel it
 * agreed to let be, going against its commander, getting involved, and what it wants of the other side to end a
 * standoff. Those it can be talked out of (or the GM can) have an intensity; the rest (`fixed`) only show.
 */
function attitudesOf(run, u, links, marks) {
  const has = id => id && id !== u.id && run.byId.has(id);
  const line = (kind, to, extra = {}) => { if ( has(to) ) links.push({ type: "attitude", kind, from: u.id, to, intensity: 1, most: 1, ...extra }); };
  const mark = (kind, extra = {}) => marks.push({ type: "attitude", on: u.id, kind, intensity: 1, most: 1, ...extra });
  for ( const [id, n] of u.rebuffed ?? [] ) if ( n > 0 ) line("wary", id, { intensity: n, most: null });
  for ( const [id, g] of u.grudges ?? [] ) line("grudge", id, { provoked: !!g?.provoked });
  if ( u.scheming?.against ) line("schemes", u.scheming.against);
  if ( u.following?.id ) line("follows", u.following.id, { fixed: true });
  if ( u.truce?.withId ) line("truce", u.truce.withId);
  if ( u.spec.flags?.masterId ) line("serves", u.spec.flags.masterId, { fixed: true });
  if ( u.summoner ) line("summoned", u.summoner, { fixed: true });
  // (On it: a neutral's lean, the sides it turned on, how far it's been talked round, and the rest.)
  if ( u.lean && u.status === STATUS.STANDING ) mark("leans", { side: u.lean, level: u.leanLevel ?? 50, intensity: desireBand(u.leanLevel ?? 50) + 1, most: 5 });
  for ( const side of u.against ?? [] ) mark("against", { side });
  const steps = stepsToConvince(u, run);
  for ( const [side, n] of u.sway ?? [] ) if ( n > 0 && side !== u.side ) mark("swayed", { side, intensity: n, most: Math.max(1, steps - 1), steps });
  if ( u.holdsBack ) mark("holdsBack");
  if ( u.contrarian ) mark("contrarian");
  if ( u.meddling?.how ) mark("meddles", { how: u.meddling.how, side: u.meddling.side ?? null, fixed: true });
  const expect = run.standoff && !u.dealt && u.status === STATUS.STANDING ? expectOf(u) : null;
  if ( expect ) mark("demands", { expect: { ...expect } });
}

/**
 * The GM's word on what a creature keeps toward others (attitudesOf): {kind, byId | side, level}. 0 takes it away:
 * hears byId out as before (wary), the grudge let go, the scheme dropped, the truce over, back on that side's good
 * terms (against), no longer swayed toward that side, the quarrel no longer let be, no longer contrary, the demand let
 * go. Wary of hearing byId, and swayed toward a side, take a count (up to one short of being talked round); a lean,
 * how strongly (its band).
 */
export function setAttitude(run, id, { kind, byId = null, side = null, level = 0 } = {}) {
  const u = run.byId.get(id);
  if ( !u ) return false;
  const n = Math.max(0, Math.round(Number(level) || 0));
  switch ( kind ) {
    case "wary":
      if ( !run.byId.has(byId) ) return false;
      if ( n ) (u.rebuffed ??= new Map()).set(byId, n);
      else u.rebuffed?.delete(byId);
      break;
    case "grudge":
      if ( n || !u.grudges?.delete(byId) ) return false;
      break;
    case "schemes":
      if ( n || u.scheming?.against !== byId ) return false;
      u.scheming = null;
      break;
    case "truce":
      if ( n || u.truce?.withId !== byId ) return false;
      u.truce = null;
      break;
    case "leans":
      if ( !u.lean ) return false;
      u.leanLevel = n ? bandLevel(n - 1) : 0;
      break;
    case "against":
      if ( n || !u.against?.delete(side) ) return false;
      settleSides(run);
      break;
    case "swayed": {
      if ( !side ) return false;
      const most = Math.max(1, stepsToConvince(u, run) - 1);
      if ( n ) (u.sway ??= new Map()).set(side, Math.min(most, n));
      else u.sway?.delete(side);
      break;
    }
    case "holdsBack":
      u.holdsBack = n > 0;
      break;
    case "contrarian":
      u.contrarian = n > 0;
      break;
    case "demands":
      if ( n ) return false;
      u.expect = null;
      break;
    default:
      return false;
  }
  run.live?.facts.push({ kind: "attitude", id, attitude: kind, byId, side, level: n, round: run.round });
  return true;
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
const UNIT_SKIP = new Set(["prep", "spec", "turn", "nearby", "nearbyKey", "pool", "sharedPools", "coreConds"]);
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
  // (What the GM changed of the fight itself, again: hostile groups it gained, chains of command.)
  for ( const e of run.prepEdits ?? [] ) editPrep(run, e, { keep: false });
  for ( const u of run.units ) {
    u.sharedPools = run.sharedPools;
    recompute(u);
  }
  run.log = snap.log ? decode(snap.log, run.byId) : [...(log ?? [])].slice(0, snap.logLength ?? Infinity);
  run.trapLog = (unit, data) => log(run, unit, data);
  return attach(run, decode(snap.live ?? {}, run.byId));
}
