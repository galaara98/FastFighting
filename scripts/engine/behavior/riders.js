/**
 * What a blow can carry beyond its damage.
 *
 * On-hit riders (spec.riders): extras a creature may add to a hit, often for a price. 5e Divine Smite (a spell slot:
 * more damage), Stunning Strike (a ki point: a save or be stunned), Battle Master maneuvers (a superiority die: damage,
 * and a save or be knocked prone). A creature decides each time whether this hit is worth it.
 *   {id, label, when: "hit" | "miss", melee?, ranged?, weapon?, resource?, uses?, oncePerTurn?, damage?: DamagePart[],
 *    critDouble?, save?: {type, dc}, onSave?: [critFail, fail, success, critSuccess], outcome?, attackDie?, tell?}
 *   when "miss" with attackDie: a die added to an attack that just missed by a little (5e Precision Attack)
 *   melee / ranged: only for those attacks (unset: either); weapon: only for weapon strikes, not spells
 *   vs: only against creatures with one of these traits (Divine Smite's extra die against fiends and undead)
 *   group: one rider of a group per hit, the first that's worth it (the version against fiends, else the plain one)
 *   cost: what it takes from the turn, on the creature's own turn only (a smite spell: {bonus: 1, slot: 1})
 *
 * Deeds (spec.deeds, for attacks with a deed die: DCC Mighty Deeds of Arms): declared before the roll; the deed
 * happens if the attack hits and the deed die shows enough, the more the better.
 *   {id, label, melee?, ranged?, tiers: [{min, outcome}]}   (the highest tier the deed die reaches; an outcome with
 *   self lands on the one who did it: a defensive deed)
 *
 * Crits and fumbles from tables (spec.crit / action.crit, spec.fumble): a critical hit rolls on the attacker's table
 * for extra damage and a lasting effect on the foe; a fumble rolls on its own for what befalls the fumbler.
 *   {die: DamagePart, mod, rows: [{lo, hi, damage?, outcome?, self?, slay?}]}
 * spec.critAgainst: taken off crit rolls made against this creature by anyone but a player character (DCC: a PC's
 * Luck modifier works against a monster's crits).
 * Pure: no Foundry globals.
 */
import { TACTICAL, clamp } from "../../constants.js";
import { meanPart, samplePart } from "../dice.js";
import { liveTier } from "../battle-state.js";
import { meanDamageVs, threatOf } from "./evaluate.js";
import { outcomeWorth } from "./effects.js";

const isWeapon = action => action.kind === "strike";
const isRanged = action => !!action.range && !action.melee;

/** Does this rider (or deed) go with this attack (on this target)? */
function fits(r, action, t = null) {
  if ( r.vs?.length && !(t?.spec.creatureTraits ?? []).some(x => r.vs.includes(x)) ) return false;
  if ( r.weapon && !isWeapon(action) ) return false;
  if ( r.melee && isRanged(action) ) return false;
  if ( r.ranged && !isRanged(action) ) return false;
  return action.kind === "strike" || action.kind === "spell-attack";
}

/** Can u pay for it now? (What it takes from the turn only on u's own turn: no bonus action off-turn.) */
function affordable(run, u, r) {
  if ( r.oncePerTurn && u.usedThisTurn?.has(`rider:${r.id}`) ) return false;
  if ( r.cost && Object.keys(r.cost).length && (run.acting !== u || !u.turn?.canAfford(r.cost)) ) return false;
  if ( r.resource ) return (u.resources[r.resource] ?? 0) >= (r.amount ?? 1);
  if ( Number.isFinite(r.uses) ) return (u.riderUses?.[r.id] ?? r.uses) > 0;
  return true;
}

function pay(u, r) {
  if ( r.oncePerTurn ) (u.usedThisTurn ??= new Set()).add(`rider:${r.id}`);
  if ( r.cost && Object.keys(r.cost).length ) u.turn?.spend(r.cost);
  if ( r.resource ) u.resources[r.resource] -= (r.amount ?? 1);
  else if ( Number.isFinite(r.uses) ) (u.riderUses ??= {})[r.id] = (u.riderUses[r.id] ?? r.uses) - 1;
}

