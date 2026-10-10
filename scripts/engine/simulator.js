/**
 * Round-by-round battle simulation. Pure: give it a BattleSpec and a rules object, get statistics back.
 */
import { STATUS, TACTICAL, DOWNED_MODELS } from "../constants.js";
import { createRng, deriveSeed, randomSeed } from "./rng.js";
import { sampleDamage, samplePart, doubled } from "./dice.js";
import {
  prepareBattle, createRun, isStanding, enemiesOf, areEnemies, liveTier, currentAc, attackBonusMods,
  rangePenalty, moveToward
} from "./battle-state.js";
import { chooseTarget, bestOptionVs } from "./behavior/targeting.js";
import { decideHeal } from "./behavior/healing.js";
import { checkMorale, MORALE } from "./behavior/morale.js";
import { expectedDamage, spendUse } from "./behavior/evaluate.js";
import { createAggregator } from "./aggregate.js";

const MAX_STEPS_PER_TURN = 8;

function log(run, u, text) {
  if ( run.log ) run.log.push({ round: run.round, actor: u?.spec.name ?? "", side: u?.side ?? null, text });
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
/*  Damage & healing                            */
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
    if ( source ) source.damageDealt += dealt + absorbed;
    if ( target.hp <= 0 ) {
      target.hp = 0;
      target.wasDowned = true;
      rules.onDropped(target, { crit, model });
      target.fellRound ??= run.round;
      run.firstFallen ??= target.id;
      log(run, target, target.status === STATUS.DEAD ? "is slain" : `falls (dying ${target.dying})`);
    }
  } else if ( target.status === STATUS.DOWN ) {
    if ( model === DOWNED_MODELS.OUT ) return;
    rules.onDropped(target, { crit, model });
    log(run, target, target.status === STATUS.DEAD ? "is finished off" : `is struck while down (dying ${target.dying})`);
  }
}

function applyHit(run, u, action, t, parts, multiplier, crit) {
  const rules = run.prep.rules;
  const rolled = sampleDamage(parts, run.rng, multiplier);
  const total = rules.applyIwr(t.spec.iwr, rolled.byType);
  for ( const p of rolled.persistent ) {
    if ( !t.spec.iwr?.immune?.includes(p.type) ) t.persistent.push({ part: p, sourceId: u.id });
  }
  dealDamage(run, u, t, total, { crit });
  return total;
}

