/**
 * The same GM signed in twice (the desktop app and a browser, two browser windows): Foundry has one active GM, a user,
 * so both sessions are it, and the game system's own turn-start and turn-end work runs in each. The one behind sends the
 * encounter's turn back as it does (a combatant's update carries the turn its sender saw, and Foundry sets the turn to
 * it, telling no turn change), and a live battle's tracker goes back under it.
 * Each browser says hello on the module's socket as it's ready, and one signed in as the same user answers: the GM is
 * told once per twin, and a Fast Fight doesn't start while one is there (twinSession asks afresh). A session going away
 * says goodbye. The decision (twinHeard) is pure; the socket needs Foundry.
 */
import { MODULE_ID } from "../constants.js";

const CHANNEL = `module.${MODULE_ID}`;
const TYPE = "session";

/** This browser's session: its own, so its user's other sessions can be told apart. */
let SESSION = null;
const session = () => (SESSION ??= foundry.utils.randomID());

/** The other sessions of this browser's user heard from, and not gone since. */
const twins = new Set();
/** Those the GM has been told of: their notices, taken down as they go. */
const told = new Map();

/**
 * What a session message means here: "twin" (the same user's other session, here or answering), "gone" (one going away),
 * else null (someone else's, or this session's own). Pure.
 * @param {{type, user, session, bye?}} message
 * @param {{user: string, session: string}} me
 */
export function twinHeard(message, me) {
  if ( message?.type !== TYPE || message.user !== me.user || !message.session || message.session === me.session ) return null;
  return message.bye ? "gone" : "twin";
}

const say = (fields = {}) => game.socket.emit(CHANNEL, { type: TYPE, user: game.user.id, session: session(), ...fields });

/** The GM told of a twin, once each. */
function tell(id) {
  if ( !game.user.isGM || told.has(id) ) return;
  told.set(id, ui.notifications.warn(game.i18n.format("FASTFIGHTING.Live.TwinSession", { name: game.user.name }), { permanent: true }));
}

/** A twin gone: its notice taken down. */
function forget(id) {
  twins.delete(id);
  const notice = told.get(id);
  told.delete(id);
  if ( notice ) {
    try {
      ui.notifications.remove(notice);
    } catch ( err ) {
      // (Closed by the GM already.)
    }
  }
}

/** Listen for the user's other sessions, and say hello (at ready: the socket is up). */
export function registerTwinSessions() {
  game.socket.on(CHANNEL, message => {
    const heard = twinHeard(message, { user: game.user.id, session: session() });
    if ( heard === "gone" ) forget(message.session);
    else if ( heard === "twin" ) {
      twins.add(message.session);
      if ( message.hello ) say({ hello: false });
      tell(message.session);
    }
  });
  window.addEventListener("beforeunload", () => say({ bye: true }));
  say({ hello: true });
}

/** How long a hello waits for the user's other sessions to answer. */
const ANSWER_WAIT = 700;

/**
 * Is this browser's user signed in somewhere else too? None heard from: no. Else asked afresh (one may have gone without
 * a goodbye): a hello, and whoever answers in time.
 */
export async function twinSession() {
  if ( !twins.size ) return false;
  twins.clear();
  say({ hello: true });
  await new Promise(resolve => setTimeout(resolve, ANSWER_WAIT));
  return twins.size > 0;
}
