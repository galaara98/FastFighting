/**
 * Do it For Real Now, live: the battle played on the scene's own combat tracker, a turn at a time.
 *   - A creature FastFighting plays (an NPC, or a character the GM lets it play): when the tracker reaches it, its
 *     turn is played (engine/live.js liveTurn) against the sheets as they stand, its tokens move, what it changed is
 *     written onto the sheets (adapter.commitChanges), its card is told; then FastFighting waits for the GM's Continue.
 *   - A character a player runs: the player plays the turn. When the tracker moves on, what happened is read (the
 *     system's roll cards, through the helper's readTurn; and the sheets) and told as that turn's card, and the
 *     creatures FastFighting plays feel it as they would have (engine/live.js pcTurn).
 *   - A reaction someone must decide (a player's "ask me", or an NPC's when the GM wants to be asked): the turn stops,
 *     the question is put, and the turn is played again from where it began, with the same dice and the answer.
 *   - Rewind Turn puts the last turn back (last first): what it wrote, its cards, its moves, and the run as it was.
 *     Rewind This Encounter puts every turn back.
 * The run lives in the GM's browser while the battle goes; after every turn it's kept (snapshot, turns) on a journal
 * entry only GMs can see, the combat holding only that a battle is live. A reload picks it up again.
 */
import { MODULE_ID, STATUS, SIDES, DISPOSITION_SIDES, NEUTRAL_PARTY, HOSTILE_GROUPS } from "../constants.js";
import { escapeHtml as escape, inertHtml } from "../i18n.js";
import { getAdapter, characterSpec } from "../api.js";
import { setting } from "../settings.js";
import { positionOf, squareFeet } from "./terrain.js";
import { approachFor, sceneNow } from "./battle.js";
import { currentPathGrid, pathGridFor, sceneWallGrid } from "./pathing.js";
import { getSetup, sceneEncounter } from "./persistence.js";
import { QUERIES, isPlayerControlled, getStoredTactics, reactionPrefsFor } from "./tactics.js";
import {
  holdingPause, playMoves, postBeat, postStory, revertEntry, gmIds, chronicle, storyTitle, packSpec, unpackSpec, placeOf, spotsFor
} from "./make-it-so.js";
import { storyBeats } from "../story/story.js";
import { logLine } from "../story/log-lines.js";
import { loadStoryTables } from "../story/tables.js";
import {
  beginLive, liveRound, liveOrder, liveDrop, liveTurn, pcTurnBegin, pcTurnEnd, syncFromSheets, setApproach, setScene, captureAll, snapshotRun, restoreRun, endLive, packLog, followCommand,
  NeedsDecision, rollsKind, applyFact, gmMoment, leavingReach, openingFor, reactNow, movedBeside, nextSpotlight, liveAftermath,
  setCondition, setRelation, clearRelation, setAffliction, setGoal, setAttitude, setSide, setRole, playerRuns
} from "../engine/live.js";
import { diffAll, sideAfter } from "../engine/changes.js";
import { undoRecord } from "./sheet-tools.js";
import { keepUpdate, keptBattle, forgetUpdate } from "./live-keeping.js";
import { randomSeed } from "../engine/rng.js";
import { holderOf } from "../engine/behavior/troubles.js";
import { perceives } from "../engine/behavior/senses.js";
import { SystemAdapter } from "../adapters/adapter-base.js";

/** Does the helper do this itself (its own, not the base adapter's do-nothing)? */
const offers = (adapter, name) => typeof adapter?.[name] === "function" && adapter[name] !== SystemAdapter.prototype[name];

/**
 * The kinds of roll the system makes itself in this battle, as its helper offers them (engine/live.js systemRoll):
 * strikes (rollStrike); saves (rollSave); checks (rollCheck); an action's own card (useAction) and its damage, once
 * for all it catches (rollDamage); and the damage cards of strikes and those applied its own way (applyDamageCard).
 */
function systemRollKinds(adapter) {
  const out = [];
  if ( offers(adapter, "rollStrike") ) out.push("strike");
  if ( offers(adapter, "rollSave") ) out.push("save");
  if ( offers(adapter, "rollCheck") ) out.push("check");
  if ( offers(adapter, "useAction") ) out.push("use");
  if ( offers(adapter, "rollDamage") ) out.push("damage");
  if ( (out.includes("strike") || out.includes("damage")) && offers(adapter, "applyDamageCard") ) out.push("apply");
  return out;
}
import { isStanding, canMove } from "../engine/battle-state.js";

const loc = key => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
/** How many turns back Rewind Turn reaches (each keeps the run as it was before it). */
const REWIND_DEPTH = 12;

/** The battle in this GM's hands: {combat, scene, spec, rules, run, data (what's kept), pc (a player's turn going), keptSpec}. */
let battle = null;
export const liveBattle = () => battle;

/**
 * Whose browser plays a battle: the GM who began it, while they're here; when they're gone, the active GM (who takes it
 * over).
 */
function runsHere(data) {
  const owner = data?.user ? game.users.get(data.user) : null;
  return owner?.active ? owner.isSelf : !!game.user.isActiveGM;
}

/**
 * Is the battle this browser holds still its own to play? The combat's flag (every client sees it) says which battle
 * is on it and whose browser plays it: another GM may have rewound it, begun another, or picked it up while this one
 * was away.
 */
function stillHere() {
  const flag = battle?.combat?.getFlag(MODULE_ID, "live");
  return !!flag && flag.id === battle.data.id && (!flag.user || flag.user === game.user.id);
}

/** This browser plays the battle it holds now. */
const playsHere = () => !!battle && runsHere(battle.data) && stillHere();

/** The combat's flag for the battle: which it is, whether it's still going, and whose browser plays it. */
const flagOf = active => ({ id: battle.data.id, active, user: battle.data.user });

/** Something changed in the battle: whatever shows it draws it again. */
const changed = () => Hooks.callAll("fastFighting.liveBattle", battle);

/* -------------------------------------------- */
/*  Keeping it                                  */
/* -------------------------------------------- */

/**
 * The journal entry that keeps live battles (what a Rewind puts back, run with a GM's rights): only the one the world's
 * liveStore setting names (a setting only a GM can write), last written by a GM, and seen by no player. A player can
 * make a journal entry no other player sees, flag it, and fill it: such a one is never trusted. (Every client is sent
 * every journal entry, whatever its ownership: what's kept here isn't secret from a player who digs, only safe from
 * one who would change it.)
 */
const trustedStore = j => !!j?.getFlag(MODULE_ID, "liveStore") && !!game.users.get(j._stats?.lastModifiedBy)?.isGM
  && !game.users.some(u => !u.isGM && j.testUserPermission(u, "LIMITED"));

async function store() {
  const named = game.journal.get(setting("liveStore"));
  if ( trustedStore(named) ) return named;
  // (One from before the setting: the oldest a GM made, no player sees, and none has written since.)
  const old = game.journal.filter(j => trustedStore(j) && game.users.get(j._stats?.createdBy)?.isGM).sort((a, b) => (a._stats.createdTime ?? 0) - (b._stats.createdTime ?? 0))[0];
  const JournalEntry = foundry.documents.JournalEntry ?? globalThis.JournalEntry;
  const doc = old ?? await JournalEntry.create({
    name: loc("FASTFIGHTING.Live.Store"),
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    flags: { [MODULE_ID]: { liveStore: true } }
  });
  if ( doc ) await game.settings.set(MODULE_ID, "liveStore", doc.id);
  return doc;
}

/**
 * A battle is kept on the store a part at a time (live-keeping.js): each keep writes the battle as it stands, and of its
 * turns and its log only what's new or changed since the keep before (b.kept: what that one wrote; none, the first keep
 * of a battle begun or picked up, writes them all). One write to the store at a time (inTurn: keep, forget), so each
 * keep goes from what the one before it wrote.
 */
let keeping = Promise.resolve();
function inTurn(work) {
  const next = keeping.then(work, work);
  keeping = next.catch(() => null);
  return next;
}

function keep() {
  const b = battle;
  return inTurn(() => keepNow(b));
}

async function keepNow(b) {
  if ( !b ) return;
  changed();
  b.data.snapshot = snapshotRun(b.run, { log: false });
  // (A player's turn under way: who, since when, what the GM said and what reactions wrote. Its cards are found again by time.)
  const pc = b.pc;
  b.data.pc = pc ? { combatantId: pc.combatantId, id: pc.id, round: pc.round, facts: pc.facts, records: pc.records, snapshot: pc.snapshot, from: pc.from, damage: pc.damage ?? [], dealt: pc.dealt ?? [], lastAt: pc.lastAt ?? null } : null;
  const doc = await store();
  // (The battle's own key replaced whole, the store's other keys left as they are. Its spec, the biggest part, only
  // when it's changed: kept beside it. Its turns and its log, each apart: only what's new.)
  const spec = b.data.spec;
  const { update, kept: now } = keepUpdate(b.kept ?? null, b.combat.id, b.data, {
    log: b.run.log ?? [], pack: (from, to) => packLog(b.run, from, to), root: `flags.${MODULE_ID}`, keptSpec: b.keptSpec ?? null
  });
  await doc.update(update);
  b.keptSpec = spec;
  b.kept = now;
}

/** A battle as it was kept (live-keeping.js keptBattle), or null. */
async function kept(combatId) {
  const doc = await store();
  return doc ? keptBattle(path => doc.getFlag(MODULE_ID, path), combatId) : null;
}

function forget(combatId) {
  return inTurn(async () => {
    const doc = await store();
    await doc?.update(forgetUpdate(combatId, `flags.${MODULE_ID}`));
  });
}

/* -------------------------------------------- */
/*  Starting                                    */
/* -------------------------------------------- */

/**
 * A live battle, from the planner's battle (its spec, built as for a simulation), on the scene's encounter. `players`:
 * ids of the characters the players run (none: FastFighting plays everyone). It begins at once (beginEncounter), or,
 * with `begin` false, waits for the encounter to begin: the Battle Vantage's Begin Encounter, or Foundry's own.
 * `began`: the encounter has only now begun, for this battle (Foundry's own button, the planner ready): Rewind This
 * Encounter takes the start back too, as it does one FastFighting made. `combatId`: the plan's encounter (a scene can
 * hold several; else the one the tracker shows).
 */
export async function startLiveBattle(spec, { style = setting("storyStyle"), odds = null, players = [], begin = true, began = false, combatId = null, applyDamage = setting("applyPlayerDamage") } = {}) {
  if ( !game.user.isGM ) return null;
  const scene = canvas.scene;
  // (The plan's own encounter, by its id; else the scene's as the planner has it: the tracker's, linked to this scene or
  // to none.)
  const combat = (combatId ? game.combats.get(combatId) : null) ?? sceneEncounter(scene);
  if ( !combat ) {
    ui.notifications.warn(loc("FASTFIGHTING.Live.NoCombat"));
    return null;
  }
  // Everyone in the encounter on the tracker, with initiative.
  const inEncounter = spec.combatants.filter(c => c.inEncounter !== false && !c.hazard);
  const missing = inEncounter.filter(c => !combat.combatants.some(x => x.tokenId === (c.tokenId ?? c.id)));
  if ( missing.length ) {
    await combat.createEmbeddedDocuments("Combatant", missing.map(c => ({ tokenId: c.tokenId ?? c.id, sceneId: scene.id, actorId: scene.tokens.get(c.tokenId ?? c.id)?.actorId })));
  }
  const adapter = getAdapter();
  const spotlight = adapter.liveTurns === "spotlight";
  const seed = randomSeed();
  const live = { ...spec, options: { ...spec.options, initiativeOrder: combat.turns.map(c => c.tokenId) } };
  const run = beginLive(live, adapter.rules, { seed, players, owns: adapter.liveOwnership?.() ?? {}, npcReactions: "calculated", systemRolls: systemRollKinds(adapter), readsRolls: offers(adapter, "readTurn") });
  // (Prepared until the encounter begins: no turn played, nothing told.)
  battle = {
    combat, scene, spec: live, rules: adapter.rules, run, pc: null,
    data: {
      id: foundry.utils.randomID(), user: game.user.id, sceneId: scene.id, spec: packSpec(live), seed, style, odds, players, told: 0, turns: [],
      ended: false, played: null, opening: [], rolled: [], rollCards: [], joined: [], startedCombat: false, spotlight, spots: 0, prepared: true, applyDamage: !!applyDamage,
      startedBefore: combat.started && !began
    }
  };
  await combat.setFlag(MODULE_ID, "live", flagOf(true));
  Hooks.callAll("fastFighting.liveBattleStarted", battle);
  if ( begin ) await beginEncounter();
  else await keep();
  return battle;
}

/** The encounter beginning (beginEncounter), while it does. */
let beginning = null;

/**
 * The encounter begins, a battle prepared on it: the Battle Vantage's Begin Encounter, Foundry's own (the tracker's,
 * noticed: registerLiveBattles), or Do it For Real Now. Those yet to roll initiative roll it, straight away (no
 * system's roll dialog for each one; Rewind This Encounter takes them back; a spotlight system rolls none: whoever the
 * GM spotlights acts). The combat starts, if it hasn't, the tracker's order is the fight's, and its first turn begins:
 * played, if FastFighting plays it.
 */
export function beginEncounter() {
  if ( !battle?.data.prepared ) return null;
  if ( beginning ) return beginning;
  beginning = queue(async () => {
    if ( !battle?.data.prepared ) return;
    const combat = battle.combat;
    const adapter = getAdapter();
    const unrolled = battle.data.spotlight ? [] : combat.combatants.filter(c => c.initiative === null).map(c => c.id);
    const rolledFrom = Date.now();
    if ( unrolled.length ) await rollFor(combat, unrolled);
    const rollCards = unrolled.length ? initiativeCards(rolledFrom) : [];
    if ( !combat.started ) await combat.startCombat();
    // (Begun with Foundry's own button before the rolls: the tracker on the first of the order they made.)
    else if ( unrolled.length && combat.turn !== 0 ) await combat.update({ turn: 0 }, { turnEvents: false });
    // (Begun for this battle, whoever pressed the button: Rewind This Encounter takes it back.)
    const started = !battle.data.startedBefore;
    if ( battle.data.spotlight && combat.turn !== null ) await adapter.giveSpotlight(combat, null);
    liveOrder(battle.run, combat.turns.map(c => unitOf(c)?.id).filter(Boolean));
    battle.spec = { ...battle.spec, options: { ...battle.spec.options, initiativeOrder: combat.turns.map(c => c.tokenId) } };
    battle.data.spec = packSpec(battle.spec);
    liveRound(battle.run, combat.round || 1);
    Object.assign(battle.data, { prepared: false, rolled: unrolled, rollCards, startedCombat: started });
    battle.data.opening = await tellNew();
    await keep();
    await turnBegins(combat.combatant);
  }).finally(() => { beginning = null; });
  return beginning;
}

/** End Encounter (the Battle Vantage's): Foundry's own, which asks first and deletes the combat (and the battle with it). */
export function endEncounter() {
  return battle?.combat.started ? battle.combat.endCombat() : null;
}

/* -------------------------------------------- */
/*  The tracker                                 */
/* -------------------------------------------- */

let line = Promise.resolve();
/** One thing at a time: a turn played, a turn closed, a rewind. */
function queue(work) {
  const next = line.then(work, work);
  line = next.catch(err => {
    console.error(`${MODULE_ID} | live battle`, err);
    ui.notifications.error(fmt("FASTFIGHTING.Live.Failed", { error: err.message }));
  });
  return next;
}

/**
 * The tracker moved on: the turn that ended is closed (a player's, read and told), and the next begins (one FastFighting
 * plays, played). Moved back (Previous Turn, Previous Round): the battle follows it (followBack).
 */
function onTurnChange(combat, prior, current) {
  // (Prepared, not yet begun: the encounter's start is beginEncounter's.)
  if ( battle?.combat !== combat || battle.data.ended || battle.data.prepared || !playsHere() ) return;
  // (Moved by a player some other way than ending their own character's turn: put back, and the GM told.)
  if ( !battle.data.spotlight && !movedRightly(combat, prior, current) ) {
    queue(async () => {
      await combat.update({ round: prior.round, turn: prior.turn }, { turnEvents: false });
      ui.notifications.warn(fmt("FASTFIGHTING.Live.TrackerRefused", { name: game.users.get(combat._stats?.lastModifiedBy)?.name ?? "" }));
      changed();
    });
    return;
  }
  // (A spotlight system's tracker has no order to go back along: its Rewind is the battle's own.)
  const back = !battle.data.spotlight && !!prior && current?.round > 0 && prior.combatantId !== current.combatantId
    && (current.round < prior.round || (current.round === prior.round && (current.turn ?? -1) < (prior.turn ?? -1)));
  if ( back ) {
    queue(() => followBack(prior));
    return;
  }
  queue(async () => {
    pauseFor(unitOf(combat.combatant));
    await clearAreas();
    if ( battle.pc && battle.pc.combatantId !== combat.combatant?.id ) await closePlayerTurn();
    if ( battle.data.spotlight ) await spotlightMoved(combat, prior);
    else if ( combat.round > (battle.run.round ?? 0) ) await newRound(combat.round);
    await turnBegins(combat.combatant);
  });
}

