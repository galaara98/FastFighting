/**
 * What live battles (live-battle.js) share for the map and the chat: token moves and doors (playMoves, holdingPause),
 * spots beside a token (spotsBeside), story cards (postBeat, postStory), undo records (revertRecord, revertEntry), and
 * the Sample tab's list of what a fight changes (planMakeItSo).
 *
 * And what's left of the whole-fight playback FastFighting played before live battles: the fights it played can still
 * be rewound (each scene keeps its last few, newest first: from their summary cards, or the planner), and one a crash
 * cut short, though no longer continued.
 */
import { MODULE_ID } from "../constants.js";
import { escapeHtml as escape, inertHtml } from "../i18n.js";
import { getAdapter } from "../api.js";
import { setting } from "../settings.js";
import { pixelsFor, sceneDistance, squareFeet } from "./terrain.js";
import { concessionText } from "../story/story.js";

const loc = key => game.i18n.localize(key);
const UNDO_DEPTH = 5;
/** The most chat messages after a played fight's summary for its Rewind to still work: further back, it's history. */
export const UNDO_REACH = 10;

/**
 * Undo entries for a scene, newest first (older worlds stored a single entry). Only a scene a GM last wrote: one a
 * player owns, and wrote, could hold records a GM's Undo would run.
 */
function undoStack(scene) {
  const stored = scene?.getFlag(MODULE_ID, "undo");
  if ( !stored ) return [];
  if ( scene._stats?.lastModifiedBy && !game.users.get(scene._stats.lastModifiedBy)?.isGM ) {
    console.warn(`${MODULE_ID} | ${scene.name}: its undo records were last written by a player, and aren't trusted`);
    return [];
  }
  if ( Array.isArray(stored.stack) ) return stored.stack;
  return (stored.records || stored.moves || stored.messages || stored.doors) ? [stored] : [];
}

async function writeStack(scene, stack) {
  if ( stack.length ) await scene.update({ [`flags.${MODULE_ID}.==undo`]: { stack: stack.slice(0, UNDO_DEPTH) } });
  else await scene.unsetFlag(MODULE_ID, "undo");
}

/** A fight the old playback left unfinished on a scene (a crash, a lost connection): what it had done. */
export function unfinishedPlayback(scene = canvas.scene) {
  return scene?.getFlag(MODULE_ID, "playback") ?? null;
}

/** Feet between the token's current center and the engine's final position. */
function feetMoved(spec, final) {
  if ( !spec.position || !final?.position ) return 0;
  return Math.round(Math.hypot(final.position.x - spec.position.x, final.position.y - spec.position.y));
}

/**
 * Build the per-token change list for a replayed fight.
 * @param {object} spec      BattleSpec that produced the replay
 * @param {object} replay    runOne(..., {capture: true, log: true}) result
 */
export function planMakeItSo(spec, replay, scene = canvas.scene) {
  const adapter = getAdapter();
  const rows = [];
  for ( const c of spec.combatants ) {
    const final = replay.units[c.id]?.final;
    const tokenDoc = scene.tokens.get(c.tokenId ?? c.id);
    if ( !final || !tokenDoc ) continue;
    const lines = adapter.describeOutcome(c, final);
    const moved = feetMoved(c, final);
    if ( moved >= 5 ) lines.push(game.i18n.format("FASTFIGHTING.MakeItSo.Moves", { distance: sceneDistance(moved) }));
    rows.push({ spec: c, final, tokenDoc, lines, moved, changed: lines.length > 0 });
  }
  // Something given up changes hands: say so on both sides.
  for ( const row of rows ) {
    for ( const c of row.final.concessions ?? [] ) {
    const what = concessionText(c);
    // (Robbed while down is taken, as stolen is.)
    const taken = c.how === "theft" || c.how === "loot";
    if ( c.kept ) {
      row.lines.push(game.i18n.format("FASTFIGHTING.MakeItSo.Kept", { what, luck: c.luck }));
      continue;
    }
    if ( c.returned ) {
      row.lines.push(game.i18n.format("FASTFIGHTING.MakeItSo.Reclaimed", { what, name: c.toName }));
      continue;
    }
    row.lines.push(game.i18n.format(taken ? "FASTFIGHTING.MakeItSo.Stolen" : "FASTFIGHTING.MakeItSo.Gives", { what, name: c.toName }));
    row.changed = true;
    const to = rows.find(r => r.spec.id === c.to);
    if ( to ) {
      to.lines.push(game.i18n.format(taken ? "FASTFIGHTING.MakeItSo.Steals" : "FASTFIGHTING.MakeItSo.Receives", { what, name: row.spec.name }));
      to.changed = true;
    }
    }
  }
  // The encounter's own record, by the system (Ironsworn: its progress track, kept on one character): {title, lines}.
  let encounter = null;
  try {
    encounter = adapter.describeEncounter?.(spec, replay) ?? null;
  } catch ( err ) {
    console.error(`${MODULE_ID} | the encounter's own record failed`, err);
  }
  if ( encounter?.lines?.length ) rows.encounter = { ...encounter, spec, replay };
  return rows;
}

