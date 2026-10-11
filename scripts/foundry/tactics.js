/**
 * Tactics questionnaire glue: stored answers on actors, the question list for templates, player survey status,
 * and the socket message that opens surveys on players' screens.
 *
 * Storage
 *  - Actor flag `fast-fighting.tactics.<key>`: one field per answer, written individually so two players
 *    sharing a token can edit different questions at the same time without overwriting each other.
 *    Also `playstyles` (up to four ids), `stayTrue`, `roleplay` and `alwaysTalk` (booleans).
 *  - User flag `fast-fighting.survey`: {status, sceneId, requestId, updated} for the GM's status indicators.
 */
import { MODULE_ID } from "../constants.js";
import { TACTIC_CHOICES, TACTIC_KEYS, suggestTactics, resolveTactics } from "../engine/tactics.js";
import { PLAYSTYLES, PLAYSTYLE_IDS, MAX_PLAYSTYLES, combinePlaystyles } from "../engine/playstyles.js";
import { getAdapter } from "../api.js";
import { DESIRE_KINDS, DESIRE_BAND_KEYS } from "../engine/behavior/desire.js";
import { setting } from "../settings.js";

export const SOCKET = `module.${MODULE_ID}`;
export const SURVEY_STATUS = Object.freeze({ NONE: "none", REQUESTED: "requested", ENTERING: "entering", CLOSED: "closed", DONE: "done" });

const loc = key => game.i18n.localize(key);

const META_KEYS = ["stayTrue", "roleplay", "alwaysTalk", "avoidConsumables", "avoidCostlySpells", "neverKill"];
/** Stated desires: three slots, each "what, at whom, how badly". */
const DESIRE_SLOTS = ["d0", "d1", "d2"];
const DESIRE_KEY = /^desire\.(d[0-2])\.(kind|target|level)$/;
/** The level a band stands for (its middle). */
export const DESIRE_LEVELS = Object.freeze({ passing: 10, wants: 30, determined: 50, driven: 70, obsessed: 90 });

function cleanDesire(raw) {
  if ( !isPlain(raw) ) return null;
  const out = {};
  if ( raw.kind === "" || DESIRE_KINDS.includes(raw.kind) ) out.kind = raw.kind;
  if ( typeof raw.target === "string" && raw.target.length <= 64 ) out.target = raw.target;
  const level = Number(raw.level);
  if ( Number.isFinite(level) ) out.level = Math.max(0, Math.min(100, Math.round(level)));
  return out;
}
const MAX_NOTES = 2000;
const isPlain = v => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Keep only answers the survey could have produced. Players own these flags and can write anything to them
 * from the console, so nothing unexpected (an unknown choice, a fifth playstyle, a non-array) reaches the planner.
 */
export function sanitizeTactics(raw) {
  const out = {};
  if ( !isPlain(raw) ) return out;
  for ( const [key, choices] of Object.entries(TACTIC_CHOICES) ) {
    const v = raw[key];
    if ( v === "auto" || choices.includes(v) ) out[key] = v;
  }
  if ( typeof raw.preferredAction === "string" ) out.preferredAction = raw.preferredAction.slice(0, MAX_NOTES);
  if ( typeof raw.notes === "string" ) out.notes = raw.notes.slice(0, MAX_NOTES);
  if ( Array.isArray(raw.playstyles) ) {
    out.playstyles = [...new Set(raw.playstyles.filter(id => typeof id === "string" && PLAYSTYLES[id]))].slice(0, MAX_PLAYSTYLES);
  }
  for ( const key of META_KEYS ) if ( key in raw ) out[key] = raw[key] === true;
  if ( isPlain(raw.desires) ) {
    out.desires = {};
    for ( const slot of DESIRE_SLOTS ) {
      const d = cleanDesire(raw.desires[slot]);
      if ( d ) out.desires[slot] = d;
    }
  }
  return out;
}

