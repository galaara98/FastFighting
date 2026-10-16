/**
 * The GM's conditions in a live battle (the Battle Interface): any the core knows put on, changed and taken off, who
 * caused it remembered; those toward someone (afraid of, grabbed by, goaded by, controlled by, tied up by, off guard
 * to, marked by); what its sheet shows kept as the sheet says, the rest by the core alone.
 */
import { describe, expect, test } from "vitest";
import { beginLive, liveRound, liveTurn, setCondition, setRelation, clearRelation, conditionsOf, syncFromSheets, snapshotRun, restoreRun, captureAll } from "../scripts/engine/live.js";
import { CORE_CONDITIONS, RELATIONS, GM_RELATIONS, validConditionKey } from "../scripts/engine/conditions.js";
import { applyOutcome } from "../scripts/engine/behavior/effects.js";
import { diffAll } from "../scripts/engine/changes.js";
import { levelOf, conditionWishes } from "../scripts/engine/behavior/desire.js";
import { moraleStress } from "../scripts/engine/behavior/morale.js";
import { liveTrait } from "../scripts/engine/battle-state.js";
import { STATUS } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const fight = () => battle([
  creature({ id: "valeros", name: "Valeros", kind: "pc", diesAtZero: false, position: at(0), hp: { value: 40, max: 40 } }),
  creature({ id: "kyra", name: "Kyra", kind: "pc", diesAtZero: false, position: at(0, 10), hp: { value: 30, max: 30 } }),
  creature({ id: "orc", name: "Orc", side: "hostile", position: at(10), hp: { value: 35, max: 35 }, actions: [strike({ id: "axe", damage: [parseFormula("1d12+4", "slashing")] })] }),
  creature({ id: "goblin", name: "Goblin", side: "hostile", position: at(15, 5), hp: { value: 14, max: 14 } })
], { positioning: true, maxRounds: 10 });
const start = () => beginLive(fight(), pf2eRules, { seed: 1, players: ["valeros", "kyra"] });

describe("the core's conditions", () => {
  test("a list of its own, the counted ones marked; and those toward someone", () => {
    const keys = CORE_CONDITIONS.map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(["prone", "offGuard", "frightened", "incapacitated", "immobilized", "unconscious", "blinded"]));
    expect(CORE_CONDITIONS.find(c => c.key === "frightened").valued).toBe(true);
    // (Tied up is on the creature, a condition of its own: not toward the one who tied it.)
    expect(GM_RELATIONS).toEqual(RELATIONS.filter(k => k !== "marked" && k !== "bound"));
    expect(CORE_CONDITIONS.some(c => c.key === "bound")).toBe(true);
    expect(validConditionKey("offGuard")).toBe(true);
    expect(validConditionKey("<script>")).toBe(false);
  });
});

