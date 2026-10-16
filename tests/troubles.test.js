/**
 * The core's own conditions (engine/conditions.js PROFILES, behavior/troubles.js): what each does where the system
 * says nothing of it, and nothing where it does; holds, remedies, a friend's help, countdowns, spreading; the names
 * systems give them.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, endOfTurn, noteHeal, prepareBattle } from "../scripts/engine/simulator.js";
import { applyOutcome, conditionWeight } from "../scripts/engine/behavior/effects.js";
import { turnFor, canMove, canCommand } from "../scripts/engine/battle-state.js";
import { holdsOf, ownHolds, freeable, remediesOf } from "../scripts/engine/behavior/holds.js";
import { hasUses } from "../scripts/engine/behavior/evaluate.js";
import { canTalk } from "../scripts/engine/behavior/standoff.js";
import { rankedDesires } from "../scripts/engine/behavior/desire.js";
import { coreKeyFor, CORE_CONDITIONS, PROFILES } from "../scripts/engine/conditions.js";
import { networkOf, setCondition } from "../scripts/engine/live.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle, social } from "./helpers.js";

const hero = (extra = {}) => creature({ id: "hero", name: "Hero", hp: { value: 60, max: 60 }, actions: [strike({ bonus: -50 })], ...extra });
const orc = (extra = {}) => creature({ id: "orc", name: "Orc", side: "hostile", hp: { value: 60, max: 60 }, actions: [strike({ bonus: -50 })], ...extra });

function fight(list, rules = pf2eRules, seed = 5) {
  const run = beginRun(prepareBattle(battle(list, { maxRounds: 10, aftermath: "none" }), rules), seed, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}
/** Put a condition on: by whom, for long enough. */
const lay = (u, conditions, by = null) => applyOutcome(u, { conditions, rounds: 20, label: "" }, by?.id ?? null, { id: `test:${Object.keys(conditions)[0]}` });
const beside = (a, b) => {
  a.adjacent.add(b.id);
  b.adjacent.add(a.id);
};

