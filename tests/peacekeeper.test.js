import { describe, expect, test } from "vitest";
import { prepareBattle } from "../scripts/engine/simulator.js";
import { createRun, behaviorOf } from "../scripts/engine/battle-state.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";
import { impatience } from "../scripts/engine/behavior/standoff.js";
import { talkDC, bestPitch, attemptTalk, willingToPay } from "../scripts/engine/behavior/talk.js";
import { dislikesViolence } from "../scripts/engine/behavior/neutral.js";
import { initDesires, styleWants, levelOf } from "../scripts/engine/behavior/desire.js";
import { STATUS } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle, social } from "./helpers.js";

const pills = (ids, extra = {}) => {
  const p = combinePlaystyles(ids, extra);
  return { playstyles: ids, behavior: p.behavior, desireStyle: p.desire, ...extra };
};
const always = { chance: () => true, next: () => 0, die: n => n, d20: () => 20, pick: a => a[0], shuffle: a => a };
const runOf = combatants => {
  const run = createRun(prepareBattle(battle(combatants), pf2eRules));
  for ( const u of run.units ) initDesires(u);
  run.log = [];
  const say = (unit, text, data) => run.log.push({ actor: unit.spec.name, text, ...data });
  return { run, say, by: id => run.byId.get(id) };
};

describe("the Peacekeeper", () => {
  test("holds everyone in a standoff back, whichever side they're on", () => {
    const plain = runOf([creature({ id: "pc", social: social() }), creature({ id: "orc", side: "hostile", social: social() })]);
    const kept = runOf([creature({ id: "pc", social: social(), ...pills(["peacekeeper"]) }), creature({ id: "orc", side: "hostile", social: social() })]);
    for ( const g of [plain, kept] ) g.run.standoff = true;
    expect(impatience(kept.run, kept.by("orc"))).toBeCloseTo(impatience(plain.run, plain.by("orc")) * 0.5, 6);
  });

  test("its word is trusted, and it never threatens", () => {
    const { run, by } = runOf([creature({ id: "keeper", social: social({ diplomacy: 5, intimidation: 40 }), ...pills(["peacekeeper"]) }), creature({ id: "talker", social: social({ diplomacy: 5, intimidation: 40 }) }),
      creature({ id: "orc", side: "hostile", social: social() })]);
    expect(talkDC(run, by("keeper"), by("orc"), "persuade")).toBe(talkDC(run, by("talker"), by("orc"), "persuade") - 2);
    expect(bestPitch(run, by("talker"), by("orc")).kind).toBe("intimidate");
    expect(bestPitch(run, by("keeper"), by("orc")).kind).not.toBe("intimidate");
  });

  test("foes it talks round stand down, even mid-fight: a truce, not a surrender", () => {
    const { run, by, say } = runOf([creature({ id: "keeper", social: social({ diplomacy: 40 }), ...pills(["peacekeeper"]) }), creature({ id: "orc", side: "hostile", social: social(), hp: { value: 4, max: 20 } })]);
    run.rng = always;
    for ( let i = 0; i < 6 && by("orc").status === STATUS.STANDING; i++ ) attemptTalk(run, by("keeper"), { target: by("orc"), kind: "persuade", aim: "down", mod: 40, dc: 10 }, say);
    expect(by("orc").status).toBe(STATUS.STOOD_DOWN);
  });

  test("can't abide violence, and would pay a boss to go", () => {
    const { run, by } = runOf([creature({ id: "keeper", social: social(), ...pills(["peacekeeper"]) }), creature({ id: "orc", side: "hostile" })]);
    expect(dislikesViolence(by("keeper"))).toBe(true);
    expect(willingToPay(run, by("keeper"))).toBe(true);
    expect(behaviorOf(by("keeper")).spareDowned).toBe(1);
  });
});

describe("the Fragile", () => {
  test("once hurt, wants to mend itself", () => {
    const potion = { id: "potion", name: "Potion", kind: "heal", cost: 1, selfOnly: true, amount: [{ count: 1, faces: 8, bonus: 0 }] };
    const { run, by } = runOf([creature({ id: "glass", ...pills(["fragile"]), actions: [potion] }), creature({ id: "orc", side: "hostile" })]);
    const u = by("glass");
    styleWants(run, u, [], { canHeal: true });
    expect(levelOf(u, "heal", u.id)).toBe(0); // (unhurt)
    u.hp = 5;
    styleWants(run, u, [], { canHeal: true });
    expect(levelOf(u, "heal", u.id)).toBeGreaterThan(0);
  });
});
