/**
 * Patrolling (behavior/patrol.js): a creature in the fight that knows of no foe looks for one rather than standing
 * idle; who patrols how, the cues it follows (a scent, the din of a fight it hears, a foe its friends see), the Seek it
 * makes (a check against the Stealth DC of those hidden from it in the area it searches, walls blocking), holding back,
 * fidgeting, and a Seek in a live battle asked of the system.
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, playTurn, prepareBattle, replay } from "../scripts/engine/simulator.js";
import { turnFor } from "../scripts/engine/battle-state.js";
import { applyOutcome } from "../scripts/engine/behavior/effects.js";
import { hiddenFrom, hearDC, HEAR } from "../scripts/engine/behavior/senses.js";
import { patrolMode, knowsAFoe, seek, stealthDC, fidgetChance } from "../scripts/engine/behavior/patrol.js";
import { patrolStyle, PLAYSTYLES, PATROL_STYLES, combinePlaystyles } from "../scripts/engine/playstyles.js";
import { beginLive, liveRound, liveTurn, NeedsDecision, networkOf } from "../scripts/engine/live.js";
import { logLine } from "../scripts/story/log-lines.js";
import { buildStory } from "../scripts/story/story.js";
import { storyTables, text as words } from "./foundry-i18n.js";
import { parseFormula } from "../scripts/engine/dice.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const english = storyTables();
const tables = { get: k => english[k] };
const at = (x, y = 0) => ({ x, y, size: 5 });
const wall = (ax, ay, bx, by) => ({ a: [ax, ay], b: [bx, by], s: 20, d: 0, door: null, open: false });
/** A creature that can't hit anything: the fights go on as long as the test needs. */
const harmless = (id, over = {}) => creature({ id, name: id, hp: { value: 300, max: 300 }, flags: { fearless: true }, actions: [strike({ id: `${id}.blow`, bonus: -40 })], ...over });
const hyena = (id, x, side) => creature({
  id, name: id, side, animalistic: true, position: at(x, 80), speeds: { walk: 35 }, senses: { smell: 30 }, perception: 7, hp: { value: 40, max: 40 },
  flags: { fearless: true }, actions: [strike({ id: `${id}.jaws`, name: "Jaws", bonus: 7, damage: [parseFormula("1d6+2", "piercing")] })]
});
const THREE_SIDES = {
  friendly: { label: "Party", enemies: ["hostile", "beasts"] }, hostile: { label: "Kobolds", enemies: ["friendly", "beasts"] }, beasts: { label: "Hyenas", enemies: ["friendly", "hostile"] }
};

/**
 * The live test's case: three hyenas in a room of their own, a wall between them and a fight they can hear (a gap far to
 * the east, the way round), out of their smell and their hearing's 60 feet.
 */
function hyenas({ side = "beasts" } = {}) {
  const spec = battle([
    harmless("fighter", { kind: "pc", diesAtZero: false, position: at(0, -30) }),
    harmless("kobold", { side: "hostile", position: at(0, -40) }),
    hyena("hyena1", -10, side), hyena("hyena2", 0, side), hyena("hyena3", 10, side)
  ], { positioning: true, maxRounds: 8 }, side === "beasts" ? THREE_SIDES : null);
  spec.walls = [wall(-300, 20, 120, 20), wall(140, 20, 300, 20)];
  return spec;
}

/** A fight played round by round to `rounds`, its run kept: whatever the test asks of it after each round. */
function play(spec, seed, rounds, after = () => {}, rules = pf2eRules) {
  const run = beginRun(prepareBattle(spec, rules), seed, { log: true });
  for ( let round = 1; round <= rounds; round++ ) {
    beginRound(run, round);
    for ( const u of run.order ) if ( playTurn(run, u) ) return run;
    after(run, round);
  }
  return run;
}

const HYENAS = ["hyena1", "hyena2", "hyena3"];

