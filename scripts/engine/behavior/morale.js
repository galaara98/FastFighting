/**
 * Morale: stress from losses, wounds, a fallen leader or master, bad odds, and friends seen running, resisted by Brave.
 * Outcomes: hold, waver (-1 to attacks), or rout (leave the battle).
 *
 * Running together. Nobody runs alone if it can help it, and nobody watches a friend run without wondering:
 *  - Seen running (whatever sent it: its nerve, someone's words, a spell or a terror): every friend in its group takes
 *    it hard (stress, more for one of its leaders; more again in a group with nobody able to lead it), and wonders at
 *    its next turn whether to run too.
 *  - Calling a retreat: one who means to run first tries to take its group with it. Its commander decides (one who
 *    commands calls it itself; a pack runs with its leader); asked, a commander agrees the more shaken it is and the
 *    better the case, and refusing, orders the caller to hold (which it may). Called, the group falls back together:
 *    each member as readily as it would take its commander's lead (the Leader influence setting; a boss's, more), more
 *    when shaken. With nobody to lead it, a group runs together more readily still: nobody tells it to stay. Never the
 *    fearless, nor a player character (they decide for themselves).
 *  - Bosses almost never run (and almost never agree to a retreat someone else urges); their presence steadies the
 *    group, and their word carries, by the Boss influence setting. A leader or boss prone to running (a Chicken above
 *    all; Fragile, Mercenary, Lazy, Wallflower) panics its group more when it goes, and takes more of it along.
 *  - Rallying: seeing friends run or waver, its commander (or one brave and loyal enough, with the voice for it) may
 *    spend an action holding the rest together: those who hear it are steadier this round and the next (less stress,
 *    and slower to answer a call to retreat), and may shake off wavering. A commander's rally carries more (by the
 *    Leader influence setting; a boss's most).
 */
import { STATUS, TACTICAL, STAND_GROUND, clamp } from "../../constants.js";
import { alliesOf, enemiesOf, isStanding, liveTier, liveTrait, chainOf, commandOf, groupKeyOf, edgeDistance, behaviorOf, wish } from "../battle-state.js";
import { threatOf } from "./evaluate.js";
import { perceives } from "./senses.js";
import { followChance } from "./desire.js";
import { canTalk } from "./standoff.js";

export const MORALE = Object.freeze({ HOLD: "hold", WAVER: "waver", ROUT: "rout" });

/**
 * Wanting to run, does u stay anyway? Only someone who doesn't like to flee (Tactics: "I don't like to flee"), and
 * only when running is its own choice (fear, a lost cause, a stated retreat): what a spell or a rule makes it do
 * (frightened, fleeing, turned) plays out as the system says. It stays the "standGround" percent of the time.
 */
export function standsGround(run, u) {
  // A boss almost never runs (one prone to it, a little more readily).
  if ( u.isBoss ) return !run.rng.chance(clamp(BOSS_RUNS * (1 + 3 * (behaviorOf(u).flighty ?? 0)), 0, 0.5));
  // (As often as the setting says for "Never" retreating; less for answers that lean less that way.)
  const strength = wish(u.spec.avoidFleeing);
  if ( !strength ) return false;
  return run.rng.chance((clamp(run.prep?.options.standGround ?? STAND_GROUND, 0, 100) / 100) * strength);
}

/**
 * How shaken u is. With a floor (the stress it must reach for a new morale check), the costly reckoning of the odds is
 * skipped when even the worst odds couldn't bring it there.
 */
