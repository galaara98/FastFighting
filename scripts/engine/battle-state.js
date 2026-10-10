/**
 * Battle preparation (once per batch) and per-run mutable state.
 *
 * @typedef {object} CombatantSpec
 * @property {string} id
 * @property {string} name
 * @property {string} side
 * @property {string} kind                  "pc" | "npc" | "companion" | "summon" | "minion" | "hazard"
 * @property {number} level
 * @property {{value: number, max: number, temp?: number}} hp
 * @property {{ac: number, fortitude?: number, reflex?: number, will?: number}} defenses
 * @property {{ac: number}|null} [shield]   Shield bonus available via Raise a Shield
 * @property {{mod: number, stealth?: number}} initiative
 * @property {Record<string, number>} speeds  walk / fly / swim / climb / burrow in feet
 * @property {ActionSpec[]} actions
 * @property {{immune?: string[], weak?: Record<string,number>, resist?: Record<string,number>}} iwr
 * @property {Record<string, number>} [resources]  Pools such as "focus", "slot:3", "item:<id>"
 * @property {Record<string, {base:number, fudge:number}>} traits
 * @property {object} [flags]               packTactics, fearless, mindless, masterId, flying
 * @property {object} [disposition]         {healAggro, allyDying, selfRevived}
 * @property {boolean} [diesAtZero]         NPCs normally die at 0 HP
 * @property {number} [wounded]
 * @property {number} [doomed]
 *
 * @typedef {object} ActionSpec
 * @property {string} id
 * @property {string} name
 * @property {string} kind                  "strike" | "spell-attack" | "save" | "heal"
 * @property {number} cost                  Actions (PF2e) to use once
 * @property {number} [bonus]               Attack modifier
 * @property {number[]} [maps]              Multiple attack penalties
 * @property {boolean} [subjectToMAP]
 * @property {boolean} [melee]
 * @property {number} [reach]
 * @property {{increment: number, max?: number}} [range]
 * @property {object[]} [damage]            DamagePart[]
 * @property {object[]} [critDamage]        DamagePart[] (defaults to doubled damage)
 * @property {{type: string, dc: number, basic: boolean}} [save]
 * @property {{targets: number}} [area]
 * @property {object[]} [heal]              DamagePart[] of healing
 * @property {string} [resource]            Pool key consumed per use
 * @property {number} [uses]                Uses per battle when not pool-based
 * @property {boolean} [attack]             Counts toward MAP
 *
 * @typedef {object} BattleSpec
 * @property {CombatantSpec[]} combatants
 * @property {Record<string, object>} sides           {id, label, enemies[], traits, leaderId, leadership, healAggro, morale}
 * @property {Record<string, Record<string, object>>} [approach]  approach[a][t] = {dist, mult, speed, mode, los, meleeOk}
 * @property {object} options                         {maxRounds, downedModel, positioning, morale, leadership, initiativeOrder, surpriseSide}
 */
import { STATUS, clamp, fudged, tacticalTier, TRAITS } from "../constants.js";
import { meanPart } from "./dice.js";

const DEFAULT_APPROACH = Object.freeze({ dist: 5, mult: 1, speed: 25, mode: "walk", los: true, meleeOk: true });
const SIDE_WEIGHT = 0.3;

/**
 * One-time preparation shared by every run of a batch.
 */
