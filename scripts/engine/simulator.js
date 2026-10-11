/**
 * Round-by-round battle simulation. Pure: give it a BattleSpec and a rules object, get statistics back.
 *
 * Every logged event carries structured data (type, rolls, margins, damage types, movement) so the story
 * writer can narrate it at any level of detail.
 */
import { STATUS, TACTICAL, DOWNED_MODELS, AFTERMATH, EXECUTE_LUCK, clamp } from "../constants.js";
import { createRng, deriveSeed, randomSeed } from "./rng.js";
import { sampleDamage, samplePart } from "./dice.js";
import { rollCheck } from "./probability.js";
import { costOf, mainPool } from "./turn.js";
import {
  prepareBattle, createRun, isStanding, isUp, enemiesOf, alliesOf, areEnemies, liveTier, liveTrait, currentAc,
  attackRoll, saveRoll, checkRoll, turnFor, moveToward, moveAway, bonusDamageParts, dispositionOf,
  behaviorOf, edgeDistance, movesNeeded, approach, canMove, moveTowardPoint
} from "./battle-state.js";
import { sampleRunTactics } from "./playstyles.js";
import { chooseTarget, bestOptionVs, scoreTargets } from "./behavior/targeting.js";
import { decideHeal, rescueOption, healScores } from "./behavior/healing.js";
import { initDesires, newTurn, think, want, thwart, relieve, levelOf, mind, thoughts as thoughtsOf, levelsFromScores, listen, remember, styleWants, styleOf, CHOICE_LEVEL } from "./behavior/desire.js";
import { prepareDoors, doorStates, doorAhead, atDoor, doorPlan, patienceFor, doorDamage } from "./behavior/doors.js";
import { checkMorale, MORALE } from "./behavior/morale.js";
import { expectedDamage, spendUse, attacksIn, criticalParts, saveMultiplier } from "./behavior/evaluate.js";
import { createAggregator } from "./aggregate.js";
import { talkActionsThisTurn, choosePitch, attemptTalk } from "./behavior/talk.js";
import { opensWithTalk, breaksStandoff, standoffPitches, charismaticLeader } from "./behavior/standoff.js";
import { controlOutcome, controlRoll, isImmune, degreeShift } from "./behavior/control.js";
import { recompute as recomputeConditions, applyOutcome, applyControl, beginConcentration, endConcentration, holdsAnything, noteConcentration, moveHeld, settleAllegiance, iwrOf } from "./behavior/effects.js";
import { decideBuff, aidScores } from "./behavior/support.js";
import { perceives } from "./behavior/senses.js";
import { stealChance, theftTarget, theftPlan, attemptTheft } from "./behavior/theft.js";
import { reactionsPerRound, threats, takesSafeWay } from "./behavior/reactions.js";
import { normalizeCost } from "./turn.js";

const MAX_STEPS_PER_TURN = 8;
/** After the last blow, how long the winners keep tending the dying (ten minutes of rounds, at most). */
const AFTERMATH_ROUNDS = 100;
/** Batches give the browser back control this often (ms), so the GM's screen stays responsive. */
const SLICE_MS = 25;
const DEGREE_LABEL = ["critical failure", "failure", "success", "critical success"];
/** How much being hit makes a creature want to hit back, by tactical band: simple minds go for whoever hurt them. */
const HIT_URGE = [40, 25, 10, 5, 3];

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
    const from = run.log && b.pos ? { x: b.pos.x, y: b.pos.y } : null;
    moveAway(run, b, (b.spec.speeds?.walk ?? 25) * 2);
    return log(run, b, "wants no part of it and slips away", { type: "leave", from, to: from ? { x: b.pos.x, y: b.pos.y } : null });
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
  if ( target.effects?.some(e => e.endsOnDamage || e.endsOnHarm) ) {
    // A blow wakes the sleeper; a charm breaks when its caster's side does the harm.
    const harms = e => {
      if ( e.endsOnDamage ) return true;
      const holder = run.byId.get(e.sourceId);
      return !!(e.endsOnHarm && source && holder && (source === holder || source.homeSide === holder.homeSide));
    };
    const before = target.effects.length;
    target.effects = target.effects.filter(e => !harms(e));
    if ( target.effects.length !== before ) {
      recomputeConditions(target);
      settleSides(run);
    }
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
      if ( areEnemies(run, source, target) ) {
        // Hit from afar while already trading blows with someone: keep at the one in front of it.
        const busy = !target.adjacent.has(source.id) && [...target.adjacent].some(id => { const o = run.byId.get(id); return o && isStanding(o) && areEnemies(run, target, o); });
        want(target, "hurt", source.id, (busy ? 3 : (HIT_URGE[liveTier(run, target)] ?? 5)) * styleOf(target).retaliate);
      }
    }
    if ( target.hp <= 0 ) {
      target.hp = 0;
      target.wasDowned = true;
      rules.onDropped(target, { crit, model, amount: rest, overflow: Math.max(0, rest - dealt) });
      if ( source?.spec.neverKill && target.status === STATUS.DEAD ) knockOut(run, target);
      target.fellRound ??= run.round;
      target.killerId = source?.id ?? target.killerId ?? null;
      run.firstFallen ??= target.id;
      releaseGrabs(run, target);
      const dead = target.status === STATUS.DEAD;
      // A friend's fall: the one who did it becomes someone to settle with, the more so for the loyal.
      if ( source ) {
        for ( const a of run.units ) {
          if ( a !== target && a.side === target.side && isStanding(a) && perceives(run, a, target, { crisis: true }) ) want(a, "hurt", source.id, 15 * liveTrait(run, a, "loyal") / 60 * styleOf(a).avenge);
        }
      }
      log(run, target, dead ? "is slain" : target.knockedOut ? "is knocked out" : `falls${target.dying ? ` (dying ${target.dying})` : ""}`, {
        type: dead ? "death" : "down", by: source?.spec.name ?? null, byId: source?.id ?? null, dying: target.dying, knockedOut: !!target.knockedOut
      });
    }
    testConcentration(run, target, rest + absorbed);
  } else if ( target.status === STATUS.DOWN ) {
    if ( model === DOWNED_MODELS.OUT ) return;
    rules.onDropped(target, { crit, model, amount, overflow: amount });
    if ( source?.spec.neverKill && target.status === STATUS.DEAD ) knockOut(run, target);
    const dead = target.status === STATUS.DEAD;
    if ( dead ) target.killerId = source?.id ?? target.killerId ?? null;
    log(run, target, dead ? "is finished off" : `is struck while down (dying ${target.dying})`, { type: dead ? "death" : "struckDown", by: source?.spec.name ?? null, byId: source?.id ?? null, dying: target.dying, finished: dead });
  }
}

