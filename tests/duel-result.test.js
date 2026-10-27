/**
 * Spell duels the system reckons itself (rules.duelResult, API 34): each spell goes on at the total the system says
 * (weakened, its tier there), at its target or turned back on its caster, or comes to nothing; the answer lands out of
 * its caster's turn; what else the system lays on the duellists. Without duelResult, the two checks are compared.
 * Also API 34: rules.delay's `reasons` and `waitFor`, and a notice check's `sense`.
 */
import { describe, expect, test } from "vitest";
import { replay, prepareBattle, beginRun } from "../scripts/engine/simulator.js";
import { delayFor } from "../scripts/engine/behavior/waiting.js";
import { part } from "../scripts/engine/dice.js";
import { genericRules } from "../scripts/adapters/generic/rules.js";
import { STATUS } from "../scripts/constants.js";
import { logLine } from "../scripts/story/log-lines.js";
import { buildStory } from "../scripts/story/story.js";
import { storyTables } from "./foundry-i18n.js";
import { creature, strike, battle } from "./helpers.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";

/** A DCC-like game: one action die, checks meet the DC, a natural 1 fails. */
const base = {
  ...genericRules,
  id: "test-duels",
  degreeOfSuccess(natural, total, dc, kind = "check", die) {
    const faces = die?.faces ?? 20;
    if ( kind === "attack" ) return natural === 1 ? 0 : natural === faces || total >= dc ? 2 : 1;
    if ( natural === 1 ) return 1;
    return total >= dc ? 2 : 1;
  },
  critical: parts => parts,
  turn: () => ({ action: 1, move: 30 }),
  costOf: () => ({ action: 1 }),
  onDropped(c) {
    c.status = STATUS.DEAD;
    return c.status;
  },
  /** The foe's wizard answers the hero's spell once a round, with the same spell. */
  duel(run, caster, action) {
    if ( caster.id !== "hero" ) return null;
    const by = run.byId.get("foe");
    if ( !by || by.status !== STATUS.STANDING || by.answered === run.round ) return null;
    by.answered = run.round;
    return { by, counter: by.spec.actions.find(a => a.casting) };
  }
};

