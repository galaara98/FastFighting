/**
 * Bargaining in a standoff (or only an argument): what each character offers to end it, and what it expects to
 * (spec.motives, from its survey; checked against what it really has before the fight: foundry/motives.js). A deal
 * ends the encounter.
 *  - An offer: money, one of its own items, or a promise: "we won't harm you", "we let you pass", "we leave".
 *  - An expectation: money (at least so much), something of a kind (the system's categories and attributes: a weapon,
 *    of cold iron, rare, worth at least so much; an unvalued item counts if it says so: junk, or beyond price), or a
 *    promise: "you don't harm us", "you let us pass", "you leave".
 * On its turn in the standoff, one who offers puts it to the other side: what meets one of their expectations is taken;
 * with none stated, they may take it all the same (the greedy readily, for goods; the timid, for a promise). One who
 * expects asks: whoever on the other side has what meets it and would part with it (or offers it) hands it over. (A
 * player character hands over only what it offered, unless it's talked into more: it decides its own fate.)
 * What isn't met is talked over (talk.js), with the usual checks:
 *  - the other side haggles (the "haggle" aim): each success calms the one who expects (it keeps talking); talked
 *    round, it comes down (asks for less: comeDown), and agrees if the talker meets the new price; pressed again,
 *    it lets it go;
 *  - the one who expects presses (the "press" aim): talked round, whoever it pressed hands over what meets it.
 * Both against the resolve of whoever's being talked round (holdsOut: the greedy hold out for their due and hold on to
 * what they have; the peaceable come round). A failed haggle irritates the one who expects, as does a failed press of
 * its own; a botched pitch insults. While nothing meets it, its patience wears faster (standoff.js), and when it runs
 * out, the standoff breaks ("unmet"; only an argument: the talks collapse).
 * Goods change hands as a concession (Make it So moves them); a promise changes nothing on the map: the story tells it.
 */
import { STATUS, CONCEDE_LUCK, NEUTRAL_PARTY } from "../../constants.js";
import { isStanding, liveTrait, areEnemies, command } from "../battle-state.js";
import { willingToPay, remaining } from "./talk.js";

/** The promises, each with the one it answers (an offer of "passage" meets an expectation of "passage"). */
export const PROMISES = Object.freeze(["noHarm", "passage", "leave"]);

/** What u expects now: what it asked for, as far as it has come down (null: nothing, or it let it go). */
export const expectOf = u => (u.expect !== undefined ? u.expect : u.spec.motives?.expect ?? null);

/** Does what's given meet what's expected? Money: at least as much. Goods: the kind asked for. A promise: its own. */
export function meets(given, expect) {
  if ( !given || !expect ) return false;
  if ( expect.kind === "promise" ) return given.kind === "promise" && given.promise === expect.promise;
  if ( expect.kind === "money" ) return given.kind === "money" && given.amount >= (expect.amount ?? 0);
  if ( expect.kind !== "thing" || given.kind !== "item" ) return false;
  const item = given.item ?? {};
  if ( expect.category && item.category !== expect.category ) return false;
  if ( expect.material && item.material !== expect.material ) return false;
  if ( expect.rarity && item.rarity !== expect.rarity ) return false;
  // (An item with no price is unvalued: junk, or beyond price. It counts only if the expectation says so.)
  if ( !(item.value > 0) ) return !!expect.unvalued;
  return item.value >= (expect.minValue ?? 0);
}

/** The other side's members still in the standoff (standing, at odds with u). */
const across = (run, u) => run.units.filter(o => o !== u && isStanding(o) && !o.spec.hazard && areEnemies(run, u, o));

/** What u's offer is now (its money and goods as it still has them: nothing it gave away already). */
function offered(u) {
  const offer = u.spec.motives?.offer;
  if ( !offer || u.dealt ) return null;
  if ( offer.kind === "promise" ) return offer;
  const v = remaining(u);
  if ( offer.kind === "money" ) return v.money > 0 ? { kind: "money", amount: Math.min(offer.amount, v.money), denominations: v.denominations } : null;
  const item = [...v.stowed, ...v.wielded].find(i => i.id === offer.item?.id);
  return item ? { kind: "item", item } : null;
}

