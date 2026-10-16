/**
 * Timed effects: crowd control, buffs and debuffs, as one thing. A control action's outcome at a degree, a buff, a
 * save rider: each is an outcome
 *   {conditions?, mods?, tempHp?, mark?, rounds, label, endsOnDamage?, repeatSave?, onlyVs?, self?}
 *     conditions   the system's condition keys (and the engine's own: prone, immobilized, incapacitated, and
 *                  controlled: charmed or dominated, it fights for whoever laid it on, until it ends)
 *     mods         bonuses and penalties (see engine/mods.js)
 *     tempHp       temporary hit points when it lands (they don't stack: the better stays)
 *     mark         damage parts added to the source's own hits against it (Hunter's Mark, Hex)
 *     repeatSave   {type, dc}: a save at the end of each of its turns ends it (5e Hold Person)
 *     onlyVs       its conditions hold only against the source (PF2e Feint: off-guard to the feinter)
 *     self         it lands on the one who acted, not the target (PF2e Trip, critically failed: you fall)
 *     endsOnHarm   it ends when its source or the source's side harms the bearer (5e Charm Person)
 *     iwr          {resist: {type: value}, immune: [types], weak: {type: value}} for as long as it lasts (Rage, Stoneskin)
 *     actionsNow   main-pool units it gains at once, this turn only (5e Action Surge)
 *     uses         spent after that many rolls it helps (or, for a mark on its defense, attacks against it): 5e Help,
 *                  Guidance, Bardic Inspiration, PF2e Aid and Sure Strike, Ironsworn "+1 on your next move"
 *     vs           a creature id: its bonuses count only for rolls against that one (its attacks, or its words or
 *                  first aid aimed at it)
 *     vsFocus      laid on a friend: against whoever that friend is set on (the foe it would hurt, the one it would
 *                  talk to, the friend it would tend), worked out when it lands
 *     vsSort       a sort of creature (battle-state.js sortOf): a boost against every one of that sort
 *     boost        its rolls against `vs` are about this many times as likely to succeed as they would have been
 *                  (worked out roll by roll, as far as the dice allow): a Lore-Collector's payoff for sizing a foe up
 *     thisTurn     laid on itself, it lasts only to the end of this turn (not through its next one)
 *     resources    resources it gains at once ({momentum: 2}): the system says how (rules.gainResource)
 *     taunt        a taunt: for as long as it lasts, the bearer wants to go for whoever laid it on, this badly (a
 *                  desire level, 0 to 100; true: TAUNT, "driven"). It's a desire like any other (behavior/desire.js):
 *                  stronger reasons of its own (an obsession, a grudge, a cruel streak) can still win out, and a
 *                  taunter it can't reach wears it down. The want ends early when the taunter falls (its `defy`
 *                  runs its rounds).
 *     defy         with a taunt: what ignoring it costs, bonuses and penalties (as mods) on the bearer's rolls against
 *                  anyone but the taunter (5e Compelled Duel: {adv: -1}; PF2e Taunt: {attack: -1})
 * Everything is optional: an outcome with nothing the engine understands does nothing. Effects from the same action
 * and source refresh rather than pile up; an action with `concentration` holds them only while its source keeps
 * concentrating (one at a time; damage may break it, if the system says how).
 * Pure: no Foundry globals.
 */
import { STATUS, clamp } from "../../constants.js";
import { combineMods, diceMean } from "../mods.js";
import { isStanding, areEnemies, enemiesOf, alliesOf, boostReaches, wish, behaviorOf } from "../battle-state.js";
import { threatOf, unitsPerTurn, attacksIn } from "./evaluate.js";
import { meanPart } from "../dice.js";

/** How badly a taunt makes its bearer want to go for the taunter, unless it says: "driven", above a clear choice. */
export const TAUNT = 65;

/* -------------------------------------------- */
/*  Applying                                    */
/* -------------------------------------------- */

