/**
 * Terrain, movement and perception from the scene:
 *  - approach[a][b]: distance, the movement mode a would use (walk, fly, swim, climb, burrow), its terrain cost
 *    (Foundry region behaviors: walk 2x through rubble, fly 1x), the named regions crossed, line of sight, and
 *    whether melee is even possible (a high flyer out of reach of a ground-bound brute).
 *  - awareness[b][c]: can bystander b see combatant c, smell it, feel it (its other senses), pick it up on radar (tech
 *    sensing), and how hard is it to hear them (walls muffle sound).
 *  - cover: tokens standing beside walls can duck behind them (used by the story writer).
 */
import { getAdapter } from "../api.js";
import { MODULE_ID } from "../constants.js";
import { distanceText } from "../i18n.js";
import { pathGridFor, THROUGH_WALL } from "./pathing.js";
import { senseReach, sightReach, DARK } from "../engine/behavior/senses.js";

const MODES = ["walk", "fly", "swim", "climb", "burrow"];

/**
 * What a region behavior means for a fight: core behaviors here, system ones (PF2e environments and
 * environment features, ...) from the system helper's describeRegionBehavior.
 * @returns {{types?: string[], difficult?: boolean, hazardous?: boolean}|null}
 */
function describeBehavior(behavior) {
  if ( behavior.disabled ) return null;
  if ( behavior.type === "modifyMovementCost" ) return (behavior.system.difficulties?.walk ?? 1) > 1 ? { difficult: true } : null;
  if ( ["executeScript", "executeMacro"].includes(behavior.type) ) return { hazardous: true };
  try {
    return getAdapter()?.describeRegionBehavior?.(behavior) ?? null;
  } catch ( err ) {
    return null;
  }
}

/**
 * How far around each creature the ground is read for forced movement (a shove goes no farther than 20 feet), and the
 * engine's cells (5 feet).
 */
const GROUND_REACH = 25;
const CELL_FEET = 5;
const OUT = Object.freeze([[1, 0, "e"], [1, 1, "se"], [0, 1, "s"], [-1, 1, "sw"], [-1, 0, "w"], [-1, -1, "nw"], [0, -1, "n"], [1, -1, "ne"]]);

/** A region's ground height, in feet, as the GM gave it (FastFighting's field on its settings), or null. */
export function regionGround(region) {
  const v = region?.getFlag?.(MODULE_ID, "ground");
  return v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v) * feetPerUnit();
}

/** The ground's cells read so far, by scene and cell size (computeGround); at most GROUND_KEPT, then started over. */
let groundCells = { sceneId: null, cellPx: null, cells: new Map() };
const GROUND_KEPT = 200000;

/** Walls or regions changed: the ground is read again, cell by cell, as it's wanted. */
export function forgetGround() {
  groundCells = { sceneId: null, cellPx: null, cells: new Map() };
}

/**
 * The ground around everyone in the battle, cell by cell (engine/behavior/forced.js): only the cells with something
 * to them. A cell's ground height: the highest a region over it was given (a ledge 20, a pit -30; FastFighting's field
 * on the region's settings), else the floor (0). Difficult: a region slowing walking. Hazardous: a region the system
 * says harms (its helper's describeRegionBehavior, or a script). Blocked: which ways out of it a wall stops movement.
 * Each cell, once read, is kept (groundCells) until walls or regions change (forgetGround): only cells new to the
 * fight are read when its creatures have moved.
 * @param {Token[]} tokens
 * @returns {{size: number, cells: Array<[number, number, object]>}}
 */
