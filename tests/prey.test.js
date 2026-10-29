/**
 * A hunted prey (API 37.3): the foe a creature hunts (u.preyId, spec.preyId), set by an action that hunts it as it strikes
 * (action.huntsPrey: PF2e's Hunt Prey); extra damage against it alone (bonusDamage "prey"); the system's attack penalty
 * told whom it's against (rules.attackPenalty's attacker and target: PF2e's Flurry).
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, prepareBattle, replay } from "../scripts/engine/simulator.js";
import { bonusDamageParts, attackRoll } from "../scripts/engine/battle-state.js";
import { parseFormula, part } from "../scripts/engine/dice.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const at = x => ({ position: { x, y: 0, size: 5 } });
const edge = { id: "precision", when: "prey", oncePerTurn: true, parts: [part([{ n: 1, faces: 8 }], 0, "slashing", { category: "precision" })] };
const sword = strike({ id: "sword", name: "Sword", bonus: 12, damage: [parseFormula("1d8+4", "slashing")], bonusDamage: [edge] });
const hunt = { ...sword, id: "sword.hunt", name: "Hunt Prey (Sword)", cost: 2, huntsPrey: true, classAction: "hunt-prey" };

function field(extra = {}) {
  return beginRun(prepareBattle(battle([
    creature({ id: "ranger", name: "Ranger", actions: [sword, hunt], hp: { value: 100, max: 100 }, ...at(0), ...extra }),
    creature({ id: "orc", name: "Orc", side: "hostile", hp: { value: 300, max: 300 }, flags: { fearless: true }, ...at(5) }),
    creature({ id: "goblin", name: "Goblin", side: "hostile", hp: { value: 300, max: 300 }, flags: { fearless: true }, ...at(-5) })
  ], { positioning: true, maxRounds: 3 }), pf2eRules), 1, { log: true });
}

describe("the hunted prey", () => {
  test("its extra damage against the prey alone; the prey from the sheet (spec.preyId)", () => {
    const run = field({ preyId: "orc" });
    const [ranger, orc, goblin] = ["ranger", "orc", "goblin"].map(id => run.byId.get(id));
    expect(ranger.preyId).toBe("orc");
    expect(bonusDamageParts(run, ranger, sword, orc).some(p => p.category === "precision")).toBe(true);
    expect(bonusDamageParts(run, ranger, sword, goblin).some(p => p.category === "precision")).toBe(false);
  });

  test("a Strike that hunts makes its foe the prey, its edge on that very blow", () => {
    let hunted = 0;
    for ( const seed of [1, 2, 3, 4, 5] ) {
      const r = replay(battle([
        creature({ id: "ranger", name: "Ranger", actions: [sword, hunt], hp: { value: 100, max: 100 }, ...at(0) }),
        creature({ id: "orc", name: "Orc", side: "hostile", hp: { value: 300, max: 300 }, flags: { fearless: true }, ...at(5) })
      ], { positioning: true, maxRounds: 2 }), pf2eRules, seed);
      const hunts = r.log.filter(e => e.actorId === "ranger" && e.type === "attack" && e.action === "Hunt Prey (Sword)");
      hunted += hunts.length;
      // (Once it hunts the orc, it never hunts it again: the plain Strike has the edge from then on.)
      expect(hunts.length).toBeLessThanOrEqual(1);
    }
    expect(hunted).toBeGreaterThan(0);
  });

  test("the system's attack penalty hears whom the attack is against", () => {
    const seen = [];
    const rules = { ...pf2eRules, attackPenalty: (action, n, ctx) => { seen.push(ctx?.target?.id ?? null); return 0; } };
    const run = beginRun(prepareBattle(battle([
      creature({ id: "ranger", actions: [sword], ...at(0) }), creature({ id: "orc", side: "hostile", ...at(5) })
    ], { positioning: true }), rules), 1);
    beginRound(run, 1);
    attackRoll(run, run.byId.get("ranger"), run.byId.get("orc"), sword, 1);
    expect(seen).toContain("orc");
  });
});
