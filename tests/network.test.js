/**
 * The Battle Interface's map of minds, in the engine's terms (live.js networkOf): every desire, condition, goal and
 * way toward others as a line (or, on the creature itself, a symbol), each with an intensity and its most; a player's
 * character FastFighting isn't playing shows no desires.
 */
import { describe, expect, test } from "vitest";
import { beginLive, liveRound, networkOf, setCondition, clearRelation, setAttitude, applyFact } from "../scripts/engine/live.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle, social } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });

function scene({ players = [] } = {}) {
  const hero = creature({ id: "hero", kind: "pc", position: at(0), desires: [{ kind: "hurt", targetId: "foe", level: 60 }] });
  const foe = creature({ id: "foe", side: "hostile", position: at(40), actions: [strike({ bonus: -50 })] });
  const guard = creature({ id: "guard", side: "hostile", inEncounter: false, position: at(90) });
  const spec = battle([hero, foe, guard], { positioning: true, maxRounds: 3, aftermath: "none" });
  spec.doors = { d1: { x: 20, y: 0 } };
  spec.approach = { hero: { foe: { dist: 35, mult: 1, speed: 25, mode: "walk", los: true, meleeOk: true, doors: ["d1"] } } };
  const run = beginLive(spec, pf2eRules, { seed: 3, players });
  liveRound(run, 1);
  for ( const id of ["hero", "foe"] ) run.byId.get(id).active = true;
  return run;
}
const linksOf = (net, type, from) => net.links.filter(l => l.type === type && (!from || l.from === from));

describe("the map of minds", () => {
  test("a desire is a line from who wants to whom, its band its intensity (1 to 5); a door it wants through, a thing", () => {
    const net = networkOf(scene());
    expect(linksOf(net, "desire", "hero").find(l => l.to === "foe")).toMatchObject({ kind: "hurt", level: 60, intensity: 4, most: 5, gm: false });
    expect(net.things).toEqual([expect.objectContaining({ id: "d1", type: "door", x: 20, y: 0 })]);
    expect(linksOf(net, "goal", "hero")[0]).toMatchObject({ kind: "openDoor", to: "d1", via: "foe", played: true });
  });

  test("a player's character FastFighting isn't playing: no desires or goals, but what's on it", () => {
    const run = scene({ players: ["hero"] });
    setCondition(run, "hero", { key: "frightened", value: 2, byId: "foe" });
    setCondition(run, "hero", { key: "prone", value: 1 });
    const net = networkOf(run);
    expect(linksOf(net, "desire", "hero")).toEqual([]);
    expect(linksOf(net, "goal", "hero")).toEqual([]);
    expect(net.creatures.find(c => c.id === "hero")).toMatchObject({ player: true });
    // Frightened by the foe: a line from it, counted; prone: on its own, only on or off.
    expect(linksOf(net, "condition", "foe")[0]).toMatchObject({ to: "hero", key: "frightened", intensity: 2, most: null, valued: true });
    expect(net.marks.find(m => m.on === "hero" && m.key === "prone")).toMatchObject({ type: "condition", intensity: 1, most: 1 });
  });

  test("a bystander who hasn't noticed the fight, unaware; told it has, it's gone", () => {
    const run = scene();
    expect(networkOf(run).marks.find(m => m.on === "guard")).toMatchObject({ type: "status", key: "unaware", most: 1 });
    applyFact(run, { kind: "notice", id: "guard" });
    expect(networkOf(run).marks.some(m => m.on === "guard" && m.key === "unaware")).toBe(false);
  });

  test("what the GM set aside, to hand back", () => {
    const run = scene();
    applyFact(run, { kind: "want", id: "hero", desire: "hurt", targetId: "foe", level: 0 });
    const net = networkOf(run);
    expect(linksOf(net, "desire", "hero")).toEqual([]);
    expect(net.setAside).toEqual([{ type: "desire", id: "hero", kind: "hurt", targetId: "foe" }]);
  });

  test("a talk says how it would put it: its best pitch", () => {
    const run = scene();
    const hero = run.byId.get("hero");
    hero.spec.social = social({ pitches: { persuade: { mod: 30 }, intimidate: { mod: -10 } } });
    hero.desire.stated.set("talk|foe", 70);
    expect(linksOf(networkOf(run), "desire", "hero").find(l => l.kind === "talk")).toMatchObject({ pitch: "persuade", intensity: 4 });
  });

  test("ways toward others outside its desires: won't listen to, wary of hearing, a grudge; the GM takes them away", () => {
    const run = scene();
    const foe = run.byId.get("foe");
    foe.offendedBy = new Set(["hero"]);
    foe.rebuffed = new Map([["hero", 2]]);
    foe.grudges = new Map([["hero", { provoked: true }]]);
    const net = networkOf(run);
    expect(linksOf(net, "relation", "foe").find(l => l.kind === "shuns")).toMatchObject({ to: "hero", most: 1 });
    expect(linksOf(net, "attitude", "foe").find(l => l.kind === "wary")).toMatchObject({ to: "hero", intensity: 2, most: null });
    expect(linksOf(net, "attitude", "foe").find(l => l.kind === "grudge")).toMatchObject({ to: "hero", provoked: true });
    expect(clearRelation(run, "foe", { kind: "shuns", byId: "hero" })).toBe(true);
    setAttitude(run, "foe", { kind: "wary", byId: "hero", level: 1 });
    expect(foe.rebuffed.get("hero")).toBe(1);
    setAttitude(run, "foe", { kind: "grudge", byId: "hero", level: 0 });
    const after = networkOf(run);
    expect(linksOf(after, "relation", "foe").some(l => l.kind === "shuns")).toBe(false);
    expect(linksOf(after, "attitude", "foe").some(l => l.kind === "grudge")).toBe(false);
  });
});
