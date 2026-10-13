/**
 * "Make it So": commit one replayed fight to the world.
 *   1. Move every token to where the fight left it (snapped to the grid, never stacked, never through a wall).
 *   2. Commit each token's outcome through the system adapter (HP, conditions, death, loot, spent resources).
 *   3. Post the story of the fight to chat.
 * Everything is recorded on the scene so Undo can put it all back, chat message included. The last few are kept,
 * newest first, so several Make it So's can be undone in turn.
 */
import { MODULE_ID, STATUS } from "../constants.js";
import { escapeHtml as escape, inertHtml } from "../i18n.js";
import { getAdapter } from "../api.js";
import { setting } from "../settings.js";
import { pixelsFor, sceneDistance } from "./terrain.js";
import { currentPathGrid, pathGridFor } from "./pathing.js";
import { concessionText } from "../story/story.js";

const loc = key => game.i18n.localize(key);
const UNDO_DEPTH = 5;

/** Undo entries for a scene, newest first (older worlds stored a single entry). */
function undoStack(scene) {
  const stored = scene?.getFlag(MODULE_ID, "undo");
  if ( !stored ) return [];
  if ( Array.isArray(stored.stack) ) return stored.stack;
  return (stored.records || stored.moves || stored.messages || stored.doors) ? [stored] : [];
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
export function planMakeItSo(spec, replay) {
  const adapter = getAdapter();
  const rows = [];
  for ( const c of spec.combatants ) {
    const final = replay.units[c.id]?.final;
    const tokenDoc = canvas.scene.tokens.get(c.tokenId ?? c.id);
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

/** Ask the GM to confirm; returns true if they accept. */
export async function confirmMakeItSo(rows, replay = null) {
  const changed = rows.filter(r => r.changed);
  const doors = Object.values(replay?.doors ?? {});
  const doorLine = doors.length ? `<li>${game.i18n.format("FASTFIGHTING.MakeItSo.Doors", { n: doors.length, broken: doors.filter(d => d.broken).length })}</li>` : "";
  const encounter = rows.encounter ? `<li><strong>${escape(rows.encounter.title ?? "")}</strong>: ${rows.encounter.lines.map(escape).join("; ")}</li>` : "";
  const content = `<p>${loc("FASTFIGHTING.MakeItSo.Confirm")}</p>
    <ul class="ff-mis-list">${changed.map(r => `<li><strong>${escape(r.spec.name)}</strong>: ${r.lines.map(escape).join("; ")}</li>`).join("")}${encounter}${doorLine}</ul>
    <p class="hint">${loc("FASTFIGHTING.MakeItSo.UndoHint")}</p>`;
  return foundry.applications.api.DialogV2.confirm({
    window: { title: loc("FASTFIGHTING.MakeItSo.Title"), icon: "fa-solid fa-gavel" },
    content,
    yes: { label: loc("FASTFIGHTING.MakeItSo.Button"), icon: "fa-solid fa-gavel" },
    no: { label: loc("Cancel") },
    position: { width: 560 }
  });
}

/* -------------------------------------------- */
/*  Token placement                             */
/* -------------------------------------------- */

/** Where a token really is. (While it's animating, a token's x and y follow the animation, not the move.) */
const placeOf = doc => ({ x: doc._source.x, y: doc._source.y });

/** How fast tokens run through the fight on the map, in grid squares a second. */
const PLAYBACK_SPEED = 16;

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
async function holdingPause(work) {
  const wasPaused = game.paused;
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
async function quickMove(doc, waypoints) {
  const size = canvas.dimensions.size;
  let squares = 0;
  let from = placeOf(doc);
  for ( const p of waypoints ) {
    squares += Math.hypot(p.x - from.x, p.y - from.y) / size;
    from = p;
  }
  const takes = (squares / PLAYBACK_SPEED) * 1000 + 250;
  try {
    // (One step, no checkpoints: a game paused meanwhile doesn't stop it. A move something else holds up, such as a
    // region's script pausing it, is let go after a while; everyone settles where the fight left them anyway.)
    const moving = doc.move(waypoints, {
      animation: { movementSpeed: PLAYBACK_SPEED }, showRuler: false, pan: false, autoRotate: false,
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
 * Walk the tokens through the fight as the story tells it: every move in order, quickly, around walls (or
 * straight through where the fight went through). Returns the ids of the tokens it moved.
 */
async function playOnMap(replay, rows, doorsOpened) {
  const docs = new Map(rows.map(r => [r.spec.id, r.tokenDoc]));
  const grid = currentPathGrid() ?? pathGridFor(rows.map(r => r.tokenDoc.object).filter(Boolean));
  const moved = new Set();
  for ( const e of replay.log ?? [] ) {
    // A door opens when the story opens it.
    if ( e.type === "door" && e.success ) {
      await openSceneDoor(e.doorId, doorsOpened);
      continue;
    }
    if ( !["move", "flee", "leave"].includes(e.type) || !e.to ) continue;
    const doc = docs.get(e.actorId);
    if ( !doc?.object || doc.hidden ) continue;
    const dest = clampToScene(pixelsFor(doc, e.to), doc);
    if ( dest.x === doc._source.x && dest.y === doc._source.y ) continue;
    await quickMove(doc, grid ? grid.route(doc, dest, { doors: true }) : [dest]);
    moved.add(doc.id);
  }
  return moved;
}

/** Open a door on the scene (once), remembering how it was for Undo. */
async function openSceneDoor(id, opened) {
  const wall = canvas.scene.walls.get(id);
  if ( !wall || opened.has(id) || wall.ds === CONST.WALL_DOOR_STATES.OPEN ) return;
  opened.set(id, { uuid: wall.uuid, ds: wall.ds });
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
function planPlacements(rows) {
  const occupied = new Set();
  const moving = new Set(rows.filter(r => r.moved >= 5).map(r => r.tokenDoc.id));
  for ( const t of canvas.scene.tokens ) {
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
/*  Commit                                      */
/* -------------------------------------------- */

/**
 * Commit the plan: move tokens, apply outcomes, post the story. Stores everything needed for Undo.
 * @param {object[]} rows       From planMakeItSo
 * @param {object} replay       The fight being committed
 * @param {object} [options]
 * @param {{title: string, html: string}} [options.story]    The story to post (older callers)
 * @param {{everyone?: object, gm?: object}} [options.stories] The story for the table, and one for the GMs alone
 *   (the Statistician's, with a button to show it to everyone)
 * @param {string} [options.odds]  A line on the odds, to add to the stories (only when the GM wants it shown)
 */
export async function executeMakeItSo(rows, replay, options = {}) {
  if ( !game.user.isGM ) return [];
  return holdingPause(() => commitFight(rows, replay, options));
}

async function commitFight(rows, replay, { story = null, stories = null, odds = null } = {}) {
  stories ??= { everyone: story };
  const adapter = getAdapter();
  // Where a lingering effect came from: the action (and its user) that laid it, for the helper to copy.
  const sources = new Map(rows.flatMap(r => r.spec.actions.map(action => [action.id, { action, spec: r.spec }])));
  const options = { lootMode: setting("lootMode"), corpseMode: setting("corpseMode"), fledMode: setting("fledMode"), effectSource: id => sources.get(id) ?? null };
  Hooks.callAll("fastFighting.preMakeItSo", { rows, replay, options, story: stories.everyone ?? stories.gm ?? null, stories });

  // 1. Movement: the fight plays out on the map (every move in the story's order, quickly, around walls), then
  //    everyone settles on a free spot where the fight left them.
  const placements = planPlacements(rows);
  const start = new Map(rows.map(r => [r.tokenDoc.id, placeOf(r.tokenDoc)]));
  const moves = rows.map(r => ({ uuid: r.tokenDoc.uuid, ...start.get(r.tokenDoc.id) }));
  const doorsOpened = new Map();
  const played = setting("playOnMap") ? await playOnMap(replay, rows, doorsOpened) : new Set();
  // Doors the fight opened or broke stay open (if the map didn't already show it).
  for ( const id of Object.keys(replay.doors ?? {}) ) await openSceneDoor(id, doorsOpened);
  const finals = new Map(placements.map(p => [p.doc.id, { x: p.x, y: p.y }]));
  for ( const id of played ) if ( !finals.has(id) ) finals.set(id, start.get(id));
  const settle = [];
  for ( const [id, p] of finals ) {
    const doc = canvas.scene.tokens.get(id);
    if ( doc && (doc._source.x !== p.x || doc._source.y !== p.y) ) settle.push(quickMove(doc, [p]));
  }
  await Promise.all(settle);

  // 2. Outcomes
  const records = [];
  for ( const row of rows.filter(r => r.changed) ) {
    try {
      records.push(await adapter.commitOutcome(row.tokenDoc, row.spec, row.final, options));
    } catch ( err ) {
      console.error(`${MODULE_ID} | Make it So failed for ${row.spec.name}`, err);
      ui.notifications.error("FASTFIGHTING.MakeItSo.Failed", { format: { name: row.spec.name } });
    }
  }

  // (Changed sides: wanting to lead, a playstyle, goes from the character, and Undo puts it back.)
  for ( const row of rows ) {
    if ( !row.final.ambitionDropped ) continue;
    const actor = row.tokenDoc?.actor;
    const before = actor?.getFlag(MODULE_ID, "tactics")?.playstyles;
    if ( !Array.isArray(before) || !before.includes("leader") ) continue;
    try {
      await actor.update({ [`flags.${MODULE_ID}.tactics.playstyles`]: before.filter(p => p !== "leader") });
      records.push({ tokenUuid: row.tokenDoc.uuid, actorUuid: actor.uuid, actorUpdate: { [`flags.${MODULE_ID}.tactics.playstyles`]: before } });
    } catch ( err ) {
      console.error(`${MODULE_ID} | Make it So: dropping ${row.spec.name}'s ambition failed`, err);
    }
  }

  // 3. Whatever was given up changes hands. A PC's loss gets its own GM card with an Undo for just that.
  const messages = [];
  if ( adapter.commitConcession ) {
    for ( const row of rows ) {
      for ( const c of row.final.concessions ?? [] ) {
      if ( c.kept || c.returned ) continue; // kept by luck, or taken back from a beaten taker: nothing changes hands
      const to = rows.find(r => r.spec.id === c.to);
      try {
        // (The giver's side, for what it shares: Ironsworn's Supply.)
        const sideOf = r => r.final.side ?? r.spec.side;
        const allies = rows.filter(r => r !== row && sideOf(r) === sideOf(row)).map(r => r.tokenDoc);
        const eventRecords = (await adapter.commitConcession(row.tokenDoc, to?.tokenDoc ?? null, c, { giver: row.spec, receiver: to?.spec ?? null, allies })) ?? [];
        if ( !eventRecords.length ) continue;
        const eventId = foundry.utils.randomID();
        for ( const r of eventRecords ) r.eventId = eventId;
        records.push(...eventRecords);
        if ( row.spec.kind === "pc" ) {
          const card = await concessionCard(row.spec.name, to?.spec.name ?? c.toName, c, eventId, eventRecords);
          if ( card ) messages.push(card.id);
        }
      } catch ( err ) {
        console.error(`${MODULE_ID} | handing over what ${row.spec.name} gave up failed`, err);
        ui.notifications.error("FASTFIGHTING.MakeItSo.Failed", { format: { name: row.spec.name } });
      }
      }
    }
  }

  // 3b. The encounter's own record, by the system (Ironsworn: its progress track, kept on one character).
  if ( rows.encounter && adapter.commitEncounter ) {
    try {
      records.push(...((await adapter.commitEncounter(rows.encounter.spec, rows.encounter.replay, options)) ?? []));
    } catch ( err ) {
      console.error(`${MODULE_ID} | Make it So: the encounter's own record failed`, err);
      ui.notifications.error("FASTFIGHTING.MakeItSo.Failed", { format: { name: rows.encounter.title ?? "" } });
    }
  }

  // 4. The story: for the table (or the GMs, by the delivery setting); the Statistician's account for the GMs alone,
  //    with a button to show it to everyone. Then, for the GMs, what the players' characters spent and how long it
  //    all took (nothing is changed: the encounter stays open and the clock stays where it was).
  const ChatMessage = foundry.documents.ChatMessage ?? globalThis.ChatMessage;
  const gms = game.users.filter(u => u.isGM).map(u => u.id);
  const speaker = { alias: loc("FASTFIGHTING.Story.Speaker") };
  const post = async (s, { gmOnly = false } = {}) => {
    if ( !s?.html ) return;
    const oddsHtml = odds ? `<p class="ff-odds"><em>${escape(odds)}</em></p>` : "";
    const reveal = gmOnly ? `<button type="button" data-ff-reveal><i class="fa-solid fa-eye"></i> ${loc("FASTFIGHTING.Story.Reveal")}</button>` : "";
    const message = await ChatMessage.create({
      content: inertHtml(`<div class="fast-fighting-story"><header><i class="fa-solid fa-book-open"></i> ${escape(s.title)}</header>${s.html}${oddsHtml}${reveal}</div>`),
      speaker,
      whisper: gmOnly || setting("storyMode") === "whisper" ? gms : [],
      flags: { [MODULE_ID]: { story: true, revealable: gmOnly } }
    });
    if ( message ) messages.push(message.id);
  };
  await post(stories.everyone);
  await post(stories.gm, { gmOnly: true });
  const summary = gmSummary(rows, replay, adapter);
  if ( summary ) {
    const message = await ChatMessage.create({ content: inertHtml(summary), speaker, whisper: gms, flags: { [MODULE_ID]: { summary: true } } });
    if ( message ) messages.push(message.id);
  }

  const stack = [{ time: Date.now(), records, moves, messages, doors: [...doorsOpened.values()] }, ...undoStack(canvas.scene)].slice(0, UNDO_DEPTH);
  await canvas.scene.update({ [`flags.${MODULE_ID}.==undo`]: { stack } });
  Hooks.callAll("fastFighting.makeItSo", records);
  return records;
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
    <p class="hint">${loc("FASTFIGHTING.Summary.Unchanged")}</p></div>`;
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

export function hasUndo(scene = canvas.scene) {
  return undoStack(scene).length > 0;
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
async function concessionCard(giverName, receiverName, c, eventId, records) {
  const ChatMessage = foundry.documents.ChatMessage ?? globalThis.ChatMessage;
  const text = game.i18n.format(c.how === "theft" ? "FASTFIGHTING.Concession.CardTheft" : "FASTFIGHTING.Concession.Card", { giver: escape(giverName), what: escape(concessionText(c)), receiver: escape(receiverName ?? "") });
  const luckKey = c.how === "theft" ? "FASTFIGHTING.Concession.TheftLuck" : "FASTFIGHTING.Concession.Luck";
  const needed = c.how === "theft" ? (c.needed ?? setting("theftLuck")) : (c.needed ?? setting("concedeLuck"));
  const luck = c.luck ? `<p class="hint">${game.i18n.format(luckKey, { luck: c.luck, needed })}</p>` : "";
  return ChatMessage.create({
    content: inertHtml(`<div class="fast-fighting-concession"><p>${text}</p>${luck}<button type="button" data-ff-undo-concession><i class="fa-solid fa-rotate-left"></i> ${loc("FASTFIGHTING.Concession.Undo")}</button></div>`),
    speaker: { alias: loc("FASTFIGHTING.Story.Speaker") },
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    flags: { [MODULE_ID]: { concession: { eventId, sceneId: canvas.scene.id, records, undone: false } } }
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

/** Revert the most recent Make it So on this scene: outcomes, positions and the story message. */
export async function undoMakeItSo(scene = canvas.scene) {
  if ( !game.user.isGM ) return false;
  return holdingPause(() => undoFight(scene));
}

async function undoFight(scene) {
  const [undo, ...rest] = undoStack(scene);
  if ( !undo ) return false;
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
  if ( rest.length ) await scene.update({ [`flags.${MODULE_ID}.==undo`]: { stack: rest } });
  else await scene.unsetFlag(MODULE_ID, "undo");
  return true;
}

