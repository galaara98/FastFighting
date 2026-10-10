/**
 * Round-by-round battle simulation. Pure: give it a BattleSpec and a rules object, get statistics back.
 *
 * Every logged event carries structured data (type, rolls, margins, damage types, movement) so the story
 * writer can narrate it at any level of detail.
 */
import { STATUS, TACTICAL, DOWNED_MODELS, AFTERMATH } from "../constants.js";
import { createRng, deriveSeed, randomSeed } from "./rng.js";
import { sampleDamage, samplePart } from "./dice.js";
import { rollCheck } from "./probability.js";
import { costOf, costUnits } from "./turn.js";
import {
  prepareBattle, createRun, isStanding, isUp, enemiesOf, alliesOf, areEnemies, liveTier, liveTrait, currentAc,
  attackRoll, saveRoll, checkRoll, turnFor, moveToward, moveAway, bonusDamageParts, dispositionOf,
  behaviorOf, edgeDistance, movesNeeded, approach, canMove
} from "./battle-state.js";
import { sampleRunTactics } from "./playstyles.js";
import { chooseTarget, bestOptionVs } from "./behavior/targeting.js";
import { decideHeal, rescueOption } from "./behavior/healing.js";
import { checkMorale, MORALE } from "./behavior/morale.js";
import { expectedDamage, spendUse, attacksIn, criticalParts, saveMultiplier } from "./behavior/evaluate.js";
import { createAggregator } from "./aggregate.js";
import { talkActionsThisTurn, choosePitch, attemptTalk } from "./behavior/talk.js";
import { opensWithTalk, breaksStandoff, standoffPitches, charismaticLeader } from "./behavior/standoff.js";
import { controlOutcome, isImmune, degreeShift, applyControl } from "./behavior/control.js";
import { stealChance, theftTarget, theftPlan, attemptTheft } from "./behavior/theft.js";

const MAX_STEPS_PER_TURN = 8;
/** After the last blow, how long the winners keep tending the dying (ten minutes of rounds, at most). */
const AFTERMATH_ROUNDS = 100;
/** Batches give the browser back control this often (ms), so the GM's screen stays responsive. */
const SLICE_MS = 25;
const DEGREE_LABEL = ["critical failure", "failure", "success", "critical success"];

function log(run, u, text, data = {}) {
  if ( !run.log ) return;
  run.log.push({
    round: run.round, actor: u?.spec.name ?? "", actorId: u?.id ?? null, side: u?.side ?? null, text,
    type: data.type ?? "note", ...data
  });
}

const primaryType = action => (action.damage ?? action.heal ?? [])[0]?.type ?? "untyped";

/** How a degree of success moves an affliction along: on first exposure, and at each later save. */
function afflictionStep(rules, degree, phase) {
  if ( rules.afflictionStep ) return rules.afflictionStep(degree, phase);
  return phase === "exposure" ? (degree <= 1 ? 1 : 0) : (degree <= 1 ? 1 : -1);
}

/* -------------------------------------------- */
/*  Initiative                                  */
/* -------------------------------------------- */

function rollInitiative(run) {
  const { options } = run.prep;
  const stealthSides = new Set(options.stealthSides ?? []);
  const fixed = options.initiativeOrder ?? null;
  const rolled = new Map();
  for ( const u of run.units ) {
    const init = u.spec.initiative ?? { mod: 0 };
    let mod = stealthSides.has(u.side) ? (init.stealth ?? init.mod ?? 0) : (init.mod ?? 0);
    mod += behaviorOf(u).initiative ?? 0; // Instigators jump in first
    if ( liveTier(run, u) >= TACTICAL.MASTERMIND ) mod += 2; // ambush instincts
    rolled.set(u.id, run.rng.d20() + mod + run.rng.next() * 0.01);
  }
  if ( fixed?.length ) {
    const known = fixed.map(id => run.byId.get(id)).filter(Boolean);
    const rest = run.units.filter(u => !fixed.includes(u.id)).sort((a, b) => rolled.get(b.id) - rolled.get(a.id));
    return known.concat(rest);
  }
  return [...run.units].sort((a, b) => rolled.get(b.id) - rolled.get(a.id));
}

/* -------------------------------------------- */
/*  Bystanders: noticing, joining, help, hunt   */
/* -------------------------------------------- */

/**
 * Could bystander b notice combatant c this round? Uses precomputed sight and sound (walls muffle).
 * @returns {{dc: number, sense: "sight"|"sound"}|null}
 */
function cueFrom(run, b, c) {
  const aw = run.prep.spec.awareness?.[b.id]?.[c.id];
  if ( !aw ) return run.prep.spec.awareness ? null : { dc: 10, sense: "sound" };
  if ( aw.see ) return { dc: 5, sense: "sight" };
  if ( aw.hearDC !== null && aw.hearDC !== undefined ) return { dc: aw.hearDC, sense: "sound" };
  return null;
}

function notice(run, b, cause, source) {
  b.aware = true;
  // During a standoff there is no fighting to see or hear, only a tense crowd and raised voices.
  if ( run.standoff && (cause === "sight" || cause === "sound") ) cause = "standoff";
  const text = {
    standoff: "notices the tense standoff",
    sight: `sees the fight${source ? ` (${source.spec.name})` : ""}`,
    sound: "hears the sounds of fighting",
    fledInto: `is stumbled into by the fleeing ${source?.spec.name ?? "combatant"}`,
    help: `is roused by ${source?.spec.name ?? "an ally"} calling for help`,
    attacked: `is set upon by ${source?.spec.name ?? "a hunter"}`
  }[cause] ?? "notices the fight";
  log(run, b, text, { type: "notice", cause, by: source?.spec.name ?? null, byId: source?.id ?? null });
  if ( cause === "attacked" ) return join(run, b, "forced");
  decideToJoin(run, b, cause);
}

function join(run, b, why) {
  b.active = true;
  b.joinedRound = run.round;
  log(run, b, why === "forced" ? "is drawn into the fight" : "joins the fight", { type: "join", why });
}

/** A bystander who has noticed the fight decides: join, leave, or keep watching. */
function decideToJoin(run, b, cause) {
  const brave = b.prep.traits.brave;
  const loyal = b.prep.traits.loyal;
  const selfish = b.prep.traits.selfish;
  const friends = alliesOf(run, b).filter(a => a !== b && a.active);
  const foes = enemiesOf(run, b).filter(isStanding);
  if ( !foes.length && !friends.length ) {
    b.watchUntil = run.round + 2;
    return log(run, b, "watches warily", { type: "watch" });
  }
  const tier = liveTier(run, b);
  let p = 0.35 + (brave - 50) / 150 + (loyal - 50) / 150 - (selfish - 50) / 250;
  if ( tier <= TACTICAL.FERAL ) p = 0.5 + (brave - 50) / 100; // territorial instinct
  if ( b.spec.flags?.mindless ) p = 0.9;
  if ( cause === "help" ) p += 0.35;
  const losing = friends.some(f => f.status !== STATUS.STANDING);
  if ( losing ) p += 0.1 * (loyal / 50);
  if ( run.rng.chance(Math.min(0.95, Math.max(0.05, p))) ) return join(run, b, cause);
  if ( selfish > 60 || brave < 30 ) {
    b.status = STATUS.FLED;
    b.fellRound ??= run.round;
    moveAway(run, b, (b.spec.speeds?.walk ?? 25) * 2);
    return log(run, b, "wants no part of it and slips away", { type: "leave" });
  }
  b.watchUntil = run.round + 2;
  log(run, b, "hangs back, watching", { type: "watch" });
}