/** Work out a unit's conditions, bonuses and marks from what's on it (base, timed effects, afflictions). */
export function recompute(u) {
  const conds = { ...u.baseConds };
  const vs = new Map();
  const mods = [].concat(u.baseMods ?? []);
  const marks = [];
  let controlledBy = null;
  const extra = { resist: {}, immune: new Set(), weak: {} };
  let hardened = false;
  const raise = (into, k, v) => {
    const value = v === true ? 1 : Number(v) || 0;
    into[k] = Math.max(into[k] ?? 0, value);
  };
  const against = new Map(); // bonuses that count against one creature only: id -> [mods]
  const defied = new Map(); // a taunt's price, paid against everyone but the taunter: id -> [mods]
  for ( const e of u.effects ?? [] ) {
    if ( e.onlyVs && e.sourceId ) {
      const row = vs.get(e.sourceId) ?? {};
      for ( const [k, v] of Object.entries(e.conditions ?? {}) ) raise(row, k, v);
      vs.set(e.sourceId, row);
    } else for ( const [k, v] of Object.entries(e.conditions ?? {}) ) raise(conds, k, v);
    if ( e.mods && e.vs ) {
      if ( !against.has(e.vs) ) against.set(e.vs, []);
      against.get(e.vs).push(e.mods);
    } else if ( e.mods ) mods.push(e.mods);
    if ( e.defy && e.sourceId ) {
      mods.push(e.defy);
      if ( !defied.has(e.sourceId) ) defied.set(e.sourceId, []);
      defied.get(e.sourceId).push(e.defy);
    }
    if ( e.mark?.length && e.sourceId ) marks.push({ by: e.sourceId, parts: e.mark });
    if ( e.sourceId && (Number(e.conditions?.controlled) || 0) > 0 ) controlledBy = e.sourceId; // the latest hold wins
    if ( e.iwr ) {
      hardened = true;
      for ( const [k, v] of Object.entries(e.iwr.resist ?? {}) ) extra.resist[k] = Math.max(extra.resist[k] ?? 0, Number(v) || 0);
      for ( const [k, v] of Object.entries(e.iwr.weak ?? {}) ) extra.weak[k] = Math.max(extra.weak[k] ?? 0, Number(v) || 0);
      for ( const k of e.iwr.immune ?? [] ) extra.immune.add(k);
    }
  }
  for ( const a of u.afflictions ?? [] ) {
    if ( a.onsetLeft > 0 ) continue; // not taken hold yet
    const stage = a.spec.stages[a.stage - 1];
    for ( const [k, v] of Object.entries(stage?.conditions ?? {}) ) raise(conds, k, v);
  }
  u.conds = conds;
  u.vs = vs.size ? vs : null;
  u.mods = combineMods(mods);
  // (Against one creature: those bonuses with everything else it has, the best of each kind still counting; against a
  // taunter, without what ignoring its taunt costs.)
  u.edgeMods = null;
  if ( against.size || defied.size ) {
    u.edgeMods = new Map();
    for ( const id of new Set([...against.keys(), ...defied.keys()]) ) {
      const spared = defied.get(id);
      const base = spared ? mods.filter(m => !spared.includes(m)) : mods;
      u.edgeMods.set(id, combineMods([...base, ...(against.get(id) ?? [])]));
    }
  }
  u.marks = marks;
  u.controlledBy = controlledBy;
  // Resistances an effect lends (Rage, Stoneskin) on top of its own: the better of each counts.
  if ( hardened ) {
    const base = u.spec.iwr ?? {};
    const resist = { ...(base.resist ?? {}) };
    for ( const [k, v] of Object.entries(extra.resist) ) resist[k] = Math.max(resist[k] ?? 0, v);
    const weak = { ...(base.weak ?? {}) };
    for ( const [k, v] of Object.entries(extra.weak) ) weak[k] = Math.max(weak[k] ?? 0, v);
    u.iwr = { ...base, resist, weak, immune: [...new Set([...(base.immune ?? []), ...extra.immune])] };
    u.iwrKey = JSON.stringify([extra.resist, extra.weak, [...extra.immune]]);
  } else {
    u.iwr = null;
    u.iwrKey = "";
  }
}

/** A condition comes off, wherever it came from (its timed effects; the one it started with): Daggerheart's Hidden, when it attacks. */
export function dropCondition(u, key) {
  if ( !u?.conds?.[key] ) return false;
  u.effects = (u.effects ?? []).filter(e => !e.conditions?.[key]);
  if ( u.baseConds ) delete u.baseConds[key];
  recompute(u);
  return true;
}

/** Its immunities, weaknesses and resistances right now (its own, and any an effect lends it). */
export function iwrOf(u) {
  return u.iwr ?? u.spec.iwr;
}

