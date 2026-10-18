/**
 * The names a helper's scripts use, for its review ledger (tools/review): the kebab-case and plain words they quote
 * ("shield-block", "rend") and the words they use as object keys (`evasion: "reflex"`). Which of them are the system's
 * slugs is the helper's to say (its packs, its ledger). Also where each is named, for links to the code. Pure.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** A quoted name: lower-case words joined by hyphens ("shield-block", "rend", "summon-animal"). */
const QUOTED = /(["'`])([a-z0-9]+(?:-[a-z0-9]+)*)\1/g;
/** An object key that isn't quoted: after "{" or "," (or starting a line), before ":" (not "::", not "?:"). */
const KEY = /(?:[{,]|^)\s*([a-z][a-z0-9]*)\s*:(?!:)/gm;

/**
 * The names a source uses: {hyphenated (quoted, with a hyphen), words (quoted, one word), keys (unquoted object keys)}.
 * @param {string} text
 */
export function namesIn(text) {
  const source = String(text ?? "");
  const hyphenated = new Set();
  const words = new Set();
  for ( const m of source.matchAll(QUOTED) ) (m[2].includes("-") ? hyphenated : words).add(m[2]);
  const keys = new Set([...source.matchAll(KEY)].map(m => m[1]));
  return { hyphenated, words, keys };
}

/**
 * A folder's source files, as {file (relative to `root`, with forward slashes), text}.
 * @param {string} dir
 * @param {object} [o]
 * @param {string} [o.root]        what `file` is relative to (default: the folder's parent)
 * @param {RegExp} [o.match]       which files (default: .js and .mjs)
 */
export function sourceFiles(dir, { root = join(dir, ".."), match = /\.m?js$/ } = {}) {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(f => match.test(f)).sort()
    .map(f => ({ file: relative(root, join(dir, f)).split(sep).join("/"), text: readFileSync(join(dir, f), "utf8") }));
}

/**
 * Where each name is used: name -> [{file, line}] (1-based), a quoted use or an object key, in the order found.
 * @param {{file: string, text: string}[]} files
 * @param {Iterable<string>} names
 */
export function whereNamed(files, names) {
  const wanted = new Set(names);
  const out = new Map([...wanted].map(n => [n, []]));
  for ( const { file, text } of files ) {
    String(text).split(/\r?\n/).forEach((line, i) => {
      const found = new Set();
      for ( const m of line.matchAll(QUOTED) ) if ( wanted.has(m[2]) ) found.add(m[2]);
      for ( const m of line.matchAll(/(?:[{,]|^)\s*([a-z][a-z0-9]*)\s*:(?!:)/g) ) if ( wanted.has(m[1]) ) found.add(m[1]);
      for ( const n of found ) out.get(n).push({ file, line: i + 1 });
    });
  }
  return out;
}

/**
 * A link to a line of code on GitHub, or the plain place where there's no repository to link to.
 * @param {{file: string, line: number}} at
 * @param {object} [o]
 * @param {string} [o.repo]   "owner/name"
 * @param {string} [o.ref]    a commit or branch
 */
export function codeLink({ file, line }, { repo = null, ref = "main" } = {}) {
  const place = `${file.split("/").pop()}:${line}`;
  return repo ? `[${place}](https://github.com/${repo}/blob/${ref}/${file}#L${line})` : place;
}
