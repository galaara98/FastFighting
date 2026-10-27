/**
 * The GM's lean toward opening with a standoff (options.standoffNoncombat, -50 to 50: "Non-combat at the start"): at -50
 * never, at 50 always (an ambush aside), between them that much more or less often than the sides would have it.
 */
import { expect, test } from "vitest";
import { prepareBattle } from "../scripts/engine/simulator.js";
import { createRun } from "../scripts/engine/battle-state.js";
import { createRng } from "../scripts/engine/rng.js";
import { opensWithTalk, impatience, noncombatLean } from "../scripts/engine/behavior/standoff.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle, social } from "./helpers.js";

/** How often it opens as a standoff, over 400 tries: talkers all (they'd rather talk) or fighters all. */
function share(lean, talkers) {
  let n = 0;
  for ( let seed = 1; seed <= 400; seed++ ) {
    const run = createRun(prepareBattle(battle([
      creature({ id: "a", alwaysTalk: talkers, social: social({ diplomacy: 6 }) }),
      creature({ id: "b", side: "hostile", alwaysTalk: talkers, social: social({ diplomacy: 6 }) })
    ], { talking: true, standoffNoncombat: lean }), pf2eRules));
    run.rng = createRng(seed);
    for ( const u of run.units ) u.tac = { talk: talkers ? "always" : "never" };
    if ( opensWithTalk(run) ) n += 1;
  }
  return n / 400;
}

test("all the way to combat, never a standoff; all the way to non-combat, always; between, a share", () => {
  expect(share(-50, true)).toBe(0);
  expect(share(0, true)).toBe(1);
  expect(share(-25, true)).toBeGreaterThan(0.4);
  expect(share(-25, true)).toBeLessThan(0.6);
  expect(share(50, false)).toBe(1);
  expect(share(0, false)).toBe(0);
  expect(share(25, false)).toBeGreaterThan(0.4);
  expect(share(25, false)).toBeLessThan(0.6);
});

test("leaning toward a standoff, tempers fray more slowly; away, faster", () => {
  const at = lean => {
    const run = createRun(prepareBattle(battle([creature({ id: "a", social: social({ diplomacy: 2 }) }), creature({ id: "b", side: "hostile", social: social({ diplomacy: 2 }) })], { talking: true, standoffNoncombat: lean }), pf2eRules));
    run.round = 2;
    for ( const u of run.units ) u.tac = { talk: "opportune" };
    return impatience(run, run.byId.get("a"));
  };
  expect(noncombatLean({ prep: { options: { standoffNoncombat: 80 } } })).toBe(0.5);
  expect(at(40)).toBeLessThan(at(0));
  expect(at(-40)).toBeGreaterThan(at(0));
});
