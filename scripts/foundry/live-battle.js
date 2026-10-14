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
import { MODULE_ID, STATUS } from "../constants.js";
import { escapeHtml as escape, inertHtml } from "../i18n.js";
import { getAdapter } from "../api.js";
import { setting } from "../settings.js";
import { positionOf } from "./terrain.js";
import { approachFor } from "./battle.js";
import { currentPathGrid, pathGridFor } from "./pathing.js";
import { getSetup } from "./persistence.js";
import {
  holdingPause, playMoves, postBeat, postStory, revertEntry, gmIds, chronicle, storyTitle, packSpec, unpackSpec, placeOf
} from "./make-it-so.js";
import { storyBeats } from "../story/story.js";
import { logLine } from "../story/log-lines.js";
import { loadStoryTables } from "../story/tables.js";
import {
  beginLive, liveRound, liveTurn, pcTurn, syncFromSheets, setApproach, captureAll, snapshotRun, restoreRun, endLive, NeedsDecision
} from "../engine/live.js";
import { diffAll } from "../engine/changes.js";
import { randomSeed } from "../engine/rng.js";

const loc = key => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
/** How many turns back Rewind Turn reaches (each keeps the run as it was before it). */
const REWIND_DEPTH = 12;

/** The battle in this GM's hands: {combat, scene, spec, rules, run, data (what's kept), busy, pc (a player's turn going)}. */
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

/* -------------------------------------------- */
/*  Keeping it                                  */
/* -------------------------------------------- */

/** The journal entry that keeps live battles: GMs only (minds, plans and dice are spoilers). */
async function store() {
  const found = game.journal.find(j => j.getFlag(MODULE_ID, "liveStore"));
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
  battle.data.snapshot = snapshotRun(battle.run);
  const doc = await store();
  // (The battle's own key replaced whole, the store's other keys left as they are.)
  await doc.update({ [`flags.${MODULE_ID}.battles.==${battle.combat.id}`]: battle.data });
}

async function kept(combatId) {
  return (await store())?.getFlag(MODULE_ID, `battles.${combatId}`) ?? null;
}

