import { describe, expect, test } from "vitest";
import { prepareBattle } from "../scripts/engine/simulator.js";
import { createRun } from "../scripts/engine/battle-state.js";
import { createRng } from "../scripts/engine/rng.js";
import { initDesires } from "../scripts/engine/behavior/desire.js";
import { talkActionsThisTurn } from "../scripts/engine/behavior/talk.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle, social } from "./helpers.js";

describe("Always talk unless I am currently being hurt", () => {
  function setUp(over = {}) {
    const run = createRun(prepareBattle(battle([
      creature({ id: "talker", kind: "pc", diesAtZero: false, alwaysTalk: true, social: social({ diplomacy: 6 }), ...over }),
      creature({ id: "orc", side: "hostile", social: social({ diplomacy: 2 }) })
    ], { talking: true }), pf2eRules));
    run.rng = createRng(1);
    run.round = 2;
    for ( const u of run.units ) {
      initDesires(u);
      u.tac = { talk: "first" };
    }
    return { run, talker: run.byId.get("talker") };
  }

  test("it talks the whole turn, while nobody is hurting it", () => {
    const { run, talker } = setUp();
    const { count } = talkActionsThisTurn(run, talker, 3);
    expect(count).toBe(3);
  });

  test("hurt since its last turn, it doesn't give the whole turn to words", () => {
    const { run, talker } = setUp();
    talker.beingHurt = true;
    talker.turnsTaken = 1;
    const { count } = talkActionsThisTurn(run, talker, 3);
    expect(count).toBeLessThan(3);
  });

  test("staying true to its calculated tactics, it doesn't either", () => {
    const { run, talker } = setUp({ stayTrue: true });
    talker.turnsTaken = 1;
    expect(talkActionsThisTurn(run, talker, 3).count).toBeLessThan(3);
  });
});
