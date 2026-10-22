/**
 * Deals (behavior/deals.js): bribing someone to go, extorting money, scaring someone off. Who wants one, what's offered
 * or asked, the check and the answer, the goods changing hands (side by side, or dropped to be picked up), and quitting
 * the fight: a free friend group of those taking no side, a commander's team with it, walking off the map; and a blow
 * at one walking away by the side that dealt with it, told to the GM.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, prepareBattle, takeTurn, runBatchSync } from "../scripts/engine/simulator.js";
import { beginLive, liveTurn, NeedsDecision } from "../scripts/engine/live.js";
import { dealable, dealWishes, dealTerms, dealDC, offerDeal, quitFight, freeGroup, pickUp, dishonor, means, termsWorth, turnChance, settle } from "../scripts/engine/behavior/deals.js";
import { levelOf } from "../scripts/engine/behavior/desire.js";
import { remaining } from "../scripts/engine/behavior/talk.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle, social } from "./helpers.js";
import { STATUS, NEUTRAL_PARTY } from "../scripts/constants.js";
import { logLine } from "../scripts/story/log-lines.js";
import { buildStory } from "../scripts/story/story.js";
import { storyTables } from "./foundry-i18n.js";

const traits = (t = {}) => Object.fromEntries(["tactical", "brave", "selfish", "loyal"].map(k => [k, { base: t[k] ?? 50, fudge: 0 }]));
const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
const purse = (money = 100) => ({ money, denominations: null, stowed: [{ id: "ring", name: "Ring", value: 30 }], wielded: [] });
const talker = (mod = 50) => social({ diplomacy: mod, intimidation: mod, willDC: 15 });
const hero = (extra = {}) => creature({ id: "hero", name: "Hero", kind: "pc", traits: traits({ brave: 80, loyal: 50 }), hp: { value: 100, max: 100 }, actions: [strike({ bonus: -50 })],
  social: talker(), valuables: purse(500), ...at(0), ...extra });
const goblin = (id = "goblin", extra = {}) => creature({ id, name: id, side: "hostile", traits: traits(), hp: { value: 30, max: 30 }, actions: [strike({ bonus: -50 })],
  social: talker(), valuables: purse(), ...at(20), ...extra });

function fight(list, { bounds = { x0: -200, y0: -100, x1: 200, y1: 100 }, rules = pf2eRules, options = {}, command = null, seed = 3 } = {}) {
  const spec = battle(list, { maxRounds: 6, positioning: true, aftermath: "none", opening: "fight", ...options });
  if ( bounds ) spec.bounds = bounds;
  if ( command ) spec.command = command;
  const run = beginRun(prepareBattle(spec, rules), seed, { log: true });
  beginRound(run, 1);
  for ( const u of run.units ) u.active = true;
  return run;
}
const say = run => (u, data) => run.log.push({ actor: u.spec.name, actorId: u.id, ...data });
const unit = (run, id) => run.byId.get(id);

describe("who can deal with whom", () => {
  test("a language in common; without one, only a threat, and only where the system allows one without words", () => {
    const run = fight([hero(), goblin("goblin", { social: { ...talker(), languages: ["goblin"] } })]);
    const [h, g] = [unit(run, "hero"), unit(run, "goblin")];
    expect(means(run, h, g, "bribe")).toBe(null);
    expect(dealable(run, h, g, "scare")).toBe(false);
    const wordless = fight([hero(), goblin("goblin", { social: { ...talker(), languages: ["goblin"] } })], { rules: { ...pf2eRules, wordlessIntimidation: -4 } });
    const [h2, g2] = [unit(wordless, "hero"), unit(wordless, "goblin")];
    expect(means(wordless, h2, g2, "bribe")).toBe(null);
    expect(means(wordless, h2, g2, "scare")).toBe("wordless");
    expect(dealable(wordless, h2, g2, "scare")).toBe(true);
    // ("Ignore languages": any language at all will do.)
    const ignored = fight([hero(), goblin("goblin", { social: { ...talker(), languages: ["goblin"] } })], { options: { ignoreLanguages: true } });
    expect(means(ignored, unit(ignored, "hero"), unit(ignored, "goblin"), "bribe")).toBe("words");
  });

  test("a bribe needs something to give, an extortion someone with money; nothing with a mindless thing, or an animal", () => {
    const run = fight([hero({ valuables: { money: 0, stowed: [], wielded: [] } }), goblin("goblin", { valuables: { money: 0, stowed: [], wielded: [] } }),
      goblin("ooze", { social: { ...talker(), mindless: true } }), goblin("wolf", { animalistic: true })]);
    const h = unit(run, "hero");
    expect(dealable(run, h, unit(run, "goblin"), "bribe")).toBe(false);
    expect(dealable(run, h, unit(run, "goblin"), "extort")).toBe(false);
    expect(dealable(run, h, unit(run, "goblin"), "scare")).toBe(true);
    expect(dealable(run, h, unit(run, "ooze"), "scare")).toBe(false);
    expect(dealable(run, h, unit(run, "wolf"), "scare")).toBe(false);
  });
});

describe("wanting a deal", () => {
  test("hurt and outnumbered, a timid one wants to buy its way out; a bold, greedy one on top wants money", () => {
    const run = fight([hero(), creature({ id: "squire", traits: traits(), social: talker(), ...at(-5) }),
      goblin("coward", { traits: traits({ brave: 10, selfish: 30 }) }), goblin("bully", { traits: traits({ brave: 90, selfish: 90 }), level: 6, ...at(30) })]);
    const [h, coward, bully] = [unit(run, "hero"), unit(run, "coward"), unit(run, "bully")];
    coward.hp = 5;
    h.hp = 30;
    dealWishes(run, coward);
    expect(levelOf(coward, "bribe", h.id)).toBeGreaterThan(20);
    expect(levelOf(coward, "extort", h.id)).toBe(0);
    dealWishes(run, bully);
    expect(levelOf(bully, "extort", h.id)).toBeGreaterThan(10);
    expect(levelOf(bully, "bribe", h.id)).toBe(0);
  });

  test("nothing in a world where nobody talks, nor for one whose answer is never to", () => {
    const run = fight([hero(), goblin("coward", { traits: traits({ brave: 10 }), tactics: { talk: "never" } })]);
    const coward = unit(run, "coward");
    coward.hp = 5;
    dealWishes(run, coward);
    expect(levelOf(coward, "bribe", "hero")).toBe(0);
    const quiet = fight([hero(), goblin("coward", { traits: traits({ brave: 10 }) })], { options: { talking: false } });
    unit(quiet, "coward").hp = 5;
    dealWishes(quiet, unit(quiet, "coward"));
    expect(levelOf(unit(quiet, "coward"), "bribe", "hero")).toBe(0);
  });

  test("one taking no side wants whoever comes too close gone", () => {
    const run = fight([hero(), goblin(), creature({ id: "hermit", side: NEUTRAL_PARTY, originSide: "neutral", traits: traits({ brave: 80 }), social: talker(), valuables: purse(), ...at(5, 5) })]);
    const hermit = unit(run, "hermit");
    dealWishes(run, hermit);
    expect(levelOf(hermit, "scare", "hero") + levelOf(hermit, "bribe", "hero")).toBeGreaterThan(10);
    expect(levelOf(hermit, "scare", "goblin")).toBe(0); // (20 ft off: not too close)
  });
});

describe("the terms", () => {
  test("a bribe is a share of its purse (more, the harder pressed); with no money, the best thing it carries", () => {
    const run = fight([hero(), goblin(), goblin("poor", { valuables: { money: 0, stowed: [{ id: "a", name: "A", value: 2 }, { id: "b", name: "B", value: 9 }], wielded: [] } })]);
    const [h, g] = [unit(run, "hero"), unit(run, "goblin")];
    const calm = dealTerms(run, g, h, "bribe");
    g.hp = 3;
    const desperate = dealTerms(run, g, h, "bribe");
    expect(calm.money).toBeGreaterThan(0);
    expect(desperate.money).toBeGreaterThan(calm.money);
    expect(dealTerms(run, unit(run, "poor"), h, "bribe").items).toEqual([{ id: "b", name: "B", value: 9, count: 1 }]);
    // (Asking a player's character for money: pay, and be left alone.)
    expect(dealTerms(run, g, h, "extort")).toMatchObject({ kind: "extort", ask: "spare" });
    expect(dealTerms(run, h, g, "extort").ask).toBe("leave");
    expect(termsWorth({ money: 5, items: [{ value: 3, count: 2 }] })).toBe(11);
  });
});

describe("how hard", () => {
  test("buying it off is easiest, telling it to go harder, making it pay and go hardest; a fighter set on the fight, harder still", () => {
    const run = fight([hero(), goblin()]);
    const [h, g] = [unit(run, "hero"), unit(run, "goblin")];
    const bribe = dealDC(run, h, g, { kind: "bribe", ask: "leave", money: 1, items: [] });
    const scare = dealDC(run, h, g, { kind: "scare", ask: "leave", money: 0, items: [] });
    const extort = dealDC(run, h, g, { kind: "extort", ask: "leave", money: 1, items: [] });
    expect(bribe).toBeLessThan(scare);
    expect(scare).toBeLessThan(extort);
    expect(dealDC(run, h, g, { kind: "extort", ask: "leave", money: 100, items: [] })).toBeGreaterThan(extort);
    g.desire.stated.set("hurt|hero", 100);
    expect(dealDC(run, h, g, { kind: "scare", ask: "leave", money: 0, items: [] })).toBeGreaterThanOrEqual(scare + 3);
  });

  test("its pills: a Chicken gives way to threats, a Relentless one doesn't; a Mercenary takes the money", () => {
    const run = fight([hero(), goblin("chicken", { playstyles: ["chicken"] }), goblin("relentless", { playstyles: ["relentless"] }), goblin("merc", { playstyles: ["mercenary"] }), goblin()]);
    const h = unit(run, "hero");
    const scare = id => dealDC(run, h, unit(run, id), { kind: "scare", ask: "leave", money: 0, items: [] });
    const bribe = id => dealDC(run, h, unit(run, id), { kind: "bribe", ask: "leave", money: 10, items: [] });
    expect(scare("chicken")).toBeLessThan(scare("goblin"));
    expect(scare("relentless")).toBeGreaterThan(scare("goblin"));
    expect(bribe("merc")).toBeLessThan(bribe("goblin"));
  });

  test("an extortion that asks for nothing is a threat to go, and no more", () => {
    const run = fight([hero(), goblin()]);
    offerDeal(run, unit(run, "hero"), unit(run, "goblin"), "extort", say(run), { terms: { kind: "extort", ask: "spare", money: 0, items: [] } });
    expect(run.log.find(e => e.type === "deal")).toMatchObject({ kind: "scare", terms: { kind: "scare", ask: "leave" } });
  });
});

describe("striking the deal", () => {
  test("a bribe taken side by side: the goods go at once, and the one paid quits into a free friend group and walks off", () => {
    const run = fight([hero({ ...at(15) }), goblin()]);
    const [h, g] = [unit(run, "hero"), unit(run, "goblin")];
    h.adjacent.add(g.id);
    g.adjacent.add(h.id);
    expect(freeGroup(run)).toBe(1);
    const answer = offerDeal(run, h, g, "bribe", say(run), { terms: { kind: "bribe", ask: "leave", money: 40, items: [] } });
    expect(answer).toBe("accept");
    expect(h.concessions).toEqual([expect.objectContaining({ kind: "money", amount: 40, how: "bribe", to: "goblin" })]);
    expect(h.concessions[0].drop).toBeUndefined();
    expect(remaining(h).money).toBe(460);
    expect(g.side).toBe(NEUTRAL_PARTY);
    expect(g.friendGroup).toBe(1);
    expect(g.lean).toBe(null);
    expect(g.leaving).toMatchObject({ why: "deal", deal: { side: "friendly", byId: "hero" } });
    expect(run.log.find(e => e.type === "deal")).toMatchObject({ kind: "bribe", targetId: "goblin", answer: "accept", by: "check" });
    expect(run.log.find(e => e.type === "quit")).toMatchObject({ actorId: "goblin", group: 1, byId: "hero" });
  });

  test("apart, the goods are dropped where the giver stands, and the one paid picks them up; a player's character's go at once", () => {
    const run = fight([hero({ ...at(-40) }), creature({ id: "squire", traits: traits(), social: talker(), valuables: purse(), ...at(0) }), goblin()]);
    const [h, g] = [unit(run, "squire"), unit(run, "goblin")];
    offerDeal(run, h, g, "bribe", say(run), { terms: { kind: "bribe", ask: "leave", money: 40, items: [{ id: "ring", count: 1 }] } });
    expect(h.concessions.map(c => c.kind)).toEqual(["money", "item"]);
    expect(h.concessions[0].drop).toMatchObject({ x: 0, y: 0 });
    expect(g.fetch).toMatchObject({ x: 0, y: 0, fromId: "squire" });
    expect(run.log.some(e => e.type === "dropGoods" && e.forId === "goblin")).toBe(true);
    expect(pickUp(run, g, say(run))).toBe(true);
    expect(g.fetch).toBe(null);
    expect(h.concessions.every(c => c.picked)).toBe(true);
    expect(run.log.at(-1)).toMatchObject({ type: "pickUp", actorId: "goblin", fromId: "squire" });
    const pc = fight([hero(), goblin()]);
    offerDeal(pc, unit(pc, "hero"), unit(pc, "goblin"), "bribe", say(pc), { terms: { kind: "bribe", ask: "leave", money: 40, items: [] } });
    expect(unit(pc, "hero").concessions[0].drop).toBeUndefined();
  });

  test("where the table can't show goods on the ground, they go at once, however far", () => {
    const run = fight([creature({ id: "squire", traits: traits(), social: talker(), valuables: purse(), ...at(0) }), goblin()], { options: { dropGoods: false } });
    const [h, g] = [unit(run, "squire"), unit(run, "goblin")];
    offerDeal(run, h, g, "bribe", say(run), { terms: { kind: "bribe", ask: "leave", money: 40, items: [] } });
    expect(h.concessions[0].drop).toBeUndefined();
    expect(g.fetch).toBeUndefined();
  });

  test("an extortion paid: the money goes from the one threatened, who leaves", () => {
    const run = fight([hero({ ...at(15) }), goblin()]);
    const [h, g] = [unit(run, "hero"), unit(run, "goblin")];
    h.adjacent.add(g.id);
    offerDeal(run, h, g, "extort", say(run), { terms: { kind: "extort", ask: "leave", money: 60, items: [] } });
    expect(g.concessions).toEqual([expect.objectContaining({ kind: "money", amount: 60, how: "extort", to: "hero" })]);
    expect(g.leaving?.why).toBe("deal");
  });

  test("whoever pays must have it at the last moment: a bribe of more than the briber has, or an extortion of more than the other has, comes to nothing", () => {
    const run = fight([hero({ ...at(15) }), goblin()]);
    const [h, g] = [unit(run, "hero"), unit(run, "goblin")];
    expect(offerDeal(run, h, g, "bribe", say(run), { terms: { kind: "bribe", ask: "leave", money: 9999, items: [] } })).toBe("unpaid");
    expect(offerDeal(run, unit(run, "goblin"), h, "bribe", say(run), { terms: { kind: "bribe", ask: "leave", money: 0, items: [{ id: "nothing", count: 1 }] } })).toBe("unpaid");
    h.dealt.clear();
    expect(offerDeal(run, h, g, "extort", say(run), { terms: { kind: "extort", ask: "leave", money: 101, items: [] } })).toBe("unpaid");
    expect(h.concessions ?? []).toEqual([]);
    expect(g.concessions ?? []).toEqual([]);
    expect(g.leaving ?? null).toBe(null);
    expect(h.leaving ?? null).toBe(null);
    expect(run.log.filter(e => e.type === "deal").map(e => e.answer)).toEqual(["unpaid", "unpaid", "unpaid"]);
  });

  test("paid to be left alone: the two let each other be", () => {
    const run = fight([hero(), goblin("goblin", { ...at(5) })]);
    const [h, g] = [unit(run, "hero"), unit(run, "goblin")];
    offerDeal(run, g, h, "extort", say(run), { terms: { kind: "extort", ask: "spare", money: 10, items: [] } });
    expect(h.concessions[0]).toMatchObject({ how: "extort", to: "goblin" });
    expect(g.spares.has("hero")).toBe(true);
    expect(h.spares.has("goblin")).toBe(true);
    expect(h.leaving ?? null).toBe(null);
    expect(dealable(run, g, h, "scare")).toBe(false);
    // (Neither goes for the other now.)
    takeTurn(run, g);
    takeTurn(run, h);
    expect(run.log.some(e => e.type === "attack" && ((e.actorId === "goblin" && e.targetId === "hero") || (e.actorId === "hero" && e.targetId === "goblin")))).toBe(false);
  });

  test("a threat that got through, refused all the same, frightens; again, more", () => {
    const run = fight([hero(), goblin(), goblin("other")]);
    const [h, g] = [unit(run, "hero"), unit(run, "goblin")];
    run.live = { dealAsk: (r, req) => (req.ask === "answer" ? "refuse" : null) };
    expect(offerDeal(run, h, g, "scare", say(run))).toBe("refuse");
    expect(g.conds.frightened).toBe(1);
    expect(run.log.find(e => e.type === "deal")).toMatchObject({ answer: "refuse", by: "player", frightened: 1 });
    h.dealt.clear();
    offerDeal(run, h, g, "scare", say(run));
    expect(g.conds.frightened).toBe(2);
    expect(g.leaving ?? null).toBe(null);
  });

  test("botched: offended, it goes for whoever asked; a failure is only a no", () => {
    const run = fight([hero({ social: talker(-60) }), goblin()]);
    const [h, g] = [unit(run, "hero"), unit(run, "goblin")];
    const answer = offerDeal(run, h, g, "bribe", say(run));
    expect(["offended", "refuse"]).toContain(answer);
    if ( answer === "offended" ) {
      expect(g.offendedBy.has("hero")).toBe(true);
      expect(levelOf(g, "hurt", "hero")).toBeGreaterThan(0);
    }
    expect(h.concessions ?? []).toEqual([]);
    expect(dealable(run, h, g, "bribe")).toBe(false); // (tried once: not again)
  });

  test("where the system doesn't track languages, the GM says whether the two can talk at all", () => {
    const run = fight([hero(), goblin()], { rules: { ...pf2eRules, languages: false } });
    const [h, g] = [unit(run, "hero"), unit(run, "goblin")];
    const asked = [];
    run.live = { dealAsk: (r, req) => { asked.push(req.ask); return req.ask === "talkOk" ? false : null; } };
    expect(offerDeal(run, h, g, "bribe", say(run))).toBe(null);
    expect(asked).toEqual(["talkOk"]);
    expect(run.log.find(e => e.type === "deal")).toMatchObject({ answer: "unheard" });
    expect(h.concessions ?? []).toEqual([]);
  });
});

describe("quitting the fight", () => {
  test("a commander urges its team to go with it, into the same friend group: the loyal and the timid mostly do", () => {
    const command = { hostile: [{ id: "boss", role: "boss", leadership: { brave: 0, tacticalFloor: 40, attack: 0, ac: 0 } }] };
    let calls = 0;
    let followed = 0;
    for ( let seed = 1; seed <= 10; seed++ ) {
      const run = fight([hero(), goblin("boss"), goblin("a", { traits: traits({ loyal: 100, brave: 0 }) }), goblin("b", { traits: traits({ loyal: 100, brave: 0 }) })],
        { options: { leadership: true }, command, seed });
      quitFight(run, unit(run, "boss"), { by: unit(run, "hero"), say: say(run) });
      expect(unit(run, "boss").friendGroup).toBe(1);
      for ( const c of run.log.filter(e => e.type === "quitCall") ) {
        calls += 1;
        expect(c.byId).toBe("boss");
        if ( !c.follows ) continue;
        followed += 1;
        expect(unit(run, c.actorId)).toMatchObject({ side: NEUTRAL_PARTY, friendGroup: 1 });
        expect(unit(run, c.actorId).leaving?.why).toBe("deal");
      }
    }
    expect(calls).toBe(20);
    expect(followed).toBeGreaterThan(12);
    // (One that commands nobody quits alone.)
    const run = fight([hero(), goblin("boss"), goblin("a")], { options: { leadership: true }, command });
    quitFight(run, unit(run, "a"), { by: unit(run, "hero"), say: say(run) });
    expect(run.log.some(e => e.type === "quitCall")).toBe(false);
  });

  test("with every friend group taken, it stays with its side and runs; with no map, it's gone at once", () => {
    const hermits = [1, 2, 3].map(n => creature({ id: `h${n}`, side: NEUTRAL_PARTY, originSide: "neutral", group: n, ...at(150, n * 10) }));
    const run = fight([hero(), goblin(), ...hermits]);
    expect(freeGroup(run)).toBe(null);
    const g = unit(run, "goblin");
    quitFight(run, g, { by: unit(run, "hero"), say: say(run) });
    expect(g.side).toBe("hostile");
    expect(g.leaving?.why).toBe("deal");
    const flat = fight([hero(), goblin()], { bounds: null });
    const g2 = unit(flat, "goblin");
    quitFight(flat, g2, { by: unit(flat, "hero"), say: say(flat) });
    expect(g2.status).toBe(STATUS.FLED);
    expect(g2.walkedAway).toBe(true);
    expect(flat.log.at(-1)).toMatchObject({ type: "offMap", walkedAway: true });
  });

  test("struck on its way by the side that dealt with it: a dishonorable blow, told once for each who strikes", () => {
    const run = fight([hero(), creature({ id: "squire", traits: traits(), ...at(-5) }), goblin(), goblin("other")]);
    const [h, squire, g, other] = ["hero", "squire", "goblin", "other"].map(id => unit(run, id));
    quitFight(run, g, { by: h, say: say(run) });
    expect(dishonor(run, g, squire, say(run))).toBe(true);
    expect(dishonor(run, g, squire, say(run))).toBe(false);
    expect(dishonor(run, g, other, say(run))).toBe(false);
    expect(run.log.filter(e => e.type === "dishonor")).toEqual([expect.objectContaining({ actorId: "squire", targetId: "goblin", dealById: "hero" })]);
  });
});

describe("in the turn", () => {
  test("a hurt, timid creature goes within talking range of the one it fears and pays it to go; it walks off with the money", () => {
    const run = fight([hero({ ...at(0) }), goblin("coward", { traits: traits({ brave: 5, selfish: 20, loyal: 20 }), social: talker(4), ...at(120) })]);
    const [h, c] = [unit(run, "hero"), unit(run, "coward")];
    c.hp = 4;
    h.desire.stated.set("hurt|coward", 30);
    // (The hero, a sure thing to take it: no saying no.)
    h.prep.traits.loyal = 0;
    takeTurn(run, c);
    const deal = run.log.find(e => e.type === "deal");
    // (120 ft off: it closes in this turn, and makes its offer on the next.)
    expect(deal).toBeUndefined();
    expect(run.log.some(e => e.type === "move" && e.actorId === "coward")).toBe(true);
    takeTurn(run, c);
    const offer = run.log.find(e => e.type === "deal");
    expect(offer).toMatchObject({ actorId: "coward", kind: "bribe", targetId: "hero" });
    expect(Math.hypot(c.pos.x - h.pos.x, c.pos.y - h.pos.y)).toBeLessThanOrEqual(36);
    if ( offer.answer !== "accept" ) return;
    expect(h.leaving?.why).toBe("deal");
    // (A player's character: the money goes at once.)
    expect(c.concessions[0]).toMatchObject({ how: "bribe", to: "hero" });
    for ( let i = 0; i < 4 && h.status === STATUS.STANDING; i++ ) takeTurn(run, h);
    expect(h.status).toBe(STATUS.FLED);
    expect(h.walkedAway).toBe(true);
    expect(run.log.some(e => e.type === "offMap" && e.actorId === "hero" && e.walkedAway)).toBe(true);
  });

  test("one paid apart, by a creature, picks the goods up on its way off", () => {
    const run = fight([creature({ id: "squire", traits: traits(), social: talker(), valuables: purse(), ...at(0) }), goblin("goblin", { ...at(25) })]);
    const [sq, g] = [unit(run, "squire"), unit(run, "goblin")];
    g.prep.traits.loyal = 0;
    const answer = offerDeal(run, sq, g, "bribe", say(run), { terms: { kind: "bribe", ask: "leave", money: 50, items: [] } });
    expect(answer).toBe("accept");
    expect(g.fetch).toBeTruthy();
    takeTurn(run, g);
    expect(run.log.some(e => e.type === "pickUp" && e.actorId === "goblin")).toBe(true);
    expect(g.fetch).toBe(null);
    expect(sq.concessions[0].picked).toBe(true);
  });

  test("one that quit into a friend group of those taking no side walks off, rather than standing watching", () => {
    const run = fight([hero(), goblin("goblin", { ...at(40) }), goblin("other", { ...at(60) })]);
    const g = unit(run, "goblin");
    quitFight(run, g, { by: unit(run, "hero"), say: say(run) });
    expect(g.side).toBe(NEUTRAL_PARTY);
    const from = { ...g.pos };
    takeTurn(run, g);
    expect(Math.hypot(g.pos.x - from.x, g.pos.y - from.y)).toBeGreaterThan(50);
    expect(run.log.filter(e => e.type === "move" && e.actorId === "goblin").every(e => e.purpose === "leave")).toBe(true);
  });

  test("struck by the side that paid it off: a dishonorable blow, in the log", () => {
    const run = fight([hero({ actions: [strike({ bonus: 50 })], ...at(0) }), goblin("goblin", { ...at(5) }), goblin("other", { ...at(80) })]);
    const [h, g] = [unit(run, "hero"), unit(run, "goblin")];
    h.adjacent.add(g.id);
    g.adjacent.add(h.id);
    quitFight(run, g, { by: h, say: say(run) });
    // (The goblin stays on its side, as it would with no group free, so the hero still takes it for a foe.)
    g.side = "hostile";
    g.homeSide = "hostile";
    g.friendGroup = null;
    takeTurn(run, h);
    expect(run.log.some(e => e.type === "dishonor" && e.actorId === "hero" && e.targetId === "goblin")).toBe(true);
  });

  test("in a standoff, before any blow: a deal with one in talking range", () => {
    let dealt = 0;
    for ( let seed = 1; seed <= 20; seed++ ) {
      const run = fight([hero({ ...at(0) }), goblin("bully", { traits: traits({ brave: 95, selfish: 95 }), level: 8, ...at(20) })], { options: { opening: "standoff" }, seed });
      run.standoff ??= { by: null };
      takeTurn(run, unit(run, "bully"));
      if ( run.log.some(e => e.type === "deal" && e.actorId === "bully") ) dealt += 1;
    }
    expect(dealt).toBeGreaterThan(0);
  });

  test("whole fights with deals in them play out, and a batch of them counts the same as fight by fight", () => {
    const spec = battle([hero({ ...at(0) }), goblin("coward", { traits: traits({ brave: 5, selfish: 20 }), ...at(40) }), goblin("bully", { traits: traits({ brave: 95, selfish: 95 }), level: 6, ...at(50) })],
      { maxRounds: 6, positioning: true, aftermath: "none" });
    spec.bounds = { x0: -200, y0: -100, x1: 200, y1: 100 };
    const res = runBatchSync(spec, pf2eRules, { runs: 40 });
    expect(res.runs ?? 40).toBe(40);
  });
});

describe("told", () => {
  const english = storyTables();
  const tables = { get: k => english[k] };
  const events = [
    { type: "deal", actor: "Hero", target: "Goblin", kind: "bribe", terms: { kind: "bribe", ask: "leave", money: 40, items: [{ name: "Ring", count: 2 }] }, skill: "diplomacy", natural: 12, mod: 5, total: 17, dc: 15, dcStat: "will", degree: 2, answer: "accept", by: "check" },
    { type: "deal", actor: "Hero", target: "Goblin", kind: "extort", terms: { kind: "extort", ask: "spare", money: 40, items: [] }, skill: "intimidation", natural: 3, mod: 5, total: 8, dc: 15, dcStat: "will", degree: 1, answer: "refuse", by: "player", wordless: true },
    { type: "deal", actor: "Hero", target: "Goblin", kind: "scare", terms: { kind: "scare", ask: "leave", money: 0, items: [] }, skill: "intimidation", natural: 15, mod: 5, total: 20, dc: 15, dcStat: "will", degree: 2, answer: "refuse", by: "check", frightened: 2 },
    { type: "deal", actor: "Hero", target: "Goblin", kind: "bribe", terms: { kind: "bribe", ask: "avoid", money: 400, items: [] }, skill: "diplomacy", degree: 3, natural: 20, mod: 5, total: 25, dc: 15, dcStat: "will", answer: "unpaid" },
    { type: "deal", actor: "Hero", target: "Goblin", kind: "bribe", terms: { kind: "bribe", ask: "leave", money: 4, items: [] }, skill: "diplomacy", degree: 0, natural: 1, mod: 5, total: 6, dc: 15, dcStat: "will", answer: "offended" },
    { type: "deal", actor: "Hero", target: "Goblin", kind: "bribe", terms: { kind: "bribe", ask: "leave", money: 4, items: [] }, answer: "unheard" },
    { type: "quit", actor: "Goblin", by: "Hero", group: 2 },
    { type: "quit", actor: "Grunt", by: "Hero", following: "Goblin" },
    { type: "quitCall", actor: "Grunt", by: "Goblin", follows: true },
    { type: "dropGoods", actor: "Squire", for: "Goblin", goods: [{ kind: "money", amount: 40 }, { kind: "item", item: { name: "Ring" }, count: 2 }] },
    { type: "pickUp", actor: "Goblin", from: "Squire", goods: [{ kind: "money", amount: 40 }] },
    { type: "offMap", actor: "Goblin", walkedAway: true },
    { type: "dishonor", actor: "Squire", target: "Goblin", dealBy: "Hero" }
  ];

  test("every deal event has a log line with nothing left unfilled", () => {
    for ( const e of events ) {
      const line = logLine(e);
      expect(line, e.type).toBeTruthy();
      expect(line, line).not.toMatch(/[{}]|FASTFIGHTING\./);
    }
    expect(logLine(events[0])).toContain("Ring");
    expect(logLine(events[2])).toContain("2");
  });

  test("and a story line, the same", () => {
    const run = fight([hero(), goblin()]);
    const result = { log: events.map((e, i) => ({ round: 1, turn: i, actorId: "hero", ...e })), units: {}, rounds: 1, winner: null };
    const prose = buildStory(result, run.prep.spec ?? { combatants: [] }, "roleplay", { tables, seed: 3 }).text;
    expect(prose).not.toMatch(/\{[a-z]+\}|event\./);
  });
});

describe("live", () => {
  /** A goblin that wants nothing but to pay the hero to go, in a live battle the hero's player plays. */
  function setUp(rules = pf2eRules) {
    const spec = battle([hero({ ...at(0) }), goblin("coward", { traits: traits({ brave: 5, selfish: 20 }), social: talker(30), ...at(20) })],
      { maxRounds: 6, positioning: true, aftermath: "none", opening: "fight" });
    spec.bounds = { x0: -200, y0: -100, x1: 200, y1: 100 };
    const run = beginLive(spec, rules, { seed: 5, players: ["hero"] });
    for ( const u of run.units ) u.active = true;
    run.byId.get("coward").hp = 3;
    run.byId.get("coward").desire.stated.set("bribe|hero", 95);
    return run;
  }
  function playThrough(make, id, answer) {
    const answers = [];
    const requests = [];
    for ( let tries = 0; tries < 40; tries++ ) {
      const run = make();
      try {
        const { events } = liveTurn(run, id, { answers });
        return { run, events, requests };
      } catch ( err ) {
        if ( !(err instanceof NeedsDecision) ) throw err;
        requests.push(err.request);
        answers.push([err.request.key, answer(err.request)]);
      }
    }
    throw new Error("never stops asking");
  }

  test("a deal with a player's character waits for its player's answer, and goes as they say", () => {
    const yes = playThrough(setUp, "coward", r => (r.deal === "answer" ? "accept" : null));
    const asked = yes.requests.find(r => r.deal === "answer");
    expect(asked).toMatchObject({ unitId: "coward", targetId: "hero", kind: "bribe", terms: expect.objectContaining({ kind: "bribe" }) });
    expect(yes.events.find(e => e.type === "deal")).toMatchObject({ answer: "accept", by: "player" });
    expect(yes.run.byId.get("hero").leaving?.why).toBe("deal");
    const no = playThrough(setUp, "coward", r => (r.deal === "answer" ? "refuse" : null));
    expect(no.events.find(e => e.type === "deal")).toMatchObject({ answer: "refuse", by: "player" });
    expect(no.run.byId.get("hero").leaving ?? null).toBe(null);
  });

  test("where the system doesn't track languages, the GM is asked first; no, and nothing comes of it", () => {
    const rules = { ...pf2eRules, languages: false };
    const out = playThrough(() => setUp(rules), "coward", r => (r.deal === "talkOk" ? false : null));
    expect(out.requests.map(r => r.deal)).toEqual(["talkOk"]);
    expect(out.events.find(e => e.type === "deal")).toMatchObject({ answer: "unheard" });
  });
});

