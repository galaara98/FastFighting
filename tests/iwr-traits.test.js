/**
 * API 20: a blow's damage reaches rules.applyIwr with the action's traits, and so does the Statistics Engine's estimate
 * of it, for a weakness or resistance to what deals it rather than to its damage type (PF2e's holy and unholy: a
 * fiend's weakness to holy, whatever the holy blow's damage).
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, prepareBattle, takeTurn } from "../scripts/engine/simulator.js";
import { expectedDamage } from "../scripts/engine/behavior/evaluate.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const fiend = () => creature({ id: "fiend", side: "hostile", hp: { value: 900, max: 900 }, iwr: { weak: { holy: 10 } }, flags: { fearless: true } });
const blow = traits => strike({ id: `blow-${traits.join("-") || "plain"}`, bonus: 60, damage: [parseFormula("4", "slashing")], traits });

function fight(traits) {
  const run = beginRun(prepareBattle(battle([creature({ id: "champion", actions: [blow(traits)] }), fiend()]), pf2eRules), 1, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}

describe("the action's traits, for weaknesses and resistances to what deals it", () => {
  test("a holy blow at one weak to holy: its weakness, once a blow, whatever the blow's damage", () => {
    const run = fight(["holy"]);
    takeTurn(run, run.byId.get("champion"));
    const hits = run.log.filter(e => e.type === "attack" && e.actorId === "champion" && e.degree >= 2);
    expect(hits.length).toBeGreaterThan(0);
    for ( const e of hits ) expect(e.damage).toBe(e.crit ? 18 : 14);
  });

  test("the same blow without the trait: no weakness", () => {
    const run = fight([]);
    takeTurn(run, run.byId.get("champion"));
    for ( const e of run.log.filter(x => x.type === "attack" && x.actorId === "champion" && x.degree >= 2) ) expect(e.damage).toBe(e.crit ? 8 : 4);
  });

  test("the Statistics Engine's estimate counts it too", () => {
    const run = fight(["holy"]);
    const [champion, f] = ["champion", "fiend"].map(id => run.byId.get(id));
    expect(expectedDamage(run, champion, blow(["holy"]), f)).toBeGreaterThan(expectedDamage(run, champion, blow([]), f) + 9);
  });
});
