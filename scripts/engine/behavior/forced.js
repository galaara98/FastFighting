/**
 * Forced movement: a creature shoved away, dragged closer, or put anywhere in reach (maneuvers.js: an outcome's move,
 * {kind: "push" | "pull" | "place", feet}; or a push until it's so far off: {kind: "push", to: feet}). Stopped short
 * against a wall or another creature, the system may say what the collision does (rules.collisionDamage(t, {feetLeft,
 * into, move, by}): damage parts; `move` is the move itself, with anything the helper put on it). Where it ends up (forcedPath), step by step, 5 feet at a time: a wall or
 * another creature in the way stops it, and where the ground drops away (more than 5 feet down) it goes over the
 * edge and falls. What it finds there: the fall (rules.fallDamage(feet, unit): damage parts, else 1d6 for each 10
 * feet, at most 20d6; it lands prone), a hazard whose reach it's in (the hazard goes off: it strikes it once), harm
 * where it lands (the scene's: a fire, acid), difficult ground (slower to come back).
 *
 * What the map is like comes with the battle (spec.ground, foundry/battle.js groundOf): {size, cells: [[i, j, cell]]},
 * a cell {g: its ground's height in feet, d: difficult, h: hazardous, harm: [damage parts], b: [directions blocked
 * out of it: "n", "ne", ... "nw"]}. Without it, open level ground. Without positions at all, a push only takes it out
 * of the doer's reach.
 *
 * What a move is worth to the one doing it (forcedWorth): the harm it would do there, as well as the doer can tell
 * (the tactical see the drop and the fire; the instinctive half the time; the feral hardly), more to one whose pills
 * like it (behavior.shoves: Brawlers, the Cruel). Pure: no Foundry globals.
 */
import { TACTICAL } from "../../constants.js";
import { edgeDistance, centerDistance, isStanding, liveTier, behaviorOf } from "../battle-state.js";
import { meanPart, parseFormula } from "../dice.js";
import { dangerOf } from "./traps.js";
import { iwrOf } from "./effects.js";

const STEP = 5;
/** The eight ways out of a cell, and their names (a cell's blocked directions). */
const DIRS = Object.freeze([[1, 0, "e"], [1, 1, "se"], [0, 1, "s"], [-1, 1, "sw"], [-1, 0, "w"], [-1, -1, "nw"], [0, -1, "n"], [1, -1, "ne"]]);
/** A drop this deep or more is a fall. */
export const FALL_FROM = 10;
/** What a move does where nothing's there, and on difficult ground, and in a scene's harm with no damage given. */
const PLAIN = 0.5;
const DIFFICULT = 1.5;
const HAZARDOUS = 4;
/** How much of a hazard's blow lands, on the whole. */
const HAZARD_HITS = 0.6;

/** The battle's map, cell by cell (spec.ground), read once: Map "i,j" -> cell. */
export function groundOf(run) {
  if ( run.prep.groundMap !== undefined ) return run.prep.groundMap;
  const g = run.prep.spec.ground;
  const size = Number(g?.size) || STEP;
  const cells = new Map();
  for ( const [i, j, cell] of g?.cells ?? [] ) cells.set(`${i},${j}`, cell ?? {});
  run.prep.groundMap = { size, cells };
  return run.prep.groundMap;
}

const cellOf = (map, p) => {
  const i = Math.floor(p.x / map.size);
  const j = Math.floor(p.y / map.size);
  return { i, j, cell: map.cells.get(`${i},${j}`) ?? null };
};
const heightAt = (map, p) => Number(cellOf(map, p).cell?.g) || 0;

/** Does it fly (so a drop is no fall)? */
const flies = t => (t.spec.speeds?.fly ?? 0) > 0 && !t.prone && !t.conds?.immobilized;

/** Would t at that spot overlap one of them (sizes, center to center)? */
const overlaps = (t, p, o) => (centerDistance({ pos: p, spec: t.spec }, o) ?? Infinity) < ((t.spec.position?.size ?? 5) + (o.spec.position?.size ?? 5)) / 2 - 0.5;

