/**
 * "Make it So": commit one replayed fight to the world.
 *   1. Move every token to where the fight left it (snapped to the grid, never stacked, never through a wall).
 *   2. Commit each token's outcome through the system adapter (HP, conditions, death, loot, spent resources).
 *   3. Post the story of the fight to chat.
 * Everything is recorded on the scene so Undo can put it all back, chat message included. The last few are kept,
 * newest first, so several Make it So's can be undone in turn.
 */
import { MODULE_ID, STATUS } from "../constants.js";
import { getAdapter } from "../api.js";
import { setting } from "../settings.js";
import { pixelsFor } from "./terrain.js";
import { concessionText } from "../story/story.js";

const loc = key => game.i18n.localize(key);
const UNDO_DEPTH = 5;

/** Undo entries for a scene, newest first (older worlds stored a single entry). */
function undoStack(scene) {
  const stored = scene?.getFlag(MODULE_ID, "undo");
  if ( !stored ) return [];
  if ( Array.isArray(stored.stack) ) return stored.stack;
  return (stored.records || stored.moves || stored.messages) ? [stored] : [];
}

function escape(s) {
  return foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s)) : String(s);
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
    if ( moved >= 5 ) lines.push(game.i18n.format("FASTFIGHTING.MakeItSo.Moves", { feet: moved }));
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
  return rows;
}

