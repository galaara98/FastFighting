/**
 * Deals: bribing someone to go, extorting money with threats, scaring someone off (issue #13).
 *
 * Any creature FastFighting plays may want one, on its turn (hostile, someone taking no side, or a friend it plays):
 *   bribe   money or something it carries, for t to leave (or to keep away from its team: "avoid"). One losing, hurt
 *           or outnumbered, and timid, reaches for its purse; the selfish hate to. One taking no side may pay off
 *           whoever comes too close.
 *   extort  money, with threats: pay and go ("leave"), or pay and be left alone ("spare"). The greedy and the bold
 *           try it, the more the stronger they are than t.
 *   scare   threats alone, for t to leave: an extortion that asks for nothing but going (one that asks for nothing is
 *           one). The bold, against the weaker; one taking no side, at whoever comes too close.
 * Each is a desire (behavior/desire.js), weighed with everything else it wants. Acting on it, it goes to within talking
 * range (TALK_RANGE, or rules.talkRange) and makes the system's check: a bribe is persuasion, the rest intimidation,
 * against t's resistance (talk.js talkDC) and what the deal is to t (its greed, its loyalty, how much is asked).
 *
 * They must understand each other: a language in common (standoff.js shareLanguage, which "Ignore languages" sets
 * aside), or, for threats only, no words at all where the system allows it (rules.wordlessIntimidation: the check's
 * penalty; PF2e's -4). A system that doesn't track languages (rules.languages === false) asks the GM, in a live battle,
 * whether the two can talk at all (run.live.dealAsk "talkOk").
 *
 * What t says: a critical failure offends it (it goes for whoever asked); a failure, no; a success, yes, unless it's
 * loyal or brave enough to say no all the same (a player's character, more readily). In a live battle, a player's
 * character answers for itself (run.live.dealAsk "answer"). Saying no to a threat that got through frightens it (the
 * system's fear: frightened, one step more). Yes, but whoever pays (the briber; the one made to pay) hasn't got it at
 * the last moment: no deal ("unpaid").
 *
 * A bribe may buy t over instead (turnChance: a critical success, a lavish offer): an enemy then stands aside, leaning
 * toward the briber's side (hostiles always go through taking no side first), and one taking no side joins it.
 * Yes: the goods change hands (the giver's concessions, as anything given up: `how` "bribe" or "extort"). Side by side,
 * at once; apart, the giver drops them where it stands and the taker goes to pick them up (`drop`, `fetch`), unless a
 * player's character is giving or taking, or the table can't show goods on the ground (options.dropGoods false): then
 * at once. Asked to leave, t quits the fight (quitFight): a commander first urges its team to go with it; it joins a
 * friend group of those taking no side that nobody has yet (if there is one: it never goes back by itself), else stays
 * with its side; and it walks off the map (behavior/leaving.js), walked away after two whole turns of it or at the edge.
 * What it was given goes with it; killed on the way, it still has it on it. Anyone of the side that dealt with it who
 * strikes it on its way is told off to the GM: a dishonorable blow (dishonor).
 * Pure: no Foundry globals.
 */
import { STATUS, SWAY, GROUPS, clamp } from "../../constants.js";
import { isStanding, areEnemies, liveTrait, edgeDistance, movesNeeded, canMove, checkRoll, systemRolled, typical, commandOf, groupKeyOf, alliesOf, hpFraction, dangerScore, behaviorOf } from "../battle-state.js";
import { rollCheck } from "../probability.js";
import { mainPool, normalizeCost } from "../turn.js";
import { ORDER_WEIGHTS } from "../playstyles.js";
import { aptitude, notDumb } from "../aptitudes.js";
import { conditionMost } from "../conditions.js";
import { mind, think, want, styleOf, wantsKind, setLean, allDesires } from "./desire.js";
import { remaining, talkDC, foesKnown, applySway } from "./talk.js";
import { canTalk, shareLanguage } from "./standoff.js";
import { perceives } from "./senses.js";
import { isNeutral, standAside, offend } from "./neutral.js";
import { startLeaving } from "./leaving.js";
import { isAnimalistic } from "./animal.js";
import { applyOutcome } from "./effects.js";

