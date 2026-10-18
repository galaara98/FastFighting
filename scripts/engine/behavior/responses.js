/**
 * Reactions that answer something done to a creature, or by it (opportunity attacks, which answer a foe walking away,
 * are in reactions.js): a spell that turns a hit into a miss, a dodge that halves a blow, fire for whoever hurt you, a
 * counterspell, a shield raised against a blow, a riposte, a step when a friend comes beside it, a second bite when its
 * first one lands.
 *
 * spec.reactions: [{id, label, on, ...what it does, ...filters, resource?, amount?, uses?, free?, passive?, tell?}]
 *
 * What it does, at any moment it answers (reaction-effects.js, weighed and played there):
 *   harm, afflict, boost, heal, recharge, strike, step, areaBurst  (and the older damage, save and move: its harm)
 * and what belongs to one moment:
 *   ac          attacked, allyTargeted: a bonus to its (or the friend's) defense against this attack (PF2e Nimble Dodge,
 *               5e Protection); hit: +ac until its next turn, perhaps a miss after all (5e Shield)
 *   halve       hit: the blow halved (5e Uncanny Dodge)
 *   reduce      hit, allyHit: a DamagePart taken off (5e Parry, PF2e Shield Block; a friend's: Retributive Strike)
 *   redirect    allyHit: it takes the blow instead, against its own resistances (PF2e guardian's Intercept Attack)
 *   applies     hit, allyHit: the system's own application does the halve or reduce (PF2e's Shield Block, Champion's
 *               Resistance)
 *   counter     foeCasts: {level, mod} (5e Counterspell: a spell of its level or lower simply fails; a higher one if the
 *               check beats 10 + its level) or {level, save} (the caster saves against it)
 *   stayUp      wouldDrop: {hp, wounded} (it stays up at hp, 1 unless said: PF2e Orc Ferocity, 5e Relentless Endurance)
 *
 * The moments (`on`: a trigger from the master list, story/master.js REACTION_TRIGGERS, an older name, or a list):
 *   attacked        a foe attacks it, before the roll (what it does besides a bonus to AC comes first: a strike that
 *                   fells the attacker spoils the attack)
 *   hit             an attack hits it, before the damage (its harm, strike and the rest once the blow is done)
 *   missed          an attack at it misses (crit: a critical failure)
 *   damaged         a foe's blow hurt it
 *   allyTargeted    a foe attacks a friend near it (range)
 *   allyHit         an attack hits a friend near it (range), before the damage
 *   foeCasts        a foe casts a spell it can see ("spell")
 *   wouldDrop       a blow would drop it
 *   slain           it drops or dies: answered on its way down
 *   allyMoves       a friend ends a move beside it (range; a square beside it if not said)
 *   foeApproaches   a foe ends a move in its reach (range; its melee reach if not said), from outside it
 *   ownHit          its own attack (a Strike or a spell attack) hits: the one it hit is the one its effects are at
 *
 * Filters, all optional:
 *   range           how far it reaches, in feet (default: anywhere)
 *   melee / ranged  only those attacks (on ownHit, its own)
 *   physical        only bludgeoning, piercing and slashing; damageTypes: only those types (damaged: what hurt it)
 *   crit            only a critical hit (hit, allyHit, ownHit), or a critical failure (missed)
 *   actions         only these actions of the attacker's (by id: on ownHit, which of its own strikes)
 *   needsShield     only with its shield raised
 *   kin             only for those with one of these creature traits (Goblin Scuttle: a goblin friend)
 *   byRange         a friend's reaction (allyHit, allyTargeted): how near the one who set it off must be too, in feet
 *                   (PF2e's champion's reactions: both the friend and the foe inside its aura)
 *   strikeRanged    its strike back may be a shot, at a foe out of reach but in range (PF2e Nimble Reprisal)
 *   strikeStep      feet it may Step first to bring the foe into reach for its strike back (Nimble Reprisal's 5)
 *   free            it costs no reaction (a creature's nature: a death burst; PF2e's triggered free actions)
 *   passive         always on: never asked about in a live battle
 * Each takes the creature's reaction for the round, and whatever it says it costs. A creature uses it when it's
 * worth what it costs (the same reckoning as riders.js), thinking creatures more wisely than feral ones.
 * Pure: no Foundry globals.
 */
import { TACTICAL } from "../../constants.js";
import { liveTier, edgeDistance, isUp, saveRoll, refusesToHelp } from "../battle-state.js";
import { meanPart } from "../dice.js";
import { degreeDistribution } from "../probability.js";
import { perceives } from "./senses.js";
import { edgeAt } from "./space.js";
import { answersTo, triggerOf } from "../../story/master.js";
import { effectsWorth, riposteStrike, strikeBack, bestStep } from "./reaction-effects.js";

