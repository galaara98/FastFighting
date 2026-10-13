import { afterEach, describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { replay } from "../scripts/engine/simulator.js";
import { localize, listJoin, commonOutcome, term, hasStat, setTermSource, escapeHtml, inertHtml, brief, TIP_WORDS, TIP_SENTENCES } from "../scripts/i18n.js";
import { logLine } from "../scripts/story/log-lines.js";
import { buildStory } from "../scripts/story/story.js";
import { isBlocks, buildTables } from "../scripts/story/blocks.js";
import { loadStoryTables, invalidateStoryTables } from "../scripts/story/tables.js";
import { NEUTRAL_PARTY } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle, social } from "./helpers.js";
import { en, flatten, text, storyTables, storyFile } from "./foundry-i18n.js";

const read = file => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const placeholders = s => [...new Set(String(s).match(/\{[a-zA-Z]+\}/g) ?? [])].filter(p => p !== "{target}").sort();

/**
 * A made-up language for the tests: English with its vowels accented and each string in ⟦brackets⟧, its {placeholders}
 * and markup kept. No real translation, so the tests can tell what went through localization: plain English in the
 * output didn't.
 */
const ACCENT = { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" };
const pseudo = s => `⟦${String(s).split(/(\{[^}]+\}|<[^>]+>)/).map((part, i) => (i % 2 ? part : part.replace(/[aeiouAEIOU]/g, c => ACCENT[c]))).join("")}⟧`;

/**
 * Pretend to be a Foundry client in another language. Foundry falls back to English for any key the language's file
 * lacks: `words` is that file (flat), all of English's keys by default.
 */
function client(lang, words) {
  globalThis.game = { i18n: { lang, has: k => k in words || k in en, localize: k => words[k] ?? en[k] ?? k, format: k => words[k] ?? en[k] ?? k } };
}
const pseudoClient = () => client("xx", Object.fromEntries(Object.entries(en).map(([k, v]) => [k, pseudo(v)])));
afterEach(() => { delete globalThis.fetch; invalidateStoryTables(); });

/** The story tables in the made-up language. */
function pseudoTables() {
  const own = Object.fromEntries(Object.entries(storyTables()).map(([k, entries]) => [k, entries.map(pseudo)]));
  return { lang: "xx", get: k => own[k] };
}

/** Every file under a folder with one of these endings. */
function sources(dir, endings = [".js"]) {
  const url = new URL(`../${dir}/`, import.meta.url);
  return readdirSync(url).flatMap(f => (statSync(new URL(f, url)).isDirectory() ? sources(`${dir}/${f}`, endings)
    : endings.some(e => f.endsWith(e)) ? [`${dir}/${f}`] : []));
}

/** A fight with talking, a bystander, money and an ending: most of what the log and the stories can say. */
function talkingFight() {
  return battle([
    creature({ id: "pc", name: "Amiri", kind: "pc", diesAtZero: false, hp: { value: 50, max: 50 }, social: social({ diplomacy: 8 }), valuables: { money: 80 } }),
    creature({ id: "orc", name: "Orc", side: "hostile", hp: { value: 30, max: 30 }, social: social({ diplomacy: 2 }) }),
    creature({ id: "elder", name: "Elder", side: NEUTRAL_PARTY, originSide: "neutral", lean: "friendly", social: social({ diplomacy: 1 }), playstyles: ["moralist"] })
  ], { maxRounds: 5, opening: "talk" });
}

/** Lines a game system words itself (recovery checks and the like): the system translates those. */
const LOG_TYPES_WITH_SYSTEM_TEXT = new Set(["adjust", "endure", "startTurn", "recovery", "body"]);

describe("the language files", () => {
  test("every language the module lists has a file with only English's keys, and the same placeholders", () => {
    const m = read("module.json");
    expect(m.languages.map(l => l.lang)).toContain("en");
    for ( const { lang, path } of m.languages ) {
      const other = flatten(read(path));
      expect([lang, Object.keys(other).filter(k => !(k in en))]).toEqual([lang, []]);
      for ( const k of Object.keys(other) ) expect([lang, k, placeholders(other[k])]).toEqual([lang, k, placeholders(en[k])]);
    }
  });

  test("no language file is left out of the manifest", () => {
    const listed = read("module.json").languages.map(l => l.path);
    const files = readdirSync(new URL("../languages/", import.meta.url)).filter(f => f.endsWith(".json")).map(f => `languages/${f}`);
    expect(files.filter(f => !listed.includes(f))).toEqual([]);
  });

  test("every story file is building blocks shaped like English's, or finished tables of English's keys", () => {
    const english = read("story/en.json");
    expect(isBlocks(english)).toBe(true);
    const keys = new Set(Object.keys(storyTables()));
    for ( const f of readdirSync(new URL("../story/", import.meta.url)).filter(f => f.endsWith(".json") && f !== "en.json") ) {
      const data = read(`story/${f}`);
      const tables = isBlocks(data) ? buildTables(data) : data;
      expect([f, Object.keys(tables).filter(k => !keys.has(k))]).toEqual([f, []]);
      for ( const [k, entries] of Object.entries(tables) ) expect([f, k, Array.isArray(entries)]).toEqual([f, k, true]);
    }
  });

  test("the code holds no English: nothing beside a key for when it has no words", () => {
    // localize("KEY", "English"), t("KEY", "English") and the like: the English belongs in languages/en.json.
    const call = /\b(localize|outcomeLine|logTerm|t|w|word)\(\s*(`[^`]*`|"[^"]*"|'[^']*'|[\w.$]+)\s*,\s*["'`]/g;
    const found = [];
    for ( const file of sources("scripts") ) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      for ( const m of source.matchAll(call) ) found.push(`${file}: ${m[0]}`);
    }
    expect(found).toEqual([]);
  });
});