export function moraleStress(run, u, floor = -Infinity) {
  const allies = alliesOf(run, u).filter(a => a !== u);
  const lost = allies.filter(a => a.status !== STATUS.STANDING).length;
  const lostFrac = allies.length ? lost / allies.length : 0;
  const hpFrac = u.maxHp > 0 ? u.hp / u.maxHp : 0;
  let stress = 40 * lostFrac;
  if ( hpFrac < 0.25 ) stress += 45;
  else if ( hpFrac < 0.5 ) stress += 25;

  // Its boss or leader fallen: a blow, softened when a lieutenant has stepped up.
  const chain = chainOf(run, groupKeyOf(u));
  const head = chain?.length ? run.byId.get(chain[0].id) : null;
  if ( head && head !== u && !isStanding(head) ) {
    const shock = chain[0].role === "boss" ? 35 : 25;
    stress += commandOf(run, u) ? Math.round(shock / 2) : shock;
  }
  const masterId = u.spec.flags?.masterId;
  if ( masterId ) {
    const master = run.byId.get(masterId);
    if ( master && !isStanding(master) ) stress += (100 - liveTrait(run, u, "loyal")) * 0.6;
    else stress -= liveTrait(run, u, "loyal") * 0.2;
  }

  // Friends seen running (whatever sent them: nerve, words, magic), the more so one of its leaders: panic spreads.
  // (One of its leaders, the more so one prone to running.)
  let panic = 0;
  for ( const a of groupMates(run, u) ) {
    if ( !running(run, a) || (isStanding(a) && !perceives(run, u, a, { crisis: true })) ) continue;
    panic += chain?.some(c => c.id === a.id) ? PANIC_HEAD * (1 + (behaviorOf(a).flighty ?? 0)) : PANIC;
  }
  // Nobody able to lead it: nobody to tell it to stay. Its commander there, steady: steadier (a boss, much).
  const cmd = commandOf(run, u);
  const calming = cmd && cmd.unit !== u && !cmd.unit.wavering && !running(run, cmd.unit) ? clamp(1 - 0.15 * commandWeight(run, cmd), 0.4, 1) : 1;
  const scale = cmd ? calming : LEADERLESS;
  stress += Math.min(PANIC_MAX * Math.max(1, scale), panic * scale);
  // Rallied: steadier for a round (a commander's rally, more).
  if ( steadied(run, u) ) stress -= STEADY * (u.steadiedBy ?? 1);

  // Someone who made them pay and is still standing, unanswered, weighs on them.
  for ( const [id, g] of u.grudges ?? [] ) {
    if ( !g.provoked && isStanding(run.byId.get(id) ?? {}) ) stress += 15;
  }
  // Selfish creatures care less about the group, more about themselves.
  const factor = 0.8 + liveTrait(run, u, "selfish") / 250;

  // Tactical creatures read the odds and retreat from lost causes; others only feel losses and wounds.
  if ( liveTier(run, u) >= TACTICAL.TACTICAL && (stress + ODDS) * factor >= floor ) {
    const foes = enemiesOf(run, u).filter(isStanding);
    const friends = alliesOf(run, u).filter(isStanding);
    const foeThreat = foes.reduce((s, f) => s + threatOf(run, f, u), 0);
    const friendThreat = friends.reduce((s, f) => s + (foes[0] ? threatOf(run, f, foes[0]) : 0), 0);
    if ( friendThreat > 0 ) stress += clamp(25 * (foeThreat / friendThreat - 1), 0, ODDS);
  }
  return Math.max(0, stress * factor);
}

/** The most that bad odds add to a tactical creature's stress. */
const ODDS = 40;

/** Stress from seeing a friend run: each one, one of its leaders, and at most. */
const PANIC = 12;
const PANIC_HEAD = 20;
const PANIC_MAX = 35;
/** Stress a rally takes off those who hear it, the round it's called and the next. */
const STEADY = 20;
/** How far a call to retreat, or a rally, carries (feet). */
const EARSHOT = 60;
/** A group with nobody able to lead it: panic from friends seen running, and readiness to run with a caller, ×. */
const LEADERLESS = 1.3;
const LEADERLESS_FOLLOW = 0.65;

/** How much a commander's word and presence carry: the Leader influence setting (50 = ×1), a boss's by Boss influence. */
function commandWeight(run, cmd) {
  const opts = run.prep.options ?? {};
  const scale = (Number.isFinite(opts.leaderInfluence) ? opts.leaderInfluence : 50) / 50;
  return clamp(scale * (cmd?.boss ? (Number(opts.bossInfluence) || 2) : 1), 0, 4);
}

/** A boss's chance to run anyway, when it would (×4 for a Chicken). */
const BOSS_RUNS = 0.05;
/** A boss asked by someone else to call a retreat: this much as likely to agree. */
const BOSS_AGREES = 0.2;

/** u's group mates (its side; its neutral friend group), other than itself. */
function groupMates(run, u) {
  const key = groupKeyOf(u);
  return key ? run.units.filter(a => a !== u && groupKeyOf(a) === key) : [];
}

