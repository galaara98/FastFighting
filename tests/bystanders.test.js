import { describe, expect, test } from "vitest";
import { runBatchSync, replay } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle } from "./helpers.js";

const at = (x, y) => ({ x, y, size: 5 });

/** Party of two vs one foe, plus a hostile bystander far away. */
function scene({ see = false, hearDC = null, smell = false, feel = false, radar = false, flee = false, hunter = false } = {}) {
  const pcs = [
    creature({ id: "pc1", kind: "pc", diesAtZero: false, position: at(0, 0), tactics: hunter ? { beyond: "hunt" } : null }),
    creature({ id: "pc2", kind: "pc", diesAtZero: false, position: at(0, 10) })
  ];
  // A feral foe never thinks to fetch help, so only perception (or fleeing) can wake the guard.
  const foe = creature({ id: "foe", side: "hostile", position: at(10, 0), traits: { brave: { base: flee ? 0 : 60, fudge: 0 }, tactical: { base: 0, fudge: 0 } }, flags: { fearless: !flee } });
  const bystander = creature({ id: "guard", side: "hostile", inEncounter: false, position: at(60, 0) });
  const spec = battle([...pcs, foe, bystander], { positioning: true, maxRounds: 10 });
  const cue = see || smell || feel || radar || hearDC !== null ? { see, smell, feel, radar, hearDC } : null;
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

  test("a bystander noticing by smell, by feel (tremorsense, lifesense ...) or on radar says so", () => {
    for ( const sense of ["smell", "feel", "radar"] ) {
      const spec = scene({ [sense]: true });
      const causes = new Set();
      for ( let s = 1; s <= 40; s++ ) {
        for ( const e of replay(spec, pf2eRules, s).log ) if ( e.type === "notice" && e.actor === "guard" ) causes.add(e.cause);
      }
      expect(causes.has(sense)).toBe(true);
      expect([...causes].every(c => [sense, "fledInto", "help", "attacked"].includes(c))).toBe(true);
    }
  });

  test("a hazard lying in wait is nothing to notice, nor anyone's people in the fight", () => {
    const spec = scene();
    const trap = creature({ id: "trap", side: "hostile", position: at(55, 0), actions: [], hazard: { once: true }, untargetable: true, flags: { fearless: true, mindless: true } });
    spec.combatants.push(trap);
    spec.awareness.guard.trap = { see: true, smell: false, feel: false, radar: false, hearDC: 5 };
    const r = runBatchSync(spec, pf2eRules, { runs: 200 });
    expect(r.combatants.guard.pInvolved).toBe(0);
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

describe("aware of the conflict", () => {
  test("a bystander who notices takes its first turn the round after", () => {
    let checked = 0;
    for ( let seed = 1; seed <= 15; seed++ ) {
      const r = replay(scene({ see: true }), pf2eRules, seed);
      const noticed = r.log.find(e => e.actor === "guard" && e.type === "notice");
      if ( !noticed ) continue;
      checked += 1;
      // Nothing else from it that round; then it joins.
      expect(r.log.filter(e => e.actor === "guard" && e.round === noticed.round && e.type !== "notice" && e.type !== "thought")).toEqual([]);
      const joined = r.log.find(e => e.actor === "guard" && e.type === "join");
      if ( joined ) expect(joined.round).toBe(noticed.round + 1);
    }
    expect(checked).toBeGreaterThan(5);
  });

  test("once aware, a bystander always takes part (no more deciding whether to join)", () => {
    let noticed = 0;
    for ( let seed = 1; seed <= 20; seed++ ) {
      const r = replay(scene({ see: true }), pf2eRules, seed);
      if ( !r.log.some(e => e.actor === "guard" && e.type === "notice") ) continue;
      noticed += 1;
      expect(r.log.some(e => e.actor === "guard" && e.type === "join")).toBe(true);
      expect(r.log.some(e => e.actor === "guard" && (e.type === "leave" || e.type === "watch"))).toBe(false);
    }
    expect(noticed).toBeGreaterThan(5);
  });

  test("a neutral bystander who notices takes no side, but starts weighing what it wants", () => {
    const spec = scene({ see: true });
    const guard = spec.combatants.find(c => c.id === "guard");
    Object.assign(guard, { side: "neutralParty", originSide: "neutral", lean: "friendly" });
    // (A tough foe, so the fight lasts long enough for the guard to notice it.)
    Object.assign(spec.combatants.find(c => c.id === "foe"), { hp: { value: 120, max: 120 } });
    let watched = 0;
    for ( let seed = 1; seed <= 15; seed++ ) {
      const r = replay(spec, pf2eRules, seed);
      const joined = r.log.find(e => e.actor === "guard" && (e.type === "watch" || e.type === "join"));
      if ( !joined ) continue;
      watched += 1;
      expect(joined.type).toBe("watch");
      // It only ever fights the side it turns on (here, the foe hurting the party it leans toward).
      expect(r.log.filter(e => e.actor === "guard" && e.type === "attack").every(e => e.target === "foe")).toBe(true);
    }
    expect(watched).toBeGreaterThan(5);
  });
});
