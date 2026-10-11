import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { planHolder, getSetup, saveSetup, clearSetup, sceneEncounter } from "../scripts/foundry/persistence.js";
import { groupOf } from "../scripts/foundry/battle.js";

/** A document that keeps flags, as a Foundry Scene or Combat does. */
function doc(uuid, extra = {}) {
  const flags = {};
  return {
    uuid, id: uuid, ...extra, flags,
    getFlag: (scope, key) => flags[scope]?.[key],
    update: async changes => {
      for ( const [path, value] of Object.entries(changes) ) {
        const [, scope, key] = path.match(/^flags\.([^.]+)\.(?:==)?(\w+)$/);
        (flags[scope] ??= {})[key] = structuredClone(value);
      }
    }
  };
}

let scene;
let combats;
beforeEach(() => {
  scene = doc("Scene.ambush");
  combats = [];
  globalThis.canvas = { scene };
  globalThis.ui = { combat: { viewed: null } };
  Object.assign(globalThis.game, {
    combats: { find: fn => combats.find(fn) },
    settings: { get: () => null },
    user: { isGM: true }
  });
  // (Foundry's mergeObject copies what it merges in, as this does.)
  globalThis.foundry = { utils: { mergeObject: (a, stored) => {
    const b = structuredClone(stored);
    return { ...a, ...b, options: { ...a.options, ...b.options }, sides: { ...a.sides, ...b.sides }, tokens: { ...a.tokens, ...b.tokens } };
  } } };
});
afterEach(() => {
  delete globalThis.canvas;
  delete globalThis.ui;
  delete globalThis.foundry;
});

describe("a plan per encounter", () => {
  test("with no encounter on the scene, the scene holds the plan", async () => {
    expect(planHolder()).toBe(scene);
    const setup = getSetup();
    setup.tokens.goblin = { include: false };
    await saveSetup(setup);
    expect(getSetup().tokens.goblin).toEqual({ include: false });
  });

  test("each encounter keeps a plan of its own; a new one starts fresh", async () => {
    const first = doc("Combat.first", { scene });
    const second = doc("Combat.second", { scene });
    combats.push(first, second);
    ui.combat.viewed = first;
    expect(planHolder()).toBe(first);
    const plan = getSetup();
    plan.tokens.goblin = { include: true, group: 2 };
    await saveSetup(plan);

    // The GM views the other encounter: its plan is its own, and starts from the defaults.
    ui.combat.viewed = second;
    expect(planHolder()).toBe(second);
    expect(getSetup().tokens).toEqual({});

    // Back to the first: its plan is as the GM left it. The scene's own plan was never touched.
    ui.combat.viewed = first;
    expect(getSetup().tokens.goblin).toEqual({ include: true, group: 2 });
    expect(scene.getFlag("fast-fighting", "setup")).toBeUndefined();
  });

  test("an encounter with no plan yet starts from what the GM set up on the scene; its own plan is its own from then on", async () => {
    const before = getSetup();
    before.tokens.goblin = { include: true, group: 2 };
    await saveSetup(before); // (no encounter yet: the scene's plan)
    const encounter = doc("Combat.new", { scene });
    combats.push(encounter);
    ui.combat.viewed = encounter;
    const plan = getSetup();
    expect(plan.tokens.goblin).toEqual({ include: true, group: 2 });
    plan.tokens.goblin.group = 3;
    await saveSetup(plan);
    expect(getSetup().tokens.goblin.group).toBe(3);
    expect(scene.getFlag("fast-fighting", "setup").tokens.goblin.group).toBe(2);
  });

  test("clearing a plan puts it back to the defaults (an encounter's too, not to its scene's plan)", async () => {
    const onScene = getSetup();
    onScene.tokens.goblin = { include: false };
    await saveSetup(onScene);
    const encounter = doc("Combat.cleared", { scene });
    combats.push(encounter);
    ui.combat.viewed = encounter;
    await clearSetup();
    expect(getSetup().tokens).toEqual({});
    ui.combat.viewed = null;
    combats.length = 0;
    await clearSetup();
    expect(getSetup().tokens).toEqual({});
  });

  test("an encounter on another scene isn't this scene's", () => {
    const elsewhere = doc("Combat.elsewhere", { scene: { id: "Scene.other" } });
    combats.push(elsewhere);
    ui.combat.viewed = elsewhere;
    expect(sceneEncounter()).toBe(null);
    expect(planHolder()).toBe(scene);
  });

  test("a fresh plan puts every hostile token in one group, until the GM splits them", () => {
    const setup = getSetup();
    const hostile = { token: { id: "orc" }, baseSide: "hostile" };
    setup.tokens.orc = { include: true };
    expect(groupOf(hostile, setup)).toBe(1);
    setup.tokens.orc.group = 3;
    expect(groupOf(hostile, setup)).toBe(3);
  });
});
