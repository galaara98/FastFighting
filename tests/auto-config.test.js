/**
 * Setting a character up by itself: the playstyles that fit it (its numbers and actions, its system's hints, its
 * biography's words; best first, never two that pull against each other, at most four), and when to pick them (once)
 * and when to work its calculated answers out again (missing, broken, an older core API, the character changed).
 */
import { describe, expect, test } from "vitest";
import { scorePlaystyles, pickPlaystyles, readSpec, CLASHES } from "../scripts/engine/auto-playstyles.js";
import { autoPlan, validLets, specSignature } from "../scripts/foundry/auto-config.js";
import { readKeywordFile, keywordEffects } from "../scripts/engine/keywords.js";
import { suggestTactics, TACTIC_KEYS } from "../scripts/engine/tactics.js";
import { tacticsFor } from "../scripts/foundry/tactics.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike } from "./helpers.js";

const traits = (tactical, brave, selfish, loyal) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: brave, fudge: 0 }, selfish: { base: selfish, fudge: 0 }, loyal: { base: loyal, fudge: 0 } });
const bow = () => strike({ id: "bow", name: "Bow", melee: false, reach: undefined, range: { increment: 60, max: 240 } });
const spell = id => ({ id, name: id, kind: "spell-attack", cost: 2, rank: 1, bonus: 8, range: { increment: 60 }, damage: [parseFormula("2d6", "fire")] });
const picks = (spec, options) => pickPlaystyles(scorePlaystyles(spec, options));

describe("the playstyles that fit", () => {
  test("a brave, loyal, selfless fighter with a shield and good armor: a Tank, first", () => {
    const spec = creature({ traits: traits(55, 85, 20, 80), shield: { ac: 2, hardness: 5 }, defenses: { ac: 22, fortitude: 9, reflex: 7, will: 7 } });
    expect(picks(spec)[0]).toBe("tank");
  });

  test("a timid archer: a Chicken or a Wallflower, never a Tank or a Martyr with it", () => {
    const got = picks(creature({ traits: traits(50, 20, 50, 50), actions: [bow()] }));
    expect(got.slice(0, 2).sort()).toEqual(["chicken", "wallflower"]);
    expect(got).not.toContain("tank");
    expect(got).not.toContain("martyr");
  });

  test("one who'd rather cast: Un-Mundane; a fine thief: Thief; the mindless: Relentless, and no talker's pill", () => {
    expect(picks(creature({ traits: traits(60, 50, 40, 50), actions: [strike(), spell("a"), spell("b"), spell("c")] }))).toContain("unmundane");
    expect(picks(creature({ traits: traits(50, 50, 50, 50), theft: { mod: 12 } }))).toContain("thief");
    const zombie = picks(creature({ traits: traits(10, 90, 50, 50), flags: { mindless: true, fearless: true }, social: { pitches: { persuade: { mod: 20 } }, mindless: true } }));
    expect(zombie[0]).toBe("relentless");
    expect(zombie).not.toContain("diplomat");
  });

  test("the system's hints weigh in, for and against; the biography's words too, two at most", () => {
    const plain = creature({ traits: traits(50, 50, 50, 50), defenses: { ac: 11 } });
    expect(picks(plain)).toEqual([]);
    expect(picks(plain, { hints: { enabler: 1 } })).toEqual(["enabler"]);
    const tank = creature({ traits: traits(55, 85, 20, 80), shield: { ac: 2 }, defenses: { ac: 22 } });
    expect(picks(tank, { hints: { tank: -1 } })).not.toContain("tank");
    const words = readKeywordFile({ words: { greed: { playstyles: { mercenary: 1 } }, sellsword: { playstyles: { mercenary: 1 }, traits: { loyal: -2 } }, thief: { playstyles: { thief: 1 } } } });
    expect(keywordEffects("A greedy sellsword who loves Gold.", words).playstyles).toEqual({ mercenary: 2 });
    // (Two keywords' worth at most count, so a long list of them is no stronger than two; and words can count against.)
    expect(picks(creature({ traits: traits(50, 50, 50, 50), defenses: { ac: 11 } }), { words: { enabler: 9 } })).toEqual(["enabler"]);
    expect(picks(creature({ traits: traits(50, 50, 50, 50), defenses: { ac: 11 } }), { hints: { enabler: 1 }, words: { enabler: -2 } })).toEqual([]);
  });

  test("a player character's traits count only where it's unlike the usual one (bold, loyal, unselfish by default)", () => {
    const pc = extra => creature({ kind: "pc", traits: traits(65, 75, 25, 80), defenses: { ac: 11 }, ...extra });
    expect(picks(pc())).toEqual([]);
    // (The same numbers on a creature that isn't a player character say a lot.)
    expect(picks(creature({ traits: traits(65, 75, 25, 80), defenses: { ac: 11 } }))).toContain("moralist");
    // A timid player character, for one of them, is a Chicken.
    expect(picks(pc({ traits: traits(65, 30, 25, 80) }))).toContain("chicken");
    // A plain one (a funnel peasant: less bold and loyal than a hero) isn't a villain for it.
    const plain = picks(pc({ traits: traits(50, 50, 50, 45) }));
    expect(plain).not.toContain("cruel");
    expect(plain).not.toContain("mercenary");
  });

  test("at most four, best first, never two that pull against each other", () => {
    const hints = Object.fromEntries(["chicken", "martyr", "tank", "enabler", "moralist", "diplomat", "loreCollector"].map((id, i) => [id, 1 - i * 0.05]));
    const got = picks(creature({ traits: traits(50, 50, 50, 50), defenses: { ac: 11 } }), { hints });
    expect(got.length).toBe(4);
    expect(got[0]).toBe("chicken");
    for ( const [a, b] of CLASHES ) expect(got.includes(a) && got.includes(b)).toBe(false);
  });

  test("reading a spec: specialties against weapons, close and far", () => {
    const s = readSpec(creature({ actions: [strike(), bow(), spell("x")] }));
    expect(s).toMatchObject({ melee: 1, ranged: 2 });
    expect(s.special).toBeCloseTo(1 / 3);
  });
});

