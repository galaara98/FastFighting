/**
 * Space on the map: the room each creature takes, getting past one another on the way, where a move may end, and
 * seeing past walls.
 *
 * Room: a creature takes up its space (spec.position.size), up or down, while it's here (not dead, gone, inside
 * another, nor a hazard). Nobody's move ends in another's space, unless the system says it may (rules.endIn(run, u,
 * o): a Tiny creature, a mount). Getting past one on the way (rules.passThrough(run, u, o)):
 *   "free"       through it as if it weren't there (by default: a friend, or anyone down)
 *   "difficult"  through it, as through difficult ground (5e: another creature's space)
 *   "around"     not through it: around it, which takes about its width more (by default: a foe on its feet)
 *   "tumble"     through it if a roll says so (rules.tumbleThrough(run, u, o): {success, difficult, ...}; PF2e Tumble
 *                Through: as through difficult ground, unless difficult is false); otherwise its move ends before it
 * A melee move ends on the nearest free spot within reach of what it's after (spotWithin); one with every spot round
 * it taken can't be reached, but from farther off (a reach weapon).
 *
 * Sight: the scene's walls that block it (spec.walls: [{a: [x, y], b: [x, y], s: its sight (Foundry's sense type:
 * 10 limited, 20 and up: it blocks), d: one-way (Foundry's edge direction), door: its id, open}], in feet), as Foundry
 * has them: a one-way wall seen from the side it faces lets sight through; two limited walls stop it, one doesn't; a
 * door stops it while it's shut (the fight's door states: behavior/doors.js). A creature sees another if a line from
 * its middle reaches the other's middle or a corner (lineOfSight); how many don't is its cover. Without walls given
 * (a battle off the map), as the approach table said (approach.los, once moved toward).
 * Pure: no Foundry globals.
 */
import { STATUS } from "../../constants.js";

const STEP = 5;
const sizeOf = u => u.spec.position?.size ?? STEP;

/* -------------------------------------------- */
/*  Room                                        */
/* -------------------------------------------- */

/** Does it take up room here (on the map, alive, not inside another creature, not a hazard)? */
export function takesRoom(o) {
  if ( !o?.pos || o.spec.hazard || o.vanished || [STATUS.DEAD, STATUS.FLED].includes(o.status) ) return false;
  return !(Number(o.conds?.swallowed) > 0 || Number(o.conds?.engulfed) > 0);
}

/** Would u, standing at p, share o's space? */
export const sharesSpace = (u, p, o) => Math.hypot(p.x - o.pos.x, p.y - o.pos.y) < (sizeOf(u) + sizeOf(o)) / 2 - 0.5;

/** Whose space would u's move end in at p (one it may not end in): the first such, or null. */
export function inTheWay(run, u, p) {
  const rules = run.prep.rules;
  for ( const o of run.units ) {
    if ( o === u || !takesRoom(o) || !sharesSpace(u, p, o) ) continue;
    if ( rules.endIn?.(run, u, o) ) continue;
    return o;
  }
  return null;
}

/** How u gets past o on its way: the system's word, else freely past a friend or one down, around a foe on its feet. */
export function passOf(run, u, o, areEnemies) {
  const own = run.prep.rules.passThrough?.(run, u, o);
  if ( own ) return own;
  return o.status !== STATUS.STANDING || !areEnemies(run, u, o) ? "free" : "around";
}

/** The creatures whose space the line from p to q crosses (not u, nor `t`, the one it's going for). */
export function crossed(run, u, p, q, t = null) {
  const out = [];
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len2 = dx * dx + dy * dy;
  if ( !len2 ) return out;
  for ( const o of run.units ) {
    if ( o === u || o === t || !takesRoom(o) ) continue;
    const k = Math.max(0, Math.min(1, ((o.pos.x - p.x) * dx + (o.pos.y - p.y) * dy) / len2));
    const near = Math.hypot(p.x + k * dx - o.pos.x, p.y + k * dy - o.pos.y);
    // (Not one it starts beside and walks away from: only those it would pass through.)
    if ( near < (sizeOf(u) + sizeOf(o)) / 2 - 0.5 && k > 0 ) out.push({ o, k });
  }
  return out.sort((a, b) => a.k - b.k);
}

/**
 * What getting past those on the way costs: extra feet (around one, or through one as difficult ground: about its
 * width), and those it would have to tumble past.
 */
