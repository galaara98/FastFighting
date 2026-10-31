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
 * it taken can't be reached, but from farther off (a reach weapon). Every spot looked for (within reach, to shoot from,
 * a step, a spot for later: prepare.js spotsWithin) is one of the map's squares, the grid the creature began the fight
 * on (gridOf), wherever a move left it: a move ends where its feet run out, between squares as often as not. One that
 * keeps together (behavior/together.js) would rather not end bunched up beside its teammates (crowdCost).
 *
 * Sight: the scene's walls that block it (spec.walls: [{a: [x, y], b: [x, y], s: its sight (Foundry's sense type:
 * 10 limited, 20 and up: it blocks), d: one-way (Foundry's edge direction), door: its id, open, snd: its sound (0: sound
 * passes; unsaid, it stops it: wallsBetween, for hearing a fight)}], in feet), as Foundry
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
  if ( !o?.pos || o.spec.hazard || o.vanished || o.status === STATUS.DEAD || o.status === STATUS.FLED ) return false;
  return !(Number(o.conds?.swallowed) > 0 || Number(o.conds?.engulfed) > 0);
}

/**
 * Is the point (dx, dy) from a creature's middle closer than `r`? (Squared, without a square root: asked of everyone,
 * all the time. Only for a yes or a no: a distance that goes anywhere is the real one.)
 */
const within = (dx, dy, r) => r > 0 && dx * dx + dy * dy < r * r;

/** Would u, standing at p, share o's space? */
export const sharesSpace = (u, p, o) => within(p.x - o.pos.x, p.y - o.pos.y, (sizeOf(u) + sizeOf(o)) / 2 - 0.5);

/**
 * Whose space would u's move end in at p (one it may not end in): the first such, or null. `units`: those to look at,
 * everyone by default (nearBy's, for many spots asked about at once).
 */
export function inTheWay(run, u, p, units = run.units) {
  const rules = run.prep.rules;
  for ( const o of units ) {
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
    const k = passesAt(u, p, dx, dy, len2, o, t);
    if ( k !== null ) out.push({ o, k });
  }
  return out.sort((a, b) => a.k - b.k);
}

/** Does the line from p to q cross the space of any of `list` (as crossed would find it, without making the list)? */
export function crossesAny(u, p, q, list) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len2 = dx * dx + dy * dy;
  if ( !len2 ) return false;
  for ( const o of list ) if ( passesAt(u, p, dx, dy, len2, o, null) !== null ) return true;
  return false;
}

/** How far along the line from p (by dx, dy) u would pass through o's space (0 to 1), or null if it doesn't. */
function passesAt(u, p, dx, dy, len2, o, t) {
  if ( o === u || o === t || !takesRoom(o) ) return null;
  const k = Math.max(0, Math.min(1, ((o.pos.x - p.x) * dx + (o.pos.y - p.y) * dy) / len2));
  // (Not one it starts beside and walks away from: only those it would pass through.)
  return k > 0 && within(p.x + k * dx - o.pos.x, p.y + k * dy - o.pos.y, (sizeOf(u) + sizeOf(o)) / 2 - 0.5) ? k : null;
}

/**
 * The extra feet of getting past those on the line from p to q (those crossed finds), without making the list: around
 * one, or through one as difficult ground, about its width. Reckoning a way to every foe, a move's cost is all that's
 * wanted.
 */
export function crossedExtra(run, u, p, q, t, areEnemies) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len2 = dx * dx + dy * dy;
  if ( !len2 ) return 0;
  let extra = 0;
  for ( const o of run.units ) {
    if ( passesAt(u, p, dx, dy, len2, o, t) === null ) continue;
    const how = passOf(run, u, o, areEnemies);
    if ( how === "around" || how === "difficult" ) extra += sizeOf(o);
  }
  return extra;
}

/**
 * The scene's grid for u's middle, as how far past the 5-foot lines it falls ({ox, oy}): where it began the fight
 * (spec.position, a token on the map's squares), so wherever a move left it (between squares: a move ends where its
 * feet run out), the spots it looks at are the map's squares, the ones those round it stand on. One with no place of its
 * own (a creature called up), where it stands.
 */
