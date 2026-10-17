/**
 * Getting around walls, fast rather than perfect: a grid over the part of the scene the fight covers, which grid
 * steps the walls block (each tested once, then remembered), and shortest paths over it. It prices an approach for
 * the simulation (the way around, or through the wall when there is none) and walks tokens through the fight when
 * it plays out on the map. Square grids only; on other grids everything falls back to straight lines.
 */

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** Each direction's way back (DIRS' index of the step the other way). */
const BACK = [1, 0, 3, 2, 7, 6, 5, 4];
/** Wall-free cost of a diagonal step, by the scene's diagonal rule (CONST.GRID_DIAGONALS). */
const DIAGONAL = { 0: 1, 1: Math.SQRT2, 2: 1.5, 3: 2, 4: 1.5, 5: 1.5, 6: Infinity };
/** Going through a wall when there's no way round: that square counts as 4x difficult terrain. */
export const THROUGH_WALL = 4;
/** A closed door on the way costs about this many squares of walking (stopping, opening it). */
const DOOR_STEPS = 2;

/** A closed (or locked) ordinary door a creature could open, break or pick. Secret doors count as wall. */
function usableDoor(wall) {
  return wall.door === CONST.WALL_DOOR_TYPES.DOOR && wall.ds !== CONST.WALL_DOOR_STATES.OPEN;
}

let cached = null;
let sceneCached = null;

/** Forget the grid (walls or tokens changed). */
export function resetPathGrid() {
  cached = null;
  sceneCached = null;
}