/** Ask the GM to confirm; returns true if they accept. */
export async function confirmMakeItSo(rows) {
  const changed = rows.filter(r => r.changed);
  const content = `<p>${loc("FASTFIGHTING.MakeItSo.Confirm")}</p>
    <ul class="ff-mis-list">${changed.map(r => `<li><strong>${escape(r.spec.name)}</strong>: ${r.lines.map(escape).join("; ")}</li>`).join("")}</ul>
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

/** Back off along the line from the token's spot until the path doesn't cross a wall. */
function respectWalls(tokenDoc, dest) {
  const token = tokenDoc.object;
  if ( !token ) return dest;
  const start = { x: tokenDoc.x, y: tokenDoc.y };
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

/** Nearest free grid spot to `dest` (spiral search), so tokens never end up stacked. */
function freeSpot(tokenDoc, dest, occupied) {
  const size = canvas.dimensions.size;
  const free = p => cellsOf(p.x, p.y, tokenDoc).every(c => !occupied.has(c));
  if ( free(dest) ) return dest;
  for ( let ring = 1; ring <= 6; ring++ ) {
    for ( let dx = -ring; dx <= ring; dx++ ) {
      for ( let dy = -ring; dy <= ring; dy++ ) {
        if ( Math.max(Math.abs(dx), Math.abs(dy)) !== ring ) continue;
        const p = clampToScene({ x: dest.x + dx * size, y: dest.y + dy * size }, tokenDoc);
        if ( free(p) && !tokenDoc.object?.checkCollision(centerOf(p, tokenDoc), { type: "move", mode: "any" }) ) return p;
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
    if ( !moving.has(t.id) && !t.hidden ) for ( const c of cellsOf(t.x, t.y, t) ) occupied.add(c);
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
    if ( dest.x !== doc.x || dest.y !== doc.y ) placements.push({ doc, x: dest.x, y: dest.y });
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
 * @param {{title: string, html: string}} [options.story]  The story to post
 */
export async function executeMakeItSo(rows, replay, { story = null } = {}) {
  if ( !game.user.isGM ) return [];
  const adapter = getAdapter();
  const options = { lootMode: setting("lootMode"), corpseMode: setting("corpseMode"), fledMode: setting("fledMode") };
  Hooks.callAll("fastFighting.preMakeItSo", { rows, replay, options, story });

  // 1. Movement
  const placements = planPlacements(rows);
  const moves = placements.map(p => ({ uuid: p.doc.uuid, x: p.doc.x, y: p.doc.y }));
  if ( placements.length ) {
    await canvas.scene.updateEmbeddedDocuments("Token", placements.map(p => ({ _id: p.doc.id, x: p.x, y: p.y })));
  }

  // 2. Outcomes
  const records = [];
  for ( const row of rows.filter(r => r.changed) ) {
    try {
      records.push(await adapter.commitOutcome(row.tokenDoc, row.spec, row.final, options));
    } catch ( err ) {
      console.error(`${MODULE_ID} | Make it So failed for ${row.spec.name}`, err);
      ui.notifications.error(game.i18n.format("FASTFIGHTING.MakeItSo.Failed", { name: row.spec.name }));
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
        const eventRecords = (await adapter.commitConcession(row.tokenDoc, to?.tokenDoc ?? null, c, { giver: row.spec, receiver: to?.spec ?? null })) ?? [];
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
        ui.notifications.error(game.i18n.format("FASTFIGHTING.MakeItSo.Failed", { name: row.spec.name }));
      }
      }
    }
  }

  // 4. The story
  if ( story?.html ) {
    const ChatMessage = foundry.documents.ChatMessage ?? globalThis.ChatMessage;
    const whisper = setting("storyMode") === "whisper" ? game.users.filter(u => u.isGM).map(u => u.id) : [];
    const message = await ChatMessage.create({
      content: `<div class="fast-fighting-story"><header><i class="fa-solid fa-book-open"></i> ${escape(story.title)}</header>${story.html}</div>`,
      speaker: { alias: loc("FASTFIGHTING.Story.Speaker") },
      whisper,
      flags: { [MODULE_ID]: { story: true } }
    });
    if ( message ) messages.push(message.id);
  }

  const stack = [{ time: Date.now(), records, moves, messages }, ...undoStack(canvas.scene)].slice(0, UNDO_DEPTH);
  await canvas.scene.update({ [`flags.${MODULE_ID}.==undo`]: { stack } });
  Hooks.callAll("fastFighting.makeItSo", records);
  return records;
}

export function hasUndo(scene = canvas.scene) {
  return undoStack(scene).length > 0;
}

/** Put one undo record back: created documents removed, deleted ones restored, changed values reset. */
async function revertRecord(r) {
  try {
    for ( const uuid of r.createdTokens ?? [] ) await (await fromUuid(uuid))?.delete();
    for ( const uuid of r.createdActors ?? [] ) await (await fromUuid(uuid))?.delete();
    for ( const t of r.deletedTokens ?? [] ) {
      const parent = await fromUuid(t.parentUuid);
      await parent?.createEmbeddedDocuments("Token", [t.data], { keepId: true });
    }
    const tokenDoc = r.tokenUuid ? await fromUuid(r.tokenUuid) : null;
    const actor = tokenDoc?.actor ?? await fromUuid(r.actorUuid);
    if ( !actor ) return;
    if ( r.createdItems?.length ) {
      const ids = r.createdItems.filter(id => actor.items.has(id));
      if ( ids.length ) await actor.deleteEmbeddedDocuments("Item", ids);
    }
    if ( r.deletedItems?.length ) await actor.createEmbeddedDocuments("Item", r.deletedItems, { keepId: true });
    for ( const { id, update } of r.itemUpdates ?? [] ) await actor.items.get(id)?.update(update);
    for ( const s of r.statuses ?? [] ) await actor.toggleStatusEffect(s.id, { active: s.active, overlay: s.overlay });
    if ( Object.keys(r.actorUpdate ?? {}).length ) await actor.update(r.actorUpdate);
    if ( r.tokenUpdate && tokenDoc ) await tokenDoc.update(r.tokenUpdate);
    if ( r.combatant ) await (await fromUuid(r.combatant.uuid))?.update({ defeated: r.combatant.defeated });
  } catch ( err ) {
    console.error(`${MODULE_ID} | undo failed for a record`, r, err);
  }
}

/* -------------------------------------------- */
/*  A PC's loss: one card, one undo             */
/* -------------------------------------------- */

/** The GM-only card for something a PC gave up, with an Undo for just that hand-over. */
async function concessionCard(giverName, receiverName, c, eventId, records) {
  const ChatMessage = foundry.documents.ChatMessage ?? globalThis.ChatMessage;
  const text = game.i18n.format(c.how === "theft" ? "FASTFIGHTING.Concession.CardTheft" : "FASTFIGHTING.Concession.Card", { giver: escape(giverName), what: escape(concessionText(c)), receiver: escape(receiverName ?? "") });
  const luckKey = c.how === "theft" ? "FASTFIGHTING.Concession.TheftLuck" : "FASTFIGHTING.Concession.Luck";
  const luck = c.luck ? `<p class="hint">${game.i18n.format(luckKey, { luck: c.luck })}</p>` : "";
  return ChatMessage.create({
    content: `<div class="fast-fighting-concession"><p>${text}</p>${luck}<button type="button" data-ff-undo-concession><i class="fa-solid fa-rotate-left"></i> ${loc("FASTFIGHTING.Concession.Undo")}</button></div>`,
    speaker: { alias: loc("FASTFIGHTING.Story.Speaker") },
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    flags: { [MODULE_ID]: { concession: { eventId, sceneId: canvas.scene.id, records, undone: false } } }
  });
}

/** Undo just one hand-over from its card, and take it out of the scene's Make it So undo so it isn't undone twice. */
export async function undoConcession(message) {
  if ( !game.user.isGM ) return false;
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
  const [undo, ...rest] = undoStack(scene);
  if ( !undo ) return false;
  for ( const id of undo.messages ?? [] ) await game.messages.get(id)?.delete();
  for ( const r of [...(undo.records ?? [])].reverse() ) await revertRecord(r);
  // Positions last, so tokens recreated above go back to where they started too.
  const back = [];
  for ( const m of undo.moves ?? [] ) {
    const doc = await fromUuid(m.uuid);
    if ( doc ) back.push({ _id: doc.id, x: m.x, y: m.y });
  }
  if ( back.length ) await scene.updateEmbeddedDocuments("Token", back);
  if ( rest.length ) await scene.update({ [`flags.${MODULE_ID}.==undo`]: { stack: rest } });
  else await scene.unsetFlag(MODULE_ID, "undo");
  return true;
}

export { STATUS };