function executeOffense(run, u, action, t, attacksMade) {
  const rules = run.prep.rules;
  const targets = [t];
  if ( action.area ) {
    const others = enemiesOf(run, u).filter(o => o !== t && isStanding(o));
    run.rng.shuffle(others);
    targets.push(...others.slice(0, Math.max(0, (action.area.targets ?? 2) - 1)));
  }
  for ( const target of targets ) {
    target.lastAttackerId = u.id;
    if ( action.kind === "save" && action.save ) {
      const saveMod = target.spec.defenses[action.save.type] ?? target.spec.level + 5;
      const roll = rules.roll(run.rng, saveMod, action.save.dc);
      const mult = action.save.basic === false ? [2, 1, 0, 0][roll.degree] : rules.basicSaveMultiplier(roll.degree);
      if ( mult > 0 ) {
        const dealt = applyHit(run, u, action, target, action.damage ?? [], mult, roll.degree === 0);
        log(run, u, `${action.name} → ${target.spec.name}: save ${["crit fail", "fail", "success", "crit success"][roll.degree]}, ${dealt} damage`);
      } else log(run, u, `${action.name} → ${target.spec.name}: critical save, no damage`);
      continue;
    }
    const bonus = (action.bonus ?? 0) + rules.attackPenalty(action, attacksMade) + attackBonusMods(run, u)
      + rangePenalty(run, u, target, action);
    const ac = currentAc(run, target, u, action);
    const roll = rules.roll(run.rng, bonus, ac);
    if ( roll.degree >= 2 ) {
      const crit = roll.degree === 3;
      const parts = crit ? (action.critDamage ?? doubled(action.damage ?? [])) : (action.damage ?? []);
      const dealt = applyHit(run, u, action, target, parts, 1, crit);
      log(run, u, `${action.name} → ${target.spec.name}: ${roll.total} vs AC ${ac}, ${crit ? "critical hit" : "hit"} for ${dealt}`);
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
  const amount = Math.max(0, (action.heal ?? []).reduce((s, p) => s + samplePart(p, run.rng), 0));
  const wasDown = target.status === STATUS.DOWN;
  const before = target.hp;
  rules.onHealed(target, amount);
  u.healingDone += target.hp - before;
  u.healedTargets.add(`${action.id}|${target.id}`);
  spendUse(u, action);
  log(run, u, `${action.name} → ${target === u ? "self" : target.spec.name}: heals ${target.hp - before}${wasDown && target.status === STATUS.STANDING ? " and revives them" : ""}`);
}

/* -------------------------------------------- */
/*  Turns                                       */
/* -------------------------------------------- */

function flee(run, u, reason) {
  u.status = STATUS.FLED;
  u.fellRound ??= run.round;
  for ( const id of u.adjacent ) run.byId.get(id)?.adjacent.delete(u.id);
  u.adjacent.clear();
  log(run, u, reason);
}

function takeTurn(run, u) {
  const { rules, options } = run.prep;
  if ( u.status === STATUS.DEAD || u.status === STATUS.FLED ) return;
  u.shieldRaised = false;

  if ( u.status === STATUS.DOWN ) {
    if ( options.downedModel === DOWNED_MODELS.SIMULATE && rules.recoveryCheck ) {
      const text = rules.recoveryCheck(u, run.rng);
      if ( text ) log(run, u, text);
    }
    return;
  }

  const morale = checkMorale(run, u);
  if ( morale === MORALE.ROUT ) return flee(run, u, "breaks and flees");
  if ( morale === MORALE.WAVER && !u.wavering ) {
    u.wavering = true;
    log(run, u, "wavers");
  }

  const disposition = u.spec.disposition ?? {};
  if ( u.prone && disposition.selfRevived === "retreat" ) return flee(run, u, "retreats after being revived");
  if ( disposition.allyDying === "retreat" && run.units.some(a => a.side === u.side && a !== u && a.status === STATUS.DOWN) ) {
    return flee(run, u, "retreats as an ally falls");
  }

  let actions = rules.actionsPerTurn;
  let attacksMade = 0;
  if ( u.prone ) {
    actions -= 1;
    u.prone = false;
    log(run, u, "stands up");
  }

  for ( let step = 0; actions > 0 && step < MAX_STEPS_PER_TURN; step++ ) {
    const heal = decideHeal(run, u, actions);
    if ( heal ) {
      executeHeal(run, u, heal.action, heal.target);
      actions -= heal.action.cost;
      continue;
    }

    const target = chooseTarget(run, u);
    if ( !target ) break;
    u.targetId = target.id;
    const option = bestOptionVs(run, u, target, attacksMade);
    if ( !option ) break;

    if ( option.moves > 0 ) {
      moveToward(run, u, target, option.action.range ? null : (option.action.reach ?? 5));
      actions -= 1;
      log(run, u, `moves toward ${target.spec.name}`);
      continue;
    }

    const tier = liveTier(run, u);
    const canShield = u.spec.shield && !u.shieldRaised;
    if ( option.action.cost > actions ) {
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

    executeOffense(run, u, option.action, target, attacksMade);
    spendUse(u, option.action);
    actions -= option.action.cost;
    if ( option.action.attack !== false && option.action.kind !== "save" ) attacksMade += 1;
    if ( battleOver(run) ) break;
  }

  endOfTurn(run, u);
}

function endOfTurn(run, u) {
  const rules = run.prep.rules;
  if ( !u.persistent.length ) return;
  const remaining = [];
  for ( const entry of u.persistent ) {
    const amount = rules.applyIwr(u.spec.iwr, { [entry.part.type]: Math.max(0, samplePart(entry.part, run.rng)) });
    dealDamage(run, run.byId.get(entry.sourceId), u, amount);
    log(run, u, `takes ${amount} persistent ${entry.part.type}`);
    if ( !rules.persistentFlatCheck(run.rng) ) remaining.push(entry);
  }
  u.persistent = remaining;
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

function summarize(run, ended) {
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
      resourcesUsed: Object.fromEntries(Object.entries(u.resourcesStart).map(([k, v]) => [k, v - (u.resources[k] ?? 0)]))
    };
  }
  return { outcome, winners, rounds: run.round, firstFallen: run.firstFallen, units, log: run.log };
}

/** Simulate a single battle. */
export function runOne(prep, seed, { log: withLog = false } = {}) {
  const run = createRun(prep);
  run.rng = createRng(seed);
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
  return summarize(run, ended);
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

/** Replay one seed with a full narrative log. */
export function replay(spec, rules, seed) {
  return runOne(prepareBattle(spec, rules), seed, { log: true });
}

export { prepareBattle, areEnemies };
