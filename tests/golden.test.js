import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { goldenBattles, goldenOf } from "./golden/battles.js";

const FILE = path.join(import.meta.dirname, "golden", "logs.json");
const recording = process.env.FASTFIGHTING_GOLDEN === "record";

describe("golden fights: the engine taken apart and put back together tells every fight the same", () => {
  const fights = {};
  for ( const b of goldenBattles() ) for ( const seed of b.seeds ) fights[`${b.name}#${seed}`] = () => goldenOf(replay(b.spec, b.rules, seed));

  if ( recording ) {
    test("recording", () => {
      const out = Object.fromEntries(Object.entries(fights).map(([k, f]) => [k, f()]));
      fs.writeFileSync(FILE, JSON.stringify(out) + "\n");
    });
    return;
  }

  const kept = JSON.parse(fs.readFileSync(FILE, "utf8"));
  test("every golden fight is kept", () => expect(Object.keys(kept).sort()).toEqual(Object.keys(fights).sort()));
  for ( const [key, fight] of Object.entries(fights) ) {
    test(key, () => expect(fight()).toEqual(kept[key]));
  }
});
