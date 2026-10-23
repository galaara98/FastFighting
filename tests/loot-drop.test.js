/**
 * The fallen's loot (foundry/loot-drop.js): a creature's token, fallen, an Item Piles pile itself (up again, itself
 * again, and a Rewind either way); a dead player's character, a loot token on top of it with a copy of its things, its
 * sheet untouched (Item Piles', else the core's own); and a pile never taken for a creature.
 */
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ adapter: null }));
vi.mock("../scripts/api.js", () => ({ getAdapter: () => state.adapter }));

const { isPile, lootOnFall, revertItemPile } = await import("../scripts/foundry/loot-drop.js");

const was = { game: globalThis.game, Actor: globalThis.Actor, CONST: globalThis.CONST, fromUuid: globalThis.fromUuid, foundry: globalThis.foundry };
afterAll(() => Object.assign(globalThis, was));

let calls;
let ids = 0;
let pcMeat = false;
const flagged = (flags, scope, key) => flags[scope]?.[key];

/** Item Piles, as far as these calls go: a pile is a token whose flags say so. */
const api = {
  ACTOR_CLASS_TYPE: "loot",
  createItemPile: async o => (calls.push(["create", o]), { tokenUuid: "Scene.s.Token.pile" }),
  turnTokensIntoItemPiles: async (docs, o) => {
    calls.push(["turn", o]);
    for ( const d of docs ) d.flags = { ...d.flags, "item-piles": { data: { enabled: true } }, "fast-fighting": { ...d.flags["fast-fighting"], ...o.tokenSettings.flags["fast-fighting"] } };
    return docs.map(d => d.uuid);
  },
  revertTokensFromItemPiles: async (docs, o) => {
    calls.push(["revert", o]);
    for ( const d of docs ) d.flags = { ...d.flags, "item-piles": { data: { enabled: false } }, "fast-fighting": { ...d.flags["fast-fighting"], ...o.tokenSettings.flags["fast-fighting"] } };
    return docs.map(d => d.uuid);
  },
  isValidItemPile: d => !!d.flags?.["item-piles"]?.data?.enabled
};

const scene = { id: "s", createEmbeddedDocuments: async (type, datas) => datas.map((d, i) => ({ ...d, uuid: `Scene.s.Token.core${i}` })) };

function token(id, { flags = {}, actorFlags = {}, type = "npc" } = {}) {
  return {
    id, uuid: `Scene.s.Token.${id}`, name: id, x: 100, y: 200, elevation: 0, sort: 3, parent: scene, flags,
    texture: { src: `${id}.png`, scaleX: 1, scaleY: 1 },
    getFlag(scope, key) { return flagged(this.flags, scope, key); },
    actor: { type, getFlag: (scope, key) => flagged(actorFlags, scope, key) }
  };
}

const npc = (extra = {}) => ({ spec: { kind: "npc", ...extra } });
const pc = { spec: { kind: "pc" } };

beforeEach(() => {
  calls = [];
  state.adapter = {
    goodsOf: async () => ({ items: [{ name: "Longsword" }], coins: { gp: 5 } }),
    putGoods: async (doc, goods) => (calls.push(["put", doc.uuid, goods]), [{ put: doc.uuid }]),
    takeGoods: async () => { throw new Error("nothing comes off a sheet"); },
    meatFor: () => ({ item: { name: "Uncooked meat", system: { quantity: 4 } }, quantity: 4 })
  };
  pcMeat = false;
  globalThis.game = {
    settings: { get: (m, k) => (k === "pcMeat" ? pcMeat : undefined) },
    modules: new Map([["item-piles", { active: true }]]),
    itempiles: { API: api },
    i18n: { has: () => true, localize: k => (k === "FASTFIGHTING.Loot.Belongings" ? "{name}'s belongings" : k) }
  };
  globalThis.fromUuid = async uuid => ({ uuid, flags: {}, getFlag(s, k) { return this.flags[s]?.[k]; }, async setFlag(s, k, v) { calls.push(["flag", uuid, k, v]); (this.flags[s] ??= {})[k] = v; } });
  globalThis.foundry = { utils: { randomID: () => `id${++ids}`, deepClone: v => structuredClone(v) } };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 }, TOKEN_DISPOSITIONS: { NEUTRAL: 0 } };
  globalThis.Actor = { create: async data => (calls.push(["actor", data]), { ...data, uuid: "Actor.core", getTokenDocument: async o => ({ toObject: () => ({ ...o }) }) }) };
});

describe("a pile is no creature", () => {
  test("FastFighting's own (its token's flag or its actor's) and Item Piles'; not a creature it made a pile as it fell", () => {
    expect(isPile(token("a", { flags: { "fast-fighting": { pile: true } } }))).toBe(true);
    expect(isPile(token("b", { actorFlags: { "fast-fighting": { pile: true } } }))).toBe(true);
    expect(isPile(token("c", { flags: { "item-piles": { data: { enabled: true } } } }))).toBe(true);
    expect(isPile(token("d", { flags: { "item-piles": { data: { enabled: true } }, "fast-fighting": { fallenPile: { name: "d" } } } }))).toBe(false);
    expect(isPile(token("e"))).toBe(false);
  });
});

