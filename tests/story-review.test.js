import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { buildStory } from "../scripts/story/story.js";
import { endLine } from "../scripts/story/log-lines.js";
import { maneuverOf } from "../scripts/story/master.js";
import { storyTables, text as words } from "./foundry-i18n.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const english = storyTables();
const tables = { get: k => english[k] };
const at = (x, y = 0) => ({ x, y, size: 5 });
const bow = (over = {}) => strike({ id: "bow", name: "Shortbow", melee: false, reach: undefined, range: { increment: 60, max: 360 }, damage: [parseFormula("1d6", "piercing")], ...over });
/** Every way a table's lines can start, with its placeholders filled. */
const opening = (key, fill) => english[key].map(l => l.replace(/\{(\w+)\}/g, (m, k) => fill[k] ?? m).split(" ").slice(0, 4).join(" "));

describe("the story of the dying, as a live 5e test showed it", () => {
  test("a death save made reads as one made (5e: it doesn't lower the dying), and a natural 20 as getting back up", () => {
    const spec = battle([creature({ id: "r", name: "Riswynn", kind: "pc" }), creature({ id: "g", name: "Goblin", side: "hostile" })]);
    const base = { actor: "Riswynn", actorId: "r", side: "friendly", type: "recovery", before: 0, dying: 0, dead: false, stable: false };
    const result = { log: [{ ...base, turn: 1, round: 1, text: "death save success", better: true }, { ...base, turn: 2, round: 2, text: "a natural 20", revived: true }], units: {} };
    const told = buildStory(result, spec, "roleplay", { tables, seed: 3 }).text;
    const any = key => english[key].some(l => told.includes(l.replace("{actor}", "Riswynn")));
    expect(any("event.recoveryGood")).toBe(true);
    expect(any("event.recoveryRevived")).toBe(true);
    expect(any("event.recoveryBad")).toBe(false);
  });

  test("hiding is told as hiding, not as a power drawn on ('draws on Hide: invisible')", () => {
    const spec = battle([creature({ id: "r", name: "Riswynn", kind: "pc" }), creature({ id: "g", name: "Goblin", side: "hostile" })]);
    const result = { log: [{ turn: 1, round: 1, type: "buff", actor: "Goblin", actorId: "g", side: "hostile", action: "Hide", effect: "Invisible", self: true, targets: ["Goblin"], targetIds: ["g"], withSelf: true, maneuver: "hide" }], units: {} };
    const told = buildStory(result, spec, "roleplay", { tables, seed: 3 }).text;
    expect(english["maneuver.hide"].some(l => told.includes(l.replace("{actor}", "Goblin").split(" ").slice(1, 4).join(" ")))).toBe(true);
    expect(told).not.toMatch(/Invisible/i);
  });
});

