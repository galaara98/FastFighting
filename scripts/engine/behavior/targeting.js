/**
 * Target selection driven by the Tactical trait band.
 *
 *   Feral        nearest foe, or whoever hurt it last (hunts to live, fights what's in front of it)
 *   Instinctive  nearest; prefers wounded prey; pack hunters gang up on one victim
 *   Competent    focus fire: sticks with a target and picks the quickest kill, flanks
 *   Tactical     weighs threat: healers and casters first, quickest valuable kill
 *   Mastermind   side-wide focus target; ruthless ones finish off the downed
 */
import { STATUS, TACTICAL } from "../../constants.js";
import { enemiesOf, isStanding, liveTier, liveTrait, movesNeeded } from "../battle-state.js";
import { expectedDamage, hasUses, threatOf, actionCost } from "./evaluate.js";
import { styleWeight } from "../tactics.js";

const limited = a => !!a.resource || Number.isFinite(a.uses);

/** Is the unit (or its side) in trouble, so a careful character would spend limited resources? */
function inCrisis(run, u) {
  if ( u.maxHp > 0 && u.hp / u.maxHp < 0.5 ) return true;
  return run.units.some(o => o.side === u.side && o !== u && o.status === STATUS.DOWN);
}

/**
 * Best way for u to get an offensive action onto t this turn: moves needed, the action, and its value.
 * With `actionsLeft`, options that fit in the remaining actions win over ones that don't (so a character
 * whose favorite weapon still needs drawing punches with its last action instead of standing idle).
 */
export function bestOptionVs(run, u, t, attacksMade = 0, actionsLeft = Infinity) {
  const tactics = u.spec.tactics ?? null;
  const options = [];
  for ( const action of u.prep.offense ) {
    if ( !hasUses(u, action) ) continue;
    const moves = movesNeeded(run, u, t, action);
    if ( !Number.isFinite(moves) ) continue;
    const ev = expectedDamage(run, u, action, t, attacksMade);
    const cost = actionCost(u, action);
    // Drawing a weapon is a one-time cost, so spread it over the attacks it enables.
    const amortized = action.cost + (cost - action.cost) * 0.25;
    const perAction = ev / (amortized + moves);
    options.push({ action, moves, ev, perAction, cost, weighted: perAction * styleWeight(tactics, action) });
  }
  if ( !options.length ) return null;

  let pool = options;
  if ( tactics ) {
    // Ranged fighters don't wade in while they still have a shot.
    if ( tactics.style === "ranged" && pool.some(o => o.action.range && o.moves === 0) ) {
      pool = pool.filter(o => !(o.action.melee && o.moves > 0));
    }
    // Resource discipline for limited options (spell slots, focus, consumables, per-battle uses).
    const bestFree = Math.max(0, ...pool.filter(o => !limited(o.action)).map(o => o.perAction));
    const crisis = inCrisis(run, u);
    const gate = { conserve: crisis ? 1.15 : 1.6, balanced: 1.05, nova: 0 }[tactics.resourceUse] ?? 1.05;
    const gated = pool.filter(o => !limited(o.action) || bestFree === 0 || o.perAction >= bestFree * gate);
    if ( gated.length ) pool = gated;
  }
  const fits = pool.filter(o => o.moves + o.cost <= actionsLeft);
  if ( fits.length ) pool = fits;
  let best = null;
  for ( const o of pool ) if ( !best || o.weighted > best.weighted ) best = o;
  return best;
}

function minMoves(run, u, t) {
  let min = Infinity;
  for ( const action of u.prep.offense ) {
    if ( !hasUses(u, action) ) continue;
    min = Math.min(min, movesNeeded(run, u, t, action));
  }
  return min;
}

function hpFraction(t) {
  return t.maxHp > 0 ? t.hp / t.maxHp : 0;
}

/**
 * Choose who `u` attacks this turn. Returns a unit or null.
 */
