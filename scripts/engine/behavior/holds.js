/**
 * Holds: what keeps a creature from acting freely that it (or a friend) can break with an action.
 *  - Tied up (u.bound): FastFighting's own, with whatever was to hand (behavior/fallen.js). Who tied it (u.boundBy) is
 *    only for the story: it's on the creature, not toward anyone. Awake, it's a prisoner (STATUS.BOUND).
 *  - A grab (u.grabbedBy).
 *  - The system's own: an effect that says an action breaks it (effect.escape: {dc, others}: a web's hold, a net), a
 *    condition its sheet shows that its rules say an action breaks (rules.escapeFrom), or any other hold its rules
 *    know (rules.holds: manacles, being swallowed).
 * Each says how hard it is to break (dc, or none known) and whether a friend can free it (others: "untie", an action
 * beside it, no roll; "check", a roll; null, it can't).
 *
 * Breaking free (desire "breakFree", on itself), and freeing a friend (desire "free"): the system's own way where it
 * has one (rules.breakFree), else the creature's escape (spec.escapeWork: {mod, faces}, its best of Athletics,
 * Acrobatics, an unarmed attack ...) against the hold's DC, else a chance (ESCAPE_CHANCE). Untying a friend takes no
 * roll unless the system says otherwise. A prisoner struggles on its turn, the only thing it can do; free, it's in the
 * fight again from its next turn.
 *
 * What a system can say (all optional; the rules a helper gives the engine, and its specs):
 *   rules.holds(run, u)                    more holds on u: [{key, byId, dc, others, label}]
 *   rules.escapeFrom(run, u, key)          a condition its sheet shows that an action breaks: {dc, others} or null
 *   rules.bondsDC(u)                       how hard FastFighting's improvised bonds are to slip (default: a typical DC
 *                                          for its level, a little harder)
 *   rules.escapeCost(u, hold)              what a try at breaking free costs (default: the basic action)
 *   rules.untieCost(u, t, hold)            what freeing a friend costs (default: the basic action)
 *   rules.breakFree(run, who, hold, {freeing, held})  the system's own try, for itself or (freeing) for the friend
 *                                          `held`: {success, degree, natural, mod, total, dc, said} or null (the core's)
 *   spec.escapeWork {mod, faces}           a creature's best way out, as a check
 *   spec.escapeDC                          how hard a grab of this creature's is to break
 * Pure: no Foundry globals.
 */
import { STATUS } from "../../constants.js";
import { typical } from "../battle-state.js";
import { rollCheck } from "../probability.js";
import { recompute } from "./effects.js";
import { normalizeCost } from "../turn.js";

/** Without a roll to make: how often a try gets loose (a grab, as the engine always had it; bonds, harder). */
export const ESCAPE_CHANCE = Object.freeze({ grabbed: 0.5, bound: 0.35, other: 0.4 });
/** How much harder improvised bonds are than the system's typical DC for the creature's level. */
const BONDS_HARDER = 2;

/** Is it tied up? (A battle kept before u.bound was: whoever tied it.) */
export const isBound = u => !!(u.bound ?? u.boundBy);

/** How hard FastFighting's improvised bonds are to slip, for this creature (the system's say, or a typical DC). */
export function bondsDC(run, u) {
  const rules = run.prep.rules;
  return rules.bondsDC?.(u) ?? typical(rules, "dc", u.spec.level ?? 0) + BONDS_HARDER;
}

const dcOf = v => (Number.isFinite(v) ? v : null);

/**
 * Every hold on u that an action breaks: [{key, byId, dc (null: none known), others, label, effectKey?, sheet?}]. A
 * condition can be held by more than one thing (a web and a grab): each is its own.
 */
