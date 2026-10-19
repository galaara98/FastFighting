import { parseFormula } from "../scripts/engine/dice.js";
import { pcTurnBegin, pcTurnEnd } from "../scripts/engine/live.js";

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

/**
 * Talking data in the core's shape, from PF2e-style numbers: Diplomacy persuades, Intimidation threatens,
 * Deception bluffs; Will resists persuasion and threats, Perception resists bluffs.
 */
export function social({ diplomacy, intimidation, deception, willDC = 17, perceptionDC = 17, languages = ["common"], mindless = false, ...rest } = {}) {
  const pitch = (skill, mod) => (typeof mod === "number" ? { skill, mod } : undefined);
  return {
    pitches: { persuade: pitch("diplomacy", diplomacy), intimidate: pitch("intimidation", intimidation), deceive: pitch("deception", deception) },
    resist: { persuade: { dc: willDC, label: "will" }, intimidate: { dc: willDC, label: "will" }, deceive: { dc: perceptionDC, label: "perception" } },
    languages, mindless, ...rest
  };
}

/**
 * A player's turn in a live battle, played at once (engine/live.js pcTurnBegin, then pcTurnEnd): what was read of it,
 * the sheets as they now are, the GM's facts. Returns pcTurnEnd's, its `events` all the turn logged.
 */
export function pcTurn(run, id, events = [], states = null, facts = []) {
  const from = run.log.length;
  pcTurnBegin(run, id);
  const out = pcTurnEnd(run, id, events, states, facts);
  return { ...out, events: run.log.slice(from) };
}
