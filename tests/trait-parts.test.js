import { describe, test, expect } from "vitest";
import { traitsFromParts, signedNumber } from "../scripts/engine/trait-parts.js";
import { PC_BASELINE } from "../scripts/constants.js";
import { localize } from "../scripts/i18n.js";

const part = (why, n) => localize("FASTFIGHTING.Words.Part", { why, n });

describe("traits from parts", () => {
  test("each trait is where it starts and what moves it, kept in bounds", () => {
    const { traits } = traitsFromParts(PC_BASELINE, [
      { trait: "brave", n: -12, why: "Will" }, { trait: "brave", n: 4, why: "Bravery" },
      { trait: "selfish", n: 90, why: "fiend" }, { trait: "tactical", n: 2.6, why: "Int" }
    ]);
    expect(traits).toEqual({ tactical: 68, brave: 67, selfish: 95, loyal: 80 });
    expect(traitsFromParts(PC_BASELINE, [{ trait: "loyal", n: -200, why: "x" }]).traits.loyal).toBe(5);
  });

  test("the reasons add up: where it starts, then each part by its size, one for each reason", () => {
    const { reasons } = traitsFromParts(PC_BASELINE, [
      { trait: "brave", n: 3, why: "Con" }, { trait: "brave", n: -8, why: "Will" }, { trait: "brave", n: 2, why: "Con" },
      { trait: "brave", n: 0.2, why: "level" }
    ], { from: "PC" });
    expect(reasons.brave).toBe([part("PC", 75), part("Will", signedNumber(-8)), part("Con", signedNumber(5))].join(localize("FASTFIGHTING.Words.ListSeparator")));
    // (Nothing moved it: where it starts, and why.)
    expect(reasons.loyal).toBe(part("PC", 80));
    // (No reason for the start, and nothing moved it: none.)
    expect(traitsFromParts(PC_BASELINE).reasons.tactical).toBe("");
  });

  test("a sign on every amount but nothing", () => {
    expect(signedNumber(4)).toMatch(/^\+4$/);
    expect(signedNumber(-4)).toMatch(/4$/);
    expect(signedNumber(0)).toBe("0");
  });
});
