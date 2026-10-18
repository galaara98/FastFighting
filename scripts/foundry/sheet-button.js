/**
 * FastFighting on a character sheet's title bar, for a player who owns the character but can't open its Token or
 * Prototype Token (where a GM finds FastFighting's tab: token-tactics.js): it opens that character's own tactics, the
 * players' survey on its tab (as "My tactics" does). Only where the sheet has no token button of its own, and only for
 * a character the game system's helper reads.
 */
import { MODULE_ID } from "../constants.js";
import { getAdapter } from "../api.js";
import { localize } from "../i18n.js";
import { charactersForUser } from "./tactics.js";

/** Is FastFighting's button for this sheet: its owner, no GM, a character the helper reads, no token button there? */
export function wantsButton({ isGM = false, isOwner = false, handled = false, tokenButton = false } = {}) {
  return !isGM && isOwner && handled && !tokenButton;
}

/** The survey's tab for this sheet's character: its token on the scene (the sheet's own, else its actor's), or the actor's. */
export function surveyTabFor(characters, { tokenId = null, actorId = null } = {}) {
  return (tokenId ? characters.find(c => c.token?.id === tokenId) : null)
    ?? characters.find(c => c.actor?.id === actorId)
    ?? null;
}

/** Open the players' survey on this sheet's character. */
async function openFor(actor, token = null) {
  const { PlayerSurvey } = await import("../apps/player-survey.js");
  const tab = surveyTabFor(charactersForUser(canvas.scene, game.user), { tokenId: token?.id ?? null, actorId: actor?.id ?? null });
  return PlayerSurvey.open({ sceneId: canvas.scene?.id, ...(tab ? { start: tab.key } : {}) });
}

const handles = actor => {
  try {
    return !!getAdapter()?.canHandle?.(actor);
  } catch ( err ) {
    return false;
  }
};

/** The title bar's FastFighting button: v1 sheets (ActorSheet's header buttons) and v2 sheets (their header controls). */
export function registerSheetButton() {
  Hooks.on("getActorSheetHeaderButtons", (app, buttons) => {
    const actor = app.actor;
    const tokenButton = buttons.some(b => /configure-token/.test(b.class ?? ""));
    if ( !wantsButton({ isGM: game.user.isGM, isOwner: !!actor?.isOwner, handled: handles(actor), tokenButton }) ) return;
    buttons.unshift({
      label: localize("FASTFIGHTING.Survey.SheetButton"), class: `${MODULE_ID}-tactics`, icon: "fa-solid fa-clipboard-question",
      onclick: () => openFor(actor, app.token ?? null)
    });
  });
  Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    const actor = app.document instanceof Actor ? app.document : null;
    if ( !actor ) return;
    const tokenButton = controls.some(c => /token/i.test(c.action ?? ""));
    if ( !wantsButton({ isGM: game.user.isGM, isOwner: !!actor.isOwner, handled: handles(actor), tokenButton }) ) return;
    controls.unshift({
      icon: "fa-solid fa-clipboard-question", label: "FASTFIGHTING.Survey.SheetButton", action: `${MODULE_ID}-tactics`,
      onClick: () => openFor(actor, app.token ?? null)
    });
  });
}
