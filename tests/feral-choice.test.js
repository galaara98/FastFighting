/**
 * A feral creature with spells or maneuvers doesn't plan: half the time it does anything it has (targeting.js
 * bestOptionVs). Anything that does something, that is: never a Demoralize the foe has already shrugged off.
 */
import { expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const feral = { tactical: { base: 5, fudge: 0 }, brave: { base: 70, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 50, fudge: 0 } };
const demoralize = { id: "demoralize", name: "Demoralize", kind: "control", cost: 1, check: { mod: 4, against: "will" }, oncePerTarget: true,
  range: { increment: 30, max: 30, noPenalty: true }, melee: false, traits: ["mental"],
  onHit: [null, null, { conditions: { frightened: 1 }, rounds: 1, label: "frightened 1" }, { conditions: { frightened: 2 }, rounds: 2, label: "frightened 2" }] };

test("a feral creature never tries a once-per-target Demoralize on the same foe twice", () => {
  let tries = 0;
  for ( let seed = 1; seed <= 12; seed++ ) {
    const r = replay(battle([
      creature({ id: "hero", hp: { value: 300, max: 300 }, actions: [strike({ bonus: 0 })] }),
      creature({ id: "hyena", side: "hostile", hp: { value: 300, max: 300 }, traits: feral, flags: { fearless: true }, actions: [strike({ id: "jaws", name: "Jaws" }), demoralize] })
    ], { maxRounds: 3 }), pf2eRules, seed);
    const scares = r.log.filter(e => e.type === "control" && e.action === "Demoralize" && e.actorId === "hyena");
    tries += scares.length;
    expect(scares.length).toBeLessThanOrEqual(1);
  }
  expect(tries).toBeGreaterThan(0);
});
