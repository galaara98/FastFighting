/**
 * Round-by-round battle simulation. Pure: give it a BattleSpec and a rules object, get statistics back.
 *
 * Every logged event carries structured data (type, rolls, margins, damage types, movement) so the story
 * writer can narrate it at any level of detail.
 */
import { STATUS, TACTICAL, DOWNED_MODELS, AFTERMATH, EXECUTE_LUCK, NEUTRAL_PARTY, OPENING, clamp } from "../constants.js";
import { createRng, deriveSeed, randomSeed } from "./rng.js";
import { sampleDamage, samplePart, meanPart, part } from "./dice.js";
import { rollCheck, regrade } from "./probability.js";
import { costOf, mainPool } from "./turn.js";
import {
  prepareBattle, createRun, isStanding, isUp, enemiesOf, alliesOf, areEnemies, liveTier, liveTrait, currentAc,
  attackRoll, attackOptions, saveRoll, checkRoll, turnFor, moveToward, moveAway, bonusDamageParts, dispositionOf,
  behaviorOf, edgeDistance, movesNeeded, approach, canMove, moveTowardPoint, isMagical, upgradesSave, boostBonus, typical, sortOf, sizedUp, passedOver,
  command, commandOf, heldOff, holdsBack, wish
} from "./battle-state.js";
import { sampleRunTactics } from "./playstyles.js";
import { chooseTarget, bestOptionVs, scoreTargets } from "./behavior/targeting.js";
import { decideHeal, rescueOption, healScores } from "./behavior/healing.js";
import { initDesires, newTurn, goaded, think, want, thwart, relieve, levelOf, mind, thoughts as thoughtsOf, levelsFromScores, listen, heed, remember, styleWants, styleOf, follow, scheme, partyWants, CHOICE_LEVEL } from "./behavior/desire.js";
import { prepareDoors, doorStates, doorAhead, atDoor, doorPlan, patienceFor, doorDamage } from "./behavior/doors.js";
import { checkMorale, standsGround, callRetreat, rallies, MORALE } from "./behavior/morale.js";
import { expectedDamage, spendUse, hasUses, attacksIn, criticalParts, saveMultiplier, saveMultiplierFor, meanDamageVs, unitsPerTurn } from "./behavior/evaluate.js";
import { chooseDeed, deedTier, chooseHitRiders, rescueMiss, rollCrit, rollFumble, rallied } from "./behavior/riders.js";
import { cast } from "./behavior/casting.js";
import { boost } from "./behavior/luck.js";
import { respond, riposteStrike } from "./behavior/responses.js";
import { decideSummon, callSummons, sustainSummons, summonState, dismiss } from "./behavior/summons.js";
import { createAggregator } from "./aggregate.js";
import { spotTraps, stepOut, learnTrap } from "./behavior/traps.js";
import { bargain } from "./behavior/bargain.js";
import { talkActionsThisTurn, choosePitch, attemptTalk, shareLanguage } from "./behavior/talk.js";
import { opensWithTalk, breaksStandoff, standoffPitches, charismaticLeader, canTalk, prefersTalk } from "./behavior/standoff.js";
import { controlOutcome, controlRoll, isImmune, degreeShift } from "./behavior/control.js";
import { recompute as recomputeConditions, applyOutcome, beginConcentration, endConcentration, holdsAnything, noteConcentration, moveHeld, settleAllegiance, iwrOf, incoming, spendEdges, spendBoost, focusOf, tauntProof, withoutTaunt } from "./behavior/effects.js";
import { decideBuff, aidScores, checkDc } from "./behavior/support.js";
import { perceives } from "./behavior/senses.js";
import { stealChance, theftTarget, theftPlan, attemptTheft } from "./behavior/theft.js";
import { reactionsPerRound, threats, takesSafeWay } from "./behavior/reactions.js";
import { isNeutral, crossed, caughtInArea, refreshLeans, truceWith, truceBreaks, turnOn, settleTruce, peaceDesires, seemsFoe, meddling, inFray, fighting, dislikesViolence, annoyedBy, ANNOYED } from "./behavior/neutral.js";
import { normalizeCost } from "./turn.js";
import { localize } from "../i18n.js";

const MAX_STEPS_PER_TURN = 8;
/** After the last blow, how long the winners keep tending the dying (ten minutes of rounds, at most). */
const AFTERMATH_ROUNDS = 100;
/** Batches give the browser back control this often (ms), so the GM's screen stays responsive. */
const SLICE_MS = 25;
/** The most of each pause (to let the browser draw) counted as the prediction's time (ms): a background tab's last a second. */
const PAUSE_MS = 20;
/** How much being hit makes a creature want to hit back, by tactical band: simple minds go for whoever hurt them. */
const HIT_URGE = [40, 25, 10, 5, 3];

/**
 * Note an event in the run's log: its type and data, from which the log and the stories are told in the reader's
 * language (story/log-lines.js). A game system's own report carries its words as data.text, shown as they come.
 */
function log(run, u, data = {}) {
  if ( !run.log ) return;
  run.log.push({
    round: run.round, turn: run.turn ?? 0, turnOf: run.turnOf ?? null, actor: u?.spec.name ?? "", actorId: u?.id ?? null, side: u?.side ?? null,
    type: data.type ?? "note", ...data
  });
}

/**
 * A new turn in the log: what follows is u's turn (or, with no u, the fight's own moment: its end, the aftermath),
 * until the next. Whatever happens meanwhile, others' reactions and falls too, is told with it.
 */
function startTurn(run, u = null) {
  if ( !run.log ) return;
  run.turn = (run.turn ?? 0) + 1;
  run.turnOf = u?.id ?? null;
}

const primaryType = action => (action.damage ?? action.heal ?? [])[0]?.type ?? "untyped";
/**
 * Harm with no look of its own, added to a blow (sneak attack, a backstab, a precise strike): a part a helper marks so,
 * by its category or its type. The story tells it by how it came, not as more of the blow.
 */
const isPrecision = p => p?.category === "precision" || p?.type === "precision";
/** Every kind of harm an action deals (a flaming sword: slashing and fire), for the story to tell the one that shows. */
const damageTypesOf = action => [...new Set((action.damage ?? []).map(p => p.type).filter(Boolean))];

/** The run's logger, for helpers that log as they go (see luck.js). */
const logger = run => (run.logTo ??= (unit, data) => log(run, unit, data));

/**
 * How much rides on a save (for burning Luck on one that falls short): a blow that would drop the saver, or a hold
 * on it, matters most.
 */
function saveStakes(target, damage = 0, controls = false) {
  let s = controls ? 0.7 : 0.2;
  if ( damage > 0 ) s = Math.max(s, damage >= target.hp + target.temp + (target.stamina ?? 0) ? 0.95 : 0.25 + 0.5 * damage / Math.max(1, target.hp));
  return Math.min(1, s);
}

/** How much rides on an attack landing: a foe it would finish, a friend down and in danger. */
function attackStakes(run, u, t, action) {
  let s = 0.15;
  if ( t.hp <= meanDamageVs(run, action, t).normal ) s += 0.35;
  if ( run.units.some(a => a.side === u.side && a.status === STATUS.DOWN && !a.stable) ) s += 0.25;
  return Math.min(1, s);
}

/** A save the target makes, with Luck burned on it if it falls short and someone will. */
function rollSave(run, target, type, dc, { stakes = 0.3, label = "", magical = false } = {}) {
  const rules = run.prep.rules;
  const s = saveRoll(run, target, type, { magical });
  let roll = rollCheck(rules, run.rng, s.mod, dc, { advantage: s.advantage, dice: s.dice, kind: "save", roller: target });
  spendEdges(target, "save");
  if ( run.boosting && roll.degree < 2 ) roll = boost(run, target, roll, dc, { kind: "save", stakes, label }, logger(run));
  roll = standFirm(run, target, roll, dc, stakes, label);
  if ( roll.degree === 2 && upgradesSave(target, type) ) roll = { ...roll, degree: 3 };
  if ( rules.adjustRoll ) {
    roll = rules.adjustRoll(run, target, roll, { kind: "save", stakes, label }) ?? roll;
    if ( roll.said ) log(run, target, { text: roll.said.text, type: "adjust", ...roll.said.data });
  }
  rules.afterRoll?.(run, target, roll, { kind: "save", type, faces: 20 });
  return { roll, mod: s.mod };
}

/**
 * A failed save it can't afford (one that would take it out of the fight, or close to it), it simply makes, while it
 * has the means (spec.standFirm {pool, label}: 5e Legendary Resistance).
 */
function standFirm(run, target, roll, dc, stakes, label) {
  const firm = target.spec.standFirm;
  if ( !firm || roll.degree >= 2 || stakes < 0.6 || !((target.resources[firm.pool] ?? 0) > 0) ) return roll;
  target.resources[firm.pool] -= 1;
  log(run, target, {
    type: "standFirm", label: firm.label ?? "", against: label, natural: roll.natural, total: roll.total, dc
  });
  return { ...roll, degree: 2, firm: true };
}

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
    // (Keeping out of sight on the way in, where the system rolls Stealth for it: PF2e's Avoid Notice.)
    if ( run.prep.rules.stealthInitiative && (behaviorOf(u).lowProfile ?? 0) > 0 && Number.isFinite(init.stealth) ) mod = Math.max(mod, init.stealth);
    mod += behaviorOf(u).initiative ?? 0; // Instigators jump in first
    if ( liveTier(run, u) >= TACTICAL.MASTERMIND ) mod += 2; // ambush instincts
    // (A die of the system's own: DCC's d16 for a two-handed weapon.)
    rolled.set(u.id, run.rng.die(init.die ?? 20) + mod + run.rng.next() * 0.01);
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

/**
 * b, on the map but not in the encounter, becomes aware of the conflict. It takes its turns from the next round, as
 * if it had been in the encounter all along (its side, its desires and its nerve decide what it does then; someone
 * taking no side starts weighing what it wants). Set upon, it's in the fight at once.
 */
function notice(run, b, cause, source) {
  if ( b.spec.hazard ) return; // (a hazard notices nothing)
  if ( b.aware && cause !== "attacked" ) return; // (it already knows; it's on its way)
  b.aware = true;
  // During a standoff there is no fighting to see or hear, only a tense crowd and raised voices.
  if ( run.standoff && (cause === "sight" || cause === "sound") ) cause = "standoff";
  log(run, b, { type: "notice", cause, by: source?.spec.name ?? null, byId: source?.id ?? null });
  if ( cause === "attacked" ) return join(run, b, "forced");
  b.joinsRound ??= run.round + 1;
  b.joinCause = cause;
}

/** b takes part from now on (someone who takes no side watches, weighing what it wants). */
function join(run, b, why) {
  b.active = true;
  b.aware = true;
  b.joinsRound = null;
  b.joinedRound = run.round;
  if ( isNeutral(b) && !enemiesOf(run, b).length ) return log(run, b, { type: "watch", neutral: true, why });
  log(run, b, { type: "join", why });
}

/** Waiting to take part: aware of the conflict, with turns from the next round. */
const joining = u => u.status === STATUS.STANDING && !u.active && u.aware && u.joinsRound !== null && u.joinsRound !== undefined;

/**
 * The turn of someone on the map who isn't in the conflict yet: does it notice it now (seeing or hearing an active
 * combatant, against the system's check)? Returns true if it takes part from this turn on (it noticed earlier).
 */
function lookAround(run, b) {
  if ( joining(b) ) {
    if ( run.round < b.joinsRound ) return false;
    join(run, b, b.joinCause);
    return true;
  }
  if ( b.aware || b.status !== STATUS.STANDING ) return false;
  let best = null;
  for ( const c of run.units ) {
    if ( c === b || !c.active ) continue;
    if ( c.status !== STATUS.STANDING && c.fellRound !== run.round && c.fellRound !== run.round - 1 ) continue;
    const cue = cueFrom(run, b, c);
    if ( cue && (!best || cue.dc < best.cue.dc) ) best = { cue, c };
  }
  if ( !best ) return false;
  const perception = b.spec.perception ?? b.spec.initiative?.mod ?? 0;
  const check = checkRoll(run, b, perception);
  const roll = rollCheck(run.prep.rules, run.rng, check.mod, best.cue.dc, { advantage: check.advantage, kind: "check", roller: b });
  if ( roll.degree >= 2 ) notice(run, b, best.cue.sense, best.c);
  return false;
}

/** Bystanders on u's side who don't know about the fight yet, and could be fetched. */
function helpFor(run, u) {
  return run.units.filter(o => o !== u && !o.active && !o.aware && o.side === u.side && o.status === STATUS.STANDING && !o.calledForHelp);
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

function dealDamage(run, source, target, amount, { crit = false, types = null, action = null, lingering = false } = {}) {
  if ( amount <= 0 || target.status === STATUS.DEAD || target.status === STATUS.FLED ) return;
  // Acid or fire on a troll: its regeneration stops, for its next turn.
  if ( target.spec.regen?.stoppedBy?.length && types?.some(t => target.spec.regen.stoppedBy.includes(t)) ) target.regenStopped = true;
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
    // Temporary hit points go first, then stamina, then hit points.
    const absorbed = Math.min(target.temp, amount);
    target.temp -= absorbed;
    const winded = Math.min(target.stamina ?? 0, amount - absorbed);
    if ( winded ) target.stamina -= winded;
    const rest = amount - absorbed - winded;
    const dealt = Math.min(rest, target.hp);
    target.hp -= rest;
    target.hurtSinceTurn = true; // (being hurt, whoever or whatever it is: "always talk unless I'm being hurt")
    if ( target.hp <= 0 && holdsOn(run, target, rest, crit, types) ) target.hp = 1;
    if ( source ) {
      source.damageDealt += dealt + absorbed + winded;
      target.harmedBy.set(source.id, (target.harmedBy.get(source.id) ?? 0) + dealt + absorbed + winded);
      if ( run.standoff ) bloodInStandoff(run, source, target);
      if ( areEnemies(run, source, target) ) {
        // Hit from afar while already trading blows with someone: keep at the one in front of it.
        const busy = !target.adjacent.has(source.id) && [...target.adjacent].some(id => { const o = run.byId.get(id); return o && isStanding(o) && areEnemies(run, target, o); });
        want(target, "hurt", source.id, (busy ? 3 : (HIT_URGE[liveTier(run, target)] ?? 5)) * styleOf(target).retaliate);
      }
    }
    if ( target.hp <= 0 ) {
      target.hp = 0;
      target.wasDowned = true;
      rules.onDropped(target, { crit, model, amount: rest, overflow: Math.max(0, rest - dealt), rng: run.rng });
      if ( target.status === STATUS.DEAD && (holdsBack(run, source) || pullsBlow(run, source, action)) ) knockOut(run, target);
      killsBeaten(run, source, target);
      regenerating(target);
    }
    // (Still up at 0, by the system's rules: Ironsworn characters fight on at 0 health.)
    if ( target.hp <= 0 && target.status !== STATUS.STANDING ) {
      target.fellRound ??= run.round;
      target.killerId = source?.id ?? target.killerId ?? null;
      run.firstFallen ??= target.id;
      releaseGrabs(run, target);
      // A friend's fall: the one who did it becomes someone to settle with, the more so for the loyal.
      if ( source ) {
        for ( const a of run.units ) {
          if ( a !== target && a.side === target.side && isStanding(a) && perceives(run, a, target, { crisis: true }) ) want(a, "hurt", source.id, 15 * liveTrait(run, a, "loyal") / 60 * styleOf(a).avenge);
        }
      }
      log(run, target, {
        type: fallType(target), by: source?.spec.name ?? null, byId: source?.id ?? null, dying: target.dying, knockedOut: !!target.knockedOut, killed: !!target.killedBeaten,
        note: takeFallNote(target)
      });
      fell(run, target, source);
    }
    // One track for many (Ironsworn's encounter objective, every foe part of it): what one takes, all of them take.
    if ( sharedOf(target) ) shareHarm(run, source, target);
    testConcentration(run, target, rest + absorbed);
    // What being hurt sets off, by the system (Ironsworn: Endure Harm, a roll to shake it off or lose heart).
    if ( rules.afterHarm && target.status !== STATUS.DEAD ) {
      const up = target.status === STATUS.STANDING;
      const said = rules.afterHarm(run, target, rest + absorbed, run.rng);
      if ( said?.text ) log(run, target, { text: said.text, type: "endure", ...said.data });
      // (Taken out by it: the fall counts like any other.)
      if ( up && target.status !== STATUS.STANDING ) {
        target.wasDowned = true;
        target.fellRound ??= run.round;
        target.killerId = source?.id ?? target.killerId ?? null;
        run.firstFallen ??= target.id;
        releaseGrabs(run, target);
        fell(run, target, source);
      }
    }
    // Someone taking no side who was hurt, or who saw someone it wants safe hurt, takes note.
    if ( run.neutral && source ) crossed(run, source, target, "harm", 0.5 + Math.min(1.5, 3 * (dealt + absorbed) / Math.max(1, target.maxHp)) + (target.hp <= 0 ? 1 : 0), logger(run));
  } else if ( target.status === STATUS.DOWN ) {
    if ( model === DOWNED_MODELS.OUT ) return;
    if ( run.neutral && source ) crossed(run, source, target, "harm", 1.5, logger(run));
    rules.onDropped(target, { crit, model, amount, overflow: amount, rng: run.rng });
    if ( target.status === STATUS.DEAD && (holdsBack(run, source) || pullsBlow(run, source, action)) ) knockOut(run, target);
    regenerating(target);
    const dead = target.status === STATUS.DEAD;
    if ( dead ) target.killerId = source?.id ?? target.killerId ?? null;
    log(run, target, { type: dead ? "death" : "struckDown", by: source?.spec.name ?? null, byId: source?.id ?? null, dying: target.dying, finished: dead, lingering: lingering || undefined, note: takeFallNote(target) });
  }
}