async function forget(combatId) {
  const doc = await store();
  await doc?.update({ [`flags.${MODULE_ID}.battles.-=${combatId}`]: null });
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
  const combat = game.combats.find(c => c.scene?.id === scene.id && c === (ui.combat?.viewed ?? c)) ?? game.combats.find(c => c.scene?.id === scene.id);
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
  // (Rolled straight away: no system's roll dialog for each one. Rewind This Encounter takes them back.)
  const unrolled = combat.combatants.filter(c => c.initiative === null).map(c => c.id);
  if ( unrolled.length ) await combat.rollInitiative(unrolled, { skipDialog: true });
  const started = !combat.started;
  if ( started ) await combat.startCombat();
  const order = combat.turns.map(c => c.tokenId);
  const seed = randomSeed();
  const live = { ...spec, options: { ...spec.options, initiativeOrder: order } };
  const adapter = getAdapter();
  const run = beginLive(live, adapter.rules, { seed, players, owns: adapter.liveOwnership?.() ?? {}, npcReactions: "calculated" });
  liveRound(run, combat.round || 1);
  battle = {
    combat, scene, spec: live, rules: adapter.rules, run, busy: null, pc: null,
    data: {
      id: foundry.utils.randomID(), user: game.user.id, spec: packSpec(live), seed, style, odds, players, told: 0, turns: [], first: snapshotRun(run),
      ended: false, played: null, opening: [], rolled: unrolled, startedCombat: started
    }
  };
  await combat.setFlag(MODULE_ID, "live", { id: battle.data.id, active: true });
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

/** The tracker moved on: the turn that ended is closed (a player's, read and told), and the next begins. */
function onTurnChange(combat, prior, current) {
  if ( !battle || battle.combat !== combat || battle.data.ended || !runsHere(battle.data) ) return;
  queue(async () => {
    if ( battle.pc && battle.pc.combatantId !== combat.combatant?.id ) await closePlayerTurn();
    if ( combat.round > (battle.run.round ?? 0) ) await newRound(combat.round);
    await turnBegins(combat.combatant);
  });
}

/** Out of the fight for good: no turn to play. */
const GONE = new Set([STATUS.DEAD, STATUS.FLED, STATUS.SURRENDERED, STATUS.STOOD_DOWN, STATUS.BEATEN]);

/** The unit a combatant is (by its token). */
const unitOf = combatant => (combatant ? battle.run.byId.get(combatant.tokenId) ?? null : null);

async function turnBegins(combatant) {
  const u = unitOf(combatant);
  if ( !u || battle.data.ended ) return;
  const key = `${battle.combat.round}.${combatant.id}`;
  if ( battle.data.played === key ) return; // (played already: waiting on the GM)
  if ( GONE.has(u.status) ) {
    battle.data.played = key;
    await battle.combat.nextTurn();
    return;
  }
  if ( battle.run.live.players.has(u.id) ) {
    battle.pc = { combatantId: combatant.id, id: u.id, round: battle.combat.round, messages: [], from: Date.now() };
    // (The players' turn: the game goes on, so they can move and roll.)
    if ( game.paused ) game.togglePause(false, { broadcast: true });
    return;
  }
  await playTurn(u, combatant, key);
}

/** A new round: those not yet in the fight look around, and one that notices joins the tracker. */
async function newRound(round) {
  liveRound(battle.run, round);
  for ( const u of [...battle.run.order] ) {
    if ( u.active || u.status !== STATUS.STANDING || u.spec.hazard ) continue;
    liveTurn(battle.run, u.id);
    if ( u.active || u.joinsRound ) {
      const doc = battle.scene.tokens.get(u.spec.tokenId ?? u.id);
      if ( doc && !battle.combat.combatants.some(c => c.tokenId === doc.id) ) {
        const [c] = await battle.combat.createEmbeddedDocuments("Combatant", [{ tokenId: doc.id, sceneId: battle.scene.id, actorId: doc.actorId }]);
        if ( c ) await battle.combat.rollInitiative([c.id]);
      }
    }
  }
  await tellNew();
}

/* -------------------------------------------- */
/*  The sheets                                  */
/* -------------------------------------------- */

const docOf = id => battle.scene.tokens.get(battle.run.byId.get(id)?.spec.tokenId ?? id);

/** Every creature's sheet as it stands, with where its token is. */
async function readStates() {
  const adapter = getAdapter();
  const out = {};
  for ( const u of battle.run.units ) {
    const doc = docOf(u.id);
    if ( !doc ) continue;
    const state = (await adapter.readLiveState(doc)) ?? {};
    if ( doc.object ) {
      const p = positionOf(doc.object);
      state.position = { x: p.x, y: p.y };
    }
    out[u.id] = state;
  }
  return out;
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
  refreshApproach();
  const before = captureAll(battle.run);
  const snapshot = snapshotRun(battle.run, { log: false });
  const answers = [];
  let result;
  for ( let tries = 0; ; tries++ ) {
    try {
      result = liveTurn(battle.run, u.id, { answers, salt: battle.data.salt ?? 0 });
      break;
    } catch ( err ) {
      if ( !(err instanceof NeedsDecision) || tries > 20 ) throw err;
      answers.push([err.request.key, await ask(err.request)]);
      battle.run = restoreRun(battle.spec, battle.rules, snapshot, { log: battle.run.log });
    }
  }
  const after = captureAll(battle.run);
  const changes = diffAll(before, after);
  const turn = { key, combatantId: combatant.id, round: battle.combat.round, kind: "npc", records: [], messages: [], moves: [], doors: [], snapshot };
  await holdingPause(async () => {
    // Where everyone stood (for Rewind), then the moves and doors as the turn made them.
    turn.moves = battle.run.units.map(x => docOf(x.id)).filter(Boolean).map(doc => ({ uuid: doc.uuid, ...placeOf(doc) }));
    const docs = new Map(battle.run.units.map(x => [x.id, docOf(x.id)]).filter(([, d]) => d));
    const doorsOpened = new Map();
    if ( setting("playOnMap") ) {
      const grid = currentPathGrid() ?? pathGridFor([...docs.values()].map(d => d.object).filter(Boolean));
      await playMoves(result.events, docs, grid, doorsOpened, battle.scene);
    }
    turn.doors = [...doorsOpened.values()];
    // What the turn changed, onto the sheets (each written as it stood when the turn began).
    const options = { lootMode: setting("lootMode"), corpseMode: setting("corpseMode"), fledMode: setting("fledMode"), live: true };
    for ( const [id, ch] of Object.entries(changes) ) {
      const doc = docs.get(id);
      if ( !doc ) continue;
      const spec = { ...battle.run.byId.get(id).spec, resources: before[id].resources };
      try {
        const record = await adapter.commitChanges(doc, spec, ch, after[id], options);
        if ( record ) turn.records.push(record);
      } catch ( err ) {
        console.error(`${MODULE_ID} | writing ${doc.name}'s turn`, err);
      }
      for ( const c of ch.concessions ?? [] ) {
        if ( c.kept || !adapter.commitConcession ) continue;
        const to = docs.get(c.to);
        const records = (await adapter.commitConcession(doc, to ?? null, c, { giver: spec, receiver: to ? battle.run.byId.get(c.to)?.spec : null, allies: [] })) ?? [];
        turn.records.push(...records);
      }
    }
    turn.messages.push(...await tellNew());
  });
  battle.data.played = key;
  await settleTurn(turn, result.ended);
}

/** A turn done: kept for Rewind, the battle kept, and either the end or the GM's Continue. */
async function settleTurn(turn, ended) {
  battle.data.turns = [...battle.data.turns, turn].slice(-REWIND_DEPTH);
  if ( ended ) {
    await finish();
    return;
  }
  const card = await waitCard(turn);
  if ( card ) turn.messages.push(card.id);
  await keep();
}

/** The GMs' card after a turn FastFighting played: Continue (the tracker moves on) or Rewind Turn. */
async function waitCard(turn) {
  if ( turn.kind !== "npc" ) return null;
  const name = battle.run.byId.get(battle.combat.combatants.get(turn.combatantId)?.tokenId)?.spec.name ?? "";
  const ChatMessage = foundry.documents.ChatMessage ?? globalThis.ChatMessage;
  return ChatMessage.create({
    content: inertHtml(`<div class="fast-fighting-live"><p>${escape(fmt("FASTFIGHTING.Live.Told", { name }))}</p>
      <button type="button" data-ff-live="continue"><i class="fa-solid fa-forward"></i> ${loc("FASTFIGHTING.Live.Continue")}</button>
      <button type="button" data-ff-live="rewind"><i class="fa-solid fa-backward-step"></i> ${loc("FASTFIGHTING.Live.RewindTurn")}</button></div>`),
    speaker: chronicle(), whisper: gmIds(), flags: { [MODULE_ID]: { live: { battle: battle.data.id, turn: turn.key } } }
  });
}

/**
 * Should someone use a reaction? A player's (asked of the GM for now, on the player's behalf), or an NPC's when the
 * GM wants to be asked. True to use it.
 */
async function ask(request) {
  const run = battle.run;
  const name = id => (id ? run.byId.get(id)?.spec.name ?? "" : "");
  const trigger = game.i18n.has(`FASTFIGHTING.Live.Trigger.${request.trigger}`)
    ? fmt(`FASTFIGHTING.Live.Trigger.${request.trigger}`, { by: name(request.byId), ally: name(request.allyId) })
    : request.trigger;
  const reaction = request.reaction || (request.reactionId === "opportunity" ? loc("FASTFIGHTING.Live.Opportunity") : request.reactionId);
  const question = fmt("FASTFIGHTING.Live.Ask", { creature: name(request.unitId), reaction, trigger });
  const thinks = loc(request.would ? "FASTFIGHTING.Live.Would" : "FASTFIGHTING.Live.WouldNot");
  return !!(await foundry.applications.api.DialogV2.confirm({
    window: { title: loc("FASTFIGHTING.Live.AskTitle") },
    content: `<p>${escape(question)}</p><p class="hint">${escape(thinks)}</p>`
  }));
}

/* -------------------------------------------- */
/*  A turn a player plays                       */
/* -------------------------------------------- */

/** What a player's turn left in the chat, as it's made (not FastFighting's own cards). */
function onMessage(message) {
  if ( !battle?.pc || !runsHere(battle.data) || message.getFlag(MODULE_ID, "story") || message.getFlag(MODULE_ID, "live") ) return;
  battle.pc.messages.push(message.id);
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
  const ids = Object.fromEntries(run.units.map(u => [u.spec.tokenId ?? u.id, u.id]));
  let events = [];
  try {
    events = adapter.readTurn?.(messages, { actorId: run.byId.get(pc.id)?.spec.actorId ?? null, tokenId: pc.id, ids }) ?? [];
  } catch ( err ) {
    console.error(`${MODULE_ID} | reading ${pc.id}'s turn`, err);
  }
  const states = await readStates();
  // (Harm the cards don't account for: the player's, as far as anyone can tell.)
  const explained = new Set(events.filter(e => e.damage > 0).map(e => e.targetId));
  for ( const [id, s] of Object.entries(states) ) {
    const u = run.byId.get(id);
    if ( !u || id === pc.id || explained.has(id) || !Number.isFinite(s.hp) || s.hp >= u.hp ) continue;
    events.push({ type: "auto", targetId: id, action: "", damage: u.hp - s.hp, sure: false });
  }
  const snapshot = snapshotRun(run, { log: false });
  const result = pcTurn(run, pc.id, events, states);
  const turn = { key: `${pc.round}.${pc.combatantId}`, combatantId: pc.combatantId, round: pc.round, kind: "pc", records: [], messages: [], moves: [], doors: [], snapshot };
  turn.messages.push(...await tellNew());
  await settleTurn(turn, result.ended);
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
      if ( !beat.html ) continue;
      const message = await postBeat(battle.scene, beat, docs, { odds: battle.data.odds });
      if ( message ) out.push(message.id);
    }
    battle.data.toldBeats = [...done];
  }
  battle.data.told = Math.max(told, ...run.log.map(e => e.turn ?? 0));
  return out;
}