/** Knocked out, not killed: down at 0 hit points, unconscious and stable (the system may say more: rules.knockOut). */
function knockOut(run, u) {
  u.status = STATUS.DOWN;
  u.hp = 0;
  u.dying = 0;
  u.stable = true;
  u.knockedOut = true;
  run.prep.rules.knockOut?.(u);
}

function releaseGrabs(run, u) {
  for ( const other of run.units ) if ( other.grabbedBy === u.id ) other.grabbedBy = null;
}

/** Charmed and dominated creatures change sides as their holds take and end: tell it. */
function settleSides(run) {
  for ( const { u, joined, home, holder } of settleAllegiance(run) ) {
    const homeLabel = run.prep.sides[home]?.label ?? home;
    log(run, u, joined ? `turns on ${homeLabel}, under ${holder?.spec.name ?? "someone"}'s control` : "comes back to its senses", {
      type: "allegiance", joined, by: holder?.spec.name ?? null, byId: holder?.id ?? null, home, homeLabel
    });
  }
}

/**
 * Concentration (where the system has it): a blow may break it, and so do conditions that leave the creature unable
 * to act. Whatever it was holding up ends.
 */
function testConcentration(run, u, amount = 0) {
  const c = run.prep.rules.concentration;
  if ( !u.concentration || !c ) return;
  let broken = u.status !== STATUS.STANDING || (c.breaksOn ?? []).some(k => (u.conds[k] ?? 0) > 0);
  let roll = null;
  let dc = null;
  if ( !broken && amount > 0 ) {
    dc = c.dc ? c.dc(amount) : Math.max(10, Math.floor(amount / 2));
    const s = saveRoll(run, u, c.save ?? "con");
    roll = { ...rollCheck(run.prep.rules, run.rng, s.mod, dc, { advantage: s.advantage, dice: s.dice, kind: "save" }), mod: s.mod };
    broken = roll.degree < 2;
  }
  if ( !broken ) return;
  const name = u.concentration.name;
  const ended = endConcentration(run, u);
  settleSides(run);
  log(run, u, `loses concentration on ${name}`, {
    type: "concentrationEnd", action: name, effects: ended, reason: roll ? "blow" : "incapacitated",
    ...(roll ? { saveType: c.save ?? "con", natural: roll.natural, mod: roll.mod, total: roll.total, dc, degree: roll.degree } : {})
  });
}

function applyAfflictionStage(run, target, affliction) {
  const stage = affliction.spec.stages[affliction.stage - 1];
  recomputeConditions(target);
  if ( !stage?.damage?.length ) return;
  const rolled = sampleDamage(stage.damage, run.rng);
  const amount = run.prep.rules.applyIwr(iwrOf(target), rolled.byType);
  log(run, target, `${affliction.spec.name} stage ${affliction.stage}: ${amount} damage`, {
    type: "afflictionStage", name: affliction.spec.name, stage: affliction.stage, amount, damageType: stage.damage[0]?.type ?? "poison"
  });
  dealDamage(run, run.byId.get(affliction.sourceId), target, amount);
}

function exposeToAffliction(run, source, target, spec) {
  if ( target.spec.iwr?.immune?.some(k => spec.traits?.includes(k)) ) return;
  const rules = run.prep.rules;
  const { mod, advantage, dice } = saveRoll(run, target, spec.save.type);
  const roll = rollCheck(rules, run.rng, mod, spec.save.dc, { advantage, dice, kind: "save" });
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
      testConcentration(run, target);
      log(run, target, `is left ${effect.label || "reeling"}`, { type: "condition", by: u.spec.name, effect: effect.label ?? "" });
    } else if ( effect.kind === "save" && effect.save ) {
      saveRider(run, u, action, target, effect);
    }
  }
}

/**
 * A rider that calls for a save when it hits: a wolf's bite (Strength or be knocked prone), a spider's venom
 * (Constitution, half damage on a success). {save, damage?, conditions?, rounds?, label?}
 */
function saveRider(run, u, action, target, effect) {
  const rules = run.prep.rules;
  const { mod, advantage, dice } = saveRoll(run, target, effect.save.type);
  const roll = rollCheck(rules, run.rng, mod, effect.save.dc, { advantage, dice, kind: "save" });
  const mult = effect.damage?.length ? saveMultiplier(rules, roll.degree, effect.save) : 0;
  const hit = mult > 0 ? rollHit(run, u, action, target, effect.damage, mult, false) : null;
  log(run, target, `${effect.label || action.name}: ${effect.save.type} save ${DEGREE_LABEL[roll.degree]}${hit ? `, ${hit.total} damage` : ""}`, {
    type: "riderSave", name: effect.label || action.name, by: u.spec.name, saveType: effect.save.type, natural: roll.natural, mod, total: roll.total,
    dc: effect.save.dc, degree: roll.degree, damage: hit?.total ?? 0, controls: !!effect.conditions
  });
  hit?.apply();
  if ( roll.degree > 1 || !effect.conditions || !isUp(target) ) return;
  if ( isImmune(run, target, { traits: action.traits, onSave: [effect] }) ) return;
  applyControl(target, effect, u.id);
  testConcentration(run, target);
  log(run, target, `is left ${effect.label || "reeling"}`, { type: "condition", by: u.spec.name, effect: effect.label ?? "" });
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
  const total = rules.applyIwr(iwrOf(t), rolled.byType);
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
  for ( const target of targets ) fateful(run, target, u, () => strikeTarget(run, u, action, target, attacksMade, ranged, logging));
  if ( action.melee ) {
    u.adjacent.add(t.id);
    t.adjacent.add(u.id);
  }
  // A concentration spell everyone shrugged off holds nothing up.
  if ( action.concentration && u.concentration?.actionId === action.id && !holdsAnything(run, u) ) u.concentration = null;
}

