/**
 * Round-by-round battle simulation. Pure: give it a BattleSpec and a rules object, get statistics back.
 *
 * Every logged event carries structured data (type, rolls, margins, damage types, movement) so the story
 * writer can narrate it at any level of detail.
 */
import { STATUS, TACTICAL, DOWNED_MODELS, AFTERMATH, EXECUTE_LUCK, NEUTRAL_PARTY, OPENING, clamp } from "../constants.js";
import { createRng, deriveSeed, randomSeed } from "./rng.js";
import { sampleDamage, samplePart, meanPart, part, addTo } from "./dice.js";
import { diceAt, tableRoll, recordingRng, rollsWaiting, markRerolled, pendingRolls, markShown } from "./table-rolls.js";
import { rollCheck, regrade } from "./probability.js";
import { costOf, mainPool } from "./turn.js";
import {
  prepareBattle, createRun, isStanding, isUp, enemiesOf, alliesOf, areEnemies, liveTier, liveTrait, currentAc,
  attackRoll, attackOptions, saveRoll, checkRoll, turnFor, moveToward, moveAway, bonusDamageParts,
  behaviorOf, edgeDistance, coverOf, inArea, movesNeeded, approach, canMove, moveTowardPoint, isMagical, upgradesSave, boostBonus, typical, sortOf, sizedUp, passedOver,
  command, commandOf, heldOff, holdsBack, wish, groupKeyOf, chainOf, canCommand, regenOf, canHeal, systemRolled
} from "./battle-state.js";
import { sampleRunTactics } from "./playstyles.js";
import { chooseTarget, bestOptionVs, scoreTargets } from "./behavior/targeting.js";
import { decideHeal, rescueOption, healScores } from "./behavior/healing.js";
import { initDesires, newTurn, goaded, think, want, thwart, relieve, levelOf, mind, rankedDesires, orderAgenda, thoughts as thoughtsOf, levelsFromScores, listen, heed, remember, styleWants, styleOf, follow, conditionWishes, holdWishes, puppetWishes, actsHeld, scheme, partyWants, CHOICE_LEVEL } from "./behavior/desire.js";
import { prepareDoors, doorStates, doorAhead, atDoor, doorPlan, patienceFor, doorDamage } from "./behavior/doors.js";
import { heldGoal } from "./behavior/goals.js";
import { checkMorale, standsGround, callRetreat, rallies, MORALE } from "./behavior/morale.js";
import { expectedDamage, spendUse, spendAmmo, hasUses, attacksIn, criticalParts, saveMultiplier, saveMultiplierFor, meanDamageVs, unitsPerTurn, iwrContext, critDoubles } from "./behavior/evaluate.js";
import { chooseDeed, deedTier, chooseHitRiders, rescueMiss, rollCrit, rollFumble, rallied } from "./behavior/riders.js";
import { cast } from "./behavior/casting.js";
import { boost } from "./behavior/luck.js";
import { respond, riposteStrike, bestStep, strikeBack } from "./behavior/responses.js";
import { playEffects, hasEffects, wouldPlay } from "./behavior/reaction-effects.js";
import { decideSummon, callSummons, sustainSummons, summonState, dismiss } from "./behavior/summons.js";
import { sinkHopeless } from "./behavior/hopeless.js";
import { focusWants, focusAgenda } from "./behavior/focus.js";
import { keepTogether } from "./behavior/together.js";
import { mayLeave, startLeaving, isLeaving, wayOff, goAlong, confronted, dealsWithIt, backOnItsWay } from "./behavior/leaving.js";
import { createAggregator } from "./aggregate.js";
import { spotTraps, stepOut, learnTrap } from "./behavior/traps.js";
import { talkActionsThisTurn, choosePitch, attemptTalk, shareLanguage, resolveTalk, aimOf } from "./behavior/talk.js";
import { opensWithTalk, breaksStandoff, standoffPitches, charismaticLeader, canTalk, prefersTalk } from "./behavior/standoff.js";
import { controlOutcome, controlRoll, isImmune, degreeShift } from "./behavior/control.js";
import { recompute as recomputeConditions, applyOutcome, renewHolds, beginConcentration, endConcentration, holdsAnything, noteConcentration, moveHeld, settleAllegiance, iwrOf, incoming, spendEdges, spendBoost, focusOf, tauntProof, withoutTaunt } from "./behavior/effects.js";
import { decideBuff, aidScores, checkDc } from "./behavior/support.js";
import { perceives } from "./behavior/senses.js";
import { isAnimalistic, animalTactics } from "./behavior/animal.js";
import { stealChance, theftTarget, theftPlan, attemptTheft, robbable } from "./behavior/theft.js";
import { fallenWishes, decideFallen, bind, rob, stayBound, takesPrisoners, robsTheFallen, freeFriend, rollOf } from "./behavior/fallen.js";
import { holdsOf, ownHolds, known, tryHold, release, escapeCost, isBound, remediesOf, bears } from "./behavior/holds.js";
import { forcedPath, fallDamage, resettle } from "./behavior/forced.js";
import { stepOf, stacks, stageRounds, stageMove } from "./behavior/afflictions.js";
import { setConditionValue, layerOf, toughSave, healedOf, harmEnds, letGo, holderOf, cutOff, harmParts } from "./behavior/troubles.js";
import { profiled, hasTrait, barred } from "./conditions.js";
import { reactionsPerRound, threats, takesSafeWay, spendOwnStrike, hasMoveStrikers } from "./behavior/reactions.js";
import { isNeutral, crossed, caughtInArea, refreshLeans, truceWith, truceBreaks, turnOn, settleTruce, peaceDesires, seemsFoe, meddling, inFray, fighting, dislikesViolence, annoyedBy, ANNOYED } from "./behavior/neutral.js";
import { normalizeCost } from "./turn.js";
import { resolveSurprise } from "./behavior/surprise.js";
import { auraMoved, auraTurnStart } from "./behavior/auras.js";
import { localize } from "../i18n.js";
import { maneuverOf, answersTo } from "../story/master.js";
import { meets, noteBlow, freshTurn, setupUsed } from "./behavior/requires.js";
import { withManeuver } from "./maneuvers.js";
import { readyNow, gearStep, takeGearStep, spareBest, spareTurn, healAhead, tellStep, bestSpot, PREP } from "./behavior/prepare.js";
import { mayPatrol, patrolTurn, fidget } from "./behavior/patrol.js";
import { used } from "./gear.js";

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
 * Returns the entry (null while nothing's logged), for what's known of it only later (noteHp).
 */
export function log(run, u, data = {}) {
  if ( !run.log ) return null;
  const entry = {
    round: run.round, turn: run.turn ?? 0, turnOf: run.turnOf ?? null, actor: u?.spec.name ?? "", actorId: u?.id ?? null, side: u?.side ?? null,
    type: data.type ?? "note", ...data
  };
  run.log.push(entry);
  return entry;
}

/**
 * A new turn in the log: what follows is u's turn (or, with no u, the fight's own moment: its end, the aftermath),
 * until the next. Whatever happens meanwhile, others' reactions and falls too, is told with it.
 */
export function startTurn(run, u = null) {
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

/** What an aura's save needs of the simulation (behavior/auras.js). */
const AURA_PLAY = Object.freeze({ rollSave, rollHit, appliedLive, landOutcome, testConcentration, log });

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

/**
 * A save the target makes, with Luck burned on it if it falls short and someone will. The rules hear what it's against
 * (`action`) and who set it off (`from`): a stupefied caster's spell, a flat check the caster must make (PF2e's).
 */
function rollSave(run, target, type, dc, { stakes = 0.3, label = "", magical = false, from = null, action = null } = {}) {
  const rules = run.prep.rules;
  const s = saveRoll(run, target, type, { magical, from, action });
  // (A live battle's, the system's own roll where it makes saves: systemRolled. Its card says how it went; no Luck or
  // momentum after it.)
  const rolled = systemRolled(run, target, "save", { dc, from, save: type, action, label, advantage: s.advantage });
  let roll = rollCheck(rules, run.rng, s.mod, dc, {
    advantage: s.advantage, dice: s.dice, kind: "save", roller: target, rolled, label: label || action?.name || "", target: from,
    actionId: action?.id ?? null, stat: typeof type === "string" ? type : null
  });
  spendEdges(target, "save");
  if ( run.boosting && roll.degree < 2 && !rolled ) roll = boost(run, target, roll, dc, { kind: "save", stakes }, logger(run));
  roll = standFirm(run, target, roll, dc, stakes, label);
  if ( roll.degree === 2 && upgradesSave(target, type) ) roll = { ...roll, degree: 3 };
  // (The system's say after the dice, told whether they were the system's own (`rolled`): a flat check still stands,
  // luck or momentum is no one's to spend on a card already shown.)
  if ( rules.adjustRoll ) {
    roll = rules.adjustRoll(run, target, roll, { kind: "save", stakes, label, action, from, rolled: !!rolled }) ?? roll;
    if ( roll.said ) log(run, target, { text: roll.said.text, type: "adjust", ...roll.said.data });
  }
  rules.afterRoll?.(run, target, roll, { kind: "save", type, faces: 20, action, from });
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

/* -------------------------------------------- */
/*  Initiative                                  */
/* -------------------------------------------- */

function rollInitiative(run) {
  const { options } = run.prep;
  // (Surprise: sides sneaking up roll Stealth; the surprised, in some systems, roll at a disadvantage: behavior/surprise.js.)
  const stealthSides = new Set(run.surprise?.stealthSides ?? []);
  const disadvantage = new Set(run.surprise?.disadvantage ?? []);
  const fixed = options.initiativeOrder ?? null;
  const rolled = new Map();
  for ( const u of run.units ) {
    const init = u.spec.initiative ?? { mod: 0 };
    let mod = stealthSides.has(u.side) ? (init.stealth ?? init.mod ?? 0) : (init.mod ?? 0);
    // (Keeping out of sight on the way in, where the system rolls Stealth for it: PF2e's Avoid Notice.)
    if ( run.prep.rules.stealthInitiative && (behaviorOf(u).lowProfile ?? 0) > 0 && Number.isFinite(init.stealth) ) mod = Math.max(mod, init.stealth);
    mod += behaviorOf(u).initiative ?? 0; // Instigators jump in first
    if ( liveTier(run, u) >= TACTICAL.MASTERMIND ) mod += 2; // ambush instincts
    // (A die of the system's own: DCC's d16 for a two-handed weapon. Surprised, where it costs that: the lower of two.)
    let die = run.rng.die(init.die ?? 20);
    if ( disadvantage.has(u.id) ) die = Math.min(die, run.rng.die(init.die ?? 20));
    rolled.set(u.id, die + mod + run.rng.next() * 0.01);
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
 * How hard a fight is to miss, seen, on the radar, felt or smelled (heard: harder with distance and walls, as the
 * awareness has it).
 */
const NOTICE_DC = Object.freeze({ sight: 5, radar: 5, feel: 8, smell: 10 });

/**
 * Could bystander b notice combatant c this round? Uses precomputed sight, radar (tech sensing), feel (its other
 * senses), smell and sound (walls muffle): the easiest of them.
 * @returns {{dc: number, sense: "sight"|"radar"|"feel"|"smell"|"sound"}|null}
 */
function cueFrom(run, b, c) {
  const aw = run.prep.spec.awareness?.[b.id]?.[c.id];
  if ( !aw ) return run.prep.spec.awareness ? null : { dc: 10, sense: "sound" };
  const cues = [
    aw.see && { dc: NOTICE_DC.sight, sense: "sight" },
    aw.radar && { dc: NOTICE_DC.radar, sense: "radar" },
    aw.feel && { dc: NOTICE_DC.feel, sense: "feel" },
    aw.smell && { dc: NOTICE_DC.smell, sense: "smell" },
    Number.isFinite(aw.hearDC) && { dc: aw.hearDC, sense: "sound" }
  ].filter(Boolean);
  return cues.reduce((best, cue) => (!best || cue.dc < best.dc ? cue : best), null);
}

/**
 * b, on the map but not in the encounter, becomes aware of the conflict. It takes its turns from the next round, as
 * if it had been in the encounter all along (its side, its desires and its nerve decide what it does then; someone
 * taking no side starts weighing what it wants). Set upon, it's in the fight at once.
 */
export function notice(run, b, cause, source) {
  if ( b.spec.hazard ) return; // (a hazard notices nothing)
  if ( b.aware && cause !== "attacked" ) return; // (it already knows; it's on its way)
  b.aware = true;
  // During a standoff there is no fighting to see or hear, only a tense crowd and raised voices.
  if ( run.standoff && ["sight", "sound", "smell", "feel", "radar"].includes(cause) ) cause = "standoff";
  log(run, b, { type: "notice", cause, by: source?.spec.name ?? null, byId: source?.id ?? null });
  if ( cause === "attacked" ) return join(run, b, "forced");
  b.joinsRound ??= run.round + 1;
  b.joinCause = cause;
}

/**
 * A group's leaders and its people. Word reaches a leader whose own people are in the fight: it notices it the more
 * readily (KIN_BONUS on its check), and even out of sight and earshot (as a cue as hard to miss as KIN_DC). One who
 * takes no side takes up its people's quarrel, now and then (KIN_QUARREL, its loyalty raising it). And a leader in the
 * fight calls in its people who aren't: they hear, and come.
 */
const KIN_BONUS = 5;
const KIN_DC = 12;
const KIN_QUARREL = Object.freeze({ base: 0.2, loyal: 0.5 });

/** Is u one of its group's chain of command (its boss, its leader or a lieutenant)? */
function leadsGroup(run, u) {
  const key = groupKeyOf(u);
  return !!key && (chainOf(run, key) ?? []).some(c => c.id === u.id);
}

/** Is u in the fight (not yet to notice it, nor taking no side and turned on no one)? */
const inFight = u => u.active && isStanding(u) && (!isNeutral(u) || u.against.size > 0);

/** One of u's group in the fight, or null. */
function kinInFight(run, u) {
  const key = groupKeyOf(u);
  return key ? run.units.find(o => o !== u && groupKeyOf(o) === key && inFight(o)) ?? null : null;
}

/** How readily u takes up its people's quarrel (or answers its leader's call to arms) when it takes no side. */
const quarrelChance = (run, u) => clamp(KIN_QUARREL.base + KIN_QUARREL.loyal * liveTrait(run, u, "loyal") / 100, 0, 1);

/**
 * u takes no side but leads its people, and one of them is in the fight: it may take up their quarrel (turning on the
 * side they fight). True if it did.
 */
export function kinsQuarrel(run, u, say) {
  if ( !isNeutral(u) || u.against.size || !leadsGroup(run, u) ) return false;
  const kin = kinInFight(run, u);
  if ( !kin || !run.rng.chance(quarrelChance(run, u)) ) return false;
  const side = [...kin.against][0];
  const foe = run.units.find(o => o.side === side && isStanding(o));
  if ( !foe ) return false;
  turnOn(run, u, foe, "kin", say, kin);
  return true;
}

/**
 * A leader in the fight calls in its people who aren't: those yet to notice it who can see or hear it (they come
 * next round), and those who take no side and are only watching (they may take up its quarrel). An action, and each
 * is called once.
 */
function callToArms(run, u, turn, cost) {
  if ( !inFight(u) || !leadsGroup(run, u) || !canCommand(u) || !turn.canAfford(cost) ) return;
  const key = groupKeyOf(u);
  // (Up, whether in the fight yet or not: isStanding counts only those in it.)
  const out = run.units.filter(o => o !== u && groupKeyOf(o) === key && isUp(o) && !o.calledToArms
    && ((!o.active && !o.aware && cueFrom(run, o, u)) || (o.active && isNeutral(o) && !o.against.size)));
  if ( !out.length ) return;
  turn.spend(cost);
  for ( const o of out ) o.calledToArms = true;
  log(run, u, { type: "callToArms", targets: out.map(o => o.spec.name), targetIds: out.map(o => o.id) });
  const say = logger(run);
  for ( const o of out ) {
    if ( !o.active ) notice(run, o, "help", u);
    else if ( run.rng.chance(quarrelChance(run, o)) ) {
      const foe = enemiesOf(run, u).find(isStanding);
      if ( foe ) turnOn(run, o, foe, "kin", say, u);
    }
  }
}

/**
 * Lazy: a creature able to act that does nothing on its turn, knowingly. Either it slacks off (behaviorOf(u).slacks:
 * the Lazy playstyle's chance, with no foe beside it and its wounds not pressing), or nothing it could do was worth it
 * (the engine found nothing): either way the story says so. Not one that couldn't act: that has its own reasons.
 */
const CANT_ACT = new Set(["incapacitated", "controlled", "unconscious", "paralyzed", "stunned", "confused", "fleeing", "petrified", "dazed"]);

const ableToAct = (run, u) => {
  for ( const k in u.conds ?? {} ) if ( u.conds[k] > 0 && CANT_ACT.has(k) ) return false;
  if ( barred(u, "act") ) return false;
  return (run.prep.rules.modifiers?.actionsLost?.(u) ?? 0) < 3;
};

function slacksOff(run, u) {
  const chance = behaviorOf(u).slacks;
  if ( !(chance > 0) || !inFight(u) || !ableToAct(run, u) ) return false;
  if ( u.maxHp > 0 && u.hp / u.maxHp < 0.5 ) return false;
  if ( enemiesOf(run, u).some(o => isStanding(o) && (edgeDistance(u, o) ?? Infinity) <= 5) ) return false;
  return run.rng.chance(chance);
}

/** After a turn: one able to act that did nothing in it (nothing logged of its own) was lazy. */
export function noteIdle(run, u) {
  if ( !run.log || !inFight(u) || u.spec.hazard || u.summoner || !ableToAct(run, u) ) return;
  // (This turn's entries are the log's last: read back to where it began.)
  for ( let i = run.log.length - 1; i >= 0; i-- ) {
    const e = run.log[i];
    if ( e.turn < run.turn ) break;
    if ( e.turn === run.turn && e.actorId === u.id && e.type !== "thought" ) return;
  }
  log(run, u, { type: "lazy" });
}

/**
 * After a turn in a live battle: one on its feet that isn't part of the fight (it hasn't noticed it, has only just,
 * or takes no side and has turned on no one) and did nothing in it keeps out of it, told, so the table sees its turn
 * went by. Only in a live battle, where the tracker gives it a turn: a simulated fight tells no turn it doesn't take.
 */
export function noteAside(run, u) {
  if ( !run.live || !run.log || u.status !== STATUS.STANDING || u.spec.hazard || inFight(u) ) return;
  for ( let i = run.log.length - 1; i >= 0; i-- ) {
    const e = run.log[i];
    if ( e.turn < run.turn ) break;
    if ( e.turn === run.turn && e.actorId === u.id && e.type !== "thought" ) return;
  }
  log(run, u, { type: "aside" });
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
export function lookAround(run, b) {
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
  // A leader whose own people are in the fight hears of it, even out of sight and earshot, and looks the harder.
  const kin = leadsGroup(run, b) ? kinInFight(run, b) : null;
  if ( kin && (!best || best.cue.dc > KIN_DC) ) best = { cue: { dc: KIN_DC, sense: "help" }, c: kin };
  if ( !best ) return false;
  const perception = (b.spec.perception ?? b.spec.initiative?.mod ?? 0) + (kin ? KIN_BONUS : 0);
  const check = checkRoll(run, b, perception, null, { purpose: "notice", skill: "perception" });
  // (FastFighting's own reckoning of who notices the fight, not a roll the table makes: never shown.)
  const roll = rollCheck(run.prep.rules, run.rng, check.mod, best.cue.dc, { advantage: check.advantage, kind: "check", roller: b, quiet: true });
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

/**
 * What harm undoes before it lands: a troll's regeneration stopped by acid or fire (for its next turn), a sleeper
 * woken by a blow, a charm broken when its caster's side does the harm.
 */
export function breakOnHarm(run, source, target, types = null) {
  const regen = regenOf(target);
  if ( regen?.stoppedBy?.length && types?.some(t => regen.stoppedBy.includes(t)) ) target.regenStopped = true;
  if ( target.effects?.some(e => e.endsOnDamage || e.endsOnHarm) ) {
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
  // (The core's own: fascinated, by any harm; charmed, by its charmer's side's.)
  if ( harmEnds(run, source, target).length ) settleSides(run);
}

/**
 * What being hurt by someone sets going, apart from the hit points (which the blow, or in a live battle the sheet,
 * already took): it's being hurt now; who did it is someone to pay back, the more so in a thinking creature, unless
 * it's already trading blows with someone in front of it; and blood spilled ends a standoff's patience.
 */
export function noteHarm(run, source, target, harm) {
  target.hurtSinceTurn = true; // (being hurt, whoever or whatever it is: "always talk unless I'm being hurt")
  if ( !source ) return;
  source.damageDealt += harm;
  target.harmedBy.set(source.id, (target.harmedBy.get(source.id) ?? 0) + harm);
  if ( run.standoff ) bloodInStandoff(run, source, target);
  if ( areEnemies(run, source, target) ) {
    // Hit from afar while already trading blows with someone: keep at the one in front of it.
    const busy = !target.adjacent.has(source.id) && [...target.adjacent].some(id => { const o = run.byId.get(id); return o && isStanding(o) && areEnemies(run, target, o); });
    want(target, "hurt", source.id, (busy ? 3 : (HIT_URGE[liveTier(run, target)] ?? 5)) * styleOf(target).retaliate);
  }
}

/**
 * Someone fallen (down, dead or beaten, as the system has it already): when and by whom, its grabs let go, its
 * friends who see it want the one who did it, the fall is told, and the system says what it sets off.
 */
export function noteFall(run, target, source, action = null) {
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
  deathThroes(run, target, source, action);
}

/**
 * A harm event's hit points, for the story's health callouts (story/health.js): the one harmed's before the harm and
 * after it, and its most (hpBefore, hpAfter, maxHp), on its log entry. Only where the harm left it lower and still up:
 * a fall is told by its own event. Harm in several parts (a maneuver's own damage, then its action's) keeps the first
 * part's before.
 */
export function noteHp(entry, t, before) {
  if ( !entry || !t || t.status !== STATUS.STANDING || !(t.hp > 0) || !(t.hp < before) ) return;
  entry.hpBefore ??= before;
  entry.hpAfter = t.hp;
  entry.maxHp = t.maxHp;
}

/** `entry`: the harm's log entry, told the hit points it left (noteHp). */
function dealDamage(run, source, target, amount, { crit = false, types = null, byType = null, action = null, lingering = false, entry = null } = {}) {
  if ( amount <= 0 || target.status === STATUS.DEAD || target.status === STATUS.FLED ) return;
  // (Out of reach of all harm: in stasis, banished.)
  if ( hasTrait(target, "untouchable") ) return;
  breakOnHarm(run, source, target, types);
  const rules = run.prep.rules;
  const model = run.prep.options.downedModel;
  const before = target.hp;
  if ( target.status === STATUS.STANDING ) {
    // Temporary hit points go first, then stamina, then hit points.
    const absorbed = Math.min(target.temp, amount);
    target.temp -= absorbed;
    const winded = Math.min(target.stamina ?? 0, amount - absorbed);
    if ( winded ) target.stamina -= winded;
    const rest = amount - absorbed - winded;
    const dealt = Math.min(rest, target.hp);
    target.hp -= rest;
    if ( target.hp <= 0 && holdsOn(run, target, rest, crit, types) ) target.hp = 1;
    else if ( target.hp <= 0 ) clingsOn(run, target, source, action, rest, crit, types);
    noteHarm(run, source, target, dealt + absorbed + winded);
    if ( target.hp <= 0 ) {
      target.hp = 0;
      target.wasDowned = true;
      rules.onDropped(target, { crit, model, amount: rest, overflow: Math.max(0, rest - dealt), rng: run.rng });
      if ( target.status === STATUS.DEAD && (holdsBack(run, source) || pullsBlow(run, source, action)) ) knockOut(run, target);
      killsBeaten(run, source, target);
      regenerating(target);
    }
    // (Still up at 0, by the system's rules: Ironsworn characters fight on at 0 health.)
    if ( target.hp <= 0 && target.status !== STATUS.STANDING ) noteFall(run, target, source, action);
    // One track for many (Ironsworn's encounter objective, every foe part of it): what one takes, all of them take.
    if ( sharedOf(target) ) shareHarm(run, source, target);
    testConcentration(run, target, rest + absorbed);
    // What being hurt sets off, by the system (Ironsworn: Endure Harm, a roll to shake it off or lose heart), told who
    // did it and with what (PF2e: a blow from inside that ruptures its gullet).
    if ( rules.afterHarm && target.status !== STATUS.DEAD ) {
      const up = target.status === STATUS.STANDING;
      const said = rules.afterHarm(run, target, rest + absorbed, run.rng, { by: source, types, byType, action, crit, lingering });
      if ( said?.text ) log(run, target, { text: said.text, type: "endure", ...said.data });
      // (Taken out by it: the fall counts like any other.)
      if ( up && target.status !== STATUS.STANDING ) {
        target.wasDowned = true;
        target.fellRound ??= run.round;
        target.killerId = source?.id ?? target.killerId ?? null;
        run.firstFallen ??= target.id;
        releaseGrabs(run, target);
        fell(run, target, source);
        deathThroes(run, target, source, action);
      }
    }
    // Someone taking no side who was hurt, or who saw someone it wants safe hurt, takes note.
    if ( run.neutral && source ) crossed(run, source, target, "harm", 0.5 + Math.min(1.5, 3 * (dealt + absorbed) / Math.max(1, target.maxHp)) + (target.hp <= 0 ? 1 : 0), logger(run));
    noteHp(entry, target, before);
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
 * What a system's recovery check said, for the log: its words; whether it came back on its feet (5e's natural 20); and,
 * where the system says, whether the roll went its way (`better`: a 5e death save made doesn't lower its dying, so
 * that alone can't tell). rules.recoveryCheck returns its words, or {text, better}.
 */
function recoveryOf(said, u) {
  const text = said && typeof said === "object" ? said.text : said;
  if ( !text ) return null;
  const out = { text };
  if ( u.status === STATUS.STANDING ) out.revived = true;
  if ( said && typeof said === "object" && typeof said.better === "boolean" ) out.better = said.better;
  return out;
}

/**
 * A system's recovery check (rules.recoveryCheck: PF2e's flat check, 5e's death save), its words. In a live battle its
 * dice are a table roll: the helper's own (rng.record, with its DC), else shown plainly here.
 */
function recoveryCheck(run, u) {
  const at = diceAt(run);
  const said = run.prep.rules.recoveryCheck(u, run.rng);
  if ( at >= 0 ) tableRoll(run, at, { by: u, kind: "flat", what: "recovery", each: true });
  return said;
}

/** Persistent harm's end (rules.persistentFlatCheck: PF2e's DC 15 flat check), shown as recoveryCheck's is. */
function persistentEnds(run, u, type) {
  const at = diceAt(run);
  const ends = run.prep.rules.persistentFlatCheck(run.rng, { run, unit: u, type });
  if ( at >= 0 ) tableRoll(run, at, { by: u, kind: "flat", what: "persistentEnd", each: true });
  return ends;
}

/** What a reaction takes off a blow (its `reduce`: 5e Deflect Missiles, PF2e Shield Block's hardness), as rolled. */
function reduced(run, who, r, by) {
  const at = diceAt(run);
  const amount = samplePart(r.reduce, run.rng);
  if ( at >= 0 ) tableRoll(run, at, { by: who, target: by, kind: "other", what: "reduce", label: r.label ?? "", parts: [r.reduce] });
  return amount;
}

/**
 * A blow that would drop it, a reaction may keep it up (PF2e Orc Ferocity, 5e Relentless Endurance: stayUp {hp,
 * wounded}): at that many hit points (1), wounded the more.
 */
function clingsOn(run, u, by, action, amount, crit, types) {
  if ( !u.spec.reactions?.some(r => answersTo(r, "wouldDrop")) ) return;
  const ctx = { by, action, damage: amount, crit, types };
  const r = respond(run, u, "wouldDrop", ctx);
  if ( !r?.stayUp ) return;
  u.hp = Math.max(1, Number(r.stayUp.hp) || 1);
  if ( Number(r.stayUp.wounded) > 0 ) u.wounded = (u.wounded ?? 0) + Number(r.stayUp.wounded);
  logReaction(run, u, by ?? u, r, "wouldDrop");
  // (And whatever else it does, standing again: reaction-effects.js.)
  playEffects(run, u, r, "wouldDrop", ctx, KIT);
}

/**
 * Taken out, it may answer on its way down (5e Death Burst: areaBurst {damage, save, range}, at everyone within
 * range, a save for half; a last strike or harm at the one who felled it: reaction-effects.js). Once.
 */
function deathThroes(run, u, by, action = null) {
  if ( u.throes || !u.spec.reactions?.some(r => answersTo(r, "slain")) ) return;
  u.throes = true;
  const ctx = { by, action };
  const r = respond(run, u, "slain", ctx);
  if ( !r || !wouldPlay(run, u, r, "slain", ctx) ) return;
  logReaction(run, u, by ?? u, r, "slain");
  playEffects(run, u, r, "slain", ctx, KIT);
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
  // (Not one that only regenerates with at least 1 hit point: at 0 it's simply dead. Nor one whose wounds won't close.)
  const regen = regenOf(u);
  if ( u.status === STATUS.DEAD && regen && !regen.needsHp && !u.regenStopped && canHeal(u) ) {
    u.status = STATUS.DOWN;
    u.held = true; // (by its regeneration, not by its dying)
  }
}

/**
 * Start of its turn: regeneration (spec.regen {amount, stoppedBy}: not this turn if it took one of those damage types
 * since its last; a creature down at 0 that can't regenerate dies, if 0 is death for it) and fast healing
 * (spec.fastHealing); its own, or lent by an effect (effects.js fastHealing, regen), the better of each. Not while its
 * wounds won't close (unhealable).
 */
function regenerate(run, u) {
  const regen = regenOf(u);
  const fast = Math.max(Number(u.spec.fastHealing) || 0, Number(u.fxHealing) || 0);
  if ( (!regen && !fast) || [STATUS.DEAD, STATUS.FLED].includes(u.status) ) return;
  // (Wounds that won't close: as if fire or acid had stopped it.)
  const stopped = !!u.regenStopped || !canHeal(u);
  u.regenStopped = false;
  if ( u.status === STATUS.DOWN && u.held && stopped ) {
    if ( u.spec.diesAtZero ) {
      u.status = STATUS.DEAD;
      log(run, u, { type: "death", regen: true });
      return;
    }
    u.held = false; // (from here on, the system's dying rules)
  }
  const amount = canHeal(u) ? fast + (regen && !stopped && !(regen.needsHp && u.hp <= 0) ? regen.amount : 0) : 0;
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
  // (In its gullet, in its body: out again.)
  for ( const { u: o, key } of letGo(run, u) ) log(run, o, { type: "letGo", hold: key, by: u.spec.name, byId: u.id });
}

/**
 * Those held inside another (swallowed, engulfed: behavior/troubles.js holderOf) are where it is, gone where it went,
 * and beside it; its grab on one is over, what holds it now being its gullet or its body.
 */
export function carryInside(run) {
  for ( const u of run.units ) {
    const holder = holderOf(run, u);
    if ( !holder ) continue;
    if ( holder.pos && u.pos && (u.pos.x !== holder.pos.x || u.pos.y !== holder.pos.y) ) {
      u.pos = { x: holder.pos.x, y: holder.pos.y };
      run.geo = (run.geo ?? 0) + 1; // (someone has moved)
    }
    if ( u.grabbedBy === holder.id ) release(run, u, { key: "grabbed", byId: holder.id });
    u.adjacent.add(holder.id);
    holder.adjacent.add(u.id);
  }
}

/** Charmed and dominated creatures change sides as their holds take and end: tell it. */
export function settleSides(run) {
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
    const rolled = systemRolled(run, u, "save", { dc, save: c.save ?? "con", action: { id: u.concentration.actionId, name: u.concentration.name }, advantage: s.advantage });
    roll = { ...rollCheck(run.prep.rules, run.rng, s.mod, dc, { advantage: s.advantage, dice: s.dice, kind: "save", roller: u, rolled, label: u.concentration.name ?? "", what: "concentration" }), mod: s.mod };
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
  const at = diceAt(run);
  const rolled = sampleDamage(stage.damage, run.rng);
  const shown = at >= 0 ? tableRoll(run, at, { by: target, target, kind: "damage", label: affliction.spec.name ?? "", what: "affliction", parts: stage.damage }) : null;
  const amount = landsRolled(run, null, target, shown, run.prep.rules.applyIwr(iwrOf(target), rolled.byType, target));
  const entry = log(run, target, {
    type: "afflictionStage", name: affliction.spec.name, stage: affliction.stage, amount, damageType: stage.damage[0]?.type ?? "poison"
  });
  dealDamage(run, run.byId.get(affliction.sourceId), target, amount, { lingering: true, entry });
}

/**
 * Exposed to an affliction (behavior/afflictions.js): its save, and on a failure it takes hold (or, one with no save, it
 * simply does). One that takes hold as the save of the action laying it went (spec.bySave, with that save's `degree`:
 * PF2e's spell, 5e's Contagion) rolls none of its own: the rules' step for that degree (afflictionStep, "exposure"); its
 * own save is for later (its stages, its tally). Already on it: a disease or a curse takes no more hold; a poison's
 * fresh dose may worsen it, without making it last any longer.
 */
export function exposeToAffliction(run, source, target, spec, { degree = null } = {}) {
  if ( target.spec.iwr?.immune?.some(k => spec.traits?.includes(k)) ) return;
  const rules = run.prep.rules;
  let affliction = target.afflictions.find(a => a.spec.id === spec.id);
  if ( affliction && !stacks(spec) ) return;
  let increase = 1;
  if ( spec.bySave && Number.isFinite(degree) ) {
    increase = stepOf(rules, degree, "exposure");
    if ( increase > 0 ) log(run, target, { type: "afflicted", name: spec.name, by: source?.spec.name ?? null, byId: source?.id ?? null });
  } else if ( spec.save ) {
    const { mod, advantage, dice } = saveRoll(run, target, spec.save.type, { action: spec });
    const rolled = systemRolled(run, target, "save", { dc: spec.save.dc, from: source, save: spec.save.type, action: spec, advantage });
    const roll = rollCheck(rules, run.rng, mod, spec.save.dc, { advantage, dice, kind: "save", roller: target, rolled, label: spec.name ?? "", what: "affliction", target: source });
    increase = stepOf(rules, roll.degree, "exposure");
    log(run, target, {
      type: "afflictionSave", name: spec.name, saveType: spec.save.type, natural: roll.natural, mod, total: roll.total, dc: spec.save.dc, degree: roll.degree
    });
  } else log(run, target, { type: "afflicted", name: spec.name, by: source?.spec.name ?? null, byId: source?.id ?? null });
  if ( !(increase > 0) ) return;
  if ( !affliction ) {
    affliction = { spec, stage: Math.max(0, (Number(spec.start) || 1) - 1), rounds: 0, inStage: 0, sourceId: source?.id ?? null, onsetLeft: Math.max(0, spec.onset ?? 0) };
    target.afflictions.push(affliction);
  }
  affliction.stage = Math.min(spec.stages.length, affliction.stage + increase);
  affliction.inStage = 0;
  if ( affliction.onsetLeft > 0 ) return; // it takes hold once the onset has passed
  applyAfflictionStage(run, target, affliction);
}

/** Bigger than an outcome (or a rider) takes (its maxSize: 5e Push mastery, Large or smaller)? */
const tooBig = (t, o) => Number.isFinite(o?.maxSize) && Number.isFinite(t.spec.size) && t.spec.size > o.maxSize;

/**
 * Riders on a successful hit: knockdown, grab, afflictions, a maneuver with a roll of its own (kind "control"). `saveDegree`:
 * the target's save, for a save action's (an affliction that takes hold as it went: bySave); `dealt`: what the blow did to
 * it (a rider that only comes of a blow that hurt: hurtOnly, Daggerheart's Bear).
 */
function applyEffects(run, u, action, target, degree, { saveDegree = null, dealt = null } = {}) {
  for ( const effect of action.effects ?? [] ) {
    if ( !isUp(target) && effect.kind !== "affliction" ) continue;
    if ( target.status === STATUS.DEAD ) return;
    if ( effect.hurtOnly && !(dealt > 0) ) continue;
    if ( effect.kind === "prone" && (degree === 3 || !effect.critOnly) ) {
      target.prone = true;
      log(run, target, { type: "prone", by: u.spec.name });
    } else if ( effect.kind === "grabbed" ) {
      // (Not one that can't be grabbed: the system's immunities.)
      if ( cantBeGrabbed(run, target, action) ) continue;
      target.grabbedBy = u.id;
      target.grabKey = null;
      log(run, target, { type: "grabbed", by: u.spec.name });
    } else if ( effect.kind === "move" && effect.move && (degree === 3 || !effect.critOnly) ) {
      // (Pushed back by the blow: 5e Thunderous Smite, a creature's Push. Not one too big for it, nor one the system's
      // immunities say it isn't moved by.)
      if ( tooBig(target, effect) || isImmune(run, target, { traits: action.traits, onSave: [effect] }) ) continue;
      forceMove(run, u, target, effect.move);
    } else if ( effect.kind === "affliction" ) {
      exposeToAffliction(run, u, target, effect, { degree: saveDegree });
    } else if ( effect.kind === "condition" && (degree === 3 || !effect.critOnly) ) {
      // A rider such as "if it critically fails, it's also stunned 1": the system's own tags decide immunity.
      if ( isImmune(run, target, { traits: action.traits, onSave: [effect] }) ) continue;
      log(run, target, { type: "condition", by: u.spec.name, effect: effect.label ?? "" });
      landOutcome(run, u, target, effect, { traits: action.traits ?? [] }, { damage: false });
      testConcentration(run, target);
    } else if ( effect.kind === "save" && effect.save ) {
      saveRider(run, u, action, target, effect);
    } else if ( effect.kind === "control" && effect.control && (degree === 3 || !effect.critOnly) ) {
      // (A maneuver of its own at the one it hit, with its own roll: PF2e's Improved Grab, a free Grapple that neither
      // takes nor adds to the multiple attack penalty. A live battle shows its own card first, where it has one.)
      const control = withManeuver(effect.control);
      if ( control.card ) showAction(run, u, control, target);
      executeControl(run, u, control, target, 0, run.log ? logCommon(u, control, target, false) : null);
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
  const { roll, mod } = rollSave(run, target, effect.save.type, effect.save.dc, { stakes: saveStakes(target, harmful, !!effect.conditions), label: effect.label || action.name, magical: isMagical(action), from: u, action });
  const mult = effect.damage?.length ? saveMultiplier(rules, roll.degree, effect.save) : 0;
  const hit = mult > 0 ? rollHit(run, u, action, target, effect.damage, mult, false) : null;
  const dealt = hit ? appliedLive(run, u, target, hit, hit.total, mult) : 0;
  const entry = log(run, target, {
    type: "riderSave", name: effect.label || action.name, by: u.spec.name, saveType: effect.save.type, natural: roll.natural, mod, total: roll.total,
    dc: effect.save.dc, degree: roll.degree, damage: dealt, controls: !!effect.conditions
  });
  hit?.apply(dealt, entry);
  // (Failed: what it lays, and a push or a grab it carries: Thunderwave's.)
  if ( roll.degree > 1 || !(effect.conditions || effect.move || effect.grab) || !isUp(target) || tooBig(target, effect) ) return;
  if ( effect.conditions && isImmune(run, target, { traits: action.traits, onSave: [effect] }) ) return;
  if ( effect.conditions ) log(run, target, { type: "condition", by: u.spec.name, effect: effect.label ?? "" });
  landOutcome(run, u, target, effect, { traits: action.traits ?? [] }, { damage: false });
  testConcentration(run, target);
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
  const dealt = appliedLive(run, target, who, hit, hit.total, 1);
  const entry = logging ? log(run, who, {
    type: "backlash", label: cost.label ?? "", by: target.spec.name, byId: target.id, damage: dealt, damageType: cost.damage[0]?.type ?? "untyped"
  }) : null;
  hit.apply(dealt, entry);
}

/**
 * A save that turns the tables (rules.retort: a system whose save can strike back, doing well meaning a blow at the
 * foe): the saver's own blow at whoever made it save, if the system says so for this degree.
 */
function retort(run, saver, by, action, degree, logging) {
  const back = run.prep.rules.retort?.(run, saver, by, action, degree);
  if ( !back?.damage?.length || !isUp(saver) || !isUp(by) ) return;
  const hit = rollHit(run, saver, { name: back.label ?? "", damage: back.damage }, by, back.damage, 1, degree === 3);
  const dealt = appliedLive(run, saver, by, hit, hit.total, 1);
  const entry = logging ? log(run, saver, {
    type: "attack", action: back.label ?? "", target: by.spec.name, targetId: by.id, damage: dealt, degree, retort: true, damageType: back.damage[0]?.type ?? "untyped"
  }) : null;
  hit.apply(dealt, entry);
}

/**
 * A live battle's card for an action, as its user shows it (a spell's, a breath's: the helper's useAction), asked of
 * the system in a turn FastFighting plays (engine/live.js systemRoll "use"): {card}, or null. Nothing rolled or spent.
 */
function showAction(run, u, action, t = null) {
  return run.live?.roll?.(run, { kind: "use", unitId: u.id, targetId: t?.id ?? null, action: { id: action.id, name: action.name } }) ?? null;
}

/**
 * The damage the system rolled for this action, once for all it catches (run.liveDamage), as one target takes it:
 * times `mult` (a save's half, a critical failure's double), rounded down. {byType, card}, or null (the engine's dice).
 */
function liveDamageOf(run, action, mult = 1) {
  const d = run.liveDamage;
  if ( !d || d.actionId !== action.id ) return null;
  return { byType: Object.fromEntries(Object.entries(d.byType).map(([k, v]) => [k, Math.max(0, Math.floor(v * mult))])), card: d.card };
}

/**
 * A live battle's damage card (`sys.card`: the system's own roll's, or the engine's dice shown as the system's card,
 * a hit's `card`), applied its way to `target` (engine/live.js systemRoll "apply", times `mult`): what the target lost
 * by it; else `amount`, the engine's sum.
 */
function appliedLive(run, u, target, sys, amount, mult) {
  if ( !sys?.card ) return amount;
  const applied = run.live?.roll?.(run, { kind: "apply", unitId: (u ?? target).id, targetId: target.id, card: sys.card, amount, multiplier: mult, applies: null });
  return Number.isFinite(applied?.lost) ? Math.max(0, applied.lost) : amount;
}

/**
 * Damage the engine rolled itself in a turn a live battle plays (its table roll, `record`), shown as the system's own
 * damage card where its helper shows table rolls (engine/live.js systemRoll "card", API 20; a heal, its healing card:
 * API 21, healedLive): the rolls waiting before it
 * shown first, so the chat reads in order, all of them marked shown (never posted again). The card's message id, for
 * the system to apply it its own way ("apply"); null for none (the engine's sum, written with the turn's changes).
 * The dice are the engine's either way: nothing here rolls.
 */
function engineCard(run, record) {
  if ( !record || (record.kind !== "damage" && record.kind !== "healing") || !run.live?.playing ) return null;
  const table = pendingRolls(run);
  const answer = run.live.roll?.(run, {
    kind: "card", unitId: record.by, targetId: record.target, action: { id: record.action ?? "", name: record.label ?? "" }, table
  });
  if ( !answer ) return null;
  markShown(table);
  const card = typeof answer.card === "string" && answer.card ? answer.card : null;
  if ( card ) record.card = card;
  return card;
}

/**
 * A heal the engine rolled (its table roll, `record`) in a turn a live battle plays (API 21): the system's healing card
 * of it (engineCard: the target and the amount, a flat heal's too), applied the system's way to t (engine/live.js
 * systemRoll "apply" with `healing`, times `mult`: a heal check's), and what t's sheet gained by it; else `amount`, the
 * engine's own (no card, nothing applied, or the table settles it: a player's character's heal of another, with Apply
 * players' damage off).
 */
function healedLive(run, u, t, record, amount, mult) {
  const card = engineCard(run, record);
  if ( !card ) return amount;
  const applied = run.live?.roll?.(run, { kind: "apply", unitId: u.id, targetId: t.id, card, amount, multiplier: mult, applies: null, healing: true });
  return Number.isFinite(applied?.gained) ? Math.max(0, applied.gained) : amount;
}

/**
 * Damage the engine rolled itself (its table roll, `record`) dealt to t by `by` in a live battle: the system's card of
 * it, applied the system's way (engineCard, appliedLive), and what t lost by it; else `amount`, the engine's sum.
 */
function landsRolled(run, by, t, record, amount) {
  const card = engineCard(run, record);
  return card ? appliedLive(run, by ?? t, t, { card }, amount, 1) : amount;
}

/**
 * A blow's damage the engine rolled, shown (a live battle's table roll: engine/table-rolls.js); healing, as healing.
 * Its action's id, and whether it was an attack's or a save's, for the system's own card. The roll recorded, or null.
 */
function shownDamage(run, at, u, t, action, parts, multiplier, crit) {
  const kind = parts.length && parts.every(p => p.type === "healing") ? "healing" : "damage";
  const source = action.kind === "strike" || (action.kind === "control" && action.check?.attack) ? "attack" : action.save ? "save" : null;
  return tableRoll(run, at, { by: u, target: t, kind, label: action.name ?? "", action: typeof action.id === "string" ? action.id : null, source, parts, multiplier, crit });
}

/**
 * Roll damage for a hit; returns the total and a function that applies it (so the log reads in order), told the harm's
 * log entry where there is one (dealDamage's `entry`).
 */
function rollHit(run, u, action, t, parts, multiplier, crit, minimum = 0, forced = null) {
  const rules = run.prep.rules;
  // (The system's own damage roll, where it rolled it: its dice by type, before anyone's resistances.)
  // (A total read off a player's card: the blow's own damage type.)
  const forcedBy = forced?.byType ?? (Number.isFinite(forced?.total) ? { [parts[0]?.type ?? "untyped"]: Math.max(0, forced.total) } : null);
  // (A live battle's engine dice, a table roll each: the damage as rolled, before the target's resistances. Its share
  // by a save, `multiplier`, said with it. engine/table-rolls.js; nothing where nothing records.)
  let at = forcedBy ? -1 : diceAt(run);
  const rolled = forcedBy ? { byType: { ...forcedBy }, persistent: [], direct: !!forced.direct, byCategory: {} } : sampleDamage(parts, run.rng, multiplier);
  const record = at >= 0 ? shownDamage(run, at, u, t, action, parts, multiplier, crit) : null;
  // Rolled several times over (DCC magic missiles: so many missiles of so much each).
  if ( action.repeat && !forcedBy ) {
    at = diceAt(run);
    const repeats = Math.max(1, samplePart(action.repeat, run.rng));
    if ( at >= 0 ) tableRoll(run, at, { by: u, kind: "other", what: "repeat", label: action.name ?? "", parts: [action.repeat] });
    for ( let n = repeats; n > 1; n-- ) {
      at = diceAt(run);
      const more = sampleDamage(parts, run.rng, multiplier);
      if ( at >= 0 ) shownDamage(run, at, u, t, action, parts, multiplier, crit);
      for ( const [k, v] of Object.entries(more.byType) ) rolled.byType[k] = (rolled.byType[k] ?? 0) + v;
      for ( const [c, row] of Object.entries(more.byCategory) ) for ( const [k, v] of Object.entries(row) ) addTo(rolled.byCategory, c, k, v);
    }
  }
  // Some systems guarantee a hit does at least some damage before resistances (PF2e: 1).
  if ( minimum > 0 ) {
    const types = Object.keys(rolled.byType);
    const sum = types.reduce((s, k) => s + rolled.byType[k], 0);
    if ( types.length && sum < minimum ) rolled.byType[types[0]] += minimum - sum;
  }
  // (What dealt it too: its traits, PF2e's weakness to holy, whatever the damage; its materials, cold iron; an area's;
  // a critical hit; how much of it is precision or splash. evaluate.js iwrContext.)
  const ctx = iwrContext(action, { crit, byCategory: rolled.byCategory, direct: rolled.direct });
  const total = rules.applyIwr(iwrOf(t), rolled.byType, t, ctx);
  // (A live battle's: the engine's own dice shown as the system's damage card, for the system to apply: engineCard. Not
  // a blow rolled several times over, its rolls several cards.)
  const card = forced?.card ?? (record && !action.repeat ? engineCard(run, record) : null);
  return {
    total,
    byType: rolled.byType, // (as rolled, before anyone's resistances)
    ctx, // (what else applyIwr heard, for another who takes the blow instead)
    types: Object.keys(rolled.byType),
    card, // (its damage card in a live battle, the system's or the engine's dice shown as one: appliedLive applies it)
    apply: (amount = total, entry = null) => {
      for ( const p of rolled.persistent ) {
        if ( !t.spec.iwr?.immune?.includes(p.type) ) t.persistent.push({ part: p, sourceId: u.id });
      }
      dealDamage(run, u, t, amount, { crit, types: Object.keys(rolled.byType), byType: rolled.byType, action, entry });
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
  run.resolved = { side: null, outcome: "collapsed", cause: cause ?? null, by: u?.id ?? null };
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

/** A strike u makes out of its turn, now (a reaction: in a live battle, to something a player did). */
export function strikeOutOfTurn(run, u, action, t) {
  return executeOffense(run, u, action, t, 0);
}

function executeOffense(run, u, action, t, attacksMade) {
  // Shooting, or working a spell with its hands, in a foe's reach opens it up, where the system says so (PF2e).
  if ( ((action.range && !action.melee) || action.traits?.includes?.("manipulate")) && !provoke(run, u, "foeOpening") ) return;
  if ( counterspelled(run, u, action) || disrupted(run, u, action) ) {
    run.blood = true;
    return;
  }
  // (Struck at on its way off the map: it may turn to face it: behavior/leaving.js.)
  if ( t?.leaving ) confronted(run, t, u, "attack", logger(run));
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
  // (The din of it, for whoever hears it: behavior/patrol.js.)
  u.dinRound = run.round;
  if ( t ) t.dinRound = run.round;
  // (A live battle's: the system's own card for a spell, a breath, a blast, as its user shows it, and for a control
  // action that says it has one of its own (`card`: an ability whose roll is a maneuver's, PF2e's Grab); and the damage
  // of one that isn't an attack, rolled the system's way once for everyone it catches: liveDamage.)
  if ( (action.kind !== "strike" && action.kind !== "control") || isMagical(action) || (action.kind === "control" && action.card) ) {
    const shown = showAction(run, u, action, t);
    if ( (action.kind === "save" || action.kind === "auto") && action.damage?.length ) {
      // (An action whose damage is a Strike's, dealt with no roll of its own, names it: PF2e's Rend, `strikeOf`.)
      const what = { id: action.id, name: action.name, ...(action.strikeOf ? { strikeOf: action.strikeOf } : {}) };
      const rolled = run.live?.roll?.(run, { kind: "damage", unitId: u.id, targetId: t?.id ?? null, card: shown?.card ?? null, action: what }) ?? null;
      run.liveDamage = rolled?.damage?.byType ? { actionId: action.id, byType: rolled.damage.byType, card: rolled.card ?? null } : null;
    }
  }
  const targets = [t];
  if ( action.area ) {
    // (A live battle lays the system's own shape on the map and says who's in it: run.live.inArea, null where it can't.)
    const caught = o => run.live?.inArea?.(u, t, o, action) ?? inArea(run, u, t, o, action.area);
    const others = enemiesOf(run, u).filter(o => o !== t && isStanding(o) && !heldOff(run, u, o) && !cutOff(run, u, o) && caught(o));
    run.rng.shuffle(others);
    targets.push(...others.slice(0, Math.max(0, (action.area.targets ?? 2) - 1)));
    // (Where it was aimed, and from where, for a live battle to lay it on the map.)
    if ( run.live && run.log ) {
      const at = p => (p ? { x: p.x, y: p.y } : null);
      log(run, u, { type: "area", actionId: action.id, action: action.name, targetId: t.id, target: t.spec.name, from: at(u.pos), at: at(t.pos) });
    }
    if ( run.neutral ) targets.push(...caughtInArea(run, u, targets));
  }
  const ranged = !!action.range && !action.melee;
  const logging = !!run.log; // thousands of unlogged runs shouldn't pay for building log text
  for ( const target of targets ) fateful(run, target, u, () => strikeTarget(run, u, action, target, attacksMade, ranged, logging));
  run.liveDamage = null;
  if ( action.melee ) {
    u.adjacent.add(t.id);
    t.adjacent.add(u.id);
  }
  // A concentration spell everyone shrugged off holds nothing up.
  if ( action.concentration && u.concentration?.actionId === action.id && !holdsAnything(run, u) ) u.concentration = null;
}

/** (Who an area catches: battle-state.js inArea, kept here for those that ask the simulator.) */
export { inArea };

/**
 * The roll the system made for u's strike at target, a live battle's reaction rolled with the system's own roller
 * (engine/live.js decide: run.live.forced), taken once: {attack: {degree, natural, total}, damage: {byType} | null}.
 */
function takeForced(run, u, target) {
  const f = run.live?.forced;
  if ( !f || f.unitId !== u.id || (f.targetId && f.targetId !== target.id) ) return null;
  run.live.forced = null;
  return f;
}

/** What every log entry of an action at a target says (the attack's, the save's, the control's). */
function logCommon(u, action, target, ranged) {
  return {
    action: action.name, actionKind: action.kind, damageType: primaryType(action), damageTypes: damageTypesOf(action), storyType: action.storyType ?? null, target: target.spec.name, targetId: target.id,
    ranged, area: !!action.area, targetCover: !!target.spec.environment?.nearCover, attackerCover: !!u.spec.environment?.nearCover,
    // (A shot that leaves its weapon, an arrow, a bolt, a bullet: not a thrown one, a spell or a breath, nor an action
    // named for what's done rather than with what (launched: false, Ironsworn's Strike). The story tells the shot.)
    launched: ranged && action.kind === "strike" && !action.thrown && !action.area && action.launched !== false,
    feet: Number.isFinite(edgeDistance(u, target)) ? Math.round(edgeDistance(u, target)) : null
  };
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
      want(target, "hurt", u.id, GRUDGE.provoked * styleOf(target).retaliate);
    }

    const common = logging ? logCommon(u, action, target, ranged) : null;

    if ( action.kind === "auto" ) {
      const extra = bonusDamageParts(run, u, action, target, { commit: true });
      const sys = liveDamageOf(run, action);
      const hit = rollHit(run, u, action, target, (action.damage ?? []).concat(extra), 1, false, 0, sys);
      const amount = appliedLive(run, u, target, hit, hit.total, 1);
      const entry = logging ? log(run, u, { type: "auto", ...common, damage: amount }) : null;
      answerHarm(run, target, u, action, hit.apply(amount, entry));
      return;
    }

    if ( action.kind === "control" ) {
      executeControl(run, u, action, target, attacksMade, common);
      return;
    }

    if ( action.kind === "save" && action.save ) {
      const extra = bonusDamageParts(run, u, action, target, { commit: true });
      const { roll, mod } = rollSave(run, target, action.save.type, action.save.dc, { stakes: saveStakes(target, meanDamageVs(run, action, target).normal, !!action.effects?.length), label: action.name, magical: isMagical(action), from: u, action });
      const mult = saveMultiplierFor(rules, roll.degree, action.save, target);
      const data = !logging ? null : { type: "save", ...common, saveType: action.save.type, natural: roll.natural, mod: mod + (roll.die ?? 0), total: roll.total, dc: action.save.dc, degree: roll.degree, margin: roll.total - action.save.dc, note: roll.note ?? null, faces: roll.faces ?? null, ...(roll.said?.data?.luck ? { luck: roll.said.data.luck } : {}) };
      if ( mult > 0 ) {
        // (A live battle's damage the system rolled, once for all: this target's share by its save, applied the system's
        // way, and what it lost by it.)
        const sys = liveDamageOf(run, action, mult);
        const hit = rollHit(run, u, action, target, (action.damage ?? []).concat(extra), mult, roll.degree === 0, 0, sys);
        const amount = appliedLive(run, u, target, hit, hit.total, mult);
        const entry = logging ? log(run, u, { ...data, damage: amount }) : null;
        const dealt = hit.apply(amount, entry);
        if ( roll.degree <= 1 ) applyEffects(run, u, action, target, 3 - roll.degree, { saveDegree: roll.degree, dealt });
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
    const deedAt = diceAt(run);
    const deedRoll = r.deed ? run.rng.die(r.deed) : 0;
    if ( r.deed && deedAt >= 0 ) tableRoll(run, deedAt, { by: u, target, kind: "other", what: "deed", label: action.name, total: deedRoll });
    let ac = currentAc(run, target, u, action);
    // Reactions to the attack itself are settled before its dice, but told after it: an answer to what was done.
    const answers = [];
    const tellAnswers = () => { for ( const tell of answers.splice(0) ) tell(); };
    // (One that does something of its own before the roll, a strike, harm, a buff, is told and played at once: an
    // attacker it fells, or leaves unable to act, never makes the attack. Its bonus to AC still counts.)
    let first = false;
    const answerFirst = (g, r, trigger, ctx) => {
      if ( !hasEffects(r) || !wouldPlay(run, g, r, trigger, ctx) ) return false;
      logReaction(run, g, u, r, trigger);
      playEffects(run, g, r, trigger, ctx, KIT);
      return (first = true);
    };
    let acBonus = 0;
    // A friend close by covers it (5e Protection, Shield of the Cavalier): a bonus to its defense against this attack.
    if ( run.wardens && target !== u ) {
      const expected = meanDamageVs(run, action, target).normal;
      for ( const g of run.units ) {
        if ( g === target || g === u || g.side !== target.side || !g.spec.reactions?.some(x => answersTo(x, "allyTargeted")) ) continue;
        const ctx = { by: u, ally: target, action, damage: expected };
        const cover = respond(run, g, "allyTargeted", ctx);
        if ( cover?.ac ) acBonus += cover.ac;
        if ( cover && answerFirst(g, cover, "allyTargeted", ctx) ) break;
        if ( cover?.ac ) {
          answers.push(() => logReaction(run, g, u, cover, "allyTargeted"));
          break;
        }
      }
    }
    // Seeing it coming (PF2e Nimble Dodge): a bonus to AC against this attack.
    if ( target.spec.reactions && target !== u ) {
      const ctx = { by: u, action, damage: meanDamageVs(run, action, target).normal };
      const dodge = respond(run, target, "attacked", ctx);
      if ( dodge?.ac ) acBonus += dodge.ac;
      if ( dodge && !answerFirst(target, dodge, "attacked", ctx) && dodge.ac ) answers.push(() => logReaction(run, target, u, dodge, "attacked"));
    }
    if ( first ) {
      // (Felled or stopped by it: no attack.)
      if ( !isStanding(u) || u.conds?.incapacitated || u.conds?.stunned || u.conds?.paralyzed || !isUp(target) ) return;
      ac = currentAc(run, target, u, action);
    }
    ac += acBonus;
    // (A Lore-Collector that sized this foe up: the roll about 2.5 times as likely to land.)
    const lift = boostBonus(rules, u, target, bonus + deedRoll, ac, opts);
    // (A live battle's roll the system made itself, its cards in the chat: that roll, as it came out, in place of the
    // engine's dice (rollCheck: rolled). A reaction's, rolled as it was decided (takeForced); any other, as it's made:
    // engine/live.js systemRoll.)
    const forced = takeForced(run, u, target)
      ?? run.live?.roll?.(run, {
        kind: "strike", unitId: u.id, targetId: target.id, attackNumber: attacksMade, advantage: advantage ?? 0,
        action: { id: action.id, name: action.name, ranged: !!ranged, thrown: !!action.thrown && !!ranged }
      })
      ?? null;
    let roll = rollCheck(rules, run.rng, bonus + deedRoll + lift, ac, { ...opts, rolled: forced?.attack ?? null, by: u, label: action.name, target, actionId: action.id });
    spendEdges(u, "attack", target.id);
    // (Spent by this attack: a mark on its defense; off-guard to this attacker for its next melee attack, PF2e's Feint.)
    spendEdges(target, "defend", u.id, { melee: !!action.melee });
    spendBoost(u, target);
    if ( run.boosting && roll.degree < 2 && !forced ) roll = boost(run, u, roll, ac, { kind: "attack", stakes: attackStakes(run, u, target, action), options: opts }, logger(run));
    // The system's own say once the dice are seen (Ironsworn: burning momentum; PF2e: a flat check), told whether they
    // were the system's own (`rolled`), and what the roll means (initiative).
    if ( rules.adjustRoll ) {
      roll = rules.adjustRoll(run, u, roll, { kind: "attack", stakes: attackStakes(run, u, target, action), label: action.name, action, target, rolled: !!forced?.attack }) ?? roll;
      if ( roll.said ) log(run, u, { text: roll.said.text, type: "adjust", ...roll.said.data });
    }
    rules.afterRoll?.(run, u, roll, { kind: "attack", action, target, faces: opts.faces ?? 20 });
    // A close miss a die can mend (5e Precision Attack).
    if ( roll.degree === 1 && u.spec.riders && !forced ) {
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
        // (A buff on itself at once, for this blow's damage: told with the answer.)
        playEffects(run, target, answer, "hit", { by: u, action }, KIT, { only: ["boost"], tell: (unit, data) => answers.push(() => log(run, unit, data)) });
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
        if ( g === target || g === u || g.side !== target.side || !g.spec.reactions?.some(x => answersTo(x, "allyHit")) ) continue;
        const r2 = respond(run, g, "allyHit", { by: u, ally: target, action, crit: roll.degree === 3, damage: expected, types });
        if ( r2 ) {
          // (Told with what it did: whom it shielded, how much it took off, whether it could strike back.)
          guard = { g, r: r2, took: 0, back: r2.strike ? strikeBack(run, g, u, r2) : null };
          const told = guard;
          answers.push(() => logReaction(run, g, u, r2, "allyHit", {
            ally: target.spec.name, allyId: target.id, took: told.took, ...(r2.strike ? { struck: !!told.back } : {})
          }));
          break;
        }
      }
    }
    // (The system's roll: its own modifier, whatever it counted.)
    const sysMod = forced?.attack && Number.isFinite(roll.total) && Number.isFinite(roll.natural) ? roll.total - roll.natural : null;
    const data = !logging ? null : { type: "attack", ...common, natural: roll.natural, mod: sysMod ?? bonus + deedRoll + lift + (roll.die ?? 0), total: roll.total, dc: ac, degree: roll.degree, margin: roll.total - ac, attackNumber: attacksMade + 1, boost: lift || null, faces: roll.faces ?? opts.faces, deed: r.deed ? deedRoll : null, challenge: roll.challenge ?? null, burned: roll.burned ?? null, note: roll.note ?? null, ...(roll.said?.data?.luck ? { luck: roll.said.data.luck } : {}) };
    let struck = 0;
    if ( roll.degree >= 2 ) {
      const crit = roll.degree === 3;
      // (A critical hit on one immune to its doubling, PF2e's immunity to critical hits: a normal hit's damage, its
      // crit table's extra none; still a critical hit for everything else. evaluate.js critDoubles.)
      const doubles = crit && critDoubles(rules, target, action);
      // (A blow the system rolled is the whole blow, its own bonuses in it: nothing more added, nor anything spent on it.)
      const whole = !!forced?.damage;
      const extra = whole ? [] : bonusDamageParts(run, u, action, target, { advantage, commit: true });
      const riders = u.spec.riders && !whole ? chooseHitRiders(run, u, action, target, { crit }) : [];
      const table = crit && !whole ? rollCrit(run, u, action, target) : null;
      const base = doubles ? (action.critDamage ?? criticalParts(rules, action.damage)) : (action.damage ?? []);
      const more = doubles ? criticalParts(rules, extra) : [...extra];
      for ( const x of riders ) if ( x.damage?.length ) more.push(...(doubles && x.critDouble ? criticalParts(rules, x.damage) : x.damage));
      if ( doubles && table?.row?.damage?.length ) more.push(...table.row.damage);
      if ( deedRoll && !whole ) more.push(part([], deedRoll, primaryType(action)));
      const hit = rollHit(run, u, action, target, more.length ? base.concat(more) : base, 1, crit, rules.minimumDamage ?? 0, forced?.damage ?? null);
      // A finishing move (an Ironsworn End the Fight): whatever it has left.
      let amount = action.finish ? target.hp + target.temp + (target.stamina ?? 0) : hit.total;
      // (A crit table's row that doubles or triples the blow: DCC's "double damage".)
      if ( !action.finish && doubles && Number(table?.row?.multiply) > 1 ) amount *= Number(table.row.multiply);
      if ( answer?.halve ) amount = Math.floor(amount / 2);
      if ( answer?.reduce ) amount = Math.max(0, amount - reduced(run, target, answer, u));
      if ( guard?.r.reduce ) {
        const before = amount;
        amount = Math.max(0, amount - reduced(run, guard.g, guard.r, u));
        guard.took = before - amount;
      }
      // Taken instead (PF2e Intercept Attack): the friend takes none of it; its protector takes the blow, against its
      // own resistances.
      const intercepted = guard?.r.redirect && amount > 0 ? rules.applyIwr(iwrOf(guard.g), hit.byType, guard.g, hit.ctx) : null;
      if ( intercepted !== null ) amount = 0;
      const lessened = amount < hit.total ? hit.total - amount : 0;
      // (The system's own damage card, landing as it was rolled: the system applies it, its resistances, shields and
      // all, and the target takes what it lost by it. Lessened by reactions the system's application does itself
      // (`applies`: the target's own, PF2e's Shield Block or 5e's Uncanny Dodge halving it; a friend's, PF2e's
      // Champion's Resistance, by whom), applied with them; by any other, the engine's sum.)
      const ownByItself = !(answer?.halve || answer?.reduce) || !!answer?.applies;
      const friendByItself = !guard?.r.reduce || !!guard?.r.applies;
      const asRolled = !lessened || (ownByItself && friendByItself);
      // (The system's own roll's card; or, where the system left the strike to the engine (PF2e's Strike refused it),
      // the engine's dice shown as the system's card: rollHit's.)
      const card = forced?.card ?? hit.card ?? null;
      if ( card && asRolled && intercepted === null && !action.finish ) {
        const applies = [answer?.applies ? { key: answer.applies } : null, guard?.r.reduce && guard.r.applies ? { key: guard.r.applies, by: guard.g.id } : null].filter(Boolean);
        const was = amount;
        const applied = run.live?.roll?.(run, { kind: "apply", unitId: u.id, targetId: target.id, card, amount, applies: applies.length ? applies : null });
        if ( Number.isFinite(applied?.lost) ) {
          amount = Math.max(0, applied.lost);
          // (What the friend's reaction took off, as the system's application came out: all the blow lost but this.)
          if ( guard?.r.applies && !answer?.reduce && !answer?.halve ) guard.took = Math.max(0, hit.total - amount);
          else if ( guard ) guard.took = Math.max(0, guard.took + was - amount);
        }
      }
      const entry = logging ? log(run, u, {
        ...data, damage: amount, crit, sneak: extra.length > 0, precision: [...base, ...more].some(isPrecision) || undefined, advantage, riders: riders.map(x => x.label), critRoll: table?.total ?? null, critRowText: table?.row?.text ?? null,
        lessened, interceptedBy: intercepted !== null ? guard.g.spec.name : null, intercepted
      }) : null;
      tellAnswers();
      const dealt = intercepted !== null ? 0 : hit.apply(amount, entry);
      struck = dealt;
      if ( intercepted > 0 ) dealDamage(run, u, guard.g, intercepted, { crit, types: hit.types });
      applyEffects(run, u, action, target, roll.degree, { dealt });
      if ( table?.row ) applyCritRow(run, u, target, table);
      for ( const x of riders ) applyRider(run, u, target, x);
      if ( deed ) applyDeed(run, u, target, deed, deedRoll);
      answerHarm(run, target, u, action, dealt, crit, hit.types);
      // (Retributive Strike: the champion's own blow at the attacker, as the reaction allows: strikeBack; and whatever
      // else the friend's answer does, now the blow is done.)
      if ( guard && isUp(guard.g) ) playEffects(run, guard.g, guard.r, "allyHit", { by: u, ally: target, action, crit }, KIT, { back: guard.back });
      // (Its own blow landed: what it does on a hit, reaction-effects.js.)
      ownHit(run, u, target, action, crit, dealt, hit.types);
    } else {
      if ( logging ) log(run, u, { ...data, damage: 0, advantage, savedBy: answer?.label ?? null });
      tellAnswers();
      // A miss opens the attacker up (5e Riposte, a melee one).
      if ( target.spec.reactions && isUp(target) && target !== u ) {
        const ctx = { by: u, action, crit: roll.degree === 0 };
        const back = respond(run, target, "missed", ctx);
        if ( back && wouldPlay(run, target, back, "missed", ctx) ) {
          logReaction(run, target, u, back, "missed");
          playEffects(run, target, back, "missed", ctx, KIT);
        }
      }
      if ( deed && logging ) log(run, u, { type: "deed", deed: deed.label, maneuver: deed.maneuver ?? null, target: target.spec.name, targetId: target.id, roll: deedRoll, success: false });
      // A shot into a melee that misses may stray toward one of the shooter's own friends there (rules.strayShot: DCC).
      if ( ranged && rules.strayShot ) {
        const friend = rules.strayShot(run, u, target, action);
        if ( friend && isUp(friend) ) strayShot(run, u, action, friend, logging);
      }
      if ( roll.degree === 0 && u.spec.fumble ) applyFumble(run, u);
    }
    // (A Strike on its own turn, for what needs one first: its last action a hit, two hits in a row: requires.js. And a
    // critical hit with one brings back what a crit recharges: PF2e Draconic Momentum.)
    if ( action.kind === "strike" ) {
      noteBlow(run, u, action, target, roll.degree);
      if ( roll.degree === 3 ) rechargeOnCrit(run, u);
    }
    // (What answered the hit, now the blow is done: its harm, a strike back, what it lays.)
    if ( answer && isUp(target) ) playEffects(run, target, answer, "hit", { by: u, action, crit: roll.degree === 3 }, KIT, { skip: ["boost"] });
    // What the attempt costs the attacker, by the system (Ironsworn: a miss, or a weak Clash, is Pay the Price).
    backlash(run, u, target, action, roll.degree, logging);
    // The attack over, its damage and all it laid done: the system's say (PF2e: a hidden attacker is seen now).
    rules.afterAttack?.(run, u, target, { action, degree: roll.degree, dealt: struck });
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
  const roll = rollCheck(rules, run.rng, r.bonus, ac, { ...opts, by: u, label: action.name, target: friend });
  if ( roll.degree < 2 ) {
    if ( logging ) log(run, u, { type: "stray", action: action.name, target: friend.spec.name, targetId: friend.id, natural: roll.natural, total: roll.total, dc: ac, hit: false, damage: 0 });
    return;
  }
  const hit = rollHit(run, u, action, friend, action.damage ?? [], 1, false, rules.minimumDamage ?? 0);
  const dealt = appliedLive(run, u, friend, hit, hit.total, 1);
  const entry = logging ? log(run, u, { type: "stray", action: action.name, target: friend.spec.name, targetId: friend.id, natural: roll.natural, total: roll.total, dc: ac, hit: true, damage: dealt }) : null;
  hit.apply(dealt, entry);
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
function logReaction(run, u, by, r, trigger, extra = {}) {
  if ( !run.log ) return;
  log(run, u, { type: "reaction", reaction: r.label, tell: r.tell ?? null, maneuver: maneuverOf(r), trigger, target: by.spec.name, targetId: by.id, ...extra });
}

/**
 * u's own attack hit `target` (a Strike, a spell attack): it may answer with a reaction or a free action of its own
 * ("ownHit": a second bite, a condition on the one it hit, a breath weapon ready again on a critical hit). Not for a
 * strike its own answer made (u.answering), nor when it isn't up.
 */
function ownHit(run, u, target, action, crit, dealt, types = null) {
  if ( !u.spec.reactions || u.answering || !isUp(u) ) return;
  const ctx = { target, action, crit, damage: dealt, types: types ?? (action.damage ?? []).map(p => p.type) };
  const r = respond(run, u, "ownHit", ctx);
  if ( !r || !wouldPlay(run, u, r, "ownHit", ctx) ) return;
  logReaction(run, u, target, r, "ownHit");
  u.answering = true;
  try {
    playEffects(run, u, r, "ownHit", ctx, KIT);
  } finally {
    u.answering = false;
  }
}

/**
 * u's reaction strike at foe, as the reaction allows (behavior/responses.js strikeBack: in reach, a Step first, or a
 * shot): the Step played first where it needs one, no parting blows for it, then the strike, its ammunition spent.
 * `back`: strikeBack's, where it was found already. Returns whether it struck.
 */
function reactStrike(run, u, foe, r, logging, back = strikeBack(run, u, foe, r)) {
  if ( !back ) return false;
  if ( back.step > 0 && u.pos ) {
    const from = { x: u.pos.x, y: u.pos.y };
    moveToward(run, u, foe, back.strike.reach ?? 5, back.step);
    resettle(run, u);
    if ( run.log ) log(run, u, { type: "step", reaction: true, feet: Math.round(Math.hypot(u.pos.x - from.x, u.pos.y - from.y)), from, to: { x: u.pos.x, y: u.pos.y } });
  }
  strikeTarget(run, u, back.strike, foe, 0, !back.strike.melee, logging);
  spendAmmo(u, back.strike);
  used(u, back.strike); // (a shot fired: loaded no more)
  return true;
}

/**
 * The simulator's own moves, for reaction-effects.js to play a reaction's effects with (it can't import this file).
 */
const KIT = Object.freeze({ log, rollSave, rollHit, landOutcome, reactStrike, stepAside, forceMove, showAction, appliedLive, noteHeal, testConcentration });

/**
 * Hurt by a foe: the one hurt may answer (5e Hellish Rebuke: fire at whoever did it, a save for half; a buff, a strike
 * back, what it lays: reaction-effects.js).
 */
function answerHarm(run, target, by, action, dealt, crit = false, types = null) {
  if ( !(dealt > 0) || !target.spec.reactions || !by || target === by || !isUp(target) || !isUp(by) ) return;
  const ctx = { by, action, damage: dealt, crit, types: types ?? (action?.damage ?? []).map(p => p.type) };
  const r = respond(run, target, "damaged", ctx);
  if ( !r || !wouldPlay(run, target, r, "damaged", ctx) ) return;
  logReaction(run, target, by, r, "damaged");
  playEffects(run, target, r, "damaged", ctx, KIT);
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
    const ctx = { by: u, action };
    const r = respond(run, e, "spell", ctx);
    if ( !r ) continue;
    if ( !r.counter ) {
      // (Something else at the caster: a strike, harm, what it lays. A caster felled by it casts nothing.)
      if ( wouldPlay(run, e, r, "spell", ctx) ) {
        logReaction(run, e, u, r, "spell");
        playEffects(run, e, r, "spell", ctx, KIT);
      }
      if ( !isStanding(u) ) return true;
      continue;
    }
    let countered = !r.counter.save && (r.counter.level ?? 0) >= action.rank;
    let roll = null;
    if ( r.counter.save ) {
      roll = rollSave(run, u, r.counter.save.type, r.counter.save.dc, { stakes: 0.5, label: action.name }).roll;
      countered = roll.degree < 2;
    } else if ( !countered ) {
      roll = rollCheck(rules, run.rng, Number(r.counter.mod) || 0, 10 + action.rank, { kind: "check", roller: e, label: r.label ?? "", what: "counter", target: u });
      countered = roll.degree >= 2;
    }
    log(run, e, {
      type: "counter", reaction: r.label, target: u.spec.name, targetId: u.id, action: action.name, countered, natural: roll?.natural ?? null, total: roll?.total ?? null
    });
    if ( countered ) return true;
  }
  return false;
}

/**
 * A spell (a magical action) that comes to nothing as it's cast, as the system says (rules.disrupted(run, u, action):
 * PF2e's stupefied, a DC 5 + its value flat check): lost, and told (the system's words, and its roll where it has one:
 * {natural, dc, said: {text}}). Returns whether it was.
 */
function disrupted(run, u, action) {
  if ( !run.prep.rules.disrupted || !isMagical(action) ) return false;
  const lost = run.prep.rules.disrupted(run, u, action);
  if ( !lost ) return false;
  log(run, u, { type: "disrupted", action: action.name, text: lost.said?.text ?? "", natural: lost.natural ?? null, dc: lost.dc ?? null, ...lost.said?.data });
  return true;
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
    // (What it lays, a grab, a knockback: as any maneuver's result lands.)
    landOutcome(run, u, target, row.outcome, { id: `crit:${u.id}`, name: row.outcome.label ?? localize("FASTFIGHTING.Effect.cripplingBlow"), traits: [] }, { damage: false });
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
  const before = u.hp;
  if ( row.damage?.length ) {
    const at = diceAt(run);
    const rolled = sampleDamage(row.damage, run.rng);
    const shown = at >= 0 ? tableRoll(run, at, { by: u, target: u, kind: "damage", what: "fumble", parts: row.damage }) : null;
    const amount = landsRolled(run, u, u, shown, run.prep.rules.applyIwr(iwrOf(u), rolled.byType, u));
    if ( amount > 0 ) dealDamage(run, null, u, amount);
  }
  if ( row.outcome && isUp(u) ) applyOutcome(u, row.outcome, u.id, { id: `fumble:${u.id}`, name: row.outcome.label ?? localize("FASTFIGHTING.Effect.fumble") });
  noteHp(log(run, u, { type: "fumble", roll: total, effect: row.outcome?.label ?? "", rowText: row.text ?? null }), u, before);
}

/** An on-hit rider's lasting part: a save against it, or simply what it does. */
function applyRider(run, u, target, rider) {
  let outcome = rider.save ? null : rider.outcome;
  let roll = null;
  if ( rider.save && isUp(target) ) {
    roll = rollSave(run, target, rider.save.type, rider.save.dc, { stakes: 0.6, label: rider.label, action: rider }).roll;
    outcome = rider.onSave?.[roll.degree] ?? (roll.degree < 2 ? rider.outcome : null);
  }
  const fake = { id: `rider:${rider.id}`, traits: rider.traits, onSave: outcome ? [outcome] : [] };
  const landed = !!outcome && isUp(target) && !isImmune(run, target, fake);
  if ( landed ) {
    // (What it lays, and a push or a grab it carries: 5e Thunderous Smite, as any maneuver's result lands.)
    landOutcome(run, u, target, outcome, { id: `rider:${rider.id}`, name: rider.label, traits: rider.traits ?? [] }, { damage: false });
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
      type: "deed", deed: deed.label, maneuver: deed.maneuver ?? null, target: target.spec.name, targetId: target.id, roll: deedRoll, success: friends.length > 0, effect: friends.length ? (tier.outcome.label ?? "") : "",
      allies: friends.map(a => a.spec.name)
    });
    return;
  }
  // (A defensive deed lands on the one who did it.)
  const on = tier?.outcome?.self ? u : target;
  const landed = !!tier && isUp(on) && (on === u || !isImmune(run, target, { id: `deed:${deed.id}:${tier.min}`, onSave: [tier.outcome] }));
  // (Logged first: a push or a grab it brings follows it.)
  log(run, u, {
    type: "deed", deed: deed.label, maneuver: deed.maneuver ?? null, target: target.spec.name, targetId: target.id, roll: deedRoll, success: landed, effect: landed ? (tier.outcome?.label ?? "") : ""
  });
  if ( landed ) {
    landOutcome(run, u, target, tier.outcome, { id: `deed:${deed.id}`, name: deed.label, traits: [] }, { damage: false });
    if ( on === target ) testConcentration(run, target);
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
    d.focus?.delete(fromKey);
    d.apart?.delete(fromKey);
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
  // (In a live battle a player's fate is spent only as its player said: on its own life, on a friend's.)
  const may = a => !run.live || run.live.mayReroll(run, a, victim);
  if ( fateOf(victim) > 0 && may(victim) ) return victim;
  for ( const a of run.units ) {
    if ( a === victim || a.side !== victim.side || !isStanding(a) || fateOf(a) <= 0 || !may(a) ) continue;
    if ( !perceives(run, a, victim, { crisis: true }) ) continue;
    if ( run.rng.chance(clamp(1 - liveTrait(run, a, "selfish") / 100, 0.05, 0.95)) ) return a;
  }
  return null;
}

/** What a blow, a save or a recovery check can change on a creature, to put it back as it was. */
function snapshotOf(u) {
  const s = {};
  for ( const k in u ) {
    const v = u[k];
    if ( v === null || typeof v !== "object" ) s[k] = v;
  }
  s.conds = { ...u.conds };
  s.effects = [...(u.effects ?? [])];
  s.persistent = [...(u.persistent ?? [])];
  s.afflictions = (u.afflictions ?? []).map(a => ({ ...a }));
  s.harmedBy = new Map(u.harmedBy ?? []);
  s.usedThisTurn = u.usedThisTurn ? new Set(u.usedThisTurn) : u.usedThisTurn;
  return s;
}

/** Could anyone spend fate on `victim`: itself, or one on its side with some left? Otherwise nothing is taken back. */
const savable = (run, victim) => run.units.some(o => fateOf(o) > 0 && (o === victim || o.side === victim.side));

/**
 * Something that might kill `victim`: a blow, a save, a recovery check. If it does and someone spends fate, it's
 * taken back and rolled again (a hit may become a miss, a failed check a success), up to three times. Where the
 * system has a sure way out for the dying themselves (PF2e Heroic Recovery, all their hero points), it's that.
 */
function fateful(run, victim, actor, attempt) {
  if ( !run.fateInPlay || !victim || victim.status === STATUS.DEAD ) return attempt();
  const rules = run.prep.rules;
  for ( let tries = 0; ; tries++ ) {
    // (As things were, to take it back: only when someone could.)
    const keep = savable(run, victim);
    const before = keep ? snapshotOf(victim) : null;
    const by = keep && actor && actor !== victim ? snapshotOf(actor) : null;
    const logLength = run.log?.length ?? 0;
    const firstFallen = run.firstFallen;
    const shownFrom = rollsWaiting(run);
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
    if ( !before ) return;
    Object.assign(victim, before);
    if ( by ) Object.assign(actor, by);
    recomputeConditions(victim);
    if ( run.log ) run.log.length = logLength;
    run.firstFallen = firstFallen;
    // (Its dice were rolled all the same, at the table too: shown, as taken back.)
    markRerolled(run, shownFrom);
    spender.resources.fate -= 1;
    run.fateInPlay = run.units.some(o => fateOf(o) > 0);
    log(run, spender, {
      type: "fate", self: spender === victim, target: victim.spec.name, targetId: victim.id, label, spent: 1
    });
  }
}

/**
 * A maneuver's result landing (maneuvers.js: a control action's degree, a deed, a rider): what it lays (on the target,
 * or a botch's on the one who tried it), a grab (unless the target can't be grabbed: the system's immunities; it lasts
 * as long as what the grab laid with it, where it laid anything), a move (the target moved; a botch, the one who tried
 * it, moved by the target), and its own damage at that degree (PF2e Trip, critically: 1d6). Returns the damage.
 * `entry`: what its damage's hit points are noted on (dealDamage's).
 */
function landOutcome(run, u, target, outcome, action, { damage: harms = true, entry = null } = {}) {
  const self = !!outcome.self;
  const on = self ? u : target;
  // (Its holds on the one it holds, kept up: PF2e's Grab on a creature it has grabbed.)
  if ( outcome.renew && !self ) renewHolds(run, u, on, outcome);
  // (Until the end of its source's next turn, laid out of the source's own turn: no round more for that turn.)
  const effect = applyOutcome(on, outcome.until === "source" && run.acting !== u ? { ...outcome, thisTurn: true } : outcome, u.id, action);
  if ( isUp(on) ) gainResources(run, on, outcome);
  // (A botched Grapple: the foe has hold of the one who tried.)
  const holder = self ? target : u;
  if ( outcome.grab && isUp(on) && isUp(holder) && !cantBeGrabbed(run, on, action) ) {
    on.grabbedBy = holder.id;
    on.grabKey = self ? null : effect?.key ?? null;
    log(run, on, { type: "grabbed", by: holder.spec.name });
  }
  if ( outcome.move && isUp(on) ) {
    if ( self ) forceMove(run, target, u, outcome.move);
    else forceMove(run, u, target, outcome.move);
  }
  // (Taken inside the one who did it, swallowed, engulfed: where it is from now on.)
  if ( effect && holderOf(run, on) ) carryInside(run);
  if ( !harms || !outcome.damage?.length || !isUp(on) ) return 0;
  const hit = rollHit(run, u, action ?? { id: "outcome", damage: outcome.damage }, on, outcome.damage, 1, false);
  return hit.apply(appliedLive(run, u, on, hit, hit.total, 1), entry);
}

/**
 * The resources an outcome gives t (Ironsworn momentum) or takes from it (a negative amount: Daggerheart's Hope lost),
 * as the system says (rules.gainResource), else simply added.
 */
function gainResources(run, t, outcome) {
  for ( const [k, v] of Object.entries(outcome?.resources ?? {}) ) {
    const n = Number(v) || 0;
    if ( run.prep.rules.gainResource ) run.prep.rules.gainResource(t, k, n);
    else t.resources[k] = (t.resources[k] ?? 0) + n;
  }
}

/** Can't it be grabbed: the system's immunities say so, or its own (immune to grabbed, grappled)? */
function cantBeGrabbed(run, t, action) {
  if ( (t.spec.iwr?.immune ?? []).some(k => k === "grabbed" || k === "grappled") ) return true;
  return isImmune(run, t, { traits: action?.traits ?? [], onSave: [{ grab: true }] });
}

/**
 * t moved by u (shoved, dragged, put somewhere: behavior/forced.js): where it ends up, and what it finds there. Over a
 * drop, it falls (the system's fall damage, else 1d6 for each 10 feet) and lands prone; harm where it lands (a fire,
 * acid: the scene's), dealt; a hazard whose reach it's in goes off at it, once.
 */
function forceMove(run, u, t, move) {
  const rules = run.prep.rules;
  const path = forcedPath(run, u, t, move);
  const from = t.pos ? { x: t.pos.x, y: t.pos.y } : null;
  if ( path.noMap ) {
    // (No map: out of its reach, that's all.)
    t.adjacent.delete(u.id);
    u.adjacent.delete(t.id);
  } else if ( path.feet > 0 ) {
    t.pos.x = path.to.x;
    t.pos.y = path.to.y;
    t.feetMoved = (t.feetMoved ?? 0) + path.feet;
    resettle(run, t);
    run.geo = (run.geo ?? 0) + 1;
  }
  log(run, u, {
    type: "forced", how: move.kind, feet: path.noMap ? move.feet ?? 5 : path.feet, target: t.spec.name, targetId: t.id, from, to: path.to ?? null,
    fall: path.fall || 0, blocked: !!path.blocked, into: (path.hazards ?? []).map(h => h.spec.name), ground: path.cell?.h ? "hazardous" : path.cell?.d ? "difficult" : null
  });
  if ( path.fall > 0 && isUp(t) ) {
    const fall = fallDamage(run, path.fall, t);
    const at = diceAt(run);
    const rolled = sampleDamage(fall, run.rng, 1);
    const shown = at >= 0 ? tableRoll(run, at, { by: t, target: t, kind: "damage", what: "fall", parts: fall }) : null;
    const amount = landsRolled(run, u, t, shown, rules.applyIwr(iwrOf(t), rolled.byType, t, { direct: rolled.direct }));
    const entry = log(run, t, { type: "fall", feet: path.fall, amount });
    dealDamage(run, u, t, amount, { types: Object.keys(rolled.byType), entry });
    const prone = typeof rules.fallProne === "function" ? rules.fallProne(t, amount) : rules.fallProne !== false;
    if ( isUp(t) && prone ) t.prone = true;
  }
  // (Stopped short against a wall or someone: the system's collision, if it has one: Daggerheart's.)
  if ( path.blocked && isUp(t) && typeof rules.collisionDamage === "function" ) {
    const parts = rules.collisionDamage(t, { feetLeft: Math.max(0, (path.goal ?? move.feet ?? 5) - (path.feet ?? 0)), into: path.into ?? null, move, by: u }) ?? [];
    if ( parts.length ) {
      const at = diceAt(run);
      const rolled = sampleDamage(parts, run.rng, 1);
      const shown = at >= 0 ? tableRoll(run, at, { by: t, target: t, kind: "damage", what: "collision", parts }) : null;
      const amount = landsRolled(run, u, t, shown, rules.applyIwr(iwrOf(t), rolled.byType, t, { direct: rolled.direct }));
      const entry = log(run, t, { type: "collision", amount, into: path.into?.spec?.name ?? null });
      dealDamage(run, u, t, amount, { types: Object.keys(rolled.byType), entry });
    }
  }
  if ( path.cell?.harm?.length && isUp(t) ) {
    const at = diceAt(run);
    const rolled = sampleDamage(path.cell.harm, run.rng, 1);
    const shown = at >= 0 ? tableRoll(run, at, { by: t, target: t, kind: "damage", what: "ground", parts: path.cell.harm }) : null;
    const amount = landsRolled(run, u, t, shown, rules.applyIwr(iwrOf(t), rolled.byType, t));
    const entry = log(run, t, { type: "groundHarm", amount, damageTypes: Object.keys(rolled.byType) });
    dealDamage(run, u, t, amount, { types: Object.keys(rolled.byType), lingering: true, entry });
  }
  for ( const h of path.hazards ?? [] ) {
    if ( !isUp(t) || h.spent ) continue;
    const action = h.prep.offense.find(a => hasUses(h, a));
    if ( !action ) continue;
    log(run, h, { type: "trap", what: "springs", target: t.spec.name, targetId: t.id });
    spendUse(h, action);
    executeOffense(run, h, action, t, 0);
    if ( h.spec.hazard?.once ) h.spent = true;
  }
  // (Whatever it holds inside it went with it.)
  if ( path.feet > 0 ) carryInside(run);
  if ( run.foeAuras && path.feet > 0 && isUp(t) ) auraMoved(run, t, AURA_PLAY); // (moved into an aura: behavior/auras.js)
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
      // (A live battle's, the system's own roll where it makes them: the target's save, the user's check or its taunt.)
      const rolled = r.kind === "save" ? systemRolled(run, target, "save", { dc: r.dc, from: u, save: action.save.type, action })
        : r.kind === "check" ? systemRolled(run, u, "check", { dc: r.dc, target, purpose: "control", skill: action.check.skill ?? null, against: action.check.against ?? "will", attackNumber: action.check.attack ? attacksMade : null, action })
          : r.kind === "goad" && r.pitch ? systemRolled(run, u, "check", { dc: r.dc, target, purpose: "talk", skill: r.pitch.skill ?? null, action }) : null;
      let x = rollCheck(rules, run.rng, r.mod, r.dc, { ...opts, rolled, by: r.roller ?? (r.kind === "save" ? target : u), label: action.name, target: r.kind === "save" ? u : target });
      if ( r.kind === "save" ) spendEdges(target, "save");
      else {
        spendEdges(u, r.rollKind, target.id);
        spendBoost(u, target);
        if ( r.rollKind === "attack" ) spendEdges(target, "defend", u.id, { melee: !!action.melee });
      }
      // Luck: the target on a save against it, the user on its own roll.
      if ( run.boosting && x.degree < 2 && !rolled ) x = boost(run, r.kind === "save" ? target : u, x, r.dc, { kind: r.rollKind, stakes: r.kind === "save" ? 0.7 : 0.3, options: opts }, logger(run));
      if ( r.kind === "save" ) x = standFirm(run, target, x, r.dc, 0.7, action.name);
      if ( r.kind === "save" && x.degree === 2 && upgradesSave(target, action.save.type) ) x = { ...x, degree: 3 };
      // (Its own roll, told to the system as any is: DCC's luck on a 20, hiding given up by an attack.)
      if ( r.kind !== "save" ) rules.afterRoll?.(run, u, x, { kind: r.rollKind, control: true, action, target, faces: opts.faces });
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
  // (The target's hit points before its harm, as dealDamage notes them: for the log, which comes after: noteHp.)
  const harmed = logging ? {} : null;
  let damage = 0;
  if ( outcome && isUp(lands) ) {
    if ( !outcome.self ) moveHeld(run, u, action, lands);
    if ( !outcome.self && run.standoff && heldOff(run, u, lands) && areEnemies(run, u, lands) ) endStandoff(run, u, "blood");
    // (What it lays, a grab, a move, its own damage at that degree: landOutcome.)
    damage += landOutcome(run, u, target, outcome, action, { entry: outcome.self ? null : harmed });
    testConcentration(run, lands);
    if ( run.neutral && !outcome.self ) crossed(run, u, lands, "harm", 1, logger(run));
  }
  if ( action.damage?.length ) {
    const mult = action.save ? saveMultiplier(rules, degree, action.save) : (degree >= 2 ? 1 : 0);
    if ( mult > 0 ) {
      // (An attack's critical hit is a critical's damage, unless the action says otherwise.)
      const crit = degree === 3 && r.kind === "attack" && action.critDamage !== false;
      const hit = rollHit(run, u, action, target, action.damage, mult, crit);
      const dealt = appliedLive(run, u, target, hit, hit.total, mult);
      damage += dealt;
      hit.apply(dealt, harmed);
    }
  }
  if ( logging ) {
    noteHp(log(run, u, {
      controls: !!outcome?.conditions?.controlled,
      maneuver: maneuverOf(action), conditions: Object.keys(outcome?.conditions ?? {}).filter(k => outcome.conditions[k]),
      type: "control", ...common, roll: r.kind, saveType: action.save?.type ?? null, against: action.check?.against ?? null,
      natural: roll.natural, mod: roll.mod, total: roll.total, dc, degree, margin: roll.total === null ? null : roll.total - dc,
      effect: outcome?.label ?? "", took: !!outcome, backfired: !!outcome?.self, damage, shifted: shift, taunt: !!outcome?.taunt, note: roll.note ?? null, faces: roll.faces ?? null,
      goad: !!action.goad, skill: r.pitch?.skill ?? null, dcStat: r.pitch?.dcLabel ?? null, luck: luck?.roll ?? null, needed: luck?.needed ?? null, shrugged,
      debuff: !!(outcome?.mods || outcome?.mark), tempHp: Number(outcome?.tempHp) || 0
    }), target, harmed?.hpBefore);
  }
  // (A Demoralize is words as well as fear: an intimidation at its target, at the same degree and against the same DC,
  // with no roll of its own, as a player's Demoralize card counts in a live battle (talk.js resolveTalk): a success
  // wears its will to fight, a critical failure offends it.)
  if ( maneuverOf(action) === "demoralize" && target !== u && isUp(target) && roll.total !== null ) {
    const pitch = { target, kind: "intimidate", aim: aimOf(u, target), skill: r.pitch?.skill ?? action.check?.skill ?? "intimidate", mod: roll.mod ?? 0, dc, dcLabel: r.pitch?.dcLabel ?? "DC" };
    resolveTalk(run, u, pitch, { degree, natural: roll.natural, total: roll.total }, logger(run));
  }
  // (An attack roll that hit, a spell attack's: what it does on its own hit, reaction-effects.js.)
  if ( r.kind === "attack" && degree >= 2 && isUp(target) ) {
    ownHit(run, u, target, action, degree === 3, damage);
  }
  // (An attack roll's, over: the system's say, as for any attack.)
  if ( r.kind === "attack" ) rules.afterAttack?.(run, u, target, { action, degree, dealt: damage, control: true });
}

/** Creatures called to fight: they join the order right after u (holding its concentration, if they need it). */
function executeSummon(run, u, action) {
  if ( counterspelled(run, u, action) || disrupted(run, u, action) ) return;
  const released = beginConcentration(run, u, action);
  if ( released.length ) log(run, u, { type: "concentrationEnd", effects: released, reason: "switch" });
  const called = callSummons(run, u, action);
  log(run, u, {
    type: "summon", action: action.name, names: called.map(s => s.spec.name), ids: called.map(s => s.id)
  });
}

/** A buff on its recipients (the user too, for an aura). An action it gains at once (Action Surge) goes on the turn. */
function executeBuff(run, u, action, targets, worth = 0, turn = null) {
  if ( counterspelled(run, u, action) || disrupted(run, u, action) ) return spendUse(u, action);
  if ( action.casting ) {
    const tier = castFor(run, u, action, targets[0] ?? null);
    if ( !tier || tier.kind !== "buff" ) return spendUse(u, action);
    return executeBuff(run, u, { ...tier, id: action.id }, targets, worth, turn);
  }
  // (A live battle's: the system's own card for it, as its user shows it; one a check lands shows its check's card.)
  if ( !action.check ) showAction(run, u, action, targets[0] ?? null);
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
    const c = checkRoll(run, u, Number(action.check.mod), null, { purpose: "aid", action });
    const rolled = systemRolled(run, u, "check", { dc, target: Array.isArray(targets) ? targets[0] ?? null : null, purpose: "aid", skill: action.check.skill ?? null, action, advantage: c.advantage });
    const roll = rollCheck(rules, run.rng, c.mod, dc, { advantage: c.advantage, dice: c.dice, kind: "check", roller: u, faces: action.check.faces, rolled, label: action.check.label || action.name });
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
    gainResources(run, t, outcome);
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
      tell: action.tell ?? null, // a story line of its own (dodge, reckless, surge), if the system names one
      maneuver: maneuverOf(action) ?? undefined // (one on the master list, Hide, Take Cover: told as what it is)
    });
  }
}

function executeHeal(run, u, action, target) {
  const rules = run.prep.rules;
  if ( counterspelled(run, u, action) || disrupted(run, u, action) ) {
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
  // (A live battle's: the system's own card for it, as its user shows it; a heal a check lands shows its check's card.)
  if ( !action.healCheck ) showAction(run, u, action, target);
  let multiplier = 1;
  let roll = null;
  if ( action.healCheck ) {
    const check = checkRoll(run, u, action.healCheck.mod, target, { purpose: "heal", skill: action.healCheck.skill ?? null, action });
    const rolled = systemRolled(run, u, "check", { dc: action.healCheck.dc, target, purpose: "heal", skill: action.healCheck.skill ?? null, action, advantage: check.advantage });
    roll = rollCheck(rules, run.rng, check.mod, action.healCheck.dc, { advantage: check.advantage, dice: check.dice, kind: "check", roller: u, rolled, label: action.healCheck.label || action.name, target });
    spendEdges(u, "check", target.id);
    multiplier = rules.healCheckMultiplier ? rules.healCheckMultiplier(roll.degree) : [0, 0, 1, 2][roll.degree];
    rules.afterRoll?.(run, u, roll, { kind: "heal", action, target, faces: roll.faces ?? 20 });
    // Someone's life on it: a healer with fate to spare tries again (the selfish less readily, for others).
    const dying = target.status === STATUS.DOWN && !target.stable;
    if ( !multiplier && dying && fateOf(u) > 0 && (!run.live || run.live.mayReroll(run, u, target)) && (u === target || run.rng.chance(clamp(1 - liveTrait(run, u, "selfish") / 100, 0.05, 0.95))) ) {
      u.resources.fate -= 1;
      run.fateInPlay = run.units.some(o => fateOf(o) > 0);
      log(run, u, { type: "fate", target: target.spec.name, targetId: target.id, label: u.spec.fateLabel ?? localize("FASTFIGHTING.Words.Fate"), spent: 1 });
      const again = systemRolled(run, u, "check", { dc: action.healCheck.dc, target, purpose: "heal", skill: action.healCheck.skill ?? null, action, advantage: check.advantage });
      roll = rollCheck(rules, run.rng, check.mod, action.healCheck.dc, { advantage: check.advantage, dice: check.dice, kind: "check", roller: u, rolled: again, label: action.healCheck.label || action.name, target });
      multiplier = rules.healCheckMultiplier ? rules.healCheckMultiplier(roll.degree) : [0, 0, 1, 2][roll.degree];
    }
  }
  // (A share of the target's own hit dice: DCC Lay on Hands.)
  const healAt = diceAt(run);
  let rolled = (action.heal ?? []).reduce((s, p) => s + samplePart(p, run.rng), 0);
  for ( let n = 0; n < (action.healDice ?? 0); n++ ) rolled += run.rng.die(target.spec.hitDie ?? 6);
  let record = null;
  if ( healAt >= 0 ) {
    const hitDice = action.healDice ? [part([{ n: action.healDice, faces: target.spec.hitDie ?? 6 }], 0, "healing")] : [];
    record = tableRoll(run, healAt, {
      by: u, target, kind: "healing", label: action.name ?? "", action: typeof action.id === "string" ? action.id : null,
      parts: [...(action.heal ?? []), ...hitDice], total: rolled, multiplier
    });
  }
  // (Wounds that won't close take none of it. In a turn a live battle plays, the system's healing card, applied its
  // way: what the sheet gained.)
  let amount = canHeal(target) ? Math.max(0, Math.floor(rolled * multiplier)) : 0;
  if ( record && amount > 0 ) amount = healedLive(run, u, target, record, amount, multiplier);
  const wasDown = target.status === STATUS.DOWN;
  const before = target.hp;
  if ( amount > 0 ) rules.onHealed(target, amount);
  // (What else the heal gives, where it took: Stress cleared with it, Daggerheart's Bark at the Moon; and what it lays
  // on the one healed, as any outcome lands: Regenerate's hit point a turn, 5e's fast healing, PF2e's regeneration.)
  if ( multiplier > 0 ) {
    gainResources(run, target, action);
    // (Not one for another alone, on itself: notSelf, PF2e Lay on Hands' +2 AC.)
    if ( action.outcome && target.status !== STATUS.DEAD && !(action.outcome.notSelf && target === u) ) {
      applyOutcome(target, action.outcome, u.id, action);
      gainResources(run, target, action.outcome);
      rules.onOutcome?.(run, u, target, action.outcome);
    }
  }
  u.healedTargets.add(`${action.id}|${target.id}`);
  spendUse(u, action);
  noteHeal(run, u, target, target.hp - before, wasDown && target.status === STATUS.STANDING, {
    action: action.name, potion: !!action.selfOnly, given: !!action.administered,
    check: roll ? { skill: action.healCheck.label ?? null, natural: roll.natural, mod: action.healCheck.mod, total: roll.total, dc: action.healCheck.dc, degree: roll.degree } : null
  });
}

/**
 * A healing given (the hit points already restored, by the engine or, in a live battle, on the sheet): the healer's
 * tally, what someone taking no side makes of it, and the telling.
 */
export function noteHeal(run, u, target, healed, revived, { action = "", potion = false, check = null, given = false } = {}) {
  u.healingDone += healed;
  if ( healed > 0 ) healedOf(target); // (a bleed stops)
  if ( run.neutral && healed > 0 ) crossed(run, u, target, "help", revived ? 1.5 : 0.75, logger(run));
  if ( run.log ) log(run, u, { type: "heal", action, target: target.spec.name, targetId: target.id, self: target === u, amount: healed, revived, potion, check, ...(given ? { given } : {}) });
  if ( revived ) stayBound(run, target, logger(run));
}

/* -------------------------------------------- */
/*  Turns                                       */
/* -------------------------------------------- */

/** The reaction every creature with an opportunity strike has (PF2e Reactive Strike, 5e Opportunity Attack), by its id. */
export const OPPORTUNITY = "opportunity";

/**
 * u does something in a foe's reach that opens it up, where the system's opportunity strikes answer it
 * (rules.opportunityOn: "foeOpening", a ranged attack or a manipulate action; "foeMovesInReach", standing up): each foe
 * that can strikes. Returns false if u didn't come through it standing.
 */
function provoke(run, u, trigger) {
  if ( !run.prep.rules.opportunityOn?.includes(trigger) ) return true;
  for ( const { e, strike, reaction } of threats(run, u, null, trigger) ) {
    if ( !isStanding(u) || battleOver(run) ) break;
    // (In a live battle the player, or the GM, may say otherwise: engine/live.js.)
    if ( run.live && !run.live.decide(run, e, { reaction: reaction ?? { id: OPPORTUNITY, label: strike.name }, trigger, by: u, would: true, strike }) ) continue;
    e.reactionsLeft -= 1;
    spendOwnStrike(e, reaction);
    log(run, e, { type: "opportunity", target: u.spec.name, targetId: u.id, action: strike.name, trigger });
    executeOffense(run, e, strike, u, 0);
  }
  return isStanding(u);
}

/** The standing foe nearest u on the map, or null. */
function nearestFoeOf(run, u) {
  let best = null;
  let d = Infinity;
  for ( const o of run.units ) {
    if ( o === u || !isStanding(o) || !areEnemies(run, u, o) ) continue;
    const x = edgeDistance(u, o);
    if ( x !== null && x < d ) { d = x; best = o; }
  }
  return best;
}

/** Moves that take it away from whoever it's told by (story and log): out of reach, into cover. */
const AWAY = new Set(["fallBack", "hitAndRun", "cover"]);

/**
 * A move to a spot for next turn (behavior/prepare.js bestSpot's): a Step (the system's way out, no reactions drawn,
 * a square), or a move as far as it is, paid for (PF2e's Stride; 5e's movement, or a Dash), the reactions it draws
 * played as any move's. Told as a step for later (`prepared`), by what it's for. Returns whether it's still up.
 */
function walkTo(run, u, turn, spot, toward, purpose) {
  if ( spot.kind === "step" ) {
    turn.spend(spot.cost);
    u.disengaged = true;
    log(run, u, { type: "disengage", label: spot.label ?? "", natural: null, total: null, dc: null, made: true });
  } else {
    if ( !leaveReach(run, u, turn, null, spot.cost) ) return false;
    if ( spot.kind === "stride" && !turn.payForMove(Math.max(spot.feet, 5)) ) return false;
  }
  const move = moveTowardPoint(run, u, spot.to, spot.feetTo + 0.5, 0);
  turn.usedMove(move.cost);
  resettle(run, u);
  return moveLog(run, u, move, toward, purpose, { prepared: true, ...(AWAY.has(purpose) ? { away: true } : {}) });
}

/**
 * A patrol's move toward the creature it heads for (behavior/patrol.js: the din of a fight, a scent, a foe its friends
 * see): one move the engine's way (its approach, the way round walls), a closed door on the way worked first (walked to,
 * opened, or got through as any is). Not one it's beside already, nor one there's no way to. Told by its `patrol` event.
 * Returns whether it got anywhere.
 */
function patrolToward(run, u, turn, t) {
  if ( !t?.pos || !u.pos || !canMove(run, u) || (edgeDistance(u, t) ?? 0) <= 5.5 ) return false;
  const ap = approach(run, u, t);
  if ( !Number.isFinite(ap.mult) || !(ap.speed > 0) ) return false;
  const door = doorAhead(run, u, t);
  if ( door ) {
    const done = workTheDoor(run, u, turn, door, t);
    return done === "moved" || done === "worked";
  }
  if ( !leaveReach(run, u, turn, null) ) return false;
  const budget = turn.payForMove(ap.speed);
  if ( !budget ) return false;
  const move = moveToward(run, u, t, 5, budget);
  turn.usedMove(move.cost);
  return moveLog(run, u, move, t, "patrol", { patrol: true }) && move.feet > 0;
}

/**
 * A patrol's move to a spot (behavior/patrol.js patrolSpot: out from its friends, back to them, on to new ground), or a
 * fidget's step aside: paid for as any move (a Stride; movement), its reactions answered. Told by its `patrol` or
 * `fidget` event. Returns whether it got anywhere, still standing.
 */
function patrolWalk(run, u, turn, spot, purpose = "patrol") {
  if ( !u.pos || !canMove(run, u) || !leaveReach(run, u, turn, null) ) return false;
  if ( !turn.payForMove(Math.max(spot.feet, 5)) ) return false;
  const move = moveTowardPoint(run, u, spot.to, spot.feet + 0.5, 0);
  turn.usedMove(move.cost);
  resettle(run, u);
  if ( run.log && move.feet > 0 ) {
    log(run, u, {
      type: "move", mode: "walk", feet: move.feet, mult: 1, regions: [], toward: "", towardId: null, from: move.from, to: move.to,
      reached: true, purpose, patrol: true, tactical: liveTier(run, u)
    });
  }
  answerMove(run, u, move, null);
  return move.feet > 0 && isStanding(u);
}

/**
 * Hiding where it patrols by keeping out of sight (behavior/patrol.js "hide"): its Hide (a buff that hides itself), where
 * it has one the system lets it use now and it isn't hidden already. True if it did.
 */
function hideNow(run, u, turn) {
  if ( Number(u.conds?.hidden) > 0 ) return false;
  const rules = run.prep.rules;
  const hide = (u.prep.buffActions ?? []).find(a => a.targets === "self" && [a.outcome, ...(a.onDegree ?? [])].some(o => Number(o?.conditions?.hidden) > 0));
  if ( !hide || !hasUses(u, hide) || (rules.usable && rules.usable(run, u, hide, u) === false) ) return false;
  const cost = costOf(rules, hide, u);
  if ( !turn.canAfford(cost) ) return false;
  turn.spend(cost);
  executeBuff(run, u, hide, [u], 0, turn);
  u.actsThisTurn += 1;
  return true;
}

/**
 * Healing it can't give this turn, on its way (behavior/prepare.js healAhead): a potion got out, or a move toward the
 * friend, only as far as the heal needs. Returns whether it did anything.
 */
function tendAhead(run, u, turn, ahead) {
  if ( ahead.step === "retrieve" ) {
    takeGearStep(run, u, turn, ahead, logger(run));
    return true;
  }
  const w = ahead.target;
  if ( !leaveReach(run, u, turn, w, null) ) return true;
  const budget = turn.payForMove(approach(run, u, w).speed);
  if ( !budget ) return false;
  tellStep(u, ahead, logger(run));
  const move = moveToward(run, u, w, ahead.reach, budget, ahead.range !== null ? { range: ahead.range } : {});
  turn.usedMove(move.cost);
  moveLog(run, u, move, w, "tend", { prepared: true });
  return true;
}

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
      const rolled = safe.check ? systemRolled(run, u, "check", { dc, purpose: "disengage", skill: safe.check.skill ?? null, label: safe.label ?? "" }) : null;
      const check = safe.check ? rollCheck(run.prep.rules, run.rng, Number(safe.check.mod) || 0, dc, { kind: "check", roller: u, rolled, label: safe.label ?? "", what: "disengage" }) : null;
      clear = !check || check.degree >= 2;
      u.disengaged = clear;
      log(run, u, { type: "disengage", label: safe.label ?? "", natural: check?.natural ?? null, total: check?.total ?? null, dc: check ? dc : null, made: clear });
    }
    if ( !clear ) {
      for ( const { e, strike, reaction } of list ) {
        if ( !isStanding(u) || battleOver(run) ) break;
        // (In a live battle the player, or the GM, may say otherwise: engine/live.js. A strike of its own reaction's
        // spends what that costs: behavior/reactions.js ownMoveStrike.)
        if ( run.live && !run.live.decide(run, e, { reaction: reaction ?? { id: OPPORTUNITY, label: strike.name }, trigger: "leaveReach", by: u, would: true, strike }) ) continue;
        e.reactionsLeft -= 1;
        spendOwnStrike(e, reaction);
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
function runs(run, u, turn, why = {}) {
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
  flee(run, u, turn, why);
  const leader = retreat.commander ?? u;
  for ( const a of retreat.followers ) {
    if ( a.status !== STATUS.STANDING ) continue;
    flee(run, a, null, { retreat: true, with: leader.spec.name, withId: leader.id, leads: a === leader });
  }
  // (On a map, it makes for the edge with what's left of its turn.)
  if ( isLeaving(u) && turn ) leavingTurn(run, u, turn, { whole: false });
  return true;
}

function flee(run, u, turn = null, extra = {}) {
  // (On a map: it means to go, and makes for the edge on its turns, still in the fight until it's off: leaving.js.)
  if ( mayLeave(run, u) ) {
    startLeaving(run, u, { why: extra.why ?? (extra.retreat ? "retreat" : null) });
    log(run, u, { type: "flee", leaving: true, feet: 0, ...extra });
    return;
  }
  // Turning to run from a foe in reach invites a parting blow.
  if ( !leaveReach(run, u, turn) ) return;
  goneFrom(run, u);
  const from = run.log && u.pos ? { x: u.pos.x, y: u.pos.y } : null;
  const feet = moveAway(run, u, (Math.max(...Object.values(u.spec.speeds ?? { walk: 25 })) || 25) * 2);
  log(run, u, { type: "flee", feet, mode: (u.spec.speeds?.fly ?? 0) > 0 ? "fly" : "walk", from, to: from ? { x: u.pos.x, y: u.pos.y } : null, ...extra });
  alertOnTheWay(run, u);
}

/**
 * A turn of a creature leaving the fight (behavior/leaving.js): up off the ground, loose of what holds it, then off
 * the map as fast as it goes, whoever's in reach striking as it goes. Off the edge, it's gone; and two whole turns in
 * a row given to going (LEAVING_TURNS: nothing stopping it), it's gone too, at the edge or not, with a way off or not.
 * `whole`: a turn of its own, all of it (not what was left of the turn it set out in).
 */
function leavingTurn(run, u, turn, { whole = true } = {}) {
  const rules = run.prep.rules;
  const basic = rules.basicAction ?? 1;
  u.leaving.turns += 1;
  if ( whole ) u.leaving.whole = (u.leaving.whole ?? 0) + 1;
  const gone = () => isLeaving(u) && (u.leaving.whole ?? 0) >= LEAVING_TURNS;
  let way = wayOff(run, u);
  if ( way && u.prone ) {
    const stand = rules.standCost ? rules.standCost(u) : basic;
    if ( turn.canAfford(stand) ) {
      turn.spend(stand);
      if ( !provoke(run, u, "foeMovesInReach") ) return;
      u.prone = false;
      log(run, u, { type: "stand" });
    }
  }
  // (Nobody walks off held: loose first.)
  for ( const hold of ownHolds(run, u) ) {
    if ( hold.key === "bound" ) continue;
    const cost = escapeCost(rules, u, hold, run);
    if ( !turn.canAfford(cost) ) break;
    turn.spend(cost);
    if ( !attemptEscape(run, u, hold).success ) break;
  }
  if ( !way ) {
    // (No way off: it looks for one; its turns given to going, it's gone all the same.)
    endOfTurn(run, u);
    if ( gone() ) offMap(run, u, { blinked: true });
    return;
  }
  const speed = Math.max(...Object.values(u.spec.speeds ?? { walk: 25 })) || 25;
  for ( let step = 0; step < MAX_STEPS_PER_TURN && way.feet > 0.5 && !ownHolds(run, u).some(h => h.key !== "bound"); step++ ) {
    if ( !canMove(run, u) ) break;
    // (Turning its back on a foe in reach: a parting blow, unless it gets clear safely.)
    if ( !leaveReach(run, u, turn) ) return;
    const budget = turn.payForMove(speed);
    if ( !budget ) break;
    const went = goAlong(run, u, way, budget);
    turn.usedMove(went.feet);
    if ( run.log && went.feet > 0 ) {
      log(run, u, { type: "move", mode: (u.spec.speeds?.fly ?? 0) > 0 ? "fly" : "walk", feet: went.feet, mult: 1, regions: [], toward: null, towardId: null,
        from: went.from, to: went.to, reached: went.off, purpose: "leave", tactical: liveTier(run, u), cover: false });
    }
    way = went.rest;
    if ( went.off ) {
      for ( const id of u.adjacent ) run.byId.get(id)?.adjacent.delete(u.id);
      u.adjacent.clear();
      offMap(run, u, {});
      return;
    }
  }
  endOfTurn(run, u);
  if ( gone() ) offMap(run, u, { far: true });
}

/** How urgent healing `ally` is, 0 to 90: down, 90; under half its hit points, the more the lower; else nothing. */
function healUrgency(ally) {
  if ( ally.status === STATUS.DOWN ) return 90;
  const frac = ally.maxHp > 0 ? ally.hp / ally.maxHp : 1;
  return frac < 0.5 ? Math.round(30 + 110 * (0.5 - frac)) : 0;
}

/** Which part of a turn works on each kind of desire (the top of its agenda first: playFromHere). */
const AGENDA_GROUPS = Object.freeze({ heal: "heal", aid: "aid", bolstered: "aid", bind: "fallen", rob: "fallen", free: "fallen", hurt: "fight", protect: "fight" });

/** Whole turns in a row given to going that see a creature leaving the fight gone, at the edge or not. */
const LEAVING_TURNS = 2;

/** u is off the map, leaving the fight (or, with no way off, gone unseen: blinked): fled. */
function offMap(run, u, extra = {}) {
  goneFrom(run, u);
  u.leaving = null;
  log(run, u, { type: "offMap", ...extra });
}

/** u is out of the fight, run off: its concentration and its holds on others go, and nobody's beside it any more. */
function goneFrom(run, u) {
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
}

/** Fleeing into a bystander alerts them; an ally will hear the call for help. */
function alertOnTheWay(run, u) {
  for ( const b of run.units ) {
    if ( b.active || b.status !== STATUS.STANDING ) continue;
    const d = edgeDistance(u, b);
    if ( d !== null && d <= 40 ) notice(run, b, b.side === u.side ? "help" : "fledInto", u);
  }
}

/** A move made, logged, and answered by those it ended beside (answerMove). Returns whether u is still on its feet. */
function moveLog(run, u, move, toward, purpose = "approach", extra = {}) {
  if ( run.log && move.feet > 0 ) {
    log(run, u, {
      type: "move", mode: move.mode, feet: move.feet, mult: move.mult, regions: move.regions, toward: toward.spec.name, towardId: toward.id,
      from: move.from ?? null, to: move.to ?? null,
      reached: move.reached, purpose, tactical: liveTier(run, u), cover: !!u.spec.environment?.nearCover, ...extra
    });
  }
  answerMove(run, u, move, toward);
  return isStanding(u);
}

/**
 * u ended a move (`move`, as moveToward made it, toward `toward`): those it came beside answer, where they have a
 * reaction for it (behavior/responses.js): a friend it stopped beside ("allyMoves": PF2e Goblin Scuttle, a Step), a
 * foe whose reach it came into ("foeApproaches": a strike at it, or a step).
 */
export function answerMove(run, u, move, toward = null) {
  if ( run.reachers || hasMoveStrikers(run) ) throughReach(run, u, move);
  if ( run.foeAuras && isStanding(u) ) auraMoved(run, u, AURA_PLAY); // (into an aura, or its own onto others: behavior/auras.js)
  if ( !run.movers || !(move?.feet > 0) || !isStanding(u) ) return;
  for ( const o of [...run.units] ) {
    if ( o === u || !o.spec.reactions || battleOver(run) || !isStanding(u) ) continue;
    const foe = areEnemies(run, u, o);
    if ( foe && heldOff(run, u, o) ) continue;
    const trigger = foe ? "foeApproaches" : "allyMoves";
    const ctx = { by: foe ? u : null, ally: foe ? null : u, from: move.from ?? null, toward, reached: !!move.reached };
    const r = respond(run, o, trigger, ctx);
    if ( !r ) continue;
    logReaction(run, o, u, r, trigger);
    // (A step first, then a strike at the foe come into reach, and the rest: reaction-effects.js.)
    playEffects(run, o, r, trigger, ctx, KIT);
  }
}

/**
 * u's move ended in a foe's reach after a square or more of it inside that reach, where the system's opportunity
 * strikes answer a foe moving in reach (rules.opportunityOn "foeMovesInReach": PF2e's Reactive Strike, a reach weapon
 * that a foe walks in through): each such foe strikes, as provoke has it. One that only stepped into reach at the end
 * of its move left no square inside it: nothing.
 */
function throughReach(run, u, move) {
  const from = move?.from;
  if ( !from || !u.pos || !(move.feet > 0) || !isStanding(u) ) return;
  const length = Math.hypot(u.pos.x - from.x, u.pos.y - from.y);
  if ( length < 4.5 ) return;
  for ( const { e, strike, reaction } of threats(run, u, null, "foeMovesInReach") ) {
    if ( !isStanding(u) || battleOver(run) ) break;
    const reach = (strike.reach ?? 5) + 0.5;
    const half = ((u.spec.position?.size ?? 5) + (e.spec.position?.size ?? 5)) / 2 - 5;
    const inReach = p => Math.max(5, Math.hypot(p.x - e.pos.x, p.y - e.pos.y) - half) <= reach;
    // (Where along it the move came into reach, a foot at a time: the rest of it was inside.)
    let entered = null;
    for ( let k = 0; k <= Math.ceil(length); k++ ) {
      const f = Math.min(1, k / length);
      if ( inReach({ x: from.x + (u.pos.x - from.x) * f, y: from.y + (u.pos.y - from.y) * f }) ) {
        entered = f;
        break;
      }
    }
    if ( entered === null || (1 - entered) * length < 4.5 ) continue;
    if ( run.live && !run.live.decide(run, e, { reaction: reaction ?? { id: OPPORTUNITY, label: strike.name }, trigger: "foeMovesInReach", by: u, would: true, strike }) ) continue;
    e.reactionsLeft -= 1;
    spendOwnStrike(e, reaction);
    log(run, e, { type: "opportunity", target: u.spec.name, targetId: u.id, action: strike.name, trigger: "foeMovesInReach" });
    executeOffense(run, e, strike, u, 0);
  }
}

/** o steps, outside its turn, `feet` at most, to the best spot it finds (bestStep): no parting blows for it. */
function stepAside(run, o, feet) {
  const step = bestStep(run, o, feet);
  if ( !step ) return;
  run.geo = (run.geo ?? 0) + 1;
  const from = { x: o.pos.x, y: o.pos.y };
  o.pos.x = step.to.x;
  o.pos.y = step.to.y;
  resettle(run, o);
  if ( run.log ) log(run, o, { type: "step", reaction: true, feet: Math.round(Math.hypot(o.pos.x - from.x, o.pos.y - from.y)), from, to: { x: o.pos.x, y: o.pos.y } });
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
  // (The GM's word on it, in a live battle: given up on, or wanted this badly. behavior/goals.js)
  const held = heldGoal(u, "openDoor", door.id);
  // The door is worth whatever u wants most on the far side of it.
  const beyondIt = () => {
    const beyond = enemiesOf(run, u).filter(o => isStanding(o) && (run.prep.approachOf(u.id, o.id)?.doors ?? []).includes(door.id));
    if ( !beyond.includes(target) && areEnemies(run, u, target) ) beyond.push(target);
    return beyond;
  };
  const giveUp = beyond => {
    log(run, u, { type: "door", method: "giveup", success: false, doorId: door.id, target: target.spec.name, targetId: target.id });
    for ( const o of beyond ) {
      thwart(run, u, "hurt", o.id, 15);
      (u.walledOff ??= new Map()).set(o.id, door.id);
    }
    if ( kind !== "hurt" ) thwart(run, u, kind, target.id, 15);
    return "giveup";
  };
  if ( held === 0 ) return giveUp(beyondIt());
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
    answerMove(run, u, move);
    return move.feet > 0 && isStanding(u) ? "moved" : "stuck";
  }
  const basic = rules.basicAction ?? 1;
  const where = { doorId: door.id, target: target.spec.name, targetId: target.id };
  // (No hands for a latch: an animal can only break a closed door, as a locked one: behavior/animal.js.)
  if ( !state.locked && !isAnimalistic(u) ) {
    const cost = rules.doorCosts?.open ?? basic;
    if ( !turn.canAfford(cost) ) return "stuck";
    turn.spend(cost);
    openDoor(run, door, state);
    log(run, u, { type: "door", method: "open", success: true, ...where });
    return "worked";
  }
  const plan = doorPlan(run, u, door, state);
  // With nobody on this side to fight, there's nothing better to do, so it keeps at it longer.
  const beyond = beyondIt();
  const urge = held ?? Math.max(CHOICE_LEVEL, levelOf(u, kind, target.id), ...beyond.map(o => levelOf(u, "hurt", o.id)));
  const nothingElse = !enemiesOf(run, u).some(o => isStanding(o) && !beyond.includes(o));
  if ( !plan || plan.turns > patienceFor(urge) * (nothingElse ? 1.5 : 1) * styleOf(u).doorPatience ) return giveUp(beyond);
  if ( !turn.canAfford(plan.cost) ) return "stuck";
  turn.spend(plan.cost);
  if ( plan.method === "attack" ) {
    const roll = rollCheck(rules, run.rng, plan.strike.bonus ?? 0, door.ac, { kind: "attack", roller: u, label: plan.strike.name ?? "", what: "door" });
    let damage = 0;
    if ( roll.degree >= 2 ) {
      const parts = roll.degree === 3 ? (plan.strike.critDamage ?? criticalParts(rules, plan.strike.damage)) : plan.strike.damage;
      const at = diceAt(run);
      const rolled = sampleDamage(parts ?? [], run.rng, 1);
      if ( at >= 0 ) tableRoll(run, at, { by: u, kind: "damage", label: plan.strike.name ?? "", what: "door", parts: parts ?? [], crit: roll.degree === 3 });
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
    // (The system's own try where it has one: Ironsworn's Face Danger, its momentum and price paid. Else a check.)
    const own = rules.tryDoor?.(run, u, door, { method: plan.method, mod: plan.mod, dc: plan.dc }) ?? null;
    const roll = own ?? rollCheck(rules, run.rng, plan.mod, plan.dc, { kind: "check", roller: u, faces: plan.faces, what: "door" });
    const success = own ? !!own.success : roll.degree >= 2;
    if ( success ) openDoor(run, door, state, plan.method === "force");
    else thwart(run, u, kind, target.id, 12);
    log(run, u, own
      ? { type: "door", method: plan.method, success, degree: own.degree, ...(own.said?.text ? { said: own.said.text } : {}), ...where }
      : { type: "door", method: plan.method, success, natural: roll.natural, mod: plan.mod, total: roll.total, dc: plan.dc, degree: roll.degree, ...where });
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
    const c = checkRoll(run, u, how.mod, null, { purpose: "sizeUp", skill: how.skill ?? null });
    const roll = rollCheck(rules, run.rng, c.mod, dc, { advantage: c.advantage, dice: c.dice, kind: "check", roller: u, faces: how.faces, label: how.label ?? "", what: "sizeUp", target: t });
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
export function noteCommand(run, quietly = false) {
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
 * What u wants now, worked out again outside its turn (its side changed: the GM's word, a spell), as its next turn
 * would have it: its tactics' reasoning, its leader's and its party's pull. Nothing told, none of the fight's dice (a
 * throwaway roll of its own), nothing done. For a creature standing and in the fight.
 */
export function rethink(run, u) {
  if ( !u.desire || !u.active || u.status !== STATUS.STANDING ) return;
  const { rng, log: told } = run;
  run.rng = createRng(deriveSeed(run.live?.seed ?? 1, 7919 * (run.round ?? 0) + run.units.indexOf(u) + 1));
  run.log = null;
  try {
    deliberate(run, u);
  } finally {
    run.rng = rng;
    run.log = told;
  }
}

/** A grudge: wary of the one it's against until they go for it (the fearful more), then out for them (as it repays a blow). */
const GRUDGE = Object.freeze({ wary: 50, brave: 0.3, provoked: 60 });
/** The friend its tactics say to guard: as loyal as it is. */
const WARD = Object.freeze({ base: 50, loyal: 0.3 });

/**
 * What u wants this turn, worked out afresh. Nothing on the map changes while it thinks: its reckonings share one look
 * at who it can get at how soon (battle-state.js movesNeeded, run.movesCache).
 */
function deliberate(run, u) {
  const was = run.movesCache;
  run.movesCache = new Map();
  try {
    thinkOver(run, u);
  } finally {
    run.movesCache = was;
  }
}

/**
 * What u wants this turn: its tactics' reasoning (whom it would fight, and the runners-up; whom it would mend; whom it
 * would talk to; whom it fears), on top of what it was told to want and what the fight has stirred.
 */
function thinkOver(run, u) {
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
  // (As urgent as the need: a friend down, as pressing as anything; one nearly so, nearly as much.)
  if ( u.prep.healActions?.length ) for ( const { ally, score } of healScores(run, u) ) think(u, "heal", ally.id, Math.max(45, 20 + 20 * score, healUrgency(ally)));
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
  for ( const [id, g] of u.grudges ?? [] ) if ( !g.provoked ) think(u, "avoid", id, GRUDGE.wary + (50 - liveTrait(run, u, "brave")) * GRUDGE.brave);
  // Not one for killing: an enemy talked out of the fight is someone to talk away (or over), not to cut down.
  u.peace = null;
  // (As strongly as its answer leans to avoiding killing.)
  if ( wish(u.spec.avoidKilling) && run.neutral && run.prep.options.talking && canTalk(u) && u.tac?.talk !== "never" ) {
    u.peace = peaceDesires(run, u, Math.max(40, ...[...u.desire.logic.values()]) * wish(u.spec.avoidKilling));
  }
  if ( u.tac?.target === "protect" ) {
    const ward = run.units.find(a => a !== u && a.side === u.side && isStanding(a) && run.units.some(e => e.targetId === a.id && isStanding(e) && areEnemies(run, a, e)));
    if ( ward ) think(u, "protect", ward.id, WARD.base + (liveTrait(run, u, "loyal") - 50) * WARD.loyal);
  }
  // Foes who fall, as it answered (or its party did): finish them off, tie them up, rob them (behavior/fallen.js).
  fallenWishes(run, u);
  // What its conditions make it want: away from whoever frightened it, at whoever holds it.
  conditionWishes(run, u);
  holdWishes(run, u);
  // Badly hurt, it loses heart for foes it would have to cross the field to reach.
  if ( u.maxHp > 0 && u.hp / u.maxHp < 0.35 ) for ( const x of scored ) if ( x.moves >= 2 ) thwart(run, u, "hurt", x.t.id, 5);
  // Its playstyle's leanings (the weakest, the fallen, a friend to guard, something to fear ...).
  styleWants(run, u, scored, { canHeal: !!u.prep.healActions?.length, canTalk: !!talkTarget, talkTarget, canAid: !!u.prep.buffActions?.length });
  partyWants(run, u, scored, { canHeal: !!u.prep.healActions?.length });
  // Focus fire: the foes its team has already hit, the more for the tactical (behavior/focus.js).
  focusWants(run, u, scored);
  // What its leader and its friends want pulls on it too (for most, the leader more than the crowd).
  listen(run, u, { canHeal: !!u.prep.healActions?.length, canTalk: (u.prep.talkAffinity ?? 0) > 0, canAid: !!u.prep.buffActions?.length });
  // Friends asking it for a buff, who can make themselves understood: a willing one wants to oblige.
  heed(run, u, { canAid: !!u.prep.buffActions?.length, understands: (a, b) => !a.spec.social?.mindless && !b.spec.social?.mindless && shareLanguage(a, b, run) });
  // A smart one keeps near its team: less of what would take it well away (behavior/together.js).
  keepTogether(run, u);
  remember(run, u);
  // Under someone's control: what its controller wants, and nothing of its own.
  puppetWishes(run, u);
  // What it can't work on now sinks to the bottom; still out of reach since its last turn, given up (behavior/hopeless.js).
  sinkHopeless(run, u, rankedDesires(run, u));
  // What it means to do, in order: its top what it works on now.
  orderAgenda(run, u);
  focusAgenda(run, u);
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
    const at = diceAt(run);
    if ( a.recharge ) {
      const die = run.rng.die(a.recharge.die ?? 6);
      back = die >= (a.recharge.on ?? 6);
      if ( at >= 0 ) tableRoll(run, at, { by: u, kind: "recharge", label: a.name ?? "", total: die, dc: a.recharge.on ?? 6 });
    } else {
      u.readyAt ??= {};
      if ( u.readyAt[a.id] === undefined ) {
        let rounds = 0;
        for ( let i = 0; i < (a.cooldown.n ?? 1); i++ ) rounds += run.rng.die(a.cooldown.faces ?? 4);
        if ( at >= 0 ) tableRoll(run, at, { by: u, kind: "recharge", label: a.name ?? "", what: "cooldown", total: rounds });
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
 * What a critical hit with a Strike brings back (action.rechargeOnCrit: PF2e Draconic Momentum recharges a dragon's
 * Breath Weapon), whenever the crit comes: its uses back, and any wait it had left forgotten.
 */
function rechargeOnCrit(run, u) {
  for ( const a of u.spec.actions ) {
    if ( !a.rechargeOnCrit || !Number.isFinite(a.uses) || (u.uses[a.id] ?? 0) >= a.uses ) continue;
    u.uses[a.id] = a.uses;
    if ( u.readyAt ) delete u.readyAt[a.id];
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
    if ( run.log ) run.log.splice(at, 0, { round: run.round, turn: run.turn ?? 0, turnOf: run.turnOf ?? null, actor: u.spec.name, actorId: u.id, side: u.side, type: "peacekeep" });
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
  if ( kinsQuarrel(run, u, say) ) return true;
  // One who can't abide violence, seeing a fight, tries to stop it. Otherwise, leaning toward a side, it may get
  // involved (mostly not, unless that side is one it likes and looks like winning: neutral.js meddling): talking the
  // side it likes least out of the fight.
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
  const actions = turn.howMany(rules.talkCost ?? rules.basicAction ?? 1);
  if ( !keepsPeace(run, u, actions) && !observes(run, u, turn) ) standoffPitching(run, u, standoffPitches(run, u, actions));
  u.turnsTaken += 1;
  endOfTurn(run, u);
}

/**
 * Before a standoff breaks, a charismatic NPC leader may take one more turn to press the player characters to back
 * off (once per side). Returns true if that settled it.
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
  // (One that calls creatures on its turn, an environment's: Daggerheart's Patient Hunter. No tactics hold it back.)
  const summon = decideSummon(run, u, turn, { always: true });
  if ( summon ) {
    turn.spend(costOf(run.prep.rules, summon, u));
    executeSummon(run, u, summon);
    spendUse(u, summon);
  }
  for ( let tries = 0; tries < 6 && !battleOver(run); tries++ ) {
    // (Someone in its reach, and what it needs first, where it needs something: requires.js.)
    const ready = a => { const t = nextTargetInReach(run, u, a); return !!t && meets(run, u, a, t); };
    const action = u.prep.offense.find(a => turn.canAfford(costOf(run.prep.rules, a, u)) && hasUses(u, a) && ready(a));
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

/**
 * What comes back at the start of a creature's turn, whoever plays it: its shield is down until it raises it again,
 * being hurt since its last turn means it's being hurt now, its reaction returns, what recharges may, the system has
 * its say, legendary actions come back.
 */
export function turnUpkeep(run, u) {
  const rules = run.prep.rules;
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
}

/**
 * Does an effect run out by its source's turns (until: "source"), its source still there to take them? Else its bearer's
 * turns run it out (its source down, dead or gone).
 */
const bySource = (run, e) => e.until === "source" && !!e.sourceId && isUp(run.byId.get(e.sourceId) ?? { status: null });

/** A grab that lasted as long as what it laid with it (PF2e's, until the grabber's next turn), let go with it. */
function grabLapsed(u) {
  if ( u.grabbedBy && u.grabKey && !(u.effects ?? []).some(e => e.key === u.grabKey && e.sourceId === u.grabbedBy) ) {
    u.grabbedBy = null;
    u.grabKey = null;
  }
}

/**
 * A round of u's turns gone by: its effects whose time is up end (and what they did to its conditions and its side), and
 * so do those it laid on others to last until the end of its own turns (until: "source"; a grab with them).
 */
export function tickEffects(run, u) {
  let ended = false;
  for ( const o of run.units ) {
    if ( !o.effects?.length ) continue;
    const ticks = o === u ? e => !bySource(run, e) : e => e.sourceId === u.id && bySource(run, e);
    let ticked = false;
    for ( const e of o.effects ) {
      if ( !ticks(e) ) continue;
      e.rounds -= 1;
      ticked = true;
    }
    if ( !ticked ) continue;
    const before = o.effects.length;
    o.effects = o.effects.filter(e => e.rounds > 0);
    if ( o.effects.length === before ) continue;
    recomputeConditions(o);
    if ( o !== u ) grabLapsed(o);
    ended = true;
  }
  if ( ended ) settleSides(run);
}

/**
 * A try at breaking a hold: the system's way or its escape against it (behavior/holds.js), loose on a success, told, and
 * what the try did to whoever holds it (harmHolder: PF2e's cutting free of a gullet), whichever way it's tried.
 */
function attemptEscape(run, u, hold) {
  const got = tryHold(run, u, hold);
  if ( got.success ) release(run, u, hold);
  log(run, u, { type: "escape", hold: hold.key, success: got.success, ...rollOf(got), ...(got.said?.text ? { said: got.said.text } : {}) });
  harmHolder(run, u, hold, got);
  return got;
}

/**
 * A prisoner struggling (tied up and awake, getting loose what it wants most): against its bonds, the system's way or its
 * escape against them (behavior/holds.js); loose, it's in the fight again from its next turn.
 */
function struggle(run, u) {
  if ( !u.active ) return;
  const hold = holdsOf(run, u).find(h => h.key === "bound");
  if ( hold ) attemptEscape(run, u, hold);
}

/**
 * Held fast as its turn begins: it breaks free when that's what it most wants (the system's way, or its escape
 * against the hold, for what it costs). A grab with nothing to go on: it tries at once, an even chance, as the engine
 * always had it.
 */
function breakFree(run, u, turn) {
  const rules = run.prep.rules;
  for ( const hold of ownHolds(run, u) ) {
    if ( hold.key === "bound" ) continue;
    if ( hold.key === "grabbed" && !known(run, u, hold) ) {
      const basic = rules.basicAction ?? 1;
      if ( !turn.canAfford(basic) ) return;
      turn.spend(basic);
      const escaped = run.rng.chance(0.5);
      if ( escaped ) u.grabbedBy = null;
      log(run, u, { type: "escape", success: escaped });
      continue;
    }
    if ( mind(run, u).lead?.kind !== "breakFree" ) return;
    const cost = escapeCost(rules, u, hold, run);
    if ( !turn.canAfford(cost) ) return;
    turn.spend(cost);
    attemptEscape(run, u, hold);
  }
}

/**
 * What a try at breaking a hold did to whoever holds it, as the system's try says (got.harm {byType}: damage as rolled,
 * before the holder's resistances; PF2e: cutting itself free of a gullet hurts the swallower).
 */
function harmHolder(run, u, hold, got) {
  const holder = hold.byId ? run.byId.get(hold.byId) : null;
  const byType = got?.harm?.byType;
  if ( !holder || !isUp(holder) || !byType || typeof byType !== "object" ) return;
  const amount = run.prep.rules.applyIwr(iwrOf(holder), byType, holder);
  if ( amount > 0 ) dealDamage(run, u, holder, amount, { types: Object.keys(byType), byType });
}

/**
 * Something bothering it that an action ends (a burn, a bleed, the system's remedies: holds.js remediesOf), and being
 * rid of it what it most wants: it tries, for what it costs, the worst of it first.
 */
function getRid(run, u, turn) {
  // (Not bothered by anything at all: nothing to ask its mind.)
  if ( levelOf(u, "rid", u.id) <= 0 || mind(run, u).lead?.kind !== "rid" ) return;
  const r = remediesOf(run, u).find(x => x.key === u.ridOf) ?? remediesOf(run, u)[0];
  if ( !r || !turn.canAfford(r.cost) ) return;
  turn.spend(r.cost);
  const got = r.try(run, u) ?? { success: false };
  log(run, u, { type: "remedy", what: r.key, damageType: r.type ?? null, label: r.label ?? null, condition: r.condition ?? null, success: !!got.success, ...(got.said?.text ? { said: got.said.text } : {}) });
}

export function takeTurn(run, u) {
  carryInside(run); // (those inside another: where it went)
  stayBound(run, u, logger(run)); // (come to since, tied up)
  // Tied up: what it wants, as it is. Getting loose: it struggles. Something it can do from its bonds (and it bears
  // them): a turn from where it lies, with nothing that needs hands.
  if ( u.status === STATUS.BOUND ) {
    if ( !u.active ) return;
    deliberate(run, u);
    if ( mind(run, u).lead?.kind === "breakFree" || !actsHeld(run, u) ) return struggle(run, u);
    u.status = STATUS.STANDING;
    u.thought = true;
    try {
      return playFromHere(run, u);
    } finally {
      u.thought = false;
      if ( isBound(u) && u.status === STATUS.STANDING ) u.status = STATUS.BOUND;
    }
  }
  return playFromHere(run, u);
}

/** The rest of a creature's turn (takeTurn): all of it, but for one tied up who acts from its bonds. */
function playFromHere(run, u) {
  const { rules, options } = run.prep;
  run.movesCache = null; // (none left over: a turn broken off, a turn played again)
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
  turnUpkeep(run, u);
  // Surprised, where it costs that (5e's 2014 rules): its first turn goes by, and with it what kept it from reacting.
  if ( !u.turnsTaken && run.surprise?.surprised?.includes(u.id) && u.status === STATUS.STANDING ) {
    log(run, u, { type: "surprised" });
    u.turnsTaken += 1;
    return endOfTurn(run, u);
  }

  settleSides(run); // holds that took or ended since this creature's last turn
  startHarm(run, u); // (what harms it as its turn starts: 5e's Burning)
  regenerate(run, u);
  if ( run.foeAuras ) auraTurnStart(run, u, AURA_PLAY); // (a foe's aura it starts its turn in: behavior/auras.js)
  // (Come to tied up: a prisoner now. One acting from its bonds this turn knows it already.)
  if ( u.status === STATUS.DEAD || (!u.thought && stayBound(run, u, logger(run))) ) return endOfTurn(run, u);
  if ( u.status === STATUS.DOWN && u.held ) return endOfTurn(run, u); // (held at the edge by its regeneration)
  if ( u.status === STATUS.DOWN ) {
    if ( options.downedModel === DOWNED_MODELS.SIMULATE && rules.recoveryCheck && !systemOwns(run, u, "recovery") ) {
      fateful(run, u, null, () => {
        const before = u.dying;
        const said = recoveryOf(recoveryCheck(run, u), u);
        if ( said ) log(run, u, { ...said, type: "recovery", before, dying: u.dying, dead: u.status === STATUS.DEAD, stable: u.stable });
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
  // (Its movement as the turn begins: a turn that spends nothing of it, nor anything else, was idle: fidget.)
  const moveAtStart = turn.pools.move ?? 0;
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
  // Leaving the fight: off the map, as fast as it goes; stopped on its way, this turn goes to what stopped it
  // (behavior/leaving.js).
  dealsWithIt(u);
  if ( isLeaving(u) ) return leavingTurn(run, u, turn);
  // Slacking (the Lazy playstyle): with no foe beside it and its wounds not pressing, now and then it just doesn't.
  if ( slacksOff(run, u) ) {
    log(run, u, { type: "lazy", chose: true });
    return;
  }
  const morale = checkMorale(run, u);
  if ( morale === MORALE.ROUT && runs(run, u, turn, { why: "breaks" }) ) return;
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

  // What it wants this turn, and what that means: a terror close at hand sends it running. (Tied up, it thought already.)
  if ( !u.thought ) deliberate(run, u);
  const wants = mind(run, u);
  if ( wants.lead?.kind === "avoid" && levelOf(u, "avoid", wants.lead.targetId, { conditions: false }) >= 70 ) {
    const dread = run.byId.get(wants.lead.targetId);
    const d = dread ? edgeDistance(u, dread) : null;
    if ( dread && (d === null || d <= 30) && runs(run, u, turn, { why: "dread", dread: dread.spec.name }) ) return;
  }

  if ( u.prone && u.wasDowned && u.tac?.selfRevived === "retreat" && runs(run, u, turn, { why: "revived" }) ) return;
  if ( u.tac?.allyDying === "retreat" && run.units.some(a => a.side === u.side && a !== u && a.status === STATUS.DOWN && a.active)
    && runs(run, u, turn, { why: "allyFalls" }) ) return;

  u.usedThisTurn = null; // once-per-turn riders such as sneak attack
  freshTurn(u); // (no Strikes yet this turn, for what needs them: requires.js)
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
  u.turnAttacks = 0;
  u.fellBack = false;
  u.allOut = false;
  // (A kiter, falling back out of reach as foes close: behavior/prepare.js.)
  const kiting = (Number(behavior.kite) || 0) > 0 && !!run.prep.options.positioning && !!u.pos;
  // What getting ready for next turn takes of the simulator's own (behavior/prepare.js).
  const prepKit = {
    say: logger(run),
    shield: t => (u.spec.shield && !u.shieldRaised && u.tac?.shield !== "never" && t.canAfford(rules.shieldCost ?? basic)
      ? { step: "shield", cost: normalizeCost(rules, rules.shieldCost ?? basic), worth: shieldWorth(run, u) } : null),
    raise: t => {
      u.shieldRaised = true;
      t.spend(rules.shieldCost ?? basic);
      log(run, u, { type: "shield" });
    },
    stand: x => {
      if ( !provoke(run, x, "foeMovesInReach") ) return false;
      x.prone = false;
      log(run, x, { type: "stand", prepared: true });
      return true;
    },
    walk: (x, t, spot, toward, step) => walkTo(run, x, t, spot, toward ?? nearestFoeOf(run, x) ?? x, step)
  };
  // What patrolling and fidgeting take of the simulator's own (behavior/patrol.js).
  const patrolKit = {
    say: logger(run),
    toward: t => patrolToward(run, u, turn, t),
    walk: (spot, purpose) => patrolWalk(run, u, turn, spot, purpose),
    hide: () => hideNow(run, u, turn)
  };
  // (Prone: up, unless it bears it this turn, a selfless one fighting on from the ground.)
  if ( u.prone && !(run.prep.options.ignoreTroubles > 0 && bears(run, u)) ) {
    const stand = rules.standCost ? rules.standCost(u) : basic;
    if ( turn.canAfford(stand) ) {
      turn.spend(stand);
      // (Getting up in a foe's reach may draw a strike: PF2e.)
      if ( !provoke(run, u, "foeMovesInReach") ) return;
      u.prone = false;
      log(run, u, { type: "stand" });
    }
  }
  breakFree(run, u, turn);
  getRid(run, u, turn);

  // Running for help: head toward an ally who hasn't joined yet and shout.
  const helper = turn.left > 0 && canMove(run, u) ? wantsHelp(run, u) : null;
  if ( helper && leaveReach(run, u, turn, helper) ) {
    for ( let n = 0; n < MAX_STEPS_PER_TURN; n++ ) {
      const budget = turn.payForMove(approach(run, u, helper).speed);
      if ( !budget ) break;
      const move = moveToward(run, u, helper, 5, budget);
      turn.usedMove(move.cost);
      if ( !moveLog(run, u, move, helper, "help") ) break;
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

  // A leader in the fight calls in its people who aren't.
  callToArms(run, u, turn, basic);

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

  // The top of what it means to do first (behavior/desire.js orderAgenda), for one that acts on impulse (instinctive or
  // less); once it has acted on that, what comes next on it (its second and third) too; the rest waits until the top
  // can't be done any more this turn (then everything's open). One that thinks (competent and better) has its top lead,
  // and goes about it in the order its tactics make sense of (a bonus-action heal before the blow, say).
  const leadGroup = AGENDA_GROUPS[mind(run, u).lead?.kind] ?? null;
  const nextGroups = new Set((u.agenda ?? []).slice(1, 3).map(k => AGENDA_GROUPS[k.slice(0, k.indexOf("|"))]).filter(Boolean));
  let opened = !leadGroup || liveTier(run, u) >= TACTICAL.COMPETENT;
  let leadActed = false;
  const waits = group => !opened && group !== leadGroup && !(leadActed && nextGroups.has(group));
  const openUp = () => !opened && (opened = true);
  const acted = group => { if ( group === leadGroup ) leadActed = true; };
  // (Each step, until it does something, it decides with one look at the map: battle-state.js movesNeeded. The look
  // goes the moment anything happens.)
  const happens = () => { run.movesCache = null; };
  // (No foe it knows of to go for, as the loop found: it may patrol, behavior/patrol.js.)
  let lacked = false;
  // (Struck down mid-turn, by a reaction to a move: answerMove. Its turn is over.)
  const fightOn = () => {
    for ( let step = 0; turn.any && step < MAX_STEPS_PER_TURN && !battleOver(run) && isStanding(u); step++ ) {
      run.movesCache = new Map();
      let heal = waits("heal") ? null : decideHeal(run, u, turn);
      // (An enabler bolsters its friends first, and heals one only when it has nothing to give: never one that's down.)
      if ( heal && (Number(behavior.enable) || 0) > 0 && heal.target.status !== STATUS.DOWN && decideBuff(run, u, turn) ) heal = null;
      // (Healing it means to give and can't this turn: on its way to the friend, or the potion got out, for the next:
      // behavior/prepare.js.)
      if ( !heal && leadGroup === "heal" ) {
        const ahead = healAhead(run, u, turn);
        if ( ahead && tendAhead(run, u, turn, ahead) ) {
          acted("heal");
          happens();
          continue;
        }
      }
      if ( !heal && leadGroup === "heal" && openUp() ) continue;
      if ( heal ) {
        acted("heal");
        happens();
      }
      if ( heal?.moves > 0 ) {
        // Go to them first (a touch spell, or out of range).
        if ( !leaveReach(run, u, turn, heal.target, costOf(rules, heal.action)) ) break;
        const budget = turn.payForMove(approach(run, u, heal.target).speed);
        if ( !budget ) break;
        const move = moveToward(run, u, heal.target, heal.action.range ? null : (heal.action.reach ?? 5), budget, heal.action.range ? { range: heal.action.range.max ?? heal.action.range.increment * 3 } : {});
        turn.usedMove(move.cost);
        moveLog(run, u, move, heal.target, "tend");
        continue;
      }
      if ( heal ) {
        // (A potion it gets out first: its cost said so. Engine/gear.js.)
        const cost = costOf(rules, heal.action, u);
        readyNow(u, heal.action, logger(run));
        executeHeal(run, u, heal.action, heal.target);
        used(u, heal.action);
        turn.spend(cost);
        u.actsThisTurn += 1;
        continue;
      }
      // Call creatures to fight beside it, when they'd do more over the fight than its own blows.
      const summon = waits("fight") ? null : decideSummon(run, u, turn);
      if ( summon ) {
        happens();
        turn.spend(costOf(rules, summon, u));
        executeSummon(run, u, summon);
        spendUse(u, summon);
        u.actsThisTurn += 1;
        continue;
      }
      // Bolster a friend (or itself) when that does more than attacking would.
      const buff = waits("aid") ? null : decideBuff(run, u, turn);
      if ( !buff && leadGroup === "aid" && openUp() ) continue;
      if ( buff ) {
        happens();
        acted("aid");
        turn.spend(costOf(rules, buff.action, u));
        executeBuff(run, u, buff.action, buff.targets, buff.worth, turn);
        u.actsThisTurn += 1;
        continue;
      }
      // Tie up (or rob) a fallen foe, when that's what it most wants and it can get to it this turn.
      const fallen = waits("fallen") ? null : decideFallen(run, u, turn);
      if ( !fallen && leadGroup === "fallen" && openUp() ) continue;
      if ( fallen ) {
        acted("fallen");
        happens();
      }
      if ( fallen?.moves > 0 ) {
        if ( !leaveReach(run, u, turn, fallen.target, fallen.cost) ) break;
        const budget = turn.payForMove(approach(run, u, fallen.target).speed);
        if ( !budget ) break;
        const move = moveToward(run, u, fallen.target, 5, budget);
        turn.usedMove(move.cost);
        moveLog(run, u, move, fallen.target);
        continue;
      }
      if ( fallen ) {
        turn.spend(fallen.cost);
        if ( fallen.kind === "free" ) freeFriend(run, u, fallen.target, fallen.hold, logger(run));
        else (fallen.kind === "bind" ? bind : rob)(run, u, fallen.target, logger(run));
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
      if ( !target ) {
        if ( openUp() ) continue;
        lacked = true;
        break;
      }
      // A thief may rob someone within reach instead of hitting them (once a turn).
      if ( !u.stoleThisTurn ) {
        u.stoleThisTurn = true;
        const mark = theftTarget(run, u);
        const chance = mark ? stealChance(run, u, mark) : 0;
        const plan = chance > 0 ? theftPlan(run, u, mark) : null;
        if ( plan && turn.canAfford(plan.cost) && run.rng.chance(chance) ) {
          happens();
          turn.spend(plan.cost);
          const result = attemptTheft(run, u, mark, logger(run), { plan, attacksMade });
          attacksMade += result.attacks ?? 0;
          continue;
        }
      }
      u.targetId = target.id;
      const option = bestOptionVs(run, u, target, attacksMade, turn);
      if ( !option ) {
        if ( openUp() ) continue;
        break;
      }
      acted("fight");
      happens();
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
        const move = moveToward(run, u, target, option.action.range ? null : (option.action.reach ?? 5), budget, option.action.range ? { range: option.action.range.max ?? option.action.range.increment * 3 } : {});
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
        // Not this turn: what its gear still needs (drawn, loaded) done now, for the next (behavior/prepare.js), unless a
        // raised shield is worth more.
        const ready = gearStep(run, u, turn, option.action, target);
        if ( ready && ready.worth >= PREP.least && !(canShield && tier >= TACTICAL.INSTINCTIVE && shieldWorth(run, u) > ready.worth) ) {
          takeGearStep(run, u, turn, ready, logger(run));
          continue;
        }
        if ( canShield && tier >= TACTICAL.INSTINCTIVE ) { raiseShield(); continue; }
        if ( openUp() ) continue;
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

      // Its last action, after two blows (a kiter's, after one): a better spot for the round to come, or what else it would
      // get ready, where that's worth more than one more blow at its worst (behavior/prepare.js: the spare turn after the
      // loop takes it). A kiter in a foe's reach falls back first, and shoots with what's left.
      if ( (attacksMade >= 2 || (kiting && attacksMade >= 1)) && turn.howMany(basic) <= 1 && option.moves === 0 ) {
        const spare = spareBest(run, u, turn, prepKit);
        if ( spare && spare.worth > option.ev ) break;
      }
      if ( kiting && !u.fellBack && option.moves === 0 && threats(run, u).length ) {
        const back = bestSpot(run, u, turn);
        if ( back && (back.step === "fallBack" || back.step === "hitAndRun") && back.gain > expectedDamage(run, u, option.action, target, attacksMade + Math.max(0, turn.howMany(option.cost) - 1)) ) {
          u.fellBack = true;
          const from = nearestFoeOf(run, u);
          tellStep(u, { step: "fallBack", desire: "avoid", target: from }, logger(run));
          if ( !walkTo(run, u, turn, back, from ?? u, "fallBack") ) break;
          continue;
        }
      }
      // (Its gear made ready first, where it isn't: drawn, loaded. Its cost said so: engine/gear.js.)
      readyNow(u, option.action, logger(run));
      // Moving a mark to a new foe (Hunter's Mark) while still holding it costs no new slot.
      const holding = option.action.concentration && u.concentration?.actionId === option.action.id && holdsAnything(run, u);
      // An action that moves first (Sudden Charge): up to the foe, as part of it.
      if ( option.action.charge && option.action.melee && !u.adjacent.has(target.id) && canMove(run, u) ) {
        const move = moveToward(run, u, target, option.action.reach ?? 5, approach(run, u, target).speed * option.action.charge);
        if ( !moveLog(run, u, move, target, "approach") ) break;
      }
      if ( option.action.oncePerTurn ) (u.usedThisTurn ??= new Set()).add(option.action.id);
      // (A damage-dealer holding nothing back: the first slot, focus or bomb it spends on a blow this turn, told.)
      if ( (Number(behavior.dps) || 0) > 0 && !u.allOut && (option.action.resource || Number.isFinite(option.action.uses)) ) {
        u.allOut = true;
        log(run, u, { type: "allOut", action: option.action.name ?? "" });
      }
      executeOffense(run, u, option.action, target, attacksMade);
      used(u, option.action); // (a shot fired: loaded no more; a bomb thrown: gone from the hand)
      setupUsed(u, option.action); // (what set it up, used up: Rend wants two fresh hits)
      settleSides(run);
      if ( option.action.concentration && u.concentration?.actionId === option.action.id ) noteConcentration(u, option.ev);
      if ( !holding || !option.action.freeWhileHeld ) spendUse(u, option.action);
      turn.spend(option.cost);
      attacksMade += attacksIn(option.action);
      u.turnAttacks = attacksMade;
      u.actsThisTurn += 1;
      if ( battleOver(run) ) break;
    }
  };
  fightOn();
  happens();
  // What's left of the turn, for the next (behavior/prepare.js): its gear made ready, a potion got out, a better spot to
  // end on, a shield up; what it found nothing better to do with.
  if ( isStanding(u) && !battleOver(run) ) spareTurn(run, u, turn, prepKit);
  happens();
  // Nothing better to do, and no foe it knows of: it looks for one (behavior/patrol.js). Found, it fights at once with
  // what's left of its turn.
  if ( lacked && turn.any && !battleOver(run) && ableToAct(run, u) && mayPatrol(run, u) && patrolTurn(run, u, turn, patrolKit) ) {
    happens();
    lacked = false;
    if ( turn.any && isStanding(u) && !battleOver(run) ) fightOn();
    happens();
    if ( isStanding(u) && !battleOver(run) ) spareTurn(run, u, turn, prepKit);
  }
  happens();
  // Its turn spent on nothing at all: now and then it fidgets (behavior/patrol.js).
  if ( turn.acts === 0 && (turn.pools.move ?? 0) >= moveAtStart && inFight(u) && ableToAct(run, u) && !battleOver(run) ) fidget(run, u, turn, patrolKit);
  happens();

  u.turnsTaken += 1;
  run.acting = null;
  endOfTurn(run, u);
}

/**
 * The end of its turn, for the core's own conditions (engine/conditions.js PROFILES) the system says nothing of: what
 * harms it each turn (a fire, a bleed, radiation, a gullet's acid; at the start of it instead where the profile says
 * so: startHarm); one frozen solid tries to break out, all it can do;
 * a countdown runs on (a parasite growing, its breath running out) and, at its end, what comes (it tears free; it
 * passes out); and what it carries spreads to whoever stands beside it (a save, or caught).
 */
function conditionUpkeep(run, u) {
  if ( [STATUS.DEAD, STATUS.FLED].includes(u.status) || !profiled(u).length ) return;
  const rules = run.prep.rules;
  for ( const [key, v, p] of profiled(u) ) {
    // (Its harm, at the end of its turn unless the profile says the start: startHarm.)
    if ( p.harm && (p.harmAt ?? "end") === "end" ) {
      conditionHarm(run, u, key, v, p);
      if ( u.status === STATUS.DEAD ) return;
    }
    if ( p.hold && p.act === false && u.status === STATUS.STANDING ) {
      const hold = holdsOf(run, u).find(h => h.key === key && h.core);
      if ( hold ) attemptEscape(run, u, hold);
    }
  }
  for ( const [key, v, p] of profiled(u) ) {
    if ( !p.grows ) continue;
    const most = p.most ?? v + 1;
    if ( v < most ) {
      setConditionValue(u, key, v + 1);
      if ( run.log ) log(run, u, { type: "worsens", condition: key, value: v + 1, most });
      continue;
    }
    // (Its end: whatever grew in it tears free, or it passes out; either way, it falls.)
    setConditionValue(u, key, 0);
    log(run, u, { type: p.term === "burst" ? "burst" : "suffocates", condition: key });
    if ( u.status === STATUS.STANDING ) dealDamage(run, layerOf(run, u, key), u, u.hp + (u.temp ?? 0) + (u.stamina ?? 0), { lingering: true });
    if ( u.status === STATUS.DEAD ) return;
  }
  if ( u.status !== STATUS.STANDING ) return;
  for ( const [key, v, p] of profiled(u) ) {
    if ( !p.spreads ) continue;
    const dc = typical(rules, "dc", u.spec.level ?? 0) + 2 * (v - 1);
    for ( const o of run.units ) {
      if ( o === u || !isUp(o) || o.spec.hazard || (o.conds?.[key] ?? 0) > 0 || hasTrait(o, "untouchable") ) continue;
      if ( o.spec.iwr?.immune?.some(k => k === "disease" || k === key) ) continue;
      const near = u.adjacent?.has(o.id) || (u.pos && o.pos && (edgeDistance(u, o) ?? Infinity) <= 5.5);
      if ( !near ) continue;
      const s = saveRoll(run, o, toughSave(run, o));
      const rolled = systemRolled(run, o, "save", { dc, from: u, save: toughSave(run, o), label: key });
      const roll = rollCheck(rules, run.rng, s.mod, dc, { advantage: s.advantage, dice: s.dice, kind: "save", roller: o, rolled, what: "spread", target: u });
      if ( roll.degree >= 2 ) continue;
      applyOutcome(o, { conditions: { [key]: 1 }, rounds: 999, label: "" }, u.id, { id: `spread:${key}` });
      log(run, o, { type: "spread", condition: key, by: u.spec.name, byId: u.id, natural: roll.natural, mod: s.mod, total: roll.total, dc, degree: roll.degree });
    }
  }
}

/**
 * One of the core's conditions harming it, now: the system's own say first, its harm in its own terms (Ironsworn's a
 * point; behavior/troubles.js harmParts), else by its value, or by the level of whoever laid it. Told, and dealt by
 * whoever laid it.
 */
function conditionHarm(run, u, key, v, p) {
  const rules = run.prep.rules;
  const by = layerOf(run, u, key);
  const parts = harmParts(run, u, key, v, p, by);
  if ( !parts.length ) return;
  const at = diceAt(run);
  const rolled = sampleDamage(parts, run.rng);
  const shown = at >= 0 ? tableRoll(run, at, { by: u, target: u, kind: "damage", what: "persistent", parts }) : null;
  const amount = landsRolled(run, by, u, shown, rules.applyIwr(iwrOf(u), rolled.byType, u));
  const types = Object.keys(rolled.byType);
  const entry = log(run, u, { type: "persistent", damageType: types[0] ?? p.harm[1], amount, condition: key });
  dealDamage(run, by, u, amount, { types, lingering: true, entry });
}

/**
 * The start of its turn, for the core's own conditions whose harm comes then (a profile's harmAt "start", as the system
 * may say: 5e's Burning, a gullet's acid).
 */
function startHarm(run, u) {
  if ( [STATUS.DEAD, STATUS.FLED].includes(u.status) ) return;
  for ( const [key, v, p] of profiled(u) ) {
    if ( !p.harm || p.harmAt !== "start" ) continue;
    conditionHarm(run, u, key, v, p);
    if ( u.status === STATUS.DEAD ) return;
  }
}

/**
 * In a live battle, does the game system already do this for u itself (its recovery checks, its persistent damage)?
 * Then the engine leaves it be. Never, in a simulated fight.
 */
const systemOwns = (run, u, what) => !!run.live?.systemOwns?.(u, what);

export function endOfTurn(run, u) {
  const rules = run.prep.rules;
  backOnItsWay(run, u); // (stopped on its way off the map, and this turn given to that: going again)
  conditionUpkeep(run, u);
  // A save at the end of each of its turns may shake an effect off (5e Hold Person).
  if ( isUp(u) && u.effects?.some(e => e.repeatSave) && !systemOwns(run, u, "repeatSaves") ) {
    for ( const e of [...u.effects] ) {
      if ( !e.repeatSave ) continue;
      const s = saveRoll(run, u, e.repeatSave.type);
      const rolled = systemRolled(run, u, "save", { dc: e.repeatSave.dc, save: e.repeatSave.type, label: e.label ?? "" });
      const roll = rollCheck(rules, run.rng, s.mod, e.repeatSave.dc, { advantage: s.advantage, dice: s.dice, kind: "save", roller: u, rolled, label: e.label ?? "", what: "repeatSave" });
      if ( roll.degree < 2 ) continue;
      u.effects.splice(u.effects.indexOf(e), 1);
      recomputeConditions(u);
      log(run, u, {
        type: "shakeOff", effect: e.label ?? "", saveType: e.repeatSave.type, natural: roll.natural, mod: s.mod, total: roll.total, dc: e.repeatSave.dc, degree: roll.degree
      });
    }
  }
  tickEffects(run, u);
  // (A grab that lasts as long as what it laid with it: let go with it.)
  grabLapsed(u);
  if ( u.persistent.length && !systemOwns(run, u, "persistent") ) {
    const remaining = [];
    for ( const entry of u.persistent ) {
      const at = diceAt(run);
      const own = rules.applyIwr(iwrOf(u), { [entry.part.type]: Math.max(0, samplePart(entry.part, run.rng)) });
      const shown = at >= 0 ? tableRoll(run, at, { by: u, target: u, kind: "damage", what: "persistent", parts: [{ ...entry.part, persistent: false }] }) : null;
      const amount = landsRolled(run, run.byId.get(entry.sourceId) ?? u, u, shown, own);
      const told = log(run, u, { type: "persistent", damageType: entry.part.type, amount });
      dealDamage(run, run.byId.get(entry.sourceId), u, amount, { types: [entry.part.type], lingering: true, entry: told });
      if ( !persistentEnds(run, u, entry.part.type) ) remaining.push(entry);
    }
    u.persistent = remaining;
  }
  if ( u.afflictions.length && u.status !== STATUS.DEAD && !systemOwns(run, u, "afflictions") ) {
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
      // (No save to work it off, or settled for the fight: it stays as it is.)
      if ( !a.spec.save || a.settled ) continue;
      const { mod, advantage, dice } = saveRoll(run, u, a.spec.save.type);
      if ( a.spec.tally ) {
        // (5e's way: saves counted, until enough of one or the other.)
        const rolled = systemRolled(run, u, "save", { dc: a.spec.save.dc, save: a.spec.save.type, action: a.spec });
        const roll = rollCheck(rules, run.rng, mod, a.spec.save.dc, { advantage, dice, kind: "save", roller: u, rolled, label: a.spec.name ?? "", what: "affliction" });
        const saved = roll.degree >= 2;
        a.cured = (a.cured ?? 0) + (saved ? 1 : 0);
        a.kept = (a.kept ?? 0) + (saved ? 0 : 1);
        const said = { name: a.spec.name, natural: roll.natural, mod, total: roll.total, dc: a.spec.save.dc, degree: roll.degree };
        if ( a.cured >= (a.spec.tally.cure ?? 3) ) {
          u.afflictions.splice(u.afflictions.indexOf(a), 1);
          log(run, u, { type: "afflictionEnd", ...said });
        } else if ( a.kept >= (a.spec.tally.keep ?? 3) ) {
          a.settled = true;
          log(run, u, { type: "afflictionSettles", ...said });
        } else log(run, u, { type: "afflictionSave", saveType: a.spec.save.type, tally: { cured: a.cured, kept: a.kept }, ...said });
        continue;
      }
      // (A save at the end of each stage: a poison's round, a disease's days.)
      a.inStage = (a.inStage ?? 0) + 1;
      if ( a.inStage < stageRounds(a.spec, a.stage) ) continue;
      a.inStage = 0;
      const rolled = systemRolled(run, u, "save", { dc: a.spec.save.dc, save: a.spec.save.type, action: a.spec });
      const roll = rollCheck(rules, run.rng, mod, a.spec.save.dc, { advantage, dice, kind: "save", roller: u, rolled, label: a.spec.name ?? "", what: "affliction" });
      a.stage = Math.min(a.spec.stages.length, a.stage + stageMove(rules, a, roll.degree));
      if ( a.stage <= 0 ) {
        u.afflictions.splice(u.afflictions.indexOf(a), 1);
        log(run, u, { type: "afflictionEnd", name: a.spec.name, natural: roll.natural, mod, total: roll.total, dc: a.spec.save.dc, degree: roll.degree });
        continue;
      }
      // (The save told, as the stage it leaves it at: a worse one, the same, or a better one.)
      log(run, u, { type: "afflictionSave", name: a.spec.name, saveType: a.spec.save.type, natural: roll.natural, mod, total: roll.total, dc: a.spec.save.dc, degree: roll.degree, stage: a.stage });
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
  const check = checkRoll(run, u, u.spec.firstAid.mod, target, { purpose: "firstAid", skill: u.spec.firstAid.skill ?? null });
  const rolled = systemRolled(run, u, "check", { dc, target, purpose: "firstAid", skill: u.spec.firstAid.skill ?? null });
  const roll = rollCheck(rules, run.rng, check.mod, dc, { advantage: check.advantage, dice: check.dice, kind: "check", roller: u, faces: u.spec.firstAid.faces, rolled, what: "firstAid", target });
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
 * The fallen on the losing side are dealt with as the victors' answers and playstyles say (see mercyOf): spared and
 * tended, finished off, or left to their own recovery checks; and those still alive tied up (prisoners, tended too) and
 * robbed (behavior/fallen.js).
 */
function aftermath(run, order) {
  const { rules, options } = run.prep;
  if ( options.aftermath === AFTERMATH.NONE ) return;
  const simulated = options.downedModel === DOWNED_MODELS.SIMULATE;
  // (A hazard still set wins nothing: it settles nobody's fate, and makes nobody's friend a fallen foe.)
  const victors = run.units.filter(u => isStanding(u) && !u.spec.hazard);
  const fallen = run.units.filter(u => u.status === STATUS.DOWN && victors.some(v => areEnemies(run, v, u)));
  const decided = simulated && fallen.length > 0 && victors.some(v => mercyOf(run, v) !== "leave" || takesPrisoners(v) || robsTheFallen(v));
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
        const foe = !friend && (mercyOf(run, u) === "spare" || takesPrisoners(u)) ? run.units.find(a => a.spared && isDying(a)) : null;
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
        const said = recoveryOf(recoveryCheck(run, u), u);
        if ( said ) log(run, u, { ...said, type: "recovery", before, dying: u.dying, dead: u.status === STATUS.DEAD, stable: u.stable, aftermath: true });
      });
    }
  }
  for ( const u of bodies ) {
    const at = diceAt(run);
    const text = rules.recoverBody(u, run.rng);
    // (The system's roll, where its helper didn't show it itself: its dice as a plain roll.)
    if ( at >= 0 ) tableRoll(run, at, { by: u, kind: "check", what: "body", each: true });
    if ( text ) log(run, u, { text, type: "body", alive: u.status !== STATUS.DEAD, aftermath: true });
    if ( u.status !== STATUS.DEAD ) tended = true;
  }
  if ( marker ) marker.tended = tended; // the story opens differently when nobody comes to help
  run.aftermathRounds = i; // (how long it took, for the GM's summary of time passed)
  run.round = rounds;
}

/**
 * What a victor does with a fallen foe once the fighting is over: its answer to "Foes who fall" first (finish them,
 * spare them), then its playstyles: "spare" it (a Moralist, a Diplomat most of the time, one who avoids killing as
 * often as it holds back: decided once), "finish" it (the Cruel, with no other answer), or "leave" it to fate. (Tying
 * them up and robbing them come after, for the living: behavior/fallen.js.)
 */
export function mercyOf(run, u) {
  const b = behaviorOf(u);
  const said = u.tac?.fallen;
  if ( said === "finish" ) return "finish";
  u.sparesTheFallen ??= holdsBack(run, u);
  if ( u.sparesTheFallen || said === "spare" || (b.spareDowned ?? 0) >= 0.5 ) return "spare";
  if ( b.finishDowned && !b.spareDowned && !said ) return "finish";
  return "leave";
}

/**
 * The victors settle the fallen: anyone sparing them stops the rest; otherwise the cruel finish them off. Those still
 * alive are then tied up by whoever takes prisoners (and tended like the spared), and robbed by whoever robs them.
 */
function dealWithTheFallen(run, victors, fallen) {
  for ( const f of fallen ) {
    // (Only its own foes: nobody finishes, or spares, a friend.)
    const sparer = victors.find(v => areEnemies(run, v, f) && mercyOf(run, v) === "spare");
    const finishers = victors.filter(v => areEnemies(run, v, f) && mercyOf(run, v) === "finish");
    if ( sparer ) {
      f.spared = true;
      if ( finishers.length ) log(run, sparer, { type: "mercy", target: f.spec.name, targetId: f.id, aftermath: true });
    } else {
      const killer = finishers.find(k => executionCheck(run, k, f) === f);
      if ( killer ) {
        // Its everyday blows (no spell slots or potions on the helpless), until it's done.
        const blows = killer.prep.offense.filter(a => !a.resource && !Number.isFinite(a.uses) && a.kind !== "control" && a.damage?.length);
        const best = blows.reduce((top, a) => { const ev = expectedDamage(run, killer, a, f, 0); return !top || ev > top.ev ? { a, ev } : top; }, null);
        for ( let n = 0; best && n < 4 && f.status === STATUS.DOWN; n++ ) executeOffense(run, killer, best.a, f, 0);
      }
    }
    if ( f.status !== STATUS.DOWN ) continue;
    const binder = !isBound(f) ? victors.find(v => areEnemies(run, v, f) && takesPrisoners(v)) : null;
    if ( binder ) {
      bind(run, binder, f, logger(run), { aftermath: true });
      f.spared = true; // (a prisoner is worth keeping alive)
    }
    const robber = victors.find(v => areEnemies(run, v, f) && robsTheFallen(v) && !v.robbedFrom?.has(f.id));
    if ( robber && robbable(f) ) rob(run, robber, f, logger(run), { aftermath: true });
  }
}

/**
 * When the fight is over, whatever was given up comes back to its owner if the one who took it was beaten (dead,
 * down, surrendered, talked down, beaten); a taker who got away keeps it.
 */
const BEATEN = new Set([STATUS.DEAD, STATUS.DOWN, STATUS.SURRENDERED, STATUS.STOOD_DOWN, STATUS.BEATEN, STATUS.BOUND]);
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
  // (Nor does a troll lying there, mending: it will get back up unless someone burns it, or ties it up.)
  // (Nor one on its way off the map: behavior/leaving.js.)
  return (isStanding(u) || joining(u) || (u.held && u.status === STATUS.DOWN && !isBound(u))) && !u.spec.untargetable && u.side !== NEUTRAL_PARTY && !isLeaving(u);
}

function activeSides(run) {
  const out = [];
  for ( const u of run.units ) if ( keepsSideIn(u) && !out.includes(u.side) ) out.push(u.side);
  return out;
}

export function battleOver(run) {
  if ( run.resolved ) return true; // a standoff settled by a retreat (or talks that collapsed)
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
/** The effects on u that lay conditions alone, with whose they are ({laid}), or nothing (captureUnit). */
function laidBy(u) {
  if ( [STATUS.DEAD, STATUS.FLED].includes(u.status) ) return {};
  const laid = (u.effects ?? []).filter(e => !(e.mods || e.iwr || e.mark) && Object.keys(e.conditions ?? {}).length)
    .map(e => ({ key: e.key, sourceId: e.sourceId, label: e.label, conditions: { ...e.conditions } }));
  return laid.length ? { laid } : {};
}

export function captureUnit(u, rules) {
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
    // (And those that lay conditions alone, with whose they are, where there are any: the system's card names who got
    // what. API 21.)
    ...laidBy(u),
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
    // (Tied up: by whom. A prisoner, awake (status bound) or not.)
    ...(isBound(u) ? { bound: { by: u.boundBy ?? null, round: u.boundRound ?? null } } : {}),
    position: u.pos ? { x: u.pos.x, y: u.pos.y } : null,
    feetMoved: Math.round(u.feetMoved)
  };
}

function summarize(run, ended, capture, winners) {
  const outcome = !ended ? "stalemate" : (winners.length ? "victory" : "none");
  const units = {};
  for ( const u of run.units ) {
    if ( u.summoner ) continue; // summoned for this fight alone: not the table's
    units[u.id] = {
      // (Tied up and alive, awake or not: a prisoner.)
      status: isBound(u) && u.status === STATUS.DOWN ? STATUS.BOUND : u.status,
      involved: u.active,
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
  // (And why, and by whom: for the planner's most common reason.)
  const collapseCause = collapsed ? { cause: run.resolved.cause ?? null, by: run.resolved.by ?? null } : null;
  return { outcome, winners, rounds: run.round, aftermathRounds: run.aftermathRounds ?? 0, firstFallen: run.firstFallen, peaceful: ended && !run.blood && !collapsed,
    collapsed, collapseCause, units, doors, log: run.log };
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
  const run = beginRun(prep, seed, { log: withLog });
  const order = run.order;
  // A round of their own first, for those with surprise, where it comes to that (behavior/surprise.js).
  const surprise = run.surprise;
  if ( surprise?.round && surprise.by.length ) {
    run.round = 0;
    for ( const side of surprise.by ) log(run, null, { type: "surprise", sideLabel: prep.sides[side]?.label ?? side });
    for ( const u of order ) {
      if ( !surprise.by.includes(u.side) ) continue;
      startTurn(run, u);
      takeTurn(run, u);
      noteIdle(run, u);
    }
  }
  let ended = battleOver(run);
  noteCommand(run, true);
  for ( let round = 1; !ended && round <= prep.options.maxRounds; round++ ) {
    beginRound(run, round);
    // (Who acts, and when: the initiative order, or the system's own way of passing the turn: Daggerheart's spotlight.)
    for ( const u of prep.rules.roundTurns ? prep.rules.roundTurns(run, order) : order ) {
      if ( playTurn(run, u) ) { ended = true; break; }
    }
  }
  return endRun(run, ended, { capture });
}

/**
 * A fight set up and ready for its first turn: its creatures, their wants and leanings, the doors, the tactics each
 * goes with this time, the system's own state, the traps they know of, the initiative order (run.order), and whether
 * it opens with words (a standoff, logged). With `log`, everything that happens is kept in run.log. With `record` (a
 * live battle's), its dice are recorded as they fall (engine/table-rolls.js: the system's surprise, rolled as it begins).
 */
export function beginRun(prep, seed, { log: withLog = false, record = false } = {}) {
  const run = createRun(prep);
  run.rng = record ? recordingRng(createRng(seed)) : createRng(seed);
  run.seed = seed; // (for dice of a creature's own that mustn't touch the fight's: behavior/holds.js bears)
  for ( const u of run.units ) initDesires(u);
  refreshLeans(run); // which way those who take no side lean
  prep.doors ??= prepareDoors(prep.spec, prep.rules);
  run.doors = doorStates(prep);
  // Each simulated fight decides which stated preferences win out (see "stay mostly true").
  for ( const u of run.units ) {
    u.tac = sampleRunTactics(u.spec, run.rng);
    // (An animal's own answers where nothing else answered: behavior/animal.js.)
    if ( isAnimalistic(u) ) u.tac = { ...animalTactics(u.spec), ...(u.tac ?? {}) };
    u.hunts = u.tac?.beyond === "hunt";
  }
  // The system's own state for the fight (Daggerheart: the GM's Fear).
  prep.rules.initRun?.(run);
  if ( withLog ) run.log = [];
  // Trap avoiders: the hazards they spot (behavior/traps.js), kept clear of as they move.
  run.trapLog = logger(run);
  spotTraps(run, run.trapLog);
  // Who has surprise, and who's caught by it (behavior/surprise.js): as the plan has it, or the system's own rule. The
  // surprised can't react until their first turn has gone by; those who sneaked up unnoticed start hidden.
  run.surprise = resolveSurprise(run);
  for ( const id of run.surprise.surprised ) {
    const u = run.byId.get(id);
    if ( u ) u.reactionsLeft = 0;
  }
  for ( const id of run.surprise.hidden ) {
    const u = run.byId.get(id);
    if ( u ) applyOutcome(u, { conditions: { hidden: 1 }, rounds: 10 }, u.id, { id: "surprise:hidden", name: "" });
  }
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
  return run;
}

/** A new round: its number, and which way those who take no side lean now (the underdog changes as the fight goes). */
export function beginRound(run, round) {
  run.round = round;
  refreshLeans(run);
}

/**
 * One creature's turn, as the fight's own: a change of command first, if there's been one, then the turn, then what
 * comes after it (a last stand ending, a legendary creature's moment). True if the fight is over.
 */
export function playTurn(run, u) {
  noteCommand(run);
  startTurn(run, u);
  takeTurn(run, u);
  noteIdle(run, u);
  noteAside(run, u);
  return afterTurn(run, u);
}

/**
 * What comes after anyone's turn: those inside another where it went, a last stand ending, a legendary creature's
 * moment. True if the fight is over.
 */
export function afterTurn(run, u) {
  carryInside(run);
  if ( u.lastStand ) endLastStand(run, u);
  if ( battleOver(run) ) return true;
  if ( run.legendary ) {
    legendaryMoment(run, u);
    if ( battleOver(run) ) return true;
  }
  return false;
}

/**
 * The aftermath on its own, after a fight already ended (a live battle's, when the GM says): the fallen settled (the
 * dying bleed out or hold on, the beaten dealt with), goods taken back by their owners. Told as a moment of its own.
 */
export function settleAftermath(run) {
  startTurn(run);
  aftermath(run, run.order);
  reclaimGoods(run);
}

/**
 * The fight over (or out of rounds, `ended` false): who won, told; then the aftermath settles the fallen and goods
 * go back (unless `settle` is false: a live battle's GM decides that); and what came of it, summed up (each
 * creature's end state too, with `capture`).
 */
export function endRun(run, ended, { capture = false, settle = true } = {}) {
  const prep = run.prep;
  // Who won is decided when the last blow lands (or one side backs off); the aftermath only settles the fallen.
  // (Talks that collapsed: nobody's.)
  const winners = !ended ? [] : run.resolved ? [run.resolved.side].filter(Boolean) : activeSides(run);
  // (Those still on their way off the map have gone.)
  for ( const u of run.units ) if ( isLeaving(u) ) offMap(run, u, { ended: true });
  if ( run.log ) {
    startTurn(run);
    const labels = winners.map(s => prep.sides[s]?.label ?? s);
    log(run, null, {
      type: "end", outcome: !ended ? "stalemate" : (winners.length ? "victory" : "none"), winners, winnerLabels: labels, rounds: run.round,
      peaceful: ended && !run.blood, standoff: !!run.standoff, resolved: run.resolved?.outcome ?? null
    });
  }
  if ( ended && settle ) {
    aftermath(run, run.order);
    for ( const u of run.units ) stayBound(run, u, logger(run));
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
 * @param {(fraction: number, done: number) => void} [opts.onProgress]   how far along, and how many fights are done
 * @param {AbortSignal} [opts.signal]
 */
export async function runBatch(spec, rules, { runs = 2000, seed = randomSeed(), onProgress, signal, maxMs = null } = {}) {
  const prep = prepareBattle(spec, rules);
  const agg = createAggregator(prep);
  // (`maxMs`: fights until the time is up, `runs` at most. No fight is started once it's up; the one under way is
  // finished. There's always one. The time is the time spent on it: a pause to let the browser draw counts, but only so
  // much of one, since a browser tab in the background makes each pause last a second.)
  let spent = 0;
  let done = 0;
  let sliceStart = performance.now();
  for ( let i = 0; i < runs; i++ ) {
    if ( maxMs && i > 0 && spent + performance.now() - sliceStart >= maxMs ) break;
    const runSeed = deriveSeed(seed, i);
    agg.add(runOne(prep, runSeed), runSeed);
    done++;
    if ( performance.now() - sliceStart > SLICE_MS ) {
      spent += performance.now() - sliceStart;
      onProgress?.(maxMs ? Math.min(1, spent / maxMs) : done / runs, done);
      const paused = performance.now();
      await new Promise(resolve => setTimeout(resolve, 0));
      spent += Math.min(PAUSE_MS, performance.now() - paused);
      if ( signal?.aborted ) break;
      sliceStart = performance.now();
    }
  }
  onProgress?.(1, done);
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
