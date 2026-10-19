/**
 * How hurt a creature looks, called out in the story (story/health.js): the core's bands, or the Health Estimate
 * module's words where it's on (foundry/health-estimate.js); once for each state it falls into, again after it's healed
 * out of one and falls back in, never at 0; and the GMs' alone where the players may not learn it.
 */
import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { beginLive, liveRound } from "../scripts/engine/live.js";
import { healthBand, healthCallout, healthCallouts, healthLine } from "../scripts/story/health.js";
import { buildStory, storyBeats } from "../scripts/story/story.js";
import { healthLookup, HE_THRESHOLD } from "../scripts/foundry/health-estimate.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle, pcTurn } from "./helpers.js";
import { storyTables, text } from "./foundry-i18n.js";

const english = storyTables();
const tables = { get: k => english[k] };
const word = key => text(`FASTFIGHTING.Health.${key}`);

/** Amiri's blow at the wolf (100 hit points at most), from `from` hit points to `to`, in turn `turn`. */
const blow = (turn, from, to, extra = {}) => ({
  round: 1, turn, turnOf: "amiri", type: "attack", actor: "Amiri", actorId: "amiri", side: "friendly", target: "Wolf", targetId: "wolf",
  action: "Bastard Sword", degree: 2, margin: 3, damage: from - to, damageType: "slashing", hpBefore: from, hpAfter: to, maxHp: 100, ...extra
});

/** Amiri and the wolf. */
const duel = () => battle([
  creature({ id: "amiri", name: "Amiri", kind: "pc", diesAtZero: false, actions: [strike({ name: "Bastard Sword" })] }),
  creature({ id: "wolf", name: "Wolf", side: "hostile", hp: { value: 100, max: 100 }, actions: [strike({ name: "Jaws", damage: [parseFormula("1d6+2", "piercing")] })] })
]);

/** How often the story's callout lines say the wolf looks this way. */
function calledOut(told, state) {
  const lines = english["event.healthState"].map(l => l.replace("{target}", "Wolf").replace("{state}", state).trim());
  return lines.reduce((n, l) => n + told.split(l.charAt(0).toUpperCase() + l.slice(1)).length - 1, 0);
}

/** Health Estimate on, as a stub: its default estimation table, or a getStage that throws. Returns what getStage was asked. */
function healthEstimate({ hide = false, throws = false, on = true } = {}) {
  const asked = [];
  const stages = [[0, "Unconscious"], [25, "Near Death"], [50, "Badly Injured"], [75, "Injured"], [99, "Barely Injured"], [100, "Unharmed"]];
  globalThis.game.modules = new Map([["healthEstimate", { active: on }]]);
  globalThis.game.healthEstimate = {
    getStage(token, fraction) {
      asked.push({ token, fraction });
      if ( throws ) throw new Error("no estimate");
      const pct = Math.round(fraction * 1000) / 10;
      const index = stages.findIndex(([value]) => value >= pct);
      return { estimate: { value: stages[index][0], label: stages[index][1] }, index };
    },
    hideEstimate: () => hide
  };
  return asked;
}

/** The wolf's token on the scene (not drawn: no placeable). */
const wolfToken = (over = {}) => ({ name: "Wolf", hidden: false, object: null, actor: { type: "npc", statuses: new Set() }, ...over });