describe("a creature that falls", () => {
  test("fallen, its token an Item Piles pile (never emptied away); up again, itself as it was; Rewind either way", async () => {
    const doc = token("goblin");
    const fell = await lootOnFall(doc, npc(), { fell: true }, "corpse");
    expect(fell.records).toEqual([{ tokenUuid: doc.uuid, itemPile: { made: true } }]);
    expect(calls[0][1].pileSettings).toEqual({ deleteWhenEmpty: false });
    expect(doc.getFlag("fast-fighting", "fallenPile")).toEqual({ name: "goblin", texture: { src: "goblin.png", scaleX: 1, scaleY: 1 } });
    expect(isPile(doc)).toBe(false);
    // (Dying on: already a pile.)
    expect((await lootOnFall(doc, npc(), { died: true }, "corpse")).records).toEqual([]);
    const rose = await lootOnFall(doc, npc(), { revived: true }, "corpse");
    expect(calls.at(-1)[1].tokenSettings).toMatchObject({ name: "goblin", texture: { src: "goblin.png" } });
    expect(doc.getFlag("fast-fighting", "fallenPile")).toBeNull();
    // (Rewind of its rising: a pile again; of its fall: itself again.)
    await revertItemPile(rose.records[0].itemPile, doc);
    expect(api.isValidItemPile(doc)).toBe(true);
    await revertItemPile(fell.records[0].itemPile, doc);
    expect(api.isValidItemPile(doc)).toBe(false);
  });

  test("only as the loot setting's \"Leave on corpse\" asks, with Item Piles; never a hazard or a summoned one", async () => {
    for ( const mode of ["pile", "none"] ) expect((await lootOnFall(token("g"), npc(), { fell: true }, mode)).records).toEqual([]);
    expect((await lootOnFall(token("g"), npc({ hazard: {} }), { fell: true }, "corpse")).records).toEqual([]);
    expect((await lootOnFall(token("g"), { ...npc(), summoner: "x" }, { fell: true }, "corpse")).records).toEqual([]);
    game.modules.set("item-piles", { active: false });
    expect((await lootOnFall(token("g"), npc(), { fell: true }, "corpse")).records).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("a player's character that dies", () => {
  test("a loot token on top of it, Item Piles', with a copy of all it has: nothing off its sheet", async () => {
    const doc = token("kyra", { type: "character" });
    const out = await lootOnFall(doc, pc, { died: true, fell: true }, "corpse");
    expect(out.remains).toBe("Scene.s.Token.pile");
    const [, made] = calls.find(c => c[0] === "create");
    // (Each thing with an id of its own, or Item Piles would keep only the last.)
    expect(made.items).toEqual([{ name: "Longsword", _id: expect.stringMatching(/^id\d+$/) }]);
    expect(made).toMatchObject({ position: { x: 100, y: 200 }, sceneId: "s", tokenOverrides: { name: "kyra's belongings", sort: 4, flags: { "fast-fighting": { pile: true } } } });
    expect(calls.find(c => c[0] === "put")).toEqual(["put", "Scene.s.Token.pile", { items: [], coins: { gp: 5 }, money: 0 }]);
    expect(out.records[0]).toEqual({ createdTokens: ["Scene.s.Token.pile"] });
    // (Our mark on it, which Item Piles doesn't keep from what it's given.)
    expect(calls).toContainEqual(["flag", "Scene.s.Token.pile", "pile", true]);
    // (Only on dying; and not with the loot setting at "Do nothing".)
    expect((await lootOnFall(doc, pc, { fell: true }, "corpse")).remains).toBeNull();
    expect((await lootOnFall(doc, pc, { died: true }, "none")).remains).toBeNull();
  });

  test("its meat too, only where the GM's setting says so", async () => {
    pcMeat = true;
    await lootOnFall(token("kyra", { type: "character" }), pc, { died: true }, "corpse");
    const [, made] = calls.find(c => c[0] === "create");
    expect(made.items.map(i => i.name)).toEqual(["Longsword", "Uncooked meat"]);
  });

  test("no Item Piles, no pile of the system's: the core's own, an actor of its kind everyone can look in", async () => {
    game.modules.set("item-piles", { active: false });
    const out = await lootOnFall(token("kyra", { type: "character" }), pc, { died: true }, "pile");
    const [, actor] = calls.find(c => c[0] === "actor");
    expect(actor).toMatchObject({ name: "kyra's belongings", type: "character", ownership: { default: 2 }, flags: { "fast-fighting": { pile: true } } });
    expect(out.remains).toBe("Scene.s.Token.core0");
    expect(out.records[0]).toEqual({ createdActors: ["Actor.core"], createdTokens: ["Scene.s.Token.core0"] });
    expect(calls.find(c => c[0] === "put")[2]).toEqual({ items: [{ name: "Longsword" }], coins: { gp: 5 } });
  });
});
