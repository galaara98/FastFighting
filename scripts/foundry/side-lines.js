/**
 * The chat lines a system posts by itself as FastFighting writes a sheet (foundry-ironsworn's change log: "+2 momentum
 * (now 4)", "… progress advanced") or moves the tracker (PF2e's "Current Conditions" as a turn starts): made in the
 * middle of FastFighting's own work, they're its own, and a Rewind takes them.
 *   - Writing a live battle's turn (writingFor): each is marked as the battle's (flags.fast-fighting.live.battle), and
 *     goes into the turn's cards (`into`) once made, so taking the turn back deletes it; Rewind This Encounter deletes
 *     every card marked as the battle's.
 *   - Moving a live battle's tracker (movingTracker): a system posts its turn's start once the tracker has moved, in its
 *     own time, so the lines made as it moves and for a moment after (SETTLE) are the battle's. One for the creature
 *     whose turn it is (startOf) is marked with the turn it started (`start`: {round, combatantId, move}), unless
 *     FastFighting is playing that turn already (turnBegun: what's posted then is the turn's own; startLine). One for a
 *     turn told of in an earlier move (a Rewind went back to it) takes the place of those (startedBefore). Rewind deletes those of turns it goes back past (startedAfter);
 *     Rewind This Encounter, all of them. A system may post none (PF2e's are a setting the GM may turn off), and the GM
 *     may delete one before a Rewind: then there's nothing to mark or delete (forgetLine).
 *   - Taking a write back (takingBack, a Rewind): none is posted at all. What it would tell of undoes FastFighting's own
 *     change, whose line goes too.
 * A side line is a message this browser's user makes (the GM's, writing), with no dice (a roll's card is the turn's own,
 * gathered as it always was), not FastFighting's own, that speaks for a creature in the battle (`actors`, by id).
 * Anything else posted meanwhile, a player's chat or the GM's own, is left alone: a line typed in the chat while
 * FastFighting writes or moves the tracker, in character or not, is marked as typed as it's made (typedLine), and never
 * taken for a side line.
 * The decisions (sideLine, typedLine, scopeAt, startLine, startedAfter, startedBefore) are pure; the hooks need Foundry.
 */
import { MODULE_ID } from "../constants.js";

/** How long after FastFighting moved the tracker a system's line is still taken for its turn's start, in ms. */
export const SETTLE = 3000;

/** Where FastFighting is writing now: {battle, actors: Set<actorId>, into: string[]|null, drop}, or null. */
let scope = null;
/**
 * FastFighting's latest move of the tracker: {battle, actors, startOf, seq, open (1 while it moves), until (ms), playing
 * (the combatant whose turn FastFighting has begun since, by id)}, or null.
 */
let moved = null;
/** How many moves of the tracker FastFighting has made here: each one's own number (seq). */
let moves = 0;
/** Side lines marked and not yet made: their mark -> the turn's cards they go into. */
const pending = new Map();

/**
 * What becomes of a message about to be made, in `scope` (null: nothing; "drop": not made; "mark": the battle's). Pure.
 * @param {{rolls?: object[], flags?: object, speaker?: object}} message
 * @param {object|null} at     the scope ({actors, drop})
 * @param {boolean} mine       made by this browser's user
 */
export function sideLine(message, at, mine) {
  if ( !at || !mine ) return null;
  if ( (message?.rolls?.length ?? 0) > 0 || message?.flags?.[MODULE_ID] ) return null;
  const actor = message?.speaker?.actor;
  if ( !actor || !at.actors?.has(actor) ) return null;
  return at.drop ? "drop" : "mark";
}

/**
 * The scope a message made `now` (ms) is in: FastFighting's write (`writing`), else its move of the tracker (`move`)
 * while it moves or until it's settled (`until`), else none. Pure.
 */
export function scopeAt(writing, move, now) {
  if ( writing ) return writing;
  return move && (move.open > 0 || now <= move.until) ? move : null;
}

/**
 * The turn's start a line marked in a move (`at`) tells of: `of` (startOf's {round, combatantId}, or null) with the
 * move's number, or null if there's none, or FastFighting is playing that turn already (its own card). Pure.
 */
export function startLine(of, at) {
  if ( !of || !at || at.playing === of.combatantId ) return null;
  return { ...of, move: at.seq };
}

/**
 * A line typed in the chat (Foundry's chatMessage hook: its data before it's made), while FastFighting writes (`at`, the
 * scope): marked as typed, the user's own, so it isn't taken for a side line. Outside a write, left as it is. Pure.
 */
export function typedLine(chatData, at) {
  if ( !at || !chatData || typeof chatData !== "object" ) return chatData;
  const flags = chatData.flags && typeof chatData.flags === "object" ? chatData.flags : {};
  chatData.flags = { ...flags, [MODULE_ID]: { ...(flags[MODULE_ID] ?? {}), typed: true } };
  return chatData;
}

