/**
 * Players who leave a live battle and come back (live-battle.js runs it, in the browser that plays the battle), as
 * plain data. Pure: no Foundry globals.
 *   - A player leaves (the autoPlayAbsent setting on): each character they own that the players run and that has no
 *     other of its players connected gets a countdown (autoPlayAbsentSeconds). A player not connected as the battle
 *     begins counts as gone since then.
 *   - A countdown runs out: a character still without any of its players connected is FastFighting's to play.
 *   - A player comes back: their characters' countdowns stop at once; once they've stayed BACK_AFTER_MS, every
 *     character they own that FastFighting plays is theirs again, whoever had FastFighting play it.
 * Each character comes in as `{id, owners}`: the players (not GMs) who own it, a summons' own and its summoner's.
 * `connected` is the players connected now, `players` the ids the players run now (Sets); `timers` is the countdowns
 * as `{id: deadline}` (ms).
 */

/** How long a player who joins must stay before their characters are handed back (a connection that drops and comes back at once hands nothing back). */
export const BACK_AFTER_MS = 12000;

/** One of a character's players is connected. */
const anyHere = (u, connected) => u.owners.some(p => connected.has(p));

/**
 * The countdowns as a player leaves (`user`), or as the battle begins (no `user`: every character): one ending at
 * `from` + `ms` for each character the players run (one `user` owns) with none of its players connected, unless it has
 * one already. Off (`on` false): none, and those pending go.
 */
export function awayTimers({ units, connected, players, timers = {}, user = null, from, ms, on = true }) {
  if ( !on ) return {};
  const out = { ...timers };
  for ( const u of units ) {
    if ( !players.has(u.id) || u.id in out || (user && !u.owners.includes(user)) || anyHere(u, connected) ) continue;
    out[u.id] = from + ms;
  }
  return out;
}

/** The countdowns still running: those of characters one of whose players is connected (back again) go. */
export function stillAway({ units, connected, timers = {} }) {
  const byId = new Map(units.map(u => [u.id, u]));
  return Object.fromEntries(Object.entries(timers).filter(([id]) => {
    const u = byId.get(id);
    return !!u && !anyHere(u, connected);
  }));
}

/**
 * The countdowns run out by `now`: `automate`, the characters FastFighting plays from now (still the players', none of
 * their players connected), and `timers`, those still running.
 */
export function dueTimers({ units, connected, players, timers = {}, now }) {
  const byId = new Map(units.map(u => [u.id, u]));
  const automate = [];
  const left = {};
  for ( const [id, at] of Object.entries(timers) ) {
    if ( at > now ) {
      left[id] = at;
      continue;
    }
    const u = byId.get(id);
    if ( u && players.has(id) && !anyHere(u, connected) ) automate.push(id);
  }
  return { automate, timers: left };
}

/** A player here to stay (`user`): the characters they own that FastFighting plays, to hand back to the players. */
export function handBack({ units, players, user }) {
  return units.filter(u => u.owners.includes(user) && !players.has(u.id)).map(u => u.id);
}

/** Time left on a countdown, as a clock: "1:05" (whole seconds, rounded up). */
export function clockText(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * One timeout for each deadline: `arm(timers)` sets one for each deadline that has none (anew where its deadline
 * moved) and stops those whose countdown is gone; `clear()` stops them all. `due(id)` as each runs out.
 */
export function deadlineClocks({ due, later = (fn, ms) => setTimeout(fn, ms), stop = t => clearTimeout(t), now = () => Date.now() }) {
  const clocks = new Map();
  return {
    arm(timers = {}) {
      for ( const [id, c] of clocks ) {
        if ( timers[id] === c.at ) continue;
        stop(c.handle);
        clocks.delete(id);
      }
      for ( const [id, at] of Object.entries(timers) ) {
        if ( clocks.has(id) ) continue;
        const handle = later(() => {
          clocks.delete(id);
          due(id);
        }, Math.max(0, at - now()));
        clocks.set(id, { at, handle });
      }
    },
    clear() {
      for ( const c of clocks.values() ) stop(c.handle);
      clocks.clear();
    },
    get size() {
      return clocks.size;
    }
  };
}

/**
 * Players joining, each `settled(user)` once they've stayed `ms`: `joined(user)` starts the wait (again, from now),
 * `left(user)` ends it, `clear()` ends them all.
 */
export function joinWaits({ ms = BACK_AFTER_MS, settled, later = (fn, t) => setTimeout(fn, t), stop = t => clearTimeout(t) }) {
  const waits = new Map();
  const left = user => {
    if ( waits.has(user) ) stop(waits.get(user));
    waits.delete(user);
  };
  return {
    joined(user) {
      left(user);
      waits.set(user, later(() => {
        waits.delete(user);
        settled(user);
      }, ms));
    },
    left,
    clear() {
      for ( const t of waits.values() ) stop(t);
      waits.clear();
    },
    waiting: user => waits.has(user)
  };
}
