/**
 * The Battle Vantage's Next Turn hold (apps/hold.js): held for the setting's seconds from the newest thing waiting on
 * the GM; never at 0; until nothing waits at the last stop.
 */
import { describe, expect, test } from "vitest";
import { holdOf, HOLD_UNLIMITED } from "../scripts/apps/hold.js";

describe("holding Next Turn", () => {
  test("nothing waiting, or a hold of 0: never held", () => {
    expect(holdOf([], 1000, 10).held).toBe(false);
    expect(holdOf([1000], 1000, 0).held).toBe(false);
  });

  test("held for the setting's seconds from the newest, counting down in whole seconds", () => {
    expect(holdOf([0, 5000], 5000, 10)).toEqual({ held: true, left: 10, until: 15000 });
    expect(holdOf([0, 5000], 12500, 10)).toEqual({ held: true, left: 3, until: 15000 });
    expect(holdOf([0, 5000], 15000, 10).held).toBe(false);
  });

  test("at the last stop: held as long as something waits", () => {
    expect(holdOf([0], 10 ** 9, HOLD_UNLIMITED)).toMatchObject({ held: true, until: null });
    expect(holdOf([], 0, HOLD_UNLIMITED).held).toBe(false);
  });
});