describe("the hyenas: walled off from every foe, a fight to be heard", () => {
  test("they head for the noise (or what their friends see), never idle, and nearly always find a foe within a few rounds", () => {
    let hyenasSeen = 0;
    let soon = 0;
    for ( const side of ["beasts", "hostile"] ) {
      for ( let seed = 1; seed <= 6; seed++ ) {
        const found = new Map();
        const run = play(hyenas({ side }), seed, 5, (r, round) => {
          for ( const id of HYENAS ) if ( !found.has(id) && knowsAFoe(r, r.byId.get(id)) ) found.set(id, round);
        });
        // (Before it knew of a foe, never idle: a patrol each turn.)
        for ( const id of HYENAS ) {
          const until = found.get(id) ?? Infinity;
          const mine = run.log.filter(e => e.actorId === id && e.turnOf === id);
          expect(mine.filter(e => e.type === "lazy" && e.round < until)).toEqual([]);
          expect(mine.some(e => e.type === "patrol" && e.round <= until)).toBe(true);
          hyenasSeen += 1;
          if ( until <= 4 ) soon += 1;
        }
        // (Toward a cue: the din of the fight, or the foe its friends have in view, or its pack's.)
        const cues = run.log.filter(e => e.type === "patrol" && HYENAS.includes(e.actorId)).map(e => e.how);
        expect(cues.some(h => ["noise", "seen", "pack", "scent"].includes(h))).toBe(true);
        // (Its moves toward a cue, closer to it each time.)
        const moves = run.log.filter(e => e.type === "move" && e.patrol && HYENAS.includes(e.actorId));
        expect(moves.length).toBeGreaterThan(0);
        for ( const m of moves.filter(x => x.towardId) ) {
          const t = run.byId.get(m.towardId).pos;
          expect(Math.hypot(m.to.x - t.x, m.to.y - t.y)).toBeLessThan(Math.hypot(m.from.x - t.x, m.from.y - t.y) + 0.5);
        }
      }
    }
    // (Hearing the fight through the wall is a quiet check each turn: now and then one misses it for a while and wanders
    // off, about one in nine when they're a side of their own, over thousands of fights.)
    expect(soon).toBeGreaterThanOrEqual(hyenasSeen * 5 / 6);
  });

  test("on their own side, only what they hear leads them: the din of the fight through the wall, a quiet check", () => {
    let heard = 0;
    for ( let seed = 1; seed <= 6; seed++ ) {
      const r = replay(hyenas(), pf2eRules, seed);
      heard += r.log.filter(e => e.type === "patrol" && e.how === "noise").length;
      // (The check to hear it is the Statistics Engine's own: no table roll comes of it.)
      for ( const e of r.log.filter(x => x.type === "patrol" && x.how === "noise") ) expect(["fighter", "kobold"]).toContain(e.towardId);
    }
    expect(heard).toBeGreaterThan(0);
  });

  test("the din: the notice system's DC, harder with distance and through each wall that stops sound", () => {
    const run = beginRun(prepareBattle(hyenas(), pf2eRules), 1, { log: true });
    const h = run.byId.get("hyena2");
    const f = run.byId.get("fighter");
    const feet = 110;
    expect(hearDC(run, h, f)).toBe(Math.round(HEAR.baseDC + feet / HEAR.perFeet + HEAR.perWall));
    run.prep.spec.walls = [];
    run.prep.sightWalls = null;
    expect(hearDC(run, h, f)).toBe(Math.round(HEAR.baseDC + feet / HEAR.perFeet));
    h.conds.deafened = 1;
    expect(hearDC(run, h, f)).toBeNull();
  });
});

