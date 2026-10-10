/**
 * Tactics questionnaire glue: stored answers on actors, the question list for templates, player survey status,
 * and the socket message that opens surveys on players' screens.
 *
 * Storage
 *  - Actor flag `fast-fighting.tactics.<key>`: one field per answer, written individually so two players
 *    sharing a token can edit different questions at the same time without overwriting each other.
 *  - User flag `fast-fighting.survey`: {status, sceneId, requestId, updated} for the GM's status indicators.
 */
import { MODULE_ID } from "../constants.js";
import { TACTIC_CHOICES, TACTIC_KEYS, suggestTactics, resolveTactics } from "../engine/tactics.js";
import { getAdapter } from "../api.js";
import { setting } from "../settings.js";

export const SOCKET = `module.${MODULE_ID}`;
export const SURVEY_STATUS = Object.freeze({ NONE: "none", REQUESTED: "requested", ENTERING: "entering", CLOSED: "closed", DONE: "done" });

const loc = key => game.i18n.localize(key);

/** Stored answers, migrating the older `disposition` flag. */
export function getStoredTactics(actor) {
  if ( !actor ) return {};
  const old = actor.getFlag(MODULE_ID, "disposition") ?? {};
  return { ...old, ...(actor.getFlag(MODULE_ID, "tactics") ?? {}) };
}

export async function setTactic(actor, key, value) {
  if ( !actor || !TACTIC_KEYS.includes(key) ) return;
  await actor.update({ [`flags.${MODULE_ID}.tactics.${key}`]: value });
}

export function worldTacticDefaults() {
  return { healAggro: setting("pcHealAggro"), allyDying: setting("pcAllyDying") };
}

/** Effective tactics for a spec + actor: stored answers over "what the character would probably do". */
export function tacticsFor(actor, spec) {
  const suggested = suggestTactics(spec, worldTacticDefaults());
  const stored = getStoredTactics(actor);
  const resolved = resolveTactics(stored, suggested);
  if ( resolved.preferredAction && !spec.actions.some(a => a.id === resolved.preferredAction) ) resolved.preferredAction = suggested.preferredAction;
  return { suggested, stored, resolved };
}

/** Tokens a user controls (owns) on a scene that the active adapter can simulate. */
export function tokensForUser(scene, user) {
  const adapter = getAdapter();
  if ( !scene || !adapter ) return [];
  return scene.tokens.filter(t => t.actor && adapter.canHandle(t.actor) && t.actor.testUserPermission(user, "OWNER"));
}

/** Non-GM users who control at least one token on the scene. */
export function playersOnScene(scene) {
  return game.users.filter(u => !u.isGM && tokensForUser(scene, u).length);
}

/** Should the GM planner show the questionnaire for this token? */
export function isPlayerControlled(spec, actor) {
  return spec.kind === "pc" || !!actor?.hasPlayerOwner;
}

/* -------------------------------------------- */
/*  Question view-model                         */
/* -------------------------------------------- */

function actionLabel(a) {
  const kind = loc(`FASTFIGHTING.Tactics.ActionKind.${a.kind}`);
  const extra = a.range && !a.melee ? ` · ${a.range.increment} ft` : "";
  return `${a.name} (${kind}${extra})`;
}

/**
 * Build the template context for one actor's questionnaire.
 * @param {object} spec   CombatantSpec
 * @param {Actor} actor
 * @param {string} uid    Unique suffix for input names in this form
 */
