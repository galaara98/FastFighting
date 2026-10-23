/**
 * Team stances. A team (the party, each hostile group, each friend group of those taking no side: battle-state.js
 * groupKeyOf) takes a view of the fight as a whole through its head, once a round, and all of it but those who don't
 * listen to leaders acts on it:
 *  - leave: the odds against it look too long. A competent head or better counts heads and hit points; a tactical
 *    one weighs, too, how long each side would take to bring the other down.
 *  - save / harm: a friend group of those taking no side jumps in for the side it leans to as soon as that side is set
 *    upon near it, or against a side it holds a grudge against. An instinctive head does it rashly; a competent one
 *    weighs the odds first.
 *  - wait, then prey: a team not in it yet hangs back while two others fight, and goes in once one of them is spent,
 *    to rob, extort or finish. A tactical head or better; a mastermind picks the better mark, winner or loser.
 * The party takes a stance only when FastFighting plays all of it (playsParty). A new head (the old one fallen, gone
 * over, or deposed) takes the team's view again by its own nature and wishes: one that would fight on calls back a
 * team its old head took away. Kept per fight (run.stance), never in what a batch shares. Pure: no Foundry globals.
 */
import { TACTICAL, SIDES, STATUS, NEUTRAL_PARTY, clamp } from "../../constants.js";
import { chainOf, command, canCommand, groupKeyOf, liveTier, liveTrait, isStanding, areEnemies, edgeDistance } from "../battle-state.js";
import { threatOf } from "./evaluate.js";
import { isNeutral, turnOn, leanSide, LEAN, GRIEVANCE, fighting } from "./neutral.js";
import { standsGround } from "./morale.js";
import { isLeaving, stopLeaving } from "./leaving.js";
import { think } from "./desire.js";
import { ignoresLeader } from "./deals.js";
import { lootable } from "./theft.js";

export const STANCE = Object.freeze({ LEAVE: "leave", SAVE: "save", HARM: "harm", WAIT: "wait", PREY: "prey" });

/** Taken once and kept: a team that has set off, or thrown in its lot. */
const FINAL = new Set([STANCE.LEAVE, STANCE.SAVE, STANCE.HARM]);
/** A fight this near a friend group (feet, from any of it) is one it's in the way of. */
export const NEAR = 60;
/** Odds under which a team is spent: its fight as good as lost. */
export const SPENT = 0.25;
/**
 * Leaving: the odds a team's head will stand for, before its nature (base); its selfishness raises them, its
 * bravery lowers them (per point from 50); one with no part in the fight minds the danger more (bystander); and its
 * own strongest wish to hurt a foe lowers them (per point over 40, at most wish).
 */
export const LEAVE_AT = Object.freeze({ base: 0.3, selfish: 1 / 200, brave: 1 / 150, bystander: 0.15, hurt: 1 / 200, wish: 0.2, least: 0.1, most: 0.55 });
/** Jumping in: a round's chance from how fond it is of the side (fond), its bravery and loyalty; never more than most. */
export const JUMP_IN = Object.freeze({ fond: 0.35, brave: 1 / 200, loyal: 1 / 300, most: 0.85, hopeless: 0.2, devoted: 80 });

/** Does FastFighting play the whole party (in a live battle, none of it the players'; in the planner, by its toggle)? */
export function playsParty(run) {
  if ( run.live ) return !run.units.some(u => u.side === SIDES.FRIENDLY && run.live.players?.has(u.id));
  return run.prep.options.playersRun === false;
}

/** Each team in the fight, and its members: group key -> units. */
function teams(run) {
  const out = new Map();
  for ( const u of run.units ) {
    const key = groupKeyOf(u);
    if ( !key || u.spec.hazard || u.summoner ) continue;
    if ( !out.has(key) ) out.set(key, []);
    out.get(key).push(u);
  }
  return out;
}

/** Those of a team still in it: on their feet and not on their way out. */
const up = members => members.filter(o => isStanding(o) && !isLeaving(o));

/**
 * Its head now: its chain's head if it can lead (one taking no side still watching counts: command() wouldn't see it),
 * else whoever commands it. Null for a leaderless team.
 */
function headOf(run, key) {
  const first = chainOf(run, key)?.[0];
  const u = first ? run.byId.get(first.id) : null;
  if ( u && groupKeyOf(u) === key && u.status === STATUS.STANDING && u.active !== false && canCommand(u) ) return u;
  return command(run, key)?.unit ?? null;
}