/** The battle over: who won, told; the GMs told it's over. (The combat stays for the GM to end.) */
async function finish() {
  endLive(battle.run, { ended: true, settle: false });
  const messages = await tellNew();
  battle.data.ended = true;
  const ChatMessage = foundry.documents.ChatMessage ?? globalThis.ChatMessage;
  const card = await ChatMessage.create({
    content: inertHtml(`<div class="fast-fighting-live"><p>${escape(loc("FASTFIGHTING.Live.Over"))}</p>
      <button type="button" data-ff-live="rewindAll"><i class="fa-solid fa-backward"></i> ${loc("FASTFIGHTING.MakeItSo.Undo")}</button></div>`),
    speaker: chronicle(), whisper: gmIds(), flags: { [MODULE_ID]: { live: { battle: battle.data.id, over: true } } }
  });
  const last = battle.data.turns.at(-1);
  if ( last ) last.messages.push(...messages, ...(card ? [card.id] : []));
  await keep();
  await battle.combat.setFlag(MODULE_ID, "live", { id: battle.data.id, active: false });
}

/* -------------------------------------------- */
/*  The GM's buttons                            */
/* -------------------------------------------- */

/** Continue: the tracker moves on to the next turn. */
export function continueBattle() {
  if ( !battle || battle.data.ended ) return null;
  return battle.combat.nextTurn();
}

