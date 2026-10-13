/**
 * Words for the people at the table, in their language.
 *
 * Everything the GM and players read (the story, the log, what Make it So will change, why a trait is what it is)
 * goes through localize(): the text Foundry has for the key, in the client's language or else in English. The words
 * live only in languages/en.json (and the story's in story/en.json); the code holds keys, never the English itself.
 * The tests load languages/en.json into a stand-in for Foundry's i18n (tests/foundry-i18n.js).
 * Pure: it only reads Foundry's i18n.
 */

/** The client's language ("en" without Foundry). */
export const language = () => globalThis.game?.i18n?.lang ?? "en";

/** Fill {placeholders} from data (left as they are when data has no such value). */
export function fillIn(text, data) {
  if ( !data ) return text;
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (data[k] !== undefined && data[k] !== null ? String(data[k]) : m));
}

/** Does Foundry have text for this key (in the client's language or English)? */
export const hasWords = key => !!key && !!globalThis.game?.i18n?.has?.(key);

/* The game's words for its stats ------------------------------------------- */

let termSource = null;

/**
 * Where the game system's own words for its stats come from: its helper's (adapter.term(key)), set by the Foundry
 * side. A helper gives a word, null (FastFighting's generic word) or false (the system has no such stat).
 */
export function setTermSource(source) {
  termSource = source;
}

function ownTerm(key) {
  try {
    return termSource?.(key) ?? null;
  } catch ( err ) {
    return null;
  }
}

/**
 * Does the game system have this stat? ("ac": how hard a creature is to hit; "hp": how much harm it can take; "sp":
 * stamina, spent before hit points, where a system has it.)
 */
export const hasStat = key => ownTerm(key) !== false;

/** The game's word for a stat: the system helper's own, else FastFighting's generic one (FASTFIGHTING.Stat.<key>). */
export function term(key) {
  const own = ownTerm(key);
  if ( typeof own === "string" && own ) return own;
  return hasWords(`FASTFIGHTING.Stat.${key}`) ? globalThis.game.i18n.localize(`FASTFIGHTING.Stat.${key}`) : key;
}

/** {AC}, {HP}, {SP} and {MONEY} in any text: the game's words for them (money: what paying costs, Ironsworn's Supply). */
const TERMS = { AC: "ac", HP: "hp", SP: "sp", MONEY: "money" };
const withTerms = text => String(text).replace(/\{(AC|HP|SP|MONEY)\}/g, (m, k) => term(TERMS[k]));

/**
 * The text for `key` in the reader's language, {placeholders} filled from data, and {AC}, {HP} and {SP} with the game's words
 * for them. A key with no text comes back as it is, as Foundry's own localize does.
 * @param {string} key       a translation key ("FASTFIGHTING.MakeItSo.Outcome.Dead")
 * @param {object} [data]    values for the {placeholders}
 */
export function localize(key, data = null) {
  const text = hasWords(key) ? globalThis.game.i18n.localize(key) : key;
  return fillIn(withTerms(text), data);
}

/** Text made safe to put in HTML (names players chose, words a table wrote): &, <, >, " and ' escaped. */
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
export const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => HTML_ESCAPES[c]);

/**
 * A chat message's HTML made inert. Chat runs every message through Foundry's enrichers, which make `[[...]]` a roll,
 * `@UUID[...]` a link and `&Reference[...]` a reference: a name a player wrote could become one inside the GM's card.
 * An invisible word joiner after each `[`, `@` and `&` keeps the text as it reads, and the markup from working.
 */