/** May this team take a stance: a head of its own, the party only when FastFighting plays all of it? */
function free(run, key, head) {
  if ( !head || head.controlledBy ) return false;
  if ( key === SIDES.FRIENDLY || head.spec.kind === "pc" ) return playsParty(run);
  return true;
}

/**
 * u's team's stance, if u goes along with it (its head's own, always; the rest but those who don't listen to leaders,
 * and players' characters only when FastFighting plays them all). Null otherwise.
 */
export function stanceOf(run, u) {
  const key = groupKeyOf(u);
  const s = key ? run.stance?.[key] : null;
  if ( !s ) return null;
  if ( u.id === s.byId ) return s;
  if ( u.spec.kind === "pc" && !playsParty(run) ) return null;
  return ignoresLeader(u) ? null : s;
}

/**
 * How a team would fare against another, 0 (hopeless) to 1 (certain): at a head's tier. Competent and below: hit points
 * (three parts) and heads (one); tactical and up: how long each would take to bring the other down, by what each deals
 * a round (behavior/evaluate.js threatOf).
 */
export function teamOdds(run, ours, theirs, tier = TACTICAL.COMPETENT) {
  const a = up(ours);
  const b = up(theirs);
  if ( !b.length ) return 1;
  if ( !a.length ) return 0;
  const hp = list => list.reduce((s, o) => s + Math.max(0, o.hp) + (o.temp ?? 0) + (o.stamina ?? 0), 0);
  const ha = hp(a);
  const hb = hp(b);
  const share = ha + hb > 0 ? ha / (ha + hb) : 0.5;
  const heads = a.length / (a.length + b.length);
  if ( tier < TACTICAL.TACTICAL ) return 0.75 * share + 0.25 * heads;
  const dealt = (from, to) => from.reduce((s, o) => s + (Number(threatOf(run, o, to[0])) || 0), 0);
  // (Worked out apart from the round's own reckoning (evaluate.js keeps one per round): a head sizing things up as the
  // round begins mustn't fix what the others reckon later in it.)
  const kept = [run.threatRound, run.threatCache, run.threatCacheInner];
  run.threatRound = null;
  let da;
  let db;
  try {
    da = dealt(a, b);
    db = dealt(b, a);
  } finally {
    [run.threatRound, run.threatCache, run.threatCacheInner] = kept;
  }
  // (Rounds for each to bring the other down: the sooner, the likelier to win.)
  const ta = da > 0 ? hb / da : Infinity;
  const tb = db > 0 ? ha / db : Infinity;
  if ( !Number.isFinite(ta) && !Number.isFinite(tb) ) return share;
  if ( !Number.isFinite(ta) ) return 0;
  if ( !Number.isFinite(tb) ) return 1;
  return clamp(tb / (ta + tb), 0, 1);
}

/** Which teams have come to blows with which: a blow struck either way, or a quarrel taken up. key -> Set(key). */
function blows(run, all) {
  const out = new Map([...all.keys()].map(k => [k, new Set()]));
  const keyOf = new Map(run.units.map(o => [o.id, groupKeyOf(o)]));
  const meet = (a, b) => {
    if ( !a || !b || a === b || !out.has(a) || !out.has(b) ) return;
    out.get(a).add(b);
    out.get(b).add(a);
  };
  for ( const o of run.units ) {
    const k = keyOf.get(o.id);
    for ( const by of o.harmedBy?.keys?.() ?? [] ) meet(k, keyOf.get(by));
    if ( isNeutral(o) ) for ( const side of o.against ) for ( const x of run.units ) if ( x.side === side ) meet(k, keyOf.get(x.id));
  }
  return out;
}

/**
 * Those a team would be up against: the teams it's at blows with; not at blows yet, the strongest of its foes in the
 * fight (it would face one at a time); one taking no side, at blows with no one, the strongest team fighting near it.
 */