const flat = (n, type = "force") => [part([], n, type)];
/** The same spell for both: what it does at 12, 14 and 20 is easy to tell apart. */
const bolt = id => ({
  id, name: "Bolt", kind: "auto", range: { increment: 150 }, casting: { mod: 40, label: "spell check" }, damage: flat(5), castChance: 1,
  tiers: [{ min: 12, damage: flat(1) }, { min: 14, damage: flat(5) }, { min: 30, damage: flat(9) }]
});
const sturdy = { value: 500, max: 500 };
const traits = { tactical: { base: 70, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 20, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
const duelists = () => battle([
  creature({ id: "hero", name: "Hero", hp: sturdy, initiative: { mod: 100 }, actions: [bolt("hero-bolt")], traits, flags: { fearless: true } }),
  creature({ id: "foe", name: "Foe", side: "hostile", hp: sturdy, initiative: { mod: -100 }, actions: [bolt("foe-bolt")], traits, flags: { fearless: true } })
], { maxRounds: 1 });

/** The hero's first spell, what came of it, and the damage each took in its round. */
function firstDuel(rules, seeds = 20) {
  for ( let s = 1; s <= seeds; s++ ) {
    const r = replay(duelists(), rules, s);
    const at = r.log.findIndex(e => e.type === "duel");
    if ( at < 0 ) continue;
    // (Up to the next spell cast: the foe's own turn.)
    const rest = r.log.slice(at + 1);
    const next = rest.findIndex(e => e.type === "cast");
    return { r, duel: r.log[at], after: next < 0 ? rest : rest.slice(0, next) };
  }
  throw new Error("no duel");
}
const hits = (after, actorId, targetId) => after.filter(e => e.type === "auto" && e.actorId === actorId && e.targetId === targetId);

describe("a duel the system reckons (rules.duelResult)", () => {
  test("without it, the checks are compared as before", () => {
    const { duel } = firstDuel(base);
    expect(duel.spell).toBeUndefined();
    expect(["wins", "both", "loses", "fails"]).toContain(duel.outcome);
  });

  test("the spell undone, the answer lands on the caster it answered", () => {
    const rules = { ...base, duelResult: (run, x) => ({ spell: { total: null }, counter: { total: x.answer }, label: "Overwhelm" }) };
    const { duel, after } = firstDuel(rules);
    expect(duel).toMatchObject({ spell: "undone", answered: "stands", effect: "Overwhelm" });
    expect(hits(after, "foe", "hero").length).toBe(1);
    expect(hits(after, "hero", "foe").length).toBe(0);
  });

  test("a spell weakened goes on at its lower total's tier; the answer comes to nothing", () => {
    const rules = { ...base, duelResult: () => ({ spell: { total: 13 }, counter: { total: null }, label: "Mitigate" }) };
    const { duel, after } = firstDuel(rules);
    expect(duel).toMatchObject({ spell: "weakened", answered: "undone" });
    const mine = hits(after, "hero", "foe");
    expect(mine.length).toBe(1);
    expect(mine[0].damage).toBe(1); // (13: the lowest tier)
    expect(hits(after, "foe", "hero").length).toBe(0);
  });

  test("weakened below its lowest tier, it comes to nothing", () => {
    const rules = { ...base, duelResult: () => ({ spell: { total: 8 }, counter: { total: null } }) };
    const { after } = firstDuel(rules);
    expect(hits(after, "hero", "foe").length).toBe(0);
  });

  test("a spell turned back hits its own caster; an answer turned back hits its own", () => {
    const rules = { ...base, duelResult: (run, x) => ({ spell: { total: x.total, reflect: true }, counter: { total: 14, reflect: true }, label: "Reflect" }) };
    const { duel, after } = firstDuel(rules);
    expect(duel).toMatchObject({ spell: "reflected", answered: "reflected" });
    expect(hits(after, "hero", "hero").length).toBe(1);
    expect(hits(after, "foe", "foe").length).toBe(1);
    expect(hits(after, "foe", "foe")[0].damage).toBe(5); // (14: the middle tier)
  });

  test("what else it lays on the duellists lands, and a collision is told as one", () => {
    const rules = {
      ...base,
      duelResult: (run, x) => ({
        spell: { total: null }, counter: { total: null }, disturbance: true, label: "Time Slows",
        effects: [x.caster, x.by].map(u => ({ unitId: u.id, outcome: { conditions: { incapacitated: 1 }, rounds: 2, label: "Time Slows" } }))
      })
    };
    const { r, duel } = firstDuel(rules);
    expect(duel.disturbance).toBe(true);
    expect(logLine(duel)).toContain("Time Slows");
    const english = storyTables();
    const prose = buildStory(r, duelists(), "roleplay", { tables: { get: k => english[k] }, seed: 1 }).text;
    expect(prose.length).toBeGreaterThan(0);
    // (Neither acts while it lasts: no blow from either after the duel this round.)
    expect(r.log.filter(e => e.type === "auto")).toHaveLength(0);
  });

  test("the log line names what became of each", () => {
    const line = logLine({ type: "duel", actor: "Foe", target: "Hero", action: "Bolt", counter: "Bolt", total: 18, against: 16, outcome: "wins", effect: "Push Through", spell: "weakened", answered: "stands" });
    expect(line).toContain("Push Through");
    expect(line).not.toMatch(/FASTFIGHTING\./);
  });
});

describe("Delay's reasons, the system's own (API 34)", () => {
  const at = (x, y = 0) => ({ x, y, size: 5 });
  const farApart = () => battle([
    creature({ id: "hero", name: "Hero", position: at(0), initiative: { mod: 100 }, hp: sturdy }),
    creature({ id: "brute", name: "Brute", side: "hostile", position: at(60), initiative: { mod: -100 }, hp: sturdy })
  ], { positioning: true, maxRounds: 2 });
  const ready = rules => {
    const run = beginRun(prepareBattle(farApart(), rules), 1, { log: true });
    run.round = 1;
    return run;
  };

  test("none of the core's own where the system names none", () => {
    const run = ready({ ...pf2eRules, delay: { reasons: [] } });
    expect(delayFor(run, run.byId.get("hero"))).toBeNull();
    const all = ready({ ...pf2eRules, delay: {} });
    expect(delayFor(all, all.byId.get("hero"))).toMatchObject({ why: "reach" });
  });

  test("the system's own reason first", () => {
    const run = ready({ ...pf2eRules, delay: { reasons: [], waitFor: (r, u, later) => ({ why: "counter", afterId: later[0].id, forId: later[0].id }) } });
    expect(delayFor(run, run.byId.get("hero"))).toEqual({ why: "counter", afterId: "brute", forId: "brute" });
  });

  test("told as waiting to answer a spell", () => {
    const english = storyTables();
    expect(english["event.delayCounter"]?.length).toBeGreaterThan(0);
  });
});

describe("a notice check names its sense (API 34)", () => {
  test("the rules hear how a bystander would notice: by sight, or by sound", () => {
    for ( const [cue, sense] of [[{ see: true }, "sight"], [{ hearDC: 12 }, "sound"]] ) {
      const heard = [];
      const rules = { ...pf2eRules, modifiers: { ...pf2eRules.modifiers, check: ctx => { if ( ctx.purpose === "notice" ) heard.push(ctx.sense); return { bonus: 0, advantage: 0 }; } } };
      const at = (x, y = 0) => ({ x, y, size: 5 });
      const spec = battle([
        creature({ id: "pc", kind: "pc", diesAtZero: false, position: at(0) }),
        creature({ id: "foe", side: "hostile", position: at(10), flags: { fearless: true } }),
        creature({ id: "guard", side: "hostile", inEncounter: false, position: at(60) })
      ], { positioning: true, maxRounds: 3 });
      spec.awareness = { guard: { pc: cue, foe: cue } };
      replay(spec, rules, 1);
      expect(heard.length).toBeGreaterThan(0);
      expect(new Set(heard)).toEqual(new Set([sense]));
    }
  });
});