/* -------------------------------------------- */
/*  Token placement                             */
/* -------------------------------------------- */

/** Where a token really is. (While it's animating, a token's x and y follow the animation, not the move.) */
export const placeOf = doc => ({ x: doc._source.x, y: doc._source.y });

/** How fast tokens move through the fight on the map, in grid squares a second. */
const PLAYBACK_SPEED = 10;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A turn (or a Rewind) being written onto the map: a promise that settles when it's done, or null. */
let busy = null;
export const makingItSo = () => busy;

/**
 * Keep the game paused while a turn (or a Rewind) is written onto the map, so no player drags a token into the
 * middle of it. A pause only stops players: the GM's writes and every animation go on, so nothing here ever waits on
 * it, whoever pauses or un-pauses meanwhile. After, the game is left as it was before (the planner keeps it paused
 * while it's open), unless someone paused or un-paused it meanwhile: that stands.
 */
export async function holdingPause(work, { resume = false } = {}) {
  // (`resume`: the game was going before, and goes on once it's done.)
  const wasPaused = game.paused && !resume;
  if ( !wasPaused ) game.togglePause(true, { broadcast: true });
  let touched = false;
  const hook = Hooks.on("pauseGame", () => { touched = true; });
  const running = (async () => {
    try {
      return await work();
    } finally {
      Hooks.off("pauseGame", hook);
      if ( !wasPaused && !touched && game.paused ) game.togglePause(false, { broadcast: true });
    }
  })();
  const done = running.then(() => {}, () => {});
  busy = done;
  try {
    return await running;
  } finally {
    if ( busy === done ) busy = null;
  }
}

/**
 * Move a token quickly along waypoints (walls are already accounted for), and give the animation about as long as
 * it should take. (A browser tab in the background doesn't animate at all, so never wait on it for longer.)
 */
async function quickMove(doc, waypoints, speed = PLAYBACK_SPEED) {
  const size = canvas.dimensions.size;
  let squares = 0;
  let from = placeOf(doc);
  for ( const p of waypoints ) {
    squares += Math.hypot(p.x - from.x, p.y - from.y) / size;
    from = p;
  }
  const takes = (squares / speed) * 1000 + 250;
  try {
    // (One step, no checkpoints: a game paused meanwhile doesn't stop it. A move something else holds up, such as a
    // region's script pausing it, is let go after a while; everyone settles where the fight left them anyway.)
    const moving = doc.move(waypoints, {
      animation: { movementSpeed: speed }, showRuler: false, pan: false, autoRotate: false,
      constrainOptions: { ignoreWalls: true, ignoreCost: true }
    });
    const settled = await Promise.race([moving.then(() => true), wait(takes + 5000).then(() => false)]);
    if ( !settled && doc.movement?.user?.isSelf ) doc.stopMovement();
    const animation = doc.object?.movementAnimationPromise;
    if ( animation ) await Promise.race([animation, wait(takes)]);
  } catch ( err ) {
    console.warn(`${MODULE_ID} | couldn't play a move for ${doc.name}`, err);
  }
}