/** The kinds of deal (and of the desires for them). */
export const DEAL_KINDS = Object.freeze(["bribe", "extort", "scare"]);
/** How far a creature makes itself heard to strike a deal (feet), where the rules don't say. */
export const TALK_RANGE = 30;
/** Someone not of its group this near (feet) is too close, for one taking no side. */
export const TOO_CLOSE = 15;
/** A wish to deal under this isn't worth a thought; none goes over this. */
const LEAST = 10;
const MOST = 75;
/** How readily its pills take a bribe (the DC, less), or don't (more): each by its place (ORDER_WEIGHTS). */
const TAKES = Object.freeze({ mercenary: -3, thief: -2, lazy: -1, wildcard: -1, moralist: 3, relentless: 2, vengeful: 2, martyr: 2 });
/** How readily its pills give way to threats (the DC, less), or don't (more). */
const COWED = Object.freeze({ chicken: -3, wallflower: -2, fragile: -2, lazy: -1, peoplePleaser: -1, brawler: 2, relentless: 3, vengeful: 2, tank: 2, martyr: 2, leader: 1 });
/** A bribe's DC is at least this much under the threat's; a threat that asks for money too, at least this much over. */
const BRIBE_EASIER = 2;
const PAY_HARDER = 2;

/** How far u makes itself heard (feet). */
export const talkRange = run => (Number(run.prep.rules.talkRange) > 0 ? Number(run.prep.rules.talkRange) : TALK_RANGE);

/** The penalty to threaten without words where the system allows it (PF2e's -4), or null where it doesn't. */
export function wordlessPenalty(run) {
  const p = run.prep.rules.wordlessIntimidation;
  return Number.isFinite(Number(p)) && p !== null && p !== false ? Number(p) : null;
}

/** Is u one to strike a deal at all: on its feet, with its wits, not leaving, and talking in this world? */
export function mayDeal(run, u) {
  return !!run.prep.options.talking && isStanding(u) && !u.spec.hazard && !u.leaving && !u.controlledBy && u.tac?.talk !== "never" && listens(u);
}

/** Can t be dealt with: a mind of its own (not mindless, not an animal's wits), and in sight? */
const listens = t => !!t.spec.social && !t.spec.social.mindless && notDumb(t) && !isAnimalistic(t) && !(t.spec.hidden && !t.revealed);

/**
 * How u would get through to t for this kind of deal: "words" (a language in common, both able to talk), "wordless"
 * (a threat, where the system allows one without words), or null.
 */
export function means(run, u, t, kind) {
  if ( canTalk(u) && canTalk(t) && shareLanguage(u, t, run) ) return "words";
  if ( kind !== "bribe" && wordlessPenalty(run) !== null ) return "wordless";
  return null;
}

/** Has u something to give: money, or something carried and not held or worn? */
export function hasGoods(u) {
  const v = remaining(u);
  return v.money > 0 || v.stowed.length > 0;
}

/** How near t is to one taking no side, or to its friend group: 1 right beside, to 0 at TOO_CLOSE and beyond. */
function closeness(run, u, t) {
  if ( !t.pos ) return 0;
  let near = Infinity;
  for ( const f of alliesOf(run, u) ) if ( f.pos && isStanding(f) ) near = Math.min(near, edgeDistance(f, t) ?? Infinity);
  return near <= TOO_CLOSE ? clamp(1 - (near - 5) / TOO_CLOSE, 0.3, 1) : 0;
}

/** Could u try this kind of deal on t now (whether or not it's in range)? */
export function dealable(run, u, t, kind) {
  if ( !t || t === u || !isStanding(t) || t.leaving || t.spec.hazard || t.spec.untargetable || !listens(t) ) return false;
  if ( u.dealt?.has(t.id) || t.offendedBy.has(u.id) || u.spares?.has(t.id) ) return false;
  // (Its foes; for one taking no side, whoever comes too close.)
  if ( !areEnemies(run, u, t) && !(isNeutral(u) && !isNeutral(t) && closeness(run, u, t) > 0) ) return false;
  if ( kind === "bribe" && !hasGoods(u) ) return false;
  if ( kind === "extort" && !(remaining(t).money > 0) ) return false;
  // (A Peacekeeper never threatens.)
  if ( kind !== "bribe" && (behaviorOf(u).peacekeeping ?? 0) >= 0.5 ) return false;
  return !!means(run, u, t, kind) && perceives(run, u, t);
}

