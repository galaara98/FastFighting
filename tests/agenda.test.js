/**
 * What a creature means to do, in order (behavior/desire.js orderAgenda): its top what it's working on; new desires at
 * the bottom unless placed or a good fit; everything climbing toward second, the faster the more intense; its mind
 * jumping to the strongest now and then (the ADHD setting), more readily for what it could do this very turn; a
 * planner ordering it by what matters; and the turn working on its top first.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, prepareBattle } from "../scripts/engine/simulator.js";
import { orderAgenda, placeDesire, mind } from "../scripts/engine/behavior/desire.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { creature, strike, battle } from "./helpers.js";
import { STATUS } from "../scripts/constants.js";

const traitsAt = tactical => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 50, fudge: 0 }, selfish: { base: 50, fudge: 0 }, loyal: { base: 50, fudge: 0 } });
const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
const foe = (id, x, extra = {}) => creature({ id, name: id, side: "hostile", traits: traitsAt(50), hp: { value: 50, max: 50 }, actions: [strike({ bonus: -50 })], ...at(x), ...extra });

function fight({ tactical = 30, adhd = 20, me = {}, others = [] } = {}) {
  const spec = battle([
    creature({ id: "me", name: "Me", traits: traitsAt(tactical), hp: { value: 50, max: 50 }, actions: [strike({ bonus: -50 })], ...at(0), ...me }),
    foe("a", 5), foe("b", 10), foe("c", 15), foe("d", 20), ...others
  ], { maxRounds: 3, positioning: true, aftermath: "none", morale: false, talking: false, adhd });
  const run = beginRun(prepareBattle(spec, pf2eRules), 5, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  const u = run.byId.get("me");
  u.desire.logic.clear();
  return { run, u };
}
const want = (u, id, level) => u.desire.stated.set(`hurt|${id}`, level);
const order = u => u.agenda.map(k => k.split("|")[1]);

describe("the order of what it means to do", () => {
  test("its first thoughts in order of strength; a new one at the bottom, climbing toward second the faster the more intense", () => {
    const { run, u } = fight({ adhd: 0 });
    want(u, "a", 50);
    want(u, "b", 40);
    want(u, "c", 30);
    orderAgenda(run, u);
    expect(order(u)).toEqual(["a", "b", "c"]);
    // (A faint new one: at the bottom, and it stays there.)
    want(u, "d", 10);
    orderAgenda(run, u);
    expect(order(u).at(-1)).toBe("d");
    // (An obsession: second at once.)
    want(u, "d", 85);
    orderAgenda(run, u);
    expect(order(u)[1]).toBe("d");
    // (Its top stays its top: it keeps at what it's doing.)
    expect(order(u)[0]).toBe("a");
  });

  test("placed first or second (setting out to leave, what stopped it), wherever it was", () => {
    const { run, u } = fight({ adhd: 0 });
    for ( const [id, lvl] of [["a", 50], ["b", 40], ["c", 30], ["d", 20]] ) want(u, id, lvl);
    orderAgenda(run, u);
    placeDesire(u, "hurt", "d", "top");
    placeDesire(u, "hurt", "c", "second");
    orderAgenda(run, u);
    expect(order(u).slice(0, 2)).toEqual(["d", "c"]);
  });

  test("its mind jumps to the strongest now and then: never at 0%, always at 100%", () => {
    const steady = fight({ adhd: 0 });
    want(steady.u, "c", 30);
    orderAgenda(steady.run, steady.u);
    want(steady.u, "a", 70);
    orderAgenda(steady.run, steady.u);
    expect(order(steady.u)[0]).toBe("c");
    const jumpy = fight({ adhd: 100 });
    want(jumpy.u, "c", 30);
    orderAgenda(jumpy.run, jumpy.u);
    want(jumpy.u, "a", 70);
    orderAgenda(jumpy.run, jumpy.u);
    expect(order(jumpy.u)[0]).toBe("a");
  });

  test("three times as readily for the least thoughtful, when it could do it this very turn", () => {
    // (34% ×3: sure, for a foe right beside it.)
    let jumps = 0;
    for ( let n = 0; n < 10; n++ ) {
      const { run, u } = fight({ tactical: 25, adhd: 34 });
      want(u, "d", 30);
      orderAgenda(run, u);
      want(u, "a", 70);
      orderAgenda(run, u);
      if ( order(u)[0] === "a" ) jumps++;
    }
    expect(jumps).toBe(10);
  });

  test("one who plans ahead orders it by what matters most", () => {
    const { run, u } = fight({ tactical: 70, adhd: 0 });
    want(u, "c", 30);
    orderAgenda(run, u);
    want(u, "a", 70);
    want(u, "b", 50);
    orderAgenda(run, u);
    expect(order(u)).toEqual(["a", "b", "c"]);
  });

  test("a good fit goes first: a Cruel one, the foe it fought fallen", () => {
    const { run, u } = fight({ adhd: 0, me: { playstyles: ["cruel"], behavior: { finishDowned: 0.8 } } });
    for ( const [id, lvl] of [["a", 50], ["b", 40], ["c", 30]] ) want(u, id, lvl);
    orderAgenda(run, u);
    const c = run.byId.get("c");
    c.status = STATUS.DOWN;
    c.hp = 0;
    orderAgenda(run, u);
    expect(order(u)[0]).toBe("c");
  });

  test("a protective one: whoever's at a friend it can reach this turn, first", () => {
    const friend = creature({ id: "friend", name: "Friend", traits: traitsAt(50), hp: { value: 50, max: 50 }, actions: [strike({ bonus: -50 })], ...at(5, 5) });
    const { run, u } = fight({ adhd: 0, me: { tactics: { style: "protector" } }, others: [friend] });
    for ( const [id, lvl] of [["b", 50], ["c", 40], ["d", 30]] ) want(u, id, lvl);
    orderAgenda(run, u);
    const a = run.byId.get("a");
    a.targetId = "friend";
    a.adjacent.add("friend");
    want(u, "a", 20);
    orderAgenda(run, u);
    expect(order(u)[0]).toBe("a");
  });
});

describe("the turn, its top first", () => {
  test("set on hurting, with a friend to heal next: the blow first, then the heal", () => {
    const heal = { id: "mend", name: "Mend", kind: "heal", heal: [parseFormula("10", "healing")], range: { max: 60 }, cost: 1 };
    const friend = creature({ id: "friend", name: "Friend", traits: traitsAt(50), hp: { value: 10, max: 50 }, actions: [strike({ bonus: -50 })], ...at(-5) });
    const { run, u } = fight({ adhd: 0, me: { actions: [strike({ bonus: 60 }), heal] }, others: [friend] });
    u.agenda = ["hurt|a", "heal|friend"];
    u.desire.stated.set("hurt|a", 80);
    u.desire.stated.set("heal|friend", 60);
    takeTurn(run, u);
    const mine = run.log.filter(e => e.actorId === "me" && (e.type === "attack" || e.type === "heal")).map(e => e.type);
    expect(mine[0]).toBe("attack");
    expect(mine).toContain("heal");
    expect(mind(run, u).lead).toBeTruthy();
  });
});