describe("when to set a character up", () => {
  const spec = creature({ actions: [strike({ id: "sword" })] });
  const lets = suggestTactics(spec);
  const sig = specSignature(spec);
  const record = { api: 12, sig, lets, picked: ["tank"] };

  test("never set up and no playstyles: pick them, and work its answers out", () => {
    expect(autoPlan({}, null, { api: 12, sig, spec })).toEqual({ pick: true, lets: true });
  });

  test("set up by hand before (playstyles, no record): its playstyles stay; its answers are worked out", () => {
    expect(autoPlan({ playstyles: ["thief"] }, null, { api: 12, sig, spec })).toEqual({ pick: false, lets: true });
  });

  test("set up already: nothing, and its playstyles are never picked again, even with none left", () => {
    expect(autoPlan({ playstyles: ["tank"] }, record, { api: 12, sig, spec })).toEqual({ pick: false, lets: false });
    expect(autoPlan({}, record, { api: 12, sig, spec })).toEqual({ pick: false, lets: false });
  });

  test("its answers again (not its playstyles) when the core API moves on, the character changes, or they're missing or broken", () => {
    expect(autoPlan({}, record, { api: 13, sig, spec })).toEqual({ pick: false, lets: true });
    expect(autoPlan({}, record, { api: 12, sig: "other", spec })).toEqual({ pick: false, lets: true });
    const { talk, ...missing } = lets;
    expect(autoPlan({}, { ...record, lets: missing }, { api: 12, sig, spec })).toEqual({ pick: false, lets: true });
    expect(autoPlan({}, { ...record, lets: { ...lets, retreat: "sometimes" } }, { api: 12, sig, spec })).toEqual({ pick: false, lets: true });
    expect(autoPlan({}, { ...record, lets: { ...lets, preferredAction: "gone" } }, { api: 12, sig, spec })).toEqual({ pick: false, lets: true });
  });

  test("a reset: both, at once", () => {
    expect(autoPlan({}, null, { api: 12, sig, spec, force: true })).toEqual({ pick: true, lets: true });
  });

  test("whole and sound answers: one for every question, each a fair one", () => {
    expect(validLets(lets, spec)).toBe(true);
    expect(TACTIC_KEYS.every(k => k in lets)).toBe(true);
    expect(validLets(null, spec)).toBe(false);
  });

  test("what the answers are worked out from: its level, what it can do, the world's defaults", () => {
    expect(specSignature({ ...spec, level: 2 })).not.toBe(sig);
    expect(specSignature({ ...spec, actions: [...spec.actions, bow()] })).not.toBe(sig);
    expect(specSignature(spec, { healAggro: "aggressive" })).not.toBe(sig);
    expect(specSignature(creature({ id: "other", actions: [strike({ id: "sword" })] }))).toBe(sig);
  });

  test("what 'Let it decide' shows: the answers its auto setup worked out (sound ones), over the live reading", () => {
    globalThis.game.settings = { get: () => undefined };
    globalThis.game.system = { id: "none" };
    const flags = { auto: { ...record, lets: { ...lets, retreat: "losing", talk: "never" } } };
    const actor = { getFlag: (scope, key) => flags[key] };
    const { calc } = tacticsFor(actor, spec);
    expect(calc).toMatchObject({ retreat: "losing", talk: "never" });
    flags.auto.lets.retreat = "nonsense";
    expect(tacticsFor(actor, spec).calc.retreat).toBe(lets.retreat);
  });
});
