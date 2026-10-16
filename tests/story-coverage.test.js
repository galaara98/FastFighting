/**
 * Every condition and maneuver the story can tell has words enough: at least three lines to choose from, and a line
 * for its best and its worst; and every condition the core can lay reaches one of them.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { CONDITIONS, MANEUVERS, conditionOf } from "../scripts/story/master.js";
import { CORE_CONDITIONS } from "../scripts/engine/conditions.js";

const story = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "story", "en.json"), "utf8"));
const lines = key => story[key]?.length ?? 0;
/** Told by events of their own (falling, dying), not as conditions. */
const OUTCOMES = new Set(["dying", "dead"]);

describe("the story's words for conditions and maneuvers", () => {
  test("each: three lines or more, and one for its best and one for its worst", () => {
    const short = [];
    for ( const [kind, ids] of [["condition", CONDITIONS.filter(id => !OUTCOMES.has(id))], ["maneuver", MANEUVERS]] ) {
      for ( const id of ids ) {
        if ( lines(`${kind}.${id}`) < 3 || lines(`${kind}.${id}.amazing`) < 1 || lines(`${kind}.${id}.terrible`) < 1 ) short.push(`${kind}.${id}`);
      }
    }
    expect(short).toEqual([]);
  });

  test("every condition the core can lay reaches one", () => {
    const untold = CORE_CONDITIONS.map(c => c.key).filter(k => !lines(`condition.${conditionOf(k, null)}`));
    expect(untold).toEqual([]);
  });
});
