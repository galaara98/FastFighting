/**
 * Food and meat as the helper says (foundry/food.js, API 27): nothing where its system keeps no food; its appetite,
 * meat and food as given, kept in bounds; the GM's word on hunger over the roll, but never on a player's own.
 */
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ adapter: null }));
vi.mock("../scripts/api.js", () => ({ getAdapter: () => state.adapter }));

const { appetiteOf, meatGoods, foodOf, knowsFood } = await import("../scripts/foundry/food.js");

const was = { foundry: globalThis.foundry };
afterAll(() => Object.assign(globalThis, was));
beforeEach(() => {
  globalThis.foundry = { utils: { deepClone: v => structuredClone(v) } };
});

const actor = (flags = {}, hasPlayerOwner = false) => ({ name: "Wolf", hasPlayerOwner, getFlag: (s, k) => flags[s]?.[k] });

describe("a system with no food of its own", () => {
  test("nothing is food, no one hungers, no body leaves meat", () => {
    const adapter = {};
    expect(knowsFood(adapter)).toBe(false);
    expect(appetiteOf(actor(), {}, adapter)).toEqual({});
    expect(meatGoods(actor(), {}, adapter)).toBeNull();
    expect(foodOf({ name: "Rations" }, adapter)).toBeNull();
  });
});

describe("as the helper says", () => {
  const adapter = {
    appetite: () => ({ diet: "meat", hunger: 1.7, cannibal: 1 }),
    meatFor: () => ({ item: { name: "Uncooked meat", system: { quantity: 8 } }, quantity: 8 }),
    isFood: item => (item.name === "Rations" ? { portions: 3, meat: false } : null)
  };

  test("its appetite, kept in bounds, with the meat its body would leave", () => {
    expect(appetiteOf(actor(), {}, adapter)).toEqual({ diet: "meat", hunger: 1, cannibal: true, hungry: null, meat: 8 });
    expect(appetiteOf(actor(), {}, { ...adapter, appetite: () => ({ diet: "stones", hunger: -1 }) })).toMatchObject({ diet: null, hunger: 0 });
  });

  test("the GM's mark on its hunger; never on a player's own (its flags are the player's to write)", () => {
    expect(appetiteOf(actor({ "fast-fighting": { hunger: "famished" } }), {}, adapter).hungry).toBe("famished");
    expect(appetiteOf(actor({ "fast-fighting": { hunger: "famished" } }, true), {}, adapter).hungry).toBeNull();
    expect(appetiteOf(actor({ "fast-fighting": { hunger: "ravenous" } }), {}, adapter).hungry).toBeNull();
  });

  test("its meat as goods, a copy of the helper's item; food by the helper's say", () => {
    const goods = meatGoods(actor(), {}, adapter);
    expect(goods).toEqual({ items: [{ name: "Uncooked meat", system: { quantity: 8 } }], coins: null });
    expect(foodOf({ name: "Rations" }, adapter)).toEqual({ portions: 3, meat: false });
    expect(foodOf({ name: "Rope" }, adapter)).toBeNull();
  });

  test("a hook that throws is no food, not a broken battle", () => {
    const broken = { appetite: () => { throw new Error("x"); }, meatFor: () => { throw new Error("y"); }, isFood: () => { throw new Error("z"); } };
    expect(appetiteOf(actor(), {}, broken)).toEqual({});
    expect(meatGoods(actor(), {}, broken)).toBeNull();
    expect(foodOf({}, broken)).toBeNull();
  });
});

describe("corpses (API 30)", () => {
  test("a fresh corpse's portions left; nothing for anything else", async () => {
    const { corpsePortions } = await import("../scripts/foundry/food.js");
    expect(corpsePortions({ flags: { "fast-fighting": { corpse: "fresh", portions: 4 } } })).toBe(4);
    expect(corpsePortions({ flags: { "fast-fighting": { corpse: "fresh", portions: 0 } } })).toBe(0);
    expect(corpsePortions({ getFlag: (s, k) => (k === "portions" ? 2 : undefined) })).toBe(2);
    expect(corpsePortions({ flags: { "fast-fighting": { corpse: "rotten" } } })).toBeNull();
    expect(corpsePortions({ name: "Rations" })).toBeNull();
  });

  test("a rotten or scrap corpse goes on the body, though no one eats it", () => {
    const rotten = { name: "Rotten Corpse", flags: { "fast-fighting": { corpse: "rotten" } } };
    const adapter = { appetite: () => null, meatFor: () => ({ item: rotten, quantity: 0 }) };
    expect(meatGoods(actor(), {}, adapter)).toEqual({ items: [rotten], coins: null });
    expect(appetiteOf(actor(), {}, adapter).meat).toBeUndefined();
  });
});
