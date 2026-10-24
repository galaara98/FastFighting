import { describe, expect, test } from "vitest";
import { runBatchSync, replay, prepareBattle } from "../scripts/engine/simulator.js";
import { createRun } from "../scripts/engine/battle-state.js";
import { combineMods, diceMean } from "../scripts/engine/mods.js";
import { degreeDistribution, rollCheck } from "../scripts/engine/probability.js";
import { createRng } from "../scripts/engine/rng.js";
import { applyOutcome, beginConcentration, endConcentration } from "../scripts/engine/behavior/effects.js";
import { combinePlaystyles, PLAYSTYLE_IDS } from "../scripts/engine/playstyles.js";
import { STATUS } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";
import { buildStory } from "../scripts/story/story.js";
import { storyTables, text } from "./foundry-i18n.js";
import { logLine } from "../scripts/story/log-lines.js";

const english = storyTables();
const tables = { get: k => english[k] };
const traits = (tactical = 70) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const brute = (extra = {}) => creature({
  id: "brute", side: "hostile", hp: { value: 150, max: 150 }, defenses: { ac: 18, fortitude: 8, reflex: 6, will: 2 },
  actions: [strike({ id: "maul", bonus: 12, damage: [parseFormula("2d8+6", "bludgeoning")] })], flags: { fearless: true }, traits: traits(40), ...extra
});
const fighter = id => creature({ id, kind: "pc", diesAtZero: false, hp: { value: 120, max: 120 }, traits: traits(60),
  actions: [strike({ id: `${id}-sword`, bonus: 7, damage: [parseFormula("1d10+5", "slashing")] })] });
const bless = { id: "bless", name: "Bless", kind: "buff", cost: 2, aura: 30, resource: "slot", outcome: { mods: { attack: 1 }, rounds: 10, label: "blessed" } };
const cleric = (actions = [bless], extra = {}) => creature({ id: "cleric", kind: "pc", diesAtZero: false, hp: { value: 120, max: 120 }, traits: traits(70), resources: { slot: 2 },
  actions: [strike({ id: "mace", bonus: 3, damage: [parseFormula("1d6", "bludgeoning")] }), ...actions], ...extra });

describe("bonuses and penalties", () => {
  test("the best bonus and the worst penalty count; advantage and disadvantage cancel; junk is ignored", () => {
    const m = combineMods([{ attack: 1, ac: 2 }, { attack: 2, ac: -1 }, { attackDie: 4 }, { attackDie: -4 }, { adv: 1 }, { adv: -1 }, { bogus: 5, attack: "lots" }, null, 7]);
    expect(m).toEqual({ attack: 2, ac: 1, attackDie: [4, -4] });
    expect(diceMean([4])).toBe(2.5);
    expect(diceMean([4, -4])).toBe(0);
  });

  test("a die that rides along shifts the odds exactly (Bless's d4)", () => {
    const with4 = degreeDistribution(pf2eRules, 5, 20, { kind: "attack", dice: [4] });
    const by = [1, 2, 3, 4].map(n => degreeDistribution(pf2eRules, 5 + n, 20, { kind: "attack" }));
    for ( let d = 0; d < 4; d++ ) expect(with4[d]).toBeCloseTo(by.reduce((s, x) => s + x[d], 0) / 4, 10);
    const rng = createRng(3);
    for ( let i = 0; i < 50; i++ ) {
      const r = rollCheck(pf2eRules, rng, 5, 20, { dice: [4] });
      expect(r.die).toBeGreaterThanOrEqual(1);
      expect(r.die).toBeLessThanOrEqual(4);
      expect(r.total).toBe(r.natural + 5 + r.die);
    }
  });
});