/** How hard pressed u is, 0 to 1: badly hurt, or outnumbered by the foes it knows of. */
function pressure(run, u) {
  const hurt = clamp((0.6 - hpFraction(u)) / 0.5, 0, 1);
  const friends = alliesOf(run, u).filter(isStanding).length;
  const odds = clamp((foesKnown(run, u).length - friends) / Math.max(1, friends), 0, 1);
  return Math.max(hurt, odds);
}

/** How much of a danger t is to u, 0 to 1: as dangerous as u or more; more again when it's on u. */
function menace(u, t) {
  const share = dangerScore(t) / Math.max(1, dangerScore(u) + dangerScore(t));
  return clamp(2 * share + (t.targetId === u.id || u.adjacent.has(t.id) ? 0.3 : 0), 0, 1);
}

/** How much the stronger u is than t, 0 to 1: t badly hurt, t outnumbered, u the more dangerous. */
function upperHand(run, u, t) {
  const hurt = hpFraction(t) < 0.5 ? 0.4 : 0;
  const odds = foesKnown(run, t).length > alliesOf(run, t).filter(isStanding).length ? 0.4 : 0;
  const might = dangerScore(u) > 1.25 * dangerScore(t) ? 0.4 : 0;
  return clamp(hurt + odds + might, 0, 1);
}

/**
 * The deals u would want now: a bribe, an extortion or a threat at each one it could try it on, as strongly as its
 * nature and the fight say (its pills, styleOf: bribe, extort, scare; its force of personality). [{kind, target, level}]
 */
export function dealsWanted(run, u) {
  if ( !u.desire || !mayDeal(run, u) ) return [];
  const out = [];
  const brave = liveTrait(run, u, "brave");
  const selfish = liveTrait(run, u, "selfish");
  const style = styleOf(u);
  // (Force of personality: a little keener, or less.)
  const flair = (aptitude(u, "charismatic") - 2) * 4;
  const pressed = pressure(run, u);
  const greed = clamp((selfish - 35) / 50, 0, 1);
  const nerve = clamp((brave - 25) / 60, 0, 1);
  for ( const t of run.units ) {
    if ( t === u || !isStanding(t) || !t.active ) continue;
    const close = isNeutral(u) && !isNeutral(t) ? closeness(run, u, t) : 0;
    if ( !close && !areEnemies(run, u, t) ) continue;
    const edge = upperHand(run, u, t);
    for ( const kind of DEAL_KINDS ) {
      let level = kind === "bribe" ? 60 * Math.max(pressed * menace(u, t), close) * (1.3 - brave / 100) * (1.2 - selfish / 125)
        : kind === "extort" ? 55 * greed * nerve * Math.max(edge, close / 2)
          : 45 * nerve * Math.max(edge, close) * (1 - greed / 2);
      if ( level <= 0 ) continue;
      level += (style[kind] ?? 0) + flair;
      if ( level >= LEAST && dealable(run, u, t, kind) ) out.push({ kind, target: t, level: Math.min(MOST, level) });
    }
  }
  return out;
}

/** What u wants of deals this turn: dealsWanted, in its logic layer. */
export function dealWishes(run, u) {
  for ( const w of dealsWanted(run, u) ) think(u, w.kind, w.target.id, w.level);
}

/** What a deal costs from a turn: the system's talking (rules.talkCost), else its basic action. */
export const dealCost = rules => normalizeCost(rules, rules.dealCost ?? rules.talkCost ?? rules.basicAction ?? 1);

/**
 * Whether u works on a deal now, the next step of its turn, when that's what it most wants: struck now (in talking
 * range), or after getting there this turn; farther, a move toward it (it keeps at it). {kind, target, moves, cost},
 * or null.
 */