/**
 * A blow that would drop it, it may shrug off at 1 hit point (5e Undead Fortitude: spec.holdOn {save, base, except,
 * notOnCrit}: a save against base + the damage, unless the damage was one of `except` or a critical hit).
 */
function holdsOn(run, u, amount, crit, types) {
  const h = u.spec.holdOn;
  if ( !h || (crit && h.notOnCrit) || (types && h.except?.length && types.some(t => h.except.includes(t))) ) return false;
  const dc = (h.base ?? 5) + amount;
  const { roll } = rollSave(run, u, h.save ?? "con", dc, { stakes: 0.9, label: h.label ?? "" });
  if ( roll.degree < 2 ) return false;
  log(run, u, { type: "holdOn", label: h.label ?? "", natural: roll.natural, total: roll.total, dc });
  return true;
}

/** While its regeneration works, a creature can't be killed: it lies there, mending (a troll). */
function regenerating(u) {
  // (Not one that only regenerates with at least 1 hit point: at 0 it's simply dead.)
  if ( u.status === STATUS.DEAD && u.spec.regen && !u.spec.regen.needsHp && !u.regenStopped ) {
    u.status = STATUS.DOWN;
    u.held = true; // (by its regeneration, not by its dying)
  }
}

/**
 * Start of its turn: regeneration (spec.regen {amount, stoppedBy}: not this turn if it took one of those damage types
 * since its last; a creature down at 0 that can't regenerate dies, if 0 is death for it) and fast healing
 * (spec.fastHealing).
 */
function regenerate(run, u) {
  const regen = u.spec.regen;
  const fast = Number(u.spec.fastHealing) || 0;
  if ( (!regen && !fast) || [STATUS.DEAD, STATUS.FLED].includes(u.status) ) return;
  const stopped = !!u.regenStopped;
  u.regenStopped = false;
  if ( u.status === STATUS.DOWN && u.held && stopped ) {
    if ( u.spec.diesAtZero ) {
      u.status = STATUS.DEAD;
      log(run, u, { type: "death", regen: true });
      return;
    }
    u.held = false; // (from here on, the system's dying rules)
  }
  const amount = fast + (regen && !stopped && !(regen.needsHp && u.hp <= 0) ? regen.amount : 0);
  if ( amount <= 0 || u.hp >= u.maxHp ) return;
  const before = u.hp;
  const wasDown = u.status === STATUS.DOWN;
  run.prep.rules.onHealed(u, amount);
  if ( u.status === STATUS.STANDING ) u.held = false;
  log(run, u, {
    type: "regen", amount: u.hp - before, revived: wasDown && u.status === STATUS.STANDING
  });
}

/**
 * One who spares the fallen (its playstyles' spareDowned: a Moralist, a Peacekeeper, a Diplomat now and then) pulls a
 * blow that would kill, where the system has a way to (rules.pullsBlow: 5e a melee blow, PF2e a nonlethal attack, DCC a
 * weapon that subdues): the foe is knocked out instead.
 */
