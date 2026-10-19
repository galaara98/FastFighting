/**
 * The record of the author writing FastFighting's English (docs/english-strings-handoff.md): every string in the six
 * repos, its status (todo, written, approved, skipped), when, and the commit that entered it. Approved: the author
 * reviewed the draft and accepted it as it stands; for Foundry's AI policy it's still a draft, not the author's writing. The entries come from the files
 * the words live in, so nothing is missed:
 *   - each repo's languages/en.json, one entry per key;
 *   - the core's story/en.json, one entry per list of phrases (the author writes a list at a time; its count is free);
 *   - each repo's module.json title and description;
 *   - the messages in the code for developers (console messages, errors thrown at other modules), which the author
 *     words in the code itself: one entry per message, by file, function and order.
 * Each entry keeps a hash of its text when it was last recorded, so a change made outside a recorded batch shows up.
 *
 *   node docs/strings/tracker.mjs sync              add new strings (todo), drop gone ones, flag changed ones
 *   node docs/strings/tracker.mjs status            what's left, by area
 *   node docs/strings/tracker.mjs check             exit 1 if anything changed outside a recorded batch
 *   node docs/strings/tracker.mjs list <area> [n]   the next n strings to write in an area (ids, placeholders)
 *   node docs/strings/tracker.mjs mark <written|written-same|approved|skipped> <commit> <id> ...   record a batch (text hashes
 *                                                  refreshed); written-same: written, the same as the draft it replaced
 *
 * The repos sit side by side: this one (FastFighting) and FastFighting-PF2e, -DnD5e, -DCC, -Ironsworn, -Daggerheart next
 * to it.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { createHash } from "crypto";
import { dirname, join, relative } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { parseAst } from "rolldown/parseAst";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, "..", "..");
const ROOT = join(CORE, "..");
const RECORD = join(HERE, "tracker.json");
const REPOS = { core: "FastFighting", pf2e: "FastFighting-PF2e", dnd5e: "FastFighting-DnD5e", dcc: "FastFighting-DCC", ironsworn: "FastFighting-Ironsworn", daggerheart: "FastFighting-Daggerheart" };

const hash = text => createHash("sha256").update(String(text)).digest("hex").slice(0, 12);
const today = () => new Date().toISOString().slice(0, 10);
export const placeholders = text => [...new Set(String(text).match(/\{[a-zA-Z]+\}/g) ?? [])];
const readJson = file => JSON.parse(readFileSync(file, "utf8"));

/** A nested object's string leaves as [path, value] (lists kept whole when `lists`). */
function leaves(o, prefix = "", { lists = false } = {}, out = []) {
  for ( const [k, v] of Object.entries(o) ) {
    const path = prefix ? `${prefix}.${k}` : k;
    if ( lists && Array.isArray(v) ) out.push([path, v]);
    else if ( v && typeof v === "object" ) leaves(v, path, { lists }, out);
    else out.push([path, v]);
  }
  return out;
}

/** The area a language key belongs to: its first two parts ("FASTFIGHTING.Settings"), or one for a short key. */
function areaOf(repo, key) {
  const parts = key.split(".");
  return `${repo}/${parts.length > 2 ? parts[1] : "General"}`;
}

/* -------------------------------------------- */
/*  Developer messages in the code              */
/* -------------------------------------------- */

function jsFiles(dir) {
  if ( !existsSync(dir) ) return [];
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? jsFiles(p) : p.endsWith(".js") ? [p] : [];
  });
}

/** A string or template literal's text, with ${…} where it fills something in. */
function literalText(node, src) {
  if ( node?.type === "Literal" && typeof node.value === "string" ) return node.value;
  if ( node?.type === "TemplateLiteral" ) return node.quasis.map(q => q.value.cooked).join("${…}");
  if ( node?.type === "BinaryExpression" && node.operator === "+" ) {
    const a = literalText(node.left, src);
    const b = literalText(node.right, src);
    return a === null && b === null ? null : `${a ?? "${…}"}${b ?? "${…}"}`;
  }
  return null;
}

