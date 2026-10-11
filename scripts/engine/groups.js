/**
 * Friend groups for neutral tokens, proposed the moment the Battle Planner opens (the GM can move anyone after).
 *
 * From the map's top-left corner, the nearest neutral starts group 1, and every neutral of its kind joins it (the
 * same stat block, or what the system calls the same type of creature). Then anyone within `reach` squares of the
 * group joins, and anyone within reach of those, and of those (three steps out, no more). Group 2 starts the same way
 * from whoever is left; everyone left after that is group 3.
 * Pure: positions in feet (token centers; size, the token's width), as the engine has them.
 */
import { NEUTRAL_REACH } from "../constants.js";

/** How many steps out from a group a neutral can be pulled in by being near someone already in it. */
const STEPS = 3;

/**
 * Squares between two creatures, edge to edge, counting diagonals as one (adjacent: 1; sharing a square: 0).
 * @param {{x, y, size}} a
 * @param {{x, y, size}} b
 */
export function squaresApart(a, b, square = 5) {
  const centers = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const gap = centers - ((a.size ?? square) + (b.size ?? square)) / 2 + square;
  return Math.max(0, gap / square);
}

/** The same kind of creature: the same stat block, the same type (as the system has it), or the same name. */
export function sameKind(a, b) {
  return (!!a.block && a.block === b.block) || (!!a.kind && a.kind === b.kind) || (!!a.name && a.name === b.name);
}

/**
 * @param {{id: string, x: number, y: number, size?: number, block?: string, kind?: string, name?: string}[]} list
 * @param {{origin?: {x, y}, reach?: number, square?: number}} [options]
 * @returns {Map<string, number>}  id -> group (1-3)
 */
export function proposeGroups(list, { origin = { x: 0, y: 0 }, reach = NEUTRAL_REACH, square = 5 } = {}) {
  const out = new Map();
  const fromCorner = n => Math.hypot(n.x - origin.x, n.y - origin.y);
  // (Ties go to the one nearer the top, then the left.)
  let left = [...list].sort((a, b) => fromCorner(a) - fromCorner(b) || a.y - b.y || a.x - b.x);
  for ( const group of [1, 2] ) {
    if ( !left.length ) break;
    const seed = left[0];
    const members = left.filter(n => n === seed || sameKind(n, seed));
    let rest = left.filter(n => !members.includes(n));
    for ( let step = 0; step < STEPS && rest.length; step++ ) {
      const near = rest.filter(n => members.some(m => squaresApart(n, m, square) <= reach + 1e-6));
      if ( !near.length ) break;
      members.push(...near);
      rest = rest.filter(n => !near.includes(n));
    }
    for ( const m of members ) out.set(m.id, group);
    left = rest;
  }
  for ( const n of left ) out.set(n.id, 3);
  return out;
}
