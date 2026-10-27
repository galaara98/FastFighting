/**
 * A buff that lasts only to the end of the turn it's laid in (PF2e's "until the end of your turn": Sure Strike) is worth
 * only what's left of that turn once it's paid for: laid with the turn's last action, nothing.
 */
import { expect, test } from "vitest";
import { prepareBattle } from "../scripts/engine/simulator.js";
import { createRun, turnFor } from "../scripts/engine/battle-state.js";
import { outcomeWorth, thisTurnShare } from "../scripts/engine/behavior/effects.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle } from "./helpers.js";

function acting(left) {
  const run = createRun(prepareBattle(battle([creature({ id: "me" }), creature({ id: "foe", side: "hostile" })]), pf2eRules));
  const u = run.byId.get("me");
  u.turn = turnFor(run, u);
  u.turn.spend({ actions: 3 - left });
  run.acting = u;
  return { run, u };
}

test("an end-of-turn buff on oneself is worth only the actions left after it", () => {
  const sure = { mods: { attack: 2 }, rounds: 1, thisTurn: true, label: "+2 attack" };
  const lasting = { ...sure, thisTurn: false };
  const last = acting(1);
  expect(thisTurnShare(last.run, last.u, last.u, sure, 1)).toBe(0);
  expect(outcomeWorth(last.run, last.u, last.u, sure, { cost: 1 })).toBe(0);
  expect(outcomeWorth(last.run, last.u, last.u, lasting, { cost: 1 })).toBeGreaterThan(0);
  const first = acting(3);
  expect(thisTurnShare(first.run, first.u, first.u, sure, 1)).toBeCloseTo(2 / 3, 6);
  expect(outcomeWorth(first.run, first.u, first.u, sure, { cost: 1 })).toBeGreaterThan(0);
  // (Good for one roll: any action left is enough. Two actions to cast, two left: one after.)
  expect(thisTurnShare(first.run, first.u, first.u, { ...sure, uses: 1 }, 2)).toBe(1);
  const two = acting(2);
  expect(thisTurnShare(two.run, two.u, two.u, { ...sure, uses: 1 }, { actions: 2 })).toBe(0);
  // (Laid on a foe as it acts, PF2e's Feint: off-guard to its next blow this turn. As its last action, nothing.)
  const feint = { conditions: { offGuard: 1 }, onlyVs: true, uses: 1, rounds: 1, thisTurn: true };
  expect(outcomeWorth(last.run, last.u, last.run.byId.get("foe"), feint, { versus: last.u, cost: 1 })).toBe(0);
  expect(thisTurnShare(first.run, first.u, first.run.byId.get("foe"), feint, 1)).toBe(1);
  // (Not acting now: as before.)
  const idle = acting(1);
  idle.run.acting = null;
  expect(thisTurnShare(idle.run, idle.u, idle.u, sure, 1)).toBe(1);
});