export function pastCost(run, u, list, areEnemies) {
  let extra = 0;
  const tumble = [];
  for ( const { o } of list ) {
    const how = passOf(run, u, o, areEnemies);
    if ( how === "around" || how === "difficult" ) extra += sizeOf(o);
    else if ( how === "tumble" ) tumble.push(o);
  }
  return { extra, tumble };
}

/** A point on u's own grid (its middle where it stands now, a square's width at a time). */
function onGrid(u, x, y) {
  const ox = (((u.pos?.x ?? 0) % STEP) + STEP) % STEP;
  const oy = (((u.pos?.y ?? 0) % STEP) + STEP) % STEP;
  return { x: Math.round((x - ox) / STEP) * STEP + ox, y: Math.round((y - oy) / STEP) * STEP + oy };
}

/** The feet between creatures' edges with u at p (as battle-state.js edgeDistance has it). */
const edgeAt = (u, p, t) => Math.max(STEP, Math.hypot(p.x - t.pos.x, p.y - t.pos.y) - ((sizeOf(u) + sizeOf(t)) / 2 - STEP));

/**
 * Where u can stand to have t within reach: the free spot nearest `from` (where u is), on u's grid; null when every
 * one is taken. Kept until someone moves.
 */
export function spotWithin(run, u, t, reach, from = u.pos) {
  if ( !u.pos || !t.pos ) return null;
  const key = `${run.geo ?? 0}|${u.id}|${t.id}|${reach}|${from.x},${from.y}`;
  const cache = run.spotCache && run.spotCache.geo === run.geo ? run.spotCache : (run.spotCache = { geo: run.geo, map: new Map() });
  if ( cache.map.has(key) ) return cache.map.get(key);
  const far = reach + (sizeOf(u) + sizeOf(t)) / 2;
  let best = null;
  for ( let dx = -far; dx <= far; dx += STEP ) {
    for ( let dy = -far; dy <= far; dy += STEP ) {
      const p = onGrid(u, t.pos.x + dx, t.pos.y + dy);
      if ( sharesSpace(u, p, t) || edgeAt(u, p, t) > reach + 0.5 || inTheWay(run, u, p) ) continue;
      const d = Math.hypot(p.x - from.x, p.y - from.y);
      if ( !best || d < best.feet ) best = { x: p.x, y: p.y, feet: d };
    }
  }
  cache.map.set(key, best);
  return best;
}

/**
 * The free spot nearest `point` for u to stand on (one where its move may end: inTheWay), on the grid of `lattice` (a
 * creature already there), a ring of squares at a time out to `most` feet; only those `accept` takes (in range, in
 * sight). {x, y} or null.
 */
export function freeSpotNear(run, u, point, { lattice = null, most = 30, accept = () => true } = {}) {
  const grid = lattice?.pos ? lattice : { pos: point };
  const at = p => onGrid(grid, p.x, p.y);
  const spots = [];
  for ( let dx = -most; dx <= most; dx += STEP ) {
    for ( let dy = -most; dy <= most; dy += STEP ) {
      const p = at({ x: point.x + dx, y: point.y + dy });
      spots.push({ ...p, d: Math.hypot(p.x - point.x, p.y - point.y) });
    }
  }
  spots.sort((a, b) => a.d - b.d);
  const found = spots.find(p => p.d <= most + 0.5 && !inTheWay(run, u, p) && accept(p));
  return found ? { x: found.x, y: found.y } : null;
}

/* -------------------------------------------- */
/*  Sight                                       */
/* -------------------------------------------- */

/** Are the scene's walls known to this fight (a battle on a map)? */
export const wallsKnown = run => Array.isArray(run.prep.spec.walls);

/** The walls that block sight, read once. */
function wallsOf(run) {
  if ( run.prep.sightWalls ) return run.prep.sightWalls;
  run.prep.sightWalls = (run.prep.spec.walls ?? []).filter(w => (Number(w.s) || 0) > 0).map(w => ({
    ax: w.a[0], ay: w.a[1], bx: w.b[0], by: w.b[1], limited: Number(w.s) < 20, dir: Number(w.d) || 0, door: w.door ?? null, open: !!w.open
  }));
  return run.prep.sightWalls;
}

/** Foundry's orient2dFast: which side of a -> b the point c is on (its sign). */
const orient = (ax, ay, bx, by, cx, cy) => (ay - cy) * (bx - cx) - (ax - cx) * (by - cy);

/**
 * Does the line p-q cross the wall a-b? Through a wall's end counts (a corner where two walls meet stops it, as Foundry
 * has it); a wall merely touching p or q doesn't.
 */