/** A grid over the whole scene (the way off it, for a creature leaving the fight), kept until reset; null off a square grid. */
export function sceneWallGrid() {
  if ( canvas.grid?.type !== CONST.GRID_TYPES.SQUARE || !canvas.scene ) return null;
  if ( sceneCached?.sceneId === canvas.scene.id ) return sceneCached;
  sceneCached = new WallGrid([], 0, { whole: true });
  return sceneCached;
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
   * @param {object} [options]
   * @param {boolean} [options.whole]  The whole scene instead (the way off it)
   */
  constructor(tokens, margin = 12, { whole = false } = {}) {
    const { size, sceneRect } = canvas.dimensions;
    this.sceneId = canvas.scene.id;
    this.size = size;
    this.diagonal = DIAGONAL[canvas.grid.diagonals] ?? 1;
    const snap = v => Math.floor(v / size) * size;
    const xs = tokens.map(t => t.document.x);
    const ys = tokens.map(t => t.document.y);
    const x0 = whole ? snap(sceneRect.x) : Math.max(snap(sceneRect.x), snap(Math.min(...xs)) - margin * size);
    const y0 = whole ? snap(sceneRect.y) : Math.max(snap(sceneRect.y), snap(Math.min(...ys)) - margin * size);
    const x1 = whole ? sceneRect.x + sceneRect.width : Math.min(sceneRect.x + sceneRect.width, Math.max(...xs) + (margin + 2) * size);
    const y1 = whole ? sceneRect.y + sceneRect.height : Math.min(sceneRect.y + sceneRect.height, Math.max(...ys) + (margin + 2) * size);
    this.ox = x0;
    this.oy = y0;
    this.cols = Math.max(1, Math.ceil((x1 - x0) / size));
    this.rows = Math.max(1, Math.ceil((y1 - y0) / size));
    // Per cell and direction: 0 not tested yet, 1 open, 2 wall, 3 only closed doors in the way (which ones: doorsAt).
    this.edges = new Uint8Array(this.cols * this.rows * 8);
    this.doorsAt = new Map();
    this.fields = new Map();
    this.ways = new Map();
    this.walls = canvas.scene.walls.filter(w => w.move !== CONST.WALL_MOVEMENT_TYPES.NONE);
    // (Each wall's box: a step only asks which walls stop it of those whose box its own touches.)
    this.boxes = this.walls.map(w => {
      const [x1, y1, x2, y2] = w.c;
      return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    });
    // (With no one-way wall on the map, what's between two squares is the same both ways: worked out once for both.)
    this.bothWays = !this.walls.some(w => w.dir);
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

  /** What's between a cell and its neighbor in direction d: 1 nothing, 2 wall, 3 only closed doors. */
  #edge(cell, d) {
    const k = cell * 8 + d;
    if ( !this.edges[k] ) {
      const next = this.#step(cell, d);
      let state = next < 0 ? 2 : 1;
      if ( next >= 0 ) {
        const a = this.#center(cell);
        const b = this.#center(next);
        let blocked = false;
        try {
          blocked = !!CONFIG.Canvas.polygonBackends.move.testCollision(a, b, { type: "move", mode: "any" });
        } catch ( err ) {
          blocked = false;
        }
        if ( blocked ) {
          // Which walls? If every one in the way is a door, it's a door to open (or break, or pick). (Only those whose
          // box the step's touches can be in its way: the rest aren't asked.)
          const x0 = Math.min(a.x, b.x);
          const y0 = Math.min(a.y, b.y);
          const x1 = Math.max(a.x, b.x);
          const y1 = Math.max(a.y, b.y);
          const hit = this.walls.filter((w, i) => {
            const box = this.boxes[i];
            if ( box[2] < x0 || box[0] > x1 || box[3] < y0 || box[1] > y1 ) return false;
            return foundry.utils.lineSegmentIntersects(a, b, { x: w.c[0], y: w.c[1] }, { x: w.c[2], y: w.c[3] });
          });
          const doors = hit.length && hit.every(usableDoor) ? hit.map(w => w.id) : null;
          state = doors ? 3 : 2;
          if ( doors ) this.doorsAt.set(k, doors);
          if ( doors && this.bothWays ) this.doorsAt.set(next * 8 + BACK[d], doors);
        }
        if ( this.bothWays ) this.edges[next * 8 + BACK[d]] = state;
      }
      this.edges[k] = state;
    }
    return this.edges[k];
  }

  /** Can a creature step from cell in direction d? (Through a closed door too, if `doors`.) */
  #open(cell, d, doors = false) {
    const e = this.#edge(cell, d);
    return e === 1 || (doors && e === 3);
  }

  /**
   * Steps (in squares, diagonals by the scene's rule) from a cell to every other cell, around walls; with `doors`,
   * through closed doors too (each costing a little extra). Cached.
   */
  field(from, doors = false) {
    // (No door beside anywhere it can walk to: through doors is the same as around them.)
    if ( doors ) {
      const around = this.field(from);
      if ( !this.doorsAt.size ) return around;
    }
    const cacheKey = `${from}|${doors ? 1 : 0}`;
    let dist = this.fields.get(cacheKey);
    if ( dist ) return dist;
    const n = this.cols * this.rows;
    dist = new Float32Array(n).fill(Infinity);
    dist[from] = 0;
    const heap = new MinHeap();
    heap.push(from, 0);
    while ( heap.size ) this.#settle(heap, dist, doors);
    this.fields.set(cacheKey, dist);
    return dist;
  }

  /**
   * One step of working out a field (field, #toEdge): the nearest cell not yet settled, and the steps to its neighbors
   * through it. Returns that cell and its steps, or null for one settled already. (The steps are kept as 32-bit
   * numbers: one is settled already only when its kept steps are fewer than these, as kept.)
   */
  #settle(heap, dist, doors) {
    const [cell, d] = heap.pop();
    if ( Math.fround(d) > dist[cell] ) return null;
    for ( let k = 0; k < 8; k++ ) {
      const base = k < 4 ? 1 : this.diagonal;
      if ( !Number.isFinite(base) || !this.#open(cell, k, doors) ) continue;
      const next = this.#step(cell, k);
      const nd = d + base + (this.#edge(cell, k) === 3 ? DOOR_STEPS : 0);
      if ( nd < dist[next] ) {
        dist[next] = nd;
        heap.push(next, nd);
      }
    }
    return [cell, d];
  }

  /** Is a cell on the grid's edge? */
  #onEdge(c) {
    const col = c % this.cols;
    const row = Math.floor(c / this.cols);
    return col === 0 || row === 0 || col === this.cols - 1 || row === this.rows - 1;
  }

  /**
   * field(from, true) only as far as the nearest cell on the grid's edge: the steps to every cell nearer than that one
   * (as the whole field has them), and that cell ({dist, best}; best -1 when there's none), the first by number of
   * those as near. The rest of the scene isn't looked at.
   */
  #toEdge(from) {
    const dist = new Float32Array(this.cols * this.rows).fill(Infinity);
    dist[from] = 0;
    const heap = new MinHeap();
    heap.push(from, 0);
    let reach = null;
    while ( heap.size ) {
      // (Past the nearest edge: everything as near as it settled, nothing more to find.)
      if ( reach !== null && Math.fround(heap.peek()) > reach ) break;
      const settled = this.#settle(heap, dist, true);
      if ( settled && reach === null && this.#onEdge(settled[0]) ) reach = dist[settled[0]];
    }
    if ( reach === null ) return { dist, best: -1 };
    let best = -1;
    for ( let c = 0; c < dist.length; c++ ) if ( dist[c] === reach && this.#onEdge(c) ) { best = c; break; }
    return { dist, best };
  }

  /**
   * How a walks to come beside b: squares of walking, and the closed doors on the way (in order), or Infinity
   * squares when walls (and doors) shut it off. The way round wins unless the door saves a real detour.
   * @param {Token} a
   * @param {Token} b
   * @returns {{steps: number, doors: string[]}|null}
   */
  stepsBetween(a, b) {
    const from = this.cellAt(a.document._source.x, a.document._source.y);
    const to = this.cellAt(b.document._source.x, b.document._source.y);
    if ( from < 0 || to < 0 ) return null;
    const around = this.field(from)[to];
    const through = this.field(from, true)[to];
    if ( Number.isFinite(around) && around <= through + DOOR_STEPS ) return { steps: Math.max(0, around - 1), doors: [] };
    if ( !Number.isFinite(through) ) return { steps: Infinity, doors: [] };
    const doors = this.#doorsOnWay(from, to);
    return { steps: Math.max(0, through - 1 - DOOR_STEPS * doors.length), doors };
  }

  /** The doors on the shortest way from one cell to another (walking back from the far end), nearest first. */
  #doorsOnWay(from, to) {
    const dist = this.field(from, true);
    const found = [];
    let cell = to;
    for ( let guard = 0; cell !== from && guard < this.cols * this.rows; guard++ ) {
      let best = -1;
      let bestD = dist[cell];
      let bestK = -1;
      for ( let k = 0; k < 8; k++ ) {
        if ( !this.#open(cell, k, true) ) continue;
        const prev = this.#step(cell, k);
        if ( dist[prev] < bestD - 1e-6 ) { bestD = dist[prev]; best = prev; bestK = k; }
      }
      if ( best < 0 ) break;
      for ( const id of this.doorsAt.get(cell * 8 + bestK) ?? [] ) if ( !found.includes(id) ) found.unshift(id);
      cell = best;
    }
    return found;
  }

  /**
   * The nearest way off the grid from a cell, around walls and through closed doors (a creature can open them): the
   * corners it turns at (top-left pixels), the last a square on the grid's edge, and how many squares it walks; null
   * when walls shut it in. Worked out only as far as that edge (#toEdge), once from each cell (until the grid is reset).
   */
  wayOff(from) {
    if ( from < 0 ) return null;
    if ( !this.ways.has(from) ) this.ways.set(from, this.#wayOffNow(from));
    return this.ways.get(from);
  }

  #wayOffNow(from) {
    const { dist, best } = this.#toEdge(from);
    if ( best < 0 ) return null;
    // (Walked back from the edge, downhill to where it stands.)
    const cells = [best];
    let cell = best;
    for ( let guard = 0; cell !== from && guard < dist.length; guard++ ) {
      let prev = -1;
      for ( let k = 0; k < 8; k++ ) {
        const p = this.#step(cell, k);
        if ( p < 0 || !this.#open(p, BACK[k], true) ) continue;
        if ( dist[p] < dist[cell] - 1e-6 && (prev < 0 || dist[p] < dist[prev]) ) prev = p;
      }
      if ( prev < 0 ) break;
      cell = prev;
      if ( cell !== from ) cells.unshift(cell);
    }
    // (Only where it turns, and where it ends.)
    const corners = [];
    for ( let i = 0; i < cells.length; i++ ) {
      const before = i ? cells[i - 1] : from;
      const next = cells[i + 1];
      if ( next === undefined || (cells[i] - before) !== (next - cells[i]) ) corners.push(this.corner(cells[i]));
    }
    return { corners, steps: dist[best] };
  }

  /**
   * The waypoints (top-left pixels) a token follows from where it is to `dest`, around walls; straight to `dest`
   * when there's no way round (or either end is off the grid).
   */
  route(tokenDoc, dest, { doors = false } = {}) {
    const from = this.cellAt(tokenDoc._source.x, tokenDoc._source.y);
    const to = this.cellAt(dest.x, dest.y);
    if ( from < 0 || to < 0 || from === to ) return [dest];
    const dist = this.field(to, doors); // walk the field downhill from the start to the destination
    if ( !Number.isFinite(dist[from]) ) return [dest];
    const cells = [];
    let cell = from;
    for ( let guard = 0; cell !== to && guard < this.cols * this.rows; guard++ ) {
      let best = -1;
      let bestD = dist[cell];
      for ( let k = 0; k < 8; k++ ) {
        if ( !this.#open(cell, k, doors) ) continue;
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
  /** The smallest priority (with none, undefined). */
  peek() {
    return this.#items[0]?.[1];
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
