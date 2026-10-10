/**
 * Healing decisions: who to heal, and whether it is worth the resource.
 * PCs follow their GM-entered disposition; monsters scale with Tactical, but always consider healing they have.
 */
import { STATUS, TACTICAL, clamp } from "../../constants.js";
import { alliesOf, liveTier, liveTrait } from "../battle-state.js";
import { hasUses } from "./evaluate.js";
import { meanPart } from "../dice.js";

const THRESHOLD = { conservative: 0.3, balanced: 0.45, aggressive: 0.6, allCosts: 0.8 };

export function healAggroOf(run, u) {
  if ( u.spec.kind === "pc" || u.spec.disposition?.healAggro ) {
    return u.spec.disposition?.healAggro ?? run.prep.sides[u.side].healAggro ?? "balanced";
  }
  const tier = liveTier(run, u);
  if ( tier <= TACTICAL.FERAL ) return "conservative";
  if ( tier === TACTICAL.INSTINCTIVE ) return "conservative";
  if ( tier === TACTICAL.COMPETENT ) return "balanced";
  return "aggressive";
}

const meanHeal = action => (action.heal ?? []).reduce((s, p) => s + meanPart(p), 0);

/**
 * @returns {{action: object, target: object}|null}
 */
export function decideHeal(run, u, actionsLeft) {
  const heals = u.prep.healActions.filter(a => a.cost <= actionsLeft && hasUses(u, a));
  if ( !heals.length ) return null;

  const aggro = healAggroOf(run, u);
  const threshold = THRESHOLD[aggro] ?? 0.45;
  const selfish = liveTrait(run, u, "selfish");
  const tier = liveTier(run, u);
  const allyDying = u.spec.disposition?.allyDying ?? (selfish >= 70 ? "protectSelf" : "rescue");

  let best = null;
  let bestScore = 0;
  for ( const ally of alliesOf(run, u) ) {
    if ( ally.status === STATUS.DEAD || ally.status === STATUS.FLED ) continue;
    const isSelf = ally === u;
    if ( !isSelf && (allyDying === "protectSelf" || allyDying === "retreat") ) continue;
    if ( !isSelf && tier <= TACTICAL.FERAL ) continue; // feral healers only tend themselves
    const frac = ally.maxHp > 0 ? ally.hp / ally.maxHp : 0;
    let score = 0;
    if ( ally.status === STATUS.DOWN ) {
      score = allyDying === "rescue" ? 3 : (allyDying === "fight" ? 1.2 : 0.5);
      if ( ally.dying >= 2 ) score += 1;
    } else if ( frac < threshold ) {
      score = 1 - frac;
      if ( aggro === "conservative" && frac >= 0.25 ) score = 0;
    }
    if ( score <= 0 ) continue;
    score *= isSelf ? (1 + selfish / 50) : clamp(1 - selfish / 200, 0.2, 1);
    if ( score > bestScore ) { bestScore = score; best = ally; }
  }
  if ( !best ) return null;

  // Prefer free (unlimited) healing unless going all out or someone is dying.
  const urgent = best.status === STATUS.DOWN || aggro === "allCosts";
  const usable = heals
    .filter(a => !a.oncePerTarget || !u.healedTargets.has(`${a.id}|${best.id}`))
    .filter(a => !a.selfOnly || best === u)
    .filter(a => !a.targetTrait || best.spec.creatureTraits?.includes(a.targetTrait))
    .sort((a, b) => meanHeal(b) / b.cost - meanHeal(a) / a.cost);
  const unlimited = usable.filter(a => !a.resource && !Number.isFinite(a.uses));
  const action = urgent ? usable[0] : (unlimited[0] ?? (aggro === "conservative" ? null : usable[0]));
  if ( !action ) return null;
  return { action, target: best };
}