/** Start of each round: bystanders who can see or hear an active combatant may notice. */
function checkAwareness(run) {
  for ( const b of run.units ) {
    if ( b.active || b.status !== STATUS.STANDING ) continue;
    if ( b.aware && b.watchUntil && run.round < b.watchUntil ) continue;
    let best = null;
    for ( const c of run.units ) {
      if ( c === b || !c.active ) continue;
      if ( c.status !== STATUS.STANDING && c.fellRound !== run.round && c.fellRound !== run.round - 1 ) continue;
      const cue = cueFrom(run, b, c);
      if ( cue && (!best || cue.dc < best.cue.dc) ) best = { cue, c };
    }
    if ( !best ) continue;
    const perception = b.spec.perception ?? b.spec.initiative?.mod ?? 0;
    const check = checkRoll(run, b, perception);
    const roll = rollCheck(run.prep.rules, run.rng, check.mod, best.cue.dc, { advantage: check.advantage, kind: "check" });
    if ( roll.degree >= 2 ) {
      if ( b.aware ) decideToJoin(run, b, best.cue.sense);
      else notice(run, b, best.cue.sense, best.c);
    }
  }
}

/** Unaware or uncommitted bystanders on u's side who could be fetched. */
function helpFor(run, u) {
  return run.units.filter(o => o !== u && !o.active && o.side === u.side && o.status === STATUS.STANDING && !o.calledForHelp);
}

/** Should u run for help this turn? (Its answers say so, or a thinking NPC sees it going badly.) */
function wantsHelp(run, u) {
  const helpers = helpFor(run, u);
  if ( !helpers.length ) return null;
  const choice = u.tac?.beyond;
  if ( choice === "stay" || choice === "hunt" ) return null;
  const hurt = u.maxHp > 0 && u.hp / u.maxHp < 0.5;
  const allies = alliesOf(run, u).filter(a => a.active);
  // Going badly: an ally has fallen, or they're outnumbered more than two to one.
  const losing = allies.some(a => a !== u && a.status !== STATUS.STANDING)
    || enemiesOf(run, u).filter(isStanding).length > 2 * allies.filter(isStanding).length;
  const thinks = choice === "seekHelp" || (u.spec.kind !== "pc" && liveTier(run, u) >= TACTICAL.COMPETENT);
  if ( !thinks || !(hurt || losing) ) return null;
  return helpers.sort((a, b) => (edgeDistance(u, a) ?? 0) - (edgeDistance(u, b) ?? 0))[0];
}

function isHunter(u) {
  return !!u.hunts;
}

/** Bystanders a hunter could go after once the real fight is over. */
function huntable(run, u) {
  return run.units.filter(o => !o.active && o.status === STATUS.STANDING && areEnemies(run, u, o));
}

/* -------------------------------------------- */
/*  Damage, healing, conditions                 */
/* -------------------------------------------- */

function dealDamage(run, source, target, amount, { crit = false } = {}) {
  if ( amount <= 0 || target.status === STATUS.DEAD || target.status === STATUS.FLED ) return;
  if ( target.effects?.some(e => e.endsOnDamage) ) {
    target.effects = target.effects.filter(e => !e.endsOnDamage); // a blow wakes the sleeper
    recomputeConditions(target);
  }
  const rules = run.prep.rules;
  const model = run.prep.options.downedModel;
  if ( target.status === STATUS.STANDING ) {
    const absorbed = Math.min(target.temp, amount);
    target.temp -= absorbed;
    const rest = amount - absorbed;
    const dealt = Math.min(rest, target.hp);
    target.hp -= rest;
    if ( source ) {
      source.damageDealt += dealt + absorbed;
      target.harmedBy.set(source.id, (target.harmedBy.get(source.id) ?? 0) + dealt + absorbed);
    }
    if ( target.hp <= 0 ) {
      target.hp = 0;
      target.wasDowned = true;
      rules.onDropped(target, { crit, model, amount: rest, overflow: Math.max(0, rest - dealt) });
      target.fellRound ??= run.round;
      target.killerId = source?.id ?? target.killerId ?? null;
      run.firstFallen ??= target.id;
      releaseGrabs(run, target);
      const dead = target.status === STATUS.DEAD;
      log(run, target, dead ? "is slain" : `falls (dying ${target.dying})`, { type: dead ? "death" : "down", by: source?.spec.name ?? null, byId: source?.id ?? null, dying: target.dying });
    }
  } else if ( target.status === STATUS.DOWN ) {
    if ( model === DOWNED_MODELS.OUT ) return;
    rules.onDropped(target, { crit, model, amount, overflow: amount });
    const dead = target.status === STATUS.DEAD;
    if ( dead ) target.killerId = source?.id ?? target.killerId ?? null;
    log(run, target, dead ? "is finished off" : `is struck while down (dying ${target.dying})`, { type: dead ? "death" : "struckDown", by: source?.spec.name ?? null, byId: source?.id ?? null, dying: target.dying, finished: dead });
  }
}

function releaseGrabs(run, u) {
  for ( const other of run.units ) if ( other.grabbedBy === u.id ) other.grabbedBy = null;
}

/** Recompute condition values from active afflictions (the worst value of each condition wins). */
function recomputeConditions(u) {
  const conds = { ...u.baseConds };
  for ( const e of u.effects ?? [] ) {
    for ( const [k, v] of Object.entries(e.conditions) ) {
      const value = v === true ? 1 : Number(v) || 0;
      conds[k] = Math.max(conds[k] ?? 0, value);
    }
  }
  for ( const a of u.afflictions ) {
    if ( a.onsetLeft > 0 ) continue; // not taken hold yet
    const stage = a.spec.stages[a.stage - 1];
    for ( const [k, v] of Object.entries(stage?.conditions ?? {}) ) {
      const value = v === true ? 1 : Number(v) || 0;
      conds[k] = Math.max(conds[k] ?? 0, value);
    }
  }
  u.conds = conds;
}