/**
 * Walk tokens through a turn as the story tells it: each move in order, around walls (or straight through where the
 * fight went through), and each door opened as it's opened. A move a token has made already is simply where it is.
 * `instant`: no walking, each straight to where it ended.
 */
export async function playMoves(events, docs, grid, doorsOpened, scene, { instant = false } = {}) {
  // (Not played: each token straight to where the turn left it, unanimated, once its doors are open.)
  const last = instant ? new Map() : null;
  for ( const e of events ) {
    if ( e.type === "door" && e.success ) {
      await openSceneDoor(scene, e.doorId, doorsOpened);
      continue;
    }
    if ( !["move", "flee", "leave", "forced"].includes(e.type) || !e.to ) continue;
    // (Forced: the one it moved, not the one moving it.)
    const doc = docs.get(e.type === "forced" ? e.targetId : e.actorId);
    if ( !doc?.object || doc.hidden ) continue;
    const dest = clampToScene(pixelsFor(doc, e.to), doc);
    if ( last ) {
      last.set(doc, dest);
      continue;
    }
    if ( dest.x === doc._source.x && dest.y === doc._source.y ) continue;
    await quickMove(doc, grid ? grid.route(doc, dest, { doors: true }) : [dest]);
  }
  for ( const [doc, dest] of last ?? [] ) {
    if ( dest.x !== doc._source.x || dest.y !== doc._source.y ) await doc.update({ x: dest.x, y: dest.y }, { animate: false });
  }
}

/** Open a door on the scene (once), remembering how it was for Rewind. */
export async function openSceneDoor(scene, id, opened) {
  const wall = scene.walls.get(id);
  if ( !wall || opened.has(id) || wall.ds === CONST.WALL_DOOR_STATES.OPEN ) return;
  opened.set(id, { id, uuid: wall.uuid, ds: wall.ds });
  try {
    await wall.update({ ds: CONST.WALL_DOOR_STATES.OPEN });
  } catch ( err ) {
    console.warn(`${MODULE_ID} | couldn't open door ${id}`, err);
  }
}

function cellsOf(x, y, doc) {
  const size = canvas.dimensions.size;
  const cx = Math.round(x / size);
  const cy = Math.round(y / size);
  const out = [];
  for ( let i = 0; i < Math.max(1, Math.round(doc.width)); i++ ) {
    for ( let j = 0; j < Math.max(1, Math.round(doc.height)); j++ ) out.push(`${cx + i},${cy + j}`);
  }
  return out;
}

function clampToScene(point, doc) {
  const r = canvas.dimensions.sceneRect;
  const size = canvas.dimensions.size;
  return {
    x: Math.min(Math.max(point.x, r.x), r.x + r.width - doc.width * size),
    y: Math.min(Math.max(point.y, r.y), r.y + r.height - doc.height * size)
  };
}

function centerOf(point, doc) {
  const size = canvas.dimensions.size;
  return { x: point.x + (doc.width * size) / 2, y: point.y + (doc.height * size) / 2 };
}

function wallBetween(a, b) {
  try {
    return !!CONFIG.Canvas.polygonBackends.move.testCollision(a, b, { type: "move", mode: "any" });
  } catch ( err ) {
    return false;
  }
}

/**
 * Free grid spots beside a token (its own size), nearest first, on its side of any wall: where what it summons appears.
 * @returns {{x: number, y: number}[]} top-left corners
 */
export function spotsBeside(tokenDoc, count, scene = tokenDoc.parent) {
  const occupied = new Set();
  for ( const t of scene.tokens ) if ( !t.hidden ) for ( const c of cellsOf(t._source.x, t._source.y, t) ) occupied.add(c);
  const out = [];
  for ( let i = 0; i < count; i++ ) {
    const spot = freeSpot(tokenDoc, placeOf(tokenDoc), occupied);
    for ( const c of cellsOf(spot.x, spot.y, tokenDoc) ) occupied.add(c);
    out.push(spot);
  }
  return out;
}

