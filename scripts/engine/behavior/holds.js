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
 *   rules.breakFree(run, who, hold, {freeing, held})  the system's own try, by `who`: for itself, or (freeing) for
 *                                          `held`, the friend it frees. Returns {success, degree, natural, mod, total,
 *                                          dc, said: {text}} (the numbers only for a d20 against a DC; the system's own
 *                                          words in said), or null (the core's)
 *   spec.escapeWork {mod, faces}           a creature's best way out, as a check
 *   spec.escapeDC                          how hard a grab of this creature's is to break
 *   action.hands, rules.handsKnown         how many free hands an action needs (0: none, a spell with no gesture, a
 *                                          bite); handsKnown: the helper says it of every action
 *   rules.tiedStopsSpells                  without handsKnown: whether tied up stops a spell (the helper's setting;
 *                                          by default it does)
 *   rules.remedies(run, u)                 what else bothers u that an action ends (remediesOf)
 *   rules.persistentRemedy(run, u, type)   the system's own try at ending persistent harm of a type ({success, said}),
 *   rules.persistentRemedyCost(u, type)    and what it costs (default: one more recovery roll, for the basic action)
 * Tied up, a creature can't move, nor use what needs hands (needsHands); talking it always can. What it could still do
 * from its bonds weighs against getting loose (desire.js holdWishes): one willing to suffer them may not struggle. And
 * any creature may bear what holds or hurts it, for a turn, as selfless as it is (bears: the world's slider).
 * Pure: no Foundry globals.
 */
import { STATUS, IGNORE_TROUBLES } from "../../constants.js";
import { typical, isMagical, liveTrait } from "../battle-state.js";
import { createRng, deriveSeed } from "../rng.js";
import { meanPart } from "../dice.js";
import { rollCheck } from "../probability.js";
import { recompute } from "./effects.js";
import { normalizeCost } from "../turn.js";

/**
 * What a hold keeps in place with it (a grab or restraints: can't move), cleared when it's broken unless another hold
 * still does it. A hold may name its own (hold.with, effect.escape.with: the system's).
 */
const WITH = Object.freeze({ grabbed: Object.freeze(["immobilized"]), restrained: Object.freeze(["immobilized"]) });

/** Without a roll to make: how often a try gets loose (a grab, as the engine always had it; bonds, harder). */
export const ESCAPE_CHANCE = Object.freeze({ grabbed: 0.5, bound: 0.35, other: 0.4 });
/** How much harder improvised bonds are than the system's typical DC for the creature's level. */
const BONDS_HARDER = 2;

/**
 * Does this action need free hands? What the helper says (action.hands); a helper that says it of every action
 * (rules.handsKnown): none it didn't mark. Otherwise a spell as the helper's setting says (rules.tiedStopsSpells, by
 * default it does), a natural attack (a bite, a claw) none, and anything else (a weapon, a manipulation) hands.
 */
export function needsHands(rules, action) {
  if ( Number.isFinite(action?.hands) ) return action.hands > 0;
  if ( rules?.handsKnown ) return false;
  if ( isMagical(action) ) return rules?.tiedStopsSpells !== false;
  return !action?.natural;
}

/** Is it tied up? (A battle kept before u.bound was: whoever tied it.) */
export const isBound = u => !!(u.bound ?? u.boundBy);

/** How hard FastFighting's improvised bonds are to slip, for this creature (the system's say, or a typical DC). */
export function bondsDC(run, u) {
  const rules = run.prep?.rules ?? {};
  return rules.bondsDC?.(u) ?? typical(rules, "dc", u.spec.level ?? 0) + BONDS_HARDER;
}

const dcOf = v => (Number.isFinite(v) ? v : null);

/**
 * Every hold on u that an action breaks: [{key, byId, dc (null: none known), others, label, effectKey?, sheet?}]. A
 * condition can be held by more than one thing (a web and a grab): each is its own.
 */
export function holdsOf(run, u) {
  const rules = run.prep?.rules ?? {};
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
      out.push({ key, byId: e.sourceId ?? null, dc: dcOf(e.escape.dc), others: e.escape.others ?? null, with: e.escape.with ?? null, label: e.label || null, effectKey: e.key });
    }
  }
  // (The system's own: on the sheet with nothing of the engine's behind it, and any other it knows.)
  if ( typeof rules.escapeFrom === "function" ) {
    for ( const [key, v] of Object.entries(u.baseConds ?? {}) ) {
      if ( !(Number(v) > 0) || out.some(h => h.key === key) ) continue;
      const h = rules.escapeFrom(run, u, key);
      if ( h ) out.push({ key, byId: h.byId ?? null, dc: dcOf(h.dc), others: h.others ?? null, with: h.with ?? null, label: h.label ?? null, sheet: true });
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
export function tryHold(run, who, hold, { freeing = false, held = null } = {}) {
  const rules = run.prep?.rules ?? {};
  const own = typeof rules.breakFree === "function" ? rules.breakFree(run, who, hold, { freeing, held: held ?? (freeing ? null : who) }) : null;
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

/**
 * The hold is broken: u is free of it (and of its condition, where that's all the hold was), and of what it kept in
 * place with it (WITH, hold.with), unless another hold still keeps it so.
 */
export function release(run, u, hold) {
  const along = [...new Set([...(WITH[hold.key] ?? []), ...(hold.with ?? [])])];
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
  if ( along.length ) {
    recompute(u);
    const still = new Set(holdsOf(run, u).flatMap(h => [...(WITH[h.key] ?? []), ...(h.with ?? [])]));
    for ( const k of along.filter(k => !still.has(k)) ) {
      if ( u.baseConds ) delete u.baseConds[k];
      u.effects = (u.effects ?? []).flatMap(e => {
        if ( !(k in (e.conditions ?? {})) || !(e.key === hold.effectKey || e.key === "gm:grabbed") ) return [e];
        const conditions = { ...e.conditions };
        delete conditions[k];
        return Object.keys(conditions).length || e.mods ? [{ ...e, conditions }] : [];
      });
    }
  }
  recompute(u);
}

/** What a try at breaking free costs from a turn. */
export const escapeCost = (rules, u, hold) => normalizeCost(rules, rules.escapeCost?.(u, hold) ?? rules.basicAction ?? 1);

/** What freeing a friend costs from a turn. */
export const untieCost = (rules, u, t, hold) => normalizeCost(rules, rules.untieCost?.(u, t, hold) ?? rules.basicAction ?? 1);

/**
 * What else bothers u that an action can end (its remedies), besides what holds it: persistent harm (a burn, a bleed,
 * acid: by default an action for one more try at the system's recovery, rolling on the ground, pressing the wound) and
 * whatever the system says a remedy ends (rules.remedies(run, u): [{key, cost, annoyance, label, try(run, u) ->
 * {success, said}}]: PF2e Retch for sickened, a lower DC for fire). Each with how badly it bothers u (annoyance, 0-100:
 * persistent harm by what it takes each round, of what u has), what a try costs, and the try.
 */
export function remediesOf(run, u) {
  const rules = run.prep?.rules ?? {};
  const out = [];
  if ( u.persistent?.length && typeof rules.persistentFlatCheck === "function" ) {
    const byType = new Map();
    for ( const e of u.persistent ) byType.set(e.part.type, (byType.get(e.part.type) ?? 0) + Math.max(0, meanPart(e.part)));
    for ( const [type, each] of byType ) {
      const share = u.maxHp > 0 ? each / u.maxHp : 1;
      out.push({
        key: `persistent:${type}`, type, label: type, annoyance: Math.min(85, REMEDY.pain + REMEDY.painShare * share),
        cost: normalizeCost(rules, rules.persistentRemedyCost?.(u, type) ?? rules.basicAction ?? 1),
        try: (r, v) => {
          const ok = rules.persistentRemedy ? rules.persistentRemedy(r, v, type) : { success: rules.persistentFlatCheck(r.rng) };
          if ( ok?.success ) v.persistent = v.persistent.filter(e => e.part.type !== type);
          return ok ?? { success: false };
        }
      });
    }
  }
  for ( const r of (typeof rules.remedies === "function" ? rules.remedies(run, u) : null) ?? [] ) {
    if ( r?.key && typeof r.try === "function" ) out.push({ annoyance: REMEDY.other, ...r, cost: normalizeCost(rules, r.cost ?? rules.basicAction ?? 1) });
  }
  return out;
}

/** Would the harm it's under (persistent: a burn, a bleed) take it to nothing this round? */
const deadly = u => (u.persistent ?? []).reduce((n, e) => n + Math.max(0, meanPart(e.part)), 0) >= (u.hp ?? 0) + (u.temp ?? 0);

/** How badly a remedy-able thing bothers a creature, before its personality: persistent harm, by what it takes. */
export const REMEDY = Object.freeze({ pain: 30, painShare: 150, other: 35 });

/**
 * Does u bear what holds or hurts it this turn (not trying to be rid of it)? A d100 of its own (the fight's dice
 * untouched) at or under the world's slider (ignoreTroubles) times how selfless it is, less the more calculating: all
 * of it for a fully selfless creature, none for a wholly selfish or calculating one. Decided once a turn.
 */
export function bears(run, u) {
  // (Even the selfless don't want to die: harm that would drop it this round is never borne.)
  if ( deadly(u) ) return false;
  const key = `${run.round ?? 0}|${run.turn ?? 0}`;
  if ( u.bearsAt === key ) return !!u.bearing;
  const chance = (run.prep?.options?.ignoreTroubles ?? IGNORE_TROUBLES) * ((100 - liveTrait(run, u, "selfish")) / 100) * ((100 - liveTrait(run, u, "tactical")) / 100);
  const seed = deriveSeed(((run.seed ?? run.live?.seed ?? 1) >>> 0), 104729 * (run.round ?? 0) + 7919 * (run.turn ?? 0) + run.units.indexOf(u) + 1);
  u.bearsAt = key;
  u.bearing = chance > 0 && createRng(seed).die(100) <= chance;
  return u.bearing;
}

/** The hold a friend would free first (bonds before anything else), or null. */
export const freeable = (run, t) => holdsOf(run, t).find(h => h.others) ?? null;
