/**
 * The Battle Vantage's Next Turn, held while something waits on the GM (a player's turn to review, a reaction being
 * rolled): for the waitHold setting's seconds from when the newest of them came. Pure.
 */

/** The setting's last stop: Next Turn is held until nothing waits on the GM. */
export const HOLD_UNLIMITED = 61;

/**
 * The hold now: `seen`, when each thing waiting came (ms); `seconds`, the setting (0: never held; HOLD_UNLIMITED: until
 * none is left). {held, left (whole seconds), until (ms; null when held for good, or not at all)}.
 */
export function holdOf(seen, now, seconds) {
  if ( !seen.length || !(seconds > 0) ) return { held: false, left: 0, until: null };
  if ( seconds >= HOLD_UNLIMITED ) return { held: true, left: Infinity, until: null };
  const until = Math.max(...seen) + seconds * 1000;
  return until > now ? { held: true, left: Math.ceil((until - now) / 1000), until } : { held: false, left: 0, until: null };
}