/** Within earshot (without a map, always). */
const hears = (a, b) => { const d = edgeDistance(a, b); return d === null || d <= EARSHOT; };

/** Steadied by a rally this round or last. */
const steadied = (run, u) => (u.steadied ?? -9) >= run.round - 1;

/**
 * Running, whatever sent it: fled this round or last (its nerve, a retreat, someone's words), or on the field and sent
 * running by a spell or a rule (fleeing, turned).
 */
export function running(run, a) {
  if ( a.status === STATUS.FLED ) return (a.ranRound ?? -9) >= run.round - 1;
  return isStanding(a) && !!(a.conds?.fleeing || a.conds?.turned);
}

/**
 * u means to run: does its group go with it? Its commander decides (u itself, if it commands; with nobody commanding,
 * u can only shout and hope; a player character commanding isn't made to). Returns who falls back with u (the
 * commander first, when u talked it into it), or held: true when the commander refused and u obeys its order to hold.
 * @param {(unit, data) => void} say
 * @returns {{followers: object[], commander: object|null, held: boolean}}
 */
export function callRetreat(run, u, say = () => {}) {
  const none = { followers: [], commander: null, held: false };
  if ( u.controlledBy ) return none;
  const mates = groupMates(run, u).filter(a => isStanding(a) && a.active !== false && !a.controlledBy && hears(u, a));
  if ( !mates.length ) return none;
  const commander = commandOf(run, u)?.unit ?? null;
  // A commander leads by example (a pack runs with its leader); anyone else has to say so.
  if ( commander !== u && !canTalk(u) ) return none;
  if ( commander && commander !== u ) {
    if ( !mates.includes(commander) || commander.spec.kind === "pc" ) return none;
    const shaken = (moraleStress(run, commander) - liveTrait(run, commander, "brave") * 0.75) / 100;
    const word = (chainOf(run, groupKeyOf(u))?.some(c => c.id === u.id) ? 0.15 : 0) + 0.2 * (u.prep.talkAffinity ?? 0);
    const p = clamp((0.2 + shaken + word) * (steadied(run, commander) ? 0.5 : 1) * (commander.isBoss ? BOSS_AGREES : 1), 0.01, 0.85);
    if ( !run.rng.chance(p) ) {
      say(commander, { type: "retreat", what: "refused", target: u.spec.name, targetId: u.id, chance: p });
      // Ordered to hold: it does as readily as it would take its commander's lead.
      const f = followChance(run, u);
      return { ...none, commander, held: !!f && run.rng.chance(f.chance) };
    }
  }
  const leader = commander ?? u;
  say(leader, {
    type: "retreat", what: "call", by: u.spec.name, byId: u.id, urged: !!commander && commander !== u
  });
  const followers = commander && commander !== u ? [commander] : [];
  // (A commander prone to running takes more of them along.)
  const flighty = commander ? 1 + (behaviorOf(commander).flighty ?? 0) : 1;
  for ( const a of mates ) {
    if ( a === commander || a.spec.kind === "pc" || a.spec.flags?.fearless || liveTrait(run, a, "brave") >= 95 || a.tac?.retreat === "never" ) continue;
    const f = commander ? followChance(run, a) : null;
    const shaken = clamp((moraleStress(run, a) - liveTrait(run, a, "brave") * 0.75) / 100, -0.3, 0.4);
    const p = clamp(((f?.chance ?? LEADERLESS_FOLLOW) + shaken) * flighty * (steadied(run, a) ? 0.6 : 1), 0, 0.95);
    if ( run.rng.chance(p) && !standsGround(run, a) ) followers.push(a);
  }
  return { followers, commander: leader, held: false };
}

/**
 * u, seeing friends in its group run or waver, may hold the rest together (an action, spent by the caller): its
 * commander most readily; otherwise one brave and loyal enough, with the voice for it (playstyles that look after
 * their people: more readily); never one shaken itself, nor twice for the same round's trouble. Those who hear it are
 * steadied (stress, and retreat calls, for this round and the next), and may shake off wavering.
 * @returns {object[]|null}  who heard it, or null if it doesn't rally
 */
