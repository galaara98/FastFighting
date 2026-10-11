import { describe, expect, test } from "vitest";
import { runBatchSync, replay } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle } from "./helpers.js";

const at = (x, y) => ({ x, y, size: 5 });

/** Party of two vs one foe, plus a hostile bystander far away. */
function scene({ see = false, hearDC = null, flee = false, hunter = false } = {}) {
  const pcs = [
    creature({ id: "pc1", kind: "pc", diesAtZero: false, position: at(0, 0), tactics: hunter ? { beyond: "hunt" } : null }),
    creature({ id: "pc2", kind: "pc", diesAtZero: false, position: at(0, 10) })
  ];
  // A feral foe never thinks to fetch help, so only perception (or fleeing) can wake the guard.
  const foe = creature({ id: "foe", side: "hostile", position: at(10, 0), traits: { brave: { base: flee ? 0 : 60, fudge: 0 }, tactical: { base: 0, fudge: 0 } }, flags: { fearless: !flee } });
  const bystander = creature({ id: "guard", side: "hostile", inEncounter: false, position: at(60, 0) });
  const spec = battle([...pcs, foe, bystander], { positioning: true, maxRounds: 10 });
  const cue = see || hearDC !== null ? { see, hearDC } : null;
  spec.awareness = { guard: Object.fromEntries(["pc1", "pc2", "foe"].map(id => [id, cue])) };
  return spec;
}

describe("bystanders", () => {
  test("a bystander who never perceives the fight does nothing", () => {
    const r = runBatchSync(scene(), pf2eRules, { runs: 300 });
    expect(r.combatants.guard.pInvolved).toBe(0);
  });

  test("a bystander who can see the fight often joins", () => {
    const r = runBatchSync(scene({ see: true }), pf2eRules, { runs: 300 });
    expect(r.combatants.guard.pInvolved).toBeGreaterThan(0.3);
  });

  test("hearing through walls is harder than seeing", () => {
    const seen = runBatchSync(scene({ see: true }), pf2eRules, { runs: 400 });
    const muffled = runBatchSync(scene({ hearDC: 25 }), pf2eRules, { runs: 400 });
    expect(muffled.combatants.guard.pInvolved).toBeLessThan(seen.combatants.guard.pInvolved);
  });

  test("someone fleeing into a bystander alerts them", () => {
    const r = runBatchSync(scene({ flee: true }), pf2eRules, { runs: 400 });
    expect(r.combatants.guard.pInvolved).toBeGreaterThan(0.05);
  });

  test("a thinking foe that is going badly runs to fetch help", () => {
    const spec = scene();
    const foe = spec.combatants.find(c => c.id === "foe");
    foe.traits = { ...foe.traits, tactical: { base: 60, fudge: 0 } };
    foe.hp = { value: 60, max: 60 };
    const r = runBatchSync(spec, pf2eRules, { runs: 300 });
    expect(r.combatants.guard.pInvolved).toBeGreaterThan(0.2);
  });

  test("hunters go after bystanders after the fight", () => {
    // (Across a few fights: some end before there's anyone left to hunt.)
    const hunted = [1, 2, 3, 4, 5].some(seed => replay(scene({ hunter: true }), pf2eRules, seed).log
      .some(e => e.type === "notice" && e.cause === "attacked" || e.type === "move" && e.purpose === "hunt"));
    expect(hunted).toBe(true);
  });

  test("positions are captured for Make it So", () => {
    const r = replay(scene({ see: true }), pf2eRules, 2);
    expect(r.units.pc1.final.position).toBeTruthy();
    expect(r.log.some(e => e.type === "move" && typeof e.feet === "number")).toBe(true);
  });
});
