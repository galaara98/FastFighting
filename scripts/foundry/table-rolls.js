/**
 * The engine's own table rolls in the chat (engine/table-rolls.js records them as a live battle plays): each a Foundry
 * Roll carrying the very dice the engine rolled, so the roll's tooltip shows them and Dice So Nice throws them.
 *   - After a turn is written onto the sheets, its rolls are posted: one message for each creature that rolled and each
 *     audience, its token the speaker (postRolls). Where the helper shows rolls its system's way (showTableRoll, API
 *     20), each roll is its system's own card instead (PF2e's check and damage cards), one roll to a card, in order; a
 *     roll it leaves alone is a plain one. One the system showed already (`shown`: a damage card made in the turn, and
 *     the rolls before it) isn't posted again.
 *   - Who sees them (rollAudience): a player's character's, everyone; a creature the players can't see (a hidden token,
 *     one the fight has hidden or unseen, one whose name the GM keeps secret), the GMs only; any other, as the GM's own
 *     roll mode says, and never fewer than the GMs.
 *   - A fight settled at once (Play to the end, the aftermath): one card for the GMs, its rolls by round and creature,
 *     folded away (tallyHtml), so they don't flood the chat.
 * The messages are the turn's: Rewind deletes them with its other cards.
 * The builders (rollJson, rollFlavor, rollAudience, rollMessages, tallyHtml) are pure; the posting needs Foundry.
 */
import { MODULE_ID } from "../constants.js";
import { localize, hasWords, escapeHtml as escape, inertHtml, numberText } from "../i18n.js";
import { groupValue } from "../engine/table-rolls.js";

/** What a roll was for, in words: "Greataxe: damage", "Recovery check", "Longsword: attack (DC 18)". */
export function rollFlavor(roll, { dc = true, part = 0 } = {}) {
  const kind = hasWords(`FASTFIGHTING.Rolls.Kind.${roll.kind}`) ? roll.kind : "other";
  const named = roll.label || (roll.what && hasWords(`FASTFIGHTING.Rolls.What.${roll.what}`) ? localize(`FASTFIGHTING.Rolls.What.${roll.what}`) : "");
  let text = named ? localize(`FASTFIGHTING.Rolls.Kind.${kind}`, { what: named }) : localize(`FASTFIGHTING.Rolls.Plain.${kind}`);
  if ( part > 0 ) text = localize("FASTFIGHTING.Rolls.Part", { flavor: text, n: part + 1 });
  if ( dc && part === 0 && Number.isFinite(roll.dc) ) text = localize("FASTFIGHTING.Rolls.Dc", { flavor: text, dc: roll.dc });
  if ( Number.isFinite(roll.multiplier) && roll.multiplier !== 1 ) text = localize("FASTFIGHTING.Rolls.Times", { flavor: text, n: numberText(roll.multiplier, 2) });
  if ( roll.rerolled ) text = localize("FASTFIGHTING.Rolls.Rerolled", { flavor: text });
  return text;
}

const numeric = n => ({ class: "NumericTerm", number: n, options: {}, evaluated: true });
const operator = op => ({ class: "OperatorTerm", operator: op, options: {}, evaluated: true });

/** A group's dice as a Die term's results: every one active, but the one not kept (advantage), discarded. */
function resultsOf(g) {
  if ( !g.keep ) return g.results.map(result => ({ result, active: true }));
  const kept = g.keep === "kl" ? Math.min(...g.results) : Math.max(...g.results);
  const at = g.results.indexOf(kept);
  return g.results.map((result, i) => (i === at ? { result, active: true } : { result, active: false, discarded: true }));
}

/** A term as it reads in a formula. */
const termText = t => (t.class === "Die" ? `${t.number}d${t.faces}${t.modifiers.join("")}` : t.class === "OperatorTerm" ? t.operator : String(t.number));

/**
 * One of a table roll's rolls (`part`: which, for one shown as several) as a Foundry Roll's data (Roll.fromData): its
 * dice as Die terms holding the results the engine rolled, its modifier, and the engine's own total. Null for a part
 * with no dice.
 */
