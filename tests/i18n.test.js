import { afterEach, describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { replay } from "../scripts/engine/simulator.js";
import { localize, listJoin, commonOutcome } from "../scripts/i18n.js";
import { logLine, LOG_ENGLISH } from "../scripts/story/log-lines.js";
import { buildStory } from "../scripts/story/story.js";
import { buildEnglishTables } from "../scripts/story/tables-en.js";
import { NEUTRAL_PARTY } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle, social } from "./helpers.js";

const read = file => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const flatten = (o, p = "", out = {}) => {
  for ( const [k, v] of Object.entries(o) ) {
    if ( v && typeof v === "object" ) flatten(v, `${p}${k}.`, out);
    else out[`${p}${k}`] = v;
  }
  return out;
};
const en = flatten(read("languages/en.json"));
const placeholders = s => [...new Set(String(s).match(/\{[a-zA-Z]+\}/g) ?? [])].filter(p => p !== "{target}").sort();

/**
 * A made-up language for the tests: English with its vowels accented and each string in ⟦brackets⟧, its {placeholders}
 * and markup kept. No real translation, so the tests can tell what went through localization: plain English in the
 * output didn't.
 */
const ACCENT = { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" };
const pseudo = s => `⟦${String(s).split(/(\{[^}]+\}|<[^>]+>)/).map((part, i) => (i % 2 ? part : part.replace(/[aeiouAEIOU]/g, c => ACCENT[c]))).join("")}⟧`;
const xx = Object.fromEntries(Object.entries(en).map(([k, v]) => [k, pseudo(v)]));

/** Pretend to be a Foundry client in the made-up language (its English falls back as Foundry's does). */
function pseudoClient() {
  globalThis.game = { i18n: { lang: "xx", has: k => k in xx || k in en, localize: k => xx[k] ?? en[k] ?? k } };
}
afterEach(() => { delete globalThis.game; });

/** Story tables in the made-up language, with a possessive that agrees with the weapon ({su}, as some languages need). */
function pseudoTables() {
  const english = buildEnglishTables();
  const own = Object.fromEntries(Object.entries(english).map(([k, entries]) => [k, entries.map(line => pseudo(line.replace(/\btheir \{weapon\}/g, "{su} {weapon}")))]));
  return { lang: "xx", possessive: weapon => (/s$/i.test(weapon) ? "⟦théír⟧" : "⟦hís⟧"), get: k => own[k] ?? english[k] };
}

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

  test("the log's English in the code is the English in the language file", () => {
    for ( const [k, v] of Object.entries(LOG_ENGLISH) ) expect(en[`FASTFIGHTING.Log.${k}`]).toBe(v);
  });
});

describe("in another language", () => {
  test("words in the reader's language, English without Foundry", () => {
    expect(listJoin(["Amiri", "Ezren", "Lini"])).toBe("Amiri, Ezren and Lini");
    pseudoClient();
    expect(listJoin(["Amiri", "Ezren", "Lini"])).toBe("Amiri, Ezren ⟦ánd⟧ Lini");
    expect(localize("FASTFIGHTING.MakeItSo.Outcome.Dead", "Dead")).toBe("⟦Déád⟧");
    expect(commonOutcome({ hp: { value: 20 }, kind: "npc" }, { hp: 0, status: "dead" })).toEqual(["⟦HP 20 → 0⟧", "⟦Déád⟧"]);
  });

  test("a whole fight, told every way, with nothing left in English or unfilled", () => {
    const tables = pseudoTables();
    const spec = battle([
      creature({ id: "pc", name: "Amiri", kind: "pc", diesAtZero: false, hp: { value: 50, max: 50 }, social: social({ diplomacy: 8 }), valuables: { money: 80 } }),
      creature({ id: "orc", name: "Orc", side: "hostile", hp: { value: 30, max: 30 }, social: social({ diplomacy: 2 }) }),
      creature({ id: "elder", name: "Elder", side: NEUTRAL_PARTY, originSide: "neutral", lean: "friendly", social: social({ diplomacy: 1 }), playstyles: ["moralist"] })
    ], { maxRounds: 5, opening: "talk" });
    pseudoClient();
    let possessives = 0;
    for ( let seed = 1; seed <= 6; seed++ ) {
      const r = replay(spec, pf2eRules, seed);
      for ( const e of r.log ) {
        // (Words with no vowels, "vs" and "DC", read the same in the made-up language: not checked.)
        if ( !LOG_TYPES_WITH_SYSTEM_TEXT.has(e.type) ) expect(logLine(e)).not.toMatch(/\b(the|attacks|takes|falls|win after)\b|undefined|\{[a-zA-Z]+\}/);
      }
      for ( const style of ["roleplay", "standard", "statistician"] ) {
        const story = buildStory(r, spec, style, { tables, seed });
        expect(story.text).not.toMatch(/undefined|NaN|\{[a-zA-Z]+\}/);
        possessives += (story.text.match(/⟦(hís|théír)⟧/g) ?? []).length;
      }
    }
    expect(possessives).toBeGreaterThan(0);
    const one = buildStory(replay(spec, pf2eRules, 2), spec, "statistician", { tables, seed: 2 }).text;
    expect(one).toMatch(/⟦/);
  });
});

/** Lines a game system words itself (recovery checks and the like): the system translates those. */
const LOG_TYPES_WITH_SYSTEM_TEXT = new Set(["adjust", "endure", "startTurn", "recovery", "body"]);