function applyAfflictionStage(run, target, affliction) {
  const stage = affliction.spec.stages[affliction.stage - 1];
  recomputeConditions(target);
  if ( !stage?.damage?.length ) return;
  const rolled = sampleDamage(stage.damage, run.rng);
  const amount = run.prep.rules.applyIwr(target.spec.iwr, rolled.byType);
  log(run, target, `${affliction.spec.name} stage ${affliction.stage}: ${amount} damage`, {
    type: "afflictionStage", name: affliction.spec.name, stage: affliction.stage, amount, damageType: stage.damage[0]?.type ?? "poison"
  });
  dealDamage(run, run.byId.get(affliction.sourceId), target, amount);
}

function exposeToAffliction(run, source, target, spec) {
  if ( target.spec.iwr?.immune?.some(k => spec.traits?.includes(k)) ) return;
  const rules = run.prep.rules;
  const { mod, advantage } = saveRoll(run, target, spec.save.type);
  const roll = rollCheck(rules, run.rng, mod, spec.save.dc, { advantage, kind: "save" });
  const increase = afflictionStep(rules, roll.degree, "exposure");
  log(run, target, `${spec.name}: ${spec.save.type} save ${DEGREE_LABEL[roll.degree]}`, {
    type: "afflictionSave", name: spec.name, saveType: spec.save.type, natural: roll.natural, mod, total: roll.total, dc: spec.save.dc, degree: roll.degree
  });
  if ( !(increase > 0) ) return;
  let affliction = target.afflictions.find(a => a.spec.id === spec.id);
  if ( !affliction ) {
    affliction = { spec, stage: 0, rounds: 0, sourceId: source.id, onsetLeft: Math.max(0, spec.onset ?? 0) };
    target.afflictions.push(affliction);
  }
  affliction.stage = Math.min(spec.stages.length, affliction.stage + increase);
  if ( affliction.onsetLeft > 0 ) return; // it takes hold once the onset has passed
  applyAfflictionStage(run, target, affliction);
}

/** Riders on a successful hit: knockdown, grab, afflictions. */
function applyEffects(run, u, action, target, degree) {
  for ( const effect of action.effects ?? [] ) {
    if ( !isUp(target) && effect.kind !== "affliction" ) continue;
    if ( target.status === STATUS.DEAD ) return;
    if ( effect.kind === "prone" && (degree === 3 || !effect.critOnly) ) {
      target.prone = true;
      log(run, target, "is knocked prone", { type: "prone", by: u.spec.name });
    } else if ( effect.kind === "grabbed" ) {
      target.grabbedBy = u.id;
      log(run, target, `is grabbed by ${u.spec.name}`, { type: "grabbed", by: u.spec.name });
    } else if ( effect.kind === "affliction" ) {
      exposeToAffliction(run, u, target, effect);
    } else if ( effect.kind === "condition" && (degree === 3 || !effect.critOnly) ) {
      // A rider such as "if it critically fails, it's also stunned 1": the system's own tags decide immunity.
      if ( isImmune(run, target, { traits: action.traits, onSave: [effect] }) ) continue;
      applyControl(target, effect, u.id);
      recomputeConditions(target);
      log(run, target, `is left ${effect.label || "reeling"}`, { type: "condition", by: u.spec.name, effect: effect.label ?? "" });
    }
  }
}

/** Roll damage for a hit; returns the total and a function that applies it (so the log reads in order). */
function rollHit(run, u, action, t, parts, multiplier, crit, minimum = 0) {
  const rules = run.prep.rules;
  const rolled = sampleDamage(parts, run.rng, multiplier);
  // Some systems guarantee a hit does at least some damage before resistances (PF2e: 1).
  if ( minimum > 0 ) {
    const types = Object.keys(rolled.byType);
    const sum = types.reduce((s, k) => s + rolled.byType[k], 0);
    if ( types.length && sum < minimum ) rolled.byType[types[0]] += minimum - sum;
  }
  const total = rules.applyIwr(t.spec.iwr, rolled.byType);
  return {
    total,
    apply: () => {
      for ( const p of rolled.persistent ) {
        if ( !t.spec.iwr?.immune?.includes(p.type) ) t.persistent.push({ part: p, sourceId: u.id });
      }
      dealDamage(run, u, t, total, { crit });
    }
  };
}

/** Someone else u could hit with this action without moving (when a multiattack's first target drops). */
function nextTargetInReach(run, u, action) {
  return enemiesOf(run, u).filter(o => isStanding(o) && movesNeeded(run, u, o, action) === 0).sort((a, b) => a.hp - b.hp)[0] ?? null;
}

