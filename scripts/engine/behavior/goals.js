/**
 * Goals: what a creature wants that isn't another creature (behavior/desire.js has those): through a door, clear of a
 * trap, away from the fight, a place, an item. Each kind is in GOALS: what it's about (a door, a hazard, an item, a
 * place, an object, or only itself), whether the engine plays it yet, and how its intensity is counted ("band": as a
 * desire's, 0 to 100 in five bands; "count": 1 up to `most`). One the engine doesn't play yet is kept and shown (a
 * battle's own, a combatant's spec.goals: [{kind, thing: {type, id, x, y, name}, level}]; the GM's hold on it) but
 * changes nothing a creature does: the behaviour comes later.
 *
 *   openDoor   through a closed door between it and what it's after (doors.js): walk to it, open it, force it   played
 *   avoidTrap  out of the reach of a hazard it spotted, or that went for it (traps.js)                      played
 *   runAway    out of the fight: shaken (morale.js), it's thinking of running; 2, it runs                     played
 *   closeDoor, lockDoor  a door shut (behind it, against what's coming)                                     not yet
 *   pickUp     what lies in a pile: the treasure, a dropped purse (behavior/forage.js)                        played
 *   eat        food: a pile's, or the meat of the dead (behavior/forage.js), when hungry                      played
 *   reach      a place: a square on the map, the altar, high ground                                         not yet
 *   swim, fly, climb   somewhere by water, by air, up a wall                                                 not yet
 *   hide       out of sight                                                                                  not yet
 *   takeCover  behind something                                                                              not yet
 *   escape     off the map, by a way out                                                                     not yet
 *   useObject  something worked: a lever, a winch, a ritual circle                                          not yet
 *
 * In a live battle the GM holds a goal at an intensity (u.goalHeld, key "<kind>|<thing id>"; 0 sets it aside), as a
 * desire is held: a door given up on is given up on (simulator.js workTheDoor), a trap set aside is forgotten, and a
 * creature no longer thinking of running is steady again (setGoal, engine/live.js).
 */
import { STATUS } from "../../constants.js";
import { rankedDesires, CHOICE_LEVEL } from "./desire.js";
import { doorAhead } from "./doors.js";

export const GOALS = Object.freeze({
  openDoor: Object.freeze({ about: "door", played: true, scale: "band" }),
  avoidTrap: Object.freeze({ about: "hazard", played: true, scale: "count", most: 1 }),
  runAway: Object.freeze({ about: "self", played: true, scale: "count", most: 2 }),
  closeDoor: Object.freeze({ about: "door", scale: "band" }),
  lockDoor: Object.freeze({ about: "door", scale: "band" }),
  pickUp: Object.freeze({ about: "item", played: true, scale: "band" }),
  eat: Object.freeze({ about: "food", played: true, scale: "band" }),
  reach: Object.freeze({ about: "place", scale: "band" }),
  swim: Object.freeze({ about: "place", scale: "band" }),
  fly: Object.freeze({ about: "place", scale: "band" }),
  climb: Object.freeze({ about: "place", scale: "band" }),
  hide: Object.freeze({ about: "self", scale: "band" }),
  takeCover: Object.freeze({ about: "place", scale: "band" }),
  escape: Object.freeze({ about: "place", scale: "band" }),
  useObject: Object.freeze({ about: "object", scale: "band" })
});
export const GOAL_KINDS = Object.freeze(Object.keys(GOALS));

/** A goal's key: its kind and what it's about ("self" for one about nothing else). */
export const goalKey = (kind, thingId) => `${kind}|${thingId ?? "self"}`;

/** The level the GM holds a goal at, or undefined. */
export const heldGoal = (u, kind, thingId) => u.goalHeld?.get(goalKey(kind, thingId));

/** The GM holds it at this level (0: set aside); undefined hands it back. */
export function holdGoal(u, kind, thingId, level) {
  const key = goalKey(kind, thingId);
  if ( level === undefined ) u.goalHeld?.delete(key);
  else (u.goalHeld ??= new Map()).set(key, Math.max(0, Math.round(Number(level) || 0)));
}

/** What a goal is about, from the thing the battle (or the GM) gave: {type, id, x, y, name}, or null for itself. */
const thingOf = t => (t && typeof t === "object" && t.id ? { type: String(t.type ?? GOALS.reach.about), id: String(t.id), x: Number(t.x) || 0, y: Number(t.y) || 0, name: t.name ?? null } : null);

/** Desires that take it somewhere (a door in the way matters): all but keeping away. */
const GOES = new Set(["hurt", "heal", "protect", "aid", "talk", "bind", "rob"]);

/**
 * Every goal a creature has now: the engine's own (a door in the way of what it's after most, the traps it keeps clear
 * of, running), and those the battle gave it: [{kind, key, thing, targetId, via, level, scale, most, played, gm}],
 * strongest first. Those the GM set aside are left out. Changes nothing.
 */
export function goalsOf(run, u) {
  const out = [];
  const add = (kind, level, { thing = null, targetId = null, via = null } = {}) => {
    const g = GOALS[kind];
    if ( !g ) return;
    const key = goalKey(kind, thing?.id ?? targetId);
    if ( out.some(o => o.key === key) ) return;
    const held = u.goalHeld?.get(key);
    const at = held ?? level;
    if ( !(at > 0) ) return;
    out.push({ kind, key, thing, targetId, via, level: g.scale === "count" ? Math.min(g.most ?? 1, at) : at, scale: g.scale, most: g.most ?? null, played: !!g.played, gm: held !== undefined });
  };
  const standing = u.status === STATUS.STANDING;
  if ( standing && u.active ) {
    // Through the door between it and what it's after most (as workTheDoor reckons it, there).
    const lead = rankedDesires(run, u).find(d => GOES.has(d.kind) && d.targetId !== u.id);
    const t = lead ? run.byId.get(lead.targetId) : null;
    const door = t ? doorAhead(run, u, t) : null;
    if ( door && u.walledOff?.get(t.id) !== door.id ) {
      const state = run.doors?.get(door.id);
      add("openDoor", Math.max(CHOICE_LEVEL, lead.level), {
        thing: { type: "door", id: String(door.id), x: Number(door.x) || 0, y: Number(door.y) || 0, name: door.name ?? null, locked: !!state?.locked },
        via: t.id
      });
    }
    // Clear of the traps it knows.
    for ( const id of u.spottedTraps ?? [] ) {
      const h = run.byId.get(id);
      if ( h && h.status === STATUS.STANDING ) add("avoidTrap", 1, { targetId: h.id });
    }
    // Thinking of running.
    if ( u.wavering ) add("runAway", 1);
  }
  // What it wants of what lies about (behavior/forage.js): a pile's valuables, food (a pile's, or a body's meat).
  for ( const f of u.forage ?? [] ) add(f.kind, f.level, { thing: { type: run.byId.has(f.sourceId) ? "body" : "pile", id: f.sourceId, x: f.x, y: f.y, name: f.name } });
  // The battle's own (and the GM's word on them).
  for ( const s of u.spec.goals ?? [] ) {
    if ( !GOALS[s?.kind] || !standing ) continue;
    add(s.kind, Math.max(0, Math.min(100, Number(s.level) || 0)), { thing: thingOf(s.thing) });
  }
  return out.sort((a, b) => (b.scale === "band" ? b.level : b.level * 20) - (a.scale === "band" ? a.level : a.level * 20));
}
