import { describe, expect, test } from "vitest";
import { TACTIC_WISHES, TACTIC_CHOICES } from "../scripts/engine/tactics.js";
import { holdsBack, wish, wishWins } from "../scripts/engine/battle-state.js";
import { standsGround } from "../scripts/engine/behavior/morale.js";
import { createRng } from "../scripts/engine/rng.js";

/** How often something comes out true over many tries, with fresh dice. */
const share = (fn, n = 4000) => {
  const run = { rng: createRng(5), prep: { options: {} } };
  let yes = 0;
  for ( let i = 0; i < n; i++ ) if ( fn(run) ) yes++;
  return yes / n;
};

describe("the wishes the answers carry", () => {
  test("every answer has a strength: the strongest all of the old tick-box, the opposite none", () => {
    for ( const key of ["talk", "fallen", "retreat"] ) {
      expect(Object.keys(TACTIC_WISHES[key]).sort()).toEqual([...TACTIC_CHOICES[key]].sort());
    }
    expect(TACTIC_WISHES.talk).toMatchObject({ always: 1, never: 0 });
    // ("I avoid killing" is sparing the fallen now; taking them prisoner leans most of the way.)
    expect(TACTIC_WISHES.fallen).toMatchObject({ spare: 1, tie: 0.66, finish: 0 });
    expect(TACTIC_WISHES.target).toBeUndefined();
    expect(TACTIC_WISHES.retreat).toMatchObject({ never: 1, hurt: 0 });
    expect(wish(true)).toBe(1);
    expect(wish(undefined)).toBe(0);
  });

  test("holding back from a kill: the setting's chance times how strongly its answer leans that way", () => {
    expect(share(run => holdsBack(run, { spec: { avoidKilling: 1 } }))).toBeCloseTo(0.9, 1);
    expect(share(run => holdsBack(run, { spec: { avoidKilling: 0.33 } }))).toBeCloseTo(0.3, 1);
    expect(share(run => holdsBack(run, { spec: { avoidKilling: 0 } }))).toBe(0);
  });

  test("staying put rather than fleeing: likewise", () => {
    expect(share(run => standsGround(run, { spec: { avoidFleeing: 1 } }))).toBeCloseTo(0.9, 1);
    expect(share(run => standsGround(run, { spec: { avoidFleeing: 0.5 } }))).toBeCloseTo(0.45, 1);
    expect(share(run => standsGround(run, { spec: { avoidFleeing: 0 } }))).toBe(0);
  });

  test("a wish of none or all of it rolls no dice", () => {
    const rng = createRng(9);
    const before = createRng(9).next();
    const run = { rng };
    expect(wishWins(run, 0)).toBe(false);
    expect(wishWins(run, 1)).toBe(true);
    expect(rng.next()).toBe(before);
  });
});
