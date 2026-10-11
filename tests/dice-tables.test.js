import { describe, expect, test } from "vitest";
import { replay, runBatchSync } from "../scripts/engine/simulator.js";
import { degreeDistribution } from "../scripts/engine/probability.js";
import { parseFormula, part } from "../scripts/engine/dice.js";
import { genericRules } from "../scripts/adapters/generic/rules.js";
import { STATUS } from "../scripts/constants.js";
import { creature, strike, battle } from "./helpers.js";
import { buildStory } from "../scripts/story/story.js";
import { buildEnglishTables } from "../scripts/story/tables-en.js";

/**
 * A DCC-like d20 game for the core's own tests: any die for the action, crits from the top of the die (the threat
 * range scaled to it) on a hit, natural 1 (or a wider range) fumbles, crits don't double (tables add instead).
 */
const rules = {
  ...genericRules,
  id: "test-dice-tables",
  degreeOfSuccess(natural, total, dc, kind = "check", die) {
    const faces = die?.faces ?? 20;
    if ( kind === "attack" ) {
      if ( natural <= (die?.fumbleOn ?? 1) ) return 0;
      const threat = natural >= faces - (20 - (die?.critOn ?? 20));
      const hit = natural === faces || total >= dc;
      return hit ? (threat ? 3 : 2) : 1;
    }
    if ( natural === 1 ) return 1;
    return total >= dc ? 2 : 1;
  },
  critical: parts => parts,
  actionDie: (u, n) => u.spec.actionDice?.[n] ?? u.spec.actionDice?.at(-1) ?? 20,
  turn: u => ({ action: u.spec.actionDice?.length ?? 1, move: 30 }),
  costOf: () => ({ action: 1 }),
  onDropped(c) {
    c.status = c.spec.kind === "pc" ? STATUS.DOWN : STATUS.DEAD;
    c.stable = true;
    return c.status;
  }
};

const traits = (tactical = 70) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 20, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const dummy = (extra = {}) => creature({ id: "dummy", side: "hostile", hp: { value: 400, max: 400 }, defenses: { ac: 14, fortitude: 2, reflex: 2, will: 2 },
  actions: [strike({ id: "slap", bonus: 0, damage: [parseFormula("1", "bludgeoning")] })], flags: { fearless: true }, traits: traits(40), ...extra });
const hero = (extra = {}) => creature({ id: "hero", kind: "pc", diesAtZero: false, hp: { value: 300, max: 300 }, traits: traits(70),
  actions: [strike({ id: "sword", bonus: 4, damage: [parseFormula("1d8", "slashing")] })], ...extra });
const events = (spec, type, seeds = 12) => {
  const out = [];
  for ( let s = 1; s <= seeds; s++ ) out.push(...replay(spec, rules, s).log.filter(e => e.type === type));
  return out;
};

describe("dice other than a d20", () => {
  test("the odds follow the die rolled, and a crit threat scales to it", () => {
    const d20 = degreeDistribution(rules, 0, 15, { kind: "attack" });
    const d24 = degreeDistribution(rules, 0, 15, { kind: "attack", faces: 24, critOn: 20 });
    expect(d24[2] + d24[3]).toBeGreaterThan(d20[2] + d20[3]);
    expect(d24[3]).toBeCloseTo(1 / 24, 10); // only the 24 threatens
    expect(degreeDistribution(rules, 0, 15, { kind: "attack", faces: 24, critOn: 19 })[3]).toBeCloseTo(2 / 24, 10);
    expect(degreeDistribution(rules, 0, 15, { kind: "attack", faces: 16, fumbleOn: 2 })[0]).toBeCloseTo(2 / 16, 10);
    expect(d24.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 10);
  });

  test("several action dice: one action each, the first die then the second", () => {
    const giant = hero({ actionDice: [24, 16], actions: [strike({ id: "club", bonus: 2, damage: [parseFormula("1d6", "bludgeoning")] })] });
    const attacks = events(battle([giant, dummy()], { maxRounds: 2 }), "attack", 6).filter(e => e.actorId === "hero");
    const byRound = new Map();
    for ( const e of attacks ) (byRound.get(e.round) ?? byRound.set(e.round, []).get(e.round)).push(e.faces);
    for ( const faces of byRound.values() ) expect(faces.slice(0, 2)).toEqual([24, 16]);
    expect(attacks.every(e => e.natural <= e.faces)).toBe(true);
  });
});

