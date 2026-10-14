/**
 * Strain: words that wear a creature down. Some systems drain a resource when talking goes against someone (a pool
 * of composure, focus, stamina or resolve): whoever loses an exchange pays, the talker when its pitch fails (more on
 * a critical failure), the one it talks to when the pitch gets through (more on a critical success).
 *
 * The system says so for everyone (rules.talkStrain: the settings, or a function of the unit giving them), or for one
 * creature (spec.social.strain, which wins). The settings:
 *   pool     the resources key it drains (spec.resources[pool]); a creature without it loses nothing
 *   amount   how much a loss costs (1)
 *   crit     how much a critical costs (twice the amount)
 *   label    the system's word for the pool, for the log (else the key)
 *   empty    an outcome laid on it when the pool runs dry (behavior/effects.js: {conditions, mods, rounds, label}),
 *            worn down: Daggerheart-style vulnerability, a penalty, ...
 * A system that wants more (a price beyond the pool, a gain on a win) has rules.afterTalk as well.
 * Pure: no Foundry globals.
 */
import { STATUS } from "../../constants.js";
import { applyOutcome } from "./effects.js";

/** u's strain settings, made whole, or null if words don't wear it down. */
export function strainOf(run, u) {
  const said = u.spec.social?.strain ?? run.prep.rules.talkStrain ?? null;
  const s = typeof said === "function" ? said(u) : said;
  if ( !s || typeof s !== "object" || typeof s.pool !== "string" || !s.pool ) return null;
  const amount = Number.isFinite(Number(s.amount)) ? Math.max(0, Number(s.amount)) : 1;
  const crit = Number.isFinite(Number(s.crit)) ? Math.max(0, Number(s.crit)) : amount * 2;
  return { pool: s.pool, amount, crit, label: s.label ?? s.pool, empty: s.empty && typeof s.empty === "object" ? s.empty : null };
}

/**
 * u lost an exchange of words with `by` (critically, or not): its pool drains, and run dry, it's worn down.
 * Returns what it lost.
 */
export function strain(run, u, by, critical, log) {
  const s = strainOf(run, u);
  if ( !s || u.status !== STATUS.STANDING ) return 0;
  const had = Number(u.resources[s.pool]) || 0;
  const lost = Math.min(had, critical ? s.crit : s.amount);
  if ( !(lost > 0) ) return 0;
  u.resources[s.pool] = had - lost;
  const empty = u.resources[s.pool] <= 0;
  if ( empty && s.empty ) applyOutcome(u, { label: s.label, ...s.empty }, by.id, { id: `strain:${s.pool}`, name: s.label });
  if ( run.log ) log(u, {
    type: "strain", pool: s.pool, label: s.label, lost, left: u.resources[s.pool], target: by.spec.name, targetId: by.id, critical: !!critical,
    empty, conditions: empty ? Object.keys(s.empty?.conditions ?? {}).filter(k => s.empty.conditions[k]) : []
  });
  return lost;
}
