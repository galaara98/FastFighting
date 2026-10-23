/**
 * Reinforcements (engine/behavior/reinforce.js): a team's own (one creature, so many of it), called by its head as the
 * fight turns against it (competent: by the odds; instinctive: outnumbered, or one of its own down; feral: never), or
 * by the GM; they come next round at the edge farthest from its foes, and join the team. Help on its way, it holds on.
 */
import { describe, expect, test } from "vitest";
import { beginRun, prepareBattle, beginRound, playTurn, replay } from "../scripts/engine/simulator.js";
import { reinforcementsWanted, callReinforcements } from "../scripts/engine/behavior/reinforce.js";
import { STATUS, NEUTRAL_PARTY } from "../scripts/constants.js";
import { groupKeyOf } from "../scripts/engine/battle-state.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";
import { buildStory } from "../scripts/story/story.js";
import { text } from "./foundry-i18n.js";

const mind = (tactical = 50) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 50, fudge: 0 }, selfish: { base: 40, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
const lead = () => ({ brave: 0, tacticalFloor: 0, attack: 0, ac: 0 });
const goblin = (id, tactical = 50, extra = {}) => creature({ id, name: id, side: "hostile", hp: { value: 8, max: 8 }, traits: mind(tactical), ...extra });
const hero = (extra = {}) => creature({ id: "hero", name: "Hero", kind: "pc", diesAtZero: false, hp: { value: 300, max: 300 }, traits: mind(65),
  actions: [strike({ bonus: 20, damage: [parseFormula("3d10+10", "slashing")] })], ...extra });
const wolf = { id: "wolf", name: "Wolf", kind: "npc", level: 1, hp: { value: 20, max: 20, temp: 0 }, defenses: { ac: 15, fortitude: 7, reflex: 7, will: 5 }, initiative: { mod: 4 },
  speeds: { walk: 35 }, actions: [strike()], iwr: {}, traits: mind(30), flags: {}, diesAtZero: true };

function fight(combatants, { tactical = 50, reinforcements = { hostile: { spec: wolf, count: 6 } }, options = {}, command = { hostile: [{ id: "chief", role: "leader", leadership: lead() }] } } = {}) {
  const spec = { ...battle(combatants, { leadership: true, ...options }), command, reinforcements };
  const run = beginRun(prepareBattle(spec, pf2eRules), 1, { log: true });
  beginRound(run, 1);
  return { run, by: id => run.byId.get(id) };
}

describe("calling for reinforcements", () => {
  test("a competent head, outmatched, calls as many as would even the hit points; they come next round, on its team", () => {
    const { run, by } = fight([goblin("chief"), goblin("gob"), hero()]);
    const n = reinforcementsWanted(run, by("chief"));
    expect(n).toBeGreaterThan(1);
    expect(n).toBeLessThanOrEqual(6);
    // (With help still to call, it doesn't give up: it calls instead.)
    expect(run.stance.hostile ?? null).toBeNull();
    playTurn(run, by("chief"));
    expect(run.log.some(e => e.type === "reinforce" && e.actorId === "chief" && e.count === n)).toBe(true);
    expect(run.reinforce.hostile).toMatchObject({ left: 6 - n, coming: [{ n, round: 2 }] });
    // (One call at a time: while they're on their way, no more.)
    expect(reinforcementsWanted(run, by("chief"))).toBe(0);
    beginRound(run, 2);
    const came = run.units.filter(u => u.reinforcementOf === "hostile");
    expect(came).toHaveLength(n);
    expect(came.every(u => u.side === "hostile" && groupKeyOf(u) === "hostile" && u.spec.name === "Wolf" && u.status === STATUS.STANDING)).toBe(true);
    expect(run.order.slice(-n)).toEqual(came);
    expect(run.log.some(e => e.type === "arrive" && e.team === "hostile" && e.count === n)).toBe(true);
  });

  test("an instinctive head calls when outnumbered or one of its own is down; a feral one never", () => {
    const pack = fight([goblin("chief", 30), hero(), creature({ id: "ally", kind: "pc", traits: mind(65) })]);
    expect(reinforcementsWanted(pack.run, pack.by("chief"))).toBe(2);
    const even = fight([goblin("chief", 30), goblin("gob", 30), hero()]);
    expect(reinforcementsWanted(even.run, even.by("chief"))).toBe(0);
    Object.assign(even.by("gob"), { status: STATUS.DOWN, hp: 0 });
    expect(reinforcementsWanted(even.run, even.by("chief"))).toBeGreaterThan(0);
    const feral = fight([goblin("chief", 5), hero(), creature({ id: "ally", kind: "pc", traits: mind(65) })]);
    expect(reinforcementsWanted(feral.run, feral.by("chief"))).toBe(0);
  });

  test("none to call, none called; an even fight, none needed; nobody but the head calls", () => {
    const none = fight([goblin("chief"), goblin("gob"), hero()], { reinforcements: {} });
    expect(reinforcementsWanted(none.run, none.by("chief"))).toBe(0);
    const strong = fight([goblin("chief", 50, { hp: { value: 400, max: 400 } }), hero()]);
    expect(reinforcementsWanted(strong.run, strong.by("chief"))).toBe(0);
    const { run, by } = fight([goblin("chief"), goblin("gob"), hero()]);
    expect(reinforcementsWanted(run, by("gob"))).toBe(0);
  });

  test("the GM's call: as many as asked, no more than are left; a friend group's come into the group", () => {
    const { run } = fight([goblin("chief"), hero(), creature({ id: "elder", side: NEUTRAL_PARTY, originSide: "neutral", group: 1 })],
      { reinforcements: { hostile: { spec: wolf, count: 2 }, [`${NEUTRAL_PARTY}#1`]: { spec: wolf, count: 1 } } });
    expect(callReinforcements(run, "hostile", 5)).toBe(2);
    expect(callReinforcements(run, "hostile", 1)).toBe(0);
    callReinforcements(run, `${NEUTRAL_PARTY}#1`, 1);
    beginRound(run, 2);
    const villager = run.units.find(u => u.reinforcementOf === `${NEUTRAL_PARTY}#1`);
    expect(villager).toMatchObject({ side: NEUTRAL_PARTY, friendGroup: 1 });
  });

  test("told: who called, how many, how many left; who came", () => {
    const spec = { ...battle([goblin("chief", 50, { initiative: { mod: 50 }, hp: { value: 60, max: 60 } }), goblin("gob", 50, { hp: { value: 60, max: 60 } }), hero()], { leadership: true, maxRounds: 3 }),
      command: { hostile: [{ id: "chief", role: "leader", leadership: lead() }] }, reinforcements: { hostile: { spec: wolf, count: 6 } } };
    const r = replay(spec, pf2eRules, 1);
    const call = r.log.find(e => e.type === "reinforce");
    expect(call).toMatchObject({ actor: "chief", team: "hostile" });
    expect(buildStory(r, spec, "statistician").text).toContain(text("FASTFIGHTING.Log.ReinforceCall", { actor: "chief", n: call.count, left: call.left }));
    expect(r.log.find(e => e.type === "arrive")).toMatchObject({ team: "hostile", teamName: "Enemies", count: call.count });
  });

  test("on a map: at the edge farthest from the team's foes", () => {
    const spec = { ...battle([goblin("chief", 50, at(10, 50)), hero(at(0, 50))], { leadership: true, positioning: true }),
      command: { hostile: [{ id: "chief", role: "leader", leadership: lead() }] }, reinforcements: { hostile: { spec: wolf, count: 1 } }, bounds: { x0: 0, y0: 0, x1: 100, y1: 100 } };
    const run = beginRun(prepareBattle(spec, pf2eRules), 1, { log: true });
    beginRound(run, 1);
    callReinforcements(run, "hostile", 1);
    beginRound(run, 2);
    const w = run.units.find(u => u.reinforcementOf === "hostile");
    expect(w.pos.x).toBe(95);
  });
});