export function computeGround(tokens) {
  const perFoot = canvas.dimensions.size / squareFeet();
  const cellPx = CELL_FEET * perFoot;
  if ( groundCells.sceneId !== canvas.scene?.id || groundCells.cellPx !== cellPx || groundCells.cells.size > GROUND_KEPT ) {
    groundCells = { sceneId: canvas.scene?.id, cellPx, cells: new Map() };
  }
  const known = groundCells.cells;
  let regions = null;
  const regionsNow = () => regions ??= canvas.scene.regions.contents.map(region => ({
    region, ground: regionGround(region),
    difficult: region.behaviors.some(b => describeBehavior(b)?.difficult),
    hazardous: region.behaviors.some(b => describeBehavior(b)?.hazardous)
  })).filter(r => r.ground !== null || r.difficult || r.hazardous);
  const backend = CONFIG.Canvas.polygonBackends.move;
  const inside = (region, point) => {
    try {
      return region.polygonTree?.testPoint?.(point) ?? region.testPoint({ ...point, elevation: 0 });
    } catch ( err ) {
      return false;
    }
  };
  const seen = new Set();
  const cells = [];
  for ( const t of tokens ) {
    const fx = t.center.x / perFoot;
    const fy = t.center.y / perFoot;
    for ( let i = Math.floor((fx - GROUND_REACH) / CELL_FEET); i <= Math.floor((fx + GROUND_REACH) / CELL_FEET); i++ ) {
      for ( let j = Math.floor((fy - GROUND_REACH) / CELL_FEET); j <= Math.floor((fy + GROUND_REACH) / CELL_FEET); j++ ) {
        const key = `${i},${j}`;
        if ( seen.has(key) ) continue;
        seen.add(key);
        if ( known.has(key) ) {
          const kept = known.get(key);
          if ( kept ) cells.push([i, j, kept]);
          continue;
        }
        const center = { x: (i + 0.5) * cellPx, y: (j + 0.5) * cellPx };
        const cell = {};
        let ground = null;
        for ( const r of regionsNow() ) {
          if ( !inside(r.region, center) ) continue;
          if ( r.ground !== null ) ground = Math.max(ground ?? -Infinity, r.ground);
          if ( r.difficult ) cell.d = true;
          if ( r.hazardous ) cell.h = true;
        }
        if ( ground !== null && ground !== 0 ) cell.g = ground;
        const blocked = OUT.filter(([dx, dy]) => {
          try {
            return backend.testCollision(center, { x: center.x + dx * cellPx, y: center.y + dy * cellPx }, { type: "move", mode: "any" });
          } catch ( err ) {
            return false;
          }
        }).map(([, , name]) => name);
        if ( blocked.length ) cell.b = blocked;
        const something = Object.keys(cell).length > 0;
        known.set(key, something ? cell : null);
        if ( something ) cells.push([i, j, cell]);
      }
    }
  }
  return { size: CELL_FEET, cells };
}

/** How far beyond the fight's creatures the walls are read for lines of sight (a long bow's range). */
const WALLS_REACH = 300;

/**
 * The scene's walls that block sight, near the fight (within WALLS_REACH of a creature in it), in feet, for the
 * engine's lines of sight (engine/behavior/space.js): [{a: [x, y], b: [x, y], s (its sight: Foundry's sense type), d
 * (one-way: Foundry's edge direction), door (its id, for a door), open (a door open now)}]. A secret door is a wall
 * while it's shut, like any other.
 * @param {Token[]} tokens
 */
export function computeWalls(tokens) {
  const { size } = canvas.dimensions;
  const feet = squareFeet();
  const toFeet = v => (v / size) * feet;
  const reach = (WALLS_REACH / feet) * size;
  const xs = tokens.map(t => t.center.x);
  const ys = tokens.map(t => t.center.y);
  const box = xs.length ? { x0: Math.min(...xs) - reach, x1: Math.max(...xs) + reach, y0: Math.min(...ys) - reach, y1: Math.max(...ys) + reach } : null;
  const out = [];
  for ( const w of canvas.scene.walls ) {
    const s = Number(w.sight) || 0;
    if ( !s ) continue;
    const [x1, y1, x2, y2] = w.c;
    if ( box && (Math.max(x1, x2) < box.x0 || Math.min(x1, x2) > box.x1 || Math.max(y1, y2) < box.y0 || Math.min(y1, y2) > box.y1) ) continue;
    const door = w.door && w.door !== CONST.WALL_DOOR_TYPES.NONE;
    out.push({
      a: [toFeet(x1), toFeet(y1)], b: [toFeet(x2), toFeet(y2)], s, d: Number(w.dir) || 0,
      door: door ? w.id : null, open: !!door && w.ds === CONST.WALL_DOOR_STATES.OPEN
    });
  }
  return out;
}

/**
 * FastFighting's field on a region's settings: its ground's height (a ledge, a platform; a pit's floor below), so a
 * creature shoved off it falls. Blank: the region isn't ground.
 */
