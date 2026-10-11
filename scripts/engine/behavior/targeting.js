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
import { enemiesOf, isStanding, liveTier, liveTrait, movesNeeded, behaviorOf } from "../battle-state.js";
import { expectedDamage, hasUses, threatOf, costOf, costUnits, unitsPerTurn } from "./evaluate.js";
import { mainPool } from "../turn.js";
import { styleWeight } from "../tactics.js";
import { threats, isWary } from "./reactions.js";
import { think, thwart, mind, avoids, levelsFromScores } from "./desire.js";
import { willingness } from "./reluctance.js";
import { perceives, apparentHealth } from "./senses.js";

const limited = a => !!a.resource || Number.isFinite(a.uses);

/** Is the unit (or its side) in trouble, so a careful character would spend limited resources? */
function inCrisis(run, u) {
  if ( u.maxHp > 0 && u.hp / u.maxHp < 0.5 ) return true;
  return run.units.some(o => o.side === u.side && o !== u && o.status === STATUS.DOWN);
}

/**
 * Best way for u to get an offensive action onto t this turn: moves needed, the action, and its value.
 * With a `turn`, options that fit in what's left of it win over ones that don't (so a character whose favorite
 * weapon still needs drawing punches with its last action instead of standing idle), and moving costs what the
 * system says (PF2e: an action per Stride; 5e: nothing until the movement runs out).
 */
