/**
 * The review ledger's shared pieces, for every FastFighting helper (tools/review): so a game system's update or errata
 * never means reviewing every item. Developer tool, never in the module (the release zip leaves tools/ out).
 *
 * A helper keeps two files of its own (its review/ folder) and a small part that knows its system (its
 * tools/review.mjs: how to read the system's packs, which of its items the code names, what its readers build):
 *  - the ledger: one entry per special case, an item the helper's code recognises by slug or identifier, with the
 *    team's note on what's special and where, and fingerprints of the item's structure and description;
 *  - the snapshot: for the generic items its readers handle from structure, a fingerprint per slug of the shape of
 *    what the helper builds from it.
 * A check compares a fresh scan of the system's packs with both and reports special cases whose structure or text
 * changed, generic slugs whose built shape changed, new slugs (likely special cases flagged), and slugs the code names
 * that the system no longer has. Accepting re-stamps what was reviewed.
 *
 *   fingerprint.mjs  normalize, maskNumbers, withoutKeys, fingerprint, setPrint, printsPrint
 *   names.mjs        namesIn (the names a script quotes or uses as keys), sourceFiles, whereNamed, codeLink
 *   ledger.mjs       readJSON, writeJSON and linesJSON (one entry per line), stamp, compareVersions, today
 *   compare.mjs      compareSpecial, compareGeneric, compareNamed, newerThan
 *   report.mjs       buildReport, issueBody, issueTitle
 */
export * from "./fingerprint.mjs";
export * from "./names.mjs";
export * from "./ledger.mjs";
export * from "./compare.mjs";
export * from "./report.mjs";
