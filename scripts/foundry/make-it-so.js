/**
 * What live battles (live-battle.js) share for the map and the chat: token moves and doors (playMoves, holdingPause),
 * story cards (postBeat, postStory), undo records (revertRecord, revertEntry), and
 * the Sample tab's list of what a fight changes (planMakeItSo).
 *
 * (The whole-fight playback of 0.1 to 0.2.5 kept its undo records on the scene, flags `undo` and `playback`, and on its
 * summary cards. Nothing reads them now: a scene's flags are any of its owners' to write.)
 */
import { statusesOf, statusEntry } from "./sheet-tools.js";
import { chatMessageClass, gmIds } from "./chat.js";
import { MODULE_ID } from "../constants.js";
import { revertItemPile } from "./loot-drop.js";
import { escapeHtml as escape, inertHtml, listJoin } from "../i18n.js";
import { getAdapter } from "../api.js";
import { setting } from "../settings.js";
import { pixelsFor, sceneDistance, squareFeet } from "./terrain.js";
import { concessionText } from "../story/story.js";

const loc = key => game.i18n.localize(key);

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
async function quickMove(doc, waypoints, speed) {
  speed = Number(speed) > 0 ? Number(speed) : PLAYBACK_SPEED;
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
 * `instant`: no walking, each straight to where it ended. `speed`: how fast they walk, in grid squares a second (a Fast
 * Fight's quicker; none, PLAYBACK_SPEED).
 */
export async function playMoves(events, docs, grid, doorsOpened, scene, { instant = false, speed = PLAYBACK_SPEED } = {}) {
  // (Not played: each token straight to where the turn left it, unanimated, once its doors are open.)
  const last = instant ? new Map() : null;
  for ( const e of events ) {
    if ( e.type === "door" && e.success ) {
      await openSceneDoor(scene, e.doorId, doorsOpened);
      continue;
    }
    // (A step: a reaction's, out of its turn, with where it went.)
    if ( !["move", "flee", "leave", "forced", "step"].includes(e.type) || !e.to ) continue;
    // (Forced: the one it moved, not the one moving it.)
    const doc = docs.get(e.type === "forced" ? e.targetId : e.actorId);
    if ( !doc?.object || doc.hidden ) continue;
    const dest = clampToScene(pixelsFor(doc, e.to), doc);
    if ( last ) {
      last.set(doc, dest);
      continue;
    }
    if ( dest.x === doc._source.x && dest.y === doc._source.y ) continue;
    await quickMove(doc, grid ? grid.route(doc, dest, { doors: true }) : [dest], speed);
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

export const chronicle = () => ({ alias: loc("FASTFIGHTING.Story.Speaker") });
export const storyTitle = scene => game.i18n.format("FASTFIGHTING.Story.Title", { scene: scene?.name ?? "" });

/**
 * One turn's cards, told as a story (never as a creature's own words): what everyone may know, and what only the GMs
 * are told (beat.gmHtml: who takes the lead, what a creature thinks), on a card of its own whispered to them. Returns
 * the messages made.
 */
export async function postBeat(scene, beat, docs, state) {
  const ChatMessage = chatMessageClass();
  const doc = beat.actorId ? (docs.get(beat.actorId) ?? null) : null;
  const whisper = setting("storyMode") === "whisper" ? gmIds() : [];
  const flags = { [MODULE_ID]: { story: true, beat: true } };
  // (Someone in it whose name the players haven't learned: which token each is, for the GMs' who's who (whoIsWho). No
  // name in the card: every browser is sent it.)
  if ( beat.someone?.length ) flags[MODULE_ID].someone = { scene: scene?.id ?? null, who: beat.someone };
  // (Those it names, and their tokens: their names shown on the map with a click, panLinks.)
  if ( beat.links && Object.keys(beat.links).length ) flags[MODULE_ID].links = { scene: scene?.id ?? null, names: beat.links };
  // (A hidden creature not yet given away: the narrator's card, not its own.)
  const speaker = doc && !beat.anonymous ? ChatMessage.getSpeaker({ scene, token: doc }) : chronicle();
  const head = beat.closing ? `<header><i class="fa-solid fa-book-open"></i> ${escape(storyTitle(scene))}</header>`
    : beat.round >= 1 ? `<header>${escape(beat.actorName
      ? game.i18n.format("FASTFIGHTING.Story.TurnRoundOf", { n: beat.round, name: beat.actorName })
      : game.i18n.format("FASTFIGHTING.Story.TurnRound", { n: beat.round }))}</header>` : "";
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

/**
 * A story card told openly with someone in it (flags.fast-fighting.someone: {scene, who: [{label, tokenId}]}), in a GM's
 * browser: a short line above the story saying who each is, by its name in the battle (`nameOf(scene, tokenId)`:
 * "Black Tear Cutthroat (2)" where namesakes are numbered), else its token's. Drawn here only, so the card the players
 * are sent never holds the names.
 */
export function whoIsWho(message, html, nameOf = null) {
  const said = message.getFlag(MODULE_ID, "someone");
  if ( !game.user.isGM || !ownCard(message) || !Array.isArray(said?.who) || !said.who.length ) return;
  const story = html.querySelector?.(".fast-fighting-story");
  if ( !story || story.querySelector(".ff-who-is-who") ) return;
  const scene = game.scenes.get(said.scene) ?? canvas?.scene ?? null;
  const each = said.who.map(w => {
    const name = nameOf?.(scene, w.tokenId) ?? scene?.tokens.get(w.tokenId)?.name;
    return name && w.label ? game.i18n.format("FASTFIGHTING.Story.WhoIs", { someone: w.label, name }) : null;
  }).filter(Boolean);
  if ( !each.length ) return;
  const line = document.createElement("p");
  line.className = "ff-who-is-who";
  line.dataset.tooltip = game.i18n.localize("FASTFIGHTING.Story.WhoIsWhoHint");
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-eye-slash";
  icon.setAttribute("aria-hidden", "true");
  line.append(icon, " ", game.i18n.format("FASTFIGHTING.Story.WhoIsWho", { list: listJoin(each) }));
  story.prepend(line);
}

/**
 * A story card's names (flags.fast-fighting.links: {scene, names: {name: tokenId}}), in anyone's browser: each one's
 * bold name a link that shows it on the map (pans there; a GM's, or its owner's, selects it). Not one whose token is
 * hidden from this user, nor one gone from the scene.
 */
export function panLinks(message, html) {
  const links = message.getFlag(MODULE_ID, "links");
  if ( !ownCard(message) || !links?.names ) return;
  const scene = game.scenes.get(links.scene);
  for ( const bold of html.querySelectorAll?.(".fast-fighting-story strong") ?? [] ) {
    const id = links.names[bold.textContent];
    const token = id ? scene?.tokens.get(id) : null;
    if ( !token || (token.hidden && !game.user.isGM) || bold.classList.contains("ff-pan") ) continue;
    bold.classList.add("ff-pan");
    bold.tabIndex = 0;
    bold.setAttribute("role", "button");
    bold.dataset.tooltip = game.i18n.localize("FASTFIGHTING.Story.PanTo");
    const go = event => {
      if ( event.type === "keydown" && event.key !== "Enter" && event.key !== " " ) return;
      event.preventDefault();
      panTo(scene, token);
    };
    bold.addEventListener("click", go);
    bold.addEventListener("keydown", go);
  }
}

/** Show a token on the map: pan to it; a GM's, or its owner's, select it. On another scene, say so. */
function panTo(scene, token) {
  if ( canvas.scene?.id !== scene?.id ) {
    ui.notifications.info(game.i18n.format("FASTFIGHTING.Story.OtherScene", { scene: scene?.name ?? "" }));
    return;
  }
  const t = token.object;
  if ( !t ) return;
  canvas.animatePan({ x: t.center.x, y: t.center.y, duration: 250 });
  if ( token.isOwner ) t.control({ releaseOthers: true });
}

/** A whole story in one card (the Statistician's: the GMs', with a button to show it to everyone). */
export async function postStory(story, odds, { gmOnly = false } = {}) {
  if ( !story?.html ) return null;
  const oddsHtml = odds ? `<p class="ff-odds"><em>${escape(odds)}</em></p>` : "";
  const reveal = gmOnly ? `<button type="button" data-ff-reveal><i class="fa-solid fa-eye"></i> ${loc("FASTFIGHTING.Story.Reveal")}</button>` : "";
  return chatMessageClass().create({
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

/**
 * Put one undo record back: created documents removed, deleted ones restored, changed values reset.
 * An undo record is data, and Rewind runs it with a GM's rights, so it does only what FastFighting's own records do:
 * each thing it names only of the kind they name, and on the battle's scene (`scene`, where given); an actor it would
 * delete only one FastFighting brought in for a summoning (a GM's copy of a compendium's, no player's); a world setting
 * only one of the system's that FastFighting recorded itself (`settings`); a token restored owned as its actor is; and
 * of a player, only flags, FastFighting's or the system's (DCC's Fleeting Luck).
 * @param {object} r
 * @param {object} [options]
 * @param {Scene} [options.scene]          the scene it was recorded on
 * @param {Set<string>} [options.settings] "namespace.key" of each world setting FastFighting recorded
 */
export async function revertRecord(r, { scene = null, settings = null } = {}) {
  if ( !r || typeof r !== "object" ) return;
  // Each step on its own: one that fails (a status the server has already dropped, say) mustn't stop the rest.
  const step = async (what, fn) => {
    try {
      await fn();
    } catch ( err ) {
      console.error(`${MODULE_ID} | undo: ${what} failed`, r, err);
    }
  };
  const of = async (uuid, type) => (typeof uuid === "string" && foundry.utils.parseUuid(uuid)?.type === type ? fromUuid(uuid) : null);
  // (On the scene: a token or a region its own; a combatant one of a combat there, or of none.)
  const here = doc => !!doc && (!scene || doc.parent?.id === scene.id);
  const inCombat = combat => !!combat && (!scene || !combat.scene || combat.scene.id === scene.id);
  const ofHere = async (uuid, type) => {
    const doc = await of(uuid, type);
    return (type === "Combatant" ? inCombat(doc?.parent) : here(doc)) ? doc : null;
  };
  // (Or a pile of goods FastFighting made: foundry/loot-drop.js.)
  const summoned = a => !!a && !a.hasPlayerOwner && ((!!a._stats?.compendiumSource && !!game.users.get(a._stats?.createdBy)?.isGM) || !!a.getFlag?.(MODULE_ID, "pile"));
  // (The tracker's own turn events stay quiet: taking a turn back is no turn starting or ending, for the system or for a
  // live battle: live-battle.js onTurnChange.)
  for ( const uuid of r.createdCombatants ?? [] ) await step("removing a combatant", async () => (await ofHere(uuid, "Combatant"))?.delete({ turnEvents: false }));
  for ( const uuid of r.createdRegions ?? [] ) await step("removing an area", async () => (await ofHere(uuid, "Region"))?.delete());
  for ( const uuid of r.createdTokens ?? [] ) await step("removing a token", async () => (await ofHere(uuid, "Token"))?.delete());
  for ( const uuid of r.createdActors ?? [] ) {
    await step("removing an actor", async () => {
      const a = await of(uuid, "Actor");
      if ( summoned(a) ) await a.delete();
    });
  }
  // (A pile's own actor, picked up: back, before its token.)
  for ( const a of r.deletedActors ?? [] ) {
    await step("restoring an actor", async () => {
      if ( a?._id && !game.actors.has(a._id) && a.flags?.[MODULE_ID]?.pile ) await Actor.create(a, { keepId: true });
    });
  }
  for ( const t of r.deletedTokens ?? [] ) {
    await step("restoring a token", async () => {
      const at = await of(t?.parentUuid, "Scene");
      if ( at && (!scene || at.id === scene.id) ) await at.createEmbeddedDocuments("Token", [tokenData(t.data)], { keepId: true });
    });
  }
  // (One the fight took off the tracker, gone off the map: back on it, as it was.)
  for ( const c of r.deletedCombatants ?? [] ) {
    await step("restoring a combatant", async () => {
      const combat = await of(c?.parentUuid, "Combat");
      if ( inCombat(combat) ) await combat.createEmbeddedDocuments("Combatant", [c.data], { keepId: true, turnEvents: false });
    });
  }
  // (A world setting the system keeps a pool in: Daggerheart's Fear, the GM's. Only the system's own, and only one
  // FastFighting recorded itself: never a way to change the core's, another module's, or the system's configuration.)
  if ( settingRestored(r.setting, settings, game.system.id) ) {
    await step("restoring a setting", () => game.settings.set(r.setting.namespace, r.setting.key, r.setting.value));
  }
  const tokenDoc = r.tokenUuid ? await ofHere(r.tokenUuid, "Token") : null;
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
  for ( const { id, update } of r.itemUpdates ?? [] ) await step("restoring an item", () => actor.items.get(id)?.update(withoutOwnership(update)));
  for ( const s of r.statuses ?? [] ) {
    if ( statusesOf(actor).has(s.id) === s.active ) continue; // already as it was
    await step(`status ${s.id}`, () => actor.toggleStatusEffect(s.id, { active: s.active, overlay: s.overlay }));
  }
  const actorUpdate = actorData(r.actorUpdate);
  // (The system's own options for it, under its id, where the record has them (API 29): DCC's mark that its ability log
  // is already right, so its own hook doesn't log the restore as a change made by hand.)
  const sys = game.system?.id;
  const own = sys && r.systemOptions && typeof r.systemOptions === "object" ? r.systemOptions[sys] : null;
  const options = own && typeof own === "object" ? { [sys]: foundry.utils.deepClone(own) } : {};
  if ( Object.keys(actorUpdate).length ) await step("restoring the actor", () => actor.update(actorUpdate, options));
  // Anything the system added along the way (dnd5e lays the unconscious down Prone) comes off too.
  if ( r.statusesBefore ) {
    const before = new Set(r.statusesBefore);
    for ( const id of [...statusesOf(actor)] ) {
      if ( before.has(id) || !statusEntry(id) ) continue;
      await step(`status ${id}`, () => (statusesOf(actor).has(id) ? actor.toggleStatusEffect(id, { active: false }) : null));
    }
  }
  const tokenUpdate = tokenFields(r.tokenUpdate);
  if ( tokenUpdate && tokenDoc ) await step("restoring the token", () => tokenDoc.update(tokenUpdate));
  // (A fallen creature's token made an Item Piles pile, or back from one: loot-drop.js lootOnFall.)
  if ( r.itemPile && tokenDoc ) await step("the fallen's pile", () => revertItemPile(r.itemPile, tokenDoc));
  // (A player's flags, such as DCC's Fleeting Luck: FastFighting's and the system's, nothing else of a user's, their
  // role least of all; and a player's, never a GM's.)
  const user = typeof r.userId === "string" ? game.users.get(r.userId) : null;
  const flags = userFlags(r.userUpdate, game.system.id);
  if ( user && !user.isGM && Object.keys(flags).length ) await step("restoring a player's", () => user.update(flags));
  // (Its place on it too, where a Delay moved it: live-battle.js delayOnTracker.)
  if ( r.combatant ) {
    await step("the combat tracker", async () => {
      const was = { ...("defeated" in r.combatant ? { defeated: !!r.combatant.defeated } : {}), ...("initiative" in r.combatant ? { initiative: r.combatant.initiative } : {}) };
      await (await ofHere(r.combatant.uuid, "Combatant"))?.update(was, { turnEvents: false });
    });
  }
}

/**
 * Does an undo record's world setting go back? Only the system's own (`system`, its id), and only one FastFighting
 * recorded itself (`recorded`: a Set of "namespace.key"; none given, none).
 */
export function settingRestored(setting, recorded, system) {
  if ( !setting || typeof setting !== "object" || typeof setting.key !== "string" || !system || setting.namespace !== system ) return false;
  return !!recorded?.has?.(`${setting.namespace}.${setting.key}`);
}

/** What of a player an undo record puts back: flags in FastFighting's namespace or the system's (`system`), flattened. */
export function userFlags(update, system) {
  const ok = k => k.startsWith(`flags.${MODULE_ID}.`) || (!!system && k.startsWith(`flags.${system}.`));
  return Object.fromEntries(Object.entries(foundry.utils.flattenObject(update ?? {})).filter(([k]) => ok(k)));
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

/**
 * A token an undo record puts back: as it was, but no one's ownership changed by it (that's its actor's): neither its
 * own nor its unlinked actor's (`delta`).
 */
export function tokenData(data) {
  const rest = withoutOwnership(data ?? {});
  if ( rest.delta && typeof rest.delta === "object" ) rest.delta = withoutOwnership(rest.delta);
  return rest;
}

/** An update, or a document's data, without `ownership`: nobody's rights change on Rewind. */
function withoutOwnership(data) {
  if ( !data || typeof data !== "object" ) return data;
  const { ownership, ...rest } = data;
  return rest;
}

/**
 * Put back what one fight did: its chat cards, outcomes, doors and positions. Each record as revertRecord takes it,
 * on `scene` (`settings`: the world settings FastFighting recorded); each door a wall there, each move a token there.
 */
export async function revertEntry(scene, undo, { settings = null } = {}) {
  for ( const id of undo.messages ?? [] ) await game.messages.get(id)?.delete();
  for ( const r of [...(undo.records ?? [])].reverse() ) await revertRecord(r, { scene, settings });
  const onScene = async (uuid, type) => {
    if ( typeof uuid !== "string" || foundry.utils.parseUuid(uuid)?.type !== type ) return null;
    const doc = await fromUuid(uuid);
    return doc && doc.parent?.id === scene?.id ? doc : null;
  };
  // Doors as they were (closed, or locked).
  const states = new Set(Object.values(CONST.WALL_DOOR_STATES));
  for ( const d of undo.doors ?? [] ) {
    try {
      if ( states.has(d?.ds) ) await (await onScene(d.uuid, "Wall"))?.update({ ds: d.ds });
    } catch ( err ) {
      console.warn(`${MODULE_ID} | couldn't restore a door`, err);
    }
  }
  // Positions last, so tokens recreated above go back to where they started too.
  // Straight back where they stood, without walking the map again.
  const back = [];
  for ( const m of undo.moves ?? [] ) {
    if ( !Number.isFinite(m?.x) || !Number.isFinite(m?.y) ) continue;
    const doc = await onScene(m.uuid, "Token");
    if ( doc && (doc._source.x !== m.x || doc._source.y !== m.y) ) back.push([doc.id, { destination: { x: m.x, y: m.y, action: "displace" } }]);
  }
  // (Moves, not plain updates: Foundry quietly refuses a position update that would cross a wall.)
  if ( back.length ) await scene.moveTokens(Object.fromEntries(back), { animate: false });
}

