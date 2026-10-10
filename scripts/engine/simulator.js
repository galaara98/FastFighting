/**
 * Round-by-round battle simulation. Pure: give it a BattleSpec and a rules object, get statistics back.
 */
import { STATUS, TACTICAL, DOWNED_MODELS } from "../constants.js";
import { createRng, deriveSeed, randomSeed } from "./rng.js";
import { sampleDamage, samplePart, doubled } from "./dice.js";
import {
  prepareBattle, createRun, isStanding, enemiesOf, areEnemies, liveTier, currentAc, attackBonusMods,
  rangePenalty, moveToward, saveMod, actionsThisTurn, bonusDamageParts, dispositionOf, behaviorOf, studyBonus
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

function log(run, u, text) {
  if ( run.log ) run.log.push({ round: run.round, actor: u?.spec.name ?? "", actorId: u?.id ?? null, side: u?.side ?? null, text });
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
      log(run, target, target.status === STATUS.DEAD ? "is slain" : `falls (dying ${target.dying})`);
    }
  } else if ( target.status === STATUS.DOWN ) {
    if ( model === DOWNED_MODELS.OUT ) return;
    rules.onDropped(target, { crit, model });
    if ( target.status === STATUS.DEAD ) target.killerId = source?.id ?? target.killerId ?? null;
    log(run, target, target.status === STATUS.DEAD ? "is finished off" : `is struck while down (dying ${target.dying})`);
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
  log(run, target, `${affliction.spec.name} stage ${affliction.stage}: ${amount} damage`);
  dealDamage(run, run.byId.get(affliction.sourceId), target, amount);
}

