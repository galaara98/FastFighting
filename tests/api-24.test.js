/**
 * API 24: the engine's advantage reaches the system's roller in a live battle. A save, a check or a strike the system
 * rolls itself (systemRolled; engine/live.js systemRoll) carries the engine's net advantage on it (1, -1 or 0), and
 * the live side hands it to the helper's rollSave, rollCheck and rollStrike. A recovery check its helper read as stable
 * leaves the creature stable. The rules take up what only they keep from the sheets as a live battle reads them
 * (rules.syncUnit).
 */
import { describe, expect, test } from "vitest";
import { CORE_API, CORE_API_VERSION } from "../scripts/core-api.js";
import { beginLive, liveRound, liveTurn, pcTurnBegin, pcTurnEnd, NeedsDecision, syncFromSheets } from "../scripts/engine/live.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
const blast = { id: "blast", name: "Blast", kind: "save", rank: 3, magical: true, area: { targets: 1 }, save: { type: "reflex", dc: 20, basic: true }, range: { increment: 60, max: 60, noPenalty: true }, cost: 2, damage: [parseFormula("4d6", "fire")] };

/** The mage's turn played through its questions; the requests it asked. */
function requestsOf(heroOver = {}) {
  const spec = battle([
    creature({ id: "hero", name: "Hero", kind: "pc", diesAtZero: false, ...at(0), hp: { value: 60, max: 60 }, ...heroOver }),
    creature({ id: "mage", name: "Mage", side: "hostile", ...at(30), actions: [blast, strike({ bonus: -50 })], resources: {} })
  ], { positioning: true, maxRounds: 3, aftermath: "none", talking: false, morale: false });
  const answers = [];
  const requests = [];
  for ( let tries = 0; tries < 40; tries++ ) {
    const run = beginLive(spec, pf2eRules, { seed: 3, players: ["hero"], systemRolls: ["save"] });
    liveRound(run, 1);
    try {
      liveTurn(run, "mage", { answers });
      return requests;
    } catch ( err ) {
      if ( !(err instanceof NeedsDecision) ) throw err;
      requests.push(err.request);
      answers.push([err.request.key, err.request.roll === "save" ? { degree: 2, natural: 15, total: 25 } : false]);
    }
  }
  throw new Error("a turn that never stops asking");
}

test("the API is 24 or later, major.bug", () => {
  expect(CORE_API.major).toBeGreaterThanOrEqual(24);
  expect(CORE_API_VERSION).toBe(`${CORE_API.major}.${CORE_API.bug}`);
});

describe("advantage on a roll the system makes", () => {
  test("a save carries the engine's advantage on it (here, against magic); none, 0", () => {
    const plain = requestsOf().find(r => r.roll === "save");
    expect(plain).toMatchObject({ unitId: "hero", save: "reflex", advantage: 0 });
    const warded = requestsOf({ saveVs: [{ advantage: 1, vs: ["magical"] }] }).find(r => r.roll === "save");
    expect(warded).toMatchObject({ unitId: "hero", save: "reflex", advantage: 1 });
  });
});

describe("a recovery check its helper read as stable", () => {
  test("leaves the creature stable, where the sheet keeps no mark of it", () => {
    const spec = battle([
      creature({ id: "hero", name: "Hero", kind: "pc", diesAtZero: false, ...at(0), hp: { value: 0, max: 40 }, dying: 1 }),
      creature({ id: "orc", name: "Orc", side: "hostile", ...at(5), actions: [strike({ bonus: -50 })] })
    ], { positioning: true, maxRounds: 3, aftermath: "none", talking: false, morale: false });
    const run = beginLive(spec, pf2eRules, { seed: 1, players: ["hero"] });
    liveRound(run, 1);
    pcTurnBegin(run, "hero");
    const told = pcTurnEnd(run, "hero", [{ type: "recovery", better: true, stable: true }], { hero: { status: "down", dying: 0 } }).events;
    expect(told.find(e => e.type === "recovery")).toMatchObject({ stable: true, better: true });
    expect(run.byId.get("hero").stable).toBe(true);
  });
});

describe("the sheets' own state, for the system's rules", () => {
  test("rules.syncUnit hears each creature's state as read, after the core's own fields; rules without it, nothing", () => {
    const spec = battle([
      creature({ id: "hero", name: "Hero", kind: "pc", diesAtZero: false, ...at(0), hp: { value: 0, max: 40 } }),
      creature({ id: "orc", name: "Orc", side: "hostile", ...at(5), actions: [strike({ bonus: -50 })] })
    ], { positioning: true, maxRounds: 3, aftermath: "none", talking: false, morale: false });
    const heard = [];
    const rules = { ...pf2eRules, syncUnit(u, state) { heard.push([u.id, u.hp, state.deathSaves]); u.tally = state.deathSaves; } };
    const run = beginLive(spec, rules, { seed: 1, players: ["hero"] });
    syncFromSheets(run, { hero: { hp: 0, deathSaves: { success: 2, failure: 1 } }, orc: { hp: 30 } });
    expect(heard).toEqual([["hero", 0, { success: 2, failure: 1 }], ["orc", 30, undefined]]);
    expect(run.byId.get("hero").tally).toEqual({ success: 2, failure: 1 });
    expect(() => syncFromSheets(beginLive(spec, pf2eRules, { seed: 1 }), { hero: { hp: 0, deathSaves: {} } })).not.toThrow();
  });
});
