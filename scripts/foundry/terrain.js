/**
 * Terrain, movement and perception from the scene:
 *  - approach[a][b]: distance, the movement mode a would use (walk, fly, swim, climb, burrow), its terrain cost
 *    (Foundry region behaviors: walk 2x through rubble, fly 1x), the named regions crossed, line of sight, and
 *    whether melee is even possible (a high flyer out of reach of a ground-bound brute).
 *  - awareness[b][c]: can bystander b see combatant c, and how hard is it to hear them (walls muffle sound).
 *  - cover: tokens standing beside walls can duck behind them (used by the story writer).
 */

const MODES = ["walk", "fly", "swim", "climb", "burrow"];

/** Hearing combat in the open: easy nearby, harder with distance, much harder through each wall. */
const HEAR = { baseDC: 8, perFeet: 15, perWall: 6, maxFeet: 300 };
const VISION_FEET = 240;
const COVER_FEET = 7.5;

function sizeFeet(doc) {
  return Math.max(doc.width, doc.height) * canvas.dimensions.distance;
}

/** Straight-line distance between the edges of two tokens, in feet (adjacent = 5). */
function edgeDistance(a, b) {
  const grid = canvas.dimensions.distance;
  const pa = { ...a.center, elevation: a.document.elevation };
  const pb = { ...b.center, elevation: b.document.elevation };
  const center = canvas.grid.measurePath([pa, pb]).distance;
  const extra = (sizeFeet(a.document) + sizeFeet(b.document)) / 2 - grid;
  return Math.max(grid, center - extra);
}

/** Terrain-aware cost multiplier for moving token a to b using `action`. */
function terrainMultiplier(a, b, action) {
  const from = { x: a.document.x, y: a.document.y, elevation: a.document.elevation, action };
  const to = { x: b.document.x, y: b.document.y, elevation: b.document.elevation, action };
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
    const difficult = region.behaviors.some(beh => !beh.disabled
      && ((beh.type === "modifyMovementCost" && (beh.system.difficulties?.walk ?? 1) > 1)
        || (beh.type === "environmentFeature" && beh.system.terrain?.difficult)));
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
export function computeApproach(tokens, specs, { ignoreTerrain = false, ignoreTerrainFor = new Set(), terrainFudge = {} } = {}) {
  const approach = {};
  for ( const a of tokens ) {
    const specA = specs.get(a.id);
    if ( !specA ) continue;
    const row = approach[a.id] = {};
    const speeds = specA.speeds ?? { walk: 25 };
    const reach = Math.max(5, ...specA.actions.filter(x => x.melee).map(x => x.reach ?? 5));
    for ( const b of tokens ) {
      if ( a === b ) continue;
      const specB = specs.get(b.id);
      if ( !specB ) continue;
      const dist = edgeDistance(a, b);
      const elevDiff = Math.abs((a.document.elevation ?? 0) - (b.document.elevation ?? 0));
      const blocked = a.checkCollision(b.center, { type: "move", mode: "any" });
      const modes = {};
      let best = null;
      for ( const mode of MODES ) {
        const speed = speeds[mode];
        if ( !(speed > 0) ) continue;
        let mult = (ignoreTerrain || ignoreTerrainFor.has(a.id)) ? 1 : terrainMultiplier(a, b, mode);
        mult *= 1 + (terrainFudge[a.id] ?? 0);
        // Blocked by walls: walkers and swimmers detour; climbers go over; burrowers go under.
        if ( blocked && !["burrow", "climb"].includes(mode) ) mult *= 1.5;
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
 * Who could notice whom: for each bystander, for each combatant, can they see it, and the DC to hear it.
 * @param {Token[]} bystanders
 * @param {Token[]} combatants
 * @returns {Record<string, Record<string, {see: boolean, hearDC: number|null}>>}
 */
export function computeAwareness(bystanders, combatants) {
  const out = {};
  const darkness = canvas.scene.environment?.darknessLevel ?? 0;
  for ( const b of bystanders ) {
    const row = out[b.id] = {};
    const senses = b.actor?.system?.perception?.senses ?? [];
    const darkvision = Array.isArray(senses) ? senses.some(s => /darkvision|greater-darkvision/.test(s.type ?? s)) : false;
    const visionFeet = (darkness > 0.7 && !darkvision) ? 30 : VISION_FEET;
    for ( const c of combatants ) {
      if ( b === c ) continue;
      const feet = canvas.grid.measurePath([b.center, c.center]).distance;
      const see = feet <= visionFeet && !b.checkCollision(c.center, { type: "sight", mode: "any" });
      let hearDC = null;
      if ( feet <= HEAR.maxFeet ) {
        hearDC = Math.round(HEAR.baseDC + feet / HEAR.perFeet + HEAR.perWall * wallsBetween(b, c));
      }
      row[c.id] = { see, hearDC };
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
  return (best / canvas.dimensions.size) * canvas.dimensions.distance;
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
      if ( behavior.disabled ) continue;
      if ( behavior.type === "environment" ) {
        for ( const t of behavior.system.environmentTypes ?? [] ) env.types.push(t);
      } else if ( behavior.type === "environmentFeature" && behavior.system.terrain?.difficult ) {
        env.difficult = true;
      } else if ( behavior.type === "modifyMovementCost" ) {
        if ( (behavior.system.difficulties?.walk ?? 1) > 1 ) env.difficult = true;
      } else if ( ["executeScript", "executeMacro"].includes(behavior.type) ) {
        env.hazardous = true;
      }
    }
  }
  env.aquatic = env.types.includes("aquatic");
  env.nearCover = canvas.scene.walls.size > 0 && nearestWallFeet(token.center) <= COVER_FEET + sizeFeet(token.document) / 2;
  return env;
}

/** Token center in feet, plus its size, for the engine's positions. */
export function positionOf(token) {
  const { size, distance } = canvas.dimensions;
  return { x: (token.center.x / size) * distance, y: (token.center.y / size) * distance, size: sizeFeet(token.document) };
}

/** Convert an engine position (feet, center) back to a token's top-left x/y in pixels, snapped to the grid. */
export function pixelsFor(tokenDoc, position) {
  const { size, distance } = canvas.dimensions;
  const cx = (position.x / distance) * size;
  const cy = (position.y / distance) * size;
  const w = tokenDoc.width * size;
  const h = tokenDoc.height * size;
  const raw = { x: cx - w / 2, y: cy - h / 2 };
  const snapped = canvas.grid.getSnappedPoint?.(raw, { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_CORNER }) ?? raw;
  return { x: Math.round(snapped.x), y: Math.round(snapped.y) };
}
