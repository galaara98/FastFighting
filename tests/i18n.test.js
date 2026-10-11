import { afterEach, describe, expect, test } from "vitest";
import { readFileSync } from "fs";
import { replay } from "../scripts/engine/simulator.js";
import { localize, listJoin, commonOutcome } from "../scripts/i18n.js";
import { logLine, LOG_ENGLISH } from "../scripts/story/log-lines.js";
import { buildStory } from "../scripts/story/story.js";
import { buildEnglishTables } from "../scripts/story/tables-en.js";
import { buildSpanishTables, possessive } from "../scripts/story/tables-es.js";
import { NEUTRAL_PARTY } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle, social } from "./helpers.js";

const read = lang => JSON.parse(readFileSync(new URL(`../languages/${lang}.json`, import.meta.url), "utf8"));
const flatten = (o, p = "", out = {}) => {
  for ( const [k, v] of Object.entries(o) ) {
    if ( v && typeof v === "object" ) flatten(v, `${p}${k}.`, out);
    else out[`${p}${k}`] = v;
  }
  return out;
};
const en = flatten(read("en"));
const es = flatten(read("es"));
const placeholders = s => [...new Set(String(s).match(/\{[a-zA-Z]+\}/g) ?? [])].filter(p => p !== "{target}").sort();

/** Pretend to be a Spanish Foundry client (its English falls back as Foundry's does). */
function spanish() {
  globalThis.game = { i18n: { lang: "es", has: k => k in es || k in en, localize: k => es[k] ?? en[k] ?? k } };
}
afterEach(() => { delete globalThis.game; });

describe("the language files", () => {
  test("Spanish has every key English has (and no others), with the same placeholders", () => {
    expect(Object.keys(es).filter(k => !(k in en))).toEqual([]);
    expect(Object.keys(en).filter(k => !(k in es))).toEqual([]);
    for ( const k of Object.keys(en) ) expect([k, placeholders(es[k])]).toEqual([k, placeholders(en[k])]);
  });

  test("the log's English in the code is the English in the language file", () => {
    for ( const [k, v] of Object.entries(LOG_ENGLISH) ) expect(en[`FASTFIGHTING.Log.${k}`]).toBe(v);
  });

  test("the module offers Spanish", () => {
    const m = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
    expect(m.languages.map(l => l.lang)).toEqual(expect.arrayContaining(["en", "es"]));
  });
});

describe("the Spanish story tables", () => {
  test("every table the English has, five entries each, nothing left unfilled", () => {
    const e = buildEnglishTables();
    const s = buildSpanishTables();
    expect(Object.keys(s).sort()).toEqual(Object.keys(e).sort());
    for ( const [k, entries] of Object.entries(s) ) {
      expect([k, entries.length]).toEqual([k, 5]);
      for ( const line of entries ) expect(line).not.toMatch(/\{(aim|hit|wound|graze|miss|crit|botch|verb|good|bad)\}/);
    }
  });

  test("su or sus before a weapon, by whether its name reads as plural", () => {
    expect(possessive("Espada larga")).toBe("su");
    expect(possessive("Garras")).toBe("sus");
    expect(possessive("Fauces")).toBe("sus");
    expect(possessive("Longsword")).toBe("su");
    expect(possessive("Jaws")).toBe("sus");
  });
});

describe("in Spanish", () => {
  test("words in the reader's language, English without Foundry", () => {
    expect(listJoin(["Amiri", "Ezren", "Lini"])).toBe("Amiri, Ezren and Lini");
    spanish();
    expect(listJoin(["Amiri", "Ezren", "Lini"])).toBe("Amiri, Ezren y Lini");
    expect(localize("FASTFIGHTING.MakeItSo.Outcome.Dead", "Dead")).toBe("Muerto");
    expect(commonOutcome({ hp: { value: 20 }, kind: "npc" }, { hp: 0, status: "dead" })).toEqual(["PG 20 → 0", "Muerto"]);
  });

  test("a whole fight, told every way, with nothing left in English or unfilled", () => {
    const english = buildEnglishTables();
    const s = buildSpanishTables();
    const tables = { lang: "es", possessive, get: k => s[k] ?? english[k] };
    const spec = battle([
      creature({ id: "pc", name: "Amiri", kind: "pc", diesAtZero: false, hp: { value: 50, max: 50 }, social: social({ diplomacy: 8 }), valuables: { money: 80 } }),
      creature({ id: "orc", name: "Orco", side: "hostile", hp: { value: 30, max: 30 }, social: social({ diplomacy: 2 }) }),
      creature({ id: "elder", name: "Anciana", side: NEUTRAL_PARTY, originSide: "neutral", lean: "friendly", social: social({ diplomacy: 1 }), playstyles: ["moralist"] })
    ], { maxRounds: 5, opening: "talk" });
    spanish();
    for ( let seed = 1; seed <= 6; seed++ ) {
      const r = replay(spec, pf2eRules, seed);
      for ( const e of r.log ) {
        if ( !LOG_TYPES_WITH_SYSTEM_TEXT.has(e.type) ) expect(logLine(e)).not.toMatch(/\b(the|vs|attacks|takes|falls|win after)\b|undefined|\{[a-zA-Z]+\}/);
      }
      for ( const style of ["roleplay", "standard", "statistician"] ) {
        const story = buildStory(r, spec, style, { tables, seed });
        expect(story.text).not.toMatch(/undefined|NaN|\{[a-zA-Z]+\}/);
      }
    }
    const one = buildStory(replay(spec, pf2eRules, 2), spec, "statistician", { tables, seed: 2 }).text;
    expect(one).toMatch(/contra|Iniciativa/);
  });
});

/** Lines a game system words itself (recovery checks and the like): the system translates those. */
const LOG_TYPES_WITH_SYSTEM_TEXT = new Set(["adjust", "endure", "startTurn", "recovery", "body"]);