/** Put the last turn back: what it wrote, its cards and moves, and the run as it was before it; the tracker on it again. */
export function rewindTurn() {
  return queue(async () => {
    const turn = battle?.data.turns.at(-1);
    if ( !turn ) return false;
    await holdingPause(() => revertEntry(battle.scene, turn));
    battle.run = restoreRun(battle.spec, battle.rules, turn.snapshot, { log: battle.run.log });
    battle.data.turns = battle.data.turns.slice(0, -1);
    battle.data.played = null;
    battle.data.ended = false;
    battle.data.salt = (battle.data.salt ?? 0) + 1;
    battle.data.told = Math.max(0, ...battle.run.log.map(e => e.turn ?? 0));
    battle.pc = null;
    // (The cards it told are gone: told again when it's played again.)
    const gone = new Set(battle.run.log.map(e => e.turn ?? 0));
    battle.data.toldBeats = (battle.data.toldBeats ?? []).filter(k => k === "closing" ? false : k.split(",").every(t => gone.has(Number(t))));
    const at = battle.combat.turns.findIndex(c => c.id === turn.combatantId);
    if ( at >= 0 ) await battle.combat.update({ round: turn.round, turn: at }, { turnEvents: false });
    await keep();
    await battle.combat.setFlag(MODULE_ID, "live", { id: battle.data.id, active: true });
    const u = unitOf(battle.combat.combatant);
    if ( u && battle.run.live.players.has(u.id) ) battle.pc = { combatantId: battle.combat.combatant.id, id: u.id, round: battle.combat.round, messages: [], from: Date.now() };
    else if ( u ) await rewoundCard(u);
    return true;
  });
}

/** The GMs' card after a rewind to a turn FastFighting plays: Play it (again, with fresh dice). */
async function rewoundCard(u) {
  const ChatMessage = foundry.documents.ChatMessage ?? globalThis.ChatMessage;
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
    const combat = battle.combat;
    // (Its opening cards, and the combat as it was: not started, the initiative it rolled taken back.)
    for ( const id of battle.data.opening ?? [] ) await game.messages.get(id)?.delete();
    if ( battle.data.rolled?.length ) await combat.updateEmbeddedDocuments("Combatant", battle.data.rolled.filter(id => combat.combatants.has(id)).map(id => ({ _id: id, initiative: null })));
    if ( battle.data.startedCombat ) await combat.update({ round: 0, turn: null });
    await combat.unsetFlag(MODULE_ID, "live");
    await forget(combat.id);
    battle = null;
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
    const spec = unpackSpec(data.spec);
    const rules = getAdapter()?.rules;
    if ( !rules ) return;
    battle = { combat, scene: combat.scene, spec, rules, run: restoreRun(spec, rules, data.snapshot), busy: null, pc: null, data };
    ui.notifications.info(loc("FASTFIGHTING.Live.PickedUp"));
    return;
  }
}

export function registerLiveBattles() {
  Hooks.on("combatTurnChange", onTurnChange);
  Hooks.on("createChatMessage", onMessage);
  Hooks.once("ready", () => pickUp());
  // (Its GM left: the active GM picks it up.)
  Hooks.on("userConnected", () => {
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
        else if ( what === "rewind" ) await rewindTurn();
        else if ( what === "play" ) await playCurrent();
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

