import { describe, expect, test } from "vitest";
import { runBatchSync, replay, prepareBattle } from "../scripts/engine/simulator.js";
import { createRun } from "../scripts/engine/battle-state.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { buildStory } from "../scripts/story/story.js";
import { storyTables, text } from "./foundry-i18n.js";
import { sanitizeTactics } from "../scripts/foundry/tactics.js";
import { creature, strike, battle } from "./helpers.js";

const english = storyTables();
const tables = { get: k => english[k] };

/**
 * A PC who is already dying, with a friend standing over them and one weak foe left. (holdsOff: the friend looks to
 * itself in the fight, tending the dying only once it's over.)
 */
function rescue({ medic = true, aftermath = "tell", holdsOff = false } = {}) {
  const dying = creature({ id: "down", name: "Valeros", kind: "pc", diesAtZero: false, hp: { value: 0, max: 30 }, dying: 2 });
  const friend = creature({ id: "friend", name: "Kyra", kind: "pc", diesAtZero: false, hp: { value: 40, max: 40 },
    actions: [strike({ id: "sword", bonus: 20, damage: [parseFormula("3d8+10", "slashing")] })],
    firstAid: medic ? { mod: 20 } : null, disposition: holdsOff ? { allyDying: "protectSelf" } : undefined });
  const foe = creature({ id: "foe", side: "hostile", hp: { value: 5, max: 5 }, defenses: { ac: 5 }, actions: [strike({ bonus: -50 })] });
  return battle([dying, friend, foe], { maxRounds: 5, aftermath });
}

describe("after the fight", () => {
  test("a fight already under way keeps a creature's dying value", () => {
    const run = createRun(prepareBattle(rescue(), pf2eRules));
    const down = run.byId.get("down");
    expect(down.dying).toBe(2);
    expect(down.stable).toBe(false);
  });

  test("conditions a creature already has carry into the fight", () => {
    const scared = creature({ id: "s", conditions: { frightened: 2, prone: true } });
    const run = createRun(prepareBattle(battle([scared, creature({ id: "x", side: "hostile" })]), pf2eRules));
    expect(run.byId.get("s").conds.frightened).toBe(2);
    expect(run.byId.get("s").prone).toBe(true);
  });

  test("the survivors tend a dying friend, so nobody is committed as dying", () => {
    const r = runBatchSync(rescue(), pf2eRules, { runs: 200 });
    expect(r.combatants.down.pDead).toBeLessThan(0.2);
    for ( let seed = 1; seed <= 20; seed++ ) {
      const final = replay(rescue(), pf2eRules, seed).units.down.final;
      expect(final.status === "down" && final.dying > 0).toBe(false);
    }
  });

  test("without anyone to help, recovery checks settle it", () => {
    for ( let seed = 1; seed <= 20; seed++ ) {
      const final = replay(rescue({ medic: false }), pf2eRules, seed).units.down.final;
      expect(["dead", "down"]).toContain(final.status);
      if ( final.status === "down" ) expect(final.stable).toBe(true);
    }
  });

  test("stopping at the last blow leaves the fallen as they lie", () => {
    const final = replay(rescue({ aftermath: "none", holdsOff: true }), pf2eRules, 3).units.down.final;
    expect(final.status).toBe("down");
    expect(final.dying).toBeGreaterThan(0);
  });

  test("a quiet aftermath is settled but not told", () => {
    const told = replay(rescue({ holdsOff: true }), pf2eRules, 5);
    const quiet = replay(rescue({ aftermath: "quiet", holdsOff: true }), pf2eRules, 5);
    expect(told.log.some(e => e.aftermath)).toBe(true);
    expect(quiet.units.down.final.status).toBe(told.units.down.final.status);
    const spec = rescue({ aftermath: "quiet", holdsOff: true });
    const story = buildStory(quiet, spec, "statistician", { tables });
    expect(story.html).not.toContain(text("FASTFIGHTING.Log.Aftermath"));
    expect(buildStory(told, rescue({ holdsOff: true }), "statistician", { tables }).html).toContain(text("FASTFIGHTING.Log.Aftermath"));
  });

  test("first aid in the fight: one who would rescue a dying friend tends it before the fight is over", () => {
    let tended = 0;
    for ( let seed = 1; seed <= 10; seed++ ) {
      const log = replay(rescue(), pf2eRules, seed).log;
      tended += log.filter(e => e.type === "firstAid" && !e.aftermath && e.actorId === "friend").length;
    }
    expect(tended).toBeGreaterThan(0);
    const held = replay(rescue({ holdsOff: true }), pf2eRules, 1).log;
    expect(held.some(e => e.type === "firstAid" && !e.aftermath)).toBe(false);
  });
});

