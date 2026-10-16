/**
 * Holds (behavior/holds.js): breaking free of what holds a creature (tied up, a grab, what the system says an action
 * breaks), and freeing a friend; the system's own say on it; tied up as something on the creature, from no one.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, prepareBattle } from "../scripts/engine/simulator.js";
import { holdsOf, tryHold, isBound, bears, release } from "../scripts/engine/behavior/holds.js";
import { recompute } from "../scripts/engine/behavior/effects.js";
import { mind } from "../scripts/engine/behavior/desire.js";
import { beginLive, liveRound, setCondition, conditionsOf, networkOf } from "../scripts/engine/live.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const traits = (loyal = 60) => ({ tactical: { base: 60, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: loyal, fudge: 0 } });
const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
/** A neutral desire style, with what the test says on top. */
const emptyStyle = () => ({ hurt: {}, avoid: {}, heal: 0, protect: 0, aid: 0, talk: 0, bind: 0, rob: 0, free: 0, rid: 0, whim: 0, contrarian: 0, retaliate: 1, avenge: 1, cool: 1, frustration: 1, leader: 1, doorPatience: 1 });
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

describe("tied up, it may bear its bonds", () => {
  // (A spell at range that needs no hands, or one the helper said nothing about.)
  const bolt = (extra = {}) => strike({ id: "bolt", name: "Bolt", bonus: 20, range: { increment: 60, max: 120 }, melee: false, magical: true, damage: [parseFormula("3d6", "fire")], ...extra });
  const caster = (brave, extra = {}) => fighter("mage", "hostile", 30, { traits: { ...traits(), brave: { base: brave, fudge: 0 } }, actions: [bolt(extra)], escapeWork: { mod: 60 } });

  test("brave, with a spell that needs no hands at a foe in range: it casts from its bonds, and doesn't struggle", () => {
    const run = fight([fighter("hero", "friendly", 0), caster(95, { hands: 0 })]);
    const mage = tie(run.byId.get("mage"));
    takeTurn(run, mage);
    expect(run.log.some(e => e.actorId === "mage" && e.type === "attack" && e.targetId === "hero")).toBe(true);
    expect(run.log.some(e => e.actorId === "mage" && e.type === "escape")).toBe(false);
    expect([mage.status, isBound(mage)]).toEqual(["bound", true]);
  });

  test("fearful, the same spell or not: it would rather be loose", () => {
    const run = fight([fighter("hero", "friendly", 0), caster(5, { hands: 0 })]);
    const mage = tie(run.byId.get("mage"));
    takeTurn(run, mage);
    expect(run.log.some(e => e.actorId === "mage" && e.type === "escape")).toBe(true);
  });

  test("a spell the helper says nothing about: tied up stops it, unless the helper's setting says it doesn't", () => {
    const run = fight([fighter("hero", "friendly", 0), caster(95)]);
    const mage = tie(run.byId.get("mage"));
    takeTurn(run, mage);
    expect(run.log.some(e => e.actorId === "mage" && e.type === "attack")).toBe(false);
    expect(run.log.some(e => e.actorId === "mage" && e.type === "escape")).toBe(true);
    const free = fight([fighter("hero", "friendly", 0), caster(95)], { ...pf2eRules, tiedStopsSpells: false });
    const m = tie(free.byId.get("mage"));
    takeTurn(free, m);
    expect(free.log.some(e => e.actorId === "mage" && e.type === "attack")).toBe(true);
  });

  test("tied up, it can't go anywhere: no moving toward a foe out of reach", () => {
    const run = fight([fighter("hero", "friendly", 0), caster(95, { hands: 0, range: { increment: 10, max: 10 } })]);
    const mage = tie(run.byId.get("mage"));
    takeTurn(run, mage);
    expect(run.log.some(e => e.actorId === "mage" && e.type === "move")).toBe(false);
  });
});

