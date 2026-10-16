/**
 * A fear condition is the game's rule while it lasts, and the system's to say: by default the frightened keep away from
 * whoever frightened them, and never run or leave the fight for it. Frightened again and again, past what its nerve
 * bears, a creature wants to get away on its own: that may send it running.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, prepareBattle } from "../scripts/engine/simulator.js";
import { levelOf } from "../scripts/engine/behavior/desire.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const traits = { tactical: { base: 70, fudge: 0 }, brave: { base: 50, fudge: 0 }, selfish: { base: 50, fudge: 0 }, loyal: { base: 50, fudge: 0 } };
const at = x => ({ position: { x, y: 0, size: 5 } });

function fight(rules = pf2eRules) {
  const spec = battle([
    creature({ id: "ogre", name: "Ogre", traits, hp: { value: 200, max: 200 }, actions: [strike({ bonus: -50 })], ...at(0) }),
    creature({ id: "goblin", name: "Goblin", side: "hostile", traits, hp: { value: 30, max: 30 }, actions: [strike({ bonus: -50 })], ...at(5) })
  ], { maxRounds: 4, positioning: true, aftermath: "none", morale: false });
  spec.bounds = { x0: -500, y0: -500, x1: 500, y1: 500 };
  const run = beginRun(prepareBattle(spec, rules), 4, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}
const fear = (u, by, conditions) => u.effects.push({ key: `fright:${conditions.frightened ?? "flee"}`, conditions, sourceId: by.id, rounds: 3, mods: null });
const ran = (run, id) => run.log.some(e => e.type === "flee" && e.actorId === id);

describe("fear, by default", () => {
  test("frightened, or even fleeing: it keeps away while it lasts, and doesn't run for it", () => {
    for ( const conditions of [{ frightened: 2 }, { fleeing: 1 }] ) {
      const run = fight();
      const [o, g] = ["ogre", "goblin"].map(id => run.byId.get(id));
      fear(g, o, conditions);
      takeTurn(run, g);
      expect(levelOf(g, "avoid", o.id)).toBeGreaterThan(0);
      expect(levelOf(g, "avoid", o.id, { conditions: false })).toBe(0);
      expect(ran(run, "goblin")).toBe(false);
      expect(g.leaving ?? null).toBeNull();
    }
  });

  test("its fear made worse and worse (three steps, for one of middling nerve): it wants to get away on its own, and runs", () => {
    const run = fight();
    const [o, g] = ["ogre", "goblin"].map(id => run.byId.get(id));
    fear(g, o, { frightened: 3 });
    takeTurn(run, g);
    // (Its own dread of the ogre, close at hand, sends it off: setting out, it lays its quarrel down.)
    expect(run.log.find(e => e.type === "flee" && e.actorId === "goblin")).toMatchObject({ why: "dread", dread: "Ogre", leaving: true });
  });
});

describe("fear, as the system says", () => {
  test("a system whose fright means nothing to keep away from: nothing", () => {
    const rules = { ...pf2eRules, conditionWishes: (run, u, { key }) => (key === "frightened" ? [] : null) };
    const run = fight(rules);
    const [o, g] = ["ogre", "goblin"].map(id => run.byId.get(id));
    fear(g, o, { frightened: 3 });
    takeTurn(run, g);
    expect(levelOf(g, "avoid", o.id)).toBe(0);
  });

  test("whatever its fright means in the system, its fear worse again and again is a reason to run", () => {
    const rules = { ...pf2eRules, conditionWishes: (run, u, { key }) => (key === "frightened" ? [] : null) };
    const run = fight(rules);
    const [o, g] = ["ogre", "goblin"].map(id => run.byId.get(id));
    fear(g, o, { frightened: 3 });
    takeTurn(run, g);
    expect(run.log.find(e => e.type === "flee" && e.actorId === "goblin")).toMatchObject({ why: "dread" });
  });

  test("and one whose fright keeps it away as it says", () => {
    const rules = { ...pf2eRules, conditionWishes: (run, u, { key, by }) => (key === "frightened" ? [{ kind: "avoid", targetId: by.id, level: 33 }] : null) };
    const run = fight(rules);
    const [o, g] = ["ogre", "goblin"].map(id => run.byId.get(id));
    fear(g, o, { frightened: 1 });
    takeTurn(run, g);
    expect(levelOf(g, "avoid", o.id)).toBeGreaterThanOrEqual(33);
    expect(levelOf(g, "avoid", o.id, { conditions: false })).toBe(0);
  });
});