export function rallies(run, u) {
  if ( !canTalk(u) || u.wavering || u.controlledBy ) return null;
  const mates = groupMates(run, u);
  const heard = mates.filter(a => isStanding(a) && a.active !== false && hears(u, a));
  if ( !heard.length ) return null;
  if ( !mates.some(a => running(run, a)) && !heard.some(a => a.wavering) ) return null;
  const cmd = commandOf(run, u);
  const commands = cmd?.unit === u;
  const brave = liveTrait(run, u, "brave");
  const loyal = liveTrait(run, u, "loyal");
  const keen = behaviorOf(u).rally ?? 0;
  if ( !commands && !keen && (brave < 65 || loyal < 55) ) return null;
  const weight = commands ? commandWeight(run, cmd) : 1;
  // (Only where it adds something: not twice for the same round, unless a stronger voice.)
  const by = commands ? clamp(1.5 * weight, 1, 3) : 1;
  if ( heard.every(a => a.steadied === run.round && (a.steadiedBy ?? 1) >= by) ) return null;
  const p = commands ? clamp((0.6 + keen / 2) * weight, 0, 0.95) : clamp(0.1 + Math.max(0, brave - 65) / 100 + Math.max(0, loyal - 55) / 150 + 0.2 * (u.prep.talkAffinity ?? 0) + keen, 0.05, 0.6);
  if ( !run.rng.chance(p) ) return null;
  for ( const a of heard ) {
    a.steadiedBy = a.steadied === run.round ? Math.max(a.steadiedBy ?? 1, by) : by;
    a.steadied = run.round;
    if ( a.wavering && run.rng.chance(commands ? clamp(0.5 * weight, 0.2, 0.9) : 0.3) ) a.wavering = false;
  }
  return heard;
}

/** Roll morale at the start of u's turn when its stress has risen meaningfully. */
export function checkMorale(run, u) {
  const side = run.prep.sides[u.side];
  // A player's stated retreat rule replaces the bravery roll.
  const retreat = u.tac?.retreat;
  if ( retreat ) {
    if ( retreat === "never" ) return MORALE.HOLD;
    // (Badly hurt: under a quarter, unless the system says otherwise; Ironsworn heroes fight on until 0 health.)
    if ( retreat === "hurt" ) return (u.maxHp > 0 && u.hp / u.maxHp < (run.prep.rules.retreatAt ?? 0.25)) ? MORALE.ROUT : MORALE.HOLD;
    if ( retreat === "losing" ) {
      const friends = alliesOf(run, u).filter(isStanding).length;
      const foes = enemiesOf(run, u).filter(isStanding).length;
      const fallen = alliesOf(run, u).filter(a => a.status !== STATUS.STANDING).length;
      return (fallen >= Math.ceil(alliesOf(run, u).length / 2) && foes > friends) ? MORALE.ROUT : MORALE.HOLD;
    }
  }
  if ( !side.morale ) return MORALE.HOLD;
  // A system's own morale rule, for those it covers (DCC: a Will save when a group's first falls, when half are down,
  // when one alone has lost half its hit points): its answer stands, and what it rolled is told.
  const own = run.prep.rules.morale?.(run, u);
  if ( own ) {
    const said = typeof own === "object" ? own.said : null;
    if ( said?.text && run.log ) run.log.push({ round: run.round, turn: run.turn ?? 0, turnOf: run.turnOf ?? null, actor: u.spec.name, actorId: u.id, side: u.side, type: "morale", text: said.text, ...said.data });
    return typeof own === "object" ? own.result : own;
  }
  const brave = liveTrait(run, u, "brave");
  if ( u.spec.flags?.fearless || brave >= 95 ) return MORALE.HOLD;
  const stress = moraleStress(run, u, u.moraleStress + 10);
  if ( stress < u.moraleStress + 10 ) return u.wavering ? MORALE.WAVER : MORALE.HOLD;
  u.moraleStress = stress;
  const resolve = brave * 0.75;
  if ( stress <= resolve ) return u.wavering ? MORALE.WAVER : MORALE.HOLD;
  const p = clamp((stress - resolve) / 80, 0, 0.85);
  if ( !run.rng.chance(p) ) return u.wavering ? MORALE.WAVER : MORALE.HOLD;
  return stress > brave ? MORALE.ROUT : MORALE.WAVER;
}
