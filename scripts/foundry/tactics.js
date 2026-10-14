/**
 * Tactics questionnaire glue: stored answers on actors, the question list for templates, player survey status,
 * and the socket message that opens surveys on players' screens.
 *
 * Storage
 *  - Actor flag `fast-fighting.tactics.<key>`: one field per answer, written individually so two players
 *    sharing a token can edit different questions at the same time without overwriting each other.
 *    Also `playstyles` (up to four ids), `stayTrue`, `roleplay` and `avoidCostlySpells` (booleans). (An older sheet's
 *    `avoidConsumables` box is its answer to Consumables: avoid.)
 *    Older tick-boxes read as answers while their question is unanswered: `alwaysTalk` (talk "always"), `avoidKilling` or
 *    `neverKill` (target "avoidKilling"), `avoidFleeing` (retreat "never"); answering the question sets them aside.
 *    And `offer` and `expect`: what it brings to a standoff, and what it wants out of it (foundry/motives.js).
 *  - User flag `fast-fighting.survey`: {status, sceneId, requestId, updated} for the GM's status indicators.
 */
import { MODULE_ID, TRAITS, clamp, fudged, traitBand } from "../constants.js";
import { TACTIC_CHOICES, TACTIC_KEYS, suggestTactics, resolveTactics } from "../engine/tactics.js";
import { isSpecial } from "../engine/behavior/specialty.js";
import { PLAYSTYLES, PLAYSTYLE_IDS, MAX_PLAYSTYLES, RENAMED_PLAYSTYLES, combinePlaystyles, isPlaystyle, answerChances } from "../engine/playstyles.js";
import { getAdapter } from "../api.js";
import { DESIRE_KINDS, DESIRE_BAND_KEYS } from "../engine/behavior/desire.js";
import { setting } from "../settings.js";
import { distanceText, localize, listItems, language, brief } from "../i18n.js";
import { signedNumber } from "../engine/trait-parts.js";
import { cleanMotive, cleanMotiveField, MOTIVE_KEY, motivesContext, NO_CATALOG, suggestMotives } from "./motives.js";
import { autoRecord, validLet, validMotive } from "./auto-config.js";

export const SOCKET = `module.${MODULE_ID}`;
export const SURVEY_STATUS = Object.freeze({ NONE: "none", REQUESTED: "requested", ENTERING: "entering", CLOSED: "closed", DONE: "done" });

const loc = key => localize(key);

const META_KEYS = ["stayTrue", "roleplay", "avoidCostlySpells"];
/** Stated desires: three slots, each "what, at whom, how badly". */
const DESIRE_SLOTS = ["d0", "d1", "d2"];
const DESIRE_KEY = /^desire\.(d[0-2])\.(kind|target|level)$/;
/** A reaction's choice (always use it, ask its player, never), by the reaction's own key; a reroll setting. */
const REACTION_KEY = /^reactions\.([\w-]+)$/;
const REROLL_KEY = /^rerolls\.(self|team)$/;
export const REACTION_CHOICES = Object.freeze(["ask", "always", "never"]);
/** A reaction's key, the same fight after fight: its id without the actor's in front (PF2e "shield-block"). */
export const reactionKey = id => String(id ?? "").split(".").pop();
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
const MAX_ACTION_ID = 2000;
/** The tick-boxes that became answers, by the question that took each over. */
const LEGACY = Object.freeze({ talk: ["alwaysTalk"], target: ["avoidKilling", "neverKill"], retreat: ["avoidFleeing"] });
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
  if ( typeof raw.preferredAction === "string" ) out.preferredAction = raw.preferredAction.slice(0, MAX_ACTION_ID);
  if ( Array.isArray(raw.playstyles) ) {
    const current = id => (Object.hasOwn(RENAMED_PLAYSTYLES, id) ? RENAMED_PLAYSTYLES[id] : id);
    out.playstyles = [...new Set(raw.playstyles.filter(id => typeof id === "string").map(current).filter(isPlaystyle))].slice(0, MAX_PLAYSTYLES);
  }
  for ( const key of META_KEYS ) if ( key in raw ) out[key] = raw[key] === true;
  // The tick-boxes that became answers: "always prefers talking" talks always (unless hurt); "I avoid killing" (once
  // "I never kill") is an answer to who it goes for; "I don't like to flee", where it hadn't said when to retreat, never
  // retreats.
  const unanswered = key => [undefined, "auto", ""].includes(out[key]);
  if ( raw.alwaysTalk === true && unanswered("talk") ) out.talk = "always";
  if ( (raw.avoidKilling === true || raw.neverKill === true) && unanswered("target") ) out.target = "avoidKilling";
  if ( raw.avoidFleeing === true && unanswered("retreat") ) out.retreat = "never";
  if ( raw.avoidConsumables === true && unanswered("consumables") ) out.consumables = "avoid";
  // What it brings to a standoff, and what it wants out of it (checked against what it has when a battle is built).
  for ( const which of ["offer", "expect"] ) {
    const m = cleanMotive(which, raw[which]);
    if ( m && Object.keys(m).length ) out[which] = m;
  }
  if ( isPlain(raw.reactions) ) {
    const r = Object.fromEntries(Object.entries(raw.reactions).filter(([k, v]) => /^[\w-]+$/.test(k) && REACTION_CHOICES.includes(v)));
    if ( Object.keys(r).length ) out.reactions = r;
  }
  if ( isPlain(raw.rerolls) ) out.rerolls = { self: raw.rerolls.self === true, team: raw.rerolls.team === true };
  if ( isPlain(raw.desires) ) {
    out.desires = {};
    for ( const slot of DESIRE_SLOTS ) {
      const d = cleanDesire(raw.desires[slot]);
      if ( d ) out.desires[slot] = d;
    }
  }
  return out;
}