describe("buffs", () => {
  test("a thinking cleric blesses the party first, once, and the party hits harder for it", () => {
    const party = () => [cleric(), fighter("f1"), fighter("f2"), fighter("f3")];
    const r = replay(battle([...party(), brute()], { maxRounds: 4 }), pf2eRules, 5);
    const buffs = r.log.filter(e => e.type === "buff");
    expect(buffs).toHaveLength(1);
    expect(buffs[0].round).toBe(1);
    expect(buffs[0].targetIds).toEqual(expect.arrayContaining(["cleric", "f1", "f2", "f3"]));
    const hits = (spec, n = 400) => {
      const res = runBatchSync(spec, pf2eRules, { runs: n, seed: 11 });
      return ["f1", "f2", "f3"].reduce((s, id) => s + res.combatants[id].meanDamage, 0);
    };
    const without = hits(battle([cleric([]), fighter("f1"), fighter("f2"), fighter("f3"), brute()], { maxRounds: 4 }));
    const blessed = hits(battle([...party(), brute()], { maxRounds: 4 }));
    expect(blessed).toBeGreaterThan(without * 1.03);
  });

  test("feral minds only ever look after themselves", () => {
    const self = { ...bless, id: "rage", name: "Rage", aura: undefined, resource: undefined, outcome: { mods: { attack: 2, damage: 2 }, rounds: 10, label: "raging" } };
    for ( let s = 1; s <= 20; s++ ) {
      const r = replay(battle([cleric([self], { traits: traits(5) }), fighter("f1"), brute()], { maxRounds: 3 }), pf2eRules, s);
      for ( const e of r.log.filter(x => x.type === "buff") ) expect(e.targetIds).toEqual(["cleric"]);
    }
  });

  test("its desires show it: the cleric wants to bolster its friends", () => {
    const r = replay(battle([cleric(), fighter("f1"), fighter("f2"), brute()], { maxRounds: 1 }), pf2eRules, 2);
    const thought = r.log.find(e => e.type === "thought" && e.actorId === "cleric");
    expect(thought.desires.some(d => d.kind === "aid")).toBe(true);
  });

  test("the story tells it", () => {
    const spec = battle([cleric(), fighter("f1"), fighter("f2"), brute()], { maxRounds: 2 });
    const r = replay(spec, pf2eRules, 5);
    const prose = buildStory(r, spec, "roleplay", { tables, seed: 5 }).text;
    expect(prose).toMatch(/Bless/);
    expect(prose).not.toMatch(/\{\w+\}/);
    expect(buildStory(r, spec, "statistician").text).toMatch(/cleric → self, f1, f2: Bless · blessed|cleric → .*Bless · blessed/);
  });
});

