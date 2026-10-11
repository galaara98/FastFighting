/**
 * The author's writing batches: the next strings to write, in the order a GM meets them, as a CSV for Excel. Each row
 * says where the string shows, the file it lives in, what it's for, what to keep, the text now (a draft to rewrite),
 * and has a column for the author's own words.
 *   node docs/strings/batch.mjs [size]      writes docs/strings/batches/batch-NN.csv (50 strings by default)
 *   node docs/strings/batch.mjs --list      the next batch, without writing it (and which strings need a purpose)
 * A string answered in an earlier batch stays out, unless its text has changed since; one left blank comes back.
 * What each string is for: the short strings' descriptions (short-strings.mjs), else docs/strings/purposes.json.
 * The repos sit side by side, as for tracker.mjs.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { current, load, placeholders } from "./tracker.mjs";
import { describe, isShort, parseCsv } from "./short-strings.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, "..", "..");
const BATCHES = join(HERE, "batches");
const PURPOSES = join(HERE, "purposes.json");
const FOLDERS = { core: "FastFighting", pf2e: "FastFighting-PF2e", dnd5e: "FastFighting-DnD5e", dcc: "FastFighting-DCC", ironsworn: "FastFighting-Ironsworn" };
const HELPERS = { pf2e: "PF2e", dnd5e: "D&D 5e", dcc: "DCC", ironsworn: "Ironsworn" };

/* -------------------------------------------- */
/*  Where a GM meets each string                */
/* -------------------------------------------- */

/**
 * The Settings window, top to bottom: the buttons that open dialogs (each followed by its dialog's words), then each
 * setting (its name, its hint and its dropdown's choices) in the order the module registers them.
 */
