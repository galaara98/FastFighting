/**
 * Reactions that answer something done to a creature (opportunity attacks, which answer a foe walking away, are in
 * reactions.js): a spell that turns a hit into a miss, a dodge that halves a blow, fire for whoever hurt you, a
 * counterspell, a shield raised against a blow, a riposte.
 *
 * spec.reactions: [{id, label, on, ...what it does, resource?, amount?, uses?, range?, melee?, physical?, tell?}]
 *   on "attacked"   a foe attacks it, before the roll:          ac (a bonus against this attack: PF2e Nimble Dodge)
 *   on "hit"        an attack hits it, before the damage:        ac (5e Shield: +ac until its next turn, perhaps
 *                                                                a miss after all), halve (5e Uncanny Dodge), reduce
 *                                                                (a DamagePart taken off: 5e Parry, PF2e Shield Block)
 *   on "missed"     a melee attack misses it:                   strike (5e Riposte: its best melee strike back)
 *   on "damaged"    a foe's blow hurt it:                       damage and save (5e Hellish Rebuke, at the foe)
 *   on "allyHit"    an attack hits a friend near it (range):     reduce (taken off the friend's damage) and strike
 *                                                                (its best melee strike at the attacker, if in reach:
 *                                                                PF2e Retributive Strike, Glimpse of Redemption ...);
 *                                                                redirect: it takes the blow instead, against its own
 *                                                                resistances (PF2e guardian's Intercept Attack)
 *   on "spell"      a foe casts a spell it can see:             counter: {level, mod} (5e Counterspell: a spell of
 *                                                                its level or lower simply fails; a higher one if
 *                                                                the check beats 10 + its level)
 *   range           how far it reaches, in feet (default: anywhere); melee / ranged: only those attacks; physical: only
 *                   bludgeoning, piercing and slashing; needsShield: only with its shield raised
 * Each takes the creature's reaction for the round, and whatever it says it costs. A creature uses it when it's
 * worth what it costs (the same reckoning as riders.js), thinking creatures more wisely than feral ones.
 * Pure: no Foundry globals.
 */
import { TACTICAL } from "../../constants.js";
import { liveTier, edgeDistance, isUp, saveRoll, movesNeeded, refusesToHelp } from "../battle-state.js";
import { meanPart } from "../dice.js";
import { meanDamageVs, threatOf } from "./evaluate.js";
import { degreeDistribution } from "../probability.js";
import { perceives } from "./senses.js";

const PHYSICAL = new Set(["bludgeoning", "piercing", "slashing", "physical"]);

/** What a reaction's price is worth to u now, in damage terms (a spell slot is dear when few are left). */
function priceOf(u, r, scale) {
  if ( !r.resource && !Number.isFinite(r.uses) ) return 0;
  const start = r.resource ? (u.resourcesStart[r.resource] ?? 1) : r.uses;
  const left = r.resource ? (u.resources[r.resource] ?? 0) : (u.reactionUses?.[r.id] ?? r.uses);
  const frac = start > 0 ? left / start : 0;
  const style = { conserve: 1.6, balanced: 1, nova: 0.55 }[u.tac?.resourceUse] ?? 1;
  return style * (0.6 + 1.4 * (1 - frac)) * Math.max(1, scale);
}

function ready(run, u, r) {
  if ( !isUp(u) || (u.reactionsLeft ?? 0) <= 0 || u.conds?.incapacitated || u.conds?.stunned || u.conds?.paralyzed ) return false;
  if ( r.needsShield && !u.shieldRaised ) return false;
  if ( r.resource ) return (u.resources[r.resource] ?? 0) >= (r.amount ?? 1);
  if ( Number.isFinite(r.uses) ) return (u.reactionUses?.[r.id] ?? r.uses) > 0;
  return true;
}

function pay(u, r) {
  u.reactionsLeft -= 1;
  if ( r.resource ) u.resources[r.resource] -= (r.amount ?? 1);
  else if ( Number.isFinite(r.uses) ) (u.reactionUses ??= {})[r.id] = (u.reactionUses[r.id] ?? r.uses) - 1;
}

const near = (run, u, other, r) => {
  if ( !r.range ) return true;
  const d = edgeDistance(u, other);
  return d === null || d <= r.range;
};

/**
 * Does u react to this? The first of its reactions for the trigger that's worth it, paid for; or null.
 * @param {object} run
 * @param {object} u          the one reacting
 * @param {string} trigger    "attacked" | "hit" | "missed" | "damaged" | "spell"
 * @param {object} ctx        {by, action, roll, ac, crit, damage (expected), types (damage types), spell}
 */
