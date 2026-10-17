/**
 * Reactions to a move that ends beside a creature (behavior/responses.js): a friend's ("allyMoves": a step of its own
 * to a better spot, PF2e's Goblin Scuttle) and a foe's into its reach ("foeApproaches": a strike at it, or a step).
 */
import { describe, expect, test } from "vitest";
import { beginRun, prepareBattle, answerMove, replay } from "../scripts/engine/simulator.js";
import { beginLive, movedBeside, NeedsDecision } from "../scripts/engine/live.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const scuttle = { id: "scuttle", label: "Scuttle", on: "allyMoves", step: 5, kin: ["goblin"] };
const weak = () => [strike({ bonus: 0, damage: [parseFormula("1", "bludgeoning")] })];

function setUp(combatants) {
  const run = beginRun(prepareBattle(battle(combatants, { positioning: true, maxRounds: 3 }), pf2eRules), 1, { log: true });
  return { run, by: id => run.byId.get(id) };
}

/** u moves to `to` (as moveToward would have it), and those it ends beside answer. */
function moveTo(run, u, to) {
  const from = { x: u.pos.x, y: u.pos.y };
  u.pos.x = to.x;
  u.pos.y = to.y;
  run.geo = (run.geo ?? 0) + 1;
  answerMove(run, u, { feet: Math.hypot(to.x - from.x, to.y - from.y), from, to: { ...to }, reached: false });
}

describe("a friend comes beside it", () => {
  const goblins = (kin = ["goblin"]) => [
    creature({ id: "hero", position: at(0, 0), actions: weak() }),
    creature({ id: "a", side: "hostile", position: at(5, 5), creatureTraits: ["goblin"], reactions: [scuttle], flags: { fearless: true } }),
    creature({ id: "b", side: "hostile", position: at(5, 30), creatureTraits: kin, flags: { fearless: true } })
  ];

  test("a goblin steps in beside the foe its friend just reached: flanked", () => {
    const { run, by } = setUp(goblins());
    moveTo(run, by("b"), { x: 5, y: 0 });
    expect(run.log.find(e => e.type === "reaction" && e.actorId === "a")).toMatchObject({ reaction: "Scuttle", trigger: "allyMoves", targetId: "b" });
    expect(run.log.find(e => e.type === "step" && e.actorId === "a")).toMatchObject({ reaction: true, from: { x: 5, y: 5 }, to: { x: 0, y: 5 } });
    expect(by("a").adjacent.has("hero")).toBe(true);
    expect(by("a").reactionsLeft).toBe(0);
  });

  test("not for a friend without the trait it answers, nor one that stops out of its range", () => {
    const other = setUp(goblins(["orc"]));
    moveTo(other.run, other.by("b"), { x: 5, y: 0 });
    expect(other.run.log.some(e => e.type === "reaction")).toBe(false);
    const far = setUp(goblins());
    moveTo(far.run, far.by("b"), { x: 5, y: 20 });
    expect(far.run.log.some(e => e.type === "reaction")).toBe(false);
  });

  test("nowhere better to stand: it keeps its reaction", () => {
    const { run, by } = setUp([...goblins().slice(0, 2), creature({ id: "b", side: "hostile", position: at(30, 30), creatureTraits: ["goblin"] })]);
    by("a").pos = { x: 0, y: 5 }; // (beside the hero already)
    moveTo(run, by("b"), { x: 5, y: 10 });
    expect(run.log.some(e => e.type === "step")).toBe(false);
    expect(by("a").reactionsLeft).toBe(1);
  });
});