/** Is that spot taken by someone else standing there (the doer counts: no shoving it into its own space)? */
function taken(run, t, p) {
  return run.units.some(o => o !== t && o.pos && isStanding(o) && !o.spec.hazard && overlaps(t, p, o));
}

/** The nearest of the eight ways to go along (dx, dy). */
function compass(dx, dy) {
  const a = Math.atan2(dy, dx);
  const k = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return DIRS[k];
}

/**
 * Where a move leaves t: {to, feet, fall, hazards, cell, blocked}. Step by step along the way it's pushed (or pulled,
 * stopping beside the doer); placed, the worst spot within the doer's reach, no farther than the move goes.
 */
export function forcedPath(run, u, t, move) {
  if ( !t.pos || !u.pos ) return { to: null, feet: move.feet ?? STEP, fall: 0, hazards: [], cell: null, blocked: false, noMap: true };
  const map = groundOf(run);
  if ( move.kind === "place" ) return placeWorst(run, u, t, move, map);
  const away = move.kind === "pull" ? -1 : 1;
  const [sx, sy, name] = compass((t.pos.x - u.pos.x) * away, (t.pos.y - u.pos.y) * away);
  const start = { x: t.pos.x, y: t.pos.y };
  let at = start;
  let feet = 0;
  let fall = 0;
  let blocked = false;
  let into = null;
  const from = heightAt(map, start);
  // (Pushed until it's that far off, rather than so many feet: Daggerheart's knocked back to Far.)
  const feetToGo = Number.isFinite(move.to) ? Math.max(0, move.to - (edgeDistance(u, t) ?? 0)) : move.feet ?? STEP;
  for ( let n = 0; n < Math.round(feetToGo / STEP); n++ ) {
    if ( cellOf(map, at).cell?.b?.includes(name) ) { blocked = true; break; }
    const next = { x: at.x + sx * STEP, y: at.y + sy * STEP };
    // (Dragged: no closer than beside the one dragging it.)
    if ( move.kind === "pull" && overlaps(t, next, u) ) break;
    if ( taken(run, t, next) ) {
      blocked = true;
      into = run.units.find(o => o !== t && o.pos && isStanding(o) && !o.spec.hazard && overlaps(t, next, o)) ?? null;
      break;
    }
    at = next;
    feet += STEP;
    const drop = from - heightAt(map, at);
    if ( drop >= FALL_FROM && !flies(t) ) {
      fall = drop;
      break;
    }
  }
  return { to: at, feet, fall, hazards: hazardsAt(run, t, at), cell: cellOf(map, at).cell, blocked, into };
}

/** Placed anywhere within the doer's reach (no farther than the move goes): the spot that would hurt it most. */
function placeWorst(run, u, t, move, map) {
  const reach = 5 + (u.spec.position?.size ?? 5) / 2;
  const range = move.feet ?? STEP;
  let best = { to: { x: t.pos.x, y: t.pos.y }, feet: 0, fall: 0, hazards: hazardsAt(run, t, t.pos), cell: cellOf(map, t.pos).cell, blocked: false };
  let bestHarm = harmThere(run, t, best);
  const from = heightAt(map, t.pos);
  for ( let dx = -range; dx <= range; dx += STEP ) {
    for ( let dy = -range; dy <= range; dy += STEP ) {
      if ( !dx && !dy ) continue;
      const p = { x: t.pos.x + dx, y: t.pos.y + dy };
      if ( Math.hypot(p.x - u.pos.x, p.y - u.pos.y) > reach + range || taken(run, t, p) ) continue;
      const drop = from - heightAt(map, p);
      const there = { to: p, feet: Math.max(Math.abs(dx), Math.abs(dy)), fall: drop >= FALL_FROM && !flies(t) ? drop : 0, hazards: hazardsAt(run, t, p), cell: cellOf(map, p).cell, blocked: false };
      const harm = harmThere(run, t, there);
      if ( harm > bestHarm ) {
        best = there;
        bestHarm = harm;
      }
    }
  }
  return best;
}