describe("being rid of what hurts it, or bearing it", () => {
  const burning = u => u.persistent.push({ part: parseFormula("2d6", "fire"), sourceId: "hero" });

  test("on fire, a fearful one tries to put itself out (one more try at the system's recovery); a bold Martyr fights on", () => {
    const run = fight([fighter("hero", "friendly", 0), fighter("orc", "hostile", 5, { traits: { ...traits(), brave: { base: 5, fudge: 0 } }, hp: { value: 30, max: 30 } })]);
    const orc = run.byId.get("orc");
    burning(orc);
    takeTurn(run, orc);
    expect(run.log.find(e => e.actorId === "orc" && e.type === "remedy")).toMatchObject({ what: "persistent:fire", damageType: "fire" });
    const bold = fight([fighter("hero", "friendly", 0), fighter("orc", "hostile", 5, { traits: { ...traits(), brave: { base: 95, fudge: 0 } }, hp: { value: 300, max: 300 }, desireStyle: { ...emptyStyle(), rid: -25 } })]);
    const b = bold.byId.get("orc");
    burning(b);
    takeTurn(bold, b);
    expect(bold.log.some(e => e.actorId === "orc" && e.type === "remedy")).toBe(false);
    expect(bold.log.some(e => e.actorId === "orc" && e.type === "attack")).toBe(true);
  });

  test("the slider: a fully selfless, uncalculating creature bears it that often, a calculating or selfish one less; never what would kill it", () => {
    const run = fight([fighter("hero", "friendly", 0), fighter("orc", "hostile", 5)], { ...pf2eRules });
    run.prep.options.ignoreTroubles = 29;
    const orc = run.byId.get("orc");
    const rate = (selfish, tactical) => {
      Object.assign(orc.prep.traits, { selfish, tactical });
      let n = 0;
      for ( let r = 1; r <= 4000; r++ ) {
        run.round = r;
        if ( bears(run, orc) ) n += 1;
      }
      return n / 4000;
    };
    expect(rate(0, 0)).toBeCloseTo(0.29, 1);
    expect(rate(50, 0)).toBeCloseTo(0.145, 1);
    expect(rate(0, 100)).toBe(0);
    // (Even the selfless don't want to die: harm that would drop it this round.)
    Object.assign(orc.prep.traits, { selfish: 0, tactical: 0 });
    orc.hp = 3;
    burning(orc);
    run.round = 9000;
    let borne = 0;
    for ( let r = 9000; r < 9200; r++ ) {
      run.round = r;
      if ( bears(run, orc) ) borne += 1;
    }
    expect(borne).toBe(0);
  });

  test("broken free of restraints, it can move again (unless another hold still keeps it in place)", () => {
    const run = fight([fighter("hero", "friendly", 0), fighter("orc", "hostile", 40)]);
    const orc = run.byId.get("orc");
    orc.effects.push({ key: "web", conditions: { restrained: 1, immobilized: 1 }, sourceId: "hero", rounds: Infinity, escape: { dc: 10, others: null } });
    recompute(orc);
    const hold = holdsOf(run, orc).find(h => h.key === "restrained");
    release(run, orc, hold);
    expect([orc.conds.restrained ?? 0, orc.conds.immobilized ?? 0]).toEqual([0, 0]);
  });
});

describe("caught by a hazard", () => {
  const snare = (x, extra = {}) => creature({ id: "snare", name: "Snare", side: "hostile", kind: "hazard", hazard: { once: false }, untargetable: true, speeds: {}, position: { x, y: 0, size: 5 }, ...extra });

  test("held by a hazard, it always weighs getting out (worse in its reach); a friend who sees it ponders freeing it, with a roll", () => {
    // (A foe across the room: the fight goes on.)
    const run = fight([fighter("hero", "friendly", 0), fighter("kyra", "friendly", 10, { tactics: { allyDying: "rescue" }, escapeWork: { mod: 60 } }), snare(5, { escapeDC: 12 }), fighter("orc", "hostile", 200)]);
    const hero = run.byId.get("hero");
    hero.grabbedBy = "snare";
    const hold = holdsOf(run, hero)[0];
    expect(hold).toMatchObject({ key: "grabbed", byId: "snare", dc: 12, others: "check", hazard: true });
    takeTurn(run, run.byId.get("kyra"));
    expect(run.log.find(e => e.actorId === "kyra" && e.type === "free")).toMatchObject({ targetId: "hero", hold: "grabbed", success: true, dc: 12 });
    expect(hero.grabbedBy).toBe(null);
  });

  test("its own escape: weighed as a desire (no even chance at the turn's start)", () => {
    const run = fight([fighter("hero", "friendly", 0, { escapeWork: { mod: 60 } }), snare(5), fighter("orc", "hostile", 200)]);
    const hero = run.byId.get("hero");
    hero.grabbedBy = "snare";
    takeTurn(run, hero);
    expect(run.log.find(e => e.actorId === "hero" && e.type === "escape")).toMatchObject({ hold: "grabbed", success: true });
  });
});

describe("freeing a friend", () => {
  test("a friend tied up, and no foe on it: one who'd rescue a friend goes over and unties them (no roll)", () => {
    const run = fight([fighter("hero", "friendly", 0, { tactics: { allyDying: "rescue" } }), fighter("kyra", "friendly", 10), fighter("orc", "hostile", 120)]);
    const kyra = tie(run.byId.get("kyra"), "orc");
    const hero = run.byId.get("hero");
    takeTurn(run, hero);
    expect(run.log.find(e => e.actorId === "hero" && e.type === "free")).toMatchObject({ targetId: "kyra", hold: "bound", success: true });
    expect([kyra.status, isBound(kyra)]).toEqual(["standing", false]);
  });

  test("one who looks after itself goes for the foe instead; so does one with little loyalty", () => {
    for ( const extra of [{ tactics: { allyDying: "protectSelf" } }, { traits: traits(30) }] ) {
      const run = fight([fighter("hero", "friendly", 0, extra), fighter("kyra", "friendly", 10), fighter("orc", "hostile", 120)]);
      tie(run.byId.get("kyra"), "orc");
      const hero = run.byId.get("hero");
      takeTurn(run, hero);
      expect(run.log.some(e => e.actorId === "hero" && e.type === "free")).toBe(false);
      expect(run.log.some(e => e.actorId === "hero" && e.type === "move" && e.towardId === "orc")).toBe(true);
    }
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
