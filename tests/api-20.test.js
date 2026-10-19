/**
 * API 20: what a CombatantSpec may say since (situational saves, auras that make foes save, what an action needs first,
 * reactions' effects at every moment and the ownHit moment): the version.
 */
import { expect, test } from "vitest";
import { CORE_API, CORE_API_VERSION } from "../scripts/core-api.js";

test("the API is 20 or later, major.bug: the version, and its parts", () => {
  expect(CORE_API.major).toBeGreaterThanOrEqual(20);
  expect(CORE_API_VERSION).toBe(`${CORE_API.major}.${CORE_API.bug}`);
});

test("chat HTML for helpers: escaped, and a name's markup left inert", async () => {
  const api = await import("../scripts/core-api.js");
  expect(api.escapeHtml("<b>&")).toBe("&lt;b&gt;&amp;");
  expect(api.inertHtml("[[/r 1d6]] @UUID[Actor.x]")).not.toMatch(/\[\[|@UUID\[/);
});
