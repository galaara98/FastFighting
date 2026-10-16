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
import { approachFor } from "./battle.js";
import { currentPathGrid, pathGridFor, sceneWallGrid } from "./pathing.js";
import { getSetup, sceneEncounter } from "./persistence.js";
import { QUERIES } from "./tactics.js";
import {
  holdingPause, playMoves, postBeat, postStory, revertEntry, gmIds, chronicle, storyTitle, packSpec, unpackSpec, placeOf, spotsFor
} from "./make-it-so.js";
import { storyBeats } from "../story/story.js";
import { logLine } from "../story/log-lines.js";
import { loadStoryTables } from "../story/tables.js";
import {
  beginLive, liveRound, liveTurn, pcTurnBegin, pcTurnEnd, syncFromSheets, setApproach, captureAll, snapshotRun, restoreRun, endLive,
  NeedsDecision, applyFact, gmMoment, leavingReach, openingFor, reactNow, nextSpotlight, liveAftermath,
  setCondition, setRelation, clearRelation, setAffliction, setGoal, setAttitude, setSide, setRole, playerRuns
} from "../engine/live.js";
import { diffAll } from "../engine/changes.js";
import { randomSeed } from "../engine/rng.js";

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
 * The journal entry that keeps live battles: GMs only (minds, plans and dice are spoilers). Only one no player can see
 * is trusted: a player who could edit it could rewrite what a Rewind puts back, and a GM's client would do it.
 */
const trustedStore = j => !!j.getFlag(MODULE_ID, "liveStore") && !game.users.some(u => !u.isGM && j.testUserPermission(u, "LIMITED"));

async function store() {
  const found = game.journal.find(trustedStore);
  if ( found ) return found;
  const JournalEntry = foundry.documents.JournalEntry ?? globalThis.JournalEntry;
  return JournalEntry.create({
    name: loc("FASTFIGHTING.Live.Store"),
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    flags: { [MODULE_ID]: { liveStore: true } }
  });
}

async function keep() {
  if ( !battle ) return;
  changed();
  battle.data.snapshot = snapshotRun(battle.run);
  // (A player's turn under way: who, since when, what the GM said and what reactions wrote. Its cards are found again by time.)
  const pc = battle.pc;
  battle.data.pc = pc ? { combatantId: pc.combatantId, id: pc.id, round: pc.round, facts: pc.facts, records: pc.records, snapshot: pc.snapshot, from: pc.from } : null;
  const doc = await store();
  // (The battle's own key replaced whole, the store's other keys left as they are. Its spec, the biggest part, only
  // when it's changed: kept beside it.)
  const { spec, ...rest } = battle.data;
  const update = { [`flags.${MODULE_ID}.battles.==${battle.combat.id}`]: rest };
  if ( spec !== battle.keptSpec ) update[`flags.${MODULE_ID}.specs.==${battle.combat.id}`] = spec;
  await doc.update(update);
  battle.keptSpec = spec;
}

async function kept(combatId) {
  const doc = await store();
  const data = doc?.getFlag(MODULE_ID, `battles.${combatId}`);
  return data ? { ...data, spec: doc.getFlag(MODULE_ID, `specs.${combatId}`) } : null;
}

async function forget(combatId) {
  const doc = await store();
  await doc?.update({ [`flags.${MODULE_ID}.battles.-=${combatId}`]: null, [`flags.${MODULE_ID}.specs.-=${combatId}`]: null });
}

/* -------------------------------------------- */
/*  Starting                                    */
/* -------------------------------------------- */

/**
 * A live battle, from the planner's battle (its spec, built as for a simulation). The encounter's combat is started
 * (the NPCs' initiative rolled; the players' rolled for them where they haven't), and the tracker's order is the
 * fight's. `players`: ids of the characters the players run (none: FastFighting plays everyone).
 */
