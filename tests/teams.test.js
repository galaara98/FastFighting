/**
 * The GM's teams and chains of command in a live battle (engine/live.js setSide, setRole): a hostile group the fight
 * didn't have (it joins as everyone's enemy), a neutral friend group, a place in a group's chain (boss, leader,
 * lieutenants); what everyone wants worked out again at once; kept with the battle, and there again when it's restored.
 */
import { describe, expect, test } from "vitest";
import { beginLive, liveRound, setSide, setRole, snapshotRun, restoreRun } from "../scripts/engine/live.js";
import { areEnemies, alliesOf, commandOf, groupKeyOf } from "../scripts/engine/battle-state.js";
import { rankedDesires } from "../scripts/engine/behavior/desire.js";
import { rethink } from "../scripts/engine/simulator.js";
import { NEUTRAL_PARTY } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const traits = { tactical: { base: 60, fudge: 0 }, brave: { base: 70, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
const fight = () => battle([
  creature({ id: "hero", name: "Hero", kind: "pc", traits }),
  creature({ id: "boss", name: "Boss", side: "hostile", traits, actions: [strike()] }),
  creature({ id: "orc", name: "Orc", side: "hostile", traits, actions: [strike()] }),
  creature({ id: "goblin", name: "Goblin", side: "hostile", traits, actions: [strike()] })
], { maxRounds: 4 });
function live() {
  const spec = fight();
  spec.command = { hostile: [{ id: "boss", role: "leader", slot: "leader", leadership: { brave: 10, tacticalFloor: 40 } }] };
  const run = beginLive(spec, pf2eRules, { seed: 3, players: ["hero"] });
  liveRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return { run, spec };
}

describe("teams", () => {
  test("to a hostile group the fight didn't have: it joins, everyone's enemy; and what everyone wants is worked out again", () => {
    const { run } = live();
    const [orc, goblin, hero] = ["orc", "goblin", "hero"].map(id => run.byId.get(id));
    expect(setSide(run, "orc", "hostile2")).toBe(true);
    expect(orc.side).toBe("hostile2");
    expect(areEnemies(run, orc, goblin)).toBe(true);
    expect(areEnemies(run, orc, hero)).toBe(true);
    // (Its old friends want it hurt now, at once.)
    expect(rankedDesires(run, goblin).some(d => d.kind === "hurt" && d.targetId === "orc")).toBe(true);
  });

  test("to a neutral friend group: taking no side, with that group's others", () => {
    const { run } = live();
    setSide(run, "orc", NEUTRAL_PARTY, { group: 2 });
    setSide(run, "goblin", NEUTRAL_PARTY, { group: 2 });
    const orc = run.byId.get("orc");
    expect(orc.side).toBe(NEUTRAL_PARTY);
    expect(groupKeyOf(orc)).toBe(`${NEUTRAL_PARTY}#2`);
    expect(alliesOf(run, orc).map(u => u.id).sort()).toEqual(["goblin", "orc"]);
    // (To another of its groups: just that.)
    expect(setSide(run, "goblin", NEUTRAL_PARTY, { group: 3 })).toBe(true);
    expect(alliesOf(run, orc).map(u => u.id)).toEqual(["orc"]);
  });

  test("a friend becomes a foe's teammate: the hero's wish to hurt it goes, and its new side's foes want it", () => {
    const { run } = live();
    const goblin = run.byId.get("goblin");
    rethink(run, goblin);
    expect(rankedDesires(run, goblin).some(d => d.kind === "hurt" && d.targetId === "hero")).toBe(true);
    setSide(run, "hero", "hostile");
    expect(rankedDesires(run, goblin).some(d => d.kind === "hurt" && d.targetId === "hero")).toBe(false);
  });
});

describe("chains of command", () => {
  test("a new leader: the one it had gives it up, the side follows its new head, everyone's thinking again", () => {
    const { run } = live();
    const orc = run.byId.get("orc");
    expect(commandOf(run, orc).unit.id).toBe("boss");
    expect(setRole(run, "orc", "leader", { brave: 20, tacticalFloor: 50 })).toBe(true);
    expect(commandOf(run, run.byId.get("goblin")).unit.id).toBe("orc");
    expect(run.prep.sides.hostile.leaderId).toBe("orc");
    expect(run.prep.command.hostile.map(c => [c.id, c.slot])).toEqual([["orc", "leader"]]);
    // (A lieutenant beside it; out again with "none".)
    setRole(run, "goblin", "lt1");
    expect(run.prep.command.hostile.map(c => c.slot)).toEqual(["leader", "lt1"]);
    setRole(run, "goblin", "none");
    expect(run.prep.command.hostile.map(c => c.id)).toEqual(["orc"]);
  });

  test("the lieutenant takes over when the head can't lead", () => {
    const { run } = live();
    setRole(run, "orc", "lt1");
    run.byId.get("boss").status = "down";
    expect(commandOf(run, run.byId.get("goblin")).unit.id).toBe("orc");
  });

  test("the party has no boss; one who changes team gives up its place in the old one's chain", () => {
    const { run } = live();
    expect(setRole(run, "hero", "boss")).toBe(false);
    setSide(run, "boss", "hostile2");
    expect(run.prep.command.hostile ?? []).toHaveLength(0);
  });

  test("kept with the battle: a restored one has the new group and the new chain", () => {
    const { run, spec } = live();
    setSide(run, "orc", "hostile2");
    setRole(run, "goblin", "leader");
    const back = restoreRun(spec, pf2eRules, snapshotRun(run));
    expect(back.prep.sides.hostile2).toBeTruthy();
    expect(areEnemies(back, back.byId.get("orc"), back.byId.get("goblin"))).toBe(true);
    expect(commandOf(back, back.byId.get("boss")).unit.id).toBe("goblin");
  });
});