export function chooseTarget(run, u) {
  const tier = liveTier(run, u);
  const selfish = liveTrait(run, u, "selfish");
  const foes = enemiesOf(run, u);
  let candidates = foes.filter(isStanding);

  // Ruthless tacticians consider finishing downed (dying) foes when nothing else is close.
  if ( tier >= TACTICAL.TACTICAL && selfish >= 60 ) {
    const downed = foes.filter(f => f.status === STATUS.DOWN && !f.stable);
    candidates = candidates.concat(downed);
  }
  const reachable = candidates
    .map(t => ({ t, moves: minMoves(run, u, t) }))
    .filter(x => Number.isFinite(x.moves));
  if ( !reachable.length ) return null;
  const rng = run.rng;
  const nearest = () => {
    const min = Math.min(...reachable.map(x => x.moves));
    return rng.pick(reachable.filter(x => x.moves === min)).t;
  };

  // A player's stated target priority overrides the personality-driven choice.
  const choice = u.spec.tactics?.target;
  if ( choice ) {
    const standing = reachable.filter(x => isStanding(x.t));
    const pool = standing.length ? standing : reachable;
    const near = Math.min(...pool.map(x => x.moves));
    const close = pool.filter(x => x.moves <= near + 1);
    switch ( choice ) {
      case "nearest": return nearest();
      case "weakest": return [...close].sort((a, b) => hpFraction(a.t) - hpFraction(b.t) || a.t.hp - b.t.hp)[0].t;
      // Danger is weighed against the turns it takes to get there and bring the foe down.
      case "dangerous": return pickBy(run, u, pool, x => valueOfKill(run, u, x));
      case "casters": return pickBy(run, u, pool, x => valueOfKill(run, u, x) * ((x.t.prep.isCaster || x.t.prep.isHealer) ? 2.5 : 1));
      case "protect": {
        // Whoever is attacking my allies (not me), nearest first.
        const threats = pool.filter(x => {
          const victim = x.t.targetId && run.byId.get(x.t.targetId);
          return victim && victim !== u && victim.side === u.side;
        });
        if ( threats.length ) return pickBy(run, u, threats, x => -x.moves);
        return nearest();
      }
    }
  }

  switch ( tier ) {
    case TACTICAL.FERAL: {
      const last = reachable.find(x => x.t.id === u.lastAttackerId && x.moves <= 1);
      return last ? last.t : nearest();
    }
    case TACTICAL.INSTINCTIVE: {
      const min = Math.min(...reachable.map(x => x.moves));
      const close = reachable.filter(x => x.moves <= min + 1 && isStanding(x.t));
      if ( u.spec.flags?.packTactics ) {
        const ganged = close.map(x => ({ ...x, n: [...x.t.adjacent].filter(id => run.byId.get(id)?.side === u.side).length }));
        const most = Math.max(...ganged.map(x => x.n));
        if ( most > 0 ) return rng.pick(ganged.filter(x => x.n === most)).t;
      }
      if ( !close.length ) return nearest();
      close.sort((a, b) => hpFraction(a.t) - hpFraction(b.t));
      return close[0].t;
    }
    case TACTICAL.COMPETENT: {
      const current = reachable.find(x => x.t.id === u.targetId && isStanding(x.t));
      if ( current ) return current.t;
      return pickBy(run, u, reachable, x => quickestKill(run, u, x));
    }
    default: {
      if ( tier >= TACTICAL.MASTERMIND ) {
        const focus = run.sideFocus[u.side] && run.byId.get(run.sideFocus[u.side]);
        const focusEntry = focus && reachable.find(x => x.t === focus && isStanding(x.t));
        if ( focusEntry && focusEntry.moves <= 2 ) return focus;
      }
      const choice = pickBy(run, u, reachable, x => valueOfKill(run, u, x));
      if ( tier >= TACTICAL.MASTERMIND && choice && isStanding(choice) ) run.sideFocus[u.side] = choice.id;
      return choice;
    }
  }
}

function pickBy(run, u, reachable, score) {
  let best = null;
  let bestScore = -Infinity;
  for ( const x of reachable ) {
    const s = score(x);
    if ( s > bestScore ) { bestScore = s; best = x.t; }
  }
  return best;
}

/** Higher is better: fewer turns to drop the target including travel. */
function quickestKill(run, u, { t, moves }) {
  if ( t.status === STATUS.DOWN ) return -moves; // finishing blow is trivial if worthwhile
  const option = bestOptionVs(run, u, t);
  const dpr = Math.max(0.1, (option?.ev ?? 0) * Math.max(1, Math.floor(run.prep.rules.actionsPerTurn / (option?.action.cost ?? 1))));
  return -(t.hp / dpr + moves / run.prep.rules.actionsPerTurn);
}

/** Threat removed per turn invested: prioritises dangerous, fragile, healing or casting foes. */
function valueOfKill(run, u, x) {
  const { t, moves } = x;
  if ( t.status === STATUS.DOWN ) return 0.5 * (t.spec.kind === "pc" ? 3 : 1) / (1 + moves);
  const option = bestOptionVs(run, u, t);
  const dpr = Math.max(0.1, (option?.ev ?? 0) * Math.max(1, Math.floor(run.prep.rules.actionsPerTurn / (option?.action.cost ?? 1))));
  const turns = t.hp / dpr + moves / run.prep.rules.actionsPerTurn;
  let threat = threatOf(run, t, u) + 1;
  if ( t.prep.isHealer ) threat *= 1.5;
  if ( t.prep.isCaster ) threat *= 1.25;
  return threat / Math.max(0.25, turns);
}
