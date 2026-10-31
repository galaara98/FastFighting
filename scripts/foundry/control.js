/**
 * One GM in control of FastFighting at a time (the world's `controller` setting): their browser alone plays the live
 * battles, writes plans, and answers what FastFighting hears (turn changes, chat, sheets). Every other GM's Battle
 * Planner and Battle Vantage are read only, with Take Control.
 *   - Take Control: the GM in control, where they're here, is asked to hand over (handOver: their queue finished, the
 *     battle they hold kept and let go), then the setting names the GM who took it. One who doesn't answer in time,
 *     or isn't here, isn't waited on.
 *   - The GM in control gone for GONE_MS (a reload is back sooner), or not here as another GM comes: the active GM
 *     (Foundry's) names themself, so the one who left is read only when they're back, until they take it back. Meanwhile
 *     no one's in control. A world where no one has been named yet: the active GM, at once.
 * Who's in control (controllerOf) is pure; the rest needs Foundry.
 */
import { MODULE_ID } from "../constants.js";

/** The query that asks the GM in control to hand over. */
export const HAND_CONTROL = `${MODULE_ID}.handControl`;

/** How long Take Control waits on the GM in control to hand over, and how long a hand-over waits on the setting. */
export const HAND_MS = 10000;

/** How long the GM in control may be gone (a reload) before the active GM takes control. */
export const GONE_MS = 15000;

/**
 * Who's in control, pure: the GM named (`chosen`, a user id), here or not (one gone is replaced by claimIfGone); none
 * named, or not a GM, the active GM (`activeGM`, an id, Foundry's), or null. `users`: [{id, isGM}].
 */
export function controllerOf({ chosen = null, users = [], activeGM = null } = {}) {
  const named = chosen ? users.find(u => u.id === chosen) : null;
  if ( named?.isGM ) return named.id;
  return activeGM ?? null;
}

/** This browser handing over: in control no more, while the setting catches up (or HAND_MS * 2, should it not). */
let handing = false;
let handTimer = null;

/** What this browser does to hand over (live-battle.js: its battle kept and let go), given `done`, called once it's in hand. */
let release = async done => done();

/** live-battle.js's part of a hand-over. */
export const onHandOver = fn => { release = fn; };

const chosenNow = () => {
  try {
    return game.settings.get(MODULE_ID, "controller") || null;
  } catch ( err ) {
    return null;
  }
};

/** The GM in control now (a User, maybe gone a moment), or null. */
export function controller() {
  const id = controllerOf({ chosen: chosenNow(), users: game.users?.contents ?? [], activeGM: game.users?.activeGM?.id ?? null });
  return id ? game.users.get(id) ?? null : null;
}

/** Is this browser the one in control? Never a player's. */
export const inControl = () => !!game.user?.isGM && !handing && !!controller()?.isSelf;

/** Is the GM in control here? */
export const controllerHere = () => !!controller()?.active;

/** Who's in control changed (the setting, a GM come or gone, a hand-over begun): the apps and live battles follow it. */
const changed = () => Hooks.callAll("fastFighting.control", controller());

/** Take Control (a read-only GM's): the GM in control asked to hand over first, where they're here. */
export async function takeControl() {
  if ( !game.user?.isGM || inControl() ) return;
  const now = controller();
  if ( now && !now.isSelf && now.active ) {
    try {
      await now.query(HAND_CONTROL, {}, { timeout: HAND_MS });
    } catch ( err ) {
      // (Gone meanwhile, or too slow: taken all the same.)
    }
  }
  await game.settings.set(MODULE_ID, "controller", game.user.id);
}

/** Asked to hand over (Foundry says who asks: another GM): this browser's battle kept and let go, then it answers. */
async function handOver(data, { user } = {}) {
  if ( !user?.isGM || user.isSelf || !inControl() ) return false;
  try {
    await release(() => {
      handing = true;
      changed();
    });
  } catch ( err ) {
    console.error(`${MODULE_ID} | handing over control`, err);
  }
  handing = true;
  clearTimeout(handTimer);
  // (The setting never came: in control again, as it still says.)
  handTimer = setTimeout(() => {
    handing = false;
    changed();
  }, HAND_MS * 2);
  return true;
}

/**
 * The GM named not here (or none named yet): the active GM names themself, told where it was someone else's. Only that
 * one browser writes it.
 */
async function claimIfGone() {
  if ( !game.user?.isGM || !game.user.isActiveGM ) return;
  const chosen = chosenNow();
  const named = chosen ? game.users.get(chosen) : null;
  if ( named?.isSelf || (named?.isGM && named.active) ) return;
  await game.settings.set(MODULE_ID, "controller", game.user.id);
  if ( named ) ui.notifications.info(game.i18n.format("FASTFIGHTING.Control.Claimed", { name: named.name }));
}

/** The setting changed: a hand-over done, the GMs who lost control told who has it. */
export function controlSettingChanged() {
  clearTimeout(handTimer);
  const was = handing;
  handing = false;
  const now = controller();
  if ( game.user?.isGM && now && !now.isSelf && was ) ui.notifications.info(game.i18n.format("FASTFIGHTING.Control.TakenBy", { name: now.name }));
  changed();
}

const claim = () => claimIfGone().catch(err => console.error(`${MODULE_ID} | taking control`, err));
let goneTimer = null;

export function registerControl() {
  CONFIG.queries[HAND_CONTROL] = handOver;
  Hooks.once("ready", () => {
    claim();
    changed();
  });
  // (The GM in control gone: taken over if they aren't back in GONE_MS.)
  Hooks.on("userConnected", (user, connected) => {
    if ( !user?.isGM ) return;
    changed();
    if ( connected || user.id !== chosenNow() ) return;
    clearTimeout(goneTimer);
    goneTimer = setTimeout(claim, GONE_MS);
  });
}
