/**
 * Auras that make foes save: a presence that frightens (PF2e Frightful Presence), a stench that sickens, heat that
 * burns whoever comes close. Its bearer spends nothing on it: it goes off at a foe that comes inside it, or starts its
 * turn inside it, as the aura says.
 *
 * spec.auras: [{id, key, label, range, save, byDegree, damage, when, immuneAfter, immuneAll, immuneRounds, traits,
 * needs, foesOnly, magical}]
 *   id            unique among its bearer's (the helper's: its item's)
 *   key           its kind, by slug ("stench"): what immuneAll is immune to
 *   label         its name, for the log and the story
 *   range         feet, from its bearer's edge (an emanation)
 *   save          {type, dc, basic}: the save it calls for (basic, for its damage: as a basic save; true unless said)
 *   byDegree      [critical failure, failure, success, critical success]: an outcome each (effects.js: conditions with
 *                 values, rounds, mods ...) or null
 *   damage        DamagePart[]: dealt as the save's degree says (rules.saveMultiplier)
 *   when          "enter" (a foe that comes inside it, by its own move, one it's made to make, or the bearer's),
 *                 "turnStart" (a foe that starts its turn inside it) or "both" (the default)
 *   immuneAfter   "save": once it has saved, whatever came of it, it's immune; "success": once it saved well; left
 *                 out, never (each time it enters or starts its turn inside, as `when` says)
 *   immuneAll     immune to every aura of the same key, not only this bearer's (PF2e's stench)
 *   immuneRounds  so many rounds immune (PF2e's minute: 10); left out, the rest of the fight
 *   traits        the system's own (emotion, fear, mental, olfactory ...): its immunities (rules.isImmune, as for
 *                 any action) and spec.saveVs (behavior/save-vs.js) go by them
 *   needs         "sight" | "hearing" | "smell": a sense it takes to be affected (PF2e's visual, auditory and
 *                 olfactory traits): blinded or sightless, it doesn't see one it needs to see (nor an invisible
 *                 bearer, nor one past a wall); deafened or deaf, it doesn't hear; senses.smell 0, it doesn't smell
 *   foesOnly      true (the default): only its bearer's foes; false: everyone but its bearer
 *   magical       its save counts as against magic (saveVs, Magic Resistance)
 * One with no save, or with nothing a save could come to, isn't one of these (a friend's save aura is
 * spec.saveAura). A creature is affected at most once a round by each aura. The bearer must be up and able to act;
 * the one affected, standing and in the fight (not a bystander yet, not one held off by a standoff).
 *
 * Where: on a map, real distance from the bearer's edge; the fight's start is where everyone stood (spec.position),
 * so whoever stood inside an aura as the fight began comes into it then, and saves at the start of its first turn.
 * Off the map (no positions), everyone is inside every aura (as with a friend's save aura): each foe comes into it as
 * the fight begins, and starts each of its turns inside it.
 *
 * The Statistics Engine (auraToll): a creature that would walk into an aura to strike weighs what the aura would cost
 * it (its save's chances, what each degree lays and deals) against what the blow is worth: the brave mind it less,
 * the feral not at all, one immune or already inside not at all. A shot can keep its distance.
 *
 * Live battles: in a turn FastFighting plays, and when a player's character ends a move (live.js movedBeside), the
 * save is the system's own roll (battle-state.js systemRolled: "save"), and what it lays goes on the sheet with the
 * turn's change set, as any save's does; its damage is the engine's dice, written as any damage the engine deals. A
 * player's character starting its turn inside an aura is the table's to settle: FastFighting rolls nothing for it.
 *
 * What it needs of the simulation (simulator.js passes it: `play`): rollSave, rollHit, appliedLive, landOutcome,
 * testConcentration and log.
 * Pure: no Foundry globals.
 */
import { STATUS, TACTICAL } from "../../constants.js";
import { edgeDistance, separation, isStanding, isUp, areEnemies, heldOff, isMagical, liveTier, liveTrait, saveRoll } from "../battle-state.js";
import { degreeDistribution } from "../probability.js";
import { maxPart } from "../dice.js";
import { barred } from "../conditions.js";
import { isImmune } from "./control.js";
import { outcomeWorth } from "./effects.js";
import { saveMultiplierFor, upgradedDistribution, meanDamageVs } from "./evaluate.js";
import { senseReach, sightReach, DARK } from "./senses.js";
import { wallsKnown, lineOfSight } from "./space.js";
import { cutOff } from "./troubles.js";

/** The senses an aura may need. */
const NEEDS = new Set(["sight", "hearing", "smell"]);