function settingsScreen() {
  const src = readFileSync(join(CORE, "scripts/settings.js"), "utf8");
  const screen = [
    ["Story tables (button and dialog)", ["FASTFIGHTING.Story.TablesMenu", "FASTFIGHTING.Story.Tables", "FASTFIGHTING.Story.Install", "FASTFIGHTING.Story.Reinstall", "FASTFIGHTING.Story.Installing", "FASTFIGHTING.Story.Installed"]],
    ["Generic system (button and dialog)", ["FASTFIGHTING.Generic."]],
    ["Side personality defaults (button and dialog)", ["FASTFIGHTING.Settings.sideDefaults.", "FASTFIGHTING.Defaults."]]
  ];
  // (Each named as the window shows it.)
  const names = JSON.parse(readFileSync(join(CORE, "languages/en.json"), "utf8")).FASTFIGHTING.Settings;
  for ( const m of src.matchAll(/^ {2}(\w+): \{ type: \w+,[^\n]*$/gm) ) {
    const choices = /choices: choices\(.*?, "([\w.]+)"\)/.exec(m[0])?.[1];
    screen.push([`Setting: ${names[m[1]]?.Name ?? m[1]}`, [`FASTFIGHTING.Settings.${m[1]}.`, ...(choices ? [`FASTFIGHTING.${choices}.`] : [])]]);
  }
  return screen;
}

/** The places, in the order a GM meets them: [place, part, test(entry)]. The first that fits a string is its place. */
function places() {
  const core = (e, ...prefixes) => e.repo === "core" && e.file === "languages/en.json" && prefixes.some(p => e.key.startsWith(p));
  const list = settingsScreen().map(([part, prefixes]) => ["Settings: FastFighting (Configure Settings)", part, e => core(e, ...prefixes)]);
  for ( const [repo, name] of Object.entries(HELPERS) ) {
    list.push([`Settings: FastFighting ${name} (Configure Settings)`, "Its settings", e => e.repo === repo && e.area === `${repo}/Settings`]);
  }
  list.push(
    ["Configure Controls", "The keyboard shortcut", e => core(e, "FASTFIGHTING.Keybinding.")],
    ["Notices and the Combat Tracker", "The Combat Tracker's button", e => core(e, "FASTFIGHTING.Tracker.")],
    ["Notices and the Combat Tracker", "Notices about system helpers", e => core(e, "FASTFIGHTING.Helper.")],
    ["Notices and the Combat Tracker", "Notices about translations", e => core(e, "FASTFIGHTING.Translation.")],
    ["Words used in many places", "Lists and distances", e => core(e, "FASTFIGHTING.Words.", "FASTFIGHTING.Units.")],
    ["Battle Planner", "The window, its options and each creature's row", e => core(e, "FASTFIGHTING.Planner.")],
    ["Battle Planner", "Sides", e => core(e, "FASTFIGHTING.Side.")],
    ["Battle Planner", "Personality traits and their bands", e => core(e, "FASTFIGHTING.Trait.", "FASTFIGHTING.Band.")],
    ["Battle Planner", "Stats, badges and movement", e => core(e, "FASTFIGHTING.Stat.", "FASTFIGHTING.Kind.", "FASTFIGHTING.Mode.", "FASTFIGHTING.Fudge.")],
    ["Battle Planner", "Tactics, playstyles and desires (also the players' survey)", e => core(e, "FASTFIGHTING.Tactics.", "FASTFIGHTING.Playstyle.", "FASTFIGHTING.Desire.")],
    ["Battle Planner: results", "Overview, combatants, swing factors, resources", e => core(e, "FASTFIGHTING.Results.", "FASTFIGHTING.Difficulty.", "FASTFIGHTING.Swing.", "FASTFIGHTING.Status.")],
    ["Battle Planner: results", "Sample fight", e => core(e, "FASTFIGHTING.Sample.")],
    ["Make it So (dialog and chat cards)", "What changes, and the summary", e => core(e, "FASTFIGHTING.MakeItSo.", "FASTFIGHTING.Summary.", "FASTFIGHTING.Concession.")],
    ["Make it So (dialog and chat cards)", "Effects on creatures", e => core(e, "FASTFIGHTING.Effect.")],
    ["Players' tactics survey", "The survey window", e => core(e, "FASTFIGHTING.Survey.")],
    ["Chat: the story of the fight", "The story card and its styles", e => core(e, "FASTFIGHTING.Story.") && !e.key.startsWith("FASTFIGHTING.Story.Labels.") && !e.key.startsWith("FASTFIGHTING.Story.Part.")],
    ["Chat: the story of the fight", "Standard story: each character's line", e => core(e, "FASTFIGHTING.Story.Labels.")],
    ["Chat: the story of the fight", "Roleplay story: its phrases (story/en.json)", e => e.repo === "core" && e.file === "story/en.json"],
    ["Chat: the story of the fight", "Statistician story: the battle log", e => core(e, "FASTFIGHTING.Log.")],
    ["Chat: the story of the fight", "Damage types", e => core(e, "FASTFIGHTING.DamageType.")],
    ["Rollable Tables sidebar", "Story table names", e => core(e, "FASTFIGHTING.Story.Part.")]
  );
  for ( const [repo, name] of Object.entries(HELPERS) ) {
    list.push([`System helper: FastFighting ${name}`, "Its words (planner, story, log, Make it So)", e => e.repo === repo && e.file === "languages/en.json"]);
  }
  list.push(
    ["The module listing", "Each module's title and description (module.json)", e => e.file === "module.json"],
    ["Developer messages (console and errors, English only)", "Written straight into the code", e => e.area.endsWith("/code")],
    ["Everything else", "", () => true]
  );
  return list;
}

/* -------------------------------------------- */
/*  What a row says                             */
/* -------------------------------------------- */

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);

/** What to keep: placeholders, spaces at either end, markup, a list's shape. */
function keeps(e) {
  const notes = [];
  if ( e.file === "story/en.json" ) notes.push("a list: one phrase per line (Alt+Enter starts a new line in a cell); as many phrases as you like");
  if ( e.area.endsWith("/code") ) notes.push("${…} is where the code fills something in");
  const text = e.file === "story/en.json" ? JSON.parse(e.text).join("\n") : String(e.text);
  const marks = placeholders(text);
  if ( marks.length ) notes.push(`keep ${marks.join(" ")}`);
  if ( /<[a-z][^>]*>/i.test(text) ) notes.push("keep the <tags>");
  if ( /^\s/.test(text) ) notes.push("starts with a space");
  if ( /\s$/.test(text) ) notes.push("ends with a space");
  return notes.join("; ");
}

