/**
 * How everyone can reach everyone (foundry/terrain.js computeApproach), on a stand-in for Foundry's canvas: worked out
 * again after some have moved, only the pairs with one of them in it are measured again, and the matrix comes out as
 * measuring every pair afresh would have it.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { computeApproach } from "../scripts/foundry/terrain.js";
import { resetPathGrid } from "../scripts/foundry/pathing.js";

const SIZE = 100;
const saved = {};
const orient = (a, b, c) => (a.y - c.y) * (b.x - c.x) - (a.x - c.x) * (b.y - c.y);
function lineSegmentIntersects(a, b, c, d) {
  const xa = orient(a, b, c);
  const xb = orient(a, b, d);
  if ( !xa && !xb ) return false;
  return (xa * xb) <= 0 && (orient(c, d, a) * orient(c, d, b)) <= 0;
}
let measured = 0;
const blockedBy = (a, b) => globalThis.canvas.scene.walls.some(w => lineSegmentIntersects(a, b, { x: w.c[0], y: w.c[1] }, { x: w.c[2], y: w.c[3] }));

/** A token at square (col, row). */
function token(id, col, row) {
  const t = {
    id,
    document: { x: col * SIZE, y: row * SIZE, _source: { x: col * SIZE, y: row * SIZE }, elevation: 0, width: 1, height: 1 },
    get center() { return { x: this.document.x + SIZE / 2, y: this.document.y + SIZE / 2 }; },
    checkCollision(dest) {
      measured += 1;
      return blockedBy(this.center, dest);
    },
    createTerrainMovementPath: points => points,
    measureMovementPath: () => ({ distance: 1, cost: 1 })
  };
  t.moveTo = (col2, row2) => {
    t.document.x = t.document._source.x = col2 * SIZE;
    t.document.y = t.document._source.y = row2 * SIZE;
  };
  return t;
}

beforeAll(() => {
  for ( const k of ["canvas", "CONST", "CONFIG", "foundry"] ) saved[k] = globalThis[k];
  const regions = [];
  regions.contents = regions;
  globalThis.canvas = {
    grid: { type: 1, diagonals: 0, size: SIZE, measurePath: ([p, q]) => ({ distance: Math.hypot(q.x - p.x, q.y - p.y) / SIZE * 5 }) },
    dimensions: { size: SIZE, distance: 5, sceneRect: { x: 0, y: 0, width: 30 * SIZE, height: 30 * SIZE } },
    scene: { id: "s1", grid: { units: "ft", distance: 5 }, regions, walls: [{ id: "w1", c: [10 * SIZE, 2 * SIZE, 10 * SIZE, 14 * SIZE], move: 20, dir: 0, door: 0, ds: 0 }] }
  };
  globalThis.CONST = { GRID_TYPES: { SQUARE: 1 }, WALL_MOVEMENT_TYPES: { NONE: 0 }, WALL_DOOR_TYPES: { NONE: 0, DOOR: 1 }, WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1, LOCKED: 2 } };
  globalThis.CONFIG = { Canvas: { polygonBackends: { move: { testCollision: (a, b) => blockedBy(a, b) } } }, Token: { movement: { actions: {} } } };
  globalThis.foundry = { ...(saved.foundry ?? {}), utils: { ...(saved.foundry?.utils ?? {}), lineSegmentIntersects } };
});
afterAll(() => {
  resetPathGrid();
  for ( const [k, v] of Object.entries(saved) ) globalThis[k] = v;
});

describe("the approach matrix, pair by pair", () => {
  test("after some have moved, only the pairs with one of them in it are measured again; the same matrix as afresh", () => {
    const tokens = [token("a", 2, 4), token("b", 3, 8), token("c", 14, 6), token("d", 16, 9), token("e", 12, 3)];
    const specs = new Map(tokens.map(t => [t.id, { speeds: { walk: 25 }, actions: [{ melee: true, reach: 5 }] }]));
    const afresh = () => {
      resetPathGrid();
      return computeApproach(tokens, specs, { ignoreTerrainFor: new Set() });
    };
    const pairs = new Map();
    const first = computeApproach(tokens, specs, { ignoreTerrainFor: new Set(), pairs });
    expect(first).toEqual(afresh());
    expect(first.a.c.blocked).toBe(true); // (the wall between them: the way round)
    // (Two of them move: 2 x 4 pairs each way, less the one between them counted twice.)
    tokens[0].moveTo(5, 5);
    tokens[2].moveTo(13, 7);
    measured = 0;
    const second = computeApproach(tokens, specs, { ignoreTerrainFor: new Set(), pairs });
    expect(measured).toBe(2 * 14);
    expect(second).toEqual(afresh());
    // (Nobody moved: nothing measured.)
    measured = 0;
    expect(computeApproach(tokens, specs, { ignoreTerrainFor: new Set(), pairs })).toEqual(second);
    expect(measured).toBe(0);
    // (One that ignores terrain now: its own pairs again, as afresh.)
    const ignoring = computeApproach(tokens, specs, { ignoreTerrainFor: new Set(["b"]), pairs });
    resetPathGrid();
    expect(ignoring).toEqual(computeApproach(tokens, specs, { ignoreTerrainFor: new Set(["b"]) }));
  });
});