export async function startLiveBattle(spec, { style = setting("storyStyle"), odds = null, players = [] } = {}) {
  if ( !game.user.isGM ) return null;
  const scene = canvas.scene;
  // (The scene's encounter as the planner has it: the tracker's, linked to this scene or to none.)
  const combat = sceneEncounter(scene);
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
  // (Rolled straight away: no system's roll dialog for each one. Rewind This Encounter takes them back. A spotlight
  // system rolls none: whoever the GM spotlights acts.)
  const adapter = getAdapter();
  const spotlight = adapter.liveTurns === "spotlight";
  const unrolled = spotlight ? [] : combat.combatants.filter(c => c.initiative === null).map(c => c.id);
  const rolledFrom = Date.now();
  if ( unrolled.length ) await combat.rollInitiative(unrolled, { skipDialog: true });
  const rollCards = unrolled.length ? initiativeCards(rolledFrom) : [];
  const started = !combat.started;
  if ( started ) await combat.startCombat();
  if ( spotlight && combat.turn !== null ) await adapter.giveSpotlight(combat, null);
  const order = combat.turns.map(c => c.tokenId);
  const seed = randomSeed();
  const live = { ...spec, options: { ...spec.options, initiativeOrder: order } };
  const run = beginLive(live, adapter.rules, { seed, players, owns: adapter.liveOwnership?.() ?? {}, npcReactions: "calculated" });
  liveRound(run, combat.round || 1);
  battle = {
    combat, scene, spec: live, rules: adapter.rules, run, pc: null,
    data: {
      id: foundry.utils.randomID(), user: game.user.id, sceneId: scene.id, spec: packSpec(live), seed, style, odds, players, told: 0, turns: [],
      ended: false, played: null, opening: [], rolled: unrolled, rollCards, joined: [], startedCombat: started, spotlight, spots: 0
    }
  };
  await combat.setFlag(MODULE_ID, "live", flagOf(true));
  Hooks.callAll("fastFighting.liveBattleStarted", battle);
  await queue(async () => {
    battle.data.opening = await tellNew();
    await keep();
    await turnBegins(combat.combatant);
  });
  return battle;
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
  if ( battle?.combat !== combat || battle.data.ended || !playsHere() ) return;
  // (A spotlight system's tracker has no order to go back along: its Rewind is the battle's own.)
  const back = !battle.data.spotlight && !!prior && current?.round > 0 && prior.combatantId !== current.combatantId
    && (current.round < prior.round || (current.round === prior.round && (current.turn ?? -1) < (prior.turn ?? -1)));
  if ( back ) {
    queue(() => followBack(prior));
    return;
  }
  queue(async () => {
    if ( battle.pc && battle.pc.combatantId !== combat.combatant?.id ) await closePlayerTurn();
    if ( battle.data.spotlight ) await spotlightMoved(combat, prior);
    else if ( combat.round > (battle.run.round ?? 0) ) await newRound(combat.round);
    await turnBegins(combat.combatant);
  });
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
  if ( battle.pc?.records?.length ) await holdingPause(() => revertEntry(battle.scene, { records: battle.pc.records }));
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
    pcTurnBegin(battle.run, u.id);
    battle.pc = { combatantId: combatant.id, id: u.id, round: reopen.round, messages: reopen.cards ?? [], facts: reopen.facts ?? [], records: [], snapshot: reopen.snapshot, from: reopen.from };
  } else if ( own || (u && GONE.has(u.status)) ) battle.data.played = key;
  else if ( u && playerRuns(battle.run, u) ) await beginPlayerTurn(u, combatant);
  else if ( u ) await rewoundCard(u);
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
const tokenIdOf = u => u.tokenId ?? u.spec.tokenId ?? u.id;

/** The unit a combatant is (by its token). */
const unitOf = combatant => (combatant ? battle.run.units.find(u => tokenIdOf(u) === combatant.tokenId) ?? null : null);

async function turnBegins(combatant) {
  // (Someone on the tracker the battle doesn't know yet: a player's summons, one the GM brought in. It joins now.)
  const u = unitOf(combatant) ?? (combatant && !battle.data.ended ? await joinFight(combatant) : null);
  if ( !u || battle.data.ended ) return;
  const key = turnKey(combatant);
  if ( battle.data.played === key ) return; // (played already: waiting on the GM)
  if ( GONE.has(u.status) ) {
    battle.data.played = key;
    await moveOn();
    return;
  }
  if ( playerRuns(battle.run, u) ) {
    await beginPlayerTurn(u, combatant);
    // (The players' turn: the game goes on, so they can move and roll.)
    if ( game.paused ) game.togglePause(false, { broadcast: true });
    return;
  }
  await playTurn(u, combatant, key);
}

/**
 * A creature added to the battle's combat mid-fight that the battle doesn't know (a player's summons, one the GM brings
 * in): it joins, read like any other. Friendly, and come in a player's character's turn, it's that character's (its
 * side, the player's to run); otherwise its token's disposition says its side (one already in the fight, or it stays
 * out). Made part of the battle itself, so a turn kept before it came still has it when restored. Returns its unit.
 */
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
  pcTurnBegin(battle.run, u.id);
  battle.pc = { combatantId: combatant.id, id: u.id, round: battle.combat.round, messages: [], facts: [], records: [], snapshot, from: Date.now() };
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
          await battle.combat.rollInitiative([c.id], { skipDialog: true }); // (no system roll dialog: PF2e opens one)
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
    const state = (await adapter.readLiveState(doc, { spec: battle.spec, unit: u })) ?? {};
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

