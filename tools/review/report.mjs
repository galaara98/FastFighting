/**
 * What a review check found, written for the team (tools/review): the report a check prints and the body of the
 * GitHub issue the system-watch workflow opens. It holds slugs, counts, which fingerprints changed, the team's own notes
 * and links to the code that handles each special case; never the system's text. Pure.
 */

/** The issue's title for a system's version (one issue per version: the workflow looks for it first). */
export const issueTitle = (system, version) => `${system} ${version}: what changed for FastFighting`;

/** GitHub's limit on an issue's body is 65536 characters: the body stops short of it. */
export const ISSUE_LIMIT = 60000;

const esc = s => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map(r => `| ${r.map(esc).join(" | ")} |`)];
const code = s => `\`${s}\``;

/**
 * A section of the report: its title and count, a line on what it means, its rows (at most `limit`, the rest
 * counted).
 */
function section(title, rows, { intro = "", head = [], limit = 200, after = [] } = {}) {
  if ( !rows.length ) return [];
  const shown = rows.slice(0, limit);
  return [`## ${title} (${rows.length})`, "", ...(intro ? [intro, ""] : []), ...table(head, shown),
    ...(rows.length > shown.length ? ["", `... and ${rows.length - shown.length} more (the full list: run the check yourself).`] : []), ...(after.length ? ["", ...after] : []), ""];
}

/**
 * The report, as Markdown, and whether it found anything to look at.
 * @param {object} d
 * @param {string} d.system          the system's name ("PF2e")
 * @param {string} d.version         the version checked
 * @param {string} [d.source]        where its packs came from (said in a line)
 * @param {string} [d.checked]       the version the ledger was last fully checked against
 * @param {string} [d.snapshot]      the snapshot's version
 * @param {{slug, how, note, fields: string[], code: string[]}[]} [d.special]   special cases whose fingerprints changed
 * @param {{slug, how, note, named: boolean, code: string[]}[]} [d.gone]        ledger slugs the system no longer has
 * @param {{slug, code: string[]}[]} [d.unrecorded]  slugs the code names with no ledger entry
 * @param {{slug, how}[]} [d.unnamed]                ledger entries the code no longer names
 * @param {{slug, before, after}[]} [d.generic]      generic slugs whose built shape changed ({built, count} each)
 * @param {{slug, kind, count, level, why: string[]}[]} [d.added]   new slugs, `why` saying what makes one a candidate
 * @param {{slug, count}[]} [d.removed]              generic slugs the system no longer has
 * @param {{title, intro, head, rows}[]} [d.extra]   sections of the helper's own
 * @param {object} [d.commands]                      {check, accept, acceptGeneric}: how to run each, for the reader
 * @param {object} [o]
 * @param {number} [o.limit]    rows a section shows at most
 * @returns {{text: string, clean: boolean, counts: object}}
 */
