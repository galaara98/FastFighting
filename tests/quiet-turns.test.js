/**
 * Turns the table should hear about even when little happens in them, in a live battle:
 *  - one on its feet that isn't part of the fight (it hasn't noticed it, has only just, or takes no side and has turned
 *    on no one) and does nothing keeps out of it, told (simulator.js noteAside; the story's event.aside). Only in a live
 *    battle: a simulated fight tells no turn it doesn't take.
 *  - a player's character dying, its recovery check (a death save) rolled at the table, told as the engine's own check
 *    is (live.js pcTurnEnd, noteRecovery): what its helper read of the card, else what its rules say of the sheet before
 *    and after (rules.recoveryRead), else the core's reading of the dying value.
 */
import { describe, expect, test } from "vitest";
import { beginLive, liveRound, liveTurn, pcTurnBegin, pcTurnEnd } from "../scripts/engine/live.js";
import { replay } from "../scripts/engine/simulator.js";
import { storyBeats } from "../scripts/story/story.js";
import { logLine } from "../scripts/story/log-lines.js";
import { NEUTRAL_PARTY } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { storyTables, text } from "./foundry-i18n.js";
import { creature, strike, battle } from "./helpers.js";

const english = storyTables();
const tables = { get: k => english[k] };
const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
const harmless = () => [strike({ bonus: -50 })];

function scene(extra = {}) {
  return battle([
    creature({ id: "hero", name: "Hero", kind: "pc", diesAtZero: false, ...at(0), hp: { value: 40, max: 40 }, ...extra.hero }),
    creature({ id: "orc", name: "Orc", side: "hostile", ...at(5), hp: { value: 200, max: 200 }, actions: harmless() }),
    creature({ id: "dancer", name: "Dancer", side: NEUTRAL_PARTY, originSide: "neutral", ...at(60, 60), actions: harmless() })
  ], { positioning: true, maxRounds: 4, aftermath: "none", talking: false, morale: false });
}

/** What the story tells of these events, as one beat's words. */
const told = (events, spec) => storyBeats({ log: events, units: {} }, spec, "roleplay", { tables, seed: 1 }).map(b => b.text).join(" ");

describe("a turn by one not part of the fight", () => {
  test("in a live battle, every turn of a bystander tells something of its own: noticing, watching, or keeping out of it", () => {
    const spec = scene();
    let asides = 0;
    for ( const seed of [1, 2, 3, 4] ) {
      const run = beginLive(spec, pf2eRules, { seed, players: ["hero"] });
      for ( let round = 1; round <= 3; round++ ) {
        liveRound(run, round);
        const { events } = liveTurn(run, "dancer");
        const own = events.filter(e => e.actorId === "dancer" && e.type !== "thought");
        expect(own.length).toBeGreaterThan(0);
        asides += own.filter(e => e.type === "aside").length;
      }
    }
    expect(asides).toBeGreaterThan(0);
  });

  test("told from its own lines, in the story and the GMs' log", () => {
    const spec = scene();
    const e = { type: "aside", actor: "Dancer", actorId: "dancer", round: 2, turn: 5 };
    const lines = english["event.aside"].map(l => l.replace("{actor}", "Dancer"));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.some(l => told([e], spec).includes(l))).toBe(true);
    expect(logLine(e)).toBe(text("FASTFIGHTING.Log.Aside", { actor: "Dancer" }));
  });

  test("a simulated fight tells no such turn", () => {
    const spec = scene();
    for ( const seed of [1, 2, 3] ) expect(replay(spec, pf2eRules, seed).log.some(e => e.type === "aside")).toBe(false);
  });
});

describe("a player's character's recovery check, rolled at the table", () => {
  const dyingHero = { hero: { hp: { value: 0, max: 40 }, dying: 2 } };
  /** Its turn, the sheet read after it as `sheet` says. */
  const turn = sheet => {
    const run = beginLive(scene(dyingHero), pf2eRules, { seed: 1, players: ["hero"] });
    liveRound(run, 1);
    pcTurnBegin(run, "hero");
    return pcTurnEnd(run, "hero", [], { hero: sheet }).events.filter(e => e.type === "recovery");
  };

  test("better, worse, stable, dead: told as the engine's own check is", () => {
    expect(turn({ status: "down", dying: 1 })).toEqual([expect.objectContaining({ actorId: "hero", before: 2, dying: 1, better: true, dead: false })]);
    expect(turn({ status: "down", dying: 3 })).toEqual([expect.objectContaining({ before: 2, dying: 3, better: false })]);
    expect(turn({ status: "down", dying: 0, stable: true })).toEqual([expect.objectContaining({ stable: true, better: true })]);
    expect(turn({ status: "dead", dying: 4 })).toEqual([expect.objectContaining({ dead: true, better: false })]);
  });

  test("nothing rolled (the sheet as it was): nothing told", () => {
    expect(turn({ status: "down", dying: 2 })).toEqual([]);
  });

  test("the system says what it came to, where it counts its own way: its helper's reading of the card, or its rules", () => {
    // (Read off the card: told as the helper says, the core's numbers beside it.)
    const run = beginLive(scene(dyingHero), pf2eRules, { seed: 1, players: ["hero"] });
    liveRound(run, 1);
    pcTurnBegin(run, "hero");
    const read = pcTurnEnd(run, "hero", [{ type: "recovery", better: true, text: "Death save: 14, a success" }], { hero: { status: "down", dying: 2 } }).events.filter(e => e.type === "recovery");
    expect(read).toEqual([expect.objectContaining({ before: 2, dying: 2, better: true, text: "Death save: 14, a success" })]);
    // (A one-roll system, its rules' say: nothing to tell, or what it came to.)
    const ruled = (said, sheet) => {
      const r = beginLive(scene(dyingHero), { ...pf2eRules, recoveryRead: () => said }, { seed: 1, players: ["hero"] });
      liveRound(r, 1);
      pcTurnBegin(r, "hero");
      return pcTurnEnd(r, "hero", [], { hero: sheet }).events.filter(e => e.type === "recovery");
    };
    expect(ruled(null, { status: "down", dying: 1 })).toEqual([]);
    expect(ruled({ stable: true, better: true }, { status: "down", dying: 2 })).toEqual([expect.objectContaining({ stable: true, better: true })]);
    expect(ruled(undefined, { status: "down", dying: 1 })).toEqual([expect.objectContaining({ better: true })]);
  });

  test("the GMs' log: the system's words, or what it came to", () => {
    expect(logLine({ type: "recovery", actor: "Hero", text: "Death save: 14" })).toBe("Hero: Death save: 14");
    expect(logLine({ type: "recovery", actor: "Hero", before: 2, dying: 1 })).toBe(`Hero: ${text("FASTFIGHTING.Log.DyingN", { n: 1 })}`);
    expect(logLine({ type: "recovery", actor: "Hero", dead: true })).toBe(`Hero: ${text("FASTFIGHTING.Log.Dies")}`);
  });

  test("the story tells it from its recovery lines", () => {
    const [e] = turn({ status: "down", dying: 1 });
    const lines = english["event.recoveryGood"].map(l => l.replace("{actor}", "Hero"));
    expect(lines.some(l => told([e], scene()).includes(l))).toBe(true);
  });
});
