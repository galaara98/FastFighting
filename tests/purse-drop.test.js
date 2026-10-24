/**
 * A team's purse as the dead leave it (battle-state.js purseShares, behavior/talk.js dropShare): the purse pictured
 * split as the fight starts, a share each, a lieutenant 2, a leader 4, a boss a leader's times the boss's influence;
 * each that dies leaves its share of what's still in the purse on its body (down for a single share, up for the rest),
 * out of the purse; and a live battle's change set carries it (engine/changes.js purseDrop).
 */
import { describe, expect, test } from "vitest";
import { purseShares } from "../scripts/engine/battle-state.js";
import { dropShare, purseLeft } from "../scripts/engine/behavior/talk.js";
import { diffOutcome } from "../scripts/engine/changes.js";

const unit = id => ({ id });
const team = (money, roles, bossInfluence = 2) => {
  const members = Object.keys(roles).map(unit);
  const command = { hostile: Object.entries(roles).filter(([, r]) => r).map(([id, role]) => ({ id, role })) };
  const purse = { key: "hostile", money, members, ...purseShares({ command, options: { bossInfluence } }, "hostile", members) };
  for ( const u of members ) u.purse = purse;
  return Object.fromEntries(members.map(u => [u.id, u]));
};

describe("a team's purse, pictured split", () => {
  test("a share each, a lieutenant 2, a leader 4, a boss a leader's times the boss's influence", () => {
    const t = team(1000, { boss: "boss", lt: "lieutenant", g1: null, g2: null });
    expect(t.boss.purse.shares).toEqual({ boss: 8, lt: 2, g1: 1, g2: 1 });
    expect(t.boss.purse.totalShares).toBe(12);
    expect(team(1000, { boss: "boss", g: null }, 3).boss.purse.shares.boss).toBe(12);
  });
});

describe("the dead leave their share", () => {
  test("of what's still in the purse: down for a grunt, up for the rest; out of the purse; once", () => {
    const t = team(1000, { boss: "boss", lt: "lieutenant", g1: null, g2: null });
    expect(dropShare(t.g1)).toBe(83); // 1000 / 12, down
    expect(purseLeft(t.boss)).toBe(917);
    expect(dropShare(t.lt)).toBe(153); // 917 * 2 / 12 = 152.8, up
    expect(purseLeft(t.boss)).toBe(764);
    expect(dropShare(t.lt)).toBeNull();
    expect(dropShare(t.boss)).toBe(510); // 764 * 8 / 12 = 509.3, up
    expect(purseLeft(t.g2)).toBe(254);
  });

  test("a promotion or a demotion in the fight changes no one's share: the purse was pictured split as it began", async () => {
    const { prepareBattle } = await import("../scripts/engine/simulator.js");
    const { createRun } = await import("../scripts/engine/battle-state.js");
    const { pf2eRules } = await import("./fixtures/three-action-rules.js");
    const { creature, strike, battle } = await import("./helpers.js");
    const foe = id => creature({ id, side: "hostile", actions: [strike({ bonus: 1 })] });
    const spec = battle([creature({ id: "hero" }), foe("chief"), foe("g1"), foe("g2")]);
    spec.purses = { hostile: 600 };
    spec.command = { hostile: [{ id: "chief", role: "leader" }] };
    const run = createRun(prepareBattle(spec, pf2eRules));
    const [chief, g1] = ["chief", "g1"].map(id => run.byId.get(id));
    expect(chief.purse.shares).toEqual({ chief: 4, g1: 1, g2: 1 });
    // (The chief falls, a grunt steps up to lead: it still has a grunt's share.)
    run.prep.command.hostile = [{ id: "g1", role: "leader" }];
    expect(dropShare(g1)).toBe(100); // 600 / 6, down
  });

  test("one with no purse leaves nothing to settle", () => {
    expect(dropShare({ id: "x" })).toBeNull();
  });
});

describe("in a live battle's change set", () => {
  test("the share it left as it died, once", () => {
    expect(diffOutcome({ status: "standing" }, { status: "dead", purseDrop: 83 }).purseDrop).toBe(83);
    expect(diffOutcome({ status: "dead", purseDrop: 83 }, { status: "dead", purseDrop: 83 })?.purseDrop).toBeUndefined();
  });
});