/**
 * What a character could want of someone: anyone can want to hurt, guard or keep away from someone; to heal or bolster
 * someone, only one who can, and to talk to someone or be bolstered by a friend, one who can make itself understood.
 */
export function desireKindsFor(spec) {
  const actions = spec?.actions ?? [];
  const speaks = (spec?.social?.languages?.length ?? 0) > 0 && !spec?.social?.mindless;
  const canDo = {
    heal: actions.some(a => a.kind === "heal"),
    aid: actions.some(a => a.kind === "buff" && !a.tell), // (Dodge and the like are moves, not bolstering)
    talk: speaks,
    bolstered: speaks
  };
  return DESIRE_KINDS.filter(k => canDo[k] !== false);
}

/** A desire's level as the survey has it: the nearest of its bands. */
const bandLevel = level => Object.values(DESIRE_LEVELS).reduce((best, v) => (Math.abs(v - level) < Math.abs(best - level) ? v : best), DESIRE_LEVELS.determined);

/**
 * The desires a character's Tactics state, for the engine: [{kind, targetId, level}]. With its spec, only what the
 * survey would offer it (a kind it could want, a level of one of the bands), whatever was written to the flag.
 */
export function statedDesires(stored, spec = null) {
  const kinds = spec ? new Set(desireKindsFor(spec)) : null;
  return Object.values(stored?.desires ?? {})
    .filter(d => d.kind && d.target && (!kinds || kinds.has(d.kind)))
    .map(d => ({ kind: d.kind, targetId: d.target, level: bandLevel(Number(d.level ?? DESIRE_LEVELS.determined)) }));
}

/** Stored answers, migrating the older `disposition` flag. */
export function getStoredTactics(actor) {
  if ( !actor ) return {};
  const old = actor.getFlag(MODULE_ID, "disposition");
  const current = actor.getFlag(MODULE_ID, "tactics");
  return sanitizeTactics({ ...(isPlain(old) ? old : {}), ...(isPlain(current) ? current : {}) });
}

export async function setTactic(actor, key, value) {
  const motive = MOTIVE_KEY.exec(key ?? "");
  if ( actor && motive ) {
    const [, which, field] = motive;
    const clean = cleanMotiveField(which, field, value);
    if ( clean === null ) return;
    await actor.update({ [`flags.${MODULE_ID}.tactics.${which}.${field}`]: clean });
    return;
  }
  const reaction = REACTION_KEY.exec(key ?? "");
  if ( actor && reaction ) {
    if ( !REACTION_CHOICES.includes(value) ) return;
    await actor.update({ [`flags.${MODULE_ID}.tactics.reactions.${reaction[1]}`]: value });
    return;
  }
  const reroll = REROLL_KEY.exec(key ?? "");
  if ( actor && reroll ) {
    await actor.update({ [`flags.${MODULE_ID}.tactics.rerolls.${reroll[1]}`]: value === true });
    return;
  }
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
  // (An older tick-box this question took over is set aside once the question is answered.)
  const stored = actor.getFlag(MODULE_ID, "tactics") ?? {};
  const aside = Object.fromEntries((LEGACY[key] ?? []).filter(k => stored[k] === true).map(k => [`flags.${MODULE_ID}.tactics.${k}`, false]));
  await actor.update({ [`flags.${MODULE_ID}.tactics.${key}`]: clean[key], ...aside });
}