export function prepareBattle(spec, rules) {
  const options = {
    maxRounds: 20,
    downedModel: "simulate",
    positioning: true,
    morale: true,
    leadership: true,
    ...spec.options
  };
  const sides = {};
  for ( const [id, side] of Object.entries(spec.sides) ) {
    const leadership = side.leadership ?? {};
    sides[id] = {
      id,
      label: side.label ?? id,
      enemies: new Set(side.enemies ?? []),
      traits: Object.fromEntries(TRAITS.map(k => [k, fudged(side.traits?.[k] ?? 50)])),
      leaderId: options.leadership ? (side.leaderId ?? null) : null,
      leadership: {
        brave: fudged(leadership.brave ?? 0, -50, 50),
        tacticalFloor: fudged(leadership.tacticalFloor ?? 0, 0, 100),
        attack: fudged(leadership.attack ?? 0, -5, 5),
        ac: fudged(leadership.ac ?? 0, -5, 5)
      },
      healAggro: side.healAggro ?? "balanced",
      morale: options.morale && side.morale !== false
    };
  }
  // Enemy relations are symmetric.
  for ( const a of Object.values(sides) ) {
    for ( const b of a.enemies ) sides[b]?.enemies.add(a.id);
  }

  const combatants = spec.combatants.filter(c => sides[c.side]).map(c => {
    const side = sides[c.side];
    const traits = {};
    for ( const k of TRAITS ) {
      traits[k] = clamp(Math.round(fudged(c.traits?.[k] ?? 50) * (1 - SIDE_WEIGHT) + side.traits[k] * SIDE_WEIGHT), 0, 100);
    }
    const meanHeal = a => (a.heal ?? []).reduce((s, p) => s + meanPart(p), 0);
    return {
      spec: c,
      traits,
      isHealer: c.actions.some(a => a.kind === "heal"),
      isCaster: c.actions.some(a => a.kind === "save" || a.kind === "spell-attack"),
      hasRanged: c.actions.some(a => a.range && a.kind !== "heal"),
      flies: (c.speeds?.fly ?? 0) > 0,
      healActions: c.actions.filter(a => a.kind === "heal").sort((x, y) => meanHeal(y) / y.cost - meanHeal(x) / x.cost),
      offense: c.actions.filter(a => a.kind !== "heal")
    };
  });

  const byId = new Map(combatants.map(c => [c.spec.id, c]));
  const approachOf = (aId, tId) => spec.approach?.[aId]?.[tId] ?? DEFAULT_APPROACH;

  return { spec, rules, options, sides, combatants, byId, approachOf, meanCache: new Map() };
}

/** Fresh mutable state for one run. */
export function createRun(prep) {
  const units = prep.combatants.map(p => {
    const s = p.spec;
    const resources = { ...(s.resources ?? {}) };
    const uses = {};
    for ( const a of s.actions ) if ( Number.isFinite(a.uses) ) uses[a.id] = a.uses;
    return {
      prep: p,
      spec: s,
      id: s.id,
      side: s.side,
      hp: s.hp.value,
      maxHp: s.hp.max,
      temp: s.hp.temp ?? 0,
      status: s.hp.value > 0 ? STATUS.STANDING : STATUS.DOWN,
      dying: 0,
      wounded: s.wounded ?? 0,
      doomed: s.doomed ?? 0,
      stable: s.hp.value <= 0,
      prone: false,
      persistent: [],
      resources,
      resourcesStart: { ...resources },
      uses,
      advance: 0,
      adjacent: new Set(),
      losGained: new Set(),
      lastAttackerId: null,
      targetId: null,
      shieldRaised: false,
      wavering: false,
      moraleStress: 0,
      checkedHalf: false,
      checkedQuarter: false,
      damageDealt: 0,
      healingDone: 0,
      fellRound: null,
      wasDowned: false,
      healedTargets: new Set(),
      drawn: new Set(),
      conds: {},
      afflictions: [],
      grabbedBy: null,
      tac: s.tactics ?? null, // replaced per fight by sampleRunTactics in runOne
      studied: new Set(),
      parleyed: false
    };
  });
  return {
    prep,
    units,
    byId: new Map(units.map(u => [u.id, u])),
    round: 0,
    sideFocus: {},
    firstFallen: null,
    log: null
  };
}

export const isStanding = u => u.status === STATUS.STANDING;

/** Healing/dying answers for this fight: player tactics, else the older disposition record. */
export function dispositionOf(u) {
  return u.tac ?? u.spec.disposition ?? {};
}

/** Playstyle-driven behavior chances (see engine/playstyles.js). */
export function behaviorOf(u) {
  return u.spec.behavior ?? {};
}

