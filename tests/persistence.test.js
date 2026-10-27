import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { planHolder, getSetup, saveSetup, clearSetup, sceneEncounter, planDistrust, planSignature } from "../scripts/foundry/persistence.js";
import { groupOf, resolveAllegiances, resolveLeans, commandGroup, commandChains, seedCommand, repickCommand, secretTeam, SECRET_TEAMS } from "../scripts/foundry/battle.js";

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

describe("who commands: picked once, when the plan is new or just cleared", () => {
  // (The system's ranking: whoever has a lead score, best first.)
  const adapter = { detectLeaders: specs => specs.filter(s => s.lead !== undefined)
    .map(s => ({ id: s.id, score: s.lead, reason: "", bonus: { brave: 10 } })).sort((a, b) => b.score - a.score) };
  const token = (id, lead) => ({ token: { id, actor: { id } }, baseSide: "hostile", spec: { id, level: 1, lead, traits: {} } });
  const roles = setup => Object.fromEntries(Object.entries(setup.tokens).filter(([, t]) => t.role).map(([id, t]) => [id, t.role]));

  test("a new plan gets its commanders once; a better leader joining later changes nothing; cleared, it picks again", async () => {
    const setup = getSetup();
    const roster = ["a", "b", "c", "d", "e"].map(id => token(id, id === "c" ? 5 : 1));
    for ( const e of roster ) setup.tokens[e.token.id] = { include: true };
    seedCommand(roster, setup, adapter);
    // Five in the group: a leader and a lieutenant, kept in the plan as the automatic pick.
    expect(roles(setup)).toEqual({ c: "leader", a: "lt1" });
    expect(setup.tokens.c.roleAuto).toBe(true);
    expect(setup.commandSeeded).toBe(true);
    roster.push(token("f", 9));
    setup.tokens.f = { include: true };
    const chain = commandChains(roster, setup, resolveAllegiances(roster, setup), adapter).hostile;
    expect(chain.map(c => [c.id, c.slot, c.auto])).toEqual([["c", "leader", true], ["a", "lt1", true]]);
    await saveSetup(setup);
    await clearSetup();
    expect(getSetup().commandSeeded).toBeUndefined();
  });

  test("a group of four gets a leader and no lieutenant; one alone, nobody; the GM's own picks stand", () => {
    const setup = getSetup();
    const roster = ["a", "b", "c", "d"].map(id => token(id, id === "b" ? 3 : 0));
    for ( const e of roster ) setup.tokens[e.token.id] = { include: true };
    setup.tokens.d.role = "lt2";
    seedCommand(roster, setup, adapter);
    expect(roles(setup)).toEqual({ b: "leader", d: "lt2" });
    expect(setup.tokens.d.roleAuto).toBeUndefined();
    const alone = getSetup();
    alone.tokens.a = { include: true };
    seedCommand([token("a", 9)], alone, adapter);
    expect(roles(alone)).toEqual({});
  });

  test("re-picked: the automatic roles, or every one, the teams untouched", () => {
    const setup = getSetup();
    const roster = ["a", "b", "c", "d"].map(id => token(id, id === "b" ? 3 : 0));
    for ( const e of roster ) setup.tokens[e.token.id] = { include: true, group: 2 };
    setup.tokens.d.role = "leader";
    seedCommand(roster, setup, adapter);
    expect(roles(setup)).toEqual({ d: "leader" });
    // A better leader joins: the automatic re-pick keeps the GM's leader.
    roster.push(token("e", 9));
    setup.tokens.e = { include: true, group: 2 };
    repickCommand(roster, setup, {}, adapter);
    expect(roles(setup)).toEqual({ d: "leader", e: "lt1" });
    // Every role: the GM's goes too, and the best takes the lead.
    repickCommand(roster, setup, { all: true }, adapter);
    expect(roles(setup)).toEqual({ e: "leader", b: "lt1" });
    expect(Object.values(setup.tokens).map(t => t.group)).toEqual([2, 2, 2, 2, 2]);
  });
});

describe("a plan kept on a scene a player owns", () => {
  test("is read unless a player owns the scene and no GM signed the plan as it is", () => {
    expect(planDistrust({ playerOwned: false, signed: true })).toBe(null);
    expect(planDistrust({ playerOwned: true, signed: true })).toBe(null);
    expect(planDistrust({ playerOwned: false, signed: false })).toBe(null);
    expect(planDistrust({ playerOwned: true, signed: false })).toBe("player");
  });

  test("a plan's signature: the same for the same plan, its keys in any order; another for any change", () => {
    const plan = { options: { seconds: 10, purses: {} }, tokens: { goblin: { include: true, fudge: { hp: 0 } } } };
    expect(planSignature(plan)).toBe(planSignature({ tokens: { goblin: { fudge: { hp: 0 }, include: true } }, options: { purses: {}, seconds: 10 } }));
    expect(planSignature(plan)).not.toBe(planSignature({ ...plan, tokens: { goblin: { include: true, fudge: { hp: 50 } } } }));
  });

  test("written by its player-owner, isn't read: the defaults, and an encounter there starts from them", async () => {
    const gmFlags = {};
    const gm = { id: "gm", isGM: true, getFlag: (scope, key) => gmFlags[scope]?.[key] };
    const users = [gm, { id: "pat", isGM: false, getFlag: () => ({ ambush: "forged" }) }];
    game.users = { some: fn => users.some(fn), get: id => users.find(u => u.id === id) };
    game.user = { ...gm, update: async changes => {
      for ( const [path, value] of Object.entries(changes) ) {
        const [, scope, key, id] = path.match(/^flags\.([^.]+)\.(\w+)\.(\w+)$/);
        ((gmFlags[scope] ??= {})[key] ??= {})[id] = value;
      }
    } };
    const owners = new Set(["pat"]);
    Object.assign(scene, { id: "ambush", documentName: "Scene", name: "Ambush", _stats: { lastModifiedBy: "gm" }, testUserPermission: u => owners.has(u.id) });
    const plan = getSetup();
    plan.options.applyPlayerDamage = true;
    plan.tokens.goblin = { include: true, fudge: { hp: 50 } };
    await saveSetup(plan);
    // (The GM saved it, as it is: the GM's own plan, on a scene the player owns; whatever else changed the scene since.)
    scene._stats.lastModifiedBy = "pat";
    expect(getSetup().tokens.goblin.fudge.hp).toBe(50);
    // (The player changed the plan since, a GM's edit of the scene after it or not: not the GM's.)
    scene.flags["fast-fighting"].setup.tokens.goblin.fudge.hp = 500;
    scene._stats.lastModifiedBy = "gm";
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(getSetup().tokens).toEqual({});
      expect(getSetup().options.applyPlayerDamage).not.toBe(true);
      const encounter = doc("Combat.new", { scene });
      combats.push(encounter);
      ui.combat.viewed = encounter;
      expect(getSetup().tokens).toEqual({});
      // (An encounter's own plan is the GM's alone.)
      const own = getSetup();
      own.tokens.goblin = { include: false };
      await saveSetup(own);
      expect(getSetup().tokens.goblin).toEqual({ include: false });
    } finally {
      console.warn = warn;
    }
    // (No player owns it now: read again.)
    owners.clear();
    ui.combat.viewed = null;
    combats.length = 0;
    expect(getSetup().tokens.goblin.fudge.hp).toBe(500);
  });
});
