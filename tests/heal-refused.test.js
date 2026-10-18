/**
 * A heal the system says can't mend someone (rules.usable, asked of heals: PF2e's vitality healing on one with void
 * healing) makes nobody want to heal that one with it, during the fight or after it.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, prepareBattle } from "../scripts/engine/simulator.js";
import { healScores, rescueOption } from "../scripts/engine/behavior/healing.js";
import { Turn } from "../scripts/engine/turn.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle } from "./helpers.js";

const heal = { id: "heal", name: "Heal", kind: "heal", cost: 2, heal: [parseFormula("2d8", "healing")], traits: ["healing", "vitality"], range: { increment: 30, max: 30, noPenalty: true } };
const rules = { ...pf2eRules, usable: (run, u, a, t) => !(a.kind === "heal" && a.traits?.includes("vitality") && t?.spec.undead) };

function setUp() {
  const hurt = { value: 3, max: 20, temp: 0 };
  const run = beginRun(prepareBattle(battle([
    creature({ id: "cleric", actions: [heal] }), creature({ id: "zombie", hp: hurt, undead: true }), creature({ id: "fighter", hp: hurt }), creature({ id: "foe", side: "hostile" })
  ]), rules), 1);
  beginRound(run, 1);
  return run;
}

describe("a heal the system says can't mend someone", () => {
  test("only those it mends are worth healing", () => {
    const run = setUp();
    const ids = healScores(run, run.byId.get("cleric")).map(x => x.ally.id);
    expect(ids).toContain("fighter");
    expect(ids).not.toContain("zombie");
  });

  test("nor after the fight, for one down", () => {
    const run = setUp();
    const cleric = run.byId.get("cleric");
    const turn = new Turn(rules, cleric, 0);
    expect(rescueOption(run, cleric, run.byId.get("zombie"), turn)).not.toBe(heal);
    expect(rescueOption(run, cleric, run.byId.get("fighter"), turn)?.id).toBe("heal");
  });
});
