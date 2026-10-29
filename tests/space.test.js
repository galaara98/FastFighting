/**
 * Space on the map (behavior/space.js): nobody's move ends in another's space; a melee move takes the nearest free
 * spot within reach (the map's squares, wherever its last move left it; round a foe between squares, the squares as they
 * lie round it), and one with every spot round it taken can't be reached; past a foe the long way round, past a
 * friend freely, as the system says otherwise (passThrough, tumbleThrough, endIn). And sight past the scene's walls: a
 * ranged attacker with no clear line moves to a spot it has one from, a one-way wall and limited walls as Foundry has
 * them, a door shut or open, the cover a target has.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, takeTurn, prepareBattle } from "../scripts/engine/simulator.js";
import { movesNeeded, moveToward, edgeDistance, currentAc, saveRoll, COVER_POINTS, reachShape } from "../scripts/engine/battle-state.js";
import { inTheWay, spotWithin, spotToShoot, stepSpots, lineOfSight, sightBlocked, lineBlocked, blockedPoints, coverFrom, crossed, crossesAny, crossedExtra } from "../scripts/engine/behavior/space.js";
import { spotsWithin } from "../scripts/engine/behavior/prepare.js";
import { areEnemies } from "../scripts/engine/battle-state.js";
import { snapshotRun } from "../scripts/engine/live.js";
import { STATUS } from "../scripts/constants.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const traits = { tactical: { base: 70, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 40, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
const bow = { id: "bow", name: "Bow", kind: "strike", cost: 1, bonus: 9, maps: [0, -5, -10], melee: false, range: { increment: 60, max: 60 }, damage: [{ dice: [{ n: 1, faces: 8, mult: 1 }], flat: 0, type: "piercing", persistent: false, category: null }] };
const who = (id, side, x, y = 0, extra = {}) => creature({ id, name: id, side, traits, hp: { value: 60, max: 60 }, actions: [strike({ bonus: -50 })], ...at(x, y), ...extra });

function fight(list, { rules = pf2eRules, walls = undefined } = {}) {
  const spec = battle(list, { maxRounds: 4, positioning: true, aftermath: "none" });
  if ( walls !== undefined ) spec.walls = walls;
  const run = beginRun(prepareBattle(spec, rules), 2, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}
const get = (run, ...ids) => ids.map(id => run.byId.get(id));
const wall = (ax, ay, bx, by, extra = {}) => ({ a: [ax, ay], b: [bx, by], s: 20, d: 0, door: null, open: false, ...extra });

describe("room", () => {
  test("a spot freed (whoever stood there killed, nobody moving): free at once, not as it was a moment ago", () => {
    // (A goblin on the spot nearest the hero beside the orc; the next best is a step round.)
    const run = fight([who("hero", "friendly", 0), who("goblin", "friendly", 35), who("orc", "hostile", 40)]);
    const [h, g, o] = get(run, "hero", "goblin", "orc");
    const round = spotWithin(run, h, o, 5);
    expect(round).toBeTruthy();
    expect(round.x === 35 && round.y === 0).toBe(false);
    g.status = STATUS.DEAD; // (as the system's own recovery check would have it: nothing else said)
    expect(spotWithin(run, h, o, 5)).toMatchObject({ x: 35, y: 0 });
  });

  test("a melee move never ends in another's space: the nearest free spot within reach instead", () => {
    // (The orc at 20, a goblin already where the hero would stop, at 15.)
    const run = fight([who("hero", "friendly", 0), who("goblin", "friendly", 15), who("orc", "hostile", 20)]);
    const [h, , o] = get(run, "hero", "goblin", "orc");
    expect(inTheWay(run, h, { x: 15, y: 0 })).toBeTruthy();
    moveToward(run, h, o, 5, 30);
    expect(inTheWay(run, h, h.pos)).toBeNull();
    expect(edgeDistance(h, o)).toBeLessThanOrEqual(5.5);
  });

  test("one with every spot round it taken can't be reached up close; with a reach weapon it can", () => {
    const ring = [[-5, -5], [0, -5], [5, -5], [-5, 0], [5, 0], [-5, 5], [0, 5], [5, 5]].map(([x, y], i) => who(`g${i}`, "hostile", 50 + x, y));
    const run = fight([who("hero", "friendly", 0), who("orc", "hostile", 50), ...ring]);
    const [h, o] = get(run, "hero", "orc");
    expect(spotWithin(run, h, o, 5)).toBeNull();
    expect(movesNeeded(run, h, o, strike())).toBe(Infinity);
    expect(Number.isFinite(movesNeeded(run, h, o, strike({ reach: 10 })))).toBe(true);
  });

  test("its last move left it between squares: it still finds a free square beside a crowded foe, and ends its move there", () => {
    // (The orc's square-mates on the hero's side of it, the way straight in taken; the hero half a square off the
    // squares it began on, where none of the spots a square's width from it lie beside the orc.)
    const run = fight([who("hero", "friendly", 0), who("orc", "hostile", 50), who("g1", "friendly", 45), who("g2", "friendly", 50, -5)]);
    const [h, o] = get(run, "hero", "orc");
    h.pos = { x: 27.5, y: 2.5 };
    const spot = spotWithin(run, h, o, 5);
    expect(spot).toMatchObject({ x: 50, y: 5 });
    expect(spot.feet).toBeCloseTo(Math.hypot(22.5, 2.5), 6);
    expect(movesNeeded(run, h, o, strike())).toBe(1);
    const move = moveToward(run, h, o, 5, 25);
    expect(move.reached).toBe(true);
    expect(h.pos).toEqual({ x: 50, y: 5 });
    expect(move.cost).toBeCloseTo(Math.hypot(22.5, 2.5), 6);
    expect(inTheWay(run, h, h.pos)).toBeNull();
  });

  test("a crowded foe standing between squares: where none of the map's squares round it is in reach and free, the squares as they lie round it", () => {
    // (The orc a foot and a half off its square: of the map's squares, only one is beside it, and a goblin has it.)
    const run = fight([who("hero", "friendly", 0), who("orc", "hostile", 50), who("g1", "friendly", 55, 5)]);
    const [h, o] = get(run, "hero", "orc");
    o.pos = { x: 51.5, y: 1.5 };
    const spot = spotWithin(run, h, o, 5);
    expect(spot).toMatchObject({ x: 46.5, y: 1.5 });
    expect(Math.hypot(spot.x - o.pos.x, spot.y - o.pos.y)).toBeCloseTo(5, 6);
    expect(inTheWay(run, h, spot)).toBeNull();
    expect(Number.isFinite(movesNeeded(run, h, o, strike()))).toBe(true);
  });

  test("every spot a creature between squares looks for is on the squares it began on: to shoot from, to step to, for later", () => {
    const run = fight([who("hero", "friendly", 0, 0, { actions: [bow] }), who("orc", "hostile", 100), who("g1", "friendly", 30)],
      { walls: [wall(60, -40, 60, 40)] });
    const [h, o] = get(run, "hero", "orc");
    h.pos = { x: 21.5, y: -3 };
    const square = p => Number.isInteger(p.x / 5) && Number.isInteger(p.y / 5);
    const shoot = spotToShoot(run, h, o, 60, 50, edgeDistance);
    expect(shoot && square(shoot)).toBe(true);
    expect(shoot.feet).toBeCloseTo(Math.hypot(shoot.x - h.pos.x, shoot.y - h.pos.y), 6);
    expect(shoot.feet).toBeLessThanOrEqual(50.5);
    const steps = stepSpots(run, h, 5);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every(square)).toBe(true);
    expect(steps.every(p => Math.hypot(p.x - h.pos.x, p.y - h.pos.y) <= 5 * Math.SQRT2 + 0.5)).toBe(true);
    const later = spotsWithin(run, h, 25);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every(square)).toBe(true);
  });

  test("past a foe on its feet: the long way round; past a friend: freely; as the system says otherwise", () => {
    const run = fight([who("hero", "friendly", 0), who("ally", "friendly", 10), who("orc", "hostile", 20), who("target", "hostile", 40)]);
    const [h, , , t] = get(run, "hero", "ally", "orc", "target");
    const list = crossed(run, h, h.pos, { x: 35, y: 0 }, t);
    expect(list.map(x => x.o.id)).toEqual(["ally", "orc"]);
    expect(crossedExtra(run, h, h.pos, { x: 35, y: 0 }, t, areEnemies)).toBe(5);
    const fivee = fight([who("hero", "friendly", 0), who("ally", "friendly", 10), who("target", "hostile", 40)], { rules: { ...pf2eRules, passThrough: (r, u, o) => (areEnemies(r, u, o) ? "around" : "difficult") } });
    const [h2, , t2] = get(fivee, "hero", "ally", "target");
    expect(crossedExtra(fivee, h2, h2.pos, { x: 35, y: 0 }, t2, areEnemies)).toBe(5);
  });

  test("whether a line crosses any of some creatures: as crossed finds them, for lines every which way", () => {
    let seed = 3;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const spot = () => 5 * Math.round((-40 + 80 * rnd()) / 5);
    const run = fight(Array.from({ length: 8 }, (_, i) => who(`c${i}`, i % 2 ? "hostile" : "friendly", spot(), spot())));
    const [h] = get(run, "c0");
    const foes = run.units.filter(o => o.side === "hostile");
    let crossing = 0;
    for ( let i = 0; i < 400; i++ ) {
      const q = { x: spot(), y: spot() };
      const want = crossed(run, h, h.pos, q).some(({ o }) => foes.includes(o));
      expect(crossesAny(h, h.pos, q, foes)).toBe(want);
      if ( want ) crossing += 1;
    }
    expect(crossing).toBeGreaterThan(20);
    expect(crossing).toBeLessThan(380);
  });

  test("tumbling past: failed, its move stops short of that one", () => {
    const rules = { ...pf2eRules, passThrough: (r, u, o) => (areEnemies(r, u, o) ? "tumble" : null), tumbleThrough: () => ({ success: false, natural: 3, mod: 5, total: 8, dc: 15 }) };
    const run = fight([who("hero", "friendly", 0), who("orc", "hostile", 15), who("target", "hostile", 30)], { rules });
    const [h, o, t] = get(run, "hero", "orc", "target");
    moveToward(run, h, t, 5, 30);
    expect(h.pos.x).toBeLessThan(15);
    expect(inTheWay(run, h, h.pos)).toBeNull();
    expect(run.log.find(e => e.type === "tumble")).toMatchObject({ targetId: "orc", success: false });
    expect(o.pos.x).toBe(15);
  });

  test("tumbling past as many in a move as the system allows (PF2e one): the next stops it short, untried", () => {
    const tumbles = [];
    const rules = { ...pf2eRules, tumblesPerMove: 1, passThrough: (r, u, o) => (areEnemies(r, u, o) ? "tumble" : null),
      tumbleThrough: (r, u, o) => { tumbles.push(o.id); return { success: true }; } };
    const run = fight([who("hero", "friendly", 0), who("orc", "hostile", 15), who("kobold", "hostile", 25), who("target", "hostile", 45)], { rules });
    const [h, , , t] = get(run, "hero", "orc", "kobold", "target");
    moveToward(run, h, t, 5, 60);
    expect(tumbles).toEqual(["orc"]);
    expect(run.log.filter(e => e.type === "tumble").map(e => e.targetId)).toEqual(["orc"]);
    expect(h.pos.x).toBeLessThan(25);
    expect(inTheWay(run, h, h.pos)).toBeNull();
  });

  test("tumbling past: through, as through difficult ground, unless the system says not", () => {
    const tumbling = difficult => ({ ...pf2eRules, passThrough: (r, u, o) => (areEnemies(r, u, o) ? "tumble" : null), tumbleThrough: () => ({ success: true, difficult }) });
    const through = difficult => {
      const run = fight([who("hero", "friendly", 0), who("orc", "hostile", 15), who("target", "hostile", 40)], { rules: tumbling(difficult) });
      const [h, , t] = get(run, "hero", "orc", "target");
      return moveToward(run, h, t, 5, 60);
    };
    const hard = through(undefined);
    expect(hard.cost).toBe(hard.feet + 5);
    const easy = through(false);
    expect(easy.cost).toBe(easy.feet);
  });

  test("ending in another's space, where the system allows it (a Tiny creature)", () => {
    const rules = { ...pf2eRules, endIn: (r, u, o) => o.id === "pixie" };
    const run = fight([who("hero", "friendly", 0), who("pixie", "friendly", 15)], { rules });
    expect(inTheWay(run, run.byId.get("hero"), { x: 15, y: 0 })).toBeNull();
  });
});

describe("sight past walls", () => {
  test("a wall between them: no line of sight; moved to where it has one, it shoots", () => {
    // (A wall from (20,-10) to (20,10): between the archer at 0 and the orc at 40; open ground below it.)
    const walls = [wall(20, -10, 20, 10)];
    const run = fight([who("archer", "friendly", 0, 0, { actions: [bow] }), who("orc", "hostile", 40)], { walls });
    const [a, o] = get(run, "archer", "orc");
    expect(lineOfSight(run, a, o)).toBe(false);
    expect(movesNeeded(run, a, o, bow)).toBeGreaterThanOrEqual(1);
    takeTurn(run, a);
    expect(lineOfSight(run, a, o)).toBe(true);
    expect(run.log.some(e => e.type === "attack" && e.actorId === "archer")).toBe(true);
    // (And no closer than it had to: it didn't walk up to the orc.)
    expect(edgeDistance(a, o)).toBeGreaterThan(10);
  });

  test("in the open, in range: it stays where it is", () => {
    const run = fight([who("archer", "friendly", 0, 0, { actions: [bow] }), who("orc", "hostile", 40)], { walls: [] });
    const [a, o] = get(run, "archer", "orc");
    expect(movesNeeded(run, a, o, bow)).toBe(0);
  });

  test("a one-way wall lets sight through from the side it faces; two limited walls stop it, one doesn't", () => {
    const run = fight([who("a", "friendly", 0), who("b", "hostile", 40)], { walls: [] });
    const p = { x: 0, y: 0 };
    const q = { x: 40, y: 0 };
    const oneWay = d => fight([who("a", "friendly", 0), who("b", "hostile", 40)], { walls: [wall(20, -10, 20, 10, { d })] });
    // (Foundry's rule: it lets sight through when the viewer is on the side it names.)
    const blocks = [1, 2].map(d => sightBlocked(oneWay(d), p, q));
    expect(blocks.filter(Boolean)).toHaveLength(1);
    expect(sightBlocked(oneWay(1), p, q)).not.toBe(sightBlocked(oneWay(1), q, p));
    const limited = n => fight([who("a", "friendly", 0), who("b", "hostile", 40)], { walls: Array.from({ length: n }, (_, i) => wall(15 + 10 * i, -10, 15 + 10 * i, 10, { s: 10 })) });
    expect(sightBlocked(limited(1), p, q)).toBe(false);
    expect(sightBlocked(limited(2), p, q)).toBe(true);
    expect(sightBlocked(run, p, q)).toBe(false);
  });

  test("a door: shut, it stops sight; opened in the fight, not", () => {
    const run = fight([who("a", "friendly", 0), who("b", "hostile", 40)], { walls: [wall(20, -10, 20, 10, { door: "d1" })] });
    const [a, b] = get(run, "a", "b");
    expect(lineOfSight(run, a, b)).toBe(false);
    run.doors.set("d1", { open: true });
    run.geo = (run.geo ?? 0) + 1;
    expect(lineOfSight(run, a, b)).toBe(true);
  });

  test("a map with many walls: every line of sight comes out as looking at each wall would have it", () => {
    // (Hundreds of short walls, some limited, some one-way, some doors (one open), and lines every which way: the walls'
    // index against the same walls looked at one by one.)
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const walls = Array.from({ length: 300 }, (_, i) => {
      const x = -200 + 400 * rnd();
      const y = -200 + 400 * rnd();
      return wall(x, y, x + 40 * (rnd() - 0.5), y + 40 * (rnd() - 0.5), { s: rnd() < 0.25 ? 10 : 20, d: rnd() < 0.1 ? 1 + Math.floor(2 * rnd()) : 0, door: i % 50 === 0 ? `d${i}` : null });
    });
    walls.push(wall(0, -300, 0, 300), wall(-100, 30, 100, 30, { s: 10 }));
    const indexed = fight([who("a", "friendly", 0), who("b", "hostile", 40)], { walls });
    const plain = fight([who("a", "friendly", 0), who("b", "hostile", 40)], { walls });
    sightBlocked(plain, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(plain.prep.sightIndex).toBeTruthy();
    plain.prep.sightIndex = null; // (the same walls, each looked at)
    for ( const run of [indexed, plain] ) run.doors.set("d50", { open: true });
    let blocked = 0;
    for ( let i = 0; i < 3000; i++ ) {
      const p = { x: -220 + 440 * rnd(), y: -220 + 440 * rnd() };
      const far = rnd() < 0.2 ? 400 : 60;
      const q = { x: p.x + far * (rnd() - 0.5), y: p.y + far * (rnd() - 0.5) };
      const got = sightBlocked(indexed, p, q);
      expect(got).toBe(sightBlocked(plain, p, q));
      if ( got ) blocked += 1;
    }
    // (Lines both ways: plenty blocked, plenty clear.)
    expect(blocked).toBeGreaterThan(300);
    expect(blocked).toBeLessThan(2700);
  });

  test("cover the system has no rule for: three quarters of it hidden or more, a little more AC and saves against that one; none for less", () => {
    // (A wall hiding the orc's upper corners and middle: three of its five points.)
    const walls = [wall(20, -20, 20, 0.5)];
    const run = fight([who("archer", "friendly", 0), who("orc", "hostile", 40)], { walls });
    const [a, o] = get(run, "archer", "orc");
    expect(coverFrom(run, a, o)).toBe("most");
    expect(currentAc(run, o, a, bow) - o.spec.defenses.ac).toBe(COVER_POINTS);
    expect(saveRoll(run, o, "reflex", { from: a }).mod - saveRoll(run, o, "reflex").mod).toBe(COVER_POINTS);
    // (A system with its own: none of the core's; its rules see the cover.)
    const seen = [];
    const own = fight([who("archer", "friendly", 0), who("orc", "hostile", 40)], { walls, rules: { ...pf2eRules, handlesCover: true, modifiers: { ...pf2eRules.modifiers, defense: ctx => (seen.push(ctx.cover), 0) } } });
    const [a2, o2] = get(own, "archer", "orc");
    expect(currentAc(own, o2, a2, bow)).toBe(o2.spec.defenses.ac);
    expect(seen).toContain("most");
    // (Some of it only: nothing more.)
    const some = fight([who("archer", "friendly", 0), who("orc", "hostile", 40)], { walls: [wall(20, -20, 20, -0.5)] });
    const [a3, o3] = get(some, "archer", "orc");
    expect(currentAc(some, o3, a3, bow)).toBe(o3.spec.defenses.ac);
  });

  test("cover: some of it hidden behind a wall's end", () => {
    // (A wall up to the line between them, hiding the orc's upper corners only.)
    const run = fight([who("archer", "friendly", 0), who("orc", "hostile", 40)], { walls: [wall(20, -20, 20, -0.5)] });
    const [a, o] = get(run, "archer", "orc");
    expect(lineOfSight(run, a, o)).toBe(true);
    expect(coverFrom(run, a, o)).toBe("some");
  });
});

describe("one look at the map while it decides", () => {
  test("the moves it needs, kept while it makes up its mind (the same answers), and none kept once its turn is done", () => {
    const run = fight([who("hero", "friendly", 0), who("goblin", "friendly", 15), who("orc", "hostile", 40), who("archer", "hostile", 60, 20, { actions: [bow] })]);
    const [h, o, a] = get(run, "hero", "orc", "archer");
    const sword = h.prep.offense[0];
    const fresh = [movesNeeded(run, h, o, sword), movesNeeded(run, h, a, sword), movesNeeded(run, a, h, bow)];
    run.movesCache = new Map();
    expect([movesNeeded(run, h, o, sword), movesNeeded(run, h, a, sword), movesNeeded(run, a, h, bow)]).toEqual(fresh);
    expect(run.movesCache.get(h).get(reachShape(sword)).get(o)).toBe(fresh[0]);
    takeTurn(run, h);
    expect(run.movesCache).toBeNull();
    // (Kept with a live battle, it isn't: snapshotRun leaves out anything named for a cache.)
    run.movesCache = new Map([[h, new Map()]]);
    expect(Object.keys(snapshotRun(run).run)).not.toContain("movesCache");
  });

  test("one action's moves kept for every action that gets there the same way (a Strike, a Trip): each as if worked out alone", () => {
    const run = fight([who("hero", "friendly", 0), who("goblin", "friendly", 15), who("orc", "hostile", 40), who("archer", "hostile", 60, 20, { actions: [bow] })], { walls: [wall(20, -10, 20, 10)] });
    const actions = [{ id: "cut", reach: 5 }, { id: "trip", reach: 5 }, { id: "glaive", reach: 10 }, { id: "charge", reach: 5, charge: 2 }, bow, { ...bow, id: "bow2" }, { id: "sling", range: { increment: 30 } }];
    expect(reachShape(actions[0])).toBe(reachShape(actions[1]));
    expect(reachShape(bow)).toBe(reachShape(actions[5]));
    expect(new Set(actions.map(reachShape)).size).toBe(5);
    const all = () => run.units.flatMap(a => run.units.filter(t => t !== a).flatMap(t => actions.map(x => movesNeeded(run, a, t, x))));
    const alone = all();
    run.movesCache = new Map();
    const kept = all();
    run.movesCache = null;
    expect(kept).toEqual(alone);
    expect(alone.some(m => m > 0)).toBe(true);
  });

  test("a spot to shoot from: the nearest within reach it would see its target from, as looking at every square in turn finds it", () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const walls = Array.from({ length: 40 }, () => {
      const x = -60 + 120 * rnd();
      const y = -60 + 120 * rnd();
      return wall(x, y, x + 30 * (rnd() - 0.5), y + 30 * (rnd() - 0.5));
    });
    const run = fight([who("a", "friendly", 0), who("b", "hostile", 40), who("c", "friendly", 10, 10)], { walls });
    const [a, b] = get(run, "a", "b");
    // (Every square within `most` of a, nearest first, and the first that will do: the search square by square.)
    const bySquares = (range, most) => {
      const spots = [];
      const r = Math.floor(most / 5) * 5;
      for ( let dx = -r; dx <= r; dx += 5 ) for ( let dy = -r; dy <= r; dy += 5 ) {
        const p = { x: a.pos.x + dx, y: a.pos.y + dy, feet: Math.hypot(dx, dy) };
        if ( p.feet <= most + 0.5 ) spots.push(p);
      }
      spots.sort((p, q) => p.feet - q.feet);
      return spots.find(p => edgeDistance({ pos: p, spec: a.spec }, b) <= range + 0.5 && !(p.feet > 0 && inTheWay(run, a, p)) && lineOfSight(run, a, b, p)) ?? null;
    };
    const grid = () => 5 * Math.round((-90 + 180 * rnd()) / 5);
    let found = 0;
    let none = 0;
    for ( let i = 0; i < 150; i++ ) {
      a.pos = { ...a.pos, x: grid(), y: grid() };
      b.pos = { ...b.pos, x: grid(), y: grid() };
      run.geo = (run.geo ?? 0) + 1; // (someone moved: what was kept is stale)
      for ( const [range, most] of [[15, 25], [30, 50], [60, 50], [10, 37.5]] ) {
        const got = spotToShoot(run, a, b, range, most, edgeDistance);
        const want = bySquares(range, most);
        expect(got ? { x: got.x, y: got.y, feet: got.feet } : null).toEqual(want);
        if ( got ) found += 1;
        else none += 1;
      }
    }
    // (Both kinds: spots found, and none, near and far.)
    expect(found).toBeGreaterThan(100);
    expect(none).toBeGreaterThan(100);
  });

  test("lines of sight kept by where they run: as worked out afresh, through everyone's moves, a door opened and shut, another fight on the same walls", () => {
    let seed = 5;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const walls = Array.from({ length: 30 }, (_, i) => {
      const x = -60 + 120 * rnd();
      const y = -60 + 120 * rnd();
      return wall(x, y, x + 30 * (rnd() - 0.5), y + 30 * (rnd() - 0.5), { s: rnd() < 0.3 ? 10 : 20, door: i % 6 === 0 ? `d${i}` : null });
    });
    const run = fight([who("a", "friendly", 0), who("b", "hostile", 40)], { walls });
    const [a, b] = get(run, "a", "b");
    const grid = () => 5 * Math.round((-70 + 140 * rnd()) / 5);
    // (Every point of b, each looked at alone: what blockedPoints and lineBlocked must come to.)
    const afresh = (p, q) => sightBlocked(run, p, q);
    const pointsAfresh = () => {
      const h = 2;
      return [[0, 0], [-h, -h], [h, -h], [-h, h], [h, h]].filter(([dx, dy]) => afresh(a.pos, { x: b.pos.x + dx, y: b.pos.y + dy })).length;
    };
    const check = () => {
      let hidden = 0;
      for ( let i = 0; i < 60; i++ ) {
        a.pos = { x: grid(), y: grid() };
        b.pos = { x: grid(), y: grid() };
        run.geo = (run.geo ?? 0) + 1; // (someone moved)
        expect(blockedPoints(run, a, b)).toBe(pointsAfresh());
        expect(lineBlocked(run, a.pos, b.pos)).toBe(afresh(a.pos, b.pos));
        if ( afresh(a.pos, b.pos) ) hidden += 1;
      }
      return hidden;
    };
    // (Lines both ways: some hidden, some clear.)
    const hidden = check();
    expect(hidden).toBeGreaterThan(5);
    expect(hidden).toBeLessThan(55);
    const kept = run.sightCache.store;
    // (Moves keep what's kept: the same lines, the same store.)
    run.geo += 1;
    blockedPoints(run, a, b);
    expect(run.sightCache.store).toBe(kept);
    // (A door opened: another store, the right answers; shut again, the first one back.)
    run.doors.set("d0", { open: true });
    run.geo += 1;
    check();
    expect(run.sightCache.store).not.toBe(kept);
    run.doors.set("d0", { open: false });
    run.geo += 1;
    check();
    expect(run.sightCache.store).toBe(kept);
    // (Another fight on the same walls shares them; the store isn't kept with a live battle's snapshot.)
    const other = fight([who("a", "friendly", 0), who("b", "hostile", 40)], { walls });
    blockedPoints(other, ...get(other, "a", "b"));
    expect(other.sightCache.store).toBe(kept);
    expect(Object.keys(snapshotRun(run).run)).not.toContain("sightCache");
  });
});
