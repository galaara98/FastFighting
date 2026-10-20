/**
 * API 23: aptitudes, a hidden judgment each helper makes in its own game's terms (spec.aptitudes: smart, strong, fast,
 * wise, charismatic, 0 to 4), and the first desires that weigh them.
 *  - Aptitudes (engine/aptitudes.js): the helper's numbers, kept within 0 to 4; unsaid, the core's own reading (smart 0
 *    for the mindless and the animalistic, else 2; the rest 2).
 *  - Focus fire (behavior/focus.js): nothing until its team has hit a foe; then a foe already hit is far likelier to be
 *    the one it goes for, the more so the more tactical (from 40, not dumb), fully for a pack hunter; never past what
 *    it's taunted into or told to want; a leader who wants it sways its followers half as much again.
 *  - Keeping together (behavior/together.js): the tactical and smart dampen wishes that would take them well away from
 *    their team, and would rather not stand bunched up beside a teammate unless the two flank their foe.
 */
import { describe, expect, test } from "vitest";
import { CORE_API, CORE_API_VERSION, APTITUDES, APTITUDE_MOST, APTITUDE_AVERAGE } from "../scripts/core-api.js";
import { aptitude, notDumb } from "../scripts/engine/aptitudes.js";
import { beginRun, beginRound, prepareBattle, replay } from "../scripts/engine/simulator.js";
import { liveTrait } from "../scripts/engine/battle-state.js";
import { newTurn, think, levelOf, listen, remember, orderAgenda, LEADER_SWAY } from "../scripts/engine/behavior/desire.js";
import { focusFire, focusWants, focusAgenda, alreadyHit, FOCUS } from "../scripts/engine/behavior/focus.js";
import { keepsTogether, keepTogether, apartShare, TOGETHER } from "../scripts/engine/behavior/together.js";
import { crowdCost, spotWithin, CROWD } from "../scripts/engine/behavior/space.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const traitsAt = tactical => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 60, fudge: 0 }, selfish: { base: 40, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
const tough = { value: 200, max: 200 };
const foe = (id, x, y = 0, extra = {}) => creature({ id, name: id, side: "hostile", traits: traitsAt(50), hp: tough, actions: [strike({ bonus: -50 })], ...at(x, y), ...extra });
const friend = (id, x, y = 0, extra = {}) => creature({ id, name: id, traits: traitsAt(50), hp: tough, actions: [strike({ bonus: -50 })], ...at(x, y), ...extra });