/**
 * Charmed or dominated creatures fight for whoever holds them, and come back to their own side the moment the
 * hold ends (or its holder falls). Returns the creatures whose side just changed: [{u, joined, home}].
 */
export function settleAllegiance(run) {
  const changed = [];
  for ( const u of run.units ) {
    const holder = u.controlledBy ? run.byId.get(u.controlledBy) : null;
    const home = u.homeSide ?? u.side;
    const side = holder && holder.status === STATUS.STANDING && holder.side !== home ? holder.side : home;
    if ( u.side === side || [STATUS.DEAD, STATUS.FLED].includes(u.status) ) continue;
    u.side = side;
    u.targetId = null;
    u.wavering = false;
    run.geo = (run.geo ?? 0) + 1; // friends and foes have changed
    changed.push({ u, joined: side !== home, home, holder });
  }
  return changed;
}

/**
 * Lay an outcome on a target. Returns the effect, or null if nothing lasting came of it (temporary hit points and
 * a knockdown happen at once). `action` (optional) names it, so the same effect refreshes instead of piling up.
 */
export function applyOutcome(target, outcome, sourceId = null, action = null) {
  if ( !target || !outcome || typeof outcome !== "object" ) return null;
  const conditions = { ...(outcome.conditions ?? {}) };
  if ( conditions.prone ) {
    target.prone = true;
    delete conditions.prone;
  }
  const temp = Math.round(Number(outcome.tempHp) || 0);
  if ( temp > 0 ) target.temp = Math.max(target.temp ?? 0, temp);
  const mods = outcome.mods && typeof outcome.mods === "object" && Object.keys(outcome.mods).length ? outcome.mods : null;
  const mark = Array.isArray(outcome.mark) && outcome.mark.length ? outcome.mark : null;
  const iwr = outcome.iwr && typeof outcome.iwr === "object" && (Object.keys(outcome.iwr.resist ?? {}).length || outcome.iwr.immune?.length || Object.keys(outcome.iwr.weak ?? {}).length) ? outcome.iwr : null;
  const boost = Number(outcome.boost) > 1 ? Number(outcome.boost) : null;
  // (A taunt needs a taunter, and someone else to be taunted.)
  const taunt = sourceId && target.id !== sourceId ? tauntLevel(outcome.taunt) : 0;
  const defy = taunt && outcome.defy && typeof outcome.defy === "object" && Object.keys(outcome.defy).length ? { ...outcome.defy } : null;
  if ( !Object.keys(conditions).length && !mods && !mark && !iwr && !boost && !taunt ) return null;
  const key = action?.id ?? outcome.label ?? null;
  if ( key !== null ) target.effects = (target.effects ?? []).filter(e => !(e.key === key && e.sourceId === sourceId));
  // Effects run out at the end of the bearer's turns; one it lays on itself during its own turn would lose a round
  // straight away, so "until your next turn" gets the extra one it needs.
  const self = sourceId !== null && target.id === sourceId;
  const effect = {
    key, conditions, mods, mark, iwr, sourceId,
    rounds: Math.max(1, Math.round(Number(outcome.rounds) || 1)) + (self && !outcome.thisTurn ? 1 : 0),
    endsOnDamage: !!outcome.endsOnDamage,
    endsOnHarm: !!outcome.endsOnHarm,
    label: outcome.label ?? action?.name ?? "",
    concentration: !!action?.concentration,
    repeatSave: outcome.repeatSave?.type && Number.isFinite(Number(outcome.repeatSave.dc)) ? { type: outcome.repeatSave.type, dc: Number(outcome.repeatSave.dc) } : null,
    // (One an action breaks: behavior/holds.js. {dc, others, with}.)
    ...(outcome.escape ? { escape: { dc: Number.isFinite(Number(outcome.escape.dc)) ? Number(outcome.escape.dc) : null, others: outcome.escape.others ?? null, with: outcome.escape.with ?? null } } : {}),
    onlyVs: !!outcome.onlyVs,
    uses: Number(outcome.uses) > 0 ? Math.round(Number(outcome.uses)) : null,
    vs: typeof outcome.vs === "string" && outcome.vs ? outcome.vs : null,
    vsSort: typeof outcome.vsSort === "string" && outcome.vsSort ? outcome.vsSort : null,
    boost,
    taunt: taunt || null,
    defy
  };
  (target.effects ??= []).push(effect);
  recompute(target);
  return effect;
}