/**
 * Would u grant a promise asked of it? Not harming them is easy in a standoff (most would); letting them pass, the
 * less bold readily; leaving, only the timid, or the selfish who'd rather not bother.
 */
function willingToPromise(run, u, promise) {
  const brave = liveTrait(run, u, "brave");
  const selfish = liveTrait(run, u, "selfish");
  if ( promise === "noHarm" ) return brave < 85 || willingToPay(run, u);
  if ( promise === "passage" ) return brave < 60 || willingToPay(run, u);
  return brave < 40 || (selfish >= 60 && brave < 60);
}

/**
 * What u can hand over that meets an expectation: its offer if it does; else (if it would part with it, or `eager`:
 * talked into it, or agreeing to the price it haggled) the cheapest that does. A player character hands over only what
 * it offered, unless it's talked into more.
 */
function answerFrom(run, u, expect, { eager = false } = {}) {
  const given = offered(u);
  if ( given && meets(given, expect) ) return given;
  if ( expect.kind === "promise" ) return eager || willingToPromise(run, u, expect.promise) ? { kind: "promise", promise: expect.promise } : null;
  if ( !eager && (u.spec.kind === "pc" || !willingToPay(run, u)) ) return null;
  const v = remaining(u);
  if ( expect.kind === "money" ) return expect.amount > 0 && v.money >= expect.amount ? { kind: "money", amount: expect.amount, denominations: v.denominations } : null;
  const goods = [...v.stowed, ...v.wielded].map(item => ({ kind: "item", item })).filter(g => meets(g, expect));
  return goods.sort((a, b) => (a.item.value || 0) - (b.item.value || 0))[0] ?? null;
}

/** With nothing stated by the other side, does it take u's offer all the same? Goods: the greedy readily. A promise: the timid. */
function takesUnasked(run, taker, given) {
  const selfish = liveTrait(run, taker, "selfish");
  const brave = liveTrait(run, taker, "brave");
  const p = given.kind === "promise"
    ? 0.15 + (60 - brave) / 200 + (given.promise === "noHarm" ? 0.1 : 0)
    : 0.15 + (selfish - 50) / 150 + (given.kind === "money" ? 0.05 : 0);
  return run.rng.chance(Math.max(0.03, Math.min(0.6, p)));
}

/** Still holding out for what it expects: no deal yet, and in the standoff. */
const demanding = u => !!expectOf(u) && !u.dealt && isStanding(u) && u.status !== STATUS.FLED;

/** Waiting on what it expects (it asked, and nothing met it), and irritated by it: its patience wears faster. */
export const waiting = u => demanding(u) && (u.unmet ?? 0) > 0;

/** Irritated: another turn with nothing meeting what it expects, or a pitch about it that got nowhere. */
export const irritated = u => { u.unmet = (u.unmet ?? 0) + 1; };

/**
 * u's turn in the standoff, before it talks: it asks for what it expects, or offers what it offers. Returns true when
 * that struck the deal (the standoff is over).
 */
export function bargain(run, u, log) {
  if ( !u.spec.motives || run.resolved ) return false;
  const others = across(run, u);
  if ( !others.length ) return false;
  const expect = expectOf(u);
  // Asking: whoever over there would meet it, hands it over.
  if ( expect && !u.dealt ) {
    for ( const o of others ) {
      const given = answerFrom(run, o, expect);
      if ( given ) return strike(run, o, u, given, log);
    }
  }
  // Offering: one of theirs whose expectation it meets takes it; else, with nothing stated over there, they may.
  const given = offered(u);
  if ( given ) {
    const wanting = others.find(o => demanding(o) && meets(given, expectOf(o)));
    if ( wanting ) return strike(run, u, wanting, given, log);
    if ( !others.some(demanding) ) {
      // (Their voice: whoever commands them, if it's here; else the first of them.)
      const head = command(run, others[0].side)?.unit;
      const voice = head && others.includes(head) ? head : others[0];
      if ( takesUnasked(run, voice, given) ) return strike(run, u, voice, given, log);
    }
  }
  if ( expect && !u.dealt ) {
    u.asked = true; // (the other side knows now what it expects: they can haggle over it)
    irritated(u);
  }
  return false;
}