describe("who patrols, and how: its pills, then its nature, then its tactics", () => {
  test("every playstyle's patrol is one the engine knows (or none); the table's picks", () => {
    for ( const p of Object.values(PLAYSTYLES) ) if ( p.patrol !== undefined ) expect(PATROL_STYLES).toContain(p.patrol);
    expect(patrolStyle(["medic"])).toBe("near");
    expect(patrolStyle(["tank"])).toBe("spread");
    expect(patrolStyle(["lazy"])).toBe("hold");
    expect(patrolStyle(["chicken"])).toBe("hide");
    expect(patrolStyle(["wallflower"])).toBe("hide");
    expect(patrolStyle(["dps"])).toBeNull();
    // (Each pill a vote as heavy as its place: a Medic first, a Brawler second, keeps near.)
    expect(patrolStyle(["medic", "brawler"])).toBe("near");
    expect(patrolStyle(["brawler", "medic"])).toBe("spread");
  });

  test("an animal roams; anyone else watches; a hunter spreads out; holding its ground, it holds", () => {
    const run = beginRun(prepareBattle(battle([
      creature({ id: "beast", animalistic: true }), creature({ id: "guard", side: "hostile" }), creature({ id: "medic", playstyles: ["medic"] }),
      creature({ id: "hunter", tactics: { beyond: "hunt" } }), creature({ id: "stayer", playstyles: ["tank"], tactics: { beyond: "stay" } }),
      creature({ id: "hider", playstyles: ["chicken"], tactics: { beyond: "stay" } })
    ]), pf2eRules), 1);
    const mode = id => patrolMode(run, run.byId.get(id));
    expect(mode("beast")).toBe("roam");
    expect(mode("guard")).toBe("watch");
    expect(mode("medic")).toBe("near");
    expect(mode("hunter")).toBe("spread");
    expect(mode("stayer")).toBe("hold");
    expect(mode("hider")).toBe("hide");
  });
});

/** A guard and its teammate in a hall, a foe far off behind a wall it knows nothing of. */
function guarded(over = {}, mate = {}) {
  const spec = battle([
    harmless("guard", { side: "hostile", position: at(0, 0), perception: 6, ...over }),
    harmless("mate", { side: "hostile", position: at(5, 0), ...mate }),
    harmless("foe", { kind: "pc", diesAtZero: false, position: at(0, 200) })
  ], { positioning: true, maxRounds: 3 });
  spec.walls = [wall(-300, 100, 300, 100)];
  return spec;
}

describe("a patroller: out from its teammates, searching as it goes", () => {
  test("a guard spreads to 20 to 30 feet from its teammate, and Seeks: from a fresh spot Seek, Stride, Seek", () => {
    for ( let seed = 1; seed <= 4; seed++ ) {
      const run = play(guarded({ playstyles: ["tank"] }, { tactics: { beyond: "stay" } }), seed, 1);
      const g = run.byId.get("guard");
      const m = run.byId.get("mate");
      const d = Math.hypot(g.pos.x - m.pos.x, g.pos.y - m.pos.y);
      expect(d).toBeGreaterThanOrEqual(19.5);
      expect(d).toBeLessThanOrEqual(30.5);
      const mine = run.log.filter(e => e.actorId === "guard" && e.turnOf === "guard" && e.type !== "thought").map(e => e.type);
      expect(mine).toEqual(["patrol", "seek", "move", "seek"]);
      expect(run.log.find(e => e.actorId === "guard" && e.type === "patrol").how).toBe("spread");
    }
  });

  test("a Medic keeps near its teammates: it stays, and searches from there", () => {
    const run = play(guarded({ playstyles: ["medic"] }), 1, 2);
    const g = run.byId.get("guard");
    expect(g.pos).toEqual({ x: 0, y: 0 });
    expect(run.log.filter(e => e.actorId === "guard" && e.type === "patrol").map(e => e.how)).toEqual(["near", "near"]);
    expect(run.log.some(e => e.actorId === "guard" && e.type === "seek")).toBe(true);
  });
});