export function decideDeal(run, u, turn) {
  if ( !wantsKind(u, DEAL_KINDS) ) return null;
  const lead = mind(run, u).lead;
  if ( !DEAL_KINDS.includes(lead?.kind) ) return null;
  const t = run.byId.get(lead.targetId);
  if ( !dealable(run, u, t, lead.kind) ) return null;
  const rules = run.prep.rules;
  const cost = dealCost(rules);
  const moves = movesNeeded(run, u, t, { range: { max: talkRange(run) } });
  if ( !moves ) return turn.canAfford(cost) ? { kind: lead.kind, target: t, moves: 0, cost } : null;
  if ( !Number.isFinite(moves) || !canMove(run, u) ) return null;
  const pool = mainPool(rules);
  const speed = run.prep.approachOf(u.id, t.id).speed;
  // (Too far to strike it this turn: closer, as far as the turn goes.)
  if ( moves > 1 ) return turn.canAfford({ [pool]: turn.unitsForMoves(1, speed) }) ? { kind: lead.kind, target: t, moves, cost } : null;
  return turn.canAfford({ ...cost, [pool]: (cost[pool] ?? 0) + turn.unitsForMoves(moves, speed) }) ? { kind: lead.kind, target: t, moves, cost } : null;
}

/**
 * What u offers or asks: {kind, ask, money, items: [{id, name, value, count}], denominations}. A bribe: a share of
 * its purse, the larger the harder pressed and the less selfish it is; with no money, the best thing it carries. An
 * extortion: a share of t's purse, the larger the greedier u is. Asked to go: "leave"; a commander buying its team's
 * peace, "avoid"; a player's character paying to be left alone, "spare".
 */
export function dealTerms(run, u, t, kind) {
  const selfish = liveTrait(run, u, "selfish");
  if ( kind === "bribe" ) {
    const v = remaining(u);
    const ask = commandOf(run, u)?.unit === u ? "avoid" : "leave";
    if ( v.money > 0 ) {
      const share = clamp(0.15 + 0.35 * pressure(run, u) - (selfish - 50) / 250, 0.05, 0.6);
      return { kind, ask, money: Math.max(1, Math.round(v.money * share)), items: [], denominations: v.denominations ?? null };
    }
    const best = [...v.stowed].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))[0];
    return { kind, ask, money: 0, items: best ? [{ id: best.id, name: best.name, value: Number(best.value) || 0, count: 1 }] : [], denominations: null };
  }
  if ( kind === "extort" ) {
    const v = remaining(t);
    const share = clamp(0.2 + 0.6 * clamp((selfish - 30) / 70, 0, 1), 0.2, 1);
    return { kind, ask: t.spec.kind === "pc" ? "spare" : "leave", money: Math.max(1, Math.round(v.money * share)), items: [], denominations: v.denominations ?? null };
  }
  return { kind, ask: "leave", money: 0, items: [], denominations: null };
}

/** What the goods are worth, in the smallest coin. */
export const termsWorth = terms => (terms.money ?? 0) + (terms.items ?? []).reduce((s, i) => s + (Number(i.value) || 0) * (i.count ?? 1), 0);

/** The kind of pitch a deal is made with (talk.js TALK_KINDS): a bribe persuades, the rest threaten. */
export const pitchOf = kind => (kind === "bribe" ? "persuade" : "intimidate");

/**
 * The DC t sets against u's deal: its resistance to the pitch (talk.js talkDC: grudges, wounds, odds, its nature), then
 * what the deal is to it. Getting it to go is easiest bought (a bribe: at least BRIBE_EASIER less, the more of u's
 * purse the less again, the more for the greedy; a purse much fatter than the bribe, harder), harder by threats alone
 * (scare: an extortion that asks for nothing but going), and hardest by threats that ask for money too (at least
 * PAY_HARDER more, the more of its purse the more). Then what it is: its pills (TAKES, for a bribe; COWED, for a
 * threat), how badly it wants the fight (its strongest wish to hurt someone), and, asked to leave its friends, its
 * loyalty.
 */
