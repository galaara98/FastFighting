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

/**
 * The text for `key` in the reader's language, {placeholders} filled from data. A key with no text comes back as it is,
 * as Foundry's own localize does.
 * @param {string} key       a translation key ("FASTFIGHTING.MakeItSo.Outcome.Dead")
 * @param {object} [data]    values for the {placeholders}
 */
export function localize(key, data = null) {
  const text = hasWords(key) ? globalThis.game.i18n.localize(key) : key;
  return fillIn(text, data);
}

/** Names one after another ("Amiri, Ezren"), with the language file's separator. */
export const listItems = items => items.join(localize("FASTFIGHTING.Words.ListSeparator"));

/** A list in words: "Amiri, Ezren and Lini" ("Amiri, Ezren y Lini"), its shape from the language file. */
export function listJoin(items) {
  const list = (items ?? []).filter(x => x !== null && x !== undefined && x !== "").map(String);
  if ( list.length <= 1 ) return list[0] ?? "";
  return localize("FASTFIGHTING.Words.List", { rest: listItems(list.slice(0, -1)), last: list.at(-1) });
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