describe("debuffs", () => {
  const bane = { id: "bane", name: "Bane", kind: "control", cost: 2, save: { type: "will", dc: 22 }, range: { increment: 30, max: 30, noPenalty: true }, melee: false,
    onSave: [{ mods: { attack: -3, ac: -3 }, rounds: 10, label: "weakened" }, { mods: { attack: -2, ac: -2 }, rounds: 10, label: "weakened" }, null, null] };

  test("weakening a heavy hitter cuts the damage it does", () => {
    const damageTaken = actions => {
      const res = runBatchSync(battle([cleric(actions, { resources: {} }), fighter("f1"), brute()], { maxRounds: 4 }), pf2eRules, { runs: 400, seed: 3 });
      return res.combatants.brute.meanDamage;
    };
    expect(damageTaken([bane])).toBeLessThan(damageTaken([]) * 0.95);
  });

  test("a mark adds to its maker's hits, and only theirs", () => {
    const mark = { id: "mark", name: "Hunter's Mark", kind: "control", cost: 1, auto: true, range: { increment: 90, max: 90, noPenalty: true }, melee: false,
      outcome: { mark: [parseFormula("1d6", "piercing")], rounds: 10, label: "marked" } };
    const ranger = creature({ id: "ranger", kind: "pc", diesAtZero: false, hp: { value: 200, max: 200 }, traits: traits(70),
      actions: [strike({ id: "bow", bonus: 9, melee: false, range: { increment: 100, max: 600 }, damage: [parseFormula("1d8+3", "piercing")] }), mark] });
    const r = replay(battle([ranger, brute()], { maxRounds: 4 }), pf2eRules, 4);
    expect(r.log.some(e => e.type === "control" && e.action === "Hunter's Mark" && e.roll === "auto" && e.took)).toBe(true);
    const prep = prepareBattle(battle([ranger, brute(), fighter("f1")]), pf2eRules);
    const run = createRun(prep);
    const [u, b] = run.units;
    applyOutcome(b, mark.outcome, u.id, mark);
    expect(b.marks).toHaveLength(1);
    expect(b.marks[0].by).toBe("ranger");
  });

  test("a skill against a defense DC: Demoralize, once per target", () => {
    const demoralize = { id: "demoralize", name: "Demoralize", kind: "control", cost: 1, check: { mod: 30, against: "will" }, oncePerTarget: true, range: { increment: 30, max: 30, noPenalty: true }, melee: false,
      traits: ["mental", "fear"], onHit: [null, null, { conditions: { frightened: 1 }, rounds: 1, label: "frightened 1" }, { conditions: { frightened: 2 }, rounds: 2, label: "frightened 2" }] };
    const r = replay(battle([cleric([demoralize]), brute()], { maxRounds: 5 }), pf2eRules, 1);
    const tries = r.log.filter(e => e.type === "control" && e.action === "Demoralize");
    expect(tries).toHaveLength(1);
    expect(tries[0].roll).toBe("check");
    expect(tries[0].dc).toBe(12); // 10 + Will 2
    expect(tries[0].took).toBe(true);
  });

  test("a Demoralize is words too: an intimidation at its target, at its degree, no roll of its own; botched, it offends", () => {
    const demoralize = mod => ({ id: "demoralize", name: "Demoralize", kind: "control", cost: 1, check: { mod, against: "will" }, oncePerTarget: true, range: { increment: 30, max: 30, noPenalty: true }, melee: false,
      traits: ["mental", "fear"], onHit: [null, null, { conditions: { frightened: 1 }, rounds: 1, label: "frightened 1" }, { conditions: { frightened: 2 }, rounds: 2, label: "frightened 2" }] });
    const r = replay(battle([cleric([demoralize(30)]), brute()], { maxRounds: 5 }), pf2eRules, 1);
    const tried = r.log.find(e => e.type === "control" && e.action === "Demoralize");
    const talked = r.log.find(e => e.type === "talk" && e.kind === "intimidate");
    expect(talked).toMatchObject({ actorId: tried.actorId, targetId: tried.targetId, degree: tried.degree, total: tried.total, dc: tried.dc });
    expect(talked.progress).toBeGreaterThan(0);
    // (Botched: the target takes offense at the one who tried.)
    let botched = null;
    for ( let seed = 1; seed <= 60 && !botched; seed++ ) {
      const b = replay(battle([cleric([demoralize(0)]), brute()], { maxRounds: 5 }), pf2eRules, seed);
      if ( b.log.some(e => e.type === "control" && e.action === "Demoralize" && e.degree === 0) ) botched = b.log.find(e => e.type === "talk" && e.kind === "intimidate");
    }
    expect(botched).toMatchObject({ degree: 0, offended: true });
  });

  test("a botched Trip lands its user on the floor", () => {
    const trip = { id: "trip", name: "Trip", kind: "control", cost: 1, check: { mod: -30, against: "reflex", attack: true }, melee: true, reach: 5,
      onHit: [{ conditions: { prone: 1 }, self: true, rounds: 1, label: "prone" }, null, { conditions: { prone: 1 }, rounds: 1, label: "prone" }, { conditions: { prone: 1 }, rounds: 1, label: "prone" }] };
    const clumsy = creature({ id: "clumsy", kind: "pc", diesAtZero: false, hp: { value: 200, max: 200 }, traits: traits(10), actions: [trip] });
    const r = replay(battle([clumsy, brute()], { maxRounds: 2 }), pf2eRules, 1);
    const botched = r.log.find(e => e.type === "control" && e.backfired);
    expect(botched).toBeDefined();
    expect(r.log.some(e => e.type === "stand" && e.actorId === "clumsy")).toBe(true);
  });

  test("a repeat save shakes an effect off", () => {
    const hold = { id: "hold", name: "Hold Person", kind: "control", cost: 2, save: { type: "will", dc: 40 }, range: { increment: 60, max: 60, noPenalty: true }, melee: false,
      onSave: [{ conditions: { paralyzed: 1 }, rounds: 10, label: "paralyzed", repeatSave: { type: "will", dc: 12 } }, { conditions: { paralyzed: 1 }, rounds: 10, label: "paralyzed", repeatSave: { type: "will", dc: 12 } }, null, null] };
    const r = replay(battle([cleric([hold]), brute()], { maxRounds: 6 }), pf2eRules, 2);
    expect(r.log.some(e => e.type === "control" && e.took)).toBe(true);
    expect(r.log.some(e => e.type === "shakeOff" && e.actorId === "brute")).toBe(true);
  });

  test("the instigator gets really into it; a few others lean that way", () => {
    expect(combinePlaystyles(["instigator"]).behavior.hinders).toBe(1);
    const leaning = PLAYSTYLE_IDS.filter(id => id !== "instigator" && combinePlaystyles([id]).behavior.hinders);
    expect(leaning.sort()).toEqual(["cruel", "daredevil", "leader", "puzzleManiac", "wallflower"]);
    for ( const id of leaning ) expect(combinePlaystyles([id]).behavior.hinders).toBeLessThanOrEqual(0.3);
    // A jinx worth about 60% of a sword stroke: what does each open the fight with?
    const slowSpell = { id: "jinx", name: "Jinx", kind: "control", cost: 1, save: { type: "fortitude", dc: 15 }, range: { increment: 30, max: 30, noPenalty: true }, melee: false,
      onSave: [{ mods: { attack: -2 }, rounds: 2, label: "jinxed" }, { mods: { attack: -2 }, rounds: 2, label: "jinxed" }, null, null] };
    const opensWithIt = behavior => {
      let n = 0;
      for ( let s = 1; s <= 30; s++ ) {
        const caster = creature({ id: "c", kind: "pc", diesAtZero: false, hp: { value: 300, max: 300 }, traits: traits(60), behavior,
          actions: [strike({ id: "blade", bonus: 10, damage: [parseFormula("1d8+4", "slashing")] }), slowSpell] });
        const first = replay(battle([caster, brute()], { maxRounds: 1 }), pf2eRules, s).log.find(e => e.actorId === "c" && (e.type === "control" || e.type === "attack"));
        if ( first?.type === "control" ) n += 1;
      }
      return n;
    };
    expect(opensWithIt(combinePlaystyles(["instigator"]).behavior)).toBeGreaterThanOrEqual(25);
    expect(opensWithIt({})).toBeLessThanOrEqual(5);
    // An affinity tips it now and then at most.
    expect(opensWithIt(combinePlaystyles(["wallflower"]).behavior)).toBeLessThan(25);
  });
});