/** How everyone can reach everyone now they've moved. */
function refreshApproach() {
  const roster = battle.run.units.map(u => ({ token: docOf(u.id)?.object, spec: u.spec })).filter(e => e.token);
  setApproach(battle.run, approachFor(roster, getSetup()));
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
  let result;
  for ( let tries = 0; ; tries++ ) {
    try {
      battle.run.live.exitOf = exitOf; // (the way off the scene, for one leaving the fight)
      result = liveTurn(battle.run, u.id, { answers, salt: battle.data.salt ?? 0 });
      break;
    } catch ( err ) {
      if ( !(err instanceof NeedsDecision) || tries > 20 ) throw err;
      answers.push([err.request.key, await ask(err.request)]);
      battle.run = restoreRun(battle.spec, battle.rules, snapshot, { log: battle.run.log });
    }
  }
  const after = captureAll(battle.run);
  const turn = { key, combatantId: combatant.id, round: battle.combat.round, at: battle.combat.turn, kind: "npc", records: [], messages: [], moves: [], doors: [], snapshot };
  await holdingPause(async () => {
    // Where everyone stood (for Rewind), then the moves and doors as the turn made them.
    turn.moves = battle.run.units.map(x => docOf(x.id)).filter(Boolean).map(doc => ({ uuid: doc.uuid, ...placeOf(doc) }));
    const docs = new Map(battle.run.units.map(x => [x.id, docOf(x.id)]).filter(([, d]) => d));
    const doorsOpened = new Map();
    if ( setting("playOnMap") ) {
      const grid = currentPathGrid() ?? pathGridFor([...docs.values()].map(d => d.object).filter(Boolean));
      await playMoves(result.events, docs, grid, doorsOpened, battle.scene);
    } else await playMoves(result.events, docs, null, doorsOpened, battle.scene, { instant: true });
    turn.doors = [...doorsOpened.values()];
    // What it summoned, onto the scene and the tracker.
    await placeSummons(turn.records);
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

/** How long a player has to answer a question about their reaction (ms) before the GM is asked instead. */
const ASK_MS = 60000;

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
  if ( getAdapter().liveOpening?.(message, pc.id) ) queue(() => openingTaken(pc));
}

/** A player's character lowered its guard in a foe's reach: each foe that can strikes (asked of the GM, or as reckoned). */
async function openingTaken(pc) {
  if ( battle?.pc !== pc ) return;
  const run = battle.run;
  for ( const { reactorId, strike } of openingFor(run, pc.id) ) {
    const use = run.live.npcReactions === "ask"
      ? await ask({ unitId: reactorId, player: false, reactionId: "opportunity", reaction: strike.name, trigger: "foeOpening", byId: pc.id, would: true })
      : true;
    if ( !use ) continue;
    const before = captureAll(run);
    reactNow(run, reactorId, pc.id, strike, "foeOpening");
    await writeChanges(before, captureAll(run), pc.records);
  }
  await keep();
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
  for ( const [id, s] of Object.entries(states) ) {
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
 * it decide (then the foe strikes, as its tactics would). Done now, on the sheets; told with the player's turn.
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
    reactNow(run, reactorId, pc.id, strike);
    await writeChanges(before, captureAll(run), pc.records);
    answered = true;
  }
  // (Where it is now, as the engine has it: the next move is from here. Kept only when a foe answered it: otherwise
  // the token itself says where it is, should the battle be picked up again.)
  syncFromSheets(run, { [pc.id]: { position: to } });
  if ( answered ) await keep();
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
    const beats = storyBeats(result, battle.spec, style, {
      tables: await loadStoryTables(), seed: battle.data.seed, damageType: adapter?.rules?.storyDamageType?.bind(adapter.rules) ?? null,
      conditionType: adapter?.rules?.storyCondition?.bind(adapter.rules) ?? null
    });
    const docs = new Map(run.units.map(u => [u.id, docOf(u.id)]).filter(([, d]) => d));
    const done = new Set(battle.data.toldBeats ?? []);
    for ( const beat of beats ) {
      const key = beat.closing ? "closing" : beat.turns.join(",");
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
    if ( battle.pc?.records?.length ) await holdingPause(() => revertEntry(battle.scene, { records: battle.pc.records }));
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
    battle = { combat, scene, spec, rules, run: restoreRun(spec, rules, data.snapshot), pc: null, data, keptSpec: data.spec };
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
  Hooks.on("combatTurnChange", onTurnChange);
  Hooks.on("updateToken", (doc, changes) => {
    if ( !battle?.pc || doc.id !== battle.pc.id || !("x" in changes || "y" in changes) || !playsHere() ) return;
    queue(() => playerMoved(doc));
  });
  Hooks.on("createChatMessage", onMessage);
  Hooks.on("createCombatant", combatant => {
    if ( battle?.combat !== combatant.parent || battle.data.ended || !playsHere() ) return;
    queue(() => joinFight(combatant));
  });
  Hooks.once("ready", () => pickUp());
  // (Its GM left: the active GM picks it up.)
  Hooks.on("userConnected", () => {
    if ( !battle ) pickUp();
  });
  // (Another GM rewound it, began another, or picked it up while this one was away: this browser lets go of the one it
  // held, and takes up one that's its own now.)
  Hooks.on("updateCombat", (combat, changes) => {
    if ( !foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) ) return;
    if ( battle?.combat === combat && !stillHere() ) {
      battle = null;
      changed();
    }
    if ( !battle ) pickUp();
  });
  Hooks.on("deleteCombat", combat => {
    if ( battle?.combat === combat ) battle = null;
    if ( game.user.isActiveGM ) forget(combat.id);
  });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    for ( const button of html.querySelectorAll?.("[data-ff-live]") ?? [] ) {
      const live = message.getFlag(MODULE_ID, "live");
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