/**
 * How readily u shrugs off a taunt as it lands, any taunt (a playstyle's, a skill, a power, a spell): its playstyles'
 * (behavior tauntProof: Relentless most, then Skeptic, Peacekeeper, Puzzle-Maniac, Diplomat, Chicken, Wallflower,
 * Lazy), at most 90%.
 */
export function tauntProof(u) {
  return clamp(Number(behaviorOf(u).tauntProof) || 0, 0, 0.9);
}

/** An outcome without its taunt (shrugged off, and with it what ignoring it would cost): the rest, or null if that was all. */
export function withoutTaunt(outcome) {
  const { taunt, defy, ...rest } = outcome;
  const does = ["conditions", "mods", "mark", "iwr", "boost", "tempHp", "resources", "actionsNow"]
    .some(k => rest[k] && (typeof rest[k] !== "object" || Object.keys(rest[k]).length));
  return does ? rest : null;
}

/** How badly an outcome's taunt makes its bearer want the taunter: 0 (none) to 100; true is TAUNT. */
export function tauntLevel(taunt) {
  if ( taunt === true ) return TAUNT;
  const level = Number(taunt);
  return level > 0 ? clamp(level, 0, 100) : 0;
}

/** The bonuses each kind of roll draws on (and, for "defend", the marks that make it easier to hit). */
const ROLL_KEYS = Object.freeze({
  attack: ["attack", "attackDie", "adv", "damage"], check: ["checks", "checkDie", "checkAdv"], save: ["saves", "saveDie", "saveAdv"], defend: ["defAdv", "ac"]
});

/**
 * A roll was made: effects good for only so many rolls (`uses`) that helped it are spent (for one against a single
 * creature, only a roll against that one). `kind`: attack, check, save, or defend (an attack against u).
 */
export function spendEdges(u, kind, targetId = null) {
  const keys = ROLL_KEYS[kind];
  if ( !keys || !u?.effects?.length ) return;
  let spent = false;
  for ( const e of u.effects ) {
    if ( !(e.uses > 0) || !e.mods || (e.vs && e.vs !== targetId) ) continue;
    if ( !keys.some(k => e.mods[k]) ) continue;
    e.uses -= 1;
    spent = true;
  }
  if ( !spent ) return;
  u.effects = u.effects.filter(e => e.uses !== 0);
  recompute(u);
}

/**
 * A roll a boost helps was made (an attack, or words, at `target`): a boost good for so many rolls (`uses`) is spent
 * by it, the strongest first.
 */
export function spendBoost(u, target = null) {
  const e = (u?.effects ?? []).filter(x => x.boost > 1 && x.uses > 0 && boostReaches(x, target)).sort((a, b) => b.boost - a.boost)[0];
  if ( !e ) return;
  e.uses -= 1;
  if ( e.uses === 0 ) u.effects = u.effects.filter(x => x !== e);
}

/**
 * Whoever t is set on: the foe it would hurt, the one it would talk to, or the friend it would tend (its strongest
 * such desire last turn, else the foe it was fighting): {unit, kind}, or null.
 */
export function focusOf(run, t) {
  for ( const d of t.lastDesires ?? [] ) {
    if ( !["hurt", "talk", "heal"].includes(d.kind) ) continue;
    const o = run.byId.get(d.targetId);
    if ( o && o !== t && o.status !== STATUS.DEAD && o.status !== STATUS.FLED ) return { unit: o, kind: d.kind };
  }
  const current = t.targetId ? run.byId.get(t.targetId) : null;
  return current && isStanding(current) && areEnemies(run, t, current) ? { unit: current, kind: "hurt" } : null;
}

/**
 * Does the target already carry this action's effect (from this source, or anyone's)? Effects run out at the end of
 * the bearer's turn, so one that's there still covers its next turn: doing it again now gains nothing.
 */
export function hasFresh(target, action, sourceId = null) {
  return (target.effects ?? []).some(e => e.key === action.id && (sourceId === null || e.sourceId === sourceId));
}

