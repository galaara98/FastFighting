/**
 * A fresh scan of a game system's packs compared with a helper's review ledger and snapshot (tools/review): which
 * special cases changed, which generic readings changed, what's new and what's gone. Pure.
 */
import { compareVersions } from "./ledger.mjs";

/** A ledger entry's fields the team writes and the stamp sets, as against its fingerprints. */
export const META = Object.freeze(new Set(["how", "note", "reviewed", "system"]));

const asMap = m => (m instanceof Map ? m : new Map(Object.entries(m ?? {})));

/**
 * The special cases: each ledger entry's fingerprints against its fresh ones.
 * @param {object} entries          the ledger's {slug: entry}
 * @param {Map|object} fresh        slug -> its fresh fingerprints ({rules, text, ...}); none where the system has no item
 *                                  of that slug any more
 * @returns {{changed: {slug: string, entry: object, fields: string[]}[], gone: {slug: string, entry: object}[], same: number}}
 */
export function compareSpecial(entries, fresh) {
  const now = asMap(fresh);
  const changed = [];
  const gone = [];
  let same = 0;
  for ( const slug of Object.keys(entries ?? {}).sort() ) {
    const entry = entries[slug];
    const prints = now.get(slug);
    if ( !prints ) {
      gone.push({ slug, entry });
      continue;
    }
    const keys = new Set([...Object.keys(prints), ...Object.keys(entry ?? {}).filter(k => !META.has(k))]);
    const fields = [...keys].filter(k => (entry?.[k] ?? null) !== (prints[k] ?? null)).sort();
    if ( fields.length ) changed.push({ slug, entry, fields });
    else same++;
  }
  return { changed, gone, same };
}

/**
 * The generic readings: the snapshot's {slug: {built, count}} against a fresh one. `changed`: what the helper builds
 * from it isn't what it was; `added` and `removed`: slugs the system has now and hadn't, and the other way round.
 * @param {object} before
 * @param {Map|object} after
 */
export function compareGeneric(before, after) {
  const was = asMap(before);
  const now = asMap(after);
  const changed = [];
  const added = [];
  const removed = [];
  for ( const [slug, b] of was ) {
    const a = now.get(slug);
    if ( !a ) removed.push({ slug, before: b });
    else if ( a.built !== b.built ) changed.push({ slug, before: b, after: a });
  }
  for ( const [slug, a] of now ) if ( !was.has(slug) ) added.push({ slug, after: a });
  const order = (x, y) => ((y.after ?? y.before)?.count ?? 0) - ((x.after ?? x.before)?.count ?? 0) || x.slug.localeCompare(y.slug);
  return { changed: changed.sort(order), added: added.sort(order), removed: removed.sort(order) };
}

/**
 * The slugs the code names against the ledger: `unrecorded`, named with no entry (a special case that landed without
 * one); `unnamed`, entries the code no longer names (to drop, or the code lost a case).
 * @param {Iterable<string>} named   the system's slugs the helper's code names
 * @param {object} ledger            {entries, ignore}
 */
export function compareNamed(named, ledger) {
  const names = new Set(named);
  const entries = ledger?.entries ?? {};
  const ignore = ledger?.ignore ?? {};
  return {
    unrecorded: [...names].filter(s => !Object.hasOwn(entries, s) && !Object.hasOwn(ignore, s)).sort(),
    unnamed: Object.keys(entries).filter(s => !names.has(s)).sort()
  };
}

/** Is `version` newer than the ledger's last full check (`checked`)? */
export const newerThan = (version, checked) => !checked || compareVersions(version, checked) > 0;
