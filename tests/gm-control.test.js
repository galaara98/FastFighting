import { describe, expect, test } from "vitest";
import { controllerOf, handsOver, lockedUntil, LOCK_MS } from "../scripts/foundry/control.js";

describe("the GM in control of FastFighting (controllerOf)", () => {
  const gm = (id, active = true) => ({ id, isGM: true, active });
  const users = [gm("ana"), gm("bo"), gm("cy", false), { id: "pat", isGM: false, active: true }];

  test("the GM named, while they're here", () => {
    expect(controllerOf({ chosen: "bo", users, activeGM: "ana" })).toBe("bo");
  });

  test("the GM named gone a moment (a reload): still them, until another takes over", () => {
    expect(controllerOf({ chosen: "cy", users, activeGM: "ana" })).toBe("cy");
  });

  test("none named: the active GM", () => {
    expect(controllerOf({ chosen: null, users, activeGM: "ana" })).toBe("ana");
    expect(controllerOf({ chosen: "nobody", users, activeGM: "ana" })).toBe("ana");
  });

  test("never a player, whatever the setting says", () => {
    expect(controllerOf({ chosen: "pat", users, activeGM: "ana" })).toBe("ana");
  });

  test("none named and no GM here: none", () => {
    expect(controllerOf({ chosen: null, users: [gm("cy", false)], activeGM: null })).toBe(null);
  });
});

describe("the GM in control asked to hand over (handsOver)", () => {
  test("Refuse keeps control; Allow, or no answer in time, hands it over", () => {
    expect(handsOver("refuse")).toBe(false);
    expect(handsOver("allow")).toBe(true);
    expect(handsOver(null)).toBe(true);
  });
});

describe("Take Control off after two refusals (lockedUntil)", () => {
  const s = n => n * 1000;

  test("two refusals by the GM in control within a minute: off for 5 minutes from the second", () => {
    const refusals = [{ by: "ana", at: s(0) }, { by: "ana", at: s(50) }];
    expect(lockedUntil(refusals, "ana", s(60))).toBe(s(50) + LOCK_MS);
    expect(lockedUntil(refusals, "ana", s(50) + LOCK_MS)).toBe(0);
  });

  test("one refusal, or two more than a minute apart: not off", () => {
    expect(lockedUntil([{ by: "ana", at: s(0) }], "ana", s(1))).toBe(0);
    expect(lockedUntil([{ by: "ana", at: s(0) }, { by: "ana", at: s(61) }], "ana", s(62))).toBe(0);
  });

  test("only the refusals of the GM in control now count", () => {
    const refusals = [{ by: "ana", at: s(0) }, { by: "bo", at: s(10) }];
    expect(lockedUntil(refusals, "bo", s(20))).toBe(0);
    expect(lockedUntil([...refusals, { by: "bo", at: s(30) }], "ana", s(40))).toBe(0);
    expect(lockedUntil([...refusals, { by: "bo", at: s(30) }], "bo", s(40))).toBe(s(30) + LOCK_MS);
  });
});