export function gridOf(u) {
  const base = Number.isFinite(u.spec?.position?.x) && Number.isFinite(u.spec?.position?.y) ? u.spec.position : u.pos;
  return { ox: (((base?.x ?? 0) % STEP) + STEP) % STEP, oy: (((base?.y ?? 0) % STEP) + STEP) % STEP };
}

/** The point of grid g (gridOf's) nearest (x, y). */
const snapTo = (g, x, y) => ({ x: Math.round((x - g.ox) / STEP) * STEP + g.ox, y: Math.round((y - g.oy) / STEP) * STEP + g.oy });

/** The feet between creatures' edges with u at p (as battle-state.js edgeDistance has it). */
export const edgeAt = (u, p, t) => Math.max(STEP, Math.hypot(p.x - t.pos.x, p.y - t.pos.y) - ((sizeOf(u) + sizeOf(t)) / 2 - STEP));

/**
 * Where u could step to, a move of its own outside its turn of `feet` at most (a reaction's: PF2e's Step): the free
 * squares that far or nearer from its own (gridOf), a square's width a step (diagonals too), none past a wall. Not where
 * it is; standing between squares, its own square too, and none farther off than such a step goes from a square.
 */
export function stepSpots(run, u, feet) {
  if ( !u.pos ) return [];
  const most = Math.max(STEP, Math.floor(feet / STEP) * STEP);
  const c = snapTo(gridOf(u), u.pos.x, u.pos.y);
  const far = most * Math.SQRT2 + 0.5;
  const out = [];
  for ( let dx = -most; dx <= most; dx += STEP ) {
    for ( let dy = -most; dy <= most; dy += STEP ) {
      const p = { x: c.x + dx, y: c.y + dy };
      if ( (p.x === u.pos.x && p.y === u.pos.y) || Math.hypot(p.x - u.pos.x, p.y - u.pos.y) > far ) continue;
      if ( inTheWay(run, u, p) || (wallsKnown(run) && lineBlocked(run, u.pos, p)) ) continue;
      out.push(p);
    }
  }
  return out;
}

/**
 * Everyone whose space a spot within `feet` of c could share with u's (inTheWay's `units`): asked of every square in a
 * search, all the others on a big map are only time spent.
 */
function nearBy(run, u, c, feet) {
  const out = [];
  for ( const o of run.units ) {
    if ( o === u || !takesRoom(o) ) continue;
    const r = feet + (sizeOf(u) + sizeOf(o)) / 2 + 1;
    const dx = o.pos.x - c.x;
    const dy = o.pos.y - c.y;
    if ( dx * dx + dy * dy <= r * r ) out.push(o);
  }
  return out;
}

/**
 * Who takes up room on the map, as a count that goes up whenever anyone starts or stops (falls dead, runs off,
 * vanishes, is swallowed, is called onto the map): with run.geo, what the free spots kept depend on. Looked at each time
 * rather than told: the system's own rules can kill a creature too (a recovery check).
 */
function roomNow(run) {
  const room = (run.roomCache ??= { takes: [], count: 0 });
  const units = run.units;
  let changed = room.takes.length !== units.length;
  for ( let i = 0; i < units.length; i++ ) {
    const takes = takesRoom(units[i]);
    if ( room.takes[i] === takes ) continue;
    room.takes[i] = takes;
    changed = true;
  }
  if ( changed ) {
    room.takes.length = units.length;
    room.count += 1;
  }
  return room.count;
}

/** A cache of spots, kept until someone moves or the room on the map changes (`name`: the run's key it's kept under). */
function spotsKept(run, name) {
  const room = roomNow(run);
  const kept = run[name];
  if ( kept && kept.geo === run.geo && kept.room === room ) return kept;
  return (run[name] = { geo: run.geo, room, map: new Map() });
}

/**
 * Where u can stand to have t within reach: the free spot nearest `from` (where u is), on the map's squares (gridOf),
 * wherever a move left u. With t between squares, and none of those in reach and free, the squares as they lie round t
 * (the map's, moved as far as t is off its own): its middle a square's width from theirs, as on the map. Null when every
 * one is taken. Kept until someone moves, or someone takes up room or stops (spotsKept). `crowd` (crowdCost's): the feet
 * a spot costs besides its distance, for one that would rather not stand bunched up.
 */