function crosses(p, q, w) {
  const d1 = orient(w.ax, w.ay, w.bx, w.by, p.x, p.y);
  const d2 = orient(w.ax, w.ay, w.bx, w.by, q.x, q.y);
  const d3 = orient(p.x, p.y, q.x, q.y, w.ax, w.ay);
  const d4 = orient(p.x, p.y, q.x, q.y, w.bx, w.by);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 >= 0 && d4 <= 0) || (d3 <= 0 && d4 >= 0)) && !(d3 === 0 && d4 === 0);
}

/** Does a wall stop sight from p to q (Foundry's way: one-way walls from their open side, two limited walls, shut doors)? */
export function sightBlocked(run, p, q) {
  let limited = 0;
  for ( const w of wallsOf(run) ) {
    if ( w.door && (w.open || run.doors?.get(w.door)?.open) ) continue;
    if ( !crosses(p, q, w) ) continue;
    // (One-way: Foundry lets sight through from the side it faces, edge.orientPoint's LEFT for orient2dFast < 0.)
    if ( w.dir ) {
      const side = orient(w.ax, w.ay, w.bx, w.by, p.x, p.y) < 0 ? 1 : 2;
      if ( side === w.dir ) continue;
    }
    if ( w.limited ) {
      if ( ++limited >= 2 ) return true;
      continue;
    }
    return true;
  }
  return false;
}

/** The points of t a line of sight may reach: its middle, and its corners (just inside them). */
function pointsOf(t) {
  const h = Math.max(0, sizeOf(t) / 2 - 0.5);
  const { x, y } = t.pos;
  return [{ x, y }, { x: x - h, y: y - h }, { x: x + h, y: y - h }, { x: x - h, y: y + h }, { x: x + h, y: y + h }];
}

/** How many of t's points u can't see from `from` (0: in the open; all 5: wholly hidden). */
export function blockedPoints(run, u, t, from = u.pos) {
  if ( !from || !t.pos || !wallsKnown(run) ) return 0;
  const key = `${run.geo ?? 0}|${from.x},${from.y}|${t.id}|${[...(run.doors ?? [])].filter(([, s]) => s.open).length}`;
  const cache = run.sightCache && run.sightCache.geo === run.geo ? run.sightCache : (run.sightCache = { geo: run.geo, map: new Map() });
  if ( cache.map.has(key) ) return cache.map.get(key);
  const n = pointsOf(t).filter(q => sightBlocked(run, from, q)).length;
  cache.map.set(key, n);
  return n;
}

/** Can u see t from where it stands (or from `from`): a clear line to its middle or a corner? */
export const lineOfSight = (run, u, t, from = u.pos) => blockedPoints(run, u, t, from) < 5;

/** Cover t has from u, by the walls: "none", "some" (one or two of its points hidden), "most" (three or four), "total". */
export function coverFrom(run, u, t) {
  const n = blockedPoints(run, u, t);
  return n === 0 ? "none" : n <= 2 ? "some" : n < 5 ? "most" : "total";
}

/**
 * The nearest spot (from u's) within `most` feet where u would see t with t within `range`, on u's grid and free:
 * {x, y, feet}, or null. Kept until someone moves.
 */
export function spotToShoot(run, u, t, range, most, edgeDistance) {
  if ( !u.pos || !t.pos ) return null;
  const key = `${run.geo ?? 0}|${u.id}|${t.id}|${range}|${most}`;
  const cache = run.shootCache && run.shootCache.geo === run.geo ? run.shootCache : (run.shootCache = { geo: run.geo, map: new Map() });
  if ( cache.map.has(key) ) return cache.map.get(key);
  // (Nearest first: the first that will do is the one.)
  const spots = [];
  const r = Math.floor(most / STEP) * STEP;
  for ( let dx = -r; dx <= r; dx += STEP ) {
    for ( let dy = -r; dy <= r; dy += STEP ) {
      const p = onGrid(u, u.pos.x + dx, u.pos.y + dy);
      const feet = Math.hypot(p.x - u.pos.x, p.y - u.pos.y);
      if ( feet <= most + 0.5 ) spots.push({ x: p.x, y: p.y, feet });
    }
  }
  spots.sort((a, b) => a.feet - b.feet);
  const best = spots.find(p => edgeDistance({ pos: p, spec: u.spec }, t) <= range + 0.5 && !(p.feet > 0 && inTheWay(run, u, p)) && lineOfSight(run, u, t, p)) ?? null;
  cache.map.set(key, best);
  return best;
}