export function registerGroundField() {
  Hooks.on("renderRegionConfig", (app, html) => {
    const root = html;
    const region = app.document;
    if ( !root || !region || root.querySelector(".ff-region-ground") ) return;
    const anchor = root.querySelector('[name="elevation.top"]')?.closest(".form-group") ?? root.querySelector(".form-group");
    if ( !anchor ) return;
    const group = document.createElement("div");
    group.className = "form-group ff-region-ground";
    // (The flag as a number only, set through the DOM: a region's flags are anyone's who can make one, never HTML.)
    const raw = region.getFlag(MODULE_ID, "ground");
    const stored = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
    group.innerHTML = `<label>${foundry.utils.escapeHTML(game.i18n.localize("FASTFIGHTING.Region.Ground"))}</label>
      <div class="form-fields"><input type="number" step="any" name="flags.${MODULE_ID}.ground"></div>
      <p class="hint">${foundry.utils.escapeHTML(game.i18n.localize("FASTFIGHTING.Region.GroundHint"))}</p>`;
    const input = group.querySelector("input");
    if ( input ) input.value = Number.isFinite(stored) ? String(stored) : "";
    anchor.after(group);
  });
}

/** Hearing combat in the open: easy nearby, harder with distance, much harder through each wall. */
const HEAR = { baseDC: 8, perFeet: 15, perWall: 6, maxFeet: 300 };
const VISION_FEET = 240;
const COVER_FEET = 7.5;

/**
 * Feet in one of the scene's distance units, whatever the system or the GM calls them ("ft", "feet", "m",
 * "metres", ...; a metre counted the table way, 1.5 m to a 5-foot square). Units it doesn't know count squares,
 * five feet each. The engine works in feet; this keeps it right on any grid.
 */
const UNIT_FEET = {
  ft: 1, feet: 1, foot: 1, "'": 1, pi: 1, pieds: 1, "fuß": 1, fuss: 1,
  m: 10 / 3, meter: 10 / 3, meters: 10 / 3, metre: 10 / 3, metres: 10 / 3, "mètre": 10 / 3, "mètres": 10 / 3, metro: 10 / 3, metros: 10 / 3, metri: 10 / 3,
  yd: 3, yard: 3, yards: 3, mi: 5280, mile: 5280, miles: 5280, km: 10000 / 3
};
export function feetPerUnit(scene = canvas.scene) {
  const units = String(scene?.grid?.units ?? "").trim().toLowerCase().replace(/\.$/, "");
  if ( units in UNIT_FEET ) return UNIT_FEET[units];
  return 5 / (scene?.grid?.distance || 5);
}

/** A scene's units, for distances told in them: {label, feetPer}, or null (no units named: feet). */
export function sceneUnit(scene = canvas.scene) {
  const label = String(scene?.grid?.units ?? "").trim();
  return label ? { label, feetPer: feetPerUnit(scene) } : null;
}

/** A distance in feet as the scene measures it, to the nearest whole square: "30 ft", "9 m". */
export function sceneDistance(feet) {
  const square = squareFeet();
  return distanceText(Math.max(1, Math.round(feet / square)) * square);
}

/** Feet across one grid square of the current scene. */
export function squareFeet() {
  return canvas.dimensions.distance * feetPerUnit();
}

function sizeFeet(doc) {
  return Math.max(doc.width, doc.height) * squareFeet();
}

/** Straight-line distance between the edges of two tokens, in feet (adjacent = 5). */
function edgeDistance(a, b) {
  const grid = squareFeet();
  const pa = { ...a.center, elevation: a.document.elevation };
  const pb = { ...b.center, elevation: b.document.elevation };
  const center = canvas.grid.measurePath([pa, pb]).distance * feetPerUnit();
  const extra = (sizeFeet(a.document) + sizeFeet(b.document)) / 2 - grid;
  return Math.max(grid, center - extra);
}