/**
 * Toggle a playstyle pill. Returns false (and changes nothing) when it would exceed the limit.
 * The whole list is written at once; the order is the order they were picked (first wins conflicts).
 */
export async function togglePlaystyle(actor, id) {
  if ( !actor || !isPlaystyle(id) ) return false;
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
 *   calc       what "Let this character decide" stands for before its playstyles: its calculated answers as its auto
 *              setup stored them (its system's, where its helper had one: foundry/auto-config.js), else worked out now;
 *              with what it offers and expects (calc.offer, calc.expect)
 *   why        a system's reason for a calculated answer ({key: reason})
 *   suggested  calc adjusted by playstyles: what "Let this character decide" means for this character
 *   resolved   stored answers over suggested
 */
export function tacticsFor(actor, spec) {
  const stored = getStoredTactics(actor);
  const playstyles = combinePlaystyles(stored.playstyles ?? [], { stayTrue: !!stored.stayTrue, roleplay: !!stored.roleplay });
  const record = autoRecord(actor);
  const calc = { ...suggestTactics(spec, worldTacticDefaults(), getAdapter()?.rules ?? null), ...suggestMotives(spec) };
  for ( const [k, v] of Object.entries(record?.lets ?? {}) ) {
    if ( TACTIC_KEYS.includes(k) ? validLet(k, v, spec) : ["offer", "expect"].includes(k) && validMotive(k, v) ) calc[k] = v;
  }
  const why = record?.why ?? {};
  const suggested = { ...calc, ...playstyles.suggest };
  const resolved = resolveTactics(stored, suggested);
  if ( resolved.preferredAction && !spec.actions.some(a => a.id === resolved.preferredAction) ) resolved.preferredAction = calc.preferredAction;
  return { calc, why, suggested, stored, resolved, playstyles };
}

/** Tokens a user controls (owns) on a scene that the active adapter can simulate. */
export function tokensForUser(scene, user) {
  const adapter = getAdapter();
  if ( !scene || !adapter ) return [];
  return scene.tokens.filter(t => t.actor && adapter.canHandle(t.actor) && t.actor.testUserPermission(user, "OWNER"));
}

/** Has a user anything to set tactics for (as charactersForUser, stopping at the first)? */
export function hasCharactersFor(scene, user) {
  const adapter = getAdapter();
  if ( !adapter ) return false;
  if ( scene?.tokens.some(t => t.actor && adapter.canHandle(t.actor) && t.actor.testUserPermission(user, "OWNER")) ) return true;
  return (game.actors ?? []).some(a => a.hasPlayerOwner && a.testUserPermission(user, "OWNER") && adapter.canHandle(a));
}

/**
 * Everything a player can set tactics for: its tokens on the battle map, then its own characters with no token there.
 * A token linked to its actor is the actor (one set of answers, shared); an unlinked token on the map has answers of
 * its own, so it stands for its actor here (the token is what fights). Each entry: {key, name, token|null, actor}.
 */
export function charactersForUser(scene, user) {
  const adapter = getAdapter();
  if ( !adapter ) return [];
  const tokens = scene ? tokensForUser(scene, user) : [];
  const out = tokens.map(t => ({ key: t.id, name: t.name, token: t, actor: t.actor }));
  const onMap = new Set(tokens.map(t => t.actorId));
  for ( const a of game.actors ?? [] ) {
    if ( onMap.has(a.id) || !a.hasPlayerOwner || !a.testUserPermission(user, "OWNER") || !adapter.canHandle(a) ) continue;
    out.push({ key: `actor-${a.id}`, name: a.name, token: null, actor: a });
  }
  return out;
}

/** Non-GM users who control at least one token on the scene. */
export function playersOnScene(scene) {
  return game.users.filter(u => !u.isGM && tokensForUser(scene, u).length);
}

/** Should the GM planner show the questionnaire for this token? */
export function isPlayerControlled(spec, actor) {
  return spec.kind === "pc" || !!actor?.hasPlayerOwner;
}

/**
 * Compact fingerprint of what changes the sheet's shape: "Let this character decide" (playstyles and the checkboxes), and the
 * kind of offer and expectation (each shows fields of its own).
 */
export function playstyleSignature(actor) {
  const t = getStoredTactics(actor);
  return JSON.stringify([t.playstyles ?? [], !!t.stayTrue, !!t.roleplay, !!t.avoidCostlySpells, t.offer?.kind ?? "", t.expect?.kind ?? ""]);
}

/**
 * A stored answer by its survey key: a question, a desire's field, or a motive's field (undefined: never set, so the
 * sheet keeps showing its default, such as the coin an amount is counted in).
 */
function storedValue(stored, key) {
  const motive = MOTIVE_KEY.exec(key);
  if ( motive ) return stored[motive[1]]?.[motive[2]];
  const desire = DESIRE_KEY.exec(key);
  if ( desire ) return stored.desires?.[desire[1]]?.[desire[2]] ?? (desire[2] === "level" ? DESIRE_LEVELS.determined : "");
  return stored[key];
}

/* -------------------------------------------- */
/*  Question view-model                         */
/* -------------------------------------------- */

/** Habits whose number is a bonus in points (initiative), not a share. */
const POINT_HABITS = new Set(["initiative"]);

/** A share as the reader's language writes it ("40%"). */
function percentText(share) {
  try {
    return new Intl.NumberFormat(language(), { style: "percent", maximumFractionDigits: 0 }).format(share);
  } catch ( err ) {
    return `${Math.round(share * 100)}%`;
  }
}

/**
 * What the picked playstyles do together, in words, for the GM: their shifts to the hidden scores (signed points), then
 * their habits, the strongest first (how strongly each applies; a bonus in points; one that's on or off, by its name).
 * As a fight has them: each pill counting less further down, more with roleplay, little when staying true.
 * @param {{traits: object, behavior: object}} combined   combinePlaystyles' result
 * @returns {string} "" when they do nothing
 */
export function playstyleEffectsText(combined) {
  const item = (what, n) => game.i18n.format("FASTFIGHTING.Playstyle.EffectItem", { what, n });
  const traits = TRAITS.map(k => [k, Math.round(combined?.traits?.[k] ?? 0)]).filter(([, n]) => n)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([k, n]) => item(loc(`FASTFIGHTING.Trait.${k}`), signedNumber(n)));
  const habits = Object.entries(combined?.behavior ?? {}).filter(([, v]) => v === true || (Number.isFinite(v) && Math.abs(v) >= 0.005))
    .sort((a, b) => (Number(b[1]) || 1) - (Number(a[1]) || 1))
    .map(([k, v]) => {
      const name = loc(`FASTFIGHTING.Playstyle.Effect.${k}`);
      if ( v === true ) return name;
      return item(name, POINT_HABITS.has(k) ? signedNumber(v) : percentText(Math.min(1, v)));
    });
  return listItems([...traits, ...habits]);
}

function actionLabel(a) {
  const kind = loc(`FASTFIGHTING.Tactics.ActionKind.${a.kind}`);
  const extra = a.range && !a.melee ? ` · ${distanceText(a.range.increment)}` : "";
  return `${a.name} (${kind}${extra})`;
}

/**
 * Build the template context for one actor's questionnaire.
 * @param {object} spec   CombatantSpec
 * @param {Actor} actor
 * @param {string} uid    Unique suffix for input names in this form
 * @param {object} [options]
 * @param {boolean} [options.questions=true]  Include the tactics questions (NPC rows show only playstyles)
 * @param {{id: string, name: string}[]|null} [options.targets]  Who a desire can be about (tokens on the scene); null or
 *   none: nobody can be named, and there are no desires to state
 */
export function questionsContext(spec, actor, uid, { questions: withQuestions = true, targets: named = [] } = {}) {
  const targets = named ?? [];
  const { calc, suggested, stored, playstyles, why } = tacticsFor(actor, spec);
  // (What "Let this character decide" stands for, and the hidden scores: for a GM or assistant GM only.)
  const gm = !!game.user?.isGM;
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
  // What it chooses, and why: the playstyle that chose it, else its system's reason (its calculated answer).
  const answerLabel = (key, v) => {
    const choice = key === "preferredAction" ? spec.actions.find(a => a.id === v)?.name ?? loc("FASTFIGHTING.Tactics.BestAvailable") : v ? choiceLabel(key, v) : "";
    if ( !choice ) return "";
    const source = playstyles.ids.find(id => PLAYSTYLES[id].suggest[key] === v);
    const reason = source ? loc(`FASTFIGHTING.Playstyle.${source}.Name`) : v === calc[key] ? why[key] : null;
    return reason ? game.i18n.format("FASTFIGHTING.Tactics.AutoFrom", { choice, why: reason }) : choice;
  };
  // As a fight has it: where its pills disagree, or it stays true to its calculated answers, each answer with its chance.
  const suggestionLabel = key => {
    const chances = answerChances(key, calc[key], playstyles, !!stored.stayTrue).filter(([v, p]) => p >= 0.005 && answerLabel(key, v));
    if ( chances.length <= 1 ) return answerLabel(key, chances[0]?.[0] ?? suggested[key]);
    return listItems(chances.map(([v, p]) => game.i18n.format("FASTFIGHTING.Tactics.AutoChance", { choice: answerLabel(key, v), chance: percentText(p) })));
  };

  const questions = [];
  const add = (key, values, { show = true } = {}) => {
    if ( !show || !withQuestions ) return;
    const value = stored[key] ?? "auto";
    const choices = [{ value: "auto", label: loc("FASTFIGHTING.Tactics.Auto"), selected: value === "auto" || value === "" }];
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
      value,
      autoValue: gm ? suggestionLabel(key) || null : null
    });
  };

  // (Talking first, then who it goes for: the top of the sheet.)
  add("talk", TACTIC_CHOICES.talk, { show: (spec.social?.languages?.length ?? 0) > 0 && !spec.social?.mindless });
  add("target", TACTIC_CHOICES.target);
  add("preferredAction", offense.map(a => ({ value: a.id, label: actionLabel(a) })), { show: offense.length > 1 });
  add("style", TACTIC_CHOICES.style);
  add("resourceUse", TACTIC_CHOICES.resourceUse, { show: hasLimited });
  add("specialty", TACTIC_CHOICES.specialty, { show: spec.actions.some(isSpecial) });
  add("consumables", TACTIC_CHOICES.consumables, { show: spec.actions.some(a => /^item:/.test(a.resource ?? "")) });
  add("healAggro", TACTIC_CHOICES.healAggro, { show: heals.some(a => !a.selfOnly) });
  add("potionThreshold", TACTIC_CHOICES.potionThreshold, { show: hasPotions });
  add("allyDying", TACTIC_CHOICES.allyDying);
  add("selfRevived", TACTIC_CHOICES.selfRevived);
  add("retreat", TACTIC_CHOICES.retreat);
  // (A shield to raise, or a turn given to its own defense: 5e's Dodge.)
  add("shield", TACTIC_CHOICES.shield, { show: !!spec.shield || spec.actions.some(a => a.guard) });
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
  // (What it could want of someone; one it wants already stays shown.)
  const possible = desireKindsFor(spec);
  const desires = !targets?.length ? null : DESIRE_SLOTS.map(slot => {
    const d = stored.desires?.[slot] ?? {};
    const kinds = DESIRE_KINDS.filter(k => possible.includes(k) || d.kind === k);
    const level = d.level ?? DESIRE_LEVELS.determined;
    const band = Object.entries(DESIRE_LEVELS).reduce((best, [k, v]) => (Math.abs(v - level) < Math.abs(DESIRE_LEVELS[best] - level) ? k : best), "determined");
    return {
      kind: { key: `desire.${slot}.kind`, name: `tactic-${uid}-desire-${slot}-kind`, choices: ["", ...kinds].map(k => ({ value: k, label: loc(`FASTFIGHTING.Desire.Kind.${k || "none"}`), selected: (d.kind ?? "") === k })) },
      target: { key: `desire.${slot}.target`, name: `tactic-${uid}-desire-${slot}-target`, choices: [{ value: "", label: loc("FASTFIGHTING.Desire.Who"), selected: !d.target }, ...others.map(t => ({ value: t.id, label: t.name, selected: d.target === t.id }))] },
      level: { key: `desire.${slot}.level`, name: `tactic-${uid}-desire-${slot}-level`, choices: DESIRE_BAND_KEYS.map(k => ({ value: DESIRE_LEVELS[k], label: loc(`FASTFIGHTING.Desire.Level.${k}`), selected: band === k })) },
      empty: !d.kind
    };
  });
  // Its hidden scores, as a fight would have them (its sheet, its biography, its playstyles), for the GM.
  const hidden = gm && withQuestions ? TRAITS.map(k => {
    const value = clamp(Math.round(fudged(spec.traits?.[k] ?? 50) + (playstyles.traits?.[k] ?? 0)), 0, 100);
    return { key: k, label: loc(`FASTFIGHTING.Trait.${k}`), value, band: loc(`FASTFIGHTING.Band.${traitBand(k, value)}`), reason: brief(spec.traitReasons?.[k] ?? "") };
  }) : null;
  return {
    uid,
    actorUuid: actor.uuid,
    withQuestions,
    hidden,
    questions,
    desires,
    // (In alphabetical order, as the player reads them.)
    playstyles: PLAYSTYLE_IDS.map(id => ({
      id,
      icon: PLAYSTYLES[id].icon,
      label: loc(`FASTFIGHTING.Playstyle.${id}.Name`),
      hint: loc(`FASTFIGHTING.Playstyle.${id}.Hint`),
      active: picked.includes(id),
      order: picked.indexOf(id) + 1,
      disabled: !picked.includes(id) && picked.length >= MAX_PLAYSTYLES
    })).sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang)),
    playstyleCount: game.i18n.format("FASTFIGHTING.Playstyle.Count", { n: picked.length, max: MAX_PLAYSTYLES }),
    // (What they do together, for a GM or assistant GM.)
    playstyleEffects: gm && picked.length ? playstyleEffectsText(playstyles) || null : null,
    // What it brings to a standoff, and what it wants out of it.
    motives: withQuestions ? motivesContext(spec, stored, getAdapter()?.itemCatalog?.() ?? NO_CATALOG, uid, actor.uuid, {
      auto: { offer: suggested.offer, expect: suggested.expect }, why, gm
    }) : null,
    ...reactionsContext(spec, actor, stored, uid),
    stayTrue: { name: `tactic-${uid}-stayTrue`, checked: !!stored.stayTrue },
    roleplay: { name: `tactic-${uid}-roleplay`, checked: !!stored.roleplay },
    avoidCostlySpells: { name: `tactic-${uid}-avoidCostlySpells`, checked: !!stored.avoidCostlySpells, show: spec.actions.some(a => ((a.rank ?? 0) > 0 || a.spellId) && (a.resource || Number.isFinite(a.uses))) },
    conflict: !!stored.stayTrue && !!stored.roleplay
  };
}

