/**
 * What API 17 gives the helpers (the PF2e and 5e helpers' asks): a heal's outcome, size on a push, an affliction that
 * takes hold as the action's save went, a system's remedy in place of the core's and a profile changed in part (no
 * remedy, no penalties, harm at the start of a turn), held inside another creature for every system, a hold let go of
 * as the system says, the AI's weighing of all of it, a stale hold no more, what a check or a save is for, a spell
 * disrupted, what harm came with, a try at a hold that hurts its holder, usable heals, and after the attack.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, endOfTurn, playTurn, prepareBattle, carryInside } from "../scripts/engine/simulator.js";
import { applyOutcome, outcomeWorth } from "../scripts/engine/behavior/effects.js";
import { holdsOf, release, remediesOf } from "../scripts/engine/behavior/holds.js";
import { holderOf, cutOff } from "../scripts/engine/behavior/troubles.js";
import { expectedDamage } from "../scripts/engine/behavior/evaluate.js";
import { decideHeal } from "../scripts/engine/behavior/healing.js";
import { decideFallen } from "../scripts/engine/behavior/fallen.js";
import { think } from "../scripts/engine/behavior/desire.js";
import { chooseTarget } from "../scripts/engine/behavior/targeting.js";
import { movesNeeded, turnFor, saveRoll, checkRoll } from "../scripts/engine/battle-state.js";
import { simpleAffliction } from "../scripts/engine/behavior/afflictions.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { CORE_API } from "../scripts/core-api.js";
import { creature, strike, battle } from "./helpers.js";

/** pf2eRules with some system hooks of its own. */
const withHooks = hooks => Object.assign(Object.create(pf2eRules), hooks);
const at = (x, y = 0) => ({ x, y, size: 5 });
const hero = (extra = {}) => creature({ id: "hero", name: "Hero", hp: { value: 60, max: 60 }, actions: [strike({ bonus: -50 })], ...extra });
const orc = (extra = {}) => creature({ id: "orc", name: "Orc", side: "hostile", hp: { value: 60, max: 60 }, actions: [strike({ bonus: -50 })], ...extra });

