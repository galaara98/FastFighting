import { describe, expect, test } from "vitest";
import { replay } from "../scripts/engine/simulator.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { buildStory, storyBeats, SECRET } from "../scripts/story/story.js";
import { logLine } from "../scripts/story/log-lines.js";
import { storyTables } from "./foundry-i18n.js";
import { creature, strike, battle, social } from "./helpers.js";

const english = storyTables();
const tables = { get: k => english[k] };

function fight() {
  const at = (x, y) => ({ x, y, size: 5 });
  const spec = battle([
    creature({ id: "amiri", name: "Amiri", kind: "pc", diesAtZero: false, position: at(0, 0), actions: [strike({ name: "Bastard Sword" })] }),
    creature({ id: "merisiel", name: "Merisiel", kind: "pc", diesAtZero: false, position: at(0, 10),
      actions: [strike({ id: "bow", name: "Shortbow", melee: false, range: { increment: 60, max: 360 }, damage: [parseFormula("1d6", "piercing")] })] }),
    creature({ id: "wolf", name: "Wolf", side: "hostile", position: at(40, 0), actions: [strike({ name: "Jaws", damage: [parseFormula("1d6+2", "piercing")] })] })
  ], { positioning: true });
  spec.approach = null;
  return spec;
}

const words = s => s.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

