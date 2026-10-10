import { describe, expect, test } from "vitest";
import { parseFormula, meanPart, maxPart, samplePart, sampleDamage, doubled } from "../scripts/engine/dice.js";
import { createRng, deriveSeed } from "../scripts/engine/rng.js";

describe("dice", () => {
  test("parses formulas with flavor and multiple dice", () => {
    const p = parseFormula("(2d6 + 4)[slashing] + 1d4 - 1", "slashing");
    expect(p.dice).toEqual([{ n: 2, faces: 6 }, { n: 1, faces: 4 }]);
    expect(p.flat).toBe(3);
    expect(meanPart(p)).toBeCloseTo(7 + 2.5 + 3);
    expect(maxPart(p)).toBe(19);
  });

  test("sample mean converges to analytic mean", () => {
    const rng = createRng(42);
    const p = parseFormula("3d8+2");
    let sum = 0;
    const n = 20000;
    for ( let i = 0; i < n; i++ ) sum += samplePart(p, rng);
    expect(sum / n).toBeCloseTo(meanPart(p), 0);
  });

  test("sampleDamage groups by type and never goes negative", () => {
    const rng = createRng(1);
    const out = sampleDamage([parseFormula("1d4-5", "fire"), parseFormula("2", "cold")], rng);
    expect(out.byType.fire).toBe(0);
    expect(out.byType.cold).toBe(2);
  });

  test("doubled doubles dice and flat", () => {
    const [d] = doubled([parseFormula("1d8+4")]);
    expect(d.dice[0].n).toBe(2);
    expect(d.flat).toBe(8);
  });

  test("rng is deterministic per seed", () => {
    const a = createRng(deriveSeed(7, 3));
    const b = createRng(deriveSeed(7, 3));
    expect([a.d20(), a.d20(), a.d20()]).toEqual([b.d20(), b.d20(), b.d20()]);
    expect(deriveSeed(7, 3)).not.toBe(deriveSeed(7, 4));
  });
});
