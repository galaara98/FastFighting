/**
 * What the core's own conditions do that takes the engine (engine/conditions.js PROFILES): the holds an action breaks
 * (frozen solid: chipped out; swallowed: cut free or let go of when the swallower falls; a parasite: cut out), what a
 * creature can try itself to be rid of one (drop and roll, press the wound, get air, reboot), what a friend beside it
 * can do for it (beat the flames out, haul it back in), and changing one's value (a parasite growing, a reboot easing
 * a glitch); who holds a creature inside it, and the total cover between those inside and everything outside
 * (holderOf, cutOff). The turn's harm, a countdown's end and a spread are the simulator's (conditionUpkeep).
 * A system that gives a condition its own meaning (conditions.js conditionSetup) gets none of this for that one.
 * Pure: no Foundry globals.
 */
import { profileOf, profiled, INSIDE } from "../conditions.js";
import { typical } from "../battle-state.js";
import { recompute } from "./effects.js";
import { afflictionFor } from "./afflictions.js";
import { normalizeCost } from "../turn.js";
import { parseFormula } from "../dice.js";

/** Whoever laid a condition on it (the latest effect with it that says), or null. */
export function layerOf(run, u, key) {
  const e = [...(u.effects ?? [])].reverse().find(x => !x.onlyVs && (Number(x.conditions?.[key]) || (x.conditions?.[key] === true ? 1 : 0)) > 0 && x.sourceId);
  return e ? run.byId.get(e.sourceId) ?? null : null;
}

/**
 * Whoever holds it inside (swallowed it, engulfed it: a profile that's inside, laid by that one), or null. A corpse
 * may still hold it, where the system says it keeps hold (rules.letGo).
 */
export function holderOf(run, u) {
  for ( const key of INSIDE ) {
    if ( !(Number(u?.conds?.[key]) > 0) || !profileOf(u, key)?.inside ) continue;
    const by = layerOf(run, u, key);
    if ( by ) return by;
  }
  return null;
}

/**
 * Total cover between a and b: one of them inside a creature (holderOf) and the other neither that creature nor inside
 * it too. Nothing reaches through it, either way: no blow, no spell, no heal, no hand.
 */
export function cutOff(run, a, b) {
  if ( a === b ) return false;
  const ha = holderOf(run, a);
  const hb = holderOf(run, b);
  if ( ha ) return b !== ha && hb !== ha;
  return !!hb;
}

/**
 * What one of the core's conditions harms it with each time (damage parts; none: no harm): the system's own say first
 * (rules.conditionHarm(key, value, unit, by): its harm in its own terms; Ironsworn's a point), else by its value, or by
 * the level of whoever laid it (in a gullet: the swallower's).
 */
export function harmParts(run, u, key, v, p, by = layerOf(run, u, key)) {
  if ( !p?.harm ) return [];
  const [formula, type] = p.harm;
  const own = run.prep?.rules?.conditionHarm?.(key, v, u, by);
  if ( own !== undefined ) return own ?? [];
  const f = p.bySource ? `${1 + Math.floor((by?.spec.level ?? u.spec.level ?? 1) / 4)}d6` : formula?.(v);
  return f ? [parseFormula(f, type)] : [];
}

/**
 * A condition's value changed where it comes from (0 takes it off): the effects that carry it (the strongest keeps
 * the new value, the rest let it go), else what it started with; a simple affliction's stage, where one stands for it.
 */
export function setConditionValue(u, key, n) {
  const value = Math.max(0, Math.round(Number(n) || 0));
  const a = afflictionFor(u, key);
  if ( a ) {
    if ( value <= 0 ) u.afflictions = u.afflictions.filter(x => x !== a);
    else a.stage = Math.min(a.spec.stages.length, value);
    recompute(u);
    return;
  }
  let kept = false;
  const carrying = (u.effects ?? []).filter(e => !e.onlyVs && key in (e.conditions ?? {}));
  const strongest = carrying.reduce((best, e) => ((Number(e.conditions[key]) || 1) > (Number(best?.conditions[key]) || 0) ? e : best), null);
  u.effects = (u.effects ?? []).flatMap(e => {
    if ( !carrying.includes(e) ) return [e];
    const conditions = { ...e.conditions };
    if ( e === strongest && value > 0 ) {
      conditions[key] = value;
      kept = true;
    } else delete conditions[key];
    const rest = Object.keys(conditions).length || e.mods || e.mark?.length || e.iwr || e.boost || e.taunt || e.uses || e.fastHealing || e.regen;
    return rest ? [{ ...e, conditions }] : [];
  });
  if ( u.baseConds ) {
    if ( value > 0 && !kept ) u.baseConds[key] = value;
    else delete u.baseConds[key];
  }
  recompute(u);
}