describe("Seek: what it finds, and what it doesn't", () => {
  /** A seeker in the open, a hidden foe beside it, another behind a wall as near. */
  function seeking(perception) {
    const spec = battle([
      harmless("seeker", { side: "hostile", position: at(0, 0), perception }),
      harmless("open", { kind: "pc", diesAtZero: false, position: at(10, 0), initiative: { mod: 0, stealth: 5 } }),
      harmless("walled", { kind: "pc", diesAtZero: false, position: at(0, 15), initiative: { mod: 0, stealth: 5 } })
    ], { positioning: true });
    spec.walls = [wall(-50, 7.5, 50, 7.5)];
    const run = beginRun(prepareBattle(spec, pf2eRules), 3, { log: true });
    for ( const id of ["open", "walled"] ) applyOutcome(run.byId.get(id), { conditions: { hidden: 1 }, rounds: 3 }, id, { id: "hide" });
    const u = run.byId.get("seeker");
    return { run, u, by: id => run.byId.get(id) };
  }

  test("a success reveals a hidden foe in its area: known to it, hidden from it no more (only from it); not through a wall", () => {
    const { run, u, by } = seeking(60);
    expect(hiddenFrom(u, by("open"))).toBe(true);
    const found = seek(run, u, turnFor(run, u), { say: (x, data) => run.log.push({ actorId: x.id, actor: x.spec.name, ...data }) });
    expect(found.map(o => o.id)).toEqual(["open"]);
    expect(hiddenFrom(u, by("open"))).toBe(false);
    expect(hiddenFrom(by("walled"), by("open"))).toBe(true); // (still hidden from anyone else)
    expect(hiddenFrom(u, by("walled"))).toBe(true);
    expect(u.seenFoes.has("open")).toBe(true);
    const e = run.log.at(-1);
    expect(e).toMatchObject({ type: "seek", dc: stealthDC(run, u, by("open")), foundIds: ["open"], shape: "emanation", feet: 15 });
    expect(logLine(e)).toContain(words("FASTFIGHTING.Log.SeekFound", { names: "open" }));
  });

  test("a failure finds nothing; hiding again undoes what a Seek found", () => {
    const missed = seeking(-60);
    expect(seek(missed.run, missed.u, turnFor(missed.run, missed.u))).toEqual([]);
    expect(hiddenFrom(missed.u, missed.by("open"))).toBe(true);
    const { run, u, by } = seeking(60);
    seek(run, u, turnFor(run, u));
    applyOutcome(by("open"), { conditions: { hidden: 1 }, rounds: 3 }, "open", { id: "hide" });
    expect(hiddenFrom(u, by("open"))).toBe(true);
  });

  test("a system with no Seek: none, it moves and watches", () => {
    const { run, u } = seeking(60);
    run.prep.rules = { ...pf2eRules, seek: false };
    expect(seek(run, u, turnFor(run, u))).toBeNull();
  });
});

describe("holding back", () => {
  test("a Lazy one sometimes still just doesn't", () => {
    let slacked = 0;
    for ( let seed = 1; seed <= 20; seed++ ) {
      const lazy = combinePlaystyles(["lazy"]);
      const run = play(guarded({ playstyles: ["lazy"], behavior: lazy.behavior }), seed, 3);
      slacked += run.log.filter(e => e.actorId === "guard" && e.type === "lazy" && e.chose).length;
      expect(run.byId.get("guard").pos).toEqual({ x: 0, y: 0 }); // (holds back: never off on patrol)
    }
    expect(slacked).toBeGreaterThan(0);
  });

  test("a Wallflower or a Chicken doesn't wander off: it stays out of sight where it is", () => {
    for ( const pill of ["wallflower", "chicken"] ) {
      const run = play(guarded({ playstyles: [pill] }), 2, 3);
      expect(run.byId.get("guard").pos).toEqual({ x: 0, y: 0 });
      expect(run.log.filter(e => e.actorId === "guard" && e.type === "patrol").every(e => e.how === "hide")).toBe(true);
      expect(run.log.some(e => e.actorId === "guard" && e.type === "move")).toBe(false);
    }
  });

  test("\"Stay with the fight\": it Seeks without moving, even toward the din of a fight", () => {
    const spec = hyenas();
    for ( const c of spec.combatants ) if ( c.id.startsWith("hyena") ) c.tactics = { beyond: "stay" };
    const run = play(spec, 1, 3);
    for ( const id of HYENAS ) {
      const start = spec.combatants.find(c => c.id === id).position;
      expect(run.byId.get(id).pos).toEqual({ x: start.x, y: start.y });
      expect(run.log.filter(e => e.actorId === id && e.type === "patrol").every(e => e.how === "hold")).toBe(true);
      expect(run.log.some(e => e.actorId === id && e.type === "seek")).toBe(true);
    }
  });
});

