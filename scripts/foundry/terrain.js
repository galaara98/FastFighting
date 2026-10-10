/**
 * Terrain and movement: for each attacker/target pair, how far apart they are, which movement mode the attacker
 * would use, what the terrain costs that mode (Foundry region behaviors: walk 2x through rubble, fly 1x), whether
 * walls block sight, and whether melee is even possible (a high flyer out of reach of a ground-bound brute).
 */

const MODES = ["walk", "fly", "swim", "burrow"];

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
    return measured.cost / measured.distance;
  } catch ( err ) {
    return 1;
  }
}

/**
 * @param {Token[]} tokens                 Placeables taking part
 * @param {Map<string, object>} specs      tokenId -> CombatantSpec (for speeds and reach)
 * @param {object} [options]
 * @param {boolean} [options.ignoreTerrain]  Treat all terrain as normal
 * @param {Set<string>} [options.ignoreTerrainFor]  Token ids that ignore terrain (GM override)
 * @returns {Record<string, Record<string, object>>}  approach[aId][tId] = {dist, mult, speed, mode, los, meleeOk, modes}
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
      const modes = {};
      let best = null;
      for ( const mode of MODES ) {
        const speed = speeds[mode];
        if ( !(speed > 0) ) continue;
        let mult = (ignoreTerrain || ignoreTerrainFor.has(a.id)) ? 1 : terrainMultiplier(a, b, mode);
        mult *= 1 + (terrainFudge[a.id] ?? 0);
        // Blocked by walls for this mode: assume a detour rather than an impossible path.
        if ( mode !== "burrow" && a.checkCollision(b.center, { type: "move", mode: "any" }) ) mult *= 1.5;
        if ( !Number.isFinite(mult) ) mult = Infinity;
        modes[mode] = { speed, mult, moveActions: Number.isFinite(mult) ? Math.ceil((dist * mult) / speed) : Infinity };
        const score = (dist * mult) / speed;
        if ( !best || score < best.score ) best = { mode, speed, mult, score };
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
        modes
      };
    }
  }
  return approach;
}

/** Environment flags for a token from the regions it stands in (PF2e environment behaviors, difficult terrain). */
export function environmentAt(token) {
  const point = { ...token.center, elevation: token.document.elevation };
  const env = { types: [], difficult: false, aquatic: false, hazardous: false, regions: [] };
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
  return env;
}
