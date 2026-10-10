/**
 * Getting around walls, fast rather than perfect: a grid over the part of the scene the fight covers, which grid
 * steps the walls block (each tested once, then remembered), and shortest paths over it. It prices an approach for
 * the simulation (the way around, or through the wall when there is none) and walks tokens through the fight when
 * it plays out on the map. Square grids only; on other grids everything falls back to straight lines.
 */

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** Wall-free cost of a diagonal step, by the scene's diagonal rule (CONST.GRID_DIAGONALS). */
const DIAGONAL = { 0: 1, 1: Math.SQRT2, 2: 1.5, 3: 2, 4: 1.5, 5: 1.5, 6: Infinity };
/** Going through a wall when there's no way around: that square counts as 4x difficult terrain. */
export const THROUGH_WALL = 4;

let cached = null;

/** Forget the grid (walls or tokens changed). */
export function resetPathGrid() {
  cached = null;
}

/** The grid for these fighters on the current scene (kept until reset, or until the fight moves elsewhere). */
export function pathGridFor(tokens) {
  if ( canvas.grid?.type !== CONST.GRID_TYPES.SQUARE || !tokens?.length ) return null;
  if ( cached?.sceneId === canvas.scene.id && tokens.every(t => cached.covers(t.document.x, t.document.y)) ) return cached;
  cached = new WallGrid(tokens);
  return cached;
}

/** The last grid built, for playing a fight back (null if none or for another scene). */
export function currentPathGrid() {
  return cached?.sceneId === canvas.scene?.id ? cached : null;
}

export class WallGrid {
  /**
   * @param {Token[]} tokens   The fighters: the grid covers them and a margin around them
   * @param {number} [margin]  Grid squares of room around the fighters for going the long way round
   */
  constructor(tokens, margin = 12) {
    const { size, sceneRect } = canvas.dimensions;
    this.sceneId = canvas.scene.id;
    this.size = size;
    this.diagonal = DIAGONAL[canvas.grid.diagonals] ?? 1;
    const snap = v => Math.floor(v / size) * size;
    const xs = tokens.map(t => t.document.x);
    const ys = tokens.map(t => t.document.y);
    const x0 = Math.max(snap(sceneRect.x), snap(Math.min(...xs)) - margin * size);
    const y0 = Math.max(snap(sceneRect.y), snap(Math.min(...ys)) - margin * size);
    const x1 = Math.min(sceneRect.x + sceneRect.width, Math.max(...xs) + (margin + 2) * size);
    const y1 = Math.min(sceneRect.y + sceneRect.height, Math.max(...ys) + (margin + 2) * size);
    this.ox = x0;
    this.oy = y0;
    this.cols = Math.max(1, Math.ceil((x1 - x0) / size));
    this.rows = Math.max(1, Math.ceil((y1 - y0) / size));
    // Per cell and direction: 0 not tested yet, 1 open, 2 blocked.
    this.edges = new Uint8Array(this.cols * this.rows * 8);
    this.fields = new Map();
  }

  covers(x, y) {
    const c = this.cellAt(x, y);
    return c >= 0;
  }

  /** The cell under a token's top-left corner (pixels), or -1 outside the grid. */
  cellAt(x, y) {
    const col = Math.floor((x - this.ox) / this.size + 1e-6);
    const row = Math.floor((y - this.oy) / this.size + 1e-6);
    if ( col < 0 || row < 0 || col >= this.cols || row >= this.rows ) return -1;
    return row * this.cols + col;
  }

  /** Top-left corner (pixels) of a cell. */
  corner(cell) {
    return { x: this.ox + (cell % this.cols) * this.size, y: this.oy + Math.floor(cell / this.cols) * this.size };
  }