/**
 * Where creatures a summoning called appear: where the engine put them (behavior/summons.js: the nearest space no
 * one's in to where each would want to be), as top-left corners for their size; still the nearest free spot to that,
 * should a token be standing there on the map. One the engine has nowhere for, beside its summoner.
 * @param {TokenDocument} summonerDoc
 * @param {object[]} units   the engine's creatures, as called (pos in feet, spec)
 * @returns {{x: number, y: number}[]} top-left corners
 */
export function spotsFor(summonerDoc, units, scene = summonerDoc.parent) {
  const occupied = new Set();
  for ( const t of scene.tokens ) if ( !t.hidden ) for ( const c of cellsOf(t._source.x, t._source.y, t) ) occupied.add(c);
  return units.map(s => {
    const squares = Math.max(1, Math.round((s.spec.position?.size ?? squareFeet()) / squareFeet()));
    const shape = { width: squares, height: squares };
    const dest = s.pos ? clampToScene(pixelsFor(shape, s.pos), shape) : placeOf(summonerDoc);
    const spot = freeSpot(shape, dest, occupied);
    for ( const c of cellsOf(spot.x, spot.y, shape) ) occupied.add(c);
    return spot;
  });
}

/** Nearest free grid spot to `dest` (spiral search, on the same side of any wall), so tokens never end up stacked. */
function freeSpot(tokenDoc, dest, occupied) {
  const size = canvas.dimensions.size;
  const free = p => cellsOf(p.x, p.y, tokenDoc).every(c => !occupied.has(c));
  if ( free(dest) ) return dest;
  for ( let ring = 1; ring <= 6; ring++ ) {
    for ( let dx = -ring; dx <= ring; dx++ ) {
      for ( let dy = -ring; dy <= ring; dy++ ) {
        if ( Math.max(Math.abs(dx), Math.abs(dy)) !== ring ) continue;
        const p = clampToScene({ x: dest.x + dx * size, y: dest.y + dy * size }, tokenDoc);
        if ( free(p) && !wallBetween(centerOf(dest, tokenDoc), centerOf(p, tokenDoc)) ) return p;
      }
    }
  }
  return dest;
}

/* -------------------------------------------- */
/*  Story cards                                 */
/* -------------------------------------------- */

/** How a number JSON can't hold (Infinity: uses without limit) is written, so a stored BattleSpec comes back exactly. */
const NUMBER = "$ffNumber";

/** A BattleSpec as text, kept with a live battle (to pick it up again after a reload). */
export const packSpec = spec => JSON.stringify(spec, (key, v) => (typeof v === "number" && !Number.isFinite(v) ? { [NUMBER]: String(v) } : v));

export const unpackSpec = text => JSON.parse(text, (key, v) => (v && typeof v === "object" && Object.keys(v).length === 1 && NUMBER in v ? Number(v[NUMBER]) : v));

export const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);
export const chronicle = () => ({ alias: loc("FASTFIGHTING.Story.Speaker") });
export const storyTitle = scene => game.i18n.format("FASTFIGHTING.Story.Title", { scene: scene?.name ?? "" });
const ChatMessageClass = () => foundry.documents.ChatMessage ?? globalThis.ChatMessage;

/**
 * One turn's cards, told as a story (never as a creature's own words): what everyone may know, and what only the GMs
 * are told (beat.gmHtml: who takes the lead, what a creature thinks), on a card of its own whispered to them. Returns
 * the messages made.
 */
