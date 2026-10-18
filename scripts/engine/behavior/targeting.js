/**
 * Target selection driven by the Tactical trait band.
 *
 *   Feral        nearest foe, or whoever hurt it last (hunts to live, fights what's in front of it)
 *   Instinctive  nearest; prefers wounded prey; pack hunters gang up on one victim
 *   Competent    focus fire: sticks with a target and picks the quickest kill, flanks
 *   Tactical     weighs threat: healers and casters first, quickest valuable kill
 *   Mastermind   side-wide focus target; ruthless ones finish off the downed
 */
import { STATUS, TACTICAL, NEUTRAL_PARTY } from "../../constants.js";
import { enemiesOf, isStanding, liveTier, liveTrait, movesNeeded, behaviorOf, heldOff, holdsBackThisRound, regenOf, edgeDistance } from "../battle-state.js";
import { isAnimalistic } from "./animal.js";
import { hasTrait } from "../conditions.js";
import { expectedDamage, hasUses, limited, threatOf, costOf, costUnits, unitsPerTurn } from "./evaluate.js";
import { mainPool, unitsPerUse } from "../turn.js";
import { needsDraw } from "../gear.js";
import { styleWeight } from "../tactics.js";
import { threats, isWary } from "./reactions.js";
import { think, thwart, mind, avoids, levelsFromScores } from "./desire.js";
import { seemsFoe, sparedForTruce } from "./neutral.js";
import { willingness } from "./reluctance.js";
import { specialtyWeight } from "./specialty.js";
import { perceives, apparentHealth, knowsOf } from "./senses.js";
import { auraToll } from "./auras.js";
import { meets, followUpWorth } from "./requires.js";


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
    if ( action.oncePerTurn && u.usedThisTurn?.has(action.id) ) continue; // (PF2e Flurry of Blows)
    if ( run.prep.rules.usable && !run.prep.rules.usable(run, u, action, t) ) continue; // (Ironsworn: Strike needs the initiative)
    if ( !meets(run, u, action, t) ) continue; // (what it needs first: a grab, a hit, two hits on this foe: requires.js)
    const moves = movesNeeded(run, u, t, action);
    if ( !Number.isFinite(moves) ) continue;
    // (And what it would set up: a claw that makes a Rend possible is worth more than its own damage.)
    const ev = expectedDamage(run, u, action, t, attacksMade) + followUpWorth(run, u, action, t, attacksMade, turn);
    const cost = costOf(rules, action, u);
    // Drawing a weapon is a one-time cost, so spread it over the attacks it enables; every shot's Reload is its own
    // (engine/gear.js: a heavy crossbow's shot is three actions, loaded now or not).
    const amortized = unitsPerUse(rules, action) + (needsDraw(u, action) ? Number(action.drawCost) : 0) * 0.25;
    const moveUnits = turn ? turn.unitsForMoves(moves, run.prep.approachOf(u.id, t.id).speed) : moves;
    const perAction = ev / Math.max(0.1, amortized + moveUnits);
    // (Reluctant to spend a potion or a spell slot? Far less likely, unless the moment demands it.)
    let weighted = perAction * styleWeight(tactics, action) * willingness(run, u, action);
    // Walking off from another foe invites a free swing: the wary would rather use what reaches from here.
    if ( moves > 0 && (wary ??= !!run.prep.rules.opportunity && isWary(run, u) && threats(run, u, t).length > 0) ) weighted *= 0.3;
    // Walking into a foe's aura to get there: what the aura would cost it, weighed against the blow (auras.js).
    if ( moves > 0 && run.foeAuras ) weighted *= auraToll(run, u, t, action, ev);
    if ( behavior.meleeBias && action.melee ) weighted *= 1 + behavior.meleeBias;
    // A kiter would rather strike from beyond its foe's own reach (a reach weapon), where it can't answer.
    if ( behavior.kite && action.melee && (action.reach ?? 5) > foeReach(t) ) weighted *= 1 + 0.3 * behavior.kite;
    if ( behavior.exploitWeakness && (action.damage ?? []).some(p => t.spec.iwr?.weak?.[p.type] || t.spec.iwr?.exploit?.[p.type]) ) weighted *= 1 + behavior.exploitWeakness;
    // A foe down and regenerating: only what stops it (fire, acid) does any good.
    if ( t.held && t.status === STATUS.DOWN ) weighted *= (action.damage ?? []).some(p => regenOf(t)?.stoppedBy?.includes(p.type)) ? 3 : 0.05;
    // Spoilers would rather lock a foe down, harass it or weaken it than simply hit it.
    if ( behavior.hinders && action.kind === "control" ) weighted *= 1 + 1.5 * behavior.hinders;
    // Magic and its own specialties, as strongly as its answer says (an Un-Mundane character's lean).
    weighted *= specialtyWeight(u, action);
    // The system's own lean (DCC: one in a hurry would rather charge in).
    if ( rules.optionWeight ) weighted *= rules.optionWeight(run, u, action, t, moves) ?? 1;
    options.push({ action, moves, moveUnits, ev, perAction, cost, weighted });
  }
  if ( !options.length ) return null;

  // Feral creatures with spells don't plan: half the time they let fly with anything, otherwise whatever hurts most
  // right now, spending what they have without a thought.
  const SPELLS = ["spell-attack", "save", "auto", "control"];
  if ( liveTier(run, u) <= TACTICAL.FERAL && options.some(o => SPELLS.includes(o.action.kind)) ) {
    const affordable = turn ? options.filter(o => turn.canAfford({ ...o.cost, [main]: (o.cost[main] ?? 0) + o.moveUnits })) : options;
    // (Anything that does something, that is: not a Demoralize the foe has already shrugged off, worth nothing now.)
    const able = affordable.length ? affordable : options;
    const pool = able.some(o => o.ev > 0) ? able.filter(o => o.ev > 0) : able;
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

/** The longest reach of t's own melee strikes (5 feet if it has none). */
function foeReach(t) {
  let reach = 5;
  for ( const a of t.prep?.offense ?? [] ) if ( a.melee && hasUses(t, a) ) reach = Math.max(reach, a.reach ?? 5);
  return reach;
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
/** Charmed by f (a charm it caused): u won't attack it. */
const charmedBy = (u, f) => (u.effects ?? []).some(e => (e.conditions?.charmed ?? 0) > 0 && e.sourceId === f.id);

/**
 * Foes u is willing to go after (not the ones it's afraid of, or set on keeping away from, or charmed by), and anyone taking no side
 * that it takes for a foe. A smart one holds off those a talk its side is having would be ruined by hurting. While a
 * standoff holds, only a quarrel with someone taking no side is fought.
 */
function foesOf(run, u) {
  const foes = run.neutral ? [...enemiesOf(run, u), ...run.units.filter(n => seemsFoe(run, u, n))] : enemiesOf(run, u);
  const spared = sparedForTruce(run, u);
  // (A system may say who can be pressed right now: Ironsworn, not a foe who has the initiative over it.)
  const can = run.prep.rules.canTarget;
  // (Walled off: behind a locked door it decided wasn't worth the trouble. Unknown: out of its senses, never seen and
  // never come to blows with: senses.js knowsOf.)
  return foes.filter(f => !feared(u, f) && !avoids(run, u, f) && !charmedBy(u, f) && !hasTrait(f, "untouchable") && !u.walledOff?.has(f.id) && !spared?.has(f.id) && !heldOff(run, u, f) && (!can || can(run, u, f)) && knowsOf(run, u, f));
}

/**
 * Choose who `u` attacks this turn. Returns a unit or null.
 * Playstyles get the first word (Cruel finishes the fallen, Wildcards surprise, People-Pleasers follow the
 * group's target), then stated tactics or personality decide, then the target's own playstyle can pull
 * attention (Instigators, Martyrs) or slip it (Wallflowers, Chickens).
 */
export function chooseTarget(run, u) {
  const t = pickTarget(run, u);
  // (Whatever its desires say, the system may rule someone out right now: Ironsworn, a foe with the initiative.)
  const can = run.prep.rules.canTarget;
  return t && can && !can(run, u, t) ? null : t;
}

function pickTarget(run, u) {
  const behavior = behaviorOf(u);
  const rng = run.rng;
  const foes = foesOf(run, u);
  const reach = list => list.map(t => ({ t, moves: minMoves(run, u, t) })).filter(x => Number.isFinite(x.moves));
  // Whoever took from them and then attacked them is the one they want.
  for ( const f of foes ) {
    if ( grudge(u, f)?.provoked && isStanding(f) && Number.isFinite(minMoves(run, u, f)) ) return f;
  }
  if ( behavior.finishDowned && !behavior.spareDowned && !holdsBackThisRound(run, u) ) {
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
  const scored = scoreTargets(run, u, behavior, foes);
  for ( const { id, level } of levelsFromScores(scored.map(x => ({ id: x.t.id, score: x.score }))) ) think(u, "hurt", id, level);
  // A stronger desire (stated in Tactics, or stirred by the fight) decides instead, if its target can be reached; one of
  // its own reckoning gives way to an opening only another foe allows.
  const { lead, blinding } = mind(run, u);
  if ( lead?.kind === "hurt" ) {
    const wanted = run.byId.get(lead.targetId);
    if ( wanted && !u.walledOff?.has(wanted.id) && !sparedForTruce(run, u)?.has(wanted.id) && !heldOff(run, u, wanted) && Number.isFinite(minMoves(run, u, wanted)) ) {
      const pick = blinding ? wanted : opening(run, u, wanted, standing);
      if ( liveTier(run, u) >= TACTICAL.MASTERMIND ) run.sideFocus[u.side] = pick.id;
      return pick;
    }
    thwart(run, u, "hurt", lead.targetId, 8); // can't get at them from here
  } else if ( lead?.kind === "protect" ) {
    const ward = run.byId.get(lead.targetId);
    const threat = scored.find(x => x.t.targetId === ward?.id || x.t.adjacent.has(ward?.id));
    if ( threat ) return threat.t;
  }
  const target = opening(run, u, scored[0]?.t ?? null, standing);
  if ( target && liveTier(run, u) >= TACTICAL.MASTERMIND && isStanding(target) ) run.sideFocus[u.side] = target.id;
  return redirectForAttention(run, target, standing);
}

/** How much better than its best against the foe it picked an opening only another foe allows has to be, to take it. */
const OPENING = 1.25;

/**
 * An option only some foes allow (the system's usable says no to the rest: 2014's behir swallows only the one it's
 * grappling; or what it needs first holds only for them: the one it has grabbed, the one it hit twice, requires.js):
 * what it would do to each foe that allows it, against u's best at the one it picked; clearly better (OPENING), that
 * foe instead. Only where some option is ruled out against the one it picked.
 */
function opening(run, u, target, standing) {
  const rules = run.prep.rules;
  if ( !target ) return target;
  const allows = (a, t) => (!rules.usable || rules.usable(run, u, a, t)) && meets(run, u, a, t);
  const picky = u.prep.offense.filter(a => hasUses(u, a) && !allows(a, target));
  if ( !picky.length ) return target;
  let here = null;
  let best = null;
  for ( const { t } of standing ) {
    if ( t === target || !picky.some(a => allows(a, t)) ) continue;
    const o = bestOptionVs(run, u, t);
    if ( !o || !picky.includes(o.action) ) continue;
    here ??= bestOptionVs(run, u, target)?.weighted ?? 0;
    if ( o.weighted > here * OPENING && (!best || o.weighted > best.weighted) ) best = { t, weighted: o.weighted };
  }
  return best?.t ?? target;
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
 * runners-up compare. The score's scale differs by band; only the order and the ratios matter. `known`: its foes
 * (foesOf), where the caller has just worked them out.
 * @returns {{t, moves, score}[]}
 */
export function scoreTargets(run, u, behavior = behaviorOf(u), known = null) {
  const tier = liveTier(run, u);
  const selfish = liveTrait(run, u, "selfish");
  const foes = known ?? foesOf(run, u);
  let candidates = foes.filter(isStanding);

  // Ruthless tacticians consider finishing downed (dying) foes when nothing else is close; Moralists never do.
  const spares = behavior.spareDowned && (behavior.spareDowned >= 1 || run.rng.chance(behavior.spareDowned));
  if ( !spares && !holdsBackThisRound(run, u) && tier >= TACTICAL.TACTICAL && selfish >= 60 ) {
    const downed = foes.filter(f => f.status === STATUS.DOWN && !f.stable && perceives(run, u, f));
    candidates = candidates.concat(downed);
  }
  // A foe down but regenerating gets back up: anyone with what stops it (fire, acid) finishes it.
  if ( !holdsBackThisRound(run, u) && tier >= TACTICAL.INSTINCTIVE ) {
    const mending = foes.filter(f => f.held && f.status === STATUS.DOWN && !candidates.includes(f) && canStop(u, f) && perceives(run, u, f));
    candidates = candidates.concat(mending);
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
  // Someone taking no side that only seems a foe is less of a priority than the foes who are fighting.
  // (To an animal, prey is prey: a bystander is no less of it.)
  const animal = isAnimalistic(u);
  const spare = t => (t.controlledBy && t.homeSide === u.side && tier >= TACTICAL.INSTINCTIVE ? Math.max(0.1, 0.5 - liveTrait(run, u, "loyal") / 250) : 1)
    * (t.side === NEUTRAL_PARTY && !animal ? 0.6 : 1);
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

  // An animal, as a predator picks its prey (behavior/animal.js): what just hurt it, if it's close; else the nearest, the
  // more so the hurt, the small and the lone, and (a pack hunter) the one its pack is already on.
  if ( animal ) {
    const size = t => Number(t.spec.size ?? 2);
    const lone = t => !run.units.some(a => a !== t && isStanding(a) && a.side === t.side && t.side !== NEUTRAL_PARTY && a.pos && t.pos && (edgeDistance(a, t) ?? Infinity) <= 10);
    const ganged = t => [...t.adjacent].filter(id => run.byId.get(id)?.side === u.side).length;
    return ranked(x => {
      if ( x.t.id === u.lastAttackerId && x.moves <= 1 ) return 10;
      let s = near(x) * (1 + 0.6 * (1 - apparentHealth(run, u, x.t)));
      s *= size(x.t) < size(u) ? 1.2 : size(x.t) > size(u) ? 0.8 : 1;
      if ( lone(x.t) ) s *= 1.3;
      if ( u.spec.flags?.packTactics ) s *= 1 + 0.5 * ganged(x.t);
      return s;
    });
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

/** Has u something that stops f's regeneration (a fire or acid attack for a troll)? */
function canStop(u, f) {
  const stoppers = regenOf(f)?.stoppedBy ?? [];
  return u.prep.offense.some(a => (a.damage ?? []).some(p => stoppers.includes(p.type)));
}

/** Higher is better: fewer turns to drop the target including travel. */
/** Damage per round of an option, and how many moves fit in a round, by the system's turn. */
function pace(run, u, option) {
  const rules = run.prep.rules;
  const perTurn = unitsPerTurn(rules, u);
  const units = option ? Math.max(1e-9, unitsPerUse(rules, option.action)) : 1;
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
