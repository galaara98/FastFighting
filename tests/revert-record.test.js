/**
 * Rewind's undo records are data, run with a GM's rights (make-it-so.js revertRecord, revertEntry): each one does only
 * what FastFighting's own records do, whatever else it names.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { revertRecord, revertEntry, settingRestored, userFlags, tokenData, rewindScopes, actorData } from "../scripts/foundry/make-it-so.js";

/** A document as Foundry has one: its uuid, its parent, and what was done to it. */
function docOf(uuid, parent = null, extra = {}) {
  const done = [];
  return {
    uuid, id: uuid.split(".").at(-1), parent, done, ...extra,
    delete: async () => done.push(["delete"]),
    update: async (data, options) => done.push(options && Object.keys(options).length ? ["update", data, options] : ["update", data]),
    createEmbeddedDocuments: async (type, list, options) => done.push(["create", type, list, options])
  };
}

const flatten = (o, prefix = "", out = {}) => {
  for ( const [k, v] of Object.entries(o ?? {}) ) {
    const path = prefix ? `${prefix}.${k}` : k;
    if ( v && typeof v === "object" && !Array.isArray(v) ) flatten(v, path, out);
    else out[path] = v;
  }
  return out;
};

let world;
let settings;
const realFoundry = globalThis.foundry;
beforeEach(() => {
  const here = docOf("Scene.here");
  const there = docOf("Scene.there");
  const combat = docOf("Scene.here.Combat.c1", null, { scene: here });
  const actor = docOf("Actor.a1", null, { items: new Map(), effects: new Map(), statuses: new Set() });
  world = {
    here, there, combat, actor,
    token: docOf("Scene.here.Token.t1", here, { actor, _source: { x: 0, y: 0 } }),
    farToken: docOf("Scene.there.Token.t9", there, { actor, _source: { x: 0, y: 0 } }),
    region: docOf("Scene.here.Region.r1", here),
    farRegion: docOf("Scene.there.Region.r9", there),
    wall: docOf("Scene.here.Wall.w1", here),
    farWall: docOf("Scene.there.Wall.w9", there),
    combatant: docOf("Scene.here.Combat.c1.Combatant.k1", combat),
    player: docOf("User.pat", null, { isGM: false }),
    gm: docOf("User.gm", null, { isGM: true })
  };
  const byUuid = new Map(Object.values(world).map(d => [d.uuid, d]));
  settings = [];
  globalThis.fromUuid = async uuid => byUuid.get(uuid) ?? null;
  globalThis.foundry = { utils: { parseUuid: uuid => ({ type: String(uuid).split(".").at(-2) }), flattenObject: flatten } };
  globalThis.CONST = { WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1, LOCKED: 2 } };
  Object.assign(globalThis.game, {
    system: { id: "daggerheart" },
    users: { get: id => ({ pat: world.player, gm: world.gm })[id] },
    settings: { set: async (namespace, key, value) => settings.push([namespace, key, value]) },
    messages: { get: () => null }
  });
  world.here.moveTokens = async moves => world.here.done.push(["move", moves]);
});
afterEach(() => {
  globalThis.foundry = realFoundry;
  delete globalThis.fromUuid;
  delete globalThis.CONST;
});

const did = doc => doc.done.map(d => d[0]);