export function spotWithin(run, u, t, reach, from = u.pos, crowd = null) {
  if ( !u.pos || !t.pos ) return null;
  const key = `${u.id}|${t.id}|${reach}|${from.x},${from.y}${crowd ? "|c" : ""}`;
  const cache = spotsKept(run, "spotCache");
  if ( cache.map.has(key) ) return cache.map.get(key);
  const g = gridOf(u);
  let best = nearestWithin(run, u, t, reach, from, g, crowd);
  if ( !best ) {
    const own = snapTo(gridOf(t), t.pos.x, t.pos.y);
    const dx = t.pos.x - own.x;
    const dy = t.pos.y - own.y;
    if ( dx || dy ) best = nearestWithin(run, u, t, reach, from, { ox: g.ox + dx, oy: g.oy + dy }, crowd);
  }
  cache.map.set(key, best);
  return best;
}

/**
 * The free spot of grid g (gridOf's) nearest `from` where u would have t within reach (with `crowd`, its distance and what
 * it costs bunched up): {x, y, feet}, or null.
 */
function nearestWithin(run, u, t, reach, from, g, crowd = null) {
  const far = reach + (sizeOf(u) + sizeOf(t)) / 2;
  let best = null;
  let bestCost = Infinity;
  for ( let dx = -far; dx <= far; dx += STEP ) {
    for ( let dy = -far; dy <= far; dy += STEP ) {
      const p = snapTo(g, t.pos.x + dx, t.pos.y + dy);
      if ( sharesSpace(u, p, t) || edgeAt(u, p, t) > reach + 0.5 || inTheWay(run, u, p) ) continue;
      const d = Math.hypot(p.x - from.x, p.y - from.y);
      if ( d >= bestCost ) continue;
      const cost = crowd ? d + crowd(p) : d;
      if ( cost < bestCost ) {
        best = { x: p.x, y: p.y, feet: d };
        bestCost = cost;
      }
    }
  }
  return best;
}

/**
 * What standing beside a teammate costs one that keeps together: so many feet for each, at most so many teammates.
 * Beside: a square away, diagonals too (edge to edge, within `beside` feet).
 */
export const CROWD = Object.freeze({ feet: 7.5, most: 2, beside: STEP * Math.SQRT2 + 0.5 });

/**
 * What standing at p costs u in feet, bunched up beside its teammates (`team`: those on the map and on their feet):
 * CROWD.feet for each it would stand beside (CROWD.beside), at most CROWD.most of them; none for one the two
 * would flank t with (a line between them crosses its space). A function of p, or null with no one to stand beside.
 */
export function crowdCost(u, team, t = null) {
  if ( !u?.pos || !team?.length ) return null;
  return p => {
    let n = 0;
    for ( const a of team ) if ( edgeAt(u, p, a) <= CROWD.beside && !flanks(u, p, a, t) && ++n >= CROWD.most ) break;
    return n * CROWD.feet;
  };
}

/** Would u at p and a flank t: both beside it, a line between them crossing its space? */
function flanks(u, p, a, t) {
  if ( !t?.pos || edgeAt(a, a.pos, t) > CROWD.beside || edgeAt(u, p, t) > CROWD.beside ) return false;
  const dx = a.pos.x - p.x;
  const dy = a.pos.y - p.y;
  const len2 = dx * dx + dy * dy;
  if ( !len2 ) return false;
  const k = ((t.pos.x - p.x) * dx + (t.pos.y - p.y) * dy) / len2;
  return k > 0 && k < 1 && within(p.x + k * dx - t.pos.x, p.y + k * dy - t.pos.y, sizeOf(t) / 2);
}

/**
 * The free spot nearest `point` for u to stand on (one where its move may end: inTheWay), on the squares `lattice` (a
 * creature already there) stands on (gridOf), a ring of squares at a time out to `most` feet; only those `accept` takes
 * (in range, in sight). {x, y} or null.
 */
