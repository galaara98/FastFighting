/**
 * Taking no side: neutral parties.
 *
 * Neutral tokens, and enemies talked out of the fight, stand on the field as a party of their own (NEUTRAL_PARTY):
 * nobody fights them and they fight no one. Each stands with its friend group alone (the planner's groups 1 2 3: the
 * villagers, the caravan; an enemy talked out of the fight, alone), and each may lean one way: the planner's "leans
 * toward the party / the enemy / the nearest side / the underdog" makes it want that side's members safe (a desire,
 * LEAN strong; the underdog's changes as the fight goes), and a friend group wants its own safe too (FELLOW). A lean
 * guides it; it doesn't bind it, and it doesn't last: watching the side it leans to hurt someone it cares about wears
 * it down, and that side hurting it ends it at once.
 *
 *  - Crossed: whoever hurts it, robs it, or insults it with a botched pitch offends it at once. Seeing someone hurt
 *    or hinder a creature it wants safe (or help one it wants hurt) builds a grievance against the doer's side,
 *    faster the more it cares and the worse the harm; enough of it (GRIEVANCE) offends it too. Offended, it turns
 *    on that side alone, and fights it.
 *  - Words first: a talker who can make itself understood confronts the offender instead, a truce between the two
 *    in the middle of the fight. The offender's side can talk it round; it can talk the offender into making amends
 *    (paying up, or an apology). It turns on them when it loses patience, or if that side crosses it again.
 *  - Won over: any side's talkers can talk it into joining them, against its lean too, so long as it hasn't seen
 *    that side cross it. Talkers weigh what joining would mean to it (appeal): a pitch that gives it what it wants
 *    (one leaning their way already wants in) is easier, one that asks it to betray what it wants is harder. Only a
 *    tactical talker knows it could be won over; anyone else tries only when its desires lead it to talk to it.
 *  - Taken for a foe: a tactical mind sees someone taking no side for what it is. Anyone else goes by appearances
 *    (seemsFoe): one leaning toward its enemies seems one of them, and to a feral creature anything close is fair
 *    game; its desires may make attacking it look like a good idea (or, for one who always tries words first,
 *    talking to it, which may win it over by accident).
 *  - Holding back: while someone taking no side is having words with a side, that side's smart members (TACTICAL
 *    and up) don't hurt it or anyone it wants safe, unless the talk is going against them anyway (sparedForTruce).
 *  - Getting involved: in a standoff (and once it's a fight), most keep out of it. One leaning toward a side that it
 *    likes well enough and that looks like winning may speak up (meddling): it talks the side it likes least out of
 *    the fight, or (the greedy) squeezes it for money. A botched word may start a quarrel between it and that side:
 *    the two fight it out, and the standoff between the sides holds (heldOff), unless someone loses patience (blood
 *    nearby wears on everyone) or blames the side it seems to be with (annoyed).
 *  - Can't abide violence (peacekeepers, diplomats, moralists, people-pleasers, those who never kill, those who always talk): seeing
 *    a fight, it puts its words into stopping it, on either side: in a standoff, talking a quarrel's fighters into
 *    letting it be; once it's a fight, talking the fighters into leaving.
 *  - Enemies come here first: an enemy talked into changing sides stands aside (on a d100 under the switch luck),
 *    still leaning a little toward its old friends, the more so the more loyal it is; from here it can be won over
 *    like anyone else.
 * Pure: no Foundry globals.
 */
import { STATUS, NEUTRAL_PARTY, TACTICAL, SWAY, clamp } from "../../constants.js";
import { isStanding, isUp, edgeDistance, liveTrait, liveTier, commandOf, dropAmbition, areEnemies, heldOff } from "../battle-state.js";
import { levelOf, want, think, setLean, allDesires } from "./desire.js";
import { perceives } from "./senses.js";
import { prefersTalk, canTalk, impatience } from "./standoff.js";

/** How much a lean makes it want each member of that side safe ("determined"). */
export const LEAN = 50;
/** How much neutral tokens want each other safe ("wants"). */
export const FELLOW = 30;
/** A lean this weak no longer makes it look like one of that side. */
const SHOWS = 25;
/** Offended at a side once what that side has done against its wishes adds up to this. */
export const GRIEVANCE = 100;
/** A wish to see someone hurt this strong is crossed by healing or bolstering them. */
const SPITE = 40;
/** Wishes for someone's good. */
const CARING = ["protect", "heal", "aid"];