describe("deeds", () => {
  const trip = { id: "trip", label: "Trip", melee: true, tiers: [{ min: 3, outcome: { conditions: { prone: 1 }, label: "knocked down" } }, { min: 5, outcome: { mods: { attack: -4 }, conditions: { prone: 1 }, rounds: 2, label: "sprawling" } }] };
  const warrior = () => hero({ deeds: [trip], actions: [strike({ id: "sword", bonus: 1, deedDie: 6, damage: [parseFormula("1d8", "slashing")] })] });

  test("the deed die adds to the roll and the damage; a deed lands only on a hit with 3 or more", () => {
    const spec = battle([warrior(), dummy()], { maxRounds: 3 });
    const attacks = events(spec, "attack").filter(e => e.actorId === "hero");
    expect(attacks.length).toBeGreaterThan(10);
    for ( const a of attacks ) {
      expect(a.deed).toBeGreaterThanOrEqual(1);
      expect(a.total).toBe(a.natural + 1 + a.deed);
      if ( a.degree >= 2 ) expect(a.damage).toBeGreaterThanOrEqual(1 + a.deed);
    }
    const deeds = events(spec, "deed");
    expect(deeds.some(d => d.success)).toBe(true);
    for ( const d of deeds ) if ( d.success ) expect(d.roll).toBeGreaterThanOrEqual(3);
    expect(deeds.filter(d => d.success && d.roll >= 5).every(d => d.effect === "sprawling")).toBe(true);
  });

  test("the feral don't think of deeds", () => {
    const brute = hero({ traits: traits(5), deeds: [trip], actions: [strike({ id: "sword", bonus: 1, deedDie: 6, damage: [parseFormula("1d8", "slashing")] })] });
    expect(events(battle([brute, dummy()], { maxRounds: 3 }), "deed")).toHaveLength(0);
  });
});

describe("crit and fumble tables", () => {
  const crit = { die: parseFormula("1d4"), mod: 0, rows: [
    { lo: -99, hi: 2, damage: [part([], 10, "slashing")], text: "a deep cut" },
    { lo: 3, hi: 99, damage: [part([], 20, "slashing")], outcome: { mods: { attack: -2 }, rounds: 3, label: "bleeding badly" } }
  ] };
  const fumble = { die: parseFormula("1d4"), mod: 0, rows: [{ lo: -99, hi: 99, outcome: { mods: { ac: -2 }, rounds: 1, label: "off balance" } }] };

  test("a crit rolls on the table: its damage on top of the blow (not doubled), its effect on the foe", () => {
    const killer = hero({ actions: [strike({ id: "sword", bonus: 2, critOn: 15, crit, damage: [parseFormula("1d8", "slashing")] })] });
    const spec = battle([killer, dummy()], { maxRounds: 3 });
    const hits = events(spec, "attack").filter(e => e.crit && e.actorId === "hero");
    expect(hits.length).toBeGreaterThan(3);
    for ( const h of hits ) {
      expect([1, 2, 3, 4]).toContain(h.critRoll);
      expect(h.damage).toBeGreaterThanOrEqual(h.critRoll <= 2 ? 11 : 21);
      expect(h.damage).toBeLessThanOrEqual(h.critRoll <= 2 ? 18 : 28);
    }
    expect(events(spec, "critTable").some(e => e.effect === "bleeding badly")).toBe(true);
    // The odds know the table is worth more than nothing.
    const plain = runBatchSync(battle([hero({ actions: [strike({ id: "sword", bonus: 2, critOn: 15, damage: [parseFormula("1d8", "slashing")] })] }), dummy()], { maxRounds: 3 }), rules, { runs: 200, seed: 3 });
    const tabled = runBatchSync(spec, rules, { runs: 200, seed: 3 });
    expect(tabled.combatants.hero.meanDamage).toBeGreaterThan(plain.combatants.hero.meanDamage * 1.3);
  });

  test("a fumble rolls on the fumbler's own table", () => {
    const clumsy = hero({ fumble, actions: [strike({ id: "sword", bonus: 2, fumbleOn: 8, damage: [parseFormula("1d8", "slashing")] })] });
    const spec = battle([clumsy, dummy()], { maxRounds: 3 });
    const fumbles = events(spec, "fumble");
    expect(fumbles.length).toBeGreaterThan(3);
    expect(fumbles.every(e => e.actorId === "hero" && e.effect === "off balance")).toBe(true);
    expect(events(spec, "attack").filter(e => e.degree === 0).every(e => e.natural <= 8)).toBe(true);
  });
});