/**
 * Was the tracker moved as it may be? By a GM, any way; by a player, only forward, from the turn of a character of their
 * own (ending it), into the next round at most. Foundry lets anyone set a combat's turn: a player going back would
 * have the GM's client take back a foe's turn (and roll it again), one going on past others, skip theirs.
 */
function movedRightly(combat, prior, current) {
  const by = game.users.get(combat._stats?.lastModifiedBy);
  if ( !by || by.isGM ) return true;
  if ( !prior ) return false;
  const forward = current.round > prior.round || (current.round === prior.round && (current.turn ?? -1) > (prior.turn ?? -1));
  const was = combat.combatants.get(prior.combatantId);
  return forward && current.round - prior.round <= 1 && !!was?.actor?.testUserPermission(by, "OWNER");
}

/**
 * A spotlight system (no initiative, no rounds on the tracker): each spotlight given is a turn of its own, and a player
 * character given it again after the others had theirs begins a new round.
 */
async function spotlightMoved(combat, prior) {
  const c = combat.combatant;
  if ( !c || prior?.combatantId === c.id ) return;
  battle.data.spots = (battle.data.spots ?? 0) + 1;
  const u = unitOf(c);
  if ( u?.spec.kind !== "pc" ) return;
  const spot = (battle.run.live.spot ??= { last: null, up: {} });
  spot.had ??= [];
  if ( spot.had.includes(u.id) ) {
    spot.had = [];
    await newRound((battle.run.round ?? 1) + 1);
  }
  spot.had.push(u.id);
}

