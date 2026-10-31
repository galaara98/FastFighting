/**
 * One GM in control of FastFighting at a time (the world's `controller` setting): their browser alone plays the live
 * battles, writes plans, and answers what FastFighting hears (turn changes, chat, sheets). Every other GM's Battle
 * Planner and Battle Vantage are read only, with Take Control.
 *   - Take Control: the GM in control, where they're here, is asked (Allow or Refuse). Allowed, or no answer in ASK_MS,
 *     they hand over (handOver: their queue finished, the battle they hold kept and let go), then the setting names the
 *     GM who took it; refused, nothing changes, and the one who asked is told. A browser that doesn't answer at all, or
 *     a GM in control who isn't here, isn't waited on.
 *   - Refused twice by the same GM within REFUSE_WINDOW_MS: that asker's Take Control is off for LOCK_MS (in their
 *     browser only: each GM asks for themself), or until Foundry says the GM in control left, or their browser has had
 *     no input for IDLE_MS (asked of it every IDLE_POLL_MS: Foundry doesn't say how long another user's been idle).
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

/** How long the GM in control has to answer Take Control before it's handed over all the same. */
export const ASK_MS = 20000;

/** Two refusals by the same GM within this long lock the asker's Take Control. */
export const REFUSE_WINDOW_MS = 60000;

/** How long Take Control stays off after the second refusal. */
export const LOCK_MS = 5 * 60000;

/** The GM in control's browser this long without input: they're away, and the lock lifts. */
export const IDLE_MS = 2 * 60000;

/** How often a locked asker asks the GM in control's browser how long it's been idle. */
export const IDLE_POLL_MS = 20000;

/** The query that asks a browser how long since its GM last touched it (ms). */
export const CONTROL_IDLE = `${MODULE_ID}.controlIdle`;

/**
 * Until when Take Control is off, pure (ms, or 0: it isn't): two of `refusals` ([{by, at}], ms) by the GM in control
 * now (`by`) within REFUSE_WINDOW_MS of each other lock it for LOCK_MS from the later one.
 */
export function lockedUntil(refusals = [], by = null, now = Date.now()) {
  const times = refusals.filter(r => r.by === by).map(r => r.at).sort((a, b) => a - b);
  let until = 0;
  for ( let i = 1; i < times.length; i++ ) {
    if ( times[i] - times[i - 1] <= REFUSE_WINDOW_MS ) until = Math.max(until, times[i] + LOCK_MS);
  }
  return until > now ? until : 0;
}

/** The GM in control's answer to Take Control (their dialog's), pure: "refuse" refuses; Allow, or none in time, hands over. */
export const handsOver = answer => answer !== "refuse";

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

/** Who's in control changed (the setting, a GM come or gone, a hand-over begun): the apps and live battles follow it. */
const changed = () => Hooks.callAll("fastFighting.control", controller());

/** This browser's refusals ([{by, at}]): its Take Control's lock (lockedUntil). */
let refusals = [];
let lockTimer = null;
let idlePoll = null;

/** When this browser's GM last touched it (pointer, key, wheel): for CONTROL_IDLE. */
let lastInput = Date.now();

/** Is this GM's Take Control off now (refused twice)? Until when, or 0. */
export const takeLocked = () => lockedUntil(refusals, controller()?.id ?? null);

/** The lock lifted (its time up, the GM in control gone or idle): Take Control on again. */
function unlock() {
  refusals = [];
  clearTimeout(lockTimer);
  clearInterval(idlePoll);
  lockTimer = idlePoll = null;
  changed();
}

