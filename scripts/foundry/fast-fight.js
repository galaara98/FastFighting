/**
 * Fast Fight (the Battle Vantage's ">> Fast Fight >>", live-battle.js plays it): the rest of a live battle where
 * FastFighting plays every token, turn after turn, with no wait and no GMs' card after each turn. Everything else is as
 * in any live battle: the moves on the map (only quicker, FAST_MOVE_SPEED), the system's own cards, the table rolls,
 * the story, the sheets, and each turn kept for Rewind. Dice So Nice's 3D dice are off while it runs (hushDice).
 * Its rules here are plain data, pure (no Foundry globals), but for Dice So Nice's own switches.
 */
import { MODULE_ID } from "../constants.js";

/** How fast tokens walk their moves in a Fast Fight, in grid squares a second (make-it-so.js plays a turn's at 10). */
export const FAST_MOVE_SPEED = 60;

/**
 * Does the Battle Vantage offer Fast Fight? While it runs, always (as its Stop). Otherwise in a battle begun and not
 * over where FastFighting plays every token: the planner's Players run their characters off, or no character the
 * players run (`players`: the battle's list of them).
 */
export function fastFightOffered({ running = false, started = false, ended = false, prepared = false, playersRun = true, players = [] } = {}) {
  if ( running ) return true;
  if ( !started || ended || prepared ) return false;
  return playersRun === false || !(players?.length);
}

/**
 * Why a Fast Fight stops now, or null while it goes on. What's known at that moment:
 *   - pressed: the GM pressed Stop (or the Battle Vantage's Next Turn or Rewind, or Play to the end);
 *   - failed: something went wrong;
 *   - ended: the battle is over;
 *   - change: a turn change on the tracker (fastTurnChange): "theirs", the GM used the tracker;
 *   - playerTurn: the turn beginning is a character its player runs; `players` and `had`, the characters the players
 *     run now and as the Fast Fight began: one more (handed back to a player who came back, or by the GM), and it stops;
 *   - asks: a GM is wanted ("roll", a save or check the helper leaves to them; "question", a reaction to allow;
 *     "damage", a player's reaction's damage to say; "player", a player's reaction to wait on; "review", a player's
 *     turn to look over; "spotlight", the spotlight to give);
 * The first that holds is why: "pressed", "error", "ended", "tracker", "player" or "gm". (A fight going nowhere isn't
 * one of them: the GM is asked whether it goes on, stillSince. A live battle never ends as a stalemate: Max rounds is
 * the simulation's alone.)
 */
export function fastFightStop({ pressed = false, failed = false, ended = false, change = null, playerTurn = false, players = [], had = [], asks = null } = {}) {
  if ( pressed ) return "pressed";
  if ( failed ) return "error";
  if ( ended ) return "ended";
  if ( change === "theirs" ) return "tracker";
  if ( playerTurn || (players ?? []).some(id => !(had ?? []).includes(id)) ) return "player";
  if ( asks ) return "gm";
  return null;
}

/** Where a fight stands, as one string: each creature's HP, its state, and whether it was talked over. */
export function fightMoment(units = []) {
  return units.map(u => `${u.id}:${Math.round(Number(u.hp) || 0)}:${u.status ?? ""}:${u.swayOutcome ?? ""}`).join("|");
}

/** How many whole rounds a Fast Fight goes with nothing changing before the GM is asked whether it goes on. */
export const STILL_ROUNDS = 2;

/**
 * STILL_ROUNDS whole rounds gone by with nothing changing: `since`, the round and the creature whose turn it was when
 * the fight last changed (fightMoment), or when the GM said to go on; `round` and `id`, the turn beginning now. That
 * creature's turn has come round that many times, or one round more has begun (its turns may have stopped coming).
 */
export function stillSince(since, round, id) {
  if ( !since ) return false;
  const gone = round - since.round;
  return gone > STILL_ROUNDS || (gone === STILL_ROUNDS && id === since.id);
}