describe("a foe comes into its reach", () => {
  const guard = { id: "stand", label: "Stand Still", on: "foeApproaches", strike: true };
  const setting = () => setUp([
    creature({ id: "guard", position: at(0, 0), reactions: [guard], actions: [strike({ id: "spear", bonus: 30 })] }),
    creature({ id: "orc", side: "hostile", position: at(20, 0), hp: { value: 200, max: 200 }, flags: { fearless: true } })
  ]);

  test("it strikes as the foe arrives", () => {
    const { run, by } = setting();
    moveTo(run, by("orc"), { x: 5, y: 0 });
    expect(run.log.find(e => e.type === "reaction" && e.actorId === "guard")).toMatchObject({ trigger: "foeApproaches", targetId: "orc" });
    expect(run.log.find(e => e.type === "attack" && e.actorId === "guard")).toMatchObject({ targetId: "orc" });
  });

  test("not at one already in its reach, moving about in it", () => {
    const { run, by } = setting();
    by("orc").pos = { x: 5, y: 0 };
    moveTo(run, by("orc"), { x: 0, y: 5 });
    expect(run.log.some(e => e.type === "reaction")).toBe(false);
  });
});

test("in a whole fight: an archer beside the foe scuttles clear as its friend runs in, the same each time with the same dice", () => {
  const bow = strike({ id: "bow", name: "Shortbow", melee: false, reach: undefined, range: { increment: 60, max: 300 } });
  const spec = () => battle([
    creature({ id: "hero", position: at(0, 0), hp: { value: 120, max: 120 }, actions: [strike({ bonus: 12 })] }),
    creature({ id: "archer", side: "hostile", position: at(5, 0), creatureTraits: ["goblin"], reactions: [scuttle], actions: [bow], flags: { fearless: true } }),
    creature({ id: "runner", side: "hostile", position: at(10, 0), creatureTraits: ["goblin"], flags: { fearless: true } })
  ], { positioning: true, maxRounds: 2 });
  let steps = 0;
  for ( let seed = 1; seed <= 6; seed++ ) {
    const a = replay(spec(), pf2eRules, seed);
    const b = replay(spec(), pf2eRules, seed);
    expect(b.log).toEqual(a.log);
    for ( const e of a.log.filter(x => x.type === "step" && x.reaction) ) {
      steps += 1;
      const i = a.log.indexOf(e);
      expect(a.log[i - 1]).toMatchObject({ type: "reaction", actorId: e.actorId, trigger: "allyMoves" });
      expect(Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y)).toBeLessThanOrEqual(5 * Math.SQRT2 + 0.01);
    }
  }
  expect(steps).toBeGreaterThan(0);
});

describe("in a live battle: a player's character moves", () => {
  const spec = () => battle([
    creature({ id: "hero", kind: "pc", position: at(20, 0), hp: { value: 200, max: 200 } }),
    creature({ id: "guard", side: "hostile", position: at(0, 0), reactions: [{ id: "stand", label: "Stand Still", on: "foeApproaches", strike: true }],
      actions: [strike({ id: "spear", bonus: 30 })], flags: { fearless: true } })
  ], { positioning: true, maxRounds: 3 });
  const walk = run => {
    const hero = run.byId.get("hero");
    const from = { ...hero.pos };
    hero.pos = { x: 5, y: 0 };
    return from;
  };

  test("a foe whose reach it came into strikes, now", () => {
    const run = beginLive(spec(), pf2eRules, { seed: 3, players: ["hero"] });
    const events = movedBeside(run, "hero", walk(run), { nonce: 7 });
    expect(events.find(e => e.type === "reaction")).toMatchObject({ actorId: "guard", trigger: "foeApproaches" });
    expect(events.find(e => e.type === "attack")).toMatchObject({ actorId: "guard", targetId: "hero" });
  });

  test("the GM asked first, where the GM wants to be: played again with the answer", () => {
    const run = beginLive(spec(), pf2eRules, { seed: 3, players: ["hero"], npcReactions: "ask" });
    const from = walk(run);
    let asked = null;
    try {
      movedBeside(run, "hero", from, { nonce: 7 });
    } catch ( err ) {
      asked = err;
    }
    expect(asked).toBeInstanceOf(NeedsDecision);
    expect(asked.request).toMatchObject({ unitId: "guard", trigger: "foeApproaches", byId: "hero" });
    const again = beginLive(spec(), pf2eRules, { seed: 3, players: ["hero"], npcReactions: "ask" });
    expect(movedBeside(again, "hero", walk(again), { nonce: 7, answers: [[asked.request.key, false]] }).some(e => e.type === "attack")).toBe(false);
  });
});