export function rollJson(roll, { flavor = null, part = 0 } = {}) {
  const groups = (roll.groups ?? []).filter(g => (g.roll ?? 0) === part);
  if ( !groups.some(g => g.faces) ) return null;
  const own = roll.rolls?.[part] ?? { mod: part === 0 ? roll.mod : 0, total: part === 0 ? roll.total : null };
  const terms = [];
  const signed = sign => {
    if ( terms.length ) terms.push(operator(sign < 0 ? "-" : "+"));
    else if ( sign < 0 ) terms.push(operator("-"));
  };
  for ( const g of groups ) {
    if ( !g.faces ) {
      const v = Number(g.flat) || 0;
      if ( !v ) continue;
      signed(Math.sign(v));
      terms.push(numeric(Math.abs(v)));
      continue;
    }
    signed(g.sign ?? 1);
    terms.push({ class: "Die", number: g.results.length, faces: g.faces, modifiers: g.keep ? [g.keep] : [], results: resultsOf(g), options: {}, evaluated: true });
    if ( (g.mult ?? 1) !== 1 ) terms.push(operator("*"), numeric(g.mult));
  }
  const mod = Number(own.mod) || 0;
  if ( mod ) {
    signed(Math.sign(mod));
    terms.push(numeric(Math.abs(mod)));
  }
  const total = Number.isFinite(own.total) ? own.total : Math.floor(groups.reduce((s, g) => s + groupValue(g), 0) + mod);
  return {
    class: "Roll", options: flavor ? { flavor } : {}, dice: [], formula: terms.map(termText).join(" "), terms, total, evaluated: true
  };
}

/** Every Roll's data a table roll shows (one, or one for each of its rolls), each with its flavor. */
export function rollJsons(roll, { dc = true } = {}) {
  const parts = Math.max(1, roll.rolls?.length ?? 1);
  const out = [];
  for ( let part = 0; part < parts; part++ ) {
    const json = rollJson(roll, { flavor: rollFlavor(roll, { dc, part }), part });
    if ( json ) out.push(json);
  }
  return out;
}

/** The chat's audiences: everyone, or the GMs alone. */
export const AUDIENCE = Object.freeze({ PUBLIC: "public", GM: "gm" });

/**
 * Who sees a creature's rolls. A token the players can't see (hidden on the map), the GMs; a player's character
 * (one a player owns), everyone; one the fight has hidden or unseen, or whose name the GM keeps secret, the GMs; any
 * other, as the GM's own roll mode (core messageMode: "public" and "ic" are everyone's, "gm", "blind" and "self" the
 * GMs'), and never fewer than the GMs.
 */
export function rollAudience({ playerOwned = false, tokenHidden = false, unseen = false, secret = false, gmMode = "public" } = {}) {
  if ( tokenHidden ) return AUDIENCE.GM;
  if ( playerOwned ) return AUDIENCE.PUBLIC;
  if ( unseen || secret ) return AUDIENCE.GM;
  return gmMode === "public" || gmMode === "ic" ? AUDIENCE.PUBLIC : AUDIENCE.GM;
}

/**
 * A turn's table rolls, as its messages: one for each creature that rolled and each audience, in the order they first
 * rolled, each roll in its own order. `audienceOf(id)`: who sees that creature's. [{by, audience, rolls}].
 */
export function rollMessages(rolls, audienceOf) {
  const out = new Map();
  for ( const r of rolls ?? [] ) {
    const audience = audienceOf(r.by);
    const key = `${r.by ?? ""}|${audience}`;
    if ( !out.has(key) ) out.set(key, { by: r.by ?? null, audience, rolls: [] });
    out.get(key).rolls.push(r);
  }
  return [...out.values()];
}

/** A Roll's data as an inline result in a card (Foundry's own inline roll: its tooltip shows the dice). */
function inlineRoll(json) {
  // (Foundry reads it back with unescape(): escape()'s own encoding, "@" too, so the card's inertHtml leaves it whole.)
  const data = globalThis.escape(JSON.stringify(json)).replace(/@/g, "%40");
  return `<a class="inline-roll inline-result" data-roll="${data}" data-tooltip-text="${escape(json.formula)}"><i class="fa-solid fa-dice-d20" inert></i> ${escape(String(json.total))}</a>`;
}

/**
 * The card for rolls settled at once: by round (the aftermath after), then by creature, each folded away, every roll an
 * inline result with its flavor. `entries`: [{turn, round, aftermath, rolls}]; `names`: creature id -> its name.
 */
