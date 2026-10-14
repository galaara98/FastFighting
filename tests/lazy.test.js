import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";
import { buildStory } from "../scripts/story/story.js";
import { storyTables } from "./foundry-i18n.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const english = storyTables();
const tables = { get: k => english[k] };
const at = (x, y = 0) => ({ x, y, size: 5 });

describe("lazy: a turn knowingly spent doing nothing", () => {
  test("the Lazy playstyle, with no foe beside it, now and then just doesn't; the story says so", () => {
    const pill = combinePlaystyles(["lazy"]);
    let lazy = 0;
    for ( let seed = 1; seed <= 20; seed++ ) {
      const spec = battle([
        creature({ id: "slob", name: "Slob", position: at(0), behavior: pill.behavior, playstyles: ["lazy"], hp: { value: 200, max: 200 },
          actions: [strike({ id: "bow", name: "Shortbow", melee: false, range: { increment: 60, max: 360 } })] }),
        creature({ id: "foe", name: "Foe", side: "hostile", position: at(60), hp: { value: 200, max: 200 }, actions: [strike({ bonus: -50, melee: false, range: { increment: 60, max: 360 } })] })
      ], { positioning: true, maxRounds: 4 });
      const r = replay(spec, pf2eRules, seed);
      const turns = r.log.filter(e => e.type === "lazy" && e.actorId === "slob");
      lazy += turns.length;
      // (Nothing else of its own in a lazy turn.)
      for ( const e of turns ) expect(r.log.filter(o => o.turn === e.turn && o.actorId === "slob" && !["thought", "lazy"].includes(o.type))).toEqual([]);
      if ( turns.length ) {
        const text = buildStory(r, spec, "roleplay", { tables, seed }).text;
        expect(english["condition.lazy"].some(l => text.includes(l.replace("{actor}", "Slob")))).toBe(true);
      }
    }
    expect(lazy).toBeGreaterThan(0);
  });

  test("creatures busy fighting are never called lazy", () => {
    for ( let seed = 1; seed <= 6; seed++ ) {
      const spec = battle([
        creature({ id: "pc", name: "Pc", kind: "pc", diesAtZero: false, hp: { value: 200, max: 200 } }),
        creature({ id: "foe", name: "Foe", side: "hostile", hp: { value: 200, max: 200 } })
      ], { maxRounds: 2 });
      const r = replay(spec, pf2eRules, seed);
      expect(r.log.filter(e => e.type === "lazy")).toEqual([]);
    }
  });
});