describe("charmed and dominated", () => {
  const dominate = { id: "dominate", name: "Dominate", kind: "control", cost: 2, concentration: true, save: { type: "will", dc: 40 }, range: { increment: 60, max: 60, noPenalty: true }, melee: false,
    onSave: [{ conditions: { controlled: 1 }, rounds: 10, label: "dominated", repeatSave: { type: "will", dc: 14 } }, { conditions: { controlled: 1 }, rounds: 10, label: "dominated", repeatSave: { type: "will", dc: 14 } }, null, null] };
  const twoBrutes = () => [brute(), brute({ id: "brute2", name: "brute2" })];

  test("a dominated creature turns on its own side, then comes back to itself", () => {
    let turned = 0;
    let back = 0;
    let struckFriend = 0;
    for ( let s = 1; s <= 10; s++ ) {
      const mage = cleric([dominate], { hp: { value: 400, max: 400 } });
      const r = replay(battle([mage, ...twoBrutes()], { maxRounds: 8 }), pf2eRules, s);
      const flip = r.log.find(e => e.type === "allegiance" && e.joined);
      if ( !flip ) continue;
      turned += 1;
      const after = r.log.slice(r.log.indexOf(flip) + 1);
      const home = after.findIndex(e => e.type === "allegiance" && !e.joined && e.actorId === flip.actorId);
      const while_ = home < 0 ? after : after.slice(0, home);
      if ( while_.some(e => e.actorId === flip.actorId && e.type === "attack" && ["brute", "brute2"].includes(e.targetId)) ) struckFriend += 1;
      expect(while_.some(e => e.actorId === flip.actorId && e.type === "attack" && e.targetId === "cleric")).toBe(false);
      if ( home >= 0 ) back += 1;
      // It still belongs to its own side when the fight is told.
      expect(r.units[flip.actorId].final.side).toBe("hostile");
    }
    expect(turned).toBeGreaterThan(5);
    expect(struckFriend).toBeGreaterThan(0);
    expect(back).toBeGreaterThan(0);
  });

  test("a charm breaks when its caster's side harms the charmed", () => {
    const charm = { ...dominate, id: "charm", name: "Charm", concentration: false,
      onSave: [{ conditions: { controlled: 1 }, rounds: 100, label: "charmed", endsOnHarm: true }, { conditions: { controlled: 1 }, rounds: 100, label: "charmed", endsOnHarm: true }, null, null] };
    const run = createRun(prepareBattle(battle([cleric([charm]), fighter("f1"), brute()]), pf2eRules));
    const [c, , b] = run.units;
    applyOutcome(b, charm.onSave[0], c.id, charm);
    expect(b.controlledBy).toBe("cleric");
  });
});

