/**
 * The side a token starts on (foundry/battle.js startingSide): its disposition's; one in the system's own party
 * (a helper's partyMembers, API 29) the Friendly Team unless its token is Hostile; a hazard left Neutral set against the
 * Friendlies.
 */
import { describe, expect, test } from "vitest";
import { startingSide } from "../scripts/foundry/battle.js";

describe("a token's starting side", () => {
  test("its disposition; in the system's party, Friendly unless Hostile; a Neutral hazard, Hostile", () => {
    expect(startingSide(1)).toBe("friendly");
    expect(startingSide(0)).toBe("neutral");
    expect(startingSide(-1)).toBe("hostile");
    expect(startingSide(0, { inParty: true })).toBe("friendly");
    expect(startingSide(-1, { inParty: true })).toBe("hostile");
    expect(startingSide(0, { hazard: true })).toBe("hostile");
  });
});