export async function postBeat(scene, beat, docs, state) {
  const ChatMessage = ChatMessageClass();
  const doc = beat.actorId ? (docs.get(beat.actorId) ?? null) : null;
  const whisper = setting("storyMode") === "whisper" ? gmIds() : [];
  const flags = { [MODULE_ID]: { story: true, beat: true } };
  // (A hidden creature not yet given away: the narrator's card, not its own.)
  const speaker = doc && !beat.anonymous ? ChatMessage.getSpeaker({ scene, token: doc }) : chronicle();
  const head = beat.closing ? `<header><i class="fa-solid fa-book-open"></i> ${escape(storyTitle(scene))}</header>`
    : beat.round >= 1 ? `<header>${escape(game.i18n.format("FASTFIGHTING.Story.TurnRound", { n: beat.round }))}</header>` : "";
  const odds = beat.closing && state.odds ? `<p class="ff-odds"><em>${escape(state.odds)}</em></p>` : "";
  const kind = beat.closing ? "fast-fighting-story" : "fast-fighting-story fast-fighting-beat";
  const out = [];
  if ( beat.html ) out.push(await ChatMessage.create({ content: inertHtml(`<div class="${kind}">${head}${beat.html}${odds}</div>`), speaker, whisper, flags }));
  if ( beat.gmHtml ) {
    const gm = `<header><i class="fa-solid fa-eye-slash"></i> ${escape(loc("FASTFIGHTING.Story.GmOnly"))}</header>`;
    out.push(await ChatMessage.create({ content: inertHtml(`<div class="fast-fighting-story fast-fighting-beat ff-gm-only">${gm}${beat.gmHtml}</div>`), speaker, whisper: gmIds(), flags }));
  }
  return out.filter(Boolean);
}

/** A whole story in one card (the Statistician's: the GMs', with a button to show it to everyone). */
export async function postStory(story, odds, { gmOnly = false } = {}) {
  if ( !story?.html ) return null;
  const oddsHtml = odds ? `<p class="ff-odds"><em>${escape(odds)}</em></p>` : "";
  const reveal = gmOnly ? `<button type="button" data-ff-reveal><i class="fa-solid fa-eye"></i> ${loc("FASTFIGHTING.Story.Reveal")}</button>` : "";
  return ChatMessageClass().create({
    content: inertHtml(`<div class="fast-fighting-story"><header><i class="fa-solid fa-book-open"></i> ${escape(story.title)}</header>${story.html}${oddsHtml}${reveal}</div>`),
    speaker: chronicle(),
    whisper: gmOnly || setting("storyMode") === "whisper" ? gmIds() : [],
    flags: { [MODULE_ID]: { story: true, revealable: gmOnly } }
  });
}

/**
 * Is this one of FastFighting's own cards? Only a GM posts them. Anyone can post a chat message with any flags, so a
 * card a player wrote is never acted on: its "undo records" would run with the GM's rights.
 */
export const ownCard = message => !!message?.author?.isGM;

/** Show a GM-only story to everyone (the Reveal button on it). */
export async function revealStory(message) {
  if ( !game.user.isGM || !ownCard(message) || !message.getFlag(MODULE_ID, "revealable") ) return false;
  const content = message.content.replace(/<button[^>]*data-ff-reveal[^>]*>[\s\S]*?<\/button>/, "");
  await message.update({ whisper: [], content, [`flags.${MODULE_ID}.revealable`]: false });
  return true;
}

/** Is there a played fight to rewind here (and none cut short: that has its own Rewind)? */
export function hasUndo(scene = canvas.scene) {
  return undoStack(scene).length > 0 && !unfinishedPlayback(scene);
}

/**
 * Can this summary card's fight be rewound: "ok" (the latest on its scene, and recent in the chat); "later" (not
 * the latest: a later one on the same scene stands on it); "buried" (more than UNDO_REACH messages since, in the
 * chat); "gone" (no longer kept: undone already, or too many since). Only "ok" undoes anything.
 */
export function cardUndoState(message) {
  const data = message?.getFlag(MODULE_ID, "undoFight");
  const scene = game.scenes.get(data?.sceneId);
  const stack = undoStack(scene);
  const at = stack.findIndex(e => e.id && e.id === data?.id);
  if ( at < 0 ) return "gone";
  // (One cut short on the scene stands on it too.)
  if ( at > 0 || unfinishedPlayback(scene) ) return "later";
  const since = (game.messages?.contents ?? []).filter(m => m.timestamp > message.timestamp).length;
  return since > UNDO_REACH ? "buried" : "ok";
}

