/**
 * How hurt a creature looks, called out in the story once it's badly hurt: right after the harm that made it look
 * worse, while it's still up (a fall is told by its own event).
 *
 * A harm event carries the hit points of the one it harmed, before the harm and after it, and its most (hpBefore,
 * hpAfter, maxHp: engine/simulator.js noteHp). It's called out when how that one looks after the harm differs from how
 * it looked before. So a state is told once and never twice running, and told again once it's been healed out of it
 * and falls back in.
 *
 * How it looks, by its share of its most hit points:
 *   the caller's lookup, the story options' healthState(unitId, fraction): a label, {label, hidden}, or null for nothing
 *   to say; undefined, or a lookup that fails, leaves it to the core's bands (foundry/health-estimate.js: the Health
 *   Estimate module's words, where it's on);
 *   else the core's bands (FASTFIGHTING.Health): below half annoyed, below a quarter wounded, below a tenth bloodied,
 *   below 2.5% nearly dead.
 * `hidden`: the players may not learn it, so storyBeats tells it to the GMs alone.
 * Pure apart from reading Foundry's translations (../i18n.js).
 */
import { localize } from "../i18n.js";
import { logTerm } from "./log-lines.js";

/** The core's bands: below this share of its most hit points, its key under FASTFIGHTING.Health (the worst first). */
export const HEALTH_BANDS = Object.freeze([
  Object.freeze({ below: 0.025, key: "nearlyDead" }),
  Object.freeze({ below: 0.1, key: "bloodied" }),
  Object.freeze({ below: 0.25, key: "wounded" }),
  Object.freeze({ below: 0.5, key: "annoyed" })
]);

/** The core's band for a share of hit points (0 to 1): its key, or null (half or more, or none left). */
export function healthBand(fraction) {
  if ( !(fraction > 0) ) return null;
  return HEALTH_BANDS.find(b => fraction < b.below)?.key ?? null;
}

/** How a creature looks by the core's bands, in the reader's language: {label, hidden: false}, or null. */
export function coreHealth(fraction) {
  const key = healthBand(fraction);
  return key ? { label: localize(`FASTFIGHTING.Health.${key}`), hidden: false } : null;
}

/** How a creature looks at this share of its hit points: by the caller's lookup, else the core's bands; or null. */
function looks(unitId, fraction, healthState) {
  if ( typeof healthState === "function" ) {
    try {
      const said = healthState(unitId, fraction);
      if ( said === null ) return null;
      if ( typeof said === "string" && said ) return { label: said, hidden: false };
      if ( typeof said?.label === "string" && said.label ) return { label: said.label, hidden: !!said.hidden };
    } catch ( err ) {
      // (A lookup that fails: the core's bands.)
    }
  }
  return coreHealth(fraction);
}

/** The one a harm event harmed: {id, name, before, after} (shares of its most hit points), or null. */
function harmedBy(e) {
  if ( !e || !Number.isFinite(e.hpBefore) || !Number.isFinite(e.hpAfter) || !(e.maxHp > 0) ) return null;
  const id = e.targetId ?? e.actorId;
  if ( !id ) return null;
  return { id, name: (e.targetId ? e.target : e.actor) ?? "", before: e.hpBefore / e.maxHp, after: e.hpAfter / e.maxHp };
}

/**
 * What a harm event calls out: {id, name, label, hidden, fraction} (the one harmed, how it looks now, whether the players
 * may learn it, its share of its hit points), or null.
 */
export function healthCallout(e, healthState = null) {
  const h = harmedBy(e);
  if ( !h || !(h.after > 0) || !(h.after < h.before) ) return null;
  const now = looks(h.id, h.after, healthState);
  if ( !now ) return null;
  if ( looks(h.id, h.before, healthState)?.label === now.label ) return null;
  return { id: h.id, name: h.name, label: now.label, hidden: now.hidden, fraction: h.after };
}

/** Every callout in a log: event -> its callout. */
export function healthCallouts(log = [], healthState = null) {
  const out = new Map();
  for ( const e of log ?? [] ) {
    const c = healthCallout(e, healthState);
    if ( c ) out.set(e, c);
  }
  return out;
}

/** A callout as the Statistician's log has it ("Wolf: Wounded (24% HP)"): its share of hit points, rounded down. */
export function healthLine(c) {
  return logTerm("HealthState", { target: c.name, state: c.label, n: Math.max(1, Math.floor(c.fraction * 100)) });
}
