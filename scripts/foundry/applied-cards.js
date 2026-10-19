/**
 * The damage cards whose damage FastFighting applied itself in a live battle, or settled by its own sum, whoever made
 * the card: a player's reaction rolled on their screen, a player's own damage card applied for them, a card the GM's
 * browser rolled. The browser that plays the battle notes their ids with the turn that applied them (live-battle.js
 * noteApplied). A helper whose system puts Apply buttons on its damage cards takes them off these (`damageApplied`,
 * core-api, API 20), so nothing is applied twice. Only ids FastFighting noted count, never a flag on the card: anyone
 * may flag their own.
 */

/** Where the ids are: the live battle's own test of a message id (live-battle.js registers it). */
let noted = () => false;

/** The live battle's test of a message id (live-battle.js registerLiveBattles). */
export function notedBy(test) {
  noted = typeof test === "function" ? test : () => false;
}

/**
 * Did FastFighting apply this damage card itself (a message, or its id), in the live battle this GM's browser plays?
 * False anywhere else: another browser, no battle, a card it never applied.
 */
export function damageApplied(message) {
  const id = typeof message === "string" ? message : message?.id;
  if ( typeof id !== "string" || !id ) return false;
  try {
    return noted(id) === true;
  } catch ( err ) {
    return false;
  }
}
