/**
 * Go Live: the battle played on the scene's own combat tracker, a turn at a time.
 *   - A creature FastFighting plays (an NPC, or a character the GM lets it play): when the tracker reaches it, its
 *     turn is played (engine/live.js liveTurn) against the sheets as they stand, its tokens move, what it changed is
 *     written onto the sheets (adapter.commitChanges), its card is told; then FastFighting waits for the GM's Continue.
 *   - A character a player runs: the player plays the turn. When the tracker moves on, what happened is read (the
 *     system's roll cards, through the helper's readTurn; and the sheets) and told as that turn's card, and the
 *     creatures FastFighting plays feel it as they would have (engine/live.js pcTurnBegin and pcTurnEnd).
 *   - A reaction someone must decide (a player's "ask me", or an NPC's when the GM wants to be asked): the turn stops,
 *     the question is put, and the turn is played again from where it began, with the same dice and the answer.
 *   - The dice the engine rolls itself for what the table would roll (damage, a save, a recharge ...) are shown as real
 *     rolls, the turn's own cards (table-rolls.js); a fight played through (Play to the end, the aftermath) on one card
 *     for the GMs.
 *   - Rewind Turn puts the last turn back (last first): what it wrote, its cards, its moves, and the run as it was.
 *     Rewind This Encounter puts every turn back.
 *   - A player who leaves: each character of theirs with none of its players left gets a countdown, and FastFighting
 *     plays it once that runs out; back for BACK_AFTER_MS, their characters are theirs again (away.js).
 *   - Fast Fight, where FastFighting plays every token: the turns go on one after another, no card and no wait between
 *     them, each kept for Rewind as ever, until something needs the GM or a player (fast-fight.js).
 * The run lives in the GM's browser while the battle goes; after every turn it's kept (snapshot, turns) on its
 * transcript, a journal entry only GMs can see (live-journals.js), the combat holding only that a battle is live. A
 * reload picks it up again.
 */
import { twinSession } from "./twin-sessions.js";
import { MODULE_ID, STATUS, SIDES, DISPOSITION_SIDES, NEUTRAL_PARTY, HOSTILE_GROUPS, clamp } from "../constants.js";
import { escapeHtml as escape, inertHtml, listJoin } from "../i18n.js";
import { getAdapter, characterSpec } from "../api.js";
import { dropGoods, pickUpGoods, lootOnFall, writeForaged } from "./loot-drop.js";
import { meatGoods } from "./food.js";
import { setting, followSetting, rangeOf } from "../settings.js";
import { positionOf, squareFeet } from "./terrain.js";
import { approachFor, sceneNow, namesakeOf } from "./battle.js";
import { currentPathGrid, pathGridFor, sceneWallGrid } from "./pathing.js";
import { getSetup, sceneEncounter } from "./persistence.js";
import { QUERIES, isPlayerControlled, getStoredTactics, reactionPrefsFor } from "./tactics.js";
import {
  holdingPause, playMoves, postBeat, postStory, revertEntry, chronicle, storyTitle, packSpec, unpackSpec, placeOf, spotsFor
} from "./make-it-so.js";
import { storyBeats } from "../story/story.js";
import { logLine, goodsText, askText } from "../story/log-lines.js";
import { healthCallout, healthLine } from "../story/health.js";
import { loadStoryTables } from "../story/tables.js";
import { healthLookup } from "./health-estimate.js";
import {
  beginLive, liveRound, gmReinforce, liveLookAround, liveOrder, liveDrop, liveTurn, pcTurnBegin, pcTurnEnd, syncFromSheets, setApproach, setScene, captureAll, snapshotRun, restoreRun, endLive, packLog, followCommand,
  NeedsDecision, rollsKind, applyFact, gmMoment, leavingReach, openingFor, reactNow, movedBeside, nextSpotlight, liveAftermath,
  setCondition, setRelation, clearRelation, setAffliction, setGoal, setAttitude, setSide, setRole, playerRuns, takeRolls
} from "../engine/live.js";
import { postRolls, postTally, tallyOf, audiencesFor, audienceFor } from "./table-rolls.js";
import { cardGm, chatMessageClass, gmIds } from "./chat.js";
import { registerSideLines, writingFor, takingBack, movingTracker, startedAfter } from "./side-lines.js";
import { diffAll, sideAfter, leaveToTable } from "../engine/changes.js";
import { undoRecord } from "./sheet-tools.js";
import { keepUpdate, keptBattle } from "./live-keeping.js";
import { notedBy } from "./applied-cards.js";
import { BACK_AFTER_MS, awayTimers, stillAway, dueTimers, handBack, deadlineClocks, joinWaits } from "./away.js";
import { transcriptOf, newTranscript, dropTranscripts, tidyOnLogin } from "./live-journals.js";
import { randomSeed } from "../engine/rng.js";
import { holderOf } from "../engine/behavior/troubles.js";
import { perceives, noteSeen } from "../engine/behavior/senses.js";
import { SystemAdapter } from "../adapters/adapter-base.js";
import { FAST_MOVE_SPEED, FAST_STOP_NOTES, fastFightOffered, fastFightStop, fastTurnChange, fightMoment, stillSince, STILL_AGAIN, hushDice, unhushDice, registerQuietDice } from "./fast-fight.js";

/** Does the helper do this itself (its own, not the base adapter's do-nothing)? */
const offers = (adapter, name) => typeof adapter?.[name] === "function" && adapter[name] !== SystemAdapter.prototype[name];

/**
 * The kinds of roll the system makes itself in this battle, as its helper offers them (engine/live.js systemRoll):
 * strikes (rollStrike); saves (rollSave); checks (rollCheck); an action's own card (useAction) and its damage, once
 * for all it catches (rollDamage); the engine's own damage shown as the system's damage card (showTableRoll, API 20,
 * with applyDamageCard); and the damage cards of strikes and those applied its own way (applyDamageCard).
 */
function systemRollKinds(adapter) {
  const out = [];
  if ( offers(adapter, "rollStrike") ) out.push("strike");
  if ( offers(adapter, "rollSave") ) out.push("save");
  if ( offers(adapter, "rollCheck") ) out.push("check");
  if ( offers(adapter, "useAction") ) out.push("use");
  if ( offers(adapter, "rollDamage") ) out.push("damage");
  if ( offers(adapter, "adjustRolled") ) out.push("adjust");
  if ( offers(adapter, "showTableRoll") && offers(adapter, "applyDamageCard") ) out.push("card");
  if ( (out.includes("strike") || out.includes("damage") || out.includes("card")) && offers(adapter, "applyDamageCard") ) out.push("apply");
  return out;
}
import { isStanding, canMove, groupKeyOf, pullsThisRound, burstPoint } from "../engine/battle-state.js";
import { means, dealDC, pitchOf, dealInsight, dealAnswer, mayToll, talkRange } from "../engine/behavior/deals.js";

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

/**
 * The GM whose browser plays the battle on this encounter, where it isn't this one's (another GM began it, or picked it
 * up while this one was away): that user, else null. The combat's flag says, as every browser reads it.
 */
export function playedElsewhere(combat) {
  const flag = combat?.getFlag?.(MODULE_ID, "live");
  if ( !flag?.active || (battle?.combat === combat && playsHere()) ) return null;
  const user = flag.user ? game.users.get(flag.user) : null;
  return user && !user.isSelf ? user : null;
}

/** The combat's flag for the battle: which it is, whether it's still going, and whose browser plays it. */
/**
 * The combat's flag for its battle, as every browser reads it: which, whether it's on, whose browser plays it, and
 * whether FastFighting is in use for it (begun, or the GM has used the Battle Vantage on it: playersTracker).
 */
const flagOf = active => ({ id: battle.data.id, active, user: battle.data.user, inUse: active && (!battle.data.prepared || !!battle.data.touched) });

/**
 * The GM has used the Battle Vantage on this battle (a button pressed, a setting changed): FastFighting is in use for
 * it from now on, even before it begins (playersTracker).
 */
export async function markInUse() {
  if ( !battle || battle.data.touched || battle.data.ended || !playsHere() ) return;
  battle.data.touched = true;
  await keep();
  await battle.combat.setFlag(MODULE_ID, "live", flagOf(!battle.data.ended));
}

/**
 * The Combat Tracker as a player sees it: with FastFighting in use for its encounter (the combat's flag, flagOf), no
 * Previous Turn (a player can only end their own turn in a live battle); otherwise, and once the battle is over, as
 * Foundry draws it. Hidden with a class (`ff-live-tracker`), not removed, so a module that looks for it still finds it.
 */
export function playersTracker(app, element) {
  const live = (app?.viewed ?? game.combat)?.getFlag(MODULE_ID, "live");
  element?.classList?.toggle("ff-live-tracker", !game.user.isGM && !!live?.active && !!live?.inUse);
}

/** Something changed in the battle: whatever shows it draws it again. */
const changed = () => Hooks.callAll("fastFighting.liveBattle", battle);

/* -------------------------------------------- */
/*  Keeping it                                  */
/* -------------------------------------------- */

/**
 * A battle is kept on its transcript, a journal of its own found by its combat's id and its own (live-journals.js:
 * trusted only, made at its first keep), a part at a time (live-keeping.js): each keep writes the battle as it stands, and of its
 * turns and its log only what's new or changed since the keep before (b.kept: what that one wrote, to that journal;
 * none, the first keep of a battle begun or picked up, or a journal new since, writes them all), and when it was kept.
 * One write at a time (inTurn: keep, forget), so each keep goes from what the one before it wrote.
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

/**
 * The world settings the helper's undo records name (Daggerheart's Fear), noted as they come from it in this browser,
 * "namespace.key": the only ones a Rewind puts back (make-it-so.js revertRecord). Returns the records.
 */
function noteSettings(records) {
  for ( const r of records ?? [] ) {
    const s = r?.setting;
    if ( !s || typeof s.namespace !== "string" || typeof s.key !== "string" ) continue;
    const key = `${s.namespace}.${s.key}`;
    if ( !(battle.data.settingKeys ??= []).includes(key) ) battle.data.settingKeys.push(key);
  }
  return records;
}

/** What a Rewind of this battle may put back beyond the sheets (revertEntry's options): the settings it noted. */
const rewinding = () => ({ settings: new Set(battle?.data.settingKeys ?? []) });

async function keepNow(b) {
  if ( !b ) return;
  changed();
  b.data.snapshot = snapshotRun(b.run, { log: false });
  // (A player's turn under way: who, since when, what the GM said and what reactions wrote. Its cards are found again by time.)
  const pc = b.pc;
  // (Its big parts, the run before it and the sheets as it began, kept apart: written once a turn, pcTurnKept.)
  b.data.pc = pc ? { combatantId: pc.combatantId, id: pc.id, round: pc.round, facts: pc.facts, records: pc.records, from: pc.from, damage: pc.damage ?? [], dealt: pc.dealt ?? [], applied: pc.applied ?? [], lastAt: pc.lastAt ?? null, startAt: pc.startAt ?? null, rollCards: pc.rollCards ?? [], dealRolls: pc.dealRolls ?? [], doors: pc.doors ?? [] } : null;
  const doc = transcriptOf(b.combat.id, b.data.id) ?? await newTranscript(b.combat.id);
  if ( !doc ) return;
  // (The battle's own key replaced whole, the journal's other keys left as they are. Its spec, the biggest part, only
  // when it's changed: kept beside it. Its turns and its log, each apart: only what's new. A journal other than the one
  // the last keep wrote to: all of it.)
  const same = doc.id === b.transcriptId;
  const spec = b.data.spec;
  const { update, kept: now } = keepUpdate(same ? b.kept ?? null : null, b.combat.id, b.data, {
    log: b.run.log ?? [], pack: (from, to) => packLog(b.run, from, to), root: `flags.${MODULE_ID}`, keptSpec: same ? b.keptSpec ?? null : null, keptAt: Date.now(),
    pcTurn: pc ? pcTurnKept(pc) : null
  });
  await doc.update(update);
  b.transcriptId = doc.id;
  b.keptSpec = spec;
  b.kept = now;
}

/**
 * A player's turn's big parts as they're kept (live-keeping.js pcs.<id>): the run as it was before it, and every sheet
 * as it began (sheetsAt). The same object while they're the same, so they're written once a turn.
 */
const pcTurns = new WeakMap();
function pcTurnKept(pc) {
  const sheets = sheetsAt.get(pc) ?? null;
  let kept = pcTurns.get(pc);
  if ( !kept || kept.snapshot !== pc.snapshot || kept.sheets !== sheets ) pcTurns.set(pc, kept = { snapshot: pc.snapshot, sheets });
  return kept;
}

/**
 * A battle as it was kept (live-keeping.js keptBattle), and the journal it was read from: its transcript (the battle's
 * on this combat, by its id); or null.
 */
function kept(combatId, battleId) {
  const doc = transcriptOf(combatId, battleId);
  const data = doc ? keptBattle(path => doc.getFlag(MODULE_ID, path), combatId) : null;
  return data ? { data, doc } : null;
}

