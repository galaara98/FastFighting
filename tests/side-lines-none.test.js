/**
 * The start lines a system posts as FastFighting moves the tracker (foundry/side-lines.js), when there are none: a
 * system that posts none, PF2e's Current Conditions turned off in its settings, or one the GM deleted before a Rewind.
 * Nothing is marked or deleted, and a Rewind goes on without an error. The hooks run on a stand-in for Foundry's chat.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MODULE_ID } from "../scripts/constants.js";
import { registerSideLines, movingTracker, turnBegun, dropStartsAfter, forgetLine, SETTLE } from "../scripts/foundry/side-lines.js";

const GM = "gm";
const order = ["a", "b", "c"];
const at = id => order.indexOf(id);
const actors = new Set(["kara", "brand"]);
const startOf = m => (m.speaker?.actor === "kara" ? { round: 1, combatantId: "b" } : null);

let hooks;
let chat;

/** A chat message as the hooks see it. */
function message(data) {
  const m = {
    id: data.id, timestamp: Date.now(), rolls: [], flags: {}, speaker: {}, ...data,
    updateSource(changes) {
      for ( const [path, value] of Object.entries(changes) ) {
        const [, scope, key] = path.split(".");
        m.flags[scope] = { ...(m.flags[scope] ?? {}), [key]: value };
      }
    },
    getFlag: (scope, key) => m.flags[scope]?.[key],
    delete: vi.fn(async () => {
      if ( !chat.has(m.id) ) throw new Error(`ChatMessage ${m.id} does not exist`);
      chat.delete(m.id);
      return m;
    })
  };
  return m;
}

/** A message made as Foundry makes one: preCreate's say, then in the chat, then createChatMessage. */
async function post(data, userId = GM) {
  const m = message(data);
  for ( const fn of hooks.preCreateChatMessage ?? [] ) if ( fn(m, data, {}, userId) === false ) return null;
  chat.set(m.id, m);
  for ( const fn of hooks.createChatMessage ?? [] ) await fn(m, {}, userId);
  return m;
}

beforeEach(() => {
  hooks = {};
  chat = new Map();
  globalThis.Hooks = { on: (name, fn) => (hooks[name] ??= []).push(fn) };
  globalThis.foundry = { utils: { randomID: () => Math.random().toString(36).slice(2, 18) } };
  globalThis.game = {
    user: { id: GM },
    messages: { has: id => chat.has(id), get: id => chat.get(id), get contents() { return [...chat.values()]; } }
  };
  registerSideLines();
});

afterEach(() => {
  delete globalThis.Hooks;
  delete globalThis.foundry;
  delete globalThis.game;
  vi.useRealTimers();
});

describe("no start line at all (a system that posts none, or PF2e's turned off)", () => {
  test("a move that posts nothing marks nothing; Rewind deletes nothing and goes on", async () => {
    const own = await post({ id: "gm-own", content: "The road is quiet.", speaker: { alias: "Gamemaster" } });
    const side = await post({ id: "side", flags: { [MODULE_ID]: { live: { battle: "b1", line: "s" } } }, speaker: { actor: "kara" } });
    expect(await movingTracker("b1", actors, startOf, async () => "moved")).toBe("moved");
    await expect(dropStartsAfter("b1", { round: 1, at: 0 }, at)).resolves.toBeUndefined();
    await expect(dropStartsAfter("b1", { round: 1, at: -1 }, at)).resolves.toBeUndefined();
    expect([...chat.keys()]).toEqual(["gm-own", "side"]);
    expect(own.delete).not.toHaveBeenCalled();
    expect(side.delete).not.toHaveBeenCalled();
    expect(own.flags[MODULE_ID]).toBeUndefined();
  });

  test("an empty chat, or none to read: Rewind goes on", async () => {
    await expect(dropStartsAfter("b1", { round: 1, at: 0 }, at)).resolves.toBeUndefined();
    globalThis.game.messages = undefined;
    await expect(dropStartsAfter("b1", { round: 1, at: 0 }, at)).resolves.toBeUndefined();
    await expect(forgetLine(null)).resolves.toBeUndefined();
  });

  test("after the move has settled, a line for a creature in the battle is the GM's own, and stays", async () => {
    vi.useFakeTimers();
    await movingTracker("b1", actors, startOf, async () => {});
    vi.advanceTimersByTime(SETTLE + 1);
    const later = await post({ id: "later", speaker: { actor: "kara" }, content: "Kara draws breath." });
    expect(later.flags[MODULE_ID]).toBeUndefined();
    await dropStartsAfter("b1", { round: 1, at: 0 }, at);
    expect(chat.has("later")).toBe(true);
  });
});