export function dealDC(run, u, t, terms) {
  const pills = t.spec.playstyles ?? [];
  const lean = table => Math.round(pills.reduce((s, id, i) => s + (table[id] ?? 0) * (ORDER_WEIGHTS[i] ?? 0), 0));
  // (What it is, whatever the deal: how badly it wants the fight, its strongest wish to hurt someone, 40 or so the usual;
  // asked to leave its friends, its loyalty.)
  const fight = Math.max(0, ...allDesires(t).filter(d => d.kind === "hurt").map(d => d.level));
  const stays = clamp(Math.round((fight - 40) / 20), -2, 3) + (terms.ask === "leave" || terms.ask === "avoid" ? Math.round((liveTrait(run, t, "loyal") - 50) / 25) : 0);
  const threat = talkDC(run, u, t, "intimidate") + lean(COWED) + stays;
  if ( terms.kind === "scare" ) return threat;
  if ( terms.kind === "extort" ) return threat + (terms.money > 0 ? PAY_HARDER + Math.round(3 * clamp(terms.money / Math.max(1, remaining(t).money), 0, 1)) : 0);
  const worth = termsWorth(terms);
  const purse = remaining(u);
  const generous = worth / Math.max(1, purse.money + purse.stowed.reduce((s, i) => s + (Number(i.value) || 0), 0));
  let dc = talkDC(run, u, t, "persuade") - BRIBE_EASIER - Math.round(5 * clamp(generous, 0, 1) * (0.5 + liveTrait(run, t, "selfish") / 100));
  if ( remaining(t).money > 10 * worth ) dc += 1;
  // (Never as hard as telling it to go.)
  return Math.min(dc + lean(TAKES) + stays, threat - 1);
}

/**
 * t's answer to a deal that rolled this degree: "offended" (a critical failure), "refuse", or "accept" (a success,
 * unless it's loyal enough, or against a threat brave enough, to say no all the same; a player's character more
 * readily; half as readily against a critical success).
 */
export function dealAnswer(run, t, kind, degree) {
  if ( degree <= 0 ) return "offended";
  if ( degree === 1 ) return "refuse";
  let no = (liveTrait(run, t, "loyal") - 60) / 150 + (kind === "bribe" ? 0 : (liveTrait(run, t, "brave") - 60) / 150) + (t.spec.kind === "pc" ? 0.15 : 0);
  no = clamp(no, 0, 0.5) / (degree >= 3 ? 2 : 1);
  return no > 0 && run.rng.chance(no) ? "refuse" : "accept";
}

/**
 * u tries a deal on t: the check, t's answer and what comes of it. Returns the answer ("accept", "refuse",
 * "offended"), or null when it came to nothing before any roll (the GM said the two can't talk).
 * @param {(unit, data) => void} say
 * @param {object} [options]
 * @param {object} [options.terms]  What's offered or asked (dealTerms', by default)
 */
