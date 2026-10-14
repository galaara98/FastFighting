/**
 * Golden fights: a spread of battles whose every logged step is kept, so the engine can be taken apart and put back
 * together (for live battles, a turn at a time) without a single fight coming out differently.
 *   FASTFIGHTING_GOLDEN=record npx vitest run tests/golden.test.js   keeps them anew (only when a fight is meant to
 *   come out differently; a refactor must leave tests/golden/logs.json as it is)
 */
import { parseFormula, part } from "../../scripts/engine/dice.js";
import { NEUTRAL_PARTY } from "../../scripts/constants.js";
import { pf2eRules } from "../fixtures/three-action-rules.js";
import { genericRules } from "../../scripts/adapters/generic/rules.js";
import { creature, strike, battle, social as talkData } from "../helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const minded = (tactical = 60, brave = 60) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: brave, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const social = (over = {}) => talkData({ diplomacy: 3, intimidation: 3, deception: 3, ...over });
const bow = (over = {}) => strike({ id: "bow", name: "Shortbow", melee: false, reach: undefined, range: { increment: 60, max: 360 }, damage: [parseFormula("1d6", "piercing")], ...over });
const venom = {
  kind: "affliction", id: "venom", name: "Venom", traits: ["poison"], save: { type: "fortitude", dc: 16 }, maxDuration: 6,
  stages: [{ damage: [parseFormula("1d4", "poison")], conditions: { offGuard: true } }, { damage: [parseFormula("1d6", "poison")], conditions: { offGuard: true, clumsy: 1 } }]
};
const lead = () => ({ brave: 10, tacticalFloor: 40, attack: 0, ac: 0 });