export function tallyHtml(entries, names = {}) {
  const rounds = new Map();
  for ( const e of entries ?? [] ) {
    const key = e.aftermath ? "aftermath" : `r${e.round ?? 0}`;
    if ( !rounds.has(key) ) rounds.set(key, { aftermath: !!e.aftermath, round: e.round ?? 0, by: new Map() });
    const at = rounds.get(key);
    for ( const r of e.rolls ?? [] ) {
      const who = r.by ?? "";
      if ( !at.by.has(who) ) at.by.set(who, []);
      at.by.get(who).push(r);
    }
  }
  const sections = [...rounds.values()].sort((a, b) => (a.aftermath - b.aftermath) || a.round - b.round).map(round => {
    const count = [...round.by.values()].reduce((s, list) => s + list.length, 0);
    const title = round.aftermath ? localize("FASTFIGHTING.Rolls.Tally.Aftermath", { n: count }) : localize("FASTFIGHTING.Rolls.Tally.Round", { round: round.round, n: count });
    const creatures = [...round.by.entries()].map(([id, list]) => {
      const name = names[id] ?? localize("FASTFIGHTING.Rolls.Tally.Nobody");
      const items = list.flatMap(r => rollJsons(r).map(json => `<li>${inlineRoll(json)} ${escape(json.options.flavor ?? "")}</li>`)).join("");
      return `<details><summary>${escape(localize("FASTFIGHTING.Rolls.Tally.Creature", { name, n: list.length }))}</summary><ul>${items}</ul></details>`;
    }).join("");
    return `<details><summary>${escape(title)}</summary>${creatures}</details>`;
  }).join("");
  return `<div class="fast-fighting-rolls"><header><i class="fa-solid fa-dice"></i> ${escape(localize("FASTFIGHTING.Rolls.Tally.Title"))}</header>${sections}</div>`;
}

/* -------------------------------------------- */
/*  Posting (Foundry)                           */
/* -------------------------------------------- */

const ChatMessageClass = () => foundry.documents.ChatMessage ?? globalThis.ChatMessage;
const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);

/** The GM's own roll mode, on this client (v14's messageMode; an older core's rollMode, as v14 maps it). */
function gmMode() {
  try {
    return game.settings.get("core", "messageMode");
  } catch ( err ) {
    try {
      const legacy = game.settings.get("core", "rollMode");
      return { publicroll: "public", gmroll: "gm", blindroll: "blind", selfroll: "self" }[legacy] ?? "public";
    } catch ( err2 ) {
      return "public";
    }
  }
}

/**
 * Who sees creature `id`'s rolls now: its token (`docOf(id)`) and what the fight knows of it (`unitOf(id)`: a
 * hidden token not given away, hidden or invisible).
 */
export function audienceFor(id, { docOf, unitOf }) {
  const doc = id ? docOf(id) : null;
  const u = id ? unitOf(id) : null;
  const unseen = !!u && ((u.spec?.hidden && !u.revealed) || (Number(u.conds?.hidden) || 0) > 0 || (Number(u.conds?.invisible) || 0) > 0);
  return rollAudience({
    playerOwned: !!doc?.actor?.hasPlayerOwner, tokenHidden: !!doc?.hidden, unseen,
    secret: !!doc?.actor?.getFlag?.(MODULE_ID, "secretName"), gmMode: gmMode()
  });
}

/** Who sees each roller's rolls, as things stand now (before a turn's writing hides one that fled): id -> audience. */
export function audiencesFor(rolls, { docOf, unitOf }) {
  return new Map([...new Set((rolls ?? []).map(r => r.by ?? null))].map(id => [id, audienceFor(id, { docOf, unitOf })]));
}

/**
 * A turn's table rolls posted, every roll a Foundry Roll with the engine's dice, its token the speaker (the narrator's,
 * with none): a message for each creature and audience. `flags`: the battle's own (live: {battle, turn}), so Rewind
 * finds them. `audiences`: who sees each roller's, as audiencesFor found them earlier (else as things stand now).
 * `show` (API 20): the helper's own way of showing a roll, as its system's card (showTableRoll, through the live side:
 * `show(roll, {token, target, audience, flavor, flags})`, its messages' ids or null), tried for each roll in the order
 * rolled; a roll it doesn't show is a plain message of its own between them, so the chat reads in order, one roll to a
 * card as the system posts them. `cards`: a Map, given each roll `show` showed, with its messages' ids.
 * Returns the messages' ids.
 */