/** One of spec.auras, made ready: its fields checked, and an action of its own (for immunities, saves and the log). */
function ready(raw) {
  if ( !raw || typeof raw !== "object" || !raw.save?.type || !Number.isFinite(Number(raw.save.dc)) ) return null;
  const range = Number(raw.range);
  if ( !(range > 0) ) return null;
  const byDegree = [0, 1, 2, 3].map(d => (raw.byDegree?.[d] && typeof raw.byDegree[d] === "object" ? raw.byDegree[d] : null));
  const damage = Array.isArray(raw.damage) && raw.damage.length ? raw.damage : null;
  if ( !damage && !byDegree.some(Boolean) ) return null;
  const when = ["enter", "turnStart"].includes(raw.when) ? raw.when : "both";
  const save = { type: raw.save.type, dc: Number(raw.save.dc), basic: raw.save.basic !== false };
  const traits = Array.isArray(raw.traits) ? raw.traits.filter(t => typeof t === "string") : [];
  const id = String(raw.id ?? raw.key ?? raw.label ?? "aura");
  return {
    id, key: String(raw.key ?? id), label: raw.label ?? "", range, save, byDegree, damage,
    enter: when !== "turnStart", turnStart: when !== "enter",
    immuneAfter: ["save", "success"].includes(raw.immuneAfter) ? raw.immuneAfter : null,
    immuneAll: !!raw.immuneAll, immuneRounds: Number(raw.immuneRounds) > 0 ? Math.round(Number(raw.immuneRounds)) : null,
    needs: NEEDS.has(raw.needs) ? raw.needs : null, foesOnly: raw.foesOnly !== false,
    // (What it is to the rest of the engine: an area that calls for a save, with these traits.)
    action: {
      id, name: raw.label ?? "", kind: "aura", aura: true, traits, save, damage: damage ?? [], onSave: byDegree,
      area: { shape: "emanation", feet: range }, ...(raw.magical ? { magical: true } : {})
    }
  };
}

/** A bearer's auras, made ready (once a battle: its prep is the battle's). */
export function aurasOf(b) {
  if ( !b?.spec?.auras?.length ) return [];
  if ( b.prep ) return b.prep.auraList ??= b.spec.auras.map(ready).filter(Boolean);
  return b.spec.auras.map(ready).filter(Boolean);
}

/** Whoever has an aura of these, as the fight's creatures stand (kept until someone joins). */
function bearers(run) {
  const kept = run.bearerCache;
  if ( kept && kept.n === run.units.length ) return kept.list;
  const list = run.units.filter(u => aurasOf(u).length);
  run.bearerCache = { n: run.units.length, list };
  return list;
}

/** Which of b's auras, for t's records ("bearer|aura"). */
const auraKey = (b, aura) => `${b.id}|${aura.id}`;

/** What t is immune to once it has saved: this bearer's aura, or every aura of its kind. */
const immunityKey = (b, aura) => (aura.immuneAll ? `kind:${aura.key}` : auraKey(b, aura));

/**
 * Is t inside b's aura: within its range of b's edge, where they stand (`start`: where they stood as the fight began),
 * or as far apart as the fight's approach has them; off the map (no positioning), always.
 */
function inside(run, b, aura, t, { start = false } = {}) {
  if ( t === b || cutOff(run, b, t) ) return false;
  if ( !run.prep.options.positioning ) return true;
  let d;
  if ( start && b.spec.position && t.spec.position ) d = edgeDistance({ pos: b.spec.position, spec: b.spec }, { pos: t.spec.position, spec: t.spec });
  else d = edgeDistance(b, t) ?? separation(run, b, t);
  return d !== null && d <= aura.range + 0.5;
}

/** Is b's aura up: b standing, in the fight and able to act? */
const projects = b => isStanding(b) && !(b.conds?.incapacitated > 0) && !barred(b, "act");

/** Does b's aura reach t: standing, in the fight, nothing set and untouchable, and (most auras) one of b's foes? */
function affects(run, b, aura, t) {
  if ( t === b || !isStanding(t) || t.spec.hazard || t.spec.untargetable || !projects(b) ) return false;
  return aura.foesOnly ? areEnemies(run, b, t) : true;
}

/** Is t immune to b's aura just now: for having saved against it (or one of its kind), or by its traits (expose)? */
function immuneNow(run, b, aura, t) {
  if ( !t.auraImmune?.size ) return false;
  return [auraKey(b, aura), immunityKey(b, aura)].some(k => {
    const until = t.auraImmune.get(k);
    return until !== undefined && run.round < until;
  });
}

/** Can t sense b's aura as it must to be affected (aura.needs)? */
function senses(run, b, aura, t) {
  const r = senseReach(t.spec, run.prep.rules.hearingFeet ?? 60);
  if ( aura.needs === "sight" ) {
    if ( (t.conds?.blinded ?? 0) > 0 || (b.conds?.invisible ?? 0) > 0 ) return false;
    const d = edgeDistance(t, b);
    if ( d !== null && d > sightReach(r, (run.prep.options.darkness ?? 0) >= DARK) ) return false;
    return !(wallsKnown(run) && t.pos && b.pos) || lineOfSight(run, t, b);
  }
  if ( aura.needs === "hearing" ) return !((t.conds?.deafened ?? 0) > 0) && r.hearing > 0;
  // (Smell: anyone can, but one that has none at all, senses.smell 0.)
  if ( aura.needs === "smell" ) return t.spec.senses?.smell !== 0;
  return true;
}

