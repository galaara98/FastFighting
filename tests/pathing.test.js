/**
 * Getting around walls (foundry/pathing.js), on a stand-in for Foundry's canvas: walls as segments, Foundry's own
 * segment test, a square grid. The way off the scene worked out only as far as the nearest edge comes out as the whole
 * field would have it; the steps to every square, as a plain shortest-path reckoning has them, whatever the diagonals.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { WallGrid } from "../scripts/foundry/pathing.js";

const SIZE = 100;
const saved = {};
/** Foundry's orient2dFast and lineSegmentIntersects, as Foundry has them. */
const orient = (a, b, c) => (a.y - c.y) * (b.x - c.x) - (a.x - c.x) * (b.y - c.y);
function lineSegmentIntersects(a, b, c, d) {
  const xa = orient(a, b, c);
  const xb = orient(a, b, d);
  if ( !xa && !xb ) return false;
  return (xa * xb) <= 0 && (orient(c, d, a) * orient(c, d, b)) <= 0;
}

/** A scene of `cols` x `rows` squares with these walls ([x1, y1, x2, y2] in squares, a door's state if a door). */
function scene(cols, rows, walls, diagonals = 0) {
  const docs = walls.map(([x1, y1, x2, y2, ds = null], i) => ({
    id: `w${i}`, c: [x1 * SIZE, y1 * SIZE, x2 * SIZE, y2 * SIZE], move: 20, dir: 0, door: ds === null ? 0 : 1, ds: ds ?? 0
  }));
  globalThis.canvas = {
    grid: { type: 1, diagonals },
    dimensions: { size: SIZE, sceneRect: { x: 0, y: 0, width: cols * SIZE, height: rows * SIZE } },
    scene: { id: "s1", walls: docs }
  };
  return docs;
}

beforeAll(() => {
  for ( const k of ["canvas", "CONST", "CONFIG", "foundry"] ) saved[k] = globalThis[k];
  globalThis.CONST = {
    GRID_TYPES: { SQUARE: 1 }, WALL_MOVEMENT_TYPES: { NONE: 0 }, WALL_DOOR_TYPES: { NONE: 0, DOOR: 1, SECRET: 2 }, WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1, LOCKED: 2 }
  };
  // (Movement stopped by any wall in the way but an open door.)
  const testCollision = (a, b) => globalThis.canvas.scene.walls.some(w => w.move && !(w.door && w.ds === 1) && lineSegmentIntersects(a, b, { x: w.c[0], y: w.c[1] }, { x: w.c[2], y: w.c[3] }));
  globalThis.CONFIG = { Canvas: { polygonBackends: { move: { testCollision } } } };
  globalThis.foundry = { ...(saved.foundry ?? {}), utils: { ...(saved.foundry?.utils ?? {}), lineSegmentIntersects } };
});
afterAll(() => {
  for ( const [k, v] of Object.entries(saved) ) globalThis[k] = v;
});

/** The way off as it was worked out before (the whole field, then the nearest edge square, then downhill back). */
function wayOffWhole(grid, from) {
  const dist = grid.field(from, true);
  const edge = c => c % grid.cols === 0 || Math.floor(c / grid.cols) === 0 || c % grid.cols === grid.cols - 1 || Math.floor(c / grid.cols) === grid.rows - 1;
  let best = -1;
  for ( let c = 0; c < dist.length; c++ ) if ( Number.isFinite(dist[c]) && edge(c) && (best < 0 || dist[c] < dist[best]) ) best = c;
  return best < 0 ? null : { best, steps: dist[best] };
}

