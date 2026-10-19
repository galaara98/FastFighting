/**
 * Animalistic creatures (behavior/animal.js): they fight as real animals do, a hyena, a tiger, an alligator. Instinct,
 * not a plan; prey drive, bystanders too; the nearest, the hurt, the small and the lone; hurt, they break off; a pack
 * holds its nerve together; no words, no latch.
 */
import { describe, expect, test } from "vitest";
import { beginRun, prepareBattle, replay } from "../scripts/engine/simulator.js";
import { liveTier } from "../scripts/engine/battle-state.js";
import { isAnimalistic, animalTactics, bystanderUrge, BYSTANDER_URGE } from "../scripts/engine/behavior/animal.js";
import { seemsFoe } from "../scripts/engine/behavior/neutral.js";
import { think, rankedDesires } from "../scripts/engine/behavior/desire.js";
import { tacticFits } from "../scripts/engine/tactics.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";
import { scoreTargets } from "../scripts/engine/behavior/targeting.js";
import { moraleStress } from "../scripts/engine/behavior/morale.js";
import { doorPlan } from "../scripts/engine/behavior/doors.js";
import { TACTICAL } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const minded = (tactical, brave = 50) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: brave, fudge: 0 }, selfish: { base: 60, fudge: 0 }, loyal: { base: 50, fudge: 0 } });
const hyena = (id, over = {}) => creature({ id, name: id, side: "hostile", animalistic: true, traits: minded(70), speeds: { walk: 40 }, flags: { packTactics: true }, ...over });
const begin = (combatants, options = {}, sides = null) => beginRun(prepareBattle(battle(combatants, { positioning: true, maxRounds: 4, ...options }, sides), pf2eRules), 1, { log: true });

describe("what an animal is", () => {
  test("its spec's say, or an older helper's flags.beast", () => {
    expect(isAnimalistic({ spec: { animalistic: true } })).toBe(true);
    expect(isAnimalistic({ spec: { flags: { beast: true } } })).toBe(true);
    expect(isAnimalistic({ spec: { animalistic: false, flags: { beast: true } } })).toBe(false);
    expect(isAnimalistic({ spec: {} })).toBe(false);
  });

  test("it reads the fight, it doesn't plan one: never above instinctive, however sharp its numbers", () => {
    const run = begin([hyena("h"), creature({ id: "hero", position: at(30) })]);
    expect(liveTier(run, run.byId.get("h"))).toBe(TACTICAL.INSTINCTIVE);
  });

  test("its tactics: no words, breaks off hurt, eats what it brings down, hunts on; a swimmer keeps to its water", () => {
    expect(animalTactics({ speeds: { walk: 40 } })).toMatchObject({ talk: "never", retreat: "hurt", fallen: "finish", beyond: "hunt", shield: "never" });
    expect(animalTactics({ speeds: { walk: 20, swim: 30 }, flags: { fearless: true } })).toMatchObject({ retreat: "never", beyond: "stay" });
  });

  test("the GM's answers and its playstyles' come first; its own fill the rest", () => {
    const run = begin([hyena("h", { tactics: { retreat: "never" } }), creature({ id: "hero", position: at(30) })]);
    expect(run.byId.get("h").tac).toMatchObject({ retreat: "never", talk: "never", fallen: "finish" });
  });
});

describe("prey", () => {
  test("the bystander urge: an animal or a feral mind nearly always, the dim now and then, the Cruel and the chaotic as they are", () => {
    const u = (spec = {}) => ({ spec });
    expect(bystanderUrge(u({ animalistic: true }), TACTICAL.INSTINCTIVE)).toBeCloseTo(BYSTANDER_URGE.animal);
    expect(bystanderUrge(u(), TACTICAL.FERAL)).toBeCloseTo(BYSTANDER_URGE.feral);
    expect(bystanderUrge(u(), TACTICAL.INSTINCTIVE)).toBeCloseTo(BYSTANDER_URGE.instinctive);
    expect(bystanderUrge(u(), TACTICAL.COMPETENT)).toBe(0);
    expect(bystanderUrge(u({ playstyles: ["cruel"] }), TACTICAL.MASTERMIND)).toBeCloseTo(BYSTANDER_URGE.cruel);
    expect(bystanderUrge(u({ playstyles: ["wildcard", "instigator"] }), TACTICAL.COMPETENT)).toBeCloseTo(1 - (1 - BYSTANDER_URGE.wildcard) * (1 - BYSTANDER_URGE.instigator));
    // (The party's own, and a companion, are kept in hand: only their playstyles count.)
    expect(bystanderUrge({ side: "friendly", spec: { animalistic: true } }, TACTICAL.FERAL)).toBe(0);
    expect(bystanderUrge({ side: "hostile", spec: { animalistic: true, flags: { masterId: "druid" } } }, TACTICAL.FERAL)).toBe(0);
    expect(bystanderUrge({ side: "friendly", spec: { playstyles: ["cruel"] } }, TACTICAL.COMPETENT)).toBeCloseTo(BYSTANDER_URGE.cruel);
  });

  test("a bystander it can make out is prey to an animal; never to a competent mind with no such nature", () => {
    let preyed = 0;
    for ( let seed = 1; seed <= 20; seed++ ) {
      const run = beginRun(prepareBattle(battle([
        hyena("h", { position: at(0) }), creature({ id: "hero", position: at(200) }), creature({ id: "farmer", side: "neutralParty", position: at(20) })
      ], { positioning: true, maxRounds: 4 }), pf2eRules), seed, { log: true });
      const farmer = run.units.find(o => o.spec.id === "farmer");
      if ( seemsFoe(run, run.byId.get("h"), farmer) ) preyed += 1;
    }
    expect(preyed).toBeGreaterThan(12);
    const run = begin([creature({ id: "guard", position: at(0), traits: minded(50) }), creature({ id: "hero", position: at(200) }), creature({ id: "farmer", side: "neutralParty", position: at(20) })]);
    expect(seemsFoe(run, run.byId.get("guard"), run.units.find(o => o.spec.id === "farmer"))).toBe(false);
  });

  test("of two in reach, the hurt and the lone one first; whatever just hurt it, before all", () => {
    const run = begin([
      hyena("h", { position: at(0) }),
      creature({ id: "fresh", position: at(5), hp: { value: 20, max: 20 } }), creature({ id: "guarded", position: at(10, 0) }),
      creature({ id: "hurt", position: at(0, 5), hp: { value: 4, max: 20 } })
    ]);
    const h = run.byId.get("h");
    expect(scoreTargets(run, h)[0].t.id).toBe("hurt");
    h.lastAttackerId = "fresh";
    expect(scoreTargets(run, h)[0].t.id).toBe("fresh");
  });
});

