import { describe, expect, test } from "vitest";
import { beginLive, liveRound, liveTurn, snapshotRun, restoreRun, takeRolls, NeedsDecision } from "../scripts/engine/live.js";
import { beginRun, prepareBattle, runBatchSync } from "../scripts/engine/simulator.js";
import { createRng } from "../scripts/engine/rng.js";
import { recordingRng, diceAt, tableRoll } from "../scripts/engine/table-rolls.js";
import { rollCheck } from "../scripts/engine/probability.js";
import { parseFormula, part, sampleDamage } from "../scripts/engine/dice.js";
import { rollAudience, rollJson, rollJsons, rollMessages, rollFlavor, tallyHtml, audiencesFor, AUDIENCE } from "../scripts/foundry/table-rolls.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const minded = (tactical = 60) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 70, fudge: 0 } });

/** A hero and an orc beside it, on a map (and a goblin far off, so the fight goes on). */
function duel(extra = {}) {
  return battle([
    creature({ id: "valeros", name: "Valeros", kind: "pc", diesAtZero: false, position: at(0), hp: { value: 400, max: 400 }, traits: minded(70), ...extra.valeros }),
    creature({ id: "orc", name: "Orc", side: "hostile", position: at(5), hp: { value: 300, max: 300 }, traits: minded(40), flags: { fearless: true },
      actions: [strike({ id: "axe", name: "Greataxe", bonus: 10, damage: [parseFormula("1d12+4", "slashing")] })], desires: [{ kind: "hurt", targetId: "valeros", level: 95 }], ...extra.orc }),
    creature({ id: "goblin", name: "Goblin", side: "hostile", position: at(300), hp: { value: 14, max: 14 }, flags: { fearless: true } })
  ], { positioning: true, maxRounds: 10 });
}

/** The orc's turn, played through its questions as the live side plays it (each answered yes), from a fresh copy each pass. */
function orcTurn(spec, seed, { players = [] } = {}) {
  const run = beginLive(spec, pf2eRules, { seed, players });
  liveRound(run, 1);
  takeRolls(run);
  const kept = snapshotRun(run, { log: false });
  const answers = [];
  let asked = 0;
  for ( let tries = 0; tries < 20; tries++ ) {
    const pass = restoreRun(spec, pf2eRules, kept, { log: run.log });
    const hpBefore = pass.byId.get("valeros").hp;
    try {
      const result = liveTurn(pass, "orc", { answers, nonce: 7 });
      return { run: pass, result, asked, lost: hpBefore - pass.byId.get("valeros").hp };
    } catch ( err ) {
      if ( !(err instanceof NeedsDecision) ) throw err;
      asked += 1;
      answers.push([err.request.key, true]);
    }
  }
  throw new Error("a turn that never stops asking");
}

