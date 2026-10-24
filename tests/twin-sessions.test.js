/**
 * The same user signed in twice (foundry/twin-sessions.js twinHeard): a session message is a twin's only from another
 * session of the same user; its goodbye is a twin gone.
 */
import { describe, expect, test } from "vitest";
import { twinHeard } from "../scripts/foundry/twin-sessions.js";

const me = { user: "gm", session: "a" };
const said = fields => ({ type: "session", user: "gm", session: "b", ...fields });

describe("a session message", () => {
  test("from the same user's other session: a twin, saying hello or answering", () => {
    expect(twinHeard(said({ hello: true }), me)).toBe("twin");
    expect(twinHeard(said({ hello: false }), me)).toBe("twin");
  });

  test("its goodbye: a twin gone", () => {
    expect(twinHeard(said({ bye: true }), me)).toBe("gone");
  });

  test("this session's own, another user's, or not a session message: nothing", () => {
    expect(twinHeard(said({ session: "a" }), me)).toBeNull();
    expect(twinHeard(said({ user: "player" }), me)).toBeNull();
    expect(twinHeard(said({ type: "other" }), me)).toBeNull();
    expect(twinHeard(said({ session: "" }), me)).toBeNull();
    expect(twinHeard(null, me)).toBeNull();
  });
});
