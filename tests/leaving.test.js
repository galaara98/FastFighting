/**
 * Leaving the fight on a map with edges (behavior/leaving.js): set on going, a creature stays in the fight and makes for
 * the nearest edge, its quarrel laid down, and is gone at the edge; with no way off, gone after one turn more. Struck or
 * spoken to on its way, its nature decides whether it keeps going or turns to deal with it first; stopped often enough,
 * it forgets going.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, prepareBattle, battleOver } from "../scripts/engine/simulator.js";
import { startLeaving, isLeaving, commitment, confronted } from "../scripts/engine/behavior/leaving.js";
import { mind, levelOf } from "../scripts/engine/behavior/desire.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";
import { STATUS } from "../scripts/constants.js";

const traits = { tactical: { base: 70, fudge: 0 }, brave: { base: 50, fudge: 0 }, selfish: { base: 50, fudge: 0 }, loyal: { base: 50, fudge: 0 } };
const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
const hero = (extra = {}) => creature({ id: "hero", name: "Hero", traits, hp: { value: 100, max: 100 }, actions: [strike({ bonus: -50 })], ...at(0), ...extra });
const goblin = (extra = {}) => creature({ id: "goblin", name: "Goblin", side: "hostile", traits, hp: { value: 30, max: 30 }, actions: [strike({ bonus: -50 })], speeds: { walk: 25 }, ...at(40), ...extra });

function fight(list, { bounds = { x0: -100, y0: -50, x1: 100, y1: 50 }, options = {} } = {}) {
  const spec = battle(list, { maxRounds: 6, positioning: true, aftermath: "none", ...options });
  if ( bounds ) spec.bounds = bounds;
  const run = beginRun(prepareBattle(spec, pf2eRules), 3, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}

describe("setting out", () => {
  test("it stays in the fight, wanting nothing so much as to be off the map, its quarrel laid down", () => {
    const run = fight([hero(), goblin()]);
    const [h, g] = ["hero", "goblin"].map(id => run.byId.get(id));
    g.desire.stated.set(`hurt|${h.id}`, 90);
    startLeaving(run, g, { by: h });
    expect(g.status).toBe(STATUS.STANDING);
    expect(isLeaving(g)).toBe(true);
    expect(levelOf(g, "hurt", h.id)).toBe(0);
    expect(mind(run, g).lead).toMatchObject({ kind: "leave", targetId: g.id, level: 100 });
    // (Nobody left keeping its side in: the fight is over.)
    expect(battleOver(run)).toBe(true);
  });

  test("on its turns it makes for the nearest edge, and is gone at it", () => {
    const run = fight([hero(), goblin()], { bounds: { x0: -100, y0: -200, x1: 100, y1: 200 } });
    const g = run.byId.get("goblin");
    startLeaving(run, g, {});
    for ( let i = 0; i < 4 && g.status === STATUS.STANDING; i++ ) takeTurn(run, g);
    expect(g.status).toBe(STATUS.FLED);
    expect(g.pos.x).toBeCloseTo(100, 0);
    const moves = run.log.filter(e => e.actorId === "goblin" && e.type === "move" && e.purpose === "leave");
    expect(moves.length).toBeGreaterThan(0);
    expect(run.log.find(e => e.type === "offMap" && e.actorId === "goblin")).toBeTruthy();
  });

  test("with no way off (the map's walls say so), two whole turns given to going, and then gone all the same", () => {
    const run = fight([hero(), goblin()]);
    run.live = { exitOf: () => ({ none: true }) };
    const g = run.byId.get("goblin");
    startLeaving(run, g, {});
    takeTurn(run, g);
    expect(g.status).toBe(STATUS.STANDING);
    takeTurn(run, g);
    expect(g.status).toBe(STATUS.FLED);
    expect(run.log.find(e => e.type === "offMap" && e.actorId === "goblin")).toMatchObject({ blinked: true });
  });

  test("two whole turns in a row given to going: gone, at the edge or not; stopped on the way, they start over", () => {
    const far = { x0: -2000, y0: -2000, x1: 2000, y1: 2000 };
    const run = fight([hero(), goblin()], { bounds: far });
    const g = run.byId.get("goblin");
    startLeaving(run, g, {});
    takeTurn(run, g);
    expect(g.status).toBe(STATUS.STANDING);
    takeTurn(run, g);
    expect(g.status).toBe(STATUS.FLED);
    expect(run.log.find(e => e.type === "offMap" && e.actorId === "goblin")).toMatchObject({ far: true });

    const stopped = fight([hero(), goblin()], { bounds: far, options: { leaveResolve: 0 } });
    const [h, s] = ["hero", "goblin"].map(id => stopped.byId.get(id));
    startLeaving(stopped, s, {});
    takeTurn(stopped, s);
    confronted(stopped, s, h, "attack");
    takeTurn(stopped, s); // (given to what stopped it)
    takeTurn(stopped, s); // (one whole turn going again)
    expect(s.status).toBe(STATUS.STANDING);
    takeTurn(stopped, s);
    expect(s.status).toBe(STATUS.FLED);
  });

  test("along the way its map gives it, around the walls", () => {
    const run = fight([hero(), goblin()]);
    run.live = { exitOf: u => ({ path: [[u.pos.x, u.pos.y], [u.pos.x, 30], [-100, 30]], feet: 0 }) };
    const g = run.byId.get("goblin");
    startLeaving(run, g, {});
    takeTurn(run, g);
    // (Up the first leg before heading off: not straight to the nearer edge.)
    expect(g.pos.y).toBeGreaterThan(0);
  });

  test("without edges, gone at once, as ever", () => {
    const run = fight([hero(), goblin()], { bounds: null });
    const g = run.byId.get("goblin");
    g.tac = { ...g.tac, retreat: "hurt" };
    g.hp = 1;
    takeTurn(run, g);
    expect(g.leaving ?? null).toBeNull();
  });
});

describe("stopped on its way", () => {
  test("its nature: all of the world's share for one that leans to going, never under 70% of it", () => {
    const run = fight([hero(), goblin({ playstyles: ["chicken"] }), creature({ id: "orc", name: "Orc", side: "hostile", traits: { ...traits, brave: { base: 100, fudge: 0 } }, playstyles: ["vengeful", "relentless"], actions: [strike()], ...at(-40) })]);
    const [g, o] = ["goblin", "orc"].map(id => run.byId.get(id));
    g.tac = { ...g.tac, retreat: "hurt", talk: "never" };
    o.tac = { ...o.tac, retreat: "never", talk: "always" };
    expect(commitment(run, g, "attack")).toBe(1);
    expect(commitment(run, o, "attack")).toBeCloseTo(0.7);
    expect(commitment(run, o, "talk")).toBeGreaterThanOrEqual(0.7);
  });

  test("kept going (the share all of it), or turned to what stopped it, going second; back on its way after a turn", () => {
    const keeps = fight([hero(), goblin()], { options: { leaveResolve: 100 } });
    const [h1, g1] = ["hero", "goblin"].map(id => keeps.byId.get(id));
    startLeaving(keeps, g1, {});
    expect(confronted(keeps, g1, h1, "attack")).toMatchObject({ kept: true });
    expect(isLeaving(g1)).toBe(true);

    const stops = fight([hero(), goblin()], { options: { leaveResolve: 0 } });
    const [h, g] = ["hero", "goblin"].map(id => stops.byId.get(id));
    startLeaving(stops, g, {});
    expect(confronted(stops, g, h, "attack")).toMatchObject({ kept: false, forgot: false });
    expect(isLeaving(g)).toBe(false);
    const ranked = mind(stops, g).ranked;
    expect(ranked[0]).toMatchObject({ kind: "hurt", targetId: "hero" });
    expect(ranked[1]).toMatchObject({ kind: "leave" });
    // (Its turn given to that, it's on its way again.)
    takeTurn(stops, g);
    expect(isLeaving(g)).toBe(true);
    expect(levelOf(g, "hurt", "hero")).toBe(0);
  });

  test("stopped often enough, it forgets going: the less its nature holds it, the sooner", () => {
    const run = fight([hero(), goblin()], { options: { leaveResolve: 0 } });
    const [h, g] = ["hero", "goblin"].map(id => run.byId.get(id));
    startLeaving(run, g, {});
    let stops = 0;
    const said = [];
    while ( g.leaving && stops < 10 ) {
      confronted(run, g, h, "attack", (unit, e) => said.push(e));
      stops++;
    }
    expect(g.leaving).toBeNull();
    expect(stops).toBeGreaterThanOrEqual(3);
    expect(stops).toBeLessThanOrEqual(5);
    expect(said.at(-1)).toMatchObject({ type: "leaveStopped", forgot: true });
  });
});