describe("table rolls: the engine's own dice, recorded where a live battle shows them", () => {
  test("a recording rng rolls exactly the dice a plain one does, every kind of draw", () => {
    const plain = createRng(99);
    const taped = recordingRng(createRng(99));
    const draw = r => [r.die(6), r.d20(), r.next(), r.chance(0.5), r.pick([1, 2, 3]), r.shuffle([1, 2, 3, 4]).join(""), r.die(100)];
    for ( let i = 0; i < 50; i++ ) expect(draw(taped)).toEqual(draw(plain));
    // (Its dice on the tape; the others not dice at all.)
    expect(taped.tray.tape.length).toBe(150);
  });

  test("a table roll claims its own dice once; one inside another claims first; nothing rolled, nothing recorded", () => {
    const run = { rng: recordingRng(createRng(3)) };
    const outer = diceAt(run);
    run.rng.die(100); // (the Statistics Engine's own: claimed by nobody)
    const inner = diceAt(run);
    sampleDamage([parseFormula("2d6+3", "fire")], run.rng);
    const fire = tableRoll(run, inner, { by: "orc", kind: "damage", label: "Fire", parts: [parseFormula("2d6+3", "fire")] });
    expect(fire.dice.length).toBe(2);
    expect(fire.total).toBe(fire.dice[0].result + fire.dice[1].result + 3);
    // (The outer roll finds only the d100 left: it's whatever the caller says it is, so a caller claims only its own.)
    expect(tableRoll(run, outer, { by: "orc", kind: "other" }).dice.map(d => d.faces)).toEqual([100]);
    expect(tableRoll(run, diceAt(run), { by: "orc", kind: "check", total: 12 })).toBe(null);
    // (A plain rng records nothing, anywhere.)
    const plain = { rng: createRng(3) };
    expect(diceAt(plain)).toBe(-1);
    expect(tableRoll(plain, 0, { kind: "check" })).toBe(null);
    expect(takeRolls(plain)).toEqual([]);
  });

  test("a helper's roll the core shows for it, not knowing how its dice add up: each die a roll of its own", () => {
    const run = { rng: recordingRng(createRng(12)) };
    const at = diceAt(run);
    const luck = run.rng.die(20);
    const loss = run.rng.die(3);
    const body = tableRoll(run, at, { by: "hero", kind: "check", what: "body", each: true });
    expect(body.total).toBe(luck);
    expect(body.rolls).toEqual([{ mod: 0, total: luck }, { mod: 0, total: loss }]);
    expect(rollJsons(body).map(j => j.formula)).toEqual(["1d20", "1d3"]);
  });

  test("rollCheck records its roll in a live battle (the engine's dice), never the system's own nor a quiet one", () => {
    const rng = recordingRng(createRng(5));
    const roll = rollCheck(pf2eRules, rng, 7, 18, { kind: "save", roller: { id: "orc" }, label: "Fireball", advantage: 1, dice: [4] });
    rollCheck(pf2eRules, rng, 7, 18, { kind: "check", roller: { id: "orc" }, quiet: true });
    rollCheck(pf2eRules, rng, 7, 18, { kind: "check", roller: { id: "orc" }, rolled: { degree: 2, natural: 12, total: 19 } });
    const [shown, ...more] = rng.tray.rolls;
    expect(more).toEqual([]);
    expect(shown).toMatchObject({ by: "orc", kind: "save", label: "Fireball", mod: 7, dc: 18, total: roll.total, natural: roll.natural, degree: roll.degree });
    // (The Bless die first, then the two d20s, the higher kept.)
    expect(shown.groups.map(g => [g.faces, g.results.length, g.keep])).toEqual([[4, 1, null], [20, 2, "kh"]]);
    expect(Math.max(...shown.groups[1].results)).toBe(roll.natural);
  });

  test("a live turn's final pass records exactly its table rolls: each attack and its damage, as the engine applied them", () => {
    let attacks = 0;
    for ( const seed of [1, 2, 3, 4, 5, 6, 7, 8] ) {
      const { result, lost } = orcTurn(duel(), seed);
      const events = result.events.filter(e => e.actorId === "orc" && e.type === "attack");
      const rolls = result.rolls;
      const swings = rolls.filter(r => r.kind === "attack");
      expect(swings.length).toBe(events.length);
      events.forEach((e, i) => {
        expect(swings[i]).toMatchObject({ by: "orc", target: "valeros", label: "Greataxe", natural: e.natural, total: e.total, dc: e.dc, degree: e.degree });
        expect(swings[i].dice.length).toBe(1);
        expect(swings[i].dice[0].result).toBe(e.natural);
      });
      // (Every blow that landed, its damage roll: what the hero lost, die for die, with no resistances.)
      const damage = rolls.filter(r => r.kind === "damage");
      expect(damage.length).toBe(events.filter(e => e.degree >= 2).length);
      expect(damage.reduce((s, r) => s + r.total, 0)).toBe(lost);
      for ( const r of damage ) {
        expect(r).toMatchObject({ by: "orc", target: "valeros", label: "Greataxe" });
        expect(r.total).toBe(r.groups.reduce((s, g) => s + (g.faces ? g.results.reduce((a, b) => a + b, 0) * (g.mult ?? 1) : g.flat), 0));
      }
      // (Nothing else: no roll the Statistics Engine made for itself.)
      expect(rolls.length).toBe(swings.length + damage.length);
      attacks += events.length;
    }
    expect(attacks).toBeGreaterThan(0);
  });

  test("a pass thrown away (a question asked mid-turn) records nothing: the final pass has its own rolls, once", () => {
    // (A player's Shield Block, asked of its player once the blow has hit: the attack rolled, then the pass thrown away.)
    const block = { id: "block", label: "Shield Block", on: "hit", reduce: part([], 5, "untyped"), physical: true };
    let asked = 0;
    for ( const seed of [1, 2, 3, 4, 5, 6, 7, 8] ) {
      const spec = duel({ valeros: { reactions: [block] } });
      const turn = orcTurn(spec, seed, { players: ["valeros"] });
      asked += turn.asked;
      const swings = turn.result.events.filter(e => e.actorId === "orc" && e.type === "attack");
      expect(turn.result.rolls.filter(r => r.kind === "attack").length).toBe(swings.length);
      // (Nothing left behind on the run either.)
      expect(takeRolls(turn.run)).toEqual([]);
    }
    expect(asked).toBeGreaterThan(0);
  });

  test("simulations, plans and copies record nothing", () => {
    const spec = duel();
    // A simulated fight's rng is a plain one: no tape, no tray.
    const run = beginRun(prepareBattle(spec, pf2eRules), 11);
    expect(run.rng.mark).toBeUndefined();
    expect(takeRolls(run)).toEqual([]);
    // (A batch of them runs as ever.)
    expect(() => runBatchSync(spec, pf2eRules, { runs: 5, seed: 2 })).not.toThrow();
    // A live run kept and restored (a turn's snapshot, a copy for working something out) has no dice until a turn gives it some.
    const live = beginLive(spec, pf2eRules, { seed: 3, players: [] });
    liveRound(live, 1);
    liveTurn(live, "orc");
    const snap = snapshotRun(live, { log: false });
    expect(JSON.stringify(snap)).not.toContain("tape");
    const copy = restoreRun(spec, pf2eRules, snap, { log: live.log });
    expect(copy.rng).toBeUndefined();
    expect(takeRolls(copy)).toEqual([]);
  });
});

