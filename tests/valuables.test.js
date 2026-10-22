/**
 * What a creature has that could change hands (stolen, looted, given up), as the engine counts it, in a system without
 * coins and goods (Ironsworn): its side shares its Supply, and a foe gives ground instead.
 */
import { describe, expect, test } from "vitest";
import { prepareBattle } from "../scripts/engine/simulator.js";
import { createRun } from "../scripts/engine/battle-state.js";
import { createRng } from "../scripts/engine/rng.js";
import { beginLive, endLive, liveAftermath } from "../scripts/engine/live.js";
import { remaining, concession, hasValuables } from "../scripts/engine/behavior/talk.js";
import { STATUS } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle, social } from "./helpers.js";

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

  test("ground given stays given, even when the one it was given to is beaten; Supply taken comes back", () => {
    const run = beginLive(battle([pc("a"), foe]), pf2eRules, { seed: 1 });
    const [a, f] = [run.byId.get("a"), run.byId.get("foe")];
    const ground = { kind: "progress", amount: 1, to: "a", toName: "a", round: 1 };
    const taken = { kind: "money", amount: 2, denominations: supply, to: "foe", toName: "foe", round: 1 };
    f.concessions = [ground];
    a.concessions = [taken];
    a.status = STATUS.DEAD;
    f.status = STATUS.DEAD;
    endLive(run);
    liveAftermath(run);
    expect(ground.returned).toBeFalsy();
    expect(taken.returned).toBe(true);
  });
});