/** Lore-Collector bonus against a foe it has studied: +1, or +2 when the foe has a weakness to exploit. */
export function studyBonus(u, t) {
  if ( !t || !u.studied?.has(t.id) ) return 0;
  return Object.keys(t.spec.iwr?.weak ?? {}).length ? 2 : 1;
}
export const isOut = u => u.status !== STATUS.STANDING;

export function areEnemies(run, a, b) {
  return run.prep.sides[a.side]?.enemies.has(b.side) ?? false;
}

export function enemiesOf(run, u) {
  return run.units.filter(o => o !== u && areEnemies(run, u, o));
}

export function alliesOf(run, u) {
  return run.units.filter(o => o.side === u.side);
}

export function leaderStanding(run, side) {
  const id = run.prep.sides[side]?.leaderId;
  if ( !id ) return false;
  const leader = run.byId.get(id);
  return !!leader && isStanding(leader);
}

/** Trait value including live leadership effects. */
export function liveTrait(run, u, trait) {
  let value = u.prep.traits[trait];
  const side = run.prep.sides[u.side];
  if ( leaderStanding(run, u.side) && side.leaderId !== u.id ) {
    if ( trait === "brave" ) value += side.leadership.brave;
    if ( trait === "tactical" ) value = Math.max(value, side.leadership.tacticalFloor);
  }
  return clamp(value, 0, 100);
}

export function liveTier(run, u) {
  return tacticalTier(liveTrait(run, u, "tactical"));
}

/** Status penalty to checks and DCs (frightened / sickened don't stack; the worst applies). */
export function statusPenalty(u) {
  return Math.max(u.conds.frightened ?? 0, u.conds.sickened ?? 0);
}

/** Off-guard: prone, grabbed, flanked, or a condition that says so. */
export function isOffGuard(run, target, attacker = null, action = null) {
  if ( target.prone || target.conds.offGuard || target.conds.paralyzed ) return true;
  if ( target.grabbedBy ) {
    const grabber = run.byId.get(target.grabbedBy);
    if ( grabber && isStanding(grabber) ) return true;
  }
  return !!(attacker && action?.melee && isFlanked(run, target, attacker));
}

/** Current AC including raised shield, leadership, off-guard and conditions. */
export function currentAc(run, target, attacker, action) {
  let ac = target.spec.defenses.ac;
  if ( target.shieldRaised && target.spec.shield ) ac += target.spec.shield.ac;
  const side = run.prep.sides[target.side];
  if ( leaderStanding(run, target.side) ) ac += side.leadership.ac;
  if ( isOffGuard(run, target, attacker, action) ) ac -= 2;
  ac -= (target.conds.clumsy ?? 0) + statusPenalty(target);
  return ac;
}

/** Saving throw modifier including conditions. */
export function saveMod(target, type) {
  let mod = target.spec.defenses[type] ?? (target.spec.level + 5);
  mod -= statusPenalty(target);
  if ( type === "reflex" ) mod -= target.conds.clumsy ?? 0;
  return mod;
}

/** Actions available at the start of a turn. */
export function actionsThisTurn(run, u) {
  const base = run.prep.rules.actionsPerTurn;
  if ( u.conds.paralyzed ) return 0;
  return Math.max(0, base - (u.conds.slowed ?? 0) - (u.conds.stunned ?? 0));
}

/** Effective action cost, including drawing an unready weapon the first time. */
export function actionCost(u, action) {
  return action.cost + ((action.drawCost && !u.drawn.has(action.id)) ? action.drawCost : 0);
}

/** Attackers flank when another standing ally of theirs is adjacent to the target and they coordinate. */
export function isFlanked(run, target, attacker) {
  if ( !attacker.adjacent.has(target.id) ) return false;
  const coordinates = liveTier(run, attacker) >= 2 || attacker.spec.flags?.packTactics;
  if ( !coordinates ) return false;
  return alliesAdjacentTo(run, target, attacker) >= 1;
}

