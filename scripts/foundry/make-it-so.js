/**
 * "Do it For Real Now": one more fight, that nobody has seen, played out for the table.
 *   1. The story is told in the chat a turn at a time, each turn's tokens moving as it's told (the Statistician's
 *      account is the GMs' alone: one card, and the tokens go straight to where the fight left them).
 *   2. Every token settles where the fight left it (snapped to the grid, never stacked, never through a wall).
 *   3. Each token's outcome is written through the system adapter (HP, conditions, death, loot, spent resources).
 *   4. The GMs get a summary, with Rewind This Encounter.
 * Everything is kept on the scene as it's done, so a playback cut short (a crash, a lost connection) can be continued
 * or rewound from the planner, and Rewind puts it all back, every chat card included. The last few are kept, newest
 * first, so several can be rewound in turn.
 */
import { MODULE_ID, STATUS } from "../constants.js";
import { escapeHtml as escape, inertHtml } from "../i18n.js";
import { getAdapter } from "../api.js";
import { setting } from "../settings.js";
import { pixelsFor, sceneDistance } from "./terrain.js";
import { currentPathGrid, pathGridFor } from "./pathing.js";
import { concessionText, buildStory, storyBeats } from "../story/story.js";
import { loadStoryTables } from "../story/tables.js";
import { replay } from "../engine/simulator.js";
import { randomSeed } from "../engine/rng.js";

const loc = key => game.i18n.localize(key);
const UNDO_DEPTH = 5;
/** The most chat messages after a Make it So's summary for its Undo to still work: further back, it's history. */
export const UNDO_REACH = 10;

/** Undo entries for a scene, newest first (older worlds stored a single entry). */
function undoStack(scene) {
  const stored = scene?.getFlag(MODULE_ID, "undo");
  if ( !stored ) return [];
  if ( Array.isArray(stored.stack) ) return stored.stack;
  return (stored.records || stored.moves || stored.messages || stored.doors) ? [stored] : [];
}

async function writeStack(scene, stack) {
  if ( stack.length ) await scene.update({ [`flags.${MODULE_ID}.==undo`]: { stack: stack.slice(0, UNDO_DEPTH) } });
  else await scene.unsetFlag(MODULE_ID, "undo");
}

/** The fight playing on a scene, or one a crash (or a lost connection) left unfinished: what it has done so far. */
export function unfinishedPlayback(scene = canvas.scene) {
  return scene?.getFlag(MODULE_ID, "playback") ?? null;
}