/** Begin concentrating on an action: whatever the source held before ends first. */
export function beginConcentration(run, u, action) {
  if ( !action?.concentration ) return [];
  const ended = u.concentration && u.concentration.actionId !== action.id ? endConcentration(run, u) : [];
  u.concentration = { actionId: action.id, name: action.name, worth: 0, round: run.round };
  return ended;
}

/** Stop concentrating: every effect it held ends. Returns the labels that ended. */
export function endConcentration(run, u) {
  const ended = new Set();
  for ( const o of run.units ) {
    if ( !o.effects?.length ) continue;
    const before = o.effects.length;
    o.effects = o.effects.filter(e => {
      const held = e.concentration && e.sourceId === u.id;
      if ( held ) ended.add(e.label);
      return !held;
    });
    if ( o.effects.length !== before ) recompute(o);
  }
  u.concentration = null;
  return [...ended];
}

/**
 * A single-target effect u is holding (a mark, a hold) moves when u lays it on someone new: it leaves the others.
 * Returns whether anyone else still had it standing (then moving it costs what it was doing there).
 */
export function heldElsewhere(run, u, action, target = null) {
  if ( !action?.concentration || action.area || action.aura || u.concentration?.actionId !== action.id ) return false;
  return run.units.some(o => o !== target && o.status === STATUS.STANDING && o.effects?.some(e => e.key === action.id && e.sourceId === u.id));
}

export function moveHeld(run, u, action, target) {
  if ( !action?.concentration || action.area || action.aura ) return;
  for ( const o of run.units ) {
    if ( o === target || !o.effects?.some(e => e.key === action.id && e.sourceId === u.id) ) continue;
    o.effects = o.effects.filter(e => !(e.key === action.id && e.sourceId === u.id));
    recompute(o);
  }
}

/** Is u still holding anything up with its concentration? (A spell everyone resisted holds nothing.) */
export function holdsAnything(run, u) {
  return run.units.some(o => o.effects?.some(e => e.concentration && e.sourceId === u.id)
    // (or creatures it called and holds here with its concentration)
    || (o.summoner === u.id && !o.vanished && o.status !== STATUS.DEAD && o.summonedBy === u.concentration?.actionId));
}

/* -------------------------------------------- */
/*  Worth                                       */
/* -------------------------------------------- */

/** One point on a d20 roll: about 8.5% more (or less) of what that roll decides, at a typical chance to hit. */
const D20_POINT = 0.085;
/** Advantage or disadvantage: worth about four points. */
const ADVANTAGE = 0.35;
/** Saves decide less of what comes at a creature than attacks do. */
const SAVE_SHARE = 0.25;
/**
 * Knocked prone, it gets up on its next turn: being easier to hit lasts only until then, and only for foes close
 * enough to take advantage (in some systems those further off do worse). About half of what it would be worth.
 */
const PRONE_SHARE = 0.5;
/** Most fights don't last long: no effect counts for more than this many more rounds. */
const MAX_ROUNDS = 3;
/** How strongly a creature wants its usual pick, when nothing says (a clear choice lands a little above 45). */
const USUAL_LEAD = 50;

/** Share of a creature's fighting a set of conditions takes away each round (0-1). */
export function conditionWeight(rules, conditions = {}) {
  let w = 0;
  for ( const [key, raw] of Object.entries(conditions) ) {
    const value = raw === true ? 1 : Number(raw) || 0;
    const custom = rules.conditionWeight?.(key, value);
    if ( typeof custom === "number" ) { w += custom; continue; }
    if ( key === "incapacitated" || key === "controlled" ) w += 1;
    else if ( key === "immobilized" ) w += 0.25;
    else if ( key === "prone" ) w += 0.15;
    else w += 0.08 * value;
  }
  return clamp(w, 0, 1);
}

/** A foe of t to measure its fighting against: whoever it's after, else the nearest standing foe. */
function typicalFoe(run, t) {
  const current = t.targetId ? run.byId.get(t.targetId) : null;
  if ( current && isStanding(current) && areEnemies(run, t, current) ) return current;
  return enemiesOf(run, t).find(isStanding) ?? null;
}

/** Damage t deals in a round (against `versus`, or a typical foe). */
function damageOut(run, t, versus = null) {
  const foe = versus ?? typicalFoe(run, t);
  return foe ? threatOf(run, t, foe) : 0;
}

