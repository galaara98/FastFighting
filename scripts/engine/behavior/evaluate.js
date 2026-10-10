/**
 * Expected-value helpers used by behavior decisions. The simulation itself always rolls real dice.
 */
import { meanPart, doubled } from "../dice.js";
import { degreeDistribution } from "../probability.js";
import { attackBonusMods, currentAc, rangePenalty, saveMod, bonusDamageParts, actionCost, studyBonus } from "../battle-state.js";

function meanByType(parts) {
  const out = {};
  for ( const p of parts ?? [] ) {
    if ( p.persistent ) continue;
    out[p.type] = (out[p.type] ?? 0) + Math.max(0, meanPart(p));
  }
  return out;
}

function persistentMean(parts) {
  // Persistent damage lasts ~2.5 turns on average (a DC 15 flat check ends it 30% of the time).
  return (parts ?? []).filter(p => p.persistent).reduce((s, p) => s + Math.max(0, meanPart(p)) * 2.5, 0);
}

/** Rough expected value of riders such as afflictions (their stage damage over a few rounds). */
function effectMean(action) {
  let total = 0;
  for ( const e of action.effects ?? [] ) {
    if ( e.kind === "affliction" ) total += 0.5 * (e.stages?.[0]?.damage ?? []).reduce((s, p) => s + meanPart(p), 0) * 2;
    if ( e.kind === "prone" || e.kind === "grabbed" ) total += 1.5;
  }
  return total;
}

/** Mean damage of `action` against `target` after IWR, for normal and critical outcomes. Cached per batch. */
export function meanDamageVs(run, action, target) {
  const key = `${action.id}|${target.id}`;
  const cache = run.prep.meanCache;
  let hit = cache.get(key);
  if ( hit ) return hit;
  const rules = run.prep.rules;
  const iwr = target.spec.iwr;
  const crit = action.critDamage ?? doubled(action.damage ?? []);
  const rider = effectMean(action);
  hit = {
    normal: rules.applyIwr(iwr, meanByType(action.damage)) + persistentMean(action.damage) + rider,
    critical: rules.applyIwr(iwr, meanByType(crit)) + persistentMean(crit) + rider
  };
  cache.set(key, hit);
  return hit;
}

/** Expected damage dealt by one use of `action` from a against t, given attacks already made this turn. */
export function expectedDamage(run, a, action, t, attacksMade = 0) {
  const rules = run.prep.rules;
  const dmg = meanDamageVs(run, action, t);
  const extra = bonusDamageParts(run, a, action, t).reduce((s, p) => s + Math.max(0, meanPart(p)), 0);
  const targets = action.area ? Math.max(1, action.area.targets ?? 2) : 1;
  if ( action.kind === "auto" ) return targets * (dmg.normal + extra);
  if ( action.kind === "save" && action.save ) {
    const dist = degreeDistribution(rules, saveMod(t, action.save.type), action.save.dc);
    const mult = action.save.basic === false ? [2, 1, 0, 0] : [2, 1, 0.5, 0];
    return targets * dist.reduce((s, p, d) => s + p * mult[d] * (dmg.normal + extra), 0);
  }
  const bonus = (action.bonus ?? 0) + rules.attackPenalty(action, attacksMade) + attackBonusMods(run, a, action) + studyBonus(a, t)
    + rangePenalty(run, a, t, action);
  const dist = degreeDistribution(rules, bonus, currentAc(run, t, a, action));
  return targets * (dist[2] * (dmg.normal + extra) + dist[3] * (dmg.critical + extra * 2));
}

/**
 * A unit's typical damage per round against a foe: its best single action used repeatedly. Targeting and morale
 * ask this constantly, so it is worked out once per pair per round (within a round it barely changes).
 */
export function threatOf(run, u, versus) {
  if ( run.threatRound !== run.round ) {
    run.threatRound = run.round;
    run.threatCache = new Map();
  }
  let row = run.threatCache.get(u);
  if ( !row ) run.threatCache.set(u, row = new Map());
  const cached = row.get(versus);
  if ( cached !== undefined ) return cached;
  let best = 0;
  const actions = run.prep.rules.actionsPerTurn;
  for ( const action of u.prep.offense ) {
    let total = 0;
    let made = 0;
    for ( let spent = 0; spent + action.cost <= actions; spent += action.cost ) {
      total += expectedDamage(run, u, action, versus, made);
      if ( countsAsAttack(action) ) made += 1;
      if ( Number.isFinite(action.uses) || action.resource ) break;
    }
    best = Math.max(best, total);
  }
  row.set(versus, best);
  return best;
}

export function countsAsAttack(action) {
  return action.attack !== false && (action.kind === "strike" || action.kind === "spell-attack");
}

export function hasUses(u, action) {
  if ( action.resource ) return (u.resources[action.resource] ?? 0) > 0;
  if ( Number.isFinite(action.uses) ) return (u.uses[action.id] ?? 0) > 0;
  return true;
}

export function spendUse(u, action) {
  if ( action.resource ) u.resources[action.resource] -= 1;
  else if ( Number.isFinite(action.uses) ) u.uses[action.id] -= 1;
}

export { actionCost };
