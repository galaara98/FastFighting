/**
 * Holds (behavior/holds.js): breaking free of what holds a creature (tied up, a grab, what the system says an action
 * breaks), and freeing a friend; the system's own say on it; tied up as something on the creature, from no one.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, prepareBattle } from "../scripts/engine/simulator.js";
import { holdsOf, tryHold, isBound } from "../scripts/engine/behavior/holds.js";
import { mind } from "../scripts/engine/behavior/desire.js";
import { beginLive, liveRound, setCondition, conditionsOf, networkOf } from "../scripts/engine/live.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const traits = (loyal = 60) => ({ tactical: { base: 60, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: loyal, fudge: 0 } });
const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
const blade = () => strike({ id: "blade", bonus: 14, damage: [parseFormula("2d8+8", "slashing")] });
const fighter = (id, side, x, extra = {}) => creature({ id, name: id, side, diesAtZero: false, hp: { value: 300, max: 300 }, traits: traits(), actions: [blade()], flags: { fearless: true }, ...at(x), ...extra });

/** A fight on a map, a round in, with whatever rules it's given. */
function fight(list, rules = pf2eRules, seed = 3) {
  const run = beginRun(prepareBattle(battle(list, { maxRounds: 6, positioning: true }), rules), seed, { log: true });
  beginRound(run, 1);
  return run;
}
const tie = (u, by = null) => Object.assign(u, { bound: true, boundBy: by, status: "bound" });

describe("breaking free", () => {
  test("a prisoner struggles on its turn, and nothing else; loose, it's in the fight again", () => {
    const run = fight([fighter("hero", "friendly", 0), fighter("orc", "hostile", 5, { escapeWork: { mod: 60 } })]);
    const orc = tie(run.byId.get("orc"), "hero");
    takeTurn(run, orc);
    expect(run.log.at(-1)).toMatchObject({ type: "escape", hold: "bound", success: true });
    expect([orc.status, isBound(orc)]).toEqual(["standing", false]);
    expect(run.log.some(e => e.actorId === "orc" && e.type === "attack")).toBe(false);
    beginRound(run, 2);
    takeTurn(run, orc);
    expect(run.log.some(e => e.actorId === "orc" && e.type === "attack")).toBe(true);
  });

  test("the knots hold for one who can't slip them; it wants to, all the same", () => {
    const run = fight([fighter("hero", "friendly", 0), fighter("orc", "hostile", 5, { escapeWork: { mod: -50 } })]);
    const orc = tie(run.byId.get("orc"));
    takeTurn(run, orc);
    expect(orc.status).toBe("bound");
    expect(mind(run, orc).lead).toMatchObject({ kind: "breakFree", targetId: "orc" });
  });

  test("a grab with nothing to go on: an even chance at the turn's start, as ever; with its own numbers, a check", () => {
    const run = fight([fighter("hero", "friendly", 0), fighter("orc", "hostile", 5)]);
    const orc = run.byId.get("orc");
    orc.grabbedBy = "hero";
    takeTurn(run, orc);
    expect(run.log.find(e => e.actorId === "orc" && e.type === "escape")).toEqual(expect.not.objectContaining({ hold: expect.anything() }));
    // (Its own numbers, and the grabber's DC: a check, as badly as it wants loose.)
    const known = fight([fighter("hero", "friendly", 0, { escapeDC: 15 }), fighter("orc", "hostile", 40, { escapeWork: { mod: 60 } })]);
    const k = known.byId.get("orc");
    k.grabbedBy = "hero";
    takeTurn(known, k);
    expect(known.log.find(e => e.actorId === "orc" && e.type === "escape")).toMatchObject({ hold: "grabbed", success: true, dc: 15 });
    expect(k.grabbedBy).toBe(null);
  });

  test("the system's own: a condition its sheet shows that an action breaks (rules.escapeFrom), and its own way (rules.breakFree)", () => {
    const tries = [];
    const rules = {
      ...pf2eRules,
      escapeFrom: (run, u, key) => (key === "restrained" ? { dc: 18, others: "check" } : null),
      breakFree: (run, who, hold, { freeing }) => {
        tries.push([who.id, hold.key, freeing]);
        return { success: true, natural: 20, mod: 0, total: 20, dc: hold.dc, degree: 3 };
      }
    };
    const run = fight([fighter("hero", "friendly", 0), fighter("orc", "hostile", 40)], rules);
    const orc = run.byId.get("orc");
    orc.baseConds = { restrained: 1 };
    expect(holdsOf(run, orc)).toEqual([expect.objectContaining({ key: "restrained", dc: 18, others: "check", sheet: true })]);
    takeTurn(run, orc);
    expect(tries[0]).toEqual(["orc", "restrained", false]);
    expect(run.log.find(e => e.actorId === "orc" && e.type === "escape")).toMatchObject({ hold: "restrained", success: true });
    expect(orc.baseConds.restrained).toBeUndefined();
  });
});

describe("freeing a friend", () => {
  test("a friend tied up, and no foe on it: it goes over and unties them (no roll)", () => {
    const run = fight([fighter("hero", "friendly", 0), fighter("kyra", "friendly", 10), fighter("orc", "hostile", 120)]);
    const kyra = tie(run.byId.get("kyra"), "orc");
    const hero = run.byId.get("hero");
    takeTurn(run, hero);
    expect(run.log.find(e => e.actorId === "hero" && e.type === "free")).toMatchObject({ targetId: "kyra", hold: "bound", success: true });
    expect([kyra.status, isBound(kyra)]).toEqual(["standing", false]);
  });

  test("what the system says a friend can break takes a roll (or the system's way, told it's a friend's)", () => {
    const run = fight([fighter("hero", "friendly", 0, { escapeWork: { mod: 60 } }), fighter("kyra", "friendly", 5)]);
    const kyra = run.byId.get("kyra");
    kyra.effects.push({ key: "net", conditions: { restrained: 1 }, sourceId: null, rounds: Infinity, escape: { dc: 10, others: "check" } });
    const hold = holdsOf(run, kyra)[0];
    expect(hold).toMatchObject({ key: "restrained", effectKey: "net", others: "check" });
    expect(tryHold(run, run.byId.get("hero"), hold, { freeing: true })).toMatchObject({ success: true, dc: 10 });
  });
});

describe("tied up, as the GM puts it on", () => {
  test("on the creature, from no one: no line toward anyone; taken off, it's free", () => {
    const hero = creature({ id: "hero", kind: "pc", ...at(0) });
    const orc = creature({ id: "orc", side: "hostile", ...at(10) });
    const run = beginLive(battle([hero, orc], { positioning: true, maxRounds: 3, aftermath: "none" }), pf2eRules, { seed: 1 });
    liveRound(run, 1);
    expect(setCondition(run, "orc", { key: "bound", value: 1 })).toBe(true);
    const u = run.byId.get("orc");
    expect([u.status, u.bound, u.boundBy]).toEqual(["bound", true, null]);
    expect(conditionsOf(run, "orc").conditions.find(c => c.key === "bound")).toMatchObject({ sources: [] });
    const net = networkOf(run);
    expect(net.marks.find(m => m.on === "orc" && m.key === "bound")).toBeTruthy();
    expect(net.links.some(l => l.to === "orc" && (l.kind === "bound" || l.key === "bound"))).toBe(false);
    setCondition(run, "orc", { key: "bound", value: 0 });
    expect([u.status, isBound(u)]).toEqual(["standing", false]);
  });
});