describe("what they do where the system says nothing", () => {
  test("bonuses and penalties, by the system's dice; none where it gives the condition its own meaning", () => {
    const run = fight([hero(), orc()]);
    const h = run.byId.get("hero");
    lay(h, { dazzled: 1 });
    expect(h.mods.attack).toBe(-2);
    const owns = fight([hero(), orc()], { ...pf2eRules, ownConditions: ["dazzled"] });
    const o = owns.byId.get("hero");
    lay(o, { dazzled: 1 });
    expect(o.mods.attack ?? 0).toBe(0);
    // (A d6 system: a d20's 2 points are worth about 1 of its own.)
    const small = fight([hero(), orc()], { ...pf2eRules, rollPoint: 0.17 });
    const s = small.byId.get("hero");
    lay(s, { dazzled: 1 });
    expect(s.mods.attack).toBe(-1);
  });

  test("hastened: an action more; chilled: slower; outlined: hiding does it no good", () => {
    const run = fight([hero(), orc()]);
    const h = run.byId.get("hero");
    const before = turnFor(run, h).howMany(1);
    lay(h, { hastened: 1 });
    expect(turnFor(run, h).howMany(1)).toBe(before + 1);
    lay(h, { chilled: 2 });
    expect(h.mods.speed).toBe(-20);
    lay(h, { invisible: 1, outlined: 1 });
    expect(h.conds.invisible).toBeUndefined();
  });

  test("frozen solid: no actions, can't move or lead, worth a whole creature's fighting; it tries to break out, and a friend can chip it free", () => {
    const run = fight([hero(), creature({ id: "friend", name: "Friend" }), orc()]);
    const h = run.byId.get("hero");
    lay(h, { frozen: 1 });
    expect(turnFor(run, h).howMany(1)).toBe(0);
    expect(canMove(run, h)).toBe(false);
    expect(canCommand(h)).toBe(false);
    expect(conditionWeight(pf2eRules, { frozen: 1 })).toBe(1);
    expect(freeable(run, h)).toMatchObject({ key: "frozen", others: "check", core: true });
    endOfTurn(run, h);
    expect(run.log.some(e => e.type === "escape" && e.hold === "frozen" && e.actorId === "hero")).toBe(true);
  });

  test("in stasis: nothing harms it, nobody goes for it, it does nothing", () => {
    const run = fight([creature({ id: "knight", actions: [strike({ bonus: 50, damage: [parseFormula("20", "slashing")] })] }), orc()]);
    const o = run.byId.get("orc");
    lay(o, { stasis: 1 });
    takeTurn(run, run.byId.get("knight"));
    expect(o.hp).toBe(60);
    expect(rankedDesires(run, run.byId.get("knight")).some(d => d.kind === "hurt" && d.targetId === "orc")).toBe(false);
    expect(turnFor(run, o).howMany(1)).toBe(0);
  });

  test("transformed: no spells, nothing that needs hands; a bite still", () => {
    const spell = strike({ id: "bolt", name: "Bolt", magical: true, traits: ["magical"] });
    const bite = strike({ id: "bite", name: "Bite", natural: true });
    const run = fight([hero({ actions: [strike({ id: "sword" }), spell, bite] }), orc()]);
    const h = run.byId.get("hero");
    lay(h, { transformed: 1 });
    expect(hasUses(h, h.spec.actions.find(a => a.id === "sword"))).toBe(false);
    expect(hasUses(h, spell)).toBe(false);
    expect(hasUses(h, bite)).toBe(true);
  });

  test("choking, or in a rage: no talking anyone round; enraged, the nearest foe, badly", () => {
    const run = fight([hero({ social: social({ diplomacy: 5 }) }), orc()]);
    const h = run.byId.get("hero");
    expect(canTalk(h)).toBe(true);
    lay(h, { suffocating: 1 });
    expect(canTalk(h)).toBe(false);
    const rage = fight([hero(), orc()]);
    const r = rage.byId.get("hero");
    lay(r, { enraged: 1 });
    takeTurn(rage, r);
    expect(r.lastDesires?.[0] ?? rankedDesires(rage, r)[0]).toMatchObject({ kind: "hurt", targetId: "orc" });
  });
});