describe("concentration", () => {
  const rules = { ...pf2eRules, concentration: { save: "fortitude", dc: dmg => Math.max(10, Math.floor(dmg / 2)), breaksOn: ["paralyzed"] } };
  const shield = { id: "sof", name: "Shield of Faith", kind: "buff", cost: 1, concentration: true, range: { increment: 60, max: 60 }, outcome: { mods: { ac: 2 }, rounds: 10, label: "shielded" } };
  const heroism = { id: "heroism", name: "Heroism", kind: "buff", cost: 1, concentration: true, range: { increment: 60, max: 60 }, outcome: { mods: { attack: 1 }, rounds: 10, label: "heroic" } };

  test("one thing at a time: starting another ends the first", () => {
    const run = createRun(prepareBattle(battle([cleric([shield, heroism]), fighter("f1"), brute()]), rules));
    const [c, f] = run.units;
    beginConcentration(run, c, shield);
    applyOutcome(f, shield.outcome, c.id, shield);
    expect(f.mods.ac).toBe(2);
    const ended = beginConcentration(run, c, heroism);
    expect(ended).toEqual(["shielded"]);
    expect(f.mods.ac).toBeUndefined();
    applyOutcome(f, heroism.outcome, c.id, heroism);
    expect(endConcentration(run, c)).toEqual(["heroic"]);
    expect(f.mods).toEqual({});
  });

  test("a blow can break it, and whatever it held ends", () => {
    let broke = 0;
    for ( let s = 1; s <= 20; s++ ) {
      const caster = cleric([shield], { defenses: { ac: 10, fortitude: -5, reflex: 0, will: 0 }, hp: { value: 400, max: 400 }, resources: {} });
      const r = replay(battle([caster, fighter("f1"), brute()], { maxRounds: 4 }), rules, s);
      const lost = r.log.find(e => e.type === "concentrationEnd" && e.reason === "blow");
      if ( !lost ) continue;
      broke += 1;
      expect(lost.effects).toEqual(["shielded"]);
    }
    expect(broke).toBeGreaterThan(0);
  });
});

describe("a system that has none of it", () => {
  // The least a system can give the core: no concentration, no skill DCs, no condition numbers, no reactions.
  const bare = {
    id: "bare",
    degreeOfSuccess: (natural, total, dc) => (total >= dc ? 2 : 1),
    attackPenalty: () => 0,
    applyIwr: (iwr, byType) => Object.values(byType).reduce((s, v) => s + Math.max(0, v), 0),
    onDropped(u) { u.status = STATUS.DEAD; },
    onHealed(u, n) { u.hp = Math.min(u.maxHp, u.hp + n); },
    persistentFlatCheck: rng => rng.chance(0.5)
  };
  const junk = [
    { id: "j1", name: "Odd Buff", kind: "buff", cost: 1, outcome: { mods: { attack: "lots", bogus: 3, ac: NaN }, rounds: "forever" } },
    { id: "j2", name: "Empty Buff", kind: "buff", cost: 1 },
    { id: "j3", name: "Word Buff", kind: "buff", cost: 1, outcome: "nonsense" },
    { id: "j4", name: "Luck Check", kind: "control", cost: 1, check: { mod: "high", against: "luck" }, onHit: [null, null, { mods: { saves: -1 }, label: "jinxed" }, null] },
    { id: "j5", name: "Blank Mark", kind: "control", cost: 1, auto: true, outcome: { mark: [], repeatSave: { type: "none" } } },
    { id: "j6", name: "Self Hex", kind: "buff", cost: 1, targets: "self", concentration: true, outcome: { mods: { adv: 1, speed: 10, actions: 1 }, tempHp: "5", rounds: 2, label: "hexed" } }
  ];

  test("it all runs, and the story still reads", () => {
    const a = creature({ id: "a", hp: { value: 40, max: 40 }, actions: [strike(), ...junk], traits: traits(70) });
    const b = creature({ id: "b", side: "hostile", hp: { value: 40, max: 40 }, actions: [strike(), ...junk], traits: traits(70) });
    const spec = battle([a, b], { maxRounds: 6 });
    expect(() => runBatchSync(spec, bare, { runs: 60 })).not.toThrow();
    const r = replay(spec, bare, 3);
    for ( const style of ["roleplay", "standard", "statistician"] ) expect(() => buildStory(r, spec, style, { tables, seed: 3 })).not.toThrow();
  });
});