export async function postRolls(rolls, { scene, docOf, unitOf, flags = {}, speakerless = null, audiences = null, show = null, cards = null } = {}) {
  if ( !rolls?.length ) return [];
  const audienceOf = id => audiences?.get(id ?? null) ?? audienceFor(id, { docOf, unitOf });
  const own = { [MODULE_ID]: { live: { ...flags, rolls: true } } };
  const plain = messages => postPlain(messages, { scene, docOf, flags: own, speakerless });
  if ( typeof show !== "function" ) return plain(rollMessages(rolls, audienceOf));
  const ids = [];
  for ( const r of rolls ) {
    const audience = audienceOf(r.by ?? null);
    let shown = null;
    try {
      // (Its words without the DC: the system shows a DC its own way, to whom its settings say.)
      shown = await show(r, {
        token: r.by ? docOf(r.by) ?? null : null, target: r.target ? docOf(r.target) ?? null : null, audience,
        flavor: rollFlavor(r, { dc: false }), flags: structuredClone(own)
      });
    } catch ( err ) {
      console.error(`${MODULE_ID} | showing the engine's roll the system's way`, err);
      shown = null;
    }
    const list = [].concat(shown ?? []).filter(id => typeof id === "string" && id);
    if ( list.length ) {
      ids.push(...list);
      cards?.set(r, list);
      continue;
    }
    ids.push(...await plain([{ by: r.by ?? null, audience, rolls: [r] }]));
  }
  return ids;
}

/** Plain rolls posted, a message for each of `messages` ({by, audience, rolls}: rollMessages'). Returns their ids. */
async function postPlain(messages, { scene, docOf, flags, speakerless = null }) {
  const ChatMessage = ChatMessageClass();
  const Roll = foundry.dice?.Roll ?? globalThis.Roll;
  const ids = [];
  for ( const m of messages ) {
    try {
      const doc = m.by ? docOf(m.by) : null;
      const gm = m.audience === AUDIENCE.GM;
      // (The DC only for the GMs: a player's character's roll would give away a foe's numbers.)
      const list = m.rolls.flatMap(r => rollJsons(r, { dc: gm })).map(json => Roll.fromData(json));
      if ( !list.length ) continue;
      const speaker = doc ? ChatMessage.getSpeaker({ scene, token: doc }) : (speakerless ?? { alias: localize("FASTFIGHTING.Story.Speaker") });
      const message = await ChatMessage.create({
        speaker, rolls: list, whisper: gm ? gmIds() : [], sound: CONFIG.sounds?.dice, flags
      });
      if ( message ) ids.push(message.id);
    } catch ( err ) {
      console.error(`${MODULE_ID} | showing the engine's rolls`, err);
    }
  }
  return ids;
}

/**
 * The card for rolls settled at once, made or brought up to date: `entries` as tallyHtml has them (kept in the card's
 * flags, so a turn rewound can be taken out), for the GMs alone. `id`: the card so far (none: a new one). Returns its id,
 * or null when nothing's left to show (the card deleted).
 */
export async function postTally(id, entries, { names = {}, flags = {} } = {}) {
  const ChatMessage = ChatMessageClass();
  const old = id ? game.messages.get(id) : null;
  const shown = (entries ?? []).filter(e => e.rolls?.length);
  try {
    if ( !shown.length ) {
      await old?.delete();
      return null;
    }
    const content = inertHtml(tallyHtml(shown, names));
    const data = { [`flags.${MODULE_ID}.tally`]: { entries: shown, names } };
    if ( old ) {
      await old.update({ content, ...data });
      return old.id;
    }
    const card = await ChatMessage.create({
      content, speaker: { alias: localize("FASTFIGHTING.Story.Speaker") }, whisper: gmIds(),
      flags: { [MODULE_ID]: { live: { ...flags, tally: true }, tally: { entries: shown, names } } }
    });
    return card?.id ?? null;
  } catch ( err ) {
    console.error(`${MODULE_ID} | the engine's rolls, settled at once`, err);
    return old?.id ?? null;
  }
}

/** The entries a tally card keeps (its flags), or none. */
export const tallyOf = id => {
  const kept = id ? game.messages.get(id)?.getFlag(MODULE_ID, "tally") : null;
  return { entries: Array.isArray(kept?.entries) ? kept.entries : [], names: kept?.names ?? {} };
};
