import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { sampleRunTactics } from "../scripts/engine/playstyles.js";
import { initDesires, partyWants, levelOf, PARTY_POINTS } from "../scripts/engine/behavior/desire.js";
import { majority, partyWishes, PARTY_QUESTIONS, PARTY_TACTICS } from "../scripts/foundry/party.js";
import { createRng } from "../scripts/engine/rng.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const tr = loyal => ({ tactical: { base: 60, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: loyal, fudge: 0 } });
const harmless = () => strike({ bonus: -50 });
const tough = { value: 500, max: 500, temp: 0 };

/**
 * How often a follower heads for the left foe (of two alike) when its leader wants the left one and it wants the right
 * one itself, out of so many fights.
 */
function followsLeft({ leaderWants = 95, own = 60, influence = 50, boss = false, loyal = 60, runs = 120 } = {}) {
  let left = 0;
  let moved = 0;
  for ( let seed = 1; seed <= runs; seed++ ) {
    const units = [
      creature({ id: "chief", position: at(0), traits: tr(60), actions: [harmless()], desires: [{ kind: "hurt", targetId: "left", level: leaderWants }], initiative: { mod: 60 } }),
      creature({ id: "mate", position: at(0, 10), traits: tr(loyal), actions: [strike({ bonus: -50 })], initiative: { mod: 40 }, desires: own ? [{ kind: "hurt", targetId: "right", level: own }] : [] }),
      creature({ id: "left", side: "hostile", position: at(30, -20), hp: tough, actions: [harmless()] }),
      creature({ id: "right", side: "hostile", position: at(30, 40), hp: tough, actions: [harmless()] })
    ];
    const spec = battle(units, { positioning: true, maxRounds: 1, aftermath: "none", leadership: true, leaderInfluence: influence }, {
      friendly: { label: "Party", enemies: ["hostile"], leaderId: "chief" }, hostile: { label: "Foes", enemies: ["friendly"] }
    });
    if ( boss ) spec.command = { friendly: [{ id: "chief", role: "boss" }] };
    const move = replay(spec, pf2eRules, seed).log.find(e => e.actorId === "mate" && e.type === "move");
    if ( move ) { moved++; if ( move.towardId === "left" ) left++; }
  }
  return left / Math.max(1, moved);
}

describe("leaders", () => {
  test("a follower takes up its leader's wish in proportion: a mild one loses to its own strong wish, a strong one wins often", () => {
    expect(followsLeft({ leaderWants: 50 })).toBeLessThan(0.1);
    expect(followsLeft({ leaderWants: 95 })).toBeGreaterThan(0.3);
    // (Under a boss, nearly always.)
    expect(followsLeft({ leaderWants: 95, boss: true })).toBeGreaterThan(0.8);
  });

  test("a leader always counts: with nobody following outright (influence 0), it still tips a close call", () => {
    expect(followsLeft({ influence: 0, own: 0 })).toBeGreaterThan(0.9);
    expect(followsLeft({ influence: 0, own: 60 })).toBeLessThan(0.1);
  });
});

describe("the party's wishes (its players' votes)", () => {
  test("majority rules; a tie, no answer", () => {
    expect(majority([{ target: "weakest", talk: "first" }, { target: "weakest", talk: "never" }, { target: "dangerous" }])).toEqual({ target: "weakest" });
    expect(majority([{ retreat: "never" }])).toEqual({ retreat: "never" });
    expect(majority([{ fallen: "nonsense" }])).toEqual({});
    expect(partyWishes([], 3)).toBeNull();
  });

  test("six questions, answered with pills; three of them sway how everyone acts", () => {
    expect(Object.keys(PARTY_QUESTIONS)).toHaveLength(6);
    expect(Object.keys(PARTY_TACTICS).sort()).toEqual(["resources", "retreat", "talk"]);
  });

  test("what they want: the party's pick of foe, the fallen, each other, at the party's sway", () => {
    const mk = (id, side, extra = {}) => ({ id, side, active: true, status: "standing", hp: 10, maxHp: 10, spec: { name: id, level: 1 }, prep: { traits: {} }, ...extra });
    const me = mk("me", "friendly", { hp: 10 });
    const hurt = mk("hurt", "friendly", { hp: 3 });
    const near = mk("near", "hostile");
    const weak = mk("weak", "hostile", { hp: 2 });
    const run = party => ({
      prep: { sides: { friendly: { id: "friendly", enemies: new Set(["hostile"]), party }, hostile: { id: "hostile", enemies: new Set(["friendly"]) } }, options: {} },
      units: [me, hurt, near, weak], byId: new Map([me, hurt, near, weak].map(u => [u.id, u])), rng: createRng(1)
    });
    const scored = [{ t: near, moves: 0 }, { t: weak, moves: 1 }];
    initDesires(me);
    partyWants(run({ target: "weakest", care: "heal", sway: 0.03 }), me, scored, { canHeal: true });
    expect(levelOf(me, "hurt", "weak")).toBeCloseTo(PARTY_POINTS * 0.03);
    expect(levelOf(me, "hurt", "near")).toBe(0);
    expect(levelOf(me, "heal", "hurt")).toBeCloseTo(PARTY_POINTS * 0.03);
    // (No wishes, or another side: nothing.)
    initDesires(me);
    partyWants(run(null), me, scored, { canHeal: true });
    expect(levelOf(me, "hurt", "weak")).toBe(0);
  });

  test("how they act: the party's answer, in that share of fights, where the character left it to itself", () => {
    const spec = { tactics: { talk: "never", retreat: "never" }, partyTactics: { talk: "first" }, partySway: 0.2 };
    const rng = createRng(7);
    let talked = 0;
    for ( let i = 0; i < 2000; i++ ) if ( sampleRunTactics(spec, rng).talk === "first" ) talked++;
    expect(talked / 2000).toBeGreaterThan(0.16);
    expect(talked / 2000).toBeLessThan(0.24);
    expect(sampleRunTactics({ tactics: { talk: "never" } }, createRng(1)).talk).toBe("never");
  });
});
