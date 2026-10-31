/**
 * The swing study's tests (foundry/battle.js swingTests): a pill each for the party's side, its foes, those who take no
 * side and the rules; creatures that took no part left alone; those that did most tested first. A side's pill: its
 * creatures in the encounter (the default), all of them on the map, or none.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { swingTests, SWING_SCOPES, swingScopeState, nextSwingState } from "../scripts/foundry/battle.js";

beforeAll(() => {
  globalThis.game ??= {};
  globalThis.game.i18n = { lang: "en", localize: key => key, format: (key, data) => `${key} ${data?.name ?? ""}`.trim() };
});

const creature = (id, side, damage, extra = {}) => ({ id, name: id, side, level: 1, hp: { max: 10 }, damage, ...extra });

function battle(list, options = { leadership: true, morale: true, positioning: false }) {
  return {
    spec: { combatants: list.map(({ damage, involved, ...c }) => c), options },
    baseline: { runs: 100, combatants: Object.fromEntries(list.map(c => [c.id, { meanDamage: c.damage, meanHealing: 0, pInvolved: c.involved ?? 1 }])) }
  };
}

describe("swingTests", () => {
  const { spec, baseline } = battle([
    creature("kyra", "friendly", 12), creature("valeros", "friendly", 20),
    creature("orc", "hostile", 15), creature("ogre", "hostile2", 30),
    creature("hermit", "neutralParty", 1), creature("sleeper", "hostile", 0, { involved: 0.02 }),
    creature("lurker", "hostile", 5, { inEncounter: false })
  ]);

  test("counts each pill's tests: creatures by side, rules switched on", () => {
    expect(SWING_SCOPES).toEqual(["friendly", "foes", "neutrals", "rules"]);
    expect(swingTests(spec, baseline).counts).toEqual({
      friendly: { encounter: 2, all: 2 }, foes: { encounter: 2, all: 3 }, neutrals: { encounter: 1, all: 1 }, rules: 2
    });
  });

  test("a creature that took no part is left alone", () => {
    expect(swingTests(spec, baseline).tests.map(t => t.id)).not.toContain("sleeper");
  });

  test("a pill off: its tests aren't run", () => {
    const { tests } = swingTests(spec, baseline, { friendly: false, rules: false });
    expect(tests.map(t => t.scope)).toEqual(["foes", "foes", "neutrals"]);
  });

  test("each test leaves its creature out, or turns its rule off", () => {
    const { tests } = swingTests(spec, baseline, { foes: false, neutrals: false, friendly: false });
    expect(tests.map(t => t.key)).toEqual(["leadership", "morale"]);
    expect(tests[1].make(spec).options.morale).toBe(false);
    const { tests: kyra } = swingTests(spec, baseline, { foes: false, neutrals: false, rules: false });
    expect(kyra[0].make(spec).combatants.map(c => c.id)).not.toContain(kyra[0].id);
  });

  test("a side's creatures in the encounter by default; all of them on the map; or none", () => {
    const ids = scope => swingTests(spec, baseline, { rules: false, ...scope }).tests.map(t => t.id);
    expect(ids({})).not.toContain("lurker");
    expect(ids({ foes: "all" })).toContain("lurker");
    expect(ids({ foes: false })).toEqual(["valeros", "kyra", "hermit"]);
    // (Round and round: in the encounter, all on the map, none; the rules on and off.)
    expect(swingScopeState({}, "foes")).toBe("encounter");
    expect(swingScopeState({ foes: true }, "foes")).toBe("encounter");
    expect(["encounter", "all", false].map(s => nextSwingState("foes", s))).toEqual(["all", false, "encounter"]);
    expect([swingScopeState({}, "rules"), nextSwingState("rules", true), nextSwingState("rules", false)]).toEqual([true, false, true]);
  });

  test("every creature that took part, those that did most in the run first", () => {
    const many = battle(Array.from({ length: 40 }, (_, i) => creature(`foe${i}`, "hostile", i)));
    const ids = swingTests(many.spec, many.baseline, { rules: false }).tests.map(t => t.id);
    expect(ids).toHaveLength(40);
    expect(ids[0]).toBe("foe39");
    expect(ids.at(-1)).toBe("foe0");
  });
});