export function offerDeal(run, u, t, kind, say, { terms = null } = {}) {
  const rules = run.prep.rules;
  (u.dealt ??= new Map()).set(t.id, null);
  terms ??= dealTerms(run, u, t, kind);
  // (An extortion that asks for nothing but going: threats alone.)
  if ( kind === "extort" && !(terms.money > 0) && !terms.items?.length ) {
    kind = "scare";
    terms = { ...terms, kind, ask: "leave" };
  }
  const how = means(run, u, t, kind) ?? "words";
  // (A system with no languages of its own: whether the two can talk at all is the GM's say.)
  if ( rules.languages === false && how === "words" && run.live?.dealAsk?.(run, { ask: "talkOk", unitId: u.id, targetId: t.id, kind }) === false ) {
    say(u, { type: "deal", kind, target: t.spec.name, targetId: t.id, terms, answer: "unheard" });
    u.dealt.set(t.id, "unheard");
    return null;
  }
  const pitch = u.spec.social?.pitches?.[pitchOf(kind)];
  const base = typeof pitch?.mod === "number" ? pitch.mod : typical(rules, "skill", u.spec.level ?? 0) - 2;
  const skill = pitch?.skill ?? pitchOf(kind);
  const wordless = how === "wordless" ? wordlessPenalty(run) : 0;
  const check = checkRoll(run, u, base + wordless, t, { purpose: kind, skill });
  const dc = dealDC(run, u, t, terms);
  const deal = { kind, ask: terms.ask, money: terms.money, items: terms.items.map(i => ({ id: i.id, count: i.count ?? 1 })), wordless: how === "wordless" };
  const rolled = systemRolled(run, u, "check", { dc, target: t, purpose: kind, skill, label: kind, deal });
  const roll = rollCheck(rules, run.rng, check.mod, dc, { advantage: check.advantage ?? 0, dice: check.dice ?? null, kind: "check", roller: u, rolled, what: kind, target: t });
  // (A player's character answers for itself, in a live battle.)
  const said = run.live?.dealAsk?.(run, { ask: "answer", unitId: u.id, targetId: t.id, kind, terms, degree: roll.degree, dc }) ?? null;
  const agreed = said === "accept" || said === "refuse" ? said : dealAnswer(run, t, kind, roll.degree);
  // (Agreed, but whoever pays hasn't got it now, at the last moment: no deal.)
  const payer = kind === "bribe" ? u : kind === "extort" ? t : null;
  const answer = agreed === "accept" && payer && !canPay(payer, terms) ? "unpaid" : agreed;
  u.dealt.set(t.id, answer);
  // (Saying no to a threat that got through: shaken all the same.)
  const frightened = answer === "refuse" && kind !== "bribe" && roll.degree >= 2 ? frighten(run, t, u) : null;
  say(u, {
    type: "deal", kind, target: t.spec.name, targetId: t.id, terms, skill, wordless: how === "wordless",
    natural: roll.natural, mod: check.mod, total: roll.total, note: roll.note ?? null, faces: roll.faces ?? null, dc, dcStat: t.spec.social?.resist?.[pitchOf(kind)]?.label ?? "DC",
    degree: roll.degree, margin: roll.total - dc, answer, by: said ? "player" : "check", frightened
  });
  if ( answer === "offended" ) {
    t.offendedBy.add(u.id);
    if ( isNeutral(t) ) offend(run, t, u, "insulted", say);
    else want(t, "hurt", u.id, 25);
  }
  if ( answer === "accept" ) settle(run, u, t, terms, say, { degree: roll.degree });
  return answer;
}

/** A deal t agreed to: the goods change hands; asked to go, t quits the fight; paid to be left alone, the two let each other be. */
export function settle(run, u, t, terms, say, { degree = 2 } = {}) {
  if ( terms.kind === "bribe" ) give(run, u, t, terms, "bribe", say);
  if ( terms.kind === "extort" ) give(run, t, u, terms, "extort", say);
  // (Bought over: it stays, on the briber's side's side of things.)
  if ( terms.kind === "bribe" && run.rng.chance(turnChance(run, u, t, terms, degree)) ) {
    turnOver(run, u, t, say);
    return;
  }
  if ( terms.ask === "spare" ) {
    (u.spares ??= new Set()).add(t.id);
    (t.spares ??= new Set()).add(u.id);
    return;
  }
  quitFight(run, t, { by: u, say });
}

/**
 * How likely a bribe t took turns it instead of sending it off: a critical success's 0.35, and up to 0.35 more for how
 * lavish the offer is to it (against its own purse, or half the briber's where that's more: 7 times as much, all of
 * it), as selfish and disloyal as it is, at most 0.75. Never a player's character, nor a boss, nor for one taking no side
 * itself (it has no side to bring anyone over to).
 */