describe("the core's bands", () => {
  test("below half annoyed, below a quarter wounded, below a tenth bloodied, below 2.5% nearly dead; half or more, nothing", () => {
    expect([0.49, 0.24, 0.09, 0.02, 0.51, 0.5, 0].map(healthBand)).toEqual(["annoyed", "wounded", "bloodied", "nearlyDead", null, null, null]);
    // (As a blow from full health calls them out: the language file's words.)
    for ( const [hp, key] of [[49, "annoyed"], [24, "wounded"], [9, "bloodied"], [2, "nearlyDead"]] ) expect(healthCallout(blow(1, 100, hp))?.label).toBe(word(key));
    expect(healthCallout(blow(1, 100, 51))).toBe(null);
  });

  test("called once for each state it falls into; again after it's healed out of one and falls back in", () => {
    // (Hit to 49, 45, 24, 20; healed to 60 between turns 4 and 5; hit to 20, 9, 2.)
    const log = [blow(1, 100, 49), blow(2, 49, 45), blow(3, 45, 24), blow(4, 24, 20), blow(5, 60, 20), blow(6, 20, 9), blow(7, 9, 2)];
    const told = healthCallouts(log);
    expect(log.map(e => told.get(e)?.label ?? null)).toEqual([word("annoyed"), null, word("wounded"), null, word("wounded"), word("bloodied"), word("nearlyDead")]);
    // (Told so in the story, right after each blow.)
    const story = buildStory({ log, units: {} }, duel(), "roleplay", { tables, seed: 4 }).text;
    expect(calledOut(story, word("wounded"))).toBe(2);
    expect(calledOut(story, word("annoyed"))).toBe(1);
    expect(calledOut(story, word("nearlyDead"))).toBe(1);
  });

  test("nothing at 0 hit points: a fall is told by its own event", () => {
    expect(healthCallout(blow(1, 30, 0))).toBe(null);
    let falls = 0;
    for ( let seed = 1; seed <= 12; seed++ ) {
      const spec = duel();
      spec.combatants.find(c => c.id === "wolf").hp = { value: 30, max: 30 };
      const r = replay(spec, pf2eRules, seed);
      // (Every harm that says its hit points left them lower, and above 0.)
      const noted = r.log.filter(e => Number.isFinite(e.hpAfter));
      expect(noted.length).toBeGreaterThan(0);
      for ( const e of noted ) {
        expect(e.hpAfter).toBeGreaterThan(0);
        expect(e.hpAfter).toBeLessThan(e.hpBefore);
        expect(e.hpBefore - e.hpAfter).toBeLessThanOrEqual(e.damage ?? e.amount);
        expect(e.maxHp).toBe(spec.combatants.find(c => c.id === (e.targetId ?? e.actorId)).hp.max);
      }
      // (The blow that fells it says none.)
      r.log.forEach((e, i) => {
        if ( !["down", "death"].includes(e.type) ) return;
        falls += 1;
        const felling = r.log.slice(0, i).reverse().find(b => b.type === "attack" && b.targetId === e.actorId && b.turn === e.turn);
        if ( felling ) expect(felling.hpAfter).toBeUndefined();
      });
    }
    expect(falls).toBeGreaterThan(0);
  });

  test("a player's blow in a live battle: its hit points as the sheets show them, on its last blow at the creature", () => {
    const spec = battle([
      creature({ id: "valeros", name: "Valeros", kind: "pc", diesAtZero: false, hp: { value: 40, max: 40 } }),
      creature({ id: "goblin", name: "Goblin", side: "hostile", hp: { value: 20, max: 20 } })
    ]);
    const run = beginLive(spec, pf2eRules, { seed: 2, players: ["valeros"] });
    liveRound(run, 1);
    const hit = { type: "attack", targetId: "goblin", action: "Longsword", degree: 2, damage: 7, damageType: "slashing", natural: 15, total: 24, dc: 16, melee: true };
    expect(run.byId.get("goblin").hp).toBe(20);
    const { events } = pcTurn(run, "valeros", [hit, { ...hit, damage: 6 }], { goblin: { hp: 7 } });
    const [first, last] = events.filter(e => e.type === "attack" && e.actorId === "valeros");
    expect(first.hpAfter).toBeUndefined();
    expect(last).toMatchObject({ hpBefore: 20, hpAfter: 7, maxHp: 20 });
    expect(healthCallout(last)?.label).toBe(word("annoyed"));
    // (Fallen, as the sheets show: nothing.)
    const { events: more } = pcTurn(run, "valeros", [hit], { goblin: { hp: 0, status: "dead" } });
    expect(more.find(e => e.type === "attack").hpAfter).toBeUndefined();
  });

  test("the Statistician's line: whom, how it looks, its share of hit points", () => {
    const log = [blow(1, 100, 24)];
    const c = healthCallout(log[0]);
    expect(healthLine(c)).toContain(word("wounded"));
    expect(healthLine(c)).toContain("24");
    expect(buildStory({ log, units: {} }, duel(), "statistician").text).toContain(healthLine(c));
  });
});