export function holdsOf(run, u) {
  const rules = run.prep.rules;
  const out = [];
  if ( isBound(u) ) out.push({ key: "bound", byId: u.boundBy ?? null, dc: bondsDC(run, u), others: "untie" });
  if ( u.grabbedBy ) {
    const g = run.byId.get(u.grabbedBy);
    out.push({ key: "grabbed", byId: u.grabbedBy, dc: dcOf(g?.spec.escapeDC), others: null });
  }
  for ( const e of u.effects ?? [] ) {
    if ( !e.escape || e.onlyVs ) continue;
    for ( const [key, v] of Object.entries(e.conditions ?? {}) ) {
      if ( !(Number(v) > 0 || v === true) || (key === "grabbed" && u.grabbedBy) ) continue;
      out.push({ key, byId: e.sourceId ?? null, dc: dcOf(e.escape.dc), others: e.escape.others ?? null, label: e.label || null, effectKey: e.key });
    }
  }
  // (The system's own: on the sheet with nothing of the engine's behind it, and any other it knows.)
  if ( typeof rules.escapeFrom === "function" ) {
    for ( const [key, v] of Object.entries(u.baseConds ?? {}) ) {
      if ( !(Number(v) > 0) || out.some(h => h.key === key) ) continue;
      const h = rules.escapeFrom(run, u, key);
      if ( h ) out.push({ key, byId: h.byId ?? null, dc: dcOf(h.dc), others: h.others ?? null, label: h.label ?? null, sheet: true });
    }
  }
  for ( const h of (typeof rules.holds === "function" ? rules.holds(run, u) : null) ?? [] ) {
    if ( h?.key && !out.some(o => o.key === h.key) ) out.push({ byId: null, others: null, ...h, dc: dcOf(h.dc), system: true });
  }
  return out;
}

/**
 * One try at breaking a hold, by `who`: u itself, or (freeing) a friend beside it. The system's own way, else a check
 * of its escape against the DC, else a chance; a friend untying needs no roll. {success, degree?, natural?, mod?,
 * total?, dc?, said?}
 */
export function tryHold(run, who, hold, { freeing = false } = {}) {
  const rules = run.prep.rules;
  const own = typeof rules.breakFree === "function" ? rules.breakFree(run, who, hold, { freeing }) : null;
  if ( own ) return { ...own, success: !!own.success };
  if ( freeing && hold.others === "untie" ) return { success: true };
  const work = who.spec.escapeWork;
  if ( Number.isFinite(work?.mod) && Number.isFinite(hold.dc) ) {
    const roll = rollCheck(rules, run.rng, work.mod, hold.dc, { kind: "check", roller: who, faces: work.faces });
    return { success: roll.degree >= 2, natural: roll.natural, mod: work.mod, total: roll.total, dc: hold.dc, degree: roll.degree };
  }
  return { success: run.rng.chance(ESCAPE_CHANCE[hold.key] ?? ESCAPE_CHANCE.other) };
}

/**
 * Does breaking this hold go by the system's or the creature's own numbers (not the old even chance at a grab)? A
 * creature with none of them tries to get out of a grab at the start of every turn, as the engine always had it.
 */
export const known = (run, u, hold) => typeof run.prep.rules.breakFree === "function" || (Number.isFinite(u.spec.escapeWork?.mod) && Number.isFinite(hold?.dc));

/** The hold is broken: u is free of it (and of its condition, where that's all the hold was). */
export function release(run, u, hold) {
  switch ( hold.key ) {
    case "bound":
      u.bound = false;
      u.boundBy = null;
      u.boundRound = null;
      if ( u.status === STATUS.BOUND ) u.status = u.hp > 0 ? STATUS.STANDING : STATUS.DOWN;
      break;
    case "grabbed":
      u.grabbedBy = null;
      u.effects = (u.effects ?? []).filter(e => !(e.conditions?.grabbed && (e.key === "gm:grabbed" || e.key === hold.effectKey)));
      if ( u.baseConds ) delete u.baseConds.grabbed;
      break;
    default:
      if ( hold.effectKey ) {
        u.effects = (u.effects ?? []).flatMap(e => {
          if ( e.key !== hold.effectKey ) return [e];
          const conditions = { ...e.conditions };
          delete conditions[hold.key];
          return Object.keys(conditions).length || e.mods ? [{ ...e, conditions }] : [];
        });
      }
      if ( (hold.sheet || hold.system) && u.baseConds ) delete u.baseConds[hold.key];
  }
  recompute(u);
}

/** What a try at breaking free costs from a turn. */
export const escapeCost = (rules, u, hold) => normalizeCost(rules, rules.escapeCost?.(u, hold) ?? rules.basicAction ?? 1);

/** What freeing a friend costs from a turn. */
export const untieCost = (rules, u, t, hold) => normalizeCost(rules, rules.untieCost?.(u, t, hold) ?? rules.basicAction ?? 1);

/** The hold a friend would free first (bonds before anything else), or null. */
export const freeable = (run, t) => holdsOf(run, t).find(h => h.others) ?? null;