/** The desires a character's Tactics state, for the engine: [{kind, targetId, level}]. */
export function statedDesires(stored) {
  return Object.values(stored?.desires ?? {})
    .filter(d => d.kind && d.target)
    .map(d => ({ kind: d.kind, targetId: d.target, level: d.level ?? DESIRE_LEVELS.determined }));
}

/** Stored answers, migrating the older `disposition` flag. */
export function getStoredTactics(actor) {
  if ( !actor ) return {};
  const old = actor.getFlag(MODULE_ID, "disposition");
  const current = actor.getFlag(MODULE_ID, "tactics");
  return sanitizeTactics({ ...(isPlain(old) ? old : {}), ...(isPlain(current) ? current : {}) });
}

export async function setTactic(actor, key, value) {
  const desire = DESIRE_KEY.exec(key ?? "");
  if ( actor && desire ) {
    const [, slot, field] = desire;
    const clean = cleanDesire({ [field]: field === "level" ? Number(value) : value });
    if ( !clean || !(field in clean) ) return;
    await actor.update({ [`flags.${MODULE_ID}.tactics.desires.${slot}.${field}`]: clean[field] });
    return;
  }
  if ( !actor || !(TACTIC_KEYS.includes(key) || META_KEYS.includes(key)) ) return;
  const clean = sanitizeTactics({ [key]: value });
  if ( !(key in clean) ) return;
  await actor.update({ [`flags.${MODULE_ID}.tactics.${key}`]: clean[key] });
}

/**
 * Toggle a playstyle pill. Returns false (and changes nothing) when it would exceed the limit.
 * The whole list is written at once; the order is the order they were picked (first wins conflicts).
 */
export async function togglePlaystyle(actor, id) {
  if ( !actor || !PLAYSTYLES[id] ) return false;
  const current = [...(getStoredTactics(actor).playstyles ?? [])];
  const i = current.indexOf(id);
  if ( i >= 0 ) current.splice(i, 1);
  else {
    if ( current.length >= MAX_PLAYSTYLES ) return false;
    current.push(id);
  }
  await actor.update({ [`flags.${MODULE_ID}.tactics.playstyles`]: current });
  return true;
}

export function worldTacticDefaults() {
  return { healAggro: setting("pcHealAggro"), allyDying: setting("pcAllyDying") };
}

/**
 * Effective tactics for a spec + actor.
 *   calc       what the stats and calculated tactical level say (no playstyles)
 *   suggested  calc adjusted by playstyles: what "Let them decide" means for this character
 *   resolved   stored answers over suggested
 */