/**
 * The deal: goods change hands (a concession, which Make it So moves), or a promise is given. The encounter is over,
 * for the side that got what it wanted (a truce: nobody's).
 */
function strike(run, giver, taker, given, log) {
  const record = { ...given, to: taker.id, toName: taker.spec.name, round: run.round, deal: true };
  if ( given.kind !== "promise" ) (giver.concessions ??= []).push(record);
  giver.dealt = taker.dealt = true;
  run.resolved = given.kind === "promise" && given.promise === "noHarm"
    ? { side: null, outcome: "truce", deal: record }
    : { side: taker.side, outcome: given.kind === "promise" ? given.promise : "conceded", deal: record };
  log?.(giver, { type: "deal", target: taker.spec.name, targetId: taker.id, concession: given.kind === "promise" ? null : record, promise: given.kind === "promise" ? given.promise : null });
  return true;
}

/**
 * What t hands over when it's made to pay to end a standoff (talked into conceding; paying a boss to go; squeezed by
 * someone taking no side): what the one it pays (`to`) expects, or someone with it does (goods), if t has it; else
 * what t offered (goods); else null, and it pays the usual way (talk.js concession). A player character made to hand
 * over one of its things (not one it offered) keeps it unless a d100 comes up under the concede luck.
 * @returns {{given: object, taker: object}|null}  given: the concession (expected or offered: true), taker: who gets it
 */
export function owed(run, t, to) {
  const wanting = [to, ...run.units.filter(o => o !== to && o.side === to.side && o.side !== NEUTRAL_PARTY && isStanding(o))]
    .filter(o => demanding(o) && expectOf(o).kind !== "promise");
  for ( const taker of wanting ) {
    const given = answerFrom(run, t, expectOf(taker), { eager: true });
    if ( given && given.kind !== "promise" ) return { given: luckFor(run, t, { ...given, expected: true }), taker };
  }
  const offer = offered(t);
  return offer && offer.kind !== "promise" ? { given: luckFor(run, t, { ...offer, offered: true }), taker: to } : null;
}

/** A player character handing over one of its things it didn't offer: it keeps it unless the concede luck says otherwise. */
function luckFor(run, t, given) {
  if ( t.spec.kind !== "pc" || given.kind !== "item" || given.item.id === t.spec.motives?.offer?.item?.id ) return given;
  const luck = run.rng.die(100);
  const needed = run.prep.options.concedeLuck ?? CONCEDE_LUCK;
  return { ...given, luck, needed, kept: luck > needed };
}

/**
 * Talking to t in a standoff about what's expected: "press" (the talker expects something t could hand over), or
 * "haggle" (t asked for something, and nothing has met it); null for neither.
 */
export function bargainAim(run, talker, t) {
  if ( !run?.standoff || run.resolved || !areEnemies(run, talker, t) ) return null;
  if ( demanding(talker) && answerFrom(run, t, expectOf(talker), { eager: true }) ) return "press";
  if ( demanding(t) && t.asked ) return "haggle";
  return null;
}

/** Playstyles that hold out for their due, and hold on to what they have (+), and those that come round (-): steps of the DC. */
const HOLDS_OUT = Object.freeze({ mercenary: 3, thief: 2, cruel: 1, vengeful: 1, relentless: 1, impatient: 1, peacekeeper: -3, diplomat: -2, peoplePleaser: -2, moralist: -1, lazy: -1, chicken: -1, enabler: -1 });

