/**
 * API 18: what the helpers each wrote for themselves, once in the core. A side after a change of heart; the token
 * palette as a list or a map; a status toggled with its undo; an empty undo record; a purse paid from; an item handed
 * over; a description as the books have it, up to its length; a sheet's text; word lists in both languages; trait
 * parts from a leaning, with a helper's reasons first; a number setting within bounds; a uuid's last id.
 */
import { afterEach, describe, expect, test } from "vitest";
import {
  sideAfter, statusesOf, statusEntry, toggleStatus, undoRecord, payFrom, handOverItem, englishName, englishDescription,
  DESCRIPTION_MOST, plainText, numberSetting, idFromUuid, tokenIdIn, partsOf, traitsFromParts, listWords, saysWord
} from "../scripts/core-api.js";

const was = { CONFIG: globalThis.CONFIG };
afterEach(() => Object.assign(globalThis, was));

describe("a creature's side after a change of heart", () => {
  test("won over, talked out of the fight, turned on the party; or nothing changed", () => {
    expect(sideAfter({ swayed: "switched", side: "friendly" })).toBe("friendly");
    expect(sideAfter({ swayed: "switched", side: "hostile" })).toBe("hostile");
    expect(sideAfter({ side: "neutralParty", swayed: "neutral" })).toBe("neutral");
    expect(sideAfter({ side: "neutralParty", against: ["friendly"] })).toBe("hostile");
    expect(sideAfter({ side: "neutralParty", swayed: "neutral", status: "dead" })).toBeNull();
    expect(sideAfter({ side: "hostile" })).toBeNull();
  });
});

describe("statuses", () => {
  const actor = (on = [], effects = []) => {
    const statuses = new Set(on);
    const a = {
      statuses, effects,
      async toggleStatusEffect(id, { active }) { if ( active ) statuses.add(id); else statuses.delete(id); }
    };
    return a;
  };

  test("an actor's, from its effects too; the palette's, a list or a map", () => {
    expect([...statusesOf(actor(["prone"], [{ statuses: new Set(["blind"]) }, { disabled: true, statuses: new Set(["deaf"]) }]))]).toEqual(["prone", "blind"]);
    globalThis.CONFIG = { statusEffects: [{ id: "prone" }, { id: "prone", name: "again" }] };
    expect(statusEntry("prone")).toEqual({ id: "prone" });
    globalThis.CONFIG = { statusEffects: { stun: { id: "stun", name: "Stunned" } } };
    expect(statusEntry("stun")?.name).toBe("Stunned");
    expect(statusEntry("prone")).toBeNull();
  });

  test("put on or taken off, with how to put it back; nothing when it's as asked; a system's own say", async () => {
    const a = actor(["prone"]);
    const undo = undoRecord({ uuid: "Token.t" }, { uuid: "Actor.a", statuses: new Set(["prone"]), effects: [] });
    expect(undo).toMatchObject({ tokenUuid: "Token.t", actorUuid: "Actor.a", statuses: [], statusesBefore: ["prone"] });
    expect(await toggleStatus(a, "prone", true, undo)).toBe(false);
    expect(await toggleStatus(a, "stun", true, undo, { overlay: true })).toBe(true);
    expect(await toggleStatus(a, "prone", false, undo)).toBe(true);
    expect(undo.statuses).toEqual([{ id: "stun", active: false, overlay: true }, { id: "prone", active: true, overlay: false }]);
    expect(await toggleStatus(a, "stun", false, undo, { skip: () => true })).toBe(false);
    expect(undoRecord(null, null, { statusesBefore: false }).statusesBefore).toBeUndefined();
  });
});