export function turnChance(run, u, t, terms, degree) {
  if ( terms.kind !== "bribe" || t.spec.kind === "pc" || t.isBoss || isNeutral(u) ) return 0;
  const purse = remaining(u);
  const scale = Math.max(1, remaining(t).money, (purse.money + purse.stowed.reduce((s, i) => s + (Number(i.value) || 0) * (i.quantity ?? 1), 0) + termsWorth(terms)) / 2);
  const lavish = clamp(Math.log2(1 + termsWorth(terms) / scale) / 3, 0, 1);
  const nature = (0.5 + liveTrait(run, t, "selfish") / 100) * (1.5 - liveTrait(run, t, "loyal") / 100);
  return clamp(((degree >= 3 ? 0.35 : 0) + 0.35 * lavish) * nature, 0, 0.75);
}

/**
 * t, bought over by u: an enemy only stands aside (taking no side, leaning toward u's), as talking one round does; one
 * already taking no side joins u's side (talk.js applySway: the same outcomes, logged the same way).
 */
export function turnOver(run, u, t, say) {
  if ( isNeutral(t) ) {
    applySway(run, u, t, SWAY.SWITCH, say, "bribe");
    return "switched";
  }
  applySway(run, u, t, SWAY.NEUTRAL, say, "bribe");
  // (Leaning toward whoever paid it, not its old side.)
  t.lean = u.side;
  t.leanLevel = Math.max(t.leanLevel ?? 0, 30);
  t.leaning = null;
  return "neutral";
}

/** Has the payer got what the deal asks of it, now: the money, and each thing, as many as asked? */
export function canPay(payer, terms) {
  const v = remaining(payer);
  if ( (terms.money ?? 0) > v.money ) return false;
  for ( const i of terms.items ?? [] ) {
    const item = v.stowed.find(s => s.id === i.id) ?? v.wielded.find(s => s.id === i.id);
    if ( !item || (i.count ?? 1) > (item.quantity ?? 1) ) return false;
  }
  return true;
}

/**
 * The goods go from `from` to `to`: concessions of the giver's, the way anything given up is (`how` "bribe",
 * "extort"). Side by side, or where a player's character gives or takes, or the table can't show goods on the ground:
 * at once. Apart: dropped where the giver stands (`drop`), for `to` to pick up (`to.fetch`). Returns the records.
 */
export function give(run, from, to, terms, how, say = null) {
  const v = remaining(from);
  const beside = from.adjacent.has(to.id) || (edgeDistance(from, to) ?? 0) <= 5;
  const atOnce = beside || !from.pos || !to.pos || run.prep.options.dropGoods === false || from.spec.kind === "pc" || to.spec.kind === "pc";
  const drop = atOnce ? null : { id: (run.drops = (run.drops ?? 0) + 1), x: from.pos.x, y: from.pos.y };
  const records = [];
  const money = Math.min(terms.money ?? 0, v.money);
  if ( money > 0 ) records.push({ kind: "money", amount: money, denominations: v.denominations ?? null });
  for ( const i of terms.items ?? [] ) {
    const item = v.stowed.find(s => s.id === i.id) ?? v.wielded.find(s => s.id === i.id);
    if ( item ) records.push({ kind: "item", item, count: Math.max(1, Math.min(i.count ?? 1, item.quantity ?? 1)) });
  }
  for ( const r of records ) {
    Object.assign(r, { how, to: to.id, toName: to.spec.name, round: run.round }, drop ? { drop } : {});
    (from.concessions ??= []).push(r);
  }
  if ( drop && records.length ) {
    to.fetch = { drop: drop.id, x: drop.x, y: drop.y, fromId: from.id };
    say?.(from, { type: "dropGoods", for: to.spec.name, forId: to.id, drop: drop.id, goods: records.map(r => ({ ...r })) });
  }
  return records;
}

/**
 * t picks up what was dropped for it, if it's there: logged, its fetch done. True when it did.
 * @param {(unit, data) => void} say
 */
export function pickUp(run, t, say) {
  const f = t.fetch;
  if ( !f ) return false;
  t.fetch = null;
  const from = run.byId.get(f.fromId);
  const goods = (from?.concessions ?? []).filter(c => c.drop?.id === f.drop && c.to === t.id);
  if ( !goods.length ) return false;
  for ( const c of goods ) c.picked = true;
  say(t, { type: "pickUp", from: from.spec.name, fromId: from.id, drop: f.drop, goods: goods.map(c => ({ ...c })) });
  return true;
}

