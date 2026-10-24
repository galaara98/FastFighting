/**
 * Whom the party has seen (behavior/senses.js noteSeen): one a standing player's character perceives, unless hidden;
 * one it came to blows or words with, hidden or not. Marked once, on the creature.
 */
import { describe, expect, test } from "vitest";
import { noteSeen } from "../scripts/engine/behavior/senses.js";

const unit = (id, spec = {}) => ({ id, status: "standing", active: true, spec: { id, ...spec }, harmedBy: new Map() });
const runOf = (units, log = null) => ({ units, byId: new Map(units.map(u => [u.id, u])), log, prep: { options: { positioning: false } } });

describe("whom the party has seen", () => {
  test("one in a character's senses; a hidden one only once it meets the party", () => {
    const pc = unit("pc", { kind: "pc" });
    const orc = unit("orc");
    const lurker = unit("lurker", { hidden: true });
    const run = runOf([pc, orc, lurker]);
    noteSeen(run, new Set([pc]));
    expect([orc.partySaw, lurker.partySaw, pc.partySaw]).toEqual([true, undefined, undefined]);
    lurker.harmedBy.set("pc", 4);
    noteSeen(run, new Set([pc]));
    expect(lurker.partySaw).toBe(true);
  });

  test("words with the party, from the log, read on from where it was read to", () => {
    const pc = unit("pc", { kind: "pc" });
    const lurker = unit("lurker", { hidden: true });
    const run = runOf([pc, lurker], [{ actorId: "pc", targetId: "pc" }]);
    noteSeen(run, new Set([pc]));
    expect(lurker.partySaw).toBeUndefined();
    run.log.push({ actorId: "lurker", targetId: "pc", type: "talk" });
    noteSeen(run, new Set([pc]));
    expect(lurker.partySaw).toBe(true);
    expect(run.seenLogAt).toBe(2);
  });

  test("no party: no one marked", () => {
    const orc = unit("orc");
    noteSeen(runOf([orc]), new Set());
    expect(orc.partySaw).toBeUndefined();
  });
});

test("no party given: nothing marked, nothing thrown", () => {
  const orc = { id: "orc", status: "standing", spec: { id: "orc" } };
  expect(() => noteSeen({ units: [orc], byId: new Map(), prep: { options: {} } }, undefined)).not.toThrow();
  expect(orc.partySaw).toBeUndefined();
});