/** Each played fight's summary in the chat drawn again (its Rewind works, or not, as things stand now). */
export function refreshUndoCards() {
  if ( !game.user.isGM ) return;
  for ( const m of game.messages?.contents ?? [] ) if ( m.getFlag(MODULE_ID, "undoFight") ) ui.chat?.updateMessage?.(m);
}

/** Rewind from a summary card in the chat: the fight it reports, on its own scene, once the GM confirms. */
export async function undoFromCard(message) {
  if ( !game.user.isGM || !ownCard(message) ) return false;
  // (Not the latest on its scene, or too far back in the chat: nothing happens.)
  if ( cardUndoState(message) !== "ok" ) return false;
  const scene = game.scenes.get(message.getFlag(MODULE_ID, "undoFight").sceneId);
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: loc("FASTFIGHTING.MakeItSo.UndoTitle") },
    content: `<p>${foundry.utils.escapeHTML(game.i18n.format("FASTFIGHTING.MakeItSo.UndoConfirmScene", { scene: scene.name }))}</p>`
  });
  if ( !ok || cardUndoState(message) !== "ok" ) return false;
  await undoMakeItSo(scene);
  ui.notifications.info(loc("FASTFIGHTING.MakeItSo.Undone"));
  return true;
}

/**
 * The statuses on an actor, read from its effects too: a system that applies effects its own way (dcc) may leave
 * actor.statuses empty.
 */
function statusesOf(actor) {
  const out = new Set(actor?.statuses ?? []);
  for ( const e of actor?.effects ?? [] ) if ( !e.disabled ) for ( const s of e.statuses ?? [] ) out.add(s);
  return out;
}

