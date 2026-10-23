/**
 * The planner's Overview numbers (engine/aggregate.js): the party's lot, how the party's foes end, bystanders joining,
 * reinforcements arriving and a foe's leader falling, from fights' summaries.
 */
import { describe, expect, test } from "vitest";
import { createAggregator, foeEnd, FOE_ENDS } from "../scripts/engine/aggregate.js";

const prep = {
  sides: { friendly: { label: "Party" }, hostile: { label: "Hostile" } },
  combatants: [
    { spec: { id: "kyra", kind: "pc", side: "friendly" } },
    { spec: { id: "valeros", kind: "pc", side: "friendly" } },
    { spec: { id: "orc", kind: "npc", side: "hostile" } },
    { spec: { id: "boss", kind: "npc", side: "hostile" } },
    { spec: { id: "hermit", kind: "npc", side: "hostile", inEncounter: false } }
  ],
  command: { hostile: [{ id: "boss", role: "boss" }] },
  reinforcements: new Map([["hostile", {}]])
};

const unit = (status, extra = {}) => ({
  status, involved: true, wasDowned: ["dead", "down"].includes(status), hpFrac: status === "standing" ? 0.5 : 0,
  damage: 0, healing: 0, resourcesUsed: {}, conceded: false, swayed: null, ...extra
});

function twoFights() {
  const agg = createAggregator(prep);
  // A wipe: both PCs out, the orc slain, the boss fled; the hermit never joined.
  agg.add({ outcome: "victory", winners: ["hostile"], rounds: 4, units: {
    kyra: unit("down"), valeros: unit("dead"), orc: unit("dead"), boss: unit("fled"), hermit: unit("standing", { involved: false })
  } }, 1);
  // A win: Kyra paid up, the orc talked over, the boss slain, the hermit joined, reinforcements came.
  agg.add({ outcome: "victory", winners: ["friendly"], rounds: 6, units: {
    kyra: unit("standing", { conceded: true }), valeros: unit("standing"), orc: unit("standing", { swayed: "neutral" }),
    boss: unit("dead"), hermit: unit("standing"), "reinforce~hostile~0": unit("standing")
  } }, 2);
  return agg.finish();
}

describe("the party's lot", () => {
  test("wiped, PCs down and dead on average, HP left, goods lost", () => {
    const { party } = twoFights();
    expect(party.pcs).toBe(2);
    expect(party.pWiped).toBe(0.5);
    expect(party.meanDowned).toBe(1);
    expect(party.meanDead).toBe(0.5);
    expect(party.meanHp).toBe(0.25);
    expect(party.pLostGoods).toBe(0.5);
  });

  test("no PCs: none", () => {
    const agg = createAggregator({ ...prep, combatants: prep.combatants.filter(c => c.spec.kind !== "pc") });
    agg.add({ outcome: "stalemate", winners: [], rounds: 12, units: { orc: unit("standing") } }, 1);
    expect(agg.finish().party).toBeNull();
  });
});

describe("how the foes end", () => {
  test("each foe in each fight it took part in, by how it ended", () => {
    const { foesEnd } = twoFights();
    expect(Object.keys(foesEnd)).toEqual(FOE_ENDS);
    expect(foesEnd.slain).toBeCloseTo(2 / 5);
    expect(foesEnd.fled).toBeCloseTo(1 / 5);
    expect(foesEnd.talked).toBeCloseTo(1 / 5);
    expect(foesEnd.standing).toBeCloseTo(1 / 5);
    expect(foesEnd.down + foesEnd.captured + foesEnd.gaveUp).toBe(0);
  });

  test("talked over before its status; giving up covers surrender, beaten and standing down", () => {
    expect(foeEnd({ status: "standing", swayed: "switched" })).toBe("talked");
    for ( const status of ["surrendered", "beaten", "stoodDown"] ) expect(foeEnd({ status })).toBe("gaveUp");
    expect(foeEnd({ status: "bound" })).toBe("captured");
  });
});

describe("the fight", () => {
  test("bystanders joining, reinforcements arriving, a foe's leader falling", () => {
    const r = twoFights();
    expect(r.pBystandersJoin).toBe(0.5);
    expect(r.pReinforced).toBe(0.5);
    expect(r.pFoeHeadFalls).toBe(1);
  });

  test("none to count: null", () => {
    const agg = createAggregator({ ...prep, combatants: prep.combatants.filter(c => c.spec.id !== "hermit"), command: {}, reinforcements: new Map() });
    agg.add({ outcome: "stalemate", winners: [], rounds: 12, units: { orc: unit("standing") } }, 1);
    const r = agg.finish();
    expect([r.pBystandersJoin, r.pReinforced, r.pFoeHeadFalls]).toEqual([null, null, null]);
  });
});
