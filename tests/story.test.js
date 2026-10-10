import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { buildStory, tierOf } from "../scripts/story/story.js";
import { buildEnglishTables, TIERS, DELIVERIES, DAMAGE_TYPES, TALK_SKILLS, RELATIONSHIPS, MOVE_MODES, MOVE_SITUATIONS } from "../scripts/story/tables-en.js";
import { creature, strike, battle } from "./helpers.js";

const english = buildEnglishTables();
const tables = { get: k => english[k] };

function fight() {
  const at = (x, y) => ({ x, y, size: 5 });
  const spec = battle([
    creature({ id: "amiri", name: "Amiri", kind: "pc", diesAtZero: false, position: at(0, 0), actions: [strike({ name: "Bastard Sword" })] }),
    creature({ id: "merisiel", name: "Merisiel", kind: "pc", diesAtZero: false, position: at(0, 10),
      actions: [strike({ id: "bow", name: "Shortbow", melee: false, range: { increment: 60, max: 360 }, damage: [parseFormula("1d6", "piercing")] })] }),
    creature({ id: "wolf", name: "Wolf", side: "hostile", position: at(40, 0), actions: [strike({ name: "Jaws", damage: [parseFormula("1d6+2", "piercing")] })] })
  ], { positioning: true });
  spec.approach = null;
  return spec;
}

describe("story tables", () => {
  test("every table has five entries", () => {
    const keys = [];
    for ( const d of DELIVERIES ) for ( const t of DAMAGE_TYPES ) for ( const tier of TIERS ) keys.push(`action.${d}.${t}.${tier}`);
    for ( const s of TALK_SKILLS ) for ( const tier of TIERS ) keys.push(`talk.${s}.${tier}`);
    for ( const r of RELATIONSHIPS ) for ( const p of ["success", "failure"] ) keys.push(`relationship.${r}.${p}`);
    for ( const m of MOVE_MODES ) for ( const s of MOVE_SITUATIONS ) keys.push(`move.${m}.${s}`);
    for ( const k of keys ) expect(english[k], k).toHaveLength(5);
    expect(Object.keys(english).length).toBeGreaterThan(450);
  });

  test("action entries within a table are all different", () => {
    for ( const [k, entries] of Object.entries(english) ) {
      if ( !k.startsWith("action.") ) continue;
      expect(new Set(entries).size, k).toBe(5);
    }
  });

  test("tiers from degree and margin", () => {
    expect(tierOf(3, 12)).toBe("criticalSuccess");
    expect(tierOf(2, 7)).toBe("majorSuccess");
    expect(tierOf(2, 0)).toBe("minorSuccess");
    expect(tierOf(2, 4)).toBe("success");
    expect(tierOf(1, -1)).toBe("minorFailure");
    expect(tierOf(1, -8)).toBe("majorFailure");
    expect(tierOf(0, -12)).toBe("criticalFailure");
  });
});

describe("story writer", () => {
  test("roleplay reads as prose with no leftover placeholders and no raw numbers", () => {
    const spec = fight();
    const result = replay(spec, pf2eRules, 7);
    const story = buildStory(result, spec, "roleplay", { tables, seed: 7, title: "Test" });
    expect(story.html).toMatch(/<p>/);
    expect(story.text).not.toMatch(/\{\w+\}/);
    expect(story.text).toMatch(/Amiri|Wolf/);
    expect(story.text).not.toMatch(/vs AC/);
  });

  test("standard lists each character and the outcome", () => {
    const spec = fight();
    const result = replay(spec, pf2eRules, 7);
    const story = buildStory(result, spec, "standard", { tables, seed: 7 });
    for ( const name of ["Amiri", "Merisiel", "Wolf"] ) expect(story.html).toContain(name);
  });

  test("statistician shows dice, modifiers and DCs", () => {
    const spec = fight();
    const result = replay(spec, pf2eRules, 7);
    const story = buildStory(result, spec, "statistician", { tables, seed: 7 });
    expect(story.text).toMatch(/d20 \d+ [+-]\d+ = \d+ vs AC \d+/);
  });

  test("the same seed tells the same story", () => {
    const spec = fight();
    const result = replay(spec, pf2eRules, 3);
    expect(buildStory(result, spec, "roleplay", { tables, seed: 3 }).text).toBe(buildStory(result, spec, "roleplay", { tables, seed: 3 }).text);
  });
});
