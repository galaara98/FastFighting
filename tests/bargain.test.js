import { describe, expect, test } from "vitest";
import { replay, prepareBattle } from "../scripts/engine/simulator.js";
import { createRun } from "../scripts/engine/battle-state.js";
import { meets, comeDown, holdsOut } from "../scripts/engine/behavior/bargain.js";
import { impatience } from "../scripts/engine/behavior/standoff.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { buildStory } from "../scripts/story/story.js";
import { storyTables } from "./foundry-i18n.js";
import { creature, battle, social } from "./helpers.js";

const english = storyTables();
const tables = { get: k => english[k] };
const speaks = (extra = {}) => social({ diplomacy: 12, intimidation: 8, deception: 6, willDC: 16, perceptionDC: 16, ...extra });
const sword = { id: "sword", name: "Cold Iron Sword", value: 300, category: "weapon", material: "coldIron", rarity: "common" };

/** A toll at a bridge: an envoy for the party, a captain and a guard; what each brings and wants, as given. */
function toll({ opening = "argument", envoy = {}, captain = {}, options = {} } = {}) {
  const e = creature({ id: "envoy", name: "Seelah", kind: "pc", diesAtZero: false, social: speaks(), tactics: { talk: "first" },
    valuables: { money: 60, stowed: [], wielded: [] }, motives: { offer: null, expect: null }, ...envoy });
  const c = creature({ id: "captain", name: "Captain", side: "hostile", social: speaks({ diplomacy: 6 }), tactics: { talk: "first" },
    valuables: { money: 500, stowed: [], wielded: [] }, motives: { offer: null, expect: null }, ...captain });
  const g = creature({ id: "guard", name: "Guard", side: "hostile", social: speaks({ diplomacy: 2 }) });
  const spec = battle([e, c, g], { maxRounds: 8, opening, ...options });
  spec.sides.hostile.leaderId = "captain";
  return spec;
}

const deals = r => r.log.filter(e => e.type === "deal");

describe("what meets what's expected", () => {
  test("money: at least as much; a promise: the same one; something: the kind asked for", () => {
    expect(meets({ kind: "money", amount: 50 }, { kind: "money", amount: 50 })).toBe(true);
    expect(meets({ kind: "money", amount: 49 }, { kind: "money", amount: 50 })).toBe(false);
    expect(meets({ kind: "promise", promise: "passage" }, { kind: "promise", promise: "passage" })).toBe(true);
    expect(meets({ kind: "promise", promise: "noHarm" }, { kind: "promise", promise: "passage" })).toBe(false);
    const item = i => ({ kind: "item", item: { ...sword, ...i } });
    expect(meets(item({}), { kind: "thing", category: "weapon", material: "coldIron", minValue: 200 })).toBe(true);
    expect(meets(item({ category: "armor" }), { kind: "thing", category: "weapon" })).toBe(false);
    expect(meets(item({ rarity: "uncommon" }), { kind: "thing", rarity: "rare" })).toBe(false);
    expect(meets(item({ value: 100 }), { kind: "thing", minValue: 200 })).toBe(false);
    // An unvalued thing (junk, or beyond price) counts only when that's allowed.
    expect(meets(item({ value: 0 }), { kind: "thing", category: "weapon" })).toBe(false);
    expect(meets(item({ value: 0 }), { kind: "thing", category: "weapon", unvalued: true })).toBe(true);
  });

  test("talked down, it asks for less, step by step, then lets it go; what it first asked stays as it was", () => {
    const asked = { kind: "thing", category: "weapon", material: "coldIron", rarity: "rare", minValue: 8, labels: { category: "Weapon", material: "Cold Iron", rarity: "Rare" } };
    const u = { spec: { motives: { expect: asked } } };
    expect(comeDown(u)).toMatchObject({ category: "weapon", material: "", rarity: "", minValue: 8 });
    expect(comeDown(u)).toMatchObject({ minValue: 4 });
    comeDown(u); comeDown(u);
    expect(comeDown(u)).toMatchObject({ minValue: 0, unvalued: true });
    expect(comeDown(u)).toBe(null);
    expect(u.spec.motives.expect).toBe(asked);
    expect(asked.minValue).toBe(8);
    const p = { spec: { motives: { expect: { kind: "promise", promise: "leave" } } } };
    expect(comeDown(p).promise).toBe("passage");
    expect(comeDown(p).promise).toBe("noHarm");
    expect(comeDown(p)).toBe(null);
    const m = { spec: { motives: { expect: { kind: "money", amount: 9 } } } };
    expect(comeDown(m).amount).toBe(4);
  });

  test("the greedy hold out, the peaceable come round", () => {
    const run = createRun(prepareBattle(toll(), pf2eRules));
    const captain = run.byId.get("captain");
    const base = holdsOut(run, captain);
    captain.spec = { ...captain.spec, playstyles: ["mercenary"] };
    const mercenary = holdsOut(run, captain);
    captain.spec = { ...captain.spec, playstyles: ["peacekeeper"] };
    expect(mercenary).toBeGreaterThan(base);
    expect(holdsOut(run, captain)).toBeLessThan(base);
  });

  test("waiting on what it expects, with nothing meeting it, wears on its patience", () => {
    const run = createRun(prepareBattle(toll({ captain: { motives: { expect: { kind: "money", amount: 10 } } } }), pf2eRules));
    const captain = run.byId.get("captain");
    run.round = 1;
    const calm = impatience(run, captain);
    captain.unmet = 3;
    expect(impatience(run, captain)).toBeGreaterThan(calm);
  });
});