/** (Where they were before: what a strike back is and where a step goes, reaction-effects.js.) */
export { riposteStrike, strikeBack, bestStep };

const PHYSICAL = new Set(["bludgeoning", "piercing", "slashing", "physical"]);
/** Moments about itself alone: whoever caused them, near or seen or not. */
const SELF = new Set(["wouldDrop", "slain"]);
/** Moments a creature's move makes, ending beside it. */
const MOVES = new Set(["allyMoves", "foeApproaches"]);
/** Moments whose other one needn't be seen: an attack at it (it's felt), its own blow (it just landed). */
const UNSEEN = new Set(["hit", "attacked", "ownHit"]);

/** What a reaction's price is worth to u now, in damage terms (a spell slot is dear when few are left). */
function priceOf(u, r, scale) {
  if ( !r.resource && !Number.isFinite(r.uses) ) return 0;
  const start = r.resource ? (u.resourcesStart[r.resource] ?? 1) : r.uses;
  const left = r.resource ? (u.resources[r.resource] ?? 0) : (u.reactionUses?.[r.id] ?? r.uses);
  const frac = start > 0 ? left / start : 0;
  const style = { conserve: 1.6, balanced: 1, nova: 0.55 }[u.tac?.resourceUse] ?? 1;
  return style * (0.6 + 1.4 * (1 - frac)) * Math.max(1, scale);
}

function ready(u, r, trigger) {
  // (Slain: it answers on its way down. Free: it costs no reaction.)
  const going = trigger === "slain";
  if ( (!going && !isUp(u)) || (!r.free && (u.reactionsLeft ?? 0) <= 0) ) return false;
  if ( !going && (u.conds?.incapacitated || u.conds?.stunned || u.conds?.paralyzed) ) return false;
  if ( r.needsShield && !u.shieldRaised ) return false;
  if ( r.resource ) return (u.resources[r.resource] ?? 0) >= (r.amount ?? 1);
  if ( Number.isFinite(r.uses) ) return (u.reactionUses?.[r.id] ?? r.uses) > 0;
  return true;
}

