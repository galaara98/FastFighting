/**
 * Fingerprints for a helper's review ledger (tools/review): a short sha-256 of a value's normalized JSON. A change in
 * what a game system ships shows as a changed fingerprint, and nothing of the system's text is kept. Developer tool,
 * never in the module. Pure, node only.
 */
import { createHash } from "node:crypto";

/** How many hex digits a fingerprint keeps (48 bits: plenty to tell one version of an item from the next). */
export const PRINT_LENGTH = 12;

/**
 * A value made stable for a fingerprint: object keys sorted; strings trimmed, runs of white space one space;
 * undefined, null, empty strings, empty arrays and empty objects dropped (a schema's defaults come and go, the data
 * doesn't); arrays kept in their order.
 * @param {*} value
 * @returns {*}  the normalized value, or undefined for one dropped
 */
export function normalize(value) {
  if ( value === null || value === undefined ) return undefined;
  if ( typeof value === "string" ) {
    const s = value.replace(/\s+/g, " ").trim();
    return s || undefined;
  }
  if ( typeof value === "number" ) return Number.isFinite(value) ? value : String(value);
  if ( typeof value !== "object" ) return value;
  if ( Array.isArray(value) ) {
    const list = value.map(normalize).filter(v => v !== undefined);
    return list.length ? list : undefined;
  }
  const out = {};
  for ( const key of Object.keys(value).sort() ) {
    const v = normalize(value[key]);
    if ( v !== undefined ) out[key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Numbers masked, for a shape: every number "#", every run of digits in a string "#" (one creature's DCs, damage and
 * ranges, not what kind of thing the helper made). Keys are kept.
 * @param {*} value
 */
export function maskNumbers(value) {
  if ( typeof value === "number" ) return "#";
  if ( typeof value === "string" ) return value.replace(/\d+(?:\.\d+)?/g, "#");
  if ( Array.isArray(value) ) return value.map(maskNumbers);
  if ( value && typeof value === "object" ) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskNumbers(v)]));
  return value;
}

/**
 * Keys dropped from a value, however deep (an id the tool made up, a label in the reader's language).
 * @param {*} value
 * @param {Set<string>|string[]} keys
 */
export function withoutKeys(value, keys) {
  const drop = keys instanceof Set ? keys : new Set(keys);
  if ( Array.isArray(value) ) return value.map(v => withoutKeys(v, drop));
  if ( value && typeof value === "object" ) {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !drop.has(k)).map(([k, v]) => [k, withoutKeys(v, drop)]));
  }
  return value;
}

/** A short sha-256 of a string. */
export const hash = (text, length = PRINT_LENGTH) => createHash("sha256").update(String(text)).digest("hex").slice(0, length);

/**
 * A value's fingerprint: its normalized JSON, hashed. Two values that normalize the same have the same fingerprint.
 * @param {*} value
 * @param {number} [length]
 */
export const fingerprint = (value, length = PRINT_LENGTH) => hash(JSON.stringify(normalize(value) ?? null), length);

/**
 * One fingerprint for a set of values (every creature's copy of an ability): each one's fingerprint, the distinct ones
 * sorted, hashed together. The same set in any order prints the same.
 * @param {Iterable<*>} values
 * @param {number} [length]
 */
export function setPrint(values, length = PRINT_LENGTH) {
  const prints = [...new Set([...values].map(v => fingerprint(v, 64)))].sort();
  return hash(prints.join("\n"), length);
}

/** Many fingerprints already made, as one (each once, in any order). */
export const printsPrint = (prints, length = PRINT_LENGTH) => hash([...new Set(prints)].sort().join("\n"), length);