function dangerTo(run, members, engaged) {
  if ( isNeutral(members[0]) && !members.some(m => m.against.size) ) {
    // (Not the side it leans to: its friends are no danger to it.)
    const friends = leanSide(run, members[0]);
    const near = run.units.filter(o => !members.includes(o) && o.side !== friends && fighting(run, o) && isStanding(o) && members.some(m => (edgeDistance(m, o) ?? Infinity) <= NEAR));
    return { foes: strongestTeam(run, near), bystander: true };
  }
  const foes = run.units.filter(o => !members.includes(o) && isStanding(o) && !isLeaving(o) && members.some(m => areEnemies(run, m, o)) && !isNeutral(o));
  if ( engaged.size ) return { foes: [...foes, ...run.units.filter(o => isNeutral(o) && isStanding(o) && engaged.has(groupKeyOf(o)))], bystander: false };
  return { foes: strongestTeam(run, foes), bystander: false };
}

/** (a) Does its head take it out of the fight? {kind: leave, odds} or null. */
function weighLeaving(run, head, members, engaged, tier) {
  if ( tier < TACTICAL.COMPETENT ) return null;
  const { foes, bystander } = dangerTo(run, members, engaged);
  if ( !foes.length ) return null;
  const odds = teamOdds(run, members, foes, tier);
  // (Its own wishes as well as its nature: one bent on a foe (vengeance for a fallen head, say) holds on longer.)
  const bent = Math.max(0, ...(head.lastDesires ?? []).filter(d => d.kind === "hurt").map(d => d.level));
  const need = clamp(LEAVE_AT.base + (liveTrait(run, head, "selfish") - 50) * LEAVE_AT.selfish - (liveTrait(run, head, "brave") - 50) * LEAVE_AT.brave
    + (bystander ? LEAVE_AT.bystander : 0) - clamp((bent - 40) * LEAVE_AT.hurt, 0, LEAVE_AT.wish), LEAVE_AT.least, LEAVE_AT.most);
  // (A boss almost never gives up: morale.js standsGround, asked only when it would.)
  return odds < need && !standsGround(run, head) ? { kind: STANCE.LEAVE, target: null, odds } : null;
}

/** The members of the strongest team among these (by standing hit points). */
function strongestTeam(run, units) {
  const byTeam = new Map();
  for ( const o of units ) {
    const k = groupKeyOf(o) ?? o.id;
    byTeam.set(k, [...(byTeam.get(k) ?? []), o]);
  }
  let best = [];
  let most = -1;
  for ( const list of byTeam.values() ) {
    const hp = list.reduce((s, o) => s + Math.max(0, o.hp), 0);
    if ( hp > most ) [best, most] = [list, hp];
  }
  return best;
}

/** The standing members of a side (not those taking no side). */
const sideUnits = (run, side) => run.units.filter(o => o.side === side && isStanding(o) && !isNeutral(o));

/** The sides fighting a side now: its enemies with someone standing (not those taking no side). */
const foesOfSide = (run, side) => [...(run.prep.sides[side]?.enemies ?? [])].filter(s => sideUnits(run, s).length);

/** (b) A friend group jumping in, for a side or against one: {kind: save|harm, target: side, odds} or null. */
function weighJumping(run, head, members, tier) {
  if ( !isNeutral(head) || members.some(m => m.against.size) || tier < TACTICAL.INSTINCTIVE ) return null;
  const near = o => members.some(m => (edgeDistance(m, o) ?? Infinity) <= NEAR);
  const brave = liveTrait(run, head, "brave");
  const loyal = liveTrait(run, head, "loyal");
  // Save: the side it leans to, set upon near it.
  const side = leanSide(run, head);
  if ( side ) {
    const ours = sideUnits(run, side);
    const beset = ours.some(o => near(o) && o.harmedBy.size > 0);
    if ( beset && foesOfSide(run, side).length ) {
      const fond = clamp((head.leanLevel ?? LEAN) / LEAN, 0, 1.5);
      let p = JUMP_IN.fond * fond + (brave - 50) * JUMP_IN.brave + (loyal - 50) * JUMP_IN.loyal;
      const foes = foesOfSide(run, side).flatMap(s => sideUnits(run, s));
      const odds = teamOdds(run, [...members, ...ours], foes, tier);
      // (A competent head weighs it: not into a hopeless fight, unless it's devoted.)
      if ( tier >= TACTICAL.COMPETENT ) {
        if ( odds < JUMP_IN.hopeless && loyal < JUMP_IN.devoted ) return null;
        p *= clamp(odds / 0.5, 0.3, 1.2);
      }
      if ( run.rng.chance(clamp(p, 0, JUMP_IN.most)) ) return { kind: STANCE.SAVE, target: side, odds };
    }
  }
  // Harm: a side it holds a grudge against (the most any of them holds), near it.
  let grudge = null;
  for ( const m of members ) for ( const [s, g] of m.grievance ) if ( g > (grudge?.g ?? 0) && sideUnits(run, s).length ) grudge = { side: s, g };
  if ( grudge && grudge.g >= GRIEVANCE / 2 && sideUnits(run, grudge.side).some(near) ) {
    const foes = sideUnits(run, grudge.side);
    const odds = teamOdds(run, [...members, ...foesOfSide(run, grudge.side).flatMap(s => sideUnits(run, s))], foes, tier);
    if ( tier >= TACTICAL.COMPETENT && odds < 0.5 ) return null;
    const p = clamp(grudge.g / GRIEVANCE * 0.5 + (brave - 50) * JUMP_IN.brave, 0, JUMP_IN.most);
    if ( run.rng.chance(p) ) return { kind: STANCE.HARM, target: grudge.side, odds };
  }
  return null;
}