/** Put one undo record back: created documents removed, deleted ones restored, changed values reset. */
export async function revertRecord(r) {
  // Each step on its own: one that fails (a status the server has already dropped, say) mustn't stop the rest.
  const step = async (what, fn) => {
    try {
      await fn();
    } catch ( err ) {
      console.error(`${MODULE_ID} | undo: ${what} failed`, r, err);
    }
  };
  // (An undo record is data: each thing it names only of the kind FastFighting's own records name, and an actor it
  // would delete only one FastFighting brought in for a summoning: a GM's copy of a compendium's, no player's.)
  const of = async (uuid, type) => (typeof uuid === "string" && foundry.utils.parseUuid(uuid)?.type === type ? fromUuid(uuid) : null);
  const summoned = a => !!a && !a.hasPlayerOwner && !!a._stats?.compendiumSource && !!game.users.get(a._stats?.createdBy)?.isGM;
  for ( const uuid of r.createdCombatants ?? [] ) await step("removing a combatant", async () => (await of(uuid, "Combatant"))?.delete());
  for ( const uuid of r.createdTokens ?? [] ) await step("removing a token", async () => (await of(uuid, "Token"))?.delete());
  for ( const uuid of r.createdActors ?? [] ) {
    await step("removing an actor", async () => {
      const a = await of(uuid, "Actor");
      if ( summoned(a) ) await a.delete();
    });
  }
  for ( const t of r.deletedTokens ?? [] ) {
    await step("restoring a token", async () => (await of(t.parentUuid, "Scene"))?.createEmbeddedDocuments("Token", [tokenData(t.data)], { keepId: true }));
  }
  // (One the fight took off the tracker, gone off the map: back on it, as it was.)
  for ( const c of r.deletedCombatants ?? [] ) {
    await step("restoring a combatant", async () => (await of(c.parentUuid, "Combat"))?.createEmbeddedDocuments("Combatant", [c.data], { keepId: true, turnEvents: false }));
  }
  // (A world setting the system keeps a pool in: Daggerheart's Fear, the GM's.)
  // (Only the system's own: an undo record is data, and never a way to change the core's or another module's settings.)
  if ( r.setting && r.setting.namespace === game.system.id ) await step("restoring a setting", () => game.settings.set(r.setting.namespace, r.setting.key, r.setting.value));
  const tokenDoc = r.tokenUuid ? await of(r.tokenUuid, "Token") : null;
  const actor = tokenDoc?.actor ?? (r.actorUuid ? await of(r.actorUuid, "Actor") : null);
  if ( !actor ) return;
  if ( r.createdItems?.length ) {
    const ids = r.createdItems.filter(id => actor.items.has(id));
    if ( ids.length ) await step("removing items", () => actor.deleteEmbeddedDocuments("Item", ids));
  }
  if ( r.deletedItems?.length ) await step("restoring items", () => actor.createEmbeddedDocuments("Item", r.deletedItems, { keepId: true }));
  if ( r.createdEffects?.length ) {
    const ids = r.createdEffects.filter(id => actor.effects.has(id));
    if ( ids.length ) await step("removing effects", () => actor.deleteEmbeddedDocuments("ActiveEffect", ids));
  }
  // (One a turn took off, such as a spell's effect that ended: put back as it was.)
  if ( r.deletedEffects?.length ) await step("restoring effects", () => actor.createEmbeddedDocuments("ActiveEffect", r.deletedEffects, { keepId: true }));
  for ( const { id, update } of r.itemUpdates ?? [] ) await step("restoring an item", () => actor.items.get(id)?.update(update));
  for ( const s of r.statuses ?? [] ) {
    if ( statusesOf(actor).has(s.id) === s.active ) continue; // already as it was
    await step(`status ${s.id}`, () => actor.toggleStatusEffect(s.id, { active: s.active, overlay: s.overlay }));
  }
  const actorUpdate = actorData(r.actorUpdate);
  if ( Object.keys(actorUpdate).length ) await step("restoring the actor", () => actor.update(actorUpdate));
  // Anything the system added along the way (dnd5e lays the unconscious down Prone) comes off too.
  if ( r.statusesBefore ) {
    const before = new Set(r.statusesBefore);
    for ( const id of [...statusesOf(actor)] ) {
      if ( before.has(id) || !CONFIG.statusEffects.some(s => s.id === id) ) continue;
      await step(`status ${id}`, () => (statusesOf(actor).has(id) ? actor.toggleStatusEffect(id, { active: false }) : null));
    }
  }
  const tokenUpdate = tokenFields(r.tokenUpdate);
  if ( tokenUpdate && tokenDoc ) await step("restoring the token", () => tokenDoc.update(tokenUpdate));
  // (A player's own, such as DCC's Fleeting Luck.)
  // (A player's flags, such as DCC's Fleeting Luck: nothing else of a user's, their role least of all.)
  const flagsOnly = Object.fromEntries(Object.entries(foundry.utils.flattenObject(r.userUpdate ?? {})).filter(([k]) => k.startsWith("flags.")));
  if ( r.userId && Object.keys(flagsOnly).length ) await step("restoring a player's", () => game.users.get(r.userId)?.update(flagsOnly));
  if ( r.combatant ) await step("the combat tracker", async () => (await of(r.combatant.uuid, "Combatant"))?.update({ defeated: !!r.combatant.defeated }));
}

/** What of an actor an undo record puts back: its system's data, and FastFighting's and the system's flags; nothing else. */
function actorData(update) {
  const flat = foundry.utils.flattenObject(update ?? {});
  const ok = k => k.startsWith("system.") || k.startsWith(`flags.${MODULE_ID}.`) || k.startsWith(`flags.${game.system.id}.`);
  return Object.fromEntries(Object.entries(flat).filter(([k]) => ok(k)));
}

/** What of a token an undo record puts back: where it stood, and whether it's hidden; null for nothing. */
const TOKEN_FIELDS = new Set(["x", "y", "elevation", "rotation", "hidden", "alpha"]);
function tokenFields(update) {
  if ( !update || typeof update !== "object" ) return null;
  const out = Object.fromEntries(Object.entries(update).filter(([k]) => TOKEN_FIELDS.has(k)));
  return Object.keys(out).length ? out : null;
}

