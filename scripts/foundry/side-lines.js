/**
 * The chat lines a system posts by itself as FastFighting writes a sheet (foundry-ironsworn's change log: "+2 momentum
 * (now 4)", "… progress advanced"): made in the middle of FastFighting's write, they're its own, and a Rewind takes them.
 *   - Writing a live battle's turn (writingFor): each is marked as the battle's (flags.fast-fighting.live.battle), and
 *     goes into the turn's cards (`into`) once made, so taking the turn back deletes it; Rewind This Encounter deletes
 *     every card marked as the battle's.
 *   - Taking a write back (takingBack, a Rewind): none is posted at all. What it would tell of undoes FastFighting's own
 *     change, whose line goes too.
 * A side line is a message this browser's user makes (the GM's, writing), with no dice (a roll's card is the turn's own,
 * gathered as it always was), not FastFighting's own, that speaks for a creature in the battle (`actors`, by id).
 * Anything else posted meanwhile, a player's chat or the GM's own, is left alone: a line typed in the chat while
 * FastFighting writes, in character or not, is marked as typed as it's made (typedLine), and never taken for a side line.
 * The decisions (sideLine, typedLine) are pure; the hooks need Foundry.
 */
import { MODULE_ID } from "../constants.js";

/** Where FastFighting is writing now: {battle, actors: Set<actorId>, into: string[]|null, drop}, or null. */
let scope = null;
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
 * A line typed in the chat (Foundry's chatMessage hook: its data before it's made), while FastFighting writes (`at`, the
 * scope): marked as typed, the user's own, so it isn't taken for a side line. Outside a write, left as it is. Pure.
 */
export function typedLine(chatData, at) {
  if ( !at || !chatData || typeof chatData !== "object" ) return chatData;
  const flags = chatData.flags && typeof chatData.flags === "object" ? chatData.flags : {};
  chatData.flags = { ...flags, [MODULE_ID]: { ...(flags[MODULE_ID] ?? {}), typed: true } };
  return chatData;
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

function preCreate(message, data, options, userId) {
  const what = sideLine(message, scope, userId === game.user?.id);
  if ( what === "drop" ) return false;
  if ( what !== "mark" ) return;
  const mark = foundry.utils.randomID();
  message.updateSource({ [`flags.${MODULE_ID}.live`]: { battle: scope.battle, line: mark } });
  if ( scope.into ) pending.set(mark, scope.into);
}

function created(message) {
  const mark = message.getFlag?.(MODULE_ID, "live")?.line;
  if ( !mark || !pending.has(mark) ) return;
  pending.get(mark).push(message.id);
  pending.delete(mark);
}

export function registerSideLines() {
  Hooks.on("chatMessage", (log, text, chatData) => {
    typedLine(chatData, scope);
  });
  Hooks.on("preCreateChatMessage", preCreate);
  Hooks.on("createChatMessage", created);
}
