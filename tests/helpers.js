import { parseFormula } from "../scripts/engine/dice.js";

let counter = 0;

/** Build a CombatantSpec with sensible PF2e-ish defaults. */
export function creature(overrides = {}) {
  const id = overrides.id ?? `c${++counter}`;
  const base = {
    id,
    name: overrides.name ?? id,
    side: "friendly",
    kind: "npc",
    level: 1,
    hp: { value: 20, max: 20, temp: 0 },
    defenses: { ac: 16, fortitude: 7, reflex: 7, will: 7 },
    initiative: { mod: 5 },
    speeds: { walk: 25 },
    actions: [strike()],
    iwr: {},
    traits: {
      tactical: { base: 50, fudge: 0 },
      brave: { base: 60, fudge: 0 },
      selfish: { base: 30, fudge: 0 },
      loyal: { base: 60, fudge: 0 }
    },
    flags: {},
    diesAtZero: true
  };
  return { ...base, ...overrides, id };
}

export function strike(overrides = {}) {
  return {
    id: overrides.id ?? `strike${++counter}`,
    name: "Longsword",
    kind: "strike",
    cost: 1,
    bonus: 9,
    maps: [0, -5, -10],
    melee: true,
    reach: 5,
    damage: [parseFormula("1d8+4", "slashing")],
    ...overrides
  };
}

export function battle(combatants, options = {}, sides = null) {
  return {
    combatants,
    sides: sides ?? {
      friendly: { label: "Party", enemies: ["hostile"] },
      hostile: { label: "Enemies", enemies: ["friendly"] }
    },
    options: { positioning: false, ...options }
  };
}