/** Takes no side (for now). */
export const isNeutral = u => u.side === NEUTRAL_PARTY;
/** Easy to talk to: it came as a neutral, or it stands aside now. */
export const standsAside = u => u.spec.originSide === "neutral" || isNeutral(u);

/** A language in common (or, with languages set aside, any language on both sides): talk.js shareLanguage. */
function sharesLanguage(a, b, run) {
  const la = a.spec.social?.languages ?? [];
  const lb = b.spec.social?.languages ?? [];
  if ( run?.prep.options.ignoreLanguages ) return la.length > 0 && lb.length > 0;
  return la.some(l => lb.includes(l));
}

/** The side a lean points to now: its own choice, or (the underdog) whichever side has the least of itself left. */
export function leanSide(run, u) {
  if ( !u.lean ) return null;
  if ( u.lean !== "underdog" ) return u.lean !== NEUTRAL_PARTY && run.prep.sides[u.lean] ? u.lean : null;
  let worst = null;
  for ( const [side, s] of Object.entries(run.prep.sides) ) {
    if ( side === NEUTRAL_PARTY || !s.enemies.size ) continue;
    let max = 0;
    let left = 0;
    for ( const o of run.units ) {
      if ( o.side !== side || o.summoner || o.active === false ) continue;
      max += o.maxHp;
      if ( isStanding(o) ) left += o.hp;
    }
    if ( max > 0 && (!worst || left / max < worst.share) ) worst = { side, share: left / max };
  }
  return worst?.side ?? null;
}

/**
 * The other neutral tokens in a neutral token's friend group (the planner's 1 2 3; all of them, without groups). A Secret
 * token the GM put on a neutral team is one of that team's.
 */
function fellowsOf(run, u) {
  const neutralToken = o => o.spec.side === NEUTRAL_PARTY && (o.spec.originSide === "neutral" || (o.spec.originSide === "secret" && !!o.spec.group));
  if ( !neutralToken(u) ) return [];
  return run.units.filter(o => o !== u && neutralToken(o) && (o.spec.group ?? null) === (u.spec.group ?? null)).map(o => o.id);
}

/** Point every lean at the members of the side it leans to (they change: the underdog, a new recruit). */
export function refreshLeans(run) {
  if ( !run.neutral ) return;
  for ( const u of run.units ) {
    if ( !u.desire ) continue;
    const fellows = u.fellows ??= fellowsOf(run, u);
    if ( !u.lean && !fellows.length ) continue;
    const side = leanSide(run, u);
    const level = u.leanLevel ?? LEAN;
    const members = side && level > 0 ? run.units.filter(o => o !== u && o.side === side && o.status !== STATUS.DEAD).map(o => o.id) : [];
    const key = `${side}|${members.length}|${Math.round(level)}`;
    if ( u.leaning === key ) continue;
    u.leaning = key;
    setLean(u, [...fellows.map(id => ["protect", id, FELLOW]), ...members.map(id => ["protect", id, level])]);
  }
}

/** Playstyles that can't abide violence: seeing a fight, they try to stop it. */
const PEACEABLE = new Set(["peacekeeper", "diplomat", "moralist", "peoplePleaser"]);

/** Can't abide violence: a peaceable playstyle, Tactics' "I never kill", or always prefers talking to fighting. */
export const dislikesViolence = u => !!u.spec.neverKill || (!!u.spec.alwaysTalk && !u.spec.stayTrue) || (u.spec.playstyles ?? []).some(p => PEACEABLE.has(p));

/** Is o fighting anyone right now (in a standoff: a quarrel with someone taking no side)? */
export function fighting(run, o) {
  if ( !isStanding(o) || o.holdsBack ) return false;
  return run.units.some(p => p !== o && isStanding(p) && !(p.spec.hidden && !p.revealed) && areEnemies(run, o, p) && !heldOff(run, o, p));
}

/** In a standoff, is u in a quarrel (one of its sides against someone taking no side)? It fights that out. */
export const inFray = (run, u) => !!run.standoff && fighting(run, u);

/** Getting involved: the chance before personality, and how much a liked, winning side adds. */
const MEDDLE = { base: 0.08, keen: 0.6, max: 0.85 };