export function bestOptionVs(run, u, t, attacksMade = 0, turn = null) {
  const rules = run.prep.rules;
  const main = mainPool(rules);
  const tactics = u.tac;
  const behavior = behaviorOf(u);
  let wary = null; // worked out only if some option means walking
  const options = [];
  for ( const action of u.prep.offense ) {
    if ( !hasUses(u, action) ) continue;
    const moves = movesNeeded(run, u, t, action);
    if ( !Number.isFinite(moves) ) continue;
    const ev = expectedDamage(run, u, action, t, attacksMade);
    const cost = costOf(rules, action, u);
    const base = costUnits(rules, costOf(rules, action));
    // Drawing a weapon is a one-time cost, so spread it over the attacks it enables.
    const amortized = base + ((cost[main] ?? 0) - (costOf(rules, action)[main] ?? 0)) * 0.25;
    const moveUnits = turn ? turn.unitsForMoves(moves, run.prep.approachOf(u.id, t.id).speed) : moves;
    const perAction = ev / Math.max(0.1, amortized + moveUnits);
    // (Reluctant to spend a potion or a spell slot? Far less likely, unless the moment demands it.)
    let weighted = perAction * styleWeight(tactics, action) * willingness(run, u, action);
    // Walking off from another foe invites a free swing: the wary would rather use what reaches from here.
    if ( moves > 0 && (wary ??= !!run.prep.rules.opportunity && isWary(run, u) && threats(run, u, t).length > 0) ) weighted *= 0.3;
    if ( behavior.meleeBias && action.melee ) weighted *= 1 + behavior.meleeBias;
    if ( behavior.exploitWeakness && (action.damage ?? []).some(p => t.spec.iwr?.weak?.[p.type]) ) weighted *= 1 + behavior.exploitWeakness;
    // Spoilers would rather lock a foe down, harass it or weaken it than simply hit it.
    if ( behavior.hinders && action.kind === "control" ) weighted *= 1 + 1.5 * behavior.hinders;
    options.push({ action, moves, moveUnits, ev, perAction, cost, weighted });
  }
  if ( !options.length ) return null;

  // Feral creatures with spells don't plan: half the time they let fly with anything, otherwise whatever hurts most
  // right now, spending what they have without a thought.
  const SPELLS = ["spell-attack", "save", "auto", "control"];
  if ( liveTier(run, u) <= TACTICAL.FERAL && options.some(o => SPELLS.includes(o.action.kind)) ) {
    const affordable = turn ? options.filter(o => turn.canAfford({ ...o.cost, [main]: (o.cost[main] ?? 0) + o.moveUnits })) : options;
    const pool = affordable.length ? affordable : options;
    if ( run.rng && run.rng.chance(0.5) ) return run.rng.pick(pool);
    return pool.reduce((best, o) => (!best || o.ev > best.ev ? o : best), null);
  }

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
  if ( turn ) {
    const fits = pool.filter(o => turn.canAfford({ ...o.cost, [main]: (o.cost[main] ?? 0) + o.moveUnits }));
    if ( fits.length ) pool = fits;
  }
  // Wildcards sometimes just do something else.
  if ( behavior.random && run.rng && pool.length > 1 && run.rng.chance(behavior.random) ) return run.rng.pick(pool);
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

/** Hit points t seems to have left, to u: the truth if u can tell, else as many as it started with. */
function apparentHp(run, u, t) {
  return perceives(run, u, t) ? t.hp : t.maxHp;
}

/**
 * Someone who made u give something up mid-fight: feared (not a target) until they attack u, then the one u most
 * wants to hit.
 */
function grudge(u, f) {
  return u.grudges?.get(f.id) ?? null;
}
const feared = (u, f) => { const g = grudge(u, f); return !!g && !g.provoked; };

/** Foes u is willing to go after (not the ones it's afraid of, or set on keeping away from). */
function foesOf(run, u) {
  // (Walled off: behind a locked door it decided wasn't worth the trouble.)
  return enemiesOf(run, u).filter(f => !feared(u, f) && !avoids(run, u, f) && !u.walledOff?.has(f.id));
}

/**
 * Choose who `u` attacks this turn. Returns a unit or null.
 * Playstyles get the first word (Cruel finishes the fallen, Wildcards surprise, People-Pleasers follow the
 * group's target), then stated tactics or personality decide, then the target's own playstyle can pull
 * attention (Instigators, Martyrs) or slip it (Wallflowers, Scaredy-Cats).
 */
export function chooseTarget(run, u) {
  const behavior = behaviorOf(u);
  const rng = run.rng;
  const foes = foesOf(run, u);
  const reach = list => list.map(t => ({ t, moves: minMoves(run, u, t) })).filter(x => Number.isFinite(x.moves));
  // Whoever took from them and then attacked them is the one they want.
  for ( const f of foes ) {
    if ( grudge(u, f)?.provoked && isStanding(f) && Number.isFinite(minMoves(run, u, f)) ) return f;
  }
  if ( behavior.finishDowned && !behavior.spareDowned && !u.spec.neverKill ) {
    const downed = reach(foes.filter(f => f.status === STATUS.DOWN && !f.stable && perceives(run, u, f))).filter(x => x.moves <= 1);
    if ( downed.length && rng.chance(behavior.finishDowned) ) return rng.pick(downed).t;
  }
  const standing = reach(foes.filter(isStanding));
  if ( behavior.random && standing.length && rng.chance(behavior.random) ) return rng.pick(standing).t;
  if ( behavior.followFocus && standing.length && rng.chance(behavior.followFocus) ) {
    const focus = standing.map(x => ({ ...x, n: run.units.filter(a => a.side === u.side && a !== u && isStanding(a) && a.targetId === x.t.id).length }));
    const most = Math.max(...focus.map(x => x.n));
    if ( most > 0 ) return rng.pick(focus.filter(x => x.n === most)).t;
  }
  // The tactics score every foe in reach; their pick and the runners-up become what the character wants.
  const scored = scoreTargets(run, u, behavior);
  for ( const { id, level } of levelsFromScores(scored.map(x => ({ id: x.t.id, score: x.score }))) ) think(u, "hurt", id, level);
  // A stronger desire (stated in Tactics, or stirred by the fight) decides instead, if its target can be reached.
  const { lead } = mind(run, u);
  if ( lead?.kind === "hurt" ) {
    const wanted = run.byId.get(lead.targetId);
    if ( wanted && !u.walledOff?.has(wanted.id) && Number.isFinite(minMoves(run, u, wanted)) ) {
      if ( liveTier(run, u) >= TACTICAL.MASTERMIND ) run.sideFocus[u.side] = wanted.id;
      return wanted;
    }
    thwart(run, u, "hurt", lead.targetId, 8); // can't get at them from here
  } else if ( lead?.kind === "protect" ) {
    const ward = run.byId.get(lead.targetId);
    const threat = scored.find(x => x.t.targetId === ward?.id || x.t.adjacent.has(ward?.id));
    if ( threat ) return threat.t;
  }
  const target = scored[0]?.t ?? null;
  if ( target && liveTier(run, u) >= TACTICAL.MASTERMIND && isStanding(target) ) run.sideFocus[u.side] = target.id;
  return redirectForAttention(run, target, standing);
}

/** Targets' playstyles: some draw attacks, some avoid notice. */
function redirectForAttention(run, target, standing) {
  if ( !target || !standing.length ) return target;
  const rng = run.rng;
  const here = standing.find(x => x.t === target);
  const near = here ? here.moves + 1 : Math.min(...standing.map(x => x.moves)) + 1;
  const tb = behaviorOf(target);
  if ( tb.lowProfile && rng.chance(tb.lowProfile) ) {
    const others = standing.filter(x => x.t !== target && x.moves <= near && !behaviorOf(x.t).lowProfile);
    if ( others.length ) target = rng.pick(others).t;
  }
  for ( const x of rng.shuffle(standing.filter(y => y.t !== target && behaviorOf(y.t).drawAggro && y.moves <= near)) ) {
    if ( rng.chance(behaviorOf(x.t).drawAggro) ) return x.t;
  }
  return target;
}

/**
 * Every foe u could go for, scored by how its tactics think (best first): what it would pick, and how the
 * runners-up compare. The score's scale differs by band; only the order and the ratios matter.
 * @returns {{t, moves, score}[]}
 */
export function scoreTargets(run, u, behavior = behaviorOf(u)) {
  const tier = liveTier(run, u);
  const selfish = liveTrait(run, u, "selfish");
  const foes = foesOf(run, u);
  let candidates = foes.filter(isStanding);

  // Ruthless tacticians consider finishing downed (dying) foes when nothing else is close; Moralists never do.
  const spares = behavior.spareDowned && (behavior.spareDowned >= 1 || run.rng.chance(behavior.spareDowned));
  if ( !spares && !u.spec.neverKill && tier >= TACTICAL.TACTICAL && selfish >= 60 ) {
    const downed = foes.filter(f => f.status === STATUS.DOWN && !f.stable && perceives(run, u, f));
    candidates = candidates.concat(downed);
  }
  let reachable = candidates
    .map(t => ({ t, moves: minMoves(run, u, t) }))
    .filter(x => Number.isFinite(x.moves));
  if ( !reachable.length ) return [];
  // Engaged with a foe who'd strike as it walks off, a wary fighter keeps to the foes it can hit from where it stands.
  if ( run.prep.rules.opportunity && reachable.some(x => x.moves === 0) && isWary(run, u) && threats(run, u).length ) reachable = reachable.filter(x => x.moves === 0);
  // Ties go any way.
  reachable = run.rng.shuffle([...reachable]);
  const min = Math.min(...reachable.map(x => x.moves));
  const near = x => 1 / (1 + x.moves - min); // 1 for the nearest
  // A friend who's been charmed or dominated is still a friend: anyone with a thought for it would rather not cut it
  // down (the loyal least of all).
  const spare = t => (t.controlledBy && t.homeSide === u.side && tier >= TACTICAL.INSTINCTIVE ? Math.max(0.1, 0.5 - liveTrait(run, u, "loyal") / 250) : 1);
  const ranked = score => reachable.map(x => ({ ...x, score: Math.max(0, score(x)) * spare(x.t) })).sort((a, b) => b.score - a.score);

  // A player's stated target priority overrides the personality-driven choice.
  const choice = u.tac?.target;
  if ( choice ) {
    const standing = reachable.filter(x => isStanding(x.t));
    const pool = new Set(standing.length ? standing : reachable);
    const poolMin = Math.min(...[...pool].map(x => x.moves));
    const close = x => pool.has(x) && x.moves <= poolMin + 1;
    switch ( choice ) {
      case "nearest": return ranked(near);
      case "weakest": return ranked(x => (close(x) ? 2 - apparentHealth(run, u, x.t) - apparentHp(run, u, x.t) / 10000 : 0.1 * near(x)));
      // Danger is weighed against the turns it takes to get there and bring the foe down.
      case "dangerous": return ranked(x => (pool.has(x) ? valueOfKill(run, u, x) : 0));
      case "casters": return ranked(x => (pool.has(x) ? valueOfKill(run, u, x) * ((x.t.prep.isCaster || x.t.prep.isHealer) ? 2.5 : 1) : 0));
      case "protect": {
        // Whoever is attacking my allies (not me), nearest first.
        const attacking = x => {
          const victim = x.t.targetId && run.byId.get(x.t.targetId);
          return pool.has(x) && victim && victim !== u && victim.side === u.side;
        };
        return ranked(x => (attacking(x) ? 2 + near(x) : near(x)));
      }
    }
  }

  switch ( tier ) {
    // Feral: whoever just hurt it, if it's close; otherwise whatever is nearest.
    case TACTICAL.FERAL: return ranked(x => (x.t.id === u.lastAttackerId && x.moves <= 1 ? 2 : 0) + near(x));
    // Instinctive: close prey, the weakest first; pack hunters pile onto whoever the pack already has.
    case TACTICAL.INSTINCTIVE: {
      const close = x => x.moves <= min + 1 && isStanding(x.t);
      const ganged = x => [...x.t.adjacent].filter(id => run.byId.get(id)?.side === u.side).length;
      const pack = u.spec.flags?.packTactics && reachable.some(x => close(x) && ganged(x) > 0);
      if ( pack ) return ranked(x => (close(x) ? 1 + ganged(x) : 0.2 * near(x)));
      return ranked(x => (close(x) ? 1 + (1 - apparentHealth(run, u, x.t)) : 0.2 * near(x)));
    }
    // Competent: sticks with its foe; otherwise the quickest kill.
    case TACTICAL.COMPETENT: return ranked(x => (x.t.id === u.targetId && isStanding(x.t) ? 10 : 1 / (1 + Math.max(0, -quickestKill(run, u, x)))));
    // Tactical and up: the threat removed per turn invested; masterminds keep the side on one focus.
    default: {
      const focusId = tier >= TACTICAL.MASTERMIND ? run.sideFocus[u.side] : null;
      return ranked(x => (x.t.id === focusId && isStanding(x.t) && x.moves <= 2 ? 1e6 : valueOfKill(run, u, x)));
    }
  }
}

/** Higher is better: fewer turns to drop the target including travel. */
/** Damage per round of an option, and how many moves fit in a round, by the system's turn. */
function pace(run, u, option) {
  const rules = run.prep.rules;
  const perTurn = unitsPerTurn(rules, u);
  const units = option ? Math.max(1e-9, costUnits(rules, costOf(rules, option.action))) : 1;
  const dpr = Math.max(0.1, (option?.ev ?? 0) * Math.max(1, Math.floor(perTurn / units)));
  // PF2e: every action can be a Stride; 5e: a move and a Dash.
  const movesPerTurn = rules.movement === "feet" ? 2 : perTurn;
  return { dpr, movesPerTurn };
}

function quickestKill(run, u, { t, moves }) {
  if ( t.status === STATUS.DOWN ) return -moves; // finishing blow is trivial if worthwhile
  const { dpr, movesPerTurn } = pace(run, u, bestOptionVs(run, u, t));
  return -(apparentHp(run, u, t) / dpr + moves / movesPerTurn);
}

/** Threat removed per turn invested: prioritises dangerous, fragile, healing or casting foes. */
function valueOfKill(run, u, x) {
  const { t, moves } = x;
  if ( t.status === STATUS.DOWN ) return 0.5 * (t.spec.kind === "pc" ? 3 : 1) / (1 + moves);
  const { dpr, movesPerTurn } = pace(run, u, bestOptionVs(run, u, t));
  const turns = apparentHp(run, u, t) / dpr + moves / movesPerTurn;
  let threat = threatOf(run, t, u) + 1;
  if ( t.prep.isHealer ) threat *= 1.5;
  if ( t.prep.isCaster ) threat *= 1.25;
  return threat / Math.max(0.25, turns);
}