describe("riders", () => {
  test("a smite spends from its pool, never more than there is, and hits harder", () => {
    const smite = { id: "smite", label: "Divine Smite", resource: "slot", damage: [parseFormula("2d8", "radiant")], critDouble: true, melee: true };
    const paladin = () => hero({ resources: { slot: 2 }, riders: [smite], tac: { resourceUse: "nova" } });
    const spec = battle([paladin(), dummy()], { maxRounds: 5 });
    for ( let s = 1; s <= 10; s++ ) {
      const r = replay(spec, rules, s);
      const used = r.log.filter(e => e.type === "attack" && e.riders?.includes("Divine Smite"));
      expect(used.length).toBeLessThanOrEqual(2);
      for ( const u of used ) expect(u.damage).toBeGreaterThanOrEqual(3);
    }
    const plain = runBatchSync(battle([hero({ resources: { slot: 2 } }), dummy()], { maxRounds: 5 }), rules, { runs: 200, seed: 5 });
    const smiting = runBatchSync(spec, rules, { runs: 200, seed: 5 });
    expect(smiting.combatants.hero.meanDamage).toBeGreaterThan(plain.combatants.hero.meanDamage + 4);
  });

  test("a rider with a save lays its effect on a failed save (Stunning Strike)", () => {
    const stun = { id: "stun", label: "Stunning Strike", resource: "ki", save: { type: "fortitude", dc: 30 }, onSave: [{ conditions: { incapacitated: 1 }, rounds: 1, label: "stunned" }, { conditions: { incapacitated: 1 }, rounds: 1, label: "stunned" }, null, null], melee: true };
    const monk = hero({ resources: { ki: 3 }, riders: [stun], tac: { resourceUse: "nova" } });
    const used = events(battle([monk, dummy({ actions: [strike({ id: "slap", bonus: 6, damage: [parseFormula("3d10", "bludgeoning")] })] })], { maxRounds: 4 }), "rider");
    expect(used.some(e => e.landed && e.effect === "stunned")).toBe(true);
  });

  test("against fiends a smite does more; only one smite of a group per hit", () => {
    const vs = { id: "smite-fiend", label: "Smite (fiend)", group: "smite", vs: ["fiend"], resource: "slot", damage: [parseFormula("3d8", "radiant")], melee: true };
    const plain = { id: "smite", label: "Smite", group: "smite", resource: "slot", damage: [parseFormula("2d8", "radiant")], melee: true };
    const paladin = () => hero({ resources: { slot: 3 }, riders: [vs, plain], tac: { resourceUse: "nova" } });
    const used = traits => events(battle([paladin(), dummy({ creatureTraits: traits })], { maxRounds: 4 }), "attack").filter(e => e.actorId === "hero" && e.riders?.length);
    const onFiend = used(["fiend"]);
    const onBeast = used(["beast"]);
    expect(onFiend.length).toBeGreaterThan(0);
    expect(onFiend.every(e => e.riders.length === 1 && e.riders[0] === "Smite (fiend)")).toBe(true);
    expect(onBeast.every(e => e.riders.length === 1 && e.riders[0] === "Smite")).toBe(true);
  });

  test("a rider that takes the bonus action: once a turn, and never on someone else's turn", () => {
    const bonusRules = { ...rules, turn: u => ({ action: 2, bonus: 1, move: 30 }) };
    const smite = { id: "smite", label: "Smite", resource: "slot", cost: { bonus: 1 }, damage: [parseFormula("2d8", "radiant")], melee: true };
    const paladin = hero({ resources: { slot: 9 }, riders: [smite], tac: { resourceUse: "nova" } });
    let used = 0;
    for ( let s = 1; s <= 10; s++ ) {
      const r = replay(battle([paladin, dummy()], { maxRounds: 4 }), bonusRules, s);
      const byRound = new Map();
      for ( const e of r.log.filter(x => x.type === "attack" && x.riders?.includes("Smite")) ) byRound.set(e.round, (byRound.get(e.round) ?? 0) + 1);
      for ( const n of byRound.values() ) expect(n).toBe(1);
      used += byRound.size;
    }
    expect(used).toBeGreaterThan(5);
  });

  test("a die mends a close miss (Precision Attack)", () => {
    const precision = { id: "precision", label: "Precision Attack", when: "miss", attackDie: 8, resource: "sup" };
    const fighter = hero({ resources: { sup: 4 }, riders: [precision], tac: { resourceUse: "nova" } });
    const mends = events(battle([fighter, dummy()], { maxRounds: 4 }), "rider", 20);
    expect(mends.length).toBeGreaterThan(0);
    expect(mends.some(e => e.made)).toBe(true);
    expect(mends.every(e => e.roll >= 1 && e.roll <= 8)).toBe(true);
  });
});