describe("table rolls in the chat", () => {
  test("who sees a creature's rolls: a player's character everyone, a GM's creature by the GM's roll mode, one unseen the GMs", () => {
    expect(rollAudience({ playerOwned: true, gmMode: "gm" })).toBe(AUDIENCE.PUBLIC);
    expect(rollAudience({ playerOwned: false, gmMode: "public" })).toBe(AUDIENCE.PUBLIC);
    expect(rollAudience({ playerOwned: false, gmMode: "ic" })).toBe(AUDIENCE.PUBLIC);
    for ( const gmMode of ["gm", "blind", "self"] ) expect(rollAudience({ gmMode })).toBe(AUDIENCE.GM);
    // (Hidden from the players: always the GMs', whatever the roll mode.)
    expect(rollAudience({ tokenHidden: true, gmMode: "public" })).toBe(AUDIENCE.GM);
    expect(rollAudience({ unseen: true, gmMode: "public" })).toBe(AUDIENCE.GM);
    expect(rollAudience({ secret: true, gmMode: "public" })).toBe(AUDIENCE.GM);
    expect(rollAudience({ tokenHidden: true, playerOwned: true })).toBe(AUDIENCE.GM);
    // (Read off a creature's token and what the fight knows of it, the GM's roll mode from the core's setting.)
    const docs = {
      hero: { hidden: false, actor: { hasPlayerOwner: true, getFlag: () => null } },
      orc: { hidden: false, actor: { hasPlayerOwner: false, getFlag: () => null } },
      sneak: { hidden: false, actor: { hasPlayerOwner: false, getFlag: () => null } },
      ghost: { hidden: true, actor: { hasPlayerOwner: false, getFlag: () => null } }
    };
    const units = { hero: {}, orc: { spec: {} }, sneak: { spec: { hidden: true }, revealed: false }, ghost: { spec: {} } };
    const where = { docOf: id => docs[id], unitOf: id => units[id] };
    game.settings = { get: (scope, key) => (scope === "core" && key === "messageMode" ? "gm" : null) };
    expect(Object.fromEntries(audiencesFor([{ by: "hero" }, { by: "orc" }, { by: "sneak" }, { by: "ghost" }], where))).toEqual({ hero: "public", orc: "gm", sneak: "gm", ghost: "gm" });
    game.settings = { get: () => "public" };
    expect(audiencesFor([{ by: "orc" }, { by: "sneak" }], where).get("orc")).toBe("public");
    units.sneak.revealed = true;
    expect(audiencesFor([{ by: "sneak" }], where).get("sneak")).toBe("public");
  });

  test("a roll's Foundry data carries the engine's dice: kept and discarded, signs, multipliers, its modifier and total", () => {
    const rng = recordingRng(createRng(8));
    const run = { rng };
    rollCheck(pf2eRules, rng, 5, 15, { kind: "attack", roller: { id: "orc" }, label: "Greataxe", advantage: -1 });
    const crit = [{ ...parseFormula("1d12+4", "slashing"), dice: [{ n: 1, faces: 12, mult: 2 }], flat: 8 }];
    const at0 = diceAt(run);
    sampleDamage(crit, rng);
    tableRoll(run, at0, { by: "orc", kind: "damage", label: "Greataxe", parts: crit, multiplier: 0.5 });
    const [attack, damage] = rng.tray.rolls;
    const a = rollJson(attack, { flavor: "x" });
    expect(a.terms[0]).toMatchObject({ class: "Die", number: 2, faces: 20, modifiers: ["kl"] });
    expect(a.terms[0].results.filter(r => r.active).map(r => r.result)).toEqual([attack.natural]);
    expect(a.terms[0].results.filter(r => r.discarded).length).toBe(1);
    expect(a.formula).toBe("2d20kl + 5");
    expect(a.total).toBe(attack.total);
    const d = rollJson(damage);
    expect(d.formula).toBe("1d12 * 2 + 8");
    expect(d.total).toBe(damage.dice[0].result * 2 + 8);
    expect(d.evaluated).toBe(true);
    // (Its flavor says what for, the DC for the GMs alone, and a save's share.)
    expect(rollFlavor(attack)).toContain("Greataxe");
    expect(rollFlavor(attack)).toContain("15");
    expect(rollFlavor(attack, { dc: false })).not.toContain("15");
    expect(rollFlavor(damage)).toContain("0.5");
  });

  test("a turn's rolls: one message for each creature and audience, in the order they rolled", () => {
    const rolls = [{ by: "orc", kind: "attack" }, { by: "valeros", kind: "save" }, { by: "orc", kind: "damage" }, { by: "shade", kind: "attack" }];
    const audience = id => (id === "shade" ? AUDIENCE.GM : AUDIENCE.PUBLIC);
    const messages = rollMessages(rolls, audience);
    expect(messages.map(m => [m.by, m.audience, m.rolls.map(r => r.kind)])).toEqual([
      ["orc", "public", ["attack", "damage"]], ["valeros", "public", ["save"]], ["shade", "gm", ["attack"]]
    ]);
  });

  test("a fight played through: its rolls gathered on one card, by round and creature, folded away", () => {
    const rolls = [];
    for ( const seed of [1, 2, 3] ) {
      const { result } = orcTurn(duel(), seed);
      rolls.push(...result.rolls.map(r => ({ ...r })));
    }
    const entries = [
      { turn: "1.a", round: 1, rolls: rolls.slice(0, 2) },
      { turn: "2.a", round: 2, rolls: rolls.slice(2) },
      { turn: "aftermath", round: 2, aftermath: true, rolls: [{ ...rolls[0], by: "valeros" }] }
    ];
    const html = tallyHtml(entries, { orc: "Orc", valeros: "Valeros" });
    const shown = entries.flatMap(e => e.rolls).flatMap(r => rollJsons(r)).length;
    expect(html.match(/class="inline-roll inline-result"/g)?.length).toBe(shown);
    // (Rounds, then the aftermath, each folded; each creature folded inside.)
    expect(html.indexOf("Round 1")).toBeLessThan(html.indexOf("Round 2"));
    expect(html.indexOf("Round 2")).toBeLessThan(html.indexOf("Aftermath"));
    expect(html.match(/<details>/g).length).toBe(3 + 3);
    expect(html).toContain("Orc");
    expect(html).not.toContain(" open");
    // (Each roll's data whole, for Foundry to read back: no "@" for a card's inertHtml to break.)
    const data = [...html.matchAll(/data-roll="([^"]*)"/g)].map(m => JSON.parse(globalThis.unescape(m[1])));
    expect(data[0]).toMatchObject({ class: "Roll", evaluated: true });
    expect(html.match(/data-roll="[^"]*@/)).toBe(null);
  });
});