/** Each: {name, spec, rules, seeds}. */
export function goldenBattles() {
  return [
    {
      name: "skirmish",
      rules: pf2eRules,
      seeds: [1, 2, 3, 4, 5],
      spec: battle([
        creature({ id: "fighter", name: "Fighter", kind: "pc", diesAtZero: false, hp: { value: 40, max: 40 }, traits: minded(70), resources: { fate: 1 }, fateLabel: "Hero Points",
          reactions: [{ id: "block", label: "Shield Block", on: "hit", reduce: part([], 5, "untyped"), physical: true }] }),
        creature({ id: "archer", name: "Archer", kind: "pc", diesAtZero: false, hp: { value: 28, max: 28 }, actions: [bow()], traits: minded(60) }),
        creature({ id: "orc", name: "Orc", side: "hostile", hp: { value: 35, max: 35 }, traits: minded(40, 80), actions: [strike({ id: "axe", name: "Greataxe", bonus: 10, damage: [parseFormula("1d12+4", "slashing")] })] }),
        creature({ id: "goblin", name: "Goblin", side: "hostile", hp: { value: 12, max: 12 }, traits: minded(30, 40), actions: [bow({ id: "gbow", bonus: 6 })] })
      ], { maxRounds: 6 })
    },
    {
      name: "positions",
      rules: pf2eRules,
      seeds: [1, 2, 3, 4],
      spec: battle([
        creature({ id: "knight", name: "Knight", kind: "pc", diesAtZero: false, position: at(0), hp: { value: 50, max: 50 }, traits: minded(70) }),
        creature({ id: "mage", name: "Mage", kind: "pc", diesAtZero: false, position: at(0, 10), hp: { value: 20, max: 20 }, actions: [bow({ id: "bolt", name: "Force Bolt", kind: "spell-attack", damage: [parseFormula("2d4+2", "force")] })] }),
        creature({ id: "wolf", name: "Wolf", side: "hostile", position: at(50), hp: { value: 24, max: 24 }, traits: minded(20, 70), actions: [strike({ id: "jaws", name: "Jaws", damage: [parseFormula("1d6+3", "piercing")] })] }),
        creature({ id: "spider", name: "Spider", side: "hostile", position: at(60, 10), hp: { value: 30, max: 30 }, actions: [strike({ id: "fangs", name: "Fangs", effects: [venom] })] }),
        creature({ id: "watcher", name: "Watcher", side: "hostile", inEncounter: false, position: at(120) })
      ], { positioning: true, maxRounds: 6 })
    },
    {
      name: "talk",
      rules: pf2eRules,
      seeds: [1, 2, 3, 4, 5],
      spec: battle([
        creature({ id: "talker", name: "Talker", kind: "pc", diesAtZero: false, social: social({ diplomacy: 12, intimidation: 10, deception: 8 }), hp: { value: 30, max: 30 } }),
        creature({ id: "bandit", name: "Bandit", side: "hostile", originSide: "neutral", social: social(), hp: { value: 25, max: 25 } }),
        creature({ id: "thug", name: "Thug", side: "hostile", social: social({ intimidation: 8 }), hp: { value: 30, max: 30 } })
      ], { maxRounds: 5, talking: true })
    },
    {
      name: "standoff",
      rules: pf2eRules,
      seeds: [1, 2, 3],
      spec: battle([
        creature({ id: "envoy", name: "Envoy", kind: "pc", diesAtZero: false, social: social({ diplomacy: 14 }), tactics: { talk: "first" } }),
        creature({ id: "chief", name: "Chief", side: "hostile", social: social({ diplomacy: 8 }), tactics: { talk: "first" } }),
        creature({ id: "guard", name: "Guard", side: NEUTRAL_PARTY, originSide: "neutral", social: social(), lean: "friendly" })
      ], { maxRounds: 5, opening: "talk" })
    },
    {
      name: "leaders",
      rules: pf2eRules,
      seeds: [1, 2, 3, 4],
      spec: {
        ...battle([
          creature({ id: "boss", name: "Boss", side: "hostile", hp: { value: 20, max: 30 }, traits: minded(70) }),
          creature({ id: "lt", name: "Lieutenant", side: "hostile", hp: { value: 40, max: 40 }, traits: minded(50) }),
          creature({ id: "grunt", name: "Grunt", side: "hostile", hp: { value: 15, max: 15 }, traits: minded(30) }),
          creature({ id: "hero", name: "Hero", kind: "pc", diesAtZero: false, hp: { value: 70, max: 70 }, actions: [strike({ bonus: 14, damage: [parseFormula("2d8+5", "slashing")] })] })
        ], { leadership: true, morale: true, maxRounds: 6 }),
        command: { hostile: [["boss", "boss"], ["lt", "lieutenant"]].map(([id, role]) => ({ id, role, leadership: lead() })) }
      }
    },
    {
      name: "support",
      rules: pf2eRules,
      seeds: [1, 2, 3, 4],
      spec: battle([
        creature({ id: "cleric", name: "Cleric", kind: "pc", diesAtZero: false, hp: { value: 30, max: 30 }, resources: { slot: 3, "item:p": 2 }, traits: minded(70),
          actions: [strike({ id: "mace", name: "Mace", bonus: 7, damage: [parseFormula("1d6+2", "bludgeoning")] }),
            { id: "heal", name: "Heal", kind: "heal", cost: 2, heal: [parseFormula("2d8+8", "healing")], resource: "slot", range: { increment: 30, max: 30, noPenalty: true } },
            { id: "potion", name: "Healing Potion", kind: "heal", cost: 1, heal: [parseFormula("2d8", "healing")], resource: "item:p", selfOnly: true }] }),
        creature({ id: "wizard", name: "Wizard", kind: "pc", diesAtZero: false, hp: { value: 22, max: 22 }, resources: { slot: 2 }, traits: minded(70),
          actions: [strike({ id: "staff", name: "Staff", bonus: 4 }),
            { id: "slow", name: "Slow", kind: "control", cost: 2, save: { type: "fortitude", dc: 21 }, range: { increment: 30, max: 30, noPenalty: true }, melee: false, resource: "slot",
              onSave: [{ conditions: { slowed: 2 }, rounds: 10, label: "slowed 2" }, { conditions: { slowed: 1 }, rounds: 10, label: "slowed 1" }, { conditions: { slowed: 1 }, rounds: 1, label: "slowed 1" }, null] }] }),
        creature({ id: "ogre", name: "Ogre", side: "hostile", hp: { value: 60, max: 60 }, traits: minded(30, 90), flags: { fearless: true },
          actions: [strike({ id: "club", name: "Club", bonus: 11, damage: [parseFormula("2d8+5", "bludgeoning")] })] })
      ], { maxRounds: 6 })
    },
    {
      name: "generic",
      rules: genericRules,
      seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      spec: battle([
        creature({ id: "a", name: "Alpha", kind: "pc", diesAtZero: false, hp: { value: 30, max: 30 } }),
        creature({ id: "b", name: "Beta", kind: "pc", diesAtZero: false, hp: { value: 30, max: 30 }, actions: [bow()] }),
        creature({ id: "x", name: "Xeno", side: "hostile", hp: { value: 40, max: 40 }, actions: [strike({ id: "claw", name: "Claws", damage: [parseFormula("2d6+2", "slashing")] })] }),
        creature({ id: "y", name: "Ypsilon", side: "hostile", hp: { value: 20, max: 20 } })
      ], { maxRounds: 8 })
    }
  ];
}

/** Strings a translation could change aren't the engine's doing: kept are the numbers, flags and ids of each step. */
const KEEP = new Set(["type", "actorId", "targetId", "byId", "towardId", "turnOf", "cause", "kind", "aim", "outcome", "what", "why", "trigger", "mode", "purpose", "maneuver", "action", "reaction", "side"]);

function project(value) {
  if ( Array.isArray(value) ) return value.map(project);
  if ( value && typeof value === "object" ) {
    const out = {};
    for ( const [k, v] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b)) ) {
      if ( typeof v === "string" && !KEEP.has(k) ) continue;
      out[k] = project(v);
    }
    return out;
  }
  return typeof value === "number" && !Number.isFinite(value) ? String(value) : value;
}

/** A fight's log and outcome, as the goldens keep them. */
export function goldenOf(result) {
  return {
    rounds: result.rounds,
    log: result.log.map(project),
    units: Object.fromEntries(Object.entries(result.units ?? {}).map(([id, u]) => [id, project(u.final ?? null)]))
  };
}