describe("a start line gone before the Rewind", () => {
  test("deleted by the GM first: Rewind deletes nothing, without an error", async () => {
    let card;
    await movingTracker("b1", actors, startOf, async () => {
      card = await post({ id: "conditions", speaker: { actor: "kara", token: "t1" }, content: "Current Conditions" });
    });
    expect(card.flags[MODULE_ID].live).toMatchObject({ battle: "b1", start: { round: 1, combatantId: "b" } });
    await card.delete();
    card.delete.mockClear();
    await expect(dropStartsAfter("b1", { round: 1, at: 0 }, at)).resolves.toBeUndefined();
    expect(card.delete).not.toHaveBeenCalled();
  });

  test("deleted elsewhere as Rewind deletes it: Rewind goes on", async () => {
    let card;
    await movingTracker("b1", actors, startOf, async () => {
      card = await post({ id: "conditions", speaker: { actor: "kara" } });
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    card.delete.mockImplementationOnce(async () => {
      chat.delete(card.id);
      throw new Error("ChatMessage conditions does not exist");
    });
    await expect(dropStartsAfter("b1", { round: 1, at: 0 }, at)).resolves.toBeUndefined();
    expect(chat.size).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test("still there: Rewind deletes it; one told of again replaces the older one", async () => {
    await movingTracker("b1", actors, startOf, async () => {
      await post({ id: "first", speaker: { actor: "kara" } });
    });
    await movingTracker("b1", actors, startOf, async () => {
      await post({ id: "again", speaker: { actor: "kara" } });
    });
    expect([...chat.keys()]).toEqual(["again"]);
    await dropStartsAfter("b1", { round: 1, at: 0 }, at);
    expect(chat.size).toBe(0);
  });
});

describe("the turn a line starts can't be told", () => {
  test("still made and the battle's, with no turn: only Rewind This Encounter takes it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let card;
    await movingTracker("b1", actors, () => { throw new Error("no combat"); }, async () => {
      card = await post({ id: "conditions", speaker: { actor: "kara" } });
    });
    warn.mockRestore();
    expect(card.flags[MODULE_ID].live.battle).toBe("b1");
    expect(card.flags[MODULE_ID].live.start).toBeUndefined();
    await dropStartsAfter("b1", { round: 1, at: -1 }, at);
    expect(chat.has("conditions")).toBe(true);
  });
});

describe("FastFighting begins the turn", () => {
  test("what is posted for it from then on is the turn's own, not its start's; two start lines of one move both stay", async () => {
    let one, two, spell;
    await movingTracker("b1", actors, startOf, async () => {
      one = await post({ id: "one", speaker: { actor: "kara" } });
      two = await post({ id: "two", speaker: { actor: "kara" } });
      turnBegun("b");
      spell = await post({ id: "spell", speaker: { actor: "kara" }, content: "Heal" });
    });
    expect(one.flags[MODULE_ID].live.start).toMatchObject({ round: 1, combatantId: "b" });
    expect(two.flags[MODULE_ID].live.start).toMatchObject({ round: 1, combatantId: "b" });
    expect(spell.flags[MODULE_ID].live.battle).toBe("b1");
    expect(spell.flags[MODULE_ID].live.start).toBeUndefined();
    expect([...chat.keys()]).toEqual(["one", "two", "spell"]);
  });
});
