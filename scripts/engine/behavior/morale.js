/**
 * Morale: stress from losses, wounds, a fallen leader or master, and bad odds, resisted by Brave.
 * Outcomes: hold, waver (-1 to attacks), or rout (leave the battle).
 */
import { STATUS, TACTICAL, STAND_GROUND, clamp } from "../../constants.js";
import { alliesOf, enemiesOf, isStanding, liveTier, liveTrait } from "../battle-state.js";
import { threatOf } from "./evaluate.js";

export const MORALE = Object.freeze({ HOLD: "hold", WAVER: "waver", ROUT: "rout" });

/**
 * Wanting to run, does u stay anyway? Only someone who doesn't like to flee (Tactics: "I don't like to flee"), and
 * only when running is its own choice (fear, a lost cause, a stated retreat): what a spell or a rule makes it do
 * (frightened, fleeing, turned) plays out as the system says. It stays the "standGround" percent of the time.
 */
export function standsGround(run, u) {
  if ( !u.spec.avoidFleeing ) return false;
  return run.rng.chance(clamp(run.prep?.options.standGround ?? STAND_GROUND, 0, 100) / 100);
}

/**
 * How shaken u is. With a floor (the stress it must reach for a new morale check), the costly reckoning of the odds is
 * skipped when even the worst odds couldn't bring it there.
 */
export function moraleStress(run, u, floor = -Infinity) {
  const allies = alliesOf(run, u).filter(a => a !== u);
  const lost = allies.filter(a => a.status !== STATUS.STANDING).length;
  const lostFrac = allies.length ? lost / allies.length : 0;
  const hpFrac = u.maxHp > 0 ? u.hp / u.maxHp : 0;
  let stress = 40 * lostFrac;
  if ( hpFrac < 0.25 ) stress += 45;
  else if ( hpFrac < 0.5 ) stress += 25;

  const side = run.prep.sides[u.side];
  if ( side.leaderId && side.leaderId !== u.id ) {
    const leader = run.byId.get(side.leaderId);
    if ( leader && !isStanding(leader) ) stress += 25;
  }
  const masterId = u.spec.flags?.masterId;
  if ( masterId ) {
    const master = run.byId.get(masterId);
    if ( master && !isStanding(master) ) stress += (100 - liveTrait(run, u, "loyal")) * 0.6;
    else stress -= liveTrait(run, u, "loyal") * 0.2;
  }

  // Someone who made them pay and is still standing, unanswered, weighs on them.
  for ( const [id, g] of u.grudges ?? [] ) {
    if ( !g.provoked && isStanding(run.byId.get(id) ?? {}) ) stress += 15;
  }
  // Selfish creatures care less about the group, more about themselves.
  const factor = 0.8 + liveTrait(run, u, "selfish") / 250;

  // Tactical creatures read the odds and retreat from lost causes; others only feel losses and wounds.
  if ( liveTier(run, u) >= TACTICAL.TACTICAL && (stress + ODDS) * factor >= floor ) {
    const foes = enemiesOf(run, u).filter(isStanding);
    const friends = alliesOf(run, u).filter(isStanding);
    const foeThreat = foes.reduce((s, f) => s + threatOf(run, f, u), 0);
    const friendThreat = friends.reduce((s, f) => s + (foes[0] ? threatOf(run, f, foes[0]) : 0), 0);
    if ( friendThreat > 0 ) stress += clamp(25 * (foeThreat / friendThreat - 1), 0, ODDS);
  }
  return Math.max(0, stress * factor);
}

/** The most that bad odds add to a tactical creature's stress. */
const ODDS = 40;

/** Roll morale at the start of u's turn when its stress has risen meaningfully. */
export function checkMorale(run, u) {
  const side = run.prep.sides[u.side];
  // A player's stated retreat rule replaces the bravery roll.
  const retreat = u.tac?.retreat;
  if ( retreat ) {
    if ( retreat === "never" ) return MORALE.HOLD;
    // (Badly hurt: under a quarter, unless the system says otherwise; Ironsworn heroes fight on until 0 health.)
    if ( retreat === "hurt" ) return (u.maxHp > 0 && u.hp / u.maxHp < (run.prep.rules.retreatAt ?? 0.25)) ? MORALE.ROUT : MORALE.HOLD;
    if ( retreat === "losing" ) {
      const friends = alliesOf(run, u).filter(isStanding).length;
      const foes = enemiesOf(run, u).filter(isStanding).length;
      const fallen = alliesOf(run, u).filter(a => a.status !== STATUS.STANDING).length;
      return (fallen >= Math.ceil(alliesOf(run, u).length / 2) && foes > friends) ? MORALE.ROUT : MORALE.HOLD;
    }
  }
  if ( !side.morale ) return MORALE.HOLD;
  const brave = liveTrait(run, u, "brave");
  if ( u.spec.flags?.fearless || brave >= 95 ) return MORALE.HOLD;
  const stress = moraleStress(run, u, u.moraleStress + 10);
  if ( stress < u.moraleStress + 10 ) return u.wavering ? MORALE.WAVER : MORALE.HOLD;
  u.moraleStress = stress;
  const resolve = brave * 0.75;
  if ( stress <= resolve ) return u.wavering ? MORALE.WAVER : MORALE.HOLD;
  const p = clamp((stress - resolve) / 80, 0, 0.85);
  if ( !run.rng.chance(p) ) return u.wavering ? MORALE.WAVER : MORALE.HOLD;
  return stress > brave ? MORALE.ROUT : MORALE.WAVER;
}