/** Is it one to prey on the weakened: selfish enough, scheming, or a thief's, a mercenary's or a cruel nature? */
const opportunist = (run, head) => liveTrait(run, head, "selfish") >= 50 || !!head.scheming || (head.spec.playstyles ?? []).some(p => p === "thief" || p === "mercenary" || p === "cruel");

/**
 * (c) A team not in it yet, with two others at blows: it waits; once one of them is spent, it preys. A mastermind
 * goes for whichever of the two it would fare best against; anyone else for the spent one (the easy pickings), or, that
 * one gone, the other if it can take it. {kind: wait|prey, target: key, odds} or null.
 */
function weighWaiting(run, key, head, members, all, met, tier) {
  if ( tier < TACTICAL.TACTICAL || met.get(key)?.size || !opportunist(run, head) ) return null;
  const pairs = [];
  for ( const [a, others] of met ) {
    if ( a === key ) continue;
    for ( const b of others ) if ( b !== key && a < b ) pairs.push([a, b]);
  }
  if ( !pairs.length ) return null;
  const standing = k => up(all.get(k) ?? []);
  const oddsOf = k => teamOdds(run, all.get(k) ?? [], [...(met.get(k) ?? [])].filter(x => x !== key).flatMap(x => all.get(x) ?? []), tier);
  for ( const [a, b] of pairs ) {
    const spent = [a, b].find(k => !standing(k).length || oddsOf(k) < SPENT);
    if ( !spent ) continue;
    const other = spent === a ? b : a;
    const marks = [spent, other].filter(k => standing(k).length);
    if ( !marks.length ) continue;
    const vs = k => teamOdds(run, members, all.get(k), tier);
    const mark = tier >= TACTICAL.MASTERMIND ? marks.reduce((x, y) => (vs(y) > vs(x) ? y : x))
      : standing(spent).length ? spent : vs(other) >= 0.5 ? other : null;
    if ( mark ) return { kind: STANCE.PREY, target: mark, odds: vs(mark) };
  }
  return { kind: STANCE.WAIT, target: null, odds: null };
}

/**
 * Each team's head takes its view of the fight, as a round begins (simulator.js beginRound): kept in run.stance,
 * told once each time it changes, and acted on at once where that's a matter of whom it's against (a friend group
 * jumping in, or going after its mark); leaving and waiting are played on each one's own turn.
 */