/** A turn's dice of its own, drawn as it begins and kept nowhere: nothing a player's client is sent foretells them. */
const freshNonce = () => (globalThis.crypto?.getRandomValues?.(new Uint32Array(1))[0] || Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0 || 1;

/** A turn's key: its round and combatant (a spotlight system's: which spotlight it is). */
const turnKey = combatant => `${battle.data.spotlight ? `s${battle.data.spots ?? 0}` : battle.combat.round}.${combatant?.id}`;

/**
 * On to the next turn: the tracker's next; a spotlight system's spotlight handed back for the GM to give (or, with
 * Play to the end and FastFighting playing everyone, given where FastFighting would give it).
 */
async function moveOn() {
  if ( !battle.data.spotlight ) await battle.combat.nextTurn();
  else if ( battle.data.auto && !battle.run.live.players.size ) await spotlightNext();
  else await getAdapter().giveSpotlight(battle.combat, null);
  await takeOffTracker();
}

/**
 * The way off the scene for u, from where it stands in the fight (engine/behavior/leaving.js run.live.exitOf): around
 * the walls, through doors it could open; {none: true} when walls shut it in; null off a square grid (straight to the
 * nearest edge, then).
 */
function exitOf(u) {
  const grid = u.pos ? sceneWallGrid() : null;
  if ( !grid ) return null;
  const { size } = canvas.dimensions;
  const feet = squareFeet();
  const half = (u.spec.position?.size ?? feet) / 2;
  const cell = grid.cellAt(((u.pos.x - half) / feet) * size, ((u.pos.y - half) / feet) * size);
  if ( cell < 0 ) return null;
  const way = grid.wayOff(cell);
  if ( !way ) return { none: true };
  const toFeet = c => [(c.x / size) * feet + half, (c.y / size) * feet + half];
  return { path: [[u.pos.x, u.pos.y], ...way.corners.map(toFeet)], feet: way.steps * feet };
}

/**
 * Those these events saw off the map (leaving the fight, or gone with no way off: the engine's offMap): hidden (the
 * sheets' write did that, as the fled setting says) and put in the scene's first square, out of everyone's way, and
 * off the tracker as it moves on (takeOffTracker). With fled tokens left where they are (the setting), they stay put.
 * What it did goes in `turn`'s records and moves, for Rewind.
 */
async function sendOff(events, turn) {
  if ( setting("fledMode") === "leave" ) return;
  const gone = events.filter(e => e.type === "offMap").map(e => docOf(e.actorId)).filter(Boolean);
  if ( !gone.length ) return;
  const { sceneX = 0, sceneY = 0 } = canvas.dimensions;
  const moves = {};
  for ( const doc of gone ) {
    if ( !doc.hidden ) {
      turn.records.push({ tokenUuid: doc.uuid, tokenUpdate: { hidden: false } });
      await doc.update({ hidden: true });
    }
    if ( !turn.moves.some(m => m.uuid === doc.uuid) ) turn.moves.push({ uuid: doc.uuid, ...placeOf(doc) });
    moves[doc.id] = { destination: { x: sceneX, y: sceneY, action: "displace" } };
    const c = battle.combat.combatants.find(x => x.tokenId === doc.id);
    if ( c ) battle.data.offMap = [...new Set([...(battle.data.offMap ?? []), c.id])];
  }
  await battle.scene.moveTokens(moves, { animate: false });
}

/**
 * Those inside another (swallowed, engulfed: engine/behavior/troubles.js holderOf) are where their holder is: their tokens
 * put on its square, without walking the map (its middle, on the grid, for a big one). Where they stood is in the turn's
 * moves, for Rewind.
 */
async function carryInside() {
  const size = battle.scene.grid?.size ?? canvas.dimensions.size;
  const moves = {};
  for ( const u of battle.run.units ) {
    const holder = holderOf(battle.run, u);
    const doc = holder ? docOf(u.id) : null;
    const at = holder ? docOf(holder.id) : null;
    if ( !doc || !at ) continue;
    const x = at._source.x + Math.floor(Math.max(0, at.width - doc.width) / 2) * size;
    const y = at._source.y + Math.floor(Math.max(0, at.height - doc.height) / 2) * size;
    if ( doc._source.x !== x || doc._source.y !== y ) moves[doc.id] = { destination: { x, y, action: "displace" } };
  }
  if ( Object.keys(moves).length ) await battle.scene.moveTokens(moves, { animate: false });
}

/** Those gone off the map leave the tracker (all but the one whose turn it is): kept with the last turn, for Rewind. */
async function takeOffTracker() {
  if ( !battle?.data.offMap?.length ) return;
  const combat = battle.combat;
  const ids = battle.data.offMap.filter(id => combat.combatants.has(id) && id !== combat.combatant?.id);
  battle.data.offMap = battle.data.offMap.filter(id => combat.combatants.has(id) && !ids.includes(id));
  if ( !ids.length ) return;
  const data = ids.map(id => combat.combatants.get(id).toObject());
  await combat.deleteEmbeddedDocuments("Combatant", ids);
  battle.data.turns.at(-1)?.records.push({ deletedCombatants: data.map(d => ({ parentUuid: combat.uuid, data: d })) });
  await keep();
}

/** A spotlight system: the spotlight given where FastFighting would give it (engine/live.js nextSpotlight). */
export async function spotlightNext() {
  if ( !battle || battle.data.ended ) return null;
  const u = nextSpotlight(battle.run);
  const combatant = u ? battle.combat.combatants.find(c => c.tokenId === tokenIdOf(u)) : null;
  if ( !combatant ) return null;
  const adapter = getAdapter();
  // (The one who has it already: handed back first, then given again, a turn of its own.)
  if ( battle.combat.combatant?.id === combatant.id ) await adapter.giveSpotlight(battle.combat, null);
  return adapter.giveSpotlight(battle.combat, combatant);
}

/**
 * The tracker gone back to `now` ({round, at}: its place in the order): the kept turns to take back (the latest, all
 * those after it), the turn it's on (`key`) if it's kept, and that one again (reopen) when it's a player's to open
 * again. `place(turn)` is where a kept turn stands on the tracker ({round, at}, at -1 for one no longer on it).
 */
export function goingBack(turns, now, key, place) {
  const laterThan = (a, b) => a.round > b.round || (a.round === b.round && a.at > b.at);
  let keepTo = turns.length;
  while ( keepTo > 0 && laterThan(place(turns[keepTo - 1]), now) ) keepTo--;
  const own = turns[keepTo - 1]?.key === key ? turns[keepTo - 1] : null;
  const reopen = own?.kind === "pc" && own.from ? own : null;
  return { undo: turns.slice(reopen ? keepTo - 1 : keepTo), own, reopen };
}

/**
 * The tracker went back (the GM's Previous Turn or Previous Round, or Rewind): every turn after the one it's on now is
 * taken back, last first (a player's turn under way too), so the battle stands as that turn left it. One FastFighting
 * played waits for Next Turn; a player's is theirs again (their cards read again, all of them, when it ends); one never
 * played is ready to Play (a player's begun). So far back that the fight wasn't kept as it was, the tracker goes back
 * where it was: only Rewind This Encounter goes so far.
 */
async function followBack(prior) {
  const combat = battle.combat;
  const combatant = combat.combatant;
  const turns = battle.data.turns;
  const key = turnKey(combatant);
  // (One no longer on the tracker, gone off the map: where it stood when it went.)
  const place = t => {
    const at = combat.turns.findIndex(c => c.id === t.combatantId);
    return { round: t.round, at: at >= 0 ? at : (t.at ?? -1) };
  };
  const { undo, own, reopen } = goingBack(turns, { round: combat.round, at: combat.turn ?? -1 }, key, place);
  if ( undo.length && !undo[0].snapshot ) {
    ui.notifications.warn(loc("FASTFIGHTING.Live.TooFarBack"));
    await combat.update({ round: prior.round, turn: prior.turn }, { turnEvents: false });
    changed();
    return false;
  }
  await revertOpenTurn();
  for ( const turn of [...undo].reverse() ) await holdingPause(() => revertEntry(battle.scene, turn));
  const snapshot = undo[0]?.snapshot ?? battle.pc?.snapshot;
  if ( snapshot ) battle.run = playersNow(restoreRun(battle.spec, battle.rules, snapshot, { log: battle.run.log }));
  battle.data.turns = turns.slice(0, turns.length - undo.length);
  battle.data.played = null;
  battle.data.offMap = [];
  battle.data.salt = (battle.data.salt ?? 0) + 1;
  battle.data.told = lastTurn(battle.run.log);
  battle.pc = null;
  // (The cards it told are gone: told again when they're played again.)
  const gone = new Set(battle.run.log.map(e => e.turn ?? 0));
  battle.data.toldBeats = (battle.data.toldBeats ?? []).filter(k => k !== "closing" && k.split(",").every(t => gone.has(Number(t))));
  const u = unitOf(combatant);
  if ( reopen && u ) {
    pcTurnBegin(battle.run, u.id, { nonce: freshNonce() });
    battle.pc = { combatantId: combatant.id, id: u.id, round: reopen.round, messages: reopen.cards ?? [], facts: reopen.facts ?? [], records: [], snapshot: reopen.snapshot, from: reopen.from };
  } else if ( own || (u && GONE.has(u.status)) ) battle.data.played = key;
  else if ( u && playerRuns(battle.run, u) ) await beginPlayerTurn(u, combatant);
  else if ( u ) await rewoundCard(u);
  // (A player's turn again: the game goes on; anyone else's waits, paused, for the GM.)
  pauseFor(u, !!battle.pc);
  await keep();
  await combat.setFlag(MODULE_ID, "live", flagOf(true));
  changed();
  return true;
}

/** Whether the turn the tracker is on has been played, and waits for the GM's Next Turn. */
export function waitingOnGm() {
  return !!battle?.combat.combatant && battle.data.played === turnKey(battle.combat.combatant);
}

/** Whom FastFighting would spotlight next, for the Battle Vantage (a spotlight system's), or null. */
export function suggestedSpotlight() {
  if ( !battle?.data.spotlight || battle.data.ended ) return null;
  return nextSpotlight(battle.run);
}

/** Out of the fight for good: no turn to play. */
const GONE = new Set([STATUS.DEAD, STATUS.FLED, STATUS.SURRENDERED, STATUS.STOOD_DOWN, STATUS.BEATEN]);

/**
 * The game paused while the fight is FastFighting's (reading a player's turn, deciding and playing its own, waiting on
 * the GM's Next Turn), so no player moves a token meanwhile; going on for a player's turn, so they can move and roll.
 * `u`: whose turn it is now (none: FastFighting's). A GM who pauses or un-pauses it meanwhile has the last word, until
 * the next turn.
 */
function pauseFor(u, theirs = !!u && playerRuns(battle.run, u) && !GONE.has(u.status)) {
  if ( game.user.isGM && game.paused === theirs ) game.togglePause(!theirs, { broadcast: true });
}

/** The players' characters as the battle has them now (a run restored from a kept turn takes them). */
function playersNow(run = battle.run) {
  if ( Array.isArray(battle.data.players) ) run.live.players = new Set(battle.data.players);
  return run;
}

/** One more the players run (a player's summons): the battle's list and the run's. */
function addPlayer(id) {
  battle.data.players = [...new Set([...(battle.data.players ?? []), id])];
  battle.run.live.players.add(id);
}

/** The latest turn in a log (0 for none). */
const lastTurn = log => {
  let last = 0;
  for ( const e of log ) if ( (e.turn ?? 0) > last ) last = e.turn;
  return last;
};

/** Foundry's ChatMessage class. */
const chatMessages = () => foundry.documents.ChatMessage ?? globalThis.ChatMessage;

/** How a turn is written onto the sheets, as the world's settings say. */
const writeOptions = () => ({ live: true, lootMode: setting("lootMode"), corpseMode: setting("corpseMode"), fledMode: setting("fledMode") });

/** The initiative cards rolled since `from` (taken back with the encounter). */
const initiativeCards = from => game.messages.filter(m => m.timestamp >= from && m.getFlag("core", "initiativeRoll")).map(m => m.id);

/** A creature's token id: its spec's, or (summoned mid-fight) the one made for it. */
export const tokenIdOf = u => u.tokenId ?? u.spec.tokenId ?? u.id;

/** The unit a combatant is (by its token). */
const unitOf = combatant => (combatant ? battle.run.units.find(u => tokenIdOf(u) === combatant.tokenId) ?? null : null);

async function turnBegins(combatant) {
  // (Someone on the tracker the battle doesn't know yet: a player's summons, one the GM brought in. It joins now. Not
  // one a player put on the tracker for a creature they don't own.)
  const u = unitOf(combatant) ?? (combatant && !battle.data.ended && !battle.untrusted?.has(combatant.id) ? await joinFight(combatant) : null);
  if ( !u || battle.data.ended ) return;
  const key = turnKey(combatant);
  if ( battle.data.played === key ) return; // (played already: waiting on the GM)
  // (A token on the tracker twice: one turn, its first combatant's. Another, a player's doing, has none.)
  const first = battle.combat.combatants.find(c => c.tokenId === combatant.tokenId);
  if ( first && first.id !== combatant.id ) {
    battle.data.played = key;
    await moveOn();
    return;
  }
  if ( GONE.has(u.status) ) {
    battle.data.played = key;
    await moveOn();
    return;
  }
  if ( playerRuns(battle.run, u) ) {
    await beginPlayerTurn(u, combatant);
    // (The players' turn: the game goes on, so they can move and roll.)
    pauseFor(u, true);
    return;
  }
  // (FastFighting's: paused while it decides, plays it, and waits on the GM's Next Turn.)
  pauseFor(u, false);
  await playTurn(u, combatant, key);
}

/**
 * A creature added to the battle's combat mid-fight that the battle doesn't know (a player's summons, one the GM brings
 * in): it joins, read like any other. Friendly, and come in a player's character's turn, it's that character's (its
 * side, the player's to run); otherwise its token's disposition says its side (one already in the fight, or it stays
 * out). Made part of the battle itself, so a turn kept before it came still has it when restored. Returns its unit.
 */
/** What a player says of a character's reactions and rerolls (its tactics), for its spec. */
function playersSay(spec, actor) {
  const stored = getStoredTactics(actor);
  return { reactionPrefs: reactionPrefsFor(spec, stored), rerolls: { self: !!stored.rerolls?.self, team: !!stored.rerolls?.team } };
}

/**
 * A player changed what they say of a character's reactions or rerolls mid-battle: used from the next time it's asked
 * (its spec in the battle, and as kept).
 */
export function followPlayersSay(actor) {
  if ( !battle || battle.data.ended || !playsHere() || !actor ) return;
  const ids = new Set();
  for ( const u of battle.run.units ) {
    const doc = battle.scene?.tokens.get(tokenIdOf(u));
    if ( doc?.actor?.uuid !== actor.uuid || !isPlayerControlled(u.spec, actor) ) continue;
    const said = playersSay(u.spec, actor);
    if ( JSON.stringify([u.spec.reactionPrefs, u.spec.rerolls]) === JSON.stringify([said.reactionPrefs, said.rerolls]) ) continue;
    Object.assign(u.spec, said);
    ids.add(u.spec.id);
  }
  if ( !ids.size ) return;
  queue(async () => {
    battle.spec = { ...battle.spec, combatants: battle.spec.combatants.map(c => (ids.has(c.id) ? { ...c, ...playersSay(c, actor) } : c)) };
    battle.data.spec = packSpec(battle.spec);
    await keep();
  });
}

async function joinFight(combatant) {
  if ( !battle || battle.data.ended || battle.combat !== combatant.parent ) return null;
  const known = unitOf(combatant);
  if ( known ) return known;
  const doc = combatant.token;
  const adapter = getAdapter();
  if ( !doc?.actor || !adapter.canHandle?.(doc.actor) ) return null;
  const run = battle.run;
  const sides = Object.keys(battle.spec.sides ?? {});
  const caller = battle.pc ? run.byId.get(battle.pc.id) : null;
  const friendly = doc.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
  const summoner = caller && friendly ? caller : null;
  const wanted = DISPOSITION_SIDES[doc.disposition] ?? SIDES.HOSTILE;
  const side = summoner?.side ?? (sides.includes(wanted) ? wanted
    : wanted === SIDES.FRIENDLY ? run.units.find(u => u.spec.kind === "pc")?.side
      : wanted === SIDES.HOSTILE ? sides.find(s => HOSTILE_GROUPS.includes(s)) : sides.includes(NEUTRAL_PARTY) ? NEUTRAL_PARTY : null);
  if ( !side ) return null;
  let spec;
  try {
    spec = await characterSpec(adapter, doc);
  } catch ( err ) {
    console.error(`${MODULE_ID} | reading ${doc.name}`, err);
    return null;
  }
  if ( !spec || unitOf(combatant) ) return unitOf(combatant);
  Object.assign(spec, { side, originSide: side, inEncounter: true, tokenId: doc.id, hidden: doc.hidden });
  // (A player's: its reactions and rerolls as its player said.)
  if ( isPlayerControlled(spec, doc.actor) ) Object.assign(spec, playersSay(spec, doc.actor));
  spec.generic ??= spec.kind !== "pc" && !doc.actorLink && (spec.rarity ?? 0) < 3;
  if ( doc.object ) spec.position = positionOf(doc.object);
  spec.perception ??= spec.initiative?.mod ?? 0;
  battle.spec = { ...battle.spec, combatants: [...battle.spec.combatants, spec] };
  battle.data.spec = packSpec(battle.spec);
  battle.run = restoreRun(battle.spec, battle.rules, snapshotRun(run, { log: false }), { log: run.log });
  const u = battle.run.byId.get(spec.id);
  if ( !u ) return null;
  u.active = true;
  u.joinedRound = battle.run.round;
  if ( !battle.run.order.includes(u) ) {
    const at = summoner ? battle.run.order.findIndex(o => o.id === summoner.id) : -1;
    battle.run.order.splice(at >= 0 ? at + 1 : battle.run.order.length, 0, u);
  }
  if ( (summoner && battle.run.live.players.has(summoner.id)) || doc.actor.hasPlayerOwner ) addPlayer(u.id);
  refreshApproach();
  await keep();
  changed();
  return u;
}

/** A player's turn begins: kept as it was (for Rewind), begun in the engine, and its cards gathered from now on. */
function beginPlayerTurn(u, combatant) {
  const snapshot = snapshotRun(battle.run, { log: false });
  pcTurnBegin(battle.run, u.id, { nonce: freshNonce() });
  const doc = docOf(u.id);
  battle.pc = { combatantId: combatant.id, id: u.id, round: battle.combat.round, messages: [], facts: [], records: [], snapshot, from: Date.now(), lastAt: doc ? { x: doc.x, y: doc.y } : null };
  // (Every sheet and token as the turn begins, for Rewind to put back whatever the turn changed by hand.)
  sheetsAt.set(battle.pc, captureSheets());
  return keep();
}

/** A new round: those not yet in the fight look around, and one that notices joins the tracker. */
async function newRound(round) {
  liveRound(battle.run, round);
  for ( const u of [...battle.run.order] ) {
    if ( u.active || u.status !== STATUS.STANDING || u.spec.hazard ) continue;
    liveTurn(battle.run, u.id);
    if ( u.active || u.joinsRound ) {
      const doc = battle.scene.tokens.get(tokenIdOf(u));
      if ( doc && !battle.combat.combatants.some(c => c.tokenId === doc.id) ) {
        const [c] = await battle.combat.createEmbeddedDocuments("Combatant", [{ tokenId: doc.id, sceneId: battle.scene.id, actorId: doc.actorId }]);
        if ( c ) {
          battle.data.joined = [...(battle.data.joined ?? []), c.uuid];
          await keep(); // (kept at once: Rewind This Encounter takes it back even if this is all that happens)
        }
        if ( c && !battle.data.spotlight ) {
          const from = Date.now();
          await rollFor(battle.combat, [c.id]);
          battle.data.rollCards = [...(battle.data.rollCards ?? []), ...initiativeCards(from)];
        }
      }
    }
  }
  // (Told with the turn before it: rewound with it, and with the encounter.)
  const told = await tellNew();
  battle.data.turns.at(-1)?.messages.push(...told);
}

/* -------------------------------------------- */
/*  The sheets                                  */
/* -------------------------------------------- */

const docOf = id => {
  const u = battle.run.byId.get(id);
  return battle.scene.tokens.get(u ? tokenIdOf(u) : id);
};

/** Every creature's sheet as it stands, with where its token is. */
async function readStates() {
  const adapter = getAdapter();
  const out = {};
  for ( const u of battle.run.units ) {
    const doc = docOf(u.id);
    if ( !doc ) continue;
    // (A sheet that can't be read: the creature as the engine last knew it, the GM told once. Not the turn lost.)
    let state;
    try {
      state = (await adapter.readLiveState(doc, { spec: battle.spec, unit: u })) ?? {};
    } catch ( err ) {
      console.error(`${MODULE_ID} | reading ${doc.name}'s sheet`, err);
      if ( !(battle.unread ??= new Set()).has(u.id) ) {
        battle.unread.add(u.id);
        ui.notifications.warn(fmt("FASTFIGHTING.Live.SheetUnread", { name: doc.name }));
      }
      continue;
    }
    // (Which of the engine's conditions its sheet can carry: what it can't, the engine keeps.)
    state.carries ??= key => adapter.sheetCarries(key, doc.actor);
    if ( doc.object ) {
      const p = positionOf(doc.object);
      state.position = { x: p.x, y: p.y };
    }
    out[u.id] = state;
  }
  return out;
}

/** The pools the world keeps for everyone (Daggerheart's Fear), as they stand now: the engine draws on them. */
function syncPools(adapter) {
  const pools = adapter.livePools?.();
  if ( pools ) Object.assign(battle.run.sharedPools, pools);
}

/**
 * How everyone can reach everyone now they've moved; and the scene's walls and doors as they are now (a door a player
 * opened, one the GM shut: engine/live.js setScene), kept with the battle when they've changed.
 */
function refreshApproach() {
  const roster = battle.run.units.map(u => ({ token: docOf(u.id)?.object, spec: u.spec })).filter(e => e.token);
  setApproach(battle.run, approachFor(roster, getSetup()));
  if ( !battle.spec.options?.positioning ) return;
  try {
    if ( setScene(battle.run, sceneNow(roster.map(e => e.token))) ) battle.data.spec = packSpec(battle.spec);
  } catch ( err ) {
    console.warn(`${MODULE_ID} | reading the scene's walls and doors`, err);
  }
}

/* -------------------------------------------- */
/*  A turn FastFighting plays                   */
/* -------------------------------------------- */

async function playTurn(u, combatant, key) {
  const adapter = getAdapter();
  syncFromSheets(battle.run, await readStates());
  syncPools(adapter);
  refreshApproach();
  const before = captureAll(battle.run);
  const snapshot = snapshotRun(battle.run, { log: false });
  const answers = [];
  const nonce = freshNonce(); // (the turn's own dice, the same each time it's played again for an answer)
  // Where everyone stood (for Rewind), before the turn moves anyone; and what it's put on the map and in the chat
  // before each of the system's rolls (turnRoll).
  const stage = turnStage();
  const startedAt = battle.run.units.map(x => docOf(x.id)).filter(Boolean).map(doc => ({ uuid: doc.uuid, ...placeOf(doc) }));
  areaShapes.clear();
  areaTests.clear();
  let result;
  for ( let tries = 0; ; tries++ ) {
    try {
      battle.run.live.exitOf = exitOf; // (the way off the scene, for one leaving the fight)
      battle.run.live.inArea = areaTest; // (who an area catches, as the system's own shape has it on the map)
      result = liveTurn(battle.run, u.id, { answers, salt: battle.data.salt ?? 0, nonce });
      break;
    } catch ( err ) {
      if ( !(err instanceof NeedsDecision) || tries > 200 ) throw err;
      const request = err.request;
      // (A roll the system makes: what the turn did before it played on the map first. A question: asked.)
      const answer = request.roll ? await turnRoll(request, battle.run.log.slice(battle.run.live.turnFrom ?? battle.run.log.length), stage) : await answerFor(request);
      answers.push([request.key, answer]);
      battle.run = restoreRun(battle.spec, battle.rules, snapshot, { log: battle.run.log });
    }
  }
  const after = captureAll(battle.run);
  const turn = { key, combatantId: combatant.id, round: battle.combat.round, at: battle.combat.turn, kind: "npc", records: [...stage.records], messages: [...stage.messages], moves: [], doors: [], snapshot };
  await holdingPause(async () => {
    // Where everyone stood (for Rewind), then the moves and doors as the turn made them (those after its last roll:
    // the rest are on the map already).
    turn.moves = startedAt;
    const docs = stageDocs(stage);
    const doorsOpened = stage.doorsOpened;
    const rest = result.events.slice(stage.played);
    if ( setting("playOnMap") ) await playMoves(rest, docs, stageGrid(stage), doorsOpened, battle.scene);
    else await playMoves(rest, docs, null, doorsOpened, battle.scene, { instant: true });
    turn.doors = [...doorsOpened.values()];
    // (Its areas, laid on the map as the system lays them: who they caught was tested against them.)
    await layAreas(result.events, turn.records);
    // What it summoned, onto the scene and the tracker.
    await placeSummons(turn.records);
    // (Those inside another, swallowed or engulfed: where their holder went.)
    await carryInside();
    // What the turn changed, onto the sheets (each written as it stood when the turn began).
    await writeChanges(before, after, turn.records);
    // (Those it saw off the map: out of the way, and off the tracker as it moves on.)
    await sendOff(result.events, turn);
    // (What the turn did to what the encounter keeps: Daggerheart's Fear.)
    try {
      turn.records.push(...((await adapter.commitTurn(before, after, { ...writeOptions(), spec: battle.spec, events: result.events })) ?? []));
    } catch ( err ) {
      console.error(`${MODULE_ID} | writing the turn's encounter changes`, err);
    }
    // (Where they stood kept only for those it moved: everyone else is where they were, and a Rewind leaves them be.)
    const byUuid = new Map([...docs.values()].map(d => [d.uuid, d]));
    turn.moves = turn.moves.filter(m => {
      const doc = byUuid.get(m.uuid);
      return !doc || doc._source.x !== m.x || doc._source.y !== m.y;
    });
    turn.messages.push(...await tellNew());
  });
  battle.data.played = key;
  await settleTurn(turn, result.ended);
}

/**
 * A turn kept: all of them, for Rewind This Encounter (what each wrote, told and moved); the last REWIND_DEPTH with the
 * fight as it was before them too (a snapshot, the big part), for Rewind Turn.
 */
function keepTurn(turn) {
  const turns = [...battle.data.turns, turn];
  for ( const t of turns.slice(0, -REWIND_DEPTH) ) delete t.snapshot;
  battle.data.turns = turns;
}

/** A turn done: kept for Rewind, the battle kept, and either the end or the GM's Continue. */
async function settleTurn(turn, ended) {
  keepTurn(turn);
  if ( ended ) {
    await finish();
    return;
  }
  if ( battle.data.auto && turn.kind === "npc" ) {
    await keep();
    moveOn();
    return;
  }
  const card = await waitCard(turn);
  if ( card ) turn.messages.push(card.id);
  await keep();
}

/**
 * The GMs' card after a turn FastFighting played: Rewind (the tracker's Previous Turn) or Next Turn (the tracker moves
 * on), with the tracker's own arrows.
 */
async function waitCard(turn) {
  if ( turn.kind !== "npc" ) return null;
  const name = battle.run.byId.get(battle.combat.combatants.get(turn.combatantId)?.tokenId)?.spec.name ?? "";
  const ChatMessage = chatMessages();
  return ChatMessage.create({
    content: inertHtml(`<div class="fast-fighting-live"><p>${escape(fmt("FASTFIGHTING.Live.Told", { name }))}</p>
      <button type="button" data-ff-live="rewind"><i class="fa-solid fa-arrow-left"></i> ${loc("FASTFIGHTING.Live.Rewind")}</button>
      <button type="button" data-ff-live="continue"><i class="fa-solid fa-arrow-right"></i> ${loc("FASTFIGHTING.Live.NextTurn")}</button></div>`),
    speaker: chronicle(), whisper: gmIds(), flags: { [MODULE_ID]: { live: { battle: battle.data.id, turn: turn.key } } }
  });
}

/* -------------------------------------------- */
/*  The system's own rolls, in a turn it plays  */
/* -------------------------------------------- */

/** The kinds of event that move someone on the map (make-it-so.js playMoves). */
const MOVING = new Set(["move", "flee", "leave", "forced", "step"]);

/**
 * What a turn FastFighting plays has done on the map and in the chat before its rolls: how many of its events are
 * played (`played`), the doors they opened, the undo records and cards of the rolls (for Rewind).
 */
const turnStage = () => ({ played: 0, records: [], messages: [], doorsOpened: new Map(), docs: null, grid: null });

/** The battle's tokens by creature, for a turn's moves. */
const stageDocs = stage => (stage.docs ??= new Map(battle.run.units.map(x => [x.id, docOf(x.id)]).filter(([, d]) => d)));

/** The paths the turn's moves walk (the one it found its way by, else the scene's). */
const stageGrid = stage => (stage.grid ??= currentPathGrid() ?? pathGridFor([...stageDocs(stage).values()].map(d => d.object).filter(Boolean)));

/** The turn's events not played on the map yet, played: its moves, as far as it's got. */
async function playSoFar(events, stage) {
  const fresh = events.slice(stage.played);
  stage.played = Math.max(stage.played, events.length);
  if ( !fresh.some(e => MOVING.has(e.type)) ) return;
  if ( setting("playOnMap") ) await playMoves(fresh, stageDocs(stage), stageGrid(stage), stage.doorsOpened, battle.scene);
  else await playMoves(fresh, stageDocs(stage), null, stage.doorsOpened, battle.scene, { instant: true });
}

/**
 * A roll in a turn FastFighting plays, made with the system's own roller (engine/live.js systemRoll): the moves the
 * turn made before it played first (so the system sees range and flanking from where they stand), then the roll, its
 * cards in the chat; or a strike's damage card applied the system's way. Its cards and undo records are the turn's.
 * Returns what the engine takes of it, or null (the engine's own dice).
 */
async function turnRoll(request, events, stage) {
  const seen = new Set(game.messages.keys());
  let out = null;
  await holdingPause(async () => {
    try {
      if ( request.roll === "apply" ) out = await applyStrike(request, stage);
      else {
        await playSoFar(events, stage);
        if ( request.roll === "strike" ) out = await rollTurnStrike(request);
        else if ( request.roll === "save" || request.roll === "check" ) out = await rollTurnCheck(request);
        else if ( request.roll === "use" ) out = await useTurnAction(request);
        else if ( request.roll === "damage" ) out = await rollTurnDamage(request);
      }
    } catch ( err ) {
      console.error(`${MODULE_ID} | the system's roll`, err);
      out = null;
    }
  });
  stage.messages.push(...game.messages.filter(m => !seen.has(m.id)).map(m => m.id));
  return out;
}

/**
 * A strike in a turn FastFighting plays, rolled with the system's own roller (the helper's rollStrike): its attack
 * card and, on a hit, its damage card. {attack, damage: {byType} | null, card: the damage card's id}, or null.
 */
async function rollTurnStrike({ unitId, targetId, action, attackNumber }) {
  const adapter = getAdapter();
  const doc = docOf(unitId);
  const target = docOf(targetId);
  if ( !doc || !target ) return null;
  const seen = new Set(game.messages.keys());
  const raw = await adapter.rollStrike(doc, { action, target, attackNumber: Math.max(0, Number(attackNumber) || 0), secret: secretRoll(doc) });
  const out = strikeRolled(raw);
  if ( !out?.damage ) return out;
  // (Its damage card, for the system to apply as its own: the one the helper names (null: none holds it all, the
  // engine's sum), else the first damage card it made.)
  if ( raw && Object.hasOwn(raw, "card") ) return { ...out, card: typeof raw.card === "string" && game.messages.get(raw.card) ? raw.card : null };
  const ids = Object.fromEntries(battle.run.units.map(x => [tokenIdOf(x), x.id]));
  const card = game.messages.contents.filter(m => !seen.has(m.id)).find(m => {
    try {
      return adapter.damageCard?.(m, { ids })?.kind === "damage";
    } catch ( err ) {
      return false;
    }
  });
  return { ...out, card: card?.id ?? null };
}

/** What a creature has to lose, as its sheet has it now: hit points, temporary hit points and stamina. Null unread. */
async function standing(u) {
  const doc = docOf(u.id);
  if ( !doc ) return null;
  const s = await getAdapter().readLiveState(doc, { spec: battle.spec, unit: u });
  if ( !s || !Number.isFinite(s.hp) ) return null;
  return s.hp + (Number(s.temp) || 0) + (Number(s.stamina) || 0);
}

/**
 * A strike's damage card applied the system's way to its target (the helper's applyDamageCard: resistances,
 * shields, temporary hit points, its own damage-taken card): {lost}, what the target lost by it. Null: the engine's sum.
 */
async function applyStrike({ targetId, card, applies, multiplier = 1, amount = null }, stage) {
  const u = battle.run.byId.get(targetId);
  const doc = docOf(targetId);
  const message = card ? game.messages.get(card) : null;
  if ( !u || !doc || !message ) return null;
  const was = await standing(u);
  // (With the reaction the system's application does itself, where one was used: {shieldBlock: true}; a save's share
  // of an area's damage: its multiplier, half or double.)
  const times = Number.isFinite(Number(multiplier)) ? Math.max(0, Number(multiplier)) : 1;
  // (And what the engine makes of it, after the target's resistances: for a system whose own application has none.)
  const options = { multiplier: times, ...(Number.isFinite(amount) ? { amount } : {}), ...(typeof applies === "string" && applies ? { [applies]: true } : {}) };
  const records = (await getAdapter().applyDamageCard(message, doc, options)) ?? [];
  stage.records.push(...records);
  const now = await standing(u);
  return was !== null && now !== null ? { lost: Math.max(0, was - now) } : null;
}

/**
 * An action's own card in a turn FastFighting plays, as its user shows it (the helper's useAction: a spell's, a
 * breath's), nothing rolled or spent: {card} (its message id, null for none), for its damage to be rolled from.
 */
async function useTurnAction({ unitId, targetId, action }) {
  const doc = docOf(unitId);
  if ( !doc || !offers(getAdapter(), "useAction") ) return null;
  const target = targetId ? docOf(targetId) : null;
  const raw = await getAdapter().useAction(doc, { action, targets: target ? [target] : [], secret: secretRoll(doc) });
  const card = typeof raw?.card === "string" && game.messages.get(raw.card) ? raw.card : null;
  return raw ? { card } : null;
}

/**
 * The damage of an action that isn't an attack, rolled the system's way once for all it catches (the helper's
 * rollDamage: a spell's, a breath's), its card in the chat: {damage: {byType}, card}, or null (the engine's dice).
 */
async function rollTurnDamage({ unitId, action, card }) {
  const doc = docOf(unitId);
  if ( !doc || !offers(getAdapter(), "rollDamage") ) return null;
  const raw = await getAdapter().rollDamage(doc, { action, card: card ?? null, secret: secretRoll(doc) });
  const byType = raw?.damage?.byType && typeof raw.damage.byType === "object"
    ? Object.fromEntries(Object.entries(raw.damage.byType).map(([k, v]) => [String(k), counted(v)]).filter(([, v]) => v !== null)) : null;
  if ( !byType || !Object.keys(byType).length ) return null;
  return { damage: { byType }, card: typeof raw.card === "string" && game.messages.get(raw.card) ? raw.card : null };
}

/** How long a player has to answer a question about their reaction (ms) before the GM is asked instead. */
const ASK_MS = 60000;

/**
 * A reaction's answer in a turn FastFighting plays: asked (of its player, or the GM), or already decided; and, used, a
 * strike the system rolls itself (systemRoll), {use, roll} for the engine.
 */
async function answerFor(request) {
  const use = request.decided ? true : await ask(request);
  if ( !use || !request.strike ) return use;
  // (A player's, theirs to roll while they're here; a creature's, or one whose players are gone, the system's.)
  const theirs = await playerRolls(request);
  if ( theirs ) return theirs;
  const roll = await systemRoll(request);
  return roll ? { use: true, roll } : true;
}

/* -------------------------------------------- */
/*  What a player's turn changed by hand        */
/* -------------------------------------------- */

/**
 * A player's turn still open, taken back: what FastFighting wrote in it (reactions, players' damage), then what was
 * changed by hand since it began, every sheet and token as it began.
 */
async function revertOpenTurn() {
  const pc = battle?.pc;
  if ( !pc ) return;
  const before = sheetsAt.get(pc);
  const records = [...(before ? sheetUndo(before) : []), ...(pc.records ?? [])];
  if ( records.length ) await holdingPause(() => revertEntry(battle.scene, { records }));
}

/** Each player's turn's sheets as it began (captureSheets), in this browser. */
const sheetsAt = new WeakMap();

/** Every creature's token and actor in the battle, as they are now: {uuid: {token: {x, y, elevation, rotation}, actor}}. */
function captureSheets() {
  const out = {};
  for ( const u of battle.run.units ) {
    const doc = docOf(u.id);
    if ( !doc?.actor ) continue;
    try {
      out[doc.uuid] = { token: { x: doc.x, y: doc.y, elevation: doc.elevation, rotation: doc.rotation }, actor: doc.actor.toObject() };
    } catch ( err ) {
      console.warn(`${MODULE_ID} | noting ${doc.name}'s sheet`, err);
    }
  }
  return out;
}

/** The values of `before` that `now` no longer has, by flattened key (a key now added isn't taken away). */
function changedBack(before, now) {
  const a = foundry.utils.flattenObject(before ?? {});
  const b = foundry.utils.flattenObject(now ?? {});
  const out = {};
  for ( const [k, v] of Object.entries(a) ) if ( JSON.stringify(v) !== JSON.stringify(b[k]) ) out[k] = v;
  return out;
}

/**
 * Undo records for whatever changed on each sheet and token since `before` (captureSheets): where a token stood, its
 * actor's data (hit points, resources, spell slots), its items (changed, used up, added) and its effects (put on, taken
 * off), as they were.
 */
function sheetUndo(before) {
  const out = [];
  for ( const [uuid, was] of Object.entries(before) ) {
    const doc = fromUuidSync(uuid);
    if ( !doc?.actor ) continue;
    const now = doc.actor.toObject();
    const record = undoRecord(doc, doc.actor, { statusesBefore: false });
    let any = false;
    // (Where it stood.)
    const moved = Object.fromEntries(Object.entries(was.token).filter(([k, v]) => doc[k] !== v));
    if ( Object.keys(moved).length ) {
      record.tokenUpdate = moved;
      any = true;
    }
    // (Its actor's own data.)
    const system = changedBack({ system: was.actor.system }, { system: now.system });
    if ( Object.keys(system).length ) {
      record.actorUpdate = system;
      any = true;
    }
    // (Its items and its effects: changed, gone, new.)
    for ( const [kind, created, deleted] of [["items", "createdItems", "deletedItems"], ["effects", "createdEffects", "deletedEffects"]] ) {
      const then = new Map((was.actor[kind] ?? []).map(d => [d._id, d]));
      const nowById = new Map((now[kind] ?? []).map(d => [d._id, d]));
      for ( const [id, d] of then ) {
        if ( !nowById.has(id) ) {
          record[deleted].push(d);
          any = true;
        } else if ( kind === "items" ) {
          const update = changedBack({ system: d.system, name: d.name }, { system: nowById.get(id).system, name: nowById.get(id).name });
          if ( Object.keys(update).length ) {
            record.itemUpdates.push({ id, update });
            any = true;
          }
        }
      }
      for ( const id of nowById.keys() ) {
        if ( !then.has(id) ) {
          record[created].push(id);
          any = true;
        }
      }
    }
    if ( any ) out.push(record);
  }
  return out;
}

/* -------------------------------------------- */
/*  Areas on the map                            */
/* -------------------------------------------- */

/**
 * The shapes of the areas the turn being played aimed, and who they caught, by caster, target, action and where they
 * stood: the same answers each time the turn is played again, whatever has moved on the map or opened since.
 */
const areaShapes = new Map();
const areaTests = new Map();

/**
 * Where the engine has a creature, as a point on the map in pixels (its center): the map's own token where the
 * engine has no position for it. `at` is a position in the engine's feet ({x, y}) to use instead.
 */
function pointOf(u, at = u.pos) {
  if ( !at ) return docOf(u.id)?.object?.center ?? null;
  const { size } = canvas.dimensions;
  const feet = squareFeet();
  return { x: (at.x / feet) * size, y: (at.y / feet) * size };
}

/** The centers of the squares a creature covers, where the engine has it (and its own center). */
function squaresOf(o) {
  const c = pointOf(o);
  const doc = docOf(o.id);
  if ( !c || !doc ) return [];
  const size = canvas.dimensions.size;
  const w = Math.max(1, Math.round(doc.width ?? 1));
  const h = Math.max(1, Math.round(doc.height ?? 1));
  const out = [c];
  for ( let i = 0; i < w; i++ ) for ( let j = 0; j < h; j++ ) out.push({ x: c.x - (w * size) / 2 + (i + 0.5) * size, y: c.y - (h * size) / 2 + (j + 0.5) * size });
  return out;
}

/** A position, as a key. */
const spotKey = p => (p ? `${Math.round(p.x)},${Math.round(p.y)}` : "-");

/**
 * The shape an area u aims at t makes on the map, as the system draws it (the helper's areaShape; else Foundry's own
 * template defaults): a cone, a line or a cube from u toward t, a burst or a square on t, an emanation round u; from
 * where the engine has them (or `from` and `at`, where the turn's "area" event says they stood). Null off this scene.
 */
function areaShapeFor(u, t, action, { from = u.pos, at = t.pos } = {}) {
  const key = `${u.id}|${t.id}|${action.id}|${spotKey(from)}|${spotKey(at)}`;
  if ( areaShapes.has(key) ) return areaShapes.get(key);
  let out = null;
  const cu = pointOf(u, from);
  const ct = pointOf(t, at);
  const du = docOf(u.id);
  if ( cu && ct && du && canvas.scene?.id === battle.scene.id && foundry.data?.ConeShapeData ) {
    const area = action.area ?? {};
    const shape = area.shape ?? "burst";
    const px = canvas.grid.size / (canvas.grid.distance || 5);
    const radius = (Number(area.feet) > 0 ? Number(area.feet) : 10) * px;
    const rotation = Math.toDegrees(Math.atan2(ct.y - cu.y, ct.x - cu.x));
    const defaults = CONFIG.MeasuredTemplate?.defaults ?? {};
    let data;
    const half = (Math.max(du.width ?? 1, du.height ?? 1) * canvas.grid.size) / 2;
    if ( shape === "cone" ) data = { type: "cone", x: cu.x, y: cu.y, radius, angle: Number(area.angle) > 0 ? Number(area.angle) : defaults.angle ?? 90, rotation };
    else if ( shape === "line" ) {
      data = { type: "line", x: cu.x, y: cu.y, length: radius, width: Number(area.width) > 0 ? Number(area.width) * px : (defaults.width ?? 1) * canvas.grid.size, rotation };
    } else if ( shape === "cube" ) {
      // (One face against the caster's edge, toward its target.)
      const r = Math.toRadians(rotation);
      data = { type: "rectangle", x: cu.x + Math.cos(r) * half, y: cu.y + Math.sin(r) * half, width: radius, height: radius, anchorX: 0, anchorY: 0.5, rotation };
    } else if ( shape === "square" ) data = { type: "rectangle", x: ct.x, y: ct.y, width: radius, height: radius, anchorX: 0.5, anchorY: 0.5, rotation: 0 };
    else if ( shape === "emanation" ) data = { type: "circle", x: cu.x, y: cu.y, radius: radius + half };
    else data = { type: "circle", x: ct.x, y: ct.y, radius };
    try {
      data = getAdapter().areaShape?.({ ...data }, { area }) ?? data;
    } catch ( err ) {
      console.warn(`${MODULE_ID} | the system's shape for an area`, err);
    }
    const Shape = { cone: foundry.data.ConeShapeData, line: foundry.data.LineShapeData, circle: foundry.data.CircleShapeData, rectangle: foundry.data.RectangleShapeData }[data.type];
    try {
      const aimed = shape === "square" || (data.type === "circle" && shape !== "emanation");
      if ( Shape ) out = { data, shape: new Shape(data), origin: aimed ? ct : cu, actionId: action.id, name: action.name };
    } catch ( err ) {
      console.warn(`${MODULE_ID} | an area's shape`, err);
    }
  }
  areaShapes.set(key, out);
  return out;
}

/**
 * Does an area u aims at t catch o: any square o covers (where the engine has it) inside its shape, and no wall in
 * between? Null: can't tell. Asked again in the same turn with everyone where they were, the same answer.
 */
function areaTest(u, t, o, action) {
  const key = `${u.id}|${t.id}|${o.id}|${action.id}|${spotKey(u.pos)}|${spotKey(t.pos)}|${spotKey(o.pos)}`;
  if ( areaTests.has(key) ) return areaTests.get(key);
  const area = areaShapeFor(u, t, action);
  const points = area ? squaresOf(o) : [];
  const walls = CONFIG.Canvas.polygonBackends?.move;
  const out = points.length ? points.some(p => area.shape.testPoint(p) && !walls?.testCollision(area.origin, p, { type: "move", mode: "any" })) : null;
  areaTests.set(key, out);
  return out;
}

/** The areas a turn aimed (its "area" events), laid on the map as Regions; their undo kept with the turn's records. */
async function layAreas(events, records) {
  const run = battle.run;
  for ( const e of events.filter(x => x.type === "area") ) {
    const u = run.byId.get(e.actorId);
    const t = run.byId.get(e.targetId);
    const action = u?.spec.actions?.find(a => a.id === e.actionId);
    // (Where they stood as it was aimed, as the event says: either may have moved since.)
    const area = u && t && action ? areaShapeFor(u, t, action, { from: e.from ?? u.pos, at: e.at ?? t.pos }) : null;
    if ( !area ) continue;
    try {
      const [region] = await battle.scene.createEmbeddedDocuments("Region", [{
        name: area.name, color: "#f0a35b", shapes: [area.data], visibility: CONST.REGION_VISIBILITY?.ALWAYS ?? 2,
        flags: { [MODULE_ID]: { area: battle.data.id } }
      }]);
      if ( !region ) continue;
      records.push({ ...undoRecord(null, null, { statusesBefore: false }), createdRegions: [region.uuid] });
      battle.data.areas = [...(battle.data.areas ?? []), region.uuid];
    } catch ( err ) {
      console.warn(`${MODULE_ID} | laying an area on the map`, err);
    }
  }
}

/** The areas the last turn laid, cleared off the map as the tracker moves on. */
async function clearAreas() {
  const areas = battle?.data.areas ?? [];
  if ( !areas.length ) return;
  battle.data.areas = [];
  for ( const uuid of areas ) {
    try {
      await (await fromUuid(uuid))?.delete();
    } catch ( err ) {
      // (Gone already: a Rewind took it, or a GM did.)
    }
  }
}

/** A reaction a player rolls themselves, waiting: {key, unitId, name, card, resolve}, or null. */
let waiting = null;
/** The reaction a player is rolling, for the Battle Vantage (its name and key), or null. */
export const waitingReaction = () => (waiting ? { key: waiting.key, name: waiting.name } : null);

/**
 * A player's reaction, theirs to roll as they would on their turn: a card to them and the GMs (roll it, then I've done
 * my reaction), and the battle waits, the Battle Vantage saying so (They've rolled it, Go on without it). What they
 * rolled since is read off their cards (the helper's readTurn) and played as the strike's roll; its damage, as players'
 * damage goes. Null when none of its players is here, or the helper can't read their cards.
 */
async function playerRolls(request) {
  const run = battle.run;
  const adapter = getAdapter();
  const doc = docOf(request.unitId);
  if ( !run.live.players.has(request.unitId) || !offers(adapter, "readTurn") || !doc?.actor ) return null;
  const owners = game.users.filter(u => !u.isGM && u.active && doc.actor.testUserPermission(u, "OWNER"));
  if ( !owners.length ) return null;
  const name = run.byId.get(request.unitId)?.spec.name ?? "";
  const target = request.byId ? run.byId.get(request.byId)?.spec.name ?? "" : "";
  const from = Date.now();
  const ChatMessage = chatMessages();
  const card = await ChatMessage.create({
    content: inertHtml(`<div class="fast-fighting-live"><p>${escape(fmt("FASTFIGHTING.Live.YourReaction", { name, reaction: request.strike?.name ?? request.reaction, target }))}</p>
      <button type="button" data-ff-live="reactionDone"><i class="fa-solid fa-check"></i> ${loc("FASTFIGHTING.Live.ReactionDone")}</button></div>`),
    speaker: chronicle(), whisper: [...new Set([...gmIds(), ...owners.map(u => u.id)])],
    flags: { [MODULE_ID]: { live: { battle: battle.data.id, reaction: request.key, pcId: request.unitId, pcToken: doc.uuid } } }
  });
  const done = await new Promise(resolve => {
    waiting = { key: request.key, unitId: request.unitId, name, card: card?.id ?? null, resolve };
    changed();
  });
  waiting = null;
  await card?.delete();
  changed();
  if ( done !== "done" ) return { use: false };
  // (What they rolled since the card: their cards, not FastFighting's own.)
  const own = m => m.getFlag(MODULE_ID, "story") || m.getFlag(MODULE_ID, "live");
  const messages = game.messages.filter(m => m.timestamp >= from && !own(m) && madeFor(m, request.unitId));
  const ids = Object.fromEntries(run.units.map(u => [tokenIdOf(u), u.id]));
  const actors = {};
  for ( const u of run.units ) if ( u.spec.actorId && !(u.spec.actorId in actors) ) actors[u.spec.actorId] = u.id;
  let events = [];
  try {
    events = adapter.readTurn(messages, { actorId: run.byId.get(request.unitId)?.spec.actorId ?? null, tokenId: request.unitId, ids, actors }) ?? [];
  } catch ( err ) {
    console.error(`${MODULE_ID} | reading ${name}'s reaction`, err);
  }
  const hit = events.find(e => e.type === "attack" && (!e.targetId || !request.byId || e.targetId === request.byId));
  const degree = counted(hit?.degree);
  // (Nothing rolled: the reaction not used after all.)
  if ( degree === null ) return { use: false };
  const roll = { attack: { degree: Math.min(3, Math.round(degree)), natural: counted(hit.natural), total: counted(hit.total, -Infinity) }, damage: null };
  const amount = counted(hit.damage);
  if ( roll.attack.degree >= 2 && amount > 0 ) {
    const t = request.byId ? run.byId.get(request.byId) : null;
    let multiplier = 1;
    if ( t && !run.live.players.has(t.id) && !battle.data.applyDamage && !systemApplies(adapter) ) multiplier = await askDamage(name, t.spec.name, amount);
    roll.damage = { total: Math.floor(amount * multiplier) };
  }
  return { use: true, roll };
}

/**
 * What a creature's sheet says now, in a player's turn (the engine hears it only as the turn ends): {hp, status}, for the
 * Battle Vantage to show; null when nothing has changed on it since the turn began.
 */
export function sheetNow(id) {
  return battle?.pc ? battle.pc.sheets?.get(id) ?? null : null;
}

/** A sheet changed in a player's turn: what it says now, noted for the Battle Vantage. */
async function noteSheet(actor) {
  const pc = battle?.pc;
  const u = pc ? battle.run.units.find(x => docOf(x.id)?.actor === actor) : null;
  if ( !u ) return;
  try {
    const s = await getAdapter().readLiveState(docOf(u.id), { spec: battle.spec, unit: u });
    if ( !s || battle?.pc !== pc ) return;
    (pc.sheets ??= new Map()).set(u.id, { hp: Number.isFinite(s.hp) ? s.hp : u.hp, status: s.status ?? null });
    changed();
  } catch ( err ) {
    // (A sheet that can't be read: the engine's view stands.)
  }
}

/** A player's reaction rolled (done) or left (skip): the battle goes on with it. True if one was waiting. */
export function endReaction(key, how = "done") {
  if ( !waiting || (key && waiting.key !== key) ) return false;
  waiting.resolve(how);
  return true;
}

/** Asked by a player's browser: their reaction's card pressed (they've rolled it). */
function answerReactionDone(data, { user } = {}) {
  if ( !waiting || data?.key !== waiting.key ) return false;
  const actor = docOf(waiting.unitId)?.actor;
  if ( !user?.isGM && !actor?.testUserPermission(user, "OWNER") ) return false;
  return endReaction(waiting.key, "done");
}

/** A finite number at least `least` (a roll from another player's screen is only data). */
const counted = (v, least = 0) => (Number.isFinite(Number(v)) ? Math.max(least, Number(v)) : null);

/**
 * A strike as the helper's rollStrike says it went, made sure of (it may come from another player's screen):
 * {attack: {degree, natural, total, dice}, damage: {byType} | null}, damage only on a hit; null if it says no degree.
 */
function strikeRolled(roll) {
  const degree = counted(roll?.attack?.degree);
  if ( degree === null ) return null;
  const out = { attack: { degree: Math.min(3, Math.round(degree)), natural: counted(roll.attack.natural), total: counted(roll.attack.total, -Infinity) }, damage: null };
  // (The system's own dice, for its rules to read (rules.asRolled: Daggerheart's Hope and Fear): numbers only.)
  const dice = roll.attack.dice && typeof roll.attack.dice === "object"
    ? Object.fromEntries(Object.entries(roll.attack.dice).filter(([, v]) => Number.isFinite(v))) : null;
  if ( dice && Object.keys(dice).length ) out.attack.dice = dice;
  const byType = roll.damage?.byType && typeof roll.damage.byType === "object"
    ? Object.fromEntries(Object.entries(roll.damage.byType).map(([k, v]) => [String(k), counted(v)]).filter(([, v]) => v !== null)) : null;
  if ( out.attack.degree >= 2 && byType && Object.keys(byType).length ) out.damage = { byType };
  return out;
}

/**
 * Is a creature's roll made for the GMs' eyes only? One the GM marked "Keep its name secret": the system's cards
 * would name it. (Otherwise in the chat's own mode: where a system hides names by nameplate, PF2e, its cards do.)
 */
const secretRoll = doc => !!doc?.actor?.getFlag?.(MODULE_ID, "secretName");

/**
 * A reaction's strike rolled with the system's own roller, its cards in the chat: on its player's screen where a player
 * runs it and is here (else on this one). Its damage, a player's at a creature FastFighting runs, goes as players'
 * damage does: as rolled with Apply players' damage on (or where the system applies it); else a GM says how much.
 * Returns {attack: {degree, natural, total}, damage: {byType} | null}, or null (the engine rolls it).
 */
async function systemRoll({ unitId, byId, strike }) {
  const adapter = getAdapter();
  const doc = docOf(unitId);
  const target = byId ? docOf(byId) : null;
  if ( !offers(adapter, "rollStrike") || !doc || !strike ) return null;
  const run = battle.run;
  const player = run.live.players.has(unitId);
  let roll = null;
  if ( player ) {
    for ( const user of game.users.filter(u => !u.isGM && u.active && doc.actor?.testUserPermission(u, "OWNER")) ) {
      try {
        roll = await user.query(QUERIES.liveRoll, { token: doc.uuid, target: target?.uuid ?? null, strike }, { timeout: ASK_MS });
      } catch ( err ) {
        roll = null; // (gone, or too slow: rolled here)
      }
      if ( roll ) break;
    }
  }
  if ( !roll ) {
    try {
      roll = await adapter.rollStrike(doc, { action: strike, target, attackNumber: 0, secret: secretRoll(doc) });
    } catch ( err ) {
      console.error(`${MODULE_ID} | rolling a reaction`, err);
      roll = null;
    }
  }
  const out = strikeRolled(roll);
  if ( !out?.damage ) return out;
  const byType = out.damage.byType;
  // (A player's blow at a creature FastFighting runs: players' damage, as the battle has it.)
  const t = byId ? run.byId.get(byId) : null;
  let multiplier = 1;
  if ( player && t && !run.live.players.has(t.id) && !battle.data.applyDamage && !systemApplies(adapter) ) {
    const amount = Object.values(byType).reduce((s, v) => s + v, 0);
    multiplier = await askDamage(run.byId.get(unitId)?.spec.name ?? "", t.spec.name, amount);
  }
  out.damage = { byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.floor(v * multiplier)])) };
  return out;
}

