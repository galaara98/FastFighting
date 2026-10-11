import { describe, expect, test } from "vitest";
import { validMotives, cleanMotive, cleanMotiveField } from "../scripts/foundry/motives.js";
import { prepareBattle, replay } from "../scripts/engine/simulator.js";
import { createRun } from "../scripts/engine/battle-state.js";
import { createRng } from "../scripts/engine/rng.js";
import { remaining, concession, hasValuables } from "../scripts/engine/behavior/talk.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle, social } from "./helpers.js";

const coins = [{ label: "pp", value: 1000 }, { label: "gp", value: 100 }, { label: "sp", value: 10 }, { label: "cp", value: 1 }];
const sword = { id: "sword", name: "Sword", value: 1500, category: "weapon", material: "coldIron", rarity: "common" };
const valuables = { money: 2500, denominations: coins, stowed: [sword], wielded: [] };
const catalog = {
  categories: [{ key: "weapon", label: "Weapon" }, { key: "armor", label: "Armor" }],
  materials: [{ key: "coldIron", label: "Cold Iron" }],
  rarities: [{ key: "rare", label: "Rare" }]
};

describe("what a character offers and expects: only what it has, only the kinds of thing the system knows", () => {
  test("money: counted in the coin it picked, never more than it carries", () => {
    expect(validMotives({ offer: { kind: "money", amount: 10, coin: 100 } }, valuables).offer).toMatchObject({ kind: "money", amount: 1000 });
    expect(validMotives({ offer: { kind: "money", amount: 99, coin: 1000 } }, valuables).offer.amount).toBe(2500);
    expect(validMotives({ offer: { kind: "money", amount: 5 } }, { ...valuables, money: 0 })).toBe(null);
    // (No coin picked: the one worth a hundred of the smallest.)
    expect(validMotives({ expect: { kind: "money", amount: 3 } }, valuables).expect.amount).toBe(300);
  });

  test("one of its own things, still with it; never someone else's, nor one it doesn't have", () => {
    expect(validMotives({ offer: { kind: "item", item: "sword" } }, valuables).offer).toMatchObject({ kind: "item", item: { id: "sword" } });
    expect(validMotives({ offer: { kind: "item", item: "someone-elses-crown" } }, valuables)).toBe(null);
  });

  test("something of a kind: the system's categories, materials and rarities, never a particular item", () => {
    const e = validMotives({ expect: { kind: "thing", category: "weapon", material: "coldIron", rarity: "mythic", minValue: 2, coin: 100, unvalued: true, item: "sword" } }, valuables, catalog).expect;
    expect(e).toMatchObject({ kind: "thing", category: "weapon", material: "coldIron", rarity: "", minValue: 200, unvalued: true });
    expect(e.labels).toEqual({ category: "Weapon", material: "Cold Iron", rarity: "" });
    expect(e.item).toBeUndefined();
  });

  test("promises; and nothing the survey couldn't have written", () => {
    expect(validMotives({ offer: { kind: "passage" }, expect: { kind: "leave" } }, null)).toEqual({ offer: { kind: "promise", promise: "passage" }, expect: { kind: "promise", promise: "leave" } });
    expect(validMotives({ offer: { kind: "everything" }, expect: { kind: "item", item: "sword" } }, valuables, catalog)).toBe(null);
    expect(cleanMotive("offer", { kind: "money", amount: "12.7", coin: -4, evil: "x" })).toEqual({ kind: "money", amount: 12, coin: 0 });
    expect(cleanMotiveField("expect", "unvalued", true)).toBe(true);
    expect(cleanMotiveField("expect", "kind", "item")).toBe(null);
    // A system with no money (and nothing to hand over): no money to ask for, nothing of a kind either.
    expect(validMotives({ expect: { kind: "money", amount: 5 } }, null)).toBe(null);
    expect(validMotives({ expect: { kind: "thing" } }, null)).toBe(null);
  });
});

describe("systems without coins and goods (Ironsworn)", () => {
  const supply = [{ label: "Supply", value: 1 }];
  const pc = (id, extra = {}) => creature({ id, name: id, kind: "pc", diesAtZero: false, social: social({ diplomacy: 2 }),
    valuables: { money: 3, denominations: supply, stowed: [], wielded: [], pooled: true }, ...extra });
  const foe = creature({ id: "foe", side: "hostile", social: social({ diplomacy: 2 }), valuables: { money: 0, denominations: null, stowed: [], wielded: [], progress: 1 } });

  test("the side shares its Supply: what one pays, all of them have that much less of", () => {
    const run = createRun(prepareBattle(battle([pc("a"), pc("b"), foe]), pf2eRules));
    const [a, b] = [run.byId.get("a"), run.byId.get("b")];
    a.concessions = [{ kind: "money", amount: 2, to: "foe" }];
    expect(remaining(a).money).toBe(1);
    expect(remaining(b).money).toBe(1);
    // (The foe's own side pools nothing with them.)
    expect(remaining(run.byId.get("foe")).money).toBe(0);
  });

  test("a foe with nothing to hand over gives ground instead: progress on its track, the winner's reward", () => {
    const run = createRun(prepareBattle(battle([pc("a"), foe]), pf2eRules));
    run.rng = createRng(1);
    const f = run.byId.get("foe");
    expect(hasValuables(f)).toBe(true);
    expect(concession(run, f)).toEqual({ kind: "progress", amount: 1 });
  });

  test("ground given stays given, even when the one it was given to is beaten", () => {
    const spec = battle([pc("a", { social: social({ diplomacy: 9, intimidation: 9 }), tactics: { talk: "first" } }), { ...foe, tactics: { talk: "opportune" } }], { maxRounds: 6, opening: "talk" });
    for ( let seed = 1; seed <= 30; seed++ ) {
      const r = replay(spec, pf2eRules, seed);
      for ( const c of r.units.foe.final.concessions ?? [] ) if ( c.kind === "progress" ) expect(c.returned).toBeFalsy();
    }
  });
});