describe("the GM sets a condition", () => {
  test("put on with who caused it, for so many rounds or until taken off; its value changed; taken off", () => {
    const run = start();
    const goblin = run.byId.get("goblin");
    expect(setCondition(run, "goblin", { key: "frightened", value: 2, byId: "valeros", rounds: 3 })).toBe(true);
    expect(goblin.conds.frightened).toBe(2);
    expect(conditionsOf(run, "goblin").conditions).toEqual([{ key: "frightened", value: 2, sheet: false, sources: [{ byId: "valeros", rounds: 3, gm: true, label: "" }] }]);
    // (Changed: the GM's word over whatever gave it, here the GM's own.)
    setCondition(run, "goblin", { key: "frightened", value: 1 });
    expect(goblin.conds.frightened).toBe(1);
    expect(goblin.effects.filter(e => e.conditions?.frightened)).toHaveLength(1);
    setCondition(run, "goblin", { key: "frightened", value: 0 });
    expect(goblin.conds.frightened ?? 0).toBe(0);
    // Prone is its own thing.
    setCondition(run, "goblin", { key: "prone", value: 1 });
    expect(goblin.prone).toBe(true);
    expect(conditionsOf(run, "goblin").conditions[0]).toMatchObject({ key: "prone", value: 1 });
    expect(setCondition(run, "goblin", { key: "no such thing!" })).toBe(false);
  });

  test("taken off what put it there too: a power's condition goes, the rest of that power stays", () => {
    const run = start();
    const valeros = run.byId.get("valeros");
    applyOutcome(valeros, { conditions: { frightened: 2, offGuard: 1 }, rounds: 2, label: "Scare" }, "orc", { id: "orc.scare", name: "Scare" });
    setCondition(run, "valeros", { key: "frightened", value: 0 });
    expect(valeros.conds.frightened ?? 0).toBe(0);
    expect(valeros.conds.offGuard).toBe(1);
    expect(valeros.effects.find(e => e.sourceId === "orc").conditions).toEqual({ offGuard: 1 });
  });

  test("what its sheet carries, the sheet keeps it from then on; the rest the core keeps, through the turn's sync and a reload", () => {
    const run = start();
    const goblin = run.byId.get("goblin");
    setCondition(run, "goblin", { key: "frightened", value: 2, byId: "kyra" });
    setCondition(run, "goblin", { key: "dazed", value: 1, byId: "kyra" });
    const carries = k => k === "frightened";
    // The sheet shows frightened (written there); dazed it has no mark for.
    syncFromSheets(run, { goblin: { conditions: { frightened: 2 }, carries } });
    expect(goblin.conds).toMatchObject({ frightened: 2, dazed: 1 });
    expect(conditionsOf(run, "goblin").conditions.find(c => c.key === "frightened")).toMatchObject({ sheet: true, sources: [expect.objectContaining({ byId: "kyra" })] });
    const again = restoreRun(fight(), pf2eRules, snapshotRun(run));
    expect(again.byId.get("goblin").conds).toMatchObject({ frightened: 2, dazed: 1 });
    // Taken off the sheet at the table: gone; dazed stays until the GM takes it off.
    syncFromSheets(run, { goblin: { conditions: {}, carries } });
    expect(goblin.conds.frightened ?? 0).toBe(0);
    expect(goblin.conds.dazed).toBe(1);
  });

  test("the turn's change set has it, for the helper to write", () => {
    const run = start();
    const before = captureAll(run);
    setCondition(run, "orc", { key: "stunned", value: 1 });
    expect(diffAll(before, captureAll(run)).orc.conditions).toEqual({ set: { stunned: 1 }, cleared: [] });
  });
});

describe("conditions toward someone", () => {
  test("afraid of: a fear (the wish to keep away), at the band the GM says; taken off, gone, whatever made it", () => {
    const run = start();
    const orc = run.byId.get("orc");
    setRelation(run, "orc", { kind: "afraid", byId: "valeros", level: 3 });
    expect(levelOf(orc, "avoid", "valeros")).toBe(70);
    expect(conditionsOf(run, "orc").relations).toEqual([expect.objectContaining({ kind: "afraid", byId: "valeros", band: 3, gm: true })]);
    orc.grudges = new Map([["valeros", { provoked: false }]]);
    clearRelation(run, "orc", { kind: "afraid", byId: "valeros" });
    expect(levelOf(orc, "avoid", "valeros")).toBe(0);
    expect(orc.grudges.has("valeros")).toBe(false);
  });

  test("grabbed by, goaded by, controlled by, off guard to: each where the engine keeps it, and taken off again", () => {
    const run = start();
    const goblin = run.byId.get("goblin");
    setRelation(run, "goblin", { kind: "grabbed", byId: "valeros" });
    setRelation(run, "goblin", { kind: "goaded", byId: "kyra", rounds: 2 });
    setRelation(run, "goblin", { kind: "exposedTo", byId: "valeros" });
    expect(goblin.grabbedBy).toBe("valeros");
    expect(goblin.vs.get("valeros")).toMatchObject({ offGuard: 1 });
    const kinds = conditionsOf(run, "goblin").relations.map(r => `${r.kind}:${r.byId}`).sort();
    expect(kinds).toEqual(["exposedTo:valeros", "goaded:kyra", "grabbed:valeros"]);
    // Controlled: it fights for its controller's side, until it isn't.
    setRelation(run, "goblin", { kind: "controlled", byId: "valeros" });
    expect(goblin.controlledBy).toBe("valeros");
    expect(goblin.side).toBe("friendly");
    clearRelation(run, "goblin", { kind: "controlled", byId: "valeros" });
    expect(goblin.controlledBy).toBeNull();
    expect(goblin.side).toBe("hostile");
    for ( const kind of ["grabbed", "exposedTo"] ) clearRelation(run, "goblin", { kind, byId: "valeros" });
    clearRelation(run, "goblin", { kind: "goaded", byId: "kyra" });
    expect(conditionsOf(run, "goblin").relations).toEqual([]);
    expect(goblin.grabbedBy).toBeNull();
  });

  test("tied up by: awake, a prisoner, out of the fight; let go, back up; a power's mark only taken off", () => {
    const run = start();
    const orc = run.byId.get("orc");
    setRelation(run, "orc", { kind: "bound", byId: "valeros" });
    expect(orc).toMatchObject({ boundBy: "valeros", status: STATUS.BOUND });
    clearRelation(run, "orc", { kind: "bound", byId: "valeros" });
    expect(orc).toMatchObject({ boundBy: null, status: STATUS.STANDING });
    applyOutcome(orc, { mark: [parseFormula("1d6", "precision")], rounds: 10 }, "kyra", { id: "kyra.mark", name: "Mark" });
    expect(conditionsOf(run, "orc").relations).toEqual([expect.objectContaining({ kind: "marked", byId: "kyra" })]);
    expect(setRelation(run, "orc", { kind: "marked", byId: "kyra" })).toBe(false);
    clearRelation(run, "orc", { kind: "marked", byId: "kyra" });
    expect(orc.marks).toEqual([]);
  });
});

