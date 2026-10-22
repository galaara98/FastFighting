/**
 * Deals (behavior/deals.js): bribing someone to go, extorting money, scaring someone off. Who wants one, what's offered
 * or asked, the check and the answer, the goods changing hands (side by side, or dropped to be picked up), and quitting
 * the fight: a free friend group of those taking no side, a commander's team with it, walking off the map; and a blow
 * at one walking away by the side that dealt with it, told to the GM.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, prepareBattle } from "../scripts/engine/simulator.js";
import { dealable, dealWishes, dealTerms, dealDC, offerDeal, quitFight, freeGroup, pickUp, dishonor, means, termsWorth } from "../scripts/engine/behavior/deals.js";
import { levelOf } from "../scripts/engine/behavior/desire.js";
import { remaining } from "../scripts/engine/behavior/talk.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle, social } from "./helpers.js";
import { STATUS, NEUTRAL_PARTY } from "../scripts/constants.js";

const traits = (t = {}) => Object.fromEntries(["tactical", "brave", "selfish", "loyal"].map(k => [k, { base: t[k] ?? 50, fudge: 0 }]));
const at = (x, y = 0) => ({ position: { x, y, size: 5 } });
const purse = (money = 100) => ({ money, denominations: null, stowed: [{ id: "ring", name: "Ring", value: 30 }], wielded: [] });
const talker = (mod = 50) => social({ diplomacy: mod, intimidation: mod, willDC: 15 });
const hero = (extra = {}) => creature({ id: "hero", name: "Hero", kind: "pc", traits: traits({ brave: 80, loyal: 50 }), hp: { value: 100, max: 100 }, actions: [strike({ bonus: -50 })],
  social: talker(), valuables: purse(500), ...at(0), ...extra });
const goblin = (id = "goblin", extra = {}) => creature({ id, name: id, side: "hostile", traits: traits(), hp: { value: 30, max: 30 }, actions: [strike({ bonus: -50 })],
  social: talker(), valuables: purse(), ...at(20), ...extra });

function fight(list, { bounds = { x0: -200, y0: -100, x1: 200, y1: 100 }, rules = pf2eRules, options = {}, command = null, seed = 3 } = {}) {
  const spec = battle(list, { maxRounds: 6, positioning: true, aftermath: "none", ...options });
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
