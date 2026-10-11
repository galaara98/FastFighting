/**
 * Words for the people at the table, in their language.
 *
 * Everything the GM and players read (the story, the log, what Make it So will change, why a trait is what it is)
 * goes through localize(): the translation Foundry has for the key (the client's language, falling back to English),
 * else the English written beside the call. The English beside each call is what the tests (no Foundry) and an
 * incomplete translation see; languages/en.json carries the same English for translators to work from.
 * Pure: it only reads Foundry's i18n when it's there.
 */

/** The client's language ("en" without Foundry). */
export const language = () => globalThis.game?.i18n?.lang ?? "en";

/** Fill {placeholders} from data (left as they are when data has no such value). */
export function fillIn(text, data) {
  if ( !data ) return text;
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (data[k] !== undefined && data[k] !== null ? String(data[k]) : m));
}

/**
 * The text for `key`: Foundry's translation when it has one, else `english`; {placeholders} filled from data.
 * @param {string} key       a translation key ("FASTFIGHTING.MakeItSo.Outcome.Dead")
 * @param {string} english   the English, used without Foundry or a translation
 * @param {object} [data]    values for the {placeholders}
 */
export function localize(key, english, data = null) {
  const i18n = globalThis.game?.i18n;
  const text = key && i18n?.has?.(key) ? i18n.localize(key) : english;
  return fillIn(text, data);
}

/** A list in words: "Amiri, Ezren and Lini" ("Amiri, Ezren y Lini"). */
export function listJoin(items) {
  const list = (items ?? []).filter(x => x !== null && x !== undefined && x !== "").map(String);
  if ( list.length <= 1 ) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} ${localize("FASTFIGHTING.Words.And", "and")} ${list.at(-1)}`;
}

/* Make it So: the lines every system's outcome has in common. -------------- */

const OUTCOME = {
  Hp: "HP {from} → {to}",
  Dies: "DIES",
  Dead: "Dead",
  Down: "Down",
  Unconscious: "Unconscious (stable)",
  Dying: "Dying {n}",
  Wounded: "Wounded {n}",
  Retreated: "Retreated from the battle",
  TalkedAway: "Talked into fleeing (token hidden)",
  Fled: "Fled the battle (token hidden)",
  Surrenders: "Surrenders",
  StandsDown: "Stands down (talked out of fighting)",
  SwitchesFriendly: "Switches sides (now friendly)",
  SwitchesHostile: "Switches sides (now hostile)",
  TurnedOn: "Turned on the party (now hostile)",
  StandsAside: "Stands aside (now neutral)",
  Uses: "Uses {n}× {what}",
  StillOne: "Still {effect} (1 more round)",
  StillMany: "Still {effect} ({n} more rounds)",
  Affected: "affected",
  Persistent: "Persistent {formula} {type}",
  Affliction: "{name} (stage {stage})",
  AfflictionOnset: "{name} (takes hold in {n} rounds, stage {stage})"
};

/** One of the common Make it So lines (OUTCOME above), in the reader's language. */
export function outcomeLine(id, data = null) {
  return localize(`FASTFIGHTING.MakeItSo.Outcome.${id}`, OUTCOME[id] ?? id, data);
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