function executeOffense(run, u, action, t, attacksMade) {
  // A multiattack (or Extra Attack) makes its strikes in order, turning to a new foe if the first one drops.
  if ( action.sequence?.length ) {
    let made = attacksMade;
    let target = t;
    for ( const strike of action.sequence ) {
      if ( !target || !isStanding(target) ) target = nextTargetInReach(run, u, strike);
      if ( !target ) break;
      executeOffense(run, u, strike, target, made);
      made += attacksIn(strike);
      if ( battleOver(run) ) break;
    }
    return;
  }
  const rules = run.prep.rules;
  u.revealed = true;
  run.blood = true; // a blow has been struck: whatever happens now, it wasn't settled with words
  const targets = [t];
  if ( action.area ) {
    const others = enemiesOf(run, u).filter(o => o !== t && isStanding(o));
    run.rng.shuffle(others);
    targets.push(...others.slice(0, Math.max(0, (action.area.targets ?? 2) - 1)));
  }
  const ranged = !!action.range && !action.melee;
  const logging = !!run.log; // thousands of unlogged runs shouldn't pay for building log text
  for ( const target of targets ) {
    if ( !target.active ) notice(run, target, "attacked", u);
    target.lastAttackerId = u.id;
    const held = target.grudges?.get(u.id);
    if ( held && !held.provoked ) held.provoked = true; // they took from me, and now this

    const common = logging ? {
      action: action.name, actionKind: action.kind, damageType: primaryType(action), target: target.spec.name, targetId: target.id,
      ranged, area: !!action.area, targetCover: !!target.spec.environment?.nearCover, attackerCover: !!u.spec.environment?.nearCover
    } : null;

    if ( action.kind === "auto" ) {
      const extra = bonusDamageParts(run, u, action, target, { commit: true });
      const hit = rollHit(run, u, action, target, (action.damage ?? []).concat(extra), 1, false);
      if ( logging ) log(run, u, `${action.name} → ${target.spec.name}: ${hit.total} damage`, { type: "auto", ...common, damage: hit.total });
      hit.apply();
      continue;
    }

    if ( action.kind === "control" ) {
      executeControl(run, u, action, target, attacksMade, common);
      continue;
    }

    if ( action.kind === "save" && action.save ) {
      const extra = bonusDamageParts(run, u, action, target, { commit: true });
      const { mod, advantage } = saveRoll(run, target, action.save.type);
      const roll = rollCheck(rules, run.rng, mod, action.save.dc, { advantage, kind: "save" });
      const mult = saveMultiplier(rules, roll.degree, action.save);
      const data = !logging ? null : { type: "save", ...common, saveType: action.save.type, natural: roll.natural, mod, total: roll.total, dc: action.save.dc, degree: roll.degree, margin: roll.total - action.save.dc };
      if ( mult > 0 ) {
        const hit = rollHit(run, u, action, target, (action.damage ?? []).concat(extra), mult, roll.degree === 0);
        if ( logging ) log(run, u, `${action.name} → ${target.spec.name}: save ${DEGREE_LABEL[roll.degree]}, ${hit.total} damage`, { ...data, damage: hit.total });
        hit.apply();
        if ( roll.degree <= 1 ) applyEffects(run, u, action, target, 3 - roll.degree);
      } else if ( logging ) log(run, u, `${action.name} → ${target.spec.name}: ${DEGREE_LABEL[roll.degree]}, no damage`, { ...data, damage: 0 });
      continue;
    }

    const { bonus, advantage } = attackRoll(run, u, target, action, attacksMade);
    const ac = currentAc(run, target, u, action);
    const roll = rollCheck(rules, run.rng, bonus, ac, { advantage, kind: "attack" });
    const data = !logging ? null : { type: "attack", ...common, natural: roll.natural, mod: bonus, total: roll.total, dc: ac, degree: roll.degree, margin: roll.total - ac, attackNumber: attacksMade + 1 };
    if ( roll.degree >= 2 ) {
      const crit = roll.degree === 3;
      const extra = bonusDamageParts(run, u, action, target, { advantage, commit: true });
      const base = crit ? (action.critDamage ?? criticalParts(rules, action.damage)) : (action.damage ?? []);
      const parts = extra.length ? base.concat(crit ? criticalParts(rules, extra) : extra) : base;
      const hit = rollHit(run, u, action, target, parts, 1, crit, rules.minimumDamage ?? 0);
      if ( logging ) log(run, u, `${action.name} → ${target.spec.name}: ${roll.total} vs AC ${ac}, ${crit ? "critical hit" : "hit"} for ${hit.total}`, { ...data, damage: hit.total, crit, sneak: extra.length > 0, advantage });
      hit.apply();
      applyEffects(run, u, action, target, roll.degree);
    } else if ( logging ) {
      log(run, u, `${action.name} → ${target.spec.name}: ${roll.total} vs AC ${ac}, miss`, { ...data, damage: 0, advantage });
    }
  }
  if ( action.melee ) {
    u.adjacent.add(t.id);
    t.adjacent.add(u.id);
  }
}

/** A crowd-control action on one target: immunity, the roll, the outcome for that degree, any damage. */
function executeControl(run, u, action, target, attacksMade, common) {
  const rules = run.prep.rules;
  const logging = !!run.log;
  if ( isImmune(run, target, action) ) {
    if ( logging ) log(run, u, `${action.name} → ${target.spec.name}: unaffected`, { type: "control", ...common, immune: true, degree: null });
    return;
  }
  let roll;
  let dc;
  if ( action.save ) {
    const { mod, advantage } = saveRoll(run, target, action.save.type);
    dc = action.save.dc;
    roll = { ...rollCheck(rules, run.rng, mod, dc, { advantage, kind: "save" }), mod };
  } else {
    const { bonus, advantage } = attackRoll(run, u, target, action, attacksMade);
    dc = currentAc(run, target, u, action);
    roll = { ...rollCheck(rules, run.rng, bonus, dc, { advantage, kind: "attack" }), mod: bonus };
  }
  // Some effects hold weaker on much stronger targets (PF2e incapacitation): their result counts one better.
  const shift = degreeShift(run, u, target, action);
  const degree = Math.max(0, Math.min(3, roll.degree + (action.save ? shift : -shift)));
  const outcome = controlOutcome(action, degree);
  if ( outcome ) applyControl(target, outcome, u.id);
  recomputeConditions(target);
  let damage = 0;
  if ( action.damage?.length ) {
    const mult = action.save ? saveMultiplier(rules, degree, action.save) : (degree >= 2 ? 1 : 0);
    if ( mult > 0 ) {
      const hit = rollHit(run, u, action, target, action.damage, mult, false);
      damage = hit.total;
      hit.apply();
    }
  }
  if ( logging ) {
    log(run, u, `${action.name} → ${target.spec.name}: ${outcome?.label || "no effect"}${damage ? `, ${damage} damage` : ""}`, {
      type: "control", ...common, saveType: action.save?.type ?? null, natural: roll.natural, mod: roll.mod, total: roll.total, dc,
      degree, margin: roll.total - dc, effect: outcome?.label ?? "", took: !!outcome, damage, shifted: shift
    });
  }
}

function executeHeal(run, u, action, target) {
  const rules = run.prep.rules;
  let multiplier = 1;
  let roll = null;
  if ( action.healCheck ) {
    const check = checkRoll(run, u, action.healCheck.mod);
    roll = rollCheck(rules, run.rng, check.mod, action.healCheck.dc, { advantage: check.advantage, kind: "check" });
    multiplier = rules.healCheckMultiplier ? rules.healCheckMultiplier(roll.degree) : [0, 0, 1, 2][roll.degree];
  }
  const amount = Math.max(0, Math.floor((action.heal ?? []).reduce((s, p) => s + samplePart(p, run.rng), 0) * multiplier));
  const wasDown = target.status === STATUS.DOWN;
  const before = target.hp;
  if ( amount > 0 ) rules.onHealed(target, amount);
  u.healingDone += target.hp - before;
  u.healedTargets.add(`${action.id}|${target.id}`);
  spendUse(u, action);
  const revived = wasDown && target.status === STATUS.STANDING;
  if ( run.log ) log(run, u, `${action.name} → ${target === u ? "self" : target.spec.name}: heals ${target.hp - before}${revived ? " and revives them" : ""}`, {
    type: "heal", action: action.name, target: target.spec.name, targetId: target.id, self: target === u, amount: target.hp - before, revived,
    potion: !!action.selfOnly, check: roll ? { natural: roll.natural, mod: action.healCheck.mod, total: roll.total, dc: action.healCheck.dc, degree: roll.degree } : null
  });
}

/* -------------------------------------------- */
/*  Turns                                       */
/* -------------------------------------------- */

function flee(run, u, reason) {
  u.status = STATUS.FLED;
  u.fellRound ??= run.round;
  for ( const id of u.adjacent ) run.byId.get(id)?.adjacent.delete(u.id);
  u.adjacent.clear();
  releaseGrabs(run, u);
  const feet = moveAway(run, u, (Math.max(...Object.values(u.spec.speeds ?? { walk: 25 })) || 25) * 2);
  log(run, u, reason, { type: "flee", feet, mode: (u.spec.speeds?.fly ?? 0) > 0 ? "fly" : "walk" });
  // Fleeing into a bystander alerts them; an ally will hear the call for help.
  for ( const b of run.units ) {
    if ( b.active || b.status !== STATUS.STANDING ) continue;
    const d = edgeDistance(u, b);
    if ( d !== null && d <= 40 ) notice(run, b, b.side === u.side ? "help" : "fledInto", u);
  }
}

