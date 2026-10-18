/** One that speaks every language (social.anyLanguage: PF2e's constant tongues) understands anyone with a language. */
import { describe, expect, test } from "vitest";
import { shareLanguage } from "../scripts/engine/behavior/standoff.js";

const unit = social => ({ spec: { social } });

describe("every language", () => {
  test("anyone with a language understands it, and it them; one with none, not", () => {
    const polyglot = unit({ languages: ["draconic"], anyLanguage: true });
    expect(shareLanguage(polyglot, unit({ languages: ["goblin"] }))).toBe(true);
    expect(shareLanguage(unit({ languages: ["goblin"] }), polyglot)).toBe(true);
    expect(shareLanguage(polyglot, unit({ languages: [] }))).toBe(false);
    expect(shareLanguage(unit({ languages: ["draconic"] }), unit({ languages: ["goblin"] }))).toBe(false);
  });
});
