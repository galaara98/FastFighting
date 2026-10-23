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

describe("the stakes", () => {
  /** Four fights: the party wins three, one of them costly (Valeros dies); Kyra goes down in the one it loses. */
  function fourFights() {
    const agg = createAggregator(prep);
    const won = { outcome: "victory", winners: ["friendly"], rounds: 5 };
    agg.add({ ...won, units: { kyra: unit("standing"), valeros: unit("standing"), orc: unit("dead"), boss: unit("dead") } }, 1);
    agg.add({ ...won, units: { kyra: unit("standing"), valeros: unit("standing"), orc: unit("dead"), boss: unit("fled") } }, 2);
    agg.add({ ...won, units: { kyra: unit("standing"), valeros: unit("dead"), orc: unit("dead"), boss: unit("dead") } }, 3);
    agg.add({ outcome: "victory", winners: ["hostile"], rounds: 7, units: { kyra: unit("down"), valeros: unit("standing"), orc: unit("standing"), boss: unit("standing") } }, 4);
    return agg.finish();
  }

  test("costly wins: of the party's wins, those where a PC died or half the PCs went down", () => {
    expect(fourFights().party.pCostlyWin).toBeCloseTo(1 / 3);
  });

  test("each ally's odds of winning when it went down, and when it didn't", () => {
    const { combatants } = fourFights();
    expect(combatants.kyra.pWinIfDowned).toBe(0);
    expect(combatants.kyra.pWinIfUp).toBe(1);
    expect(combatants.valeros.pWinIfDowned).toBe(1);
    expect(combatants.valeros.pWinIfUp).toBeCloseTo(2 / 3);
    expect(combatants.orc.pWinIfDowned).toBeUndefined();
  });

  test("PCs down in the worst tenth of fights", () => {
    expect(fourFights().party.worstDowned).toBe(1);
  });
});

describe("money", () => {
  test("gained: handed or taken to the party's side, and, when it wins, what's on the foes it beat; lost: what it gave up; a deal struck", () => {
    const agg = createAggregator(prep);
    // The party wins: the orc bribed Kyra 50 (she has it), the boss is slain with 300 on it, the fled hermit's 80 isn't loot.
    agg.add({ outcome: "victory", winners: ["friendly"], rounds: 5, units: {
      kyra: unit("standing"), valeros: unit("standing"),
      orc: unit("standing", { gave: [{ to: "kyra", how: "bribe", value: 50, got: true }], worth: 20 }),
      boss: unit("dead", { worth: 300 }), hermit: unit("fled", { worth: 80 })
    } }, 1);
    // The party loses: Valeros paid a toll of 40, and a thief took 10 off Kyra; nothing on the foes counts.
    agg.add({ outcome: "victory", winners: ["hostile"], rounds: 5, units: {
      kyra: unit("down", { gave: [{ to: "orc", how: "theft", value: 10, got: true }] }),
      valeros: unit("standing", { gave: [{ to: "boss", how: "bribe", value: 40, got: true }] }),
      orc: unit("standing", { worth: 30 }), boss: unit("standing", { worth: 340 })
    } }, 2);
    const { money } = agg.finish();
    expect(money.gained).toBe((50 + 300) / 2);
    expect(money.lost).toBe((10 + 40) / 2);
    expect(money.pDeal).toBe(1);
  });

  test("goods left on the ground aren't gained", () => {
    const agg = createAggregator(prep);
    agg.add({ outcome: "stalemate", winners: [], rounds: 12, units: {
      kyra: unit("standing"), orc: unit("standing", { gave: [{ to: "kyra", how: "bribe", value: 50, got: false }] })
    } }, 1);
    expect(agg.finish().money.gained).toBe(0);
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