describe("asking a friend for a buff", () => {
  const heroism = { id: "heroism", name: "Heroism", kind: "buff", cost: 2, resource: "slot", outcome: { mods: { attack: 1 }, rounds: 10, label: "heroic" } };
  const speaks = (languages = ["common"]) => ({ pitches: {}, resist: {}, languages });
  const asker = (extra = {}) => ({ ...fighter("f2"), social: speaks(), desires: [{ kind: "bolstered", targetId: "cleric", level: 70 }], ...extra });
  const firstBuff = (party, seed = 3) => replay(battle([...party, brute()], { maxRounds: 2 }), pf2eRules, seed).log.find(e => e.type === "buff");
  const healer = (extra = {}) => cleric([heroism], { social: speaks(), ...extra });

  test("a friend who can understand it, and is willing, bolsters the one who asked", () => {
    // Unasked, two alike fighters: the first gets it.
    expect(firstBuff([healer(), { ...fighter("f1"), social: speaks() }, { ...fighter("f2"), social: speaks() }]).targetIds).toEqual(["f1"]);
    const asked = firstBuff([healer(), { ...fighter("f1"), social: speaks() }, asker()]);
    expect(asked.targetIds).toEqual(["f2"]);
    expect(asked.askedBy).toEqual(["f2"]);
  });

  test("no roll, but no language in common, or no will to help, and nothing comes of it", () => {
    const strangers = firstBuff([healer(), { ...fighter("f1"), social: speaks() }, asker({ social: speaks(["elvish"]) })]);
    expect(strangers.targetIds).toEqual(["f1"]);
    expect(strangers.askedBy).toEqual([]);
    const selfish = { tactical: { base: 70, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 95, fudge: 0 }, loyal: { base: 5, fudge: 0 } };
    expect(firstBuff([healer({ traits: selfish }), { ...fighter("f1"), social: speaks() }, asker()])?.askedBy ?? []).toEqual([]);
  });

  test("asking isn't something the asker acts on, and the story tells the call", () => {
    const spec = battle([healer(), { ...fighter("f1"), social: speaks() }, asker(), brute()], { maxRounds: 2 });
    const r = replay(spec, pf2eRules, 3);
    for ( const e of r.log.filter(x => x.type === "thought" && x.actorId === "f2") ) expect(e.desires.some(d => d.kind === "bolstered")).toBe(false);
    expect(r.log.some(e => e.type === "thought" && e.actorId === "cleric" && e.desires.some(d => d.kind === "aid" && d.targetId === "f2"))).toBe(true);
    const asked = r.log.find(e => e.type === "buff" && e.askedBy?.includes("f2"));
    expect(asked).toMatchObject({ action: "Heroism", effect: "heroic" });
    expect(logLine(asked)).toContain(text("FASTFIGHTING.Log.AskedBy", { names: "f2" }));
    expect(buildStory(r, spec, "statistician").text).toContain(logLine(asked));
    const prose = buildStory(r, spec, "roleplay", { tables, seed: 3 }).text;
    expect(prose).toMatch(/Heroism/);
    expect(prose).not.toMatch(/\{\w+\}/);
  });
});
