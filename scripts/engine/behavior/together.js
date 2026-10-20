/**
 * Keeping together: a creature smart enough knows that staying near its team is safer, and that standing bunched up
 * isn't (one area effect catches them all).
 *
 * Who (keepsTogether, worked out each turn: u.together): live Tactical from TOGETHER.tactical (a leader's tactical
 * floor counts) and average wits or better (aptitudes.js smart), or from TOGETHER.keen and high wits; on a map, on a
 * side (not one standing aside), and never an animal, a mindless creature or a hazard.
 *
 * Near the team (keepTogether, the apart layer: behavior/desire.js): each wish to hurt, tie up or rob someone that it
 * would have to move for (talking takes no move), where acting on it would leave it (at its reach or range from them,
 * on the line toward it) more than its Stride from every teammate on its feet, and farther from them than it is now,
 * is dampened, not dropped: TOGETHER.damp off, TOGETHER.perStride more for each Stride past the second, TOGETHER.most
 * at most. With no teammate standing, nothing.
 *
 * Not bunched up (space.js crowdCost, for one that keeps together this turn): a spot beside a teammate (edge to edge,
 * a square) costs CROWD.feet more for each, at most CROWD.most of them, unless the two flank the one it's after (a line
 * between them crosses its space). A move that would end in reach, or where it can shoot, bunched up so takes it to a
 * spot that isn't, if the move gets there just the same (battle-state.js moveToward and moveToShoot, by space.js
 * spotWithin and spotToShoot): never at the cost of the blow, and the moves a blow takes are counted as ever. Where it
 * would end a move for later weighs it too (prepare.js spotWorth), with the same reckoning of ending well away from the
 * team (apartShare).
 */
import { NEUTRAL_PARTY } from "../../constants.js";
import { liveTrait, canMove, movesNeeded, teamOf } from "../battle-state.js";
import { aptitude, APTITUDE_AT } from "../aptitudes.js";
import { isAnimalistic } from "./animal.js";
import { parseKey, levelOf } from "./desire.js";
import { hasUses } from "./evaluate.js";

/**
 * tactical, keen: the least Tactical with average wits, and with high wits. damp, perStride, most: how much a wish that
 * takes it away is dampened.
 */
export const TOGETHER = Object.freeze({ tactical: 60, keen: 40, damp: 0.25, perStride: 0.1, most: 0.45 });

const sizeOf = u => u.spec.position?.size ?? 5;
/** Feet between edges with u at p and a where it stands (space.js edgeAt's reckoning). */
const edgeFrom = (u, p, a) => Math.max(5, Math.hypot(p.x - a.pos.x, p.y - a.pos.y) - ((sizeOf(u) + sizeOf(a)) / 2 - 5));
/** Its Stride: its speed on foot (or the fastest it has), with what it's lent or lost. */
export const strideOf = u => Math.max(5, (Math.max(...Object.values(u.spec.speeds ?? { walk: 25 }).map(Number).filter(Number.isFinite), 0) || 25) + (u.mods?.speed ?? 0));

/** Does u keep together, as it is now? */
export function keepsTogether(run, u) {
  if ( !run.prep.options?.positioning || !u?.pos || u.spec.hazard || u.side === NEUTRAL_PARTY || isAnimalistic(u) ) return false;
  if ( u.spec.social?.mindless || u.spec.flags?.mindless ) return false;
  const tactical = liveTrait(run, u, "tactical");
  const smart = aptitude(u, "smart");
  return (tactical >= TOGETHER.tactical && smart >= APTITUDE_AT.average) || (tactical >= TOGETHER.keen && smart >= APTITUDE_AT.high);
}

/** How far u at p would be from its nearest teammate (`team`), edge to edge (Infinity with none). */
export function fromTeam(u, p, team) {
  let near = Infinity;
  for ( const a of team ) near = Math.min(near, edgeFrom(u, p, a));
  return near;
}

/**
 * How much less a creature keeping together wants something that would leave it `far` feet from its team (now `here`
 * feet off), striding `stride` a move: 0 within a Stride, or no farther off than it is.
 */
export function apartShare(far, here, stride) {
  if ( !(far > stride + 0.5) || far <= here + 0.5 ) return 0;
  return Math.min(TOGETHER.most, TOGETHER.damp + TOGETHER.perStride * Math.max(0, Math.ceil(far / stride) - 2));
}

/** Where acting on a wish to hurt (or tie up, or rob) t would leave u, if it must move for it: {x, y}, or null (no move). */
function actingSpot(run, u, t, kind) {
  let reach = 5;
  if ( kind === "hurt" ) {
    let best = null;
    for ( const a of u.prep.offense ?? [] ) {
      if ( !hasUses(u, a) ) continue;
      const moves = movesNeeded(run, u, t, a);
      if ( Number.isFinite(moves) && (!best || moves < best.moves) ) best = { a, moves };
    }
    if ( !best || best.moves === 0 ) return null;
    reach = best.a.range ? best.a.range.max ?? (best.a.range.increment ?? 0) * 3 : best.a.reach ?? 5;
  } else if ( edgeFrom(u, u.pos, t) <= 5.5 ) return null;
  const d = Math.hypot(u.pos.x - t.pos.x, u.pos.y - t.pos.y);
  if ( !(d > 0) ) return null;
  const k = Math.min(d, reach + (sizeOf(u) + sizeOf(t)) / 2 - 5) / d;
  return { x: t.pos.x + (u.pos.x - t.pos.x) * k, y: t.pos.y + (u.pos.y - t.pos.y) * k };
}

/** The kinds a creature keeping together thinks twice about, when they'd take it away from its team. */
const AWAY = new Set(["hurt", "bind", "rob"]);

/**
 * This turn's apart layer (and u.together): each wish that would take it well away from its team, dampened. Call after
 * the rest of its wishes are worked out (heed), before remember.
 */
export function keepTogether(run, u) {
  const d = u.desire;
  if ( !d ) return;
  d.apart ??= new Map();
  d.apart.clear();
  u.together = keepsTogether(run, u);
  if ( !u.together || !canMove(run, u) ) return;
  const team = teamOf(run, u);
  if ( !team.length ) return;
  const stride = strideOf(u);
  const here = fromTeam(u, u.pos, team);
  const seen = new Set();
  for ( const m of [d.logic, d.stated, d.taunt, d.memory, d.social, d.style, d.lean, d.focus, d.cond] ) {
    for ( const k of m?.keys() ?? [] ) {
      if ( seen.has(k) ) continue;
      seen.add(k);
      const [kind, targetId] = parseKey(k);
      if ( !AWAY.has(kind) ) continue;
      const t = run.byId.get(targetId);
      if ( !t?.pos || t === u ) continue;
      const level = levelOf(u, kind, targetId);
      const p = level > 0 ? actingSpot(run, u, t, kind) : null;
      if ( !p ) continue;
      const share = apartShare(fromTeam(u, p, team), here, stride);
      if ( share > 0 ) d.apart.set(k, -share * level);
    }
  }
}
