/**
 * The same user signed in twice (foundry/twin-sessions.js twinHeard): a session message is a twin's only from another
 * session of the same user, as Foundry's server says who sent it; its goodbye is a twin gone.
 */
import { describe, expect, test } from "vitest";
import { twinHeard } from "../scripts/foundry/twin-sessions.js";

const me = { user: "gm", session: "a" };
const said = fields => ({ type: "session", user: "gm", session: "b", ...fields });

describe("a session message", () => {
  test("from the same user's other session: a twin, saying hello or answering", () => {
    expect(twinHeard(said({ hello: true }), me, "gm")).toBe("twin");
    expect(twinHeard(said({ hello: false }), me, "gm")).toBe("twin");
  });

  test("its goodbye: a twin gone", () => {
    expect(twinHeard(said({ bye: true }), me, "gm")).toBe("gone");
  });

  test("this session's own, another user's, or not a session message: nothing", () => {
    expect(twinHeard(said({ session: "a" }), me, "gm")).toBeNull();
    expect(twinHeard(said({ user: "player" }), me, "player")).toBeNull();
    expect(twinHeard(said({ type: "other" }), me, "gm")).toBeNull();
    expect(twinHeard(said({ session: "" }), me, "gm")).toBeNull();
    expect(twinHeard(null, me, "gm")).toBeNull();
  });

  test("a player's, saying it's the GM's: nothing; the sender is the server's word, not the message's", () => {
    expect(twinHeard(said({ hello: true }), me, "player")).toBeNull();
    expect(twinHeard(said({ hello: true }), me, undefined)).toBeNull();
  });
});