describe("a pack, and the wild", () => {
  test("a pack animal is steadier with its pack about it, shakier alone", () => {
    const pack = begin([hyena("h", { position: at(0) }), hyena("h2", { position: at(10) }), hyena("h3", { position: at(0, 10) }), creature({ id: "hero", position: at(60) })]);
    const alone = begin([hyena("h", { position: at(0) }), hyena("h2", { position: at(200) }), creature({ id: "hero", position: at(60) })]);
    expect(moraleStress(pack, pack.byId.get("h"))).toBeLessThan(moraleStress(alone, alone.byId.get("h")));
  });

  test("no lock picked: a door is forced or broken", () => {
    const run = begin([hyena("h", { doorWork: { pick: { mod: 30 }, force: { mod: 0 } } }), creature({ id: "hero", position: at(30) })]);
    const plan = doorPlan(run, run.byId.get("h"), { id: "d", ac: 10, forceDC: 20, pickDC: 15 }, { hp: 20, locked: true });
    expect(plan?.method).not.toBe("pick");
  });

  test("in a whole fight, hyenas fall on the bystanders they can see when no other foe is in sight", () => {
    let bitten = 0;
    for ( let seed = 1; seed <= 8; seed++ ) {
      const r = replay(battle([
        hyena("h1", { position: at(0) }), hyena("h2", { position: at(5, 5) }),
        creature({ id: "hero", position: at(400), traits: minded(50) }),
        creature({ id: "farmer", side: "neutralParty", position: at(30), hp: { value: 30, max: 30 } })
      ], { positioning: true, maxRounds: 3 }), pf2eRules, seed);
      if ( r.log.some(e => e.type === "attack" && /^h\d/.test(e.actorId ?? "") && e.targetId === "farmer") ) bitten += 1;
    }
    expect(bitten).toBeGreaterThan(4);
  });

  test("a bystander not in the encounter yet, that it takes for prey or was set on, is something it can act on", () => {
    const run = begin([
      hyena("h1", { position: at(0) }),
      creature({ id: "hero", position: at(400), traits: minded(50) }),
      creature({ id: "farmer", side: "neutralParty", position: at(20), inEncounter: false })
    ]);
    const h = run.byId.get("h1");
    const farmer = run.byId.get("farmer");
    expect(farmer.active).toBe(false);
    // (The GM's say: go for the farmer. Not in the fight yet, it's still something the hyena can act on.)
    think(h, "hurt", "farmer", 70);
    expect(seemsFoe(run, h, farmer)).toBe(true);
    expect(rankedDesires(run, h).some(d => d.kind === "hurt" && d.targetId === "farmer")).toBe(true);
    // (A competent guard with no such nature, the farmer no foe of its, doesn't count it.)
    const calm = begin([
      creature({ id: "guard", position: at(0), traits: minded(50) }),
      creature({ id: "hero", position: at(400) }),
      creature({ id: "farmer", side: "neutralParty", position: at(20), inEncounter: false })
    ]);
    expect(rankedDesires(calm, calm.byId.get("guard")).some(d => d.targetId === "farmer")).toBe(false);
  });
});

describe("a playstyle's fighting style, only where it fits", () => {
  test("a Chicken with nothing to shoot isn't told to fight at range; one with a bow is", () => {
    const jaws = { actions: [{ id: "jaws", kind: "strike", melee: true, damage: [{}] }, { id: "demoralize", kind: "control", range: { increment: 30 } }] };
    const archer = { actions: [{ id: "bow", kind: "strike", range: { increment: 60 }, damage: [{}] }] };
    expect(tacticFits("style", "ranged", jaws)).toBe(false);
    expect(tacticFits("style", "ranged", archer)).toBe(true);
    expect(combinePlaystyles(["chicken"], { fits: (k, v) => tacticFits(k, v, jaws) }).suggest.style).toBeUndefined();
    expect(combinePlaystyles(["chicken"], { fits: (k, v) => tacticFits(k, v, archer) }).suggest.style).toBe("ranged");
    // (Not a style question: anyone fits.)
    expect(tacticFits("retreat", "hurt", jaws)).toBe(true);
  });
});