/** Terrain-aware cost multiplier for moving token a to b using `action`. */
function terrainMultiplier(a, b, action) {
  // Measure to the space beside the target, not into it: systems charge extra to enter a foe's space (5e counts
  // it as difficult terrain), and nobody walks into the creature they mean to hit.
  const size = canvas.grid.size;
  const beside = (ap, bp, aw, bw) => {
    if ( ap + aw * size <= bp ) return bp - aw * size; // coming from the left (or above): stop just short
    if ( ap >= bp + bw * size ) return bp + bw * size; // from the right (or below)
    return ap;                                         // already level on this axis
  };
  const A = a.document;
  const B = b.document;
  const from = { x: A.x, y: A.y, elevation: A.elevation, action };
  const to = { x: beside(A.x, B.x, A.width ?? 1, B.width ?? 1), y: beside(A.y, B.y, A.height ?? 1, B.height ?? 1), elevation: B.elevation, action };
  if ( to.x === from.x && to.y === from.y ) return 1;
  try {
    const path = a.createTerrainMovementPath([from, to]);
    const measured = a.measureMovementPath(path);
    if ( !measured.distance ) return 1;
    // Climbing and crawling carry an action cost multiplier for creatures without the speed; a creature with
    // a climb speed only pays for the terrain.
    const actionMult = CONFIG.Token.movement.actions[action]?.costMultiplier ?? 1;
    return measured.cost / measured.distance / actionMult;
  } catch ( err ) {
    return 1;
  }
}

/** The scene's regions with difficult terrain (for walkers). */
const difficultRegions = () => canvas.scene.regions.filter(region => region.behaviors.some(beh => describeBehavior(beh)?.difficult));

/**
 * Names of regions with difficult terrain (for walkers) along the straight line from a to b (`difficult`: those regions,
 * where the caller has them already).
 */
function regionsCrossed(a, b, difficult = difficultRegions()) {
  const names = new Set();
  const steps = 8;
  for ( const region of difficult ) {
    for ( let i = 1; i < steps; i++ ) {
      const t = i / steps;
      const point = { x: a.center.x + (b.center.x - a.center.x) * t, y: a.center.y + (b.center.y - a.center.y) * t, elevation: a.document.elevation };
      let inside = false;
      try { inside = region.testPoint(point); } catch ( err ) { inside = false; }
      if ( inside ) { names.add(region.name); break; }
    }
  }
  return [...names];
}

/**
 * @param {Token[]} tokens                 Placeables taking part
 * @param {Map<string, object>} specs      tokenId -> CombatantSpec (for speeds and reach)
 * @param {object} [options]
 * @param {Set<string>} [options.ignoreTerrainFor]  Token ids that ignore terrain (GM override)
 * @param {Map<string, object>} [options.pairs]  Each pair as it was worked out last (kept by the caller): a pair
 *                                               neither of which has moved (nor changed its speeds, its reach, or
 *                                               whether it ignores terrain) is taken as it was. The caller forgets it
 *                                               when walls or regions change (battle.js invalidateApproach).
 * @returns {Record<string, Record<string, object>>}  approach[aId][tId] = {dist, mult, speed, mode, los, meleeOk, modes, regions}
 */
