import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { readKeywordFile, mergeKeywords, keywordEffects, biographyEffects, PLAYSTYLE_WORD_CAP, TRAIT_WORD_CAP, STORY_WEIGHT } from "../scripts/engine/keywords.js";
import { applyBiography } from "../scripts/foundry/keywords.js";
import { PLAYSTYLES } from "../scripts/engine/playstyles.js";
import { TRAITS } from "../scripts/constants.js";

const RAW = readFileSync(new URL("../keywords/en.json", import.meta.url), "utf8");
const FILE = JSON.parse(RAW);
const ENGLISH = readKeywordFile(FILE);
const SCHEMA = JSON.parse(readFileSync(new URL("../keywords/keywords.schema.json", import.meta.url), "utf8"));

describe("the keyword file", () => {
  test("every entry is sound: lower case, known playstyles and traits, within bounds, each word once", () => {
    const ids = new Set(Object.keys(PLAYSTYLES));
    for ( const [word, entry] of Object.entries(FILE.words) ) {
      expect(word).toBe(word.trim().toLowerCase());
      expect(Object.keys(entry).every(k => ["playstyles", "traits", "whole"].includes(k)), word).toBe(true);
      for ( const [id, n] of Object.entries(entry.playstyles ?? {}) ) {
        expect(ids.has(id), `${word}: ${id}`).toBe(true);
        expect(Math.abs(n), `${word}: ${id}`).toBeLessThanOrEqual(PLAYSTYLE_WORD_CAP);
      }
      for ( const [k, n] of Object.entries(entry.traits ?? {}) ) {
        expect(TRAITS.includes(k), `${word}: ${k}`).toBe(true);
        expect(Math.abs(n), `${word}: ${k}`).toBeLessThanOrEqual(TRAIT_WORD_CAP);
      }
      expect(Object.keys(entry.playstyles ?? {}).length + Object.keys(entry.traits ?? {}).length, `${word} says nothing`).toBeGreaterThan(0);
    }
    // (JSON keeps the last of two entries for a word: the file must not have two.)
    const keys = [...RAW.matchAll(/^\s{4}"([^"]+)":/gm)].map(m => m[1]);
    expect(keys.length).toBe(new Set(keys).size);
    expect(FILE.negations.length).toBeGreaterThan(0);
  });

  test("the schema knows every playstyle and trait", () => {
    const entry = SCHEMA.properties.words.additionalProperties.properties;
    expect(Object.keys(entry.playstyles.properties).sort()).toEqual(Object.keys(PLAYSTYLES).sort());
    expect(Object.keys(entry.traits.properties).sort()).toEqual([...TRAITS].sort());
  });

  test("every playstyle has words that raise it, and villainy has as many as virtue", () => {
    const raises = id => Object.values(FILE.words).filter(e => (e.playstyles?.[id] ?? 0) > 0).length;
    for ( const id of Object.keys(PLAYSTYLES) ) expect(raises(id), id).toBeGreaterThan(0);
    const selfish = Object.values(FILE.words).filter(e => (e.traits?.selfish ?? 0) > 0).length;
    const selfless = Object.values(FILE.words).filter(e => (e.traits?.selfish ?? 0) < 0).length;
    expect(selfish).toBeGreaterThan(selfless);
  });
});

describe("what a text's keywords say", () => {
  test("words raise and lower traits and playstyles, each once, the start of a word", () => {
    const fx = keywordEffects("A greedy, ruthless sellsword. Greedy to the bone.", ENGLISH);
    expect(fx.traits.selfish).toBeGreaterThan(10);
    expect(fx.playstyles.mercenary).toBeGreaterThan(0);
    expect(fx.found).toContain("greed");
    expect(fx.found.filter(w => w === "greed").length).toBe(1);
  });

  test("a negation just before a word cancels it, in the same sentence only", () => {
    expect(keywordEffects("She is never cruel.", ENGLISH).found).not.toContain("cruel");
    expect(keywordEffects("He wasn’t a coward.", ENGLISH).found).not.toContain("coward");
    expect(keywordEffects("Not tall. Cruel to the core.", ENGLISH).found).toContain("cruel");
    // (Far enough back, a negation is about something else.)
    expect(keywordEffects("None of the guards are kind to her; she is cruel.", ENGLISH).found).toContain("cruel");
  });

  test("a whole word only, where it says so", () => {
    expect(keywordEffects("She generally keeps to herself.", ENGLISH).found).not.toContain("general");
    expect(keywordEffects("The general rides at dawn.", ENGLISH).found).toContain("general");
    expect(keywordEffects("Its corruption spreads.", ENGLISH).found).not.toContain("corrupt");
  });

  test("held in: a long list of the same sort of word is no stronger than the caps", () => {
    const fx = keywordEffects("Cruel, sadistic, vicious, ruthless, merciless, depraved, wicked, vile, evil, selfish.", ENGLISH);
    expect(fx.traits.selfish).toBe(TRAIT_WORD_CAP);
    expect(fx.playstyles.cruel).toBe(PLAYSTYLE_WORD_CAP);
  });

  test("a translation adds its words to the English ones, and its entry for a word takes the English one's place", () => {
    const es = readKeywordFile({ negations: ["nunca"], words: { cruel: { traits: { selfish: 3 } }, "codicioso": { traits: { selfish: 9 } } } });
    const both = mergeKeywords(ENGLISH, es);
    expect(keywordEffects("Un hombre codicioso", both).traits.selfish).toBe(9);
    expect(keywordEffects("A greedy man", both).traits.selfish).toBeGreaterThan(0);
    expect(keywordEffects("Cruel", both).traits.selfish).toBe(3);
    expect(keywordEffects("Nunca codicioso", both).found).toEqual([]);
  });
});

describe("a story told about a character", () => {
  test("counts a little: its words may be about anyone in it", () => {
    const told = biographyEffects({ story: "The cruel ones burned her village." }, ENGLISH);
    const said = biographyEffects({ about: "Cruel." }, ENGLISH);
    expect(told.traits.selfish).toBeCloseTo(said.traits.selfish * STORY_WEIGHT);
    expect(biographyEffects("Cruel.", ENGLISH).traits.selfish).toBe(said.traits.selfish);
    expect(biographyEffects({ about: "Kind-hearted.", story: "Cruel bandits." }, ENGLISH).traits.selfish).toBeLessThan(0);
  });
});

describe("a biography's words in a character's traits", () => {
  const spec = () => ({ traits: { tactical: { base: 50, fudge: 0 }, brave: { base: 50, fudge: 0 }, selfish: { base: 40, fudge: 0 }, loyal: { base: 50, fudge: 0 } }, traitReasons: { selfish: "kin" }, flags: {} });

  test("the traits move, and the words are in the reasons", () => {
    const s = applyBiography(spec(), "A cowardly, greedy little thief.", ENGLISH);
    expect(s.traits.brave.base).toBeLessThan(50);
    expect(s.traits.selfish.base).toBeGreaterThan(40);
    expect(s.traitReasons.selfish).toContain("kin");
    expect(s.traitReasons.selfish).toContain("greed");
    expect(s.traits.tactical.base).toBe(50);
  });

  test("not for the mindless or a hazard", () => {
    const mindless = { ...spec(), flags: { mindless: true } };
    expect(applyBiography(mindless, "Cruel and cowardly.", ENGLISH).traits.brave.base).toBe(50);
    expect(applyBiography({ ...spec(), hazard: { once: true } }, "Cruel and cowardly.", ENGLISH).traits.selfish.base).toBe(40);
  });
});