function pullsBlow(run, u, action) {
  if ( !u || !action || !run.prep.rules.pullsBlow?.(u, action) ) return false;
  const spare = Number(behaviorOf(u).spareDowned) || 0;
  return spare >= 1 || (spare > 0 && run.rng.chance(spare));
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
    log(run, u, {
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
    roll = { ...rollCheck(run.prep.rules, run.rng, s.mod, dc, { advantage: s.advantage, dice: s.dice, kind: "save", roller: u }), mod: s.mod };
    broken = roll.degree < 2;
  }
  if ( !broken ) return;
  const name = u.concentration.name;
  const ended = endConcentration(run, u);
  settleSides(run);
  log(run, u, {
    type: "concentrationEnd", action: name, effects: ended, reason: roll ? "blow" : "incapacitated",
    ...(roll ? { saveType: c.save ?? "con", natural: roll.natural, mod: roll.mod, total: roll.total, dc, degree: roll.degree } : {})
  });
}

function applyAfflictionStage(run, target, affliction) {
  const stage = affliction.spec.stages[affliction.stage - 1];
  recomputeConditions(target);
  if ( !stage?.damage?.length ) return;
  const rolled = sampleDamage(stage.damage, run.rng);
  const amount = run.prep.rules.applyIwr(iwrOf(target), rolled.byType, target);
  log(run, target, {
    type: "afflictionStage", name: affliction.spec.name, stage: affliction.stage, amount, damageType: stage.damage[0]?.type ?? "poison"
  });
  dealDamage(run, run.byId.get(affliction.sourceId), target, amount, { lingering: true });
}

function exposeToAffliction(run, source, target, spec) {
  if ( target.spec.iwr?.immune?.some(k => spec.traits?.includes(k)) ) return;
  const rules = run.prep.rules;
  const { mod, advantage, dice } = saveRoll(run, target, spec.save.type);
  const roll = rollCheck(rules, run.rng, mod, spec.save.dc, { advantage, dice, kind: "save", roller: target });
  const increase = afflictionStep(rules, roll.degree, "exposure");
  log(run, target, {
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
      log(run, target, { type: "prone", by: u.spec.name });
    } else if ( effect.kind === "grabbed" ) {
      target.grabbedBy = u.id;
      log(run, target, { type: "grabbed", by: u.spec.name });
    } else if ( effect.kind === "affliction" ) {
      exposeToAffliction(run, u, target, effect);
    } else if ( effect.kind === "condition" && (degree === 3 || !effect.critOnly) ) {
      // A rider such as "if it critically fails, it's also stunned 1": the system's own tags decide immunity.
      if ( isImmune(run, target, { traits: action.traits, onSave: [effect] }) ) continue;
      applyOutcome(target, effect, u.id);
      testConcentration(run, target);
      log(run, target, { type: "condition", by: u.spec.name, effect: effect.label ?? "" });
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
  const harmful = (effect.damage ?? []).reduce((s, p) => s + Math.max(0, meanPart(p)), 0);
  const { roll, mod } = rollSave(run, target, effect.save.type, effect.save.dc, { stakes: saveStakes(target, harmful, !!effect.conditions), label: effect.label || action.name, magical: isMagical(action) });
  const mult = effect.damage?.length ? saveMultiplier(rules, roll.degree, effect.save) : 0;
  const hit = mult > 0 ? rollHit(run, u, action, target, effect.damage, mult, false) : null;
  log(run, target, {
    type: "riderSave", name: effect.label || action.name, by: u.spec.name, saveType: effect.save.type, natural: roll.natural, mod, total: roll.total,
    dc: effect.save.dc, degree: roll.degree, damage: hit?.total ?? 0, controls: !!effect.conditions
  });
  hit?.apply();
  if ( roll.degree > 1 || !effect.conditions || !isUp(target) ) return;
  if ( isImmune(run, target, { traits: action.traits, onSave: [effect] }) ) return;
  applyOutcome(target, effect, u.id);
  testConcentration(run, target);
  log(run, target, { type: "condition", by: u.spec.name, effect: effect.label ?? "" });
}

/** The hit points a creature shares, by key (its own sharedHp, set in the fight: one who joined the track; else its spec's). */
const sharedOf = u => u.sharedHp ?? u.spec.sharedHp ?? null;

/**
 * Hit points several creatures share (spec.sharedHp, a key: Ironsworn's encounter track, which every foe in the fight is
 * part of): the others are left as the one struck was, and fall with it.
 */
function shareHarm(run, source, target) {
  const rules = run.prep.rules;
  for ( const o of run.units ) {
    if ( o === target || sharedOf(o) !== sharedOf(target) || o.status !== STATUS.STANDING ) continue;
    o.hp = Math.max(0, target.hp);
    if ( o.hp > 0 ) continue;
    o.wasDowned = true;
    rules.onDropped(o, { model: run.prep.options.downedModel, amount: 0, overflow: 0, rng: run.rng });
    killsBeaten(run, source, o);
    if ( o.status === STATUS.STANDING ) continue;
    o.fellRound ??= run.round;
    o.killerId = source?.id ?? o.killerId ?? null;
    releaseGrabs(run, o);
    log(run, o, { type: fallType(o), by: source?.spec.name ?? null, byId: source?.id ?? null, shared: true, killed: !!o.killedBeaten });
    fell(run, o, source);
  }
}

/** How a fall reads in the log: a death, beaten (out of the fight, however the table decides), or down. */
const fallType = u => (u.killedBeaten ? "beaten" : u.status === STATUS.DEAD ? "death" : u.status === STATUS.BEATEN ? "beaten" : "down");

/** The system's word on how u fell, once (rules.onDropped's u.fallNote: Daggerheart's death moves). */
function takeFallNote(u) {
  const note = u.fallNote ?? null;
  u.fallNote = null;
  return note;
}

/**
 * Would u kill one it has beaten? The Cruel would (it finishes the fallen), and so would a creature that isn't a player
 * character, unless it holds back from killing or spares the fallen. Anyone else leaves it beaten, for the table to
 * say what that means.
 */
function wouldKill(run, u) {
  if ( !u ) return false;
  const mercy = mercyOf(run, u);
  if ( mercy === "spare" ) return false;
  return mercy === "finish" || u.spec.kind !== "pc";
}

/** Beaten (the system's word: Ironsworn's full track) by one who would kill: killed. */
function killsBeaten(run, source, u) {
  if ( u.status !== STATUS.BEATEN || !wouldKill(run, source) ) return;
  u.status = STATUS.DEAD;
  u.killedBeaten = true;
}

/** Someone fell (down, beaten, killed): the system's word on it, once (Ironsworn: its friends endure stress). */
function fell(run, u, source) {
  if ( u.fallNoted || !run.prep.rules.onFall ) return;
  u.fallNoted = true;
  for ( const said of run.prep.rules.onFall(run, u, { dead: u.status === STATUS.DEAD, source }) ?? [] ) {
    if ( said?.text ) log(run, said.unit ?? u, { type: "endure", text: said.text, ...said.data });
  }
}

/**
 * The price of an attack, as the system sets it (rules.backlash): the target's harm to the attacker, or a price of
 * the system's own that it has paid already (Ironsworn's stress: its report, `said`). The system may put a friend in
 * harm's way instead (cost.to: Ironsworn's "a friend is put in harm's way").
 */
function backlash(run, u, target, action, degree, logging) {
  const cost = run.prep.rules.backlash?.(run, u, target, action, degree);
  if ( cost?.said?.text && logging ) log(run, u, { type: "endure", text: cost.said.text, ...cost.said.data });
  const who = cost?.to && isUp(cost.to) ? cost.to : u;
  if ( !cost?.damage?.length || !isUp(who) || target.status === STATUS.DEAD ) return;
  const hit = rollHit(run, target, { name: cost.label ?? "", damage: cost.damage }, who, cost.damage, 1, false);
  if ( logging ) log(run, who, {
    type: "backlash", label: cost.label ?? "", by: target.spec.name, byId: target.id, damage: hit.total, damageType: cost.damage[0]?.type ?? "untyped"
  });
  hit.apply();
}

/**
 * A save that turns the tables (rules.retort: an Ironsworn Clash, where doing well means striking the foe): the
 * saver's own blow at whoever made it save, if the system says so for this degree.
 */
function retort(run, saver, by, action, degree, logging) {
  const back = run.prep.rules.retort?.(run, saver, by, action, degree);
  if ( !back?.damage?.length || !isUp(saver) || !isUp(by) ) return;
  const hit = rollHit(run, saver, { name: back.label ?? "", damage: back.damage }, by, back.damage, 1, degree === 3);
  if ( logging ) log(run, saver, {
    type: "attack", action: back.label ?? "", target: by.spec.name, targetId: by.id, damage: hit.total, degree, retort: true, damageType: back.damage[0]?.type ?? "untyped"
  });
  hit.apply();
}

/** Roll damage for a hit; returns the total and a function that applies it (so the log reads in order). */
function rollHit(run, u, action, t, parts, multiplier, crit, minimum = 0) {
  const rules = run.prep.rules;
  const rolled = sampleDamage(parts, run.rng, multiplier);
  // Rolled several times over (DCC magic missiles: so many missiles of so much each).
  for ( let n = action.repeat ? Math.max(1, samplePart(action.repeat, run.rng)) : 1; n > 1; n-- ) {
    const more = sampleDamage(parts, run.rng, multiplier);
    for ( const [k, v] of Object.entries(more.byType) ) rolled.byType[k] = (rolled.byType[k] ?? 0) + v;
  }
  // Some systems guarantee a hit does at least some damage before resistances (PF2e: 1).
  if ( minimum > 0 ) {
    const types = Object.keys(rolled.byType);
    const sum = types.reduce((s, k) => s + rolled.byType[k], 0);
    if ( types.length && sum < minimum ) rolled.byType[types[0]] += minimum - sum;
  }
  const total = rules.applyIwr(iwrOf(t), rolled.byType, t);
  return {
    total,
    byType: rolled.byType, // (as rolled, before anyone's resistances)
    types: Object.keys(rolled.byType),
    apply: (amount = total) => {
      for ( const p of rolled.persistent ) {
        if ( !t.spec.iwr?.immune?.includes(p.type) ) t.persistent.push({ part: p, sourceId: u.id });
      }
      dealDamage(run, u, t, amount, { crit, types: Object.keys(rolled.byType), action });
      return amount;
    }
  };
}

/** Someone else u could hit with this action without moving (when a multiattack's first target drops). */
function nextTargetInReach(run, u, action) {
  const can = run.prep.rules.canTarget;
  return enemiesOf(run, u).filter(o => isStanding(o) && !heldOff(run, u, o) && movesNeeded(run, u, o, action) === 0 && (!can || can(run, u, o))).sort((a, b) => a.hp - b.hp)[0] ?? null;
}

/** The standoff is over: from here on it's a fight. */
function endStandoff(run, u, cause) {
  // Only an argument: what would come to blows ends the encounter instead.
  if ( run.prep.options.opening === OPENING.ARGUMENT ) return collapse(run, u, cause);
  run.standoff = false;
  log(run, u, { type: "breakStandoff", cause });
}

/**
 * Only an argument, and it would come to blows (someone takes offense, loses patience, a blow lands, a quarrel turns
 * ugly): the talks collapse and everyone goes their own way, nobody fighting. What was agreed before it stands.
 */
function collapse(run, u, cause) {
  if ( run.resolved ) return;
  run.resolved = { side: null, outcome: "collapsed" };
  log(run, u, { type: "collapse", cause });
}

/**
 * Someone hurt while a standoff holds: by the other side (a stray blow, a reaction), the standoff is over. In a quarrel
 * with someone taking no side, the standoff holds, but the blood frays everyone's nerves, and one hurt by someone who
 * seems to be with the other side may blame them. (Hurt by one taking no side, one that had agreed to let it be
 * doesn't any more.)
 */
function bloodInStandoff(run, source, target) {
  if ( source === target || !areEnemies(run, source, target) ) return;
  if ( heldOff(run, source, target) ) return endStandoff(run, source, "blood");
  run.fray = (run.fray ?? 0) + 1;
  if ( isNeutral(source) ) {
    target.holdsBack = false;
    annoyedBy(run, target, source, ANNOYED.blow);
  }
}

/**
 * A check whose total picks what the action does (DCC spell checks): rolled first, logged, and the action as it is at
 * that result returned (null if it failed: the spell may be lost, a cleric's disapproval widened).
 */
function castFor(run, u, action, target = null) {
  const stakes = target && !areEnemies(run, u, target) && target.status === STATUS.DOWN ? 0.9 : 0.5;
  const result = cast(run, u, action, { stakes, log: logger(run) });
  const r = result.roll;
  const tier = result.action ? tierIndex(run, action, result.action) : null;
  log(run, u, {
    type: "cast", action: action.name, natural: r.natural, mod: Number(action.casting.mod) || 0, total: r.total, faces: result.faces,
    success: !!result.action, tier, fumble: !!result.fumble, disapproved: !!result.disapproved, lost: !!result.lost,
    disapproval: u.disapproval ?? null, target: target?.spec.name ?? null, targetId: target?.id ?? null
  });
  // A spell duel (rules.duel: DCC): someone answers a spell that worked with one of its own, the two checks compared.
  // The answer's higher: the spell is undone; the same: neither stands; lower (or its own check failed): it goes on.
  if ( result.action && run.prep.rules.duel ) {
    const duel = run.prep.rules.duel(run, u, action);
    if ( duel?.by && duel.counter?.casting ) {
      const answer = cast(run, duel.by, duel.counter, { stakes: 0.5, log: logger(run) });
      const theirs = answer.action ? answer.roll.total : null;
      const outcome = theirs === null ? "fails" : theirs > r.total ? "wins" : theirs === r.total ? "both" : "loses";
      log(run, duel.by, {
        type: "duel", counter: duel.counter.name, action: action.name, target: u.spec.name, targetId: u.id, natural: answer.roll.natural, total: answer.roll.total, against: r.total, outcome
      });
      if ( outcome === "wins" || outcome === "both" ) return null;
    }
  }
  // A save against it whose DC is the check itself (DCC: the spell check total).
  if ( result.action?.save?.dc === "check" ) return { ...result.action, save: { ...result.action.save, dc: r.total } };
  return result.action;
}

/** Which of an action's tiers this is (0 the lowest). */
function tierIndex(run, action, tierAction) {
  return run.prep.tierActions?.get(action.id)?.indexOf(tierAction) ?? null;
}

function executeOffense(run, u, action, t, attacksMade) {
  if ( counterspelled(run, u, action) ) {
    run.blood = true;
    return;
  }
  if ( action.casting ) {
    const tier = castFor(run, u, action, t);
    run.blood = true;
    if ( !tier || tier.kind === "heal" || tier.kind === "buff" ) return;
    action = tier;
  }
  // A multiattack (or Extra Attack) makes its strikes in order, turning to a new foe if the first one drops.
  if ( action.sequence?.length ) {
    let made = attacksMade;
    let target = t;
    for ( const strike of action.sequence ) {
      if ( !target || !isStanding(target) ) target = nextTargetInReach(run, u, strike);
      if ( !target ) break;
      executeOffense(run, u, strike, target, made);
      if ( !action.sameMap ) made += attacksIn(strike); // (PF2e Double Slice: both at the same penalty)
      if ( battleOver(run) ) break;
    }
    return;
  }
  u.revealed = true;
  run.blood = true; // a blow has been struck: whatever happens now, it wasn't settled with words
  const targets = [t];
  if ( action.area ) {
    const others = enemiesOf(run, u).filter(o => o !== t && isStanding(o) && !heldOff(run, u, o));
    run.rng.shuffle(others);
    targets.push(...others.slice(0, Math.max(0, (action.area.targets ?? 2) - 1)));
    if ( run.neutral ) targets.push(...caughtInArea(run, u, targets));
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
  // Whoever a hazard goes for, hit or miss, knows it's there from now on (behavior/traps.js).
  if ( u.spec.hazard ) learnTrap(run, target, u, run.trapLog);
  {
    if ( !target.active ) notice(run, target, "attacked", u);
    target.lastAttackerId = u.id;
    const held = target.grudges?.get(u.id);
    if ( held && !held.provoked ) {
      held.provoked = true; // they took from me, and now this
      want(target, "hurt", u.id, 60);
    }

    const common = logging ? {
      action: action.name, actionKind: action.kind, damageType: primaryType(action), damageTypes: damageTypesOf(action), storyType: action.storyType ?? null, target: target.spec.name, targetId: target.id,
      ranged, area: !!action.area, targetCover: !!target.spec.environment?.nearCover, attackerCover: !!u.spec.environment?.nearCover
    } : null;

    if ( action.kind === "auto" ) {
      const extra = bonusDamageParts(run, u, action, target, { commit: true });
      const hit = rollHit(run, u, action, target, (action.damage ?? []).concat(extra), 1, false);
      if ( logging ) log(run, u, { type: "auto", ...common, damage: hit.total });
      answerHarm(run, target, u, action, hit.apply());
      return;
    }

    if ( action.kind === "control" ) {
      executeControl(run, u, action, target, attacksMade, common);
      return;
    }

    if ( action.kind === "save" && action.save ) {
      const extra = bonusDamageParts(run, u, action, target, { commit: true });
      const { roll, mod } = rollSave(run, target, action.save.type, action.save.dc, { stakes: saveStakes(target, meanDamageVs(run, action, target).normal, !!action.effects?.length), label: action.name, magical: isMagical(action) });
      const mult = saveMultiplierFor(rules, roll.degree, action.save, target);
      const data = !logging ? null : { type: "save", ...common, saveType: action.save.type, natural: roll.natural, mod: mod + (roll.die ?? 0), total: roll.total, dc: action.save.dc, degree: roll.degree, margin: roll.total - action.save.dc, note: roll.note ?? null, faces: roll.faces ?? null };
      if ( mult > 0 ) {
        const hit = rollHit(run, u, action, target, (action.damage ?? []).concat(extra), mult, roll.degree === 0);
        if ( logging ) log(run, u, { ...data, damage: hit.total });
        const dealt = hit.apply();
        if ( roll.degree <= 1 ) applyEffects(run, u, action, target, 3 - roll.degree);
        answerHarm(run, target, u, action, dealt);
      } else if ( logging ) log(run, u, { ...data, damage: 0 });
      retort(run, target, u, action, roll.degree, logging);
      return;
    }

    const r = attackRoll(run, u, target, action, attacksMade);
    const { bonus, advantage } = r;
    const opts = attackOptions(r);
    // A deed is declared before the roll (DCC Mighty Deeds); the deed die adds to the roll and, on a hit, the damage.
    const deed = r.deed ? chooseDeed(run, u, action, target) : null;
    const deedRoll = r.deed ? run.rng.die(r.deed) : 0;
    let ac = currentAc(run, target, u, action);
    // Reactions to the attack itself are settled before its dice, but told after it: an answer to what was done.
    const answers = [];
    const tellAnswers = () => { for ( const tell of answers.splice(0) ) tell(); };
    // Seeing it coming (PF2e Nimble Dodge): a bonus to AC against this attack.
    if ( target.spec.reactions && target !== u ) {
      const dodge = respond(run, target, "attacked", { by: u, action, damage: meanDamageVs(run, action, target).normal });
      if ( dodge?.ac ) {
        ac += dodge.ac;
        answers.push(() => logReaction(run, target, u, dodge, "attacked"));
      }
    }
    // (A Lore-Collector that sized this foe up: the roll about 2.5 times as likely to land.)
    const lift = boostBonus(rules, u, target, bonus + deedRoll, ac, opts);
    let roll = rollCheck(rules, run.rng, bonus + deedRoll + lift, ac, opts);
    spendEdges(u, "attack", target.id);
    spendEdges(target, "defend", u.id);
    spendBoost(u, target);
    if ( run.boosting && roll.degree < 2 ) roll = boost(run, u, roll, ac, { kind: "attack", stakes: attackStakes(run, u, target, action), options: opts, label: action.name }, logger(run));
    // The system's own say once the dice are seen (Ironsworn: burning momentum), and what the roll means (initiative).
    if ( rules.adjustRoll ) {
      roll = rules.adjustRoll(run, u, roll, { kind: "attack", stakes: attackStakes(run, u, target, action), label: action.name, action, target }) ?? roll;
      if ( roll.said ) log(run, u, { text: roll.said.text, type: "adjust", ...roll.said.data });
    }
    rules.afterRoll?.(run, u, roll, { kind: "attack", action, target, faces: opts.faces ?? 20 });
    // A close miss a die can mend (5e Precision Attack).
    if ( roll.degree === 1 && u.spec.riders ) {
      const mend = rescueMiss(run, u, action, target, ac - roll.total);
      if ( mend ) {
        roll = { ...roll, total: roll.total + mend.roll };
        roll.degree = regrade(rules, roll, ac, "attack", opts);
        if ( logging ) log(run, u, { type: "rider", rider: mend.rider.label, tell: mend.rider.tell ?? null, target: target.spec.name, targetId: target.id, roll: mend.roll, made: roll.degree >= 2 });
      }
    }
    // Hit, and the target answers before the damage (5e Shield: perhaps a miss after all; Uncanny Dodge, Parry, PF2e
    // Shield Block: less of it).
    let answer = null;
    if ( roll.degree >= 2 && target.spec.reactions && target !== u ) {
      answer = respond(run, target, "hit", {
        by: u, action, roll, ac, crit: roll.degree === 3, damage: meanDamageVs(run, action, target)[roll.degree === 3 ? "critical" : "normal"], types: (action.damage ?? []).map(p => p.type)
      });
      if ( answer ) {
        answers.push(() => logReaction(run, target, u, answer, "hit"));
        if ( answer.ac ) {
          applyOutcome(target, { mods: { ac: answer.ac }, rounds: 1, label: answer.label }, target.id, { id: `reaction:${answer.id}`, name: answer.label });
          ac += answer.ac;
          roll = { ...roll, degree: regrade(rules, roll, ac, "attack", opts) };
        }
      }
    }
    // A friend close by takes some of it off, and may strike back (PF2e champion's reactions).
    let guard = null;
    if ( roll.degree >= 2 && run.guards && target !== u ) {
      const types = (action.damage ?? []).map(p => p.type);
      const expected = meanDamageVs(run, action, target)[roll.degree === 3 ? "critical" : "normal"];
      for ( const g of run.units ) {
        if ( g === target || g === u || g.side !== target.side || !g.spec.reactions?.some(x => x.on === "allyHit") ) continue;
        const r2 = respond(run, g, "allyHit", { by: u, ally: target, action, crit: roll.degree === 3, damage: expected, types });
        if ( r2 ) {
          guard = { g, r: r2 };
          answers.push(() => logReaction(run, g, u, r2, "allyHit"));
          break;
        }
      }
    }
    const data = !logging ? null : { type: "attack", ...common, natural: roll.natural, mod: bonus + deedRoll + lift + (roll.die ?? 0), total: roll.total, dc: ac, degree: roll.degree, margin: roll.total - ac, attackNumber: attacksMade + 1, boost: lift || null, faces: roll.faces ?? opts.faces, deed: r.deed ? deedRoll : null, challenge: roll.challenge ?? null, burned: roll.burned ?? null, note: roll.note ?? null };
    if ( roll.degree >= 2 ) {
      const crit = roll.degree === 3;
      const extra = bonusDamageParts(run, u, action, target, { advantage, commit: true });
      const riders = u.spec.riders ? chooseHitRiders(run, u, action, target, { crit }) : [];
      const table = crit ? rollCrit(run, u, action, target) : null;
      const base = crit ? (action.critDamage ?? criticalParts(rules, action.damage)) : (action.damage ?? []);
      const more = crit ? criticalParts(rules, extra) : [...extra];
      for ( const x of riders ) if ( x.damage?.length ) more.push(...(crit && x.critDouble ? criticalParts(rules, x.damage) : x.damage));
      if ( table?.row?.damage?.length ) more.push(...table.row.damage);
      if ( deedRoll ) more.push(part([], deedRoll, primaryType(action)));
      const hit = rollHit(run, u, action, target, more.length ? base.concat(more) : base, 1, crit, rules.minimumDamage ?? 0);
      // A finishing move (an Ironsworn End the Fight): whatever it has left.
      let amount = action.finish ? target.hp + target.temp + (target.stamina ?? 0) : hit.total;
      if ( answer?.halve ) amount = Math.floor(amount / 2);
      if ( answer?.reduce ) amount = Math.max(0, amount - samplePart(answer.reduce, run.rng));
      if ( guard?.r.reduce ) amount = Math.max(0, amount - samplePart(guard.r.reduce, run.rng));
      // Taken instead (PF2e Intercept Attack): the friend takes none of it; its protector takes the blow, against its
      // own resistances.
      const intercepted = guard?.r.redirect && amount > 0 ? rules.applyIwr(iwrOf(guard.g), hit.byType, guard.g) : null;
      if ( intercepted !== null ) amount = 0;
      if ( logging ) log(run, u, {
        ...data, damage: amount, crit, sneak: extra.length > 0, precision: [...base, ...more].some(isPrecision) || undefined, advantage, riders: riders.map(x => x.label), critRoll: table?.total ?? null, critRowText: table?.row?.text ?? null,
        lessened: amount < hit.total ? hit.total - amount : 0, interceptedBy: intercepted !== null ? guard.g.spec.name : null, intercepted
      });
      tellAnswers();
      const dealt = intercepted !== null ? 0 : hit.apply(amount);
      if ( intercepted > 0 ) dealDamage(run, u, guard.g, intercepted, { crit, types: hit.types });
      applyEffects(run, u, action, target, roll.degree);
      if ( table?.row ) applyCritRow(run, u, target, table);
      for ( const x of riders ) applyRider(run, u, action, target, x);
      if ( deed ) applyDeed(run, u, target, deed, deedRoll);
      answerHarm(run, target, u, action, dealt);
      // (Retributive Strike: the champion's own blow at the attacker, if it's within reach.)
      if ( guard?.r.strike && isUp(guard.g) && isUp(u) ) {
        const strike = riposteStrike(guard.g);
        if ( strike && movesNeeded(run, guard.g, u, strike) === 0 ) strikeTarget(run, guard.g, strike, u, 0, false, logging);
      }
    } else {
      if ( logging ) log(run, u, { ...data, damage: 0, advantage, savedBy: answer?.label ?? null });
      tellAnswers();
      // A melee miss opens the attacker up (5e Riposte).
      if ( action.melee && target.spec.reactions && isUp(target) && target !== u ) {
        const back = respond(run, target, "missed", { by: u, action });
        const strike = back?.strike ? riposteStrike(target) : null;
        if ( strike ) {
          logReaction(run, target, u, back, "missed");
          strikeTarget(run, target, strike, u, 0, false, logging);
        }
      }
      if ( deed && logging ) log(run, u, { type: "deed", deed: deed.label, target: target.spec.name, targetId: target.id, roll: deedRoll, success: false });
      // A shot into a melee that misses may stray toward one of the shooter's own friends there (rules.strayShot: DCC).
      if ( ranged && rules.strayShot ) {
        const friend = rules.strayShot(run, u, target, action);
        if ( friend && isUp(friend) ) strayShot(run, u, action, friend, logging);
      }
      if ( roll.degree === 0 && u.spec.fumble ) applyFumble(run, u);
    }
    // What the attempt costs the attacker, by the system (Ironsworn: a miss, or a weak Clash, is Pay the Price).
    backlash(run, u, target, action, roll.degree, logging);
  }
}

/**
 * A stray shot: the attack again, against the friend it strayed toward (its plain roll: no deed, no sizing up), and its
 * damage on a hit.
 */
function strayShot(run, u, action, friend, logging) {
  const rules = run.prep.rules;
  const r = attackRoll(run, u, friend, action, 0);
  const opts = attackOptions(r);
  const ac = currentAc(run, friend, u, action);
  const roll = rollCheck(rules, run.rng, r.bonus, ac, opts);
  if ( roll.degree < 2 ) {
    if ( logging ) log(run, u, { type: "stray", action: action.name, target: friend.spec.name, targetId: friend.id, natural: roll.natural, total: roll.total, dc: ac, hit: false, damage: 0 });
    return;
  }
  const hit = rollHit(run, u, action, friend, action.damage ?? [], 1, false, rules.minimumDamage ?? 0);
  if ( logging ) log(run, u, { type: "stray", action: action.name, target: friend.spec.name, targetId: friend.id, natural: roll.natural, total: roll.total, dc: ac, hit: true, damage: hit.total });
  hit.apply();
}

/**
 * What raising its shield is worth to u until its next turn, in damage terms: its bonus to AC on what's coming at
 * it, and a block (PF2e Shield Block) off one blow if it has one and its reaction to spare.
 */
function shieldWorth(run, u) {
  const inc = incoming(run, u);
  let worth = inc * 0.085 * (Number(u.spec.shield?.ac) || 2);
  const block = u.spec.reactions?.find(r => r.needsShield && r.reduce);
  if ( block && (u.reactionsLeft ?? 0) > 0 ) worth += Math.min(meanPart(block.reduce), inc / 2) * 0.8;
  return worth;
}

/** A reaction taken, for the log and the story. */
function logReaction(run, u, by, r, trigger) {
  if ( !run.log ) return;
  log(run, u, { type: "reaction", reaction: r.label, tell: r.tell ?? null, trigger, target: by.spec.name, targetId: by.id });
}

/** Hurt by a foe: the one hurt may answer (5e Hellish Rebuke: fire at whoever did it, a save for half). */
function answerHarm(run, target, by, action, dealt) {
  if ( !(dealt > 0) || !target.spec.reactions || !by || target === by || !isUp(target) || !isUp(by) ) return;
  const r = respond(run, target, "damaged", { by, action, damage: dealt });
  if ( !r?.damage?.length ) return;
  logReaction(run, target, by, r, "damaged");
  const rules = run.prep.rules;
  let mult = 1;
  let roll = null;
  if ( r.save ) {
    roll = rollSave(run, by, r.save.type, r.save.dc, { stakes: 0.3, label: r.label }).roll;
    mult = saveMultiplier(rules, roll.degree, { basic: r.save.basic !== false });
  }
  if ( mult <= 0 ) return;
  const hit = rollHit(run, target, { id: `reaction:${r.id}`, damage: r.damage }, by, r.damage, mult, false);
  if ( run.log ) log(run, target, {
    type: "auto", action: r.label, actionKind: "auto", damageType: r.damage[0]?.type ?? "untyped", target: by.spec.name, targetId: by.id, damage: hit.total, reaction: true
  });
  hit.apply();
}

/**
 * A foe casts a spell (an action with a rank: its spell level) where someone with a counterspell can see it. A spell
 * of the counter's level or lower simply fails; a higher one if the check beats 10 + its level; or (5e 2024) if
 * the caster fails a save against it.
 * @returns {boolean} countered
 */
function counterspelled(run, u, action) {
  if ( !(Number(action.rank) > 0) || !run.counters ) return false;
  const rules = run.prep.rules;
  for ( const e of run.units ) {
    if ( !e.spec.reactions || !areEnemies(run, u, e) || heldOff(run, u, e) ) continue;
    const r = respond(run, e, "spell", { by: u, action });
    if ( !r?.counter ) continue;
    let countered = !r.counter.save && (r.counter.level ?? 0) >= action.rank;
    let roll = null;
    if ( r.counter.save ) {
      roll = rollSave(run, u, r.counter.save.type, r.counter.save.dc, { stakes: 0.5, label: action.name }).roll;
      countered = roll.degree < 2;
    } else if ( !countered ) {
      roll = rollCheck(rules, run.rng, Number(r.counter.mod) || 0, 10 + action.rank, { kind: "check", roller: e });
      countered = roll.degree >= 2;
    }
    log(run, e, {
      type: "counter", reaction: r.label, target: u.spec.name, targetId: u.id, action: action.name, countered, natural: roll?.natural ?? null, total: roll?.total ?? null
    });
    if ( countered ) return true;
  }
  return false;
}

/** A crit table's row: its lasting effect on the foe (and on the attacker, rarely); some simply kill. */
function applyCritRow(run, u, target, { row, total }) {
  if ( row.slay && target.status !== STATUS.DEAD ) {
    if ( target.status === STATUS.STANDING ) dealDamage(run, u, target, target.hp + target.temp + (target.stamina ?? 0), { crit: true });
    if ( target.status === STATUS.DOWN ) {
      target.status = STATUS.DEAD;
      target.killerId = u.id;
      log(run, target, { type: "death", by: u.spec.name, byId: u.id, crit: true });
    }
  }
  if ( row.outcome && isUp(target) && !isImmune(run, target, { id: `crit:${u.id}:${row.lo}`, onSave: [row.outcome] }) ) {
    applyOutcome(target, row.outcome, u.id, { id: `crit:${u.id}`, name: row.outcome.label ?? localize("FASTFIGHTING.Effect.cripplingBlow") });
    testConcentration(run, target);
  }
  if ( row.self && isUp(u) ) applyOutcome(u, row.self, u.id, { id: `critSelf:${u.id}`, name: row.self.label ?? "" });
  log(run, target, { type: "critTable", by: u.spec.name, byId: u.id, roll: total, effect: row.outcome?.label ?? "", rowText: row.text ?? null, slain: !!row.slay });
}

/** A fumble table's row: what befalls the one who fumbled. */
function applyFumble(run, u) {
  const table = rollFumble(run, u);
  if ( !table?.row ) return;
  const { row, total } = table;
  if ( row.damage?.length ) {
    const amount = run.prep.rules.applyIwr(iwrOf(u), sampleDamage(row.damage, run.rng).byType, u);
    if ( amount > 0 ) dealDamage(run, null, u, amount);
  }
  if ( row.outcome && isUp(u) ) applyOutcome(u, row.outcome, u.id, { id: `fumble:${u.id}`, name: row.outcome.label ?? localize("FASTFIGHTING.Effect.fumble") });
  log(run, u, { type: "fumble", roll: total, effect: row.outcome?.label ?? "", rowText: row.text ?? null });
}

/** An on-hit rider's lasting part: a save against it, or simply what it does. */
function applyRider(run, u, action, target, rider) {
  let outcome = rider.save ? null : rider.outcome;
  let roll = null;
  if ( rider.save && isUp(target) ) {
    roll = rollSave(run, target, rider.save.type, rider.save.dc, { stakes: 0.6, label: rider.label }).roll;
    outcome = rider.onSave?.[roll.degree] ?? (roll.degree < 2 ? rider.outcome : null);
  }
  const fake = { id: `rider:${rider.id}`, traits: rider.traits, onSave: outcome ? [outcome] : [] };
  const landed = !!outcome && isUp(target) && !isImmune(run, target, fake);
  if ( landed ) {
    applyOutcome(target, outcome, u.id, { id: `rider:${rider.id}`, name: rider.label });
    testConcentration(run, target);
  }
  if ( run.log ) log(run, u, {
    type: "rider", rider: rider.label, tell: rider.tell ?? null, target: target.spec.name, targetId: target.id, effect: landed ? (outcome.label ?? "") : "",
    saveType: rider.save?.type ?? null, natural: roll?.natural ?? null, total: roll?.total ?? null, dc: rider.save?.dc ?? null, degree: roll?.degree ?? null, landed
  });
}

/** A declared deed whose attack hit: it happens if the deed die showed enough. */
function applyDeed(run, u, target, deed, deedRoll) {
  const tier = deedTier(deed, deedRoll);
  // (A rally: the friends close enough to see it, not the foe.)
  if ( tier?.outcome?.allies ) {
    const friends = rallied(run, u, tier.outcome);
    for ( const a of friends ) applyOutcome(a, tier.outcome, u.id, { id: `deed:${deed.id}`, name: deed.label });
    log(run, u, {
      type: "deed", deed: deed.label, target: target.spec.name, targetId: target.id, roll: deedRoll, success: friends.length > 0, effect: friends.length ? (tier.outcome.label ?? "") : "",
      allies: friends.map(a => a.spec.name)
    });
    return;
  }
  // (A defensive deed lands on the one who did it.)
  const on = tier?.outcome?.self ? u : target;
  const landed = !!tier && isUp(on) && (on === u || !isImmune(run, target, { id: `deed:${deed.id}:${tier.min}`, onSave: [tier.outcome] }));
  if ( landed ) {
    applyOutcome(on, tier.outcome, u.id, { id: `deed:${deed.id}`, name: deed.label });
    if ( on === target ) testConcentration(run, target);
  }
  log(run, u, {
    type: "deed", deed: deed.label, target: target.spec.name, targetId: target.id, roll: deedRoll, success: landed, effect: landed ? (tier.outcome?.label ?? "") : ""
  });
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
    log(run, u, { type: "execute", target: t.spec.name, targetId: t.id, luck: roll, needed, goes: true });
    return t;
  }
  const next = scoreTargets(run, u).map(x => x.t).find(o => o !== t && !wouldExecute(u, o)) ?? null;
  moveDesires(u, t, next);
  u.executionChecks.set(key, { next });
  log(run, u, {
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
    const label = spender.spec.fateLabel ?? localize("FASTFIGHTING.Words.Fate");
    if ( spender === victim && rules.avertDeath ) {
      const spent = fateOf(victim);
      rules.avertDeath(victim);
      victim.resources.fate = 0;
      run.fateInPlay = run.units.some(o => fateOf(o) > 0);
      log(run, victim, { type: "fate", self: true, label, spent, sure: true });
      return;
    }
    Object.assign(victim, before);
    if ( by ) Object.assign(actor, by);
    recomputeConditions(victim);
    if ( run.log ) run.log.length = logLength;
    run.firstFallen = firstFallen;
    spender.resources.fate -= 1;
    run.fateInPlay = run.units.some(o => fateOf(o) > 0);
    log(run, spender, {
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
    if ( logging ) log(run, u, { type: "control", ...common, immune: true, degree: null });
    return;
  }
  // Starting something that needs concentration lets go of whatever it held before.
  const released = u.concentration?.actionId === action.id ? [] : beginConcentration(run, u, action);
  if ( released.length ) log(run, u, { type: "concentrationEnd", effects: released, reason: "switch" });
  const r = controlRoll(run, u, target, action, attacksMade);
  const dc = r.dc ?? null;
  const roll = r.kind === "auto" ? { natural: null, total: null, degree: 2, mod: null }
    : (() => {
      const opts = { advantage: r.advantage, dice: r.dice, kind: r.rollKind, faces: r.faces ?? 20, critOn: r.critOn ?? null, fumbleOn: r.fumbleOn ?? null, roller: r.roller ?? null };
      let x = rollCheck(rules, run.rng, r.mod, r.dc, opts);
      if ( r.kind === "save" ) spendEdges(target, "save");
      else {
        spendEdges(u, r.rollKind, target.id);
        spendBoost(u, target);
        if ( r.rollKind === "attack" ) spendEdges(target, "defend", u.id);
      }
      // Luck: the target on a save against it, the user on its own roll.
      if ( run.boosting && x.degree < 2 ) x = boost(run, r.kind === "save" ? target : u, x, r.dc, { kind: r.rollKind, stakes: r.kind === "save" ? 0.7 : 0.3, options: opts, label: action.name }, logger(run));
      if ( r.kind === "save" ) x = standFirm(run, target, x, r.dc, 0.7, action.name);
      if ( r.kind === "save" && x.degree === 2 && upgradesSave(target, action.save.type) ) x = { ...x, degree: 3 };
      return { ...x, mod: r.mod + (x.die ?? 0) };
    })();
  // Some effects hold weaker on much stronger targets (PF2e incapacitation): their result counts one better.
  const shift = r.kind === "auto" ? 0 : degreeShift(run, u, target, action);
  const degree = Math.max(0, Math.min(3, roll.degree + (action.save ? shift : -shift)));
  // A playstyle's taunt that gets through takes hold only on its luck check (the Taunting setting: behavior/goad.js).
  const luck = r.kind === "goad" && degree >= 2 ? { roll: run.rng.die(100), needed: r.luck } : null;
  let outcome = luck && luck.roll > luck.needed ? null : controlOutcome(action, degree);
  // Some won't rise to a taunt at all (their playstyles: effects.js tauntProof): it may shrug one off as it lands.
  const proof = outcome?.taunt && !outcome.self ? tauntProof(target) : 0;
  const shrugged = proof > 0 && run.rng.chance(proof);
  if ( shrugged ) outcome = withoutTaunt(outcome);
  // Most outcomes land on the target; a botched Trip lands on the one who tried it.
  const lands = outcome?.self ? u : target;
  if ( outcome && isUp(lands) ) {
    if ( !outcome.self ) moveHeld(run, u, action, lands);
    if ( !outcome.self && run.standoff && heldOff(run, u, lands) && areEnemies(run, u, lands) ) endStandoff(run, u, "blood");
    applyOutcome(lands, outcome, u.id, action);
    testConcentration(run, lands);
    if ( run.neutral && !outcome.self ) crossed(run, u, lands, "harm", 1, logger(run));
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
    log(run, u, {
      controls: !!outcome?.conditions?.controlled,
      type: "control", ...common, roll: r.kind, saveType: action.save?.type ?? null, against: action.check?.against ?? null,
      natural: roll.natural, mod: roll.mod, total: roll.total, dc, degree, margin: roll.total === null ? null : roll.total - dc,
      effect: outcome?.label ?? "", took: !!outcome, backfired: !!outcome?.self, damage, shifted: shift, taunt: !!outcome?.taunt, note: roll.note ?? null, faces: roll.faces ?? null,
      goad: !!action.goad, skill: r.pitch?.skill ?? null, dcStat: r.pitch?.dcLabel ?? null, luck: luck?.roll ?? null, needed: luck?.needed ?? null, shrugged,
      debuff: !!(outcome?.mods || outcome?.mark), tempHp: Number(outcome?.tempHp) || 0
    });
  }
}

/** Creatures called to fight: they join the order right after u (holding its concentration, if they need it). */
function executeSummon(run, u, action) {
  if ( counterspelled(run, u, action) ) return;
  const released = beginConcentration(run, u, action);
  if ( released.length ) log(run, u, { type: "concentrationEnd", effects: released, reason: "switch" });
  const called = callSummons(run, u, action);
  log(run, u, {
    type: "summon", action: action.name, names: called.map(s => s.spec.name), ids: called.map(s => s.id)
  });
}

/** A buff on its recipients (the user too, for an aura). An action it gains at once (Action Surge) goes on the turn. */
function executeBuff(run, u, action, targets, worth = 0, turn = null) {
  if ( counterspelled(run, u, action) ) return spendUse(u, action);
  if ( action.casting ) {
    const tier = castFor(run, u, action, targets[0] ?? null);
    if ( !tier || tier.kind !== "buff" ) return spendUse(u, action);
    return executeBuff(run, u, { ...tier, id: action.id }, targets, worth, turn);
  }
  if ( action.oncePerTurn ) (u.usedThisTurn ??= new Set()).add(action.id);
  const now = Number(action.outcome?.actionsNow) || 0;
  if ( now > 0 && turn && targets.includes(u) ) turn.pools[mainPool(run.prep.rules)] = (turn.pools[mainPool(run.prep.rules)] ?? 0) + now;
  const released = u.concentration?.actionId === action.id ? [] : beginConcentration(run, u, action);
  if ( released.length ) log(run, u, { type: "concentrationEnd", effects: released, reason: "switch" });
  const landed = targets.filter(t => isUp(t));
  if ( landed.length === 1 ) moveHeld(run, u, action, landed[0]);
  // An edge that needs a roll to land (PF2e Aid, Ironsworn Secure an Advantage): what the roll reaches decides what
  // comes of it.
  let outcome = action.outcome;
  let check = null;
  if ( action.check && Number.isFinite(Number(action.check.mod)) ) {
    const rules = run.prep.rules;
    const dc = checkDc(run, u, action.check);
    const c = checkRoll(run, u, Number(action.check.mod));
    const roll = rollCheck(rules, run.rng, c.mod, dc, { advantage: c.advantage, dice: c.dice, kind: "check", roller: u, faces: action.check.faces });
    spendEdges(u, "check");
    check = { skill: action.check.label ?? "", natural: roll.natural, mod: c.mod, total: roll.total, dc, degree: roll.degree, challenge: roll.challenge ?? null };
    outcome = Array.isArray(action.onDegree) ? action.onDegree[roll.degree] ?? null : roll.degree >= 2 ? action.outcome : null;
  }
  const focus = new Map();
  for ( const t of outcome ? landed : [] ) {
    // Against whoever the friend is set on (the foe it's after, the one it would talk to, the friend it would tend).
    const on = outcome.vsFocus ? focusOf(run, t) : null;
    if ( on ) focus.set(t, on.unit);
    applyOutcome(t, on ? { ...outcome, vs: on.unit.id } : outcome, u.id, action);
    for ( const [k, v] of Object.entries(outcome.resources ?? {}) ) {
      const n = Number(v) || 0;
      if ( run.prep.rules.gainResource ) run.prep.rules.gainResource(t, k, n);
      else t.resources[k] = (t.resources[k] ?? 0) + n;
    }
    run.prep.rules.onOutcome?.(run, u, t, outcome);
  }
  if ( run.neutral ) for ( const t of landed ) crossed(run, u, t, "help", 0.5, logger(run));
  spendUse(u, action);
  if ( action.concentration ) {
    if ( holdsAnything(run, u) ) noteConcentration(u, worth);
    else u.concentration = null;
  }
  if ( run.log ) {
    const self = landed.length === 1 && landed[0] === u;
    log(run, u, {
      type: "buff", action: action.name, effect: outcome?.label ?? action.name, self, targets: landed.map(t => t.spec.name), check, failed: !outcome || !!outcome.failed,
      against: landed.map(t => focus.get(t)?.spec.name ?? null),
      targetIds: landed.map(t => t.id), withSelf: landed.includes(u), tempHp: Number(outcome?.tempHp) || 0, aura: !!action.aura,
      askedBy: landed.filter(t => t !== u && u.heard?.has(t.id)).map(t => t.spec.name), // (friends who asked for it)
      tell: action.tell ?? null // a story line of its own (dodge, reckless, surge), if the system names one
    });
  }
}

function executeHeal(run, u, action, target) {
  const rules = run.prep.rules;
  if ( counterspelled(run, u, action) ) {
    u.healedTargets.add(`${action.id}|${target.id}`);
    return spendUse(u, action);
  }
  // First aid, in the fight: the system's check, as after it.
  if ( action.firstAid ) return firstAid(run, u, target, { aftermath: false });
  if ( action.casting ) {
    const tier = castFor(run, u, action, target);
    u.healedTargets.add(`${action.id}|${target.id}`);
    if ( !tier || tier.kind !== "heal" ) return spendUse(u, action);
    return executeHeal(run, u, { ...tier, id: action.id }, target);
  }
  let multiplier = 1;
  let roll = null;
  if ( action.healCheck ) {
    const check = checkRoll(run, u, action.healCheck.mod, target);
    roll = rollCheck(rules, run.rng, check.mod, action.healCheck.dc, { advantage: check.advantage, dice: check.dice, kind: "check", roller: u });
    spendEdges(u, "check", target.id);
    multiplier = rules.healCheckMultiplier ? rules.healCheckMultiplier(roll.degree) : [0, 0, 1, 2][roll.degree];
    rules.afterRoll?.(run, u, roll, { kind: "heal", action, target, faces: roll.faces ?? 20 });
    // Someone's life on it: a healer with fate to spare tries again (the selfish less readily, for others).
    const dying = target.status === STATUS.DOWN && !target.stable;
    if ( !multiplier && dying && fateOf(u) > 0 && (u === target || run.rng.chance(clamp(1 - liveTrait(run, u, "selfish") / 100, 0.05, 0.95))) ) {
      u.resources.fate -= 1;
      run.fateInPlay = run.units.some(o => fateOf(o) > 0);
      log(run, u, { type: "fate", target: target.spec.name, targetId: target.id, label: u.spec.fateLabel ?? localize("FASTFIGHTING.Words.Fate"), spent: 1 });
      roll = rollCheck(rules, run.rng, check.mod, action.healCheck.dc, { advantage: check.advantage, dice: check.dice, kind: "check", roller: u });
      multiplier = rules.healCheckMultiplier ? rules.healCheckMultiplier(roll.degree) : [0, 0, 1, 2][roll.degree];
    }
  }
  // (A share of the target's own hit dice: DCC Lay on Hands.)
  let rolled = (action.heal ?? []).reduce((s, p) => s + samplePart(p, run.rng), 0);
  for ( let n = 0; n < (action.healDice ?? 0); n++ ) rolled += run.rng.die(target.spec.hitDie ?? 6);
  const amount = Math.max(0, Math.floor(rolled * multiplier));
  const wasDown = target.status === STATUS.DOWN;
  const before = target.hp;
  if ( amount > 0 ) rules.onHealed(target, amount);
  u.healingDone += target.hp - before;
  u.healedTargets.add(`${action.id}|${target.id}`);
  spendUse(u, action);
  const revived = wasDown && target.status === STATUS.STANDING;
  if ( run.neutral && target.hp > before ) crossed(run, u, target, "help", revived ? 1.5 : 0.75, logger(run));
  if ( run.log ) log(run, u, {
    type: "heal", action: action.name, target: target.spec.name, targetId: target.id, self: target === u, amount: target.hp - before, revived,
    potion: !!action.selfOnly, check: roll ? { skill: action.healCheck.label ?? null, natural: roll.natural, mod: action.healCheck.mod, total: roll.total, dc: action.healCheck.dc, degree: roll.degree } : null
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
    let clear = false;
    if ( takesSafeWay(run, u, safe, turn, need) ) {
      turn.spend(safe.cost);
      // (A way out that takes a check, when the system has one: XCC's acrobatics, harder against several foes.)
      const dc = list.length > 1 ? safe.check?.dcMany ?? safe.check?.dc : safe.check?.dc;
      const check = safe.check ? rollCheck(run.prep.rules, run.rng, Number(safe.check.mod) || 0, dc, { kind: "check", roller: u }) : null;
      clear = !check || check.degree >= 2;
      u.disengaged = clear;
      log(run, u, { type: "disengage", label: safe.label ?? "", natural: check?.natural ?? null, total: check?.total ?? null, dc: check ? dc : null, made: clear });
    }
    if ( !clear ) {
      for ( const { e, strike } of list ) {
        if ( !isStanding(u) || battleOver(run) ) break;
        e.reactionsLeft -= 1;
        log(run, e, { type: "opportunity", target: u.spec.name, targetId: u.id, action: strike.name });
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

/**
 * u chooses to run: it goes, unless it doesn't like to flee and stands its ground (the story hears of it once). Not
 * alone if it can help it: it calls on its group to fall back with it (its commander decides, and may order it to hold
 * instead: behavior/morale.js callRetreat). Returns true if it ran.
 */
function runs(run, u, reason, turn, why = {}) {
  if ( standsGround(run, u) ) {
    if ( !u.heldGround ) log(run, u, { type: "holdGround" });
    u.heldGround = true;
    return false;
  }
  const retreat = callRetreat(run, u, logger(run));
  if ( retreat.held ) {
    log(run, u, { type: "holdGround", ordered: true, by: retreat.commander?.spec.name ?? null });
    return false;
  }
  flee(run, u, reason, turn, why);
  const leader = retreat.commander ?? u;
  for ( const a of retreat.followers ) {
    if ( a.status !== STATUS.STANDING ) continue;
    flee(run, a, a === leader ? "leads the retreat" : `falls back with ${leader.spec.name}`, null, { retreat: true, with: leader.spec.name, withId: leader.id, leads: a === leader });
  }
  return true;
}

function flee(run, u, reason, turn = null, extra = {}) {
  // Turning to run from a foe in reach invites a parting blow.
  if ( !leaveReach(run, u, turn) ) return;
  u.status = STATUS.FLED;
  u.fellRound ??= run.round;
  u.ranRound = run.round; // (seen running: its friends take it hard)
  if ( u.concentration ) {
    endConcentration(run, u);
    settleSides(run);
  }
  for ( const id of u.adjacent ) run.byId.get(id)?.adjacent.delete(u.id);
  u.adjacent.clear();
  releaseGrabs(run, u);
  const from = run.log && u.pos ? { x: u.pos.x, y: u.pos.y } : null;
  const feet = moveAway(run, u, (Math.max(...Object.values(u.spec.speeds ?? { walk: 25 })) || 25) * 2);
  log(run, u, { type: "flee", feet, mode: (u.spec.speeds?.fly ?? 0) > 0 ? "fly" : "walk", from, to: from ? { x: u.pos.x, y: u.pos.y } : null, ...extra });
  // Fleeing into a bystander alerts them; an ally will hear the call for help.
  for ( const b of run.units ) {
    if ( b.active || b.status !== STATUS.STANDING ) continue;
    const d = edgeDistance(u, b);
    if ( d !== null && d <= 40 ) notice(run, b, b.side === u.side ? "help" : "fledInto", u);
  }
}

function moveLog(run, u, move, toward, purpose = "approach") {
  if ( !run.log || !(move.feet > 0) ) return;
  log(run, u, {
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
      log(run, u, {
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
    log(run, u, { type: "door", method: "open", success: true, ...where });
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
    log(run, u, { type: "door", method: "giveup", success: false, ...where });
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
    const roll = rollCheck(rules, run.rng, plan.strike.bonus ?? 0, door.ac, { kind: "attack", roller: u });
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
    log(run, u, {
      type: "door", method: "attack", success: broke, hit: roll.degree >= 2, damage, action: plan.strike.name,
      natural: roll.natural, mod: plan.strike.bonus ?? 0, total: roll.total, dc: door.ac, degree: roll.degree, ...where
    });
  } else {
    const roll = rollCheck(rules, run.rng, plan.mod, plan.dc, { kind: "check", roller: u, faces: plan.faces });
    const success = roll.degree >= 2;
    if ( success ) openDoor(run, door, state, plan.method === "force");
    else thwart(run, u, kind, target.id, 12);
    log(run, u, {
      type: "door", method: plan.method, success, natural: roll.natural, mod: plan.mod, total: roll.total, dc: plan.dc, degree: roll.degree, ...where
    });
  }
  if ( state.open ) relieve(u, kind, target.id);
  return "worked";
}

/**
 * A Lore-Collector sizing up a foe (one it hasn't sized up, or let pass) before it first deals with it, by words or by
 * weapons: from then on it deals with that foe better (battle-state.js studyBonus). Whether it takes the time is its
 * playstyle's chance, decided once a foe; `room` says whether the turn has the time now. Returns true if it did.
 */
function sizesUp(run, u, t, turn, room, { decided = false, wholeTurn = false } = {}) {
  const chance = decided ? 1 : behaviorOf(u).study;
  if ( !chance || !room || sizedUp(u, t) || passedOver(u, t) ) return false;
  if ( !areEnemies(run, u, t) && !seemsFoe(run, u, t) ) return false;
  const rules = run.prep.rules;
  const cost = rules.basicAction ?? 1;
  if ( !turn.canAfford(cost) ) return false;
  // (Whether to take the time is decided once for each sort of foe: knowing one goblin warrior is knowing them all.)
  const sort = sortOf(t);
  if ( !run.rng.chance(chance) ) {
    u.studied.add(`skipsort:${sort}`);
    return false;
  }
  turn.spend(cost);
  // The system's way of sizing a foe up, when the helper gives one (PF2e Recall Knowledge, 5e Study, Ironsworn Secure an
  // Advantage): it has to work. Otherwise it simply does.
  const how = u.spec.sizeUp;
  let check = null;
  if ( Number.isFinite(how?.mod) ) {
    const dc = Number.isFinite(how.dc) ? how.dc : rules.sizeUpDC?.(t) ?? typical(rules, "dc", t.spec.level ?? 0);
    const c = checkRoll(run, u, how.mod);
    const roll = rollCheck(rules, run.rng, c.mod, dc, { advantage: c.advantage, dice: c.dice, kind: "check", roller: u, faces: how.faces });
    spendEdges(u, "check");
    check = { skill: how.label ?? "", natural: roll.natural, mod: c.mod, total: roll.total, dc, degree: roll.degree, challenge: roll.challenge ?? null };
  }
  const worked = !check || check.degree >= 2;
  // What it pays off with: by default its rolls against t about 2.5 times as likely to succeed; the system may say
  // otherwise (Ironsworn: its next attack or words, at anyone, 25% likelier).
  const factor = Number(how?.boost) > 1 ? Number(how.boost) : LORE_BOOST;
  const uses = Number(how?.uses) > 0 ? Number(how.uses) : undefined;
  // Others of its sort here: what it learns (or doesn't) holds for them too.
  const kin = run.units.filter(o => o !== t && isStanding(o) && sortOf(o) === sort).length;
  if ( worked ) {
    u.studied.add(t.id);
    u.studied.add(`sort:${sort}`);
    // Paid for, and it worked: against any of that sort (or, as the system says, anyone), for the rest of this turn
    // (or through its next, when sizing it up took the turn), to make up for the time it took.
    applyOutcome(u, { boost: factor, uses, vsSort: how?.anyFoe ? undefined : sort, rounds: 1, thisTurn: !wholeTurn, label: localize("FASTFIGHTING.Effect.sizedUp") }, u.id, { id: `sizeUp:${sort}`, name: localize("FASTFIGHTING.Effect.sizedUp") });
  } else {
    u.studied.add(`skipsort:${sort}`);
    // (What a miss costs, in the system's terms: Ironsworn's price.)
    if ( how?.missOutcome ) rules.onOutcome?.(run, u, u, how.missOutcome);
  }
  log(run, u, {
    type: "study", target: t.spec.name, targetId: t.id, worked, check, factor, oneRoll: !!uses, anyFoe: !!how?.anyFoe, kin, price: !worked && how?.missOutcome ? how.missOutcome.label ?? "" : null
  });
  if ( worked ) shareLore(run, u, t, sort, turn);
  return true;
}

/**
 * How likely u is to share what it learned (0 to 1). Not everyone likes to: its Lore-Collector pill's chance (smaller
 * the further down its pills it is), times how minded it is to: from even odds, more for the loyal and less for the
 * selfish, more for a tactical mind (it sees the worth of it), and as its pills lean on supporting friends (Enablers,
 * People-Pleasers, those who'd lead more; the lazy, brawlers, mercenaries less). Its side's leader shares as readily
 * as that; anyone else half as readily, unless it would rather talk than fight anyway.
 */
export function shareChance(run, u) {
  const chance = behaviorOf(u).share ?? 0;
  if ( !chance || u.spec.social?.mindless ) return 0;
  const minded = 0.5 + (liveTrait(run, u, "loyal") - 50) / 100 - (liveTrait(run, u, "selfish") - 50) / 100
    + (liveTier(run, u) >= TACTICAL.TACTICAL ? 0.15 : 0) + (styleOf(u).aid ?? 0) / 100;
  const leads = commandOf(run, u)?.unit === u;
  return clamp(chance * clamp(minded, 0, 1) * (leads || prefersTalk(u) ? 1 : 0.5), 0, 1);
}

/**
 * A Lore-Collector may pass on what it learned about t's sort, if it's minded to (shareChance): decided when it
 * learns it, told when it has an action for it (now, or its next turn).
 */
function shareLore(run, u, t, sort, turn) {
  const chance = shareChance(run, u);
  if ( !chance ) return;
  if ( !run.rng.chance(chance) ) {
    log(run, u, { type: "keepLore", target: t.spec.name, targetId: t.id, chance });
    return;
  }
  u.lorePending = { sort, name: t.spec.name, id: t.id, chance };
  tellLore(run, u, turn);
}

/**
 * Telling it: an action, to every friend within a move of it (as far as it can properly explain what it learned in
 * the time) who can understand it (a language in common). They know that sort too from then on (battle-state.js
 * studyBonus), though only the one that took the time gets the payoff. With no action left, it waits for its next
 * turn; with no one to tell, nothing is spent.
 */
function tellLore(run, u, turn) {
  const p = u.lorePending;
  if ( !p ) return;
  if ( !isStanding(u) ) {
    u.lorePending = null;
    return;
  }
  const cost = run.prep.rules.basicAction ?? 1;
  if ( !turn.canAfford(cost) ) return;
  const move = Number(u.spec.speeds?.walk) || Math.max(0, ...Object.values(u.spec.speeds ?? {}).map(Number).filter(Number.isFinite)) || 30;
  const told = alliesOf(run, u).filter(a => {
    if ( a === u || !isStanding(a) || a.studied?.has(`sort:${p.sort}`) || a.spec.social?.mindless || !shareLanguage(u, a, run) ) return false;
    const d = edgeDistance(u, a);
    return d === null || d <= move;
  });
  u.lorePending = null;
  if ( !told.length ) return;
  turn.spend(cost);
  for ( const a of told ) a.studied.add(`sort:${p.sort}`);
  log(run, u, {
    type: "shareLore", target: p.name, targetId: p.id, with: told.map(a => a.spec.name), withIds: told.map(a => a.id), chance: p.chance
  });
}

/** A Lore-Collector's payoff for sizing a foe up: its rolls against it about this many times as likely to succeed. */
const LORE_BOOST = 2.5;

/**
 * A Lore-Collector's first turn of a standoff: it may spend the whole of it watching the other side instead of
 * talking (its playstyle's chance, by the pill's place among its others), sizing up as many of them as it has
 * actions for: the one it would talk to first, then the strongest. The talk makes no progress from it that turn (and
 * the standoff may not last), but its next turn's rolls against those it sized up are much likelier to land. Returns
 * true if it spent the turn watching.
 */
function observes(run, u, turn) {
  if ( u.observed ) return false;
  u.observed = true;
  const chance = behaviorOf(u).observe;
  if ( !chance || !run.rng.chance(chance) ) return false;
  const seen = o => isStanding(o) && areEnemies(run, u, o) && !o.spec.untargetable && !(o.spec.hidden && !o.revealed) && !sizedUp(u, o) && !passedOver(u, o);
  const first = choosePitch(run, u)?.target;
  // (One of each sort: sizing up one goblin warrior is sizing up them all.)
  const sorts = new Set();
  const foes = run.units.filter(seen).sort((a, b) => (b === first) - (a === first) || (Number(b.spec.level) || 0) - (Number(a.spec.level) || 0))
    .filter(o => !sorts.has(sortOf(o)) && sorts.add(sortOf(o)));
  if ( !foes.length ) return false;
  log(run, u, { type: "observe", targets: foes.map(f => f.spec.name), targetIds: foes.map(f => f.id) });
  for ( const t of foes ) if ( !sizesUp(run, u, t, turn, true, { decided: true, wholeTurn: true }) ) break;
  turn.spendAll();
  return true;
}

/**
 * Who commands each group, as it changes: a lieutenant stepping up when the boss or the leader can't lead (down, dead,
 * gone, blinded, silenced ...), the boss or leader taking back over, nobody left to lead. Logged as it happens.
 */
function noteCommand(run, quietly = false) {
  if ( !run.prep.options.leadership ) return;
  run.commanders ??= new Map();
  run.everCommanded ??= new Set();
  for ( const key of Object.keys(run.prep.command ?? {}) ) {
    const cmd = command(run, key);
    const id = cmd?.unit.id ?? null;
    const before = run.commanders.has(key) ? run.commanders.get(key) : undefined;
    run.commanders.set(key, id);
    const again = !!id && run.everCommanded.has(id);
    if ( id ) run.everCommanded.add(id);
    if ( quietly || before === undefined || before === id ) continue;
    const from = before ? run.byId.get(before) : null;
    if ( !cmd ) {
      startTurn(run, from);
      log(run, from, { type: "command", group: key, lost: true, from: from?.spec.name ?? null });
      continue;
    }
    startTurn(run, cmd.unit);
    // Back in charge (it commanded before), or taking command.
    const back = again;
    log(run, cmd.unit, {
      type: "command", group: key, role: cmd.boss ? "boss" : cmd.rank === 0 ? "leader" : `lieutenant ${cmd.rank}`, back, from: from?.spec.name ?? null
    });
  }
}

/**
 * What u wants this turn: its tactics' reasoning (whom it would fight, and the runners-up; whom it would mend; whom it
 * would talk to; whom it fears), on top of what it was told to want and what the fight has stirred.
 */
function deliberate(run, u) {
  newTurn(u);
  // Taunted: it wants the taunter (as long as the taunt lasts and the taunter stands).
  goaded(run, u);
  // One who wants to lead and doesn't may scheme against whoever does (then it follows no one this turn).
  if ( scheme(run, u) && run.log ) {
    log(run, u, { type: "scheme", target: u.scheming.name, targetId: u.scheming.against, boss: u.scheming.boss });
  }
  // Whether it takes its lead from whoever commands its group this turn (its playstyle leans toward theirs if so).
  follow(run, u);
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
  // Not one for killing: an enemy talked out of the fight is someone to talk away (or over), not to cut down.
  u.peace = null;
  // (As strongly as its answer leans to avoiding killing.)
  if ( wish(u.spec.avoidKilling) && run.neutral && run.prep.options.talking && canTalk(u) && u.tac?.talk !== "never" ) {
    u.peace = peaceDesires(run, u, Math.max(40, ...[...u.desire.logic.values()]) * wish(u.spec.avoidKilling));
  }
  if ( u.tac?.target === "protect" ) {
    const ward = run.units.find(a => a !== u && a.side === u.side && isStanding(a) && run.units.some(e => e.targetId === a.id && isStanding(e) && areEnemies(run, a, e)));
    if ( ward ) think(u, "protect", ward.id, 50);
  }
  // Badly hurt, it loses heart for foes it would have to cross the field to reach.
  if ( u.maxHp > 0 && u.hp / u.maxHp < 0.35 ) for ( const x of scored ) if ( x.moves >= 2 ) thwart(run, u, "hurt", x.t.id, 5);
  // Its playstyle's leanings (the weakest, the fallen, a friend to guard, something to fear ...).
  styleWants(run, u, scored, { canHeal: !!u.prep.healActions?.length, canTalk: !!talkTarget, talkTarget, canAid: !!u.prep.buffActions?.length });
  partyWants(run, u, scored, { canHeal: !!u.prep.healActions?.length });
  // What its leader and its friends want pulls on it too (for most, the leader more than the crowd).
  listen(run, u, { canHeal: !!u.prep.healActions?.length, canTalk: (u.prep.talkAffinity ?? 0) > 0, canAid: !!u.prep.buffActions?.length });
  // Friends asking it for a buff, who can make themselves understood: a willing one wants to oblige.
  heed(run, u, { canAid: !!u.prep.buffActions?.length, understands: (a, b) => !a.spec.social?.mindless && !b.spec.social?.mindless && shareLanguage(a, b, run) });
  remember(run, u);
  if ( run.log ) {
    const top = thoughtsOf(run, u);
    if ( top.length || u.following ) {
      const following = u.following ? { name: u.following.name, boss: u.following.boss, chance: u.following.chance, share: u.following.share } : null;
      log(run, u, { type: "thought", desires: top, following });
    }
  }
}

/**
 * Abilities that come back: a 5e "Recharge 5–6" (action.recharge {on, die}: a die at the start of its turn), or a
 * PF2e "can't use it again for 1d4 rounds" (action.cooldown {n, faces}: rolled the first turn after it's used).
 */
function rechargeActions(run, u) {
  for ( const a of u.spec.actions ) {
    if ( !(a.recharge || a.cooldown) || !Number.isFinite(a.uses) || (u.uses[a.id] ?? 0) >= a.uses ) continue;
    let back;
    if ( a.recharge ) back = run.rng.die(a.recharge.die ?? 6) >= (a.recharge.on ?? 6);
    else {
      u.readyAt ??= {};
      if ( u.readyAt[a.id] === undefined ) {
        let rounds = 0;
        for ( let i = 0; i < (a.cooldown.n ?? 1); i++ ) rounds += run.rng.die(a.cooldown.faces ?? 4);
        u.readyAt[a.id] = run.round - 1 + rounds; // (counted from the round it was used)
      }
      back = run.round >= u.readyAt[a.id];
      if ( back ) delete u.readyAt[a.id];
    }
    if ( !back ) continue;
    u.uses[a.id] = a.uses;
    log(run, u, { type: "recharge", action: a.name });
  }
}

/**
 * Legendary actions (5e): after each other creature's turn, a legendary creature may spend some of its pool
 * (spec.legendary.pool, back at the start of its own turn) on one of its legendary options (action.legendary: what
 * it costs), the best value it can get against a foe already in reach. Not while it can't act, or a standoff holds.
 */
function legendaryMoment(run, after) {
  if ( run.standoff ) return;
  for ( const u of run.units ) {
    if ( u === after || !u.prep.legendaryActions?.length || !isStanding(u) || !((u.legendaryLeft ?? 0) > 0) ) continue;
    if ( u.conds.incapacitated || (run.prep.rules.modifiers?.actionsLost?.(u) ?? 0) >= 3 ) continue;
    let best = null;
    for ( const action of u.prep.legendaryActions ) {
      if ( action.legendary > u.legendaryLeft || !hasUses(u, action) ) continue;
      for ( const t of enemiesOf(run, u) ) {
        if ( !isStanding(t) || movesNeeded(run, u, t, action) !== 0 ) continue;
        const ev = expectedDamage(run, u, action, t, 0) / action.legendary;
        if ( ev > 0 && (!best || ev > best.ev) ) best = { action, t, ev };
      }
    }
    if ( !best ) continue;
    u.legendaryLeft -= best.action.legendary;
    startTurn(run, u);
    log(run, u, { type: "legendary", action: best.action.name, cost: best.action.legendary, target: best.t.spec.name, targetId: best.t.id });
    executeOffense(run, u, best.action, best.t, 0);
    spendUse(u, best.action);
    if ( battleOver(run) ) return;
  }
}

/** Pitches made in a standoff turn (or a leader's last word, aimed only at the player characters). Returns how many. */
function standoffPitching(run, u, n, only = null) {
  let made = 0;
  for ( let i = 0; i < n; i++ ) {
    const pitch = choosePitch(run, u, { only });
    if ( !pitch ) break;
    attemptTalk(run, u, pitch, logger(run));
    made += 1;
    if ( battleOver(run) ) break;
  }
  return made;
}

/**
 * One who can't abide violence, seeing a fight (in a standoff, a quarrel between someone taking no side and one of the
 * sides; any fight, for one taking no side), puts its words into stopping it, whoever's in it: talking the fighters
 * into letting it be (in a standoff), or into leaving. Returns true if it made a pitch.
 */
function keepsPeace(run, u, actions) {
  if ( !dislikesViolence(u) || !run.prep.options.talking || !canTalk(u) || u.tac?.talk === "never" ) return false;
  const fighters = new Set(run.units.filter(o => o !== u && fighting(run, o) && perceives(run, u, o)));
  if ( !fighters.size ) return false;
  u.calming = run.standoff ? "pacify" : "leave";
  const first = !u.keptPeace;
  const made = standoffPitching(run, u, Math.max(1, standoffPitches(run, u, actions)), o => fighters.has(o));
  u.calming = null;
  if ( made && first ) {
    u.keptPeace = true;
    // (Told before the words it says.)
    const at = run.log ? run.log.length - made : 0;
    if ( run.log ) run.log.splice(at, 0, { round: run.round, actor: u.spec.name, actorId: u.id, side: u.side, text: "tries to calm things down", type: "peacekeep" });
  }
  return made > 0;
}

/**
 * A turn for someone who takes no side and isn't fighting anyone: it watches, unless it's having words with someone
 * who crossed it (behavior/neutral.js), when it presses its case, lets it drop if there's no one left to talk to, or
 * loses patience and turns on them. Returns true if it now fights (the rest of the turn is an ordinary one).
 */
function neutralTurn(run, u) {
  const say = logger(run);
  // One who can't abide violence, seeing a fight, tries to stop it. Otherwise, leaning toward a side, it may get
  // involved (mostly not, unless that side is one it likes and looks like winning: neutral.js meddling): talking the
  // side it likes least out of the fight, or squeezing it for money.
  if ( !u.truce && run.prep.options.talking && canTalk(u) && u.tac?.talk !== "never" ) {
    const rules = run.prep.rules;
    const actions = turnFor(run, u).howMany(rules.talkCost ?? rules.basicAction ?? 1);
    if ( !keepsPeace(run, u, actions) ) {
      const involved = meddling(run, u, say);
      if ( involved ) {
        const against = new Set(involved.against);
        standoffPitching(run, u, Math.max(1, standoffPitches(run, u, actions)), o => !isNeutral(o) && against.has(o.side) && isStanding(o));
      }
    }
  }
  if ( u.truce ) {
    const other = truceWith(run, u);
    if ( !other ) {
      log(run, u, { type: "neutral", what: "lapse" });
      settleTruce(u, u.truce.side);
    } else if ( truceBreaks(run, u) ) {
      turnOn(run, u, other, "impatient", say);
      return true;
    } else {
      const rules = run.prep.rules;
      const side = u.truce.side;
      standoffPitching(run, u, standoffPitches(run, u, turnFor(run, u).howMany(rules.talkCost ?? rules.basicAction ?? 1)), o => o.side === side);
    }
  }
  u.turnsTaken += 1;
  endOfTurn(run, u);
  return false;
}

/**
 * A turn while the standoff holds: talkers press their case, everyone else keeps their hands off their weapons (and a
 * Lore-Collector may spend its first one watching the other side). One who can't abide violence, seeing a quarrel
 * break out beside it, tries to calm it first.
 */
function standoffTurn(run, u) {
  const rules = run.prep.rules;
  const turn = turnFor(run, u);
  tellLore(run, u, turn); // (what it learned last turn, if it means to tell its friends)
  // What it offers, or expects, comes first (behavior/bargain.js); a deal ends it.
  if ( u.spec.motives && bargain(run, u, logger(run)) ) {
    u.turnsTaken += 1;
    return endOfTurn(run, u);
  }
  const actions = turn.howMany(rules.talkCost ?? rules.basicAction ?? 1);
  if ( !keepsPeace(run, u, actions) && !observes(run, u, turn) ) standoffPitching(run, u, standoffPitches(run, u, actions));
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
    log(run, found.leader, { type: "lastWord" });
    standoffPitching(run, found.leader, turnFor(run, found.leader).howMany(rules.talkCost ?? rules.basicAction ?? 1), o => o.spec.kind === "pc");
    if ( battleOver(run) ) return true;
  }
  return false;
}

/**
 * A hazard's turn (a trap, a haunt, a hazardous feature): it doesn't move, think or talk. It fires at its side's enemies
 * in its reach, its actions in the order it has them, as far as its turn goes; a simple hazard fires once, a complex one
 * each round. It's set from the start, encounter or not, and waits out a standoff (nothing has set it off).
 */
function hazardTurn(run, u) {
  if ( run.standoff || u.spent || u.status !== STATUS.STANDING ) return;
  const turn = turnFor(run, u);
  run.acting = u;
  u.turn = turn;
  let made = 0;
  for ( let tries = 0; tries < 6 && !battleOver(run); tries++ ) {
    const action = u.prep.offense.find(a => turn.canAfford(costOf(run.prep.rules, a, u)) && hasUses(u, a) && nextTargetInReach(run, u, a));
    if ( !action ) break;
    turn.spend(costOf(run.prep.rules, action, u));
    spendUse(u, action);
    executeOffense(run, u, action, nextTargetInReach(run, u, action), made);
    made += attacksIn(action);
    if ( u.spec.hazard.once ) {
      u.spent = true; // (its one trigger: spent)
      break;
    }
  }
  run.acting = null;
}

function takeTurn(run, u) {
  const { rules, options } = run.prep;
  if ( [STATUS.DEAD, STATUS.FLED, STATUS.SURRENDERED, STATUS.STOOD_DOWN, STATUS.BEATEN].includes(u.status) ) return;
  if ( u.spec.hazard ) return hazardTurn(run, u);
  // On the map but not in the conflict: it only looks around, until the round after it notices.
  if ( !u.active && !lookAround(run, u) ) return;
  // A summoned creature: gone when its time or its summoner's concentration runs out; idle when it wasn't sustained.
  if ( u.summoner ) {
    const state = summonState(run, u);
    if ( state === "expired" || state === "released" ) {
      dismiss(u);
      log(run, u, { type: "vanish", reason: state });
      return;
    }
    if ( state === "idle" ) return;
  }
  u.shieldRaised = false;
  // Hurt since its last turn: it's being hurt now.
  u.beingHurt = !!u.hurtSinceTurn;
  u.hurtSinceTurn = false;
  // A creature's reaction comes back at the start of its turn.
  u.reactionsLeft = reactionsPerRound(rules, u);
  rechargeActions(run, u);
  if ( rules.startTurn ) {
    // (What the system says at the start of a turn: one report, or several, each about whoever it names.)
    for ( const said of [rules.startTurn(run, u)].flat() ) if ( said?.text ) log(run, said.unit ?? u, { text: said.text, type: "startTurn", ...said.data });
  }
  if ( u.spec.legendary?.pool ) u.legendaryLeft = u.spec.legendary.pool; // (legendary actions come back)
  u.disengaged = false;

  settleSides(run); // holds that took or ended since this creature's last turn
  regenerate(run, u);
  if ( u.status === STATUS.DEAD ) return endOfTurn(run, u);
  if ( u.status === STATUS.DOWN && u.held ) return endOfTurn(run, u); // (held at the edge by its regeneration)
  if ( u.status === STATUS.DOWN ) {
    if ( options.downedModel === DOWNED_MODELS.SIMULATE && rules.recoveryCheck ) {
      fateful(run, u, null, () => {
        const before = u.dying;
        const text = rules.recoveryCheck(u, run.rng);
        if ( text ) log(run, u, { text, type: "recovery", before, dying: u.dying, dead: u.status === STATUS.DEAD, stable: u.stable });
      });
    }
    endOfTurn(run, u);
    return;
  }

  // Taking no side: it watches, or has words with whoever crossed it; once it has turned on a side, it fights.
  if ( isNeutral(u) && !enemiesOf(run, u).some(isStanding) && !neutralTurn(run, u) ) return;

  // While a standoff holds, its sides don't fight; it lasts until someone gets upset. (A quarrel between someone taking
  // no side and one of the sides is fought out meanwhile, by those two alone: the standoff holds.)
  let brokeStandoff = false;
  if ( run.standoff ) {
    const cause = isNeutral(u) ? null : breaksStandoff(run, u, logger(run));
    if ( !cause && !inFray(run, u) ) return standoffTurn(run, u);
    // Only an argument: a quarrel coming to blows ends it too.
    if ( !cause && run.prep.options.opening === OPENING.ARGUMENT ) return collapse(run, u, "fray");
    if ( cause ) {
      // A charismatic leader may get a last word in before it comes to blows.
      if ( lastWord(run) ) return;
      endStandoff(run, u, cause);
      if ( run.resolved ) return; // (only an argument: it's over)
      brokeStandoff = true; // whoever breaks it came to fight, not to talk
    }
  }

  // The turn's budget comes from the system (PF2e: three actions; 5e: an action, a bonus action and movement).
  const turn = turnFor(run, u);
  // Whose turn it is, and what's left of it (a rider that takes a bonus action can only be had on one's own).
  run.acting = u;
  u.turn = turn;
  // What it has called and must sustain (PF2e), first thing.
  if ( u.prep.summonActions?.length ) {
    const { kept, gone } = sustainSummons(run, u, turn);
    for ( const a of kept ) log(run, u, { type: "sustain", action: a.name });
    for ( const s of gone ) {
      dismiss(s);
      log(run, s, { type: "vanish", reason: "unsustained" });
    }
  }
  const morale = checkMorale(run, u);
  if ( morale === MORALE.ROUT && runs(run, u, "breaks and flees", turn, { why: "breaks" }) ) return;
  if ( morale !== MORALE.HOLD && !u.wavering ) {
    u.wavering = true; // (shaken, even when it won't run)
    if ( morale === MORALE.WAVER ) log(run, u, { type: "waver" });
  }
  // Friends running or wavering: it may spend an action holding the rest together.
  if ( turn.canAfford(rules.basicAction ?? 1) ) {
    const heard = rallies(run, u);
    if ( heard ) {
      turn.spend(rules.basicAction ?? 1);
      log(run, u, { type: "rally", with: heard.map(a => a.spec.name), withIds: heard.map(a => a.id) });
    }
  }
  // In the reach of a hazard it spotted: it steps out first, if it can (behavior/traps.js).
  if ( run.trapsSpotted ) stepOut(run, u, turn, run.trapLog);

  // What it wants this turn, and what that means: a terror close at hand sends it running.
  deliberate(run, u);
  const wants = mind(run, u);
  if ( wants.lead?.kind === "avoid" && wants.lead.level >= 70 ) {
    const dread = run.byId.get(wants.lead.targetId);
    const d = dread ? edgeDistance(u, dread) : null;
    if ( dread && (d === null || d <= 30) && runs(run, u, `runs from ${dread.spec.name}`, turn, { why: "dread", dread: dread.spec.name }) ) return;
  }

  const disposition = dispositionOf(u);
  if ( u.prone && u.wasDowned && disposition.selfRevived === "retreat" && runs(run, u, "retreats after being revived", turn, { why: "revived" }) ) return;
  if ( disposition.allyDying === "retreat" && run.units.some(a => a.side === u.side && a !== u && a.status === STATUS.DOWN && a.active)
    && runs(run, u, "retreats as an ally falls", turn, { why: "allyFalls" }) ) return;

  u.usedThisTurn = null; // once-per-turn riders such as sneak attack
  u.stoleThisTurn = false;
  u.actsThisTurn = 0;     // (which action die the next action rolls, where there are several: DCC)
  const basic = rules.basicAction ?? 1; // a simple action: stand, escape, size up a foe, step
  const behavior = behaviorOf(u);
  // Diplomats with no one who understands them still try to talk.
  if ( !u.parleyed ) {
    u.parleyed = true;
    if ( behavior.parleyFirst && turn.canAfford(basic) && !u.spec.social && run.rng.chance(behavior.parleyFirst) ) {
      turn.spend(basic);
      log(run, u, { type: "parley" });
    }
  }
  let attacksMade = 0;
  if ( u.prone ) {
    const stand = rules.standCost ? rules.standCost(u) : basic;
    if ( turn.canAfford(stand) ) {
      turn.spend(stand);
      u.prone = false;
      log(run, u, { type: "stand" });
    }
  }
  if ( u.grabbedBy && turn.canAfford(basic) ) {
    // Escape attempt costs an action; succeed half the time.
    turn.spend(basic);
    const escaped = run.rng.chance(0.5);
    if ( escaped ) u.grabbedBy = null;
    log(run, u, { type: "escape", success: escaped });
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
        log(run, u, { type: "callHelp", toward: helper.spec.name, towardId: helper.id });
        notice(run, helper, "help", u);
        break;
      }
      if ( move.feet <= 0 ) break; // can't get any closer
    }
  }

  // What it learned last turn, if it means to tell its friends: an action, first thing.
  tellLore(run, u, turn);

  // Words before weapons: talkers sway, the less battle-worthy talk twice, anyone may quip.
  const talkCost = rules.talkCost ?? basic;
  // Set on talking someone round: it talks to them (and keeps at it). Something far stronger on its mind: no talk.
  const lead = wants.lead;
  const only = lead?.kind === "talk" && lead.driven !== "logic" ? (t => t.id === lead.targetId) : null;
  // Not one for killing, with someone it wants to talk out of the fight (or over) in view: words first.
  const peaceful = !only && u.peace && wants.inView("talk", u.peace.targetId) ? (t => t.id === u.peace.targetId) : null;
  const peacePitch = peaceful && !brokeStandoff ? choosePitch(run, u, { only: peaceful }) : null;
  const talking = brokeStandoff ? { count: 0, pitch: null }
    : only ? { count: turn.howMany(talkCost), pitch: choosePitch(run, u, { only }) }
      : peacePitch ? { count: Math.min(turn.howMany(talkCost), u.peace.level >= (lead?.level ?? 0) ? 2 : 1), pitch: peacePitch }
      : (wants.blinding && lead.level >= 60 && !wants.kindInView("talk")) ? { count: 0, pitch: null }
        : talkActionsThisTurn(run, u, turn.howMany(talkCost));
  // A Lore-Collector sizes up whoever it's about to talk to first: where a turn has several actions, when that leaves
  // one to talk with; where it has one, the whole turn (the talking waits, and its payoff makes up for it).
  const listener = talking.count > 0 ? talking.pitch?.target : null;
  const several = unitsPerTurn(rules, u) >= 2;
  if ( listener && sizesUp(run, u, listener, turn, several ? turn.howMany(basic) >= 2 : true, { wholeTurn: !several }) ) {
    talking.count = Math.min(talking.count, turn.howMany(talkCost));
    if ( !talking.count ) u.talkPending = true;
  }
  for ( let i = 0; i < talking.count && turn.canAfford(talkCost); i++ ) {
    const pitch = i === 0 ? talking.pitch : choosePitch(run, u, only ? { only } : peacePitch ? { only: peaceful } : {}); // the first pitch was already chosen
    if ( !pitch ) break;
    attemptTalk(run, u, pitch, logger(run));
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
      u.actsThisTurn += 1;
      continue;
    }
    // Call creatures to fight beside it, when they'd do more over the fight than its own blows.
    const summon = decideSummon(run, u, turn);
    if ( summon ) {
      turn.spend(costOf(rules, summon, u));
      executeSummon(run, u, summon);
      spendUse(u, summon);
      u.actsThisTurn += 1;
      continue;
    }
    // Bolster a friend (or itself) when that does more than attacking would.
    const buff = decideBuff(run, u, turn);
    if ( buff ) {
      turn.spend(costOf(rules, buff.action, u));
      executeBuff(run, u, buff.action, buff.targets, buff.worth, turn);
      u.actsThisTurn += 1;
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
    // A thief may rob someone within reach instead of hitting them (once a turn).
    if ( !u.stoleThisTurn ) {
      u.stoleThisTurn = true;
      const mark = theftTarget(run, u);
      const chance = mark ? stealChance(run, u, mark) : 0;
      const plan = chance > 0 ? theftPlan(run, u, mark) : null;
      if ( plan && turn.canAfford(plan.cost) && run.rng.chance(chance) ) {
        turn.spend(plan.cost);
        const result = attemptTheft(run, u, mark, logger(run), { plan, attacksMade });
        attacksMade += result.attacks ?? 0;
        continue;
      }
    }
    u.targetId = target.id;
    const option = bestOptionVs(run, u, target, attacksMade, turn);
    if ( !option ) break;
    // A Lore-Collector sizes up a new foe before it attacks it: where a turn has several actions, when that leaves one
    // to fight with; where it has one, the whole turn (its payoff next turn makes up for it).
    if ( sizesUp(run, u, target, turn, several ? turn.howMany(basic) >= 2 : true, { wholeTurn: !several }) ) continue;

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
      log(run, u, { type: "shield" });
    };
    // "Always" keeps the shield up: the last action of the turn goes to it.
    if ( canShield && tactics?.shield === "always" && turn.howMany(shieldCost) === 1 ) { raiseShield(); continue; }
    // Skirmishers hit twice and keep moving instead of taking a hopeless third swing.
    if ( tactics?.style === "skirmisher" && attacksMade >= 2 && option.action.melee && turn.canAfford(basic) ) {
      if ( canShield ) raiseShield();
      else {
        turn.spend(basic);
        log(run, u, { type: "step" });
      }
      continue;
    }
    if ( !turn.canAfford(option.cost) ) {
      if ( canShield && tier >= TACTICAL.INSTINCTIVE ) { raiseShield(); continue; }
      break;
    }
    // The last action: the shield up, when what it guards against is worth more than what the action would do.
    if ( canShield && tier >= TACTICAL.COMPETENT && turn.howMany(shieldCost) === 1 && shieldWorth(run, u) > option.ev ) { raiseShield(); continue; }
    // A thinking combatant with a shield prefers defense over a hopeless third attack; sooner still when a raised
    // shield can also block (PF2e Shield Block).
    if ( canShield && tier >= TACTICAL.COMPETENT && attacksMade >= 2 ) {
      const first = expectedDamage(run, u, option.action, target, 0);
      const blocks = u.spec.reactions?.some(r => r.needsShield) && (u.reactionsLeft ?? 0) > 0;
      if ( option.ev < first * (blocks ? 0.65 : 0.3) ) { raiseShield(); continue; }
    }

    if ( option.action.drawCost && !u.drawn.has(option.action.id) ) {
      u.drawn.add(option.action.id);
      log(run, u, { type: "draw", item: option.action.name });
    }
    // Moving a mark to a new foe (Hunter's Mark) while still holding it costs no new slot.
    const holding = option.action.concentration && u.concentration?.actionId === option.action.id && holdsAnything(run, u);
    // An action that moves first (Sudden Charge): up to the foe, as part of it.
    if ( option.action.charge && option.action.melee && !u.adjacent.has(target.id) && canMove(run, u) ) {
      const move = moveToward(run, u, target, option.action.reach ?? 5, approach(run, u, target).speed * option.action.charge);
      moveLog(run, u, move, target, "approach");
    }
    if ( option.action.oncePerTurn ) (u.usedThisTurn ??= new Set()).add(option.action.id);
    executeOffense(run, u, option.action, target, attacksMade);
    settleSides(run);
    if ( option.action.concentration && u.concentration?.actionId === option.action.id ) noteConcentration(u, option.ev);
    if ( !holding || !option.action.freeWhileHeld ) spendUse(u, option.action);
    turn.spend(option.cost);
    attacksMade += attacksIn(option.action);
    u.actsThisTurn += 1;
    if ( battleOver(run) ) break;
  }

  u.turnsTaken += 1;
  run.acting = null;
  endOfTurn(run, u);
}

function endOfTurn(run, u) {
  const rules = run.prep.rules;
  // A save at the end of each of its turns may shake an effect off (5e Hold Person).
  if ( isUp(u) && u.effects?.some(e => e.repeatSave) ) {
    for ( const e of [...u.effects] ) {
      if ( !e.repeatSave ) continue;
      const s = saveRoll(run, u, e.repeatSave.type);
      const roll = rollCheck(rules, run.rng, s.mod, e.repeatSave.dc, { advantage: s.advantage, dice: s.dice, kind: "save", roller: u });
      if ( roll.degree < 2 ) continue;
      u.effects.splice(u.effects.indexOf(e), 1);
      recomputeConditions(u);
      log(run, u, {
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
      if ( run.log ) log(run, u, { type: "persistent", damageType: entry.part.type, amount });
      dealDamage(run, run.byId.get(entry.sourceId), u, amount, { types: [entry.part.type], lingering: true });
      if ( !rules.persistentFlatCheck(run.rng) ) remaining.push(entry);
    }
    u.persistent = remaining;
  }
  if ( u.afflictions.length && u.status !== STATUS.DEAD ) {
    for ( const a of [...u.afflictions] ) {
      a.rounds += 1;
      if ( a.spec.maxDuration && a.rounds >= a.spec.maxDuration ) {
        u.afflictions.splice(u.afflictions.indexOf(a), 1);
        log(run, u, { type: "afflictionEnd", name: a.spec.name });
        continue;
      }
      if ( a.onsetLeft > 0 ) {
        a.onsetLeft -= 1;
        if ( a.onsetLeft <= 0 ) applyAfflictionStage(run, u, a); // the onset is over: the first stage takes hold
        continue;
      }
      const { mod, advantage, dice } = saveRoll(run, u, a.spec.save.type);
      const roll = rollCheck(rules, run.rng, mod, a.spec.save.dc, { advantage, dice, kind: "save", roller: u });
      a.stage = Math.min(a.spec.stages.length, a.stage + afflictionStep(rules, roll.degree, "stage"));
      if ( a.stage <= 0 ) {
        u.afflictions.splice(u.afflictions.indexOf(a), 1);
        log(run, u, { type: "afflictionEnd", name: a.spec.name, natural: roll.natural, mod, total: roll.total, dc: a.spec.save.dc, degree: roll.degree });
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
function firstAid(run, u, target, { aftermath = true } = {}) {
  const rules = run.prep.rules;
  const dc = rules.firstAidDC(target);
  const check = checkRoll(run, u, u.spec.firstAid.mod, target);
  const roll = rollCheck(rules, run.rng, check.mod, dc, { advantage: check.advantage, dice: check.dice, kind: "check", roller: u, faces: u.spec.firstAid.faces });
  spendEdges(u, "check", target.id);
  const before = target.dying;
  rules.firstAid(target, roll.degree);
  log(run, u, {
    type: "firstAid", target: target.spec.name, targetId: target.id, skill: u.spec.firstAid.skill ?? null, natural: roll.natural, mod: u.spec.firstAid.mod, total: roll.total, dc,
    degree: roll.degree, before, dying: target.dying, stable: target.stable, dead: target.status === STATUS.DEAD, aftermath
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
  // (A hazard still set wins nothing: it settles nobody's fate, and makes nobody's friend a fallen foe.)
  const victors = run.units.filter(u => isStanding(u) && !u.spec.hazard);
  const fallen = run.units.filter(u => u.status === STATUS.DOWN && victors.some(v => areEnemies(run, v, u)));
  const decided = simulated && fallen.length > 0 && victors.some(v => mercyOf(run, v) !== "leave");
  // The system may give a fallen player character one last chance once friends reach the body (DCC: roll the body).
  const bodies = simulated && rules.recoverBody ? run.units.filter(u => u.status === STATUS.DEAD && u.spec.kind === "pc" && victors.some(v => v.side === u.side)) : [];
  if ( !(simulated && run.units.some(isDying)) && !decided && !bodies.length ) return;
  const rounds = run.round;
  run.round = rounds + 1; // one paragraph in the story, after the fight
  startTurn(run);
  log(run, null, { type: "aftermath", aftermath: true });
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
        const foe = !friend && mercyOf(run, u) === "spare" ? run.units.find(a => a.spared && isDying(a)) : null;
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
        if ( text ) log(run, u, { text, type: "recovery", before, dying: u.dying, dead: u.status === STATUS.DEAD, stable: u.stable, aftermath: true });
      });
    }
  }
  for ( const u of bodies ) {
    const text = rules.recoverBody(u, run.rng);
    if ( text ) log(run, u, { text, type: "body", alive: u.status !== STATUS.DEAD, aftermath: true });
    if ( u.status !== STATUS.DEAD ) tended = true;
  }
  if ( marker ) marker.tended = tended; // the story opens differently when nobody comes to help
  run.aftermathRounds = i; // (how long it took, for the GM's summary of time passed)
  run.round = rounds;
}

/**
 * What a victor does with a fallen foe once the fighting is over, by its playstyles: "spare" it (a Moralist, a Diplomat
 * most of the time, one who avoids killing as often as it holds back: decided once), "finish" it (the Cruel), or
 * "leave" it to fate.
 */
export function mercyOf(run, u) {
  const b = behaviorOf(u);
  u.sparesTheFallen ??= holdsBack(run, u);
  if ( u.sparesTheFallen || (b.spareDowned ?? 0) >= 0.5 ) return "spare";
  if ( b.finishDowned && !b.spareDowned ) return "finish";
  return "leave";
}

/** The victors settle the fallen: anyone sparing them stops the rest; otherwise the cruel finish them off. */
function dealWithTheFallen(run, victors, fallen) {
  for ( const f of fallen ) {
    // (Only its own foes: nobody finishes, or spares, a friend.)
    const sparer = victors.find(v => areEnemies(run, v, f) && mercyOf(run, v) === "spare");
    const finishers = victors.filter(v => areEnemies(run, v, f) && mercyOf(run, v) === "finish");
    if ( sparer ) {
      f.spared = true;
      if ( finishers.length ) log(run, sparer, { type: "mercy", target: f.spec.name, targetId: f.id, aftermath: true });
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
 * down, surrendered, talked down, beaten); a taker who got away keeps it.
 */
const BEATEN = new Set([STATUS.DEAD, STATUS.DOWN, STATUS.SURRENDERED, STATUS.STOOD_DOWN, STATUS.BEATEN]);
function reclaimGoods(run) {
  for ( const u of run.units ) {
    for ( const c of u.concessions ?? [] ) {
      if ( c.kept || c.returned || c.kind === "progress" ) continue; // (ground given stays given)
      const taker = run.byId.get(c.to);
      // Beaten, or caught: still under the control of the owner's side when it's over (a dominated thief).
      const holder = taker?.controlledBy ? run.byId.get(taker.controlledBy) : null;
      const caught = !!holder && (holder.homeSide ?? holder.side) === (u.homeSide ?? u.side);
      if ( !taker || !(BEATEN.has(taker.status) || caught) ) continue;
      c.returned = true;
      log(run, u, { type: "reclaim", concession: c, by: taker.spec.name, byId: taker.id, aftermath: true });
    }
  }
}

/* -------------------------------------------- */
/*  Battle                                      */
/* -------------------------------------------- */

/** Still in the fight, for its side's sake. */
function keepsSideIn(u) {
  // (A summoned thing nobody can attack, a Spiritual Weapon, doesn't keep its side in the fight; nor does anyone who
  // takes no side.)
  // (Someone who has noticed the fight and takes part next round counts: it's coming.)
  // (Nor does a troll lying there, mending: it will get back up unless someone burns it.)
  return (isStanding(u) || joining(u) || (u.held && u.status === STATUS.DOWN)) && !u.spec.untargetable && u.side !== NEUTRAL_PARTY;
}

function activeSides(run) {
  const out = [];
  for ( const u of run.units ) if ( keepsSideIn(u) && !out.includes(u.side) ) out.push(u.side);
  return out;
}

export function battleOver(run) {
  if ( run.resolved ) return true; // a standoff settled by a payment or a retreat
  // (Checked after every action: stops at the first two sides still at each other's throats.)
  const active = [];
  for ( const u of run.units ) {
    if ( !keepsSideIn(u) || active.includes(u.side) ) continue;
    for ( const s of active ) if ( run.prep.sides[s].enemies.has(u.side) ) return false;
    active.push(u.side);
  }
  // Someone who took no side, and has since turned on a side still standing, keeps the fight going.
  if ( run.neutral ) {
    for ( const u of run.units ) {
      if ( isNeutral(u) && u.against.size && isStanding(u) && !u.spec.untargetable && active.some(s => u.against.has(s)) ) return false;
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
    stamina: u.stamina,
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
    against: [...(u.against ?? [])], // (someone who took no side: the sides it turned on)
    concessions: (u.concessions ?? []).map(c => ({ ...c })), // what they gave up when talked into it (Make it So hands it over)
    side: u.homeSide ?? u.side,
    ambitionDropped: !!u.ambitionGone, // (it changed sides: wanting to lead goes, on the character too)
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
    if ( u.summoner ) continue; // summoned for this fight alone: not the table's
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
  // (Talks that collapsed came to no blows, but settled nothing.)
  const collapsed = run.resolved?.outcome === "collapsed";
  return { outcome, winners, rounds: run.round, aftermathRounds: run.aftermathRounds ?? 0, firstFallen: run.firstFallen, peaceful: ended && !run.blood && !collapsed,
    collapsed, units, doors, log: run.log };
}

/**
 * A creature fighting on for a last turn or so before it dies (rules.onDropped's `lastStand: {turns, label}`:
 * Daggerheart's Blaze of Glory): when its turns are spent, it dies.
 */
function endLastStand(run, u) {
  if ( u.status !== STATUS.STANDING ) {
    u.lastStand = null;
    return;
  }
  u.lastStand.turns -= 1;
  if ( u.lastStand.turns > 0 ) return;
  const label = u.lastStand.label ?? "";
  u.lastStand = null;
  u.status = STATUS.DEAD;
  u.hp = Math.min(0, u.hp);
  u.fellRound ??= run.round;
  run.firstFallen ??= u.id;
  releaseGrabs(run, u);
  log(run, u, { type: "death", lastStand: label, by: null, byId: null, finished: true });
  fell(run, u, null);
}

/** Simulate a single battle. */
export function runOne(prep, seed, { log: withLog = false, capture = false } = {}) {
  const run = createRun(prep);
  run.rng = createRng(seed);
  for ( const u of run.units ) initDesires(u);
  refreshLeans(run); // which way those who take no side lean
  prep.doors ??= prepareDoors(prep.spec, prep.rules);
  run.doors = doorStates(prep);
  // Each simulated fight decides which stated preferences win out (see "stay mostly true").
  for ( const u of run.units ) {
    u.tac = sampleRunTactics(u.spec, run.rng);
    u.hunts = u.tac?.beyond === "hunt";
  }
  // The system's own state for the fight (Daggerheart: the GM's Fear).
  prep.rules.initRun?.(run);
  if ( withLog ) run.log = [];
  // Trap avoiders: the hazards they spot (behavior/traps.js), kept clear of as they move.
  run.trapLog = logger(run);
  spotTraps(run, run.trapLog);
  const order = rollInitiative(run);
  // A simple hazard goes off first: it's what set things off, while whoever set it off is still there.
  order.sort((a, b) => (b.spec.hazard?.once ? 1 : 0) - (a.spec.hazard?.once ? 1 : 0));
  run.order = order; // (summoned creatures join it, right after their summoner)
  if ( withLog ) {
    const fighters = order.filter(u => u.active);
    log(run, null, { type: "initiative", order: fighters.map(u => u.spec.name) });
  }
  // Words before weapons, when the sides would rather talk (or the GM says so).
  run.standoff = opensWithTalk(run);
  if ( run.standoff ) log(run, null, { type: "standoff" });

  const surpriseSide = prep.options.surpriseSide;
  if ( surpriseSide ) {
    run.round = 0;
    log(run, null, { type: "surprise", sideLabel: prep.sides[surpriseSide]?.label ?? surpriseSide });
    for ( const u of order ) {
      if ( u.side !== surpriseSide ) continue;
      startTurn(run, u);
      takeTurn(run, u);
    }
  }
  let ended = battleOver(run);
  noteCommand(run, true);
  for ( let round = 1; !ended && round <= prep.options.maxRounds; round++ ) {
    run.round = round;
    refreshLeans(run); // (the underdog changes as the fight goes)
    // (Who acts, and when: the initiative order, or the system's own way of passing the turn: Daggerheart's spotlight.)
    for ( const u of prep.rules.roundTurns ? prep.rules.roundTurns(run, order) : order ) {
      noteCommand(run);
      startTurn(run, u);
      takeTurn(run, u);
      if ( u.lastStand ) endLastStand(run, u);
      if ( battleOver(run) ) { ended = true; break; }
      if ( run.legendary ) {
        legendaryMoment(run, u);
        if ( battleOver(run) ) { ended = true; break; }
      }
    }
  }
  // Who won is decided when the last blow lands (or the deal is struck); the aftermath only settles the fallen.
  // (Talks that collapsed: nobody's.)
  const winners = !ended ? [] : run.resolved ? [run.resolved.side].filter(Boolean) : activeSides(run);
  if ( withLog ) {
    startTurn(run);
    const labels = winners.map(s => prep.sides[s]?.label ?? s);
    log(run, null, {
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
export async function runBatch(spec, rules, { runs = 2000, seed = randomSeed(), onProgress, signal, maxMs = null } = {}) {
  const prep = prepareBattle(spec, rules);
  const agg = createAggregator(prep);
  // (`maxMs`: fights until the time is up, `runs` at most. No fight is started once it's up; the one under way is
  // finished. There's always one. The time is the time spent on it: a pause to let the browser draw counts, but only so
  // much of one, since a browser tab in the background makes each pause last a second.)
  let spent = 0;
  let sliceStart = performance.now();
  for ( let i = 0; i < runs; i++ ) {
    if ( maxMs && i > 0 && spent + performance.now() - sliceStart >= maxMs ) break;
    const runSeed = deriveSeed(seed, i);
    agg.add(runOne(prep, runSeed), runSeed);
    if ( performance.now() - sliceStart > SLICE_MS ) {
      spent += performance.now() - sliceStart;
      onProgress?.(maxMs ? Math.min(1, spent / maxMs) : (i + 1) / runs);
      const paused = performance.now();
      await new Promise(resolve => setTimeout(resolve, 0));
      spent += Math.min(PAUSE_MS, performance.now() - paused);
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

export { prepareBattle };