/** A GM's say on a player's reaction's damage: Apply (1), Half (0.5), Double (2) or Dismiss (0). */
async function askDamage(by, target, amount) {
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("FASTFIGHTING.Battle.DamageWaiting") },
    content: `<p>${escape(fmt("FASTFIGHTING.Battle.DamageLine", { by, target, amount }))}</p>`,
    buttons: [
      { action: "1", label: loc("FASTFIGHTING.Battle.DamageApply"), default: true },
      { action: "0.5", label: loc("FASTFIGHTING.Battle.DamageHalf") },
      { action: "2", label: loc("FASTFIGHTING.Battle.DamageDouble") },
      { action: "0", label: loc("FASTFIGHTING.Battle.DamageDismiss") }
    ],
    rejectClose: false
  });
  const n = Number(choice);
  return Number.isFinite(n) ? n : 1;
}

/**
 * Asked by a GM's browser: roll this with the system's own roller, here (a player's own character): a reaction's strike,
 * or (`kind`) a save or a check in a turn FastFighting plays (checkOptions' options, the other token by its uuid).
 */
async function answerRoll(data, { user } = {}) {
  if ( !user?.isGM || typeof data?.token !== "string" ) return null;
  const doc = await fromUuid(data.token);
  if ( !doc?.isOwner ) return null;
  const target = typeof data.target === "string" ? await fromUuid(data.target) : null;
  const adapter = getAdapter();
  if ( data.kind === "save" || data.kind === "check" ) {
    const how = data.kind === "save" ? "rollSave" : "rollCheck";
    if ( !offers(adapter, how) ) return null;
    return (await adapter[how](doc, { ...checkOptions(data.kind, data.options ?? {}, target) })) ?? null;
  }
  return (await adapter?.rollStrike?.(doc, { action: data.strike, target, attackNumber: 0 })) ?? null;
}