describe("rules details", () => {
  test("a hit always deals at least 1 damage", () => {
    const feeble = creature({ id: "feeble", actions: [strike({ id: "slap", bonus: 30, damage: [parseFormula("1d4-10", "bludgeoning")] })] });
    const dummy = creature({ id: "dummy", side: "hostile", hp: { value: 500, max: 500 }, actions: [strike({ bonus: -50 })] });
    const r = replay(battle([feeble, dummy], { maxRounds: 1 }), pf2eRules, 2);
    const hits = r.log.filter(e => e.type === "attack" && e.degree >= 2);
    expect(hits.length).toBeGreaterThan(0);
    for ( const h of hits ) expect(h.damage).toBeGreaterThanOrEqual(1);
  });

  test("an affliction with an onset doesn't take hold until it passes", () => {
    const slow = {
      kind: "affliction", id: "slow", name: "Slow Venom", traits: ["poison"], onset: 10,
      save: { type: "fortitude", dc: 40 }, stages: [{ damage: [parseFormula("5d6", "poison")], conditions: {} }]
    };
    const spider = creature({ id: "spider", actions: [strike({ id: "fangs", bonus: 30, damage: [parseFormula("1", "piercing")], effects: [slow] })] });
    const victim = creature({ id: "victim", side: "hostile", hp: { value: 500, max: 500 }, defenses: { ac: 5, fortitude: 0 }, actions: [strike({ bonus: -50 })] });
    const r = replay(battle([spider, victim], { maxRounds: 3 }), pf2eRules, 4);
    expect(r.log.some(e => e.type === "afflictionStage")).toBe(false);
    const a = r.units.victim.final.afflictions[0];
    expect(a.onset).toBeGreaterThan(0);
  });
});

describe("what players can see in a story", () => {
  test("a hidden bystander who never joined isn't mentioned", () => {
    const at = (x, y) => ({ x, y, size: 5 });
    const spec = battle([
      creature({ id: "pc", name: "Ezren", kind: "pc", diesAtZero: false, position: at(0, 0) }),
      creature({ id: "foe", name: "Goblin", side: "hostile", position: at(10, 0) }),
      creature({ id: "lurker", name: "Hidden Assassin", side: "hostile", hidden: true, inEncounter: false, position: at(200, 0),
        traits: { tactical: { base: 50, fudge: 0 }, brave: { base: 0, fudge: 0 }, selfish: { base: 90, fudge: 0 }, loyal: { base: 50, fudge: 0 } } })
    ], { positioning: true });
    spec.awareness = { lurker: { pc: { see: true, hearDC: 5 }, foe: { see: true, hearDC: 5 } } };
    let checked = 0;
    for ( let seed = 1; seed <= 10; seed++ ) {
      const r = replay(spec, pf2eRules, seed);
      if ( r.units.lurker.final.active ) continue;
      if ( r.log.some(e => e.actorId === "lurker") ) checked += 1; // it noticed, and slipped away or watched
      for ( const style of ["roleplay", "standard", "statistician"] ) {
        expect(buildStory(r, spec, style, { tables, seed }).html).not.toContain("Hidden Assassin");
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("names are escaped in every style", () => {
    const spec = battle([
      creature({ id: "a", name: "<img src=x onerror=alert(1)>", kind: "pc", diesAtZero: false }),
      creature({ id: "b", name: "Goblin", side: "hostile" })
    ]);
    const r = replay(spec, pf2eRules, 1);
    for ( const style of ["roleplay", "standard", "statistician"] ) {
      const html = buildStory(r, spec, style, { tables, seed: 1 }).html;
      expect(html).not.toContain("<img");
    }
  });
});

describe("answers players store", () => {
  test("only answers the survey could produce survive", () => {
    const clean = sanitizeTactics({
      style: "ranged", target: "everyone", potionThreshold: "100", talk: "auto",
      playstyles: ["martyr", "martyr", "nope", "cruel", "leader", "brawler", "diplomat"], stayTrue: "yes", notes: 5
    });
    expect(clean.style).toBe("ranged");
    expect(clean.talk).toBe("auto");
    expect(clean.target).toBeUndefined();
    expect(clean.potionThreshold).toBeUndefined();
    expect(clean.playstyles).toEqual(["martyr", "cruel", "leader", "brawler"]);
    expect(clean.stayTrue).toBe(false);
    expect(clean.notes).toBeUndefined();
    expect(sanitizeTactics("not an object")).toEqual({});
    expect(sanitizeTactics({ playstyles: "cruel" }).playstyles).toBeUndefined();
    // A renamed playstyle saved under its old id still counts; an object's own keys aren't playstyles.
    expect(sanitizeTactics({ playstyles: ["scaredyCat", "constructor", "toString", "chicken", "cruel"] }).playstyles).toEqual(["chicken", "cruel"]);
    // The tick-boxes that became answers read as those answers, while their question is unanswered.
    expect(sanitizeTactics({ neverKill: true }).target).toBe("avoidKilling");
    expect(sanitizeTactics({ avoidKilling: true }).target).toBe("avoidKilling");
    expect(sanitizeTactics({ alwaysTalk: true }).talk).toBe("always");
    expect(sanitizeTactics({ avoidFleeing: true }).retreat).toBe("never");
    expect(sanitizeTactics({ avoidFleeing: true, retreat: "hurt" }).retreat).toBe("hurt");
    expect(sanitizeTactics({ alwaysTalk: true, talk: "opportune" }).talk).toBe("opportune");
    expect(sanitizeTactics({ alwaysTalk: false }).talk).toBeUndefined();
    expect(sanitizeTactics({ alwaysTalk: true }).alwaysTalk).toBeUndefined(); // (no tick-box of its own any more)
  });
});
