import { describe, expect, test } from "vitest";
import { battleSignature, rememberRun, recallRun, KEEP_RUNS } from "../scripts/foundry/run-memory.js";

/** A browser's storage, in memory. */
const storage = () => {
  const kept = new Map();
  return { getItem: k => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, String(v)) };
};
const battle = (hp = 20) => ({ combatants: [{ id: "a", hp: { value: hp, max: 20 } }, { id: "b", hp: { value: 9, max: 9 } }], options: { maxRounds: 12 } });

describe("the planner's last runs", () => {
  test("a battle's signature changes with anything in it, and only then", () => {
    expect(battleSignature(battle())).toBe(battleSignature(battle()));
    expect(battleSignature(battle(19))).not.toBe(battleSignature(battle()));
  });

  test("shown again only for the very battle it was run for", () => {
    const s = storage();
    const results = { runs: 500, seed: 7, sides: { friendly: { pWin: 0.6 } } };
    rememberRun("Combat.x", battle(), results, s);
    expect(recallRun("Combat.x", battle(), s)).toMatchObject({ results });
    expect(recallRun("Combat.x", battle(15), s)).toBeNull();
    expect(recallRun("Combat.y", battle(), s)).toBeNull();
  });

  test("the newest plans' runs are kept, one each; nothing kept or broken storage is no run", () => {
    const s = storage();
    for ( let i = 0; i < KEEP_RUNS + 2; i++ ) rememberRun(`Combat.${i}`, battle(), { runs: i + 1 }, s);
    expect(recallRun("Combat.0", battle(), s)).toBeNull();
    expect(recallRun(`Combat.${KEEP_RUNS + 1}`, battle(), s).results.runs).toBe(KEEP_RUNS + 2);
    rememberRun("Combat.6", battle(), { runs: 99 }, s);
    expect(recallRun("Combat.6", battle(), s).results.runs).toBe(99);
    const broken = { getItem: () => "{not json", setItem: () => { throw new Error("full"); } };
    expect(recallRun("Combat.6", battle(), broken)).toBeNull();
    expect(() => rememberRun("Combat.6", battle(), { runs: 1 }, broken)).not.toThrow();
  });
});
