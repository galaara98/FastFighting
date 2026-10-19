/**
 * What's changed on a character: one read again only when something about it changed (a window opened and closed over
 * and over reads nothing anew), and the reactions a window shows checked again when its items or effects change, once
 * things settle and at most once every two seconds, the window redrawn only when its list changed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const reads = { n: 0 };
vi.mock("../scripts/api.js", async original => ({
  ...(await original()),
  characterSpec: async (adapter, tokenDoc) => {
    reads.n++;
    return { id: tokenDoc.id, kind: "pc", reactions: tokenDoc.actor.reactions.map(id => ({ id: `a.${id}`, label: id })) };
  }
}));

const hooks = new Map();
const fire = (name, ...args) => (hooks.get(name) ?? []).forEach(fn => fn(...args));
const was = { Hooks: globalThis.Hooks, foundry: globalThis.foundry };
let watch;
beforeAll(async () => {
  globalThis.Hooks = { on: (name, fn) => (hooks.get(name) ?? hooks.set(name, []).get(name)).push(fn) };
  globalThis.foundry = { utils: { deepClone: v => structuredClone(v) } };
  watch = await import("../scripts/foundry/sheet-watch.js");
  watch.registerSheetWatch();
});
afterAll(() => Object.assign(globalThis, was));

const actor = { uuid: "Actor.kara", documentName: "Actor", reactions: ["shield"] };
const token = { id: "t1", uuid: "Scene.s.Token.t1", parent: {}, actor };
const item = { documentName: "Item", parent: actor };
const adapter = {};

describe("a character read again only when it changed", () => {
  beforeEach(() => { reads.n = 0; });

  test("unchanged: the read before (a copy, whoever has it may change it); changed, read again", async () => {
    const first = await watch.cachedCharacterSpec(adapter, token);
    first.reactions.length = 0;
    const again = await watch.cachedCharacterSpec(adapter, token);
    expect(reads.n).toBe(1);
    expect(again.reactions).toHaveLength(1);
    for ( let i = 0; i < 20; i++ ) await watch.cachedCharacterSpec(adapter, token);
    expect(reads.n).toBe(1);
    fire("updateItem", item, {});
    await watch.cachedCharacterSpec(adapter, token);
    expect(reads.n).toBe(2);
    fire("updateActor", actor, {});
    await watch.cachedCharacterSpec(adapter, token);
    fire("updateSetting", {}, {});
    await watch.cachedCharacterSpec(adapter, token);
    expect(reads.n).toBe(4);
  });

  test("fresh (the planner's Refresh): read again whatever, and that read kept for the next", async () => {
    await watch.cachedCharacterSpec(adapter, token);
    const before = reads.n;
    actor.reactions = ["shield", "riposte"]; // (changed where no hook tells it)
    expect((await watch.cachedCharacterSpec(adapter, token)).reactions).toHaveLength(1);
    expect((await watch.cachedCharacterSpec(adapter, token, { fresh: true })).reactions).toHaveLength(2);
    expect((await watch.cachedCharacterSpec(adapter, token)).reactions).toHaveLength(2);
    expect(reads.n).toBe(before + 1);
    actor.reactions = ["shield"];
  });
});

describe("the reactions a window shows, checked again", () => {
  test("once things settle, at most once every two seconds; never for a character no window shows", async () => {
    vi.useFakeTimers();
    try {
      const rechecks = [];
      const stop = watch.showsReactions({ shows: a => a.uuid === actor.uuid, recheck: a => { rechecks.push(a.uuid); } });
      const other = { uuid: "Actor.other", documentName: "Actor", reactions: [] };
      for ( let i = 0; i < 10; i++ ) fire("updateItem", item, {});
      fire("createActiveEffect", { documentName: "ActiveEffect", parent: other }, {});
      await vi.advanceTimersByTimeAsync(399);
      expect(rechecks).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(rechecks).toEqual(["Actor.kara"]);
      // (Changed again at once: checked two seconds after the last check, not before.)
      fire("deleteItem", item, {});
      fire("createActiveEffect", { documentName: "ActiveEffect", parent: { documentName: "Item", parent: actor } }, {});
      await vi.advanceTimersByTimeAsync(1500);
      expect(rechecks).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(rechecks).toEqual(["Actor.kara", "Actor.kara"]);
      stop();
      fire("updateItem", item, {});
      await vi.advanceTimersByTimeAsync(5000);
      expect(rechecks).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a reaction's choice: one for it, whatever slot it's cast with", () => {
  test("its key without the actor's id and the slot; the choices by each of its ids, as the engine asks them", async () => {
    const { reactionKey, reactionPrefsFor } = await import("../scripts/foundry/tactics.js");
    expect(reactionKey("a1.shield-block")).toBe("shield-block");
    expect(reactionKey("a1.item7@spell2")).toBe("item7");
    const spec = { reactions: [{ id: "a1.item7@spell1" }, { id: "a1.item7@spell3" }, { id: "a1.dodge" }] };
    expect(reactionPrefsFor(spec, { reactions: { item7: "never", opportunity: "always" } })).toEqual({
      "a1.item7@spell1": "never", "a1.item7@spell3": "never", "a1.dodge": "ask", opportunity: "always"
    });
  });
});