function pay(u, r) {
  if ( !r.free ) u.reactionsLeft -= 1;
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
 * @param {string} trigger    "attacked" | "hit" | "missed" | "damaged" | "allyHit" | "spell" | "allyTargeted" | "wouldDrop" | "slain"
 *                            | "allyMoves" | "foeApproaches" | "ownHit"
 * @param {object} ctx        {by, action, roll, ac, crit, damage (expected), types (damage types), spell}; a move's:
 *                            {by (a foe) | ally, from (where it set out), toward, reached}; its own blow's (ownHit):
 *                            {target (the one it hit), action, crit, damage (dealt), types}
 */
export function respond(run, u, trigger, ctx) {
  const list = u.spec.reactions;
  if ( !list?.length ) return null;
  const tier = liveTier(run, u);
  const careless = tier <= TACTICAL.FERAL;
  const master = triggerOf(trigger);
  // (The one who set it off, to be near and seen: the attacker, the caster, the one who hurt it; on its own blow, the
  // one it hit.)
  const other = master === "ownHit" ? ctx.target ?? null : ctx.by ?? null;
  for ( const r of list ) {
    if ( !answersTo(r, trigger) || !ready(u, r, trigger) ) continue;
    if ( r.melee && !ctx.action?.melee ) continue;
    if ( r.ranged && ctx.action?.melee ) continue;
    if ( r.physical && !(ctx.types ?? []).some(t => PHYSICAL.has(t)) ) continue;
    if ( r.damageTypes?.length && !(ctx.types ?? []).some(t => r.damageTypes.includes(t)) ) continue;
    if ( r.crit && !ctx.crit ) continue;
    if ( r.actions?.length && !r.actions.includes(ctx.action?.id) ) continue;
    if ( MOVES.has(trigger) ) {
      const mover = ctx.ally ?? ctx.by;
      if ( !mover || !cameBeside(run, u, mover, r, trigger, ctx) || !perceives(run, u, mover) ) continue;
      if ( r.kin?.length && !(mover.spec.creatureTraits ?? []).some(k => r.kin.includes(k)) ) continue;
    } else if ( trigger === "allyHit" || trigger === "allyTargeted" ) {
      if ( !ctx.ally || !near(run, u, ctx.ally, r) || !perceives(run, u, ctx.ally) || refusesToHelp(run, u, ctx.ally) ) continue;
      // (The one who set it off as well, where the reaction says so: both inside a champion's aura.)
      if ( r.byRange && ctx.by && !near(run, u, ctx.by, { range: r.byRange }) ) continue;
    } else if ( !SELF.has(trigger) ) {
      if ( other && !near(run, u, other, r) ) continue;
      if ( other && !UNSEEN.has(master) && !perceives(run, u, other) ) continue;
    }
    const worth = worthOf(run, u, r, trigger, ctx);
    // (A counterspell burns a slot of its level: the dearer the slot, the more the spell has to be worth stopping.)
    const price = priceOf(u, r, trigger === "spell" ? 6 * Math.max(1, Number(r.counter?.level ?? r.level) || 3) : (ctx.damage ?? 5));
    const would = worth > 0 && (careless || worth >= price);
    // In a live battle the player (or the GM) may say otherwise: always, never, or asked (engine/live.js).
    if ( !(run.live ? run.live.decide(run, u, { reaction: r, trigger, by: other, ally: ctx.ally ?? null, would }) : would) ) continue;
    pay(u, r);
    return r;
  }
  return null;
}

/**
 * What a reaction would do for u here, in damage terms: what it does at this moment alone (its bonus to AC, what it
 * takes off a blow, a counterspell, staying up), and its effects that answer any moment (reaction-effects.js).
 */
function worthOf(run, u, r, trigger, ctx) {
  return momentWorth(run, u, r, trigger, ctx) + effectsWorth(run, u, r, trigger, ctx);
}

/** What belongs to the moment: a bonus to AC, a blow halved or lessened or taken instead, staying up, a counterspell. */
function momentWorth(run, u, r, trigger, ctx) {
  const expected = Math.max(0, ctx.damage ?? 0);
  switch ( trigger ) {
    case "attacked":
    case "allyTargeted":
      // A bonus to AC against one attack: about a tenth of the blow per point.
      return (r.ac ?? 0) * 0.1 * Math.max(1, expected);
    case "wouldDrop":
      // Still standing: worth a good part of a fight.
      return r.stayUp ? Math.max(5, (u.maxHp ?? 10) * 0.5) : 0;
    case "hit": {
      let w = 0;
      // A bonus to AC that turns this hit into a miss (not a natural 20), and keeps helping until its next turn.
      if ( r.ac && ctx.roll && !ctx.crit && ctx.roll.total < ctx.ac + r.ac ) w += expected + expected * 0.5;
      else if ( r.ac ) w += expected * 0.3;
      if ( r.halve ) w += expected / 2;
      if ( r.reduce ) w += Math.min(expected, meanPart(r.reduce));
      return w;
    }
    case "allyHit": {
      // What it takes off the friend's blow.
      let w = r.reduce ? Math.min(expected, meanPart(r.reduce)) : 0;
      // Taking it instead: worth more the more the friend needs it, less when it would drop the one taking it.
      if ( r.redirect ) w += expected * 0.5 + (ctx.ally && expected >= ctx.ally.hp ? expected : 0) - (expected >= u.hp ? expected : 0);
      return w;
    }
    case "spell": {
      if ( !r.counter ) return 0;
      // What the spell would do, roughly: the higher its level, the more; a hold or an area more still.
      const level = Number(ctx.action?.rank) || 1;
      let sure;
      if ( r.counter.save && ctx.by ) {
        // (5e 2024: the caster saves against it.)
        const s = saveRoll(run, ctx.by, r.counter.save.type);
        const dist = degreeDistribution(run.prep.rules, s.mod, Number(r.counter.save.dc) || 15, { advantage: s.advantage, kind: "save", roller: ctx.by });
        sure = dist[0] + dist[1];
      } else sure = (r.counter.level ?? 0) >= level ? 1 : Math.max(0.1, (21 - (10 + level - (r.counter.mod ?? 0))) / 20);
      const kind = ctx.action?.kind;
      const big = (kind === "control" ? 1.6 : 1) * (ctx.action?.area ? 1.5 : 1);
      return sure * level * 7 * big;
    }
    default: return 0;
  }
}

/**
 * Did `mover`'s move bring it beside u (a reaction's range; else a square beside it, diagonals too, or for a foe, into
 * u's melee reach)? A friend, ending there; a foe, from outside it. Off the map: a foe that reached u, a friend that
 * reached a foe u is beside.
 */
function cameBeside(run, u, mover, r, trigger, { from = null, toward = null, reached = false } = {}) {
  const reach = Number(r.range) > 0 ? Number(r.range) : trigger === "foeApproaches" ? riposteStrike(u)?.reach ?? 5 : 5 * Math.SQRT2;
  if ( !run.prep.options.positioning || !u.pos || !mover.pos ) {
    if ( !reached || !toward ) return false;
    return trigger === "foeApproaches" ? toward === u : u.adjacent.has(toward.id);
  }
  const now = edgeDistance(u, mover);
  if ( now === null || now > reach + 0.5 ) return false;
  return trigger === "allyMoves" || !from || edgeAt(mover, from, u) > reach + 0.5;
}