describe("paying and handing over", () => {
  const COINS = [["cp", 1], ["sp", 10], ["gp", 100]];
  test("small coins first, a bigger one broken for change; null when it can't be paid", () => {
    expect(payFrom({ cp: 5, sp: 3, gp: 1 }, 25, COINS)).toEqual({ cp: 0, sp: 1, gp: 1 });
    expect(payFrom({ gp: 1 }, 15, COINS)).toEqual({ cp: 5, sp: 8, gp: 0 });
    expect(payFrom({ cp: 3 }, 15, COINS)).toBeNull();
  });

  test("one of an item: one fewer on the giver (gone at the last), one more on the receiver; undo records", async () => {
    const made = [];
    const items = new Map();
    const giver = { uuid: "Actor.g", statuses: new Set(), effects: [], items };
    const potion = {
      id: "p", system: { quantity: 2, equipped: true },
      toObject() { return { _id: "p", name: "Potion", system: { ...this.system } }; },
      async update(u) { this.system.quantity = u["system.quantity"]; },
      async delete() { items.delete("p"); }
    };
    items.set("p", potion);
    const receiver = { uuid: "Actor.r", statuses: new Set(), effects: [], async createEmbeddedDocuments(type, data) { made.push(...data); return data.map(() => ({ id: "new" })); } };
    const records = await handOverItem({ uuid: "Token.g", actor: giver }, { uuid: "Token.r", actor: receiver }, "p", { prepare: d => { d.system.equipped = false; } });
    expect(potion.system.quantity).toBe(1);
    expect(made[0]).toEqual({ name: "Potion", system: { quantity: 1, equipped: false } });
    expect(records.map(r => [r.actorUuid, r.itemUpdates, r.createdItems])).toEqual([["Actor.g", [{ id: "p", update: { "system.quantity": 2 } }], []], ["Actor.r", [], ["new"]]]);
    expect(records.every(r => Array.isArray(r.statusesBefore))).toBe(true);
    // (A system whose conditions are items keeps no statuses from before: PF2e's.)
    const last = await handOverItem({ uuid: "Token.g", actor: giver }, null, "p", { statusesBefore: false });
    expect(items.has("p")).toBe(false);
    expect(last).toHaveLength(1);
    expect(last[0].deletedItems[0].name).toBe("Potion");
    expect("statusesBefore" in last[0]).toBe(false);
  });
});

describe("words", () => {
  test("names and descriptions as the books have them, up to the most read; a sheet's text, with its bold or without", () => {
    const item = { name: "Cimitarra", flags: { babele: { originalName: "Scimitar", originalPayload: { description: "x".repeat(DESCRIPTION_MOST + 50) } } } };
    expect(englishName(item)).toBe("Scimitar");
    expect(englishDescription(item)).toHaveLength(DESCRIPTION_MOST);
    expect(englishDescription({ system: { description: { value: "<p>Hi</p>" } } })).toBe("<p>Hi</p>");
    expect(plainText("<p><strong>Why?</strong> Because&nbsp;I &amp; you</p>")).toBe("Why? Because I & you");
    expect(plainText("<p><strong>Why?</strong> Because</p>", { bold: false })).toBe("Because");
  });

  test("a list's words, and whether a text holds one, whole", () => {
    expect(listWords(" Fire  Bolt, «claw», ,bite ")).toEqual(["fire bolt", "claw", "bite"]);
    expect(saysWord(["claw", "fire bolt"], "Its Claw rakes")).toBe(true);
    expect(saysWord(["claw"], "Clawless")).toBe(false);
    expect(saysWord(["c++"], "a c++ thing")).toBe(true);
    expect(saysWord([], "claw")).toBe(false);
  });
});

describe("trait parts", () => {
  test("from a leaning, scaled; a helper's own reasons before the rest", () => {
    expect(partsOf({ brave: 10, loyal: -5 }, "Fighter", 2)).toEqual([{ trait: "brave", n: 20, why: "Fighter" }, { trait: "loyal", n: -10, why: "Fighter" }]);
    const built = traitsFromParts({ tactical: 50, brave: 50, selfish: 40, loyal: 50 }, partsOf({ brave: 10 }, "Fighter"), { lead: { brave: "Its own" } });
    expect(built.traits.brave).toBe(60);
    expect(built.reasons.brave.indexOf("Its own")).toBe(0);
    expect(built.reasons.brave).toContain("Fighter");
  });
});

describe("the rest", () => {
  test("a number setting within its bounds, its default when it can't be read", () => {
    const set = numberSetting("m", "k", { min: 1, max: 3, default: 2, name: "N", hint: "H" });
    globalThis.game.settings = { get: () => 9 };
    expect(set.read()).toBe(3);
    globalThis.game.settings = { get: () => "x" };
    expect(set.read()).toBe(2);
    globalThis.game.settings = { get: () => { throw new Error("none"); } };
    expect(set.read()).toBe(2);
  });

  test("a uuid's last id; the token one names or is inside", () => {
    expect(idFromUuid("Scene.s.Token.t")).toBe("t");
    expect(idFromUuid("t")).toBe("t");
    expect(idFromUuid(null)).toBeNull();
    expect(tokenIdIn("Scene.s.Token.t")).toBe("t");
    expect(tokenIdIn("Scene.s.Token.t.Actor.a")).toBe("t");
    expect(tokenIdIn("Actor.a")).toBeNull();
  });
});