export function questionsContext(spec, actor, uid) {
  const { suggested, stored } = tacticsFor(actor, spec);
  const name = spec.name;
  const offense = [];
  const seen = new Set();
  for ( const a of spec.actions ) {
    if ( a.kind === "heal" || seen.has(a.name) ) continue;
    seen.add(a.name);
    offense.push(a);
  }
  const heals = spec.actions.filter(a => a.kind === "heal");
  const hasPotions = heals.some(a => a.selfOnly);
  const hasLimited = spec.actions.some(a => a.kind !== "heal" && (a.resource || Number.isFinite(a.uses)));

  const choiceLabel = (key, v) => loc(`FASTFIGHTING.Tactics.${key}.${v}`);
  const suggestionLabel = key => {
    const v = suggested[key];
    if ( key === "preferredAction" ) return spec.actions.find(a => a.id === v)?.name ?? loc("FASTFIGHTING.Tactics.BestAvailable");
    return v ? choiceLabel(key, v) : "";
  };

  const questions = [];
  const add = (key, values, { show = true } = {}) => {
    if ( !show ) return;
    const value = stored[key] ?? "auto";
    const choices = [{ value: "auto", label: game.i18n.format("FASTFIGHTING.Tactics.Auto", { name, choice: suggestionLabel(key) }), selected: value === "auto" || value === "" }];
    for ( const v of values ) {
      const isObj = typeof v === "object";
      const val = isObj ? v.value : v;
      choices.push({ value: val, label: isObj ? v.label : choiceLabel(key, val), selected: value === val });
    }
    questions.push({
      key,
      name: `tactic-${uid}-${key}`,
      label: loc(`FASTFIGHTING.Tactics.${key}.Label`),
      hint: loc(`FASTFIGHTING.Tactics.${key}.Hint`),
      choices,
      isAuto: value === "auto" || value === "",
      value
    });
  };

  add("preferredAction", offense.map(a => ({ value: a.id, label: actionLabel(a) })), { show: offense.length > 1 });
  add("style", TACTIC_CHOICES.style);
  add("target", TACTIC_CHOICES.target);
  add("resourceUse", TACTIC_CHOICES.resourceUse, { show: hasLimited });
  add("healAggro", TACTIC_CHOICES.healAggro, { show: heals.some(a => !a.selfOnly) });
  add("potionThreshold", TACTIC_CHOICES.potionThreshold, { show: hasPotions });
  add("allyDying", TACTIC_CHOICES.allyDying);
  add("selfRevived", TACTIC_CHOICES.selfRevived);
  add("retreat", TACTIC_CHOICES.retreat);
  add("shield", TACTIC_CHOICES.shield, { show: !!spec.shield });

  return {
    uid,
    actorUuid: actor.uuid,
    questions,
    notes: { name: `tactic-${uid}-notes`, value: stored.notes ?? "", label: loc("FASTFIGHTING.Tactics.notes.Label"), placeholder: loc("FASTFIGHTING.Tactics.notes.Hint") }
  };
}

/**
 * Patch open questionnaires in place after an actor's answers change (so whoever is typing keeps focus).
 * @param {HTMLElement} root
 * @param {Actor} actor
 */
export function syncTacticsDom(root, actor) {
  if ( !root || !actor ) return;
  const stored = getStoredTactics(actor);
  for ( const el of root.querySelectorAll(`[data-tactic][data-actor-uuid="${actor.uuid}"]`) ) {
    const key = el.dataset.tactic;
    const value = stored[key] ?? (key === "notes" ? "" : "auto");
    if ( el === document.activeElement || el.value === String(value) ) continue;
    el.value = value;
    const q = el.closest(".ff-q");
    q?.classList.toggle("is-auto", value === "auto");
    q?.classList.remove("ff-synced");
    void q?.offsetWidth;
    q?.classList.add("ff-synced");
  }
}

/* -------------------------------------------- */
/*  Survey status and requests                  */
/* -------------------------------------------- */

export function surveyStatus(user, scene = canvas.scene) {
  const s = user.getFlag(MODULE_ID, "survey");
  if ( !s || s.sceneId !== scene?.id ) return { status: SURVEY_STATUS.NONE };
  return s;
}

export async function setOwnSurveyStatus(status, sceneId, requestId) {
  const current = game.user.getFlag(MODULE_ID, "survey") ?? {};
  await game.user.setFlag(MODULE_ID, "survey", { ...current, status, sceneId: sceneId ?? current.sceneId, requestId: requestId ?? current.requestId, updated: Date.now() });
}

/** GM: ask some (or all) players on the scene to fill in their survey. */
export async function requestSurveys(users, scene = canvas.scene) {
  if ( !game.user.isGM || !scene ) return;
  const requestId = foundry.utils.randomID();
  for ( const user of users ) {
    await user.setFlag(MODULE_ID, "survey", { status: SURVEY_STATUS.REQUESTED, sceneId: scene.id, requestId, updated: Date.now() });
  }
  game.socket.emit(SOCKET, { action: "openSurvey", userIds: users.map(u => u.id), sceneId: scene.id, requestId });
}