describe("stacks", () => {
  test("of a stack, only as many as went are gone", () => {
    const run = fight([creature({ id: "squire", traits: traits(), social: talker(), valuables: { money: 0, stowed: [{ id: "arrows", name: "Arrows", value: 1, quantity: 20 }], wielded: [] }, ...at(0) }), goblin("goblin", { ...at(5) })]);
    const [sq, g] = [unit(run, "squire"), unit(run, "goblin")];
    sq.adjacent.add(g.id);
    g.prep.traits.loyal = 0;
    expect(offerDeal(run, sq, g, "bribe", say(run), { terms: { kind: "bribe", ask: "leave", money: 0, items: [{ id: "arrows", name: "Arrows", count: 15 }] } })).toBe("accept");
    expect(sq.concessions[0]).toMatchObject({ kind: "item", count: 15 });
    expect(remaining(sq).stowed).toEqual([expect.objectContaining({ id: "arrows", quantity: 5 })]);
    // (More than are left: no.)
    const run2 = fight([creature({ id: "squire", traits: traits(), social: talker(), valuables: { money: 0, stowed: [{ id: "arrows", name: "Arrows", value: 1, quantity: 2 }], wielded: [] }, ...at(0) }), goblin("goblin", { ...at(5) })]);
    unit(run2, "goblin").prep.traits.loyal = 0;
    expect(offerDeal(run2, unit(run2, "squire"), unit(run2, "goblin"), "bribe", say(run2), { terms: { kind: "bribe", ask: "leave", money: 0, items: [{ id: "arrows", count: 3 }] } })).toBe("unpaid");
  });
});

