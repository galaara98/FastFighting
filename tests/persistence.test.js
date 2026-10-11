import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { planHolder, getSetup, saveSetup, clearSetup, sceneEncounter } from "../scripts/foundry/persistence.js";
import { groupOf, resolveAllegiances, resolveLeans, commandGroup, secretTeam, SECRET_TEAMS } from "../scripts/foundry/battle.js";

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

  test("a Secret token is always on a team: hostile group 1, until the GM puts it on any hostile group or neutral team", () => {
    const setup = getSetup();
    setup.sides.neutral.allegiance = "friendly"; // (neutrals leaning toward the party)
    const roster = [{ token: { id: "orc" }, baseSide: "hostile" }, { token: { id: "spy" }, baseSide: "secret" }];
    for ( const e of roster ) setup.tokens[e.token.id] = { include: true };
    const spy = roster[1];
    expect(secretTeam(spy, setup)).toEqual({ side: "hostile", group: 1 });
    expect(secretTeam(roster[0], setup)).toBe(null); // (only a Secret token has a team)
    expect(resolveAllegiances(roster, setup).spy).toBe("hostile");
    // A hostile group no one else is in: a team of its own.
    setup.tokens.spy.team = "hostile3";
    expect(resolveAllegiances(roster, setup).spy).toBe("hostile3");
    expect(secretTeam(spy, setup)).toEqual({ side: "hostile", group: 3 });
    // A neutral team: it takes no side with that team, leaning as the neutrals do, in that team's chain of command.
    setup.tokens.spy.team = "neutral2";
    const resolved = resolveAllegiances(roster, setup);
    expect(resolved.spy).toBe("neutralParty");
    expect(resolveLeans(roster, setup).spy).toBe("friendly");
    expect(commandGroup(spy, setup, resolved)).toBe("neutralParty#2");
    // The neutrals left out of it: a Secret token on a neutral team still takes no side, leaning nowhere.
    setup.sides.neutral.allegiance = "exclude";
    expect(resolveAllegiances(roster, setup).spy).toBe("neutralParty");
    expect(resolveLeans(roster, setup).spy).toBe(null);
    // A team that isn't one: hostile group 1.
    setup.tokens.spy.team = "friendly1";
    expect(resolveAllegiances(roster, setup).spy).toBe("hostile");
    expect(SECRET_TEAMS).toEqual(["hostile1", "hostile2", "hostile3", "neutral1", "neutral2", "neutral3"]);
  });

  test("neutrals take no side, leaning as the Neutral tab says; or they're left out, or fight everyone", () => {
    const setup = getSetup();
    const roster = [{ token: { id: "orc" }, baseSide: "hostile" }, { token: { id: "miller" }, baseSide: "neutral" }];
    for ( const e of roster ) setup.tokens[e.token.id] = { include: true };
    for ( const lean of ["neutral", "friendly", "hostile", "closest", "underdog"] ) {
      setup.sides.neutral.allegiance = lean;
      expect(resolveAllegiances(roster, setup).miller).toBe("neutralParty");
    }
    setup.sides.neutral.allegiance = "exclude";
    expect(resolveAllegiances(roster, setup).miller).toBe(null);
    setup.sides.neutral.allegiance = "own";
    expect(resolveAllegiances(roster, setup).miller).toBe("neutral");
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