/** What one use of an action does to one target: the attack or save, the damage, the riders. */
function strikeTarget(run, u, action, target, attacksMade, ranged, logging) {
  const rules = run.prep.rules;
  {
    if ( !target.active ) notice(run, target, "attacked", u);
    target.lastAttackerId = u.id;
    const held = target.grudges?.get(u.id);
    if ( held && !held.provoked ) {
      held.provoked = true; // they took from me, and now this
      want(target, "hurt", u.id, 60);
    }

    const common = logging ? {
      action: action.name, actionKind: action.kind, damageType: primaryType(action), target: target.spec.name, targetId: target.id,
      ranged, area: !!action.area, targetCover: !!target.spec.environment?.nearCover, attackerCover: !!u.spec.environment?.nearCover
    } : null;

    if ( action.kind === "auto" ) {
      const extra = bonusDamageParts(run, u, action, target, { commit: true });
      const hit = rollHit(run, u, action, target, (action.damage ?? []).concat(extra), 1, false);
      if ( logging ) log(run, u, `${action.name} → ${target.spec.name}: ${hit.total} damage`, { type: "auto", ...common, damage: hit.total });
      hit.apply();
      return;
    }

    if ( action.kind === "control" ) {
      executeControl(run, u, action, target, attacksMade, common);
      return;
    }

    if ( action.kind === "save" && action.save ) {
      const extra = bonusDamageParts(run, u, action, target, { commit: true });
      const { mod, advantage, dice } = saveRoll(run, target, action.save.type);
      const roll = rollCheck(rules, run.rng, mod, action.save.dc, { advantage, dice, kind: "save" });
      const mult = saveMultiplier(rules, roll.degree, action.save);
      const data = !logging ? null : { type: "save", ...common, saveType: action.save.type, natural: roll.natural, mod: mod + (roll.die ?? 0), total: roll.total, dc: action.save.dc, degree: roll.degree, margin: roll.total - action.save.dc };
      if ( mult > 0 ) {
        const hit = rollHit(run, u, action, target, (action.damage ?? []).concat(extra), mult, roll.degree === 0);
        if ( logging ) log(run, u, `${action.name} → ${target.spec.name}: save ${DEGREE_LABEL[roll.degree]}, ${hit.total} damage`, { ...data, damage: hit.total });
        hit.apply();
        if ( roll.degree <= 1 ) applyEffects(run, u, action, target, 3 - roll.degree);
      } else if ( logging ) log(run, u, `${action.name} → ${target.spec.name}: ${DEGREE_LABEL[roll.degree]}, no damage`, { ...data, damage: 0 });
      return;
    }

    const { bonus, advantage, dice } = attackRoll(run, u, target, action, attacksMade);
    const ac = currentAc(run, target, u, action);
    const roll = rollCheck(rules, run.rng, bonus, ac, { advantage, dice, kind: "attack" });
    const data = !logging ? null : { type: "attack", ...common, natural: roll.natural, mod: bonus + (roll.die ?? 0), total: roll.total, dc: ac, degree: roll.degree, margin: roll.total - ac, attackNumber: attacksMade + 1 };
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
}

/* -------------------------------------------- */
/*  The execution luck check                    */
/* -------------------------------------------- */

/** A creature other than a player character going for a player character who's down: the one blow players dread. */
const wouldExecute = (u, t) => !!t && t.status === STATUS.DOWN && t.spec.kind === "pc" && u.spec.kind !== "pc";

/**
 * Each time a creature wants to finish off a player character at 0 HP, it rolls d100: only on the world's number or
 * less (39 by default) does it go ahead. Otherwise it turns away, and everything it wanted of the fallen PC goes to
 * the next foe it would pick, in its usual order (if there is one). Once a turn for each creature and PC.
 * Returns whom it goes for now.
 */
function executionCheck(run, u, t) {
  if ( !wouldExecute(u, t) ) return t;
  const key = `${run.round}|${t.id}`;
  u.executionChecks ??= new Map();
  const known = u.executionChecks.get(key);
  if ( known ) return known.next;
  const roll = run.rng.die(100);
  const needed = run.prep.options.executeLuck ?? EXECUTE_LUCK;
  if ( roll <= needed ) {
    u.executionChecks.set(key, { next: t });
    log(run, u, `means to finish off ${t.spec.name} (luck d100 ${roll}, ${needed} or less)`, { type: "execute", target: t.spec.name, targetId: t.id, luck: roll, needed, goes: true });
    return t;
  }
  const next = scoreTargets(run, u).map(x => x.t).find(o => o !== t && !wouldExecute(u, o)) ?? null;
  moveDesires(u, t, next);
  u.executionChecks.set(key, { next });
  log(run, u, `turns away from the fallen ${t.spec.name}${next ? ` to go after ${next.spec.name}` : ""} (luck d100 ${roll}, needed ${needed} or less)`, {
    type: "execute", target: t.spec.name, targetId: t.id, next: next?.spec.name ?? null, nextId: next?.id ?? null, luck: roll, needed, goes: false
  });
  return next;
}

/** Everything u wanted of `from` (to hurt it) goes to `to` instead, or simply goes. */
function moveDesires(u, from, to) {
  const d = u.desire;
  if ( d ) {
    const fromKey = `hurt|${from.id}`;
    const toKey = to ? `hurt|${to.id}` : null;
    for ( const map of [d.stated, d.memory, d.logic, d.social, d.style] ) {
      const v = map.get(fromKey);
      if ( v === undefined ) continue;
      map.delete(fromKey);
      if ( toKey ) map.set(toKey, (map === d.stated || map === d.logic) ? Math.max(map.get(toKey) ?? 0, v) : (map.get(toKey) ?? 0) + v);
    }
    d.frustration.delete(fromKey);
  }
  if ( u.targetId === from.id ) u.targetId = to?.id ?? null;
}

/* -------------------------------------------- */
/*  Fate: hero points, inspiration              */
/* -------------------------------------------- */

/** Fate a creature has left to spend (resources.fate: PF2e hero points, 5e Heroic Inspiration, from the helper). */
const fateOf = u => u.resources?.fate ?? 0;

/**
 * Who spends fate to keep `victim` alive: the victim itself first, always; otherwise a friend with some left who
 * can tell it's happening (in a moment like this, any sense will do), the less selfish the likelier.
 */
function fateSpender(run, victim) {
  if ( fateOf(victim) > 0 ) return victim;
  for ( const a of run.units ) {
    if ( a === victim || a.side !== victim.side || !isStanding(a) || fateOf(a) <= 0 ) continue;
    if ( !perceives(run, a, victim, { crisis: true }) ) continue;
    if ( run.rng.chance(clamp(1 - liveTrait(run, a, "selfish") / 100, 0.05, 0.95)) ) return a;
  }
  return null;
}

/** What a blow, a save or a recovery check can change on a creature, to put it back as it was. */
function snapshotOf(u) {
  const s = {};
  for ( const [k, v] of Object.entries(u) ) if ( v === null || typeof v !== "object" ) s[k] = v;
  s.conds = { ...u.conds };
  s.effects = [...(u.effects ?? [])];
  s.persistent = [...(u.persistent ?? [])];
  s.afflictions = (u.afflictions ?? []).map(a => ({ ...a }));
  s.harmedBy = new Map(u.harmedBy ?? []);
  s.usedThisTurn = u.usedThisTurn ? new Set(u.usedThisTurn) : u.usedThisTurn;
  return s;
}

/**
 * Something that might kill `victim`: a blow, a save, a recovery check. If it does and someone spends fate, it's
 * taken back and rolled again (a hit may become a miss, a failed check a success), up to three times. Where the
 * system has a sure way out for the dying themselves (PF2e Heroic Recovery, all their hero points), it's that.
 */
function fateful(run, victim, actor, attempt) {
  if ( !run.fateInPlay || !victim || victim.status === STATUS.DEAD ) return attempt();
  const rules = run.prep.rules;
  for ( let tries = 0; ; tries++ ) {
    const before = snapshotOf(victim);
    const by = actor && actor !== victim ? snapshotOf(actor) : null;
    const logLength = run.log?.length ?? 0;
    const firstFallen = run.firstFallen;
    attempt();
    if ( victim.status !== STATUS.DEAD || tries >= 3 ) return;
    const spender = fateSpender(run, victim);
    if ( !spender ) return;
    const label = spender.spec.fateLabel ?? "fate";
    if ( spender === victim && rules.avertDeath ) {
      const spent = fateOf(victim);
      rules.avertDeath(victim);
      victim.resources.fate = 0;
      run.fateInPlay = run.units.some(o => fateOf(o) > 0);
      log(run, victim, `spends ${label} and pulls back from death`, { type: "fate", self: true, label, spent, sure: true });
      return;
    }
    Object.assign(victim, before);
    if ( by ) Object.assign(actor, by);
    recomputeConditions(victim);
    if ( run.log ) run.log.length = logLength;
    run.firstFallen = firstFallen;
    spender.resources.fate -= 1;
    run.fateInPlay = run.units.some(o => fateOf(o) > 0);
    log(run, spender, spender === victim ? `spends ${label} to cheat death` : `spends ${label} to save ${victim.spec.name}`, {
      type: "fate", self: spender === victim, target: victim.spec.name, targetId: victim.id, label, spent: 1
    });
  }
}

/** A crowd-control action on one target: immunity, the roll, the outcome for that degree, any damage. */
function executeControl(run, u, action, target, attacksMade, common) {
  const rules = run.prep.rules;
  const logging = !!run.log;
  if ( action.oncePerTarget ) (u.triedOn ??= new Set()).add(`${action.id}|${target.id}`);
  if ( isImmune(run, target, action) ) {
    if ( logging ) log(run, u, `${action.name} → ${target.spec.name}: unaffected`, { type: "control", ...common, immune: true, degree: null });
    return;
  }
  // Starting something that needs concentration lets go of whatever it held before.
  const released = u.concentration?.actionId === action.id ? [] : beginConcentration(run, u, action);
  if ( released.length ) log(run, u, `lets ${released.join(", ")} go`, { type: "concentrationEnd", effects: released, reason: "switch" });
  const r = controlRoll(run, u, target, action, attacksMade);
  const dc = r.dc ?? null;
  const roll = r.kind === "auto" ? { natural: null, total: null, degree: 2, mod: null }
    : (() => { const x = rollCheck(rules, run.rng, r.mod, r.dc, { advantage: r.advantage, dice: r.dice, kind: r.rollKind }); return { ...x, mod: r.mod + (x.die ?? 0) }; })();
  // Some effects hold weaker on much stronger targets (PF2e incapacitation): their result counts one better.
  const shift = r.kind === "auto" ? 0 : degreeShift(run, u, target, action);
  const degree = Math.max(0, Math.min(3, roll.degree + (action.save ? shift : -shift)));
  const outcome = controlOutcome(action, degree);
  // Most outcomes land on the target; a botched Trip lands on the one who tried it.
  const lands = outcome?.self ? u : target;
  if ( outcome && isUp(lands) ) {
    if ( !outcome.self ) moveHeld(run, u, action, lands);
    applyOutcome(lands, outcome, u.id, action);
    testConcentration(run, lands);
  }
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
    log(run, u, `${action.name} → ${target.spec.name}: ${outcome?.label || "no effect"}${outcome?.self ? " (on itself)" : ""}${damage ? `, ${damage} damage` : ""}`, {
      controls: !!outcome?.conditions?.controlled,
      type: "control", ...common, roll: r.kind, saveType: action.save?.type ?? null, against: action.check?.against ?? null,
      natural: roll.natural, mod: roll.mod, total: roll.total, dc, degree, margin: roll.total === null ? null : roll.total - dc,
      effect: outcome?.label ?? "", took: !!outcome, backfired: !!outcome?.self, damage, shifted: shift,
      debuff: !!(outcome?.mods || outcome?.mark), tempHp: Number(outcome?.tempHp) || 0
    });
  }
}

