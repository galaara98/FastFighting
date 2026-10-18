/**
 * API 20: what a CombatantSpec may say since (situational saves, auras that make foes save, what an action needs first,
 * reactions' effects at every moment and the ownHit moment): the version.
 */
import { expect, test } from "vitest";
import { CORE_API, CORE_API_VERSION } from "../scripts/core-api.js";

test("the API is 20, major.bug: the version, and its parts", () => {
  expect(CORE_API).toEqual({ major: 20, bug: 0 });
  expect(CORE_API_VERSION).toBe("20.0");
});
