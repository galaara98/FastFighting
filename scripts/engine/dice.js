/**
 * Compiled dice. Adapters turn system formulas into DamagePart lists once; the simulator samples them
 * thousands of times without touching Foundry's Roll class.
 *
 * @typedef {object} DamagePart
 * @property {{n: number, faces: number}[]} dice
 * @property {number} flat
 * @property {string} type            Damage type slug ("slashing", "fire", "healing" ...)
 * @property {boolean} [persistent]   Applied at end of the target's turn until removed
 * @property {string} [category]      "precision" | "splash" | null
 */

export function part(dice = [], flat = 0, type = "untyped", extra = {}) {
  return { dice, flat, type, persistent: false, category: null, ...extra };
}

const TERM = /([+-])?\s*(\d*)d(\d+)|([+-])?\s*(\d+)(?!\s*d)/gi;

/**
 * Parse a plain arithmetic dice formula such as "2d6+4", "1d8 + 1d6 - 1".
 * Bracketed flavor like "[fire]" and parentheses are stripped. Returns a single DamagePart.
 */
export function parseFormula(formula, type = "untyped") {
  const clean = String(formula ?? "").replace(/\[[^\]]*\]/g, "").replace(/[()]/g, "").replace(/\s+/g, "");
  const p = part([], 0, type);
  for ( const m of clean.matchAll(TERM) ) {
    if ( m[3] ) {
      const sign = m[1] === "-" ? -1 : 1;
      const n = (m[2] === "" ? 1 : Number(m[2])) * sign;
      p.dice.push({ n, faces: Number(m[3]) });
    } else if ( m[5] ) {
      p.flat += (m[4] === "-" ? -1 : 1) * Number(m[5]);
    }
  }
  return p;
}

export function samplePart(p, rng) {
  let total = p.flat;
  for ( const { n, faces } of p.dice ) {
    const count = Math.abs(n);
    let sum = 0;
    for ( let i = 0; i < count; i++ ) sum += rng.die(faces);
    total += n < 0 ? -sum : sum;
  }
  return total;
}

export function meanPart(p) {
  return p.flat + p.dice.reduce((s, { n, faces }) => s + (n * (faces + 1)) / 2, 0);
}

export function maxPart(p) {
  return p.flat + p.dice.reduce((s, { n, faces }) => s + (n > 0 ? n * faces : n), 0);
}

export function variancePart(p) {
  return p.dice.reduce((s, { n, faces }) => s + Math.abs(n) * ((faces * faces - 1) / 12), 0);
}

/** Sample a list of parts; returns {byType: {type: amount}, persistent: DamagePart[]}. Minimum 1 per non-persistent roll. */
export function sampleDamage(parts, rng, multiplier = 1) {
  const byType = {};
  const persistent = [];
  for ( const p of parts ) {
    if ( p.persistent ) { persistent.push(p); continue; }
    const amount = Math.max(0, Math.floor(samplePart(p, rng) * multiplier));
    byType[p.type] = (byType[p.type] ?? 0) + amount;
  }
  return { byType, persistent };
}

export function meanDamage(parts, multiplier = 1) {
  return parts.reduce((s, p) => s + (p.persistent ? meanPart(p) * 2 : Math.max(0, meanPart(p) * multiplier)), 0);
}

/** Double every part (used when a system gives no explicit critical formula). */
export function doubled(parts) {
  return parts.map(p => ({ ...p, dice: p.dice.map(d => ({ ...d, n: d.n * 2 })), flat: p.flat * 2 }));
}
