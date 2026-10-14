import { describe, expect, test } from "vitest";
import { replay, runBatchSync } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";
import { beginLive, liveRound, pcTurnBegin, pcTurnEnd, captureAll } from "../scripts/engine/live.js";
import { diffAll } from "../scripts/engine/changes.js";

const tail = { id: "tail", name: "Tail", kind: "strike", cost: 1, bonus: 10, melee: true, reach: 10, damage: [parseFormula("2d8+5", "bludgeoning")], legendary: 1 };
const wing = { id: "wing", name: "Wing Attack", kind: "save", cost: 1, save: { type: "reflex", dc: 20, basic: true }, damage: [parseFormula("2d6+5", "bludgeoning")], area: { targets: 3 }, legendary: 2 };

function lair({ pool = 3, standFirm = false, hold = false } = {}) {
  const dragon = creature({
    id: "dragon", side: "hostile", hp: { value: 300, max: 300 }, flags: { fearless: true },
    legendary: pool ? { pool } : undefined,
    standFirm: standFirm ? { pool: "legres", label: "Legendary Resistance" } : undefined,
    resources: standFirm ? { legres: 3 } : {},
    actions: [strike({ id: "bite", bonus: 10, damage: [parseFormula("2d10+5", "piercing")] }), tail, wing]
  });
  const heroes = ["a", "b", "c"].map(id => creature({ id, kind: "pc", diesAtZero: false, hp: { value: 200, max: 200 },
    actions: hold && id === "a"
      ? [{ id: "hold", name: "Hold Monster", kind: "control", cost: 2, save: { type: "will", dc: 40 }, outcome: { conditions: { paralyzed: 1 }, rounds: 3, label: "paralyzed" }, onSave: [{ conditions: { paralyzed: 1 }, rounds: 3, label: "paralyzed" }, { conditions: { paralyzed: 1 }, rounds: 3, label: "paralyzed" }, null, null] }]
      : [strike({ bonus: 8 })] }));
  return battle([...heroes, dragon], { maxRounds: 6 });
}

describe("legendary actions in a live battle", () => {
  test("after a player's turn: taken, and what they did is there to be written to the sheets (pcTurnEnd's synced)", () => {
    let taken = 0;
    for ( let seed = 1; seed <= 6; seed++ ) {
      const run = beginLive(lair(), pf2eRules, { seed, players: ["a", "b", "c"] });
      liveRound(run, 1);
      for ( const u of run.units ) u.active = true;
      for ( const id of ["a", "b", "c"] ) {
        pcTurnBegin(run, id);
        const result = pcTurnEnd(run, id, []);
        const moves = result.events.filter(e => e.type === "legendary");
        taken += moves.length;
        if ( moves.length ) {
          // (The heroes as the sheets had them, and as the dragon left them: the difference is the sheets' to show.)
          const hurt = Object.entries(diffAll(result.synced, captureAll(run))).filter(([, ch]) => ch.hp);
          const harmed = run.log.slice(run.log.indexOf(moves[0])).some(e => ["attack", "save"].includes(e.type) && e.actorId === "dragon" && e.damage > 0);
          if ( harmed ) expect(hurt.length).toBeGreaterThan(0);
        }
      }
    }
    expect(taken).toBeGreaterThan(0);
  });
});

describe("legendary actions", () => {
  test("between other creatures' turns, from the start, never more than its pool between its own turns, and never on its own turn", () => {
    let early = 0;
    for ( let seed = 1; seed <= 6; seed++ ) {
      const r = replay(lair(), pf2eRules, seed);
      const uses = r.log.filter(e => e.type === "legendary");
      expect(uses.length).toBeGreaterThan(0);
      // (Spent since its pool came back: at the start of each of its own turns.)
      const legendaryTurns = new Set(uses.map(e => e.turn));
      let spent = 0;
      let ownTurn = null;
      for ( const e of r.log ) {
        if ( e.type === "legendary" ) {
          spent += e.cost;
          expect(spent).toBeLessThanOrEqual(3);
        } else if ( e.actorId === "dragon" && !legendaryTurns.has(e.turn) && e.turn !== ownTurn ) {
          ownTurn = e.turn;
          spent = 0;
        }
      }
      // (It has them from the start: before its first turn too.)
      const first = r.log.findIndex(e => e.actorId === "dragon" && !legendaryTurns.has(e.turn));
      if ( r.log.slice(0, first).some(e => e.type === "legendary") ) early += 1;
      // Its own turns never use a legendary option.
      expect(r.log.some(e => e.actor === "dragon" && e.type === "attack" && e.action === "Tail" && !r.log.some(l => l.type === "legendary" && l.round === e.round))).toBe(false);
    }
    expect(early).toBeGreaterThan(0);
  });

  test("they make a legendary creature much deadlier", () => {
    const plain = runBatchSync(lair({ pool: 0 }), pf2eRules, { runs: 200 });
    const legend = runBatchSync(lair(), pf2eRules, { runs: 200 });
    const hurt = r => ["a", "b", "c"].reduce((s, id) => s + (1 - r.combatants[id].meanHpFrac), 0);
    expect(hurt(legend)).toBeGreaterThan(hurt(plain) * 1.3);
  });
});

describe("standing firm (Legendary Resistance)", () => {
  test("a save that would take it out of the fight, it makes, while it has the means", () => {
    for ( let seed = 1; seed <= 4; seed++ ) {
      const r = replay(lair({ standFirm: true, hold: true }), pf2eRules, seed);
      const firm = r.log.filter(e => e.type === "standFirm");
      expect(firm.length).toBeGreaterThan(0);
      expect(firm.length).toBeLessThanOrEqual(3);
      // Until it runs out, the hold never takes.
      const firstHeld = r.log.findIndex(e => e.type === "control" && e.target === "dragon" && e.took);
      if ( firstHeld >= 0 ) expect(r.log.slice(0, firstHeld).filter(e => e.type === "standFirm").length).toBe(3);
    }
  });
});
