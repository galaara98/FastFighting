/**
 * "Make it So": commit one replayed fight to the tokens, with a confirmation step and a full Undo.
 */
import { MODULE_ID, STATUS } from "../constants.js";
import { getAdapter } from "../api.js";
import { setting } from "../settings.js";

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
    rows.push({ spec: c, final, tokenDoc, lines, changed: lines.length > 0 });
  }
  return rows;
}

function escape(s) {
  return foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s)) : String(s);
}

/** Ask the GM to confirm; returns true if they accept. */
export async function confirmMakeItSo(rows) {
  const changed = rows.filter(r => r.changed);
  const content = `<p>${game.i18n.localize("FASTFIGHTING.MakeItSo.Confirm")}</p>
    <ul class="ff-mis-list">${changed.map(r => `<li><strong>${escape(r.spec.name)}</strong>: ${r.lines.map(escape).join("; ")}</li>`).join("")}</ul>
    <p class="hint">${game.i18n.localize("FASTFIGHTING.MakeItSo.UndoHint")}</p>`;
  return foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("FASTFIGHTING.MakeItSo.Title"), icon: "fa-solid fa-gavel" },
    content,
    yes: { label: game.i18n.localize("FASTFIGHTING.MakeItSo.Button"), icon: "fa-solid fa-gavel" },
    no: { label: game.i18n.localize("Cancel") },
    position: { width: 560 }
  });
}

/** Commit the plan. Stores undo records on the scene and posts a GM-whispered summary. */
export async function executeMakeItSo(rows, replay) {
  const adapter = getAdapter();
  const options = { lootMode: setting("lootMode"), corpseMode: setting("corpseMode"), fledMode: setting("fledMode") };
  Hooks.callAll("fastFighting.preMakeItSo", { rows, replay, options });
  const records = [];
  for ( const row of rows.filter(r => r.changed) ) {
    try {
      records.push(await adapter.commitOutcome(row.tokenDoc, row.spec, row.final, options));
    } catch ( err ) {
      console.error(`${MODULE_ID} | Make it So failed for ${row.spec.name}`, err);
      ui.notifications.error(game.i18n.format("FASTFIGHTING.MakeItSo.Failed", { name: row.spec.name }));
    }
  }
  await canvas.scene.setFlag(MODULE_ID, "undo", { time: Date.now(), records });
  Hooks.callAll("fastFighting.makeItSo", records);

  const ChatMessage = foundry.documents.ChatMessage ?? globalThis.ChatMessage;
  const summary = rows.filter(r => r.changed).map(r => `<li><strong>${escape(r.spec.name)}</strong>: ${r.lines.map(escape).join("; ")}</li>`).join("");
  const narrative = (replay.log ?? []).slice(-12).map(e => `<li>R${e.round} ${escape(e.actor)} ${escape(e.text)}</li>`).join("");
  await ChatMessage.create({
    content: `<div class="fast-fighting-report"><header><i class="fa-solid fa-gavel"></i> ${game.i18n.localize("FASTFIGHTING.MakeItSo.ChatTitle")}</header><ul>${summary}</ul><details><summary>${game.i18n.localize("FASTFIGHTING.MakeItSo.LastMoments")}</summary><ol>${narrative}</ol></details></div>`,
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    speaker: { alias: "FastFighting" }
  });
  return records;
}

export function hasUndo(scene = canvas.scene) {
  return !!scene?.getFlag(MODULE_ID, "undo")?.records?.length;
}

/** Revert the last Make it So on this scene. */
export async function undoMakeItSo(scene = canvas.scene) {
  const undo = scene.getFlag(MODULE_ID, "undo");
  if ( !undo?.records?.length ) return false;
  for ( const r of [...undo.records].reverse() ) {
    try {
      for ( const uuid of r.createdTokens ?? [] ) await (await fromUuid(uuid))?.delete();
      for ( const uuid of r.createdActors ?? [] ) await (await fromUuid(uuid))?.delete();
      for ( const t of r.deletedTokens ?? [] ) {
        const parent = await fromUuid(t.parentUuid);
        await parent?.createEmbeddedDocuments("Token", [t.data], { keepId: true });
      }
      const tokenDoc = await fromUuid(r.tokenUuid);
      const actor = tokenDoc?.actor ?? await fromUuid(r.actorUuid);
      if ( !actor ) continue;
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
  await scene.unsetFlag(MODULE_ID, "undo");
  return true;
}

export { STATUS };