function exposeToAffliction(run, source, target, spec) {
  if ( target.spec.iwr?.immune?.some(k => spec.traits?.includes(k)) ) return;
  const rules = run.prep.rules;
  const roll = rules.roll(run.rng, saveMod(target, spec.save.type), spec.save.dc);
  const increase = [2, 1, 0, 0][roll.degree];
  log(run, target, `${spec.name}: ${spec.save.type} save ${DEGREE_LABEL[roll.degree]}`);
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
    if ( !isStanding(target) && effect.kind !== "affliction" ) continue;
    if ( target.status === STATUS.DEAD ) return;
    if ( effect.kind === "prone" && (degree === 3 || !effect.critOnly) ) {
      target.prone = true;
      log(run, target, "is knocked prone");
    } else if ( effect.kind === "grabbed" ) {
      target.grabbedBy = u.id;
      log(run, target, `is grabbed by ${u.spec.name}`);
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
  for ( const target of targets ) {
    target.lastAttackerId = u.id;
    const extra = bonusDamageParts(run, u, action, target);

    if ( action.kind === "auto" ) {
      const hit = rollHit(run, u, action, target, (action.damage ?? []).concat(extra), 1, false);
      log(run, u, `${action.name} → ${target.spec.name}: ${hit.total} damage`);
      hit.apply();
      continue;
    }

    if ( action.kind === "save" && action.save ) {
      const roll = rules.roll(run.rng, saveMod(target, action.save.type), action.save.dc);
      const mult = action.save.basic === false ? [2, 1, 0, 0][roll.degree] : rules.basicSaveMultiplier(roll.degree);
      if ( mult > 0 ) {
        const hit = rollHit(run, u, action, target, (action.damage ?? []).concat(extra), mult, roll.degree === 0);
        log(run, u, `${action.name} → ${target.spec.name}: save ${DEGREE_LABEL[roll.degree]}, ${hit.total} damage`);
        hit.apply();
        if ( roll.degree <= 1 ) applyEffects(run, u, action, target, 3 - roll.degree);
      } else log(run, u, `${action.name} → ${target.spec.name}: ${DEGREE_LABEL[roll.degree]}, no damage`);
      continue;
    }

    const bonus = (action.bonus ?? 0) + rules.attackPenalty(action, attacksMade) + attackBonusMods(run, u, action) + studyBonus(u, target)
      + rangePenalty(run, u, target, action);
    const ac = currentAc(run, target, u, action);
    const roll = rules.roll(run.rng, bonus, ac);
    if ( roll.degree >= 2 ) {
      const crit = roll.degree === 3;
      const base = crit ? (action.critDamage ?? doubled(action.damage ?? [])) : (action.damage ?? []);
      const parts = base.concat(crit ? doubled(extra) : extra);
      const hit = rollHit(run, u, action, target, parts, 1, crit);
      log(run, u, `${action.name} → ${target.spec.name}: ${roll.total} vs AC ${ac}, ${crit ? "critical hit" : "hit"} for ${hit.total}`);
      hit.apply();
      applyEffects(run, u, action, target, roll.degree);
    } else {
      log(run, u, `${action.name} → ${target.spec.name}: ${roll.total} vs AC ${ac}, miss`);
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
  if ( action.healCheck ) {
    const roll = rules.roll(run.rng, action.healCheck.mod, action.healCheck.dc);
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
  log(run, u, `${action.name} → ${target === u ? "self" : target.spec.name}: heals ${target.hp - before}${revived ? " and revives them" : ""}`);
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
  log(run, u, reason);
}

function takeTurn(run, u) {
  const { rules, options } = run.prep;
  if ( u.status === STATUS.DEAD || u.status === STATUS.FLED ) return;
  u.shieldRaised = false;
  // Stunned and similar one-turn conditions from afflictions are recomputed at end of turn.

  if ( u.status === STATUS.DOWN ) {
    if ( options.downedModel === DOWNED_MODELS.SIMULATE && rules.recoveryCheck ) {
      const text = rules.recoveryCheck(u, run.rng);
      if ( text ) log(run, u, text);
    }
    endOfTurn(run, u);
    return;
  }

  const morale = checkMorale(run, u);
  if ( morale === MORALE.ROUT ) return flee(run, u, "breaks and flees");
  if ( morale === MORALE.WAVER && !u.wavering ) {
    u.wavering = true;
    log(run, u, "wavers");
  }

  const disposition = dispositionOf(u);
  if ( u.prone && u.wasDowned && disposition.selfRevived === "retreat" ) return flee(run, u, "retreats after being revived");
  if ( disposition.allyDying === "retreat" && run.units.some(a => a.side === u.side && a !== u && a.status === STATUS.DOWN) ) {
    return flee(run, u, "retreats as an ally falls");
  }

  let actions = actionsThisTurn(run, u);
  const behavior = behaviorOf(u);
  // Diplomats with no one who understands them still try to talk.
  if ( !u.parleyed ) {
    u.parleyed = true;
    if ( behavior.parleyFirst && actions > 0 && !u.spec.social && run.rng.chance(behavior.parleyFirst) ) {
      actions -= 1;
      log(run, u, "tries to talk the other side down");
    }
  }
  let attacksMade = 0;
  if ( u.prone && actions > 0 ) {
    actions -= 1;
    u.prone = false;
    log(run, u, "stands up");
  }
  if ( u.grabbedBy && actions > 0 ) {
    // Escape attempt costs an action; succeed half the time.
    actions -= 1;
    if ( run.rng.chance(0.5) ) {
      log(run, u, "escapes the grab");
      u.grabbedBy = null;
    } else log(run, u, "struggles against the grab");
  }

  // Words before weapons: talkers sway, the less battle-worthy talk twice, anyone may quip.
  const talking = talkActionsThisTurn(run, u, actions);
  for ( let i = 0; i < talking && actions > 0; i++ ) {
    const pitch = choosePitch(run, u);
    if ( !pitch ) break;
    attemptTalk(run, u, pitch, (unit, text) => log(run, unit, text));
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

    const target = chooseTarget(run, u);
    if ( !target ) break;
    // Lore-Collectors study a new foe first (Recall Knowledge), then fight it better.
    if ( behavior.study && !u.studied.has(target.id) && !u.studied.has(`skip:${target.id}`) && actions >= 2 ) {
      u.studied.add(target.id);
      if ( run.rng.chance(behavior.study) ) {
        actions -= 1;
        log(run, u, `studies ${target.spec.name} for weaknesses`);
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
      moveToward(run, u, target, option.action.range ? null : (option.action.reach ?? 5));
      actions -= 1;
      log(run, u, `moves toward ${target.spec.name}`);
      continue;
    }

    const tier = liveTier(run, u);
    const tactics = u.tac;
    const rushing = behavior.rush && run.rng.chance(behavior.rush);
    const canShield = u.spec.shield && !u.shieldRaised && tactics?.shield !== "never" && !rushing;
    // "Always" keeps the shield up: the last action of the turn goes to it.
    if ( canShield && tactics?.shield === "always" && actions === 1 ) {
      u.shieldRaised = true;
      actions -= 1;
      log(run, u, "raises a shield");
      continue;
    }
    // Skirmishers hit twice and keep moving instead of taking a hopeless third swing.
    if ( tactics?.style === "skirmisher" && attacksMade >= 2 && option.action.melee ) {
      if ( canShield ) { u.shieldRaised = true; log(run, u, "raises a shield"); }
      else log(run, u, "steps back to a better position");
      actions -= 1;
      continue;
    }
    if ( option.cost > actions ) {
      if ( canShield && tier >= TACTICAL.INSTINCTIVE ) {
        u.shieldRaised = true;
        actions -= 1;
        log(run, u, "raises a shield");
        continue;
      }
      break;
    }
    // A thinking combatant with a shield prefers defense over a hopeless third attack.
    if ( canShield && tier >= TACTICAL.COMPETENT && attacksMade >= 2 ) {
      const first = expectedDamage(run, u, option.action, target, 0);
      if ( option.ev < first * 0.3 ) {
        u.shieldRaised = true;
        actions -= 1;
        log(run, u, "raises a shield");
        continue;
      }
    }

    if ( option.action.drawCost && !u.drawn.has(option.action.id) ) {
      u.drawn.add(option.action.id);
      log(run, u, `draws ${option.action.name}`);
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
      log(run, u, `takes ${amount} persistent ${entry.part.type}`);
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
        log(run, u, `${a.spec.name} runs its course`);
        continue;
      }
      const roll = rules.roll(run.rng, saveMod(u, a.spec.save.type), a.spec.save.dc);
      a.stage = Math.min(a.spec.stages.length, a.stage + [2, 1, -1, -2][roll.degree]);
      if ( a.stage <= 0 ) {
        u.afflictions.splice(u.afflictions.indexOf(a), 1);
        log(run, u, `recovers from ${a.spec.name}`);
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
  return true;
}

/** Everything "Make it So" needs to commit one unit's end state. */
function captureUnit(u) {
  return {
    hp: u.hp,
    temp: u.temp,
    status: u.status,
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
    killerId: u.killerId ?? null
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
  for ( const u of run.units ) u.tac = sampleRunTactics(u.spec, run.rng);
  if ( withLog ) run.log = [];
  const order = rollInitiative(run);
  if ( withLog ) log(run, null, `Initiative: ${order.map(u => u.spec.name).join(", ")}`);

  const surpriseSide = prep.options.surpriseSide;
  if ( surpriseSide ) {
    run.round = 0;
    log(run, null, `Surprise round for ${prep.sides[surpriseSide]?.label ?? surpriseSide}`);
    for ( const u of order ) if ( u.side === surpriseSide ) takeTurn(run, u);
  }
  let ended = battleOver(run);
  for ( let round = 1; !ended && round <= prep.options.maxRounds; round++ ) {
    run.round = round;
    for ( const u of order ) {
      takeTurn(run, u);
      if ( battleOver(run) ) { ended = true; break; }
    }
  }
  if ( withLog ) {
    const winners = ended ? activeSides(run).map(s => prep.sides[s]?.label ?? s) : [];
    log(run, null, ended ? (winners.length ? `${winners.join(" & ")} win after ${run.round} rounds` : "No one is left standing") : `Still fighting after ${run.round} rounds`);
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

export { prepareBattle, areEnemies };