describe("checks with results by tier (spell checks)", () => {
  const missile = { id: "mm", name: "Magic Missile", kind: "auto", range: { increment: 150 }, casting: { mod: 1, lostOnFail: true, label: "spell check" },
    damage: [parseFormula("1d4+1", "force")], castChance: 0.5,
    tiers: [{ min: 12, damage: [part([], 1, "force")] }, { min: 14, damage: [parseFormula("1d4+1", "force")] }, { min: 20, damage: [parseFormula("1d6+1", "force")], repeat: parseFormula("1d4+2") }] };
  const wizard = () => hero({ actions: [missile], hp: { value: 300, max: 300 } });

  test("the total picks the tier; a failure loses the spell for the rest of the fight", () => {
    const spec = battle([wizard(), dummy()], { maxRounds: 6 });
    for ( let s = 1; s <= 15; s++ ) {
      const r = replay(spec, rules, s);
      const casts = r.log.filter(e => e.type === "cast");
      const lostAt = casts.findIndex(e => !e.success);
      if ( lostAt >= 0 ) {
        expect(casts[lostAt].lost).toBe(true);
        expect(casts.length).toBe(lostAt + 1); // never cast again
      }
      for ( const c of casts.filter(e => e.success) ) {
        expect(c.total).toBeGreaterThanOrEqual(12);
        expect(c.tier).toBe(c.total >= 20 ? 2 : c.total >= 14 ? 1 : 0);
        const dealt = r.log[r.log.indexOf(c) + 1];
        expect(dealt.type).toBe("auto");
        if ( c.tier === 0 ) expect(dealt.damage).toBe(1);
        if ( c.tier === 2 ) expect(dealt.damage).toBeGreaterThanOrEqual(6); // 3+ missiles of 2+ each
      }
    }
  });

  test("a cleric's failures widen its disapproval, and a natural within it fails", () => {
    const smite = { ...missile, id: "smite", name: "Holy Bolt", casting: { mod: 1, disapproval: 1 } };
    const priest = hero({ id: "priest", actions: [smite] });
    const casts = events(battle([priest, dummy()], { maxRounds: 8 }), "cast", 10);
    const failures = casts.filter(e => !e.success);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every(e => !e.lost)).toBe(true);
    for ( const f of failures ) expect(f.disapproval).toBeGreaterThanOrEqual(2);
    for ( const c of casts.filter(e => e.disapproved) ) expect(c.natural).toBeLessThanOrEqual(c.disapproval - 1);
  });

  test("the story tells a lost spell", () => {
    const english = buildEnglishTables();
    const tables = { get: k => english[k] };
    for ( let s = 1; s <= 30; s++ ) {
      const r = replay(battle([wizard(), dummy()], { maxRounds: 6 }), rules, s);
      if ( !r.log.some(e => e.type === "cast" && e.lost) ) continue;
      const told = buildStory(r, battle([wizard(), dummy()]), "statistician", { tables }).text;
      expect(told).toMatch(/spell lost/);
      const prose = buildStory(r, battle([wizard(), dummy()]), "roleplay", { tables, seed: s }).text;
      expect(prose).toMatch(/Magic Missile/);
      return;
    }
    throw new Error("no lost spell in 30 fights");
  });
});