function moveLog(run, u, move, toward, purpose = "approach") {
  if ( !run.log ) return;
  log(run, u, `${move.mode === "walk" ? "moves" : move.mode === "fly" ? "flies" : move.mode === "swim" ? "swims" : move.mode === "climb" ? "climbs" : "burrows"} toward ${toward.spec.name}`, {
    type: "move", mode: move.mode, feet: move.feet, mult: move.mult, regions: move.regions, toward: toward.spec.name, towardId: toward.id,
    reached: move.reached, purpose, tactical: liveTier(run, u), cover: !!u.spec.environment?.nearCover
  });
}

/** Pitches made in a standoff turn (or a leader's last word, aimed only at the player characters). */
function standoffPitching(run, u, n, only = null) {
  for ( let i = 0; i < n; i++ ) {
    const pitch = choosePitch(run, u, { only });
    if ( !pitch ) break;
    attemptTalk(run, u, pitch, (unit, text, data) => log(run, unit, text, data));
    if ( battleOver(run) ) break;
  }
}

/** A turn while the standoff holds: talkers press their case, everyone else keeps their hands off their weapons. */
function standoffTurn(run, u) {
  const rules = run.prep.rules;
  standoffPitching(run, u, standoffPitches(run, u, turnFor(run, u).howMany(rules.talkCost ?? rules.basicAction ?? 1)));
  u.turnsTaken += 1;
  endOfTurn(run, u);
}

/**
 * Before a standoff breaks, a charismatic NPC leader may take one more turn to press the player characters to pay
 * up or back off (once per side). Returns true if that settled it.
 */
function lastWord(run) {
  const rules = run.prep.rules;
  run.lastWords ??= new Set();
  for ( const side of Object.keys(run.prep.sides) ) {
    if ( run.lastWords.has(side) ) continue;
    const found = charismaticLeader(run, side);
    if ( !found ) continue;
    const pcs = run.units.filter(o => o.spec.kind === "pc" && isStanding(o) && areEnemies(run, found.leader, o));
    if ( !pcs.length ) continue;
    run.lastWords.add(side);
    if ( !run.rng.chance(Math.min(0.85, 0.35 + 0.1 * found.edge)) ) continue;
    log(run, found.leader, "steps in for one last try at settling it", { type: "lastWord" });
    standoffPitching(run, found.leader, turnFor(run, found.leader).howMany(rules.talkCost ?? rules.basicAction ?? 1), o => o.spec.kind === "pc");
    if ( battleOver(run) ) return true;
  }
  return false;
}