/** Is that playback going on right now (here, or by another GM who's still here)? If not, it was cut short. */
export function playingNow(state) {
  if ( !state ) return false;
  if ( state.user === game.user.id ) return !!busy;
  return !!game.users.get(state.user)?.active;
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
    if ( c.kept ) {
      row.lines.push(game.i18n.format("FASTFIGHTING.MakeItSo.Kept", { what, luck: c.luck }));
      continue;
    }
    if ( c.returned ) {
      row.lines.push(game.i18n.format("FASTFIGHTING.MakeItSo.Reclaimed", { what, name: c.toName }));
      continue;
    }
    row.lines.push(game.i18n.format(c.how === "theft" ? "FASTFIGHTING.MakeItSo.Stolen" : "FASTFIGHTING.MakeItSo.Gives", { what, name: c.toName }));
    row.changed = true;
    const to = rows.find(r => r.spec.id === c.to);
    if ( to ) {
      to.lines.push(game.i18n.format(c.how === "theft" ? "FASTFIGHTING.MakeItSo.Steals" : "FASTFIGHTING.MakeItSo.Receives", { what, name: row.spec.name }));
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
const placeOf = doc => ({ x: doc._source.x, y: doc._source.y });

/** How fast tokens move through the fight on the map, in grid squares a second (and when they settle at the end). */
const PLAYBACK_SPEED = 10;
const SETTLE_SPEED = 16;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The Make it So (or Undo) under way: a promise that settles when it's done, or null. */
let busy = null;
export const makingItSo = () => busy;

/**
 * Keep the game paused while Make it So (or Undo) writes the fight onto the map, so no player drags a token into the
 * middle of it. A pause only stops players: the GM's writes and every animation go on, so nothing here ever waits on
 * it, whoever pauses or un-pauses meanwhile. After, the game is left as it was before (the planner keeps it paused
 * while it's open), unless someone paused or un-paused it meanwhile: that stands.
 */
async function holdingPause(work, { resume = false } = {}) {
  // (`resume`: the game was going before a playback that was cut short, and goes on once it's done.)
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
 * Walk tokens through part of the fight as the story tells it: each move in order, around walls (or straight
 * through where the fight went through), and each door opened as it's opened. A move a token has made already (a
 * playback continued after a crash) is simply where it is.
 */
async function playMoves(events, docs, grid, doorsOpened, scene) {
  for ( const e of events ) {
    if ( e.type === "door" && e.success ) {
      await openSceneDoor(scene, e.doorId, doorsOpened);
      continue;
    }
    if ( !["move", "flee", "leave"].includes(e.type) || !e.to ) continue;
    const doc = docs.get(e.actorId);
    if ( !doc?.object || doc.hidden ) continue;
    const dest = clampToScene(pixelsFor(doc, e.to), doc);
    if ( dest.x === doc._source.x && dest.y === doc._source.y ) continue;
    await quickMove(doc, grid ? grid.route(doc, dest, { doors: true }) : [dest]);
  }
}

/** Open a door on the scene (once), remembering how it was for Rewind. */
async function openSceneDoor(scene, id, opened) {
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

/**
 * On a square grid the fight already found its way round the walls (or through one, at a price), so its final spot
 * stands. Elsewhere, back off along the line from the token's spot until the path doesn't cross a wall.
 */
function respectWalls(tokenDoc, dest) {
  const token = tokenDoc.object;
  if ( !token || currentPathGrid() ) return dest;
  const start = placeOf(tokenDoc);
  const size = canvas.dimensions.size;
  const steps = Math.ceil(Math.hypot(dest.x - start.x, dest.y - start.y) / (size / 2));
  for ( let i = steps; i >= 1; i-- ) {
    const t = i / steps;
    const p = { x: start.x + (dest.x - start.x) * t, y: start.y + (dest.y - start.y) * t };
    const snapped = canvas.grid.getSnappedPoint?.(p, { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_CORNER }) ?? p;
    if ( !token.checkCollision(centerOf(snapped, tokenDoc), { type: "move", mode: "any" }) ) return snapped;
  }
  return start;
}

function wallBetween(a, b) {
  try {
    return !!CONFIG.Canvas.polygonBackends.move.testCollision(a, b, { type: "move", mode: "any" });
  } catch ( err ) {
    return false;
  }
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

/** Final top-left spots for every row that moved. */
function planPlacements(rows, scene) {
  const occupied = new Set();
  const moving = new Set(rows.filter(r => r.moved >= 5).map(r => r.tokenDoc.id));
  for ( const t of scene.tokens ) {
    if ( !moving.has(t.id) && !t.hidden ) for ( const c of cellsOf(t._source.x, t._source.y, t) ) occupied.add(c);
  }
  const placements = [];
  // Standing combatants pick spots first; the fallen lie where they can.
  const order = rows.filter(r => moving.has(r.tokenDoc.id)).sort((a, b) => (a.final.status === STATUS.STANDING ? 0 : 1) - (b.final.status === STATUS.STANDING ? 0 : 1));
  for ( const row of order ) {
    const doc = row.tokenDoc;
    let dest = clampToScene(pixelsFor(doc, row.final.position), doc);
    dest = respectWalls(doc, dest);
    dest = freeSpot(doc, dest, occupied);
    for ( const c of cellsOf(dest.x, dest.y, doc) ) occupied.add(c);
    if ( dest.x !== doc._source.x || dest.y !== doc._source.y ) placements.push({ doc, x: dest.x, y: dest.y });
  }
  return placements;
}

/* -------------------------------------------- */
/*  Do it For Real Now                          */
/* -------------------------------------------- */

/** How long a turn's card stays the newest before the next is told (ms): about as long as it takes to read. */
const READ_MS_PER_CHAR = 35;
const BEAT_MS = { min: 1200, max: 6000 };
const readingTime = beat => (beat.html ? Math.min(BEAT_MS.max, Math.max(BEAT_MS.min, beat.text.length * READ_MS_PER_CHAR)) : 0);

/** How a number JSON can't hold (Infinity: uses without limit) is written, so a stored BattleSpec comes back exactly. */
const NUMBER = "$ffNumber";

/** A BattleSpec as text, kept on the scene while its fight plays (to play it again after a crash). */
export const packSpec = spec => JSON.stringify(spec, (key, v) => (typeof v === "number" && !Number.isFinite(v) ? { [NUMBER]: String(v) } : v));

export const unpackSpec = text => JSON.parse(text, (key, v) => (v && typeof v === "object" && Object.keys(v).length === 1 && NUMBER in v ? Number(v[NUMBER]) : v));

const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);
const chronicle = () => ({ alias: loc("FASTFIGHTING.Story.Speaker") });
const storyTitle = scene => game.i18n.format("FASTFIGHTING.Story.Title", { scene: scene?.name ?? "" });
const ChatMessageClass = () => foundry.documents.ChatMessage ?? globalThis.ChatMessage;

/** Note how far a playback has got, on its scene (only what changed is sent). */
async function save(scene, state, patch) {
  Object.assign(state, patch);
  await scene.update({ [`flags.${MODULE_ID}.playback`]: patch });
}

/**
 * Do it For Real Now: one more fight, never simulated before, played out for the table on the scene being viewed.
 * @param {object} spec              The BattleSpec
 * @param {object} [options]
 * @param {string} [options.style]   roleplay | standard | statistician
 * @param {string} [options.odds]    A line on the odds, for the story's close (only when the GM wants it shown)
 * @param {boolean} [options.resume] The game was going before the planner paused it (it goes on once a playback cut
 *                                   short is finished)
 * @returns {Promise<object[]>} the undo records
 */
export function doItForReal(spec, { style = setting("storyStyle"), odds = null, resume = false } = {}) {
  if ( !game.user.isGM ) return Promise.resolve([]);
  const scene = canvas.scene;
  const seed = randomSeed();
  const result = replay(spec, getAdapter().rules, seed);
  const rows = planMakeItSo(spec, result, scene);
  return holdingPause(async () => {
    const state = {
      id: foundry.utils.randomID(), user: game.user.id, time: Date.now(), spec: packSpec(spec), seed, style, odds, resume,
      phase: "story", next: 0, summary: null,
      moves: rows.map(r => ({ uuid: r.tokenDoc.uuid, ...placeOf(r.tokenDoc) })), messages: [], doors: [], records: [], done: []
    };
    await scene.update({ [`flags.${MODULE_ID}.==playback`]: state });
    return playFight(scene, state, { spec, result, rows });
  });
}

/** Go on with a playback that was cut short, from where it got to. */
export function continuePlayback(scene = canvas.scene) {
  const state = unfinishedPlayback(scene);
  if ( !game.user.isGM || !state || playingNow(state) ) return Promise.resolve(false);
  return holdingPause(async () => {
    await save(scene, state, { user: game.user.id });
    return playFight(scene, state);
  }, { resume: state.resume });
}

async function playFight(scene, state, { spec = null, result = null, rows = null } = {}) {
  spec ??= unpackSpec(state.spec);
  result ??= replay(spec, getAdapter().rules, state.seed);
  rows ??= planMakeItSo(spec, result, scene);
  const doorsOpened = new Map((state.doors ?? []).map(d => [d.id, d]));
  if ( state.phase === "story" ) await tellStory(scene, state, spec, result, rows, doorsOpened);
  if ( state.phase === "outcomes" ) await writeOutcomes(scene, state, result, rows, doorsOpened);
  if ( state.phase === "closing" ) await closeFight(scene, state, result, rows);
  return state.records;
}

/**
 * 1. The story, a turn at a time: each turn's card in the chat as its tokens move, then the next. The Statistician's
 *    account is one card, for the GMs (who can show it to everyone); its tokens move when everyone settles.
 */
async function tellStory(scene, state, spec, result, rows, doorsOpened) {
  if ( state.style === "statistician" ) {
    if ( !state.next ) {
      const story = buildStory(result, spec, "statistician", { title: storyTitle(scene) });
      const message = await postStory(story, state.odds, { gmOnly: true });
      await save(scene, state, { next: 1, messages: message ? [...state.messages, message.id] : state.messages });
    }
    await save(scene, state, { phase: "outcomes" });
    return;
  }
  const adapter = getAdapter();
  const beats = storyBeats(result, spec, state.style, {
    tables: await loadStoryTables(), seed: state.seed, damageType: adapter?.rules?.storyDamageType?.bind(adapter.rules) ?? null,
    conditionType: adapter?.rules?.storyCondition?.bind(adapter.rules) ?? null
  });
  const docs = new Map(rows.map(r => [r.spec.id, r.tokenDoc]));
  const play = setting("playOnMap");
  const grid = play ? (currentPathGrid() ?? pathGridFor(rows.map(r => r.tokenDoc.object).filter(Boolean))) : null;
  const byTurn = new Map();
  for ( const e of result.log ?? [] ) {
    if ( !byTurn.has(e.turn) ) byTurn.set(e.turn, []);
    byTurn.get(e.turn).push(e);
  }
  // (Continued after a crash: the turn it broke off in has its card already, and its moves play again from
  // wherever they got to.)
  for ( let i = Math.max(0, state.next - 1); i < beats.length; i++ ) {
    const beat = beats[i];
    const fresh = i >= state.next;
    const telling = fresh ? (async () => {
      const message = beat.html ? await postBeat(scene, beat, docs, state) : null;
      await save(scene, state, { next: i + 1, messages: message ? [...state.messages, message.id] : state.messages });
    })() : null;
    const moving = play ? playMoves(beat.turns.flatMap(t => byTurn.get(t) ?? []), docs, grid, doorsOpened, scene) : null;
    await Promise.all([telling, moving, fresh ? wait(readingTime(beat)) : null]);
    if ( doorsOpened.size !== (state.doors?.length ?? 0) ) await save(scene, state, { doors: [...doorsOpened.values()] });
  }
  await save(scene, state, { phase: "outcomes" });
}

/**
 * One turn's card. A creature that spent its turn only talking says it aloud: its own words in the chat, as a
 * player's would be (and a bubble over its token on the map, where those are on).
 */
async function postBeat(scene, beat, docs, state) {
  const ChatMessage = ChatMessageClass();
  const doc = beat.actorId ? (docs.get(beat.actorId) ?? null) : null;
  const whisper = setting("storyMode") === "whisper" ? gmIds() : [];
  const flags = { [MODULE_ID]: { story: true, beat: true } };
  const speaker = doc ? ChatMessage.getSpeaker({ scene, token: doc }) : chronicle();
  if ( beat.talking && doc ) {
    const bubble = !whisper.length && !doc.hidden && !!game.settings.get("core", "chatBubbles");
    return ChatMessage.create({ content: inertHtml(escape(beat.text)), speaker, style: CONST.CHAT_MESSAGE_STYLES.IC, whisper, flags }, { chatBubble: bubble });
  }
  const head = beat.closing ? `<header><i class="fa-solid fa-book-open"></i> ${escape(storyTitle(scene))}</header>`
    : beat.round >= 1 ? `<header>${escape(game.i18n.format("FASTFIGHTING.Story.TurnRound", { n: beat.round }))}</header>` : "";
  const odds = beat.closing && state.odds ? `<p class="ff-odds"><em>${escape(state.odds)}</em></p>` : "";
  const kind = beat.closing ? "fast-fighting-story" : "fast-fighting-story fast-fighting-beat";
  return ChatMessage.create({ content: inertHtml(`<div class="${kind}">${head}${beat.html}${odds}</div>`), speaker, whisper, flags });
}

/** A whole story in one card (the Statistician's: the GMs', with a button to show it to everyone). */
async function postStory(story, odds, { gmOnly = false } = {}) {
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
 * 2. Everyone settles where the fight left them, and 3. the outcomes are written: each step kept as it's done, so a
 *    playback continued after a crash doesn't do one twice.
 */
async function writeOutcomes(scene, state, result, rows, doorsOpened) {
  const adapter = getAdapter();
  // Where a lingering effect came from: the action (and its user) that laid it, for the helper to copy.
  const sources = new Map(rows.flatMap(r => r.spec.actions.map(action => [action.id, { action, spec: r.spec }])));
  const options = { lootMode: setting("lootMode"), corpseMode: setting("corpseMode"), fledMode: setting("fledMode"), effectSource: id => sources.get(id) ?? null };
  Hooks.callAll("fastFighting.preMakeItSo", { rows, replay: result, options, story: null, stories: {} });

  // Doors the fight opened or broke stay open (if the story didn't already open them).
  for ( const id of Object.keys(result.doors ?? {}) ) await openSceneDoor(scene, id, doorsOpened);
  // Everyone to a free spot where the fight left them; one that walked about and ended where it began, back there.
  const start = new Map((state.moves ?? []).map(m => [m.uuid, m]));
  const finals = new Map(planPlacements(rows, scene).map(p => [p.doc.id, { x: p.x, y: p.y }]));
  for ( const r of rows ) {
    const from = start.get(r.tokenDoc.uuid);
    if ( !finals.has(r.tokenDoc.id) && from ) finals.set(r.tokenDoc.id, { x: from.x, y: from.y });
  }
  const grid = currentPathGrid() ?? pathGridFor(rows.map(r => r.tokenDoc.object).filter(Boolean));
  const settle = [];
  for ( const [id, p] of finals ) {
    const doc = scene.tokens.get(id);
    if ( !doc || (doc._source.x === p.x && doc._source.y === p.y) ) continue;
    settle.push(quickMove(doc, grid && doc.object && !doc.hidden ? grid.route(doc, p, { doors: true }) : [p], SETTLE_SPEED));
  }
  await Promise.all(settle);
  await save(scene, state, { doors: [...doorsOpened.values()] });

  const done = new Set(state.done ?? []);
  const step = async (key, name, work) => {
    if ( done.has(key) ) return;
    let records = [];
    try {
      records = (await work()) ?? [];
    } catch ( err ) {
      console.error(`${MODULE_ID} | Do it For Real Now failed for ${name}`, err);
      ui.notifications.error("FASTFIGHTING.MakeItSo.Failed", { format: { name } });
    }
    done.add(key);
    await save(scene, state, { records: [...state.records, ...records], done: [...done], messages: state.messages });
  };

  for ( const row of rows.filter(r => r.changed) ) {
    await step(`outcome.${row.spec.id}`, row.spec.name, async () => [await adapter.commitOutcome(row.tokenDoc, row.spec, row.final, options)].filter(Boolean));
  }

  // (Changed sides: wanting to lead, a playstyle, goes from the character, and Rewind puts it back.)
  for ( const row of rows ) {
    if ( !row.final.ambitionDropped ) continue;
    await step(`ambition.${row.spec.id}`, row.spec.name, async () => {
      const actor = row.tokenDoc?.actor;
      const before = actor?.getFlag(MODULE_ID, "tactics")?.playstyles;
      if ( !Array.isArray(before) || !before.includes("leader") ) return [];
      await actor.update({ [`flags.${MODULE_ID}.tactics.playstyles`]: before.filter(p => p !== "leader") });
      return [{ tokenUuid: row.tokenDoc.uuid, actorUuid: actor.uuid, actorUpdate: { [`flags.${MODULE_ID}.tactics.playstyles`]: before } }];
    });
  }

  // Whatever was given up changes hands. A PC's loss gets its own GM card with an Undo for just that.
  if ( adapter.commitConcession ) {
    for ( const row of rows ) {
      for ( const [i, c] of (row.final.concessions ?? []).entries() ) {
        if ( c.kept || c.returned ) continue; // kept by luck, or taken back from a beaten taker: nothing changes hands
        await step(`concession.${row.spec.id}.${i}`, row.spec.name, async () => {
          const to = rows.find(r => r.spec.id === c.to);
          // (The giver's side, for what it shares: Ironsworn's Supply.)
          const sideOf = r => r.final.side ?? r.spec.side;
          const allies = rows.filter(r => r !== row && sideOf(r) === sideOf(row)).map(r => r.tokenDoc);
          const eventRecords = (await adapter.commitConcession(row.tokenDoc, to?.tokenDoc ?? null, c, { giver: row.spec, receiver: to?.spec ?? null, allies })) ?? [];
          if ( !eventRecords.length ) return [];
          const eventId = foundry.utils.randomID();
          for ( const r of eventRecords ) r.eventId = eventId;
          if ( row.spec.kind === "pc" ) {
            const card = await concessionCard(scene, row.spec.name, to?.spec.name ?? c.toName, c, eventId, eventRecords);
            if ( card ) state.messages = [...state.messages, card.id];
          }
          return eventRecords;
        });
      }
    }
  }

  // The encounter's own record, by the system (Ironsworn: its progress track, kept on one character).
  if ( rows.encounter && adapter.commitEncounter ) {
    await step("encounter", rows.encounter.title ?? "", async () => (await adapter.commitEncounter(rows.encounter.spec, rows.encounter.replay, options)) ?? []);
  }
  await save(scene, state, { phase: "closing" });
}

/**
 * 4. The GMs' summary: what the players' characters spent and how long it all took (nothing is changed: the
 *    encounter stays open and the clock stays where it was), with Rewind This Encounter. Then what the fight did goes
 *    on the scene's list to rewind, and the playback is over.
 */
async function closeFight(scene, state, result, rows) {
  if ( !state.summary ) {
    const summary = gmSummary(rows, result, getAdapter());
    const message = summary ? await ChatMessageClass().create({
      content: inertHtml(summary), speaker: chronicle(), whisper: gmIds(),
      flags: { [MODULE_ID]: { summary: true, undoFight: { sceneId: scene.id, id: state.id } } }
    }) : null;
    await save(scene, state, { summary: message?.id ?? "none", messages: message ? [...state.messages, message.id] : state.messages });
  }
  const entry = { id: state.id, time: state.time, records: state.records, moves: state.moves, messages: state.messages, doors: state.doors };
  await writeStack(scene, [entry, ...undoStack(scene).filter(e => e.id !== state.id)]);
  await scene.unsetFlag(MODULE_ID, "playback");
  refreshUndoCards();
  foundry.applications.instances.get("fast-fighting-planner")?.render();
  Hooks.callAll("fastFighting.makeItSo", state.records);
}

/** "1 minute 12 seconds" */
function timeText(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  const parts = [];
  if ( m ) parts.push(game.i18n.format(m === 1 ? "FASTFIGHTING.Summary.Minute" : "FASTFIGHTING.Summary.Minutes", { n: m }));
  if ( s || !m ) parts.push(game.i18n.format(s === 1 ? "FASTFIGHTING.Summary.Second" : "FASTFIGHTING.Summary.Seconds", { n: s }));
  return parts.join(" ");
}

/**
 * The GM's after-action note: what each player character used up (slots, focus, potions, hero points,
 * limited uses), and how much time passed, fighting and then tending the fallen.
 */
function gmSummary(rows, replay, adapter) {
  const items = [];
  for ( const r of rows ) {
    const actor = r.tokenDoc.actor;
    // A character a player controls (or a player character nobody has been given yet, as in a GM's test party).
    if ( !actor || !(r.spec.kind === "pc" || game.users.some(u => !u.isGM && actor.testUserPermission(u, "OWNER"))) ) continue;
    const spent = [];
    for ( const [key, start] of Object.entries(r.spec.resources ?? {}) ) {
      const used = start - (r.final.resources?.[key] ?? start);
      if ( used > 0 ) spent.push(`${used} × ${adapter.resourceLabel?.(key, r.spec) ?? r.spec.actions.find(a => a.resource === key)?.name ?? key}`);
    }
    for ( const [id, left] of Object.entries(r.final.uses ?? {}) ) {
      const a = r.spec.actions.find(x => x.id === id);
      if ( a && Number.isFinite(a.uses) && left < a.uses ) spent.push(`${a.uses - left} × ${a.name}`);
    }
    items.push(`<li><strong>${escape(r.spec.name)}</strong>: ${escape(spent.length ? spent.join(", ") : loc("FASTFIGHTING.Summary.Nothing"))}</li>`);
  }
  const per = adapter.rules?.secondsPerRound ?? 6;
  const fight = (replay.rounds ?? 0) * per;
  const after = (replay.aftermathRounds ?? 0) * per;
  const time = after > 0
    ? game.i18n.format("FASTFIGHTING.Summary.TimeAfter", { fight: timeText(fight), rounds: replay.rounds ?? 0, after: timeText(after) })
    : game.i18n.format("FASTFIGHTING.Summary.Time", { fight: timeText(fight), rounds: replay.rounds ?? 0 });
  return `<div class="fast-fighting-summary"><header><i class="fa-solid fa-clipboard-list"></i> ${loc("FASTFIGHTING.Summary.Title")}</header>
    <p>${escape(time)}</p>${items.length ? `<p>${loc("FASTFIGHTING.Summary.Spent")}</p><ul>${items.join("")}</ul>` : ""}
    <p class="hint">${loc("FASTFIGHTING.Summary.Unchanged")}</p>
    <button type="button" data-ff-undo-fight><i class="fa-solid fa-backward"></i> ${loc("FASTFIGHTING.MakeItSo.Undo")}</button></div>`;
}

/** Show a GM-only story to everyone (the Reveal button on it). */
/**
 * Is this one of FastFighting's own cards? Only a GM posts them. Anyone can post a chat message with any flags, so a
 * card a player wrote is never acted on: its "undo records" would run with the GM's rights.
 */
export const ownCard = message => !!message?.author?.isGM;

export async function revealStory(message) {
  if ( !game.user.isGM || !ownCard(message) || !message.getFlag(MODULE_ID, "revealable") ) return false;
  const content = message.content.replace(/<button[^>]*data-ff-reveal[^>]*>[\s\S]*?<\/button>/, "");
  await message.update({ whisper: [], content, [`flags.${MODULE_ID}.revealable`]: false });
  return true;
}

/** Is there one to rewind here (and no playback under way, or cut short: that has its own Continue and Rewind)? */
export function hasUndo(scene = canvas.scene) {
  return undoStack(scene).length > 0 && !unfinishedPlayback(scene);
}

/**
 * Can this summary card's Make it So be undone: "ok" (the latest on its scene, and recent in the chat); "later" (not
 * the latest: a later one on the same scene stands on it); "buried" (more than UNDO_REACH messages since, in the
 * chat); "gone" (no longer kept: undone already, or too many since). Only "ok" undoes anything.
 */
export function cardUndoState(message) {
  const data = message?.getFlag(MODULE_ID, "undoFight");
  const scene = game.scenes.get(data?.sceneId);
  const stack = undoStack(scene);
  const at = stack.findIndex(e => e.id && e.id === data?.id);
  if ( at < 0 ) return "gone";
  // (A playback on the scene, under way or cut short, stands on it too.)
  if ( at > 0 || unfinishedPlayback(scene) ) return "later";
  const since = (game.messages?.contents ?? []).filter(m => m.timestamp > message.timestamp).length;
  return since > UNDO_REACH ? "buried" : "ok";
}

/** Each Make it So summary in the chat drawn again (its Undo works, or not, as things stand now). */
export function refreshUndoCards() {
  if ( !game.user.isGM ) return;
  for ( const m of game.messages?.contents ?? [] ) if ( m.getFlag(MODULE_ID, "undoFight") ) ui.chat?.updateMessage?.(m);
}

/** Undo from a summary card in the chat: the Make it So it reports, on its own scene, once the GM confirms. */
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

/** Put one undo record back: created documents removed, deleted ones restored, changed values reset. */
/**
 * The statuses on an actor, read from its effects too: a system that applies effects its own way (dcc) may leave
 * actor.statuses empty.
 */
function statusesOf(actor) {
  const out = new Set(actor?.statuses ?? []);
  for ( const e of actor?.effects ?? [] ) if ( !e.disabled ) for ( const s of e.statuses ?? [] ) out.add(s);
  return out;
}

async function revertRecord(r) {
  // Each step on its own: one that fails (a status the server has already dropped, say) mustn't stop the rest.
  const step = async (what, fn) => {
    try {
      await fn();
    } catch ( err ) {
      console.error(`${MODULE_ID} | undo: ${what} failed`, r, err);
    }
  };
  for ( const uuid of r.createdTokens ?? [] ) await step("removing a token", async () => (await fromUuid(uuid))?.delete());
  for ( const uuid of r.createdActors ?? [] ) await step("removing an actor", async () => (await fromUuid(uuid))?.delete());
  for ( const t of r.deletedTokens ?? [] ) {
    await step("restoring a token", async () => (await fromUuid(t.parentUuid))?.createEmbeddedDocuments("Token", [t.data], { keepId: true }));
  }
  // (A world setting the system keeps a pool in: Daggerheart's Fear, the GM's.)
  if ( r.setting ) await step("restoring a setting", () => game.settings.set(r.setting.namespace, r.setting.key, r.setting.value));
  const tokenDoc = r.tokenUuid ? await fromUuid(r.tokenUuid) : null;
  const actor = tokenDoc?.actor ?? (r.actorUuid ? await fromUuid(r.actorUuid) : null);
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
  for ( const { id, update } of r.itemUpdates ?? [] ) await step("restoring an item", () => actor.items.get(id)?.update(update));
  for ( const s of r.statuses ?? [] ) {
    if ( statusesOf(actor).has(s.id) === s.active ) continue; // already as it was
    await step(`status ${s.id}`, () => actor.toggleStatusEffect(s.id, { active: s.active, overlay: s.overlay }));
  }
  if ( Object.keys(r.actorUpdate ?? {}).length ) await step("restoring the actor", () => actor.update(r.actorUpdate));
  // Anything the system added along the way (dnd5e lays the unconscious down Prone) comes off too.
  if ( r.statusesBefore ) {
    const before = new Set(r.statusesBefore);
    for ( const id of [...statusesOf(actor)] ) {
      if ( before.has(id) || !CONFIG.statusEffects.some(s => s.id === id) ) continue;
      await step(`status ${id}`, () => (statusesOf(actor).has(id) ? actor.toggleStatusEffect(id, { active: false }) : null));
    }
  }
  if ( r.tokenUpdate && tokenDoc ) await step("restoring the token", () => tokenDoc.update(r.tokenUpdate));
  // (A player's own, such as DCC's Fleeting Luck.)
  if ( r.userId && r.userUpdate ) await step("restoring a player's", () => game.users.get(r.userId)?.update(r.userUpdate));
  if ( r.combatant ) await step("the combat tracker", async () => (await fromUuid(r.combatant.uuid))?.update({ defeated: r.combatant.defeated }));
}

/* -------------------------------------------- */
/*  A PC's loss: one card, one undo             */
/* -------------------------------------------- */

/** The GM-only card for something a PC gave up, with an Undo for just that hand-over. */
async function concessionCard(scene, giverName, receiverName, c, eventId, records) {
  const ChatMessage = foundry.documents.ChatMessage ?? globalThis.ChatMessage;
  const text = game.i18n.format(c.how === "theft" ? "FASTFIGHTING.Concession.CardTheft" : "FASTFIGHTING.Concession.Card", { giver: escape(giverName), what: escape(concessionText(c)), receiver: escape(receiverName ?? "") });
  const luckKey = c.how === "theft" ? "FASTFIGHTING.Concession.TheftLuck" : "FASTFIGHTING.Concession.Luck";
  const needed = c.how === "theft" ? (c.needed ?? setting("theftLuck")) : (c.needed ?? setting("concedeLuck"));
  const luck = c.luck ? `<p class="hint">${game.i18n.format(luckKey, { luck: c.luck, needed })}</p>` : "";
  return ChatMessage.create({
    content: inertHtml(`<div class="fast-fighting-concession"><p>${text}</p>${luck}<button type="button" data-ff-undo-concession><i class="fa-solid fa-rotate-left"></i> ${loc("FASTFIGHTING.Concession.Undo")}</button></div>`),
    speaker: { alias: loc("FASTFIGHTING.Story.Speaker") },
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    flags: { [MODULE_ID]: { concession: { eventId, sceneId: scene.id, records, undone: false } } }
  });
}

/** Undo just one hand-over from its card, and take it out of the scene's Make it So undo so it isn't undone twice. */
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
  if ( !game.user.isGM || !state || playingNow(state) ) return Promise.resolve(false);
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
async function revertEntry(scene, undo) {
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