describe("fidgeting: now and then, an idle creature", () => {
  test("as the world's ADHD and its own say; never in place of anything it does", () => {
    const run = beginRun(prepareBattle(guarded({ adhd: 100 }), pf2eRules), 1);
    expect(fidgetChance(run, run.byId.get("guard"))).toBe(Math.min(1, 0.2 * 1.5));
    expect(fidgetChance(run, run.byId.get("mate"))).toBeCloseTo(0.1);
    // (Nothing to do at all, its system with no Seek and its pills holding it where it is: now and then it fidgets.)
    const idle = { ...pf2eRules, seek: false };
    let fidgets = 0;
    for ( let seed = 1; seed <= 10; seed++ ) {
      const spec = guarded({ playstyles: ["lazy"], adhd: 100 });
      spec.options.adhd = 100;
      const r = play(spec, seed, 3, () => {}, idle);
      const mine = r.log.filter(e => e.actorId === "guard" && e.type === "fidget");
      fidgets += mine.length;
      // (A turn it fidgets in is one it did nothing else in.)
      for ( const f of mine ) expect(r.log.filter(e => e.turn === f.turn && e.actorId === "guard" && !["thought", "fidget", "patrol", "move", "lazy"].includes(e.type))).toEqual([]);
    }
    expect(fidgets).toBeGreaterThan(0);
    // (Busy fighting: never.)
    for ( let seed = 1; seed <= 6; seed++ ) {
      const spec = battle([creature({ id: "a", adhd: 100 }), creature({ id: "b", side: "hostile", adhd: 100 })], { adhd: 100, maxRounds: 3 });
      expect(replay(spec, pf2eRules, seed).log.filter(e => e.type === "fidget")).toEqual([]);
    }
  });
});

describe("told: the story, and the Statistician's log", () => {
  test("a patrol, its search and its moves, in words", () => {
    const spec = hyenas();
    const r = replay(spec, pf2eRules, 2);
    const patrol = r.log.find(e => e.type === "patrol");
    expect(logLine(patrol)).not.toMatch(/FASTFIGHTING|\{/);
    const search = r.log.find(e => e.type === "seek");
    expect(logLine(search)).not.toMatch(/FASTFIGHTING|\{/);
    const text = buildStory(r, spec, "roleplay", { tables, seed: 2 }).text;
    const told = key => english[key].some(l => text.toLowerCase().includes(l.replace("{actor}", patrol.actor).replace("{target}", patrol.toward ?? "").split(" ").slice(0, 3).join(" ").toLowerCase()));
    expect(told(`patrol.${patrol.how}`)).toBe(true);
    expect(text).not.toMatch(/patrol\.|seek\./);
  });
});

describe("in a live battle", () => {
  test("a Seek in a turn FastFighting plays is the system's check to roll: purpose seek, its Perception against the DC", () => {
    const spec = guarded({ playstyles: ["tank"] });
    const run = beginLive(spec, pf2eRules, { seed: 5, systemRolls: ["check"] });
    liveRound(run, 1);
    let asked = null;
    try {
      liveTurn(run, "guard");
    } catch ( err ) {
      if ( !(err instanceof NeedsDecision) ) throw err;
      asked = err.request;
    }
    expect(asked).toMatchObject({ roll: "check", kind: "check", unitId: "guard", purpose: "seek", skill: "perception" });
    expect(Number.isFinite(asked.dc)).toBe(true);
  });
});

describe("the Battle Vantage", () => {
  test("one that patrolled on its last turn, still knowing of no foe: patrolling (it walked) or searching (it stood)", () => {
    const run = play(guarded({ playstyles: ["tank"] }, { tactics: { beyond: "stay" } }), 1, 1);
    const marks = networkOf(run).marks.filter(m => m.type === "status");
    expect(marks.find(m => m.on === "guard")?.key).toBe("patrolling");
    expect(marks.find(m => m.on === "mate")?.key).toBe("searching");
    run.byId.get("guard").seenFoes = new Set(["foe"]);
    expect(networkOf(run).marks.some(m => m.on === "guard" && m.type === "status")).toBe(false);
  });
});