export function decideStances(run, say = () => {}) {
  run.stance ??= {};
  const all = teams(run);
  const met = blows(run, all);
  for ( const [key, members] of all ) {
    const was = run.stance[key] ?? null;
    const head = headOf(run, key);
    // (A new head: the team's view is its own to take again. The same head keeps what it took.)
    const fresh = !!was && was.byId !== head?.id;
    if ( was && !fresh && FINAL.has(was.kind) ) continue;
    // (Its mark still in it: it goes on preying.)
    if ( was?.kind === STANCE.PREY && !fresh && up(all.get(was.target) ?? []).length ) continue;
    if ( !free(run, key, head) || !up(members).length ) {
      if ( was ) run.stance[key] = null;
      continue;
    }
    const tier = liveTier(run, head);
    const engaged = met.get(key) ?? new Set();
    // (Not at blows yet: an opportunist, with two others at it, waits before it thinks of going; a friend group jumps
    // in, if it will, before it thinks of going.)
    const waits = engaged.size ? null : weighWaiting(run, key, head, members, all, met, tier);
    const jumps = waits ? null : weighJumping(run, head, members, tier);
    const now = waits ?? jumps ?? weighLeaving(run, head, members, engaged, tier);
    if ( !now ) {
      if ( was ) run.stance[key] = null;
      // (A new head who'd fight on: it calls back those its old head took away.)
      if ( fresh && was.kind === STANCE.LEAVE ) recall(run, key, members, head, say);
      continue;
    }
    if ( was && was.kind === now.kind && was.target === now.target ) continue;
    run.stance[key] = { ...now, team: key, byId: head.id, round: run.round };
    say(head, { type: "stance", kind: now.kind, team: key, target: now.target, targetName: targetName(run, now.target, all), odds: now.odds });
    enact(run, key, members, run.stance[key], say);
  }
}

/** Those of a team on their way out because its old head judged the odds too long, called back into the fight. */
function recall(run, key, members, head, say) {
  const back = members.filter(m => isStanding(m) && m.leaving?.why === "odds" && !ignoresLeader(m));
  if ( !back.length ) return;
  for ( const m of back ) stopLeaving(m);
  say(head, { type: "stance", kind: "stay", team: key, target: null, targetName: null, odds: null });
}

/** What the story calls the team a stance is about: its side's name, or (a friend group) its head's. */
function targetName(run, target, all) {
  if ( !target ) return null;
  if ( run.prep.sides[target]?.label ) return run.prep.sides[target].label;
  const head = headOf(run, target) ?? up(all.get(target) ?? [])[0];
  return head?.spec.name ?? target;
}

/** A side's standing member to turn on (its first): what neutral.js turnOn takes. */
const oneOf = (run, side) => sideUnits(run, side)[0] ?? null;

/** A stance about whom the team is against, taken up by those who go along with it: now. */
function enact(run, key, members, s, say) {
  const goes = members.filter(m => isStanding(m) && isNeutral(m) && stanceOf(run, m) === s);
  if ( s.kind === STANCE.SAVE ) {
    for ( const m of goes ) {
      m.lean = s.target;
      m.leanLevel = Math.max(m.leanLevel ?? 0, LEAN);
      for ( const side of foesOfSide(run, s.target) ) {
        const by = oneOf(run, side);
        if ( by ) turnOn(run, m, by, "stance", say);
      }
    }
  } else if ( s.kind === STANCE.HARM || s.kind === STANCE.PREY ) {
    // (A mark that's a friend group of those taking no side: no side of its own to turn on. The wishes below still pull.)
    const sides = new Set(up(run.units.filter(o => groupKeyOf(o) === s.target)).map(o => o.side).filter(side => side !== key && side !== NEUTRAL_PARTY));
    for ( const m of goes ) for ( const side of sides ) {
      const by = oneOf(run, side);
      if ( by && !m.against.has(side) ) turnOn(run, m, by, "stance", say);
    }
  }
}

/**
 * Preying (simulator.js thinkOver, each turn): what u wants of its team's mark, by its nature. A thief or a mercenary
 * robs the fallen and makes the standing pay; a cruel one finishes the weak; anyone else a little of each.
 */
export function stanceWishes(run, u) {
  const s = stanceOf(run, u);
  if ( s?.kind !== STANCE.PREY || !u.desire ) return;
  const styles = new Set(u.spec.playstyles ?? []);
  const greedy = styles.has("thief") || styles.has("mercenary");
  const cruel = styles.has("cruel");
  for ( const t of run.units ) {
    if ( groupKeyOf(t) !== s.target || t === u ) continue;
    if ( lootable(run, t) && !u.robbedFrom?.has(t.id) ) think(u, "rob", t.id, greedy ? 55 : 40);
    if ( !isStanding(t) ) continue;
    if ( greedy && t.hp > 0 && !u.dealt?.has(t.id) ) think(u, "extort", t.id, 45);
    const weak = t.maxHp > 0 ? 1 - t.hp / t.maxHp : 0;
    think(u, "hurt", t.id, (cruel ? 45 : 30) + 30 * weak);
  }
}
