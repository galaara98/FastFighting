/**
 * Reactions that answer something done to a creature (opportunity attacks, which answer a foe walking away, are in
 * reactions.js): a spell that turns a hit into a miss, a dodge that halves a blow, fire for whoever hurt you, a
 * counterspell, a shield raised against a blow, a riposte, a step when a friend comes beside it.
 *
 * spec.reactions: [{id, label, on, ...what it does, resource?, amount?, uses?, range?, melee?, physical?, tell?}]
 *   on "attacked"   a foe attacks it, before the roll:          ac (a bonus against this attack: PF2e Nimble Dodge)
 *   on "hit"        an attack hits it, before the damage:        ac (5e Shield: +ac until its next turn, perhaps
 *                                                                a miss after all), halve (5e Uncanny Dodge), reduce
 *                                                                (a DamagePart taken off: 5e Parry, PF2e Shield Block)
 *   on "missed"     a melee attack misses it:                   strike (5e Riposte: its best melee strike back)
 *   on "damaged"    a foe's blow hurt it:                       damage and save (5e Hellish Rebuke, at the foe)
 *   on "allyHit"    an attack hits a friend near it (range):     reduce (taken off the friend's damage) and strike
 *                                                                (a strike back at the attacker: strikeBack, PF2e
 *                                                                Retributive Strike, Glimpse of Redemption ...);
 *                                                                redirect: it takes the blow instead, against its own
 *                                                                resistances (PF2e guardian's Intercept Attack);
 *                                                                applies: the system's own application does the
 *                                                                reduce (PF2e's Champion's Resistance), as for the
 *                                                                target's own reactions
 *   on "spell"      a foe casts a spell it can see:             counter: {level, mod} (5e Counterspell: a spell of
 *   ("foeCasts")                                                 its level or lower simply fails; a higher one if
 *                                                                the check beats 10 + its level)
 *   on "allyTargeted"  a foe attacks a friend near it (range):    ac (a bonus to the friend's defense against it: 5e
 *                                                                Protection, Shield of the Cavalier)
 *   on "wouldDrop"  a blow would drop it:                        stayUp: {hp, wounded} (it stays up at hp, 1 unless
 *                                                                said: PF2e Orc Ferocity, 5e Relentless Endurance)
 *   on "slain"      it drops or dies:                            areaBurst: {damage, save, range} at everyone within
 *                                                                range (5e Death Burst); answered on the way down
 *   on "allyMoves"  a friend ends a move beside it (range; a     step: feet (a move of its own to a better spot, the
 *                   square beside it if not said)                best it finds: PF2e Goblin Scuttle's Step)
 *   on "foeApproaches"  a foe ends a move in its reach (range;   strike (its best melee strike at it), step
 *                   its melee reach if not said), from outside it
 *   kin             only for those with one of these creature traits (Goblin Scuttle: a goblin friend)
 *   on              a trigger from the master list (story/master.js REACTION_TRIGGERS), an older name ("spell"), or a
 *                   list of them
 *   free            it costs no reaction (a creature's nature: a death burst)
 *   range           how far it reaches, in feet (default: anywhere); melee / ranged: only those attacks; physical: only
 *                   bludgeoning, piercing and slashing; needsShield: only with its shield raised
 *   byRange         a friend's reaction (allyHit, allyTargeted): how near the one who set it off must be too, in feet
 *                   (PF2e's champion's reactions: both the friend and the foe inside its aura)
 *   strikeRanged    its strike back may be a shot, at a foe out of reach but in range (PF2e Nimble Reprisal)
 *   strikeStep      feet it may Step first to bring the foe into reach for its strike back (Nimble Reprisal's 5)
 * Each takes the creature's reaction for the round, and whatever it says it costs. A creature uses it when it's
 * worth what it costs (the same reckoning as riders.js), thinking creatures more wisely than feral ones.
 * Pure: no Foundry globals.
 */
import { TACTICAL } from "../../constants.js";
import { liveTier, edgeDistance, isUp, isStanding, areEnemies, heldOff, saveRoll, movesNeeded, refusesToHelp, canMove } from "../battle-state.js";
import { meanPart } from "../dice.js";
import { meanDamageVs, threatOf } from "./evaluate.js";
import { degreeDistribution } from "../probability.js";
import { perceives } from "./senses.js";
import { edgeAt, stepSpots } from "./space.js";
import { answersTo } from "../../story/master.js";