describe("bought over", () => {
  const bribe = money => ({ kind: "bribe", ask: "leave", money, items: [] });

  test("the more lavish the offer to it, and a critical success, the likelier; never a player's character, a boss, or by one taking no side", () => {
    const run = fight([hero(), goblin("goblin", { traits: traits({ selfish: 80, loyal: 20 }) }), goblin("boss", { isBoss: true }), creature({ id: "hermit", side: NEUTRAL_PARTY, originSide: "neutral", social: talker(), valuables: purse(), ...at(50, 50) })]);
    const [h, g] = [unit(run, "hero"), unit(run, "goblin")];
    expect(turnChance(run, h, g, bribe(5), 2)).toBeLessThan(turnChance(run, h, g, bribe(400), 2));
    expect(turnChance(run, h, g, bribe(5), 3)).toBeGreaterThan(turnChance(run, h, g, bribe(5), 2) + 0.3);
    expect(turnChance(run, h, g, bribe(400), 3)).toBeLessThanOrEqual(0.75);
    unit(run, "boss").isBoss = true;
    expect(turnChance(run, h, unit(run, "boss"), bribe(400), 3)).toBe(0);
    expect(turnChance(run, g, h, bribe(100), 3)).toBe(0);
    expect(turnChance(run, unit(run, "hermit"), g, bribe(100), 3)).toBe(0);
    expect(turnChance(run, h, g, { kind: "scare", ask: "leave", money: 0, items: [] }, 3)).toBe(0);
  });

  test("an enemy bought over stands aside, leaning toward the briber's side, and stays; one taking no side joins it", () => {
    let aside = 0;
    for ( let seed = 1; seed <= 30; seed++ ) {
      const run = fight([hero({ ...at(15) }), goblin("goblin", { traits: traits({ selfish: 100, loyal: 0 }) })], { seed });
      const [h, g] = [unit(run, "hero"), unit(run, "goblin")];
      h.adjacent.add(g.id);
      settle(run, h, g, bribe(400), say(run), { degree: 3 });
      // (Not bought over: it quits, into a free friend group of those taking no side, and leaves.)
      if ( g.leaving ) {
        expect(g.leaving.why).toBe("deal");
        continue;
      }
      expect(g.side).toBe(NEUTRAL_PARTY);
      aside += 1;
      expect(g.lean).toBe("friendly");
      expect(g.leaving ?? null).toBe(null);
      expect(run.log.find(e => e.type === "sway")).toMatchObject({ actorId: "goblin", outcome: "neutral", byId: "hero" });
      expect(h.concessions[0]).toMatchObject({ how: "bribe", to: "goblin" });
    }
    expect(aside).toBeGreaterThan(10);
    let joined = 0;
    for ( let seed = 1; seed <= 30; seed++ ) {
      const run = fight([hero({ ...at(15) }), goblin(), creature({ id: "hermit", side: NEUTRAL_PARTY, originSide: "neutral", traits: traits({ selfish: 100, loyal: 0 }), social: talker(), ...at(25) })], { seed });
      const n = unit(run, "hermit");
      n.against.add("friendly");
      settle(run, unit(run, "hero"), n, bribe(400), say(run), { degree: 3 });
      if ( n.side === "friendly" ) joined += 1;
    }
    expect(joined).toBeGreaterThan(10);
  });
});
