/**
 * Round-by-round battle simulation. Pure: give it a BattleSpec and a rules object, get statistics back.
 *
 * Every logged event carries structured data (type, rolls, margins, damage types, movement) so the story
 * writer can narrate it at any level of detail.
 */
import { STATUS, TACTICAL, DOWNED_MODELS } from "../constants.js";
import { createRng, deriveSeed, randomSeed } from "./rng.js";
import { sampleDamage, samplePart, doubled } from "./dice.js";
import {
  prepareBattle, createRun, isStanding, isUp, enemiesOf, alliesOf, areEnemies, liveTier, liveTrait, currentAc,
  attackBonusMods, rangePenalty, moveToward, moveAway, saveMod, actionsThisTurn, bonusDamageParts, dispositionOf,
  behaviorOf, studyBonus, edgeDistance, movesNeeded
} from "./battle-state.js";
import { sampleRunTactics } from "./playstyles.js";
import { chooseTarget, bestOptionVs } from "./behavior/targeting.js";
import { decideHeal } from "./behavior/healing.js";
import { checkMorale, MORALE } from "./behavior/morale.js";
import { expectedDamage, spendUse, countsAsAttack } from "./behavior/evaluate.js";
import { createAggregator } from "./aggregate.js";
import { talkActionsThisTurn, choosePitch, attemptTalk } from "./behavior/talk.js";

const MAX_STEPS_PER_TURN = 8;
const DEGREE_LABEL = ["critical failure", "failure", "success", "critical success"];

function log(run, u, text, data = {}) {
  if ( !run.log ) return;
  run.log.push({
    round: run.round, actor: u?.spec.name ?? "", actorId: u?.id ?? null, side: u?.side ?? null, text,
    type: data.type ?? "note", ...data
  });
}

const primaryType = action => (action.damage ?? action.heal ?? [])[0]?.type ?? "untyped";

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
  const text = {
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
    const roll = run.prep.rules.roll(run.rng, perception, best.cue.dc);
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
      rules.onDropped(target, { crit, model });
      target.fellRound ??= run.round;
      target.killerId = source?.id ?? target.killerId ?? null;
      run.firstFallen ??= target.id;
      releaseGrabs(run, target);
      const dead = target.status === STATUS.DEAD;
      log(run, target, dead ? "is slain" : `falls (dying ${target.dying})`, { type: dead ? "death" : "down", by: source?.spec.name ?? null, byId: source?.id ?? null, dying: target.dying });
    }
  } else if ( target.status === STATUS.DOWN ) {
    if ( model === DOWNED_MODELS.OUT ) return;
    rules.onDropped(target, { crit, model });
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
  const conds = {};
  for ( const a of u.afflictions ) {
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
  const mod = saveMod(target, spec.save.type);
  const roll = rules.roll(run.rng, mod, spec.save.dc);
  const increase = [2, 1, 0, 0][roll.degree];
  log(run, target, `${spec.name}: ${spec.save.type} save ${DEGREE_LABEL[roll.degree]}`, {
    type: "afflictionSave", name: spec.name, saveType: spec.save.type, natural: roll.natural, mod, total: roll.total, dc: spec.save.dc, degree: roll.degree
  });
  if ( !increase ) return;
  let affliction = target.afflictions.find(a => a.spec.id === spec.id);
  if ( !affliction ) {
    affliction = { spec, stage: 0, rounds: 0, sourceId: source.id };
    target.afflictions.push(affliction);
  }
  affliction.stage = Math.min(spec.stages.length, affliction.stage + increase);
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
    }
  }
}