/** Frightened one step more (the system's fear), by `by`'s threat: the value it's at now. */
export function frighten(run, t, by) {
  const now = Number(t.conds?.frightened) || 0;
  const most = conditionMost("frightened") ?? 4;
  const to = Math.min(most, now + 1);
  applyOutcome(t, { conditions: { frightened: to }, rounds: to }, by.id, { id: "deal-fear" });
  return to;
}

/** A friend group of those taking no side that nobody in the fight has yet, or null. */
export function freeGroup(run) {
  return GROUPS.find(n => !run.units.some(o => o.friendGroup === n)) ?? null;
}

/**
 * t quits the fight, as a deal asked (`by` struck it). A commander first urges its team to go with it (each by its
 * loyalty and its nerve). All of them join a friend group of those taking no side that nobody has yet, if there is one
 * (never back to their old side by themselves), else stay with theirs, and set off: off the map, or gone at once with
 * no map.
 */
export function quitFight(run, t, { by = null, say = null } = {}) {
  const key = groupKeyOf(t);
  const leads = commandOf(run, t)?.unit === t;
  const team = leads ? run.units.filter(f => f !== t && groupKeyOf(f) === key && isStanding(f) && !f.leaving && f.spec.kind !== "pc" && !f.controlledBy) : [];
  const group = isNeutral(t) && t.friendGroup ? null : freeGroup(run);
  walkOff(run, t, { by, group, say });
  for ( const f of team ) {
    const p = clamp(0.35 + (liveTrait(run, f, "loyal") - 50) / 100 + (50 - liveTrait(run, f, "brave")) / 200, 0.15, 0.9);
    const follows = run.rng.chance(p);
    say?.(f, { type: "quitCall", by: t.spec.name, byId: t.id, follows });
    if ( follows ) walkOff(run, f, { by, group, following: t, say });
  }
}

/** One quitting: into the free group (or its side), and away. */
function walkOff(run, t, { by, group, following = null, say }) {
  const from = t.side;
  if ( group && !isNeutral(t) ) {
    standAside(run, t);
    t.friendGroup = group;
    // (No pull back to its old side: it's done with it.)
    t.lean = null;
    t.leanLevel = 0;
    t.leaning = null;
    setLean(t, []);
  }
  const deal = { side: by?.side ?? null, byId: by?.id ?? null };
  say?.(t, { type: "quit", by: by?.spec.name ?? "", byId: by?.id ?? null, from, group: isNeutral(t) ? t.friendGroup : null, following: following?.spec.name ?? null, followingId: following?.id ?? null });
  if ( t.pos && run.prep?.spec?.bounds ) {
    startLeaving(run, t, { by, why: "deal" }).deal = deal;
    return;
  }
  // (No map to walk off: gone at once.)
  for ( const id of t.adjacent ) run.byId.get(id)?.adjacent.delete(t.id);
  t.adjacent.clear();
  t.status = STATUS.FLED;
  t.fellRound ??= run.round;
  t.ranRound = run.round;
  t.walkedAway = true;
  say?.(t, { type: "offMap", walkedAway: true });
}

/**
 * Someone strikes u on its way off the map after a deal: one of the side that dealt with it is told off, once each
 * (a dishonorable blow). Logged; a live battle tells the GM.
 */
export function dishonor(run, u, by, say) {
  const deal = u.leaving?.deal;
  if ( !deal?.side || !by || by === u || by.side !== deal.side ) return false;
  const told = (u.leaving.dishonored ??= new Set());
  if ( told.has(by.id) ) return false;
  told.add(by.id);
  say?.(by, { type: "dishonor", target: u.spec.name, targetId: u.id, dealBy: run.byId.get(deal.byId)?.spec.name ?? "", dealById: deal.byId });
  return true;
}

/** Is `side` the one u made its deal with (the deal it's leaving by)? */
export const dealtWith = (u, side) => !!u.leaving?.deal && u.leaving.deal.side === side;

/** Does u spare t (paid to be left alone)? */
export const spares = (u, t) => !!u.spares?.has(t.id);