/** Harm an outcome does t (positive: good for u). */
const harm = (run, u, t, outcome) => (outcome ? -outcomeWorth(run, u, t, outcome, { versus: u }) : 0);

/* -------------------------------------------- */
/*  Deeds                                       */
/* -------------------------------------------- */

/** Chance a d`faces` shows at least `min`. */
const atLeast = (faces, min) => clamp((faces - min + 1) / faces, 0, 1);

/**
 * The deed u declares for this attack on t, or null: the one worth the most, weighing the chance the deed die
 * reaches each tier. Feral creatures don't think of it; the rest pick what helps most.
 */
export function chooseDeed(run, u, action, t) {
  const faces = action.deedDie;
  if ( !faces || !u.spec.deeds?.length || liveTier(run, u) <= TACTICAL.FERAL ) return null;
  let best = null;
  for ( const deed of u.spec.deeds ) {
    if ( !fits(deed, action, t) ) continue;
    const tiers = [...(deed.tiers ?? [])].sort((a, b) => a.min - b.min);
    let worth = 0;
    tiers.forEach((tier, i) => {
      const next = tiers[i + 1];
      const p = atLeast(faces, tier.min) - (next ? atLeast(faces, next.min) : 0);
      if ( p > 0 ) worth += p * (tier.outcome?.self ? outcomeWorth(run, u, u, tier.outcome) : harm(run, u, t, tier.outcome));
    });
    if ( worth > 0 && (!best || worth > best.worth) ) best = { deed, worth };
  }
  return best?.deed ?? null;
}

/** The tier a deed reaches with this deed-die roll, or null if it falls short. */
export function deedTier(deed, roll) {
  let out = null;
  for ( const tier of deed?.tiers ?? [] ) if ( roll >= tier.min && (!out || tier.min > out.min) ) out = tier;
  return out;
}

/* -------------------------------------------- */
/*  On-hit riders                               */
/* -------------------------------------------- */

/**
 * What spending the rider's price is worth to u right now, in damage terms: the more of the pool is gone, the more a
 * use has to do (conservers want more, those going all out less). Free riders cost nothing.
 */
function priceOf(run, u, r, baseHit) {
  if ( !r.resource && !Number.isFinite(r.uses) ) return 0;
  // A spell slot is dear by its level (r.dear); anything else by what the blow itself does.
  const scale = r.dear ? 4 * r.dear : Math.max(1, baseHit);
  const start = r.resource ? (u.resourcesStart[r.resource] ?? 1) : r.uses;
  const left = r.resource ? (u.resources[r.resource] ?? 0) : (u.riderUses?.[r.id] ?? r.uses);
  const frac = start > 0 ? left / start : 0;
  const style = { conserve: 1.6, balanced: 1, nova: 0.55 }[u.tac?.resourceUse] ?? 1;
  return style * (0.6 + 1.4 * (1 - frac)) * scale;
}

/** Expected worth of a rider on this hit (crit: double dice where the rider says so). */
function riderWorth(run, u, r, action, t, { crit, baseHit }) {
  let extra = (r.damage ?? []).reduce((s, p) => s + Math.max(0, meanPart(p)), 0);
  if ( crit && r.critDouble ) extra += (r.damage ?? []).reduce((s, p) => s + p.dice.reduce((x, d) => x + d.n * (d.faces + 1) / 2 * (d.mult ?? 1), 0), 0);
  let worth = extra;
  // Turning a blow that leaves it standing into one that drops it.
  if ( extra > 0 && t.hp > baseHit && t.hp <= baseHit + extra ) worth += threatOf(run, t, u) * 1.5;
  if ( r.save ) {
    const fail = 0.5; // (behavior's rough guess; the simulation rolls the save)
    worth += fail * harm(run, u, t, r.onSave?.[1] ?? r.outcome);
  } else if ( r.outcome ) worth += harm(run, u, t, r.outcome);
  return worth;
}

/**
 * Riders u adds to this hit on t (already paid for): each the creature thinks worth its price. Thinking creatures
 * weigh it; feral ones use what they have when they have it.
 */