function takeTurn(run, u) {
  const { rules, options } = run.prep;
  if ( [STATUS.DEAD, STATUS.FLED, STATUS.SURRENDERED, STATUS.STOOD_DOWN].includes(u.status) ) return;
  if ( !u.active ) return; // bystanders act only once they join
  u.shieldRaised = false;

  if ( u.status === STATUS.DOWN ) {
    if ( options.downedModel === DOWNED_MODELS.SIMULATE && rules.recoveryCheck ) {
      const before = u.dying;
      const text = rules.recoveryCheck(u, run.rng);
      if ( text ) log(run, u, text, { type: "recovery", before, dying: u.dying, dead: u.status === STATUS.DEAD, stable: u.stable });
    }
    endOfTurn(run, u);
    return;
  }

  // While a standoff holds, nobody fights; it lasts until someone gets upset.
  let brokeStandoff = false;
  if ( run.standoff ) {
    const cause = breaksStandoff(run, u);
    if ( !cause ) return standoffTurn(run, u);
    // A charismatic leader may get a last word in before it comes to blows.
    if ( lastWord(run) ) return;
    run.standoff = false;
    brokeStandoff = true; // whoever breaks it came to fight, not to talk
    log(run, u, { insulted: "takes offense and attacks", beast: "won't wait any longer and attacks" }[cause] ?? "has heard enough and attacks", { type: "breakStandoff", cause });
  }

  const morale = checkMorale(run, u);
  if ( morale === MORALE.ROUT ) return flee(run, u, "breaks and flees");
  if ( morale === MORALE.WAVER && !u.wavering ) {
    u.wavering = true;
    log(run, u, "wavers", { type: "waver" });
  }

  const disposition = dispositionOf(u);
  if ( u.prone && u.wasDowned && disposition.selfRevived === "retreat" ) return flee(run, u, "retreats after being revived");
  if ( disposition.allyDying === "retreat" && run.units.some(a => a.side === u.side && a !== u && a.status === STATUS.DOWN && a.active) ) {
    return flee(run, u, "retreats as an ally falls");
  }

  // The turn's budget comes from the system (PF2e: three actions; 5e: an action, a bonus action and movement).
  const turn = turnFor(run, u);
  u.usedThisTurn = null; // once-per-turn riders such as sneak attack
  u.stoleThisTurn = false;
  const basic = rules.basicAction ?? 1; // a simple action: stand, escape, recall knowledge, step
  const behavior = behaviorOf(u);
  // Diplomats with no one who understands them still try to talk.
  if ( !u.parleyed ) {
    u.parleyed = true;
    if ( behavior.parleyFirst && turn.canAfford(basic) && !u.spec.social && run.rng.chance(behavior.parleyFirst) ) {
      turn.spend(basic);
      log(run, u, "tries to talk the other side down", { type: "parley" });
    }
  }
  let attacksMade = 0;
  if ( u.prone ) {
    const stand = rules.standCost ? rules.standCost(u) : basic;
    if ( turn.canAfford(stand) ) {
      turn.spend(stand);
      u.prone = false;
      log(run, u, "stands up", { type: "stand" });
    }
  }
  if ( u.grabbedBy && turn.canAfford(basic) ) {
    // Escape attempt costs an action; succeed half the time.
    turn.spend(basic);
    const escaped = run.rng.chance(0.5);
    if ( escaped ) u.grabbedBy = null;
    log(run, u, escaped ? "escapes the grab" : "struggles against the grab", { type: "escape", success: escaped });
  }

  // Running for help: head toward an ally who hasn't joined yet and shout.
  const helper = turn.left > 0 && canMove(run, u) ? wantsHelp(run, u) : null;
  if ( helper ) {
    for ( let n = 0; n < MAX_STEPS_PER_TURN; n++ ) {
      const budget = turn.payForMove(approach(run, u, helper).speed);
      if ( !budget ) break;
      const move = moveToward(run, u, helper, 5, budget);
      turn.usedMove(move.cost);
      moveLog(run, u, move, helper, "help");
      const d = edgeDistance(u, helper);
      if ( d === null || d <= 30 ) {
        helper.calledForHelp = true;
        log(run, u, `shouts to ${helper.spec.name} for help`, { type: "callHelp", toward: helper.spec.name, towardId: helper.id });
        notice(run, helper, "help", u);
        break;
      }
      if ( move.feet <= 0 ) break; // can't get any closer
    }
  }

  // Words before weapons: talkers sway, the less battle-worthy talk twice, anyone may quip.
  const talkCost = rules.talkCost ?? basic;
  const talking = brokeStandoff ? { count: 0, pitch: null } : talkActionsThisTurn(run, u, turn.howMany(talkCost));
  for ( let i = 0; i < talking.count && turn.canAfford(talkCost); i++ ) {
    const pitch = i === 0 ? talking.pitch : choosePitch(run, u); // the first pitch was already chosen
    if ( !pitch ) break;
    attemptTalk(run, u, pitch, (unit, text, data) => log(run, unit, text, data));
    turn.spend(talkCost);
    if ( battleOver(run) ) break;
  }

  for ( let step = 0; turn.any && step < MAX_STEPS_PER_TURN && !battleOver(run); step++ ) {
    const heal = decideHeal(run, u, turn);
    if ( heal ) {
      executeHeal(run, u, heal.action, heal.target);
      turn.spend(costOf(rules, heal.action));
      continue;
    }

    let target = chooseTarget(run, u);
    // Hunters go after bystanders once there's no one else to fight.
    if ( !target && isHunter(u) ) {
      const prey = huntable(run, u)
        .map(t => ({ t, moves: Math.min(...u.prep.offense.map(a => movesNeeded(run, u, t, a))) }))
        .filter(x => Number.isFinite(x.moves))
        .sort((a, b) => a.moves - b.moves)[0];
      target = prey?.t ?? null;
    }
    if ( !target ) break;
    // Lore-Collectors study a new foe first (Recall Knowledge), then fight it better.
    if ( behavior.study && !u.studied.has(target.id) && !u.studied.has(`skip:${target.id}`) && turn.howMany(basic) >= 2 ) {
      u.studied.add(target.id);
      if ( run.rng.chance(behavior.study) ) {
        turn.spend(basic);
        log(run, u, `studies ${target.spec.name} for weaknesses`, { type: "study", target: target.spec.name, targetId: target.id });
        continue;
      }
      u.studied.delete(target.id);
      u.studied.add(`skip:${target.id}`);
    }
    // A thief may rob someone within reach instead of hitting them (once a turn).
    if ( !u.stoleThisTurn ) {
      u.stoleThisTurn = true;
      const mark = theftTarget(run, u);
      const chance = mark ? stealChance(run, u, mark) : 0;
      const plan = chance > 0 ? theftPlan(run, u, mark) : null;
      if ( plan && turn.canAfford(plan.cost) && run.rng.chance(chance) ) {
        turn.spend(plan.cost);
        const result = attemptTheft(run, u, mark, (unit, text, data) => log(run, unit, text, data), { plan, attacksMade });
        attacksMade += result.attacks ?? 0;
        continue;
      }
    }
    u.targetId = target.id;
    const option = bestOptionVs(run, u, target, attacksMade, turn);
    if ( !option ) break;

    if ( option.moves > 0 ) {
      if ( !canMove(run, u) ) break;
      // PF2e: a Stride per action. 5e: the rest of the movement, then a Dash.
      const budget = turn.payForMove(approach(run, u, target).speed);
      if ( !budget ) break;
      const move = moveToward(run, u, target, option.action.range ? null : (option.action.reach ?? 5), budget);
      turn.usedMove(move.cost);
      moveLog(run, u, move, target, target.active ? "approach" : "hunt");
      continue;
    }

    const tier = liveTier(run, u);
    const tactics = u.tac;
    const rushing = behavior.rush && run.rng.chance(behavior.rush);
    const shieldCost = rules.shieldCost ?? basic;
    const canShield = u.spec.shield && !u.shieldRaised && tactics?.shield !== "never" && !rushing && turn.canAfford(shieldCost);
    const raiseShield = () => {
      u.shieldRaised = true;
      turn.spend(shieldCost);
      log(run, u, "raises a shield", { type: "shield" });
    };
    // "Always" keeps the shield up: the last action of the turn goes to it.
    if ( canShield && tactics?.shield === "always" && turn.howMany(shieldCost) === 1 ) { raiseShield(); continue; }
    // Skirmishers hit twice and keep moving instead of taking a hopeless third swing.
    if ( tactics?.style === "skirmisher" && attacksMade >= 2 && option.action.melee && turn.canAfford(basic) ) {
      if ( canShield ) raiseShield();
      else {
        turn.spend(basic);
        log(run, u, "steps back to a better position", { type: "step" });
      }
      continue;
    }
    if ( !turn.canAfford(option.cost) ) {
      if ( canShield && tier >= TACTICAL.INSTINCTIVE ) { raiseShield(); continue; }
      break;
    }
    // A thinking combatant with a shield prefers defense over a hopeless third attack.
    if ( canShield && tier >= TACTICAL.COMPETENT && attacksMade >= 2 ) {
      const first = expectedDamage(run, u, option.action, target, 0);
      if ( option.ev < first * 0.3 ) { raiseShield(); continue; }
    }

    if ( option.action.drawCost && !u.drawn.has(option.action.id) ) {
      u.drawn.add(option.action.id);
      log(run, u, `draws ${option.action.name}`, { type: "draw", item: option.action.name });
    }
    executeOffense(run, u, option.action, target, attacksMade);
    spendUse(u, option.action);
    turn.spend(option.cost);
    attacksMade += attacksIn(option.action);
    if ( battleOver(run) ) break;
  }

  u.turnsTaken += 1;
  endOfTurn(run, u);
}