export function computeApproach(tokens, specs, { ignoreTerrainFor = new Set(), pairs = null } = {}) {
  const approach = {};
  // Walls: the way around them, from a grid over the fight (or through, at 4x, when there's none).
  const grid = pathGridFor(tokens);
  const square = squareFeet();
  let difficult = null;
  // (What a pair's reckoning depends on, besides the walls and regions: the scene and its grid, the grid the way round is
  // found on, where each token is (its centre too: a token mid-move), how high, how big.)
  const where = t => {
    const d = t.document;
    return [d._source?.x ?? d.x, d._source?.y ?? d.y, t.center?.x, t.center?.y, d.elevation ?? 0, d.width, d.height];
  };
  const field = grid ? [grid.sceneId, grid.ox, grid.oy, grid.cols, grid.rows] : null;
  const scene = [canvas.scene?.id, canvas.dimensions?.size, canvas.dimensions?.distance, canvas.grid?.type, canvas.grid?.diagonals, square, field];
  for ( const a of tokens ) {
    const specA = specs.get(a.id);
    if ( !specA ) continue;
    approach[a.id] = {};
    const speeds = specA.speeds ?? { walk: 25 };
    const reach = Math.max(5, ...specA.actions.filter(x => x.melee).map(x => x.reach ?? 5));
    const ignores = ignoreTerrainFor.has(a.id);
    const fromA = pairs ? JSON.stringify([scene, where(a), speeds, reach, ignores]) : null;
    for ( const b of tokens ) {
      if ( a === b ) continue;
      const specB = specs.get(b.id);
      if ( !specB ) continue;
      const pairKey = pairs ? `${fromA}|${JSON.stringify(where(b))}` : null;
      const known = pairs?.get(`${a.id}|${b.id}`);
      if ( known && known.key === pairKey ) {
        approach[a.id][b.id] = known.value;
        continue;
      }
      const dist = edgeDistance(a, b);
      const elevDiff = Math.abs((a.document.elevation ?? 0) - (b.document.elevation ?? 0));
      const blocked = a.checkCollision(b.center, { type: "move", mode: "any" });
      let throughWall = false;
      const doorsBy = {};
      const modes = {};
      let best = null;
      // (The way round, once for the pair: the same whichever way it moves.)
      let round;
      const wayRound = () => (round === undefined ? (round = grid?.stepsBetween(a, b)) : round);
      for ( const mode of MODES ) {
        const speed = speeds[mode];
        if ( !(speed > 0) ) continue;
        let mult = ignores ? 1 : terrainMultiplier(a, b, mode);
        // Blocked by walls: walkers, swimmers and flyers go the long way round; climbers go over; burrowers under.
        // With no way round, through the wall counts as 4x difficult terrain for that square, and a creature
        // that can't manage that in one move gives up on going that way.
        if ( blocked && !["burrow", "climb"].includes(mode) ) {
          // A closed door on the way is walked to and opened (or forced, or picked) in the fight itself.
          const way = wayRound();
          const straight = Math.max(1, dist / square);
          if ( !way ) mult *= 1.5;
          else if ( Number.isFinite(way.steps) ) {
            mult *= Math.max(1, way.steps / straight);
            if ( way.doors.length ) doorsBy[mode] = way.doors;
          } else if ( speed < THROUGH_WALL * square ) mult = Infinity;
          else mult *= (dist + (THROUGH_WALL - 1) * square) / Math.max(square, dist);
          throughWall ||= way?.steps === Infinity;
        }
        if ( !Number.isFinite(mult) ) mult = Infinity;
        modes[mode] = { speed, mult, moveActions: Number.isFinite(mult) ? Math.ceil((dist * mult) / speed) : Infinity };
        const score = (dist * mult) / speed;
        if ( !best || score < best.score - 1e-6 ) best = { mode, speed, mult, score };
      }
      // Melee needs the attacker to reach the target's elevation: flyers can, ground-bound creatures can't
      // reach a flyer hovering above their reach.
      const canFly = (speeds.fly ?? 0) > 0;
      const meleeOk = canFly || elevDiff <= reach;
      const value = {
        dist,
        mult: best?.mult ?? Infinity,
        speed: best?.speed ?? 0,
        mode: best?.mode ?? null,
        los: !a.checkCollision(b.center, { type: "sight", mode: "any" }),
        meleeOk,
        modes,
        blocked,
        throughWall,
        doors: (best && doorsBy[best.mode]) ?? [],
        regions: best?.mode === "walk" || best?.mode === "swim" ? regionsCrossed(a, b, difficult ??= difficultRegions()) : []
      };
      approach[a.id][b.id] = value;
      pairs?.set(`${a.id}|${b.id}`, { key: pairKey, value });
    }
  }
  return approach;
}

/** Number of sound-blocking walls between two points. */
function wallsBetween(a, b) {
  try {
    const hits = CONFIG.Canvas.polygonBackends.sound.testCollision(a.center, b.center, { type: "sound", mode: "all" });
    return Array.isArray(hits) ? hits.length : (hits ? 1 : 0);
  } catch ( err ) {
    return a.checkCollision(b.center, { type: "sound", mode: "any" }) ? 1 : 0;
  }
}

/**
 * Who could notice whom: for each bystander, for each combatant, can they see it (in the scene's light, with a line of
 * sight), smell it (no wall between), feel it (its other senses) or pick it up on radar (tech sensing), walls or not,
 * each within its reach, and the DC to hear it (any that hears: the din of a fight carries).
 * @param {Token[]} bystanders
 * @param {Token[]} combatants
 * @param {object} [options]
 * @param {Map<string, object>} [options.senses]  By token id: its spec's senses (spec.senses, from the system helper)
 * @param {number} [options.hearingFeet]          The system's ordinary hearing (rules.hearingFeet)
 * @returns {Record<string, Record<string, {see: boolean, smell: boolean, feel: boolean, radar: boolean, hearDC: number|null}>>}
 */