/**
 * Does n, taking no side, get involved (in this standoff, or in the fight once it's on)? Decided once (again if its lean
 * changes): mostly not, unless the side it leans toward is one it likes well enough and looks like winning (its
 * standing members' hit points against its enemies'). The bold, the greedy and the talkers get involved more readily.
 * Involved, it goes after the side it likes least: talking it out of the fight ("down"), or, the greedier it is, the
 * likelier squeezing it for money ("extort").
 * @returns {{how: "down"|"extort", side: string, against: string[], chance: number, odds: number}|null}
 */
export function meddling(run, n, say = () => {}) {
  const favored = isNeutral(n) && (n.leanLevel ?? LEAN) > 0 ? leanSide(run, n) : null;
  const enemies = favored ? run.prep.sides[favored]?.enemies : null;
  if ( !enemies?.size ) return null;
  const key = `${favored}|${run.standoff ? "standoff" : "fight"}`;
  if ( n.meddling?.key === key ) return n.meddling.how ? n.meddling : null;
  const strength = has => run.units.reduce((s, o) => (!isNeutral(o) && has(o.side) && isStanding(o) ? s + o.hp + (o.temp ?? 0) + (o.stamina ?? 0) : s), 0);
  const ours = strength(s => s === favored);
  const theirs = strength(s => enemies.has(s));
  const odds = ours + theirs > 0 ? ours / (ours + theirs) : 0.5;
  const fond = clamp((n.leanLevel ?? LEAN) / LEAN, 0, 1.5);
  const winning = clamp((odds - 0.35) / 0.4, 0, 1); // (nothing at a third of the strength; all at three quarters)
  let p = MEDDLE.base + MEDDLE.keen * fond * winning;
  p *= 1 + (liveTrait(run, n, "brave") - 50) / 100;
  p *= 1 + (liveTrait(run, n, "selfish") - 50) / 200; // (a chance at money)
  if ( prefersTalk(n) ) p *= 1.3;
  p = clamp(p, 0.02, MEDDLE.max);
  const greed = clamp(0.1 + (liveTrait(run, n, "selfish") - 50) / 50, 0.05, 0.85);
  const how = !run.rng.chance(p) ? null : run.rng.chance(greed) ? "extort" : "down";
  n.meddling = { key, how, side: favored, against: [...enemies], chance: p, odds };
  const sideLabel = run.prep.sides[favored]?.label ?? favored;
  const theirLabel = n.meddling.against.map(s => run.prep.sides[s]?.label ?? s).join(", ");
  if ( !how ) say(n, { type: "neutral", what: "aloof", chance: p, side: favored, sideLabel });
  else say(n, { type: "neutral", what: "meddle", how, chance: p, side: favored, sideLabel, against: theirLabel });
  return how ? n.meddling : null;
}

/**
 * u, of one of a standoff's sides, answers an insult from someone taking no side: the two sides of it come to blows
 * (it fights u's side now), and the standoff holds.
 */
export function feud(run, u, n, say) {
  if ( !isNeutral(n) || isNeutral(u) || n.status === STATUS.DEAD || n.against.has(u.side) ) return false;
  if ( n.truce?.side === u.side ) n.truce = null;
  n.against.add(u.side);
  n.sway.delete(u.side);
  n.active = true;
  n.aware = true;
  n.joinedRound ??= run.round;
  n.targetId = null;
  want(u, "hurt", n.id, 40);
  want(n, "hurt", u.id, 30);
  run.geo = (run.geo ?? 0) + 1; // friends and foes have changed
  say(u, { type: "neutral", what: "feud", target: n.spec.name, targetId: n.id });
  return true;
}

/** How likely one side of a standoff blames the other for an insult (or, per blow, harm) from someone leaning its way. */
export const ANNOYED = { insult: 0.35, blow: 0.15 };

/**
 * u, of one side of a standoff, crossed by n, who takes no side but seems to be with the other side: it may blame them
 * (u.annoyed: on its turn, it breaks the standoff). A tactical mind sees it for what it is, mostly.
 */
export function annoyedBy(run, u, n, chance = ANNOYED.insult) {
  if ( !run.standoff || isNeutral(u) || !isNeutral(n) || u.annoyed ) return;
  const leaning = leanSide(run, n);
  if ( !leaning || (n.leanLevel ?? LEAN) < SHOWS || !run.prep.sides[u.side]?.enemies.has(leaning) ) return;
  if ( run.rng.chance(chance * (liveTier(run, u) >= TACTICAL.TACTICAL ? 0.4 : 1)) ) u.annoyed = { byId: n.id, side: leaning };
}