/** Why it stopped, said to the GMs (what they didn't do themselves): FASTFIGHTING.Live.FastStopped.<why>. */
export const FAST_STOP_NOTES = Object.freeze(["tracker", "player", "gm"]);

/**
 * A turn change on the tracker while a Fast Fight runs (Foundry's combatTurnChange: `prior` and `current`, each
 * {round, turn, combatantId}): "same" where nobody moved it, only the order changed in the same round (one joined or
 * left the tracker: the same combatant at another place, or another at the same place); "ours" where it's the Fast
 * Fight's own move on, from where it was (`pending`, the place it moved on from; null, none on its way); else
 * "theirs": the GM (or anyone) used the tracker.
 */
export function fastTurnChange(pending, prior, current) {
  const v = (o, k) => o?.[k] ?? null;
  const same = k => v(prior, k) === v(current, k);
  if ( same("round") && (same("turn") || same("combatantId")) ) return "same";
  if ( pending && ["round", "turn", "combatantId"].every(k => v(prior, k) === v(pending, k)) ) return "ours";
  return "theirs";
}

/* -------------------------------------------- */
/*  Dice So Nice                                */
/* -------------------------------------------- */

/** Dice So Nice's id, and its flag that leaves a message's dice unthrown on every client. */
const DSN = "dice-so-nice";
export const QUIET_FLAGS = Object.freeze({ [`flags.${DSN}.skip`]: true });

/** While a Fast Fight runs in this browser: how to put Dice So Nice back as it was ({restore}); else null. */
let hushed = null;

/** Are the 3D dice off for a Fast Fight in this browser? */
export const diceHushed = () => !!hushed;

/**
 * Dice So Nice's 3D dice off for a Fast Fight: in this browser, its chat hook (`dice3d.messageHookDisabled`, as it was
 * kept to put back); and every chat message this browser makes meanwhile flagged to skip them on every client
 * (QUIET_FLAGS: registerQuietDice). Nothing is changed that outlives the page: a reload has Dice So Nice as it was.
 * Without Dice So Nice, only the flags, which nothing reads.
 */
export function hushDice(dice3d = globalThis.game?.dice3d ?? null) {
  if ( hushed ) return;
  const has = !!dice3d && typeof dice3d === "object" && "messageHookDisabled" in dice3d;
  const was = has ? dice3d.messageHookDisabled : undefined;
  if ( has ) dice3d.messageHookDisabled = true;
  hushed = { restore: () => { if ( has ) dice3d.messageHookDisabled = was; } };
}

/** Dice So Nice as it was before the Fast Fight (hushDice), once it's over, however it ended. */
export function unhushDice() {
  const h = hushed;
  hushed = null;
  try {
    h?.restore();
  } catch ( err ) {
    // (Dice So Nice gone meanwhile: nothing to put back.)
  }
}

/** The option a message made in a Fast Fight carries from its preCreate to its create, in this browser. */
const QUIET_OPTION = `${MODULE_ID}QuietDice`;

/**
 * While the 3D dice are off for a Fast Fight (hushDice): each chat message this browser makes skips Dice So Nice on
 * every client. One with rolls tells whoever waits on Dice So Nice here that its dice are done, as Dice So Nice would
 * have once they'd rolled (diceSoNiceRollComplete: PF2e's critical hit and fumble cards wait on it), so nothing waits
 * on dice nobody throws.
 */
export function registerQuietDice() {
  Hooks.on("preCreateChatMessage", (message, data, options) => {
    if ( !hushed ) return;
    message.updateSource(QUIET_FLAGS);
    if ( options ) options[QUIET_OPTION] = true;
  });
  Hooks.on("createChatMessage", (message, options, userId) => {
    if ( !options?.[QUIET_OPTION] || userId !== game.user?.id || !message.isRoll || !game.modules.get(DSN)?.active ) return;
    Hooks.callAll("diceSoNiceRollComplete", message.id, []);
  });
}
