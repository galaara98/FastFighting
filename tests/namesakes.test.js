/**
 * Tokens of the same name told apart (foundry/battle.js numberNamesakes, namesakeOf): "Name (n)" in the order they
 * come, their own name kept; one alone keeps its name; one joining later numbered past them.
 */
import { describe, expect, test } from "vitest";
import { numberNamesakes, namesakeOf } from "../scripts/foundry/battle.js";

const label = (name, n) => `${name} (${n})`;
const names = list => numberNamesakes(list.map((name, i) => ({ id: String(i), name })), label);

describe("namesakes", () => {
  test("those sharing an exact name, numbered in order; one alone, as it is", () => {
    const cs = names(["Cutthroat", "Jirelle", "Cutthroat", "Gromog", "Cutthroat"]);
    expect(cs.map(c => c.name)).toEqual(["Cutthroat (1)", "Jirelle", "Cutthroat (2)", "Gromog", "Cutthroat (3)"]);
    expect(cs[2]).toMatchObject({ baseName: "Cutthroat", namesake: 2 });
    expect(cs[1].baseName).toBeUndefined();
  });

  test("only an exact name: a goblin and a Goblin Boss aren't namesakes", () => {
    expect(names(["Goblin", "Goblin Boss"]).map(c => c.name)).toEqual(["Goblin", "Goblin Boss"]);
  });

  test("one joining: past the highest; under a name nobody has, none", () => {
    const cs = names(["Cutthroat", "Cutthroat"]);
    expect(namesakeOf(cs, "Cutthroat", label)).toEqual({ baseName: "Cutthroat", namesake: 3, name: "Cutthroat (3)" });
    expect(namesakeOf(names(["Wolf"]), "Wolf", label)).toEqual({ baseName: "Wolf", namesake: 2, name: "Wolf (2)" });
    expect(namesakeOf(cs, "Wolf", label)).toBeNull();
  });
});