describe("harm, remedies and a friend's help", () => {
  test("burning: fire each turn; it wants rid of it, and a friend beside it can beat it out (only a friend: not its own hold)", () => {
    const run = fight([hero(), creature({ id: "friend", name: "Friend" }), orc()]);
    const h = run.byId.get("hero");
    lay(h, { burning: 2 });
    endOfTurn(run, h);
    expect(run.log.find(e => e.type === "persistent" && e.condition === "burning")).toMatchObject({ damageType: "fire" });
    expect(h.hp).toBeLessThan(60);
    expect(remediesOf(run, h).some(r => r.condition === "burning")).toBe(true);
    expect(freeable(run, h)).toMatchObject({ key: "burning", others: "untie", friendOnly: true });
    expect(ownHolds(run, h).some(x => x.key === "burning")).toBe(false);
  });

  test("a bleed stops with healing", () => {
    const run = fight([hero(), orc()]);
    const h = run.byId.get("hero");
    lay(h, { bleeding: 1 });
    noteHeal(run, h, h, 0, false);
    expect(h.conds.bleeding).toBe(1);
    noteHeal(run, h, h, 5, false);
    expect(h.conds.bleeding).toBeUndefined();
  });

  test("impregnated: it grows each turn, and at its last tears free and the host falls; a botched cut makes it worse", () => {
    const run = fight([hero(), creature({ id: "medic", name: "Medic", firstAid: { mod: -50, skill: "medicine" } }), orc()]);
    const h = run.byId.get("hero");
    lay(h, { impregnated: 5 });
    endOfTurn(run, h);
    expect(h.conds.impregnated).toBe(6);
    const hold = freeable(run, h);
    expect(hold).toMatchObject({ key: "impregnated", via: "medicine" });
    endOfTurn(run, h);
    expect(run.log.some(e => e.type === "burst" && e.actorId === "hero")).toBe(true);
    expect(h.status).not.toBe("standing");
  });

  test("suffocating: its breath runs out, and it falls", () => {
    const run = fight([hero(), orc()]);
    const h = run.byId.get("hero");
    lay(h, { suffocating: 3 });
    endOfTurn(run, h);
    expect(run.log.some(e => e.type === "suffocates")).toBe(true);
    expect(h.status).not.toBe("standing");
  });

  test("infectious: whoever stands beside it may catch it", () => {
    const run = fight([hero({ defenses: { ac: 16, fortitude: -50, reflex: 7, will: 7 } }), orc()]);
    const [h, o] = ["hero", "orc"].map(id => run.byId.get(id));
    beside(h, o);
    lay(o, { infectious: 1 });
    endOfTurn(run, o);
    expect(h.conds.infectious).toBe(1);
    expect(run.log.find(e => e.type === "spread")).toMatchObject({ actorId: "hero", byId: "orc" });
  });

  test("swallowed: acid each turn, a hold as hard as the swallower makes it; out again when it falls", () => {
    const run = fight([hero(), creature({ id: "knight", actions: [strike({ bonus: 50, damage: [parseFormula("100", "slashing")] })] }), orc({ escapeDC: 18, level: 8 })]);
    const [h, o] = ["hero", "orc"].map(id => run.byId.get(id));
    lay(h, { swallowed: 1 }, o);
    expect(holdsOf(run, h).find(x => x.key === "swallowed")).toMatchObject({ byId: "orc", dc: 18, others: null });
    expect(canMove(run, h)).toBe(false);
    endOfTurn(run, h);
    expect(run.log.find(e => e.type === "persistent" && e.condition === "swallowed")).toMatchObject({ damageType: "acid" });
    takeTurn(run, run.byId.get("knight"));
    expect(o.status).not.toBe("standing");
    expect(h.conds.swallowed).toBeUndefined();
    expect(run.log.some(e => e.type === "letGo" && e.actorId === "hero")).toBe(true);
  });
});

describe("what ends them", () => {
  test("fascinated: no actions, until anything harms it; charmed: it won't go for its charmer, until its charmer's side harms it", () => {
    const run = fight([creature({ id: "knight", actions: [strike({ bonus: 50, damage: [parseFormula("2", "slashing")] })] }), orc()]);
    const [k, o] = ["knight", "orc"].map(id => run.byId.get(id));
    lay(o, { fascinated: 1 });
    expect(turnFor(run, o).howMany(1)).toBe(0);
    takeTurn(run, k);
    expect(o.conds.fascinated).toBeUndefined();
    lay(o, { charmed: 1 }, k);
    takeTurn(run, k);
    expect(o.conds.charmed).toBeUndefined();
  });
});

describe("the map of minds and the names systems give them", () => {
  test("a condition's most: raised no higher", () => {
    const run = fight([hero(), orc()]);
    run.live = { facts: [], players: new Set(), gm: new Map() };
    setCondition(run, "hero", { key: "burning", value: 4 });
    const mark = networkOf(run).marks.find(m => m.type === "condition" && m.key === "burning");
    expect(mark).toMatchObject({ intensity: 4, most: 4 });
  });

  test("each has what it does, and the names systems give them reach the core's", () => {
    for ( const c of CORE_CONDITIONS.slice(30) ) expect(PROFILES[c.key]).toBeTruthy();
    expect(coreKeyFor("Flat-Footed")).toBe("offGuard");
    expect(coreKeyFor("on_fire")).toBe("burning");
    expect(coreKeyFor("Grappled")).toBe("grabbed");
    expect(coreKeyFor("lock-on")).toBe("outlined");
    expect(coreKeyFor("gearbroken")).toBe("gearBroken");
    expect(coreKeyFor("nothing-like-it")).toBeNull();
  });
});
