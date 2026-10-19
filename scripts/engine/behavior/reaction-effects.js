/**
 * What a reaction does, whatever set it off: one set of effects, weighed and played here for every moment the engine
 * checks (responses.js respond). The moment decides only when they come and who set it off: the attacker, the caster,
 * the one who hurt or felled it, a foe come into its reach; for its own blow that lands (ownHit), the one it hit.
 *
 *   harm       {damage, save?, move?}: damage at the one who set it off, a save for less where it has one (basic unless
 *              save.basic is false), and a push or pull with it (on a failed save, where there is one). A reaction's own
 *              damage, save and move at its top level (5e Hellish Rebuke, Vengeful Fate) are its harm.
 *   afflict    {outcome?, save?, onSave?, traits?}: laid on the one who set it off (an outcome, effects.js: conditions
 *              with their values, bonuses and penalties, damage of its own at that degree). With a save: onSave by
 *              degree [critical failure, failure, success, critical success], or the outcome on a failure; with onSave
 *              and no save of its own, its harm's save (one roll for both). Its traits are the system's for immunity.
 *   boost      an outcome on itself (a short buff: bonuses, resistances, temporary hit points), until the end of its
 *              next turn unless it says longer.
 *   heal       damage parts: hit points it regains.
 *   recharge   an action id (or a list; true: every one of its own that recharges): used, it's ready again (a breath
 *              weapon back when a critical hit lands).
 *   strike     its best everyday strike at the one who set it off (strikeBack: in reach, a Step first, or a shot), or the
 *              strike an action id names (a list: the best of them); on ownHit, another blow at the one it hit.
 *   step       feet: a move of its own to the best spot it finds (bestStep).
 *   areaBurst  {damage, save, range}: at everyone up within range, a save for half.
 * Moment-bound effects stay with their moment (responses.js): ac, halve, reduce, redirect, counter, stayUp.
 *
 * When: as the moment comes (attacked and allyTargeted: before the roll, which a felled attacker never makes), except
 * that what answers a hit or a friend's hit lands once the blow is done (a buff on itself at once, for that blow's
 * damage). A live battle plays them as any action is played: the reaction's card (useAction), its damage rolled and
 * applied the system's way (rollDamage, applyDamageCard), saves rolled by the system (rollSave); what it lays and its
 * buffs reach the sheets with the turn's changes (a buff's or debuff's effect by the reaction's effectRef). A heal is the
 * engine's dice, as every heal's amount is.
 * Pure: no Foundry globals. The simulator's own moves come in `kit`.
 */
import { STATUS } from "../../constants.js";
import { isUp, isStanding, areEnemies, edgeDistance, heldOff, saveRoll, movesNeeded, canMove, canHeal } from "../battle-state.js";
import { meanPart, meanTotal, samplePart } from "../dice.js";
import { diceAt, tableRoll } from "../table-rolls.js";
import { meanDamageVs, threatOf, expectedDamage, saveMultiplier, hasAmmo } from "./evaluate.js";
import { degreeDistribution } from "../probability.js";
import { outcomeWorth, applyOutcome } from "./effects.js";
import { isImmune } from "./control.js";
import { stepSpots, edgeAt } from "./space.js";
import { triggerOf } from "../../story/master.js";
import { needsDraw, isLoaded } from "../gear.js";

/** The effects this file plays, in the order a reaction plays them. */
export const GENERAL_EFFECTS = Object.freeze(["step", "strike", "harm", "afflict", "areaBurst", "boost", "heal", "recharge"]);


/** A reaction's harm: its own `harm`, or its damage, save and move at its top level (the older way). */
export function harmOf(r) {
  if ( r?.harm && typeof r.harm === "object" ) return r.harm;
  return r && (r.damage?.length || r.move) ? { damage: r.damage ?? [], save: r.save ?? null, move: r.move ?? null } : null;
}

