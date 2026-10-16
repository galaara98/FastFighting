import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { combinePlaystyles } from "../scripts/engine/playstyles.js";
import { NEUTRAL_PARTY } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, battle, social } from "./helpers.js";

const pills = ids => {
  const p = combinePlaystyles(ids, {});
  return { playstyles: ids, behavior: p.behavior, desireStyle: p.desire };
};

describe("the log: every entry in a turn", () => {
  test("a peacekeeper's calming words are told in the turn it says them, not at the opening", () => {
    const spec = battle([
      creature({ id: "keeper", name: "Keeper", side: NEUTRAL_PARTY, originSide: "neutral", social: social({ diplomacy: 8 }), ...pills(["peacekeeper"]) }),
      creature({ id: "pc", name: "Valeros", social: social() }),
      creature({ id: "orc", name: "Orc", side: "hostile", social: social() }),
      creature({ id: "orc2", name: "Orc Two", side: "hostile", social: social() })
    ], { talking: true });
    let seen = 0;
    for ( let seed = 1; seed <= 40; seed++ ) {
      const { log } = replay(spec, pf2eRules, seed);
      for ( const [i, e] of log.entries() ) {
        expect(Number.isFinite(e.turn), `${e.type} has a turn`).toBe(true);
        if ( e.type !== "peacekeep" ) continue;
        seen += 1;
        expect(e.turn).toBeGreaterThan(0);
        expect(e.turn).toBe(log[i + 1]?.turn ?? e.turn);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});