describe("an undo record's documents", () => {
  test("are only of the kind it names them as, on the battle's scene", async () => {
    await revertRecord({
      createdTokens: [world.token.uuid, world.farToken.uuid, world.actor.uuid],
      createdRegions: [world.region.uuid, world.farRegion.uuid, world.token.uuid],
      createdCombatants: [world.combatant.uuid, world.region.uuid]
    }, { scene: world.here });
    expect(did(world.token)).toEqual(["delete"]);
    expect(did(world.region)).toEqual(["delete"]);
    expect(did(world.combatant)).toEqual(["delete"]);
    // (Another scene's, and an actor or a token named as something else: left be.)
    expect(did(world.farToken)).toEqual([]);
    expect(did(world.farRegion)).toEqual([]);
    expect(did(world.actor)).toEqual([]);
  });

  test("a token is restored only on its own scene, and with no one's ownership changed by it", async () => {
    const data = { _id: "t2", name: "Wolf", ownership: { pat: 3 }, delta: { ownership: { default: 3 }, system: { hp: 5 } } };
    await revertRecord({ deletedTokens: [{ parentUuid: world.here.uuid, data }, { parentUuid: world.there.uuid, data }] }, { scene: world.here });
    expect(world.there.done).toEqual([]);
    const [[, type, [made]]] = world.here.done;
    expect(type).toBe("Token");
    expect(made).toEqual({ _id: "t2", name: "Wolf", delta: { system: { hp: 5 } } });
    expect(tokenData({ name: "Wolf", delta: null })).toEqual({ name: "Wolf", delta: null });
  });

  test("a door goes back only as a wall on the scene, to a door's state; a token back only from the scene", async () => {
    await revertEntry(world.here, {
      doors: [{ uuid: world.wall.uuid, ds: 2 }, { uuid: world.farWall.uuid, ds: 0 }, { uuid: world.token.uuid, ds: 0 }, { uuid: world.wall.uuid, ds: "open" }],
      moves: [{ uuid: world.token.uuid, x: 100, y: 0 }, { uuid: world.farToken.uuid, x: 50, y: 50 }, { uuid: world.wall.uuid, x: 1, y: 1 }]
    });
    expect(world.wall.done).toEqual([["update", { ds: 2 }]]);
    expect(world.farWall.done).toEqual([]);
    expect(world.token.done).toEqual([]);
    expect(world.here.done).toEqual([["move", { t1: { destination: { x: 100, y: 0, action: "displace" } } }]]);
  });
});

describe("a world setting", () => {
  test("goes back only when it's the system's own and FastFighting recorded it", async () => {
    const recorded = new Set(["daggerheart.ResourcesFear"]);
    expect(settingRestored({ namespace: "daggerheart", key: "ResourcesFear", value: 3 }, recorded, "daggerheart")).toBe(true);
    expect(settingRestored({ namespace: "daggerheart", key: "Automation", value: {} }, recorded, "daggerheart")).toBe(false);
    expect(settingRestored({ namespace: "fast-fighting", key: "ResourcesFear", value: 3 }, new Set(["fast-fighting.ResourcesFear"]), "daggerheart")).toBe(false);
    expect(settingRestored({ namespace: "daggerheart", key: "ResourcesFear", value: 3 }, null, "daggerheart")).toBe(false);
    await revertRecord({ setting: { namespace: "daggerheart", key: "ResourcesFear", value: 3 } }, { settings: recorded });
    await revertRecord({ setting: { namespace: "daggerheart", key: "variantRules", value: {} } }, { settings: recorded });
    await revertRecord({ setting: { namespace: "core", key: "permissions", value: {} } }, { settings: new Set(["core.permissions"]) });
    await revertRecord({ setting: { namespace: "daggerheart", key: "ResourcesFear", value: 9 } });
    expect(settings).toEqual([["daggerheart", "ResourcesFear", 3]]);
  });
});

describe("a player's", () => {
  test("only flags, FastFighting's or the system's, and only a player's, never a GM's", async () => {
    expect(userFlags({ flags: { daggerheart: { luck: 2 }, "fast-fighting": { party: { a: 1 } }, other: { x: 1 } }, role: 4 }, "daggerheart"))
      .toEqual({ "flags.daggerheart.luck": 2, "flags.fast-fighting.party.a": 1 });
    const update = { flags: { daggerheart: { luck: 2 }, "some-module": { macro: "x" } }, role: 4, permissions: { FILES_UPLOAD: true } };
    await revertRecord({ actorUuid: world.actor.uuid, userId: "pat", userUpdate: update });
    await revertRecord({ actorUuid: world.actor.uuid, userId: "gm", userUpdate: update });
    expect(world.player.done).toEqual([["update", { "flags.daggerheart.luck": 2 }]]);
    expect(world.gm.done).toEqual([]);
  });
});