  #center(cell) {
    const p = this.corner(cell);
    return { x: p.x + this.size / 2, y: p.y + this.size / 2 };
  }

  /** The neighbor in direction d, or -1. */
  #step(cell, d) {
    const col = (cell % this.cols) + DIRS[d][0];
    const row = Math.floor(cell / this.cols) + DIRS[d][1];
    if ( col < 0 || row < 0 || col >= this.cols || row >= this.rows ) return -1;
    return row * this.cols + col;
  }

  /** Can a creature step from cell in direction d? (Walls that block movement say no.) */
  #open(cell, d) {
    const k = cell * 8 + d;
    if ( !this.edges[k] ) {
      const next = this.#step(cell, d);
      let blocked = next < 0;
      if ( !blocked ) {
        try {
          blocked = !!CONFIG.Canvas.polygonBackends.move.testCollision(this.#center(cell), this.#center(next), { type: "move", mode: "any" });
        } catch ( err ) {
          blocked = false;
        }
      }
      this.edges[k] = blocked ? 2 : 1;
    }
    return this.edges[k] === 1;
  }

  /** Steps (in squares, diagonals by the scene's rule) from a cell to every other cell, around walls. Cached. */
  field(from) {
    let dist = this.fields.get(from);
    if ( dist ) return dist;
    const n = this.cols * this.rows;
    dist = new Float32Array(n).fill(Infinity);
    dist[from] = 0;
    const heap = new MinHeap();
    heap.push(from, 0);
    while ( heap.size ) {
      const [cell, d] = heap.pop();
      if ( d > dist[cell] ) continue;
      for ( let k = 0; k < 8; k++ ) {
        const cost = k < 4 ? 1 : this.diagonal;
        if ( !Number.isFinite(cost) || !this.#open(cell, k) ) continue;
        const next = this.#step(cell, k);
        const nd = d + cost;
        if ( nd < dist[next] ) {
          dist[next] = nd;
          heap.push(next, nd);
        }
      }
    }
    this.fields.set(from, dist);
    return dist;
  }

  /**
   * Squares a walks to come beside b around the walls, or Infinity when walls shut it off.
   * @param {Token} a
   * @param {Token} b
   */
  stepsBetween(a, b) {
    const from = this.cellAt(a.document.x, a.document.y);
    const to = this.cellAt(b.document.x, b.document.y);
    if ( from < 0 || to < 0 ) return null;
    const d = this.field(from)[to];
    return Number.isFinite(d) ? Math.max(0, d - 1) : Infinity;
  }

  /**
   * The waypoints (top-left pixels) a token follows from where it is to `dest`, around walls; straight to `dest`
   * when there's no way round (or either end is off the grid).
   */
  route(tokenDoc, dest) {
    const from = this.cellAt(tokenDoc._source.x, tokenDoc._source.y);
    const to = this.cellAt(dest.x, dest.y);
    if ( from < 0 || to < 0 || from === to ) return [dest];
    const dist = this.field(to); // walk the field downhill from the start to the destination
    if ( !Number.isFinite(dist[from]) ) return [dest];
    const cells = [];
    let cell = from;
    for ( let guard = 0; cell !== to && guard < this.cols * this.rows; guard++ ) {
      let best = -1;
      let bestD = dist[cell];
      for ( let k = 0; k < 8; k++ ) {
        if ( !this.#open(cell, k) ) continue;
        const next = this.#step(cell, k);
        if ( dist[next] < bestD - 1e-6 ) { bestD = dist[next]; best = next; }
      }
      if ( best < 0 ) break;
      cells.push(best);
      cell = best;
    }
    // Keep only the corners (where the direction changes), and land exactly on the destination.
    const points = [];
    for ( let i = 0; i < cells.length; i++ ) {
      const prev = i ? cells[i - 1] : from;
      const next = cells[i + 1];
      if ( next === undefined || (cells[i] - prev) !== (next - cells[i]) ) points.push(this.corner(cells[i]));
    }
    if ( points.length ) points[points.length - 1] = dest;
    else points.push(dest);
    return points;
  }
}

/** A small binary heap of [cell, priority], smallest first. */
class MinHeap {
  #items = [];
  get size() {
    return this.#items.length;
  }
  push(cell, p) {
    const a = this.#items;
    a.push([cell, p]);
    let i = a.length - 1;
    while ( i > 0 ) {
      const parent = (i - 1) >> 1;
      if ( a[parent][1] <= a[i][1] ) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop() {
    const a = this.#items;
    const top = a[0];
    const last = a.pop();
    if ( a.length ) {
      a[0] = last;
      let i = 0;
      for ( ;; ) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if ( l < a.length && a[l][1] < a[m][1] ) m = l;
        if ( r < a.length && a[r][1] < a[m][1] ) m = r;
        if ( m === i ) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}