/** Number of attacker's standing allies (excluding the attacker) adjacent to the target. */
export function alliesAdjacentTo(run, target, attacker) {
  let n = 0;
  for ( const id of target.adjacent ) {
    const other = run.byId.get(id);
    if ( other && other !== attacker && other.side === attacker.side && isStanding(other) ) n += 1;
  }
  return n;
}

/** Extra damage parts that apply to this hit (sneak attack vs off-guard, pack attack, ...). */
export function bonusDamageParts(run, attacker, action, target) {
  const out = [];
  for ( const bonus of action.bonusDamage ?? [] ) {
    if ( bonus.when === "offGuard" && isOffGuard(run, target, attacker, action) ) out.push(...bonus.parts);
    else if ( bonus.when === "pack" && alliesAdjacentTo(run, target, attacker) >= (bonus.allies ?? 2) ) out.push(...bonus.parts);
    else if ( bonus.when === "always" ) out.push(...bonus.parts);
  }
  return out;
}

export function attackBonusMods(run, u, action = null) {
  let mod = 0;
  if ( u.wavering ) mod -= 1;
  if ( u.prone ) mod -= 2;
  mod -= statusPenalty(u);
  if ( action?.melee ) mod -= u.conds.enfeebled ?? 0;
  if ( u.spec.environment?.aquatic && !(u.spec.speeds?.swim > 0) && action?.melee ) mod -= 2;
  if ( leaderStanding(run, u.side) && run.prep.sides[u.side].leaderId !== u.id ) {
    mod += run.prep.sides[u.side].leadership.attack;
  }
  return mod;
}

/** Geometry ------------------------------------------------------------- */

export function approach(run, a, t) {
  return run.prep.approachOf(a.id, t.id);
}

/** Straight-line feet still separating a and t (after both have advanced). */
export function separation(run, a, t) {
  if ( !run.prep.options.positioning ) return 0;
  if ( a.adjacent.has(t.id) ) return 0;
  const ap = approach(run, a, t);
  return Math.max(0, ap.dist - a.advance - t.advance);
}

/** Move actions a needs before it can make `action` against t (Infinity when impossible). */
export function movesNeeded(run, a, t, action) {
  if ( !run.prep.options.positioning ) return 0;
  const ap = approach(run, a, t);
  if ( action.range ) {
    const maxRange = action.range.max ?? action.range.increment * 3;
    let moves = (ap.los || a.losGained.has(t.id)) ? 0 : 1;
    const gap = separation(run, a, t) - maxRange;
    if ( gap > 0 ) {
      if ( !Number.isFinite(ap.mult) || ap.speed <= 0 ) return Infinity;
      moves = Math.max(moves, Math.ceil((gap * ap.mult) / ap.speed));
    }
    return moves;
  }
  // Melee
  if ( a.adjacent.has(t.id) ) return 0;
  if ( !ap.meleeOk ) return Infinity;
  const reach = action.reach ?? 5;
  const gap = Math.max(0, separation(run, a, t) - reach);
  if ( gap <= 0 ) return 0;
  if ( !Number.isFinite(ap.mult) || ap.speed <= 0 ) return Infinity;
  return Math.ceil((gap * ap.mult) / ap.speed);
}

/** Range penalty (PF2e: -2 per increment beyond the first). */
export function rangePenalty(run, a, t, action) {
  if ( !action.range || action.range.noPenalty || !run.prep.options.positioning ) return 0;
  const d = separation(run, a, t);
  const increments = Math.max(0, Math.ceil(d / action.range.increment) - 1);
  return -2 * increments;
}

/** Spend one move action advancing a toward t. */
export function moveToward(run, a, t, reach = null) {
  const ap = approach(run, a, t);
  const progress = Number.isFinite(ap.mult) && ap.mult > 0 ? ap.speed / ap.mult : 0;
  a.advance = Math.min(a.advance + progress, ap.dist);
  a.losGained.add(t.id);
  if ( (reach !== null) && ap.meleeOk && separation(run, a, t) <= reach ) {
    a.adjacent.add(t.id);
    t.adjacent.add(a.id);
  }
}