/** Rewind This Encounter: the battle is undone, and its transcript goes. */
function forget(combatId, battleId) {
  return inTurn(() => dropTranscripts("rewound", combatId, battleId));
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
export async function startLiveBattle(spec, { style = setting("storyStyle"), odds = null, players = [], playersRun = true, begin = true, began = false, combatId = null, applyDamage = setting("applyPlayerDamage") } = {}) {
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
  // (What the system rolled as the fight was set up, its surprise: shown with the opening.)
  const openingRolls = takeRolls(run);
  // (Prepared until the encounter begins: no turn played, nothing told. Another battle held here before it: let go.)
  letGo();
  battle = {
    combat, scene, spec: live, rules: adapter.rules, run, pc: null,
    data: {
      id: foundry.utils.randomID(), user: game.user.id, sceneId: scene.id, spec: packSpec(live), seed, style, odds, players, told: 0, turns: [],
      ended: false, played: null, opening: [], rolled: [], rollCards: [], joined: [], startedCombat: false, spotlight, spots: 0, prepared: true, applyDamage: !!applyDamage,
      // (Players run their characters, as the planner said: off, FastFighting plays everyone, players coming or going.)
      playersRun: playersRun !== false,
      startedBefore: combat.started && !began, openingRolls
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
 * noticed: registerLiveBattles), or Go Live. Those yet to roll initiative roll it, straight away (no
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
    if ( !combat.started ) await moving(() => combat.startCombat());
    // (Begun with Foundry's own button before the rolls: the tracker on the first of the order they made.)
    else if ( unrolled.length && combat.turn !== 0 ) await moving(() => combat.update({ turn: 0 }, { turnEvents: false }));
    // (Begun for this battle, whoever pressed the button: Rewind This Encounter takes it back.)
    const started = !battle.data.startedBefore;
    if ( battle.data.spotlight && combat.turn !== null ) await moving(() => adapter.giveSpotlight(combat, null));
    liveOrder(battle.run, combat.turns.map(c => unitOf(c)?.id).filter(Boolean));
    battle.spec = { ...battle.spec, options: { ...battle.spec.options, initiativeOrder: combat.turns.map(c => c.tokenId) } };
    battle.data.spec = packSpec(battle.spec);
    liveRound(battle.run, combat.round || 1);
    Object.assign(battle.data, { prepared: false, rolled: unrolled, rollCards, startedCombat: started, beganAt: rolledFrom });
    // (In use now: the players' tracker as a live battle's, playersTracker.)
    await combat.setFlag(MODULE_ID, "live", flagOf(true));
    // (Players not here as it begins: gone since it began.)
    timersAtStart(rolledFrom);
    const shown = await showRolls(battle.data.openingRolls ?? [], null);
    battle.data.openingRolls = [];
    battle.data.opening = [...shown, ...await tellNew()];
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
  line = next.catch(failed);
  return next;
}

/**
 * Work for the battle this browser holds now, queued: by the time its turn comes, a rewind (or the battle ending, or
 * another browser picking it up) may have let it go, so it's done only if that battle is still the one held.
 */
function queueFor(work) {
  const held = battle;
  return queue(() => (held && battle === held ? work() : undefined));
}

/** Something in the battle went wrong: the GM told, and a Fast Fight stopped. */
function failed(err) {
  console.error(`${MODULE_ID} | live battle`, err);
  ui.notifications.error(fmt("FASTFIGHTING.Live.Failed", { error: err.message }));
  checkFast({ failed: true });
}

/** Turn changes whose turn hasn't begun yet (onTurnChange's, still in the queue). */
let turnsWaiting = 0;

/**
 * The tracker moved on: the turn that ended is closed (a player's, read and told), and the next begins (one FastFighting
 * plays, played). Moved back (Previous Turn, Previous Round): the battle follows it (followBack).
 */
function onTurnChange(combat, prior, current) {
  // (Prepared, not yet begun: the encounter's start is beginEncounter's.)
  if ( battle?.combat !== combat || battle.data.ended || battle.data.prepared || !playsHere() ) return;
  // (A Fast Fight: its own move on, noted; the tracker used by anyone else stops it.)
  if ( battle.fast ) {
    const change = fastTurnChange(battle.fast.pending, prior, current);
    if ( change === "ours" ) battle.fast.pending = current?.combatantId ? null : { ...current };
    else checkFast({ change });
  }
  // (Moved by a player some other way than ending their own character's turn, or a spotlight given to a creature not
  // theirs: put back, and the GM told.)
  if ( !(battle.data.spotlight ? spotlightRightly(combat, prior, current) : movedRightly(combat, prior, current)) ) {
    const refused = battle.data.spotlight ? "FASTFIGHTING.Live.SpotlightRefused" : "FASTFIGHTING.Live.TrackerRefused";
    queueFor(async () => {
      await moving(() => combat.update({ round: prior.round, turn: prior.turn }, { turnEvents: false }));
      ui.notifications.warn(fmt(refused, { name: game.users.get(combat._stats?.lastModifiedBy)?.name ?? "" }));
      changed();
    });
    return;
  }
  // (A spotlight system's tracker has no order to go back along: its Rewind is the battle's own.)
  const back = !battle.data.spotlight && !!prior && current?.round > 0 && prior.combatantId !== current.combatantId
    && (current.round < prior.round || (current.round === prior.round && (current.turn ?? -1) < (prior.turn ?? -1)));
  if ( back ) {
    queueFor(() => followBack(prior));
    return;
  }
  turnsWaiting++;
  const held = battle;
  queue(async () => {
    turnsWaiting--;
    // (Let go of since: a rewind of the whole encounter, the battle over, another browser playing it.)
    if ( battle !== held ) return;
    pauseFor(unitOf(combat.combatant));
    await clearAreas();
    if ( battle.pc && battle.pc.combatantId !== combat.combatant?.id ) await closePlayerTurn();
    if ( battle.data.spotlight ) await spotlightMoved(combat, prior);
    else if ( combat.round > (battle.run.round ?? 0) ) await newRound(combat.round);
    await delayOnTracker(prior);
    await turnBegins(combat.combatant);
  });
}

/**
 * The tracker taken back before the encounter began (Previous Turn or Previous Round from round 1's first turn, by a
 * player or a GM): Foundry tells no turn change for it (combatTurnChange waits for a started combat), so it's caught
 * here. A live battle doesn't go back past its start that way: the tracker is put back where it was, and the GMs told
 * (a player's doing: TrackerRefused; a GM's: only Rewind This Encounter goes so far, TooFarBack). Rewind This
 * Encounter's own (its update's options carry MODULE_ID) is left alone.
 */
function onUnstarted(combat, diff, options, userId) {
  if ( battle?.combat !== combat || battle.data.ended || battle.data.prepared || !playsHere() ) return;
  if ( diff?.round !== 0 || options?.[MODULE_ID] ) return;
  const prior = combat.previous;
  if ( !(prior?.round > 0) ) return;
  const by = game.users.get(userId);
  queueFor(async () => {
    await moving(() => combat.update({ round: prior.round, turn: prior.turn }, { turnEvents: false }));
    ui.notifications.warn(by && !by.isGM ? fmt("FASTFIGHTING.Live.TrackerRefused", { name: by.name }) : loc("FASTFIGHTING.Live.TooFarBack"));
    changed();
  });
}

/**
 * The initiative that puts a delayed creature right after `after`'s (the initiative of the one it waits for; `next`,
 * the one after that, if any), or, with no `after`, last (`lowest`, the lowest on the tracker). Null if there's none
 * to go by. Pure.
 */
export function delayedInitiative({ after = null, next = null, lowest = null } = {}) {
  if ( Number.isFinite(after) ) return Number.isFinite(next) && next < after ? (after + next) / 2 : after - (Number.isFinite(next) ? 0.001 : 1);
  return Number.isFinite(lowest) ? lowest - 1 : null;
}

/**
 * The tracker moved on from a creature that delayed (engine/behavior/waiting.js: its turn a Delay, `battle.data.delaying`):
 * it goes on the tracker right after whomever it waits for (the round's last, if no one), its turn coming up there;
 * the one whose turn it is now stays so. Its place before, in its Delay's turn's records: a Rewind puts it back.
 */
async function delayOnTracker(prior) {
  const d = battle.data.delaying;
  if ( !d || d.combatantId !== prior?.combatantId ) return;
  battle.data.delaying = null;
  // (Its turn comes up again this round, under the same key: not one played already.)
  if ( battle.data.played === d.key ) battle.data.played = null;
  const combat = battle.combat;
  const c = combat.combatants.get(d.combatantId);
  if ( !c || !Number.isFinite(c.initiative) ) return;
  const others = combat.turns.filter(t => t.id !== c.id);
  const at = d.afterId ? others.findIndex(t => unitOf(t)?.id === d.afterId) : -1;
  const initiative = delayedInitiative({
    after: at >= 0 ? others[at].initiative : null, next: at >= 0 ? others[at + 1]?.initiative ?? null : null,
    lowest: Math.min(...others.map(t => t.initiative).filter(Number.isFinite))
  });
  if ( initiative === null ) return;
  battle.data.turns.find(t => t.key === d.key)?.records.push({ combatant: { uuid: c.uuid, initiative: c.initiative } });
  // (Foundry keeps whoever's turn it is when a combatant's initiative changes.)
  await c.update({ initiative }, { turnEvents: false });
  await keep();
}

/**
 * Where Foundry's own Next Turn (a player's End Turn) goes from `prior` ({round, turn}): the next in the order (the next
 * not defeated, `skipDefeated`), else the next round's first (its first not defeated). `defeated`: each turn's, in order.
 */
export function nextPlace(defeated, prior, skipDefeated = false) {
  const n = defeated.length;
  const from = prior.turn ?? -1;
  for ( let i = from + 1; i < n; i++ ) if ( !skipDefeated || !defeated[i] ) return { round: prior.round, turn: i };
  if ( prior.turn === null || prior.turn === undefined || !n ) return { round: prior.round + 1, turn: null };
  const first = skipDefeated ? defeated.findIndex(d => !d) : 0;
  return { round: prior.round + 1, turn: first === -1 ? 0 : first };
}

/**
 * Was the tracker moved as it may be? By a GM, any way; by a player, only as their End Turn moves it (nextPlace), from the
 * turn of a character of their own. Foundry lets anyone set a combat's turn: a player going back would have the GM's
 * client take back a foe's turn (and roll it again), one going on past others, skip theirs.
 */
function movedRightly(combat, prior, current) {
  const by = game.users.get(combat._stats?.lastModifiedBy);
  if ( !by || by.isGM ) return true;
  if ( !prior ) return false;
  const next = nextPlace(combat.turns.map(c => !!c.isDefeated), prior, !!combat.settings?.skipDefeated);
  const was = combat.combatants.get(prior.combatantId);
  return current.round === next.round && (current.turn ?? null) === next.turn && !!was?.actor?.testUserPermission(by, "OWNER");
}

/**
 * Was a spotlight system's spotlight moved as it may be (spotlightGiven)? Foundry lets anyone set a combat's turn: a
 * player handing it to a creature FastFighting plays would have the GM's client play that creature's turn.
 */
function spotlightRightly(combat, prior, current) {
  const by = game.users.get(combat._stats?.lastModifiedBy);
  if ( !by ) return true;
  return spotlightGiven({ byGM: by.isGM, prior, current, owns: id => !!combat.combatants.get(id)?.actor?.testUserPermission(by, "OWNER") });
}

/**
 * The rule for a spotlight (Daggerheart's): a GM gives it to anyone; a player only to a character of their own, as the
 * system lets them take it, or hands it back from one (to nobody: the GM's to give). Pure: `owns(combatantId)`, does
 * the one who moved it own that combatant.
 */
export function spotlightGiven({ byGM, prior, current, owns }) {
  if ( byGM ) return true;
  if ( current?.combatantId ) return !!owns(current.combatantId);
  return !prior?.combatantId || !!owns(prior.combatantId);
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
 * Play to the end or a Fast Fight and FastFighting playing everyone, given where FastFighting would give it). In a Fast
 * Fight, where it moves on from is noted first, so its turn change is known for its own (onTurnChange).
 */
async function moveOn() {
  if ( battle.fast ) battle.fast.pending = { ...battle.combat.current };
  await moving(async () => {
    if ( !battle.data.spotlight ) await battle.combat.nextTurn();
    else if ( (battle.data.auto || battle.fast) && !battle.run.live.players.size ) {
      // (No one for FastFighting to give it to: the GM gives it.)
      if ( battle.fast && !nextSpotlight(battle.run) ) checkFast({ asks: "spotlight" });
      else await spotlightNext();
    } else await getAdapter().giveSpotlight(battle.combat, null);
  });
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
  // (Walked away by a deal: always out of sight in the corner, whatever the setting says of the fled.)
  const leave = setting("fledMode") === "leave";
  const gone = events.filter(e => e.type === "offMap" && (!leave || e.walkedAway)).map(e => docOf(e.actorId)).filter(Boolean);
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
 * Rewind This Encounter's last sweep: the chat's roll cards made since the battle began (`since`, ms) by a creature in
 * it (its token, or its actor, by id), that no turn took: a player's roll between turns, a card from before a turn was
 * kept. Only cards: one with a roll, the system's own card (`system`: its flags' key, with a context), or one with a
 * flavor (the heading an action's card has: PF2e's Interact to draw a weapon); words alone stay. And only one its
 * author may speak for it with (`rightful(m)`: a GM, or one who owns it): anyone can name any speaker on a card.
 */
export function strayCards(messages, { since, tokens = new Set(), actors = new Set(), system = null, rightful = () => true } = {}) {
  if ( !Number.isFinite(since) ) return [];
  return messages.filter(m => (m.timestamp ?? 0) >= since
    && (tokens.has(m.speaker?.token) || actors.has(m.speaker?.actor))
    && ((m.rolls?.length ?? 0) > 0 || (system && !!m.flags?.[system]?.context) || !!String(m.flavor ?? "").trim())
    && rightful(m));
}

/**
 * Is a chat card one a roll in a turn made, to be taken with the turn (and deleted by its Rewind)? One this browser's
 * user made (`me`: the GM's, rolling it here), or one by a user it was asked of (`players`: a player's character's
 * owners) speaking for that character (`token` or `actor`, by id). Anything else posted meanwhile, another player's
 * chat or another GM's, isn't the turn's. Pure: the message's author and speaker.
 */
export function turnCard(m, { me, players = new Set(), token = null, actor = null } = {}) {
  const by = m?.author?.id;
  if ( !by ) return false;
  if ( by === me ) return true;
  const speaks = (!!token && m.speaker?.token === token) || (!!actor && m.speaker?.actor === actor);
  return players.has(by) && speaks;
}

/**
 * The cards a roll for `doc` made, of those posted since `seen` (ids): this browser's own, and its players' speaking
 * for it (turnCard). `asked`: whether its players could have been asked to roll it (a player's character's).
 */
function cardsSince(seen, doc = null, { asked = false } = {}) {
  const players = asked && doc?.actor ? new Set(game.users.filter(u => !u.isGM && doc.actor.testUserPermission(u, "OWNER")).map(u => u.id)) : new Set();
  const who = { me: game.user.id, players, token: doc?.id ?? null, actor: doc?.actor?.id ?? null };
  return game.messages.filter(m => !seen.has(m.id) && turnCard(m, who));
}

/**
 * What taking turns back undoes, each turn as revertEntry takes it: a player's turn taken back whole loses its player's
 * own cards too (`cards`: what they rolled in it); the one reopened (goingBack's `reopen`) keeps them, read again when
 * it ends.
 */
export function undoEntries(undo, reopen = null) {
  return undo.map(turn => (turn !== reopen && turn.cards?.length ? { ...turn, messages: [...(turn.messages ?? []), ...turn.cards] } : turn));
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
    await moving(() => combat.update({ round: prior.round, turn: prior.turn }, { turnEvents: false }));
    changed();
    return false;
  }
  // (Cards left to the table by the turns taken back, and by a player's turn still open: gone with their cards.)
  const takenBack = new Set([...undo.map(t => t.key), ...(battle.pc ? [`${battle.pc.round}.${battle.pc.combatantId}`] : [])]);
  await revertOpenTurn();
  for ( const turn of undoEntries(undo, reopen).reverse() ) await holdingPause(() => takingBack(battleActors(), () => revertEntry(battle.scene, turn, rewinding())));
  // (What the system told of the starts of turns gone back past: gone with them.)
  await dropStarts({ round: combat.round, at: combat.turn ?? -1 });
  await untally(undo);
  const snapshot = undo[0]?.snapshot ?? battle.pc?.snapshot;
  if ( snapshot ) battle.run = playersNow(restoreRun(battle.spec, battle.rules, snapshot, { log: battle.run.log }));
  battle.data.turns = turns.slice(0, turns.length - undo.length);
  battle.data.waiting = waitingAfter(battle.data.waiting, takenBack);
  // (Cards still in the chat whose damage those turns applied, its Apply back: their damage was taken back.)
  redraw(undo.flatMap(t => t.applied ?? []));
  battle.data.played = null;
  battle.data.offMap = [];
  battle.data.delaying = null; // (a Delay taken back with its turn)
  battle.data.salt = (battle.data.salt ?? 0) + 1;
  battle.data.told = lastTurn(battle.run.log);
  battle.pc = null;
  // (The cards it told are gone: told again when they're played again.)
  const gone = new Set(battle.run.log.map(e => e.turn ?? 0));
  battle.data.toldBeats = (battle.data.toldBeats ?? []).filter(k => k !== "closing" && k.split(",").every(t => gone.has(Number(t))));
  const u = unitOf(combatant);
  if ( reopen && u ) {
    pcTurnBegin(battle.run, u.id, { nonce: freshNonce() });
    battle.pc = { combatantId: combatant.id, id: u.id, round: reopen.round, messages: reopen.cards ?? [], facts: reopen.facts ?? [], records: [], snapshot: reopen.snapshot, from: reopen.from, rollCards: [], dealRolls: reopen.dealRolls ?? [] };
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

/** One more the players run (a player's summons): the battle's list and the run's. A Fast Fight stops. */
function addPlayer(id) {
  battle.data.players = [...new Set([...(battle.data.players ?? []), id])];
  battle.run.live.players.add(id);
  checkFast();
}

/** The latest turn in a log (0 for none). */
const lastTurn = log => {
  let last = 0;
  for ( const e of log ) if ( (e.turn ?? 0) > last ) last = e.turn;
  return last;
};

/** How a turn is written onto the sheets, as the world's settings say. */
const writeOptions = () => ({ live: true, lootMode: setting("lootMode"), corpseMode: setting("corpseMode"), fledMode: setting("fledMode") });

/** The initiative cards rolled here since `from` (taken back with the encounter): this browser's own, never another's. */
const initiativeCards = from => game.messages.filter(m => m.timestamp >= from && m.getFlag("core", "initiativeRoll") && m.author?.id === game.user.id).map(m => m.id);

/** A creature's token id: its spec's, or (summoned mid-fight) the one made for it. */
export const tokenIdOf = u => u.tokenId ?? u.spec.tokenId ?? u.id;

/** The token id of a creature in `run` by its id (a summons' differs from it); the id itself for one not there. Pure. */
export const unitTokenId = (run, id) => {
  const u = run?.byId?.get(id);
  return u ? tokenIdOf(u) : id;
};

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
  // (A Fast Fight goes on, unless this turn is its player's; gone two whole rounds with nothing changing, once the
  // fight has lasted the system's fewest Max rounds (or, after the GM said to go on, four more), the GM is asked
  // whether it goes on.)
  if ( battle.fast ) {
    const round = battle.run.round ?? 0;
    const moment = fightMoment(battle.run.units);
    if ( moment !== battle.fast.moment || !battle.fast.since ) Object.assign(battle.fast, { moment, since: { round, id: u.id } });
    if ( !checkFast({ playerTurn: playerRuns(battle.run, u) }) && stillSince(battle.fast.since, round, u.id, battle.fast.least) ) await askStill(round, u);
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
  queueFor(async () => {
    battle.spec = { ...battle.spec, combatants: battle.spec.combatants.map(c => (ids.has(c.id) ? { ...c, ...playersSay(c, actor) } : c)) };
    battle.data.spec = packSpec(battle.spec);
    await keep();
  });
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
  // (One of a name already in the fight: numbered past them, numberNamesakes.)
  Object.assign(spec, namesakeOf(battle.spec.combatants, spec.name) ?? {});
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

/**
 * A player's turn begins: kept as it was (for Rewind), begun in the engine, and its cards gathered from now on; its
 * player, here, offered a deal (dealTurnCard).
 */
async function beginPlayerTurn(u, combatant) {
  const snapshot = snapshotRun(battle.run, { log: false });
  pcTurnBegin(battle.run, u.id, { nonce: freshNonce() });
  const doc = docOf(u.id);
  // (Where it stood as its turn began: a Rewind puts its token back there, as an NPC's turn's moves do.)
  battle.pc = { combatantId: combatant.id, id: u.id, round: battle.combat.round, messages: [], facts: [], records: [], snapshot, from: Date.now(), lastAt: doc ? { x: doc.x, y: doc.y } : null,
    startAt: doc ? { uuid: doc.uuid, ...placeOf(doc) } : null, rollCards: [] };
  // (Every sheet and token as the turn begins, for Rewind to put back whatever the turn changed by hand.)
  sheetsAt.set(battle.pc, captureSheets());
  await dealTurnCard(u);
  return keep();
}

/**
 * A new round: a team's reinforcements called last round come in (onto the map and the tracker, kept with the turn
 * before, so a Rewind takes them back), those not yet in the fight look around, and one that notices joins the tracker.
 */
async function newRound(round) {
  liveRound(battle.run, round);
  await placeReinforcements(battle.data.turns.at(-1)?.records ?? []);
  // (Whether they notice: FastFighting's own reckoning, nothing rolled the table would see. One that has, on the tracker.)
  for ( const u of liveLookAround(battle.run) ) {
    const doc = battle.scene.tokens.get(tokenIdOf(u));
    if ( !doc || battle.combat.combatants.some(c => c.tokenId === doc.id) ) continue;
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
  // (Who comes after it this round, as the tracker has it now: for a Delay, engine/behavior/waiting.js.)
  if ( battle.rules.delay ) liveOrder(battle.run, battle.combat.turns.map(c => unitOf(c)?.id).filter(Boolean));
  const before = captureAll(battle.run);
  const snapshot = snapshotRun(battle.run, { log: false });
  // (Every pass of the turn, the first too, from the fight as the snapshot keeps it: the per-round caches the fight
  // carried from earlier turns aren't kept, and a first pass that saw them could choose otherwise than the passes after
  // it, its rolls' cards left in the chat for a blow that never came.)
  battle.run = restoreRun(battle.spec, battle.rules, snapshot, { log: battle.run.log });
  const answers = [];
  const nonce = freshNonce(); // (the turn's own dice, the same each time it's played again for an answer)
  // Where everyone stood (for Rewind), before the turn moves anyone; and what it's put on the map and in the chat
  // before each of the system's rolls (turnRoll).
  const stage = turnStage(key);
  const startedAt = battle.run.units.map(x => docOf(x.id)).filter(Boolean).map(doc => ({ uuid: doc.uuid, ...placeOf(doc) }));
  areaShapes.clear();
  areaTests.clear();
  let turn = null;
  let result;
  try {
    ({ result } = await playingTurn(u, combatant, key, { adapter, before, snapshot, nonce, answers, stage, startedAt, kept: t => (turn = t) }));
  } catch ( err ) {
    // (Failed partway: what it had written, told and moved taken back, and the fight as it was before it, so playing it
    // again doesn't do it twice.)
    try {
      await holdingPause(() => takingBack(battleActors(), () => revertEntry(battle.scene, failedTurnUndo(turn, stage, startedAt), rewinding())));
      redraw(stage.applied);
    } catch ( undoErr ) {
      console.error(`${MODULE_ID} | taking back a turn that failed`, undoErr);
    }
    battle.run = playersNow(restoreRun(battle.spec, battle.rules, snapshot, { log: battle.run.log }));
    throw err;
  }
  battle.data.played = key;
  // (A Delay: it moves on the tracker as the tracker moves on from it, delayOnTracker.)
  const delay = result.events.find(e => e.type === "delay" && e.actorId === u.id);
  battle.data.delaying = delay ? { combatantId: combatant.id, afterId: delay.afterId ?? null, key } : null;
  await settleTurn(turn, result.ended);
}

/**
 * What a turn FastFighting played that failed partway had done, as an undo entry (revertEntry's): what it wrote and
 * the cards it made (`turn`'s, once it has them; before that its rolls', `stage`'s), the doors it opened, and everyone
 * where they stood as it began (`startedAt`). Pure.
 */
export function failedTurnUndo(turn, stage, startedAt) {
  return { records: [...(turn?.records ?? stage.records)], messages: [...(turn?.messages ?? stage.messages)], doors: [...stage.doorsOpened.values()], moves: [...(startedAt ?? [])] };
}

/** A turn FastFighting plays, played (playTurn's); `kept` given the turn as soon as it has one. */
async function playingTurn(u, combatant, key, { adapter, before, snapshot, nonce, answers, stage, startedAt, kept }) {
  let result;
  // (The pass before, stopped at a question: what it had worked out, the next pass takes up. engine/live.js liveTurn.)
  let lastPass = null;
  for ( let tries = 0; ; tries++ ) {
    try {
      battle.run.live.exitOf = exitOf; // (the way off the scene, for one leaving the fight)
      battle.run.live.inArea = areaTest; // (who an area catches, as the system's own shape has it on the map)
      result = liveTurn(battle.run, u.id, { answers, salt: battle.data.salt ?? 0, nonce, before: lastPass });
      break;
    } catch ( err ) {
      if ( !(err instanceof NeedsDecision) || tries > 200 ) throw err;
      const request = err.request;
      // (A roll the system makes: what the turn did before it played on the map first. A question: asked.)
      const answer = request.roll ? await turnRoll(request, battle.run.log.slice(battle.run.live.turnFrom ?? battle.run.log.length), stage) : await answerFor(request, stage);
      answers.push([request.key, answer]);
      lastPass = battle.run;
      battle.run = restoreRun(battle.spec, battle.rules, snapshot, { log: battle.run.log });
    }
  }
  const after = captureAll(battle.run);
  const turn = kept({ key, combatantId: combatant.id, round: battle.combat.round, at: battle.combat.turn, kind: "npc", records: [...stage.records], messages: [...stage.messages], moves: [], doors: [], snapshot });
  if ( stage.applied.length ) turn.applied = [...stage.applied];
  await holdingPause(async () => {
    // Where everyone stood (for Rewind), then the moves and doors as the turn made them (those after its last roll:
    // the rest are on the map already).
    turn.moves = startedAt;
    const docs = stageDocs(stage);
    const doorsOpened = stage.doorsOpened;
    const rest = result.events.slice(stage.played);
    if ( setting("playOnMap") ) await playMoves(rest, docs, stageGrid(stage), doorsOpened, battle.scene, { speed: moveSpeed() });
    else await playMoves(rest, docs, null, doorsOpened, battle.scene, { instant: true });
    // (What it did to get ready since: drawn, loaded, up off the ground, as the system does it.)
    await playGear(rest, turn);
    turn.doors = [...doorsOpened.values()];
    // (Its areas, laid on the map as the system lays them: who they caught was tested against them.)
    await layAreas(result.events, turn.records);
    // What it summoned, onto the scene and the tracker; and any team's reinforcements come in.
    await placeSummons(turn.records);
    await placeReinforcements(turn.records);
    // (Those inside another, swallowed or engulfed: where their holder went.)
    await carryInside();
    // (Who sees the engine's rolls, as the tokens are before the turn's writing hides one that fled.)
    const audiences = rollAudiences(result.rolls);
    // What the turn changed, onto the sheets (each written as it stood when the turn began), the cards the helper made
    // as it wrote them the turn's; what a player's character did to another, the table settles (tableLeaves).
    await writeChanges(before, after, turn.records, { messages: turn.messages, leave: tableLeaves(u.id) });
    // (The engine's own dice for what the table would roll, shown: the turn's cards. Played through, the GMs' card.)
    turn.messages.push(...await showRolls(result.rolls, turn, { settle: !!battle.data.auto, audiences }));
    // (Those it saw off the map: out of the way, and off the tracker as it moves on.)
    await sendOff(result.events, turn);
    // (What the turn did to what the encounter keeps: Daggerheart's Fear.)
    try {
      const wrote = await writingFor(battle.data.id, battleActors(), turn.messages, () => adapter.commitTurn(before, after, { ...writeOptions(), spec: battle.spec, events: result.events }));
      turn.records.push(...noteSettings(wrote ?? []));
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
  return { turn, result };
}

/**
 * The battle's turns with one more kept: all of them, for Rewind This Encounter (what each wrote, told and moved); the
 * last `depth` with the fight as it was before them too (a snapshot, the big part), for Rewind Turn. Pure (the older
 * turns' snapshots dropped).
 */
export function keptTurns(turns, turn, depth = REWIND_DEPTH) {
  const out = [...(turns ?? []), turn];
  for ( const t of out.slice(0, -depth) ) delete t.snapshot;
  return out;
}

/** A turn kept (keptTurns), its cards whose damage it applied drawn again. */
function keepTurn(turn) {
  battle.data.turns = keptTurns(battle.data.turns, turn);
  redraw(turn.applied);
}

/**
 * What comes after a turn is kept (settleTurn), pure: "end", the battle is over; "on", the next turn at once, with no
 * GMs' card (a turn FastFighting played, with Play to the end or in a Fast Fight); "card", the GMs' card (Rewind, Next
 * Turn) and the wait for it; "wait", a player's turn, the tracker waits as it is. Kept for Rewind whichever it is.
 */
export function afterTurn({ kind, ended = false, auto = false, fast = false } = {}) {
  if ( ended ) return "end";
  if ( kind !== "npc" ) return "wait";
  return auto || fast ? "on" : "card";
}

/** A turn done: kept for Rewind, the battle kept, and the end, the next turn at once, or the GM's Next Turn. */
async function settleTurn(turn, ended) {
  keepTurn(turn);
  const next = afterTurn({ kind: turn.kind, ended, auto: !!battle.data.auto, fast: !!battle.fast });
  if ( next === "end" ) {
    await finish();
    return;
  }
  if ( next === "on" ) {
    await keep();
    // (Not waited on: the tracker's turn change plays the next turn, after this one.)
    moveOn().catch(failed);
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
  const ChatMessage = chatMessageClass();
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
 * played (`played`), the doors they opened, the undo records and cards of the rolls (for Rewind); whose turn it is
 * (`key`: a card it leaves to the table waits with it).
 */
const turnStage = (key = null) => ({ key, played: 0, records: [], messages: [], applied: [], doorsOpened: new Map(), docs: null, grid: null });

/** The battle's tokens by creature, for a turn's moves. */
const stageDocs = stage => (stage.docs ??= new Map(battle.run.units.map(x => [x.id, docOf(x.id)]).filter(([, d]) => d)));

/** The paths the turn's moves walk (the one it found its way by, else the scene's). */
const stageGrid = stage => (stage.grid ??= currentPathGrid() ?? pathGridFor([...stageDocs(stage).values()].map(d => d.object).filter(Boolean)));

/** The turn's events not played on the map yet, played: its moves, as far as it's got, and its getting ready. */
async function playSoFar(events, stage) {
  const fresh = events.slice(stage.played);
  stage.played = Math.max(stage.played, events.length);
  // (A door opened where it stood, with no move: opened on the map all the same, or the scene, read again, shuts it.)
  if ( fresh.some(e => MOVING.has(e.type) || (e.type === "door" && e.success)) ) {
    if ( setting("playOnMap") ) await playMoves(fresh, stageDocs(stage), stageGrid(stage), stage.doorsOpened, battle.scene, { speed: moveSpeed() });
    else await playMoves(fresh, stageDocs(stage), null, stage.doorsOpened, battle.scene, { instant: true });
  }
  await playGear(fresh, stage);
}

/** The kinds of event that get a creature ready on its own turn (behavior/prepare.js): a draw, a Reload, up off the ground. */
const READYING = new Set(["draw", "reload", "stand"]);

/**
 * A turn FastFighting plays: what its creature did to get ready, onto its sheet the system's way, in the order it did
 * it (the helper's readyGear, API 20: PF2e's Interact to draw or get a potion out, its Reload, its Stand), so the
 * system's next roll sees it. Its cards and undo records are the turn's (`into`: {records, messages}), for Rewind.
 */
async function playGear(events, into) {
  const adapter = getAdapter();
  if ( typeof adapter.readyGear !== "function" ) return;
  for ( const e of events ) {
    if ( !READYING.has(e.type) || !e.actorId || (e.turnOf ?? null) !== e.actorId ) continue;
    const doc = docOf(e.actorId);
    if ( !doc ) continue;
    const seen = new Set(game.messages.keys());
    try {
      const raw = await adapter.readyGear(doc, {
        step: e.type === "draw" && e.retrieve ? "retrieve" : e.type, actionId: e.actionId ?? null, gear: e.gear ?? null, item: e.item ?? "",
        hands: Number(e.hands) || 0, secret: secretRoll(doc)
      });
      into.records.push(...rollRecords(raw, doc));
    } catch ( err ) {
      console.error(`${MODULE_ID} | getting ${doc.name} ready on its sheet`, err);
    }
    into.messages.push(...cardsSince(seen).map(m => m.id));
  }
}

/**
 * A roll in a turn FastFighting plays, made with the system's own roller (engine/live.js systemRoll): the moves the
 * turn made before it played first (so the system sees range and flanking from where they stand), then the roll, its
 * cards in the chat; or a strike's damage card applied the system's way. Its cards and undo records are the turn's.
 * Returns what the engine takes of it, or null (the engine's own dice).
 */
async function turnRoll(request, events, stage) {
  const seen = new Set(game.messages.keys());
  // (A save or a check of a player's character may be rolled on its player's screen: theirs, for it, are the turn's too.)
  const roller = docOf(request.unitId);
  const asked = (request.roll === "save" || request.roll === "check") && battle.run.live.players.has(request.unitId);
  let out = null;
  await holdingPause(async () => {
    try {
      if ( request.roll === "apply" ) out = await applyStrike(request, stage);
      else {
        await playSoFar(events, stage);
        if ( request.roll === "strike" ) out = await rollTurnStrike(request, stage);
        else if ( request.roll === "save" || request.roll === "check" ) out = await rollTurnCheck(request);
        else if ( request.roll === "use" ) out = await useTurnAction(request);
        else if ( request.roll === "adjust" ) out = await adjustTurnRoll(request);
        else if ( request.roll === "damage" ) out = await rollTurnDamage(request);
        else if ( request.roll === "card" ) out = await showTurnCard(request);
        // (A damage card the engine now applies or settles by its own sum.)
        if ( SETTLED.has(request.roll) && typeof out?.card === "string" ) noteApplied(stage.applied, [out.card]);
      }
    } catch ( err ) {
      console.error(`${MODULE_ID} | the system's roll`, err);
      out = null;
    }
  });
  stage.messages.push(...cardsSince(seen, roller, { asked }).map(m => m.id));
  return out;
}

/**
 * A strike in a turn FastFighting plays, rolled with the system's own roller (the helper's rollStrike): its attack
 * card and, on a hit, its damage card. {attack, damage: {byType} | null, card: the damage card's id}, or null. What the
 * roll changed on the striker's sheet (PF2e's ammunition, loaded and spent) is undone with the turn (`stage`).
 */
async function rollTurnStrike({ unitId, targetId, action, attackNumber, advantage = 0 }, stage = null) {
  const adapter = getAdapter();
  const doc = docOf(unitId);
  const target = docOf(targetId);
  if ( !doc || !target ) return null;
  const seen = new Set(game.messages.keys());
  // (A blow pulled to knock out: the system's roll says so, at what it costs there: battle-state.js pullsThisRound.)
  const u = battle.run.byId.get(unitId);
  const pulled = !!u && pullsThisRound(battle.run, u) && !!battle.rules.pullsBlow?.(u, action);
  const raw = await adapter.rollStrike(doc, { action, target, attackNumber: Math.max(0, Number(attackNumber) || 0), advantage: Math.sign(Number(advantage) || 0), secret: secretRoll(doc), pulled });
  stage?.records.push(...rollRecords(raw, doc));
  const out = strikeRolled(raw);
  if ( !out?.damage ) return out;
  // (Its damage card, for the system to apply as its own: the one the helper names (null: none holds it all, the
  // engine's sum), else the first damage card it made.)
  if ( raw && Object.hasOwn(raw, "card") ) return { ...out, card: typeof raw.card === "string" && game.messages.get(raw.card) ? raw.card : null };
  return { ...out, card: damageCards(cardsSince(seen))[0] ?? null };
}

/** The ids of the damage cards among `messages`, as the helper reads them (its damageCard). */
function damageCards(messages) {
  const adapter = getAdapter();
  const ids = Object.fromEntries(battle.run.units.map(x => [tokenIdOf(x), x.id]));
  return messages.filter(m => {
    try {
      return adapter.damageCard?.(m, { ids })?.kind === "damage";
    } catch ( err ) {
      return false;
    }
  }).map(m => m.id);
}

/** The system's rolls whose damage card the engine applies, or settles by its own sum. */
const SETTLED = new Set(["strike", "damage", "card"]);

/**
 * Damage cards FastFighting applied itself, or settled by its own sum, noted by id into `into`: a turn's (its stage's,
 * then the turn's `applied`) or a player's turn's (`pc.applied`). Whoever made the card, the GM's browser takes the
 * system's Apply off it (applied-cards.js damageApplied), so it isn't applied twice. Ids this browser picked from the
 * chat as it applied them, never a flag on a card: anyone can flag their own. Returns those new to it.
 */
function noteApplied(into, ids) {
  const fresh = [...new Set(ids ?? [])].filter(id => typeof id === "string" && id && !into.includes(id));
  into.push(...fresh);
  return fresh;
}

/** Cards drawn again in this browser's chat, so a helper's own way with them shows at once (their Apply gone). */
function redraw(ids) {
  for ( const id of ids ?? [] ) {
    const message = game.messages.get(id);
    if ( message ) Promise.resolve(ui.chat?.updateMessage?.(message)).catch(() => null);
  }
}

/**
 * Has the battle noted this card as one whose damage FastFighting applied itself (noteApplied): a turn's kept
 * (`applied`), or the player's turn's going (`pc.applied`)? Pure.
 */
export function appliedIn(data, pc, id) {
  if ( typeof id !== "string" || !id ) return false;
  return !!pc?.applied?.includes(id) || (data?.turns ?? []).some(t => !!t?.applied?.includes(id));
}

/**
 * Does the table settle this itself, FastFighting applying none of it (API 21)? A player's character's heal, damage,
 * buff or debuff at another player's character (`by` and `target`: {id, pc}), FastFighting playing it for its player or
 * not, while the battle's Apply players' damage is off and its players run their characters (the planner's say: off,
 * FastFighting plays everyone, and applies everything). Never what one does to itself. Pure.
 */
export function tableSettles({ applyDamage = false, playersRun = true, by = null, target = null } = {}) {
  if ( applyDamage || playersRun === false || !by?.pc || !target?.pc ) return false;
  return !!by.id && !!target.id && by.id !== target.id;
}

/** A player's character, by its id in the run: the planner's kind of it, or a creature a player owns. */
function playerChar(id) {
  const u = battle?.run.byId.get(id);
  return !!u && (u.spec.kind === "pc" || !!docOf(id)?.actor?.hasPlayerOwner);
}

/** Does the table settle what `byId` does to `targetId`, in this battle (tableSettles)? */
const settlesHere = (byId, targetId) => !!battle && tableSettles({
  applyDamage: battle.data.applyDamage, playersRun: battle.data.playersRun,
  by: { id: byId, pc: playerChar(byId) }, target: { id: targetId, pc: playerChar(targetId) }
});

/**
 * What a turn's sheets don't get, the table settling it (tableSettles): for each other player's character, when a
 * player's character (`byId`) acts, its hit points (the turn's heals and damage at it wait in the Battle Vantage) and
 * the effects `byId` laid on it. A Map of id -> leaveToTable's options; empty when nothing's the table's.
 */
function tableLeaves(byId) {
  const out = new Map();
  if ( !battle || !byId ) return out;
  for ( const u of battle.run.units ) if ( settlesHere(byId, u.id) ) out.set(u.id, { hp: true, from: [byId] });
  return out;
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
 * A damage card applied the system's way to its target, in a turn FastFighting plays (the helper's applyDamageCard:
 * resistances, shields, temporary hit points, its own damage-taken card): {lost}, what the target lost by it; a heal's
 * healing card (`healing`, API 21), {gained}, what its sheet gained. The card and its undo records the turn's (`stage`).
 * Null: the engine's sum, or its heal.
 * A card the table settles itself (`io.settles`: tableSettles, a player's character's at another with Apply players'
 * damage off) isn't applied: off the turn's list of cards it applied, the system's own Apply put back on it (the
 * helper's leaveToTable, API 21), and a line for it in the Battle Vantage (Apply, Half, Double or Dismiss), as a player's
 * damage waits there, with the turn that left it (`stage.key`).
 * `io`: its Foundry parts (liveIo), given apart so the tests can say what each does.
 */
export async function settleCard({ unitId = null, targetId, card, applies, multiplier = 1, amount = null, healing = false }, stage, io) {
  const u = io.unit(targetId);
  const doc = io.doc(targetId);
  const message = card ? io.message(card) : null;
  if ( !u || !doc || !message ) return null;
  // (A player's character's at another, Apply players' damage off: the table's, left with the system's own Apply.)
  if ( io.settles(unitId, targetId) ) {
    const at = stage.applied.indexOf(message.id);
    if ( at >= 0 ) stage.applied.splice(at, 1);
    await io.unmark(message);
    const read = io.readCard(message);
    if ( read?.amount > 0 ) {
      await io.wait({
        key: io.randomKey(), messageId: message.id, targetId, amount: read.amount, save: false,
        healing: read.kind ? read.kind === "healing" : !!healing, by: io.nameOf(unitId), hpAt: await io.hpOf(u), turn: stage.key ?? null
      });
    }
    return null;
  }
  const was = await io.standing(u);
  // (With the reactions the system's application does itself, where they were used: the target's own, {shieldBlock:
  // true}; a friend's, {championsResistance: {by: the friend's token}}. A save's share of an area's damage: its
  // multiplier, half or double.)
  const times = Number.isFinite(Number(multiplier)) ? Math.max(0, Number(multiplier)) : 1;
  const reactions = {};
  for ( const a of [].concat(applies ?? []) ) {
    const key = typeof a === "string" ? a : a?.key;
    if ( typeof key === "string" && key ) reactions[key] = a?.by ? { by: io.doc(a.by) ?? null } : true;
  }
  // (And what the engine makes of it, after the target's resistances: for a system whose own application has none.)
  const options = { multiplier: times, ...(Number.isFinite(amount) ? { amount } : {}), ...reactions };
  stage.records.push(...(await io.apply(message, doc, options) ?? []));
  noteApplied(stage.applied, [message.id]);
  const now = await io.standing(u);
  if ( was === null || now === null ) return null;
  return healing ? { gained: Math.max(0, now - was) } : { lost: Math.max(0, was - now) };
}

/** The live battle's own parts for settleCard: this battle, this chat, this helper. */
const liveIo = () => ({
  unit: id => battle.run.byId.get(id) ?? null,
  doc: id => docOf(id) ?? null,
  message: id => game.messages.get(id) ?? null,
  settles: settlesHere,
  standing,
  // (FastFighting's own doing: no card waiting in the Battle Vantage is taken for applied by it, dropApplied.)
  apply: async (message, doc, options) => {
    applying++;
    try {
      return noteSettings((await getAdapter().applyDamageCard(message, doc, options)) ?? []);
    } finally {
      applying--;
    }
  },
  unmark: async message => {
    const adapter = getAdapter();
    try {
      if ( offers(adapter, "leaveToTable") ) await adapter.leaveToTable(message);
    } catch ( err ) {
      console.error(`${MODULE_ID} | leaving a card to the table`, err);
    }
    redraw([message.id]);
  },
  readCard: readDamageCard,
  hpOf,
  nameOf: id => battle.run.byId.get(id)?.spec.name ?? "",
  randomKey: () => foundry.utils.randomID(),
  wait: async line => {
    battle.data.waiting = [...(battle.data.waiting ?? []), line];
    changed();
    ui.notifications.info(fmt(line.healing ? "FASTFIGHTING.Live.HealingWaits" : "FASTFIGHTING.Live.DamageWaits", { name: line.by }));
    Hooks.callAll("fastFighting.damageWaits", battle);
  }
});

/** A card a turn FastFighting plays applies the system's way, or leaves to the table (settleCard). */
const applyStrike = (request, stage) => settleCard(request, stage, liveIo());

/**
 * A change the rules made to a roll the system made, in a turn FastFighting plays, carried out on its card the system's
 * way (the helper's adjustRolled: Ironsworn's momentum burned): {done}, done false where it couldn't (the rules then
 * keep the roll as it fell).
 */
async function adjustTurnRoll({ unitId, card, adjust }) {
  const doc = docOf(unitId);
  const message = typeof card === "string" ? game.messages.get(card) : null;
  if ( !doc || !message || !offers(getAdapter(), "adjustRolled") ) return { done: false };
  const raw = await getAdapter().adjustRolled(doc, { card, adjust, secret: secretRoll(doc) });
  return { done: !!raw?.done };
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
async function rollTurnDamage({ unitId, targetId, action, card }) {
  const doc = docOf(unitId);
  if ( !doc || !offers(getAdapter(), "rollDamage") ) return null;
  // (Its first target, for a roller that wants one: a Strike's damage, PF2e's Rend.)
  const target = targetId ? docOf(targetId) ?? null : null;
  const raw = await getAdapter().rollDamage(doc, { action, card: card ?? null, secret: secretRoll(doc), target });
  const byType = raw?.damage?.byType && typeof raw.damage.byType === "object"
    ? Object.fromEntries(Object.entries(raw.damage.byType).map(([k, v]) => [String(k), counted(v)]).filter(([, v]) => v !== null)) : null;
  if ( !byType || !Object.keys(byType).length ) return null;
  return { damage: { byType }, card: typeof raw.card === "string" && game.messages.get(raw.card) ? raw.card : null };
}

/**
 * Damage the engine rolled itself in a turn FastFighting plays, shown as the system's own damage card (the helper's
 * showTableRoll, API 20), the table rolls still waiting before it (`table`, the damage last) shown first, each the
 * system's way where it can, so the chat reads in order: {card}, the damage card's message id (null: none, the roll
 * a plain one), for the system to apply it ("apply"). Null (the rolls shown with the turn's others, the engine's sum)
 * while the battle plays through to the end, its rolls on the GMs' one card.
 */
async function showTurnCard({ table }) {
  if ( battle.data.auto || !Array.isArray(table) || !table.length || !offers(getAdapter(), "showTableRoll") ) return null;
  const cards = new Map();
  await showRolls(table, null, { cards });
  const card = cards.get(table.at(-1))?.[0] ?? null;
  return { card: card && game.messages.get(card) ? card : null };
}

/**
 * A table roll shown as its system's own card (the helper's showTableRoll, API 20): its messages' ids, or null for the
 * core's plain roll. They carry the battle's flags (`options.flags`), so they're FastFighting's: never read as a
 * player's own card, and deleted with their turn.
 */
async function showSystemRoll(roll, options) {
  const raw = await getAdapter().showTableRoll(roll, { ...options, scene: battle.scene });
  const ids = [].concat(raw ?? []).filter(id => typeof id === "string" && game.messages.get(id));
  return ids.length ? ids : null;
}

/** How long a player has to answer a question about their reaction (ms) before the GM is asked instead. */
const ASK_MS = 60000;

/**
 * A reaction's answer in a turn FastFighting plays: asked (of its player, or the GM), or already decided; and, used, a
 * strike the system rolls itself (systemRoll), {use, roll} for the engine; what its roll changed on the sheet undone
 * with the turn (`stage`).
 */
async function answerFor(request, stage = null) {
  // (A deal's question: behavior/deals.js.)
  if ( request.deal ) return answerDeal(request, stage);
  const use = request.decided ? true : await ask(request);
  if ( !use || !request.strike ) return use;
  // (A player's, theirs to roll while they're here; a creature's, or one whose players are gone, the system's.)
  const theirs = await playerRolls(request, stage);
  if ( theirs ) return theirs;
  const roll = await systemRoll(request, stage);
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
  // (And the cards of it: its player's own, and the engine's rolls shown in it so far, a foe's reaction's.)
  const messages = [...(pc.messages ?? []), ...(pc.rollCards ?? [])];
  // (And the doors foes opened answering its moves.)
  const doors = pc.doors ?? [];
  pc.messages = [];
  pc.rollCards = [];
  pc.doors = [];
  if ( records.length || messages.length || doors.length ) await holdingPause(() => takingBack(battleActors(), () => revertEntry(battle.scene, { records, messages, doors }, rewinding())));
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
function areaShapeFor(u, t, action, { from = u.pos, at = t.pos, point = null } = {}) {
  const key = `${u.id}|${t.id}|${action.id}|${spotKey(from)}|${spotKey(at)}|${spotKey(point)}`;
  if ( areaShapes.has(key) ) return areaShapes.get(key);
  let out = null;
  const cu = pointOf(u, from);
  // (A burst goes off where the engine picked it: a corner of t's space, or as its area's `center` says: burstPoint.)
  const burst = (action.area?.shape ?? "burst") === "burst" && action.area?.shape;
  const corner = burst ? point ?? (at === t.pos && u.pos && t.pos ? burstPoint(battle.run, u, t, action.area) : null) : null;
  const ct = corner ? pointOf(t, corner) : pointOf(t, at);
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
    const area = u && t && action ? areaShapeFor(u, t, action, { from: e.from ?? u.pos, at: e.at ?? t.pos, point: e.point ?? null }) : null;
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
/** The reaction a player is rolling, for the Battle Vantage (its name and key, and whose it is), or null. */
export const waitingReaction = () => (waiting ? { key: waiting.key, name: waiting.name, unitId: waiting.unitId } : null);

/**
 * A player's reaction, theirs to roll as they would on their turn: a card to them and the GMs (roll it, then I've done
 * my reaction), and the battle waits, the Battle Vantage saying so (They've rolled it, Go on without it). What they
 * rolled since is read off their cards (the helper's readTurn) and played as the strike's roll; its damage, as players'
 * damage goes, its damage cards noted as applied into `into` (a turn's stage: noteApplied). Null when none of its
 * players is here, or the helper can't read their cards.
 */
async function playerRolls(request, into = null) {
  const run = battle.run;
  const adapter = getAdapter();
  const doc = docOf(request.unitId);
  if ( !run.live.players.has(request.unitId) || !offers(adapter, "readTurn") || !doc?.actor ) return null;
  const owners = game.users.filter(u => !u.isGM && u.active && doc.actor.testUserPermission(u, "OWNER"));
  if ( !owners.length ) return null;
  checkFast({ asks: "player" });
  const name = run.byId.get(request.unitId)?.spec.name ?? "";
  const target = request.byId ? run.byId.get(request.byId)?.spec.name ?? "" : "";
  const from = Date.now();
  const ChatMessage = chatMessageClass();
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
    if ( into ) noteApplied(into.applied, damageCards(messages));
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

/** What of an undo record a strike's roll may return: the striker's own sheet, its data and its items. */
const SHEET_RECORD = ["actorUpdate", "itemUpdates", "createdItems", "deletedItems"];

/**
 * The undo records a strike's roll returns (rollStrike's `records`, API 20: what it changed on the striker's sheet
 * beyond its cards, PF2e's ammunition loaded and spent), whether or not it says how the strike went. Only those about
 * the striker's own token and actor, and only their sheet's part: a roll may come from a player's screen, and an undo
 * record is only data.
 */
export function rollRecords(raw, doc) {
  if ( !Array.isArray(raw?.records) || !doc ) return [];
  const own = new Set([doc.uuid, doc.actor?.uuid].filter(Boolean));
  const out = [];
  for ( const r of raw.records ) {
    if ( !r || typeof r !== "object" ) continue;
    const named = [r.tokenUuid, r.actorUuid].filter(x => x !== undefined && x !== null);
    if ( !named.length || !named.every(x => own.has(x)) ) continue;
    const kept = { tokenUuid: r.tokenUuid ?? null, actorUuid: r.actorUuid ?? null };
    for ( const key of SHEET_RECORD ) if ( r[key] !== undefined ) kept[key] = r[key];
    out.push(kept);
  }
  return out;
}

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
 * Where given, what the roll changed on the striker's sheet goes into `into.records` (its undo records, the turn's or
 * the player's turn's), and its damage cards, settled by the engine, into `into.applied` (noteApplied). Returns
 * {attack: {degree, natural, total}, damage: {byType} | null}, or null (the engine rolls it).
 */
async function systemRoll({ unitId, byId, strike }, into = null) {
  const adapter = getAdapter();
  const doc = docOf(unitId);
  const target = byId ? docOf(byId) : null;
  if ( !offers(adapter, "rollStrike") || !doc || !strike ) return null;
  const run = battle.run;
  const player = run.live.players.has(unitId);
  const seen = new Set(game.messages.keys());
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
  into?.records.push(...rollRecords(roll, doc));
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
  // (Its damage cards, this browser's or its players' for it: never the card a player's screen names.)
  if ( into ) noteApplied(into.applied ??= [], damageCards(cardsSince(seen, doc, { asked: player })));
  return out;
}

/** A GM's say on a player's reaction's damage: Apply (1), Half (0.5), Double (2) or Dismiss (0). */
async function askDamage(by, target, amount) {
  checkFast({ asks: "damage" });
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

/**
 * What the helper's rollSave or rollCheck hears of a request: the save's or the check's own, the other token, and the
 * engine's net advantage on it (API 24: above 0 advantage, below disadvantage).
 */
function checkOptions(kind, request, other) {
  const action = { id: request.action?.id ?? null, name: request.action?.name ?? "" };
  const advantage = Math.sign(Number(request.advantage) || 0);
  return kind === "save"
    ? { save: request.save ?? null, dc: request.dc, action, from: other ?? null, advantage }
    : {
      purpose: request.purpose ?? null, skill: request.skill ?? null, against: request.against ?? null, attackNumber: Number.isInteger(request.attackNumber) ? request.attackNumber : null,
      standoff: request.standoff === true, dc: request.dc, action, target: other ?? null, advantage,
      // (A deal's, API 26: its kind, what it asks, and whether it's made without words.)
      ...(request.deal ? { deal: { kind: String(request.deal.kind ?? ""), ask: request.deal.ask ?? null, wordless: request.deal.wordless === true } } : {})
    };
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

/** A save or a check as the helper says it went, made sure of: {degree, natural, total, dice, card}, or null (no degree). */
function checkRolled(roll) {
  const degree = counted(roll?.degree);
  if ( degree === null ) return null;
  const out = { degree: Math.min(3, Math.round(degree)), natural: counted(roll.natural), total: counted(roll.total, -Infinity) };
  if ( typeof roll.card === "string" && game.messages.get(roll.card) ) out.card = roll.card;
  const dice = roll.dice && typeof roll.dice === "object" ? Object.fromEntries(Object.entries(roll.dice).filter(([, v]) => Number.isFinite(v))) : null;
  if ( dice && Object.keys(dice).length ) out.dice = dice;
  return out;
}

/**
 * A save or a check the system's helper can't roll (it said so: {gm: true}), settled by a GM: how it went, a critical
 * success to a critical failure, or the engine rolls it. {degree} or null.
 */
async function gmSettles(request) {
  checkFast({ asks: "roll" });
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
  checkFast({ asks: "question" });
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

/**
 * A deal's question (engine/live.js dealAsk). "talkOk", where the system doesn't track languages: the GM says whether
 * the two can talk at all. "answer": a player's character's answer to a deal, its player's (a card to them and the GMs;
 * no answer in time, or no player here, and its nature decides), then the GM's final say (the review): approved, the
 * answer stands; denied, no deal ({answer: "refuse", by: "gm"}). Its cards go with the turn (`stage`), for Rewind.
 */
async function answerDeal(request, stage = null) {
  const run = battle.run;
  const name = id => (id ? run.byId.get(id)?.spec.name ?? "" : "");
  if ( request.deal === "talkOk" ) {
    return !!(await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("FASTFIGHTING.Deal.TalkOkTitle") },
      content: `<p>${escape(fmt("FASTFIGHTING.Deal.TalkOk", { actor: name(request.unitId), target: name(request.targetId) }))}</p>`
    }));
  }
  if ( request.deal !== "answer" ) return null;
  const asked = await askPlayerDeal(request);
  if ( asked.card ) stage?.messages.push(asked.card.id);
  // (No answer from its player: its nature's, worked out now, so the GM reviews what it comes to.)
  const t = run.byId.get(request.targetId);
  const said = asked.said ?? (t ? dealAnswer(run, t, request.kind, request.degree ?? 1, { chance: q => Math.random() < q }) : null);
  const verdict = await reviewDeal(request, { said, player: true, nature: !asked.said, stage });
  const out = verdict === "deny" ? { answer: "refuse", by: "gm" } : said ? { answer: said, by: asked.said ? "player" : "check" } : null;
  await asked.card?.update({ content: dealCard(dealText(request, { open: true }), verdictText(request, verdict, said)) });
  return out;
}

/* -------------------------------------------- */
/*  Deals                                       */
/* -------------------------------------------- */

/**
 * Deals waiting in this GM's browser, by their key: a player's answer ({resolve, pcToken}), or the GM's review ({review,
 * text, resolve}).
 */
const dealsWaiting = new Map();

/** The deals waiting on the GM's review, for the Battle Vantage: [{key, text}]. */
export const waitingDeals = () => [...dealsWaiting.entries()].filter(([, d]) => d.review).map(([key, d]) => ({ key, text: d.text }));

/** A roll's degree of success in words, by its number (0 critical failure ... 3 critical success). */
const DEGREES = ["FASTFIGHTING.Log.Degree0", "FASTFIGHTING.Log.Degree1", "FASTFIGHTING.Log.Degree2", "FASTFIGHTING.Log.Degree3"];

/**
 * A deal in words: who offers (or asks, or tells) what of whom. `request`: a deal's question (engine/live.js dealAsk).
 * `open`: for the players' eyes, a creature whose name they haven't learned called as someone (openName).
 */
function dealText(request, { open = false } = {}) {
  const run = battle.run;
  const name = id => (id ? (open ? openName(id) : run.byId.get(id)?.spec.name ?? "") : "");
  const data = { actor: name(request.unitId), target: name(request.targetId), goods: goodsText(request.terms), ask: askText(request.terms?.ask) };
  return fmt({ bribe: "FASTFIGHTING.Deal.OfferBribe", extort: "FASTFIGHTING.Deal.OfferExtort", toll: "FASTFIGHTING.Deal.OfferToll" }[request.kind] ?? "FASTFIGHTING.Deal.OfferScare", data);
}

/** A deal's card: what it is, and a line under it (its state), with its buttons. */
const dealCard = (text, state = "", buttons = "") => inertHtml(`<div class="fast-fighting-live"><p>${escape(text)}</p>${state ? `<p class="hint">${escape(state)}</p>` : ""}${buttons}</div>`);

/**
 * A player's character offered a deal: a card to its owners who are here and the GMs (Accept, Refuse), and the battle
 * waits on it, as on a player's reaction. {said: "accept" | "refuse" | null (no answer in time, or nobody here to ask),
 * card}: its card says the GM is reviewing it.
 */
async function askPlayerDeal(request) {
  const doc = docOf(request.targetId);
  const owners = doc?.actor ? game.users.filter(u => !u.isGM && u.active && doc.actor.testUserPermission(u, "OWNER")) : [];
  if ( !owners.length ) return { said: null, card: null };
  checkFast({ asks: "player" });
  const ChatMessage = chatMessageClass();
  const text = dealText(request, { open: true });
  const buttons = `<div class="ff-deal-buttons"><button type="button" data-ff-live="dealAccept"><i class="fa-solid fa-check"></i> ${escape(loc("FASTFIGHTING.Deal.Accept"))}</button>
    <button type="button" data-ff-live="dealRefuse"><i class="fa-solid fa-xmark"></i> ${escape(loc("FASTFIGHTING.Deal.Refuse"))}</button></div>`;
  const card = await ChatMessage.create({
    content: dealCard(text, "", buttons), speaker: chronicle(), whisper: [...new Set([...gmIds(), ...owners.map(u => u.id)])],
    flags: { [MODULE_ID]: { live: { battle: battle.data.id, deal: request.key, pcToken: doc.uuid } } }
  });
  const said = await new Promise(resolve => {
    const late = setTimeout(() => resolve(null), ASK_MS);
    dealsWaiting.set(request.key, { pcToken: doc.uuid, resolve: answer => {
      clearTimeout(late);
      resolve(answer);
    } });
    changed();
  });
  dealsWaiting.delete(request.key);
  const who = doc.actor.name;
  const state = said ? fmt(said === "accept" ? "FASTFIGHTING.Deal.Accepted" : "FASTFIGHTING.Deal.Refused", { name: who }) : fmt("FASTFIGHTING.Deal.NoAnswer", { name: who });
  await card?.update({ content: dealCard(text, `${state} ${loc("FASTFIGHTING.Deal.Reviewing")}`) });
  changed();
  return { said, card };
}

/**
 * A player's turn, its owner here: a card to them and the GMs, "I want to bribe or extort", that opens the deal dialog
 * (apps/deal-dialog.js) in their browser. The next card posted takes it away (deal cards' hook, registerLiveBattles).
 */
async function dealTurnCard(u) {
  const doc = docOf(u.id);
  const owners = doc?.actor ? game.users.filter(x => !x.isGM && x.active && doc.actor.testUserPermission(x, "OWNER")) : [];
  if ( !owners.length || !battle.run.prep.options.talking || typeof getAdapter()?.giveables !== "function" ) return;
  const ChatMessage = chatMessageClass();
  const card = await ChatMessage.create({
    content: dealCard(fmt("FASTFIGHTING.Deal.TurnCard", { name: doc.name }), "", `<div class="ff-deal-buttons"><button type="button" data-ff-live="dealOpen"><i class="fa-solid fa-comments-dollar"></i> ${escape(loc("FASTFIGHTING.Deal.OpenDeal"))}</button></div>`),
    speaker: chronicle(), whisper: [...new Set([...gmIds(), ...owners.map(x => x.id)])],
    // (May it ask a toll: it acted first, or surprised them. What the story calls those whose names the players haven't
    // learned, by token: so the dialog does too.)
    flags: { [MODULE_ID]: { live: { battle: battle.data.id, dealOpen: true, pcToken: doc.uuid, toll: mayToll(battle.run, u), names: openNames() } } }
  });
  if ( !card ) return;
  battle.pc.dealCard = card.id;
  battle.pc.rollCards.push(card.id);
}

/**
 * No word understood: the creature answers in its own tongue, as anyone at the table would hear it (speak), letters of
 * the language's own alphabet (FASTFIGHTING.Deal.Gibberish) strung into nothing.
 */
async function gibberish(doc) {
  const letters = [...loc("FASTFIGHTING.Deal.Gibberish")];
  if ( !letters.length ) return null;
  const pick = () => letters[Math.floor(Math.random() * letters.length)];
  const words = Array.from({ length: 3 + Math.floor(Math.random() * 4) }, () => Array.from({ length: 2 + Math.floor(Math.random() * 6) }, pick).join(""));
  const text = words.join(" ");
  return speak(doc, `${text.charAt(0).toLocaleUpperCase(game.i18n.lang)}${text.slice(1)}${["!", "?", "…"][Math.floor(Math.random() * 3)]}`);
}

/** Understood: the creature mulls it over aloud (speak), one of its sayings at random. */
async function mullOver(doc) {
  const said = sayings();
  return said.length ? speak(doc, said[Math.floor(Math.random() * said.length)]) : null;
}

/**
 * What a creature says to a deal it understands, in the reader's language: every one FASTFIGHTING.Deal.Sayings lists
 * (as many as a language has), else English's.
 */
function sayings() {
  const key = "FASTFIGHTING.Deal.Sayings";
  const list = o => (o && typeof o === "object" ? Object.values(o).filter(s => typeof s === "string" && s.trim()) : []);
  const here = list(foundry.utils.getProperty(game.i18n.translations, key));
  return here.length ? here : list(foundry.utils.getProperty(game.i18n._fallback ?? {}, key));
}

/** A creature speaks, as anyone at the table hears it: its words on the map and in the chat. Kept with the turn. */
async function speak(doc, said) {
  if ( !doc ) return null;
  const ChatMessage = chatMessageClass();
  // (Under the name the players know it by: someone, numbered, where they haven't learned its own.)
  const u = battle.run.units.find(x => tokenIdOf(x) === doc.id);
  const alias = u ? someoneNow().get(u.id) : null;
  const speaker = { ...ChatMessage.getSpeaker({ token: doc }), ...(alias ? { alias } : {}) };
  const message = await ChatMessage.create({ content: escape(said), speaker, style: CONST.CHAT_MESSAGE_STYLES.IC }, { chatBubble: true });
  if ( message && battle.pc ) battle.pc.rollCards.push(message.id);
  return message;
}

/** Deals a player is making on their turn, prepared and waiting for their roll: by key. */
const dealsPending = new Map();

/** The engine's creature on a token here (its uuid), or null. */
const unitOnToken = async uuid => {
  const doc = typeof uuid === "string" ? await fromUuid(uuid) : null;
  return doc && battle ? battle.run.units.find(x => tokenIdOf(x) === doc.id) ?? null : null;
};

/**
 * A player's deal, from their browser (apps/deal-dialog.js; Foundry says who asks: one who owns the character, or a
 * GM). "prepare": on their own turn, with the goods on their sheet, whether the two understand each other (no word in
 * common: the creature answers in gibberish; a system without languages: the GM says), and the DC: {ok, key, dc,
 * purpose, wordless} or {ok: false, reason}. "rolled": their roll, the target's answer (its player's, or its nature's),
 * the GM's review, and the deal held with the turn (liveFact): {ok, answer}.
 */
async function answerDealRequest(data, { user } = {}) {
  if ( !battle || !playsHere() ) return { ok: false, reason: "none" };
  if ( data?.stage === "targets" ) return dealTargets(data, user);
  if ( data?.stage === "prepare" ) return prepareDeal(data.deal ?? {}, user);
  if ( data?.stage === "rolled" ) return rolledDeal(data, user);
  return { ok: false, reason: "none" };
}

/**
 * Does u perceive t (seen, heard, or found by its other senses: behavior/senses.js), from where its token stands now,
 * moved this turn? Not one hidden from the start and not yet given away.
 */
function perceivesNow(run, u, t, doc) {
  if ( t.spec.hidden && !t.revealed ) return false;
  const p = doc?.object ? positionOf(doc.object) : null;
  return perceives(run, p ? { ...u, pos: { x: p.x, y: p.y }, adjacent: null } : u, t);
}

/**
 * Whom a player's character could make a deal with now (apps/deal-dialog.js): every creature standing that it
 * perceives, by token id, and what the players call those whose names they haven't learned. {ok, ids, names}.
 */
async function dealTargets(data, user) {
  const u = await unitOnToken(data?.pcToken);
  const doc = u ? docOf(u.id) : null;
  if ( !u || !doc?.actor || (!user?.isGM && !doc.actor.testUserPermission(user, "OWNER")) ) return { ok: false, ids: [] };
  const run = battle.run;
  const ids = run.units.filter(t => t !== u && isStanding(t) && perceivesNow(run, u, t, doc)).map(t => docOf(t.id)?.id).filter(Boolean);
  return { ok: true, ids, names: openNames() };
}

async function prepareDeal(deal, user) {
  const run = battle.run;
  const u = await unitOnToken(deal.pcToken);
  const t = await unitOnToken(deal.targetToken);
  const doc = u ? docOf(u.id) : null;
  if ( !u || !t || !doc?.actor || t === u || !isStanding(t) ) return { ok: false, reason: "none" };
  if ( !user?.isGM && !doc.actor.testUserPermission(user, "OWNER") ) return { ok: false, reason: "none" };
  if ( battle.pc?.id !== u.id ) return { ok: false, reason: "notYourTurn" };
  // (Only with one it perceives: none it hasn't seen, heard or otherwise found.)
  if ( !perceivesNow(run, u, t, doc) ) return { ok: false, reason: "unseen" };
  // (Within talking range, by the grid's own measure, as the dialog lists them.)
  const there = docOf(t.id)?.object;
  const feet = doc.object && there ? canvas.grid.measurePath([doc.object.center, there.center]).distance : null;
  if ( feet !== null && feet > talkRange(run) ) return { ok: false, reason: "tooFar" };
  const adapter = getAdapter();
  const goods = adapter.giveables?.(doc.actor) ?? { money: 0, items: [] };
  const kind = deal.kind === "extort" ? (Number(deal.money) > 0 ? "extort" : "scare") : deal.kind === "bribe" ? "bribe" : deal.kind === "toll" && Number(deal.money) > 0 ? "toll" : null;
  if ( !kind ) return { ok: false, reason: "none" };
  if ( kind === "toll" && !mayToll(run, u) ) return { ok: false, reason: "noToll" };
  // (What they give: what's on their sheet, no more; what they ask: an amount of money, or nothing but going.)
  const items = kind === "bribe" ? (Array.isArray(deal.items) ? deal.items : []).map(i => {
    const item = goods.items.find(x => x.id === i?.id);
    return item ? { id: item.id, name: item.name, value: item.value, count: Math.max(1, Math.min(item.quantity, Math.round(Number(i.count) || 1))) } : null;
  }).filter(Boolean) : [];
  const money = Math.max(0, Math.round(Number(deal.money) || 0));
  if ( kind === "bribe" && money > goods.money ) return { ok: false, reason: "short" };
  if ( kind === "bribe" && !money && !items.length ) return { ok: false, reason: "nothing" };
  const terms = { kind, ask: kind === "bribe" && deal.ask === "avoid" ? "avoid" : "leave", money: kind === "scare" ? 0 : money, items, denominations: u.spec.valuables?.denominations ?? null };
  // (Understood: a word in common, or a threat that needs none where the system has those.)
  const how = means(run, u, t, kind);
  if ( !how ) {
    await gibberish(docOf(t.id));
    return { ok: false, reason: "language" };
  }
  if ( run.prep.rules.languages === false && how === "words" ) {
    const name = x => x.spec.name;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("FASTFIGHTING.Deal.TalkOkTitle") },
      content: `<p>${escape(fmt("FASTFIGHTING.Deal.TalkOk", { actor: name(u), target: name(t) }))}</p>`
    });
    if ( !ok ) {
      await gibberish(docOf(t.id));
      return { ok: false, reason: "unheard" };
    }
  }
  // (The attempt begins: the one approached answers aloud, in its own tongue where it can't follow the words.)
  await (how === "wordless" ? gibberish : mullOver)(docOf(t.id));
  const key = foundry.utils.randomID();
  const dc = dealDC(run, u, t, terms);
  const skill = (adapter.skillsOf?.(doc.actor) ?? []).find(s => s.key === deal.skill);
  // (One deal at a time for each player: a new one takes the place of any not rolled yet.)
  for ( const [k, v] of dealsPending ) if ( v.user === user.id ) dealsPending.delete(k);
  // (The skill's name from the sheet's own skills; free words, short, only where the system lists none.)
  const skillName = skill?.label ?? (adapter.skillsOf ? "" : String(deal.skill ?? "").slice(0, 40));
  dealsPending.set(key, { u: u.id, t: t.id, terms, dc, dcStat: t.spec.social?.resist?.[pitchOf(kind)]?.label ?? "DC", wordless: how === "wordless", skill: skillName, user: user.id });
  return { ok: true, key, dc, purpose: kind, wordless: how === "wordless" };
}

async function rolledDeal(data, user) {
  const p = dealsPending.get(data?.key);
  if ( !p || (p.user !== user?.id && !user?.isGM) ) return { ok: false, reason: "none" };
  dealsPending.delete(data.key);
  const run = battle.run;
  const u = run.byId.get(p.u);
  const t = run.byId.get(p.t);
  if ( !u || !t || battle.pc?.id !== u.id ) return { ok: false, reason: "notYourTurn" };
  // (Its roll's cards, its player's: kept out of what the turn's cards are read for, at its end.)
  const cards = (Array.isArray(data.cards) ? data.cards : []).filter(id => typeof id === "string" && game.messages.get(id)?.author?.id === user?.id);
  if ( cards.length ) battle.pc.dealRolls = [...(battle.pc.dealRolls ?? []), ...cards];
  const natural = Number.isFinite(Number(data.roll?.natural)) ? Number(data.roll.natural) : null;
  const total = Number.isFinite(Number(data.roll?.total)) ? Number(data.roll.total) : null;
  // (Its degree worked out here from its total against the DC; only without a total, the one its player's browser gave.)
  let degree = total !== null ? run.prep.rules.degreeOfSuccess(natural ?? 10, total, p.dc, "check", 20) : null;
  if ( degree === null && Number.isInteger(data.roll?.degree) ) degree = clamp(data.roll.degree, 0, 3);
  if ( degree === null ) return { ok: false, reason: "none" };
  const roll = { degree, natural, total };
  const request = {
    key: `deal|${p.u}|${p.t}|${data.key}`, deal: "answer", unitId: p.u, targetId: p.t, kind: p.terms.kind, terms: p.terms, degree, dc: p.dc, dcStat: p.dcStat,
    skill: p.skill, natural, total, wordless: p.wordless, insight: dealInsight(run, u, t, p.terms, degree)
  };
  // (Its answer: its player's, a player's character's whose player is here; else its nature's.)
  const player = run.live.players.has(t.id);
  const asked = player ? await askPlayerDeal(request) : { said: null, card: null };
  if ( asked.card ) battle.pc?.rollCards.push(asked.card.id);
  const would = asked.said ?? dealAnswer(run, t, p.terms.kind, degree, { chance: q => Math.random() < q });
  const verdict = await reviewDeal(request, { said: would, player, nature: !asked.said });
  const answer = verdict === "deny" ? "refuse" : would;
  const by = verdict === "deny" ? "gm" : asked.said ? "player" : "check";
  await asked.card?.update({ content: dealCard(dealText(request, { open: true }), verdictText(request, verdict, would)) });
  await liveFact({ kind: "deal", id: t.id, byId: u.id, deal: { terms: p.terms, skill: p.skill, wordless: p.wordless, dc: p.dc, dcStat: p.dcStat, roll, said: { answer, by } } });
  // (Told at once, to its player and the GMs: the turn tells the rest as it ends.)
  const owners = game.users.filter(x => x.id === p.user || x.isGM).map(x => x.id);
  const ChatMessage = chatMessageClass();
  const card = await ChatMessage.create({
    content: dealCard(dealText(request, { open: true }), fmt(DEAL_ANSWERS[answer] ?? DEAL_ANSWERS.refuse, { name: openName(t.id) })), speaker: chronicle(), whisper: owners,
    flags: { [MODULE_ID]: { live: { battle: battle.data.id, dealDone: true } } }
  });
  if ( card ) battle.pc?.rollCards.push(card.id);
  changed();
  return { ok: true, answer };
}

/** A deal's answer, told on its card. */
const DEAL_ANSWERS = Object.freeze({ accept: "FASTFIGHTING.Deal.Accepted", refuse: "FASTFIGHTING.Deal.Refused", offended: "FASTFIGHTING.Deal.Offended" });

/** A player's answer to a deal, from their browser (Foundry says who asks: one who owns the character, or a GM). */
function answerDealQuery(data, { user } = {}) {
  const waiting = dealsWaiting.get(data?.key);
  if ( !waiting?.pcToken || (data.answer !== "accept" && data.answer !== "refuse") ) return false;
  const actor = fromUuidSync(waiting.pcToken)?.actor;
  if ( !user?.isGM && !actor?.testUserPermission(user, "OWNER") ) return false;
  waiting.resolve(data.answer);
  return true;
}

/**
 * The GM's final say on a deal: a card for the GMs only (Review) and the Battle Vantage's deals waiting, and the review
 * window at once. Resolves with "approve" or "deny". `said`: a player's answer to it, where its target is theirs.
 */
async function reviewDeal(request, { said = null, player = false, nature = false, stage = null } = {}) {
  const text = dealText(request);
  const context = reviewContext(request, { said, player, nature });
  const ChatMessage = chatMessageClass();
  const card = await ChatMessage.create({
    content: dealCard(fmt("FASTFIGHTING.Deal.ReviewCard", { what: text }), "", `<button type="button" data-ff-live="dealReview"><i class="fa-solid fa-scale-balanced"></i> ${escape(loc("FASTFIGHTING.Deal.Review"))}</button>`),
    speaker: chronicle(), whisper: gmIds(), flags: { [MODULE_ID]: { live: { battle: battle.data.id, dealReview: request.key } } }
  });
  if ( card ) stage?.messages.push(card.id);
  const verdict = await new Promise(resolve => {
    dealsWaiting.set(request.key, { review: true, text, context, resolve });
    openDealReview(request.key);
    changed();
  });
  dealsWaiting.delete(request.key);
  await card?.update({ content: dealCard(text, verdictText(request, verdict, said)) });
  changed();
  return verdict;
}

/** What the GM's say on a deal came to, in words: turned down; or let stand, and its answer where it's known. */
function verdictText(request, verdict, said) {
  if ( verdict === "deny" ) return loc("FASTFIGHTING.Deal.Denied");
  const name = openName(request.targetId);
  const answer = DEAL_ANSWERS[said];
  return answer ? `${loc("FASTFIGHTING.Deal.Settled")} ${fmt(answer, { name })}` : loc("FASTFIGHTING.Deal.Settled");
}

/** The review window of a deal waiting (the card's Review, the Battle Vantage's): one for each deal. */
export function openDealReview(key) {
  const waiting = dealsWaiting.get(key);
  if ( !waiting?.review ) return false;
  const id = String(key).replace(/[^A-Za-z0-9_-]/g, "_");
  const open = foundry.applications.instances.get(`ff-deal-review-${id}`);
  if ( open ) {
    open.bringToFront?.();
    return true;
  }
  // (The window's class, once one is wanted: it's Foundry's to build on.)
  import("../apps/deal-review.js").then(({ DealReview }) => new DealReview({ id, context: waiting.context, decide: verdict => waiting.resolve(verdict) }).render({ force: true }));
  return true;
}

/**
 * What the review window shows: the deal, the roll against its DC, the player's answer, and what FastFighting makes of
 * it (engine/behavior/deals.js dealInsight).
 */
function reviewContext(request, { said = null, player = false, nature = false } = {}) {
  const run = battle.run;
  const name = id => (id ? run.byId.get(id)?.spec.name ?? "" : "");
  const rows = [];
  if ( Number.isFinite(request.total) ) {
    rows.push({
      label: loc("FASTFIGHTING.Deal.Roll"),
      value: fmt("FASTFIGHTING.Deal.RollLine", { skill: request.skill ?? "", total: request.total, natural: request.natural ?? "", stat: request.dcStat ?? "DC", dc: request.dc ?? "", degree: loc(DEGREES[request.degree ?? 1] ?? DEGREES[1]) })
    });
  }
  if ( request.wordless ) rows.push({ label: loc("FASTFIGHTING.Deal.Wordless"), value: loc("FASTFIGHTING.Deal.WordlessYes") });
  const answer = { accept: "FASTFIGHTING.Deal.Accept", refuse: "FASTFIGHTING.Deal.Refuse", offended: "FASTFIGHTING.Deal.Insulted" }[said];
  if ( player && !nature ) rows.push({ label: loc("FASTFIGHTING.Deal.PlayerSaid"), value: answer ? loc(answer) : loc("FASTFIGHTING.Deal.NoneYet") });
  else if ( answer ) rows.push({ label: loc("FASTFIGHTING.Deal.ItsAnswer"), value: loc(answer) });
  const i = request.insight;
  const insight = i ? [
    { label: loc("FASTFIGHTING.Deal.Greed"), value: i.greed },
    { label: loc("FASTFIGHTING.Deal.Nerve"), value: i.nerve },
    { label: loc("FASTFIGHTING.Deal.Loyalty"), value: i.loyalty },
    { label: loc("FASTFIGHTING.Deal.Worth"), value: fmt("FASTFIGHTING.Deal.WorthLine", { worth: goodsText({ money: i.worth, denominations: request.terms?.denominations ?? null }) || "0", purse: goodsText({ money: i.purse, denominations: request.terms?.denominations ?? null }) || "0" }) },
    { label: loc("FASTFIGHTING.Deal.RefuseChance"), value: `${i.refuse}%` },
    ...(request.kind === "bribe" ? [{ label: loc("FASTFIGHTING.Deal.TurnChance"), value: `${i.turn}%` }] : [])
  ] : [];
  return { heading: `${name(request.unitId)} → ${name(request.targetId)}`, what: dealText(request), rows, insight };
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
 * Whether a card counts as a player's character's turn's: made in this browser (where the battle plays: a foe's
 * reaction in it, rolled here), or by a GM or one who owns it, speaking for it (its token or actor). Anyone can name any
 * speaker on a card, so another player's card at its turn isn't its doing; and nobody else's chat, nor its player's
 * own words as themselves, is the turn's (Rewind would delete it).
 */
function madeFor(message, pcId) {
  const author = message.author;
  if ( !author ) return false;
  if ( author.id === game.user.id ) return true;
  const doc = docOf(pcId);
  const speaks = (!!doc && message.speaker?.token === doc.id) || (!!doc?.actor && message.speaker?.actor === doc.actor.id);
  return speaks && (author.isGM || !!doc.actor?.testUserPermission(author, "OWNER"));
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
  const card = readDamageCard(message);
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

/** A damage card as the helper reads it (its damageCard): {amount, kind, targets, save}, or null. */
function readDamageCard(message) {
  if ( !message ) return null;
  try {
    return getAdapter().damageCard(message, { ids: Object.fromEntries(battle.run.units.map(u => [tokenIdOf(u), u.id])) }) ?? null;
  } catch ( err ) {
    console.error(`${MODULE_ID} | reading a damage card`, err);
    return null;
  }
}

/**
 * Is players' damage waiting on a GM still what the GM is shown? Its card's total as it was put before them
 * (`line.amount`), and as it reads now (`card`, readDamageCard's): a player may change their own card meanwhile.
 */
export const damageStill = (line, card) => !!card && Number.isFinite(card.amount) && card.amount === line?.amount && card.kind === (line.healing ? "healing" : "damage");

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
 * button (or a player theirs, on a card the table settles: settleCard): the oldest line for it goes, so it isn't applied
 * a second time. The player's turn's lines first, then the battle's.
 */
async function dropApplied(actor) {
  if ( !battle ) return;
  const pc = battle.pc;
  for ( const [lines, put] of [[pc?.damage, rest => { pc.damage = rest; }], [battle.data.waiting, rest => { battle.data.waiting = rest; }]] ) {
    for ( const line of lines ?? [] ) {
      const u = line.targetId ? battle.run.byId.get(line.targetId) : null;
      if ( !u || docOf(u.id)?.actor !== actor || line.hpAt === null ) continue;
      const hp = await hpOf(u);
      if ( hp === null || (line.healing ? hp <= line.hpAt : hp >= line.hpAt) ) continue;
      put(lines.filter(d => d !== line));
      await keep();
      return;
    }
  }
}

/**
 * A damage card applied to a creature (times `multiplier`), through the system: kept with the turn (`into`: the player's
 * turn going on, or a turn kept, its records and the cards it applied), for Rewind.
 */
async function applyDamage(into, message, u, multiplier = 1) {
  const doc = docOf(u.id);
  if ( !doc || !message ) return false;
  let records;
  applying++;
  try {
    records = noteSettings((await getAdapter().applyDamageCard(message, doc, { multiplier })) ?? []);
    into.records.push(...records);
    redraw(noteApplied(into.applied ??= [], [message.id]));
    await markFallen(into, u);
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
async function markFallen(into, u) {
  const s = (await readStates())[u.id];
  if ( !s || !Number.isFinite(s.hp) || s.hp > 0 ) return;
  const copy = restoreRun(battle.spec, battle.rules, snapshotRun(battle.run, { log: false }));
  syncFromSheets(copy, { [u.id]: s });
  const before = captureAll(copy);
  if ( !liveDrop(copy, u.id) ) return;
  await writeChanges(before, captureAll(copy), into.records, { messages: cardsOf(into) });
}

/**
 * A GM's answer to players' damage waiting in the Battle Vantage: applied (times `multiplier`, to `targetId`, picked
 * where the card had none) or dismissed. True if it was taken. A player's turn's own (`pc.damage`), kept with it; or one
 * the table settles (`battle.data.waiting`: settleCard), kept with the turn that left it (else the turn going on now).
 */
export function answerDamage(key, { multiplier = 1, targetId = null, dismiss = false } = {}) {
  return queue(async () => {
    const pc = battle?.pc;
    const own = pc?.damage?.find(d => d.key === key) ?? null;
    const line = own ?? battle?.data.waiting?.find(d => d.key === key) ?? null;
    if ( !line ) return false;
    const put = own ? rest => { pc.damage = rest; } : rest => { battle.data.waiting = rest; };
    const listed = () => (own ? pc.damage : battle.data.waiting) ?? [];
    put(listed().filter(d => d !== line));
    const u = battle.run.byId.get(targetId ?? line.targetId);
    const message = game.messages.get(line.messageId);
    if ( !dismiss && u && message ) {
      // (Only what the GM was shown: a card changed since, its total or its kind, goes back before them as it is now.)
      const card = readDamageCard(message);
      if ( !damageStill(line, card) ) {
        const healing = card?.kind === "healing";
        if ( card?.amount > 0 ) put([...listed(), { ...line, key: foundry.utils.randomID(), amount: card.amount, healing, hpAt: line.targetId ? await hpOf(u) : null }]);
        ui.notifications.warn(fmt("FASTFIGHTING.Live.DamageChanged", { name: line.by, was: line.amount, now: card?.amount ?? 0 }));
        await keep();
        changed();
        return false;
      }
      await applyDamage(own ? pc : waitedIn(line), message, u, multiplier);
    } else if ( !own ) await keep();
    changed();
    return true;
  });
}

/**
 * Where a card the table settled, now applied from the Battle Vantage, is kept: the turn that left it (its undo
 * records, the cards it applied), for Rewind; else the player's turn going on, the last turn, or the GM's own.
 */
function waitedIn(line) {
  const turn = line?.turn ? battle.data.turns.find(t => t.key === line.turn) : null;
  return turn ?? battle.pc ?? battle.data.turns.at(-1) ?? { records: (battle.data.gmRecords ??= []), applied: [] };
}

/**
 * The cards waiting in the Battle Vantage that turns taken back (their keys) left to the table: gone with them, their
 * cards deleted. Pure.
 */
export const waitingAfter = (waiting, keys) => (waiting ?? []).filter(l => !l?.turn || !keys.has(l.turn));

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
    await rollFirst(run, reactorId, pc.id, strike, pc);
    const events = reactNow(run, reactorId, pc.id, strike, "foeOpening");
    await writeChanges(before, captureAll(run), pc.records, { messages: cardsOf(pc) });
    await showPcRolls(pc);
    // (A blow that disrupts what the character was doing, as the system has it: PF2e's critical Reactive Strike.)
    const crit = events.some(e => e.type === "attack" && e.actorId === reactorId && e.degree === 3);
    if ( crit && message && getAdapter().disruptsAction?.(message) ) await tellStop(pc.id, fmt("FASTFIGHTING.Live.Disrupted", { name: run.byId.get(pc.id)?.spec.name ?? "", by: run.byId.get(reactorId)?.spec.name ?? "" }));
  }
  await keep();
}

/**
 * A foe's strike at a player's character in its turn, rolled with the system's own roller first, where it can; what the
 * roll changed on the foe's sheet, and its damage cards the engine settles, the player's turn's (`pc`: systemRoll's
 * `into`), its cards drawn again.
 */
async function rollFirst(run, reactorId, targetId, strike, pc = null) {
  if ( !rollsKind(run.live, "strike") ) return;
  const was = pc?.applied?.length ?? 0;
  const roll = await systemRoll({ unitId: reactorId, byId: targetId, strike: { id: strike.id, name: strike.name } }, pc);
  if ( roll ) run.live.forced = { unitId: reactorId, targetId, ...roll };
  redraw(pc?.applied?.slice(was));
}

/** A word to a player's character's players and the GMs: its move stopped, or its action disrupted. */
async function tellStop(pcId, text) {
  const actor = docOf(pcId)?.actor;
  const whisper = [...new Set([...gmIds(), ...game.users.filter(u => !u.isGM && actor?.testUserPermission(u, "OWNER")).map(u => u.id)])];
  const ChatMessage = chatMessageClass();
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
  // (With what it was read from, the player's own cards: the tracker taken back to it, it's theirs again. Kept even if
  // closing it fails partway, as far as it got, so a Rewind still takes it back: closedTurn.)
  const turn = closedTurn(pc, battle.combat.turns.findIndex(c => c.id === pc.combatantId));
  // (What the turn changed by hand, the player's or a GM's: moves, hit points, resources, items, effects. First, so a
  // Rewind puts it back last: every sheet as the turn began. Taken as it's written, the GM's review done.)
  const before = sheetsAt.get(pc);
  sheetsAt.delete(pc);
  let byHand = !before;
  const handMade = () => {
    if ( !byHand ) turn.records.unshift(...sheetUndo(before));
    byHand = true;
  };
  let ended;
  try {
    ended = await readPlayerTurn(pc, turn, handMade);
  } catch ( err ) {
    handMade();
    keepTurn(turn);
    await keep();
    throw err;
  }
  await settleTurn(turn, ended);
}

/**
 * A player's turn as it's kept, before what its closing writes (`at`: its place on the tracker): what reactions wrote in
 * it, its cards so far (the engine's rolls shown in it), where it stood, the doors opened in it, the fight before it.
 * Pure.
 */
export function closedTurn(pc, at) {
  const turn = {
    key: `${pc.round}.${pc.combatantId}`, combatantId: pc.combatantId, round: pc.round, at, kind: "pc", records: [...(pc.records ?? [])], messages: [...(pc.rollCards ?? [])],
    moves: pc.startAt ? [pc.startAt] : [], doors: [...(pc.doors ?? [])], snapshot: pc.snapshot, from: pc.from, cards: pc.messages, facts: pc.facts ?? [], dealRolls: pc.dealRolls ?? []
  };
  if ( pc.applied?.length ) turn.applied = [...pc.applied];
  return turn;
}

/** A player's turn read, written and told into `turn` (closePlayerTurn's); `handMade` notes the changes made by hand. Whether the battle ended. */
async function readPlayerTurn(pc, turn, handMade) {
  const run = battle.run;
  const adapter = getAdapter();
  // (Not a deal's roll: the deal is told, and holds, on its own: rolledDeal.)
  const deals = new Set(pc.dealRolls ?? []);
  const messages = pc.messages.filter(id => !deals.has(id)).map(id => game.messages.get(id)).filter(Boolean);
  const ids = Object.fromEntries(run.units.map(u => [tokenIdOf(u), u.id]));
  // (By actor too, for a card that names only the actor: the first of its tokens.)
  const actors = {};
  for ( const u of run.units ) if ( u.spec.actorId && !(u.spec.actorId in actors) ) actors[u.spec.actorId] = u.id;
  let events = [];
  try {
    events = adapter.readTurn?.(messages, { actorId: run.byId.get(pc.id)?.spec.actorId ?? null, tokenId: unitTokenId(run, pc.id), ids, actors }) ?? [];
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
  // (What the engine's dice did as it ended, a foe's death throes, an effect's save: shown with the turn, seen as the
  // tokens are before its writing.)
  const endRolls = takeRolls(run);
  const audiences = rollAudiences(endRolls);
  // (What the engine itself made of the turn, past what the sheets say: a death burst, written; after the changes made
  // by hand.)
  handMade();
  await writeChanges(result.synced, captureAll(run), turn.records, { messages: turn.messages });
  turn.messages.push(...await showRolls(endRolls, turn, { audiences }));
  turn.messages.push(...await tellNew());
  return result.ended;
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
  checkFast({ asks: "review" });
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
  if ( !pc || unitTokenId(battle.run, pc.id) !== doc.id || !doc.object ) return;
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
    await rollFirst(run, reactorId, pc.id, strike, pc);
    reactNow(run, reactorId, pc.id, strike);
    await writeChanges(before, captureAll(run), pc.records, { messages: cardsOf(pc) });
    await showPcRolls(pc);
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
  if ( (!battle.run.movers && !battle.run.reachers && !battle.run.foeAuras && !battle.run.readying) || !from ) return false;
  const before = captureAll(battle.run);
  const snapshot = snapshotRun(battle.run, { log: false });
  // (Every pass from the snapshot, the first too: playTurn's.)
  battle.run = restoreRun(battle.spec, battle.rules, snapshot, { log: battle.run.log });
  const nonce = freshNonce();
  const stage = turnStage(`${pc.round}.${pc.combatantId}`);
  const answers = [];
  let events = [];
  let lastPass = null; // (the pass before, stopped at a question: playTurn's)
  for ( let tries = 0; ; tries++ ) {
    try {
      events = movedBeside(battle.run, pc.id, from, { answers, nonce, before: lastPass });
      break;
    } catch ( err ) {
      if ( !(err instanceof NeedsDecision) || tries > 50 ) throw err;
      const request = err.request;
      const answer = request.roll ? await turnRoll(request, battle.run.log.slice(battle.run.live.turnFrom ?? battle.run.log.length), stage) : await answerFor(request, stage);
      answers.push([request.key, answer]);
      lastPass = battle.run;
      battle.run = restoreRun(battle.spec, battle.rules, snapshot, { log: battle.run.log });
    }
  }
  // (What the system's own rolls applied, its undo records, the player's turn's; and the engine's rolls shown as the
  // system's cards meanwhile, FastFighting's own (its flags: no player's), taken back with the turn.)
  pc.records.push(...stage.records);
  redraw(noteApplied(pc.applied ??= [], stage.applied));
  const shownHere = stage.messages.filter(id => game.messages.get(id)?.getFlag(MODULE_ID, "live"));
  if ( shownHere.length ) pc.rollCards = [...(pc.rollCards ?? []), ...shownHere];
  // (The doors they opened on the way, the player's turn's: shut again with it.)
  const doors = () => (pc.doors = doorsWith(pc.doors, stage.doorsOpened.values()));
  doors();
  if ( !events.length ) return stage.records.length > 0;
  await writeChanges(before, captureAll(battle.run), pc.records, { messages: cardsOf(pc) });
  await showPcRolls(pc);
  const rest = events.slice(stage.played);
  await playMoves(rest, stageDocs(stage), setting("playOnMap") ? stageGrid(stage) : null, stage.doorsOpened, battle.scene, { instant: !setting("playOnMap") });
  doors();
  return true;
}

/** Doors opened (`kept`, each {id, uuid, ds}), with those just opened (`fresh`): each once, as it was first found. Pure. */
export function doorsWith(kept, fresh) {
  const out = [...(kept ?? [])];
  for ( const d of fresh ?? [] ) if ( d?.uuid && !out.some(k => k.uuid === d.uuid) ) out.push(d);
  return out;
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
    records.push(...noteSettings(placed?.records ?? []));
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

/**
 * A team's reinforcements come since (the engine's, with no token yet: behavior/reinforce.js): placed where the engine
 * says they come in, by the helper's placeSummons (as a summoning's, one of the team standing in for the summoner),
 * and on the tracker after everyone. Undo records added to `records`.
 */
async function placeReinforcements(records) {
  const run = battle.run;
  const fresh = run.units.filter(s => s.reinforcementOf && !s.tokenId && s.status === STATUS.STANDING);
  if ( !fresh.length ) return;
  const adapter = getAdapter();
  const teams = new Map();
  for ( const s of fresh ) (teams.get(s.reinforcementOf) ?? teams.set(s.reinforcementOf, []).get(s.reinforcementOf)).push(s);
  for ( const [key, list] of teams ) {
    // (One of the team on the map to stand in for the summoner: its side shows on theirs. None left: the map's middle.)
    const mate = run.units.map(o => (groupKeyOf(o) === key && !o.reinforcementOf ? docOf(o.id) : null)).find(Boolean) ?? null;
    const side = list[0].side;
    const disposition = CONST.TOKEN_DISPOSITIONS[side === SIDES.FRIENDLY ? "FRIENDLY" : side === NEUTRAL_PARTY ? "NEUTRAL" : "HOSTILE"];
    const standIn = mate ?? { x: battle.scene.width / 2, y: battle.scene.height / 2, width: 1, height: 1, elevation: 0, disposition, parent: battle.scene };
    let placed;
    try {
      placed = await adapter.placeSummons(battle.scene, standIn, { id: `reinforce~${key}`, kind: "summon" }, list.map(s => s.spec), spotsFor(standIn, list, battle.scene));
    } catch ( err ) {
      console.error(`${MODULE_ID} | placing ${key}'s reinforcements`, err);
      continue;
    }
    records.push(...noteSettings(placed?.records ?? []));
    const tokens = placed?.tokens ?? [];
    tokens.forEach((t, i) => { if ( list[i] ) list[i].tokenId = t.id; });
    if ( !tokens.length ) continue;
    // (After everyone on the tracker; a spotlight system's, when the GM gives it the spotlight.)
    const last = Math.min(...battle.combat.combatants.map(c => c.initiative).filter(Number.isFinite));
    const created = await battle.combat.createEmbeddedDocuments("Combatant", tokens.map((t, i) => ({
      tokenId: t.id, sceneId: battle.scene.id, actorId: t.actorId, initiative: battle.data.spotlight || !Number.isFinite(last) ? null : last - 1 - 0.01 * i
    })));
    records.push({ createdCombatants: created.map(c => c.uuid) });
  }
  await keep();
}

/**
 * The GM calls a team's reinforcements (the Battle Vantage): `n` of them come next round. How many are coming.
 */
export function liveReinforce(team, n) {
  return queue(async () => {
    if ( !playsHere() || !battle.run.reinforce?.[team] ) return 0;
    const count = gmReinforce(battle.run, team, n);
    if ( count ) await keep();
    changed();
    return count;
  });
}

/** Each team's reinforcements in this battle: [{team, name, left, coming}] (the Battle Vantage's list). */
export function reinforcementsLeft() {
  const run = battle?.run;
  if ( !run?.reinforce ) return [];
  return Object.entries(run.reinforce).map(([team, r]) => ({
    team, name: run.prep.reinforcements?.get(team)?.p.spec.name ?? "", left: r.left, coming: r.coming.reduce((s, c) => s + c.n, 0)
  }));
}

/**
 * What the engine changed between two captures of everyone, onto the sheets; their undo records added to `records`.
 * The cards the helper made as it wrote them (API 21: PF2e's naming who got which effect) to `messages`, a turn's (a
 * player's turn's own: cardsOf), so a Rewind takes them with it. `leave`: what the table settles itself, by creature
 * (tableLeaves: engine/changes.js leaveToTable's options), taken out of its change set and handed over as its `left`,
 * for the helper to name, not write; its `final` with the hit points and status its sheet has.
 * The helper hears too: `tokenOf(id)` (a creature's token, by its id in the run: an effect's source) and `audience(id)`
 * (who sees that creature's cards, table-rolls.js audienceFor: "public" or "gm"). The lines the system posts by itself
 * about these writes (Ironsworn's change log) are the battle's, and go into `messages` too (side-lines.js).
 */
function writeChanges(before, after, records, { messages = null, leave = null } = {}) {
  return writingFor(battle.data.id, battleActors(), messages, () => writeEach(before, after, records, { messages, leave }));
}

/** The actors of the battle's creatures (their tokens'), by id: whose lines the system posts are side lines. */
const battleActors = () => new Set(battle.run.units.map(u => docOf(u.id)?.actor?.id).filter(Boolean));

/**
 * fn(), FastFighting moving the battle's tracker: what the system posts meanwhile for the turn that starts (PF2e's
 * Current Conditions) is the battle's, marked with that turn (side-lines.js movingTracker).
 */
function moving(fn) {
  if ( !battle ) return fn();
  const combat = battle.combat;
  const startOf = m => {
    const c = combat.combatants.find(x => !!m.speaker?.token && x.tokenId === m.speaker.token) ?? combat.combatants.find(x => !!m.speaker?.actor && x.actorId === m.speaker.actor);
    return c ? { round: combat.round, combatantId: c.id } : null;
  };
  return movingTracker(battle.data.id, battleActors(), startOf, fn);
}

/** A combatant's place in the tracker's order (by id), -1 off it. */
const orderOf = id => battle.combat.turns.findIndex(c => c.id === id);

/** Rewind going back to `now` ({round, at}): what the system told of the starts it goes back past, deleted (startedAfter). */
async function dropStarts(now) {
  for ( const m of startedAfter(game.messages.contents, battle.data.id, now, orderOf) ) await m.delete();
}

/**
 * writeChanges' work: each creature's change set onto its sheet, by the helper's commitChanges.
 */
async function writeEach(before, after, records, { messages = null, leave = null } = {}) {
  const adapter = getAdapter();
  const seen = new Set(game.messages.keys());
  const tokenOf = id => (typeof id === "string" && id ? docOf(id) ?? null : null);
  const audience = id => audienceFor(id ?? null, { docOf, unitOf: x => battle.run.byId.get(x) ?? null });
  // (The conditions an effect of the engine's lays, on whom it lies: one the table settles isn't set.)
  const conditionsOf = id => e => battle.run.byId.get(id)?.effects?.find(x => x.key === e.key && (x.sourceId ?? null) === (e.sourceId ?? null))?.conditions ?? null;
  // (Where a buff or debuff came from: the action that laid it, or the reaction (its boost, what it lays), and whose, for
  // the helper to put its effect on the sheet.)
  let sources = null;
  const effectSource = id => {
    // (Or the aura that laid it: behavior/auras.js.)
    sources ??= new Map(battle.run.units.flatMap(u => [...(u.spec.actions ?? []), ...(u.spec.reactions ?? []), ...(u.spec.auras ?? [])].map(action => [action.id, { action, spec: u.spec }])));
    return sources.get(id) ?? null;
  };
  for ( const [id, raw] of Object.entries(diffAll(before, after)) ) {
    const doc = docOf(id);
    if ( !doc ) continue;
    const ch = leave?.has(id) ? leaveToTable(raw, { ...leave.get(id), conditionsOf: conditionsOf(id) }) : raw;
    if ( !ch ) continue;
    // (Its hit points the table's: as its sheet had them, so nothing the helper reads of them says otherwise.)
    const final = ch.left?.hp ? { ...after[id], ...Object.fromEntries(SHEET_HP.filter(k => k in before[id]).map(k => [k, before[id][k]])) } : after[id];
    applying++;
    try {
      const spec = { ...battle.run.byId.get(id).spec, resources: before[id].resources };
      // (Dead, a creature's body leaves its corpse, fresh, rotten or scrap: on it before the system's own loot takes its
      // things, so it goes where they go. Not a player's character's, nor a hazard's or a summoned one's: foundry/food.js.)
      const unit = battle.run.byId.get(id);
      if ( ch.died && unit.spec.kind !== "pc" && !unit.spec.hazard && !unit.summoner && typeof adapter.putGoods === "function" ) {
        const meat = meatGoods(doc.actor, unit.spec, adapter);
        if ( meat ) records.push(...noteSettings((await adapter.putGoods(doc, meat)) ?? []));
      }
      // (Dead, its share of its team's purse lies on it, out of the purse: coins on its sheet, there for its pile.)
      if ( ch.purseDrop > 0 && typeof adapter.putGoods === "function" ) {
        records.push(...noteSettings((await adapter.putGoods(doc, { items: [], coins: null, money: ch.purseDrop })) ?? []));
      }
      const record = await adapter.commitChanges(doc, spec, ch, final, {
        ...writeOptions(), before: before[id], effectSource, tokenOf, audience
      });
      if ( record ) records.push(...noteSettings([record]));
      // (Won over, talked out of the fight, turned on the party: its token shows it, whatever its system wrote.)
      const side = ch.side ? sideAfter(after[id]) : null;
      const disposition = side ? CONST.TOKEN_DISPOSITIONS[{ friendly: "FRIENDLY", hostile: "HOSTILE", neutral: "NEUTRAL" }[side]] : undefined;
      if ( disposition !== undefined && doc.disposition !== disposition ) {
        records.push({ ...undoRecord(doc, doc.actor, { statusesBefore: false }), tokenUpdate: { disposition: doc.disposition } });
        await doc.update({ disposition });
      }
      // (What it took from a pile, or ate: off the pile or the body, onto it or gone. behavior/forage.js.)
      for ( const f of ch.foraged ?? [] ) {
        const from = f.pile ? battle.scene.tokens.get(f.source) ?? null : docOf(f.source);
        records.push(...noteSettings(await writeForaged(battle.scene, doc, f, from)));
      }
      // (Fallen, a pile to loot; up again, itself; a player's character dead, its things' copy on top of it.)
      const fall = await lootOnFall(doc, battle.run.byId.get(id), ch, setting("lootMode"));
      records.push(...noteSettings(fall.records));
      if ( fall.remains ) battle.data.remains = { ...(battle.data.remains ?? {}), [id]: fall.remains };
      // (Tied up this turn: marked on the sheet, the system's way.)
      if ( ch.bound !== undefined ) {
        const marked = await adapter.commitBound(doc, ch.bound);
        if ( marked ) records.push(...noteSettings([marked]));
      }
      // (A deal's goods, at the last moment: whoever pays still has them on its sheet, or nothing of that deal moves.)
      const short = await shortOnSheet(doc, ch.concessions);
      if ( short.length ) ch.concessions = ch.concessions.filter(c => !short.includes(c));
      // (Goods dropped on the ground, a deal struck apart: one pile for each drop. foundry/loot-drop.js.)
      for ( const [drop, goods] of dropsIn(ch.concessions) ) {
        const at = pointOf(battle.run.byId.get(id), goods[0].drop);
        const receiverDoc = goods[0].to ? docOf(goods[0].to) : null;
        // (Its own share off its sheet; its team's purse's, money on no sheet, dropped with it.)
        const own = goods.map(ownShare).filter(Boolean);
        const minted = goods.reduce((n, c) => n + (c.purseKey ? Number(c.purse) || 0 : 0), 0);
        const made = at ? await dropGoods({ scene: battle.scene, point: at, giverDoc: doc, receiverDoc, goods: own, minted }) : { records: [], pile: null };
        records.push(...noteSettings(made.records));
        if ( made.pile ) battle.data.piles = { ...(battle.data.piles ?? {}), [drop]: made.pile };
      }
      for ( const c of ch.concessions ?? [] ) {
        if ( c.kept || c.drop || !adapter.commitConcession ) continue;
        // (Off a dead player's character's loot token, not its sheet: gone, nothing to take.)
        const from = c.from === "remains" ? await remainsDoc(id) : doc;
        if ( !from ) continue;
        const to = c.to ? docOf(c.to) : null;
        // (The giver's side, for what it shares: Ironsworn's Supply.)
        const giver = battle.run.byId.get(id);
        const allies = battle.run.units.filter(u => u !== giver && u.side === giver.side).map(u => docOf(u.id)).filter(Boolean);
        const own = ownShare(c);
        if ( own ) records.push(...noteSettings((await adapter.commitConcession(from, to ?? null, own, { giver: spec, receiver: to ? battle.run.byId.get(c.to)?.spec : null, allies })) ?? []));
        // (Out of its team's purse, on no sheet: onto the receiver's, as the system's coin.)
        const minted = c.purseKey ? Number(c.purse) || 0 : 0;
        if ( minted > 0 && to && adapter.putGoods ) records.push(...noteSettings((await adapter.putGoods(to, { items: [], money: minted })) ?? []));
      }
    } catch ( err ) {
      console.error(`${MODULE_ID} | writing ${doc.name}'s changes`, err);
    } finally {
      applying--;
    }
  }
  // (Picked up this turn: what was dropped for it, off the ground and onto its sheet.)
  for ( const { pile, to } of pickUpsIn(before, after) ) {
    const receiverDoc = docOf(to);
    if ( !receiverDoc || !battle.data.piles?.[pile] ) continue;
    applying++;
    try {
      records.push(...noteSettings(await pickUpGoods({ pileUuid: battle.data.piles[pile], receiverDoc })));
    } catch ( err ) {
      console.error(`${MODULE_ID} | picking up a pile`, err);
    } finally {
      applying--;
    }
  }
  messages?.push(...cardsSince(seen).map(m => m.id));
}

/** A dead player's character's loot token (loot-drop.js lootOnFall), while it's there. */
async function remainsDoc(id) {
  const uuid = battle.data.remains?.[id];
  return typeof uuid === "string" ? fromUuid(uuid).catch(() => null) : null;
}

/**
 * A deal's goods its payer hasn't got on its sheet any more (spent, given away since): all of that deal's, which then
 * don't move, the GMs told. Where the helper can't say what a sheet holds (no giveables), none.
 */
async function shortOnSheet(doc, concessions = []) {
  const deals = concessions.filter(c => !c.kept && (c.how === "bribe" || c.how === "extort" || c.how === "toll"));
  const held = deals.length ? getAdapter().giveables?.(doc.actor) : null;
  if ( !held ) return [];
  const money = deals.filter(c => c.kind === "money").reduce((n, c) => n + (Number(ownShare(c)?.amount) || 0), 0);
  const items = new Map();
  for ( const c of deals ) if ( c.kind === "item" ) items.set(c.item?.id, (items.get(c.item?.id) ?? 0) + (c.count ?? 1));
  const enough = money <= (held.money ?? 0) && [...items].every(([id, n]) => (held.items ?? []).some(i => i.id === id && i.quantity >= n));
  if ( enough ) return [];
  const ChatMessage = chatMessageClass();
  await ChatMessage.create({ content: dealCard(fmt("FASTFIGHTING.Deal.ShortOnSheet", { name: doc.name })), speaker: chronicle(), whisper: gmIds() });
  return deals;
}

/** What of a payment comes off the giver's own sheet: all of it, but money drawn from its team's purse (null: none). */
function ownShare(c) {
  if ( c.kind !== "money" || !c.purseKey ) return c;
  const amount = (Number(c.amount) || 0) - (Number(c.purse) || 0);
  return amount > 0 ? { ...c, amount } : null;
}

/** A turn's dropped goods (behavior/deals.js give), by their drop: [[drop id, concessions]]. */
function dropsIn(concessions = []) {
  const out = new Map();
  for ( const c of concessions ) if ( c.drop && !c.kept ) out.set(c.drop.id, [...(out.get(c.drop.id) ?? []), c]);
  return [...out];
}

/** The drops picked up between two captures: {pile: its drop id, to: who picked it up}. */
function pickUpsIn(before, after) {
  const out = new Map();
  for ( const [id, a] of Object.entries(after) ) {
    const was = before[id]?.concessions ?? [];
    (a.concessions ?? []).forEach((c, i) => {
      if ( c.drop && c.picked && !was[i]?.picked ) out.set(c.drop.id, { pile: c.drop.id, to: c.to });
    });
  }
  return [...out.values()];
}

/** A creature's hit points and the status they give it, as a capture has them (writeChanges: those the table settles). */
const SHEET_HP = ["hp", "temp", "stamina", "dying", "wounded", "stable", "status"];

/**
 * Where FastFighting's own cards go, for Rewind (writeChanges' `messages`): a player's turn going on, its rollCards
 * (its `messages` are its player's, read as the turn); a turn kept, its messages.
 */
const cardsOf = into => (into && into === battle?.pc ? (into.rollCards ??= []) : (into ? (into.messages ??= []) : null));

/* -------------------------------------------- */
/*  Telling                                     */
/* -------------------------------------------- */

/**
 * Is a creature's name kept from the players in the story? Not a player's own, nor a player character the GM runs (the
 * party's: Kingmaker's companions); not one whose nameplate shows to
 * everyone (Always, Hover). One the GM marked "Keep its name secret" (its FastFighting tab) always is. Where the system
 * lets nameplates decide (namesFollowNameplates: PF2e's own setting), any other is, as the system's cards have it;
 * elsewhere, until a player's character has seen it this fight (`u.partySaw`: senses.js noteSeen).
 */
function nameHidden(doc, u = null, byNameplate = nameplatesDecide()) {
  if ( !doc || doc.actor?.hasPlayerOwner ) return false;
  u ??= battle?.run.units.find(x => tokenIdOf(x) === doc.id) ?? null;
  if ( u?.spec.kind === "pc" ) return false;
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

/** The players' characters in the battle. */
const partyOf = run => new Set(run.units.filter(p => p.spec.kind === "pc" || run.live.players.has(p.id) || docOf(p.id)?.actor?.hasPlayerOwner));

/**
 * May the players tell how hurt a creature is, for its health callout told openly without Health Estimate
 * (health-estimate.js)? One of theirs; else one that a player's character still standing can make out where it is
 * (senses.js perceives, as apparentHealth reads it), unless it's hidden and not yet given away.
 */
function playersCanTell(run, id) {
  const u = run.byId.get(id);
  if ( !u ) return false;
  const party = partyOf(run);
  if ( party.has(u) ) return true;
  if ( u.spec.hidden && !u.revealed ) return false;
  return [...party].some(p => isStanding(p) && perceives(run, p, u));
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
    else known.add(u.spec.baseName ?? u.spec.name);
  }
  const numbers = (battle.data.someone ??= {});
  const out = new Map();
  for ( const u of hidden ) {
    if ( known.has(u.spec.baseName ?? u.spec.name) ) continue;
    numbers[u.id] ??= Object.keys(numbers).length + 1;
    out.set(u.id, game.i18n.format("FASTFIGHTING.Desire.Unknown", { n: numbers[u.id] }));
  }
  return out;
}

/** Those whose names the players haven't learned, now (unnamed): unit id -> what the open story calls each. */
function someoneNow() {
  const run = battle.run;
  // (Each creature a player's character has seen this fight: named from then on, senses.js noteSeen.)
  noteSeen(run, partyOf(run));
  return unnamed(run, new Map(run.units.map(u => [u.id, docOf(u.id)]).filter(([, d]) => d)));
}

/** A creature's name as the players know it: its own, or someone, numbered (someoneNow). */
function openName(id) {
  return someoneNow().get(id) ?? battle.run.byId.get(id)?.spec.name ?? "";
}

/** someoneNow, by token id: for a player's browser (apps/deal-dialog.js), which knows tokens, not the engine's ids. */
function openNames() {
  const out = {};
  for ( const [id, name] of someoneNow() ) {
    const doc = docOf(id);
    if ( doc ) out[doc.id] = name;
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
  // (How hurt a harm left the one it hurt, where it looks worse: story/health.js, in Health Estimate's words where it's
  // on. Worked out from each harm's own hit points, before and after it, so the whole log told again says the same.)
  const healthState = healthLookup({ tokenOf: id => docOf(id) ?? null, playersKnow: id => playersCanTell(run, id) });
  if ( style === "statistician" ) {
    const lines = run.log.filter(e => (e.turn ?? 0) > told).flatMap(e => {
      const c = healthCallout(e, healthState);
      return [logLine(e), c ? healthLine(c) : ""];
    }).filter(Boolean);
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
      conditionType: adapter?.rules?.storyCondition?.bind(adapter.rules) ?? null, healthState, open
    };
    const beats = storyBeats(result, battle.spec, style, options);
    const docs = new Map(run.units.map(u => [u.id, docOf(u.id)]).filter(([, d]) => d));
    // (Told openly: one whose name the players haven't learned, as someone. The GMs' cards keep its name.)
    if ( open ) noteSeen(run, partyOf(run));
    const someone = open ? unnamed(run, docs) : null;
    if ( someone?.size ) {
      const told = new Map(storyBeats(...namedAs(result, battle.spec, someone), style, options).map(b => [beatKey(b), b]));
      for ( const beat of beats ) {
        beat.html = told.get(beatKey(beat))?.html ?? beat.html;
        if ( someone.has(beat.actorId) ) beat.anonymous = true;
        // (Each someone it tells of, and its token: the GMs are shown who's who on the card, make-it-so.js whoIsWho.)
        beat.someone = [...someone].filter(([, label]) => beat.html?.includes(escape(label)))
          .map(([id, label]) => ({ label, tokenId: tokenIdOf(run.byId.get(id) ?? { id, spec: {} }) }));
      }
    }
    const done = new Set(battle.data.toldBeats ?? []);
    for ( const beat of beats ) {
      // (Each creature it names by its own name, and its token: a click on the name shows it on the map, make-it-so.js
      // panLinks. Not someone: that one's isn't the players' to find.)
      beat.links = Object.fromEntries(run.units.filter(u => !someone?.has(u.id) && beat.html?.includes(`<strong>${escape(u.spec.name)}</strong>`))
        .map(u => [u.spec.name, tokenIdOf(u)]));
      // (Whose turn it tells of, in its header: as the story calls it, someone where the players don't know it.)
      const actor = beat.actorId ? run.byId.get(beat.actorId) : null;
      if ( actor ) beat.actorName = someone?.get(actor.id) ?? docs.get(actor.id)?.name ?? actor.spec.name;
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
  // (A blow at one walking away after a deal with the striker's side: the GMs are told, whatever the style.)
  for ( const e of run.log ) {
    if ( e.type !== "dishonor" || (e.turn ?? 0) <= told ) continue;
    const ChatMessage = chatMessageClass();
    const message = await ChatMessage.create({
      content: inertHtml(`<div class="fast-fighting-live"><p><i class="fa-solid fa-scale-unbalanced"></i> ${escape(logLine(e))}</p></div>`),
      speaker: chronicle(), whisper: gmIds(), flags: { [MODULE_ID]: { live: { battle: battle.data.id, dishonor: true } } }
    });
    if ( message ) out.push(message.id);
  }
  battle.data.told = Math.max(told, lastTurn(run.log));
  return out;
}

/* -------------------------------------------- */
/*  The engine's own rolls                      */
/* -------------------------------------------- */

/**
 * The table rolls the engine's own dice made (engine/table-rolls.js), shown: real rolls in the chat, each creature's
 * its own message, seen as table-rolls.js rollAudience says; `turn`'s, for Rewind (null: the battle's own, its opening).
 * Each as its system's own card where the helper shows them (showTableRoll, API 20: showSystemRoll); none the system
 * showed already (`shown`: the engine's damage made the system's card in its turn, and the rolls before it). `settle`:
 * rolls of a fight played through (Play to the end, the aftermath), on the GMs' one card for them instead (tally).
 * `cards`: a Map, given each roll shown the system's way, with its messages' ids. Returns the messages' ids (none for
 * the card: a Rewind trims it, untally).
 */
async function showRolls(rolls, turn, { settle = false, audiences = null, cards = null } = {}) {
  rolls = (rolls ?? []).filter(r => !r?.shown);
  if ( !rolls.length || !battle ) return [];
  if ( settle && turn ) {
    await tally(turn, rolls);
    return [];
  }
  return postRolls(rolls, {
    scene: battle.scene, docOf, unitOf: id => battle.run.byId.get(id) ?? null, speakerless: chronicle(), audiences, cards,
    show: offers(getAdapter(), "showTableRoll") ? showSystemRoll : null,
    flags: { battle: battle.data.id, ...(turn?.key ? { turn: turn.key } : {}) }
  });
}

/** Who sees each roller's rolls now (table-rolls.js audiencesFor). */
const rollAudiences = rolls => audiencesFor(rolls, { docOf, unitOf: id => battle.run.byId.get(id) ?? null });

/** What the engine's dice did in a player's turn so far (a foe's reaction), shown now: the turn's, for Rewind. */
async function showPcRolls(pc) {
  const ids = await showRolls(takeRolls(battle.run), null);
  if ( ids.length ) pc.rollCards = [...(pc.rollCards ?? []), ...ids];
}

/** A turn's rolls onto the GMs' card for rolls settled at once (made, or brought up to date), by its turn. */
async function tally(turn, rolls) {
  const { entries, names } = tallyOf(battle.data.tally);
  entries.push({ turn: turn.key, round: turn.round ?? battle.combat.round, aftermath: turn.kind === "aftermath", rolls });
  for ( const r of rolls ) if ( r.by && !names[r.by] ) names[r.by] = battle.run.byId.get(r.by)?.spec.name ?? "";
  battle.data.tally = await postTally(battle.data.tally, entries, { names, flags: { battle: battle.data.id } });
  turn.tallied = true;
}

/** Turns taken back: their rolls off the GMs' card (the card gone with the last of them). */
async function untally(turns) {
  const keys = new Set((turns ?? []).filter(t => t?.tallied).map(t => t.key));
  if ( !keys.size || !battle.data.tally ) return;
  const { entries, names } = tallyOf(battle.data.tally);
  battle.data.tally = await postTally(battle.data.tally, entries.filter(e => !keys.has(e.turn)), { names, flags: { battle: battle.data.id } });
}

/** The battle over: who won, told; the GMs told it's over. (The combat stays for the GM to end.) */
async function finish() {
  checkFast({ ended: true });
  const before = captureAll(battle.run);
  const told = battle.run.log.length;
  endLive(battle.run, { ended: true, settle: false });
  // (Those still on their way off the map are gone: written, and seen off, with the last turn.)
  const last = battle.data.turns.at(-1);
  const gone = battle.run.log.slice(told).filter(e => e.type === "offMap");
  if ( gone.length && last ) {
    await holdingPause(async () => {
      await writeChanges(before, captureAll(battle.run), last.records, { messages: last.messages });
      await sendOff(gone, last);
    });
  }
  const shown = await showRolls(takeRolls(battle.run), last ?? null);
  const messages = [...shown, ...await tellNew()];
  battle.data.ended = true;
  // (Nothing left to play: no countdowns.)
  setTimers({});
  const ChatMessage = chatMessageClass();
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
      await writeChanges(before, after, turn.records, { messages: turn.messages });
      // (Its rolls, the dying's and their friends': on the GMs' card for rolls settled at once.)
      await showRolls(takeRolls(run), turn, { settle: true });
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

/** Next Turn: the tracker moves on to the next turn (a Fast Fight stopped: the GM's say). */
export function continueBattle() {
  if ( !battle || battle.data.ended ) return null;
  checkFast({ pressed: true });
  return moveOn();
}

/**
 * Rewind (the Battle Vantage's, a card's): the tracker's Previous Turn, which the battle follows (followBack). At the
 * battle's first turn, in a battle over, or in a spotlight system, the last turn put back instead, the tracker on it.
 */
export function rewind() {
  if ( !battle ) return null;
  checkFast({ pressed: true });
  const combat = battle.combat;
  if ( battle.data.ended || battle.data.spotlight || (combat.round <= 1 && !combat.turn) ) return rewindTurn();
  return moving(() => combat.previousTurn());
}

/** Put the last turn back: what it wrote, its cards and moves, and the run as it was before it; the tracker on it again. */
export function rewindTurn() {
  checkFast({ pressed: true });
  return queue(async () => {
    const turn = battle?.data.turns.at(-1);
    // (So far back, only the whole encounter can be rewound.)
    if ( !turn?.snapshot ) return false;
    // (A player's turn under way after it: what a foe's reaction wrote in it comes off first. Cards either left to the
    // table go with their cards.)
    const takenBack = new Set([turn.key, ...(battle.pc ? [`${battle.pc.round}.${battle.pc.combatantId}`] : [])]);
    await revertOpenTurn();
    await holdingPause(() => takingBack(battleActors(), () => revertEntry(battle.scene, turn, rewinding())));
    battle.data.waiting = waitingAfter(battle.data.waiting, takenBack);
    await untally([turn]);
    battle.run = playersNow(restoreRun(battle.spec, battle.rules, turn.snapshot, { log: battle.run.log }));
    battle.data.turns = battle.data.turns.slice(0, -1);
    redraw(turn.applied);
    battle.data.played = null;
    battle.data.offMap = [];
    battle.data.delaying = null; // (a Delay taken back with its turn: followBack's)
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
    // (What the system told of the starts of turns after it: gone. A spotlight system's have no order to go back along:
    // Rewind This Encounter's.)
    if ( !battle.data.spotlight ) await dropStarts({ round: turn.round, at });
    if ( at >= 0 ) await moving(() => battle.combat.update({ round: turn.round, turn: at }, { turnEvents: false }));
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
  const ChatMessage = chatMessageClass();
  return ChatMessage.create({
    content: inertHtml(`<div class="fast-fighting-live"><p>${escape(fmt("FASTFIGHTING.Live.Rewound", { name: u.spec.name }))}</p>
      <button type="button" data-ff-live="play"><i class="fa-solid fa-play"></i> ${loc("FASTFIGHTING.Live.Play")}</button></div>`),
    speaker: chronicle(), whisper: gmIds(), flags: { [MODULE_ID]: { live: { battle: battle.data.id, rewound: true } } }
  });
}

/** Put the whole battle back: every turn, last first, and the run as it began. */
export function rewindEncounter() {
  checkFast({ pressed: true });
  return queue(async () => {
    if ( !battle ) return false;
    // (A player's turn still open: what it changed, by hand and by FastFighting, first.)
    await revertOpenTurn();
    for ( const turn of undoEntries(battle.data.turns).reverse() ) await holdingPause(() => takingBack(battleActors(), () => revertEntry(battle.scene, turn, rewinding())));
    // (What the GM changed before the first turn.)
    if ( battle.data.gmRecords?.length ) await holdingPause(() => takingBack(battleActors(), () => revertEntry(battle.scene, { records: battle.data.gmRecords }, rewinding())));
    const combat = battle.combat;
    // (Its opening cards, and the combat as it was: not started, the initiative it rolled taken back, and those who
    // joined it on the way gone from it.)
    for ( const id of [...(battle.data.opening ?? []), ...(battle.data.rollCards ?? [])] ) await game.messages.get(id)?.delete();
    for ( const m of game.messages.filter(x => x.getFlag(MODULE_ID, "live")?.battle === battle.data.id && x.author?.isGM) ) await m.delete();
    // (And whatever else a creature in it rolled since it began, that no turn took.)
    const tokens = new Set(battle.run.units.map(u => tokenIdOf(u)));
    const actors = new Set(battle.run.units.map(u => docOf(u.id)?.actor?.id).filter(Boolean));
    const rightful = m => !!m.author && (m.author.isGM || !!(battle.scene.tokens.get(m.speaker?.token)?.actor ?? game.actors.get(m.speaker?.actor))?.testUserPermission(m.author, "OWNER"));
    for ( const m of strayCards(game.messages.contents, { since: battle.data.beganAt, tokens, actors, system: game.system?.id, rightful }) ) await m.delete();
    // (None of the tracker's own turn events, as the combat is put back: no turn starting or ending, for the system or
    // for this battle: onTurnChange.)
    for ( const uuid of battle.data.joined ?? [] ) {
      try {
        await (await fromUuid(uuid))?.delete({ turnEvents: false });
      } catch ( err ) {
        console.error(`${MODULE_ID} | taking back one who joined`, err);
      }
    }
    // (The battle's own data kept apart: taking the combat's flag off lets this browser go of the battle (the
    // updateCombat hook), so `battle` may be gone by the end.)
    const data = battle.data;
    if ( data.rolled?.length ) await combat.updateEmbeddedDocuments("Combatant", data.rolled.filter(id => combat.combatants.has(id)).map(id => ({ _id: id, initiative: null })), { turnEvents: false });
    if ( data.startedCombat ) await combat.update({ round: 0, turn: null }, { turnEvents: false, [MODULE_ID]: "rewindAll" });
    await combat.unsetFlag(MODULE_ID, "live");
    await forget(combat.id, data.id);
    letGo();
    changed();
    // (Back where it was before it began: the Battle Vantage makes it ready again, as the planner left it.)
    Hooks.callAll("fastFighting.encounterRewound", combat);
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
    const last = battle.data.turns.at(-1);
    const messages = [...await showRolls(takeRolls(battle.run), last ?? null), ...await tellNew()];
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
    const last = battle.data.turns.at(-1);
    const records = battle.pc?.records ?? last?.records ?? (battle.data.gmRecords ??= []);
    const messages = battle.pc ? cardsOf(battle.pc) : last?.messages ?? null;
    await holdingPause(() => writeChanges(before, captureAll(run), records, { messages }));
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
 * A player's character played by FastFighting from now on (`on`), or handed back to its player: the Battle Vantage's
 * FastFighting plays their turns. The GM's say: its away countdown, if it had one, goes.
 */
export function setAutomated(id, on) {
  return queue(async () => {
    if ( !battle || !battle.run.byId.has(id) ) return false;
    const timers = timersNow();
    if ( id in timers ) {
      delete timers[id];
      setTimers(timers);
    }
    return automate([id], on);
  });
}

/**
 * Characters played by FastFighting from now on (`on`), or handed back to their players (in the queue). In the middle
 * of one's own turn: one not acted in yet, FastFighting plays at once; one the player has acted in is theirs to finish,
 * and FastFighting takes over from the next.
 */
async function automate(ids, on) {
  const players = new Set(battle.data.players ?? []);
  for ( const id of ids ) {
    if ( on ) players.delete(id);
    else players.add(id);
  }
  battle.data.players = [...players];
  playersNow();
  // (One handed back to its player: a Fast Fight stops.)
  checkFast();
  const pc = battle.pc;
  if ( on && pc && ids.includes(pc.id) && pc.snapshot && !pc.messages.length && !pc.records?.length && !pc.facts?.length ) {
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
}

/** NPC reactions: as FastFighting calculates them ("calculated"), or asked each time ("ask"). */
export async function setNpcReactions(mode) {
  if ( !battle ) return;
  battle.run.live.npcReactions = mode === "ask" ? "ask" : "calculated";
  await keep();
}

/**
 * Play to the end: the turns FastFighting plays go on without waiting for the GM's Continue. Never with a Fast Fight
 * (whose rolls stay in the chat, not on the GMs' one card): on, it stops one; a Fast Fight turns it off.
 */
export async function setPlayThrough(on) {
  if ( !battle ) return;
  if ( on ) checkFast({ pressed: true });
  battle.data.auto = !!on;
  await keep();
  if ( on && battle.combat.combatant && battle.data.played === turnKey(battle.combat.combatant) ) continueBattle();
}

/* -------------------------------------------- */
/*  Fast Fight                                  */
/* -------------------------------------------- */

/** Is a Fast Fight running on the battle this browser plays? */
export const fastRunning = () => !!battle?.fast;

/** Does the Battle Vantage offer Fast Fight on this battle (fast-fight.js fastFightOffered)? */
export function fastOffered(b = battle) {
  if ( !b || b !== battle ) return false;
  return fastFightOffered({
    running: !!b.fast, started: !!b.combat?.started, ended: !!b.data.ended, prepared: !!b.data.prepared, playersRun: b.data.playersRun, players: b.data.players ?? []
  });
}

/** How fast tokens walk a turn's moves: a Fast Fight's speed, else the usual (make-it-so.js). */
const moveSpeed = () => (battle?.fast ? FAST_MOVE_SPEED : undefined);

/**
 * ">> Fast Fight >>" (the Battle Vantage's), and its Stop. Pressed, the rest of the fight is played turn after turn:
 * no GMs' card after each turn and no wait for Next Turn (settleTurn: afterTurn), each turn kept for Rewind as ever;
 * the moves on the map quick (FAST_MOVE_SPEED), Dice So Nice's 3D dice off (fast-fight.js hushDice), Play to the end
 * off. It goes from where the battle is: a turn played and waiting, on to the next; one not played yet, played. It
 * stops as fastFightStop says (checkFast): pressed again, the battle over, a player's character to act, a GM wanted,
 * the tracker used, or something gone wrong; two still rounds ask the GM whether it goes on (askStill). It doesn't
 * start while this GM is signed in somewhere else too (twin-sessions.js): the other session sends the tracker back.
 */
export async function fastFight() {
  if ( !battle || !playsHere() ) return null;
  if ( battle.fast ) {
    checkFast({ pressed: true });
    return null;
  }
  if ( !fastOffered() ) return null;
  if ( await twinSession() ) {
    ui.notifications.warn(fmt("FASTFIGHTING.Live.FastTwin", { name: game.user.name }));
    return null;
  }
  // (Asked while that was found out: as it is now.)
  if ( !battle || battle.fast || !fastOffered() ) return null;
  const auto = !!battle.data.auto;
  battle.data.auto = false;
  battle.fast = { had: [...(battle.data.players ?? [])], pending: null, moment: fightMoment(battle.run.units), since: null, least: rangeOf("maxRounds").min };
  hushDice();
  changed();
  return queue(() => goFast(auto));
}

/**
 * A Fast Fight begins where the battle is (in the queue, after whatever was under way): on its way already (a turn
 * just played moved on by itself, or a turn change waits to begin its turn), nothing more; a turn played and waiting
 * on the GM, or no one in the spotlight, on to the next; one not played yet, played (as Play it); a player's, it stops.
 */
async function goFast(auto = false) {
  if ( !battle?.fast || battle.data.ended ) return;
  if ( auto ) await keep();
  // (Stopped, or the battle over, while that was kept.)
  if ( !battle?.fast || battle.data.ended || battle.fast.pending || turnsWaiting > 0 ) return;
  const combatant = battle.combat.combatant;
  const u = combatant ? unitOf(combatant) : null;
  if ( battle.pc || (u && playerRuns(battle.run, u) && !GONE.has(u.status)) ) {
    checkFast({ playerTurn: true });
    return;
  }
  if ( !combatant || battle.data.played === turnKey(combatant) ) {
    moveOn().catch(failed);
    return;
  }
  await turnBegins(combatant);
}

/**
 * Does a Fast Fight stop here (fast-fight.js fastFightStop, with what's known now: `state`)? It stops: the GMs told
 * why, where it wasn't their own doing. Returns why, or null.
 */
function checkFast(state = {}) {
  if ( !battle?.fast ) return null;
  const why = fastFightStop({ players: battle.data.players ?? [], had: battle.fast.had, ...state });
  if ( !why ) return null;
  endFast();
  if ( FAST_STOP_NOTES.includes(why) ) ui.notifications?.info(fmt(`FASTFIGHTING.Live.FastStopped.${why}`));
  changed();
  return why;
}

/**
 * A Fast Fight gone two whole rounds with nothing changing (stillSince): the GM asked whether it goes on. On, it counts
 * afresh from this turn, and isn't asked again for STILL_AGAIN more rounds; not, it stops here, and the turn waits for
 * the GM as any other.
 */
async function askStill(round, u) {
  const on = await foundry.applications.api.DialogV2.confirm({
    window: { title: loc("FASTFIGHTING.Live.FastStill.Title") },
    content: `<p>${escape(loc("FASTFIGHTING.Live.FastStill.Ask"))}</p>`
  });
  if ( !battle?.fast ) return;
  if ( on ) Object.assign(battle.fast, { since: { round, id: u.id }, least: round - 1 + STILL_AGAIN });
  else {
    endFast();
    changed();
  }
}

/** A Fast Fight over, however it ended: Dice So Nice as it was. */
function endFast() {
  if ( battle ) battle.fast = null;
  unhushDice();
}

/* -------------------------------------------- */
/*  Players away                                */
/* -------------------------------------------- */

/**
 * The players (not GMs) who own each creature in the battle, a summons' own and its summoner's: away.js's characters,
 * `{id, owners}`. `standing`: only those still in the fight.
 */
function ownedUnits({ standing = false } = {}) {
  const run = battle.run;
  const ownersOf = (u, seen = new Set()) => {
    if ( !u || seen.has(u.id) ) return [];
    seen.add(u.id);
    const actor = docOf(u.id)?.actor;
    const own = actor ? game.users.filter(p => !p.isGM && actor.testUserPermission(p, "OWNER")).map(p => p.id) : [];
    return [...new Set([...own, ...(u.summoner ? ownersOf(run.byId.get(u.summoner), seen) : [])])];
  };
  return run.units.filter(u => !standing || !GONE.has(u.status)).map(u => ({ id: u.id, owners: ownersOf(u) }));
}

/** The players (not GMs) connected now, by id. */
const connectedPlayers = () => new Set(game.users.filter(p => !p.isGM && p.active).map(p => p.id));

/** The away countdowns, `{id: deadline}` (kept as battle.data.awayTimers, `[[id, deadline]]`: ids as they are). */
const timersNow = () => Object.fromEntries(battle?.data.awayTimers ?? []);

/** The countdowns from now on: kept with the battle, and run here. True if they changed. */
function setTimers(timers) {
  const before = JSON.stringify(battle.data.awayTimers ?? []);
  battle.data.awayTimers = Object.entries(timers);
  armClocks();
  return JSON.stringify(battle.data.awayTimers) !== before;
}

/** How long a countdown lasts (ms), as the autoPlayAbsentSeconds setting says. */
const awayMs = () => (Number(setting("autoPlayAbsentSeconds")) || 120) * 1000;

/** One timeout for each countdown, in the browser that plays the battle (timeUp as each runs out). */
const clocks = deadlineClocks({ due: () => queue(timeUp) });

/** Players joining, handed their characters back once they've stayed BACK_AFTER_MS (handBackTo). */
const joins = joinWaits({ ms: BACK_AFTER_MS, settled: user => queue(() => handBackTo(user)) });

/** The countdowns run here while this browser plays the battle and it goes on; nowhere else. */
function armClocks() {
  if ( battle && playsHere() && !battle.data.ended ) clocks.arm(timersNow());
  else clocks.clear();
}

/**
 * This browser holds no battle now: its countdowns and waits stop (the browser that picks it up runs them), and a Fast
 * Fight with them.
 */
function letGo() {
  if ( battle?.fast ) endFast();
  battle = null;
  clocks.clear();
  joins.clear();
}

/**
 * A battle going on, played here, its encounter begun, its players running their characters: what players coming and
 * going change. (The planner's Players run their characters off: FastFighting plays everyone, whoever comes or goes.)
 */
const playersRunHere = () => battle?.data.playersRun !== false;
const awayMatters = () => !!battle && playsHere() && !battle.data.ended && !battle.data.prepared && playersRunHere();

/**
 * A player left (userConnected): with the autoPlayAbsent setting on, each character of theirs the players run, none of
 * its players left, gets a countdown (away.js awayTimers). Their characters handed back if they stay: not now.
 */
async function playerLeft(userId) {
  joins.left(userId);
  if ( !awayMatters() ) return;
  const timers = awayTimers({
    units: ownedUnits({ standing: true }), connected: connectedPlayers(), players: new Set(battle.data.players ?? []), timers: timersNow(),
    user: userId, from: Date.now(), ms: awayMs(), on: !!setting("autoPlayAbsent")
  });
  if ( !setTimers(timers) ) return;
  await keep();
}

/**
 * A player joined (userConnected): their characters' countdowns stop at once (away.js stillAway); once they've stayed
 * BACK_AFTER_MS, the characters of theirs FastFighting plays are handed back (handBackTo).
 */
async function playerJoined(userId) {
  if ( !battle || !playsHere() || battle.data.ended || !playersRunHere() ) return;
  joins.joined(userId);
  if ( !battle.data.awayTimers?.length ) return;
  if ( !setTimers(stillAway({ units: ownedUnits(), connected: connectedPlayers(), timers: timersNow() })) ) return;
  await keep();
}

/**
 * A player who joined BACK_AFTER_MS ago and is still here: every character they own that FastFighting plays (their
 * summons too) is theirs again, as if a GM had cleared FastFighting plays their turns, however it came to be ticked
 * (away.js handBack); its countdown, if any, goes. The GMs are told once, by name.
 */
async function handBackTo(userId) {
  const user = game.users.get(userId);
  if ( !battle || !playsHere() || battle.data.ended || !playersRunHere() || !user?.active || user.isGM ) return;
  const units = ownedUnits();
  const ids = handBack({ units, players: new Set(battle.data.players ?? []), user: userId });
  const stopped = setTimers(stillAway({ units, connected: connectedPlayers(), timers: timersNow() }));
  if ( !ids.length ) {
    if ( stopped ) await keep();
    return;
  }
  ui.notifications?.info(fmt("FASTFIGHTING.Live.HandedBack", { player: user.name, names: listJoin(ids.map(id => battle.run.byId.get(id)?.spec.name ?? "")) }));
  await automate(ids, false);
}

/**
 * A countdown ran out (away.js dueTimers): a character still with none of its players connected is FastFighting's to
 * play from now, as if a GM had ticked FastFighting plays their turns (an untouched open turn of its own, played at
 * once). The GMs are told once, by name. The setting off since: no countdowns.
 */
async function timeUp() {
  if ( !battle || !playsHere() || battle.data.ended ) return;
  if ( !setting("autoPlayAbsent") || !playersRunHere() ) {
    if ( setTimers({}) ) await keep();
    return;
  }
  const { automate: ids, timers } = dueTimers({ units: ownedUnits(), connected: connectedPlayers(), players: new Set(battle.data.players ?? []), timers: timersNow(), now: Date.now() });
  const stopped = setTimers(timers);
  if ( !ids.length ) {
    if ( stopped ) await keep();
    return;
  }
  ui.notifications?.info(fmt("FASTFIGHTING.Live.AwayPlayed", { names: listJoin(ids.map(id => battle.run.byId.get(id)?.spec.name ?? "")) }));
  await automate(ids, true);
}

/**
 * The encounter begins: each character the players run with none of its players connected gets its countdown from
 * now, as if they had left as it began (the setting on).
 */
function timersAtStart(from) {
  if ( !playersRunHere() ) return;
  setTimers(awayTimers({ units: ownedUnits({ standing: true }), connected: connectedPlayers(), players: new Set(battle.data.players ?? []), from, ms: awayMs(), on: !!setting("autoPlayAbsent") }));
}

/** The autoPlayAbsent setting turned off: the countdowns stop. */
function awaySetting(on) {
  if ( on || !battle || !playsHere() || !battle.data.awayTimers?.length ) return;
  if ( setTimers({}) ) keep();
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
    const found = kept(combat.id, flag.id);
    const data = found?.data;
    if ( !data?.snapshot || !runsHere(data) ) continue;
    data.user = game.user.id; // (its GM gone: this one plays it now)
    // (And whether FastFighting is in use for it, for a battle kept before the flag said so: flagOf's inUse.)
    const inUse = flag.inUse ?? (flag.active && (!data.prepared || !!data.touched));
    await combat.setFlag(MODULE_ID, "live", { ...flag, user: game.user.id, inUse });
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
    battle = { combat, scene, spec, rules, run, pc: null, data, keptSpec: data.spec, transcriptId: found.doc.id };
    // (Rolls made with the system's own roller, where this helper can, and a player's reaction by the player: a battle
    // begun before, too.)
    run.live.systemRolls = systemRollKinds(getAdapter());
    run.live.readsRolls = offers(getAdapter(), "readTurn");
    playersNow();
    if ( data.pc ) {
      const own = m => m.getFlag(MODULE_ID, "story") || m.getFlag(MODULE_ID, "live");
      const { sheets, ...pc } = data.pc;
      battle.pc = { ...pc, messages: game.messages.filter(m => m.timestamp >= data.pc.from && !own(m) && madeFor(m, data.pc.id)).map(m => m.id) };
      // (Every sheet as the turn began, for a Rewind of it. Kept before they were: as they are now, and the GM told that
      // what was done by hand so far stays.)
      sheetsAt.set(battle.pc, sheets ?? captureSheets());
      if ( !sheets ) ui.notifications.warn(loc("FASTFIGHTING.Live.HandChangesKept"));
      // (Where its token is now: a move with nothing to answer isn't kept.)
      const token = docOf(data.pc.id)?.object;
      if ( token ) {
        const p = positionOf(token);
        syncFromSheets(battle.run, { [data.pc.id]: { position: { x: p.x, y: p.y } } });
      }
    }
    // (Its countdowns run here now, as they were kept: none with the setting off, nor for one whose player is back.)
    const timers = setting("autoPlayAbsent") ? stillAway({ units: ownedUnits(), connected: connectedPlayers(), timers: timersNow() }) : {};
    if ( setTimers(timers) ) keep();
    ui.notifications.info(loc("FASTFIGHTING.Live.PickedUp"));
    return;
  }
}

export function registerLiveBattles() {
  // (The damage cards this GM's battle applied itself: a helper takes its system's Apply off them.)
  notedBy(id => !!battle && !!game.user?.isGM && appliedIn(battle.data, battle.pc, id));
  CONFIG.queries[QUERIES.liveAsk] = answerAsk;
  CONFIG.queries[QUERIES.liveRoll] = answerRoll;
  CONFIG.queries[QUERIES.liveReactionDone] = answerReactionDone;
  CONFIG.queries[QUERIES.liveDealAnswer] = answerDealQuery;
  CONFIG.queries[QUERIES.liveDeal] = answerDealRequest;
  // (The deal card a player's turn brings: gone with the next card posted, as the GM's browser sees it.)
  Hooks.on("createChatMessage", message => {
    const card = battle?.pc?.dealCard;
    if ( !card || message.id === card || !game.user.isGM || !playsHere() ) return;
    battle.pc.dealCard = null;
    game.messages.get(card)?.delete().catch(() => null);
  });
  // (A Fast Fight's chat cards: no 3D dice, nothing left waiting on them.)
  registerQuietDice();
  Hooks.on("combatTurnChange", onTurnChange);
  // (Taken back before the start, which Foundry doesn't tell as a turn change.)
  Hooks.on("updateCombat", onUnstarted);
  // (A player's tracker: no Previous Turn while FastFighting is in use for its encounter; drawn again as that changes.)
  Hooks.on("renderCombatTracker", playersTracker);
  Hooks.on("updateCombat", (combat, changes) => {
    if ( foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) && combat === (ui.combat?.viewed ?? game.combat) ) ui.combat?.render();
  });
  Hooks.on("updateToken", (doc, changes) => {
    if ( !battle?.pc || doc.id !== unitTokenId(battle.run, battle.pc.id) || !("x" in changes || "y" in changes) || !playsHere() ) return;
    queue(() => playerMoved(doc));
  });
  Hooks.on("createChatMessage", onMessage);
  // (The system's own lines about FastFighting's writes: the battle's, and none as a Rewind takes them back.)
  registerSideLines();
  // (Players' damage waiting on a GM, applied some other way: its line goes.)
  Hooks.on("updateActor", actor => {
    const pc = battle?.pc;
    if ( pc && playsHere() ) noteSheet(actor);
    if ( (!pc?.damage?.length && !battle?.data.waiting?.length) || applying || !playsHere() ) return;
    queue(() => dropApplied(actor));
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
  // (The active GM: the transcripts tidied first, as the troubleshooting setting says.)
  Hooks.once("ready", async () => {
    try {
      await tidyOnLogin();
    } catch ( err ) {
      console.error(`${MODULE_ID} | tidying the live battles' transcripts`, err);
    }
    pickUp();
  });
  // (Its GM left: the active GM picks it up. A player left or joined: their characters' countdowns start or stop, and
  // once they've stayed, their characters are theirs again.)
  Hooks.on("userConnected", (user, connected) => {
    if ( !battle ) pickUp();
    if ( !user || user.isGM || !game.user.isGM ) return;
    // (Not in the queue: a countdown starts as they go, even while a turn waits on someone.)
    if ( connected ) playerJoined(user.id);
    else playerLeft(user.id);
  });
  followSetting("autoPlayAbsent", awaySetting);
  // (Another GM rewound it, began another, or picked it up while this one was away: this browser lets go of the one it
  // held, and takes up one that's its own now.)
  // (Foundry's own Begin Encounter, a battle prepared on it: the battle begins with it.)
  Hooks.on("updateCombat", combat => {
    if ( battle?.combat === combat && battle.data.prepared && combat.started && playsHere() ) beginEncounter();
  });
  Hooks.on("updateCombat", (combat, changes) => {
    if ( !foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) ) return;
    if ( battle?.combat === combat && !stillHere() ) {
      letGo();
      changed();
    }
    if ( !battle ) pickUp();
  });
  Hooks.on("deleteCombat", combat => {
    if ( battle?.combat === combat ) {
      letGo();
      changed();
    }
    // (Its transcript goes with it, unless the GM is troubleshooting: live-journals.js.)
    if ( game.user.isActiveGM ) inTurn(() => dropTranscripts("combatDeleted", combat.id));
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
          const gm = cardGm(game.users, message.author.id);
          await gm?.query(QUERIES.liveReactionDone, { key: live.reaction }).catch(() => null);
        });
        continue;
      }
      // (A player's turn's deal card: the deal dialog, in their browser, or a GM's.)
      if ( button.dataset.ffLive === "dealOpen" && live?.dealOpen && message.author?.isGM ) {
        const token = typeof live.pcToken === "string" ? fromUuidSync(live.pcToken) ?? null : null;
        if ( !token?.actor || (!game.user.isGM && !token.actor.testUserPermission(game.user, "OWNER")) ) {
          button.remove();
          continue;
        }
        button.addEventListener("click", async event => {
          event.preventDefault();
          const { DealDialog } = await import("../apps/deal-dialog.js");
          new DealDialog(token, { toll: live.toll === true, names: live.names, gmId: message.author.id }).render({ force: true });
        });
        continue;
      }
      // (A player's deal card: its buttons theirs too, the GM playing the battle told by a query.)
      if ( (button.dataset.ffLive === "dealAccept" || button.dataset.ffLive === "dealRefuse") && live?.deal && message.author?.isGM ) {
        const actor = typeof live.pcToken === "string" ? fromUuidSync(live.pcToken)?.actor ?? null : null;
        if ( !game.user.isGM && !actor?.testUserPermission(game.user, "OWNER") ) {
          button.remove();
          continue;
        }
        button.addEventListener("click", async event => {
          event.preventDefault();
          for ( const b of html.querySelectorAll("[data-ff-live^='deal']") ) b.disabled = true;
          const answer = button.dataset.ffLive === "dealAccept" ? "accept" : "refuse";
          const here = dealsWaiting.get(live.deal);
          if ( here?.pcToken ) return here.resolve(answer);
          const gm = cardGm(game.users, message.author.id);
          await gm?.query(QUERIES.liveDealAnswer, { key: live.deal, answer }).catch(() => null);
        });
        continue;
      }
      if ( !game.user.isGM || !message.author?.isGM || !live ) {
        button.remove();
        continue;
      }
      // (A deal waiting on the GM's review: its window again.)
      if ( button.dataset.ffLive === "dealReview" ) {
        button.addEventListener("click", event => {
          event.preventDefault();
          if ( !openDealReview(live.dealReview) ) ui.notifications.warn(loc("FASTFIGHTING.Live.NotHere"));
        });
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