/** Damage t can expect to take in a round: its foes' share of their fighting, more for one in the thick of it. */
export function incoming(run, t) {
  if ( run.incomingRound !== run.round ) {
    run.incomingRound = run.round;
    run.incomingCache = new Map();
  }
  const cached = run.incomingCache.get(t);
  if ( cached !== undefined ) return cached;
  const foes = enemiesOf(run, t).filter(isStanding);
  const friends = Math.max(1, alliesOf(run, t).filter(isStanding).length);
  const total = foes.reduce((s, f) => s + threatOf(run, f, t), 0);
  const front = [...(t.adjacent ?? [])].some(id => { const o = run.byId.get(id); return o && isStanding(o) && areEnemies(run, t, o); });
  const value = Math.min(total, (total / friends) * (front ? 1.5 : 1));
  run.incomingCache.set(t, value);
  return value;
}

/** Hits t lands in a typical round (for flat damage and marks). */
function hitsPerRound(run, t) {
  const per = unitsPerTurn(run.prep.rules, t);
  let most = 1;
  for ( const a of t.prep?.offense ?? [] ) most = Math.max(most, attacksIn(a) * (per >= 2 ? Math.min(2, per) : 1));
  return 0.6 * Math.min(3, most);
}

/** Rounds the fight is likely to go on for a side: what its foes have left over what it deals, at most three. */
export function fightLeft(run, side) {
  if ( run.leftRound !== run.round ) {
    run.leftRound = run.round;
    run.leftCache = new Map();
  }
  if ( run.leftCache.has(side) ) return run.leftCache.get(side);
  const mine = run.units.filter(o => o.side === side && isStanding(o));
  const foes = run.units.filter(o => isStanding(o) && mine.some(m => areEnemies(run, m, o)));
  const hp = foes.reduce((s, f) => s + Math.max(0, f.hp) + (f.temp ?? 0) + (f.stamina ?? 0), 0);
  const dealt = mine.reduce((s, m) => s + damageOut(run, m), 0);
  const value = dealt > 0 ? clamp(Math.ceil(hp / dealt), 1, MAX_ROUNDS) : MAX_ROUNDS;
  run.leftCache.set(side, value);
  return value;
}

/** Rounds an effect will matter, in a fight that rarely lasts long. */
export function usefulRounds(run, side, rounds) {
  return Math.min(Math.max(1, Number(rounds) || 1), fightLeft(run, side));
}

/** Extra damage a creature deals to a foe that's off guard (sneak attack, precision): its best such bonus. */
function exposedBonus(u) {
  let best = 0;
  for ( const a of u.prep?.offense ?? [] ) {
    for ( const b of a.bonusDamage ?? [] ) {
      const when = [].concat(b.when ?? []);
      if ( !when.some(w => w === "offGuard" || w === "exposed") ) continue;
      best = Math.max(best, (b.parts ?? []).reduce((s, p) => s + Math.max(0, meanPart(p)), 0));
    }
  }
  return best;
}

/** Conditions in `conditions` worse than what t already has (the rest change nothing). */
function freshConditions(t, conditions) {
  const out = {};
  for ( const [k, raw] of Object.entries(conditions ?? {}) ) {
    const v = raw === true ? 1 : Number(raw) || 0;
    if ( k === "prone" ? !t.prone : v > (t.conds?.[k] ?? 0) ) out[k] = v;
  }
  return out;
}

/**
 * What a set of bonuses and penalties is worth to t each round (negative: it hurts t). `words`: what its checks are
 * worth in a round (talking, first aid); `own` and `guard`: the share of its attacks, and of the attacks on it, they
 * reach (all of them, or only the next one).
 */
