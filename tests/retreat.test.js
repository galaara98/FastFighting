import { describe, expect, test } from "vitest";
import { prepareBattle, replay } from "../scripts/engine/simulator.js";
import { createRun } from "../scripts/engine/battle-state.js";
import { moraleStress, callRetreat, rallies, running, standsGround, checkMorale, MORALE } from "../scripts/engine/behavior/morale.js";
import { attemptTalk, choosePitch, willingToPay } from "../scripts/engine/behavior/talk.js";
import { createRng } from "../scripts/engine/rng.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";
import { initDesires } from "../scripts/engine/behavior/desire.js";
import { STATUS, NEUTRAL_PARTY } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle, social } from "./helpers.js";
import { parseFormula } from "../scripts/engine/dice.js";

const minded = { tactical: { base: 40, fudge: 0 }, brave: { base: 50, fudge: 0 }, selfish: { base: 40, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
const always = { chance: () => true, next: () => 0, die: n => n, d20: () => 20, pick: a => a[0], shuffle: a => a };
const chain = (...ids) => ids.map((id, i) => ({ id, role: i === 0 ? "leader" : "lieutenant", leadership: { brave: 10, tacticalFloor: 40, attack: 0, ac: 0 } }));
const goblin = (id, over = {}) => creature({ id, side: "hostile", traits: minded, social: social(), ...over });
const runOf = (combatants, command = {}) => {
  const run = createRun(prepareBattle({ ...battle(combatants, { leadership: true }), command }, pf2eRules));
  for ( const u of run.units ) initDesires(u);
  run.log = [];
  const say = (unit, data) => run.log.push({ actor: unit.spec.name, ...data });
  return { run, say, by: id => run.byId.get(id) };
};
const band = (extra = []) => runOf([goblin("boss"), goblin("w1"), goblin("w2"), ...extra, creature({ id: "pc", kind: "pc", diesAtZero: false })], { hostile: chain("boss") });

describe("seeing a friend run", () => {
  test("shakes the rest of its group, whatever sent it running (its nerve, or a spell); one of its leaders, more", () => {
    const { run, by } = band();
    const w2 = by("w2");
    by("w1").status = STATUS.FLED;
    by("w1").ranRound = run.round - 5;
    const old = moraleStress(run, w2);
    by("w1").ranRound = run.round;
    expect(running(run, by("w1"))).toBe(true);
    expect(moraleStress(run, w2)).toBeGreaterThan(old + 8);
    // Sent running by magic (still on the field): the same.
    const { run: run2, by: by2 } = band();
    const calm = moraleStress(run2, by2("w2"));
    by2("w1").conds.fleeing = 1;
    expect(running(run2, by2("w1"))).toBe(true);
    expect(moraleStress(run2, by2("w2"))).toBeGreaterThan(calm + 8);
    // Its leader running: harder still.
    const { run: run3, by: by3 } = band();
    by3("boss").conds.fleeing = 1;
    expect(moraleStress(run3, by3("w2"))).toBeGreaterThan(moraleStress(run2, by2("w2")));
  });
});

describe("calling a retreat", () => {
  test("one who commands calls it, and its group falls back with it; never the fearless, nor a player character", () => {
    const { run, by, say } = band([goblin("stubborn", { flags: { fearless: true } }), goblin("hero", { kind: "pc", diesAtZero: false })]);
    run.rng = always;
    const r = callRetreat(run, by("boss"), say);
    expect(r.commander.id).toBe("boss");
    expect(r.followers.map(a => a.id).sort()).toEqual(["w1", "w2"]);
    expect(run.log.some(e => e.type === "retreat" && e.what === "call")).toBe(true);
  });

  test("anyone else has to talk its commander into it; refusing, the commander orders it to hold, and it may", () => {
    const { run, by, say } = band();
    run.rng = always;
    const agreed = callRetreat(run, by("w1"), say);
    expect(agreed.followers[0].id).toBe("boss"); // (the commander leads it)
    expect(agreed.followers.map(a => a.id)).toContain("w2");
    // A steady commander mostly refuses; told to hold, a loyal one does.
    const { run: run2, by: by2, say: say2 } = band();
    run2.rng = { ...always, chance: p => p >= 0.3 };
    const refused = callRetreat(run2, by2("w1"), say2);
    expect(refused.followers).toEqual([]);
    expect(refused.held).toBe(true);
    expect(run2.log.some(e => e.type === "retreat" && e.what === "refused")).toBe(true);
  });

  test("talked into leaving, a commander takes its group with it", () => {
    const { run, by, say } = runOf([goblin("boss"), goblin("w1"), goblin("w2"), creature({ id: "monk", side: NEUTRAL_PARTY, originSide: "neutral", social: social({ diplomacy: 30 }) }), creature({ id: "pc", kind: "pc", diesAtZero: false })], { hostile: chain("boss") });
    run.rng = always;
    const monk = by("monk");
    monk.calming = "leave";
    for ( let i = 0; i < 4 && by("boss").status === STATUS.STANDING; i++ ) attemptTalk(run, monk, { target: by("boss"), kind: "persuade", aim: "leave", mod: 40, dc: 10 }, say);
    expect(by("boss").status).toBe(STATUS.FLED);
    expect(by("w1").status).toBe(STATUS.FLED);
    expect(run.log.some(e => e.type === "flee" && e.retreat && e.actor === "w2")).toBe(true);
  });
});

describe("rallying", () => {
  test("its commander, seeing friends run, holds the rest together: steadier this round and next", () => {
    const { run, by } = band();
    run.rng = always;
    expect(rallies(run, by("boss"))).toBeNull(); // (nothing wrong yet)
    by("w1").status = STATUS.FLED;
    by("w1").ranRound = run.round;
    const before = moraleStress(run, by("w2"));
    expect(rallies(run, by("boss"))?.map(a => a.id)).toEqual(["w2"]);
    expect(moraleStress(run, by("w2"))).toBeLessThan(before - 10);
    expect(rallies(run, by("boss"))).toBeNull(); // (once is enough)
    // Not one shaken itself.
    const { run: run2, by: by2 } = band();
    run2.rng = always;
    by2("w1").wavering = true;
    by2("boss").wavering = true;
    expect(rallies(run2, by2("boss"))).toBeNull();
  });

  test("a rallied group is slower to answer a call to retreat", () => {
    const { run, by } = band();
    by("w2").steadied = run.round;
    run.rng = { ...always, chance: p => p >= 0.15 };
    expect(callRetreat(run, by("boss")).followers.map(a => a.id)).toEqual(["w1"]);
  });
});

describe("in play", () => {
  test("a beaten band falls back together, more often than one by one", () => {
    let together = 0;
    let calls = 0;
    const brute = () => creature({ id: "knight", hp: { value: 120, max: 120 }, initiative: { mod: 30 }, actions: [strike({ bonus: 16, damage: [parseFormula("2d8+10", "slashing")] })] });
    for ( let seed = 1; seed <= 40; seed++ ) {
      const r = replay({ ...battle([brute(), goblin("boss", { traits: { ...minded, brave: { base: 35, fudge: 0 } } }), goblin("w1", { traits: { ...minded, brave: { base: 25, fudge: 0 } } }),
        goblin("w2", { traits: { ...minded, brave: { base: 25, fudge: 0 } } }), goblin("w3", { traits: { ...minded, brave: { base: 25, fudge: 0 } } })], { leadership: true, maxRounds: 6, opening: "fight", talking: false }), command: { hostile: chain("boss") } }, pf2eRules, seed);
      calls += r.log.filter(e => e.type === "retreat" && e.what === "call").length;
      together += r.log.filter(e => e.type === "flee" && e.retreat).length;
    }
    expect(calls).toBeGreaterThan(3);
    expect(together).toBeGreaterThan(calls);
  });
});

describe("leaders and the leaderless", () => {
  const loose = () => runOf([goblin("boss"), goblin("w1"), goblin("w2"), creature({ id: "pc", kind: "pc", diesAtZero: false })], {});

  test("with nobody able to lead it, a group takes a friend's flight harder, and runs together more readily", () => {
    const led = band();
    const free = loose();
    for ( const g of [led, free] ) {
      g.by("w1").status = STATUS.FLED;
      g.by("w1").ranRound = g.run.round;
    }
    expect(moraleStress(free.run, free.by("w2"))).toBeGreaterThan(moraleStress(led.run, led.by("w2")));
    const calm = () => ({ ...always, chance: p => p >= 0.3 });
    const a = band();
    a.run.rng = calm();
    expect(callRetreat(a.run, a.by("boss")).followers).toEqual([]); // (a calm group under a leader: not yet)
    const b = loose();
    b.run.rng = calm();
    expect(callRetreat(b.run, b.by("w1")).followers.map(x => x.id).sort()).toEqual(["boss", "w2"]);
  });

  test("a commander's rally carries more than anyone else's, the more so with a high Leader influence", () => {
    const { run, by } = band([goblin("vet", { traits: { ...minded, brave: { base: 80, fudge: 0 }, loyal: { base: 80, fudge: 0 } } })]);
    run.rng = always;
    by("w1").status = STATUS.FLED;
    by("w1").ranRound = run.round;
    rallies(run, by("vet"));
    const fromVet = by("w2").steadiedBy;
    rallies(run, by("boss")); // (a stronger voice on top of it: it counts)
    expect(by("w2").steadiedBy).toBeGreaterThan(fromVet);
    expect(rallies(run, by("vet"))).toBeNull(); // (a weaker one again: nothing more)
    const second = band();
    second.run.rng = always;
    second.by("w1").status = STATUS.FLED;
    second.by("w1").ranRound = second.run.round;
    rallies(second.run, second.by("boss"));
    expect(second.by("w2").steadiedBy).toBeGreaterThan(fromVet);
    const strong = band();
    strong.run.prep.options.leaderInfluence = 100;
    strong.run.rng = always;
    strong.by("w1").status = STATUS.FLED;
    strong.by("w1").ranRound = strong.run.round;
    rallies(strong.run, strong.by("boss"));
    expect(strong.by("w2").steadiedBy).toBeGreaterThan(second.by("w2").steadiedBy);
  });
});

describe("bosses", () => {
  const bossChain = (...ids) => ids.map((id, i) => ({ id, role: i === 0 ? "boss" : "lieutenant", leadership: { brave: 10, tacticalFloor: 40, attack: 0, ac: 0 } }));
  const gang = (bossOver = {}, extra = [], pcOver = {}) => runOf([goblin("boss", bossOver), goblin("w1"), goblin("w2"), ...extra,
    creature({ id: "pc", kind: "pc", diesAtZero: false, social: social({ diplomacy: 30 }), valuables: { money: 200 }, playstyles: ["diplomat"], ...pcOver })], { hostile: bossChain("boss") });

  test("almost never run (a Chicken, a little more readily)", () => {
    const tally = bossOver => {
      const { run, by } = gang(bossOver);
      run.rng = createRng(3);
      let ran = 0;
      for ( let i = 0; i < 2000; i++ ) if ( !standsGround(run, by("boss")) ) ran += 1;
      return ran / 2000;
    };
    expect(tally()).toBeLessThan(0.08);
    const p = combinePlaystyles(["chicken"]);
    expect(tally({ playstyles: ["chicken"], behavior: p.behavior })).toBeGreaterThan(0.12);
  });

  test("almost never agree to a retreat someone else urges", () => {
    const { run, by } = gang();
    by("boss").hp = 1; // (badly hurt, and still)
    run.rng = { ...always, chance: p => p >= 0.25 };
    expect(callRetreat(run, by("w1")).followers).toEqual([]);
  });

  test("their presence steadies the group, by the Boss influence", () => {
    const shaken = (command, options = {}) => {
      const { run, by } = runOf([goblin("boss"), goblin("w1"), goblin("w2"), creature({ id: "pc", kind: "pc", diesAtZero: false })], command);
      Object.assign(run.prep.options, options);
      by("w1").status = STATUS.FLED;
      by("w1").ranRound = run.round;
      return moraleStress(run, by("w2"));
    };
    expect(shaken({ hostile: bossChain("boss") })).toBeLessThan(shaken({ hostile: chain("boss") }));
    expect(shaken({ hostile: bossChain("boss") }, { bossInfluence: 3 })).toBeLessThan(shaken({ hostile: bossChain("boss") }, { bossInfluence: 1.25 }));
  });

  test("in a standoff, talking a boss round means paying it to go: it leaves with its whole group, and that settles it", () => {
    const { run, by, say } = gang();
    run.standoff = true;
    run.rng = always;
    const pitch = choosePitch(run, by("pc"), { only: o => o.id === "boss" });
    expect(pitch?.target.id).toBe("boss");
    for ( let i = 0; i < 6 && by("boss").status === STATUS.STANDING; i++ ) attemptTalk(run, by("pc"), { target: by("boss"), kind: "persuade", aim: "down", mod: 40, dc: 10 }, say);
    expect(by("boss").status).toBe(STATUS.STOOD_DOWN);
    expect(by("w1").status).toBe(STATUS.STOOD_DOWN);
    expect(by("pc").concessions?.[0]).toMatchObject({ kind: "money", to: "boss", bribe: true });
    expect(by("pc").concessions[0].percent).toBeGreaterThan(10);
    expect(run.resolved?.side).toBe("friendly");
    expect(run.log.some(e => e.outcome === "bribed")).toBe(true);
    // Nobody willing to pay (a bribe isn't a shakedown: a Brawler would sooner fight), or nothing to pay with: it can't
    // be won there at all.
    const proud = gang({}, [], { playstyles: ["brawler", "diplomat"] });
    proud.run.standoff = true;
    expect(willingToPay(proud.run, proud.by("pc"))).toBe(false);
    expect(choosePitch(proud.run, proud.by("pc"), { only: o => o.id === "boss" })).toBeNull();
    const poor = runOf([goblin("boss"), goblin("w1"), creature({ id: "pc", kind: "pc", diesAtZero: false, social: social({ diplomacy: 30 }) })], { hostile: bossChain("boss") });
    poor.run.standoff = true;
    expect(choosePitch(poor.run, poor.by("pc"), { only: o => o.id === "boss" })).toBeNull();
  });

  test("a leader prone to running takes more of its group along", () => {
    const followers = over => {
      const { run, by } = runOf([goblin("boss", over), goblin("w1"), goblin("w2"), goblin("w3"), creature({ id: "pc", kind: "pc", diesAtZero: false })], { hostile: chain("boss") });
      run.rng = { ...always, chance: p => p >= 0.3 };
      return callRetreat(run, by("boss")).followers.length;
    };
    const p = combinePlaystyles(["chicken"]);
    expect(followers()).toBe(0);
    expect(followers({ playstyles: ["chicken"], behavior: p.behavior })).toBe(3);
  });
});

describe("a character's retreat answer shapes its morale", () => {
  const timid = { ...minded, brave: { base: 10, fudge: 0 } };
  const hero = retreat => {
    const { run, by } = runOf([creature({ id: "pc", kind: "pc", diesAtZero: false, traits: timid }), goblin("orc")]);
    const pc = by("pc");
    pc.tac = { retreat };
    run.rng = always;
    return { run, pc };
  };

  test("short of what it said it retreats at, its nerve is rolled as anyone's", () => {
    const { run, pc } = hero("hurt");
    pc.hp = Math.round(pc.maxHp * 0.4); // hurt, not badly
    expect(checkMorale(run, pc)).toBe(MORALE.ROUT);
  });

  test("past it, it goes whatever the roll", () => {
    const { run, pc } = hero("hurt");
    pc.hp = Math.round(pc.maxHp * 0.2);
    run.rng = { ...always, chance: () => false };
    expect(checkMorale(run, pc)).toBe(MORALE.ROUT);
  });

  test("\"Never\" rolls too, and resists the urge to run as one who doesn't like to flee", () => {
    const { run, pc } = hero("never");
    pc.hp = Math.round(pc.maxHp * 0.4);
    expect(checkMorale(run, pc)).toBe(MORALE.ROUT);
    expect(standsGround(run, pc)).toBe(true);
    pc.tac = { retreat: "hurt" };
    expect(standsGround(run, pc)).toBe(false);
  });
});