export function respond(run, u, trigger, ctx) {
  const list = u.spec.reactions;
  if ( !list?.length ) return null;
  const tier = liveTier(run, u);
  const careless = tier <= TACTICAL.FERAL;
  for ( const r of list ) {
    if ( r.on !== trigger || !ready(run, u, r) ) continue;
    if ( r.melee && !ctx.action?.melee ) continue;
    if ( r.ranged && ctx.action?.melee ) continue;
    if ( r.physical && !(ctx.types ?? []).some(t => PHYSICAL.has(t)) ) continue;
    if ( trigger === "allyHit" ) {
      if ( !ctx.ally || !near(run, u, ctx.ally, r) || !perceives(run, u, ctx.ally) || refusesToHelp(run, u, ctx.ally) ) continue;
    } else {
      if ( ctx.by && !near(run, u, ctx.by, r) ) continue;
      if ( ctx.by && trigger !== "hit" && trigger !== "attacked" && !perceives(run, u, ctx.by) ) continue;
    }
    const worth = worthOf(run, u, r, trigger, ctx);
    if ( !(worth > 0) ) continue;
    // (A counterspell burns a slot of its level: the dearer the slot, the more the spell has to be worth stopping.)
    const price = priceOf(u, r, trigger === "spell" ? 6 * Math.max(1, Number(r.counter?.level ?? r.level) || 3) : (ctx.damage ?? 5));
    if ( !careless && worth < price ) continue;
    pay(u, r);
    return r;
  }
  return null;
}

/** What a reaction would do for u here, in damage terms. */
function worthOf(run, u, r, trigger, ctx) {
  const expected = Math.max(0, ctx.damage ?? 0);
  switch ( trigger ) {
    case "attacked":
      // A bonus to AC against one attack: about a tenth of the blow per point.
      return (r.ac ?? 0) * 0.1 * Math.max(1, expected);
    case "hit": {
      let w = 0;
      // A bonus to AC that turns this hit into a miss (not a natural 20), and keeps helping until its next turn.
      if ( r.ac && ctx.roll && !ctx.crit && ctx.roll.total < ctx.ac + r.ac ) w += expected + expected * 0.5;
      else if ( r.ac ) w += expected * 0.3;
      if ( r.halve ) w += expected / 2;
      if ( r.reduce ) w += Math.min(expected, meanPart(r.reduce));
      return w;
    }
    case "missed":
      return r.strike ? meanStrike(run, u, ctx.by) : 0;
    case "allyHit": {
      // What it takes off the friend's blow, and a strike back at the attacker if it's within reach.
      let w = r.reduce ? Math.min(expected, meanPart(r.reduce)) : 0;
      // Taking it instead: worth more the more the friend needs it, less when it would drop the one taking it.
      if ( r.redirect ) w += expected * 0.5 + (ctx.ally && expected >= ctx.ally.hp ? expected : 0) - (expected >= u.hp ? expected : 0);
      const strike = r.strike && ctx.by ? riposteStrike(u) : null;
      if ( strike && movesNeeded(run, u, ctx.by, strike) === 0 ) w += meanStrike(run, u, ctx.by);
      return w;
    }
    case "damaged": {
      const dmg = (r.damage ?? []).reduce((s, p) => s + Math.max(0, meanPart(p)), 0);
      return dmg * (r.save ? 0.65 : 1) + (ctx.by ? threatOf(run, ctx.by, u) * 0.1 : 0);
    }
    case "spell": {
      // What the spell would do, roughly: the higher its level, the more; a hold or an area more still.
      const level = Number(ctx.action?.rank) || 1;
      let sure;
      if ( r.counter?.save && ctx.by ) {
        // (5e 2024: the caster saves against it.)
        const s = saveRoll(run, ctx.by, r.counter.save.type);
        const dist = degreeDistribution(run.prep.rules, s.mod, Number(r.counter.save.dc) || 15, { advantage: s.advantage, kind: "save", roller: ctx.by });
        sure = dist[0] + dist[1];
      } else sure = (r.counter?.level ?? 0) >= level ? 1 : Math.max(0.1, (21 - (10 + level - (r.counter?.mod ?? 0))) / 20);
      const kind = ctx.action?.kind;
      const big = (kind === "control" ? 1.6 : 1) * (ctx.action?.area ? 1.5 : 1);
      return sure * level * 7 * big;
    }
    default: return 0;
  }
}

/** Its best everyday melee strike against `t`, as expected damage (for a riposte). */
function meanStrike(run, u, t) {
  let best = 0;
  for ( const a of u.prep.offense ) {
    if ( a.kind !== "strike" || !a.melee || a.sequence || a.resource || Number.isFinite(a.uses) ) continue;
    best = Math.max(best, meanDamageVs(run, a, t).normal * 0.6);
  }
  return best;
}

/** Its best everyday melee strike (for a riposte), or null. */
export function riposteStrike(u) {
  let best = null;
  for ( const a of u.prep.offense ) {
    if ( a.kind !== "strike" || !a.melee || a.sequence || a.resource || Number.isFinite(a.uses) ) continue;
    const score = (a.damage ?? []).reduce((s, p) => s + meanPart(p), 0) + (a.bonus ?? 0) * 0.5;
    if ( !best || score > best.score ) best = { a, score };
  }
  return best?.a ?? null;
}