/** The hazards still set whose reach that spot is in. */
function hazardsAt(run, t, p) {
  const there = { pos: p, spec: t.spec };
  return run.units.filter(h => h.spec.hazard && h.pos && isStanding(h) && !h.spent && edgeDistance(there, h) <= dangerOf(h) + 0.5);
}

/** A fall's damage, by the system (rules.fallDamage), else 1d6 for each 10 feet (at most 20d6). */
export function fallDamage(run, feet, t) {
  const own = run.prep.rules.fallDamage?.(feet, t);
  if ( own ) return own;
  const dice = Math.min(20, Math.floor(feet / 10));
  return dice > 0 ? [parseFormula(`${dice}d6`, "bludgeoning")] : [];
}

const mean = parts => (parts ?? []).reduce((s, p) => s + Math.max(0, meanPart(p)), 0);

/** What being left there would do to t: the fall, the hazards that go off, the ground's harm, slower ground. */
function harmThere(run, t, path) {
  let harm = 0;
  if ( path.fall > 0 ) harm += mean(fallDamage(run, path.fall, t)) + 2;
  for ( const h of path.hazards ?? [] ) {
    const blow = Math.max(0, ...h.prep.offense.map(a => mean(a.damage)));
    harm += blow * HAZARD_HITS;
  }
  if ( path.cell?.harm?.length ) harm += mean(path.cell.harm);
  else if ( path.cell?.h ) harm += HAZARDOUS;
  if ( path.cell?.d ) harm += DIFFICULT;
  return harm;
}

/**
 * What a move is worth to `by` (in harm done): what it would do to t where it ends up, as well as `by` can tell (the
 * tactical see the drop; the instinctive half the time; the feral hardly), more for one whose pills like it.
 */
export function forcedWorth(run, by, t, move) {
  if ( !move || !t ) return 0;
  const path = forcedPath(run, by, t, move);
  if ( path.noMap ) return PLAIN;
  if ( !path.feet && !path.fall ) return 0;
  const tier = liveTier(run, by);
  const sees = tier >= TACTICAL.COMPETENT ? 1 : tier === TACTICAL.INSTINCTIVE ? 0.5 : 0.2;
  return (PLAIN + harmThere(run, t, path) * sees) * damageScale(run, by, t) * (1 + (behaviorOf(by).shoves ?? 0));
}

/**
 * Harm in the system's own terms, against `by`'s own blows: what its best blow would come to on t, by the system's
 * rules (rules.applyIwr: Daggerheart's Hit Points marked, a few for a hit), over its dice. 1 where they're the same.
 */
function damageScale(run, by, t) {
  const rules = run.prep.rules;
  let best = null;
  let raw = 0;
  for ( const a of by.prep?.offense ?? [] ) {
    const n = mean(a.damage);
    if ( n > raw ) {
      raw = n;
      best = a.damage;
    }
  }
  if ( !best || !(raw > 0) || typeof rules.applyIwr !== "function" ) return 1;
  const byType = {};
  for ( const p of best ) byType[p.type] = (byType[p.type] ?? 0) + Math.max(0, meanPart(p));
  const counted = Number(rules.applyIwr(iwrOf(t), byType));
  return Number.isFinite(counted) && counted > 0 ? counted / raw : 1;
}

/** Who's beside it now, it moved: in reach, or no longer. */
export function resettle(run, t) {
  for ( const o of run.units ) {
    if ( o === t || !o.pos || !t.pos ) continue;
    const near = isStanding(o) && (edgeDistance(t, o) ?? Infinity) <= 5.5;
    if ( near ) {
      t.adjacent.add(o.id);
      o.adjacent.add(t.id);
    } else {
      t.adjacent.delete(o.id);
      o.adjacent.delete(t.id);
    }
  }
}