/** Its lean wears down (it's lost at 0). */
function wearLean(run, n, amount) {
  n.leanLevel = Math.max(0, (n.leanLevel ?? LEAN) - amount);
  if ( n.leanLevel <= 0 ) n.lean = null;
  n.leaning = null;
  refreshLeans(run);
}

/**
 * Does u take n, who takes no side, for a foe? A tactical mind (TACTICAL and up) sees it for what it is, unless it
 * wants it hurt. Anyone else goes by its desires and by appearances: one leaning toward u's enemies seems to be one
 * of them, and to a feral creature anything close enough to bite is fair game.
 */
export function seemsFoe(run, u, n) {
  if ( !run.neutral || u === n || !isNeutral(n) || isNeutral(u) || n.against.has(u.side) || !isUp(n) ) return false;
  if ( levelOf(u, "hurt", n.id) >= 20 ) return true;
  const tier = liveTier(run, u);
  if ( tier >= TACTICAL.TACTICAL ) return false;
  const leaning = leanSide(run, n);
  if ( leaning && (n.leanLevel ?? LEAN) >= SHOWS && run.prep.sides[u.side]?.enemies.has(leaning) ) return true;
  return tier <= TACTICAL.FERAL && (edgeDistance(u, n) ?? Infinity) <= 10;
}

/**
 * Is the talk with n going against the side it's confronting (it will turn on them anyway)? Nobody on that side can
 * talk to it, or it's near the end of its patience.
 */
export function losingTruce(run, n) {
  const side = n.truce?.side;
  if ( !side ) return false;
  const voice = run.units.some(o => o.side === side && isStanding(o) && canTalk(o) && sharesLanguage(n, o, run)
    && ((o.prep.talkAffinity ?? 0) > 0 || prefersTalk(o)));
  return !voice || impatience(run, n, n.truce.round) >= 0.4;
}

/**
 * Whom a smart member of u's side (TACTICAL and up) holds off hurting while someone taking no side is having words
 * with that side: that someone, and anyone it wants safe. Nobody, once the talk is going against them anyway.
 * @returns {Set<string>|null}
 */
export function sparedForTruce(run, u) {
  if ( !run.neutral || isNeutral(u) || liveTier(run, u) < TACTICAL.TACTICAL ) return null;
  let spared = null;
  for ( const n of run.units ) {
    if ( !isNeutral(n) || n.truce?.side !== u.side || !isUp(n) || losingTruce(run, n) ) continue;
    (spared ??= new Set()).add(n.id);
    for ( const d of allDesires(n) ) if ( CARING.includes(d.kind) && d.level >= 20 ) spared.add(d.targetId);
  }
  return spared;
}

/**
 * `actor` just harmed `target` (how "harm": a blow, a hold, a hindrance) or helped it ("help": healing, a blessing).
 * Anyone taking no side who cares takes note: the one harmed, at once; anyone watching who wants the target safe
 * (or, for help, badly wants it hurt), a grievance against the actor's side, the more it cares.
 * @param {number} weight  how much it mattered: about 0.5 for a scratch, 2 for a crippling blow, 3 for a fall
 * @param {(unit, data) => void} say
 */
export function crossed(run, actor, target, how, weight, say) {
  if ( !run.neutral || !actor || !target || actor === target || isNeutral(actor) ) return;
  const side = actor.side;
  if ( how === "harm" && isNeutral(target) && target.status !== STATUS.DEAD ) {
    // Hurt by the side it leaned toward: that's the end of that.
    if ( target.lean && leanSide(run, target) === side ) wearLean(run, target, Infinity);
    offend(run, target, actor, "hurt", say);
  }
  for ( const n of run.units ) {
    if ( n === target || n === actor || !isNeutral(n) || !isUp(n) || !n.aware || n.against.has(side) ) continue;
    const spite = how === "help" ? levelOf(n, "hurt", target.id) : 0;
    const care = how === "harm" ? Math.max(...CARING.map(k => levelOf(n, k, target.id))) : (spite >= SPITE ? spite - SPITE / 2 : 0);
    if ( care <= 0 || !perceives(run, n, target, { crisis: true }) ) continue;
    n.crossedBy.add(side);
    // The side it leans toward hurting someone it cares about: the lean wears down.
    if ( n.lean && leanSide(run, n) === side ) wearLean(run, n, care * weight / 2);
    const grievance = (n.grievance.get(side) ?? 0) + care * weight;
    n.grievance.set(side, grievance);
    if ( grievance >= GRIEVANCE || n.truce?.side === side ) offend(run, n, actor, how === "harm" ? "harmed" : "helped", say, target);
  }
}