const JOINER = "⁠";
export const inertHtml = html => String(html ?? "").replace(/\[/g, `[${JOINER}`).replace(/@/g, `@${JOINER}`).replace(/&amp;/g, `&amp;${JOINER}`);

/** Names one after another ("Amiri, Ezren"), with the language file's separator. */
export const listItems = items => items.join(localize("FASTFIGHTING.Words.ListSeparator"));

/** A list in words: "Amiri, Ezren and Lini" ("Amiri, Ezren y Lini"), its shape from the language file. */
export function listJoin(items) {
  const list = (items ?? []).filter(x => x !== null && x !== undefined && x !== "").map(String);
  if ( list.length <= 1 ) return list[0] ?? "";
  return localize("FASTFIGHTING.Words.List", { rest: listItems(list.slice(0, -1)), last: list.at(-1) });
}

/* Numbers and distances ---------------------------------------------------- */

/** A number as the reader's language writes it ("4.5", "4,5"), to `digits` decimals at most. */
export function numberText(n, digits = 1) {
  try {
    return new Intl.NumberFormat(language(), { maximumFractionDigits: digits }).format(n);
  } catch ( err ) {
    return String(Math.round(n * 10 ** digits) / 10 ** digits);
  }
}

let distanceUnit = null;

/**
 * The units distances read in. The engine counts feet; a table may count metres. The Foundry side sets the viewed
 * scene's ({label: "m", feetPer: 10 / 3}: a metre the table way, 1.5 m to a 5-foot square); null for feet, named
 * by the language file (FASTFIGHTING.Units.Feet).
 */
export function setDistanceUnit(unit) {
  distanceUnit = unit?.label && unit.feetPer > 0 ? { label: unit.label, feetPer: unit.feetPer } : null;
}

/** A distance given in feet, in the table's units and the reader's language ("30 ft", "9 m", "4,5 m"). */
export function distanceText(feet) {
  const u = distanceUnit;
  return localize("FASTFIGHTING.Units.Distance", { n: numberText(u ? feet / u.feetPer : feet), units: u ? u.label : localize("FASTFIGHTING.Units.Feet") });
}

/* Make it So: the lines every system's outcome has in common. -------------- */

/** One of the common Make it So lines (FASTFIGHTING.MakeItSo.Outcome), in the reader's language. */
export function outcomeLine(id, data = null) {
  return localize(`FASTFIGHTING.MakeItSo.Outcome.${id}`, data);
}

/**
 * The common lines about where a creature ended up, in order: its hit points, its fate (dead, fled, surrendered, stood
 * down), and a change of side. A system adds its own (dying, wounds, resources) around them.
 * @param {object} spec    its CombatantSpec
 * @param {object} final   where the fight left it
 * @param {object} [o]     {hp: false} to leave hit points to the system (Ironsworn calls them health)
 */
export function commonOutcome(spec, final, { hp = true } = {}) {
  const lines = [];
  if ( hp && final.hp !== spec.hp.value ) lines.push(outcomeLine("Hp", { from: spec.hp.value, to: final.hp }));
  const stamina = spec.hp.stamina;
  if ( hp && stamina && final.stamina !== undefined && final.stamina !== stamina.value ) lines.push(outcomeLine("Stamina", { from: stamina.value, to: final.stamina }));
  if ( final.status === "dead" ) lines.push(outcomeLine(spec.kind === "pc" ? "Dies" : "Dead"));
  else if ( final.status === "fled" ) lines.push(outcomeLine(spec.kind === "pc" ? "Retreated" : final.swayed ? "TalkedAway" : "Fled"));
  else if ( final.status === "surrendered" ) lines.push(outcomeLine("Surrenders"));
  else if ( final.status === "stoodDown" ) lines.push(outcomeLine("StandsDown"));
  const side = sideChangeLine(final);
  if ( side ) lines.push(side);
  return lines;
}

/** A change of side, in words (null: none). */
export function sideChangeLine(final) {
  if ( final.swayed === "switched" ) return outcomeLine(final.side === "friendly" ? "SwitchesFriendly" : "SwitchesHostile");
  if ( final.side !== "neutralParty" || final.status === "dead" ) return null;
  if ( final.against?.includes("friendly") ) return outcomeLine("TurnedOn");
  return final.swayed === "neutral" ? outcomeLine("StandsAside") : null;
}

/** "Still frightened (2 more rounds)". */
export function stillLine(effect) {
  const label = effect.label || outcomeLine("Affected");
  return effect.rounds === 1 ? outcomeLine("StillOne", { effect: label }) : outcomeLine("StillMany", { effect: label, n: effect.rounds });
}