function endOfTurn(run, u) {
  const rules = run.prep.rules;
  if ( u.effects?.length ) {
    for ( const e of u.effects ) e.rounds -= 1;
    const before = u.effects.length;
    u.effects = u.effects.filter(e => e.rounds > 0);
    if ( u.effects.length !== before ) recomputeConditions(u);
  }
  if ( u.persistent.length ) {
    const remaining = [];
    for ( const entry of u.persistent ) {
      const amount = rules.applyIwr(u.spec.iwr, { [entry.part.type]: Math.max(0, samplePart(entry.part, run.rng)) });
      if ( run.log ) log(run, u, `takes ${amount} persistent ${entry.part.type}`, { type: "persistent", damageType: entry.part.type, amount });
      dealDamage(run, run.byId.get(entry.sourceId), u, amount);
      if ( !rules.persistentFlatCheck(run.rng) ) remaining.push(entry);
    }
    u.persistent = remaining;
  }
  if ( u.afflictions.length && u.status !== STATUS.DEAD ) {
    for ( const a of [...u.afflictions] ) {
      a.rounds += 1;
      if ( a.spec.maxDuration && a.rounds >= a.spec.maxDuration ) {
        u.afflictions.splice(u.afflictions.indexOf(a), 1);
        log(run, u, `${a.spec.name} runs its course`, { type: "afflictionEnd", name: a.spec.name });
        continue;
      }
      if ( a.onsetLeft > 0 ) {
        a.onsetLeft -= 1;
        if ( a.onsetLeft <= 0 ) applyAfflictionStage(run, u, a); // the onset is over: the first stage takes hold
        continue;
      }
      const { mod, advantage } = saveRoll(run, u, a.spec.save.type);
      const roll = rollCheck(rules, run.rng, mod, a.spec.save.dc, { advantage, kind: "save" });
      a.stage = Math.min(a.spec.stages.length, a.stage + afflictionStep(rules, roll.degree, "stage"));
      if ( a.stage <= 0 ) {
        u.afflictions.splice(u.afflictions.indexOf(a), 1);
        log(run, u, `recovers from ${a.spec.name}`, { type: "afflictionEnd", name: a.spec.name, natural: roll.natural, mod, total: roll.total, dc: a.spec.save.dc, degree: roll.degree });
        continue;
      }
      applyAfflictionStage(run, u, a);
    }
    recomputeConditions(u);
  }
}

/* -------------------------------------------- */
/*  Aftermath                                   */
/* -------------------------------------------- */

/** Down and not yet stable: still dying, whatever the system calls it (PF2e dying N; 5e death saves). */
const isDying = u => u.status === STATUS.DOWN && !u.stable;

/** Administer first aid to a dying ally: a skill check against the system's DC (PF2e: 15 + dying). */
function firstAid(run, u, target) {
  const rules = run.prep.rules;
  const dc = rules.firstAidDC(target);
  const check = checkRoll(run, u, u.spec.firstAid.mod);
  const roll = rollCheck(rules, run.rng, check.mod, dc, { advantage: check.advantage, kind: "check" });
  const before = target.dying;
  rules.firstAid(target, roll.degree);
  log(run, u, `gives ${target.spec.name} first aid (${roll.total} vs DC ${dc}): ${target.stable ? "stabilized" : target.status === STATUS.DEAD ? "it's too late" : "no change"}`, {
    type: "firstAid", target: target.spec.name, targetId: target.id, natural: roll.natural, mod: u.spec.firstAid.mod, total: roll.total, dc,
    degree: roll.degree, before, dying: target.dying, stable: target.stable, dead: target.status === STATUS.DEAD, aftermath: true
  });
}

/**
 * Once the last enemy is gone, the fight isn't quite over: the winners tend their dying friends (free help such as
 * first aid or Battle Medicine before spending spells and potions), and anyone left untended lives or dies by their
 * recovery checks. What Make it So commits is then settled: stable, healed, or dead, never "dying 2".
 * The fallen on the losing side get no help here; what the victors do with them is the GM's call.
 */
function aftermath(run, order) {
  const { rules, options } = run.prep;
  if ( options.aftermath === AFTERMATH.NONE || options.downedModel !== DOWNED_MODELS.SIMULATE || !run.units.some(isDying) ) return;
  const rounds = run.round;
  run.round = rounds + 1; // one paragraph in the story, after the fight
  log(run, null, "The fighting is over", { type: "aftermath", aftermath: true });
  const marker = run.log?.at(-1);
  let tended = false;
  for ( let i = 0; i < AFTERMATH_ROUNDS && run.units.some(isDying); i++ ) {
    for ( const u of order ) {
      if ( u.status === STATUS.DOWN ) {
        if ( isDying(u) && rules.recoveryCheck ) {
          const before = u.dying;
          const text = rules.recoveryCheck(u, run.rng);
          if ( text ) log(run, u, text, { type: "recovery", before, dying: u.dying, dead: u.status === STATUS.DEAD, stable: u.stable, aftermath: true });
        }
        continue;
      }
      if ( !isStanding(u) ) continue;
      const turn = turnFor(run, u);
      for ( let n = 0; n < MAX_STEPS_PER_TURN && turn.any; n++ ) {
        const dying = run.units.filter(a => a.side === u.side && a !== u && isDying(a)).sort((a, b) => (b.dying ?? 0) - (a.dying ?? 0))[0];
        if ( !dying ) break;
        const option = rescueOption(run, u, dying, turn);
        if ( !option ) break;
        if ( option === "firstAid" ) firstAid(run, u, dying);
        else executeHeal(run, u, option, dying);
        tended = true;
        turn.spend(option === "firstAid" ? (rules.firstAidCost ?? rules.basicAction ?? 1) : costOf(rules, option));
      }
    }
  }
  if ( marker ) marker.tended = tended; // the story opens differently when nobody comes to help
  run.round = rounds;
}

/**
 * When the fight is over, whatever was given up comes back to its owner if the one who took it was beaten (dead,
 * down, surrendered or talked down); a taker who got away keeps it.
 */
const BEATEN = new Set([STATUS.DEAD, STATUS.DOWN, STATUS.SURRENDERED, STATUS.STOOD_DOWN]);
function reclaimGoods(run) {
  for ( const u of run.units ) {
    for ( const c of u.concessions ?? [] ) {
      if ( c.kept || c.returned ) continue;
      const taker = run.byId.get(c.to);
      if ( !taker || !BEATEN.has(taker.status) ) continue;
      c.returned = true;
      log(run, u, `gets back what ${taker.spec.name} took`, { type: "reclaim", concession: c, by: taker.spec.name, byId: taker.id, aftermath: true });
    }
  }
}

/* -------------------------------------------- */
/*  Battle                                      */
/* -------------------------------------------- */

function activeSides(run) {
  return [...new Set(run.units.filter(isStanding).map(u => u.side))];
}

export function battleOver(run) {
  if ( run.resolved ) return true; // a standoff settled by a payment or a retreat
  const active = activeSides(run);
  for ( let i = 0; i < active.length; i++ ) {
    for ( let j = i + 1; j < active.length; j++ ) {
      if ( run.prep.sides[active[i]].enemies.has(active[j]) ) return false;
    }
  }
  // A hunter with prey still in reach keeps the fight going.
  for ( const u of run.units ) {
    if ( isStanding(u) && isHunter(u) && huntable(run, u).length ) return false;
  }
  return true;
}