/**
 * n takes offense at `by`'s side. A talker who can make itself understood has words with the offender first (a
 * truce, unless it's already having words with that side, or the offense was a botched pitch); anyone else turns on
 * that side. why: "hurt" (it was hurt), "harmed" / "helped" (crossed what it wants), "robbed", "insulted".
 * Returns true if it took offense.
 */
export function offend(run, n, by, why, say, victim = null) {
  if ( !isNeutral(n) || !by || isNeutral(by) || n.against.has(by.side) || n.status === STATUS.DEAD ) return false;
  n.crossedBy.add(by.side);
  n.grievance.set(by.side, Math.max(GRIEVANCE, n.grievance.get(by.side) ?? 0));
  const talks = !n.truce && why !== "insulted" && run.prep.options.talking && isUp(n) && prefersTalk(n)
    && isStanding(by) && canTalk(by) && sharesLanguage(n, by, run);
  if ( talks ) {
    n.truce = { withId: by.id, side: by.side, round: run.round };
    n.active = true;
    n.aware = true;
    say(n, {
      type: "neutral", what: "truce", why, by: by.spec.name, byId: by.id, victim: victim?.spec.name ?? null, victimId: victim?.id ?? null
    });
    return true;
  }
  turnOn(run, n, by, why, say, victim);
  return true;
}

/** n turns on `by`'s side: from now on they're enemies (and n is in the fight). */
export function turnOn(run, n, by, why, say, victim = null) {
  if ( n.truce?.side === by.side ) n.truce = null;
  n.against.add(by.side);
  n.sway.delete(by.side); // whatever that side had talked it toward is gone
  n.active = true;
  n.aware = true;
  n.joinedRound ??= run.round;
  n.targetId = null;
  want(n, "hurt", by.id, 40);
  run.geo = (run.geo ?? 0) + 1; // friends and foes have changed
  const sideLabel = run.prep.sides[by.side]?.label ?? by.side;
  say(n, {
    type: "neutral", what: "offended", why, by: by.spec.name, byId: by.id, side: by.side, sideLabel,
    victim: victim?.spec.name ?? null, victimId: victim?.id ?? null
  });
}

/** Whom n is having words with: the one it confronted, or someone else of that side it can talk to (null: no one). */
export function truceWith(run, n) {
  const truce = n.truce;
  if ( !truce ) return null;
  const first = run.byId.get(truce.withId);
  if ( first && first.side === truce.side && isStanding(first) ) return first;
  return run.units.find(o => o.side === truce.side && isStanding(o) && canTalk(o) && sharesLanguage(n, o, run)) ?? null;
}

/** Does n lose patience with the talk this turn? (The longer it drags and the more pitches fail on it, the likelier.) */
export const truceBreaks = (run, n) => run.rng.chance(impatience(run, n, n.truce.round));

/** The quarrel with `side` is over: n lets it go and takes no side again. */
export function settleTruce(n, side) {
  n.grievance.set(side, 0);
  if ( n.truce?.side === side ) n.truce = null;
}

/** An offended neutral talked round by `side`: it lets that side be. */
export function calm(n, side) {
  n.against.delete(side);
  settleTruce(n, side);
}

/**
 * An enemy talked out of the fight: it takes no side now, leaning a little toward the friends it left (the more
 * loyal, the more). Returns the side it left.
 */
export function standAside(run, t) {
  const home = t.side;
  dropAmbition(t); // (it wanted to lead them; not any more)
  const loyal = liveTrait(run, t, "loyal");
  t.side = NEUTRAL_PARTY;
  t.homeSide = NEUTRAL_PARTY;
  t.against.clear();
  t.grievance.clear();
  t.crossedBy.clear();
  t.truce = null;
  t.sway.clear(); // winning it over is a fresh start
  t.lean = home;
  t.leanLevel = clamp((loyal - 30) / 2, 0, 35);
  t.leaning = null;
  t.targetId = null;
  t.wavering = false;
  run.neutral = true;
  run.geo = (run.geo ?? 0) + 1;
  refreshLeans(run);
  return home;
}

