import { describe, expect, test } from "vitest";
import { prepareBattle } from "../scripts/engine/simulator.js";
import { createRun, behaviorOf } from "../scripts/engine/battle-state.js";
import { scheme, follow, willingness, initDesires, TREACHEROUS } from "../scripts/engine/behavior/desire.js";
import { stepsToConvince, talkDC, attemptTalk } from "../scripts/engine/behavior/talk.js";
import { standAside } from "../scripts/engine/behavior/neutral.js";
import { recipients } from "../scripts/engine/behavior/support.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";
import { STATUS } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle, social } from "./helpers.js";

const minded = { tactical: { base: 60, fudge: 0 }, brave: { base: 60, fudge: 0 }, selfish: { base: 40, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
const withPills = (ids, extra = {}) => {
  const p = combinePlaystyles(ids, extra);
  return { playstyles: ids, behavior: p.behavior, desireStyle: p.desire, ...extra };
};
const always = { chance: () => true, next: () => 0, die: n => n, d20: () => 20, pick: a => a[0] };
const chain = (...ids) => ids.map((id, i) => ({ id, role: i === 0 ? "leader" : "lieutenant", leadership: { brave: 10, tacticalFloor: 40, attack: 0, ac: 0 } }));
const runOf = (combatants, command, options = {}) => {
  const run = createRun(prepareBattle({ ...battle(combatants, { leadership: true, ...options }), command }, pf2eRules));
  return { run, by: id => run.byId.get(id) };
};

describe("one who wants to lead and doesn't", () => {
  test("broods as often as the pill's place says: a quarter as its first pick, less further down", () => {
    const at = i => combinePlaystyles([...["brawler", "skeptic", "lazy"].slice(0, i), "leader"]).behavior.ambition;
    const values = [0, 1, 2, 3].map(at);
    for ( let i = 1; i < 4; i++ ) expect(values[i]).toBeLessThan(values[i - 1]);
    expect(values[0]).toBeCloseTo(0.25, 6);
    expect(combinePlaystyles(["leader"], { roleplay: true }).behavior.ambition).toBeGreaterThan(0.25);
    expect(combinePlaystyles(["leader"], { stayTrue: true }).behavior.ambition).toBeLessThanOrEqual(0.1);
  });

  test("only one with a treacherous streak schemes; never while it commands", () => {
    expect(TREACHEROUS).toEqual(expect.arrayContaining(["cruel", "wildcard"]));
    const { run, by } = runOf([creature({ id: "chief", traits: minded }), creature({ id: "keen", traits: minded, ...withPills(["leader"]) }),
      creature({ id: "sly", traits: minded, ...withPills(["leader", "cruel"]) }), creature({ id: "pc", side: "hostile" })], { friendly: chain("chief") });
    run.rng = always;
    expect(scheme(run, by("keen"))).toBeNull(); // (wonders, and lets it go)
    expect(scheme(run, by("sly"))).toMatchObject({ against: "chief" });
    // In command itself (its chief down, and it the next in line): nothing to scheme about.
    const { run: run2, by: by2 } = runOf([creature({ id: "chief", traits: minded }), creature({ id: "sly", traits: minded, ...withPills(["leader", "wildcard"]) }), creature({ id: "pc", side: "hostile" })], { friendly: chain("chief", "sly") });
    run2.rng = always;
    by2("chief").status = STATUS.DOWN;
    expect(scheme(run2, by2("sly"))).toBeNull();
  });

  test("scheming, it refuses its leaders any help, and follows no one", () => {
    const pep = { id: "pep", name: "Pep", kind: "buff", cost: 1, includeSelf: false, outcome: { mods: { attack: 1 }, rounds: 3, label: "heartened" } };
    const { run, by } = runOf([creature({ id: "chief", traits: minded, social: social() }), creature({ id: "pal", traits: minded }),
      creature({ id: "sly", traits: minded, social: social(), actions: [pep], ...withPills(["leader", "cruel"]) }), creature({ id: "foe", side: "hostile" })], { friendly: chain("chief") });
    run.rng = always;
    const sly = by("sly");
    initDesires(sly);
    scheme(run, sly);
    expect(willingness(run, sly, by("chief"))).toBe(0);
    expect(willingness(run, sly, by("pal"))).toBeGreaterThan(0);
    expect(follow(run, sly)).toBeNull();
    expect(recipients(run, sly, pep, 4, { all: true }).map(x => x.ally.id)).not.toContain("chief");
  });

  test("scheming, it's far easier to talk into changing sides", () => {
    const { run, by } = runOf([creature({ id: "talker", social: social({ diplomacy: 8 }) }),
      creature({ id: "sly", side: "hostile", traits: minded, social: social(), ...withPills(["leader", "cruel"]) }), creature({ id: "boss", side: "hostile", traits: minded })], { hostile: chain("boss") });
    const sly = by("sly");
    const steps = stepsToConvince(sly, run, by("talker"));
    const dc = talkDC(run, by("talker"), sly, "persuade");
    sly.scheming = { against: "boss", name: "boss" };
    expect(stepsToConvince(sly, run, by("talker"))).toBe(Math.max(2, steps - 2));
    expect(talkDC(run, by("talker"), sly, "persuade")).toBe(dc - 4);
  });

  test("a player character scheming against the leader it wasn't chosen to be turns only on the traitor luck", () => {
    const turns = traitorLuck => {
      const { run, by } = runOf([creature({ id: "talker", side: "hostile", social: social({ diplomacy: 30 }) }),
        creature({ id: "pc", kind: "pc", diesAtZero: false, traits: minded, social: social(), ...withPills(["leader", "wildcard"]) }), creature({ id: "chief", traits: minded })],
        { friendly: chain("chief") }, { traitorLuck });
      const pc = by("pc");
      pc.scheming = { against: "chief", name: "chief" };
      pc.sway.set("hostile", 10);
      run.rng = { ...always, die: n => (n === 100 ? 5 : n) }; // a 5 on the d100
      attemptTalk(run, by("talker"), { target: pc, kind: "persuade", aim: "down", mod: 30, dc: 10, advantage: 0 }, () => {});
      return pc.side;
    };
    expect(turns(9)).toBe("neutralParty"); // (5 is under 9: it stands aside)
    expect(turns(3)).toBe("friendly");     // (not under 3: it stays)
  });

  test("changing sides, its wish to lead goes (and Make it So takes it off the character)", () => {
    const { run, by } = runOf([creature({ id: "sly", side: "hostile", traits: minded, ...withPills(["leader", "cruel"]) }), creature({ id: "pc" })], {});
    const sly = by("sly");
    expect(behaviorOf(sly).ambition).toBeGreaterThan(0);
    standAside(run, sly);
    expect(sly.ambitionGone).toBe(true);
    expect(behaviorOf(sly).ambition).toBeUndefined();
    expect(behaviorOf(sly).finishDowned).toBeGreaterThan(0); // (its other pills stay)
    run.rng = always;
    expect(scheme(run, sly)).toBeNull();
  });
});