/** How hard one of these holds is to break: as whoever laid it makes it (its escape DC), else a typical DC, harder as it says. */
function holdDC(run, u, p, by) {
  const rules = run.prep?.rules ?? {};
  if ( p.hold?.bySource && by ) return Number.isFinite(by.spec.escapeDC) ? by.spec.escapeDC : typical(rules, "dc", by.spec.level ?? 0);
  return typical(rules, "dc", u.spec.level ?? 0) + (Number(p.hold?.harder) || 0);
}

/**
 * The holds its conditions put on it (behavior/holds.js holdsOf takes them): each {key, byId, dc, others, via,
 * worsens, core: true}; and what a friend can do for it that it tries on its own another way (friendOnly: burning,
 * bleeding, adrift).
 */
export function troubleHolds(run, u) {
  const out = [];
  for ( const [key, , p] of profiled(u) ) {
    const by = layerOf(run, u, key);
    if ( p.hold ) {
      out.push({ key, byId: by?.id ?? null, dc: holdDC(run, u, p, by), others: p.hold.others ?? null, via: p.hold.via ?? null, worsens: !!p.hold.worsens, bySource: !!p.hold.bySource, core: true });
    } else if ( p.help ) {
      out.push({ key, byId: by?.id ?? null, dc: typical(run.prep?.rules ?? {}, "dc", u.spec.level ?? 0), others: p.help.others, via: p.help.via ?? null, friendOnly: true, core: true });
    }
  }
  return out;
}

/**
 * What it can try itself to be rid of its conditions (behavior/holds.js remediesOf takes them): {key, condition, type,
 * annoyance, cost, try}. A try is a chance (not one that has to move, held fast); it ends the condition, or eases it.
 */
export function troubleRemedies(run, u, canMove) {
  const rules = run.prep?.rules ?? {};
  const out = [];
  for ( const [key, v, p] of profiled(u) ) {
    const r = p.remedy;
    if ( !r || (r.moves && !canMove) ) continue;
    out.push({
      key: `condition:${key}`, condition: key, type: r.type ?? null, label: null, annoyance: r.annoyance ?? 35,
      cost: normalizeCost(rules, rules.basicAction ?? 1),
      try: (run2, w) => {
        const success = run2.rng.chance(Math.max(0, Math.min(1, Number(r.chance) || 0)));
        if ( success ) setConditionValue(w, key, r.lowers ? Math.max(0, v - r.lowers) : 0);
        return { success };
      }
    });
  }
  return out;
}

/** The save it makes against something taking hold of its body: its Fortitude or Constitution, the better (a system's own word first). */
export function toughSave(run, t) {
  const named = run.prep?.rules?.toughSave;
  if ( named ) return named;
  const d = t.spec.defenses ?? {};
  const known = ["fortitude", "con", "fort", "constitution", "str"].filter(k => Number.isFinite(d[k]));
  return known.length ? known : "fortitude";
}

/** Does any condition on it end with healing (a bleed)? Those, ended. */
export function healedOf(u) {
  const ended = profiled(u).filter(([, , p]) => p.healed === "ends").map(([key]) => key);
  for ( const key of ended ) setConditionValue(u, key, 0);
  return ended;
}

/** The conditions on it that harm ends: any harm; or harm from whoever laid it, or that one's side. Those, ended. */
export function harmEnds(run, source, u) {
  const ended = [];
  for ( const [key, , p] of profiled(u) ) {
    if ( !p.breaks ) continue;
    const by = layerOf(run, u, key);
    const ends = p.breaks === "harm" ? true : !!(source && by && (source === by || (source.homeSide ?? source.side) === (by.homeSide ?? by.side)));
    if ( ends ) {
      setConditionValue(u, key, 0);
      ended.push(key);
    }
  }
  return ended;
}

/**
 * Laid by one who just fell (a swallower, an ooze): what it held, let go of, unless the system says it keeps hold
 * (rules.letGo(run, u, key, holder) false: a corpse to cut open first, PF2e's Swallow Whole); the system's say on what
 * comes of being let go meanwhile (5e: out of a dead worm, Prone). Returns those let go: [{u, key}].
 */
export function letGo(run, fallen) {
  const rules = run.prep?.rules ?? {};
  const out = [];
  for ( const o of run.units ) {
    if ( o === fallen ) continue;
    for ( const [key, , p] of profiled(o) ) {
      if ( !p.hold?.bySource || layerOf(run, o, key) !== fallen ) continue;
      if ( rules.letGo?.(run, o, key, fallen) === false ) continue;
      setConditionValue(o, key, 0);
      out.push({ u: o, key });
    }
  }
  return out;
}

export { profileOf };