/**
 * The lines a move of `battle`'s tracker made for a turn's start (startOf's mark) that a Rewind going back to `now`
 * ({round, at}) takes: those of turns later than it (`at(combatantId)`: its place in the order, -1 off it). The turn
 * it goes back to keeps its own, until the system tells of it starting again (startedBefore). Pure.
 */
export function startedAfter(messages, battle, now, at) {
  return messages.filter(m => {
    const live = m?.flags?.[MODULE_ID]?.live;
    if ( live?.battle !== battle || !live.start ) return false;
    if ( live.start.round !== now.round ) return live.start.round > now.round;
    return at(live.start.combatantId) > now.at;
  });
}

/**
 * The start lines the system made for the same turn of the same battle as `made` (one just made) in an earlier move of
 * the tracker: told of again, the turn's start replaces them. Those of the same move stay (two lines for one start).
 * Pure.
 */
export function startedBefore(messages, made) {
  const of = made?.flags?.[MODULE_ID]?.live;
  if ( !of?.battle || !of.start ) return [];
  return messages.filter(m => {
    const live = m !== made && m?.id !== made.id ? m?.flags?.[MODULE_ID]?.live : null;
    return live?.battle === of.battle && live.start?.round === of.start.round && live.start.combatantId === of.start.combatantId
      && (live.start.move ?? 0) < (of.start.move ?? 0);
  });
}

/** fn() run with `next` as the scope, the one before put back after. */
async function within(next, fn) {
  const before = scope;
  scope = next;
  try {
    return await fn();
  } finally {
    scope = before;
  }
}

/** fn(), a live battle's turn written: the side lines it makes are the battle's, and go into `into` (a turn's cards). */
export const writingFor = (battle, actors, into, fn) => within({ battle, actors, into: Array.isArray(into) ? into : null, drop: false }, fn);

/** fn(), FastFighting's writes taken back: no side line is made. */
export const takingBack = (actors, fn) => within({ battle: null, actors, into: null, drop: true }, fn);

/**
 * fn(), a live battle's tracker moved: the side lines made meanwhile and for SETTLE after are the battle's, each marked
 * with the turn it starts (`startOf(message)`: {round, combatantId}, or null).
 */
export async function movingTracker(battle, actors, startOf, fn) {
  const move = moved = { battle, actors, startOf, seq: ++moves, into: null, drop: false, open: 1, until: 0, playing: null };
  try {
    return await fn();
  } finally {
    move.open = 0;
    move.until = Date.now() + SETTLE;
  }
}

/** FastFighting begins `combatantId`'s turn: what's posted for it from now on is the turn's own, not its start's. */
export function turnBegun(combatantId) {
  if ( moved ) moved.playing = combatantId ?? null;
}

/** A line deleted if it's still in the chat: the GM, or another browser, may have deleted it already. */
export async function forgetLine(message) {
  if ( !message?.id || !game.messages?.has(message.id) ) return;
  try {
    await message.delete();
  } catch ( err ) {
    if ( game.messages?.has(message.id) ) console.warn(`${MODULE_ID} | deleting a line`, err);
  }
}

/** Rewind going back to `now` ({round, at}): the battle's start lines of the turns after it deleted (startedAfter). */
export async function dropStartsAfter(battle, now, at) {
  for ( const m of startedAfter(game.messages?.contents ?? [], battle, now, at) ) await forgetLine(m);
}

/** The turn a line starts (startOf), or null if it can't be told. */
function startOfLine(at, message) {
  try {
    return at.startOf?.(message) ?? null;
  } catch ( err ) {
    console.warn(`${MODULE_ID} | the turn a line starts`, err);
    return null;
  }
}

function preCreate(message, data, options, userId) {
  const at = scopeAt(scope, moved, Date.now());
  const what = sideLine(message, at, userId === game.user?.id);
  if ( what === "drop" ) return false;
  if ( what !== "mark" ) return;
  const mark = foundry.utils.randomID();
  const start = at.seq ? startLine(startOfLine(at, message), at) : null;
  message.updateSource({ [`flags.${MODULE_ID}.live`]: { battle: at.battle, line: mark, ...(start ? { start } : {}) } });
  if ( at.into ) pending.set(mark, at.into);
}

async function created(message, options, userId) {
  const mark = message.getFlag?.(MODULE_ID, "live")?.line;
  if ( mark && pending.has(mark) ) {
    pending.get(mark).push(message.id);
    pending.delete(mark);
  }
  if ( userId === game.user?.id ) for ( const m of startedBefore(game.messages?.contents ?? [], message) ) await forgetLine(m);
}

export function registerSideLines() {
  Hooks.on("chatMessage", (log, text, chatData) => {
    typedLine(chatData, scopeAt(scope, moved, Date.now()));
  });
  Hooks.on("preCreateChatMessage", preCreate);
  Hooks.on("createChatMessage", created);
}