/** Everything "Make it So" needs to commit one unit's end state. */
function captureUnit(u) {
  return {
    hp: u.hp,
    temp: u.temp,
    status: u.status,
    active: u.active,
    joinedRound: u.joinedRound,
    dying: u.dying,
    wounded: u.wounded,
    stable: u.stable,
    prone: u.prone,
    persistent: u.persistent.map(e => ({ type: e.part.type, part: e.part })),
    afflictions: u.afflictions.map(a => ({ id: a.spec.id, name: a.spec.name, slug: a.spec.slug ?? null, stage: a.stage, rounds: a.rounds, onset: a.onsetLeft ?? 0, dc: a.spec.save.dc, save: a.spec.save.type })),
    conditions: { ...u.conds },
    swayed: u.swayOutcome,
    concessions: (u.concessions ?? []).map(c => ({ ...c })), // what they gave up when talked into it (Make it So hands it over)
    side: u.side,
    resources: { ...u.resources },
    uses: { ...u.uses },
    killerId: u.killerId ?? null,
    position: u.pos ? { x: u.pos.x, y: u.pos.y } : null,
    feetMoved: Math.round(u.feetMoved)
  };
}

function summarize(run, ended, capture, winners) {
  const outcome = !ended ? "stalemate" : (winners.length ? "victory" : "none");
  const units = {};
  for ( const u of run.units ) {
    const lost = ended && !winners.includes(u.side);
    units[u.id] = {
      status: u.status,
      involved: u.active,
      atMercy: u.status === STATUS.DOWN && lost,
      wasDowned: u.wasDowned,
      hpFrac: u.maxHp > 0 ? u.hp / u.maxHp : 0,
      damage: u.damageDealt,
      healing: u.healingDone,
      fellRound: u.fellRound,
      swayed: u.swayOutcome,
      conceded: (u.concessions?.length ?? 0) > 0,
      resourcesUsed: Object.fromEntries(Object.entries(u.resourcesStart).map(([k, v]) => [k, v - (u.resources[k] ?? 0)])),
      final: capture ? captureUnit(u) : undefined
    };
  }
  // Settled with words: it ended and nobody ever struck a blow.
  return { outcome, winners, rounds: run.round, firstFallen: run.firstFallen, peaceful: ended && !run.blood, units, log: run.log };
}

/** Simulate a single battle. */
export function runOne(prep, seed, { log: withLog = false, capture = false } = {}) {
  const run = createRun(prep);
  run.rng = createRng(seed);
  // Each simulated fight decides which stated preferences win out (see "stay mostly true").
  for ( const u of run.units ) {
    u.tac = sampleRunTactics(u.spec, run.rng);
    u.hunts = u.tac?.beyond === "hunt";
  }
  if ( withLog ) run.log = [];
  const order = rollInitiative(run);
  if ( withLog ) {
    const fighters = order.filter(u => u.active);
    log(run, null, `Initiative: ${fighters.map(u => u.spec.name).join(", ")}`, { type: "initiative", order: fighters.map(u => u.spec.name) });
  }
  // Words before weapons, when the sides would rather talk (or the GM says so).
  run.standoff = opensWithTalk(run);
  if ( run.standoff ) log(run, null, "A tense standoff: words before weapons", { type: "standoff" });

  const surpriseSide = prep.options.surpriseSide;
  if ( surpriseSide ) {
    run.round = 0;
    log(run, null, `Surprise round for ${prep.sides[surpriseSide]?.label ?? surpriseSide}`, { type: "surprise", sideLabel: prep.sides[surpriseSide]?.label ?? surpriseSide });
    for ( const u of order ) if ( u.side === surpriseSide ) takeTurn(run, u);
  }
  let ended = battleOver(run);
  for ( let round = 1; !ended && round <= prep.options.maxRounds; round++ ) {
    run.round = round;
    checkAwareness(run);
    for ( const u of order ) {
      takeTurn(run, u);
      if ( battleOver(run) ) { ended = true; break; }
    }
  }
  // Who won is decided when the last blow lands (or the deal is struck); the aftermath only settles the fallen.
  const winners = !ended ? [] : run.resolved ? [run.resolved.side] : activeSides(run);
  if ( withLog ) {
    const labels = winners.map(s => prep.sides[s]?.label ?? s);
    log(run, null, ended ? (labels.length ? `${labels.join(" & ")} win after ${run.round} rounds` : "No one is left standing") : `Still fighting after ${run.round} rounds`, {
      type: "end", outcome: !ended ? "stalemate" : (winners.length ? "victory" : "none"), winners, winnerLabels: labels, rounds: run.round,
      peaceful: ended && !run.blood, standoff: !!run.standoff, resolved: run.resolved?.outcome ?? null
    });
  }
  if ( ended ) {
    aftermath(run, order);
    reclaimGoods(run);
  }
  return summarize(run, ended, capture, winners);
}

/**
 * Run a batch of simulations, giving the event loop back every few milliseconds so the page stays responsive
 * however big the fight. An aborted batch returns the fights finished so far.
 * @param {object} spec             BattleSpec
 * @param {object} rules            System rules
 * @param {object} [opts]
 * @param {number} [opts.runs=2000]
 * @param {number} [opts.seed]
 * @param {(fraction: number) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 */
export async function runBatch(spec, rules, { runs = 2000, seed = randomSeed(), onProgress, signal } = {}) {
  const prep = prepareBattle(spec, rules);
  const agg = createAggregator(prep);
  let sliceStart = performance.now();
  for ( let i = 0; i < runs; i++ ) {
    const runSeed = deriveSeed(seed, i);
    agg.add(runOne(prep, runSeed), runSeed);
    if ( performance.now() - sliceStart > SLICE_MS ) {
      onProgress?.((i + 1) / runs);
      await new Promise(resolve => setTimeout(resolve, 0));
      if ( signal?.aborted ) break;
      sliceStart = performance.now();
    }
  }
  onProgress?.(1);
  return { ...agg.finish(), seed };
}

/** Synchronous batch for tests and small what-if comparisons. */
export function runBatchSync(spec, rules, { runs = 1000, seed = 1 } = {}) {
  const prep = prepareBattle(spec, rules);
  const agg = createAggregator(prep);
  for ( let i = 0; i < runs; i++ ) {
    const runSeed = deriveSeed(seed, i);
    agg.add(runOne(prep, runSeed), runSeed);
  }
  return { ...agg.finish(), seed };
}

/** Replay one seed with a full narrative log and captured end state. */
export function replay(spec, rules, seed) {
  return runOne(prepareBattle(spec, rules), seed, { log: true, capture: true });
}

/**
 * Find a seed whose outcome matches a predicate (e.g. "party wins", "a PC dies"), for the sample-fight picker.
 * @returns {{seed: number, result: object}|null}
 */
export function findSample(spec, rules, predicate, { start = 1, tries = 500 } = {}) {
  const prep = prepareBattle(spec, rules);
  for ( let i = 0; i < tries; i++ ) {
    const seed = deriveSeed(start, i);
    const result = runOne(prep, seed, { capture: true });
    if ( predicate(result) ) return { seed, result: runOne(prep, seed, { log: true, capture: true }) };
  }
  return null;
}

export { prepareBattle, areEnemies, liveTrait };