export function freeSpotNear(run, u, point, { lattice = null, most = 30, accept = () => true } = {}) {
  const g = gridOf(lattice?.pos ? lattice : { pos: point });
  const spots = [];
  for ( let dx = -most; dx <= most; dx += STEP ) {
    for ( let dy = -most; dy <= most; dy += STEP ) {
      const p = snapTo(g, point.x + dx, point.y + dy);
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

/**
 * A big map's walls, kept by where they are (squares this many feet across), so a line of sight only looks at those in
 * the squares its box covers; with fewer walls than WALL_INDEX_FROM, every one is looked at (quicker than the index).
 */
const WALL_BUCKET = 30;
const WALL_INDEX_FROM = 24;
/** A square's key in the index (its column, then its row: rows far beyond any scene's). */
const bucketKey = (gx, gy) => gx * 1048576 + gy;

/** The walls that block sight, read once (and their index, for a map with many). */
function wallsOf(run) {
  if ( run.prep.sightWalls ) return run.prep.sightWalls;
  // (Sound: whether it stops sound too, where the scene says (snd, Foundry's sense type: 0 lets it through); unsaid, it does.)
  const walls = (run.prep.spec.walls ?? []).filter(w => (Number(w.s) || 0) > 0).map(w => ({
    ax: w.a[0], ay: w.a[1], bx: w.b[0], by: w.b[1], limited: Number(w.s) < 20, dir: Number(w.d) || 0, door: w.door ?? null, open: !!w.open,
    sound: w.snd === undefined || w.snd === null || Number(w.snd) > 0
  }));
  run.prep.sightWalls = walls;
  run.prep.sightIndex = null;
  const finite = w => Number.isFinite(w.ax) && Number.isFinite(w.ay) && Number.isFinite(w.bx) && Number.isFinite(w.by);
  if ( walls.length >= WALL_INDEX_FROM && walls.every(finite) ) {
    const buckets = new Map();
    walls.forEach((w, i) => {
      for ( let gx = Math.floor(Math.min(w.ax, w.bx) / WALL_BUCKET); gx <= Math.floor(Math.max(w.ax, w.bx) / WALL_BUCKET); gx++ ) {
        for ( let gy = Math.floor(Math.min(w.ay, w.by) / WALL_BUCKET); gy <= Math.floor(Math.max(w.ay, w.by) / WALL_BUCKET); gy++ ) {
          const k = bucketKey(gx, gy);
          let list = buckets.get(k);
          if ( !list ) buckets.set(k, list = []);
          list.push(i);
        }
      }
    });
    run.prep.sightIndex = { buckets, seen: new Uint32Array(walls.length), stamp: 0 };
  }
  return walls;
}

/**
 * The walls the line from p to q could cross: on a map with many, those in the squares its box covers (each once);
 * otherwise all of them. (Which order they come in doesn't matter: sightBlocked's answer is the same either way.)
 */
function wallsNear(run, p, q) {
  const walls = wallsOf(run);
  const index = run.prep.sightIndex;
  if ( !index || !Number.isFinite(p.x + p.y + q.x + q.y) ) return walls;
  if ( ++index.stamp >= 0xFFFFFFFF ) {
    index.seen.fill(0);
    index.stamp = 1;
  }
  const { buckets, seen, stamp } = index;
  const out = [];
  const gx1 = Math.floor(Math.max(p.x, q.x) / WALL_BUCKET);
  const gy0 = Math.floor(Math.min(p.y, q.y) / WALL_BUCKET);
  const gy1 = Math.floor(Math.max(p.y, q.y) / WALL_BUCKET);
  for ( let gx = Math.floor(Math.min(p.x, q.x) / WALL_BUCKET); gx <= gx1; gx++ ) {
    for ( let gy = gy0; gy <= gy1; gy++ ) {
      const list = buckets.get(bucketKey(gx, gy));
      if ( !list ) continue;
      for ( const i of list ) {
        if ( seen[i] === stamp ) continue;
        seen[i] = stamp;
        out.push(walls[i]);
      }
    }
  }
  return out;
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
  for ( const w of wallsNear(run, p, q) ) {
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

/**
 * How many walls that stop sound the line from p to q crosses (an open door none): what muffles the din of a fight
 * (senses.js hearDC), as Foundry's sound walls do for a bystander.
 */
export function wallsBetween(run, p, q) {
  let n = 0;
  for ( const w of wallsNear(run, p, q) ) {
    if ( !w.sound || (w.door && (w.open || run.doors?.get(w.door)?.open)) ) continue;
    if ( crosses(p, q, w) ) n += 1;
  }
  return n;
}

/** The points of t a line of sight may reach: its middle, and its corners (just inside them). */
function pointsOf(t) {
  const h = Math.max(0, sizeOf(t) / 2 - 0.5);
  const { x, y } = t.pos;
  return [{ x, y }, { x: x - h, y: y - h }, { x: x + h, y: y - h }, { x: x - h, y: y + h }, { x: x + h, y: y + h }];
}

/**
 * The most lines of sight kept for one list of walls, over every state of its doors, before they're all let go and found
 * again (memory). Doors open and shut a different way in each fight of a batch, and each way keeps lines of its own: a
 * most for each would grow without end on a map of many doors.
 */
const LINES_MOST = 100000;

/** Lines of sight kept, by the battle's list of walls (spec.walls), then by the doors open: sightKept. */
const SIGHT = new WeakMap();

/**
 * Lines of sight kept by where they run from and to. What they come to hangs on the walls and the doors alone, never on
 * who stands where, so they outlast everyone's moves; and every fight of a batch, every pass of a live battle's turn,
 * shares them: one store for each list of walls (a list is never changed in place: live.js setScene gives a new one)
 * and each set of open doors. Which doors are open is looked at again whenever run.geo moves on, as a door opening or
 * shutting moves it (simulator.js openDoor, live.js setScene).
 * {lines: sightBlocked's answers, points: blockedPoints' by t's size}, each by from's x and y, then to's x and y.
 */
function sightKept(run) {
  const walls = run.prep.spec.walls;
  const kept = run.sightCache;
  if ( kept && kept.geo === run.geo && kept.walls === walls ) return kept.store;
  let open = "";
  for ( const [id, d] of run.doors ?? [] ) if ( d?.open ) open += `${id}\u0000`;
  let byDoors = SIGHT.get(walls);
  if ( !byDoors ) SIGHT.set(walls, byDoors = new Map());
  let lines = 0;
  for ( const s of byDoors.values() ) lines += s.size;
  if ( lines > LINES_MOST ) byDoors.clear();
  let store = byDoors.get(open);
  if ( !store ) byDoors.set(open, store = { lines: new Map(), points: new Map(), size: 0 });
  run.sightCache = { geo: run.geo, walls, store };
  return store;
}

/** What's kept for the line from p to q in a map of maps (by p.x, p.y, q.x, q.y), or undefined. */
const keptAt = (map, p, q) => map.get(p.x)?.get(p.y)?.get(q.x)?.get(q.y);

/** Keep v for the line from p to q. */
function keepAt(store, map, p, q, v) {
  let a = map.get(p.x);
  if ( !a ) map.set(p.x, a = new Map());
  let b = a.get(p.y);
  if ( !b ) a.set(p.y, b = new Map());
  let c = b.get(q.x);
  if ( !c ) b.set(q.x, c = new Map());
  c.set(q.y, v);
  store.size += 1;
  return v;
}

/** sightBlocked, kept (sightKept): the same answer, worked out once for each line while the doors stay as they are. */
export function lineBlocked(run, p, q) {
  const store = sightKept(run);
  const v = keptAt(store.lines, p, q);
  return v !== undefined ? v : keepAt(store, store.lines, p, q, sightBlocked(run, p, q));
}

/** How many of t's points u can't see from `from` (0: in the open; all 5: wholly hidden). */
export function blockedPoints(run, u, t, from = u.pos) {
  if ( !from || !t.pos || !wallsKnown(run) ) return 0;
  // (Kept by where the two are and how big t is: sightKept.)
  const store = sightKept(run);
  const size = sizeOf(t);
  let bySize = store.points.get(size);
  if ( !bySize ) store.points.set(size, bySize = new Map());
  const v = keptAt(bySize, from, t.pos);
  if ( v !== undefined ) return v;
  let n = 0;
  for ( const q of pointsOf(t) ) if ( sightBlocked(run, from, q) ) n += 1;
  return keepAt(store, bySize, from, t.pos, n);
}

/** Can u see t from where it stands (or from `from`): a clear line to its middle or a corner? */
export const lineOfSight = (run, u, t, from = u.pos) => blockedPoints(run, u, t, from) < 5;

/** Cover t has from u, by the walls: "none", "some" (one or two of its points hidden), "most" (three or four), "total". */
export function coverFrom(run, u, t) {
  const n = blockedPoints(run, u, t);
  return n === 0 ? "none" : n <= 2 ? "some" : n < 5 ? "most" : "total";
}

/**
 * The nearest spot (from u's) within `most` feet where u would see t with t within `range`, on the map's squares and
 * free: {x, y, feet}, or null. Kept until someone moves, or someone takes up room or stops (spotsKept).
 */
export function spotToShoot(run, u, t, range, most, edgeDistance, crowd = null) {
  if ( !u.pos || !t.pos ) return null;
  const key = `${u.id}|${t.id}|${range}|${most}${crowd ? "|c" : ""}`;
  const cache = spotsKept(run, "shootCache");
  if ( cache.map.has(key) ) return cache.map.get(key);
  // (Farther off than any spot within `most` could bring into range: none.)
  if ( edgeDistance(u, t) - most - 0.5 > range + 0.5 ) {
    cache.map.set(key, null);
    return null;
  }
  // (The map's squares round its own (gridOf), nearest first: the first that will do is the one. Standing between
  // squares, each is as much nearer or farther as its own square is off: none can be nearer than the one found once the
  // ring is that far past it. One out of range, nothing more asked of it. With `crowd`, crowdCost's: a spot costs its
  // distance and what it costs bunched up.)
  let best = null;
  let bestCost = Infinity;
  const c = snapTo(gridOf(u), u.pos.x, u.pos.y);
  const off = Math.hypot(c.x - u.pos.x, c.y - u.pos.y);
  // (The ring read as ringOf reads it, without a list made for it: RING out past `out` feet, and corners past its reach.)
  const out = off > 0 ? most + STEP : most;
  const r = reachOf(out);
  const near = nearBy(run, u, c, out);
  for ( const o of r < 0 ? [] : ringTo(r) ) {
    if ( o.feet > out + 0.5 || (best && o.feet - off > bestCost) ) break;
    if ( Math.abs(o.dx) > r || Math.abs(o.dy) > r ) continue;
    const p = { x: c.x + o.dx, y: c.y + o.dy };
    if ( !(edgeAt(u, p, t) <= range + 0.5) ) continue;
    p.feet = Math.hypot(p.x - u.pos.x, p.y - u.pos.y);
    if ( p.feet > most + 0.5 || p.feet >= bestCost ) continue;
    const cost = crowd ? p.feet + crowd(p) : p.feet;
    if ( cost >= bestCost ) continue;
    if ( !(p.feet > 0 && inTheWay(run, u, p, near)) && lineOfSight(run, u, t, p) ) {
      best = p;
      bestCost = cost;
    }
  }
  cache.map.set(key, best);
  return best;
}

/**
 * The squares round a creature's, nearest first, out to the farthest reach asked for yet (RING_REACH feet each way): the
 * same for everyone (from its own square). One ring, grown when a wider one is asked for and read only as far as it's
 * wanted (ringOf). A ring kept for each distance asked for would keep one for every stride and move left, fractions and
 * all, and every fight of a batch would add more (memory).
 */
let RING = [];
let RING_REACH = -1;

/** How far each way the squares within `most` feet go (a multiple of STEP), or -1: none (no ring without end). */
const reachOf = most => Number.isFinite(most) ? Math.floor(most / STEP) * STEP : -1;

/** RING, out to `r` feet each way at least (grown if it must be). */
function ringTo(r) {
  if ( r <= RING_REACH ) return RING;
  const ring = [];
  for ( let dx = -r; dx <= r; dx += STEP ) {
    for ( let dy = -r; dy <= r; dy += STEP ) ring.push({ dx, dy, feet: Math.hypot(dx, dy) });
  }
  // (A stable sort: squares as far off stay in the order they were put in, dx then dy, however wide the ring, so one read
  // from a wider ring comes in the same order as one worked out to its own reach.)
  ring.sort((a, b) => a.feet - b.feet);
  RING = ring;
  RING_REACH = r;
  return ring;
}

/** [{dx, dy, feet}] the squares within `most` feet and `reachOf(most)` each way, nearest first: RING read that far. */
export function ringOf(most) {
  const r = reachOf(most);
  const ring = [];
  if ( r < 0 ) return ring;
  for ( const o of ringTo(r) ) {
    if ( o.feet > most + 0.5 ) break;
    if ( Math.abs(o.dx) <= r && Math.abs(o.dy) <= r ) ring.push(o);
  }
  return ring;
}
