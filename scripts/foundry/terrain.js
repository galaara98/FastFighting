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

/** Names of regions with difficult terrain (for walkers) along the straight line from a to b. */
function regionsCrossed(a, b) {
  const names = new Set();
  const steps = 8;
  for ( const region of canvas.scene.regions ) {
    const difficult = region.behaviors.some(beh => describeBehavior(beh)?.difficult);
    if ( !difficult ) continue;
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
 * @param {boolean} [options.ignoreTerrain]  Treat all terrain as normal
 * @param {Set<string>} [options.ignoreTerrainFor]  Token ids that ignore terrain (GM override)
 * @returns {Record<string, Record<string, object>>}  approach[aId][tId] = {dist, mult, speed, mode, los, meleeOk, modes, regions}
 */
export function computeApproach(tokens, specs, { ignoreTerrain = false, ignoreTerrainFor = new Set() } = {}) {
  const approach = {};
  // Walls: the way around them, from a grid over the fight (or through, at 4x, when there's none).
  const grid = pathGridFor(tokens);
  const square = squareFeet();
  for ( const a of tokens ) {
    const specA = specs.get(a.id);
    if ( !specA ) continue;
    approach[a.id] = {};
    const speeds = specA.speeds ?? { walk: 25 };
    const reach = Math.max(5, ...specA.actions.filter(x => x.melee).map(x => x.reach ?? 5));
    for ( const b of tokens ) {
      if ( a === b ) continue;
      const specB = specs.get(b.id);
      if ( !specB ) continue;
      const dist = edgeDistance(a, b);
      const elevDiff = Math.abs((a.document.elevation ?? 0) - (b.document.elevation ?? 0));
      const blocked = a.checkCollision(b.center, { type: "move", mode: "any" });
      let throughWall = false;
      const doorsBy = {};
      const modes = {};
      let best = null;
      for ( const mode of MODES ) {
        const speed = speeds[mode];
        if ( !(speed > 0) ) continue;
        let mult = (ignoreTerrain || ignoreTerrainFor.has(a.id)) ? 1 : terrainMultiplier(a, b, mode);
        // Blocked by walls: walkers, swimmers and flyers go the long way round; climbers go over; burrowers under.
        // With no way round, through the wall counts as 4x difficult terrain for that square, and a creature
        // that can't manage that in one move gives up on going that way.
        if ( blocked && !["burrow", "climb"].includes(mode) ) {
          // A closed door on the way is walked to and opened (or forced, or picked) in the fight itself.
          const way = grid?.stepsBetween(a, b);
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
      approach[a.id][b.id] = {
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
        regions: best?.mode === "walk" || best?.mode === "swim" ? regionsCrossed(a, b) : []
      };
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