export function tacticsFor(actor, spec) {
  const stored = getStoredTactics(actor);
  const playstyles = combinePlaystyles(stored.playstyles ?? [], { stayTrue: !!stored.stayTrue, roleplay: !!stored.roleplay });
  const calc = suggestTactics(spec, worldTacticDefaults(), getAdapter()?.rules ?? null);
  const suggested = { ...calc, ...playstyles.suggest };
  const resolved = resolveTactics(stored, suggested);
  if ( resolved.preferredAction && !spec.actions.some(a => a.id === resolved.preferredAction) ) resolved.preferredAction = calc.preferredAction;
  return { calc, suggested, stored, resolved, playstyles };
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

/** Compact fingerprint of what changes "Let them decide" (playstyles and the two checkboxes). */
export function playstyleSignature(actor) {
  const t = getStoredTactics(actor);
  return JSON.stringify([t.playstyles ?? [], !!t.stayTrue, !!t.roleplay, !!t.alwaysTalk, !!t.avoidConsumables, !!t.avoidCostlySpells, !!t.neverKill]);
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
 * @param {object} [options]
 * @param {boolean} [options.questions=true]  Include the tactics questions (NPC rows show only playstyles)
 * @param {{id: string, name: string}[]} [options.targets]  Who a desire can be about (tokens on the scene)
 */
export function questionsContext(spec, actor, uid, { questions: withQuestions = true, targets = [] } = {}) {
  const { suggested, stored, playstyles } = tacticsFor(actor, spec);
  const sourceOf = key => playstyles.ids.find(id => PLAYSTYLES[id].suggest[key] === suggested[key] && PLAYSTYLES[id].suggest[key] !== undefined);
  const name = spec.name;
  const offense = [];
  const seen = new Set();
  for ( const a of spec.actions ) {
    if ( a.kind === "heal" || a.kind === "buff" || seen.has(a.name) ) continue;
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
    if ( !v ) return "";
    const source = sourceOf(key);
    return source ? `${choiceLabel(key, v)} (${loc(`FASTFIGHTING.Playstyle.${source}.Name`)})` : choiceLabel(key, v);
  };

  const questions = [];
  const add = (key, values, { show = true } = {}) => {
    if ( !show || !withQuestions ) return;
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
  add("talk", TACTIC_CHOICES.talk, { show: (spec.social?.languages?.length ?? 0) > 0 && !spec.social?.mindless });
  add("healAggro", TACTIC_CHOICES.healAggro, { show: heals.some(a => !a.selfOnly) });
  add("potionThreshold", TACTIC_CHOICES.potionThreshold, { show: hasPotions });
  add("allyDying", TACTIC_CHOICES.allyDying);
  add("selfRevived", TACTIC_CHOICES.selfRevived);
  add("retreat", TACTIC_CHOICES.retreat);
  add("shield", TACTIC_CHOICES.shield, { show: !!spec.shield });
  add("beyond", TACTIC_CHOICES.beyond);

  const picked = playstyles.ids;
  // What the character wants, at whom, how badly (any character, PC or NPC). Three goblins read "Goblin 1, 2, 3".
  const counts = new Map();
  for ( const t of targets ) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
  const numbered = new Map();
  const others = targets.map(t => {
    if ( counts.get(t.name) < 2 ) return t;
    numbered.set(t.name, (numbered.get(t.name) ?? 0) + 1);
    return { ...t, name: `${t.name} ${numbered.get(t.name)}` };
  }).filter(t => t.id !== (spec.tokenId ?? spec.id));
  // Healing, bolstering and talking only for those who can (anyone can want to hurt, guard or avoid someone).
  const canDo = {
    heal: heals.length > 0,
    aid: spec.actions.some(a => a.kind === "buff" && !a.tell), // (Dodge and the like are moves, not bolstering)
    talk: (spec.social?.languages?.length ?? 0) > 0 && !spec.social?.mindless
  };
  const desires = DESIRE_SLOTS.map(slot => {
    const d = stored.desires?.[slot] ?? {};
    const kinds = DESIRE_KINDS.filter(k => canDo[k] !== false || d.kind === k);
    const level = d.level ?? DESIRE_LEVELS.determined;
    const band = Object.entries(DESIRE_LEVELS).reduce((best, [k, v]) => (Math.abs(v - level) < Math.abs(DESIRE_LEVELS[best] - level) ? k : best), "determined");
    return {
      kind: { key: `desire.${slot}.kind`, name: `tactic-${uid}-desire-${slot}-kind`, choices: ["", ...kinds].map(k => ({ value: k, label: loc(`FASTFIGHTING.Desire.Kind.${k || "none"}`), selected: (d.kind ?? "") === k })) },
      target: { key: `desire.${slot}.target`, name: `tactic-${uid}-desire-${slot}-target`, choices: [{ value: "", label: loc("FASTFIGHTING.Desire.Who"), selected: !d.target }, ...others.map(t => ({ value: t.id, label: t.name, selected: d.target === t.id }))] },
      level: { key: `desire.${slot}.level`, name: `tactic-${uid}-desire-${slot}-level`, choices: DESIRE_BAND_KEYS.map(k => ({ value: DESIRE_LEVELS[k], label: loc(`FASTFIGHTING.Desire.Level.${k}`), selected: band === k })) },
      empty: !d.kind
    };
  });
  return {
    uid,
    actorUuid: actor.uuid,
    withQuestions,
    questions,
    desires,
    notes: withQuestions ? { name: `tactic-${uid}-notes`, value: stored.notes ?? "", label: loc("FASTFIGHTING.Tactics.notes.Label"), placeholder: loc("FASTFIGHTING.Tactics.notes.Hint") } : null,
    playstyles: PLAYSTYLE_IDS.map(id => ({
      id,
      icon: PLAYSTYLES[id].icon,
      label: loc(`FASTFIGHTING.Playstyle.${id}.Name`),
      hint: loc(`FASTFIGHTING.Playstyle.${id}.Hint`),
      active: picked.includes(id),
      order: picked.indexOf(id) + 1,
      disabled: !picked.includes(id) && picked.length >= MAX_PLAYSTYLES
    })),
    playstyleCount: game.i18n.format("FASTFIGHTING.Playstyle.Count", { n: picked.length, max: MAX_PLAYSTYLES }),
    stayTrue: { name: `tactic-${uid}-stayTrue`, checked: !!stored.stayTrue },
    roleplay: { name: `tactic-${uid}-roleplay`, checked: !!stored.roleplay },
    alwaysTalk: { name: `tactic-${uid}-alwaysTalk`, checked: !!stored.alwaysTalk, show: (spec.social?.languages?.length ?? 0) > 0 && !spec.social?.mindless },
    avoidConsumables: { name: `tactic-${uid}-avoidConsumables`, checked: !!stored.avoidConsumables, show: spec.actions.some(a => /^item:/.test(a.resource ?? "")) },
    avoidCostlySpells: { name: `tactic-${uid}-avoidCostlySpells`, checked: !!stored.avoidCostlySpells, show: spec.actions.some(a => ((a.rank ?? 0) > 0 || a.spellId) && (a.resource || Number.isFinite(a.uses))) },
    neverKill: { name: `tactic-${uid}-neverKill`, checked: !!stored.neverKill },
    conflict: !!stored.stayTrue && !!stored.roleplay
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
  const picked = stored.playstyles ?? [];
  for ( const box of root.querySelectorAll(`.ff-pills[data-actor-uuid="${actor.uuid}"]`) ) {
    let changed = false;
    for ( const pill of box.querySelectorAll("[data-playstyle]") ) {
      const on = picked.includes(pill.dataset.playstyle);
      if ( pill.classList.contains("active") !== on ) changed = true;
      pill.classList.toggle("active", on);
      pill.setAttribute("aria-pressed", String(on));
      pill.disabled = !on && picked.length >= MAX_PLAYSTYLES;
      const order = pill.querySelector(".ff-pill-order");
      if ( order ) order.textContent = on ? String(picked.indexOf(pill.dataset.playstyle) + 1) : "";
    }
    const count = box.closest(".ff-playstyles")?.querySelector(".ff-pill-count");
    if ( count ) count.textContent = game.i18n.format("FASTFIGHTING.Playstyle.Count", { n: picked.length, max: MAX_PLAYSTYLES });
    if ( changed ) { box.classList.remove("ff-synced"); void box.offsetWidth; box.classList.add("ff-synced"); }
  }
  for ( const cb of root.querySelectorAll(`input[type=checkbox][data-tactic][data-actor-uuid="${actor.uuid}"]`) ) {
    const on = !!stored[cb.dataset.tactic];
    if ( cb.checked !== on && cb !== document.activeElement ) cb.checked = on;
  }
  for ( const el of root.querySelectorAll(`select[data-tactic][data-actor-uuid="${actor.uuid}"], textarea[data-tactic][data-actor-uuid="${actor.uuid}"]`) ) {
    const key = el.dataset.tactic;
    const desire = DESIRE_KEY.exec(key);
    const value = desire ? (stored.desires?.[desire[1]]?.[desire[2]] ?? (desire[2] === "level" ? DESIRE_LEVELS.determined : ""))
      : (stored[key] ?? (key === "notes" ? "" : "auto"));
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
  const userIds = users.map(u => u.id);
  game.socket.emit(SOCKET, { action: "openSurvey", userIds, sceneId: scene.id, requestId }, { recipients: userIds });
}