/** What the helper's rollSave or rollCheck hears of a request: the save's or the check's own, the other token. */
function checkOptions(kind, request, other) {
  const action = { id: request.action?.id ?? null, name: request.action?.name ?? "" };
  return kind === "save"
    ? { save: request.save ?? null, dc: request.dc, action, from: other ?? null }
    : { purpose: request.purpose ?? null, skill: request.skill ?? null, against: request.against ?? null, attackNumber: Number.isInteger(request.attackNumber) ? request.attackNumber : null, dc: request.dc, action, target: other ?? null };
}

/**
 * A save or a check in a turn FastFighting plays, rolled with the system's own roller (the helper's rollSave or
 * rollCheck), its card in the chat: on its player's screen where a player's character makes it and they're here, else
 * here. One the helper says its code can't roll ({gm: true}), a GM settles (gmSettles). {degree, natural, total,
 * dice}, or null (the engine's dice).
 */
async function rollTurnCheck(request) {
  const adapter = getAdapter();
  const kind = request.roll;
  const how = kind === "save" ? "rollSave" : "rollCheck";
  const doc = docOf(request.unitId);
  const other = request.targetId ? docOf(request.targetId) : null;
  if ( !doc || !offers(adapter, how) ) return null;
  const options = checkOptions(kind, request, other);
  let raw = null;
  if ( battle.run.live.players.has(request.unitId) ) {
    const data = { kind, token: doc.uuid, target: other?.uuid ?? null, options: { ...options, from: null, target: null } };
    for ( const user of game.users.filter(u => !u.isGM && u.active && doc.actor?.testUserPermission(u, "OWNER")) ) {
      try {
        raw = await user.query(QUERIES.liveRoll, data, { timeout: ASK_MS });
      } catch ( err ) {
        raw = null; // (gone, or too slow: rolled here)
      }
      if ( raw ) break;
    }
  }
  raw ??= await adapter[how](doc, { ...options, secret: secretRoll(doc) });
  if ( raw?.gm ) return gmSettles(request);
  return checkRolled(raw);
}

/** A save or a check as the helper says it went, made sure of: {degree, natural, total, dice}, or null (no degree). */
function checkRolled(roll) {
  const degree = counted(roll?.degree);
  if ( degree === null ) return null;
  const out = { degree: Math.min(3, Math.round(degree)), natural: counted(roll.natural), total: counted(roll.total, -Infinity) };
  const dice = roll.dice && typeof roll.dice === "object" ? Object.fromEntries(Object.entries(roll.dice).filter(([, v]) => Number.isFinite(v))) : null;
  if ( dice && Object.keys(dice).length ) out.dice = dice;
  return out;
}

/**
 * A save or a check the system's helper can't roll (it said so: {gm: true}), settled by a GM: how it went, a critical
 * success to a critical failure, or the engine rolls it. {degree} or null.
 */
async function gmSettles(request) {
  const who = battle.run.byId.get(request.unitId)?.spec.name ?? "";
  const what = request.action?.name || request.skill || request.purpose || "";
  const line = request.roll === "save"
    ? fmt("FASTFIGHTING.Battle.GmRoll.Save", { who, save: request.save ?? "", what, dc: request.dc })
    : fmt("FASTFIGHTING.Battle.GmRoll.Check", { who, what, dc: request.dc });
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("FASTFIGHTING.Battle.GmRoll.Title") },
    content: `<p>${escape(line)}</p>`,
    buttons: [
      ...[3, 2, 1, 0].map(n => ({ action: String(n), label: loc(`FASTFIGHTING.Battle.Degree.${n}`) })),
      { action: "engine", label: loc("FASTFIGHTING.Battle.GmRoll.Engine"), default: true }
    ],
    rejectClose: false
  });
  const n = Number(choice);
  return choice !== "engine" && Number.isInteger(n) && n >= 0 && n <= 3 ? { degree: n } : null;
}

/**
 * Should someone use a reaction? A player's is asked of its player (any of its owners who's here); with none here, or
 * no answer in time, of the GM. An NPC's (when the GM wants to be asked), of the GM. True to use it.
 */
async function ask(request) {
  const run = battle.run;
  const name = id => (id ? run.byId.get(id)?.spec.name ?? "" : "");
  const words = {
    creature: name(request.unitId), reaction: request.reaction, reactionId: request.reactionId, trigger: request.trigger,
    by: name(request.byId), ally: name(request.allyId), would: request.would
  };
  if ( request.player ) {
    const actor = docOf(request.unitId)?.actor;
    const owners = game.users.filter(u => !u.isGM && u.active && actor?.testUserPermission(u, "OWNER"));
    if ( owners.length ) {
      // (The first of them to answer; none in time, or none still here, and it's the GM's call.)
      const late = new Promise((resolve, reject) => setTimeout(() => reject(new Error("late")), ASK_MS));
      try {
        return await Promise.any(owners.map(u => Promise.race([u.query(QUERIES.liveAsk, { words }, { timeout: ASK_MS }), late]).then(a => {
          if ( typeof a !== "boolean" ) throw new Error("no answer");
          return a;
        })));
      } catch ( err ) {
        // (Asked the GM instead.)
      }
    }
  }
  return askHere(words);
}

/** The question, in this client's language, and its answer (true: use it). */
async function askHere(words) {
  const trigger = game.i18n.has(`FASTFIGHTING.Live.Trigger.${words.trigger}`)
    ? fmt(`FASTFIGHTING.Live.Trigger.${words.trigger}`, { by: words.by, ally: words.ally })
    : words.trigger;
  const reaction = words.reaction || (words.reactionId === "opportunity" ? loc("FASTFIGHTING.Live.Opportunity") : words.reactionId);
  const question = fmt("FASTFIGHTING.Live.Ask", { creature: words.creature, reaction, trigger });
  const thinks = loc(words.would ? "FASTFIGHTING.Live.Would" : "FASTFIGHTING.Live.WouldNot");
  return !!(await foundry.applications.api.DialogV2.confirm({
    window: { title: loc("FASTFIGHTING.Live.AskTitle") },
    content: `<p>${escape(question)}</p><p class="hint">${escape(thinks)}</p>`
  }));
}

/** A GM's question about a player's reaction, on that player's screen (Foundry says who asks: only a GM may). */
function answerAsk(data, { user } = {}) {
  if ( !user?.isGM || !data?.words ) return null;
  return askHere(data.words);
}

/* -------------------------------------------- */
/*  A turn a player plays                       */
/* -------------------------------------------- */

/**
 * Whether a card counts as a player's character's: made by a GM or by one who owns it (anyone can name any speaker on
 * a card, so another player's card at its turn isn't its doing).
 */
function madeFor(message, pcId) {
  const author = message.author;
  return !!author && (author.isGM || !!docOf(pcId)?.actor?.testUserPermission(author, "OWNER"));
}

/** What a player's turn left in the chat, as it's made (not FastFighting's own cards). */
function onMessage(message) {
  if ( !battle?.pc || !playsHere() || message.getFlag(MODULE_ID, "story") || message.getFlag(MODULE_ID, "live") ) return;
  const pc = battle.pc;
  if ( !madeFor(message, pc.id) ) return;
  pc.messages.push(message.id);
  // (A ranged attack or a manipulate action in a foe's reach, where the system's opportunity strikes answer it: PF2e.)
  if ( getAdapter().liveOpening?.(message, pc.id) ) queue(() => openingTaken(pc, message));
  // (A damage card at a creature FastFighting runs: applied at once, or put before a GM.)
  if ( offers(getAdapter(), "damageCard") ) queue(() => playerDamage(pc, message));
}

/**
 * "Daggerheart's Automation applies players' damage itself ...": the system's or a module's own setting that does, while
 * it's on, in the GM's words (for the toggles it greys out); else null.
 */
export function systemAppliesText(adapter = getAdapter()) {
  let name = null;
  try {
    name = adapter?.appliesPlayerDamage?.() ?? null;
  } catch ( err ) {
    console.warn(`${MODULE_ID} | asking whether the system applies damage`, err);
  }
  return name ? fmt("FASTFIGHTING.Live.SystemApplies", { name }) : null;
}

/** Does the system (or a module) apply players' damage itself? Then FastFighting applies none. */
const systemApplies = adapter => {
  try {
    return !!adapter.appliesPlayerDamage?.();
  } catch ( err ) {
    return false;
  }
};

