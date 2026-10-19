/**
 * What a live battle takes from the players' side only as far as it's theirs (live-battle.js): a damage card applied
 * as the GM saw it.
 */
import { describe, expect, test } from "vitest";
import { damageStill } from "../scripts/foundry/live-battle.js";

describe("players' damage a GM approves", () => {
  const line = { amount: 7, healing: false };

  test("is applied only while its card still says what the GM was shown", () => {
    expect(damageStill(line, { amount: 7, kind: "damage" })).toBe(true);
    // (The player changed their card since: more, less, healing now, or no damage card at all.)
    expect(damageStill(line, { amount: 70, kind: "damage" })).toBe(false);
    expect(damageStill(line, { amount: 1, kind: "damage" })).toBe(false);
    expect(damageStill(line, { amount: 7, kind: "healing" })).toBe(false);
    expect(damageStill(line, null)).toBe(false);
    expect(damageStill({ amount: 4, healing: true }, { amount: 4, kind: "healing" })).toBe(true);
  });
});