/** Roll damage for a hit; returns the total and a function that applies it (so the log reads in order). */
function rollHit(run, u, action, t, parts, multiplier, crit) {
  const rules = run.prep.rules;
  const rolled = sampleDamage(parts, run.rng, multiplier);
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

function executeOffense(run, u, action, t, attacksMade) {
  const rules = run.prep.rules;
  u.revealed = true;
  const targets = [t];
  if ( action.area ) {
    const others = enemiesOf(run, u).filter(o => o !== t && isStanding(o));
    run.rng.shuffle(others);
    targets.push(...others.slice(0, Math.max(0, (action.area.targets ?? 2) - 1)));
  }
  const ranged = !!action.range && !action.melee;
  for ( const target of targets ) {
    if ( !target.active ) notice(run, target, "attacked", u);
    target.lastAttackerId = u.id;
    const extra = bonusDamageParts(run, u, action, target);
    const common = {
      action: action.name, actionKind: action.kind, damageType: primaryType(action), target: target.spec.name, targetId: target.id,
      ranged, area: !!action.area, targetCover: !!target.spec.environment?.nearCover, attackerCover: !!u.spec.environment?.nearCover
    };

    if ( action.kind === "auto" ) {
      const hit = rollHit(run, u, action, target, (action.damage ?? []).concat(extra), 1, false);
      log(run, u, `${action.name} → ${target.spec.name}: ${hit.total} damage`, { type: "auto", ...common, damage: hit.total });
      hit.apply();
      continue;
    }

    if ( action.kind === "save" && action.save ) {
      const mod = saveMod(target, action.save.type);
      const roll = rules.roll(run.rng, mod, action.save.dc);
      const mult = action.save.basic === false ? [2, 1, 0, 0][roll.degree] : rules.basicSaveMultiplier(roll.degree);
      const data = { type: "save", ...common, saveType: action.save.type, natural: roll.natural, mod, total: roll.total, dc: action.save.dc, degree: roll.degree, margin: roll.total - action.save.dc };
      if ( mult > 0 ) {
        const hit = rollHit(run, u, action, target, (action.damage ?? []).concat(extra), mult, roll.degree === 0);
        log(run, u, `${action.name} → ${target.spec.name}: save ${DEGREE_LABEL[roll.degree]}, ${hit.total} damage`, { ...data, damage: hit.total });
        hit.apply();
        if ( roll.degree <= 1 ) applyEffects(run, u, action, target, 3 - roll.degree);
      } else log(run, u, `${action.name} → ${target.spec.name}: ${DEGREE_LABEL[roll.degree]}, no damage`, { ...data, damage: 0 });
      continue;
    }

    const bonus = (action.bonus ?? 0) + rules.attackPenalty(action, attacksMade) + attackBonusMods(run, u, action) + studyBonus(u, target)
      + rangePenalty(run, u, target, action);
    const ac = currentAc(run, target, u, action);
    const roll = rules.roll(run.rng, bonus, ac);
    const data = { type: "attack", ...common, natural: roll.natural, mod: bonus, total: roll.total, dc: ac, degree: roll.degree, margin: roll.total - ac, attackNumber: attacksMade + 1 };
    if ( roll.degree >= 2 ) {
      const crit = roll.degree === 3;
      const base = crit ? (action.critDamage ?? doubled(action.damage ?? [])) : (action.damage ?? []);
      const parts = base.concat(crit ? doubled(extra) : extra);
      const hit = rollHit(run, u, action, target, parts, 1, crit);
      log(run, u, `${action.name} → ${target.spec.name}: ${roll.total} vs AC ${ac}, ${crit ? "critical hit" : "hit"} for ${hit.total}`, { ...data, damage: hit.total, crit, sneak: extra.length > 0 });
      hit.apply();
      applyEffects(run, u, action, target, roll.degree);
    } else {
      log(run, u, `${action.name} → ${target.spec.name}: ${roll.total} vs AC ${ac}, miss`, { ...data, damage: 0 });
    }
  }
  if ( action.melee ) {
    u.adjacent.add(t.id);
    t.adjacent.add(u.id);
  }
}

function executeHeal(run, u, action, target) {
  const rules = run.prep.rules;
  let multiplier = 1;
  let roll = null;
  if ( action.healCheck ) {
    roll = rules.roll(run.rng, action.healCheck.mod, action.healCheck.dc);
    multiplier = [0, 0, 1, 2][roll.degree];
  }
  const amount = Math.max(0, Math.floor((action.heal ?? []).reduce((s, p) => s + samplePart(p, run.rng), 0) * multiplier));
  const wasDown = target.status === STATUS.DOWN;
  const before = target.hp;
  if ( amount > 0 ) rules.onHealed(target, amount);
  u.healingDone += target.hp - before;
  u.healedTargets.add(`${action.id}|${target.id}`);
  spendUse(u, action);
  const revived = wasDown && target.status === STATUS.STANDING;
  log(run, u, `${action.name} → ${target === u ? "self" : target.spec.name}: heals ${target.hp - before}${revived ? " and revives them" : ""}`, {
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
  log(run, u, `${move.mode === "walk" ? "moves" : move.mode === "fly" ? "flies" : move.mode === "swim" ? "swims" : move.mode === "climb" ? "climbs" : "burrows"} toward ${toward.spec.name}`, {
    type: "move", mode: move.mode, feet: move.feet, mult: move.mult, regions: move.regions, toward: toward.spec.name, towardId: toward.id,
    reached: move.reached, purpose, tactical: liveTier(run, u), cover: !!u.spec.environment?.nearCover
  });
}

function takeTurn(run, u) {
  const { rules, options } = run.prep;
  if ( u.status === STATUS.DEAD || u.status === STATUS.FLED || u.status === STATUS.SURRENDERED ) return;
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

  let actions = actionsThisTurn(run, u);
  const behavior = behaviorOf(u);
  // Diplomats with no one who understands them still try to talk.
  if ( !u.parleyed ) {
    u.parleyed = true;
    if ( behavior.parleyFirst && actions > 0 && !u.spec.social && run.rng.chance(behavior.parleyFirst) ) {
      actions -= 1;
      log(run, u, "tries to talk the other side down", { type: "parley" });
    }
  }
  let attacksMade = 0;
  if ( u.prone && actions > 0 ) {
    actions -= 1;
    u.prone = false;
    log(run, u, "stands up", { type: "stand" });
  }
  if ( u.grabbedBy && actions > 0 ) {
    // Escape attempt costs an action; succeed half the time.
    actions -= 1;
    const escaped = run.rng.chance(0.5);
    if ( escaped ) u.grabbedBy = null;
    log(run, u, escaped ? "escapes the grab" : "struggles against the grab", { type: "escape", success: escaped });
  }

  // Running for help: head toward an ally who hasn't joined yet and shout.
  const helper = actions > 0 ? wantsHelp(run, u) : null;
  if ( helper ) {
    while ( actions > 0 ) {
      const move = moveToward(run, u, helper, 5);
      actions -= 1;
      moveLog(run, u, move, helper, "help");
      const d = edgeDistance(u, helper);
      if ( d === null || d <= 30 ) {
        helper.calledForHelp = true;
        log(run, u, `shouts to ${helper.spec.name} for help`, { type: "callHelp", toward: helper.spec.name, towardId: helper.id });
        notice(run, helper, "help", u);
        break;
      }
    }
  }

  // Words before weapons: talkers sway, the less battle-worthy talk twice, anyone may quip.
  const talking = talkActionsThisTurn(run, u, actions);
  for ( let i = 0; i < talking && actions > 0; i++ ) {
    const pitch = choosePitch(run, u);
    if ( !pitch ) break;
    attemptTalk(run, u, pitch, (unit, text, data) => log(run, unit, text, data));
    actions -= 1;
    if ( battleOver(run) ) break;
  }

  for ( let step = 0; actions > 0 && step < MAX_STEPS_PER_TURN && !battleOver(run); step++ ) {
    const heal = decideHeal(run, u, actions);
    if ( heal ) {
      executeHeal(run, u, heal.action, heal.target);
      actions -= heal.action.cost;
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
    if ( behavior.study && !u.studied.has(target.id) && !u.studied.has(`skip:${target.id}`) && actions >= 2 ) {
      u.studied.add(target.id);
      if ( run.rng.chance(behavior.study) ) {
        actions -= 1;
        log(run, u, `studies ${target.spec.name} for weaknesses`, { type: "study", target: target.spec.name, targetId: target.id });
        continue;
      }
      u.studied.delete(target.id);
      u.studied.add(`skip:${target.id}`);
    }
    u.targetId = target.id;
    const option = bestOptionVs(run, u, target, attacksMade, actions);
    if ( !option ) break;

    if ( option.moves > 0 ) {
      if ( u.grabbedBy ) break;
      const move = moveToward(run, u, target, option.action.range ? null : (option.action.reach ?? 5));
      actions -= 1;
      moveLog(run, u, move, target, target.active ? "approach" : "hunt");
      continue;
    }

    const tier = liveTier(run, u);
    const tactics = u.tac;
    const rushing = behavior.rush && run.rng.chance(behavior.rush);
    const canShield = u.spec.shield && !u.shieldRaised && tactics?.shield !== "never" && !rushing;
    const raiseShield = () => {
      u.shieldRaised = true;
      actions -= 1;
      log(run, u, "raises a shield", { type: "shield" });
    };
    // "Always" keeps the shield up: the last action of the turn goes to it.
    if ( canShield && tactics?.shield === "always" && actions === 1 ) { raiseShield(); continue; }
    // Skirmishers hit twice and keep moving instead of taking a hopeless third swing.
    if ( tactics?.style === "skirmisher" && attacksMade >= 2 && option.action.melee ) {
      if ( canShield ) raiseShield();
      else {
        actions -= 1;
        log(run, u, "steps back to a better position", { type: "step" });
      }
      continue;
    }
    if ( option.cost > actions ) {
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
    actions -= option.cost;
    if ( countsAsAttack(option.action) ) attacksMade += 1;
    if ( battleOver(run) ) break;
  }

  u.turnsTaken += 1;
  endOfTurn(run, u);
}

function endOfTurn(run, u) {
  const rules = run.prep.rules;
  if ( u.persistent.length ) {
    const remaining = [];
    for ( const entry of u.persistent ) {
      const amount = rules.applyIwr(u.spec.iwr, { [entry.part.type]: Math.max(0, samplePart(entry.part, run.rng)) });
      log(run, u, `takes ${amount} persistent ${entry.part.type}`, { type: "persistent", damageType: entry.part.type, amount });
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
      const mod = saveMod(u, a.spec.save.type);
      const roll = rules.roll(run.rng, mod, a.spec.save.dc);
      a.stage = Math.min(a.spec.stages.length, a.stage + [2, 1, -1, -2][roll.degree]);
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
/*  Battle                                      */
/* -------------------------------------------- */

function activeSides(run) {
  return [...new Set(run.units.filter(isStanding).map(u => u.side))];
}

export function battleOver(run) {
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
    afflictions: u.afflictions.map(a => ({ id: a.spec.id, name: a.spec.name, slug: a.spec.slug ?? null, stage: a.stage, rounds: a.rounds, dc: a.spec.save.dc, save: a.spec.save.type })),
    conditions: { ...u.conds },
    swayed: u.swayOutcome,
    side: u.side,
    resources: { ...u.resources },
    uses: { ...u.uses },
    killerId: u.killerId ?? null,
    position: u.pos ? { x: u.pos.x, y: u.pos.y } : null,
    feetMoved: Math.round(u.feetMoved)
  };
}

function summarize(run, ended, capture) {
  const winners = ended ? activeSides(run) : [];
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
      resourcesUsed: Object.fromEntries(Object.entries(u.resourcesStart).map(([k, v]) => [k, v - (u.resources[k] ?? 0)])),
      final: capture ? captureUnit(u) : undefined
    };
  }
  return { outcome, winners, rounds: run.round, firstFallen: run.firstFallen, units, log: run.log };
}

/** Simulate a single battle. */
export function runOne(prep, seed, { log: withLog = false, capture = false } = {}) {
  const run = createRun(prep);
  run.rng = createRng(seed);
  // Each simulated fight decides which stated preferences win out (see "stay mostly true").
  for ( const u of run.units ) {
    u.tac = sampleRunTactics(u.spec, run.rng);
    u.hunts = u.tac?.beyond === "hunt" || run.rng.chance(behaviorOf(u).hunt ?? 0);
  }
  if ( withLog ) run.log = [];
  const order = rollInitiative(run);
  if ( withLog ) {
    const fighters = order.filter(u => u.active);
    log(run, null, `Initiative: ${fighters.map(u => u.spec.name).join(", ")}`, { type: "initiative", order: fighters.map(u => u.spec.name) });
  }

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
  if ( withLog ) {
    const winners = ended ? activeSides(run) : [];
    const labels = winners.map(s => prep.sides[s]?.label ?? s);
    log(run, null, ended ? (labels.length ? `${labels.join(" & ")} win after ${run.round} rounds` : "No one is left standing") : `Still fighting after ${run.round} rounds`, {
      type: "end", outcome: !ended ? "stalemate" : (winners.length ? "victory" : "none"), winners, winnerLabels: labels, rounds: run.round
    });
  }
  return summarize(run, ended, capture);
}

/**
 * Run a batch of simulations, yielding to the event loop between chunks.
 * @param {object} spec             BattleSpec
 * @param {object} rules            System rules
 * @param {object} [opts]
 * @param {number} [opts.runs=2000]
 * @param {number} [opts.seed]
 * @param {number} [opts.chunk=100]
 * @param {(fraction: number) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 */
export async function runBatch(spec, rules, { runs = 2000, seed = randomSeed(), chunk = 100, onProgress, signal } = {}) {
  const prep = prepareBattle(spec, rules);
  const agg = createAggregator(prep);
  for ( let i = 0; i < runs; i++ ) {
    const runSeed = deriveSeed(seed, i);
    agg.add(runOne(prep, runSeed), runSeed);
    if ( (i + 1) % chunk === 0 ) {
      onProgress?.((i + 1) / runs);
      await new Promise(resolve => setTimeout(resolve, 0));
      if ( signal?.aborted ) break;
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