/**
 * A player's damage card in their turn, at creatures FastFighting runs (not another player's character): applied at
 * once through the system (the battle's Apply players' damage), or put before the GMs in the Battle Vantage (a save to
 * roll first, several targets or none, or the toggle off). Nothing while the system, or a module, applies it itself.
 */
async function playerDamage(pc, message) {
  if ( battle?.pc !== pc ) return;
  const adapter = getAdapter();
  if ( systemApplies(adapter) ) return;
  const run = battle.run;
  let card = null;
  try {
    card = adapter.damageCard(message, { ids: Object.fromEntries(run.units.map(u => [tokenIdOf(u), u.id])) }) ?? null;
  } catch ( err ) {
    console.error(`${MODULE_ID} | reading a damage card`, err);
  }
  if ( !card || !(card.amount > 0) ) return;
  // (Each card's damage once: a card the system updates again, its damage rerolled, isn't applied twice.)
  if ( pc.dealt?.includes(message.id) ) return;
  pc.dealt = [...(pc.dealt ?? []), message.id];
  const targets = card.targets ?? [];
  const ours = targets.map(t => run.units.find(u => tokenIdOf(u) === t)).filter(u => u && !playerRuns(run, u));
  // (At another player's character alone: theirs to apply.)
  if ( targets.length && !ours.length ) return;
  const healing = card.kind === "healing";
  if ( battle.data.applyDamage && !card.save && !healing && ours.length === 1 && targets.length === 1 ) {
    await applyDamage(pc, message, ours[0], 1);
    return;
  }
  const by = run.byId.get(pc.id)?.spec.name ?? "";
  const lines = [];
  for ( const u of ours.length ? ours : [null] ) {
    // (Its hit points as the card came: a GM who applies it some other way, the card's own button, clears its line.)
    lines.push({ key: foundry.utils.randomID(), messageId: message.id, targetId: u?.id ?? null, amount: card.amount, save: !!card.save, healing, by, hpAt: u ? await hpOf(u) : null });
  }
  pc.damage = [...(pc.damage ?? []), ...lines];
  changed();
  ui.notifications.info(fmt("FASTFIGHTING.Live.DamageWaits", { name: by }));
  Hooks.callAll("fastFighting.damageWaits", battle);
}

/** A creature's hit points on its sheet now (null where it can't be read). */
async function hpOf(u) {
  const doc = docOf(u.id);
  if ( !doc ) return null;
  try {
    const hp = (await getAdapter().readLiveState(doc, { spec: battle.spec, unit: u }))?.hp;
    return Number.isFinite(hp) ? hp : null;
  } catch ( err ) {
    return null;
  }
}

/** FastFighting applying players' damage itself, now (what it changes is no GM's doing). */
let applying = 0;

/**
 * A creature with players' damage waiting on a GM was hurt (or healed) some other way, a GM using the card's own
 * button: the oldest line for it goes, so it isn't applied a second time.
 */
async function dropApplied(pc, actor) {
  if ( battle?.pc !== pc || !pc.damage?.length ) return;
  for ( const line of pc.damage ) {
    const u = line.targetId ? battle.run.byId.get(line.targetId) : null;
    if ( !u || docOf(u.id)?.actor !== actor || line.hpAt === null ) continue;
    const hp = await hpOf(u);
    if ( hp === null || (line.healing ? hp <= line.hpAt : hp >= line.hpAt) ) continue;
    pc.damage = pc.damage.filter(d => d !== line);
    await keep();
    return;
  }
}

/** A damage card applied to a creature (times `multiplier`), through the system: kept with the turn, for Rewind. */
async function applyDamage(pc, message, u, multiplier = 1) {
  const doc = docOf(u.id);
  if ( !doc || !message ) return false;
  let records;
  applying++;
  try {
    records = (await getAdapter().applyDamageCard(message, doc, { multiplier })) ?? [];
    pc.records.push(...records);
    await markFallen(pc, u);
  } catch ( err ) {
    console.error(`${MODULE_ID} | applying a damage card`, err);
    ui.notifications.error(fmt("FASTFIGHTING.Live.Failed", { error: err.message }));
    return false;
  } finally {
    applying--;
  }
  await keep();
  return true;
}

/**
 * A creature a player's blow has left at 0 hit points that the system left standing: down or dead as the battle's
 * rules have it, marked on its sheet at once, so the players see it. Worked out on a copy of the fight: the turn's own
 * reading, at its end, still finds the blow.
 */
async function markFallen(pc, u) {
  const s = (await readStates())[u.id];
  if ( !s || !Number.isFinite(s.hp) || s.hp > 0 ) return;
  const copy = restoreRun(battle.spec, battle.rules, snapshotRun(battle.run, { log: false }));
  syncFromSheets(copy, { [u.id]: s });
  const before = captureAll(copy);
  if ( !liveDrop(copy, u.id) ) return;
  await writeChanges(before, captureAll(copy), pc.records);
}

/**
 * A GM's answer to players' damage waiting in the Battle Vantage: applied (times `multiplier`, to `targetId`, picked
 * where the card had none) or dismissed. True if it was taken.
 */
export function answerDamage(key, { multiplier = 1, targetId = null, dismiss = false } = {}) {
  return queue(async () => {
    const pc = battle?.pc;
    const line = pc?.damage?.find(d => d.key === key);
    if ( !line ) return false;
    pc.damage = pc.damage.filter(d => d !== line);
    const u = battle.run.byId.get(targetId ?? line.targetId);
    if ( !dismiss && u ) await applyDamage(pc, game.messages.get(line.messageId), u, multiplier);
    changed();
    return true;
  });
}

/** The battle's Apply players' damage, from now on (the Battle Vantage's toggle). */
export async function setApplyDamage(on) {
  if ( !battle ) return;
  battle.data.applyDamage = !!on;
  await keep();
}

/** A player's character lowered its guard in a foe's reach: each foe that can strikes (asked of the GM, or as reckoned). */
async function openingTaken(pc, message = null) {
  if ( battle?.pc !== pc ) return;
  const run = battle.run;
  for ( const { reactorId, strike } of openingFor(run, pc.id) ) {
    const use = run.live.npcReactions === "ask"
      ? await ask({ unitId: reactorId, player: false, reactionId: "opportunity", reaction: strike.name, trigger: "foeOpening", byId: pc.id, would: true })
      : true;
    if ( !use ) continue;
    const before = captureAll(run);
    await rollFirst(run, reactorId, pc.id, strike);
    const events = reactNow(run, reactorId, pc.id, strike, "foeOpening");
    await writeChanges(before, captureAll(run), pc.records);
    // (A blow that disrupts what the character was doing, as the system has it: PF2e's critical Reactive Strike.)
    const crit = events.some(e => e.type === "attack" && e.actorId === reactorId && e.degree === 3);
    if ( crit && message && getAdapter().disruptsAction?.(message) ) await tellStop(pc.id, fmt("FASTFIGHTING.Live.Disrupted", { name: run.byId.get(pc.id)?.spec.name ?? "", by: run.byId.get(reactorId)?.spec.name ?? "" }));
  }
  await keep();
}

/** A foe's strike at a player's character in its turn, rolled with the system's own roller first, where it can. */
async function rollFirst(run, reactorId, targetId, strike) {
  if ( !rollsKind(run.live, "strike") ) return;
  const roll = await systemRoll({ unitId: reactorId, byId: targetId, strike: { id: strike.id, name: strike.name } });
  if ( roll ) run.live.forced = { unitId: reactorId, targetId, ...roll };
}

/** A word to a player's character's players and the GMs: its move stopped, or its action disrupted. */
async function tellStop(pcId, text) {
  const actor = docOf(pcId)?.actor;
  const whisper = [...new Set([...gmIds(), ...game.users.filter(u => !u.isGM && actor?.testUserPermission(u, "OWNER")).map(u => u.id)])];
  const ChatMessage = chatMessages();
  const card = await ChatMessage.create({
    content: inertHtml(`<div class="fast-fighting-live"><p>${escape(text)}</p></div>`), speaker: chronicle(), whisper,
    flags: { [MODULE_ID]: { live: { battle: battle.data.id } } }
  });
  if ( card && battle.pc ) battle.pc.messages = battle.pc.messages.filter(id => id !== card.id);
}

/**
 * The player's turn is over: what the system's roll cards say happened (the helper's readTurn), and what the sheets
 * show that no card explains (harm done, someone fallen) put down to the player; then told, and felt.
 */
async function closePlayerTurn() {
  const pc = battle.pc;
  battle.pc = null;
  const run = battle.run;
  const adapter = getAdapter();
  const messages = pc.messages.map(id => game.messages.get(id)).filter(Boolean);
  const ids = Object.fromEntries(run.units.map(u => [tokenIdOf(u), u.id]));
  // (By actor too, for a card that names only the actor: the first of its tokens.)
  const actors = {};
  for ( const u of run.units ) if ( u.spec.actorId && !(u.spec.actorId in actors) ) actors[u.spec.actorId] = u.id;
  let events = [];
  try {
    events = adapter.readTurn?.(messages, { actorId: run.byId.get(pc.id)?.spec.actorId ?? null, tokenId: pc.id, ids, actors }) ?? [];
  } catch ( err ) {
    console.error(`${MODULE_ID} | reading ${pc.id}'s turn`, err);
  }
  const states = await readStates();
  // (A spotlight's hand-off alone, nothing to tell or look at: kept aside.)
  const handoffs = events.filter(e => e.type === "handoff");
  events = reconcile(run, pc.id, events.filter(e => e.type !== "handoff"), states);
  // (Something it couldn't be sure of: the GM looks first. The battle waits.)
  if ( events.some(e => e.sure === false) ) events = await review(pc, events);
  events.push(...handoffs);
  syncPools(adapter);
  const result = pcTurnEnd(run, pc.id, events, states, pc.facts ?? []);
  // (What the engine itself made of the turn, past what the sheets say: a death burst, written.)
  const records = pc.records ?? [];
  // (What the turn changed by hand, the player's or a GM's: moves, hit points, resources, items, effects. First, so a
  // Rewind puts it back last: every sheet as the turn began.)
  const before = sheetsAt.get(pc);
  sheetsAt.delete(pc);
  if ( before ) records.unshift(...sheetUndo(before));
  await writeChanges(result.synced, captureAll(run), records);
  // (With what it was read from, the player's own cards: the tracker taken back to it, it's theirs again.)
  const turn = {
    key: `${pc.round}.${pc.combatantId}`, combatantId: pc.combatantId, round: pc.round, at: battle.combat.turns.findIndex(c => c.id === pc.combatantId), kind: "pc", records, messages: [], moves: [], doors: [], snapshot: pc.snapshot,
    from: pc.from, cards: pc.messages, facts: pc.facts ?? []
  };
  turn.messages.push(...await tellNew());
  await settleTurn(turn, result.ended);
}

/**
 * What the cards say, against what the sheets show: the harm a creature really took (its sheet's loss) is shared among
 * the blows read at it; blows read at no one (a system whose cards name no target, Ironsworn's) are at the one creature
 * whose loss nothing else explains, when there's just one; a creature that lost hit points no card explains took it
 * from the player, as far as anyone can tell (the GM looks); a heal, as much as the sheet shows.
 */
export function reconcile(run, pcId, events, states) {
  const lost = id => {
    const u = run.byId.get(id);
    const s = states[id];
    return u && Number.isFinite(s?.hp) ? Math.max(0, u.hp - s.hp) : 0;
  };
  const out = events.map(e => ({ ...e }));
  const hitsAt = new Map();
  for ( const e of out ) if ( ["attack", "save", "auto"].includes(e.type) && e.targetId ) (hitsAt.get(e.targetId) ?? hitsAt.set(e.targetId, []).get(e.targetId)).push(e);
  const aimless = out.filter(e => ["attack", "save"].includes(e.type) && !e.targetId);
  if ( aimless.length ) {
    const unexplained = Object.keys(states).filter(id => id !== pcId && !hitsAt.has(id) && lost(id) > 0);
    if ( unexplained.length === 1 ) {
      const [id] = unexplained;
      for ( const e of aimless ) {
        e.targetId = id;
        if ( e.aimless ) e.sure = true; // (unsure only of whom it was at)
        // (A hit's harm, as much as the sheet shows, shared below.)
        if ( (e.degree ?? 2) >= 2 && !(e.damage > 0) ) e.damage = 1;
      }
      hitsAt.set(id, aimless);
    }
  }
  for ( const [id, list] of hitsAt ) {
    const real = lost(id);
    const read = list.reduce((sum, e) => sum + (e.damage > 0 ? e.damage : 0), 0);
    if ( !read ) continue;
    // (Shared as the rolls had it; what's left over by rounding, on the last.)
    let left = real;
    list.filter(e => e.damage > 0).forEach((e, i, hits) => {
      e.damage = i === hits.length - 1 ? left : Math.min(left, Math.round(real * e.damage / read));
      left -= e.damage;
    });
  }
  for ( const id of Object.keys(states) ) {
    if ( id === pcId || hitsAt.has(id) ) continue;
    const real = lost(id);
    if ( real > 0 ) out.push({ type: "auto", targetId: id, action: "", damage: real, sure: false });
  }
  for ( const e of out ) {
    if ( e.type !== "heal" || !e.targetId ) continue;
    const u = run.byId.get(e.targetId);
    const s = states[e.targetId];
    if ( u && Number.isFinite(s?.hp) ) e.amount = Math.max(0, s.hp - u.hp);
  }
  return out;
}

/**
 * The GM looks at a player's turn before it's told: what was read of it, each kept or dropped (and a talk's kind and how
 * well it went, set right). Resolves with the events to tell.
 */
function review(pc, events) {
  return new Promise(resolve => {
    battle.review = { id: pc.id, combatantId: pc.combatantId, events, resolve: chosen => {
      battle.review = null;
      changed();
      resolve(chosen);
    } };
    changed();
  });
}

/** The GM's review done: the events as the GM left them (Battle Vantage). */
export function finishReview(events) {
  battle?.review?.resolve(events);
}

/**
 * A player's token moved: a foe whose reach it left may strike as it goes. FastFighting asks the GM, unless the GM lets
 * it decide (then the foe strikes, as its tactics would). Then those it came beside answer (answerArrival). Done now,
 * on the sheets; told with the player's turn.
 */
async function playerMoved(doc) {
  const pc = battle?.pc;
  if ( !pc || pc.id !== doc.id || !doc.object ) return;
  const p = positionOf(doc.object);
  const to = { x: p.x, y: p.y };
  const run = battle.run;
  let answered = false;
  for ( const { reactorId, strike } of leavingReach(run, pc.id, to) ) {
    const use = run.live.npcReactions === "ask"
      ? await ask({ unitId: reactorId, player: false, reactionId: "opportunity", reaction: strike.name, trigger: "leaveReach", byId: pc.id, would: true })
      : true;
    if ( !use ) continue;
    const before = captureAll(run);
    await rollFirst(run, reactorId, pc.id, strike);
    reactNow(run, reactorId, pc.id, strike);
    await writeChanges(before, captureAll(run), pc.records);
    answered = true;
  }
  // (Stopped by it, knocked down, laid prone or held fast: the move goes no further. The token goes back where the move
  // began, and its players are told why.)
  const u = run.byId.get(pc.id);
  const why = !u ? null : !isStanding(u) ? "down" : u.prone ? "prone" : !canMove(run, u) ? "held" : null;
  if ( answered && why && pc.lastAt ) {
    await doc.update({ x: pc.lastAt.x, y: pc.lastAt.y }, { animate: false });
    await tellStop(pc.id, fmt("FASTFIGHTING.Live.MoveStopped", { name: u.spec.name, why: loc(`FASTFIGHTING.Live.Stopped.${why}`) }));
    await keep();
    return;
  }
  // (Where it is now, as the engine has it: the next move is from here. Kept only when someone answered it: otherwise
  // the token itself says where it is, should the battle be picked up again.)
  const from = u?.pos ? { x: u.pos.x, y: u.pos.y } : null;
  syncFromSheets(run, { [pc.id]: { position: to } });
  pc.lastAt = { x: doc.x, y: doc.y };
  if ( await answerArrival(pc, from) ) answered = true;
  if ( answered ) await keep();
}

/**
 * Those a player's character came beside, moving (its token, `from` where the engine had it): a foe whose reach it
 * came into, a friend it stopped beside, where they have a reaction for it (engine/live.js movedBeside). Played as a
 * turn FastFighting plays them is, anyone to be asked asked and the system's rolls rolled (turnRoll: a strike, its
 * damage applied, a save); done now, on the sheets and the map, told with the player's turn. True if anyone answered.
 */
