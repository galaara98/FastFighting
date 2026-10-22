import { describe, test, expect } from "vitest";
import { suggestTactics, TACTIC_CHOICES, TACTIC_KEYS } from "../scripts/engine/tactics.js";
import { willingness, CONSUMABLE_WILL } from "../scripts/engine/behavior/reluctance.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike } from "./helpers.js";

const traits = (tactical, brave, selfish, loyal) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: brave, fudge: 0 }, selfish: { base: selfish, fudge: 0 }, loyal: { base: loyal, fudge: 0 } });
const bow = () => strike({ id: "bow", name: "Shortbow", melee: false, range: { increment: 60, max: 360 }, damage: [parseFormula("1d6", "piercing")] });
const potion = () => ({ id: "potion", name: "Healing Potion", kind: "heal", cost: 1, heal: [parseFormula("2d8", "healing")], resource: "item:p", selfOnly: true });
const cure = () => ({ id: "cure", name: "Cure", kind: "heal", cost: 2, heal: [parseFormula("1d8", "healing")], resource: "slot:1" });
const who = (t, extra = {}) => creature({ traits: traits(...t), actions: [strike(), bow(), potion(), cure()], shield: { ac: 2 }, ...extra });
const talker = { languages: ["common"], pitches: { persuade: { mod: 5 } } };

describe("what a character would do, when it's left to it", () => {
  test("a middle-of-the-road character answers as most would", () => {
    const s = suggestTactics(who([50, 50, 50, 50]));
    expect(s).toMatchObject({ style: "protector", target: "protect", resourceUse: "balanced", consumables: "useful", specialty: "none",
      healAggro: "balanced", potionThreshold: "50", allyDying: "rescue", selfRevived: "rejoin", retreat: "hurt", shield: "spare", beyond: "stay" });
  });

  test("its hidden scores move it: the timid, the bold and rash, the self-serving, the planner, the devoted", () => {
    const timid = suggestTactics(who([50, 25, 50, 50]));
    expect(timid).toMatchObject({ style: "ranged", allyDying: "retreat", selfRevived: "retreat", potionThreshold: "75", shield: "always", retreat: "hurt" });
    const rash = suggestTactics(who([35, 85, 50, 50]));
    expect(rash).toMatchObject({ target: "nearest", resourceUse: "nova", consumables: "freely", retreat: "never", shield: "never", beyond: "hunt" });
    const selfish = suggestTactics(who([55, 55, 80, 40]));
    expect(selfish).toMatchObject({ healAggro: "conservative", consumables: "avoid", resourceUse: "conserve", potionThreshold: "75", allyDying: "protectSelf" });
    expect(selfish.style).not.toBe("protector");
    const planner = suggestTactics(who([85, 60, 40, 65], { shield: null }));
    expect(planner).toMatchObject({ target: "casters", resourceUse: "conserve", consumables: "sparing", retreat: "losing", beyond: "seekHelp", selfRevived: "healSelf" });
    const devoted = suggestTactics(who([60, 75, 5, 95]));
    expect(devoted).toMatchObject({ healAggro: "allCosts", consumables: "freely", allyDying: "rescue", retreat: "never" });
  });

  test("every answer is one of its own question's choices, whatever the scores", () => {
    for ( const t of [0, 25, 50, 75, 100] ) for ( const b of [0, 30, 60, 90] ) for ( const s of [0, 40, 70, 100] ) for ( const l of [0, 50, 90] ) {
      const got = suggestTactics(who([t, b, s, l], { social: talker }));
      for ( const k of TACTIC_KEYS ) {
        if ( k === "preferredAction" ) expect(got[k]).toBeTruthy();
        else expect(TACTIC_CHOICES[k], `${k}: ${got[k]}`).toContain(got[k]);
      }
    }
  });

  test("a world's default for player characters is used only where the GM set one", () => {
    const pc = who([50, 50, 50, 50], { kind: "pc" });
    expect(suggestTactics(pc, { healAggro: "auto", allyDying: "auto" })).toMatchObject({ healAggro: "balanced", allyDying: "rescue" });
    expect(suggestTactics(pc, { healAggro: "allCosts", allyDying: "fight" })).toMatchObject({ healAggro: "allCosts", allyDying: "fight" });
    // (A creature that isn't a player character answers for itself.)
    expect(suggestTactics(who([50, 50, 50, 50]), { healAggro: "allCosts" }).healAggro).toBe("balanced");
  });
});