/** The general effects a reaction has (GENERAL_EFFECTS' keys). */
export function effectsOf(r) {
  if ( !r ) return [];
  const has = {
    step: Number(r.step) > 0, strike: !!r.strike, harm: !!harmOf(r), afflict: !!r.afflict, areaBurst: !!r.areaBurst?.damage?.length,
    boost: !!r.boost, heal: !!r.heal?.length, recharge: !!r.recharge
  };
  return GENERAL_EFFECTS.filter(k => has[k]);
}

export const hasEffects = r => effectsOf(r).length > 0;

/**
 * Who set the moment off, for the effects aimed at it: the attacker, the caster, the one who hurt or felled it, a foe
 * come into its reach (ctx.by); on its own blow that lands, the one it hit (ctx.target); none for a friend's move.
 */
export function setterOf(trigger, ctx = {}) {
  const t = triggerOf(trigger);
  if ( t === "ownHit" ) return ctx.target ?? null;
  if ( t === "allyMoves" ) return null;
  return ctx.by ?? null;
}

/* -------------------------------------------- */
/*  Strikes and steps                           */
/* -------------------------------------------- */

/** How good a strike is, roughly: its damage on average and half its bonus. */
const strikeScore = a => (a.damage ?? []).reduce((s, p) => s + meanPart(p), 0) + (a.bonus ?? 0) * 0.5;

/** An everyday strike: no multiattack, nothing it has only so much of. */
const everyday = a => a.kind === "strike" && !a.sequence && !a.resource && !Number.isFinite(a.uses);

/** The strikes a reaction names (r.strike an action id, or a list), or null for its best. */
const namedStrikes = r => (typeof r?.strike === "string" ? [r.strike] : Array.isArray(r?.strike) ? r.strike.filter(x => typeof x === "string") : null);

/** Its best everyday melee strike against `t`, as expected damage. */
function meanStrike(run, u, t) {
  let best = 0;
  for ( const a of u.prep.offense ) {
    if ( !everyday(a) || !a.melee ) continue;
    best = Math.max(best, meanDamageVs(run, a, t).normal * 0.6);
  }
  return best;
}

/** Its best everyday melee strike (for a riposte), or null. */
export function riposteStrike(u) {
  let best = null;
  for ( const a of u.prep.offense ) {
    if ( !everyday(a) || !a.melee ) continue;
    const score = strikeScore(a);
    if ( !best || score > best.score ) best = { a, score };
  }
  return best?.a ?? null;
}

/** Ready to strike with as a reaction: its ammunition, in hand, loaded. */
const ready = (u, a) => hasAmmo(u, a) && !needsDraw(u, a) && isLoaded(u, a);

/**
 * The strike u's reaction makes back at `foe`, as the reaction allows: {strike, step} or null. The strike it names (the
 * best of those it names that reach the foe), else its best everyday melee strike, the foe in reach; else, where it may
 * Step first (r.strikeStep, feet: PF2e Nimble Reprisal's 5), the foe that much past its reach (step: the feet it
 * steps); else, where it may shoot instead (r.strikeRanged: Nimble Reprisal), its best everyday ranged strike, the foe
 * in range and in sight. A shot only with the ammunition for it (action.ammo), in hand and loaded (engine/gear.js: no
 * time to draw or reload in a reaction).
 */
export function strikeBack(run, u, foe, r) {
  if ( !foe || !r ) return null;
  const named = namedStrikes(r);
  if ( named ) {
    let best = null;
    for ( const a of u.prep.offense ) {
      if ( a.kind !== "strike" || !named.includes(a.id) || !ready(u, a) || movesNeeded(run, u, foe, a) !== 0 ) continue;
      const score = strikeScore(a);
      if ( !best || score > best.score ) best = { a, score };
    }
    return best ? { strike: best.a, step: 0 } : null;
  }
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
      if ( !everyday(a) || a.melee || !a.range || !ready(u, a) ) continue;
      if ( movesNeeded(run, u, foe, a) !== 0 ) continue;
      const score = strikeScore(a);
      if ( !best || score > best.score ) best = { a, score };
    }
    if ( best ) return { strike: best.a, step: 0 };
  }
  return null;
}

