import { describe, expect, test } from "vitest";
import { bossiness, rankForCommand, autoLieutenants, partyRoles, rememberRole } from "../scripts/foundry/command-pick.js";

describe("who takes command outside the party", () => {
  test("bossy playstyles pull a creature toward command, Wants to Lead most; followers' playstyles hold it back", () => {
    expect(bossiness({ playstyles: ["leader"] })).toBeGreaterThan(bossiness({ playstyles: ["instigator"] }));
    expect(bossiness({ playstyles: ["instigator"] })).toBeGreaterThan(bossiness({}));
    expect(bossiness({ playstyles: ["peoplePleaser"] })).toBeLessThan(bossiness({}));
    // (The first pill counts most.)
    expect(bossiness({ playstyles: ["leader", "brawler"] })).toBeGreaterThan(bossiness({ playstyles: ["brawler", "leader"] }));
    // Nerve and a head for tactics count a little.
    expect(bossiness({ traits: { brave: 80, tactical: 70 } })).toBeGreaterThan(bossiness({ traits: { brave: 30, tactical: 40 } }));
  });

  test("the system's ranking counts double: bossiness only sways it between near equals", () => {
    const ranked = [{ id: "sergeant", score: 6 }, { id: "brute", score: 1 }, { id: "grunt", score: 1 }];
    const members = [{ id: "sergeant" }, { id: "brute", playstyles: ["leader"] }, { id: "grunt" }];
    expect(rankForCommand(members, ranked).map(r => r.id)).toEqual(["sergeant", "brute", "grunt"]);
    // Close on stats, the one who wants to lead gets it.
    const close = [{ id: "a", score: 3 }, { id: "b", score: 2.5 }];
    expect(rankForCommand([{ id: "a" }, { id: "b", playstyles: ["leader"] }], close)[0].id).toBe("b");
    // Nobody the system ranks: still the bossiest.
    expect(rankForCommand([{ id: "x" }, { id: "y", playstyles: ["instigator"] }], [])[0].id).toBe("y");
    // Ranked at all beats bossy and unranked.
    expect(rankForCommand([{ id: "ranked" }, { id: "loud", playstyles: ["leader", "instigator", "cruel"] }], [{ id: "ranked", score: -2 }])[0].id).toBe("ranked");
  });

  test("a rarer creature has a slight edge (where its system rates rarity): it settles a near thing, no more", () => {
    // (Equals: the rare one leads, and the uncommon one is next, for a lieutenant.)
    const equals = [{ id: "common", rarity: 0 }, { id: "rare", rarity: 2 }, { id: "uncommon", rarity: 1 }];
    expect(rankForCommand(equals, equals.map(m => ({ id: m.id, score: 2 }))).map(r => r.id)).toEqual(["rare", "uncommon", "common"]);
    // A plainly better leader still leads, unique or not beside it.
    expect(rankForCommand([{ id: "captain" }, { id: "unique", rarity: 3 }], [{ id: "captain", score: 5 }, { id: "unique", score: 1 }])[0].id).toBe("captain");
    // (No rarity: nothing changes.)
    expect(rankForCommand([{ id: "a" }], [{ id: "a", score: 1 }])[0].score).toBe(rankForCommand([{ id: "a", rarity: 0 }], [{ id: "a", score: 1 }])[0].score);
  });

  test("a lieutenant of its own only in a group of five or more", () => {
    expect([1, 2, 4, 5, 9].map(autoLieutenants)).toEqual([0, 0, 0, 1, 1]);
  });
});

describe("who takes command in the party", () => {
  const party = [
    { id: "t1", actorId: "amiri", playstyles: ["brawler"] },
    { id: "t2", actorId: "ezren", playstyles: ["leader"] },
    { id: "t3", actorId: "lini", playstyles: [] }
  ];

  test("the roles the GM gave in earlier fights come back", () => {
    expect(partyRoles(party, { amiri: "leader", lini: "lt1" })).toEqual([
      { id: "t1", slot: "leader", why: "remembered" },
      { id: "t3", slot: "lt1", why: "remembered" }
    ]);
    // (Someone not here leaves their role empty; the GM's pick in this plan stands over the memory.)
    expect(partyRoles(party, { valeros: "leader", lini: "lt1" }, new Set(["lt1"]))).toEqual([{ id: "t2", slot: "leader", why: "wantsToLead" }]);
  });

  test("with no leader remembered, the one who wants to lead leads; two who want it: nobody", () => {
    expect(partyRoles(party, {})).toEqual([{ id: "t2", slot: "leader", why: "wantsToLead" }]);
    const rivals = [...party, { id: "t4", actorId: "kyra", playstyles: ["martyr", "leader"] }];
    expect(partyRoles(rivals, {})).toEqual([]);
    expect(partyRoles(party.filter(m => m.id !== "t2"), {})).toEqual([]);
  });

  test("what's remembered: the GM's pick by actor, one holder a slot; none forgets it; a boss leads the party", () => {
    let memory = rememberRole({}, "amiri", "leader");
    memory = rememberRole(memory, "lini", "lt1");
    expect(memory).toEqual({ amiri: "leader", lini: "lt1" });
    memory = rememberRole(memory, "ezren", "boss");
    expect(memory).toEqual({ ezren: "leader", lini: "lt1" });
    memory = rememberRole(memory, "lini", "none");
    expect(memory).toEqual({ ezren: "leader" });
    expect(rememberRole(memory, "ezren", null)).toEqual({});
  });
});
