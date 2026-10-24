/**
 * One that would rather its magic (a caster by its tactics, or Un-Mundane by its playstyles: behavior/targeting.js
 * rathersMagic): a plain blow counts half to it, so its spells win where both fit; and it doesn't walk up to a foe
 * for a plain blow when its spell won't fit the turn. Beside a foe already, it may still swing.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, prepareBattle, takeTurn } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const at = x => ({ position: { x, y: 0, size: 5 } });
// (A spell that takes the whole turn, out to 30 feet: from 40 feet, a Stride and it, too much for one turn.)
const arc = { id: "arc", name: "Electric Arc", kind: "save", rank: 0, magical: true, save: { type: "reflex", dc: 17, basic: true }, range: { increment: 30, max: 30, noPenalty: true }, cost: 3, damage: [parseFormula("2d4", "electricity")] };

function fight(wizard, foeAt = 40) {
  const spec = battle([
    creature({ id: "wizard", kind: "pc", hp: { value: 16, max: 16 }, speeds: { walk: 40 }, actions: [strike({ id: "fist", name: "Unarmed Attack", bonus: 5, damage: [parseFormula("1d4", "bludgeoning")] }), arc], ...at(0), ...wizard }),
    creature({ id: "foe", side: "hostile", hp: { value: 30, max: 30 }, actions: [strike({ bonus: -50 })], flags: { fearless: true }, ...at(foeAt) })
  ], { maxRounds: 3, positioning: true, aftermath: "none", opening: "fight" });
  const run = beginRun(prepareBattle(spec, pf2eRules), 5, { log: true });
  beginRound(run, 1);
  takeTurn(run, run.byId.get("wizard"));
  return run.log.filter(e => e.actorId === "wizard");
}

describe("one that would rather its magic", () => {
  test("a caster doesn't walk up to a foe for a plain blow when its spell won't fit the turn", () => {
    const did = fight({ tactics: { style: "caster" } });
    expect(did.some(e => e.type === "attack" && e.action === "Unarmed Attack")).toBe(false);
  });

  test("nor one Un-Mundane", () => {
    const did = fight({ playstyles: ["unmundane"] });
    expect(did.some(e => e.type === "attack" && e.action === "Unarmed Attack")).toBe(false);
  });

  test("anyone else does", () => {
    const did = fight({ tactics: { style: "frontline" } });
    expect(did.some(e => e.type === "attack" && e.action === "Unarmed Attack")).toBe(true);
  });

  test("beside a foe already, it may still swing", () => {
    const did = fight({ tactics: { style: "caster" }, actions: [strike({ id: "fist", name: "Unarmed Attack", bonus: 5, damage: [parseFormula("1d4", "bludgeoning")] }), { ...arc, cost: 4 }] }, 5);
    expect(did.some(e => e.type === "attack" && e.action === "Unarmed Attack")).toBe(true);
  });
});

describe("one Un-Mundane and its fists", () => {
  const fist = strike({ id: "fist", name: "Unarmed Attack", bonus: 9, traits: ["agile", "unarmed"], damage: [parseFormula("1d4", "bludgeoning")] });
  const staff = strike({ id: "staff", name: "Staff", bonus: 3, damage: [parseFormula("1d4", "bludgeoning")] });
  // (Beside its foe, its spell too much for the turn: it can only swing.)
  const big = { ...arc, cost: 4 };
  const swung = actions => fight({ playstyles: ["unmundane"], actions }, 5).filter(e => e.type === "attack").map(e => e.action);

  test("with a weapon, never its fist, however much better the fist", () => {
    const used = swung([fist, staff, big]);
    expect(used).not.toContain("Unarmed Attack");
    expect(used).toContain("Staff");
  });

  test("with a spell it can still cast, no fist either", () => {
    expect(swung([fist, big])).not.toContain("Unarmed Attack");
  });

  test("out of everything else: its fist", () => {
    expect(swung([fist, { ...big, uses: 0 }])).toContain("Unarmed Attack");
  });

  test("anyone else punches as it likes", () => {
    const used = fight({ actions: [fist, staff, big] }, 5).filter(e => e.type === "attack").map(e => e.action);
    expect(used).toContain("Unarmed Attack");
  });
});