/** What u's strike back at `foe` is worth (strikeBack), as expected damage, or nothing where it has none. */
export function strikeWorth(run, u, foe, r) {
  const back = strikeBack(run, u, foe, r);
  return back ? meanDamageVs(run, back.strike, foe).normal * 0.6 : 0;
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

/* -------------------------------------------- */
/*  Worth                                       */
/* -------------------------------------------- */

/** What the reaction lays at each degree of the save against it (afflict): its onSave, else its outcome on a failure. */
export function afflictionAt(a, degree) {
  if ( !a ) return null;
  if ( Array.isArray(a.onSave) ) return degree === null ? null : a.onSave[degree] ?? null;
  if ( degree === null ) return a.outcome ?? null;
  return degree <= 1 ? a.outcome ?? null : null;
}

/** The save an afflict rolls: its own, else (laid by degree) its harm's. */
const afflictSave = r => r.afflict?.save ?? (Array.isArray(r.afflict?.onSave) ? harmOf(r)?.save ?? null : null);

/** The reaction as an action, for the rules that hear what a roll or a hold is against: its id, name and traits. */
const asAction = r => ({ id: r.id, name: r.label ?? "", traits: [...(r.afflict?.traits ?? r.traits ?? [])] });

/** The chance of each degree of t's save (critical failure first), or [0, 0, 1, 0] with no save (it simply lands). */
function saveChances(run, u, t, save, r) {
  if ( !save ) return [0, 0, 1, 0];
  const s = saveRoll(run, t, save.type, { from: u, action: asAction(r) });
  return degreeDistribution(run.prep.rules, s.mod, Number(save.dc) || 10, { advantage: s.advantage, dice: s.dice, kind: "save", roller: t });
}

/** What laying it on t is worth to u: the harm it does t at each degree, as often as that degree comes. */
function afflictWorth(run, u, t, r) {
  const a = r.afflict;
  const outcomes = (Array.isArray(a.onSave) ? a.onSave : [a.outcome]).filter(o => o && typeof o === "object");
  if ( !outcomes.length || isImmune(run, t, { id: `reaction:${r.id}`, traits: asAction(r).traits, onSave: outcomes }) ) return 0;
  const save = afflictSave(r);
  const chances = saveChances(run, u, t, save, r);
  let w = 0;
  chances.forEach((p, d) => {
    const o = afflictionAt(a, save ? d : null);
    if ( o && p > 0 ) w -= p * outcomeWorth(run, u, t, o, { versus: u });
  });
  return Math.max(0, w);
}

/** The hit points a heal would mend: as many as it's missing (with the blow on its way, for a hit). */
function healWorth(run, u, r, trigger, ctx) {
  if ( !canHeal(u) || u.status === STATUS.DEAD ) return 0;
  const coming = ["hit", "attacked"].includes(triggerOf(trigger)) ? Math.max(0, ctx.damage ?? 0) : 0;
  return Math.min(meanTotal(r.heal), Math.max(0, (u.maxHp ?? 0) - (u.hp ?? 0) + coming));
}

/** Its own actions a recharge names, with uses (true: each one that recharges). */
function recharged(u, which) {
  const ids = which === true ? null : [].concat(which).filter(x => typeof x === "string");
  return (u.spec.actions ?? []).filter(a => Number.isFinite(a.uses) && (ids ? ids.includes(a.id) : !!(a.recharge || a.cooldown)));
}

/** What having its spent ones ready again is worth: a fair share of what one more use would do to a foe. */
function rechargeWorth(run, u, r, aim) {
  const foe = aim && isUp(aim) ? aim : (u.targetId ? run.byId.get(u.targetId) : null) ?? run.units.find(o => isStanding(o) && areEnemies(run, u, o)) ?? null;
  if ( !foe ) return 0;
  let w = 0;
  for ( const a of recharged(u, r.recharge) ) {
    if ( (u.uses[a.id] ?? 0) >= a.uses ) continue;
    w += expectedDamage(run, u, a, foe, 0) * 0.6;
  }
  return w;
}

/**
 * What the reaction's general effects are worth to u here, in damage terms: the harm it does (and, the more for one
 * that hurts it, hurting the one who did), what it lays and how much that hinders, a strike back, a better spot, a
 * burst, a buff or healing for itself, a spent action back.
 */
export function effectsWorth(run, u, r, trigger, ctx = {}) {
  const aim = setterOf(trigger, ctx);
  let w = 0;
  const harm = harmOf(r);
  if ( harm ) w += meanTotal(harm.damage) * (harm.save ? 0.65 : 1) + (aim ? threatOf(run, aim, u) * 0.1 : 0);
  if ( r.strike && aim ) w += strikeWorth(run, u, aim, r);
  if ( r.step ) w += bestStep(run, u, r.step)?.worth ?? 0;
  if ( r.areaBurst?.damage?.length ) w += meanTotal(r.areaBurst.damage) * (r.areaBurst.save ? 0.65 : 1);
  if ( r.afflict && aim && aim !== u && isUp(aim) ) w += afflictWorth(run, u, aim, r);
  if ( r.boost && isUp(u) ) w += Math.max(0, outcomeWorth(run, u, u, r.boost));
  if ( r.heal?.length ) w += healWorth(run, u, r, trigger, ctx);
  if ( r.recharge ) w += rechargeWorth(run, u, r, aim);
  return w;
}

/**
 * Would playing it now do anything? A strike only where one reaches (strikeBack, or the one found already), the rest
 * where they have someone to land on.
 */
export function wouldPlay(run, u, r, trigger, ctx = {}, { back } = {}) {
  const aim = setterOf(trigger, ctx);
  for ( const k of effectsOf(r) ) {
    if ( k === "strike" ) {
      if ( aim && (back !== undefined ? back : strikeBack(run, u, aim, r)) ) return true;
    } else if ( k === "harm" || k === "afflict" ) {
      if ( aim && aim !== u ) return true;
    } else return true;
  }
  return false;
}

/* -------------------------------------------- */
/*  Playing them                                */
/* -------------------------------------------- */

/**
 * Play a reaction's general effects (its line in the log is the caller's). `kit`: the simulator's moves {log, rollSave,
 * rollHit, landOutcome, reactStrike, stepAside, forceMove, showAction, appliedLive, noteHeal, testConcentration}.
 * Options: `only` / `skip` (effect keys), `back` (the strike back already found: strikeBack's, or null for none),
 * `tell` (how its own lines are told: later, with the attack it answers; else at once). Returns {struck}.
 */
export function playEffects(run, u, r, trigger, ctx, kit, { only = null, skip = null, back = undefined, tell = null } = {}) {
  const want = k => (!only || only.includes(k)) && !skip?.includes(k);
  const keys = effectsOf(r).filter(want);
  if ( !keys.length ) return { struck: false };
  const aim = setterOf(trigger, ctx);
  const going = triggerOf(trigger) === "slain";
  const say = tell ?? ((unit, data) => kit.log(run, unit, data));
  const play = { saves: new Map(), card: undefined };
  let struck = false;
  for ( const k of keys ) {
    // (On its way down (slain) it may still answer; otherwise only while it's up.)
    if ( !going && !isUp(u) ) break;
    if ( k === "step" ) {
      if ( u.pos ) kit.stepAside(run, u, r.step);
    } else if ( k === "strike" ) {
      if ( aim && isUp(aim) ) struck = kit.reactStrike(run, u, aim, r, !!run.log, back) || struck;
    } else if ( k === "harm" ) playHarm(run, u, r, aim, kit, play);
    else if ( k === "afflict" ) playAfflict(run, u, r, aim, kit, play);
    else if ( k === "areaBurst" ) playBurst(run, u, r, ctx, kit);
    else if ( k === "boost" ) {
      // (Outside its own turn, "until the end of its next turn" needs no extra round: thisTurn.)
      const own = triggerOf(trigger) === "ownHit";
      applyOutcome(u, own ? r.boost : { ...r.boost, thisTurn: true }, u.id, { id: r.id, name: r.label ?? "" });
      if ( run.log ) {
        say(u, { type: "buff", action: r.label ?? "", effect: r.boost.label ?? r.label ?? "", self: true, targets: [u.spec.name], targetIds: [u.id], withSelf: true,
          tempHp: Number(r.boost.tempHp) || 0, reaction: true });
      }
    } else if ( k === "heal" ) playHeal(run, u, r, kit, play);
    else if ( k === "recharge" ) {
      for ( const a of recharged(u, r.recharge) ) {
        if ( (u.uses[a.id] ?? 0) >= a.uses ) continue;
        u.uses[a.id] = a.uses;
        if ( u.readyAt ) delete u.readyAt[a.id];
        say(u, { type: "recharge", action: a.name, reaction: true });
      }
    }
  }
  return { struck };
}

/** The reaction's card, once a play (a live battle's: as its user shows it), or null. */
function cardOf(run, u, r, aim, kit, play) {
  if ( play.card === undefined ) play.card = run.live ? kit.showAction(run, u, { id: r.id, name: r.label ?? "" }, aim)?.card ?? null : null;
  return play.card;
}

/** A save the reaction calls for, rolled once a play (its harm and what it lays share it). */
function saveOnce(run, u, t, save, r, kit, play) {
  const key = `${t.id}|${[].concat(save.type).join("/")}|${save.dc}`;
  if ( !play.saves.has(key) ) play.saves.set(key, kit.rollSave(run, t, save.type, save.dc, { stakes: 0.3, label: r.label ?? "", from: u, action: asAction(r) }));
  return play.saves.get(key);
}

/** Its harm at the one who set it off: the save, the damage (a live battle's rolled and applied the system's way), the move. */
function playHarm(run, u, r, aim, kit, play) {
  const harm = harmOf(r);
  if ( !harm || !aim || aim === u || !isUp(aim) ) return;
  const rules = run.prep.rules;
  const what = { id: r.id, name: r.label ?? "" };
  let roll = null;
  let mult = 1;
  // (A live battle's: the reaction's card, and its damage the system's way, once.)
  const card = harm.damage?.length ? cardOf(run, u, r, aim, kit, play) : null;
  const rolled = harm.damage?.length && run.live ? run.live.roll?.(run, { kind: "damage", unitId: u.id, targetId: aim.id, card, action: what }) ?? null : null;
  if ( harm.save ) {
    roll = saveOnce(run, u, aim, harm.save, r, kit, play).roll;
    mult = saveMultiplier(rules, roll.degree, { basic: harm.save.basic !== false });
  }
  if ( harm.damage?.length && mult > 0 ) {
    const sys = rolled?.damage?.byType ? { byType: Object.fromEntries(Object.entries(rolled.damage.byType).map(([k, v]) => [k, Math.max(0, Math.floor(v * mult))])), card: rolled.card ?? null } : null;
    const hit = kit.rollHit(run, u, { id: `reaction:${r.id}`, name: r.label ?? "", damage: harm.damage }, aim, harm.damage, mult, false, 0, sys);
    // (The system's damage card, or the engine's dice shown as one: applied the system's way.)
    const amount = kit.appliedLive(run, u, aim, hit, hit.total, mult);
    const entry = run.log ? kit.log(run, u, { type: "auto", action: r.label, actionKind: "auto", damageType: harm.damage[0]?.type ?? "untyped", target: aim.spec.name, targetId: aim.id, damage: amount, reaction: true }) : null;
    hit.apply(amount, entry);
  }
  // (And moved: knocked back, on a failed save where it has one: Vengeful Fate.)
  if ( harm.move && isUp(aim) && (!roll || roll.degree < 2) ) kit.forceMove(run, u, aim, harm.move);
}

/** What it lays on the one who set it off: its save (or its harm's), and that degree's outcome, its own damage first. */
function playAfflict(run, u, r, aim, kit, play) {
  const a = r.afflict;
  if ( !a || !aim || aim === u || !isUp(aim) ) return;
  const save = afflictSave(r);
  let degree = null;
  if ( save ) {
    const shared = play.saves.has(`${aim.id}|${[].concat(save.type).join("/")}|${save.dc}`);
    const { roll, mod } = saveOnce(run, u, aim, save, r, kit, play);
    degree = roll.degree;
    if ( run.log && !shared ) {
      kit.log(run, aim, {
        type: "riderSave", name: r.label ?? "", by: u.spec.name, saveType: save.type, natural: roll.natural, mod, total: roll.total, dc: save.dc, degree: roll.degree, damage: 0, controls: true
      });
    }
  }
  const outcome = afflictionAt(a, save ? degree : null);
  if ( !outcome || isImmune(run, aim, { id: `reaction:${r.id}`, traits: asAction(r).traits, onSave: [outcome] }) ) return;
  const action = asAction(r);
  if ( outcome.damage?.length ) {
    const hit = kit.rollHit(run, u, { id: `reaction:${r.id}`, name: r.label ?? "", damage: outcome.damage }, aim, outcome.damage, 1, false);
    const dealt = kit.appliedLive(run, u, aim, hit, hit.total, 1);
    const entry = run.log ? kit.log(run, u, { type: "auto", action: r.label, actionKind: "auto", damageType: outcome.damage[0]?.type ?? "untyped", target: aim.spec.name, targetId: aim.id, damage: dealt, reaction: true }) : null;
    hit.apply(dealt, entry);
    if ( !isUp(aim) ) return;
  }
  const { damage: _d, ...rest } = outcome;
  if ( Object.keys(rest.conditions ?? {}).length || rest.mods ) kit.log(run, aim, { type: "condition", by: u.spec.name, effect: rest.label ?? "" });
  kit.landOutcome(run, u, aim, rest, action, { damage: false });
  kit.testConcentration(run, aim);
}

/** Its burst: everyone up within range (beside it, or the one whose blow felled it up close), a save for half. */
function playBurst(run, u, r, ctx, kit) {
  const burst = r.areaBurst;
  const rules = run.prep.rules;
  const range = Number(burst.range) || 5;
  for ( const t of run.units ) {
    if ( t === u || !isUp(t) ) continue;
    const d = u.adjacent.has(t.id) || (t === ctx.by && ctx.action?.melee) ? 0 : edgeDistance(u, t);
    if ( d === null || d > range + 0.5 ) continue;
    let mult = 1;
    if ( burst.save ) {
      const roll = kit.rollSave(run, t, burst.save.type, burst.save.dc, { stakes: 0.3, label: r.label }).roll;
      mult = saveMultiplier(rules, roll.degree, { basic: burst.save.basic !== false });
    }
    if ( mult <= 0 ) continue;
    const hit = kit.rollHit(run, u, { id: `reaction:${r.id}`, name: r.label ?? "", damage: burst.damage }, t, burst.damage, mult, false);
    const dealt = kit.appliedLive(run, u, t, hit, hit.total, mult);
    const entry = run.log ? kit.log(run, u, { type: "auto", action: r.label, actionKind: "auto", damageType: burst.damage[0]?.type ?? "untyped", target: t.spec.name, targetId: t.id, damage: dealt, reaction: true }) : null;
    hit.apply(dealt, entry);
  }
}

/** Hit points it regains (the engine's dice, as every heal's amount is; a live battle shows the reaction's card). */
function playHeal(run, u, r, kit, play) {
  if ( !canHeal(u) || u.status === STATUS.DEAD ) return;
  cardOf(run, u, r, u, kit, play);
  const at = diceAt(run);
  const amount = r.heal.reduce((s, p) => s + Math.max(0, samplePart(p, run.rng)), 0);
  if ( at >= 0 ) tableRoll(run, at, { by: u, target: u, kind: "healing", label: r.label ?? "", parts: r.heal, total: amount });
  const before = u.hp;
  const wasDown = u.status === STATUS.DOWN;
  if ( amount > 0 ) run.prep.rules.onHealed(u, amount);
  kit.noteHeal(run, u, u, u.hp - before, wasDown && u.status === STATUS.STANDING, { action: r.label ?? "" });
}