/** Random walls on the grid's lines, some of them doors (shut, locked, open), and a room or two. */
function randomWalls(rnd, cols, rows, n) {
  const walls = [];
  for ( let i = 0; i < n; i++ ) {
    const x = Math.floor(rnd() * cols);
    const y = Math.floor(rnd() * rows);
    const long = 1 + Math.floor(rnd() * 4);
    const door = rnd() < 0.15 ? Math.floor(rnd() * 3) : null;
    walls.push(rnd() < 0.5 ? [x, y, x + long, y, door] : [x, y, x, y + long, door]);
  }
  // (A room shut all round, with a door in it: a way off only through the door, when it isn't open.)
  walls.push([5, 5, 9, 5], [9, 5, 9, 9], [9, 9, 5, 9], [5, 9, 5, 7], [5, 7, 5, 6, 0], [5, 6, 5, 5]);
  return walls;
}

describe("the way off the scene", () => {
  test("worked out as far as the nearest edge: the same edge, the same steps, as the whole field has them", () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let checked = 0;
    for ( const diagonals of [0, 1, 2, 3, 4] ) {
      for ( let s = 0; s < 6; s++ ) {
        scene(18, 14, randomWalls(rnd, 18, 14, 40), diagonals);
        const quick = new WallGrid([], 0, { whole: true });
        const whole = new WallGrid([], 0, { whole: true });
        for ( let from = 0; from < quick.cols * quick.rows; from += 3 ) {
          const way = quick.wayOff(from);
          const ref = wayOffWhole(whole, from);
          if ( !ref ) {
            expect(way).toBeNull();
            continue;
          }
          expect(way.steps).toBe(ref.steps);
          const last = way.corners.at(-1);
          expect(quick.cellAt(last.x, last.y)).toBe(ref.best);
          // (Asked again: the same answer.)
          expect(quick.wayOff(from)).toBe(way);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  test("shut in: no way off", () => {
    scene(10, 10, [[2, 2, 6, 2], [6, 2, 6, 6], [6, 6, 2, 6], [2, 6, 2, 2]]);
    const grid = new WallGrid([], 0, { whole: true });
    expect(grid.wayOff(grid.cellAt(3 * SIZE, 3 * SIZE))).toBeNull();
    expect(grid.wayOff(grid.cellAt(0, 0))).toMatchObject({ steps: 0 });
  });
});

describe("the steps to every square", () => {
  test("as a plain shortest-path reckoning has them, the diagonals' odd lengths too (√2: none passed over)", () => {
    let seed = 5;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for ( const diagonals of [0, 1, 2, 3] ) {
      scene(16, 16, randomWalls(rnd, 16, 16, 30), diagonals);
      const grid = new WallGrid([], 0, { whole: true });
      const n = grid.cols * grid.rows;
      const diagonal = { 0: 1, 1: Math.SQRT2, 2: 1.5, 3: 2 }[diagonals];
      const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      const center = c => ({ x: (c % grid.cols) * SIZE + SIZE / 2, y: Math.floor(c / grid.cols) * SIZE + SIZE / 2 });
      for ( const from of [0, 37, 120, 200] ) {
        // (Every square's steps, the slow way: settle the nearest, over and over.)
        const ref = new Array(n).fill(Infinity);
        const done = new Array(n).fill(false);
        ref[from] = 0;
        for ( ;; ) {
          let c = -1;
          for ( let i = 0; i < n; i++ ) if ( !done[i] && ref[i] < Infinity && (c < 0 || ref[i] < ref[c]) ) c = i;
          if ( c < 0 ) break;
          done[c] = true;
          DIRS.forEach(([dx, dy], k) => {
            const col = (c % grid.cols) + dx;
            const row = Math.floor(c / grid.cols) + dy;
            if ( col < 0 || row < 0 || col >= grid.cols || row >= grid.rows ) return;
            const next = row * grid.cols + col;
            if ( globalThis.CONFIG.Canvas.polygonBackends.move.testCollision(center(c), center(next)) ) return;
            const nd = ref[c] + (k < 4 ? 1 : diagonal);
            if ( nd < ref[next] ) ref[next] = nd;
          });
        }
        const dist = grid.field(from);
        for ( let i = 0; i < n; i++ ) expect(dist[i]).toBe(Math.fround(ref[i]));
      }
    }
  });
});