export function buildReport(d, { limit = 200 } = {}) {
  const special = d.special ?? [];
  const gone = d.gone ?? [];
  const unrecorded = d.unrecorded ?? [];
  const unnamed = d.unnamed ?? [];
  const generic = d.generic ?? [];
  const added = d.added ?? [];
  const removed = d.removed ?? [];
  const extra = (d.extra ?? []).filter(x => x.rows?.length);
  const candidates = added.filter(a => a.why?.length);
  const counts = { special: special.length, gone: gone.length, unrecorded: unrecorded.length, unnamed: unnamed.length, generic: generic.length,
    added: added.length, candidates: candidates.length, removed: removed.length, extra: extra.reduce((n, x) => n + x.rows.length, 0) };
  const clean = Object.values(counts).every(n => !n);
  const cmd = d.commands ?? {};
  const out = [`# ${issueTitle(d.system, d.version)}`, ""];
  out.push(`Checked ${d.system} ${d.version}${d.source ? ` (${d.source})` : ""} against the review ledger${d.checked ? ` (last checked against ${d.checked})` : ""} and the snapshot${d.snapshot ? ` (${d.snapshot})` : ""}.`, "");
  if ( clean ) out.push("Nothing changed for FastFighting: no special case, no generic reading, no new slug, nothing gone.", "");
  else {
    out.push(`- Special cases to review: ${counts.special}; gone from the system: ${counts.gone}; named in the code with no ledger entry: ${counts.unrecorded}; in the ledger, no longer named: ${counts.unnamed}.`,
      `- Generic readings that changed: ${counts.generic}; new slugs: ${counts.added} (${counts.candidates} look like special cases); slugs gone: ${counts.removed}.`, "");
  }
  out.push(...section("Special cases to review", special.map(s => [code(s.slug), s.how, s.fields.join(", "), s.note, s.code.join(", ")]), {
    intro: "Items the code recognises by slug whose structure (`rules`) or description (`text`) changed. Check the code that handles each, then re-stamp it.",
    head: ["slug", "how", "changed", "what's special", "code"], limit,
    after: cmd.accept ? [`Once reviewed: \`${cmd.accept} <slug ...>\``] : [] }));
  out.push(...section("Gone: slugs the code names that the system no longer has", gone.map(s => [code(s.slug), s.how, s.named ? "yes" : "no", s.note, s.code.join(", ")]), {
    intro: "Removed or renamed. Find what replaced each, and change the code and the ledger.", head: ["slug", "how", "still named", "what's special", "code"], limit }));
  out.push(...section("Named in the code with no ledger entry", unrecorded.map(s => [code(s.slug), s.code.join(", ")]), {
    intro: "A special case that landed unrecorded: write its note and stamp it.", head: ["slug", "code"], limit,
    after: cmd.accept ? [`\`${cmd.accept} <slug> --note "what's special, and where"\``] : [] }));
  out.push(...section("In the ledger, no longer named in the code", unnamed.map(s => [code(s.slug), s.how]), {
    intro: "Drop each from the ledger, unless the code lost a case it should still handle.", head: ["slug", "how"], limit }));
  for ( const x of extra ) out.push(...section(x.title, x.rows, { intro: x.intro, head: x.head, limit }));
  out.push(...section("Generic readings that changed", generic.map(g => [code(g.slug), g.before?.count ?? 0, g.after?.count ?? 0]), {
    intro: "Items the readers handle from their structure, where what the helper builds (numbers masked, over every creature that has it) isn't what it was. A look at each is enough.",
    head: ["slug", "count before", "count now"], limit, after: cmd.acceptGeneric ? [`Once looked at: \`${cmd.acceptGeneric}\``] : [] }));
  const ordered = [...candidates, ...added.filter(a => !a.why?.length)];
  out.push(...section("New slugs", ordered.map(a => [code(a.slug), a.kind ?? "", a.count ?? "", a.level ?? "", (a.why ?? []).join("; ")]), {
    intro: "Slugs the system has now and the snapshot hadn't, likely special cases first (why: in the system's glossary, like a special case's slug, or common and not understood).",
    head: ["slug", "kind", "count", "understood", "why"], limit }));
  out.push(...section("Generic slugs gone", removed.map(r => [code(r.slug), r.before?.count ?? r.count ?? ""]), { head: ["slug", "count before"], limit }));
  if ( cmd.check ) out.push("---", "", `Run the check yourself: \`${cmd.check}\``, "");
  return { text: `${out.join("\n").trim()}\n`, clean, counts };
}

/**
 * The GitHub issue's body: the report, cut short of GitHub's limit (whole lines, with a note) where it's longer.
 * @param {string} text   buildReport's
 * @param {object} [o]
 * @param {number} [o.limit]
 * @param {string} [o.footer]   a line for the end (where the run is, how it was made)
 */
export function issueBody(text, { limit = ISSUE_LIMIT, footer = "" } = {}) {
  const end = footer ? `\n${footer}\n` : "";
  if ( text.length + end.length <= limit ) return `${text}${end}`;
  const note = "\n... cut short: the full report is the workflow run's artifact.\n";
  const room = limit - end.length - note.length;
  const cut = text.lastIndexOf("\n", room);
  return `${text.slice(0, cut > 0 ? cut : room)}${note}${end}`;
}