const PHYSICAL = new Set(["bludgeoning", "piercing", "slashing", "physical"]);
/** Moments about itself alone: whoever caused them, near or seen or not. */
const SELF = new Set(["wouldDrop", "slain"]);
/** Moments a creature's move makes, ending beside it. */
const MOVES = new Set(["allyMoves", "foeApproaches"]);

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
 *                            | "allyMoves" | "foeApproaches"
 * @param {object} ctx        {by, action, roll, ac, crit, damage (expected), types (damage types), spell}; a move's:
 *                            {by (a foe) | ally, from (where it set out), toward, reached}
 */
export function respond(run, u, trigger, ctx) {
  const list = u.spec.reactions;
  if ( !list?.length ) return null;
  const tier = liveTier(run, u);
  const careless = tier <= TACTICAL.FERAL;
  for ( const r of list ) {
    if ( !answersTo(r, trigger) || !ready(u, r, trigger) ) continue;
    if ( r.melee && !ctx.action?.melee ) continue;
    if ( r.ranged && ctx.action?.melee ) continue;
    if ( r.physical && !(ctx.types ?? []).some(t => PHYSICAL.has(t)) ) continue;
    if ( MOVES.has(trigger) ) {
      const mover = ctx.ally ?? ctx.by;
      if ( !mover || !cameBeside(run, u, mover, r, trigger, ctx) || !perceives(run, u, mover) ) continue;
      if ( r.kin?.length && !(mover.spec.creatureTraits ?? []).some(k => r.kin.includes(k)) ) continue;
    } else if ( trigger === "allyHit" || trigger === "allyTargeted" ) {
      if ( !ctx.ally || !near(run, u, ctx.ally, r) || !perceives(run, u, ctx.ally) || refusesToHelp(run, u, ctx.ally) ) continue;
      // (The one who set it off as well, where the reaction says so: both inside a champion's aura.)
      if ( r.byRange && ctx.by && !near(run, u, ctx.by, { range: r.byRange }) ) continue;
    } else if ( !SELF.has(trigger) ) {
      if ( ctx.by && !near(run, u, ctx.by, r) ) continue;
      if ( ctx.by && trigger !== "hit" && trigger !== "attacked" && !perceives(run, u, ctx.by) ) continue;
    }
    const worth = worthOf(run, u, r, trigger, ctx);
    // (A counterspell burns a slot of its level: the dearer the slot, the more the spell has to be worth stopping.)
    const price = priceOf(u, r, trigger === "spell" ? 6 * Math.max(1, Number(r.counter?.level ?? r.level) || 3) : (ctx.damage ?? 5));
    const would = worth > 0 && (careless || worth >= price);
    // In a live battle the player (or the GM) may say otherwise: always, never, or asked (engine/live.js).
    if ( !(run.live ? run.live.decide(run, u, { reaction: r, trigger, by: ctx.by ?? null, ally: ctx.ally ?? null, would }) : would) ) continue;
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
    case "allyTargeted":
      // A bonus to AC against one attack: about a tenth of the blow per point.
      return (r.ac ?? 0) * 0.1 * Math.max(1, expected);
    case "wouldDrop":
      // Still standing: worth a good part of a fight.
      return r.stayUp ? Math.max(5, (u.maxHp ?? 10) * 0.5) : 0;
    case "slain":
      return (r.areaBurst?.damage ?? []).reduce((s, p) => s + Math.max(0, meanPart(p)), 0) * (r.areaBurst?.save ? 0.65 : 1);
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
      return r.strike ? strikeWorth(run, u, ctx.by, r) : 0;
    case "allyHit": {
      // What it takes off the friend's blow, and a strike back at the attacker if it's within reach.
      let w = r.reduce ? Math.min(expected, meanPart(r.reduce)) : 0;
      // Taking it instead: worth more the more the friend needs it, less when it would drop the one taking it.
      if ( r.redirect ) w += expected * 0.5 + (ctx.ally && expected >= ctx.ally.hp ? expected : 0) - (expected >= u.hp ? expected : 0);
      if ( r.strike && ctx.by ) w += strikeWorth(run, u, ctx.by, r);
      return w;
    }
    case "damaged": {
      const dmg = (r.damage ?? []).reduce((s, p) => s + Math.max(0, meanPart(p)), 0);
      return dmg * (r.save ? 0.65 : 1) + (ctx.by ? threatOf(run, ctx.by, u) * 0.1 : 0);
    }
    case "allyMoves":
    case "foeApproaches": {
      // A strike at the foe come into reach; a step to a better spot.
      let w = 0;
      if ( r.strike && ctx.by ) w += strikeWorth(run, u, ctx.by, r);
      if ( r.step ) w += bestStep(run, u, r.step)?.worth ?? 0;
      return w;
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

/** How good a strike is, roughly: its damage on average and half its bonus. */
const strikeScore = a => (a.damage ?? []).reduce((s, p) => s + meanPart(p), 0) + (a.bonus ?? 0) * 0.5;

/** Its best everyday melee strike (for a riposte), or null. */
export function riposteStrike(u) {
  let best = null;
  for ( const a of u.prep.offense ) {
    if ( a.kind !== "strike" || !a.melee || a.sequence || a.resource || Number.isFinite(a.uses) ) continue;
    const score = strikeScore(a);
    if ( !best || score > best.score ) best = { a, score };
  }
  return best?.a ?? null;
}

/**
 * The strike u's reaction makes back at `foe`, as the reaction allows: {strike, step} or null. Its best everyday melee
 * strike, the foe in reach; else, where it may Step first (r.strikeStep, feet: PF2e Nimble Reprisal's 5), the foe that
 * much past its reach (step: the feet it steps); else, where it may shoot instead (r.strikeRanged: Nimble Reprisal),
 * its best everyday ranged strike, the foe in range and in sight.
 */
export function strikeBack(run, u, foe, r) {
  if ( !foe || !r ) return null;
  const melee = riposteStrike(u);
  if ( melee && movesNeeded(run, u, foe, melee) === 0 ) return { strike: melee, step: 0 };
  const step = Number(r.strikeStep) || 0;
  if ( melee && step > 0 && u.pos && foe.pos && canMove(run, u) ) {
    const d = edgeDistance(u, foe);
    if ( d !== null && d <= (melee.reach ?? 5) + step + 0.5 ) return { strike: melee, step };
  }
  if ( r.strikeRanged ) {
    let best = null;
    for ( const a of u.prep.offense ) {
      if ( a.kind !== "strike" || a.melee || !a.range || a.sequence || a.resource || Number.isFinite(a.uses) ) continue;
      if ( movesNeeded(run, u, foe, a) !== 0 ) continue;
      const score = strikeScore(a);
      if ( !best || score > best.score ) best = { a, score };
    }
    if ( best ) return { strike: best.a, step: 0 };
  }
  return null;
}

/** What u's strike back at `foe` is worth (strikeBack), as expected damage, or nothing where it has none. */
function strikeWorth(run, u, foe, r) {
  const back = strikeBack(run, u, foe, r);
  return back ? meanDamageVs(run, back.strike, foe).normal * 0.6 : 0;
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

/**
 * The best spot for u to step to now, `feet` at most (a reaction's step: PF2e Goblin Scuttle), and what it gains, in
 * damage terms: a fighter, a foe in reach to strike next (more so one a friend is beside too: flanked); anyone, out
 * of the reach of foes that could strike it (a shooter or a caster most of all). Null where nowhere is better by much.
 * {to: {x, y}, worth}.
 */
export function bestStep(run, u, feet) {
  if ( !run.prep.options.positioning || !u.pos || !(feet > 0) ) return null;
  const foes = run.units.filter(o => o !== u && o.pos && isStanding(o) && areEnemies(run, u, o) && !heldOff(run, u, o));
  if ( !foes.length ) return null;
  const melee = riposteStrike(u);
  const shooter = !melee || u.prep.offense.some(a => a.kind === "strike" && a.range && !a.melee && strikeScore(a) > strikeScore(melee));
  const foe = foes.map(f => {
    const theirs = riposteStrike(f);
    const flanked = run.units.some(a => a !== u && a.side === u.side && a.pos && isStanding(a) && (edgeDistance(a, f) ?? Infinity) <= 5.5);
    return { f, reach: theirs ? (theirs.reach ?? 5) : -1, harm: theirs ? meanStrike(run, f, u) : 0, mine: melee && !shooter ? meanStrike(run, u, f) * (flanked ? 1.25 : 1) : 0 };
  });
  const value = p => {
    let v = 0;
    let best = 0;
    for ( const { f, reach, harm, mine } of foe ) {
      const d = edgeAt(u, p, f);
      if ( reach >= 0 && d <= reach + 0.5 ) v -= harm * (shooter ? 1 : 0.5);
      if ( mine && d <= (melee.reach ?? 5) + 0.5 ) best = Math.max(best, mine);
    }
    return v + best;
  };
  const here = value(u.pos);
  let best = null;
  for ( const p of stepSpots(run, u, feet) ) {
    const gain = value(p) - here;
    if ( gain >= 1 && (!best || gain > best.worth) ) best = { to: p, worth: gain };
  }
  return best;
}