/** Someone taking no side, won over: it joins `side` for good. */
export function joinSide(run, t, side) {
  if ( side !== t.homeSide ) dropAmbition(t);
  t.side = side;
  t.homeSide = side;
  t.against.clear();
  t.truce = null;
  t.targetId = null;
  t.wavering = false;
  run.geo = (run.geo ?? 0) + 1;
  refreshLeans(run); // (someone leaning toward that side now has one more to look after)
}

/**
 * What joining `side` would mean to n, by what it wants: the strongest wish it would fulfil (keeping that side's
 * members safe, hurting their enemies) and the strongest it would betray (hurting someone it wants safe, standing
 * beside someone it wants hurt).
 * @returns {{fulfils: {kind, targetId, level}|null, betrays: {kind, targetId, level}|null}}
 */
export function appeal(run, n, side) {
  let fulfils = null;
  let betrays = null;
  const enemies = run.prep.sides[side]?.enemies;
  for ( const d of allDesires(n) ) {
    const t = run.byId.get(d.targetId);
    if ( !t || t === n || [STATUS.DEAD, STATUS.FLED].includes(t.status) ) continue;
    const friend = t.side === side;
    const foe = !!enemies?.has(t.side) || (isNeutral(t) && t.against.has(side));
    const caring = CARING.includes(d.kind);
    const good = (caring && friend) || (d.kind === "hurt" && foe);
    const bad = (caring && foe) || (d.kind === "hurt" && friend);
    if ( good && (!fulfils || d.level > fulfils.level) ) fulfils = d;
    if ( bad && (!betrays || d.level > betrays.level) ) betrays = d;
  }
  return { fulfils, betrays };
}

/** Playstyles that would rather see someone taking no side leave than join the fight (on either side). */
const SEND_AWAY = new Set(["peacekeeper", "diplomat", "moralist", "peoplePleaser", "chicken", "wallflower", "fragile", "lazy"]);

/**
 * Someone who doesn't like killing (Tactics: "I never kill"), seeing an enemy that was talked out of the fight, wants
 * to talk to it again: into leaving, or onto its own side, as its playstyle leans. It's a second thought, just under
 * what's most on its mind (`top`), unless it already wants to talk to it more. Leaders and talkers among them want
 * it more, would rather send anyone taking no side away (less dangerous than one more fighter, even a friendly one),
 * and look for the chance with any neutral they see.
 * @returns {{targetId: string, aim: "dismiss"|"recruit", level: number}|null}  the one it most wants to talk to
 */
export function peaceDesires(run, u, top) {
  const styles = u.spec.playstyles ?? [];
  // (One who commands its group, not merely one who'd like to; or one who'd rather talk than fight.)
  const peacemaker = commandOf(run, u)?.unit === u || prefersTalk(u);
  const aim = peacemaker || styles.some(p => SEND_AWAY.has(p)) ? "dismiss" : "recruit";
  let best = null;
  for ( const n of run.units ) {
    if ( !isNeutral(n) || !isStanding(n) || n.against.has(u.side) || n.spec.kind === "pc" || !sharesLanguage(u, n, run) ) continue;
    const converted = n.swayOutcome === SWAY.NEUTRAL;
    if ( (!converted && !peacemaker) || !perceives(run, u, n) ) continue;
    const level = clamp(converted ? (peacemaker ? top + 5 : top - 5) : top - 10, 10, 100);
    if ( levelOf(u, "talk", n.id) < level ) think(u, "talk", n.id, level);
    const wanted = levelOf(u, "talk", n.id);
    if ( !best || wanted > best.level ) best = { targetId: n.id, aim, level: wanted };
  }
  return best;
}

/** Bystanders near an area's targets that a careless user catches too (a careful one aims around them). */
export function caughtInArea(run, u, targets) {
  if ( !run.neutral ) return [];
  const careless = clamp(0.8 - liveTrait(run, u, "tactical") / 100, 0.05, 0.75);
  const spared = sparedForTruce(run, u);
  const out = [];
  for ( const n of run.units ) {
    if ( !isNeutral(n) || !isUp(n) || n.against.has(u.side) || targets.includes(n) || spared?.has(n.id) ) continue;
    const near = targets.some(t => t.adjacent?.has(n.id) || (edgeDistance(n, t) ?? Infinity) <= 10);
    if ( near && run.rng.chance(careless) ) out.push(n);
  }
  return out;
}