/** A run on a map, everyone in the fight, round 1 begun. */
function scene(list, options = {}, sides = null) {
  const spec = battle(list, { maxRounds: 3, positioning: true, aftermath: "none", morale: false, talking: false, adhd: 0, ...options }, sides);
  const run = beginRun(prepareBattle(spec, pf2eRules), 5, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}
/** t hurt by `by` (its harm noted, as a blow notes it). */
const hurt = (run, t, by, n = 10) => {
  const u = run.byId.get(t);
  u.hp -= n;
  u.harmedBy.set(by, (u.harmedBy.get(by) ?? 0) + n);
};

test("the API is 23 or later, major.bug", () => {
  expect(CORE_API.major).toBeGreaterThanOrEqual(23);
  expect(CORE_API_VERSION).toBe(`${CORE_API.major}.${CORE_API.bug}`);
});

describe("aptitudes", () => {
  test("five of them, 0 to 4, 2 the middle", () => {
    expect(APTITUDES).toEqual(["smart", "strong", "fast", "wise", "charismatic"]);
    expect(APTITUDE_MOST).toBe(4);
    expect(APTITUDE_AVERAGE).toBe(2);
  });

  test("the helper's say, kept within 0 to 4 (fractions too)", () => {
    const u = { spec: { aptitudes: { smart: 3.5, strong: 9, fast: -2, wise: "1" } } };
    expect(aptitude(u, "smart")).toBe(3.5);
    expect(aptitude(u, "strong")).toBe(4);
    expect(aptitude(u, "fast")).toBe(0);
    expect(aptitude(u, "wise")).toBe(1);
    // (Unsaid: average.)
    expect(aptitude(u, "charismatic")).toBe(2);
  });

  test("unsaid, the core's own reading: the mindless and the animalistic dumb, anyone else average", () => {
    expect(aptitude({ spec: {} }, "smart")).toBe(2);
    expect(aptitude({ spec: { social: { mindless: true } } }, "smart")).toBe(0);
    expect(aptitude({ spec: { flags: { mindless: true } } }, "smart")).toBe(0);
    expect(aptitude({ spec: { animalistic: true } }, "smart")).toBe(0);
    expect(aptitude({ spec: { animalistic: true } }, "strong")).toBe(2);
    expect(notDumb({ spec: { animalistic: true } })).toBe(false);
    expect(notDumb({ spec: { animalistic: true, aptitudes: { smart: 1 } } })).toBe(true);
  });

  test("plain data: a worker gets them as they are", () => {
    const spec = battle([friend("me", 0, 0, { aptitudes: { smart: 3, strong: 1 } }), foe("a", 10)]);
    expect(structuredClone(spec).combatants[0].aptitudes).toEqual({ smart: 3, strong: 1 });
  });
});

describe("focus fire", () => {
  const two = (me = {}, extra = []) => scene([friend("me", 0, 0, { traits: traitsAt(80), ...me }), friend("ally", 0, 10), foe("a", 10), foe("b", 0, -10), ...extra]);

  test("who has it: the tactical from 40 who aren't dumb, as tactical as they are; any pack hunter, fully", () => {
    const run = scene([
      friend("keen", 0, 0, { traits: traitsAt(90) }), friend("dull", 5, 0, { traits: traitsAt(10) }),
      friend("dumb", 10, 0, { traits: traitsAt(90), aptitudes: { smart: 0 } }), friend("pack", 15, 0, { traits: traitsAt(5), aptitudes: { smart: 0 }, flags: { packTactics: true } }),
      foe("a", 40)
    ]);
    const keen = run.byId.get("keen");
    expect(focusFire(run, keen)).toBeCloseTo(liveTrait(run, keen, "tactical") / 100);
    expect(focusFire(run, run.byId.get("dull"))).toBe(0);
    expect(focusFire(run, run.byId.get("dumb"))).toBe(0);
    expect(focusFire(run, run.byId.get("pack"))).toBe(1);
  });

  test("playstyles that like it add to it, whatever the Tactical or the wits: a Cruel one most", () => {
    const pills = ids => ({ playstyles: ids, desireStyle: combinePlaystyles(ids).desire });
    const run = scene([
      friend("cruel", 0, 0, { traits: traitsAt(20), aptitudes: { smart: 0 }, ...pills(["cruel"]) }), friend("merc", 5, 0, { traits: traitsAt(20), ...pills(["mercenary"]) }),
      friend("keen", 10, 0, { traits: traitsAt(90), ...pills(["cruel", "peoplePleaser"]) }), friend("dull", 15, 0, { traits: traitsAt(20), ...pills(["brawler"]) }),
      foe("a", 40)
    ]);
    expect(focusFire(run, run.byId.get("cruel"))).toBeCloseTo(0.6);
    expect(focusFire(run, run.byId.get("merc"))).toBeCloseTo(0.4);
    expect(focusFire(run, run.byId.get("keen"))).toBe(1);
    expect(focusFire(run, run.byId.get("dull"))).toBe(0);
  });

  test("the world's Non Player Focus Fire Dampener: those not on the friendly side less, half at 100", () => {
    const list = () => [friend("pc", 0, 0, { traits: traitsAt(80) }), foe("orc", 20, 0, { traits: traitsAt(80) }), foe("wolf", 25, 0, { flags: { packTactics: true } })];
    const plain = scene(list());
    const damped = scene(list(), { focusDampener: 100 });
    const half = scene(list(), { focusDampener: 50 });
    const f = (run, id) => focusFire(run, run.byId.get(id));
    expect(f(damped, "pc")).toBeCloseTo(f(plain, "pc"));
    expect(f(damped, "orc")).toBeCloseTo(f(plain, "orc") * 0.5);
    expect(f(half, "orc")).toBeCloseTo(f(plain, "orc") * 0.75);
    expect(f(damped, "wolf")).toBeCloseTo(0.5);
  });

  test("nothing until its team has hit someone; then the foe already hit, past the one it would have picked", () => {
    const run = two();
    const u = run.byId.get("me");
    const scored = ["a", "b"].map(id => ({ t: run.byId.get(id) }));
    newTurn(u);
    think(u, "hurt", "a", 55);
    think(u, "hurt", "b", 30);
    focusWants(run, u, scored);
    expect(u.desire.focus.size).toBe(0);
    // (Its friend hits b: b now, but no more than FOCUS.over past the one it wanted most.)
    hurt(run, "b", "ally");
    expect(alreadyHit(run, u, run.byId.get("b"))).toBe(true);
    expect(alreadyHit(run, u, run.byId.get("a"))).toBe(false);
    focusWants(run, u, scored);
    expect(levelOf(u, "hurt", "b")).toBeGreaterThan(levelOf(u, "hurt", "a"));
    expect(levelOf(u, "hurt", "b")).toBeLessThanOrEqual(55 + FOCUS.over);
    // (Hit by a foe's own side, or by nobody of its team: nothing.)
    const other = two();
    hurt(other, "b", "a");
    expect(alreadyHit(other, other.byId.get("me"), other.byId.get("b"))).toBe(false);
  });

  test("the most hurt the most; a dumb one not at all", () => {
    const run = two({}, [foe("c", 20)]);
    const u = run.byId.get("me");
    newTurn(u);
    think(u, "hurt", "a", 10);
    think(u, "hurt", "b", 10);
    think(u, "hurt", "c", 60);
    hurt(run, "a", "ally", 10);
    hurt(run, "b", "ally", 100);
    focusWants(run, u, ["a", "b", "c"].map(id => ({ t: run.byId.get(id) })));
    expect(u.desire.focus.get("hurt|b")).toBeGreaterThan(u.desire.focus.get("hurt|a"));
    const dull = two({ aptitudes: { smart: 0 } });
    const d = dull.byId.get("me");
    newTurn(d);
    think(d, "hurt", "a", 20);
    hurt(dull, "a", "ally");
    focusWants(dull, d, [{ t: dull.byId.get("a") }]);
    expect(d.desire.focus.size).toBe(0);
  });

  test("never past a foe it's taunted into, or told to want", () => {
    const run = two();
    const u = run.byId.get("me");
    newTurn(u);
    think(u, "hurt", "b", 30);
    u.desire.taunt.set("hurt|a", 60);
    hurt(run, "b", "ally", 100);
    focusWants(run, u, ["a", "b"].map(id => ({ t: run.byId.get(id) })));
    expect(levelOf(u, "hurt", "b")).toBeLessThan(levelOf(u, "hurt", "a"));
  });

  test("one that keeps at what it's doing switches to a foe already hit as readily as it focuses", () => {
    const switches = tactical => {
      let n = 0;
      for ( let seed = 1; seed <= 40; seed++ ) {
        const run = two({ traits: traitsAt(tactical) });
        run.rng = { chance: p => (seed % 40) / 40 < p };
        const u = run.byId.get("me");
        newTurn(u);
        u.desire.stated.set("hurt|a", 40);
        orderAgenda(run, u);
        u.desire.stated.clear();
        think(u, "hurt", "a", 40);
        think(u, "hurt", "b", 35);
        hurt(run, "b", "ally");
        focusWants(run, u, ["a", "b"].map(id => ({ t: run.byId.get(id) })));
        orderAgenda(run, u);
        focusAgenda(run, u);
        if ( u.agenda[0] === "hurt|b" ) n++;
      }
      return n / 40;
    };
    // (Competent: about as often as its Tactical; below 40, never.)
    expect(switches(55)).toBeGreaterThan(0.3);
    expect(switches(55)).toBeLessThan(0.7);
    expect(switches(20)).toBe(0);
  });

  test("a leader who wants it sways its followers half as much again for it", () => {
    const sides = { friendly: { label: "Party", enemies: ["hostile"], leaderId: "boss" }, hostile: { label: "Foes", enemies: ["friendly"] } };
    const pull = hit => {
      const run = scene([friend("boss", 0, 10, { traits: traitsAt(80) }), friend("me", 0, 0, { traits: traitsAt(20) }), foe("a", 10), foe("b", 0, -10)], { leadership: true }, sides);
      const boss = run.byId.get("boss");
      const u = run.byId.get("me");
      if ( hit ) hurt(run, "b", "boss");
      newTurn(boss);
      think(boss, "hurt", "b", 60);
      remember(run, boss);
      newTurn(u);
      listen(run, u, {});
      return u.desire.social.get("hurt|b") ?? 0;
    };
    const plain = pull(false);
    expect(plain).toBeGreaterThan(0);
    expect(pull(true)).toBeCloseTo(plain * FOCUS.leader);
    expect(LEADER_SWAY).toBeGreaterThan(0);
  });

  test("in a fight: a tactical one goes for the foe its friend has been hitting, far more than a dull one", () => {
    // (Its friend hits b first, every round; a is as good a target, a little nearer.)
    const onB = tactical => {
      let n = 0;
      let all = 0;
      for ( let seed = 1; seed <= 12; seed++ ) {
        const spec = battle([
          friend("me", 0, 0, { traits: traitsAt(tactical), initiative: { mod: -20 }, actions: [strike({ bonus: -50 })] }),
          friend("ally", 30, 30, { initiative: { mod: 50 }, actions: [strike({ name: "Bow", melee: false, reach: undefined, range: { increment: 200, max: 600 }, bonus: 40 })], desires: [{ kind: "hurt", targetId: "b", level: 95 }] }),
          foe("a", 10, 0, { initiative: { mod: -50 } }), foe("b", 0, 12, { initiative: { mod: -50 } })
        ], { maxRounds: 3, positioning: true, aftermath: "none", morale: false, talking: false });
        const log = replay(spec, pf2eRules, seed).log.filter(e => e.type === "attack" && e.actorId === "me");
        n += log.filter(e => e.targetId === "b").length;
        all += log.length;
      }
      return n / Math.max(1, all);
    };
    expect(onB(90)).toBeGreaterThan(onB(10) + 0.25);
  });
});

describe("keeping together", () => {
  test("who: tactical from 60 with average wits, from 40 with high ones; never an animal, the mindless, or off the map", () => {
    const run = scene([
      friend("sixty", 0, 0, { traits: traitsAt(80) }), friend("fifty", 5, 0, { traits: traitsAt(55) }),
      friend("sage", 10, 0, { traits: traitsAt(55), aptitudes: { smart: 3 } }), friend("beast", 15, 0, { traits: traitsAt(90), animalistic: true }),
      friend("zombie", 20, 0, { traits: traitsAt(90), social: { mindless: true, languages: [] } }), foe("a", 60)
    ]);
    expect(keepsTogether(run, run.byId.get("sixty"))).toBe(true);
    expect(keepsTogether(run, run.byId.get("fifty"))).toBe(false);
    expect(keepsTogether(run, run.byId.get("sage"))).toBe(true);
    expect(keepsTogether(run, run.byId.get("beast"))).toBe(false);
    expect(keepsTogether(run, run.byId.get("zombie"))).toBe(false);
    const off = scene([friend("sixty", 0, 0, { traits: traitsAt(80) }), foe("a", 60)], { positioning: false });
    expect(keepsTogether(off, off.byId.get("sixty"))).toBe(false);
  });

  test("how much less: nothing within a Stride or toward the team; a quarter, a tenth more each Stride past the second, at most 45%", () => {
    expect(apartShare(20, 0, 25)).toBe(0);
    expect(apartShare(40, 0, 25)).toBeCloseTo(TOGETHER.damp);
    expect(apartShare(70, 0, 25)).toBeCloseTo(TOGETHER.damp + TOGETHER.perStride);
    expect(apartShare(500, 0, 25)).toBe(TOGETHER.most);
    expect(apartShare(60, 80, 25)).toBe(0);
  });

  test("a wish that would take it well away from its team is dampened, not dropped; one beside the team isn't", () => {
    const run = scene([friend("me", 0, 0, { traits: traitsAt(80) }), friend("mate", 0, 5), foe("far", 120), foe("near", 0, -10)]);
    const u = run.byId.get("me");
    newTurn(u);
    think(u, "hurt", "far", 60);
    think(u, "hurt", "near", 50);
    keepTogether(run, u);
    expect(u.together).toBe(true);
    expect(levelOf(u, "hurt", "far")).toBeCloseTo(60 * (1 - TOGETHER.most));
    expect(levelOf(u, "hurt", "near")).toBe(50);
    // (Not one that doesn't keep together.)
    const dull = scene([friend("me", 0, 0, { traits: traitsAt(30) }), friend("mate", 0, 5), foe("far", 120)]);
    const d = dull.byId.get("me");
    newTurn(d);
    think(d, "hurt", "far", 60);
    keepTogether(dull, d);
    expect(levelOf(d, "hurt", "far")).toBe(60);
  });

  test("bunched up beside a teammate costs a spot more, unless the two flank the foe", () => {
    const run = scene([friend("me", -20, 0, { traits: traitsAt(80) }), friend("mate", -5, 0), foe("t", 0, 0)]);
    const u = run.byId.get("me");
    const t = run.byId.get("t");
    const crowd = crowdCost(u, [run.byId.get("mate")], t);
    // (Beside its mate, diagonally too, off to one side of the foe: crowded. Across the foe from it: flanking, free.)
    expect(crowd({ x: -5, y: -5 })).toBe(CROWD.feet);
    expect(crowd({ x: 0, y: -5 })).toBe(CROWD.feet);
    expect(crowd({ x: 5, y: 0 })).toBe(0);
    // (The nearest spot beside the foe is beside its mate too: one that keeps together goes round a little.)
    const plain = spotWithin(run, u, t, 5);
    const spread = spotWithin(run, u, t, 5, u.pos, crowd);
    expect(crowd(plain)).toBeGreaterThan(0);
    expect(crowd(spread)).toBe(0);
  });

  test("in a fight: smart ones end their moves bunched up less often", () => {
    const bunched = tactical => {
      let n = 0;
      for ( let seed = 1; seed <= 10; seed++ ) {
        const party = [0, 1, 2, 3].map(i => friend(`p${i}`, -40, i * 5 - 7.5, { traits: traitsAt(tactical), initiative: { mod: 10 - i } }));
        const spec = battle([...party, foe("t", 0, 0, { size: 3, position: { x: 0, y: 0, size: 15 } }), foe("u", 0, 25)], { maxRounds: 1, positioning: true, aftermath: "none", morale: false, talking: false });
        const run = replay(spec, pf2eRules, seed);
        const end = new Map();
        for ( const e of run.log ) if ( e.type === "move" && e.to ) end.set(e.actorId, e.to);
        const spots = [...end.values()];
        for ( let i = 0; i < spots.length; i++ ) for ( let j = i + 1; j < spots.length; j++ ) if ( Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y) <= 5.5 ) n++;
      }
      return n;
    };
    expect(bunched(85)).toBeLessThan(bunched(30));
  });
});