function fight(list, rules = pf2eRules, { seed = 5, positioning = false } = {}) {
  const run = beginRun(prepareBattle(battle(list, { maxRounds: 10, aftermath: "none", positioning }), rules), seed, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}
/** Put a condition on: by whom, for long enough. */
const lay = (u, conditions, by = null) => applyOutcome(u, { conditions, rounds: 20, label: "" }, by?.id ?? null, { id: `test:${Object.keys(conditions)[0]}` });
const ofType = (run, type, id = null) => run.log.filter(e => e.type === type && (!id || e.actorId === id));

test("the API is 17 or later", () => expect(CORE_API.major).toBeGreaterThanOrEqual(17));

describe("heals", () => {
  const potion = (extra = {}) => ({ id: "potion", name: "Potion", kind: "heal", cost: 1, heal: [parseFormula("2d6", "healing")], selfOnly: true, ...extra });

  test("a heal lays its outcome on the one healed (Regenerate's hit point a turn), and that counts when weighing heals", () => {
    const lasting = { fastHealing: 3, rounds: 10, label: "Regenerate" };
    const run = fight([hero({ hp: { value: 10, max: 60 }, actions: [strike({ bonus: -50 }), potion(), potion({ id: "regen", name: "Regenerate", outcome: lasting })] }), orc()]);
    const h = run.byId.get("hero");
    const pick = decideHeal(run, h, turnFor(run, h));
    expect(pick.action.id).toBe("regen");
    takeTurn(run, h);
    expect(h.effects.some(e => e.key === "regen" && e.fastHealing === 3)).toBe(true);
    expect(h.fxHealing).toBe(3);
  });

  test("the system's usable is asked of heals too (PF2e: sickened, no potion)", () => {
    const rules = withHooks({ usable: (run, u, a) => !(a.selfOnly && u.conds.sickened) });
    const run = fight([hero({ hp: { value: 10, max: 60 }, actions: [strike({ bonus: -50 }), potion()] }), orc()], rules);
    const h = run.byId.get("hero");
    expect(decideHeal(run, h, turnFor(run, h))?.action.id).toBe("potion");
    lay(h, { sickened: 1 });
    expect(decideHeal(run, h, turnFor(run, h))).toBeNull();
  });
});

describe("riders and afflictions", () => {
  const push = { kind: "move", move: { kind: "push", feet: 10 }, critOnly: false, maxSize: 3 };
  const pusher = (extra = {}) => creature({ id: "giant", name: "Giant", position: at(0), actions: [strike({ bonus: 50, effects: [push], damage: [parseFormula("1", "bludgeoning")] })], ...extra });
  const pushes = run => ofType(run, "forced", "giant").length;

  test("a push rider honours its maxSize, and the system's immunities to it", () => {
    for ( const [size, pushed] of [[3, 1], [4, 0]] ) {
      const run = fight([pusher(), orc({ size, position: at(5) })], pf2eRules, { positioning: true });
      takeTurn(run, run.byId.get("giant"));
      expect(pushes(run) > 0 ? 1 : 0).toBe(pushed);
    }
    const rules = withHooks({ isImmune: (t, action) => (action.onSave ?? []).some(o => o.kind === "move") });
    const run = fight([pusher(), orc({ size: 2, position: at(5) })], rules, { positioning: true });
    takeTurn(run, run.byId.get("giant"));
    expect(pushes(run)).toBe(0);
  });

  test("a rider that only comes of a blow that hurt (hurtOnly): not when the blow did nothing", () => {
    const rider = { kind: "prone", hurtOnly: true };
    const hit = damage => creature({ id: "bear", name: "Bear", actions: [strike({ bonus: 50, effects: [rider], damage: [parseFormula("5", damage)] })] });
    const run = fight([hit("slashing"), orc({ iwr: { immune: ["slashing"] } })]);
    takeTurn(run, run.byId.get("bear"));
    expect(run.byId.get("orc").prone).toBeFalsy();
    const hurt = fight([hit("bludgeoning"), orc()]);
    takeTurn(hurt, hurt.byId.get("bear"));
    expect(hurt.byId.get("orc").prone).toBe(true);
  });

  const pox = (extra = {}) => ({
    kind: "affliction", id: "pox", name: "Pox", traits: ["disease"], save: { type: "fortitude", dc: 18 }, bySave: true,
    stages: [{ damage: [], conditions: { sickened: 1 } }, { damage: [], conditions: { sickened: 2 } }, { damage: [], conditions: { sickened: 3 } }], ...extra
  });
  const caster = aff => creature({ id: "witch", name: "Witch", actions: [{ id: "curse", name: "Curse", kind: "save", cost: 2, rank: 1, save: { type: "fortitude", dc: 30, basic: false }, damage: [], range: { increment: 60, max: 60, noPenalty: true }, effects: [aff] }] });

  test("an affliction bySave takes hold as the action's save went, rolling none of its own (a critical failure: stage 2); later, its own save", () => {
    const run = fight([caster(pox()), orc({ defenses: { ac: 16, fortitude: -100, reflex: 7, will: 7 } })]);
    const o = run.byId.get("orc");
    takeTurn(run, run.byId.get("witch"));
    expect(ofType(run, "afflictionSave")).toEqual([]);
    expect(ofType(run, "afflicted", "orc")).toHaveLength(1);
    expect(o.afflictions[0]).toMatchObject({ stage: 2 });
    expect(o.conds.sickened).toBe(2);
    endOfTurn(run, o);
    expect(ofType(run, "afflictionSave").length + ofType(run, "afflictionEnd").length + (o.afflictions[0]?.stage === 3 ? 1 : 0)).toBeGreaterThan(0);
    // (Not bySave: its own save on exposure, logged.)
    const own = fight([caster(pox({ bySave: false })), orc({ defenses: { ac: 16, fortitude: -100, reflex: 7, will: 7 } })]);
    takeTurn(own, own.byId.get("witch"));
    expect(ofType(own, "afflictionSave", "orc")).toHaveLength(1);
  });

  test("an affliction's worth counts its stages' conditions, not only their damage (Goblin Pox, no damage, is worth casting)", () => {
    const run = fight([caster(pox()), orc({ defenses: { ac: 16, fortitude: 0, reflex: 7, will: 7 }, actions: [strike({ bonus: 10 })] })]);
    const [w, o] = ["witch", "orc"].map(id => run.byId.get(id));
    expect(expectedDamage(run, w, w.prep.offense[0], o, 0)).toBeGreaterThan(0);
    // (On a strike: as often as it hits and its own save fails.)
    const venom = simpleAffliction({ id: "venom", key: "sickened", most: 2, save: { type: "fortitude", dc: 30 } });
    const biter = fight([creature({ id: "snake", actions: [strike({ id: "fang", bonus: 50, damage: [], effects: [venom] })] }), orc({ actions: [strike({ bonus: 10 })] })]);
    const [s, t] = ["snake", "orc"].map(id => biter.byId.get(id));
    expect(expectedDamage(biter, s, s.prep.offense[0], t, 0)).toBeGreaterThan(0);
  });
});

describe("the core's own conditions, as a system changes them", () => {
  test("a system's remedy for a core condition is tried in place of the core's own", () => {
    const douse = { key: "sys:burning", condition: "burning", label: null, cost: 1, try: () => ({ success: true }) };
    const run = fight([hero(), orc()], withHooks({ remedies: (r, u) => ((u.conds.burning ?? 0) > 0 ? [douse] : []) }));
    const h = run.byId.get("hero");
    lay(h, { burning: 1 });
    expect(remediesOf(run, h).map(r => r.key)).toEqual(["sys:burning"]);
  });

  test("rules.conditionProfile: no remedy (corroding's scrape-off), no penalties (but the harm and the hold), harm at the start of a turn", () => {
    const profile = key => ({ corroding: { remedy: null }, swallowed: { mods: null }, burning: { harmAt: "start" } })[key] ?? null;
    const rules = withHooks({ conditionProfile: profile });
    const run = fight([hero(), orc({ escapeDC: 18 })], rules);
    const [h, o] = ["hero", "orc"].map(id => run.byId.get(id));
    lay(h, { corroding: 1 });
    expect(remediesOf(run, h).some(r => r.condition === "corroding")).toBe(false);
    lay(h, { swallowed: 1 }, o);
    expect(h.mods?.attack ?? 0).toBe(0);
    expect(holdsOf(run, h).some(x => x.key === "swallowed")).toBe(true);
    // (And where the system says nothing, as the core has them.)
    const plain = fight([hero(), orc()]);
    const p = plain.byId.get("hero");
    lay(p, { corroding: 1 });
    lay(p, { swallowed: 1 }, plain.byId.get("orc"));
    expect(remediesOf(plain, p).some(r => r.condition === "corroding")).toBe(true);
    expect(p.mods.attack).toBe(-2);
  });

  test("harm at the start of its turn (harmAt: \"start\"), and not at the end", () => {
    const rules = withHooks({ conditionProfile: key => (key === "burning" ? { harmAt: "start" } : null) });
    const run = fight([hero(), orc()], rules);
    const h = run.byId.get("hero");
    lay(h, { burning: 1 });
    endOfTurn(run, h);
    expect(ofType(run, "persistent", "hero")).toEqual([]);
    playTurn(run, h);
    const burn = ofType(run, "persistent", "hero");
    expect(burn).toHaveLength(1);
    expect(run.log.indexOf(burn[0])).toBeLessThan(run.log.findIndex(e => e.actorId === "hero" && e.type === "attack"));
  });
});

describe("inside another creature, in every system", () => {
  const worm = (extra = {}) => orc({ id: "worm", name: "Worm", position: at(0), escapeDC: 18, actions: [strike({ bonus: -50 })], ...extra });
  const placed = (id, x) => hero({ id, name: id, position: at(x) });

  test("it's where its holder is, goes where it goes, and its holder's grab on it is over", () => {
    const run = fight([worm(), placed("hero", 30)], pf2eRules, { positioning: true });
    const [w, h] = ["worm", "hero"].map(id => run.byId.get(id));
    h.grabbedBy = "worm";
    lay(h, { swallowed: 1 }, w);
    expect(holderOf(run, h)).toBe(w);
    carryInside(run);
    expect(h.pos).toEqual({ x: 0, y: 0 });
    expect(h.grabbedBy).toBeNull();
    expect(h.adjacent.has("worm")).toBe(true);
    w.pos = { x: 40, y: 10 };
    playTurn(run, w);
    expect(h.pos).toEqual({ x: w.pos.x, y: w.pos.y });
  });

  test("it reaches its holder from inside; nothing outside reaches it, nor it them, but another inside with it", () => {
    const run = fight([worm(), placed("hero", 50), placed("friend", 60), orc({ id: "ogre", position: at(100) })], pf2eRules, { positioning: true });
    const [w, h, f, ogre] = ["worm", "hero", "friend", "ogre"].map(id => run.byId.get(id));
    lay(h, { swallowed: 1 }, w);
    const blow = h.spec.actions[0];
    expect(movesNeeded(run, h, w, blow)).toBe(0);
    expect(movesNeeded(run, h, ogre, blow)).toBe(Infinity);
    expect(movesNeeded(run, w, h, blow)).toBe(Infinity);
    expect(movesNeeded(run, f, h, blow)).toBe(Infinity);
    expect([cutOff(run, h, w), cutOff(run, ogre, h), cutOff(run, w, h)]).toEqual([false, true, true]);
    lay(f, { engulfed: 1 }, w);
    expect(cutOff(run, h, f)).toBe(false);
    // (Nobody outside goes for it.)
    expect(chooseTarget(run, run.byId.get("worm"))).toBeNull();
  });

  test("let go when its holder falls, unless the system says it keeps hold (a corpse to cut open); the system's say on being let go", () => {
    const seen = [];
    const keeps = withHooks({ letGo: (run, u, key, holder) => (seen.push([u.id, key, holder.id]), key === "swallowed" ? false : void (u.prone = true)) });
    const knight = () => creature({ id: "knight", actions: [strike({ bonus: 50, damage: [parseFormula("100", "slashing")] })] });
    for ( const [rules, key, still] of [[pf2eRules, "swallowed", false], [keeps, "swallowed", true], [keeps, "engulfed", false]] ) {
      const run = fight([worm(), hero(), knight()], rules);
      const [w, h] = ["worm", "hero"].map(id => run.byId.get(id));
      lay(h, { [key]: 1 }, w);
      takeTurn(run, run.byId.get("knight"));
      expect(w.status).not.toBe("standing");
      expect((h.conds[key] ?? 0) > 0).toBe(still);
      // (Let go of by the system's say: out, Prone.)
      if ( rules === keeps && key === "engulfed" ) expect(h.prone).toBe(true);
    }
    expect(seen).toEqual([["hero", "swallowed", "worm"], ["hero", "engulfed", "worm"]]);
  });

  test("kept inside a corpse, a friend frees it from beside the corpse, as the hold says (others: \"untie\")", () => {
    const corpse = withHooks({ letGo: (run, u) => {
      const e = u.effects.find(x => x.escape);
      e.escape = { ...e.escape, others: "untie" };
      return false;
    } });
    const run = fight([worm({ position: at(0) }), placed("hero", 30), placed("friend", 10), creature({ id: "knight", position: at(5), actions: [strike({ bonus: 50, damage: [parseFormula("100", "slashing")] })] })], corpse, { positioning: true });
    const [w, h, f] = ["worm", "hero", "friend"].map(id => run.byId.get(id));
    applyOutcome(h, { conditions: { swallowed: 1 }, rounds: 100, label: "", escape: { key: "swallowed", dc: 18, others: null } }, "worm", { id: "gulp" });
    carryInside(run);
    takeTurn(run, run.byId.get("knight"));
    expect(w.status).toBe("dead");
    expect(h.conds.swallowed).toBe(1);
    think(f, "free", h.id, 90);
    const plan = decideFallen(run, f, turnFor(run, f));
    expect(plan).toMatchObject({ kind: "free", target: h, hold: { key: "swallowed", others: "untie" } });
    expect(Number.isFinite(plan.moves)).toBe(true);
  });
});

describe("what the AI weighs", () => {
  test("a condition's harm in the system's terms (rules.conditionHarm), not the core's 2d6", () => {
    const big = withHooks({ conditionHarm: key => (key === "swallowed" ? [parseFormula("60", "acid")] : undefined) });
    const worth = rules => {
      const run = fight([hero(), orc()], rules);
      const [h, o] = ["hero", "orc"].map(id => run.byId.get(id));
      return outcomeWorth(run, o, h, { conditions: { swallowed: 1 }, rounds: 3 });
    };
    expect(worth(big)).toBeLessThan(worth(pf2eRules) - 50);
  });

  test("that a foe held inside can fight none but its holder: its blows at a friend are spared them", () => {
    const run = fight([hero({ actions: [strike({ bonus: 10, damage: [parseFormula("3d8", "slashing")] })] }), creature({ id: "page", name: "Page", side: "hostile", hp: { value: 10, max: 10 }, defenses: { ac: 10, fortitude: 0, reflex: 0, will: 0 } }),
      orc({ defenses: { ac: 30, fortitude: 7, reflex: 7, will: 7 } })]);
    const [h, page, o] = ["hero", "page", "orc"].map(id => run.byId.get(id));
    const swallow = { conditions: { swallowed: 1 }, rounds: 3 };
    h.targetId = "orc";
    const atHolder = outcomeWorth(run, o, h, swallow);
    h.targetId = "page";
    const atFriend = outcomeWorth(run, o, h, swallow);
    expect(atFriend).toBeLessThan(atHolder);
  });

  test("an opening only one foe allows draws it there (2014's behir swallows the one it's grappling)", () => {
    const swallow = { id: "swallow", name: "Swallow", kind: "control", cost: 1, melee: true, reach: 5, bonus: 50, grappledOnly: true, damage: [parseFormula("10", "piercing")],
      onHit: [null, null, { conditions: { swallowed: 1 }, rounds: 100, label: "" }, { conditions: { swallowed: 1 }, rounds: 100, label: "" }] };
    const rules = withHooks({ usable: (run, u, a, t) => !(a.grappledOnly && t && t.grabbedBy !== u.id) });
    const behir = creature({ id: "behir", name: "Behir", side: "hostile", hp: { value: 160, max: 160 }, escapeDC: 18, actions: [strike({ id: "bite", bonus: 10, damage: [parseFormula("2d6", "piercing")] }), swallow] });
    const run = fight([behir, hero({ hp: { value: 60, max: 60 } }), creature({ id: "archer", name: "Archer", hp: { value: 8, max: 60 } })], rules);
    const [b, h] = ["behir", "hero"].map(id => run.byId.get(id));
    h.grabbedBy = "behir";
    expect(chooseTarget(run, b)).toBe(h);
    // (With no grip on anyone, the archer it would have gone for.)
    h.grabbedBy = null;
    expect(chooseTarget(run, b)?.id).toBe("archer");
  });
});

describe("holds, checks and saves", () => {
  test("a hold whose condition is gone holds no longer: what it laid with it goes as it's broken", () => {
    const run = fight([hero(), orc()]);
    const h = run.byId.get("hero");
    applyOutcome(h, { conditions: { restrained: 1, offGuard: 1 }, rounds: 5, label: "Spike", escape: { key: "restrained", dc: 15, with: ["offGuard"] } }, "orc", { id: "spike" });
    const [hold] = holdsOf(run, h).filter(x => x.key === "restrained");
    release(run, h, hold);
    expect(h.conds.restrained ?? 0).toBe(0);
    expect(h.conds.offGuard ?? 0).toBe(0);
    // (One left with its condition gone: no hold.)
    applyOutcome(h, { conditions: { offGuard: 1 }, rounds: 5, label: "Stale", escape: { key: "restrained", dc: 15 } }, "orc", { id: "stale" });
    expect(holdsOf(run, h).some(x => x.effectKey === "stale")).toBe(false);
  });

  test("the rules hear what a check is for and the action that calls for it, and the action a save is against", () => {
    const checks = [];
    const saves = [];
    const rules = withHooks({ modifiers: { ...pf2eRules.modifiers, check: ctx => (checks.push(ctx), { bonus: 0, advantage: 0 }), save: ctx => (saves.push(ctx), { bonus: 0, advantage: 0 }) } });
    const run = fight([hero(), orc()], rules);
    const [h, o] = ["hero", "orc"].map(id => run.byId.get(id));
    const spell = { id: "daze", name: "Daze", kind: "save", rank: 1, save: { type: "will", dc: 15 } };
    checkRoll(run, h, 5, o, { purpose: "talk", skill: "diplomacy", action: spell });
    saveRoll(run, o, "will", { from: h, action: spell });
    expect(checks.at(-1)).toMatchObject({ unit: h, target: o, purpose: "talk", skill: "diplomacy", action: spell });
    expect(saves.at(-1)).toMatchObject({ unit: o, type: "will", from: h, action: spell });
  });

  test("a try at breaking free that hurts its holder (got.harm: PF2e, cutting free of a gullet)", () => {
    const rules = withHooks({ breakFree: () => ({ success: true, harm: { byType: { slashing: 12 } }, said: { text: "cuts its way out" } }) });
    const run = fight([hero(), orc({ escapeDC: 18 })], rules);
    const [h, o] = ["hero", "orc"].map(id => run.byId.get(id));
    applyOutcome(h, { conditions: { swallowed: 1 }, rounds: 100, label: "", escape: { key: "swallowed", dc: 18, others: null } }, "orc", { id: "gulp" });
    for ( let i = 0; i < 3 && (h.conds.swallowed ?? 0) > 0; i++ ) takeTurn(run, h);
    expect(h.conds.swallowed ?? 0).toBe(0);
    expect(o.hp).toBe(48);
  });
});

describe("spells, harm and attacks", () => {
  test("a spell the system says comes to nothing as it's cast (rules.disrupted): lost, told", () => {
    const bolt = { id: "bolt", name: "Bolt", kind: "spell-attack", cost: 2, rank: 1, bonus: 50, uses: 2, damage: [parseFormula("10", "force")], range: { increment: 60, max: 60, noPenalty: true } };
    const rules = withHooks({ disrupted: (run, u, action) => (action.rank ? { natural: 3, dc: 6, said: { text: "the spell slips away" } } : null) });
    const run = fight([hero({ actions: [bolt] }), orc()], rules);
    const [h, o] = ["hero", "orc"].map(id => run.byId.get(id));
    takeTurn(run, h);
    expect(ofType(run, "disrupted", "hero")[0]).toMatchObject({ action: "Bolt", text: "the spell slips away", natural: 3, dc: 6 });
    expect(o.hp).toBe(60);
    expect(h.uses.bolt).toBeLessThan(2);
  });

  test("afterHarm hears who did it and with what; afterAttack comes once the attack's damage is done", () => {
    const harmed = [];
    const attacks = [];
    const rules = withHooks({
      afterHarm: (run, u, amount, rng, ctx) => void harmed.push({ u: u.id, amount, by: ctx?.by?.id, types: ctx?.types, byType: ctx?.byType }),
      afterAttack: (run, u, t, ctx) => void attacks.push({ u: u.id, t: t.id, hp: t.hp, degree: ctx.degree, dealt: ctx.dealt, action: ctx.action.id })
    });
    const run = fight([hero({ actions: [strike({ id: "sword", bonus: 50, damage: [parseFormula("7", "slashing")] })] }), orc()], rules);
    takeTurn(run, run.byId.get("hero"));
    const dealt = attacks[0].dealt;
    expect(dealt).toBeGreaterThanOrEqual(7);
    expect(harmed[0]).toMatchObject({ u: "orc", amount: dealt, by: "hero", types: ["slashing"], byType: { slashing: dealt } });
    expect(attacks[0]).toMatchObject({ u: "hero", t: "orc", hp: 60 - dealt, action: "sword" });
    expect(attacks[0].degree).toBeGreaterThanOrEqual(2);
  });
});
