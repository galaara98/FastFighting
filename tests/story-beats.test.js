import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { buildStory, storyBeats } from "../scripts/story/story.js";
import { storyTables } from "./foundry-i18n.js";
import { creature, strike, battle, social } from "./helpers.js";

const english = storyTables();
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

const words = s => s.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

describe("the story told a turn at a time", () => {
  test("Roleplay: every sentence of the story, once, in order, cut at the turns", () => {
    const spec = fight();
    for ( const seed of [3, 7, 11] ) {
      const result = replay(spec, pf2eRules, seed);
      const beats = storyBeats(result, spec, "roleplay", { tables, seed });
      const story = buildStory(result, spec, "roleplay", { tables, seed });
      expect(beats.map(b => b.text).filter(Boolean).join(" ")).toBe(words(story.html));
      // A beat for each turn, the closing last; a turn's beat is its creature's.
      // (Plain text: an apostrophe is an apostrophe, not &#39;.)
      expect(beats.some(b => /&(amp|lt|gt|quot|#39);/.test(b.text))).toBe(false);
      expect(beats.at(-1).closing).toBe(true);
      expect(beats.filter(b => b.closing)).toHaveLength(1);
      const turns = beats.flatMap(b => b.turns);
      expect(new Set(turns).size).toBe(turns.length);
      for ( const b of beats.filter(b => !b.closing && b.actorId) ) {
        expect(result.log.filter(e => b.turns.includes(e.turn)).every(e => e.turnOf === b.actorId)).toBe(true);
      }
    }
  });

  test("every move in the fight belongs to one beat", () => {
    const spec = fight();
    const result = replay(spec, pf2eRules, 7);
    const beats = storyBeats(result, spec, "roleplay", { tables, seed: 7 });
    const moves = result.log.filter(e => e.type === "move");
    expect(moves.length).toBeGreaterThan(0);
    for ( const m of moves ) expect(beats.filter(b => b.turns.includes(m.turn))).toHaveLength(1);
  });

  test("Standard: what each did on the turn, and the whole tally at the close", () => {
    const spec = fight();
    const result = replay(spec, pf2eRules, 7);
    const beats = storyBeats(result, spec, "standard", { tables, seed: 7 });
    const told = beats.filter(b => !b.closing && b.html);
    expect(told.length).toBeGreaterThan(1);
    for ( const b of told ) {
      const name = spec.combatants.find(c => c.id === b.actorId)?.name;
      if ( name ) expect(b.html).toContain(name);
    }
    expect(beats.at(-1).html).toBe(buildStory(result, spec, "standard").html);
  });

  test("a turn spent only talking is said aloud; one with a blow in it isn't", () => {
    const talker = creature({ id: "talker", name: "Talker", kind: "pc", diesAtZero: false,
      social: social({ diplomacy: 12, intimidation: 10, deception: 8 }), actions: [strike({ bonus: 2, damage: [parseFormula("1d4", "bludgeoning")] })] });
    const bandit = creature({ id: "bandit", name: "Bandit", side: "hostile", social: social({ diplomacy: 3, intimidation: 3, deception: 3 }) });
    let talking = 0;
    for ( let seed = 1; seed <= 40; seed++ ) {
      const spec = battle([talker, bandit]);
      const result = replay(spec, pf2eRules, seed);
      for ( const b of storyBeats(result, spec, "roleplay", { tables, seed }) ) {
        const own = result.log.filter(e => b.turns.includes(e.turn) && e.actorId === b.actorId);
        const struck = own.some(e => ["attack", "save", "move"].includes(e.type));
        if ( b.talking ) {
          talking++;
          expect(struck).toBe(false);
          expect(own.some(e => e.type === "talk")).toBe(true);
        }
      }
    }
    expect(talking).toBeGreaterThan(0);
  });
});
