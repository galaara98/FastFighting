import { describe, expect, test } from "vitest";
import { battleSignature, rememberRun, recallRun, KEEP_RUNS } from "../scripts/foundry/run-memory.js";
import { rosterOrder } from "../scripts/foundry/battle.js";
import { prepareBattle } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle as fightOf } from "./helpers.js";

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

  test("the same tokens make the same battle, however the canvas has them ordered (hovered, selected): by name, then id", () => {
    const token = (id, name) => ({ id, document: { name } });
    const tokens = [token("t9", "Kobold Warrior 2"), token("t2", "Amiri"), token("t5", "Hyena"), token("t1", "Hyena"), token("t7", "Suli Dune Dancer")];
    const shuffled = [tokens[3], tokens[0], tokens[4], tokens[1], tokens[2]];
    const order = list => [...list].sort(rosterOrder).map(t => t.id);
    expect(order(tokens)).toEqual(["t2", "t1", "t5", "t9", "t7"]);
    expect(order(shuffled)).toEqual(order(tokens));
    const specOf = list => ({ combatants: [...list].sort(rosterOrder).map(t => ({ id: t.id, name: t.document.name })) });
    expect(battleSignature(specOf(shuffled))).toBe(battleSignature(specOf(tokens)));
  });

  test("shown again only for the very battle it was run for", () => {
    const s = storage();
    const results = { runs: 500, seed: 7, sides: { friendly: { pWin: 0.6 } } };
    rememberRun("Combat.x", battleSignature(battle()), results, s);
    expect(recallRun("Combat.x", battle(), s)).toMatchObject({ results });
    expect(recallRun("Combat.x", battle(15), s)).toBeNull();
    expect(recallRun("Combat.y", battle(), s)).toBeNull();
  });

  test("known again after the run, though running it marked whose each action is (two copies of one creature)", () => {
    // (Unlinked tokens of one actor, one changed: their actions share ids, and preparing the battle writes ownerId on
    // the later ones. The planner opened again builds the battle afresh, without it.)
    const make = () => fightOf([
      creature({ id: "pc", side: "friendly", actions: [strike({ id: "sword" })] }),
      creature({ id: "dog1", side: "hostile", actions: [strike({ id: "bite" })] }),
      creature({ id: "dog2", side: "hostile", actions: [strike({ id: "bite", bonus: 9 })] })
    ]);
    const spec = make();
    const signature = battleSignature(spec);
    prepareBattle(spec, pf2eRules);
    expect(battleSignature(spec)).not.toBe(signature); // (the engine did mark them: what this test is about)
    const s = storage();
    rememberRun("Combat.x", signature, { runs: 80 }, s);
    expect(recallRun("Combat.x", make(), s)).toMatchObject({ results: { runs: 80 } });
  });

  test("the newest plans' runs are kept, one each; nothing kept or broken storage is no run", () => {
    const s = storage();
    for ( let i = 0; i < KEEP_RUNS + 2; i++ ) rememberRun(`Combat.${i}`, battleSignature(battle()), { runs: i + 1 }, s);
    expect(recallRun("Combat.0", battle(), s)).toBeNull();
    expect(recallRun(`Combat.${KEEP_RUNS + 1}`, battle(), s).results.runs).toBe(KEEP_RUNS + 2);
    rememberRun("Combat.6", battleSignature(battle()), { runs: 99 }, s);
    expect(recallRun("Combat.6", battle(), s).results.runs).toBe(99);
    const broken = { getItem: () => "{not json", setItem: () => { throw new Error("full"); } };
    expect(recallRun("Combat.6", battle(), broken)).toBeNull();
    expect(() => rememberRun("Combat.6", battleSignature(battle()), { runs: 1 }, broken)).not.toThrow();
  });
});