describe("bargaining in a standoff", () => {
  test("an offer that meets what the other side expects ends it: a deal, the goods change hands", () => {
    const spec = toll({ envoy: { motives: { offer: { kind: "money", amount: 60 }, expect: null } }, captain: { motives: { offer: null, expect: { kind: "money", amount: 50 } } } });
    for ( let seed = 1; seed <= 10; seed++ ) {
      const r = replay(spec, pf2eRules, seed);
      expect(deals(r)).toHaveLength(1);
      expect(r.winners).toEqual(["hostile"]);
      expect(r.units.envoy.final.concessions[0]).toMatchObject({ kind: "money", amount: 60, to: "captain", deal: true });
      expect(r.log.find(e => e.type === "end").resolved).toBe("conceded");
    }
  });

  test("a promise asked for and given: safe passage, and the story says so", () => {
    const spec = toll({ envoy: { motives: { offer: { kind: "promise", promise: "passage" }, expect: null } }, captain: { motives: { offer: null, expect: { kind: "promise", promise: "passage" } } } });
    for ( let seed = 1; seed <= 10; seed++ ) {
      const r = replay(spec, pf2eRules, seed);
      expect(deals(r)[0]).toMatchObject({ promise: "passage" });
      expect(r.log.find(e => e.type === "end").resolved).toBe("passage");
      const story = buildStory(r, spec, "roleplay", { tables, seed });
      expect(story.text).not.toMatch(/undefined|NaN|\{[a-zA-Z]+\}/);
      expect(english["event.promisePassage"].some(l => story.text.includes(l.replace("{actor}", "Seelah").replace("{by}", "Captain")))).toBe(true);
    }
  });

  test("a player character hands over only what it offered, unless it's talked into more (or haggles a price)", () => {
    const spec = toll({ captain: { motives: { offer: null, expect: { kind: "money", amount: 40 } } } });
    let pressed = 0;
    for ( let seed = 1; seed <= 60; seed++ ) {
      const r = replay(spec, pf2eRules, seed);
      const presses = r.log.filter(e => e.type === "talk" && e.aim === "press" && e.targetId === "envoy");
      const haggles = r.log.filter(e => e.type === "haggle" && e.what === "lowers" && e.byId === "envoy");
      pressed += presses.length;
      for ( const d of deals(r).filter(e => e.actorId === "envoy") ) {
        // (Talked into it: the captain's press got through; or it haggled the price down, and paid that.)
        const talkedInto = presses.some(p => p.degree >= 2 && p.round <= d.round);
        expect(talkedInto || haggles.length > 0).toBe(true);
        expect(d.concession.amount).toBe(talkedInto && !haggles.length ? 40 : haggles.at(-1)?.expect.amount ?? 40);
      }
    }
    expect(pressed).toBeGreaterThan(0);
  });

  test("pressed for one of its things, a player character keeps it unless the luck says otherwise", () => {
    const want = { kind: "thing", category: "weapon" };
    const envoy = { valuables: { money: 0, stowed: [sword], wielded: [] } };
    const given = concedeLuck => {
      let n = 0;
      let kept = 0;
      for ( let seed = 1; seed <= 60; seed++ ) {
        const r = replay(toll({ envoy, captain: { motives: { offer: null, expect: want } }, options: { concedeLuck } }), pf2eRules, seed);
        n += (r.units.envoy.final.concessions ?? []).filter(c => c.item?.id === "sword" && !c.kept).length;
        kept += r.log.filter(e => e.type === "haggle" && e.what === "keeps").length;
      }
      return { n, kept };
    };
    const never = given(0);
    expect(never.n).toBe(0);
    expect(never.kept).toBeGreaterThan(0);
    expect(given(100).n).toBeGreaterThan(0);
  });

  test("what nobody meets is haggled down, and agreed at the lower price", () => {
    const spec = toll({ envoy: { playstyles: ["diplomat"] }, captain: { motives: { offer: null, expect: { kind: "money", amount: 200 } } } });
    let lowered = 0;
    let agreed = 0;
    for ( let seed = 1; seed <= 60; seed++ ) {
      const r = replay(spec, pf2eRules, seed);
      lowered += r.log.filter(e => e.type === "haggle" && e.what === "lowers").length;
      const deal = deals(r)[0];
      if ( deal?.concession && deal.actorId !== "captain" ) {
        expect(deal.concession.amount).toBeLessThan(200);
        agreed++;
      }
      expect(spec.combatants[1].motives.expect.amount).toBe(200);
    }
    expect(lowered).toBeGreaterThan(0);
    expect(agreed).toBeGreaterThan(0);
  });

  test("made to pay in a standoff, it pays what the other side expects (not just a share of its purse)", () => {
    const spec = toll({ opening: "talk", envoy: { motives: { offer: null, expect: { kind: "money", amount: 77 } } } });
    let paid = 0;
    for ( let seed = 1; seed <= 60; seed++ ) {
      const r = replay(spec, pf2eRules, seed);
      for ( const c of r.units.captain.final.concessions ?? [] ) {
        if ( !c.deal && !c.expected ) continue;
        expect(c.amount).toBe(77);
        paid++;
      }
    }
    expect(paid).toBeGreaterThan(0);
  });

  test("only an argument: nobody runs, and nobody pays and goes", () => {
    const spec = toll({ envoy: { playstyles: ["diplomat"], valuables: { money: 0, stowed: [], wielded: [] } }, captain: { valuables: { money: 0, stowed: [], wielded: [] } } });
    for ( let seed = 1; seed <= 60; seed++ ) {
      const r = replay(spec, pf2eRules, seed);
      for ( const u of Object.values(r.units) ) expect(u.final.status).not.toBe("fled");
      expect(r.log.some(e => e.type === "sway" && (e.outcome === "fled" || e.outcome === "surrendered" || e.lie))).toBe(false);
    }
  });

  test("with blows possible, a standoff falls apart more often than only an argument does", () => {
    const failed = opening => {
      let n = 0;
      for ( let seed = 1; seed <= 300; seed++ ) {
        const r = replay(toll({ opening, captain: { playstyles: ["impatient"] } }), pf2eRules, seed);
        if ( r.log.some(e => e.type === "breakStandoff" || e.type === "collapse") ) n++;
      }
      return n;
    };
    expect(failed("talk")).toBeGreaterThan(failed("argument"));
  });
});