async function answerArrival(pc, from) {
  if ( (!battle.run.movers && !battle.run.reachers) || !from ) return false;
  const before = captureAll(battle.run);
  const snapshot = snapshotRun(battle.run, { log: false });
  const nonce = freshNonce();
  const stage = turnStage();
  const answers = [];
  let events = [];
  for ( let tries = 0; ; tries++ ) {
    try {
      events = movedBeside(battle.run, pc.id, from, { answers, nonce });
      break;
    } catch ( err ) {
      if ( !(err instanceof NeedsDecision) || tries > 50 ) throw err;
      const request = err.request;
      const answer = request.roll ? await turnRoll(request, battle.run.log.slice(battle.run.live.turnFrom ?? battle.run.log.length), stage) : await answerFor(request);
      answers.push([request.key, answer]);
      battle.run = restoreRun(battle.spec, battle.rules, snapshot, { log: battle.run.log });
    }
  }
  // (What the system's own rolls applied, its undo records, the player's turn's.)
  pc.records.push(...stage.records);
  if ( !events.length ) return stage.records.length > 0;
  await writeChanges(before, captureAll(battle.run), pc.records);
  const rest = events.slice(stage.played);
  await playMoves(rest, stageDocs(stage), setting("playOnMap") ? stageGrid(stage) : null, stage.doorsOpened, battle.scene, { instant: !setting("playOnMap") });
  return true;
}

/**
 * Creatures summoned since (the engine's, with no token yet): placed beside their summoner by the helper, and on the
 * tracker right after it, to take their own turns (a player's character's, the player's to run). Undo records added to
 * `records`. (One whose time runs out goes as one that ran: its token hidden, its turns passed over.)
 */
async function placeSummons(records) {
  const run = battle.run;
  const fresh = run.units.filter(s => s.summoner && !s.tokenId && !s.vanished && s.status !== STATUS.DEAD);
  if ( !fresh.length ) return;
  const adapter = getAdapter();
  const groups = new Map();
  for ( const s of fresh ) {
    const key = `${s.summoner}|${s.summonedBy}|${s.joinedRound}`;
    (groups.get(key) ?? groups.set(key, []).get(key)).push(s);
  }
  for ( const list of groups.values() ) {
    const summoner = run.byId.get(list[0].summoner);
    const doc = summoner ? docOf(summoner.id) : null;
    const action = summoner?.prep.summonActions?.find(a => a.id === list[0].summonedBy);
    if ( !doc || !action ) continue;
    let placed;
    try {
      placed = await adapter.placeSummons(battle.scene, doc, action, list.map(s => s.spec), spotsFor(doc, list, battle.scene));
    } catch ( err ) {
      console.error(`${MODULE_ID} | placing what ${doc.name} summoned`, err);
      continue;
    }
    records.push(...(placed?.records ?? []));
    const tokens = placed?.tokens ?? [];
    tokens.forEach((t, i) => { if ( list[i] ) list[i].tokenId = t.id; });
    if ( !tokens.length ) continue;
    // (Right after the summoner on the tracker; a spotlight system's, when the GM gives it the spotlight.)
    const after = battle.combat.combatants.find(c => c.tokenId === doc.id)?.initiative;
    const created = await battle.combat.createEmbeddedDocuments("Combatant", tokens.map((t, i) => ({
      tokenId: t.id, sceneId: battle.scene.id, actorId: t.actorId, initiative: battle.data.spotlight || !Number.isFinite(after) ? null : after - 0.01 * (i + 1)
    })));
    records.push({ createdCombatants: created.map(c => c.uuid) });
    if ( run.live.players.has(summoner.id) ) for ( const s of list ) addPlayer(s.id);
  }
}

/** What the engine changed between two captures of everyone, onto the sheets; their undo records added to `records`. */
async function writeChanges(before, after, records) {
  const adapter = getAdapter();
  // (Where a buff or debuff came from: the action that laid it, and whose, for the helper to put its effect on the sheet.)
  let sources = null;
  const effectSource = id => {
    sources ??= new Map(battle.run.units.flatMap(u => (u.spec.actions ?? []).map(action => [action.id, { action, spec: u.spec }])));
    return sources.get(id) ?? null;
  };
  for ( const [id, ch] of Object.entries(diffAll(before, after)) ) {
    const doc = docOf(id);
    if ( !doc ) continue;
    try {
      const spec = { ...battle.run.byId.get(id).spec, resources: before[id].resources };
      const record = await adapter.commitChanges(doc, spec, ch, after[id], {
        ...writeOptions(), before: before[id], effectSource
      });
      if ( record ) records.push(record);
      // (Won over, talked out of the fight, turned on the party: its token shows it, whatever its system wrote.)
      const side = ch.side ? sideAfter(after[id]) : null;
      const disposition = side ? CONST.TOKEN_DISPOSITIONS[{ friendly: "FRIENDLY", hostile: "HOSTILE", neutral: "NEUTRAL" }[side]] : undefined;
      if ( disposition !== undefined && doc.disposition !== disposition ) {
        records.push({ ...undoRecord(doc, doc.actor, { statusesBefore: false }), tokenUpdate: { disposition: doc.disposition } });
        await doc.update({ disposition });
      }
      // (Tied up this turn: marked on the sheet, the system's way.)
      if ( ch.bound !== undefined ) {
        const marked = await adapter.commitBound(doc, ch.bound);
        if ( marked ) records.push(marked);
      }
      for ( const c of ch.concessions ?? [] ) {
        if ( c.kept || !adapter.commitConcession ) continue;
        const to = c.to ? docOf(c.to) : null;
        // (The giver's side, for what it shares: Ironsworn's Supply.)
        const giver = battle.run.byId.get(id);
        const allies = battle.run.units.filter(u => u !== giver && u.side === giver.side).map(u => docOf(u.id)).filter(Boolean);
        records.push(...((await adapter.commitConcession(doc, to ?? null, c, { giver: spec, receiver: to ? battle.run.byId.get(c.to)?.spec : null, allies })) ?? []));
      }
    } catch ( err ) {
      console.error(`${MODULE_ID} | writing ${doc.name}'s changes`, err);
    }
  }
}

/* -------------------------------------------- */
/*  Telling                                     */
/* -------------------------------------------- */

/**
 * Is a creature's name kept from the players in the story? Not a player's own; not one whose nameplate shows to
 * everyone (Always, Hover). One the GM marked "Keep its name secret" (its FastFighting tab) always is. Where the system
 * lets nameplates decide (namesFollowNameplates: PF2e's own setting), any other is, as the system's cards have it;
 * elsewhere, until a player's character has seen it this fight (`u.partySaw`: noteSeen).
 */
function nameHidden(doc, u = null, byNameplate = nameplatesDecide()) {
  if ( !doc || doc.actor?.hasPlayerOwner ) return false;
  if ( doc.actor?.getFlag(MODULE_ID, "secretName") ) return true;
  const modes = CONST.TOKEN_DISPLAY_MODES;
  if ( [modes.ALWAYS, modes.HOVER].includes(doc.displayName) ) return false;
  return byNameplate || !u?.partySaw;
}

/** Does the system let token nameplates decide whether players learn an NPC's name? */
function nameplatesDecide() {
  try {
    return !!getAdapter()?.namesFollowNameplates?.();
  } catch ( err ) {
    return false;
  }
}

/**
 * Each creature a player's character has seen this fight, marked (`partySaw`): one in its sight (not hidden), or one
 * it came to blows or words with. Named in the story from then on (nameHidden). Kept on the creature, so a Rewind takes
 * it back with the turn.
 */
function noteSeen(run) {
  const party = new Set(run.units.filter(p => p.spec.kind === "pc" || run.live.players.has(p.id) || docOf(p.id)?.actor?.hasPlayerOwner));
  if ( !party.size ) return;
  const met = new Set();
  for ( const e of run.log ) {
    const a = run.byId.get(e.actorId);
    const t = run.byId.get(e.targetId);
    if ( a && t && (party.has(a) || party.has(t)) ) met.add(a.id).add(t.id);
  }
  for ( const u of run.units ) {
    if ( u.partySaw || party.has(u) ) continue;
    const hidden = u.spec.hidden && !u.revealed;
    if ( met.has(u.id) || (!hidden && [...party].some(p => isStanding(p) && perceives(run, p, u))) ) u.partySaw = true;
  }
}

/**
 * Initiative rolled for these combatants, with no system roll dialog (PF2e opens one): those whose names the players
 * can't read on the map, for the GMs' eyes, as Foundry rolls a hidden combatant's (the card names it).
 */
async function rollFor(combat, ids) {
  const all = ids.map(id => combat.combatants.get(id)).filter(Boolean);
  const secret = all.filter(c => nameHidden(c.token)).map(c => c.id);
  const open = all.filter(c => !nameHidden(c.token)).map(c => c.id);
  if ( open.length ) await combat.rollInitiative(open, { skipDialog: true });
  if ( secret.length ) await combat.rollInitiative(secret, { skipDialog: true, messageMode: "gm" });
}

/** A beat of the story, by the turns it tells (or the closing). */
const beatKey = beat => (beat.closing ? "closing" : beat.turns.join(","));

/**
 * The creatures whose names the players can't read on the map (no player's, its nameplate shown only to its owners, or
 * on hover to them, or to none), each as someone, numbered (as the player survey has it), the same number all battle
 * long: unit id -> what the open story calls it. One that shares its name with a creature whose name shows keeps it.
 */
function unnamed(run, docs) {
  const hidden = [];
  const known = new Set();
  const byNameplate = nameplatesDecide();
  for ( const u of run.units ) {
    const doc = docs.get(u.id);
    if ( !doc ) continue;
    if ( nameHidden(doc, u, byNameplate) ) hidden.push(u);
    else known.add(u.spec.name);
  }
  const numbers = (battle.data.someone ??= {});
  const out = new Map();
  for ( const u of hidden ) {
    if ( known.has(u.spec.name) ) continue;
    numbers[u.id] ??= Object.keys(numbers).length + 1;
    out.set(u.id, game.i18n.format("FASTFIGHTING.Desire.Unknown", { n: numbers[u.id] }));
  }
  return out;
}

/** The fight as the open story tells it: the unnamed called as someone (unnamed), in its spec and its log. */
export function namedAs(result, spec, someone) {
  const names = new Map();
  for ( const c of spec.combatants ?? [] ) if ( someone.has(c.id) ) names.set(c.name, someone.get(c.id));
  const call = v => (typeof v === "string" ? names.get(v) ?? v : Array.isArray(v) ? v.map(call) : v && typeof v === "object" ? swap(v) : v);
  const swap = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, call(v)]));
  return [
    { ...result, log: result.log.map(swap) },
    { ...spec, combatants: (spec.combatants ?? []).map(c => (someone.has(c.id) ? { ...c, name: someone.get(c.id), generic: false } : c)) }
  ];
}

/** The cards for every turn not told yet (the story told over the whole log, so it reads as one). Returns their ids. */
async function tellNew() {
  const run = battle.run;
  const result = { log: run.log, units: Object.fromEntries(Object.entries(captureAll(run)).map(([id, final]) => [id, { final }])) };
  const told = battle.data.told ?? 0;
  const out = [];
  const style = battle.data.style;
  if ( style === "statistician" ) {
    const lines = run.log.filter(e => (e.turn ?? 0) > told).map(e => logLine(e)).filter(Boolean);
    if ( lines.length ) {
      const html = `<ul>${lines.map(l => `<li>${escape(l)}</li>`).join("")}</ul>`;
      const message = await postStory({ title: storyTitle(battle.scene), html }, null, { gmOnly: true });
      if ( message ) out.push(message.id);
    }
  } else {
    const adapter = getAdapter();
    const open = setting("storyMode") !== "whisper";
    const options = {
      tables: await loadStoryTables(), seed: battle.data.seed, damageType: adapter?.rules?.storyDamageType?.bind(adapter.rules) ?? null,
      conditionType: adapter?.rules?.storyCondition?.bind(adapter.rules) ?? null, open
    };
    const beats = storyBeats(result, battle.spec, style, options);
    const docs = new Map(run.units.map(u => [u.id, docOf(u.id)]).filter(([, d]) => d));
    // (Told openly: one whose name the players haven't learned, as someone. The GMs' cards keep its name.)
    if ( open ) noteSeen(run);
    const someone = open ? unnamed(run, docs) : null;
    if ( someone?.size ) {
      const told = new Map(storyBeats(...namedAs(result, battle.spec, someone), style, options).map(b => [beatKey(b), b]));
      for ( const beat of beats ) {
        beat.html = told.get(beatKey(beat))?.html ?? beat.html;
        if ( someone.has(beat.actorId) ) beat.anonymous = true;
      }
    }
    const done = new Set(battle.data.toldBeats ?? []);
    for ( const beat of beats ) {
      const key = beatKey(beat);
      if ( done.has(key) ) continue;
      done.add(key);
      if ( !beat.html && !beat.gmHtml ) continue;
      const messages = await postBeat(battle.scene, beat, docs, { odds: battle.data.odds });
      out.push(...messages.map(m => m.id));
      if ( messages.length && beat.closing && beat.html ) battle.data.closing = messages[0].id;
    }
    battle.data.toldBeats = [...done];
  }
  battle.data.told = Math.max(told, lastTurn(run.log));
  return out;
}

/** The battle over: who won, told; the GMs told it's over. (The combat stays for the GM to end.) */
async function finish() {
  const before = captureAll(battle.run);
  const told = battle.run.log.length;
  endLive(battle.run, { ended: true, settle: false });
  // (Those still on their way off the map are gone: written, and seen off, with the last turn.)
  const last = battle.data.turns.at(-1);
  const gone = battle.run.log.slice(told).filter(e => e.type === "offMap");
  if ( gone.length && last ) {
    await holdingPause(async () => {
      await writeChanges(before, captureAll(battle.run), last.records);
      await sendOff(gone, last);
    });
  }
  const messages = await tellNew();
  battle.data.ended = true;
  const ChatMessage = chatMessages();
  const card = await ChatMessage.create({
    content: inertHtml(`<div class="fast-fighting-live"><p>${escape(loc("FASTFIGHTING.Live.Over"))}</p>
      <button type="button" data-ff-live="aftermath" data-tooltip="${escape(loc("FASTFIGHTING.Live.AftermathHint"))}"><i class="fa-solid fa-hand-holding-medical"></i> ${loc("FASTFIGHTING.Live.Aftermath")}</button>
      <button type="button" data-ff-live="rewindAll"><i class="fa-solid fa-backward"></i> ${loc("FASTFIGHTING.MakeItSo.Undo")}</button></div>`),
    speaker: chronicle(), whisper: gmIds(), flags: { [MODULE_ID]: { live: { battle: battle.data.id, over: true } } }
  });
  if ( last ) last.messages.push(...messages, ...(card ? [card.id] : []));
  await keep();
  await battle.combat.setFlag(MODULE_ID, "live", flagOf(false));
}

/* -------------------------------------------- */
/*  The GM's buttons                            */
/* -------------------------------------------- */

/**
 * The aftermath, when the GM says (the battle over): the fallen settled, goods back with their owners, written onto the
 * sheets; the closing card told again with it. Rewound like a turn.
 */
export function settleBattle() {
  return queue(async () => {
    if ( !battle?.data.ended || battle.data.settled ) return false;
    const run = battle.run;
    const snapshot = snapshotRun(run, { log: false });
    const before = captureAll(run);
    liveAftermath(run);
    const after = captureAll(run);
    const turn = { key: "aftermath", kind: "aftermath", combatantId: null, round: battle.combat.round, records: [], messages: [], moves: [], doors: [], snapshot };
    await holdingPause(async () => {
      await writeChanges(before, after, turn.records);
      // (The closing card told at the end gives way to one with the aftermath.)
      if ( battle.data.closing ) await game.messages.get(battle.data.closing)?.delete();
      battle.data.toldBeats = (battle.data.toldBeats ?? []).filter(k => k !== "closing");
      turn.messages.push(...await tellNew());
    });
    keepTurn(turn);
    battle.data.settled = true;
    await keep();
    changed();
    return true;
  });
}

/** Next Turn: the tracker moves on to the next turn. */
export function continueBattle() {
  if ( !battle || battle.data.ended ) return null;
  return moveOn();
}

/**
 * Rewind (the Battle Vantage's, a card's): the tracker's Previous Turn, which the battle follows (followBack). At the
 * battle's first turn, in a battle over, or in a spotlight system, the last turn put back instead, the tracker on it.
 */
export function rewind() {
  if ( !battle ) return null;
  const combat = battle.combat;
  if ( battle.data.ended || battle.data.spotlight || (combat.round <= 1 && !combat.turn) ) return rewindTurn();
  return combat.previousTurn();
}

