import { describe, expect, test } from "vitest";
import { controllerOf } from "../scripts/foundry/control.js";

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