describe("the story, after a review of the chat cards", () => {
  test("a shot is told as the shot, not as the bow: never the bow itself plunging in", () => {
    let shots = 0;
    for ( let seed = 1; seed <= 12; seed++ ) {
      const spec = battle([
        creature({ id: "archer", name: "Archer", position: at(0), actions: [bow()], hp: { value: 300, max: 300 } }),
        creature({ id: "foe", name: "Foe", side: "hostile", position: at(60), speeds: { walk: 0 }, hp: { value: 300, max: 300 }, actions: [bow({ id: "foe-bow", bonus: -50 })] })
      ], { positioning: true, maxRounds: 2 });
      const r = replay(spec, pf2eRules, seed);
      const shot = r.log.find(e => e.type === "attack" && e.actorId === "archer");
      expect(shot.launched).toBe(true);
      expect(shot.feet).toBeGreaterThanOrEqual(50);
      const text = buildStory(r, spec, "roleplay", { tables, seed }).text;
      const phrase = words("FASTFIGHTING.Story.Shot", { weapon: "Shortbow" });
      shots += text.split(phrase).length - 1;
      expect(text.split(phrase).join("")).not.toContain("Shortbow");
    }
    expect(shots).toBeGreaterThan(0);
  });

  test("a thrown weapon flies itself", () => {
    const spec = battle([
      creature({ id: "thrower", name: "Thrower", position: at(0), actions: [bow({ id: "javelin", name: "Javelin", thrown: true })] }),
      creature({ id: "foe", name: "Foe", side: "hostile", position: at(40), speeds: { walk: 0 } })
    ], { positioning: true, maxRounds: 1 });
    const r = replay(spec, pf2eRules, 3);
    expect(r.log.find(e => e.type === "attack" && e.actorId === "thrower").launched).toBe(false);
  });

  test("one already down does nothing about the blows that come: no dodging, no laughing, no wincing", () => {
    let told = 0;
    for ( let seed = 1; seed <= 30 && told < 3; seed++ ) {
      const spec = battle([
        creature({ id: "hero", name: "Hero", kind: "pc", diesAtZero: false, hp: { value: 6, max: 6 }, actions: [strike({ bonus: -50 })] }),
        creature({ id: "brute", name: "Brute", side: "hostile", hp: { value: 300, max: 300 }, behavior: { finishDowned: 1 }, flags: { fearless: true },
          actions: [strike({ id: "maul", name: "Maul", bonus: 12, damage: [parseFormula("2d6+4", "bludgeoning")] })] })
      ], { maxRounds: 3 });
      const r = replay(spec, pf2eRules, seed);
      const down = r.log.findIndex(e => e.type === "down" && e.actorId === "hero");
      if ( down < 0 || !r.log.slice(down).some(e => e.type === "attack" && e.targetId === "hero") ) continue;
      told += 1;
      const text = buildStory(r, spec, "roleplay", { tables, seed }).text;
      const helpless = [...opening("downed.hit", { actor: "Brute", target: "Hero", weapon: "Maul" }), ...opening("downed.miss", { actor: "Brute", target: "Hero", weapon: "Maul" })];
      expect(helpless.some(l => text.includes(l))).toBe(true);
    }
    expect(told).toBeGreaterThan(0);
  });

  test("hyphenated slugs reach the master list: a shield block is a block, a reactive shield a raised one", () => {
    expect(maneuverOf({ id: "a.shield-block" })).toBe("block");
    expect(maneuverOf({ id: "a.reactive-shield" })).toBe("raiseShield");
    expect(maneuverOf({ id: "a.nimble-dodge" })).toBe("defend");
    expect(maneuverOf({ id: "a.tumble-through" })).toBe("tumbleThrough");
  });

  test("rounds are counted as the language counts them; an argument that broke up isn't 'no one left'", () => {
    const one = words("FASTFIGHTING.Words.RoundOne", { n: 1 });
    expect(endLine({ type: "end", outcome: "victory", winnerLabels: ["Party"], rounds: 1 })).toBe(words("FASTFIGHTING.Log.End", { winners: "Party", rounds: one }));
    expect(endLine({ type: "end", outcome: "victory", winnerLabels: ["Party"], rounds: 4 })).toBe(words("FASTFIGHTING.Log.End", { winners: "Party", rounds: words("FASTFIGHTING.Words.RoundMany", { n: 4 }) }));
    expect(endLine({ type: "end", outcome: "none", resolved: "collapsed", rounds: 2 })).toBe(words("FASTFIGHTING.Log.EndCollapsed", { rounds: words("FASTFIGHTING.Words.RoundMany", { n: 2 }) }));
  });

  test("every sentence starts with a capital, even one that opens with a creature called 'the Goblin'", () => {
    for ( let seed = 1; seed <= 6; seed++ ) {
      const spec = battle([
        creature({ id: "pc", name: "Hero", kind: "pc", diesAtZero: false, hp: { value: 8, max: 8 }, actions: [strike({ bonus: -50 })] }),
        creature({ id: "g1", name: "Goblin", generic: true, side: "hostile", hp: { value: 300, max: 300 } }),
        creature({ id: "g2", name: "Goblin Archer", generic: true, side: "hostile", hp: { value: 300, max: 300 } })
      ], { maxRounds: 3 });
      spec.generic = true;
      const r = replay(spec, pf2eRules, seed);
      const text = buildStory(r, spec, "roleplay", { tables, seed }).text;
      expect(text).not.toMatch(/[.!?]\s+the /);
    }
  });
});