function modsPerRound(run, t, mods, out, inc, { words = 0, own = 1, guard = 1 } = {}) {
  // (A point means more on smaller dice: the system says how much, rules.rollPoint.)
  const ROLL_POINT = Number(run.prep.rules.rollPoint) || D20_POINT;
  if ( !mods ) return 0;
  const num = k => Number(mods[k]) || 0;
  const sign = k => Math.sign(num(k));
  const die = k => (Number.isFinite(Number(mods[k])) ? diceMean([Number(mods[k])]) : diceMean(mods[k]));
  let v = 0;
  // Its own fighting: rolls, advantage, damage, actions, getting there.
  v += own * (out * (ROLL_POINT * (num("attack") + die("attackDie")) + ADVANTAGE * sign("adv")) + num("damage") * hitsPerRound(run, t));
  const per = Math.max(1, unitsPerTurn(run.prep.rules, t));
  v += out * clamp(num("actions") / per, -1, 1);
  v += out * 0.004 * num("speed");
  // What comes at it: AC, being easy or hard to hit, its saves.
  v += guard * inc * (ROLL_POINT * num("ac") - ADVANTAGE * sign("defAdv"));
  v += inc * SAVE_SHARE * (ROLL_POINT * (num("saves") + die("saveDie")) + ADVANTAGE * sign("saveAdv"));
  // Its checks: talking someone round, first aid.
  v += words * (ROLL_POINT * (num("checks") + die("checkDie")) + ADVANTAGE * sign("checkAdv"));
  return v;
}

/**
 * What an outcome is worth to t, in damage-like points over the rounds it will matter: positive when it helps t,
 * negative when it hurts. `by` is whoever brings it about (for a mark: its own hits count). Conditions the system
 * can put a number on (rules.conditionMods) count as those bonuses and penalties; others by how much of t's
 * fighting they take away.
 */
export function outcomeWorth(run, by, t, outcome, { versus = null } = {}) {
  if ( !outcome || !t ) return 0;
  const rules = run.prep.rules;
  // Against whoever it's set on only: its blows at a foe it would hurt; its words, or its first aid, for one it would
  // talk to or tend. Set on no one, it does nothing.
  const focus = outcome.vsFocus ? focusOf(run, t) : null;
  if ( outcome.vsFocus && !focus ) return 0;
  const out = focus ? (focus.kind === "hurt" ? damageOut(run, t, focus.unit) : 0) : damageOut(run, t, versus);
  const inc = incoming(run, t);
  const words = focus ? (focus.kind === "hurt" ? 0 : Math.max(1, damageOut(run, t))) : Math.max(1, damageOut(run, t)) * checkShare(t);
  // Good for one roll (or a few): the next attack of the round's, the next check, the next blow at it.
  const uses = Number(outcome.uses) > 0 ? Number(outcome.uses) : 0;
  const share = uses ? { words, own: Math.min(1, uses / Math.max(1, hitsPerRound(run, t) / 0.6)), guard: Math.min(1, uses / 2) } : { words };
  const rounds = uses ? 1 : usefulRounds(run, by?.side ?? t.side, outcome.rounds);
  let perRound = 0;
  const fresh = freshConditions(t, outcome.conditions);
  const weighed = {};
  for ( const [k, v] of Object.entries(fresh) ) {
    // Turned against its own side: what it would have done to them, and what it now does for the other.
    if ( k === "controlled" ) {
      perRound -= 2 * out * (outcome.endsOnDamage || outcome.endsOnHarm ? 0.6 : 1);
      continue;
    }
    const asMods = rules.conditionMods?.(k, v);
    if ( outcome.onlyVs && by && by !== t ) {
      // Off-guard to its source alone (PF2e Feint): only the source's own blows land easier, and its sneak attacks
      // now find their mark. Nothing else about t changes.
      perRound += modsPerRound(run, t, { ac: asMods?.ac ?? -2 }, 0, damageOut(run, by, t));
      if ( !t.conds?.offGuard && !t.prone ) perRound -= exposedBonus(by) * 0.6;
    } else if ( asMods && typeof asMods === "object" ) perRound += modsPerRound(run, t, asMods, out, inc) * (k === "prone" ? PRONE_SHARE : 1);
    else weighed[k] = v;
  }
  if ( Object.keys(weighed).length ) perRound -= conditionWeight(rules, weighed) * out * (outcome.endsOnDamage ? 0.6 : 1);
  perRound += modsPerRound(run, t, outcome.mods, out, inc, share);
  if ( Array.isArray(outcome.mark) && by && by !== t ) {
    const extra = outcome.mark.reduce((s, p) => s + Math.max(0, meanPart(p)), 0);
    perRound -= extra * hitsPerRound(run, by) * 0.8; // it has to keep hitting that one
  }
  // A taunt: unless t shrugs it off, as often as it outweighs what t had in mind, t goes for `by` instead of whoever it
  // was set on; the rest of the time, it pays what ignoring it costs.
  const taunt = by && by !== t ? tauntLevel(outcome.taunt) : 0;
  if ( taunt ) {
    const lands = 1 - tauntProof(t);
    const holds = clamp(0.5 + (taunt - (t.lastDesires?.[0]?.level ?? USUAL_LEAD)) / 30, 0, 1);
    perRound -= lands * holds * tauntGain(run, by, t);
    if ( outcome.defy ) perRound += lands * (1 - holds) * modsPerRound(run, t, outcome.defy, out, 0);
  }
  // Resistances it lends: the share of what comes at it that they cover, and how much of each blow they stop.
  const resist = Object.entries(outcome.iwr?.resist ?? {}).filter(([k, v]) => v > (t.spec.iwr?.resist?.[k] ?? 0));
  if ( resist.length ) {
    const physical = resist.filter(([k]) => ["bludgeoning", "piercing", "slashing", "physical"].includes(k)).length;
    const share = Math.min(0.9, (physical ? 0.7 * Math.min(1, physical / 3) * (resist.some(([k]) => k === "physical") ? 3 : 1) : 0) + 0.15 * (resist.length - physical));
    const strength = Math.max(...resist.map(([, v]) => rules.resistShare?.(v) ?? 0.5));
    perRound += inc * Math.min(0.9, share) * strength;
  }
  let worth = perRound * rounds;
  // An action this very turn: as much again as one of its actions does.
  const now = Number(outcome.actionsNow) || 0;
  if ( now > 0 && by === t ) worth += now * out / Math.max(1, unitsPerTurn(rules, t));
  const temp = Number(outcome.tempHp) || 0;
  if ( temp > (t.temp ?? 0) ) worth += Math.min(temp - (t.temp ?? 0), inc * rounds);
  // Resources it gains (Ironsworn momentum): what the system says they're worth.
  for ( const [k, v] of Object.entries(outcome.resources ?? {}) ) worth += Number(rules.resourceWorth?.(run, t, k, Number(v) || 0)) || 0;
  return worth;
}