/** A refusal noted: locked, Take Control comes back at the lock's end, sooner if the GM in control goes idle. */
function noteRefusal(by) {
  const at = Date.now();
  refusals = [...refusals.filter(r => at - r.at <= LOCK_MS + REFUSE_WINDOW_MS), { by: by.id, at }];
  const until = takeLocked();
  if ( !until ) return;
  clearTimeout(lockTimer);
  lockTimer = setTimeout(unlock, until - at);
  clearInterval(idlePoll);
  idlePoll = setInterval(async () => {
    const now = controller();
    if ( !now?.active || now.isSelf ) return unlock();
    try {
      const idle = await now.query(CONTROL_IDLE, {}, { timeout: HAND_MS });
      if ( Number(idle) >= IDLE_MS ) unlock();
    } catch ( err ) {
      // (No answer: asked again next time.)
    }
  }, IDLE_POLL_MS);
  changed();
}

/**
 * Take Control (a read-only GM's): the GM in control asked first, where they're here. True once it's taken; false where
 * they refused (the GM told).
 */
export async function takeControl() {
  if ( !game.user?.isGM || inControl() || takeLocked() ) return false;
  const now = controller();
  if ( now && !now.isSelf && now.active ) {
    ui.notifications.info(game.i18n.format("FASTFIGHTING.Control.Asking", { name: now.name }));
    let answer = null;
    try {
      answer = await now.query(HAND_CONTROL, {}, { timeout: ASK_MS + HAND_MS * 2 });
    } catch ( err ) {
      // (Gone meanwhile, or no answer at all: taken all the same.)
    }
    if ( answer?.refused ) {
      ui.notifications.info(game.i18n.format("FASTFIGHTING.Control.Refused", { name: now.name }));
      noteRefusal(now);
      return false;
    }
  }
  await game.settings.set(MODULE_ID, "controller", game.user.id);
  return true;
}

/** The GM in control asked whether `user` takes control: "allow", "refuse", or null (no answer in ASK_MS). */
async function askHandOver(user) {
  let dialog = null;
  const timer = setTimeout(() => dialog?.close(), ASK_MS);
  try {
    return await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("FASTFIGHTING.Control.AskTitle") },
      content: `<p>${foundry.utils.escapeHTML(game.i18n.format("FASTFIGHTING.Control.Ask", { name: user.name, seconds: Math.round(ASK_MS / 1000) }))}</p>`,
      buttons: [
        { action: "allow", label: game.i18n.localize("FASTFIGHTING.Control.Allow"), default: true },
        { action: "refuse", label: game.i18n.localize("FASTFIGHTING.Control.Refuse") }
      ],
      rejectClose: false,
      render: (event, d) => { dialog = d; }
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asked to hand over (Foundry says who asks: another GM): the GM here asked; refused, {refused: true}; else this
 * browser's battle kept and let go, then it answers true.
 */
async function handOver(data, { user } = {}) {
  if ( !user?.isGM || user.isSelf || !inControl() ) return false;
  let answer = null;
  try {
    answer = await askHandOver(user);
  } catch ( err ) {
    console.error(`${MODULE_ID} | asking about control`, err);
  }
  // (Taken some other way meanwhile: nothing to hand over.)
  if ( !inControl() ) return true;
  if ( !handsOver(answer) ) return { refused: true };
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
  // (How long since this GM touched their browser: only another GM may ask.)
  CONFIG.queries[CONTROL_IDLE] = (data, { user } = {}) => (user?.isGM ? Date.now() - lastInput : null);
  for ( const type of ["pointerdown", "keydown", "wheel"] ) window.addEventListener(type, () => { lastInput = Date.now(); }, { capture: true, passive: true });
  Hooks.once("ready", () => {
    claim();
    changed();
  });
  // (The GM in control gone: taken over if they aren't back in GONE_MS.)
  Hooks.on("userConnected", (user, connected) => {
    if ( !user?.isGM ) return;
    // (The GM in control gone, as Foundry says: Take Control on again.)
    if ( !connected && user.id === chosenNow() && refusals.length ) unlock();
    changed();
    if ( connected || user.id !== chosenNow() ) return;
    clearTimeout(goneTimer);
    goneTimer = setTimeout(claim, GONE_MS);
  });
}
