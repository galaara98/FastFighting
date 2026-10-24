/**
 * A fallen boss's share of its team's cash, in a fight (behavior/fallen.js, theft.js teamCash, flight.js prizeFlight):
 * one of its own that robs the fallen goes for it, and with a haul like that may make off.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, prepareBattle, takeTurn } from "../scripts/engine/simulator.js";
import { prizeFlight } from "../scripts/engine/behavior/flight.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const traits = (t = {}) => Object.fromEntries(["tactical", "brave", "selfish", "loyal"].map(k => [k, { base: t[k] ?? 50, fudge: 0 }]));
const at = (x, y = 0) => ({ position: { x, y, size: 5 } });

describe("a dead boss's share of the team's cash", () => {
  test("a teammate that robs the fallen takes it off the body, and then may well make off with it", () => {
    const hero = creature({ id: "hero", kind: "pc", hp: { value: 100, max: 100 }, actions: [strike({ bonus: -50 })], ...at(250) });
    const kobold = (id, extra = {}) => creature({ id, name: id, side: "hostile", hp: { value: 20, max: 20 }, traits: traits({ selfish: 80 }),
      actions: [strike({ bonus: -50 })], valuables: { money: 10 }, ...extra });
    const spec = battle([hero, kobold("boss", at(0)), kobold("grunt", { ...at(5), tactics: { fallen: "rob" } })],
      { maxRounds: 6, positioning: true, aftermath: "none", opening: "fight" });
    spec.purses = { hostile: 900 };
    spec.command = { hostile: [{ id: "boss", role: "boss" }] };
    const run = beginRun(prepareBattle(spec, pf2eRules), 3, { log: true });
    beginRound(run, 1);
    const [boss, grunt] = ["boss", "grunt"].map(id => run.byId.get(id));
    // (The boss falls dead: its share, 8 of 9, on its body.)
    Object.assign(boss, { status: "dead", hp: 0 });
    run.rng.chance = () => false; // (no leaving yet: this turn is for the body)
    // (Its share falls with it as the turn it died in ends: the hero's.)
    takeTurn(run, run.byId.get("hero"));
    expect(boss.purseDrop).toBe(800);
    takeTurn(run, grunt);
    const robbed = run.log.find(e => e.type === "rob" && e.actorId === "grunt" && e.targetId === "boss");
    expect(robbed?.stolen).toMatchObject({ kind: "money", amount: 810 });
    // (810 against the 10 it had: as big a haul as it gets.)
    expect(prizeFlight(run, grunt)).toBeGreaterThan(0.3);
  });
});