export function chooseHitRiders(run, u, action, t, { crit = false } = {}) {
  const careless = liveTier(run, u) <= TACTICAL.FERAL;
  const baseHit = meanDamageVs(run, action, t)[crit ? "critical" : "normal"];
  // Everything worth its price, the best value for what it costs first (a free rider before any; a Divine Smite before
  // a lesser smite; the cheapest slot that does the job), then paid for while the turn and the pools allow.
  const options = [];
  for ( const r of u.spec.riders ?? [] ) {
    if ( (r.when ?? "hit") !== "hit" || !fits(r, action, t) || !affordable(run, u, r) ) continue;
    const worth = riderWorth(run, u, r, action, t, { crit, baseHit });
    const price = priceOf(run, u, r, baseHit);
    if ( worth <= 0 || (!careless && worth < price) ) continue;
    options.push({ r, rate: price > 0 ? worth / price : Infinity, worth });
  }
  options.sort((a, b) => b.rate - a.rate || b.worth - a.worth);
  const out = [];
  const groups = new Set();
  for ( const { r } of options ) {
    if ( (r.group && groups.has(r.group)) || !affordable(run, u, r) ) continue;
    pay(u, r);
    if ( r.group ) groups.add(r.group);
    out.push(r);
  }
  return out;
}

/**
 * A die added to an attack that just missed (5e Precision Attack): returns the rider used and the die rolled, or null.
 * Used when the die can make up the difference and the hit is worth the price.
 */
export function rescueMiss(run, u, action, t, short) {
  for ( const r of u.spec.riders ?? [] ) {
    if ( r.when !== "miss" || !r.attackDie || !fits(r, action, t) || !affordable(run, u, r) ) continue;
    if ( short > r.attackDie ) continue;
    const chance = atLeast(r.attackDie, short);
    const baseHit = meanDamageVs(run, action, t).normal;
    if ( chance * baseHit < priceOf(run, u, r, baseHit) * 0.6 ) continue;
    pay(u, r);
    return { rider: r, roll: run.rng.die(r.attackDie) };
  }
  return null;
}

/* -------------------------------------------- */
/*  Crit and fumble tables                      */
/* -------------------------------------------- */

/** The row a table roll lands on (off either end: the nearest). */
function rowFor(rows, total) {
  if ( !rows?.length ) return null;
  return rows.find(r => total >= r.lo && total <= r.hi) ?? (total < rows[0].lo ? rows[0] : rows.at(-1));
}

/** The crit table u rolls on with this action, if it has one. */
export function critTableOf(u, action) {
  const crit = action.crit ?? u.spec.crit;
  return crit?.rows?.length ? crit : null;
}

/** Roll on u's crit table for a critical hit on t: {row, total} or null. */
export function rollCrit(run, u, action, t) {
  const crit = critTableOf(u, action);
  if ( !crit ) return null;
  let total = samplePart(crit.die, run.rng) + (crit.mod ?? 0);
  if ( u.spec.kind !== "pc" ) total -= t.spec.critAgainst ?? 0;
  return { row: rowFor(crit.rows, total), total };
}

/** Roll on u's fumble table: {row, total} or null. */
export function rollFumble(run, u) {
  const fumble = u.spec.fumble;
  if ( !fumble?.rows?.length ) return null;
  const total = samplePart(fumble.die, run.rng) + (fumble.mod ?? 0);
  return { row: rowFor(fumble.rows, total), total };
}

const critMeans = new WeakMap();

/** Mean extra damage a crit-table roll adds (over the crit die's spread), for behavior's estimates. */
export function critExtraMean(crit) {
  if ( !crit?.rows?.length ) return 0;
  let v = critMeans.get(crit);
  if ( v !== undefined ) return v;
  const die = crit.die ?? { dice: [], flat: 0 };
  const single = die.dice.length === 1 && Math.abs(die.dice[0].n) === 1;
  const totals = single
    ? Array.from({ length: die.dice[0].faces }, (_, i) => i + 1 + die.flat + (crit.mod ?? 0))
    : [Math.round(meanPart(die) + (crit.mod ?? 0))];
  const rowMean = r => (r.damage ?? []).reduce((s, p) => s + Math.max(0, meanPart(p)), 0) + (r.outcome ? 2 : 0) + (r.slay ? 15 : 0);
  v = totals.reduce((s, total) => s + rowMean(rowFor(crit.rows, total)), 0) / totals.length;
  critMeans.set(crit, v);
  return v;
}
