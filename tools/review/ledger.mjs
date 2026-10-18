/**
 * A helper's review ledger and snapshot (tools/review), read and written as JSON with one entry per line, so a git diff
 * shows each item that changed on a line of its own. What goes in them is the helper's to say; the shape is shared:
 *
 *   ledger.json    {system, checked, entries: {slug: {how, note, reviewed, system, rules, text, ...}}, ...}
 *                  one entry per special case the helper's code names: what's special and where (`note`, the team's
 *                  own words), when it was reviewed against which system version, and fingerprints of the item's
 *                  structure (`rules`) and description (`text`), never the text itself
 *   snapshot.json  {system, version, taken, generic: {slug: {built, count}}, ...}
 *                  for the items the helper's readers handle from their structure: per slug, a fingerprint of the shape
 *                  of what the helper builds from it, and how many it saw
 * Developer tool, never in the module. Node only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Today, as the ledger dates a review (YYYY-MM-DD). */
export const today = () => new Date().toISOString().slice(0, 10);

/** A JSON file's contents, or `fallback` when there's no file. */
export function readJSON(file, fallback = null) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
}

/** A value on one line, a space after each colon and comma. */
function inline(value) {
  if ( Array.isArray(value) ) return `[${value.map(inline).join(", ")}]`;
  if ( value && typeof value === "object" ) return `{${Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(", ")}}`;
  return JSON.stringify(value ?? null);
}

/**
 * JSON with one entry per line: the top level's keys each on a line of their own; a section that is an object or an
 * array, one entry per line (an object's keys sorted, `sort: false` to keep them as given); each entry on one line.
 * @param {object} value
 * @param {object} [o]
 * @param {boolean} [o.sort]   sort each section's keys (default true)
 */
export function linesJSON(value, { sort = true } = {}) {
  const lines = ["{"];
  const top = Object.entries(value ?? {}).filter(([, v]) => v !== undefined);
  top.forEach(([key, v], i) => {
    const comma = i < top.length - 1 ? "," : "";
    if ( Array.isArray(v) && v.length ) {
      lines.push(`  ${JSON.stringify(key)}: [`, ...v.map((x, j) => `    ${inline(x)}${j < v.length - 1 ? "," : ""}`), `  ]${comma}`);
    } else if ( v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length ) {
      const keys = sort ? Object.keys(v).sort() : Object.keys(v);
      lines.push(`  ${JSON.stringify(key)}: {`, ...keys.map((k, j) => `    ${JSON.stringify(k)}: ${inline(v[k])}${j < keys.length - 1 ? "," : ""}`), `  }${comma}`);
    } else lines.push(`  ${JSON.stringify(key)}: ${inline(v)}${comma}`);
  });
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

/** Write a ledger or snapshot (linesJSON), its folder made if need be, with LF line ends. */
export function writeJSON(file, value, o = {}) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, linesJSON(value, o));
}

/**
 * Two versions compared, part by part as numbers ("8.10.0" after "8.9.2"): negative, zero or positive. A part that
 * isn't a number compares as text.
 */
export function compareVersions(a, b) {
  const pa = String(a ?? "").split(/[.-]/);
  const pb = String(b ?? "").split(/[.-]/);
  for ( let i = 0; i < Math.max(pa.length, pb.length); i++ ) {
    const x = pa[i] ?? "0";
    const y = pb[i] ?? "0";
    const nx = Number(x);
    const ny = Number(y);
    const d = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y);
    if ( d ) return Math.sign(d);
  }
  return 0;
}

/**
 * A ledger entry stamped as reviewed: today's date, the system's version, its fresh fingerprints. What the team wrote
 * (how, note) is kept; `how` and `note` are set only where given.
 * @param {object|undefined} entry
 * @param {object} d
 * @param {string} d.version     the system's version reviewed against
 * @param {object} d.prints      {rules, text, ...}: the item's fresh fingerprints (null where it has none)
 * @param {string} [d.how]
 * @param {string} [d.note]
 * @param {string} [d.date]
 */
export function stamp(entry, { version, prints = {}, how, note, date = today() }) {
  return { how: how ?? entry?.how ?? "special", note: note ?? entry?.note ?? "", reviewed: date, system: version, ...prints };
}