/** A token an undo record puts back: as it was, but no one's ownership changed by it (that's its actor's). */
function tokenData(data) {
  const { ownership, ...rest } = data ?? {};
  return rest;
}

/* -------------------------------------------- */
/*  A PC's loss: its card's own undo            */
/* -------------------------------------------- */

/** Undo just one hand-over from its card (a played fight's), and take it out of the fight's own so it isn't undone twice. */
export async function undoConcession(message) {
  if ( !game.user.isGM || !ownCard(message) ) return false;
  const data = message.getFlag(MODULE_ID, "concession");
  if ( !data || data.undone ) return false;
  for ( const r of [...(data.records ?? [])].reverse() ) await revertRecord(r);
  const scene = game.scenes.get(data.sceneId);
  if ( scene ) {
    const stack = undoStack(scene).map(entry => ({ ...entry, records: (entry.records ?? []).filter(r => r.eventId !== data.eventId) }));
    await scene.update({ [`flags.${MODULE_ID}.==undo`]: { stack } });
  }
  const content = message.content.replace(/<button[^>]*data-ff-undo-concession[^>]*>[\s\S]*?<\/button>/, `<p class="hint"><i class="fa-solid fa-check"></i> ${loc("FASTFIGHTING.Concession.Undone")}</p>`);
  await message.update({ content, [`flags.${MODULE_ID}.concession.undone`]: true });
  return true;
}

/** Rewind the most recent fight on this scene: outcomes, positions, doors and every chat card it posted. */
export async function undoMakeItSo(scene = canvas.scene) {
  if ( !game.user.isGM || unfinishedPlayback(scene) ) return false;
  return holdingPause(() => undoFight(scene));
}

/** Rewind a playback that was cut short: everything it did so far, every chat card it posted included. */
export function rewindPlayback(scene = canvas.scene) {
  const state = unfinishedPlayback(scene);
  if ( !game.user.isGM || !state ) return Promise.resolve(false);
  return holdingPause(async () => {
    await revertEntry(scene, state);
    // (Cut short as it closed: it may be on the list to rewind already.)
    const stack = undoStack(scene);
    if ( stack.some(e => e.id === state.id) ) await writeStack(scene, stack.filter(e => e.id !== state.id));
    await scene.unsetFlag(MODULE_ID, "playback");
    refreshUndoCards();
    return true;
  }, { resume: state.resume });
}

async function undoFight(scene) {
  const [undo, ...rest] = undoStack(scene);
  if ( !undo ) return false;
  await revertEntry(scene, undo);
  await writeStack(scene, rest);
  refreshUndoCards();
  return true;
}

/** Put back what one fight did: its chat cards, outcomes, doors and positions. */
export async function revertEntry(scene, undo) {
  for ( const id of undo.messages ?? [] ) await game.messages.get(id)?.delete();
  for ( const r of [...(undo.records ?? [])].reverse() ) await revertRecord(r);
  // Doors as they were (closed, or locked).
  for ( const d of undo.doors ?? [] ) {
    try {
      await (await fromUuid(d.uuid))?.update({ ds: d.ds });
    } catch ( err ) {
      console.warn(`${MODULE_ID} | couldn't restore a door`, err);
    }
  }
  // Positions last, so tokens recreated above go back to where they started too.
  // Straight back where they stood, without walking the map again.
  const back = [];
  for ( const m of undo.moves ?? [] ) {
    const doc = await fromUuid(m.uuid);
    if ( doc && (doc._source.x !== m.x || doc._source.y !== m.y) ) back.push([doc.id, { destination: { x: m.x, y: m.y, action: "displace" } }]);
  }
  // (Moves, not plain updates: Foundry quietly refuses a position update that would cross a wall.)
  if ( back.length ) await scene.moveTokens(Object.fromEntries(back), { animate: false });
}