/** Where everyone stood as the fight began, inside which auras (once a fight: those inside it, unchecked as yet). */
function begin(run) {
  if ( run.auraReady ) return;
  run.auraReady = true;
  for ( const b of bearers(run) ) {
    for ( const aura of aurasOf(b) ) {
      for ( const t of run.units ) if ( inside(run, b, aura, t, { start: true }) ) (t.auraIn ??= new Set()).add(auraKey(b, aura));
    }
  }
}

/** t's place against b's aura brought up to date: "entered" (inside, and wasn't), "left", or null (as it was). */
function follow(run, b, aura, t) {
  const key = auraKey(b, aura);
  const was = !!t.auraIn?.has(key);
  const now = inside(run, b, aura, t);
  if ( was === now ) return null;
  if ( now ) {
    (t.auraIn ??= new Set()).add(key);
    return "entered";
  }
  t.auraIn.delete(key);
  t.auraChecked?.delete(key);
  return "left";
}

/** How much rides on the save: what its harm would do, or (what it lays) a good deal. */
function stakesOf(t, aura) {
  if ( !aura.damage ) return 0.5;
  const most = aura.damage.reduce((s, p) => s + Math.max(0, maxPart(p)), 0);
  return Math.min(1, most >= t.hp + (t.temp ?? 0) ? 0.95 : 0.25 + 0.5 * most / Math.max(1, t.hp));
}

/**
 * b's aura goes off at t (`cause`: "enter" or "turnStart"): t saves (the system's own roll in a live battle's turn),
 * takes what that degree lays and deals, and may be immune from then on. Logged ("aura").
 */
function expose(run, b, aura, t, cause, play) {
  if ( !affects(run, b, aura, t) ) return;
  // (A standoff holds: not yet. It counts once the fighting starts.)
  if ( heldOff(run, b, t) ) return;
  const key = auraKey(b, aura);
  if ( t.auraLast?.get(key) === run.round ) return; // (once a round)
  (t.auraChecked ??= new Set()).add(key);
  if ( immuneNow(run, b, aura, t) || !senses(run, b, aura, t) ) return;
  (t.auraLast ??= new Map()).set(key, run.round);
  const common = { aura: aura.label, action: aura.label, auraId: aura.id, cause, target: t.spec.name, targetId: t.id, saveType: aura.save.type, dc: aura.save.dc };
  // (Immune by its traits or what it lays: the system's say, as for any action. Told once: immune to it for the fight.)
  if ( isImmune(run, t, aura.action) ) {
    play.log(run, b, { type: "aura", ...common, immune: true, took: false });
    (t.auraImmune ??= new Map()).set(key, Infinity);
    return;
  }
  const rules = run.prep.rules;
  const { roll, mod } = play.rollSave(run, t, aura.save.type, aura.save.dc, { stakes: stakesOf(t, aura), label: aura.label, magical: isMagical(aura.action), from: b, action: aura.action });
  const degree = roll.degree;
  const outcome = aura.byDegree[degree];
  const mult = aura.damage ? saveMultiplierFor(rules, degree, aura.save, t) : 0;
  const hit = mult > 0 ? play.rollHit(run, b, aura.action, t, aura.damage, mult, false) : null;
  // (A live battle's: the engine's dice shown as the system's damage card and applied its way, where it can.)
  const dealt = hit ? play.appliedLive(run, b, t, hit, hit.total, mult) : 0;
  const conditions = outcome ? Object.keys(outcome.conditions ?? {}).filter(k => outcome.conditions[k]) : [];
  const entry = play.log(run, b, {
    type: "aura", ...common, natural: roll.natural, mod: mod + (roll.die ?? 0), total: roll.total, degree, margin: roll.total - aura.save.dc,
    damage: dealt, damageType: aura.damage?.[0]?.type ?? null, conditions, effect: outcome?.label ?? "", took: !!outcome || dealt > 0,
    note: roll.note ?? null, faces: roll.faces ?? null
  });
  hit?.apply(dealt, entry);
  if ( outcome && isUp(t) ) {
    play.landOutcome(run, b, t, outcome, aura.action, { damage: false });
    play.testConcentration(run, t);
  }
  if ( aura.immuneAfter === "save" || (aura.immuneAfter === "success" && degree >= 2) ) {
    (t.auraImmune ??= new Map()).set(immunityKey(b, aura), aura.immuneRounds ? run.round + aura.immuneRounds : Infinity);
  }
}

