/**
 * Temporary: Speed Runner became DPS. These tests keep the alias and the one-time migration working for the releases
 * that carry them, and fail once the core reaches REMOVE_AT, so neither lives on unnoticed. Then remove:
 *  - the alias (engine/playstyles.js RENAMED_PLAYSTYLES' speedRunner),
 *  - the migration (foundry/migrate-playstyles.js, and its call in main.js),
 *  - this file.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { PLAYSTYLES, PLAYSTYLE_IDS, combinePlaystyles, currentPlaystyle, currentPlaystyles, currentPlaystyleMap } from "../../scripts/engine/playstyles.js";
import { readKeywordFile, keywordEffects } from "../../scripts/engine/keywords.js";
import { sanitizeTactics } from "../../scripts/foundry/tactics.js";
import { playstyleFixes } from "../../scripts/foundry/migrate-playstyles.js";

const ROOT = path.join(import.meta.dirname, "..", "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8")).version;
/** The release these tests, the alias and the migration go with. */
const REMOVE_AT = "0.7.0";
const older = (a, b) => {
  const [x, y] = [a, b].map(v => String(v).split(".").map(n => Number(n) || 0));
  for ( let i = 0; i < 3; i++ ) if ( (x[i] ?? 0) !== (y[i] ?? 0) ) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
};

describe("temporary: Speed Runner is DPS now", () => {
  test(`expires at ${REMOVE_AT}`, () => {
    expect(older(VERSION, REMOVE_AT), `FastFighting ${VERSION} has reached ${REMOVE_AT}: remove the speedRunner alias (engine/playstyles.js RENAMED_PLAYSTYLES), the migration (foundry/migrate-playstyles.js and its call in main.js) and tests/temporary/speedrunner-to-dps.test.js`).toBe(true);
  });

  test("the alias: wherever playstyles are read, speedRunner is dps, each once", () => {
    expect(currentPlaystyle("speedRunner")).toBe("dps");
    expect(currentPlaystyle("cruel")).toBe("cruel");
    expect(currentPlaystyles(["speedRunner", "dps", "cruel", "nope"])).toEqual(["dps", "cruel"]);
    const map = currentPlaystyleMap({ speedRunner: 0.4, dps: 0.2, brawler: 0.3 });
    expect(Object.keys(map)).toEqual(["dps", "brawler"]);
    expect(map.dps).toBeCloseTo(0.6);
    // (A character's stored answers, as the survey and the planner read them.)
    expect(sanitizeTactics({ playstyles: ["speedRunner", "chicken", "dps"] }).playstyles).toEqual(["dps", "chicken"]);
    // (A keyword file written before: its speedRunner points count toward DPS.)
    const words = readKeywordFile({ words: { hasty: { playstyles: { speedRunner: 1 } } } });
    expect(keywordEffects("A hasty duelist.", words).playstyles).toEqual({ dps: 1 });
    // (A helper's hints that still name it: the set-aside helpers'.)
    expect(combinePlaystyles(currentPlaystyles(["speedRunner"])).ids).toEqual(["dps"]);
  });

  test("the migration, over actors' flags: their pills and their auto setup's picks, once; nothing else touched", () => {
    const flags = { "fast-fighting": { tactics: { playstyles: ["speedRunner", "brawler"], talk: "never" }, auto: { picked: ["dps", "speedRunner"] } } };
    expect(playstyleFixes(flags)).toEqual({ "flags.fast-fighting.tactics.playstyles": ["dps", "brawler"], "flags.fast-fighting.auto.picked": ["dps"] });
    expect(playstyleFixes({ "fast-fighting": { tactics: { playstyles: ["dps"] } } })).toBeNull();
    expect(playstyleFixes({ "fast-fighting": { auto: { picked: ["speedRunner"] } } })).toEqual({ "flags.fast-fighting.auto.picked": ["dps"] });
    expect(playstyleFixes({})).toBeNull();
    expect(playstyleFixes(null)).toBeNull();
    // (Run again on what it wrote: nothing more.)
    expect(playstyleFixes({ "fast-fighting": { tactics: { playstyles: ["dps", "brawler"] }, auto: { picked: ["dps"] } } })).toBeNull();
  });

  test("nothing in the core offers Speed Runner any more", () => {
    expect(PLAYSTYLE_IDS).not.toContain("speedRunner");
    expect(Object.hasOwn(PLAYSTYLES, "speedRunner")).toBe(false);
    const en = JSON.parse(fs.readFileSync(path.join(ROOT, "languages", "en.json"), "utf8"));
    expect(en.FASTFIGHTING.Playstyle.speedRunner).toBeUndefined();
    const keywords = fs.readFileSync(path.join(ROOT, "keywords", "en.json"), "utf8");
    expect(keywords).not.toContain("speedRunner");
    expect(fs.readFileSync(path.join(ROOT, "keywords", "keywords.schema.json"), "utf8")).not.toContain("speedRunner");
    expect(fs.readFileSync(path.join(ROOT, "keywords", "README.md"), "utf8")).not.toContain("speedRunner");
  });
});