/**
 * What `by` gains each round t comes at it instead of the friend t was set on: the blows that friend is spared, less
 * the ones `by` takes (a friend who might not last the round counts for more kept standing; a taunter who might not,
 * the same against it; one who means to draw the blows, a Tank, minds them half as much). Nothing when t is set on `by`
 * already, or on no friend of its.
 */
function tauntGain(run, by, t) {
  const focus = focusOf(run, t);
  const ward = focus?.kind === "hurt" ? focus.unit : null;
  if ( !ward || ward === by || !isStanding(ward) || areEnemies(run, by, ward) ) return 0;
  const spared = damageOut(run, t, ward);
  const taken = damageOut(run, t, by);
  const left = o => Math.max(0, o.hp) + (o.temp ?? 0);
  const minds = 1 - 0.5 * Math.min(1, Number(behaviorOf(by).taunt) || 0);
  return spared * (left(ward) <= 2 * spared ? 1.5 : 1) - taken * minds * (left(by) <= 2 * taken ? 1.5 : 1);
}

/** How much of t's turn goes into checks (talking, first aid), 0 to 1: what it was set on last turn, its knack for words. */
function checkShare(t) {
  // (As much as its answer leans to always talking.)
  const devoted = t.spec.stayTrue ? 0 : wish(t.spec.alwaysTalk);
  const lead = t.lastDesires?.[0]?.kind;
  if ( lead === "talk" ) return Math.max(devoted, 0.8);
  if ( lead === "heal" && t.spec.firstAid ) return Math.max(devoted, 0.4);
  return Math.max(devoted, Math.min(0.5, 0.5 * (t.prep?.talkAffinity ?? 0)));
}

/** Remember what u's concentration is worth (so it won't drop it lightly for something lesser). */
export function noteConcentration(u, worth) {
  if ( u.concentration ) u.concentration.worth = Math.max(u.concentration.worth ?? 0, worth);
}

/** What u would give up by starting something new that needs its concentration. */
export function concentrationCost(run, u, action) {
  if ( !action?.concentration || !u.concentration || u.concentration.actionId === action.id ) return 0;
  return holdsAnything(run, u) ? (u.concentration.worth ?? 0) * 0.6 : 0;
}