describe("every key the module asks for has words", () => {
  test("each key the code and templates name is in languages/en.json (or names a group of keys)", () => {
    const missing = [];
    for ( const file of [...sources("scripts"), ...sources("templates", [".hbs"])] ) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      // (A key the code completes, FASTFIGHTING.Trait.${trait}, names its group: FASTFIGHTING.Trait.)
      for ( const [key] of source.matchAll(/FASTFIGHTING(?:\.[\w-]+)+/g) ) {
        if ( !(key in en) && !Object.keys(en).some(k => k.startsWith(`${key}.`)) ) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("each part of a story table's key has a name, for the tables a GM installs", () => {
    const parts = new Set(Object.keys(storyTables()).flatMap(k => k.split(".")));
    expect([...parts].filter(p => !(`FASTFIGHTING.Story.Part.${p}` in en))).toEqual([]);
  });
});

describe("in another language", () => {
  test("words in the reader's language", () => {
    expect(listJoin(["Amiri", "Ezren", "Lini"])).toBe(text("FASTFIGHTING.Words.List", {
      rest: `Amiri${text("FASTFIGHTING.Words.ListSeparator")}Ezren`, last: "Lini"
    }));
    pseudoClient();
    expect(listJoin(["Amiri", "Ezren", "Lini"])).toBe(pseudo(en["FASTFIGHTING.Words.List"])
      .replace("{rest}", `Amiri${pseudo(en["FASTFIGHTING.Words.ListSeparator"])}Ezren`).replace("{last}", "Lini"));
    expect(localize("FASTFIGHTING.MakeItSo.Outcome.Dead")).toBe(pseudo(en["FASTFIGHTING.MakeItSo.Outcome.Dead"]));
    expect(commonOutcome({ hp: { value: 20 }, kind: "npc" }, { hp: 0, status: "dead" })).toEqual([
      pseudo(en["FASTFIGHTING.MakeItSo.Outcome.Hp"]).replace("{HP}", pseudo(en["FASTFIGHTING.Stat.hp"])).replace("{from}", "20").replace("{to}", "0"),
      pseudo(en["FASTFIGHTING.MakeItSo.Outcome.Dead"])
    ]);
  });

  test("a whole fight, told every way, with nothing left in English, unfilled or missing", () => {
    const tables = pseudoTables();
    const spec = talkingFight();
    pseudoClient();
    for ( let seed = 1; seed <= 6; seed++ ) {
      const r = replay(spec, pf2eRules, seed);
      for ( const e of r.log ) {
        // (Words with no vowels, "vs" and "DC", read the same in the made-up language: not checked.)
        if ( !LOG_TYPES_WITH_SYSTEM_TEXT.has(e.type) ) expect(logLine(e)).not.toMatch(/\b(the|attacks|takes|falls|win after)\b|undefined|FASTFIGHTING\.|\{[a-zA-Z]+\}/);
      }
      for ( const style of ["roleplay", "standard", "statistician"] ) {
        const story = buildStory(r, spec, style, { tables, seed });
        expect(story.text).not.toMatch(/undefined|NaN|FASTFIGHTING\.|\{[a-zA-Z]+\}/);
      }
    }
    const one = buildStory(replay(spec, pf2eRules, 2), spec, "statistician", { tables, seed: 2 }).text;
    expect(one).toMatch(/⟦/);
  });
});

describe("a language the module isn't (fully) translated into reads in English", () => {
  test("no file for the language: everything in English", () => {
    const spec = talkingFight();
    const r = replay(spec, pf2eRules, 3);
    const english = r.log.map(logLine);
    client("pt-BR", {});
    expect(r.log.map(logLine)).toEqual(english);
    expect(listJoin(["Amiri", "Lini"])).toBe(text("FASTFIGHTING.Words.List", { rest: "Amiri", last: "Lini" }));
  });

  test("a half-done file: what it has in its language, the rest in English", () => {
    const half = Object.fromEntries(Object.entries(en).filter((e, i) => i % 2).map(([k, v]) => [k, pseudo(v)]));
    client("xx", half);
    const missing = Object.keys(en).find(k => !(k in half) && !/\{/.test(en[k]));
    const there = Object.keys(half).find(k => !/\{/.test(en[k]));
    expect(localize(missing)).toBe(en[missing]);
    expect(localize(there)).toBe(pseudo(en[there]));
    const spec = talkingFight();
    for ( let seed = 1; seed <= 3; seed++ ) {
      const r = replay(spec, pf2eRules, seed);
      for ( const style of ["standard", "statistician"] ) expect(buildStory(r, spec, style, { seed }).text).not.toMatch(/undefined|NaN|FASTFIGHTING\.|\{[a-zA-Z]+\}/);
    }
  });

  test("a key with no words anywhere comes back as itself, without breaking anything", () => {
    expect(localize("FASTFIGHTING.No.Such.Key")).toBe("FASTFIGHTING.No.Such.Key");
    expect(localize("FASTFIGHTING.No.Such.Key", { n: 1 })).toBe("FASTFIGHTING.No.Such.Key");
    delete globalThis.game;
    expect(localize("FASTFIGHTING.Words.ListSeparator")).toBe("FASTFIGHTING.Words.ListSeparator");
  });

  /** A Foundry world for the story tables: no RollTables of its own, and the module's story files to fetch. */
  function storyWorld(lang, files) {
    client(lang, {});
    Object.assign(globalThis.game, { tables: [], users: [] });
    globalThis.fetch = async url => {
      const name = String(url).split("/").pop();
      return name in files ? { ok: true, json: async () => files[name] } : { ok: false, json: async () => null };
    };
  }

  test("story tables: a language with no story file tells it in English", async () => {
    storyWorld("pt-BR", { "en.json": storyFile() });
    const tables = await loadStoryTables();
    expect(tables.lang).toBe("en");
    expect(tables.get("event.opening")).toEqual(storyTables()["event.opening"]);
  });

  test("story tables: a partial translation, as finished tables or as building blocks, falls back to English", async () => {
    storyWorld("xx", { "en.json": storyFile(), "xx.json": { "event.opening": ["⟦Ópéníng⟧"] } });
    let tables = await loadStoryTables();
    expect(tables.lang).toBe("xx");
    expect(tables.get("event.opening")).toEqual(["⟦Ópéníng⟧"]);
    expect(tables.get("event.death")).toEqual(storyTables()["event.death"]);

    invalidateStoryTables();
    const blocks = storyFile();
    blocks.event = { opening: ["⟦Ópéníng⟧"] };
    storyWorld("yy", { "en.json": storyFile(), "yy.json": blocks });
    tables = await loadStoryTables();
    expect(tables.get("event.opening")).toEqual(["⟦Ópéníng⟧"]);
    expect(tables.get("event.death")).toEqual(storyTables()["event.death"]);
  });

  test("story tables: building blocks half translated tell the rest in English, never a bare {placeholder}", async () => {
    const blocks = storyFile();
    blocks.shapes.melee.success = ["⟦{actor} {aim}: {hit} {target}⟧"];
    delete blocks.damage;
    blocks.talkShapes = {};
    storyWorld("zz", { "en.json": storyFile(), "zz.json": blocks });
    const tables = await loadStoryTables();
    const english = storyTables();
    expect(tables.get("action.melee.fire.success")).toEqual(english["action.melee.fire.success"]);
    expect(tables.get("talk.persuade.success")).toEqual(english["talk.persuade.success"]);
    expect(tables.get("event.opening")).toEqual(blocks.event.opening);
  });

  test("story tables: with no story file at all, the story is quiet rather than broken", async () => {
    storyWorld("en", {});
    const tables = await loadStoryTables();
    expect(tables.get("event.opening")).toBe(null);
    const spec = talkingFight();
    const story = buildStory(replay(spec, pf2eRules, 1), spec, "roleplay", { tables, seed: 1 });
    expect(story.text).not.toMatch(/undefined|NaN|\{[a-zA-Z]+\}/);
  });
});

describe("the game's words for armor class and hit points", () => {
  afterEach(() => setTermSource(null));
  const generic = key => en[`FASTFIGHTING.Stat.${key}`];

  test("FastFighting's generic words, unless the system's helper has its own; {AC} and {HP} in any text take them", () => {
    expect(term("ac")).toBe(generic("ac"));
    expect(term("hp")).toBe(generic("hp"));
    expect(localize("FASTFIGHTING.Planner.DiesAtZero")).toBe(en["FASTFIGHTING.Planner.DiesAtZero"].replace("{HP}", generic("hp")));
    setTermSource(key => (key === "ac" ? "<ac>" : null));
    expect(term("ac")).toBe("<ac>");
    expect(term("hp")).toBe(generic("hp")); // (none of its own: the generic word)
    expect(localize("FASTFIGHTING.Stat.leadAc")).toBe(en["FASTFIGHTING.Stat.leadAc"].replace("{AC}", "<ac>"));
    // The values filled in are never mistaken for the words.
    const line = localize("FASTFIGHTING.Log.FinalLine", { name: "Amiri", status: "", swayed: "", now: 3, max: 9, dying: "", wounded: "" });
    expect(line).toContain("3/9");
    expect(line).toContain(generic("hp"));
    expect(line).not.toMatch(/\{[A-Za-z]+\}/);
  });

  test("a system with no armor class doesn't show one; a helper that fails leaves the generic words", () => {
    expect(hasStat("ac")).toBe(true);
    setTermSource(key => (key === "ac" ? false : null));
    expect(hasStat("ac")).toBe(false);
    expect(hasStat("hp")).toBe(true);
    expect(term("ac")).toBe(generic("ac")); // (text that names it anyway)
    setTermSource(() => { throw new Error("no system yet"); });
    expect(term("hp")).toBe(generic("hp"));
    expect(hasStat("ac")).toBe(true);
  });

  test("templates show text with {AC}, {HP}, {SP} or {MONEY} through ffLocalize, which fills them (Foundry's localize wouldn't)", () => {
    const plain = [];
    for ( const file of sources("templates", [".hbs"]) ) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      for ( const [, key] of source.matchAll(/\{\{localize "([^"]+)"/g) ) if ( /\{(AC|HP|SP|MONEY)\}/.test(en[key] ?? "") ) plain.push(`${file}: ${key}`);
    }
    expect(plain).toEqual([]);
  });
});

describe("chat cards", () => {
  test("a name can't become a roll, a link or a reference in a chat card, and still reads as written", () => {
    const html = `<p>${escapeHtml("[[/r 1d6]] @UUID[Actor.x]{Boss} &Reference[prone]")}</p>`;
    const inert = inertHtml(html);
    expect(inert).not.toMatch(/\[\[|@UUID\[|&amp;Reference/);
    expect(inert.replace(/⁠/g, "")).toBe(html);
  });
});

describe("tooltips", () => {
  const words = s => String(s).replace(/{[^}]+}/g, "X").split(/s+/).filter(Boolean).length;
  const sentences = s => String(s).replace(/(e.g|i.e|etc|vs)./gi, "$1").split(/[.!?]+(?=s|$)/).filter(x => x.trim()).length;

  test("every tooltip says it in 50 words and 3 sentences at most", () => {
    const strings = flatten(JSON.parse(readFileSync(new URL("../languages/en.json", import.meta.url), "utf8")));
    const tips = new Set(Object.keys(strings).filter(k => /Hint$/.test(k) && !/.Settings./.test(k)));
    for ( const file of sources("templates", [".hbs"]) ) {
      for ( const m of readFileSync(file, "utf8").matchAll(/data-tooltip="{{localize "([^"]+)"}}"/g) ) tips.add(m[1]);
    }
    const long = [...tips].filter(k => strings[k] !== undefined && (words(strings[k]) > TIP_WORDS || sentences(strings[k]) > TIP_SENTENCES));
    expect(long).toEqual([]);
  });

  test("a tooltip built from a character's data is cut short", () => {
    expect(brief("A. B. C. D.")).toBe("A. B. C.");
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    expect(brief(long).split(" ")).toHaveLength(TIP_WORDS);
    expect(brief(long).endsWith("…")).toBe(true);
    expect(brief("Short and sweet.")).toBe("Short and sweet.");
  });
});