describe("consumables, from \"I don't like to\" to \"they're here to get used\"", () => {
  const run = { round: 1, rng: { chance: () => true }, units: [] };
  const unit = answer => ({ id: "u", side: "friendly", spec: { kind: "npc" }, tac: { consumables: answer }, hp: 20, maxHp: 20, status: "ok" });
  test("each answer as willing as its place on the scale; one who loves them values them more", () => {
    const w = a => willingness({ ...run, units: [unit(a)] }, unit(a), potion());
    expect(w("avoid")).toBe(CONSUMABLE_WILL.avoid);
    expect(w("sparing")).toBe(CONSUMABLE_WILL.sparing);
    expect(w("useful")).toBe(1);
    expect(w("freely")).toBeGreaterThan(1);
    // (An older sheet's "I don't like to use consumables" box.)
    expect(willingness(run, { ...unit(undefined), tac: { consumables: "avoid" }, spec: {} }, potion())).toBe(CONSUMABLE_WILL.avoid);
  });
});

describe("what the picked playstyles do together, for the GM", () => {
  test("their score shifts and habits, the strongest first, in one list; nothing for none", async () => {
    const { playstyleEffectsText } = await import("../scripts/foundry/tactics.js");
    const { combinePlaystyles, PLAYSTYLES } = await import("../scripts/engine/playstyles.js");
    const { localize } = await import("../scripts/i18n.js");
    const text = playstyleEffectsText(combinePlaystyles(["brawler", "tank"]));
    expect(text).toContain(localize("FASTFIGHTING.Trait.brave"));
    expect(text).toContain(localize("FASTFIGHTING.Playstyle.Effect.taunt"));
    expect(text).toMatch(/%/);
    expect(playstyleEffectsText(combinePlaystyles([]))).toBe("");
    // (Every habit a playstyle has, named.)
    for ( const p of Object.values(PLAYSTYLES) ) for ( const k of Object.keys(p.behavior ?? {}) ) {
      expect(localize(`FASTFIGHTING.Playstyle.Effect.${k}`), k).not.toBe(`FASTFIGHTING.Playstyle.Effect.${k}`);
    }
  });
});

describe("how often each answer comes up, as a fight draws them", () => {
  test("one pill: its answer; staying true: the calculated answer, the pill's only now and then", async () => {
    const { answerChances, combinePlaystyles, STAY_TRUE_CAP } = await import("../scripts/engine/playstyles.js");
    const brawler = combinePlaystyles(["brawler"]);
    expect(answerChances("style", "ranged", brawler)).toEqual([["frontline", 1]]);
    const steady = combinePlaystyles(["brawler"], { stayTrue: true });
    expect(answerChances("style", "ranged", steady, true)).toEqual([["ranged", 1 - STAY_TRUE_CAP], ["frontline", STAY_TRUE_CAP]]);
    // (A pill that agrees with the calculation: no departure.)
    expect(answerChances("style", "frontline", steady, true)).toEqual([["frontline", 1]]);
    // (No pill says anything: the calculated answer.)
    expect(answerChances("beyond", "stay", combinePlaystyles([]))).toEqual([["stay", 1]]);
  });

  test("pills that disagree: each by its place", async () => {
    const { answerChances, combinePlaystyles } = await import("../scripts/engine/playstyles.js");
    const both = combinePlaystyles(["brawler", "wallflower"]);
    const chances = answerChances("style", "frontline", both);
    expect(chances[0][0]).toBe("frontline");
    expect(chances.map(([v]) => v)).toContain("ranged");
    expect(chances.reduce((s, [, p]) => s + p, 0)).toBeCloseTo(1);
  });
});
