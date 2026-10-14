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
import { positionOf } from "./terrain.js";
import { approachFor } from "./battle.js";
import { currentPathGrid, pathGridFor } from "./pathing.js";
import { getSetup, sceneEncounter } from "./persistence.js";
import { SOCKET } from "./tactics.js";
import {
  holdingPause, playMoves, postBeat, postStory, revertEntry, gmIds, chronicle, storyTitle, packSpec, unpackSpec, placeOf, spotsBeside
} from "./make-it-so.js";
import { storyBeats } from "../story/story.js";
import { logLine } from "../story/log-lines.js";
import { loadStoryTables } from "../story/tables.js";
import {
  beginLive, liveRound, liveTurn, pcTurnBegin, pcTurnEnd, syncFromSheets, setApproach, captureAll, snapshotRun, restoreRun, endLive,
  NeedsDecision, applyFact, gmMoment, leavingReach, openingFor, reactNow, nextSpotlight, liveAftermath
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

/** Something changed in the battle: whatever shows it draws it again. */
const changed = () => Hooks.callAll("fastFighting.liveBattle", battle);

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
  changed();
  battle.data.snapshot = snapshotRun(battle.run);
  // (A player's turn under way: who, since when, what the GM said and what reactions wrote. Its cards are found again by time.)
  const pc = battle.pc;
  battle.data.pc = pc ? { combatantId: pc.combatantId, id: pc.id, round: pc.round, facts: pc.facts, records: pc.records, snapshot: pc.snapshot, from: pc.from } : null;
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
  const rollCards = unrolled.length ? game.messages.filter(m => m.timestamp >= rolledFrom && m.getFlag("core", "initiativeRoll")).map(m => m.id) : [];
  const started = !combat.started;
  if ( started ) await combat.startCombat();
  if ( spotlight && combat.turn !== null ) await adapter.giveSpotlight(combat, null);
  const order = combat.turns.map(c => c.tokenId);
  const seed = randomSeed();
  const live = { ...spec, options: { ...spec.options, initiativeOrder: order } };
  const run = beginLive(live, adapter.rules, { seed, players, owns: adapter.liveOwnership?.() ?? {}, npcReactions: "calculated" });
  liveRound(run, combat.round || 1);
  battle = {
    combat, scene, spec: live, rules: adapter.rules, run, busy: null, pc: null,
    data: {
      id: foundry.utils.randomID(), user: game.user.id, sceneId: scene.id, spec: packSpec(live), seed, style, odds, players, told: 0, turns: [], first: snapshotRun(run),
      ended: false, played: null, opening: [], rolled: unrolled, rollCards, joined: [], startedCombat: started, spotlight, spots: 0
    }
  };
  await combat.setFlag(MODULE_ID, "live", { id: battle.data.id, active: true });
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

/** The tracker moved on: the turn that ended is closed (a player's, read and told), and the next begins. */
function onTurnChange(combat, prior, current) {
  if ( !battle || battle.combat !== combat || battle.data.ended || !runsHere(battle.data) ) return;
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
function moveOn() {
  if ( !battle.data.spotlight ) return battle.combat.nextTurn();
  if ( battle.data.auto && !battle.run.live.players.size ) return spotlightNext();
  return getAdapter().giveSpotlight(battle.combat, null);
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

/** Whether the turn the tracker is on has been played, and waits for the GM's Continue. */
export function waitingOnGm() {
  return !!battle?.combat.combatant && battle.data.played === turnKey(battle.combat.combatant);
}

/** Whom FastFighting would spotlight next, for the Battle Interface (a spotlight system's), or null. */
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
  if ( battle.run.live.players.has(u.id) ) {
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
          battle.data.rollCards = [...(battle.data.rollCards ?? []), ...game.messages.filter(m => m.timestamp >= from && m.getFlag("core", "initiativeRoll")).map(m => m.id)];
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
      result = liveTurn(battle.run, u.id, { answers, salt: battle.data.salt ?? 0 });
      break;
    } catch ( err ) {
      if ( !(err instanceof NeedsDecision) || tries > 20 ) throw err;
      answers.push([err.request.key, await ask(err.request)]);
      battle.run = restoreRun(battle.spec, battle.rules, snapshot, { log: battle.run.log });
    }
  }
  const after = captureAll(battle.run);
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
    // What it summoned, onto the scene and the tracker.
    await placeSummons(turn.records);
    // What the turn changed, onto the sheets (each written as it stood when the turn began).
    await writeChanges(before, after, turn.records);
    // (What the turn did to what the encounter keeps: Daggerheart's Fear.)
    try {
      const options = { lootMode: setting("lootMode"), corpseMode: setting("corpseMode"), fledMode: setting("fledMode"), live: true };
      turn.records.push(...((await adapter.commitTurn(before, after, { ...options, spec: battle.spec, events: result.events })) ?? []));
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

/** How long a player has to answer a question about their reaction (ms) before the GM is asked instead. */
const ASK_MS = 60000;
/** Questions put to players, waiting for their answers: id -> resolve. */
const asking = new Map();

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
    const owners = game.users.filter(u => !u.isGM && u.active && actor?.testUserPermission(u, "OWNER")).map(u => u.id);
    if ( owners.length ) {
      const id = foundry.utils.randomID();
      const answer = await new Promise(resolve => {
        asking.set(id, resolve);
        game.socket.emit(SOCKET, { action: "liveAsk", userIds: owners, id, words }, { recipients: owners });
        setTimeout(() => resolve(null), ASK_MS);
      });
      asking.delete(id);
      if ( answer !== null ) return answer;
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

/** The socket: a GM's question about a player's reaction, on that player's screen; the player's answer, back to the GM. */
function onSocket(data, senderId) {
  const sender = game.users.get(senderId);
  if ( data?.action === "liveAsk" && sender?.isGM && data.userIds?.includes(game.user.id) ) {
    askHere(data.words).then(answer => game.socket.emit(SOCKET, { action: "liveAnswer", id: data.id, answer }, { recipients: [senderId] }));
  } else if ( data?.action === "liveAnswer" && game.user.isGM ) {
    asking.get(data.id)?.(!!data.answer);
  }
}

/* -------------------------------------------- */
/*  A turn a player plays                       */
/* -------------------------------------------- */

/** What a player's turn left in the chat, as it's made (not FastFighting's own cards). */
function onMessage(message) {
  if ( !battle?.pc || !runsHere(battle.data) || message.getFlag(MODULE_ID, "story") || message.getFlag(MODULE_ID, "live") ) return;
  const pc = battle.pc;
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
  const turn = { key: `${pc.round}.${pc.combatantId}`, combatantId: pc.combatantId, round: pc.round, kind: "pc", records, messages: [], moves: [], doors: [], snapshot: pc.snapshot };
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

/** The GM's review done: the events as the GM left them (Battle Interface). */
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
  for ( const { reactorId, strike } of leavingReach(run, pc.id, to) ) {
    const use = run.live.npcReactions === "ask"
      ? await ask({ unitId: reactorId, player: false, reactionId: "opportunity", reaction: strike.name, trigger: "leaveReach", byId: pc.id, would: true })
      : true;
    if ( !use ) continue;
    const before = captureAll(run);
    reactNow(run, reactorId, pc.id, strike);
    await writeChanges(before, captureAll(run), pc.records);
  }
  // (Where it is now, as the engine has it: the next move is from here.)
  syncFromSheets(run, { [pc.id]: { position: to } });
  await keep();
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
      placed = await adapter.placeSummons(battle.scene, doc, action, list.map(s => s.spec), spotsBeside(doc, list.length, battle.scene));
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
  for ( const [id, ch] of Object.entries(diffAll(before, after)) ) {
    const doc = docOf(id);
    if ( !doc ) continue;
    try {
      const spec = { ...battle.run.byId.get(id).spec, resources: before[id].resources };
      const record = await adapter.commitChanges(doc, spec, ch, after[id], {
        live: true, before: before[id], fledMode: setting("fledMode"), lootMode: setting("lootMode"), corpseMode: setting("corpseMode")
      });
      if ( record ) records.push(record);
      for ( const c of ch.concessions ?? [] ) {
        if ( c.kept || !adapter.commitConcession ) continue;
        const to = c.to ? docOf(c.to) : null;
        records.push(...((await adapter.commitConcession(doc, to ?? null, c, { giver: spec, receiver: to ? battle.run.byId.get(c.to)?.spec : null, allies: [] })) ?? []));
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
      if ( !beat.html ) continue;
      const message = await postBeat(battle.scene, beat, docs, { odds: battle.data.odds });
      if ( message ) out.push(message.id);
      if ( message && beat.closing ) battle.data.closing = message.id;
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
      <button type="button" data-ff-live="aftermath" data-tooltip="${escape(loc("FASTFIGHTING.Live.AftermathHint"))}"><i class="fa-solid fa-hand-holding-medical"></i> ${loc("FASTFIGHTING.Live.Aftermath")}</button>
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

/** Continue: the tracker moves on to the next turn. */
export function continueBattle() {
  if ( !battle || battle.data.ended ) return null;
  return moveOn();
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
    battle.data.ended = false;
    battle.data.salt = (battle.data.salt ?? 0) + 1;
    battle.data.told = Math.max(0, ...battle.run.log.map(e => e.turn ?? 0));
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
    await battle.combat.setFlag(MODULE_ID, "live", { id: battle.data.id, active: true });
    const u = unitOf(battle.combat.combatant);
    if ( u && battle.run.live.players.has(u.id) ) await beginPlayerTurn(u, battle.combat.combatant);
    else if ( u ) await rewoundCard(u);
    changed();
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
    // (Its opening cards, and the combat as it was: not started, the initiative it rolled taken back, and those who
    // joined it on the way gone from it.)
    for ( const id of [...(battle.data.opening ?? []), ...(battle.data.rollCards ?? [])] ) await game.messages.get(id)?.delete();
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
    const spec = unpackSpec(data.spec);
    const rules = getAdapter()?.rules;
    if ( !rules ) return;
    // (Its scene: where it began, an encounter linked to no scene included.)
    const scene = game.scenes.get(data.sceneId) ?? combat.scene ?? canvas.scene;
    battle = { combat, scene, spec, rules, run: restoreRun(spec, rules, data.snapshot), busy: null, pc: null, data };
    playersNow();
    if ( data.pc ) {
      const own = m => m.getFlag(MODULE_ID, "story") || m.getFlag(MODULE_ID, "live");
      battle.pc = { ...data.pc, messages: game.messages.filter(m => m.timestamp >= data.pc.from && !own(m)).map(m => m.id) };
    }
    ui.notifications.info(loc("FASTFIGHTING.Live.PickedUp"));
    return;
  }
}

export function registerLiveBattles() {
  Hooks.once("ready", () => game.socket.on(SOCKET, onSocket));
  Hooks.on("combatTurnChange", onTurnChange);
  Hooks.on("updateToken", (doc, changes) => {
    if ( !battle?.pc || doc.id !== battle.pc.id || !("x" in changes || "y" in changes) || !runsHere(battle.data) ) return;
    queue(() => playerMoved(doc));
  });
  Hooks.on("createChatMessage", onMessage);
  Hooks.on("createCombatant", combatant => {
    if ( battle?.combat !== combatant.parent || battle.data.ended || !runsHere(battle.data) ) return;
    queue(() => joinFight(combatant));
  });
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