describe("with Health Estimate", () => {
  test("its word for the creature at the battle's share of hit points, from 43.7% down; nothing above", () => {
    const asked = healthEstimate();
    const token = wolfToken();
    const look = healthLookup({ tokenOf: id => (id === "wolf" ? token : null) });
    expect(look("wolf", HE_THRESHOLD)).toEqual({ label: "Badly Injured", hidden: false });
    expect(look("wolf", 0.2)).toEqual({ label: "Near Death", hidden: false });
    expect(look("wolf", 0.44)).toBe(null);
    expect(look("wolf", 0.45)).toBe(null); // (the core's bands would say annoyed)
    // (Asked of the token as Health Estimate reads one: its document and its actor.)
    expect(asked[0].token.document).toBe(token);
    expect(asked[0].token.actor).toBe(token.actor);
    expect(asked[0].fraction).toBe(HE_THRESHOLD);
    // As callouts: once for each of its stages, from 43.7% down.
    const log = [blow(1, 100, 45), blow(2, 45, 43), blow(3, 43, 30), blow(4, 30, 20)];
    const told = healthCallouts(log, look);
    expect(log.map(e => told.get(e)?.label ?? null)).toEqual([null, "Badly Injured", null, "Near Death"]);
  });

  test("not on, or no token to read: the core's bands", () => {
    healthEstimate({ on: false });
    expect(healthLookup({ tokenOf: () => wolfToken() })("wolf", 0.45)).toEqual({ label: word("annoyed"), hidden: false });
    healthEstimate();
    expect(healthLookup({ tokenOf: () => null })("wolf", 0.2)).toEqual({ label: word("wounded"), hidden: false });
  });

  test("a getStage that fails, or has no word, falls back to the core's bands", () => {
    healthEstimate({ throws: true });
    const look = healthLookup({ tokenOf: () => wolfToken() });
    expect(look("wolf", 0.2)).toEqual({ label: word("wounded"), hidden: false });
    expect(healthCallout(blow(1, 100, 9), look)?.label).toBe(word("bloodied"));
    globalThis.game.healthEstimate.getStage = () => undefined;
    expect(look("wolf", 0.2)?.label).toBe(word("wounded"));
    // (A lookup of the caller's that throws: the core's bands too.)
    expect(healthCallout(blow(1, 100, 9), () => { throw new Error("no"); })?.label).toBe(word("bloodied"));
  });
});

describe("what the players may not learn", () => {
  test("hidden from players by Health Estimate, or a hidden token: hidden", () => {
    healthEstimate({ hide: true });
    expect(healthLookup({ tokenOf: () => wolfToken() })("wolf", 0.2)).toEqual({ label: "Near Death", hidden: true });
    healthEstimate();
    expect(healthLookup({ tokenOf: () => wolfToken({ hidden: true }) })("wolf", 0.2)?.hidden).toBe(true);
  });

  test("without Health Estimate, the core's rules: hidden where the players can't tell how it is", () => {
    const look = known => healthLookup({ tokenOf: () => wolfToken(), playersKnow: () => known });
    expect(look(true)("wolf", 0.2)).toEqual({ label: word("wounded"), hidden: false });
    expect(look(false)("wolf", 0.2)).toEqual({ label: word("wounded"), hidden: true });
    expect(healthLookup({ tokenOf: () => wolfToken(), playersKnow: () => { throw new Error("no run"); } })("wolf", 0.2)?.hidden).toBe(true);
  });

  test("a hidden callout is left out of the story told openly, and kept in the GMs' part; whispered, it's told as ever", () => {
    const log = [blow(1, 100, 30), blow(2, 30, 20)];
    // (The first, seen; the second, hidden: Health Estimate's flag set between them.)
    const look = (id, fraction) => (fraction < 0.25 ? { label: "Grim Shape", hidden: true } : fraction < 0.5 ? { label: "Scuffed Up", hidden: false } : null);
    for ( const style of ["roleplay", "standard"] ) {
      const open = storyBeats({ log, units: {} }, duel(), style, { tables, seed: 3, healthState: look, open: true });
      const html = open.map(b => b.html).join("");
      const gm = open.map(b => b.gmHtml).join("");
      expect([style, html.includes("Scuffed Up"), html.includes("Grim Shape")]).toEqual([style, true, false]);
      expect([style, gm.includes("Grim Shape"), gm.includes("Scuffed Up")]).toEqual([style, true, false]);
      // (Right after the blow that caused it: in that blow's beat.)
      expect(open.find(b => b.turns.includes(2)).gmHtml).toContain("Grim Shape");
      const whispered = storyBeats({ log, units: {} }, duel(), style, { tables, seed: 3, healthState: look, open: false });
      expect(whispered.map(b => b.html).join("")).toContain("Grim Shape");
    }
  });
});
