import { afterEach, describe, expect, test } from "vitest";
import { distanceText, numberText, setDistanceUnit } from "../scripts/i18n.js";
import { logLine } from "../scripts/story/log-lines.js";
import { keptEnglish, applyKeptEnglish } from "../scripts/foundry/keep-english.js";
import { sideName, hostileGroupsIn } from "../scripts/foundry/battle.js";
import { text } from "./foundry-i18n.js";

afterEach(() => {
  setDistanceUnit(null);
  delete globalThis.fetch;
});

describe("distances: the engine counts feet, the table reads its own units", () => {
  test("feet, named by the language file, without a scene's units", () => {
    expect(distanceText(30)).toBe(text("FASTFIGHTING.Units.Distance", { n: "30", units: text("FASTFIGHTING.Units.Feet") }));
  });

  test("a metric scene: metres the table way (1.5 m to a 5-foot square)", () => {
    setDistanceUnit({ label: "m", feetPer: 10 / 3 });
    expect(distanceText(30)).toBe(text("FASTFIGHTING.Units.Distance", { n: "9", units: "m" }));
    expect(distanceText(15)).toBe(text("FASTFIGHTING.Units.Distance", { n: "4.5", units: "m" }));
    const move = logLine({ type: "move", actor: "Akra", mode: "walk", feet: 15, toward: "Zanna", mult: 1, regions: [] });
    expect(move).toContain(text("FASTFIGHTING.Units.Distance", { n: "4.5", units: "m" }));
  });

  test("numbers as the reader's language writes them", () => {
    expect(numberText(4.5)).toBe("4.5");
    globalThis.game.i18n.lang = "es";
    expect(numberText(4.5)).toBe("4,5");
    setDistanceUnit({ label: "m", feetPer: 10 / 3 });
    expect(distanceText(15)).toBe(text("FASTFIGHTING.Units.Distance", { n: "4,5", units: "m" }));
    // (A code Intl doesn't know still gives a number.)
    globalThis.game.i18n.lang = "not a language";
    expect(numberText(4.5)).toBe("4.5");
  });
});

describe("a side's name", () => {
  test("a lone hostile side is just that; hostile groups are numbered from one template", () => {
    expect(sideName("hostile", 1)).toBe(text("FASTFIGHTING.Side.hostile"));
    expect(sideName("hostile", 2)).toBe(text("FASTFIGHTING.Side.hostileGroup", { n: 1 }));
    expect(sideName("hostile2", 2)).toBe(text("FASTFIGHTING.Side.hostileGroup", { n: 2 }));
    // (Only group 3 fights: still numbered, so it reads as the group the GM put it in.)
    expect(sideName("hostile3", 1)).toBe(text("FASTFIGHTING.Side.hostileGroup", { n: 3 }));
    expect(sideName("friendly", 3)).toBe(text("FASTFIGHTING.Side.friendly"));
    expect(hostileGroupsIn(["friendly", "hostile", "hostile3", "hostile", "neutralParty"])).toBe(2);
  });
});

describe("a helper's hardcoded-toEN.json: words kept in English for now", () => {
  const english = { FFX: { Skill: { per: "Persuasion", ins: "Insight" }, Cond: { frightened: "frightened" }, Label: "X" } };

  test("its keys, and groups of keys, name what stays English", () => {
    expect(keptEnglish({ lastUpdated: "2026-10-11", keys: ["FFX.Skill", "FFX.Cond.frightened"] }, english))
      .toEqual({ "FFX.Skill.per": "Persuasion", "FFX.Skill.ins": "Insight", "FFX.Cond.frightened": "frightened" });
    expect(keptEnglish({ lastUpdated: "2026-10-11", keys: [] }, english)).toEqual({});
    expect(keptEnglish(null, english)).toEqual({});
    // (A group's name is matched whole: FFX.Skil names nothing.)
    expect(keptEnglish({ keys: ["FFX.Skil"] }, english)).toEqual({});
  });

  test("in another language, those keys read their English; the rest stay translated; English needs nothing", async () => {
    const files = { "hardcoded-toEN.json": { lastUpdated: "2026-10-11", keys: ["FFX.Skill"] }, "en.json": english };
    globalThis.fetch = async url => {
      const name = String(url).split("/").pop();
      return name in files ? { ok: true, json: async () => files[name] } : { ok: false };
    };
    const i18n = { lang: "es", translations: { FFX: { Skill: { per: "Persuasión", ins: "Perspicacia" }, Label: "X es" } } };
    expect(await applyKeptEnglish("ffx", i18n)).toEqual(["FFX.Skill.per", "FFX.Skill.ins"]);
    expect(i18n.translations.FFX).toEqual({ Skill: { per: "Persuasion", ins: "Insight" }, Label: "X es" });
    expect(await applyKeptEnglish("ffx", { lang: "en", translations: {} })).toEqual([]);
  });

  test("no list, or no file: nothing changes", async () => {
    globalThis.fetch = async () => ({ ok: false });
    const i18n = { lang: "es", translations: { FFX: { Label: "X es" } } };
    expect(await applyKeptEnglish("ffx", i18n)).toEqual([]);
    expect(i18n.translations).toEqual({ FFX: { Label: "X es" } });
  });
});