/**
 * How much harder it is to strike a bargain with t (haggling it down, or pressing it to hand something over): the
 * greedy hold out (its Selfish, against the deal-taking the usual talk gives it), and its playstyles (the first
 * counts most).
 */
export function holdsOut(run, t) {
  const weights = [1, 0.75, 0.55, 0.4];
  const styles = (t.spec.playstyles ?? []).reduce((s, p, i) => s + (HOLDS_OUT[p] ?? 0) * (weights[i] ?? 0.4), 0);
  return Math.round((liveTrait(run, t, "selfish") - 50) / 12.5 + styles);
}

/** A haggling pitch got somewhere without talking it round yet: it calms down a little, and keeps talking. */
export function calmsDown(t) {
  t.unmet = Math.max(0, (t.unmet ?? 0) - 1);
}

/**
 * Talked round: t comes down from what it expects (asks for less), or, already down as far as it goes, lets it go.
 * Money: half. Something: any material and rarity, then half the value, then an unvalued thing will do. A promise:
 * leaving becomes passage, passage becomes no harm. Calm again, it keeps talking. Returns what it expects now.
 */
export function comeDown(t) {
  const e = expectOf(t);
  let next = null;
  if ( e?.kind === "money" ) next = e.amount >= 2 ? { ...e, amount: Math.floor(e.amount / 2) } : null;
  else if ( e?.kind === "thing" ) {
    if ( e.material || e.rarity ) next = { ...e, material: "", rarity: "", labels: { ...e.labels, material: "", rarity: "" } };
    else if ( (e.minValue ?? 0) >= 2 ) next = { ...e, minValue: Math.floor(e.minValue / 2) };
    else if ( !e.unvalued ) next = { ...e, minValue: 0, unvalued: true };
  } else if ( e?.kind === "promise" ) next = e.promise === "leave" ? { ...e, promise: "passage" } : e.promise === "passage" ? { ...e, promise: "noHarm" } : null;
  t.expect = next;
  t.unmet = 0;
  return next;
}

/**
 * The talker haggled t down: it asks for less (or lets it go), and agrees when the talker meets the new price (it
 * haggled for it), or someone with the talker would. (A player character agreeing to hand over one of its things it
 * didn't offer keeps it unless the concede luck says otherwise.)
 */
export function haggled(run, talker, t, log) {
  const now = comeDown(t);
  t.sway.set(talker.side, 0);
  log(t, { type: "haggle", what: now ? "lowers" : "drops", by: talker.spec.name, byId: talker.id, expect: now });
  if ( !now ) return;
  for ( const o of [talker, ...across(run, t).filter(o => o !== talker)] ) {
    const answer = answerFrom(run, o, now, { eager: o === talker });
    const given = answer && answer.kind !== "promise" ? luckFor(run, o, answer) : answer;
    if ( !given ) continue;
    if ( given.kept ) {
      log(o, { type: "haggle", what: "keeps", item: given.item, luck: given.luck, needed: given.needed, by: t.spec.name, byId: t.id });
      continue;
    }
    return strike(run, o, t, given, log);
  }
}

/**
 * The talker pressed t into meeting what it expects: t hands it over. A player character pressed for one of its things
 * (not one it offered) keeps it unless a d100 comes up under the concede luck, as when it gives something up.
 */
export function pressed(run, talker, t, log) {
  const answer = answerFrom(run, t, expectOf(talker), { eager: true });
  if ( !answer ) return;
  const given = answer.kind === "promise" ? answer : luckFor(run, t, answer);
  if ( given.kept ) {
    t.sway.set(talker.side, 0);
    irritated(talker);
    log(t, { type: "haggle", what: "keeps", item: given.item, luck: given.luck, needed: given.needed, by: talker.spec.name, byId: talker.id });
    return;
  }
  strike(run, t, talker, given, log);
}