export function computeAwareness(bystanders, combatants, { senses = new Map(), hearingFeet } = {}) {
  const out = {};
  const dark = (canvas.scene.environment?.darknessLevel ?? 0) >= DARK;
  for ( const b of bystanders ) {
    const row = out[b.id] = {};
    const r = senseReach({ senses: senses.get(b.id) }, hearingFeet);
    const sightFeet = Math.min(VISION_FEET, sightReach(r, dark));
    for ( const c of combatants ) {
      if ( b === c ) continue;
      const feet = canvas.grid.measurePath([b.center, c.center]).distance;
      const see = feet <= sightFeet && !b.checkCollision(c.center, { type: "sight", mode: "any" });
      const smell = feet <= r.smell && !b.checkCollision(c.center, { type: "move", mode: "any" });
      const feel = feet <= r.feel;
      const radar = feet <= r.radar;
      let hearDC = null;
      if ( r.hearing > 0 && feet <= HEAR.maxFeet ) {
        hearDC = Math.round(HEAR.baseDC + feet / HEAR.perFeet + HEAR.perWall * wallsBetween(b, c));
      }
      row[c.id] = { see, smell, feel, radar, hearDC };
    }
  }
  return out;
}

/** Distance in feet from a point to the nearest wall segment. */
function nearestWallFeet(point) {
  const px = point.x;
  const py = point.y;
  let best = Infinity;
  for ( const wall of canvas.scene.walls ) {
    const [x1, y1, x2, y2] = wall.c;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
    const d = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    best = Math.min(best, d);
  }
  return (best / canvas.dimensions.size) * squareFeet();
}

/** Environment flags for a token from the regions it stands in and the walls beside it. */
export function environmentAt(token) {
  const point = { ...token.center, elevation: token.document.elevation };
  const env = { types: [], difficult: false, aquatic: false, hazardous: false, regions: [], nearCover: false };
  for ( const region of canvas.scene.regions ) {
    let inside = false;
    try {
      inside = region.testPoint(point);
    } catch ( err ) {
      inside = false;
    }
    if ( !inside ) continue;
    env.regions.push(region.name);
    for ( const behavior of region.behaviors ) {
      const d = describeBehavior(behavior);
      if ( !d ) continue;
      env.types.push(...(d.types ?? []));
      if ( d.difficult ) env.difficult = true;
      if ( d.hazardous ) env.hazardous = true;
    }
  }
  env.aquatic = env.types.includes("aquatic");
  env.nearCover = canvas.scene.walls.size > 0 && nearestWallFeet(token.center) <= COVER_FEET + sizeFeet(token.document) / 2;
  return env;
}

/** Token center in feet, plus its size, for the engine's positions. */
export function positionOf(token) {
  const { size } = canvas.dimensions;
  const feet = squareFeet();
  // Where the token really is (its center while it animates is wherever the animation has got to).
  const doc = token.document;
  const cx = doc._source.x + (doc.width * size) / 2;
  const cy = doc._source.y + (doc.height * size) / 2;
  return { x: (cx / size) * feet, y: (cy / size) * feet, size: sizeFeet(doc) };
}

/**
 * Where a token stands on its own scene (not only the one on the canvas), in feet from the corner (its center), as
 * positionOf counts them: the scene's grid in its own units, in feet.
 */
export function feetOnScene(scene, doc) {
  const size = scene?.grid?.size || 100;
  const feet = (scene?.grid?.distance || 5) * feetPerUnit(scene);
  return { x: ((doc.x + ((doc.width ?? 1) * size) / 2) / size) * feet, y: ((doc.y + ((doc.height ?? 1) * size) / 2) / size) * feet };
}

/** Convert an engine position (feet, center) back to a token's top-left x/y in pixels, snapped to the grid. */
export function pixelsFor(tokenDoc, position) {
  const { size } = canvas.dimensions;
  const feet = squareFeet();
  const cx = (position.x / feet) * size;
  const cy = (position.y / feet) * size;
  const w = tokenDoc.width * size;
  const h = tokenDoc.height * size;
  const raw = { x: cx - w / 2, y: cy - h / 2 };
  const snapped = canvas.grid.getSnappedPoint?.(raw, { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_CORNER }) ?? raw;
  return { x: Math.round(snapped.x), y: Math.round(snapped.y) };
}
