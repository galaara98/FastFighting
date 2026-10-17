/**
 * A character's traits (tactical, brave, selfish, loyal) put together from where they start and everything that moves
 * them, for a system helper's deriveTraits (core-api): its stats, class, upbringing, outlook, feats and the rest, a
 * little each. Each part carries the reason it's shown with, so the planner's tooltip on a trait adds up: "player
 * character 75, Will for its level +6, criminal -8". A player character starts from PC_BASELINE (constants.js), the
 * usual hero's, so its own numbers move it from there.
 */
import { TRAITS, clamp } from "../constants.js";
import { localize, listItems, language } from "../i18n.js";

/** A whole number with its sign, as the reader's language writes it ("+8", "-3"). */
export function signedNumber(n) {
  const v = Math.round(Number(n) || 0);
  try {
    return new Intl.NumberFormat(language(), { signDisplay: "exceptZero", maximumFractionDigits: 0 }).format(v);
  } catch ( err ) {
    return v > 0 ? `+${v}` : `${v}`;
  }
}

/** Parts from a leaning ({trait: n}: a class's, a playstyle's), each with the reason it's shown with. */
export const partsOf = (lean, why, scale = 1) => Object.entries(lean ?? {}).map(([trait, n]) => ({ trait, n: n * scale, why }));

/**
 * The traits, from where they start and the parts that move them.
 * @param {Record<string, number>} base   where each trait starts (PC_BASELINE for a player character)
 * @param {{trait: string, n: number, why: string}[]} parts   what moves a trait and why; a part that rounds to nothing
 *        isn't shown, and parts with the same reason are shown as one
 * @param {object} [options]
 * @param {string|Record<string, string>} [options.from]   the reason for where they start ("player character"), shown
 *        first with the starting number
 * @param {Record<string, string>} [options.lead]   reasons shown before all of these (a helper's own, read elsewhere)
 * @param {number} [options.min=5]
 * @param {number} [options.max=95]
 * @returns {{traits: Record<string, number>, reasons: Record<string, string>}}
 */
export function traitsFromParts(base, parts = [], { from = null, lead = null, min = 5, max = 95 } = {}) {
  const traits = {};
  const reasons = {};
  const item = (why, n) => localize("FASTFIGHTING.Words.Part", { why, n });
  for ( const k of TRAITS ) {
    const start = Number(base?.[k] ?? 50);
    const mine = (parts ?? []).filter(p => p?.trait === k && Number.isFinite(Number(p.n)));
    traits[k] = Math.round(clamp(start + mine.reduce((sum, p) => sum + Number(p.n), 0), min, max));
    const byWhy = new Map();
    for ( const p of mine ) if ( p.why ) byWhy.set(p.why, (byWhy.get(p.why) ?? 0) + Number(p.n));
    const shown = [...byWhy].filter(([, n]) => Math.round(n) !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const startWhy = typeof from === "string" ? from : from?.[k];
    reasons[k] = listItems([
      ...(startWhy ? [item(startWhy, Math.round(start))] : []),
      ...shown.map(([why, n]) => item(why, signedNumber(n)))
    ]);
    if ( lead?.[k] ) reasons[k] = listItems([lead[k], reasons[k]].filter(Boolean));
  }
  return { traits, reasons };
}
