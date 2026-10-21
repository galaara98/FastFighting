import { describe, expect, test } from "vitest";
import { diffOutcome, diffAll } from "../scripts/engine/changes.js";
import { beginLive, liveRound, liveTurn, captureAll } from "../scripts/engine/live.js";
import { STATUS } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const state = (over = {}) => ({
  hp: 20, temp: 0, stamina: 0, status: STATUS.STANDING, dying: 0, wounded: 0, stable: false, prone: false, persistent: [], afflictions: [],
  conditions: {}, side: "hostile", swayed: null, against: [], concessions: [], resources: { slot: 2 }, uses: {}, position: { x: 0, y: 0 }, ...over
});

describe("what a turn changed, for the sheets", () => {
  test("nothing changed: nothing to write", () => {
    expect(diffOutcome(state(), state())).toBeNull();
  });

  test("hit points, a fall, conditions set and cleared, new burning, resources, a move", () => {
    const before = state({ conditions: { frightened: 2, slowed: 1 }, persistent: [{ type: "fire", part: { dice: [{ n: 1, faces: 6 }] } }] });
    const after = state({
      hp: 0, status: STATUS.DOWN, dying: 1, prone: true, conditions: { frightened: 1, offGuard: 1 },
      persistent: [{ type: "fire", part: { dice: [{ n: 1, faces: 6 }] } }, { type: "bleed", part: { dice: [{ n: 1, faces: 4 }] } }],
      resources: { slot: 1 }, position: { x: 10, y: 0 }
    });
    const d = diffOutcome(before, after);
    expect(d).toMatchObject({
      hp: { from: 20, to: 0 }, dying: { from: 0, to: 1 }, prone: { from: false, to: true }, fell: true, status: { from: STATUS.STANDING, to: STATUS.DOWN },
      conditions: { set: { frightened: 1, offGuard: 1 }, cleared: ["slowed"] },
      persistent: [{ type: "bleed" }], resources: { slot: { from: 2, to: 1 } }, moved: { from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }
    });
    expect(d.died).toBeUndefined();
    // (Applied, the next turn starts from it: the same again changes nothing.)
    expect(diffOutcome(after, after)).toBeNull();
  });

  test("buffs and debuffs laid and ended this turn (for a helper to put their effect on the sheet, and take it off)", () => {
    const bless = { key: "cleric.bless", sourceId: "cleric", rounds: 10, label: "Bless" };
    const bane = { key: "witch.bane", sourceId: "witch", rounds: 3, label: "Bane" };
    expect(diffOutcome(state({ effects: [bane] }), state({ effects: [bane, bless] })).effects).toEqual({ added: [bless], ended: [] });
    expect(diffOutcome(state({ effects: [bane, bless] }), state({ effects: [bless] })).effects).toEqual({ added: [], ended: [bane] });
    // (Its rounds running down isn't a change.)
    expect(diffOutcome(state({ effects: [bless] }), state({ effects: [{ ...bless, rounds: 9 }] }))).toBeNull();
  });

  test("what only the system's rules keep (rules.capture), when it changed: a death save's success alone is a change", () => {
    const tallies = (success, failure) => state({ hp: 0, status: STATUS.DOWN, dying: failure, system: { deathSuccesses: success, deathFailures: failure } });
    expect(diffOutcome(tallies(0, 1), tallies(1, 1))).toEqual({ system: { from: { deathSuccesses: 0, deathFailures: 1 }, to: { deathSuccesses: 1, deathFailures: 1 } } });
    expect(diffOutcome(tallies(1, 1), tallies(1, 1))).toBeNull();
    expect(diffOutcome(state({ system: null }), state())).toBeNull();
  });

  test("died, ran, won over: each said", () => {
    expect(diffOutcome(state({ status: STATUS.DOWN, hp: 0 }), state({ status: STATUS.DEAD, hp: 0 }))).toMatchObject({ died: true });
    expect(diffOutcome(state(), state({ status: STATUS.FLED }))).toMatchObject({ status: { to: STATUS.FLED } });
    expect(diffOutcome(state(), state({ side: "friendly", swayed: "switched" }))).toMatchObject({ side: true });
    expect(diffOutcome(state(), state({ concessions: [{ kind: "money", amount: 5 }] }))).toMatchObject({ concessions: [{ kind: "money" }] });
  });

  test("a live turn's own changes: only those it touched", () => {
    const spec = battle([
      creature({ id: "pc", kind: "pc", diesAtZero: false, position: at(0), hp: { value: 30, max: 30 } }),
      creature({ id: "orc", side: "hostile", position: at(5), hp: { value: 30, max: 30 }, actions: [strike({ bonus: 30, damage: [parseFormula("8", "slashing")] })] }),
      creature({ id: "far", side: "hostile", position: at(200), hp: { value: 10, max: 10 } })
    ], { positioning: true });
    const run = beginLive(spec, pf2eRules, { seed: 3, players: ["pc"] });
    liveRound(run, 1);
    const before = captureAll(run);
    liveTurn(run, "orc");
    const changes = diffAll(before, captureAll(run));
    expect(changes.pc.hp.to).toBeLessThan(30);
    expect(changes.far).toBeUndefined();
  });
});