/** The text as the author reads it: a story list one phrase per line. */
const shown = e => (e.file === "story/en.json" ? JSON.parse(e.text).join("\n") : String(e.text));

/** The answers in the batches so far: id -> the text the row showed then. */
function answeredBefore() {
  const out = new Map();
  if ( !existsSync(BATCHES) ) return out;
  for ( const f of readdirSync(BATCHES).filter(f => /^batch-\d+\.csv$/.test(f)).sort() ) {
    const [head, ...body] = parseCsv(readFileSync(join(BATCHES, f), "utf8").replace(/^﻿/, ""));
    const col = name => head.indexOf(name);
    for ( const r of body ) if ( (r[col("Yours")] ?? "").trim() ) out.set(r[col("Id")], r[col("Now (my draft)")]);
  }
  return out;
}

/* -------------------------------------------- */
/*  The next batch                              */
/* -------------------------------------------- */

const args = process.argv.slice(2);
const size = Number(args.find(a => /^\d+$/.test(a)) ?? 50);
const now = current();
const record = load();
const purposes = readJson(PURPOSES, {});
const before = answeredBefore();
const order = places();

const todo = Object.values(now).filter(e => {
  const r = record.strings[e.id];
  if ( !r || r.gone || r.status !== "todo" ) return false;
  return !(before.has(e.id) && before.get(e.id) === shown(e));
});
const indexed = new Map(Object.keys(now).map((id, i) => [id, i]));
const placed = todo.map(e => {
  const rank = order.findIndex(([, , test]) => test(e));
  return { e, rank, place: order[rank][0], part: order[rank][1] };
}).sort((a, b) => a.rank - b.rank || indexed.get(a.e.id) - indexed.get(b.e.id));

// A batch doesn't split a setting (its name, hint and choices) or a group of keys: the rest of it comes along.
const group = key => key.split(".").slice(0, -1).join(".");
const together = (a, b) => a.rank === b.rank && (a.part.startsWith("Setting: ") || group(a.e.key) === group(b.e.key));
let take = Math.min(size, placed.length);
while ( take < placed.length && together(placed[take], placed[take - 1]) ) take++;
const batch = placed.slice(0, take);

const missing = [];
const rows = batch.map(({ e, place, part }, i) => {
  const short = e.file === "languages/en.json" && isShort(e.text) ? describe(e.repo, e.key, e.text) : null;
  const what = purposes[e.id] ?? (short?.what ? `${short.what}${short.where ? ` (${short.where})` : ""}` : "");
  if ( !what ) missing.push(e.id);
  const notes = [short?.limits, keeps(e)].filter(Boolean).join("; ");
  const file = `${FOLDERS[e.repo]}/${e.file}${e.line ? ` (line ${e.line})` : ""}`;
  return [i + 1, place, part, file, e.key, what, notes, shown(e), "", e.id];
});
if ( args.includes("--list") ) {
  for ( const r of rows ) console.log(`${r[0]}\t${r[9]}\t${r[2]}${r[5] ? "" : "\t(no purpose yet)"}`);
  process.exit(0);
}
if ( missing.length ) {
  console.error(`No purpose yet for ${missing.length} (docs/strings/purposes.json):\n${missing.join("\n")}`);
  process.exit(1);
}

mkdirSync(BATCHES, { recursive: true });
const n = existsSync(BATCHES) ? readdirSync(BATCHES).filter(f => /^batch-\d+\.csv$/.test(f)).length + 1 : 1;
const out = join(BATCHES, `batch-${String(n).padStart(2, "0")}.csv`);
const cell = v => `"${String(v).replace(/"/g, "\"\"")}"`;
const head = ["#", "Where you see it", "Part of it", "File", "Key", "What it's for", "Keep", "Now (my draft)", "Yours", "Id"];
writeFileSync(out, `﻿${[head, ...rows].map(r => r.map(cell).join(",")).join("\r\n")}\r\n`);
console.log(`${rows.length} strings in ${out} (${placed.length - rows.length} more after these)`);
