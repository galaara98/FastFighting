/**
 * What lies on the ground (engine/behavior/forage.js): hunger as the fight begins (the helper's diet and chance, the
 * GM's mark, the famished at any wisdom, wisdom against the rest), eating the meat of the dead (a foe's; a teammate's
 * only for a cannibal or a feral mind) and food in a pile, and a pile's valuables for a thief when it's safe.
 */
import { describe, expect, test } from "vitest";
import { beginRun, prepareBattle, takeTurn, beginRound } from "../scripts/engine/simulator.js";
import { initForage, forageWishes, hungryLevel, FAMISHED, meatLeft } from "../scripts/engine/behavior/forage.js";
import { diffOutcome } from "../scripts/engine/changes.js";
import { captureUnit } from "../scripts/engine/simulator.js";
import { STATUS } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
const mind = (tactical = 50, selfish = 40) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 60, fudge: 0 }, selfish: { base: selfish, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const hyena = (id, extra = {}) => creature({ id, name: id, side: "hostile", animalistic: true, diet: "meat", hunger: 0, size: 2, traits: mind(30), ...at(0), ...extra });
const hero = (extra = {}) => creature({ id: "hero", name: "Hero", kind: "pc", diesAtZero: false, hp: { value: 200, max: 200 }, actions: [strike({ bonus: -50, damage: [parseFormula("1", "slashing")] })], ...at(200), ...extra });

function fight(combatants, { piles = [], options = {}, seed = 1 } = {}) {
  const spec = { ...battle(combatants, { positioning: true, maxRounds: 5, ...options }), piles };
  const run = beginRun(prepareBattle(spec, pf2eRules), seed, { log: true });
  beginRound(run, 1);
  return { run, by: id => run.byId.get(id) };
}

describe("hunger", () => {
  test("only a creature that eats (the helper's diet); the GM's mark over the roll", () => {
    const { by } = fight([hyena("none", { diet: null, hunger: 1 }), hyena("mark", { hungry: "hungry" }), hyena("full", { hunger: 1, hungry: "sated" }), hyena("starving", { hungry: "famished" }), hero()]);
    expect(by("none").hunger).toBeNull();
    expect(by("mark").hunger).toMatchObject({ famished: false });
    expect(by("full").hunger).toBeNull();
    expect(by("starving").hunger).toEqual({ famished: true, level: FAMISHED.level });
  });

  test("the wiser, the less it minds hunger mid-fight; a feral mind more", () => {
    const { run, by } = fight([hyena("dull", { aptitudes: { wise: 0 } }), hyena("sage", { aptitudes: { wise: 4 }, traits: mind(60) }), hyena("wild", { aptitudes: { wise: 0 }, traits: mind(5) }), hero()]);
    expect(hungryLevel(run, by("dull"))).toBe(60);
    expect(hungryLevel(run, by("sage"))).toBe(12);
    expect(hungryLevel(run, by("wild"))).toBe(70);
  });

  test("famished now and then, at any wisdom (about 3%)", () => {
    let famished = 0;
    const n = 600;
    for ( let seed = 1; seed <= n; seed++ ) {
      const { by } = fight([hyena("sage", { aptitudes: { wise: 4 }, hunger: 0 }), hero()], { seed });
      if ( by("sage").hunger?.famished ) famished += 1;
    }
    expect(famished / n).toBeGreaterThan(0.01);
    expect(famished / n).toBeLessThan(0.06);
  });
});

describe("the meat of the dead", () => {
  const kobold = (id, extra = {}) => creature({ id, name: id, side: "friendly", meat: 4, ...at(5), ...extra });

  test("a hungry meat-eater goes to a fallen foe and eats, a portion an action, until it has had its fill", () => {
    const { run, by } = fight([hyena("hyena", { hungry: "famished" }), kobold("kobold"), hero()]);
    Object.assign(by("kobold"), { status: STATUS.DEAD, hp: 0 });
    const before = captureUnit(by("hyena"), pf2eRules);
    takeTurn(run, by("hyena"));
    expect(run.log.some(e => e.type === "eat" && e.actorId === "hyena" && e.targetId === "kobold")).toBe(true);
    expect(meatLeft(by("kobold"))).toBeLessThan(4);
    expect(run.log.some(e => e.type === "eat" && e.sated)).toBe(true);
    expect(by("hyena").hunger).toBeNull();
    // (Kept for the sheets: eaten, off the body.)
    expect(diffOutcome(before, captureUnit(by("hyena"), pf2eRules)).foraged).toEqual(expect.arrayContaining([expect.objectContaining({ source: "kobold", eaten: true, pile: false })]));
  });

  test("only a beast or a feral mind eats a body, or raw meat: anyone else, prepared food alone", () => {
    const larder = { id: "larder", name: "Larder", x: 10, y: 0, size: 5, money: 0, items: [
      { id: "steak", name: "Uncooked meat", value: 0, quantity: 2, food: { portions: 2, meat: true } },
      { id: "bread", name: "Bread", value: 1, quantity: 1, food: { portions: 1, meat: false } }] };
    const { run, by } = fight([creature({ id: "cook", side: "hostile", diet: "any", hungry: "famished", traits: mind(50), ...at(0) }), kobold("kobold"), hero()], { piles: [larder] });
    Object.assign(by("kobold"), { status: STATUS.DEAD, hp: 0 });
    forageWishes(run, by("cook"));
    expect(by("cook").forage.map(f => f.sourceId)).toEqual(["larder"]);
    takeTurn(run, by("cook"));
    expect(by("cook").foraged.every(f => f.item?.id === "bread")).toBe(true);
  });

  test("a teammate's body only for a cannibal or a feral mind", () => {
    const wants = extra => {
      const { run, by } = fight([hyena("hyena", { hungry: "famished", ...extra }), hyena("mate", { ...at(5), meat: 4 }), hero()]);
      Object.assign(by("mate"), { status: STATUS.DEAD, hp: 0 });
      forageWishes(run, by("hyena"));
      return by("hyena").forage.some(f => f.kind === "eat" && f.sourceId === "mate");
    };
    expect(wants({})).toBe(false);
    expect(wants({ cannibal: true })).toBe(true);
    expect(wants({ traits: mind(5) })).toBe(true);
  });

  test("a player character's body only where the GM's setting says so", () => {
    const wants = pcMeat => {
      const { run, by } = fight([hyena("hyena", { hungry: "famished" }), creature({ id: "pal", kind: "pc", meat: 4, ...at(5) }), hero()], { options: { pcMeat } });
      Object.assign(by("pal"), { status: STATUS.DEAD, hp: 0 });
      forageWishes(run, by("hyena"));
      return by("hyena").forage.some(f => f.sourceId === "pal");
    };
    expect(wants(false)).toBe(false);
    expect(wants(true)).toBe(true);
  });
});

describe("piles", () => {
  const chest = (extra = {}) => ({ id: "chest", name: "Chest", x: 15, y: 0, size: 5, money: 5000, items: [{ id: "idol", name: "Idol", value: 9000, quantity: 1, food: null }], ...extra });
  const thief = (extra = {}) => creature({ id: "thief", name: "Thief", side: "hostile", playstyles: ["thief"], traits: mind(50, 70), valuables: { money: 10, stowed: [], wielded: [], worn: [] }, ...at(0), ...extra });

  test("a thief goes for a rich chest over the fight when it's safe: the best of it first", () => {
    const { run, by } = fight([thief(), creature({ id: "mate", side: "hostile", ...at(0, 20) }), hero()], { piles: [chest()] });
    takeTurn(run, by("thief"));
    expect(run.log.some(e => e.type === "scavenge" && e.actorId === "thief" && e.targetId === "chest" && e.item === "Idol")).toBe(true);
    expect(by("thief").foraged[0]).toMatchObject({ source: "chest", pile: true, item: { id: "idol" }, count: 1 });
    expect(run.piles.get("chest").items[0].quantity).toBe(0);
  });

  test("not with a foe at its side, nor an animal (no hands for it), nor one with no greed", () => {
    const beset = fight([thief(), hero(at(5))], { piles: [chest()] });
    forageWishes(beset.run, beset.by("thief"));
    expect(beset.by("thief").forage).toEqual([]);
    const beast = fight([thief({ animalistic: true }), hero()], { piles: [chest()] });
    forageWishes(beast.run, beast.by("thief"));
    expect(beast.by("thief").forage).toEqual([]);
    const honest = fight([thief({ playstyles: [], traits: mind(50, 20) }), hero()], { piles: [chest()] });
    forageWishes(honest.run, honest.by("thief"));
    expect(honest.by("thief").forage).toEqual([]);
  });

  test("food in a pile, for the hungry, as its diet allows", () => {
    const larder = { id: "larder", name: "Larder", x: 10, y: 0, size: 5, money: 0, items: [{ id: "bread", name: "Bread", value: 1, quantity: 3, food: { portions: 3, meat: false } }] };
    const { run, by } = fight([hyena("goat", { diet: "plants", hungry: "famished" }), hyena("wolf", { diet: "meat", hungry: "famished", ...at(0, 5) }), hero()], { piles: [larder] });
    forageWishes(run, by("goat"));
    forageWishes(run, by("wolf"));
    expect(by("goat").forage[0]).toMatchObject({ kind: "eat", sourceId: "larder" });
    expect(by("wolf").forage).toEqual([]);
    takeTurn(run, by("goat"));
    expect(run.piles.get("larder").items[0].quantity).toBeLessThan(3);
    expect(by("goat").foraged.some(f => f.item?.id === "bread" && f.eaten)).toBe(true);
  });

  test("the fight's piles are its own: another fight begins with them full", () => {
    const { run } = fight([thief(), hero()], { piles: [chest()] });
    run.piles.get("chest").money = 0;
    initForage(run);
    expect(run.piles.get("chest").money).toBe(5000);
  });
});