/**
 * A character a player runs: its reactions as its system has them, each always used, asked about, or never used (in a
 * live battle FastFighting decides nothing for it), and whether a reroll (Hero Points, Inspiration) may save its life
 * or a friend's. Nothing for anyone else.
 */
function reactionsContext(spec, actor, stored, uid) {
  if ( !isPlayerControlled(spec, actor) ) return { reactions: null, rerolls: null };
  const adapter = getAdapter();
  const list = adapter?.reactionsOf?.(spec) ?? [];
  const reactions = list.map(r => {
    const key = reactionKey(r.id);
    const value = stored.reactions?.[key] ?? "ask";
    return {
      key: `reactions.${key}`, name: `tactic-${uid}-reaction-${key}`,
      label: r.label ?? loc(key === "opportunity" ? "FASTFIGHTING.Tactics.Reactions.Opportunity" : "FASTFIGHTING.Tactics.Reactions.Unnamed"),
      choices: REACTION_CHOICES.map(c => ({ value: c, label: loc(`FASTFIGHTING.Tactics.Reactions.${c}`), selected: value === c }))
    };
  });
  const resource = adapter?.rerollResource?.() ?? null;
  return {
    reactions: reactions.length ? reactions : null,
    rerolls: resource ? {
      resource,
      self: { key: "rerolls.self", name: `tactic-${uid}-reroll-self`, checked: !!stored.rerolls?.self },
      team: { key: "rerolls.team", name: `tactic-${uid}-reroll-team`, checked: !!stored.rerolls?.team }
    } : null
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
    const on = !!storedValue(stored, cb.dataset.tactic);
    if ( cb.checked !== on && cb !== document.activeElement ) cb.checked = on;
  }
  // (An amount someone else typed.)
  for ( const el of root.querySelectorAll(`input[type=number][data-tactic][data-actor-uuid="${actor.uuid}"]`) ) {
    const value = storedValue(stored, el.dataset.tactic);
    if ( value !== undefined && el !== document.activeElement && el.value !== String(value) ) el.value = String(value);
  }
  for ( const el of root.querySelectorAll(`select[data-tactic][data-actor-uuid="${actor.uuid}"]`) ) {
    const key = el.dataset.tactic;
    const stated = storedValue(stored, key);
    if ( stated === undefined && MOTIVE_KEY.test(key) ) continue;
    const value = stated ?? "auto";
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
  // (A player writes its own: only a status the survey has.)
  return Object.values(SURVEY_STATUS).includes(s.status) ? s : { ...s, status: SURVEY_STATUS.NONE };
}

export async function setOwnSurveyStatus(status, sceneId, requestId, extra = {}) {
  const current = game.user.getFlag(MODULE_ID, "survey") ?? {};
  await game.user.setFlag(MODULE_ID, "survey", { ...current, ...extra, status, sceneId: sceneId ?? current.sceneId, requestId: requestId ?? current.requestId, updated: Date.now() });
}

/** GM: ask some (or all) players on the scene to fill in their survey. */
/**
 * GM: ask players (never a GM) to fill in their survey.
 * @param {object} [options]
 * @param {string} [options.start]  the tab it opens on: "party", or a character's key
 * @param {"open"|"keep"|"closed"} [options.party]  "open": a new round of the party's vote (the survey sent to
 *   everyone: each player votes until it locks in or closes the survey); "closed": the Party tab only to look at (a
 *   question about one character); "keep": as it stands
 */
export async function requestSurveys(users, scene = canvas.scene, { start = "party", party = "keep" } = {}) {
  if ( !game.user.isGM || !scene ) return;
  // (Never a GM's or an assistant GM's: the survey is the players'. A GM answers for a character by its own request.)
  users = users.filter(u => !u.isGM);
  if ( !users.length ) return;
  const requestId = foundry.utils.randomID();
  // (One write for them all.)
  const survey = { status: SURVEY_STATUS.REQUESTED, sceneId: scene.id, requestId, start, updated: Date.now() };
  if ( party === "open" ) Object.assign(survey, { partyRound: requestId, partyOpen: true });
  else if ( party === "closed" ) survey.partyOpen = false;
  await game.users.documentClass.updateDocuments(users.map(u => ({ _id: u.id, [`flags.${MODULE_ID}.survey`]: survey })));
  const userIds = users.map(u => u.id);
  game.socket.emit(SOCKET, { action: "openSurvey", userIds, sceneId: scene.id, requestId, start }, { recipients: userIds });
}

/**
 * Ask about one character: its players (any non-GM who controls it) get the survey on that character, with their other
 * characters there too and the Party tab only to look at.
 * @param {TokenDocument} token
 * @returns {Promise<User[]>} who was asked
 */
export async function requestCharacterSurvey(token, scene = canvas.scene) {
  const players = game.users.filter(u => !u.isGM && token?.actor?.testUserPermission(u, "OWNER"));
  await requestSurveys(players, scene, { start: token.id, party: "closed" });
  return players;
}

/**
 * One character's survey for every GM logged in (that character alone), to answer for a player who's away. The GM who
 * asks gets it at once; the others by the socket.
 * @param {TokenDocument} token
 */
export async function requestGmSurvey(token, scene = canvas.scene, open = null) {
  if ( !game.user.isGM || !token || !scene ) return;
  const userIds = game.users.filter(u => u.isGM && u.active && u !== game.user).map(u => u.id);
  if ( userIds.length ) game.socket.emit(SOCKET, { action: "openGmSurvey", userIds, sceneId: scene.id, key: token.id }, { recipients: userIds });
  await open?.({ sceneId: scene.id, start: token.id, only: token.id });
}