/** A buff on its recipients (the user too, for an aura). An action it gains at once (Action Surge) goes on the turn. */
function executeBuff(run, u, action, targets, worth = 0, turn = null) {
  if ( action.oncePerTurn ) (u.usedThisTurn ??= new Set()).add(action.id);
  const now = Number(action.outcome?.actionsNow) || 0;
  if ( now > 0 && turn && targets.includes(u) ) turn.pools[mainPool(run.prep.rules)] = (turn.pools[mainPool(run.prep.rules)] ?? 0) + now;
  const released = u.concentration?.actionId === action.id ? [] : beginConcentration(run, u, action);
  if ( released.length ) log(run, u, `lets ${released.join(", ")} go`, { type: "concentrationEnd", effects: released, reason: "switch" });
  const landed = targets.filter(t => isUp(t));
  if ( landed.length === 1 ) moveHeld(run, u, action, landed[0]);
  for ( const t of landed ) applyOutcome(t, action.outcome, u.id, action);
  spendUse(u, action);
  if ( action.concentration ) {
    if ( holdsAnything(run, u) ) noteConcentration(u, worth);
    else u.concentration = null;
  }
  if ( run.log ) {
    const self = landed.length === 1 && landed[0] === u;
    const names = landed.map(t => (t === u ? "self" : t.spec.name));
    log(run, u, `${action.name} → ${names.join(", ")}`, {
      type: "buff", action: action.name, effect: action.outcome?.label ?? action.name, self, targets: landed.map(t => t.spec.name),
      targetIds: landed.map(t => t.id), withSelf: landed.includes(u), tempHp: Number(action.outcome?.tempHp) || 0, aura: !!action.aura,
      tell: action.tell ?? null // a story line of its own (dodge, reckless, surge), if the system names one
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
    // Someone's life on it: a healer with fate to spare tries again (the selfish less readily, for others).
    const dying = target.status === STATUS.DOWN && !target.stable;
    if ( !multiplier && dying && fateOf(u) > 0 && (u === target || run.rng.chance(clamp(1 - liveTrait(run, u, "selfish") / 100, 0.05, 0.95))) ) {
      u.resources.fate -= 1;
      run.fateInPlay = run.units.some(o => fateOf(o) > 0);
      log(run, u, `spends ${u.spec.fateLabel ?? "fate"} to try again for ${target.spec.name}`, { type: "fate", target: target.spec.name, targetId: target.id, label: u.spec.fateLabel ?? "fate", spent: 1 });
      roll = rollCheck(rules, run.rng, check.mod, action.healCheck.dc, { advantage: check.advantage, kind: "check" });
      multiplier = rules.healCheckMultiplier ? rules.healCheckMultiplier(roll.degree) : [0, 0, 1, 2][roll.degree];
    }
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

/**
 * u is about to walk away from foes beside it (all but `keep`, the one it's heading for). Each that can react
 * strikes as it goes, unless u, mindful of it, first gets clear safely (5e Disengage, PF2e Step) when what's left
 * of the turn allows. Afterwards it's no longer beside them. Returns false if u didn't survive leaving.
 */
function leaveReach(run, u, turn, keep = null, need = null) {
  const list = u.disengaged ? [] : threats(run, u, keep);
  if ( list.length ) {
    const safe = run.prep.rules.disengage?.(u);
    if ( takesSafeWay(run, u, safe, turn, need) ) {
      turn.spend(safe.cost);
      u.disengaged = true;
      log(run, u, safe.label ?? "gets clear carefully", { type: "disengage", label: safe.label ?? "" });
    } else {
      for ( const { e, strike } of list ) {
        if ( !isStanding(u) || battleOver(run) ) break;
        e.reactionsLeft -= 1;
        log(run, e, `strikes at ${u.spec.name} as they pull away`, { type: "opportunity", target: u.spec.name, targetId: u.id, action: strike.name });
        executeOffense(run, e, strike, u, 0);
      }
      // That hurt: whatever it was heading for seems a little less worth it.
      if ( keep ) thwart(run, u, areEnemies(run, u, keep) ? "hurt" : "heal", keep.id, 6);
    }
  }
  for ( const id of [...u.adjacent] ) {
    if ( keep && id === keep.id ) continue;
    run.byId.get(id)?.adjacent.delete(u.id);
    u.adjacent.delete(id);
  }
  return isStanding(u);
}

function flee(run, u, reason, turn = null) {
  // Turning to run from a foe in reach invites a parting blow.
  if ( !leaveReach(run, u, turn) ) return;
  u.status = STATUS.FLED;
  u.fellRound ??= run.round;
  if ( u.concentration ) {
    endConcentration(run, u);
    settleSides(run);
  }
  for ( const id of u.adjacent ) run.byId.get(id)?.adjacent.delete(u.id);
  u.adjacent.clear();
  releaseGrabs(run, u);
  const from = run.log && u.pos ? { x: u.pos.x, y: u.pos.y } : null;
  const feet = moveAway(run, u, (Math.max(...Object.values(u.spec.speeds ?? { walk: 25 })) || 25) * 2);
  log(run, u, reason, { type: "flee", feet, mode: (u.spec.speeds?.fly ?? 0) > 0 ? "fly" : "walk", from, to: from ? { x: u.pos.x, y: u.pos.y } : null });
  // Fleeing into a bystander alerts them; an ally will hear the call for help.
  for ( const b of run.units ) {
    if ( b.active || b.status !== STATUS.STANDING ) continue;
    const d = edgeDistance(u, b);
    if ( d !== null && d <= 40 ) notice(run, b, b.side === u.side ? "help" : "fledInto", u);
  }
}

function moveLog(run, u, move, toward, purpose = "approach") {
  if ( !run.log || !(move.feet > 0) ) return;
  log(run, u, `${move.mode === "walk" ? "moves" : move.mode === "fly" ? "flies" : move.mode === "swim" ? "swims" : move.mode === "climb" ? "climbs" : "burrows"} toward ${toward.spec.name}`, {
    type: "move", mode: move.mode, feet: move.feet, mult: move.mult, regions: move.regions, toward: toward.spec.name, towardId: toward.id,
    from: move.from ?? null, to: move.to ?? null,
    reached: move.reached, purpose, tactical: liveTier(run, u), cover: !!u.spec.environment?.nearCover
  });
}

/** A door gives way (or is simply opened): it's open for everyone now, and nobody's walled off by it any more. */
function openDoor(run, door, state, broken = false) {
  state.open = true;
  state.locked = false;
  state.broken ||= broken;
  run.geo = (run.geo ?? 0) + 1;
  for ( const o of run.units ) for ( const [tid, did] of o.walledOff ?? [] ) if ( did === door.id ) o.walledOff.delete(tid);
}

/**
 * A closed door between u and what it's after: walk to it, then open it, or (if it's locked and u wants it badly
 * enough) bash it, hack at it or pick the lock, whichever is quickest for u. Every failed try wears the desire down.
 * Returns "moved", "worked", "giveup" (not worth it: u turns to something else) or "stuck" (nothing left this turn).
 */
function workTheDoor(run, u, turn, door, target) {
  const rules = run.prep.rules;
  const state = run.doors.get(door.id);
  const kind = areEnemies(run, u, target) ? "hurt" : "heal";
  if ( !atDoor(u, door) ) {
    if ( !canMove(run, u) || !leaveReach(run, u, turn, null) ) return "stuck";
    const budget = turn.payForMove(approach(run, u, target).speed);
    if ( !budget ) return "stuck";
    const move = moveTowardPoint(run, u, door, budget);
    turn.usedMove(move.cost);
    if ( run.log ) {
      log(run, u, "moves toward the door", {
        type: "move", mode: "walk", feet: move.feet, mult: 1, regions: [], toward: "the door", towardId: `door:${door.id}`,
        from: move.from, to: move.to, purpose: "door", reached: move.reached, tactical: liveTier(run, u)
      });
    }
    return move.feet > 0 ? "moved" : "stuck";
  }
  const basic = rules.basicAction ?? 1;
  const where = { doorId: door.id, target: target.spec.name, targetId: target.id };
  if ( !state.locked ) {
    const cost = rules.doorCosts?.open ?? basic;
    if ( !turn.canAfford(cost) ) return "stuck";
    turn.spend(cost);
    openDoor(run, door, state);
    log(run, u, "opens the door", { type: "door", method: "open", success: true, ...where });
    return "worked";
  }
  const plan = doorPlan(run, u, door, state);
  // The door is worth whatever u wants most on the far side of it; with nobody on this side to fight, there's
  // nothing better to do, so it keeps at it longer.
  const beyond = enemiesOf(run, u).filter(o => isStanding(o) && (run.prep.approachOf(u.id, o.id)?.doors ?? []).includes(door.id));
  if ( !beyond.includes(target) && areEnemies(run, u, target) ) beyond.push(target);
  const urge = Math.max(CHOICE_LEVEL, levelOf(u, kind, target.id), ...beyond.map(o => levelOf(u, "hurt", o.id)));
  const nothingElse = !enemiesOf(run, u).some(o => isStanding(o) && !beyond.includes(o));
  if ( !plan || plan.turns > patienceFor(urge) * (nothingElse ? 1.5 : 1) * styleOf(u).doorPatience ) {
    log(run, u, "won't waste time on the locked door", { type: "door", method: "giveup", success: false, ...where });
    for ( const o of beyond ) {
      thwart(run, u, "hurt", o.id, 15);
      (u.walledOff ??= new Map()).set(o.id, door.id);
    }
    if ( kind !== "hurt" ) thwart(run, u, kind, target.id, 15);
    return "giveup";
  }
  if ( !turn.canAfford(plan.cost) ) return "stuck";
  turn.spend(plan.cost);
  if ( plan.method === "attack" ) {
    const roll = rollCheck(rules, run.rng, plan.strike.bonus ?? 0, door.ac, { kind: "attack" });
    let damage = 0;
    if ( roll.degree >= 2 ) {
      const parts = roll.degree === 3 ? criticalParts(rules, plan.strike.damage) : plan.strike.damage;
      const rolled = sampleDamage(parts ?? [], run.rng, 1);
      damage = doorDamage(rules, door, Object.values(rolled.byType).reduce((s, v) => s + v, 0));
      state.hp -= damage;
    }
    const broke = state.hp <= 0;
    if ( broke ) openDoor(run, door, state, true);
    else thwart(run, u, kind, target.id, damage > 0 ? 4 : 8);
    log(run, u, broke ? "smashes through the door" : damage ? "hacks at the door" : "can't make a dent in the door", {
      type: "door", method: "attack", success: broke, hit: roll.degree >= 2, damage, action: plan.strike.name,
      natural: roll.natural, mod: plan.strike.bonus ?? 0, total: roll.total, dc: door.ac, degree: roll.degree, ...where
    });
  } else {
    const roll = rollCheck(rules, run.rng, plan.mod, plan.dc, { kind: "check" });
    const success = roll.degree >= 2;
    if ( success ) openDoor(run, door, state, plan.method === "force");
    else thwart(run, u, kind, target.id, 12);
    log(run, u, success ? (plan.method === "force" ? "forces the door open" : "picks the lock") : (plan.method === "force" ? "throws a shoulder at the door, but it holds" : "can't get the lock to give"), {
      type: "door", method: plan.method, success, natural: roll.natural, mod: plan.mod, total: roll.total, dc: plan.dc, degree: roll.degree, ...where
    });
  }
  if ( state.open ) relieve(u, kind, target.id);
  return "worked";
}

/**
 * What u wants this turn: its tactics' reasoning (whom it would fight, and the runners-up; whom it would mend; whom it
 * would talk to; whom it fears), on top of what it was told to want and what the fight has stirred.
 */
function deliberate(run, u) {
  newTurn(u);
  const scored = scoreTargets(run, u);
  for ( const { id, level } of levelsFromScores(scored.map(x => ({ id: x.t.id, score: x.score }))) ) think(u, "hurt", id, level);
  // (When its healing logic says heal, that's at least as pressing as the foe it would pick.)
  if ( u.prep.healActions?.length ) for ( const { ally, score } of healScores(run, u) ) think(u, "heal", ally.id, Math.max(45, 20 + 20 * score));
  // (A buff that would do more than attacking: as pressing as the foe it would pick. Less: a passing thought.)
  if ( u.prep.buffActions?.length ) for ( const { ally, score } of aidScores(run, u).slice(0, 3) ) if ( score >= 0.4 ) think(u, "aid", ally.id, Math.min(75, 15 + 30 * score));
  let talkTarget = null;
  if ( run.prep.options.talking && (u.prep.talkAffinity ?? 0) > 0 && u.tac?.talk !== "never" ) {
    const pitch = choosePitch(run, u);
    if ( pitch ) {
      talkTarget = pitch.target.id;
      think(u, "talk", talkTarget, 15 + 60 * u.prep.talkAffinity);
    }
  }
  // Whoever took from it, until they attack it.
  for ( const [id, g] of u.grudges ?? [] ) if ( !g.provoked ) think(u, "avoid", id, 50);
  if ( u.tac?.target === "protect" ) {
    const ward = run.units.find(a => a !== u && a.side === u.side && isStanding(a) && run.units.some(e => e.targetId === a.id && isStanding(e) && areEnemies(run, a, e)));
    if ( ward ) think(u, "protect", ward.id, 50);
  }
  // Badly hurt, it loses heart for foes it would have to cross the field to reach.
  if ( u.maxHp > 0 && u.hp / u.maxHp < 0.35 ) for ( const x of scored ) if ( x.moves >= 2 ) thwart(run, u, "hurt", x.t.id, 5);
  // Its playstyle's leanings (the weakest, the fallen, a friend to guard, something to fear ...).
  styleWants(run, u, scored, { canHeal: !!u.prep.healActions?.length, canTalk: !!talkTarget, talkTarget, canAid: !!u.prep.buffActions?.length });
  // What its leader and its friends want pulls on it too (for most, the leader more than the crowd).
  listen(run, u, { canHeal: !!u.prep.healActions?.length, canTalk: (u.prep.talkAffinity ?? 0) > 0, canAid: !!u.prep.buffActions?.length });
  remember(run, u);
  if ( run.log ) {
    const top = thoughtsOf(run, u);
    if ( top.length ) log(run, u, `thinks: ${top.map(d => `${d.kind} ${d.target} (${d.level})`).join(", ")}`, { type: "thought", desires: top });
  }
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
  // A creature's reaction comes back at the start of its turn.
  u.reactionsLeft = reactionsPerRound(rules, u);
  u.disengaged = false;

  settleSides(run); // holds that took or ended since this creature's last turn
  if ( u.status === STATUS.DOWN ) {
    if ( options.downedModel === DOWNED_MODELS.SIMULATE && rules.recoveryCheck ) {
      fateful(run, u, null, () => {
        const before = u.dying;
        const text = rules.recoveryCheck(u, run.rng);
        if ( text ) log(run, u, text, { type: "recovery", before, dying: u.dying, dead: u.status === STATUS.DEAD, stable: u.stable });
      });
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

  // The turn's budget comes from the system (PF2e: three actions; 5e: an action, a bonus action and movement).
  const turn = turnFor(run, u);
  const morale = checkMorale(run, u);
  if ( morale === MORALE.ROUT ) return flee(run, u, "breaks and flees", turn);
  if ( morale === MORALE.WAVER && !u.wavering ) {
    u.wavering = true;
    log(run, u, "wavers", { type: "waver" });
  }

  // What it wants this turn, and what that means: a terror close at hand sends it running.
  deliberate(run, u);
  const wants = mind(run, u);
  if ( wants.lead?.kind === "avoid" && wants.lead.level >= 70 ) {
    const dread = run.byId.get(wants.lead.targetId);
    const d = dread ? edgeDistance(u, dread) : null;
    if ( dread && (d === null || d <= 30) ) return flee(run, u, `runs from ${dread.spec.name}`, turn);
  }

  const disposition = dispositionOf(u);
  if ( u.prone && u.wasDowned && disposition.selfRevived === "retreat" ) return flee(run, u, "retreats after being revived", turn);
  if ( disposition.allyDying === "retreat" && run.units.some(a => a.side === u.side && a !== u && a.status === STATUS.DOWN && a.active) ) {
    return flee(run, u, "retreats as an ally falls", turn);
  }

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
  if ( helper && leaveReach(run, u, turn, helper) ) {
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
  // Set on talking someone round: it talks to them (and keeps at it). Something far stronger on its mind: no talk.
  const lead = wants.lead;
  const only = lead?.kind === "talk" && lead.driven !== "logic" ? (t => t.id === lead.targetId) : null;
  const talking = brokeStandoff ? { count: 0, pitch: null }
    : only ? { count: turn.howMany(talkCost), pitch: choosePitch(run, u, { only }) }
      : (wants.blinding && lead.level >= 60 && !wants.kindInView("talk")) ? { count: 0, pitch: null }
        : talkActionsThisTurn(run, u, turn.howMany(talkCost));
  for ( let i = 0; i < talking.count && turn.canAfford(talkCost); i++ ) {
    const pitch = i === 0 ? talking.pitch : choosePitch(run, u, only ? { only } : {}); // the first pitch was already chosen
    if ( !pitch ) break;
    attemptTalk(run, u, pitch, (unit, text, data) => log(run, unit, text, data));
    turn.spend(talkCost);
    if ( battleOver(run) ) break;
  }

  for ( let step = 0; turn.any && step < MAX_STEPS_PER_TURN && !battleOver(run); step++ ) {
    const heal = decideHeal(run, u, turn);
    if ( heal?.moves > 0 ) {
      // Go to them first (a touch spell, or out of range).
      if ( !leaveReach(run, u, turn, heal.target, costOf(rules, heal.action)) ) break;
      const budget = turn.payForMove(approach(run, u, heal.target).speed);
      if ( !budget ) break;
      const move = moveToward(run, u, heal.target, heal.action.range ? null : (heal.action.reach ?? 5), budget);
      turn.usedMove(move.cost);
      moveLog(run, u, move, heal.target, "tend");
      continue;
    }
    if ( heal ) {
      executeHeal(run, u, heal.action, heal.target);
      turn.spend(costOf(rules, heal.action));
      continue;
    }
    // Bolster a friend (or itself) when that does more than attacking would.
    const buff = decideBuff(run, u, turn);
    if ( buff ) {
      turn.spend(costOf(rules, buff.action, u));
      executeBuff(run, u, buff.action, buff.targets, buff.worth, turn);
      continue;
    }

    let target = executionCheck(run, u, chooseTarget(run, u));
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
      // A closed door in the way: get to it, then through it (or give up on what's behind it).
      const door = doorAhead(run, u, target);
      if ( door ) {
        const done = workTheDoor(run, u, turn, door, target);
        if ( done === "stuck" ) break;
        continue;
      }
      if ( !leaveReach(run, u, turn, target, normalizeCost(rules, option.cost)) ) break;
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
    // Moving a mark to a new foe (Hunter's Mark) while still holding it costs no new slot.
    const holding = option.action.concentration && u.concentration?.actionId === option.action.id && holdsAnything(run, u);
    executeOffense(run, u, option.action, target, attacksMade);
    settleSides(run);
    if ( option.action.concentration && u.concentration?.actionId === option.action.id ) noteConcentration(u, option.ev);
    if ( !holding || !option.action.freeWhileHeld ) spendUse(u, option.action);
    turn.spend(option.cost);
    attacksMade += attacksIn(option.action);
    if ( battleOver(run) ) break;
  }

  u.turnsTaken += 1;
  endOfTurn(run, u);
}

function endOfTurn(run, u) {
  const rules = run.prep.rules;
  // A save at the end of each of its turns may shake an effect off (5e Hold Person).
  if ( isUp(u) && u.effects?.some(e => e.repeatSave) ) {
    for ( const e of [...u.effects] ) {
      if ( !e.repeatSave ) continue;
      const s = saveRoll(run, u, e.repeatSave.type);
      const roll = rollCheck(rules, run.rng, s.mod, e.repeatSave.dc, { advantage: s.advantage, dice: s.dice, kind: "save" });
      if ( roll.degree < 2 ) continue;
      u.effects.splice(u.effects.indexOf(e), 1);
      recomputeConditions(u);
      log(run, u, `shakes off ${e.label || "the effect"}`, {
        type: "shakeOff", effect: e.label ?? "", saveType: e.repeatSave.type, natural: roll.natural, mod: s.mod, total: roll.total, dc: e.repeatSave.dc, degree: roll.degree
      });
    }
  }
  if ( u.effects?.length ) {
    for ( const e of u.effects ) e.rounds -= 1;
    const before = u.effects.length;
    u.effects = u.effects.filter(e => e.rounds > 0);
    if ( u.effects.length !== before ) {
      recomputeConditions(u);
      settleSides(run);
    }
  }
  if ( u.persistent.length ) {
    const remaining = [];
    for ( const entry of u.persistent ) {
      const amount = rules.applyIwr(iwrOf(u), { [entry.part.type]: Math.max(0, samplePart(entry.part, run.rng)) });
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
      const { mod, advantage, dice } = saveRoll(run, u, a.spec.save.type);
      const roll = rollCheck(rules, run.rng, mod, a.spec.save.dc, { advantage, dice, kind: "save" });
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
 * The fallen on the losing side are dealt with as the victors' playstyles say (see mercyOf): spared and tended,
 * finished off, or left to their own recovery checks.
 */
function aftermath(run, order) {
  const { rules, options } = run.prep;
  if ( options.aftermath === AFTERMATH.NONE ) return;
  const simulated = options.downedModel === DOWNED_MODELS.SIMULATE;
  const victors = run.units.filter(isStanding);
  const fallen = run.units.filter(u => u.status === STATUS.DOWN && victors.some(v => areEnemies(run, v, u)));
  const decided = simulated && fallen.length > 0 && victors.some(v => mercyOf(v) !== "leave");
  if ( !(simulated && run.units.some(isDying)) && !decided ) return;
  const rounds = run.round;
  run.round = rounds + 1; // one paragraph in the story, after the fight
  log(run, null, "The fighting is over", { type: "aftermath", aftermath: true });
  const marker = run.log?.at(-1);
  if ( decided ) dealWithTheFallen(run, victors, fallen);
  let tended = false;
  let i = 0;
  for ( ; i < AFTERMATH_ROUNDS && run.units.some(isDying); i++ ) {
    // With the fighting over, help comes before the dying's next roll: the survivors tend, then the dying roll.
    for ( const u of order ) {
      if ( !isStanding(u) ) continue;
      const turn = turnFor(run, u);
      for ( let n = 0; n < MAX_STEPS_PER_TURN && turn.any; n++ ) {
        // Friends first; then, for one who spares the fallen, a foe it can help for free (first aid, not a spell).
        const friend = run.units.filter(a => a.side === u.side && a !== u && isDying(a)).sort((a, b) => (b.dying ?? 0) - (a.dying ?? 0))[0];
        const foe = !friend && mercyOf(u) === "spare" ? run.units.find(a => a.spared && isDying(a)) : null;
        const dying = friend ?? foe;
        if ( !dying ) break;
        let option = rescueOption(run, u, dying, turn);
        if ( foe && option !== "firstAid" && (option?.resource || Number.isFinite(option?.uses)) ) option = null;
        if ( !option ) break;
        if ( option === "firstAid" ) firstAid(run, u, dying);
        else executeHeal(run, u, option, dying);
        tended = true;
        turn.spend(option === "firstAid" ? (rules.firstAidCost ?? rules.basicAction ?? 1) : costOf(rules, option));
      }
    }
    for ( const u of order ) {
      if ( !isDying(u) || !rules.recoveryCheck ) continue;
      fateful(run, u, null, () => {
        const before = u.dying;
        const text = rules.recoveryCheck(u, run.rng);
        if ( text ) log(run, u, text, { type: "recovery", before, dying: u.dying, dead: u.status === STATUS.DEAD, stable: u.stable, aftermath: true });
      });
    }
  }
  if ( marker ) marker.tended = tended; // the story opens differently when nobody comes to help
  run.aftermathRounds = i; // (how long it took, for the GM's summary of time passed)
  run.round = rounds;
}

/**
 * What a victor does with a fallen foe once the fighting is over, by its playstyles: "spare" it (one who never
 * kills, a Moralist, a Diplomat most of the time), "finish" it (the Cruel), or "leave" it to fate.
 */
export function mercyOf(u) {
  const b = behaviorOf(u);
  if ( u.spec.neverKill || (b.spareDowned ?? 0) >= 0.5 ) return "spare";
  if ( b.finishDowned && !b.spareDowned ) return "finish";
  return "leave";
}

/** The victors settle the fallen: anyone sparing them stops the rest; otherwise the cruel finish them off. */
function dealWithTheFallen(run, victors, fallen) {
  const sparer = victors.find(v => mercyOf(v) === "spare");
  const finishers = victors.filter(v => mercyOf(v) === "finish");
  for ( const f of fallen ) {
    if ( sparer ) {
      f.spared = true;
      if ( finishers.length ) log(run, sparer, `won't let anyone finish off ${f.spec.name}`, { type: "mercy", target: f.spec.name, targetId: f.id, aftermath: true });
      continue;
    }
    const killer = finishers.find(k => executionCheck(run, k, f) === f);
    if ( !killer ) continue;
    // Its everyday blows (no spell slots or potions on the helpless), until it's done.
    const blows = killer.prep.offense.filter(a => !a.resource && !Number.isFinite(a.uses) && a.kind !== "control" && a.damage?.length);
    const best = blows.reduce((top, a) => { const ev = expectedDamage(run, killer, a, f, 0); return !top || ev > top.ev ? { a, ev } : top; }, null);
    for ( let n = 0; best && n < 4 && f.status === STATUS.DOWN; n++ ) executeOffense(run, killer, best.a, f, 0);
  }
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
      // Beaten, or caught: still under the control of the owner's side when it's over (a dominated thief).
      const holder = taker?.controlledBy ? run.byId.get(taker.controlledBy) : null;
      const caught = !!holder && (holder.homeSide ?? holder.side) === (u.homeSide ?? u.side);
      if ( !taker || !(BEATEN.has(taker.status) || caught) ) continue;
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

/** Everything "Make it So" needs to commit one unit's end state (plus whatever the system keeps: rules.capture). */
function captureUnit(u, rules) {
  return {
    system: rules?.capture?.(u) ?? null,
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
    // Buffs and debuffs still running (Make it So leaves them on, for the rounds they have left).
    effects: [STATUS.DEAD, STATUS.FLED].includes(u.status) ? [] : (u.effects ?? []).filter(e => e.mods || e.iwr || e.mark)
      .map(e => ({ key: e.key, sourceId: e.sourceId, rounds: e.rounds, label: e.label })),
    swayed: u.swayOutcome,
    // Under someone else's control when it ended: it still belongs to its own side.
    controlledBy: u.controlledBy ?? null,
    concessions: (u.concessions ?? []).map(c => ({ ...c })), // what they gave up when talked into it (Make it So hands it over)
    side: u.homeSide ?? u.side,
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
      final: capture ? captureUnit(u, run.prep.rules) : undefined
    };
  }
  // Settled with words: it ended and nobody ever struck a blow.
  // Doors the fight opened (or broke): Make it So leaves them that way.
  const doors = {};
  for ( const [id, s] of run.doors ?? [] ) if ( s.open ) doors[id] = { open: true, broken: !!s.broken };
  return { outcome, winners, rounds: run.round, aftermathRounds: run.aftermathRounds ?? 0, firstFallen: run.firstFallen, peaceful: ended && !run.blood, units, doors, log: run.log };
}

/** Simulate a single battle. */
export function runOne(prep, seed, { log: withLog = false, capture = false } = {}) {
  const run = createRun(prep);
  run.rng = createRng(seed);
  for ( const u of run.units ) initDesires(u);
  prep.doors ??= prepareDoors(prep.spec, prep.rules);
  run.doors = doorStates(prep);
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
