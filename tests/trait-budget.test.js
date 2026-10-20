/**
 * The trait budget: the four traits, as the sliders have them, sum to 250 at most (each still 0 to 100). Over it, the
 * excess comes off the highest (of the others, where one was just raised), a point at a time; a character read over it
 * is set up by itself again, once.
 */
import { describe, expect, test } from "vitest";
import { withinBudget, budgetFudges, traitTotal, TRAIT_BUDGET } from "../scripts/engine/trait-budget.js";
import { autoPlan, specSignature } from "../scripts/foundry/auto-config.js";
import { suggestTactics } from "../scripts/engine/tactics.js";
import { suggestMotives } from "../scripts/foundry/motives.js";
import { PC_BASELINE } from "../scripts/constants.js";
import { DEFAULT_SIDE_TRAITS } from "../scripts/settings.js";
import { creature, strike } from "./helpers.js";

describe("the four traits sum to 250 at most", () => {
  test("within it: as they are", () => {
    const t = { tactical: 60, brave: 70, selfish: 30, loyal: 75 };
    expect(withinBudget(t)).toEqual(t);
    expect(TRAIT_BUDGET).toBe(250);
  });

  test("over it, nothing raised: the excess off the highest, those as high coming down together", () => {
    const kept = withinBudget({ tactical: 90, brave: 85, selfish: 40, loyal: 60 });
    expect(traitTotal(kept)).toBe(250);
    expect(kept).toEqual({ tactical: 75, brave: 75, selfish: 40, loyal: 60 });
  });

  test("one raised past it: the excess off the highest of the others, never the raised one", () => {
    const kept = withinBudget({ tactical: 95, brave: 60, selfish: 30, loyal: 75 }, { raised: "tactical" });
    expect(kept).toEqual({ tactical: 95, brave: 60, selfish: 30, loyal: 65 });
    // (The highest of the others drops until it's no longer the highest; then the next takes its turn.)
    const more = withinBudget({ tactical: 100, brave: 80, selfish: 30, loyal: 80 }, { raised: "tactical" });
    expect(more).toEqual({ tactical: 100, brave: 60, selfish: 30, loyal: 60 });
  });

  test("the others all at 0: off the raised one", () => {
    expect(withinBudget({ tactical: 100, brave: 0, selfish: 0, loyal: 0 }, { raised: "tactical", budget: 80 })).toEqual({ tactical: 80, brave: 0, selfish: 0, loyal: 0 });
  });

  test("the usual player character and every side's defaults fit", () => {
    expect(traitTotal(PC_BASELINE)).toBeLessThanOrEqual(TRAIT_BUDGET);
    for ( const t of Object.values(DEFAULT_SIDE_TRAITS) ) expect(traitTotal(t)).toBeLessThanOrEqual(TRAIT_BUDGET);
  });
});

describe("the GM's nudges kept within it", () => {
  const bases = { tactical: 60, brave: 70, selfish: 30, loyal: 75 };

  test("within it: the nudges as they are", () => {
    expect(budgetFudges(bases, { tactical: 10 })).toEqual({ tactical: 10, brave: 0, selfish: 0, loyal: 0 });
  });

  test("Tactical raised to 80: Loyal, the highest of the others, comes down by the 5 over", () => {
    const kept = budgetFudges(bases, { tactical: 20 }, { raised: "tactical" });
    expect(kept).toEqual({ tactical: 20, brave: 0, selfish: 0, loyal: -5 });
    expect(traitTotal({ tactical: 80, brave: 70, selfish: 30, loyal: 75 + kept.loyal })).toBe(250);
  });

  test("a nudge past 100 counts as 100", () => {
    const kept = budgetFudges({ tactical: 95, brave: 50, selfish: 40, loyal: 50 }, { tactical: 20 }, { raised: "tactical" });
    expect(kept).toEqual({ tactical: 20, brave: 0, selfish: 0, loyal: 0 });
  });
});

describe("a character read over it is set up by itself again, once", () => {
  const spec = creature({ actions: [strike({ id: "sword" })] });
  const lets = { ...suggestTactics(spec), ...suggestMotives(spec) };
  const sig = specSignature(spec);
  const record = { api: "12.0", sig, lets, picked: ["tank"], budget: 0 };
  const over = { ...spec, overBudget: true };

  test("its answers and its playstyles again, where nobody changed those picked for it", () => {
    expect(autoPlan({ playstyles: ["tank"] }, record, { api: "12.0", sig, spec: over })).toEqual({ pick: true, lets: true });
    expect(autoPlan({}, record, { api: "12.0", sig, spec: over })).toEqual({ pick: true, lets: true });
  });

  test("playstyles someone changed stay theirs; its answers are still worked out again", () => {
    expect(autoPlan({ playstyles: ["thief"] }, record, { api: "12.0", sig, spec: over })).toEqual({ pick: false, lets: true });
  });

  test("set up again under the budget already: nothing more", () => {
    expect(autoPlan({ playstyles: ["tank"] }, { ...record, budget: TRAIT_BUDGET }, { api: "12.0", sig, spec: over })).toEqual({ pick: false, lets: false });
  });

  test("within it: as before", () => {
    expect(autoPlan({ playstyles: ["tank"] }, record, { api: "12.0", sig, spec })).toEqual({ pick: false, lets: false });
  });
});