/**
 * u moved (its own move, one it was made to make, or a step outside its turn): whoever came inside an aura goes
 * through it, u into others' auras, or others into u's own, as each aura says (`when`: "enter").
 */
export function auraMoved(run, u, play) {
  if ( !run.foeAuras ) return;
  begin(run);
  const list = bearers(run);
  // (Into another's aura.)
  for ( const b of list ) {
    if ( b === u ) continue;
    for ( const aura of aurasOf(b) ) {
      if ( follow(run, b, aura, u) === "entered" && aura.enter ) expose(run, b, aura, u, "enter", play);
    }
  }
  // (Its own aura, carried onto others.)
  if ( !list.includes(u) ) return;
  for ( const aura of aurasOf(u) ) {
    for ( const t of [...run.units] ) {
      if ( t === u ) continue;
      if ( follow(run, u, aura, t) === "entered" && aura.enter ) expose(run, u, aura, t, "enter", play);
    }
  }
}

/**
 * u starts its turn: each aura it's inside goes off at it if the aura says so (`when`: "turnStart"), or if it came
 * inside without being checked yet (as the fight began; during a standoff; unseen).
 */
export function auraTurnStart(run, u, play) {
  if ( !run.foeAuras || !isStanding(u) || u.spec.hazard ) return;
  begin(run);
  for ( const b of bearers(run) ) {
    if ( b === u ) continue;
    for ( const aura of aurasOf(b) ) {
      follow(run, b, aura, u);
      if ( !u.auraIn?.has(auraKey(b, aura)) ) continue;
      if ( aura.turnStart ) expose(run, b, aura, u, "turnStart", play);
      else if ( aura.enter && !u.auraChecked?.has(auraKey(b, aura)) ) expose(run, b, aura, u, "enter", play);
      if ( !isUp(u) || u.status === STATUS.DEAD ) return;
    }
  }
}

/**
 * What going through b's aura would cost t, on the whole, in damage-like points: its save's chances (its situational
 * saves too), what each degree lays (effects.js outcomeWorth) and deals.
 */
export function auraCost(run, b, aura, t) {
  const rules = run.prep.rules;
  const s = saveRoll(run, t, aura.save.type, { action: aura.action, from: b, magical: isMagical(aura.action) });
  const dist = upgradedDistribution(degreeDistribution(rules, s.mod, aura.save.dc, { advantage: s.advantage, dice: s.dice, kind: "save", roller: t }), t, aura.save.type);
  const harm = aura.damage ? meanDamageVs(run, aura.action, t).normal : 0;
  let cost = 0;
  dist.forEach((p, d) => {
    if ( !(p > 0) ) return;
    if ( harm ) cost += p * saveMultiplierFor(rules, d, aura.save, t) * harm;
    if ( aura.byDegree[d] ) cost -= p * outcomeWorth(run, b, t, aura.byDegree[d]);
  });
  return Math.max(0, cost);
}

/** auraCost, kept for the round: it's asked of every option, every step. */
function costNow(run, b, aura, t) {
  if ( run.auraCostCache?.round !== run.round ) run.auraCostCache = { round: run.round, map: new Map() };
  const key = `${auraKey(b, aura)}|${t.id}`;
  let v = run.auraCostCache.map.get(key);
  if ( v === undefined ) run.auraCostCache.map.set(key, v = auraCost(run, b, aura, t));
  return v;
}

/**
 * The Statistics Engine's weight on an option that walks u in to strike t (targeting.js bestOptionVs): 1, or less
 * where the blow means going inside a foe's aura it isn't inside yet and isn't immune to, by what the aura would cost
 * it against what the blow is worth (`ev`). The brave mind it less; the feral don't see it coming. A shot (an action
 * with a range) can keep its distance: never.
 */
export function auraToll(run, u, t, action, ev) {
  if ( !run.foeAuras || action.range || !(ev > 0) || liveTier(run, u) < TACTICAL.INSTINCTIVE ) return 1;
  let toll = 0;
  for ( const b of bearers(run) ) {
    if ( b === u ) continue;
    for ( const aura of aurasOf(b) ) {
      if ( u.auraIn?.has(auraKey(b, aura)) || !affects(run, b, aura, u) || immuneNow(run, b, aura, u) ) continue;
      // (Where its blow would land it: beside t, so inside b's aura when t is, or when t is b.)
      const d = b === t ? Number(action.reach) || 5 : edgeDistance(b, t) ?? separation(run, b, t);
      if ( d === null || d > aura.range + 0.5 || isImmune(run, u, aura.action) ) continue;
      toll += costNow(run, b, aura, u);
    }
  }
  if ( !(toll > 0) ) return 1;
  const caution = 1 - 0.5 * liveTrait(run, u, "brave") / 100;
  return ev / (ev + toll * caution);
}