/** Console messages and errors thrown, with words in them: [{id, text}]. */
function codeMessages(repoKey, repoDir) {
  const out = [];
  for ( const file of jsFiles(join(repoDir, "scripts")) ) {
    const src = readFileSync(file, "utf8");
    const ast = parseAst(src, { sourceType: "module" });
    const rel = relative(repoDir, file).replace(/\\/g, "/");
    const counts = new Map();
    const visit = (node, fn) => {
      if ( !node || typeof node.type !== "string" ) return;
      let scope = fn;
      if ( /Function|MethodDefinition|PropertyDefinition/.test(node.type) ) {
        scope = node.id?.name ?? node.key?.name ?? fn;
      }
      if ( node.type === "VariableDeclarator" && /Function/.test(node.init?.type ?? "") ) scope = node.id?.name ?? fn;
      let message = null;
      const callee = node.type === "CallExpression" ? node.callee : null;
      if ( callee?.type === "MemberExpression" && callee.object?.name === "console" ) message = node.arguments[0];
      if ( node.type === "NewExpression" && /Error$/.test(node.callee?.name ?? "") ) message = node.arguments[0];
      // (Make it So's undo names each step for its console message: step("removing a token", ...).)
      if ( callee?.type === "Identifier" && callee.name === "step" ) message = node.arguments[0];
      const text = message ? literalText(message, src) : null;
      const words = text?.replace(/\$\{…\}/g, " ").replace(/\b(?:FastFighting|fast-fighting(?:-\w+)?)\s*\|/g, " ");
      if ( text !== null && /[A-Za-z']{3,}/.test(words) ) {
        const where = `${rel}:${scope ?? "(top)"}`;
        const n = (counts.get(where) ?? 0) + 1;
        counts.set(where, n);
        out.push({ id: `${repoKey}:code:${where}#${n}`, text, file: rel, line: src.slice(0, node.start).split("\n").length });
      }
      for ( const [k, v] of Object.entries(node) ) {
        if ( k === "parent" ) continue;
        if ( Array.isArray(v) ) v.forEach(c => visit(c, scope));
        else if ( v && typeof v === "object" ) visit(v, scope);
      }
    };
    visit(ast.program ?? ast, null);
  }
  return out;
}

/* -------------------------------------------- */
/*  Every string, from the files                */
/* -------------------------------------------- */

/** Every string the author writes, as it stands now: id -> {repo, file, key, area, text}. */
export function current() {
  const now = {};
  const add = entry => { now[entry.id] = entry; };
  for ( const [repo, folder] of Object.entries(REPOS) ) {
    const dir = join(ROOT, folder);
    if ( !existsSync(dir) ) throw new Error(`${folder} isn't checked out beside FastFighting`);
    for ( const [key, text] of leaves(readJson(join(dir, "languages/en.json"))) ) {
      add({ id: `${repo}:${key}`, repo, file: "languages/en.json", key, area: areaOf(repo, key), text });
    }
    const manifest = readJson(join(dir, "module.json"));
    for ( const field of ["title", "description"] ) {
      add({ id: `${repo}:module.json:${field}`, repo, file: "module.json", key: field, area: "manifests", text: manifest[field] ?? "" });
    }
    for ( const m of codeMessages(repo, dir) ) {
      add({ id: m.id, repo, file: m.file, key: m.id.split(":code:")[1], area: `${repo}/code`, text: m.text, line: m.line });
    }
  }
  const story = readJson(join(CORE, "story/en.json"));
  for ( const [path, list] of leaves(story, "", { lists: true }) ) {
    if ( !Array.isArray(list) || list.every(p => p === "") ) continue; // (a list of silences: nothing to write)
    add({ id: `core:story:${path}`, repo: "core", file: "story/en.json", key: path, area: `core/story.${path.split(".")[0]}`, text: JSON.stringify(list), phrases: list.length });
  }
  return now;
}

export function load() {
  return existsSync(RECORD) ? readJson(RECORD) : { strings: {} };
}

function save(record) {
  const sorted = Object.fromEntries(Object.entries(record.strings).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(RECORD, `${JSON.stringify({ ...record, strings: sorted }, null, 1)}\n`);
}

/** Bring the record up to date with the files. Returns what changed. */
function sync(record) {
  const now = current();
  const added = [];
  const gone = [];
  const changed = [];
  for ( const [id, e] of Object.entries(now) ) {
    const prior = record.strings[id];
    if ( !prior ) {
      record.strings[id] = { repo: e.repo, file: e.file, key: e.key, area: e.area, status: "todo", date: null, commit: null, hash: hash(e.text) };
      added.push(id);
      continue;
    }
    Object.assign(prior, { file: e.file, key: e.key, area: e.area });
    if ( prior.hash !== hash(e.text) ) {
      prior.changed = true;
      changed.push(id);
    }
  }
  for ( const id of Object.keys(record.strings) ) {
    if ( !(id in now) && !record.strings[id].gone ) {
      record.strings[id].gone = today();
      gone.push(id);
    }
  }
  return { added, gone, changed, now };
}

/* -------------------------------------------- */
/*  Commands                                    */
/* -------------------------------------------- */

// (Imported rather than run, it only lends current() and load().)
const run = !!process.argv[1] && pathToFileURL(process.argv[1]).href.toLowerCase() === import.meta.url.toLowerCase();
const [command = "status", ...args] = run ? process.argv.slice(2) : ["none"];
const record = load();

if ( command === "none" ) {
  // (imported)
}

else if ( command === "sync" ) {
  const { added, gone, changed } = sync(record);
  save(record);
  console.log(`added ${added.length}, gone ${gone.length}, changed outside a recorded batch ${changed.length}`);
  for ( const id of changed ) console.log(`  changed: ${id}`);
  for ( const id of gone ) console.log(`  gone: ${id}`);
}

else if ( command === "check" ) {
  const { added, gone, changed } = sync(structuredClone(record));
  if ( added.length || gone.length || changed.length ) {
    for ( const id of added ) console.log(`new, not in the record: ${id}`);
    for ( const id of gone ) console.log(`gone from the files: ${id}`);
    for ( const id of changed ) console.log(`changed outside a recorded batch: ${id}`);
    process.exit(1);
  }
  console.log("The record matches the files.");
}

else if ( command === "status" ) {
  const by = new Map();
  for ( const e of Object.values(record.strings) ) {
    if ( e.gone ) continue;
    const row = by.get(e.area) ?? { todo: 0, written: 0, approved: 0, skipped: 0 };
    row[e.status] += 1;
    by.set(e.area, row);
  }
  const rows = [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  const total = { todo: 0, written: 0, approved: 0, skipped: 0 };
  const line = (area, r) => `${area.padEnd(34)} ${String(r.todo).padStart(6)} ${String(r.written).padStart(8)} ${String(r.approved).padStart(9)} ${String(r.skipped).padStart(8)}`;
  console.log(line("area", { todo: "todo", written: "written", approved: "approved", skipped: "skipped" }));
  for ( const [area, r] of rows ) {
    console.log(line(area, r));
    for ( const k of Object.keys(total) ) total[k] += r[k];
  }
  console.log(line("all", total));
  const same = Object.values(record.strings).filter(e => e.sameAsDraft && !e.gone && e.status === "written").length;
  if ( same ) console.log(`(${same} of those written came out the same as the draft they replaced)`);
  const flagged = Object.entries(record.strings).filter(([, e]) => e.changed && !e.gone).length;
  if ( flagged ) console.log(`\n${flagged} changed outside a recorded batch (node docs/strings/tracker.mjs sync lists them)`);
}

else if ( command === "list" ) {
  const [area, n = "10"] = args;
  const now = current();
  const next = Object.entries(record.strings).filter(([id, e]) => !e.gone && e.status === "todo" && (!area || e.area === area))
    .slice(0, Number(n));
  for ( const [id, e] of next ) {
    const text = now[id]?.text ?? "";
    const marks = placeholders(text);
    console.log(`${id}${marks.length ? `  keeps ${marks.join(" ")}` : ""}${now[id]?.phrases ? `  (${now[id].phrases} phrases now)` : ""}${now[id]?.line ? `  line ${now[id].line}` : ""}`);
  }
}

else if ( command === "mark" ) {
  const [status, commit, ...ids] = args;
  if ( !["written", "written-same", "approved", "skipped", "todo"].includes(status) || !commit || !ids.length ) {
    console.error("usage: mark <written|written-same|approved|skipped|todo> <commit> <id> ...");
    process.exit(2);
  }
  const now = current();
  for ( const id of ids ) {
    const e = record.strings[id];
    if ( !e || !now[id] ) throw new Error(`no such string: ${id}`);
    // (The author typed it; it came out the same as the draft it replaced, as convention would say it.)
    Object.assign(e, { status: status === "written-same" ? "written" : status, date: today(), commit, hash: hash(now[id].text) });
    if ( status === "written-same" ) e.sameAsDraft = true;
    else delete e.sameAsDraft;
    delete e.changed;
  }
  save(record);
  console.log(`marked ${ids.length} ${status} (${commit})`);
}

else {
  console.error(`unknown command: ${command}`);
  process.exit(2);
}