describe("the story told a turn at a time", () => {
  test("Roleplay: every sentence of the story, once, in order, cut at the turns", () => {
    const spec = fight();
    for ( const seed of [3, 7, 11] ) {
      const result = replay(spec, pf2eRules, seed);
      const beats = storyBeats(result, spec, "roleplay", { tables, seed });
      const story = buildStory(result, spec, "roleplay", { tables, seed });
      // (Every word, once: what everyone reads in the story's order, what only the GMs are told apart.)
      const all = words(story.html).split(" ");
      const open = beats.map(b => b.text).filter(Boolean).join(" ").split(" ");
      const secret = beats.map(b => words(b.gmHtml.replace(/<\/?(strong|em|small|b|i)>/g, ""))).filter(Boolean).join(" ").split(" ").filter(Boolean);
      expect([...open, ...secret].sort()).toEqual([...all].sort());
      let k = 0;
      for ( const w of all ) if ( w === open[k] ) k++;
      expect(k).toBe(open.length);
      // (In the chat, each name in bold.)
      expect(beats.some(b => b.html.includes("<strong>Wolf</strong>"))).toBe(true);
      expect(beats.some(b => /<strong>[^<]*<strong>/.test(b.html))).toBe(false);
      // A beat for each turn, the closing last; a turn's beat is its creature's.
      // (Plain text: an apostrophe is an apostrophe, not &#39;.)
      expect(beats.some(b => /&(amp|lt|gt|quot|#39);/.test(b.text))).toBe(false);
      expect(beats.at(-1).closing).toBe(true);
      expect(beats.filter(b => b.closing)).toHaveLength(1);
      const turns = beats.flatMap(b => b.turns);
      expect(new Set(turns).size).toBe(turns.length);
      for ( const b of beats.filter(b => !b.closing && b.actorId) ) {
        expect(result.log.filter(e => b.turns.includes(e.turn)).every(e => e.turnOf === b.actorId)).toBe(true);
      }
    }
  });

  test("every move in the fight belongs to one beat", () => {
    const spec = fight();
    const result = replay(spec, pf2eRules, 7);
    const beats = storyBeats(result, spec, "roleplay", { tables, seed: 7 });
    const moves = result.log.filter(e => e.type === "move");
    expect(moves.length).toBeGreaterThan(0);
    for ( const m of moves ) expect(beats.filter(b => b.turns.includes(m.turn))).toHaveLength(1);
  });

  test("Standard: what each did on the turn, and the whole tally at the close", () => {
    const spec = fight();
    const result = replay(spec, pf2eRules, 7);
    const beats = storyBeats(result, spec, "standard", { tables, seed: 7 });
    const told = beats.filter(b => !b.closing && b.html);
    expect(told.length).toBeGreaterThan(1);
    for ( const b of told ) {
      const name = spec.combatants.find(c => c.id === b.actorId)?.name;
      if ( name ) expect(b.html).toContain(name);
    }
    expect(beats.at(-1).html).toBe(buildStory(result, spec, "standard").html);
  });

  test("what the players shouldn't learn (who takes the lead, a creature's thoughts) is the GMs' alone, apart", () => {
    // (A fight's log with a leader taken and a thought, beside a blow everyone sees.)
    const spec = fight();
    const result = replay(spec, pf2eRules, 1);
    const blow = result.log.find(e => e.type === "attack");
    const at = { turn: blow.turn, round: blow.round, turnOf: blow.turnOf };
    const command = { ...at, type: "command", actorId: blow.actorId, actor: blow.actor, target: "", targetId: null };
    const scheme = { ...at, type: "scheme", actorId: blow.actorId, actor: blow.actor, target: blow.target, targetId: blow.targetId };
    const log = [...result.log];
    log.splice(log.indexOf(blow) + 1, 0, command, scheme);
    for ( const style of ["roleplay", "standard"] ) {
      const beats = storyBeats({ ...result, log }, spec, style, { tables, seed: 1 });
      const beat = beats.find(b => b.turns.includes(blow.turn));
      expect(beat.gmHtml).toContain(blow.actor);
      expect(beat.html).not.toBe("");
      // (Nothing secret in what everyone reads, in any turn.)
      for ( const b of beats ) expect(b.html.includes(logLine(command)) || b.html.includes(logLine(scheme))).toBe(false);
    }
    expect([...SECRET]).toEqual(expect.arrayContaining(["command", "thought", "scheme"]));
  });
});

describe("doing it again", () => {
  test("the same blow at the same foe, to the same end, is told as again, not as if it were the first", () => {
    const fill = (line, e) => line.replace("{actor}", e.actor).replace("{target}", e.target).replace("{weapon}", e.action);
    let agains = 0;
    for ( let seed = 1; seed <= 30; seed++ ) {
      const spec = fight();
      const result = replay(spec, pf2eRules, seed);
      const text = buildStory(result, spec, "roleplay", { tables, seed }).text;
      // Each attack that repeats an earlier one in its turn, to the same end.
      const seen = new Map();
      for ( const e of result.log ) {
        if ( e.type !== "attack" || (e.degree !== 1 && e.degree !== 2) ) continue;
        const key = `${e.turn}|${e.actorId}|${e.action}|${e.targetId}`;
        if ( seen.get(key) === e.degree ) {
          const lines = english[e.degree === 2 ? "event.againHit" : "event.againMiss"].map(l => fill(l, e));
          if ( lines.some(l => text.includes(l.charAt(0).toUpperCase() + l.slice(1))) ) agains += 1;
        }
        seen.set(key, e.degree);
      }
    }
    expect(agains).toBeGreaterThan(0);
  });
});

describe("telling it well", () => {
  test("a creature known by what it is is always called as the language puts it (the Wolf)", () => {
    const spec = fight();
    spec.combatants.find(c => c.id === "wolf").generic = true;
    const called = game.i18n.format("FASTFIGHTING.Story.TheName", { name: "Wolf" });
    const forms = [called, called.charAt(0).toUpperCase() + called.slice(1)];
    let times = 0;
    for ( const seed of [3, 7, 11] ) {
      let text = buildStory(replay(spec, pf2eRules, seed), spec, "roleplay", { tables, seed }).text;
      for ( const f of forms ) {
        times += text.split(f).length - 1;
        text = text.split(f).join("");
      }
      // (Every mention of it is the way it's called.)
      expect(text).not.toContain("Wolf");
    }
    expect(times).toBeGreaterThan(0);
  });

  test("no line from a table twice in a row", () => {
    const spec = fight();
    for ( let seed = 1; seed <= 20; seed++ ) {
      const sentences = buildStory(replay(spec, pf2eRules, seed), spec, "roleplay", { tables, seed }).text.split(/(?<=[.!?])\s+/);
      sentences.forEach((x, i) => { if ( i ) expect(x).not.toBe(sentences[i - 1]); });
    }
  });
});

describe("magic shows over the blow that carries it", () => {
  test("a sword that also deals void damage is told by the void (it withers), never as a cut", () => {
    const spec = fight();
    const amiri = spec.combatants.find(c => c.id === "amiri");
    amiri.actions[0].damage = [parseFormula("1d8", "slashing"), parseFormula("1d6", "void")];
    const filled = key => Object.entries(english).filter(([k]) => k.startsWith(key))
      .flatMap(([, lines]) => lines.map(l => l.replace("{actor}", "Amiri").replace("{target}", "Wolf").replace("{weapon}", "Bastard Sword")));
    const voidLines = filled("action.void.");
    const cutLines = filled("action.slashing.");
    let told = 0;
    for ( let seed = 1; seed <= 12; seed++ ) {
      const result = replay(spec, pf2eRules, seed);
      expect(result.log.filter(e => e.type === "attack" && e.actorId === "amiri").every(e => e.damageTypes.includes("void"))).toBe(true);
      const text = buildStory(result, spec, "roleplay", { tables, seed }).text.toLowerCase();
      told += voidLines.filter(l => text.includes(l.toLowerCase())).length;
      expect(cutLines.filter(l => text.includes(l.toLowerCase()))).toEqual([]);
    }
    expect(told).toBeGreaterThan(0);
  });
});

describe("precision damage", () => {
  test("a hit with precision damage (a sneak attack's) is followed by how surprising, shocking or subtle it was", () => {
    const spec = fight();
    const amiri = spec.combatants.find(c => c.id === "amiri");
    amiri.actions[0].damage = [parseFormula("1d8", "slashing"), { ...parseFormula("1d6", "slashing"), category: "precision" }];
    const lines = english["emphasis.precision"].map(l => l.replace("{target}", "Wolf").replace("{actor}", "Amiri").replace("{weapon}", "Bastard Sword").toLowerCase());
    let hits = 0;
    let told = 0;
    for ( let seed = 1; seed <= 12; seed++ ) {
      const result = replay(spec, pf2eRules, seed);
      const landed = result.log.filter(e => e.type === "attack" && e.actorId === "amiri" && e.damage > 0);
      expect(landed.every(e => e.precision)).toBe(true);
      hits += landed.length;
      const text = buildStory(result, spec, "roleplay", { tables, seed }).text.toLowerCase();
      told += lines.filter(l => text.includes(l)).length;
    }
    expect(hits).toBeGreaterThan(0);
    expect(told).toBeGreaterThan(0);
  });
});

describe("the review's fixes", () => {
  test("a death from harm that lingers (venom, a burn) isn't told as being finished off", () => {
    const spec = fight();
    const death = { round: 1, turn: 1, turnOf: "amiri", type: "death", actor: "Amiri", actorId: "amiri", by: "Wolf", byId: "wolf", finished: true, lingering: true };
    const finished = english["event.finished"].map(l => l.replace("{by}", "Wolf").replace("{actor}", "Amiri"));
    for ( let seed = 1; seed <= 10; seed++ ) {
      const text = buildStory({ log: [death], units: {}, rounds: 1 }, spec, "roleplay", { tables, seed }).text;
      expect(finished.some(l => text.includes(l))).toBe(false);
    }
  });

  test("protecting a friend names the friend", () => {
    const spec = fight();
    const log = [
      { round: 1, turn: 1, turnOf: "wolf", type: "attack", actor: "Wolf", actorId: "wolf", target: "Merisiel", targetId: "merisiel", degree: 2, margin: 3, damage: 3, damageType: "piercing" },
      { round: 1, turn: 2, turnOf: "amiri", type: "attack", actor: "Amiri", actorId: "amiri", target: "Wolf", targetId: "wolf", degree: 2, margin: 3, damage: 3, damageType: "slashing" }
    ];
    const protector = [...english["relationship.protector.success"], ...english["relationship.protector.failure"]];
    expect(protector.every(l => l.includes("{ally}"))).toBe(true);
    for ( let seed = 1; seed <= 20; seed++ ) {
      const text = buildStory({ log, units: {}, rounds: 1 }, spec, "roleplay", { tables, seed }).text;
      expect(text).not.toContain("{ally}");
      const told = protector.map(l => l.trim().replace("{ally}", "Merisiel").replace("{actor}", "Amiri").replace("{target}", "Wolf"));
      if ( told.some(l => text.includes(l.charAt(0).toUpperCase() + l.slice(1))) ) return;
    }
    throw new Error("no protector aside told in 20 seeds");
  });

  test("a creature that moved this turn gets no line on how far it is", () => {
    const spec = fight();
    for ( let seed = 1; seed <= 20; seed++ ) {
      const result = replay(spec, pf2eRules, seed);
      for ( const b of storyBeats(result, spec, "roleplay", { tables, seed }) ) {
        const moved = result.log.some(e => b.turns.includes(e.turn) && e.type === "move" && e.actorId === b.actorId);
        if ( !moved || !b.actorId ) continue;
        const who = spec.combatants.find(c => c.id === b.actorId).name;
        const distance = [...english["distance.near"], ...english["distance.far"]].map(l => l.replace("{actor}", who).split("{target}")[0]).filter(s => s.length > 12);
        for ( const d of distance ) expect(b.text.includes(d.charAt(0).toUpperCase() + d.slice(1))).toBe(false);
      }
    }
  });
});

describe("maneuvers and conditions from the master list", () => {
  // A trip: an attack-style check; prone on a success (and longer on a critical).
  const trip = { id: "amiri.trip", name: "Trip", kind: "control", cost: 1, bonus: 6, maps: [0, -5, -10], melee: true, reach: 5,
    onHit: [null, null, { conditions: { prone: 1 }, rounds: 1, label: "prone" }, { conditions: { prone: 1 }, rounds: 2, label: "prone" }] };

  test("a trip that lands is told as the trip, then the one tripped hitting the ground; one that fails never says they fell", () => {
    const fill = (l, actor, target) => l.replace("{actor}", actor).replace("{target}", target).toLowerCase();
    const tripLines = english["maneuver.trip"].map(l => fill(l, "Amiri", "Wolf"));
    const proneLines = english["condition.prone"].map(l => fill(l, "Wolf", "Amiri"));
    let landed = 0;
    for ( let seed = 1; seed <= 30; seed++ ) {
      const spec = fight();
      const amiri = spec.combatants.find(c => c.id === "amiri");
      amiri.actions = [trip];
      const result = replay(spec, pf2eRules, seed);
      const tries = result.log.filter(e => e.type === "control" && e.actorId === "amiri");
      if ( !tries.length ) continue;
      expect(tries.every(e => e.maneuver === "trip")).toBe(true);
      const text = buildStory(result, spec, "roleplay", { tables, seed }).text.toLowerCase();
      if ( tries.some(e => e.took) ) {
        landed += 1;
        expect(tripLines.some(l => text.includes(l))).toBe(true);
        expect(proneLines.some(l => text.includes(l))).toBe(true);
      } else expect(proneLines.some(l => text.includes(l))).toBe(false);
    }
    expect(landed).toBeGreaterThan(0);
  });
});

describe("what luck did", () => {
  test("a miss a system's luck check made is told with why; a spell lost as it's cast fizzles", () => {
    const spec = fight();
    const result = replay(spec, pf2eRules, 3);
    const miss = result.log.find(e => e.type === "attack" && e.degree < 2) ?? result.log.find(e => e.type === "attack");
    const log = result.log.map(e => (e === miss ? { ...e, degree: 1, margin: -2, damage: 0, luck: "concealed" } : e));
    log.splice(log.indexOf(log.find(e => e.turn === miss.turn && e.type === "attack")) + 1, 0, { turn: miss.turn, round: miss.round, turnOf: miss.turnOf, type: "disrupted", actorId: miss.actorId, actor: miss.actor, action: "Fireball", text: "" });
    const html = buildStory({ ...result, log }, spec, "roleplay", { tables, seed: 3 }).html;
    const said = lines => lines.some(l => html.includes(l.replace("{actor}", miss.actor).replace("{target}", miss.target).replace("{weapon}", "Fireball").split("{")[0]));
    expect(said(english["luck.concealed"])).toBe(true);
    expect(said(english["event.spellFizzles"])).toBe(true);
  });
});