describe("the system's own options for an actor's restore", () => {
  test("passed under the system's id only; anything else the record says is ignored", async () => {
    globalThis.foundry.utils.deepClone = structuredClone;
    game.system.id = "dcc";
    await revertRecord({ actorUuid: "Actor.a1", actorUpdate: { "system.abilities.lck.value": 9 }, systemOptions: { dcc: { abilityLogged: true }, diff: false, core: { x: 1 } } });
    expect(world.actor.done.find(d => d[0] === "update")).toEqual(["update", { "system.abilities.lck.value": 9 }, { dcc: { abilityLogged: true } }]);
    world.actor.done.length = 0;
    await revertRecord({ actorUuid: "Actor.a1", actorUpdate: { "system.abilities.lck.value": 9 }, systemOptions: { pf2e: { x: 1 } } });
    expect(world.actor.done.find(d => d[0] === "update")).toEqual(["update", { "system.abilities.lck.value": 9 }]);
  });
});

describe("what a record of no actor's still puts back", () => {
  test("a Delay's place on the tracker, with no actor named", async () => {
    await revertRecord({ combatant: { uuid: world.combatant.uuid, initiative: 14 } }, { scene: world.here });
    expect(world.combatant.done).toEqual([["update", { initiative: 14 }, { turnEvents: false }]]);
  });
});

describe("a token's side", () => {
  test("its disposition goes back with the rest of the token", async () => {
    await revertRecord({ tokenUuid: world.token.uuid, tokenUpdate: { disposition: -1, texture: { src: "x" } } }, { scene: world.here });
    expect(world.token.done).toEqual([["update", { disposition: -1 }]]);
  });
});

describe("a fight's cards", () => {
  test("only those still there, in one call; a failed delete stops nothing", async () => {
    const deleted = [];
    const there = new Set(["m1", "m3"]);
    game.messages = { get: id => (there.has(id) ? { id } : null) };
    globalThis.foundry.documents = { ChatMessage: { deleteDocuments: async ids => deleted.push(ids) } };
    await revertEntry(world.here, { messages: ["m1", "m2", "m3"], doors: [{ uuid: world.wall.uuid, ds: 0 }] });
    expect(deleted).toEqual([["m1", "m3"]]);
    globalThis.foundry.documents.ChatMessage.deleteDocuments = async () => { throw new Error("gone"); };
    world.wall.done.length = 0;
    await revertEntry(world.here, { messages: ["m1"], doors: [{ uuid: world.wall.uuid, ds: 0 }] });
    expect(world.wall.done).toEqual([["update", { ds: 0 }]]);
  });
});

describe("flag scopes a helper names for Rewind (rewindFlagScopes)", () => {
  test("kept beside FastFighting's and the system's; never core's, nor anything but a plain scope name", () => {
    expect(rewindScopes("dcc", ["xcc", "core", "", 7, "a.b", "flags.x", null])).toEqual(["fast-fighting", "dcc", "xcc"]);
    expect(rewindScopes("dcc", "xcc")).toEqual(["fast-fighting", "dcc"]);
    const scopes = rewindScopes("dcc", ["xcc"]);
    expect(actorData({ system: { hp: 3 }, flags: { xcc: { mojo: 2 }, dcc: { x: 1 }, core: { sheetClass: "x" }, other: { y: 1 } }, name: "Bo" }, scopes))
      .toEqual({ "system.hp": 3, "flags.xcc.mojo": 2, "flags.dcc.x": 1 });
    expect(userFlags({ flags: { xcc: { mojo: 1 }, other: { y: 1 } }, role: 4 }, "dcc", scopes)).toEqual({ "flags.xcc.mojo": 1 });
    // (None named: as before.)
    expect(actorData({ flags: { xcc: { mojo: 2 }, dcc: { x: 1 } } }, rewindScopes("dcc"))).toEqual({ "flags.dcc.x": 1 });
  });
});
