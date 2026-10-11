import { describe, expect, test } from "vitest";
import { replay, prepareBattle } from "../scripts/engine/simulator.js";
import { createRun, turnFor } from "../scripts/engine/battle-state.js";
import { createRng } from "../scripts/engine/rng.js";
import { initDesires } from "../scripts/engine/behavior/desire.js";
import { spotTraps, keepClear, inDanger, stepOut } from "../scripts/engine/behavior/traps.js";
import { PLAYSTYLES } from "../scripts/engine/playstyles.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle, strike } from "./helpers.js";

const quiet = { pitches: {}, resist: {}, languages: [] };
const at = (x, y) => ({ x, y, size: 5 });

/** A spinning blade pillar (melee, every round) on the enemy's side. */
const pillar = (position, over = {}) => creature({
  id: "trap", name: "Blade Pillar", side: "hostile", kind: "hazard", hazard: { once: false }, untargetable: true, speeds: {},
  social: { mindless: true, languages: [], pitches: {}, resist: {} }, flags: { fearless: true, mindless: true }, position,
  actions: [strike({ id: "blade", name: "Blade", bonus: 14 })], ...over
});
const hero = (over = {}) => creature({ id: "hero", kind: "pc", diesAtZero: false, hp: { value: 200, max: 200, temp: 0 }, social: quiet, position: at(0, 0), ...over });
const goblin = (position, over = {}) => creature({ id: "goblin", side: "hostile", hp: { value: 60, max: 60, temp: 0 }, social: quiet, position, traits: { tactical: { base: 50, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } }, speeds: { walk: 0 }, ...over });
const wary = { behavior: { trapWary: 1 } };

/** One logged fight on the map: how often the pillar struck the hero, and the trap avoider's thoughts. */
function fight(combatants, seed, trapLuck) {
  const r = replay(battle(combatants, { positioning: true, talking: false, morale: false, maxRounds: 4, trapLuck }), pf2eRules, seed);
  return { struck: r.log.filter(e => e.actorId === "trap" && e.targetId === "hero").length, traps: r.log.filter(e => e.type === "trap") };
}

describe("trap avoiders", () => {
  test("who they are: Thief, Puzzle-Maniac, Lore-Collector, Skeptic, Wallflower, Chicken", () => {
    const wary = Object.entries(PLAYSTYLES).filter(([, p]) => p.behavior?.trapWary).map(([id]) => id).sort();
    expect(wary).toEqual(["chicken", "loreCollector", "puzzleManiac", "skeptic", "thief", "wallflower"]);
    // Some watch a great deal, some a little: a Thief most, a Wallflower least.
    const by = id => PLAYSTYLES[id].behavior.trapWary;
    expect(["thief", "puzzleManiac", "skeptic", "loreCollector", "chicken", "wallflower"].map(by)).toEqual([1, 0.9, 0.75, 0.6, 0.5, 0.35]);
  });

  test("the luck check is the setting times how watchful it is: a Thief spots far more often than a Wallflower", () => {
    const spots = trapWary => {
      let n = 0;
      for ( let seed = 1; seed <= 200; seed++ ) n += fight([hero({ behavior: { trapWary } }), goblin(at(60, 0)), pillar(at(40, 30))], seed, 100).traps.filter(e => e.what === "spots").length;
      return n / 200;
    };
    const thief = spots(1);
    const wallflower = spots(0.35);
    expect(thief).toBe(1);
    expect(wallflower).toBeGreaterThan(0.25);
    expect(wallflower).toBeLessThan(0.45);
  });

  test("one that spots the hazard (the luck check) goes around it; one that doesn't walks into its reach", () => {
    // The goblin waits 30 ft off; the pillar stands beside the straight way to it.
    let spotted = 0;
    let missed = 0;
    for ( let seed = 1; seed <= 12; seed++ ) {
      const careful = fight([hero(wary), goblin(at(30, 0)), pillar(at(25, 5))], seed, 100);
      expect(careful.traps.some(e => e.what === "spots" && e.actorId === "hero")).toBe(true);
      spotted += careful.struck;
      missed += fight([hero(wary), goblin(at(30, 0)), pillar(at(25, 5))], seed, 0).struck;
    }
    expect(missed).toBeGreaterThan(0);
    expect(spotted).toBeLessThan(missed / 3);
  });

  test("anyone a hazard goes for, hit or miss, knows that hazard from then on, trap avoider or not", () => {
    let gone = 0;
    for ( let seed = 1; seed <= 10; seed++ ) {
      const { traps, struck } = fight([hero(), goblin(at(30, 0)), pillar(at(25, 5))], seed, 0);
      const learned = traps.filter(e => e.what === "learns" && e.actorId === "hero");
      // (Once it has gone for the hero, the hero knows it: once.)
      expect(learned).toHaveLength(struck ? 1 : 0);
      if ( struck ) gone++;
      if ( struck ) expect(learned[0].targetId).toBe("trap");
    }
    expect(gone).toBeGreaterThan(0);
  });

  test("someone who isn't a trap avoider never spots it, whatever the luck", () => {
    const { traps, struck } = fight([hero(), goblin(at(30, 0)), pillar(at(25, 5))], 3, 100);
    expect(traps.filter(e => e.what === "spots")).toEqual([]);
    expect(struck).toBeGreaterThan(0);
  });

  /** A fight set up but not begun: the hero has spotted the pillar (luck 100). */
  function setUp(combatants, seed = 1) {
    const run = createRun(prepareBattle(battle(combatants, { positioning: true, talking: false, trapLuck: 100 }), pf2eRules));
    run.rng = createRng(seed);
    run.round = 1;
    for ( const u of run.units ) initDesires(u);
    spotTraps(run);
    return run;
  }
  /** How badly the hero wants to hurt the goblin, every way a desire can be held. */
  function wanting(u, level) {
    for ( const m of ["logic", "stated", "lean"] ) u.desire[m].set("hurt|goblin", level);
    for ( const m of ["style", "memory", "social", "frustration"] ) u.desire[m].delete("hurt|goblin");
  }

  test("what it's after stands in the hazard's reach: it goes in only for something it wants badly enough", () => {
    // The goblin stands right beside a pillar whose blades reach 10 ft: there's no getting at it from outside.
    const long = at => pillar(at, { actions: [strike({ id: "blade", name: "Blade", bonus: 14, reach: 10 })] });
    const into = { x: 25, y: 0 }; // (beside the goblin, in the blades' reach)
    for ( let seed = 1; seed <= 10; seed++ ) {
      const run = setUp([hero(wary), goblin(at(30, 0)), long(at(30, 5))], seed);
      const [h, g] = ["hero", "goblin"].map(id => run.byId.get(id));
      expect(h.spottedTraps.has("trap")).toBe(true);
      wanting(h, 85); // obsessed: it goes in
      expect(keepClear(run, h, g, into)).toEqual(into);
      run.round = 2;
      wanting(h, 25); // merely wants it: it stays out
      const kept = keepClear(run, h, g, into);
      expect(inDanger(run, h, kept)).toEqual([]);
    }
  });

  test("starting its turn in a hazard's reach, with nobody beside it, it steps out first", () => {
    const run = setUp([hero({ ...wary, position: at(25, 0) }), goblin(at(60, 0)), pillar(at(25, 5))]);
    const h = run.byId.get("hero");
    expect(inDanger(run, h, h.pos).length).toBe(1);
    const turn = turnFor(run, h);
    expect(stepOut(run, h, turn)).toBeGreaterThan(0);
    expect(inDanger(run, h, h.pos)).toEqual([]);
  });
});