describe("conditions into behaviour", () => {
  test("frightened by someone: it would rather keep away from them, the worse the more (the bold less); fleeing from them: it runs", () => {
    const run = start();
    const orc = run.byId.get("orc");
    const nerve = (50 - liveTrait(run, orc, "brave")) * 0.3;
    applyOutcome(orc, { conditions: { frightened: 1 }, rounds: 3 }, "valeros", { id: "valeros.scare", name: "Scare" });
    conditionWishes(run, orc);
    expect(levelOf(orc, "avoid", "valeros")).toBeCloseTo(35 + nerve);
    orc.desire.logic.clear();
    applyOutcome(orc, { conditions: { frightened: 3 }, rounds: 3 }, "valeros", { id: "valeros.scare", name: "Scare" });
    conditionWishes(run, orc);
    expect(levelOf(orc, "avoid", "valeros")).toBeCloseTo(65 + nerve);
    // (Fearful, more so.)
    orc.desire.logic.clear();
    orc.prep.traits.brave = 10;
    conditionWishes(run, orc);
    expect(levelOf(orc, "avoid", "valeros")).toBeGreaterThan(65 + nerve);
    orc.desire.logic.clear();
    applyOutcome(orc, { conditions: { fleeing: 1 }, rounds: 1 }, "kyra", { id: "kyra.fear", name: "Fear" });
    conditionWishes(run, orc);
    expect(levelOf(orc, "avoid", "kyra")).toBe(80);
  });

  test("grabbed: set on whoever holds it", () => {
    const run = start();
    const goblin = run.byId.get("goblin");
    setRelation(run, "goblin", { kind: "grabbed", byId: "kyra" });
    conditionWishes(run, goblin);
    expect(levelOf(goblin, "hurt", "kyra")).toBe(50);
  });

  test("charmed by someone: it never attacks them, though they're the one it would", () => {
    const shotAt = charmed => {
      const targets = [];
      for ( let seed = 1; seed <= 6; seed++ ) {
        const spec = fight();
        // (Valeros nearly down and nearest: the one it would go for.)
        spec.combatants.find(c => c.id === "valeros").hp = { value: 3, max: 40 };
        spec.combatants.find(c => c.id === "goblin").actions = [strike({ id: "sling", melee: false, reach: undefined, range: { increment: 60, max: 240 } })];
        const run = beginLive(spec, pf2eRules, { seed, players: ["valeros", "kyra"] });
        if ( charmed ) applyOutcome(run.byId.get("goblin"), { conditions: { charmed: 1 }, rounds: 5 }, "valeros", { id: "valeros.charm", name: "Charm" });
        liveRound(run, 1);
        liveTurn(run, "goblin");
        targets.push(...run.log.filter(e => e.actorId === "goblin" && e.type === "attack").map(e => e.targetId));
      }
      return targets;
    };
    expect(shotAt(false)).toContain("valeros");
    const charmed = shotAt(true);
    expect(charmed.length).toBeGreaterThan(0);
    expect(charmed).not.toContain("valeros");
  });

  test("fright weighs on its nerve, the worse the more", () => {
    const run = start();
    const orc = run.byId.get("orc");
    const calm = moraleStress(run, orc);
    orc.conds.frightened = 2;
    // (4 a step, as much as its selfishness lets the group's troubles weigh: about 8 here.)
    expect(moraleStress(run, orc)).toBeGreaterThan(calm + 6);
  });
});
