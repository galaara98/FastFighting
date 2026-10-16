/**
 * Desires it can't act on (behavior/hopeless.js): on its turn, one it couldn't work on now (whoever it would hurt
 * nowhere to be found) sinks to the bottom and can't lead; still so on its next turn, it's given up, unless the
 * creature plans ahead (tactical or better), which keeps it at the bottom until the chance comes.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, prepareBattle } from "../scripts/engine/simulator.js";
import { mind, levelOf } from "../scripts/engine/behavior/desire.js";
import { recompute } from "../scripts/engine/behavior/effects.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const traitsAt = tactical => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 50, fudge: 0 }, selfish: { base: 50, fudge: 0 }, loyal: { base: 50, fudge: 0 } });
const at = x => ({ position: { x, y: 0, size: 5 } });

/** A brute, blind and deaf, set on a foe it can't find (40 feet off), with another right beside it. */
function fight(tactical) {
  const spec = battle([
    creature({ id: "brute", name: "Brute", traits: traitsAt(tactical), hp: { value: 200, max: 200 }, actions: [strike({ bonus: -50 })], desires: [{ kind: "hurt", targetId: "far", level: 90 }], ...at(0) }),
    creature({ id: "near", name: "Near", side: "hostile", traits: traitsAt(50), hp: { value: 200, max: 200 }, actions: [strike({ bonus: -50 })], ...at(5) }),
    creature({ id: "far", name: "Far", side: "hostile", traits: traitsAt(50), hp: { value: 200, max: 200 }, actions: [strike({ bonus: -50 })], ...at(40) })
  ], { maxRounds: 4, positioning: true, aftermath: "none", morale: false, talking: false });
  const run = beginRun(prepareBattle(spec, pf2eRules), 2, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  const b = run.byId.get("brute");
  b.effects.push({ key: "dark", conditions: { blinded: 1, deafened: 1 }, sourceId: null, rounds: 99, mods: null });
  recompute(b);
  b.adjacent.add("near");
  run.byId.get("near").adjacent.add("brute");
  return { run, b };
}

describe("a desire it can't act on", () => {
  test("sinks to the bottom, can't lead, and is given up if it's still out of reach next turn", () => {
    const { run, b } = fight(30);
    takeTurn(run, b);
    expect(b.desire.sunk.has("hurt|far")).toBe(true);
    const m = mind(run, b);
    expect(m.lead?.targetId).not.toBe("far");
    expect(m.ranked.at(-1)).toMatchObject({ kind: "hurt", targetId: "far", sunk: true });
    takeTurn(run, b);
    // (Given up: what it was set on is gone, and only a passing thought of the sort anyone has is left.)
    expect(b.desire.stated.has("hurt|far")).toBe(false);
    expect(levelOf(b, "hurt", "far")).toBeLessThan(20);
  });

  test("one who plans ahead keeps it, at the bottom, until it can act on it", () => {
    const { run, b } = fight(70);
    takeTurn(run, b);
    takeTurn(run, b);
    expect(levelOf(b, "hurt", "far")).toBeGreaterThanOrEqual(90);
    expect(b.desire.sunk.has("hurt|far")).toBe(true);
    // (Its sight back: back where its strength puts it.)
    b.effects = b.effects.filter(e => e.key !== "dark");
    recompute(b);
    run.geo = (run.geo ?? 0) + 1;
    takeTurn(run, b);
    expect(b.desire.sunk.has("hurt|far")).toBe(false);
  });
});