describe("burning Luck", () => {
  const blast = { id: "blast", name: "Death Blast", kind: "save", save: { type: "fortitude", dc: 18, basic: false }, damage: [part([], 500, "fire")], range: { increment: 100 }, uses: 1 };
  const lich = () => dummy({ id: "lich", actions: [blast, strike({ id: "slap", bonus: 0, damage: [parseFormula("1", "bludgeoning")] })], initiative: { mod: 30 }, traits: traits(90) });

  test("a save against death: Luck is burned to make it, and it's gone for good", () => {
    let burned = 0;
    for ( let s = 1; s <= 30; s++ ) {
      const r = replay(battle([hero({ defenses: { ac: 12, fortitude: 4, reflex: 2, will: 2 }, boosts: [{ pool: "luck", label: "Luck" }], resources: { luck: 12 } }), lich()], { maxRounds: 2 }), rules, s);
      const b = r.log.find(e => e.type === "boost");
      if ( !b ) continue;
      burned += 1;
      expect(b.to).toBe(b.from + b.spent);
      expect(b.made).toBe(true);
      expect(r.units.hero.status).not.toBe(STATUS.DEAD);
    }
    expect(burned).toBeGreaterThan(5);
  });

  test("a thief rolls its luck die for each point; a friend may spend on another's roll", () => {
    const thief = hero({ defenses: { ac: 12, fortitude: 4, reflex: 2, will: 2 }, boosts: [{ pool: "luck", label: "Luck", faces: 3, recovers: true }], resources: { luck: 12 } });
    const rolls = events(battle([thief, lich()], { maxRounds: 2 }), "boost", 30);
    expect(rolls.length).toBeGreaterThan(3);
    for ( const b of rolls ) expect(b.to - b.from).toBeGreaterThanOrEqual(b.spent);
    const victim = hero({ id: "victim", defenses: { ac: 12, fortitude: 4, reflex: 2, will: 2 } });
    const halfling = hero({ id: "halfling", hp: { value: 900, max: 900 }, boosts: [{ pool: "luck", label: "Luck", per: 2, allies: 1, recovers: true }], resources: { luck: 14 }, traits: { ...traits(70), selfish: { base: 0, fudge: 0 } } });
    const lichOnVictim = () => lich({ actions: [blast] });
    const forOthers = events(battle([victim, halfling, lichOnVictim()], { maxRounds: 1 }), "boost", 40).filter(e => e.targetId === "victim");
    expect(forOthers.some(e => !e.self && e.actorId === "halfling")).toBe(true);
  });
});

describe("after the fight", () => {
  test("rolling the body: a fallen friend may turn out to be alive", () => {
    const body = {
      ...rules,
      onDropped(c) { c.status = STATUS.DEAD; return c.status; },
      recoverBody(u, rng) {
        const roll = rng.die(20);
        if ( roll > (u.spec.luck ?? 10) ) return `stays dead (d20 ${roll})`;
        u.status = STATUS.STANDING;
        u.hp = 1;
        return `was only unconscious (d20 ${roll})`;
      }
    };
    const victim = hero({ id: "victim", luck: 18, hp: { value: 1, max: 10 }, initiative: { mod: -10 } });
    const friend = hero({ id: "friend", hp: { value: 300, max: 300 }, initiative: { mod: 20 } });
    const foe = dummy({ hp: { value: 4, max: 4 }, initiative: { mod: 10 }, actions: [strike({ id: "stab", bonus: 30, damage: [parseFormula("5", "piercing")] })] });
    let alive = 0;
    let rolled = 0;
    for ( let s = 1; s <= 30; s++ ) {
      const r = replay(battle([victim, friend, foe], { maxRounds: 5 }), body, s);
      const e = r.log.find(x => x.type === "body");
      if ( !e ) continue;
      rolled += 1;
      if ( e.alive ) {
        alive += 1;
        expect(r.units.victim.final.hp).toBe(1);
      }
    }
    expect(rolled).toBeGreaterThan(5);
    expect(alive).toBeGreaterThan(0);
  });

  test("a heal of the target's own hit dice (Lay on Hands)", () => {
    const layOnHands = { id: "loh", name: "Lay on Hands", kind: "heal", healDice: 2, reach: 5 };
    const priest = hero({ id: "priest", actions: [strike({ id: "mace", bonus: 0 }), layOnHands] });
    const hurt = hero({ id: "hurt", hp: { value: 5, max: 100 }, hitDie: 10 });
    const heals = events(battle([priest, hurt, dummy()], { maxRounds: 2 }), "heal", 10).filter(e => e.targetId === "hurt");
    expect(heals.length).toBeGreaterThan(0);
    for ( const h of heals ) {
      expect(h.amount).toBeGreaterThanOrEqual(2);
      expect(h.amount).toBeLessThanOrEqual(20);
    }
  });
});