/** Put the last turn back: what it wrote, its cards and moves, and the run as it was before it; the tracker on it again. */
export function rewindTurn() {
  return queue(async () => {
    const turn = battle?.data.turns.at(-1);
    // (So far back, only the whole encounter can be rewound.)
    if ( !turn?.snapshot ) return false;
    // (A player's turn under way after it: what a foe's reaction wrote in it comes off first.)
    await revertOpenTurn();
    await holdingPause(() => revertEntry(battle.scene, turn));
    battle.run = playersNow(restoreRun(battle.spec, battle.rules, turn.snapshot, { log: battle.run.log }));
    battle.data.turns = battle.data.turns.slice(0, -1);
    battle.data.played = null;
    battle.data.offMap = [];
    battle.data.ended = false;
    battle.data.salt = (battle.data.salt ?? 0) + 1;
    battle.data.told = lastTurn(battle.run.log);
    battle.pc = null;
    if ( turn.kind === "aftermath" ) {
      // (Still over; the closing told again as it was before the aftermath.)
      battle.data.ended = true;
      battle.data.settled = false;
      battle.data.toldBeats = (battle.data.toldBeats ?? []).filter(k => k !== "closing");
      const told = await tellNew();
      battle.data.turns.at(-1)?.messages.push(...told);
      await keep();
      changed();
      return true;
    }
    // (The cards it told are gone: told again when it's played again.)
    const gone = new Set(battle.run.log.map(e => e.turn ?? 0));
    battle.data.toldBeats = (battle.data.toldBeats ?? []).filter(k => k === "closing" ? false : k.split(",").every(t => gone.has(Number(t))));
    const at = battle.combat.turns.findIndex(c => c.id === turn.combatantId);
    if ( at >= 0 ) await battle.combat.update({ round: turn.round, turn: at }, { turnEvents: false });
    await keep();
    await battle.combat.setFlag(MODULE_ID, "live", flagOf(true));
    const u = unitOf(battle.combat.combatant);
    if ( u && playerRuns(battle.run, u) ) await beginPlayerTurn(u, battle.combat.combatant);
    else if ( u ) await rewoundCard(u);
    changed();
    return true;
  });
}

/** The GMs' card after a rewind to a turn FastFighting plays: Play it (again, with fresh dice). */
async function rewoundCard(u) {
  const ChatMessage = chatMessages();
  return ChatMessage.create({
    content: inertHtml(`<div class="fast-fighting-live"><p>${escape(fmt("FASTFIGHTING.Live.Rewound", { name: u.spec.name }))}</p>
      <button type="button" data-ff-live="play"><i class="fa-solid fa-play"></i> ${loc("FASTFIGHTING.Live.Play")}</button></div>`),
    speaker: chronicle(), whisper: gmIds(), flags: { [MODULE_ID]: { live: { battle: battle.data.id, rewound: true } } }
  });
}

/** Put the whole battle back: every turn, last first, and the run as it began. */
export function rewindEncounter() {
  return queue(async () => {
    if ( !battle ) return false;
    // (A player's turn still open: what it changed, by hand and by FastFighting, first.)
    await revertOpenTurn();
    for ( const turn of [...battle.data.turns].reverse() ) await holdingPause(() => revertEntry(battle.scene, turn));
    // (What the GM changed before the first turn.)
    if ( battle.data.gmRecords?.length ) await holdingPause(() => revertEntry(battle.scene, { records: battle.data.gmRecords }));
    const combat = battle.combat;
    // (Its opening cards, and the combat as it was: not started, the initiative it rolled taken back, and those who
    // joined it on the way gone from it.)
    for ( const id of [...(battle.data.opening ?? []), ...(battle.data.rollCards ?? [])] ) await game.messages.get(id)?.delete();
    for ( const m of game.messages.filter(x => x.getFlag(MODULE_ID, "live")?.battle === battle.data.id) ) await m.delete();
    for ( const uuid of battle.data.joined ?? [] ) {
      try {
        await (await fromUuid(uuid))?.delete();
      } catch ( err ) {
        console.error(`${MODULE_ID} | taking back one who joined`, err);
      }
    }
    if ( battle.data.rolled?.length ) await combat.updateEmbeddedDocuments("Combatant", battle.data.rolled.filter(id => combat.combatants.has(id)).map(id => ({ _id: id, initiative: null })));
    if ( battle.data.startedCombat ) await combat.update({ round: 0, turn: null });
    await combat.unsetFlag(MODULE_ID, "live");
    await forget(combat.id);
    battle = null;
    changed();
    return true;
  });
}

/** Play the turn the tracker is on now (after a rewind, or when the GM wants FastFighting to take it). */
export function playCurrent() {
  return queue(async () => {
    if ( !battle ) return;
    battle.data.played = null;
    await turnBegins(battle.combat.combatant);
  });
}

/* -------------------------------------------- */
/*  What the GM says                            */
/* -------------------------------------------- */

/**
 * What the GM says came of the table's own rolls (engine/live.js applyFact's facts). In a player's turn, held for it
 * and told with it; otherwise a moment of its own, told at once. True if it was taken.
 */
export function liveFact(fact) {
  return queue(async () => {
    if ( !battle || battle.data.ended ) return false;
    if ( battle.pc ) {
      battle.pc.facts.push(fact);
      await keep();
      return true;
    }
    gmMoment(battle.run, fact.id);
    const ok = applyFact(battle.run, fact);
    if ( ok ) followCommand(battle.run);
    const messages = await tellNew();
    const last = battle.data.turns.at(-1);
    if ( last ) last.messages.push(...messages);
    await keep();
    return ok;
  });
}

/**
 * The GM changes a creature's conditions (the Battle Vantage): {op: "set", id, key, value, byId, rounds} (value 0
 * takes it off); {op: "relate", id, kind, byId, rounds, level}; {op: "unrelate", id, kind, byId}; {op: "affliction",
 * id, afflictionId, stage} (0 ends it). Done at once: in the
 * engine, and on the sheets for what the system's can show (through its helper: writeChanges); the rest the core keeps
 * (engine/live.js). Kept with the battle, and taken back with the turn it came after (a player's turn under way: with
 * that), or the whole encounter.
 */
export function liveCondition(op) {
  return queue(async () => {
    if ( !playsHere() || !battle.run.byId.has(op?.id) ) return false;
    const run = battle.run;
    const before = captureAll(run);
    const done = op.op === "set" ? setCondition(run, op.id, op)
      : op.op === "relate" ? setRelation(run, op.id, op)
        : op.op === "unrelate" ? clearRelation(run, op.id, op)
          : op.op === "affliction" ? setAffliction(run, op.id, op) : false;
    if ( !done ) return false;
    const records = battle.pc?.records ?? battle.data.turns.at(-1)?.records ?? (battle.data.gmRecords ??= []);
    await holdingPause(() => writeChanges(before, captureAll(run), records));
    await keep();
    return true;
  });
}

/**
 * The GM changes what a creature wants (the Battle Vantage's map of minds), at once: {op: "desire", id, kind, targetId,
 * level} holds a desire there (0 sets it aside; null hands it back to FastFighting); {op: "goal", id, kind, thingId,
 * level} a goal (engine/live.js setGoal); {op: "attitude", id, kind, byId, side, level} what it keeps toward others
 * outside its desires (setAttitude: a grudge, a truce, how far it's been talked round); {op: "side", id, side, group} another
 * side, or (taking no side) another friend group (setSide: what it wants, and everyone's toward it, worked out again);
 * {op: "role", id, slot, leadership} its place in its group's chain of command (setRole), "none" to take it out. Nothing goes on a sheet but the token's
 * disposition (the helper's, with the turn's changes); kept with the battle, and taken back with the turn it
 * came after.
 */
export function liveMind(op) {
  return queue(async () => {
    if ( !playsHere() || !battle.run.byId.has(op?.id) ) return false;
    const run = battle.run;
    const done = op.op === "desire"
      ? applyFact(run, op.level === null ? { kind: "forget", id: op.id, desire: op.kind, targetId: op.targetId } : { kind: "want", id: op.id, desire: op.kind, targetId: op.targetId, level: op.level })
      : op.op === "goal" ? setGoal(run, op.id, op)
        : op.op === "attitude" ? setAttitude(run, op.id, op)
          : op.op === "side" ? setSide(run, op.id, op.side, { group: op.group ?? null })
            : op.op === "role" ? setRole(run, op.id, op.slot, op.leadership ?? null) : false;
    if ( !done ) return false;
    await keep();
    return true;
  });
}

/** A token on the battle's map, not in the fight, brought into it: on the tracker, it joins (joinFight). */
export async function bringIntoFight(tokenId) {
  if ( !battle || !game.user.isGM ) return false;
  const doc = battle.scene.tokens.get(tokenId);
  if ( !doc || battle.combat.combatants.some(c => c.tokenId === tokenId) ) return false;
  await battle.combat.createEmbeddedDocuments("Combatant", [{ tokenId, sceneId: battle.scene.id, actorId: doc.actorId }]);
  return true;
}

/** A fact held for the player's turn, taken back before it's told. */
export function dropHeldFact(index) {
  if ( !battle?.pc?.facts?.[index] ) return;
  battle.pc.facts.splice(index, 1);
  changed();
}

/**
 * A player's character played by FastFighting from now on (`on`), or handed back to its player. In the middle of its
 * own turn: one not acted in yet, FastFighting plays at once; one the player has acted in is theirs to finish, and
 * FastFighting takes over from the next.
 */
export function setAutomated(id, on) {
  return queue(async () => {
    if ( !battle || !battle.run.byId.has(id) ) return false;
    const players = new Set(battle.data.players ?? []);
    if ( on ) players.delete(id);
    else players.add(id);
    battle.data.players = [...players];
    playersNow();
    const pc = battle.pc;
    if ( on && pc?.id === id && pc.snapshot && !pc.messages.length && !pc.records?.length && !pc.facts?.length ) {
      battle.run = playersNow(restoreRun(battle.spec, battle.rules, pc.snapshot, { log: battle.run.log }));
      battle.pc = null;
      battle.data.played = null;
      await keep();
      changed();
      await turnBegins(battle.combat.combatant);
      return true;
    }
    await keep();
    changed();
    return true;
  });
}

/** NPC reactions: as FastFighting calculates them ("calculated"), or asked each time ("ask"). */
export async function setNpcReactions(mode) {
  if ( !battle ) return;
  battle.run.live.npcReactions = mode === "ask" ? "ask" : "calculated";
  await keep();
}

/** Play to the end: the turns FastFighting plays go on without waiting for the GM's Continue. */
export async function setPlayThrough(on) {
  if ( !battle ) return;
  battle.data.auto = !!on;
  await keep();
  if ( on && battle.combat.combatant && battle.data.played === turnKey(battle.combat.combatant) ) continueBattle();
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/** A battle still live on a combat when the GM comes back: picked up where it was. */
async function pickUp() {
  if ( !game.user.isGM || battle ) return;
  for ( const combat of game.combats ) {
    const flag = combat.getFlag(MODULE_ID, "live");
    if ( !flag?.active ) continue;
    const data = await kept(combat.id);
    if ( !data?.snapshot || !runsHere(data) ) continue;
    data.user = game.user.id; // (its GM gone: this one plays it now)
    await combat.setFlag(MODULE_ID, "live", { ...flag, user: game.user.id });
    let spec;
    try {
      spec = unpackSpec(data.spec);
    } catch ( err ) {
      console.error(`${MODULE_ID} | a kept battle that won't read`, err);
      continue;
    }
    const rules = getAdapter()?.rules;
    if ( !rules ) return;
    // (Its scene: where it began, an encounter linked to no scene included.)
    const scene = game.scenes.get(data.sceneId) ?? combat.scene ?? canvas.scene;
    let run;
    try {
      // (Kept with its log apart: the snapshot given it back. Kept the old way, the log's in the snapshot.)
      run = restoreRun(spec, rules, Array.isArray(data.log) ? { ...data.snapshot, log: data.log } : data.snapshot);
      delete data.log;
    } catch ( err ) {
      // (A kept battle that won't restore: the GM told, the combat left as it is.)
      console.error(`${MODULE_ID} | a kept battle that won't restore`, err);
      ui.notifications.error(fmt("FASTFIGHTING.Live.Failed", { error: err.message }));
      continue;
    }
    battle = { combat, scene, spec, rules, run, pc: null, data, keptSpec: data.spec };
    // (Rolls made with the system's own roller, where this helper can, and a player's reaction by the player: a battle
    // begun before, too.)
    run.live.systemRolls = systemRollKinds(getAdapter());
    run.live.readsRolls = offers(getAdapter(), "readTurn");
    playersNow();
    if ( data.pc ) {
      const own = m => m.getFlag(MODULE_ID, "story") || m.getFlag(MODULE_ID, "live");
      battle.pc = { ...data.pc, messages: game.messages.filter(m => m.timestamp >= data.pc.from && !own(m) && madeFor(m, data.pc.id)).map(m => m.id) };
      // (Where its token is now: a move with nothing to answer isn't kept.)
      const token = docOf(data.pc.id)?.object;
      if ( token ) {
        const p = positionOf(token);
        syncFromSheets(battle.run, { [data.pc.id]: { position: { x: p.x, y: p.y } } });
      }
    }
    ui.notifications.info(loc("FASTFIGHTING.Live.PickedUp"));
    return;
  }
}

export function registerLiveBattles() {
  CONFIG.queries[QUERIES.liveAsk] = answerAsk;
  CONFIG.queries[QUERIES.liveRoll] = answerRoll;
  CONFIG.queries[QUERIES.liveReactionDone] = answerReactionDone;
  Hooks.on("combatTurnChange", onTurnChange);
  Hooks.on("updateToken", (doc, changes) => {
    if ( !battle?.pc || doc.id !== battle.pc.id || !("x" in changes || "y" in changes) || !playsHere() ) return;
    queue(() => playerMoved(doc));
  });
  Hooks.on("createChatMessage", onMessage);
  // (Players' damage waiting on a GM, applied some other way: its line goes.)
  Hooks.on("updateActor", actor => {
    const pc = battle?.pc;
    if ( pc && playsHere() ) noteSheet(actor);
    if ( !pc?.damage?.length || applying || !playsHere() ) return;
    queue(() => dropApplied(pc, actor));
  });
  // (A card the system fills in after it's made: Daggerheart adds an attack's damage to its card.)
  Hooks.on("updateChatMessage", message => {
    const pc = battle?.pc;
    if ( !pc || !playsHere() || !pc.messages.includes(message.id) || !offers(getAdapter(), "damageCard") ) return;
    queue(() => playerDamage(pc, message));
  });
  Hooks.on("createCombatant", (combatant, options, userId) => {
    if ( battle?.combat !== combatant.parent || battle.data.ended || !playsHere() ) return;
    // (One a player added: only for a creature of their own, as a summoning of theirs would be.)
    const user = game.users.get(userId);
    if ( !user?.isGM && !combatant.token?.actor?.testUserPermission(user, "OWNER") ) {
      (battle.untrusted ??= new Set()).add(combatant.id);
      return;
    }
    queue(() => joinFight(combatant));
  });
  Hooks.once("ready", () => pickUp());
  // (Its GM left: the active GM picks it up.)
  Hooks.on("userConnected", () => {
    if ( !battle ) pickUp();
  });
  // (Another GM rewound it, began another, or picked it up while this one was away: this browser lets go of the one it
  // held, and takes up one that's its own now.)
  // (Foundry's own Begin Encounter, a battle prepared on it: the battle begins with it.)
  Hooks.on("updateCombat", combat => {
    if ( battle?.combat === combat && battle.data.prepared && combat.started && playsHere() ) beginEncounter();
  });
  Hooks.on("updateCombat", (combat, changes) => {
    if ( !foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) ) return;
    if ( battle?.combat === combat && !stillHere() ) {
      battle = null;
      changed();
    }
    if ( !battle ) pickUp();
  });
  Hooks.on("deleteCombat", combat => {
    if ( battle?.combat === combat ) {
      battle = null;
      changed();
    }
    if ( game.user.isActiveGM ) forget(combat.id);
  });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    for ( const button of html.querySelectorAll?.("[data-ff-live]") ?? [] ) {
      const live = message.getFlag(MODULE_ID, "live");
      // (A player's reaction card: its button theirs too, the GM playing the battle told by a query.)
      if ( button.dataset.ffLive === "reactionDone" && live?.reaction && message.author?.isGM ) {
        // (A player's browser has no battle in it: the character by its token's uuid.)
        const actor = typeof live.pcToken === "string" ? fromUuidSync(live.pcToken)?.actor ?? null : null;
        if ( !game.user.isGM && !actor?.testUserPermission(game.user, "OWNER") ) {
          button.remove();
          continue;
        }
        button.addEventListener("click", async event => {
          event.preventDefault();
          button.disabled = true;
          if ( endReaction(live.reaction, "done") ) return;
          const gm = game.users.get(message.author.id)?.active ? game.users.get(message.author.id) : game.users.activeGM;
          await gm?.query(QUERIES.liveReactionDone, { key: live.reaction }).catch(() => null);
        });
        continue;
      }
      if ( !game.user.isGM || !message.author?.isGM || !live ) {
        button.remove();
        continue;
      }
      button.addEventListener("click", async event => {
        event.preventDefault();
        // (Only the battle in this GM's hands, and only its own cards: an old card does nothing.)
        if ( live.battle !== battle?.data.id ) return ui.notifications.warn(loc("FASTFIGHTING.Live.NotHere"));
        button.disabled = true;
        const what = button.dataset.ffLive;
        if ( what === "continue" ) await continueBattle();
        else if ( what === "rewind" ) await rewind();
        else if ( what === "play" ) await playCurrent();
        else if ( what === "aftermath" ) await settleBattle();
        else if ( what === "rewindAll" ) {
          const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: loc("FASTFIGHTING.MakeItSo.UndoTitle") }, content: `<p>${escape(loc("FASTFIGHTING.Live.RewindAllConfirm"))}</p>`
          });
          if ( ok ) await rewindEncounter();
          else button.disabled = false;
        }
      });
    }
  });
}

