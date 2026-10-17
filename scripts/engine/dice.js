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

/**
 * Parse a display formula such as "2 * (1d6 + 4) + 1d8 piercing + 1d4 persistent poison" (the format PF2e's
 * DamageRoll#formula produces) into DamageParts. Each run of arithmetic followed by type words is one part.
 * Multiplication by a constant is supported (dice keep a `mult`).
 */
export function parseTypedFormula(formula, defaultType = "untyped") {
  // (A die with no count before it, "d8": one of them, as parseFormula reads it.)
  const tokens = (String(formula ?? "").replace(/\[([^\]]*)\]/g, " $1 ").replace(/,/g, " ")
    .match(/\d*d\d+|\d+(?:\.\d+)?|[a-z][a-z-]*|[()+\-*/]/gi) ?? []).map(t => (/^d\d+$/i.test(t) ? `1${t}` : t));
  const parts = [];
  let expr = [];
  let words = [];
  const flush = () => {
    if ( !expr.length ) { words = []; return; }
    while ( expr.length && /^[+\-*/]$/.test(expr.at(-1)) ) expr.pop();
    const lin = evaluateLinear(expr);
    const persistent = words.includes("persistent");
    const category = words.includes("precision") ? "precision" : words.includes("splash") ? "splash" : null;
    const type = words.filter(w => !["persistent", "precision", "splash", "damage"].includes(w)).at(-1) ?? defaultType;
    if ( lin ) parts.push({ dice: lin.dice, flat: lin.flat, type, persistent, category });
    expr = [];
    words = [];
  };
  for ( let i = 0; i < tokens.length; i++ ) {
    const tok = tokens[i];
    if ( /^[a-z]/i.test(tok) && !/^\d+d\d+$/i.test(tok) ) {
      words.push(tok.toLowerCase());
      // A "+" after type words starts the next part.
      if ( tokens[i + 1] === "+" ) { flush(); i++; }
      continue;
    }
    if ( words.length ) flush();
    expr.push(tok);
  }
  flush();
  return parts;
}

/** Evaluate +,-,*,/ and parentheses over dice and numbers into {dice:[{n,faces,mult}], flat}. */
function evaluateLinear(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const scale = (v, k) => ({ dice: v.dice.map(d => ({ ...d, mult: (d.mult ?? 1) * k })), flat: v.flat * k });
  const add = (a, b, sign = 1) => ({ dice: a.dice.concat(sign === 1 ? b.dice : scale(b, -1).dice), flat: a.flat + sign * b.flat });
  const isConst = v => !v.dice.length;
  function primary() {
    const tok = tokens[pos++];
    if ( tok === "(" ) {
      const v = sum();
      if ( peek() === ")" ) pos++;
      return v;
    }
    if ( tok === "-" ) return scale(primary(), -1);
    const dm = /^(\d+)d(\d+)$/i.exec(tok ?? "");
    if ( dm ) return { dice: [{ n: Number(dm[1]), faces: Number(dm[2]), mult: 1 }], flat: 0 };
    const num = Number(tok);
    return { dice: [], flat: Number.isFinite(num) ? num : 0 };
  }
  function product() {
    let v = primary();
    while ( peek() === "*" || peek() === "/" ) {
      const op = tokens[pos++];
      const r = primary();
      if ( op === "*" ) v = isConst(v) ? scale(r, v.flat) : scale(v, isConst(r) ? r.flat : 1);
      else if ( isConst(r) && r.flat ) v = scale(v, 1 / r.flat);
    }
    return v;
  }
  function sum() {
    let v = product();
    while ( peek() === "+" || peek() === "-" ) {
      const op = tokens[pos++];
      v = add(v, product(), op === "+" ? 1 : -1);
    }
    return v;
  }
  if ( !tokens.length ) return null;
  return sum();
}

/** The most dice of one kind rolled at once (as Foundry has it): a formula's "9999999d6" is read as this many. */
export const MAX_DICE = 999;

export function samplePart(p, rng) {
  let total = p.flat;
  for ( const { n, faces, mult = 1 } of p.dice ) {
    const count = Math.min(Math.abs(n), MAX_DICE);
    let sum = 0;
    for ( let i = 0; i < count; i++ ) sum += rng.die(faces);
    total += (n < 0 ? -sum : sum) * mult;
  }
  return Math.floor(total);
}

export function meanPart(p) {
  return p.flat + p.dice.reduce((s, { n, faces, mult = 1 }) => s + (n * mult * (faces + 1)) / 2, 0);
}

export function maxPart(p) {
  return p.flat + p.dice.reduce((s, { n, faces, mult = 1 }) => s + (n > 0 ? n * faces : n) * mult, 0);
}

/** Sample a list of parts; returns {byType: {type: amount}, persistent: DamagePart[]}. Each roll is at least 0. */
export function sampleDamage(parts, rng, multiplier = 1) {
  const byType = {};
  const persistent = [];
  let direct = parts.length > 0;
  for ( const p of parts ) {
    if ( p.persistent ) { persistent.push(p); continue; }
    const amount = Math.max(0, Math.floor(samplePart(p, rng) * multiplier));
    byType[p.type] = (byType[p.type] ?? 0) + amount;
    // (Direct damage, every part of it: Daggerheart's, no Armor Slot for it. The system's applyIwr is told.)
    if ( !p.direct ) direct = false;
  }
  return { byType, persistent, direct };
}

export function meanDamage(parts, multiplier = 1) {
  return parts.reduce((s, p) => s + (p.persistent ? meanPart(p) * 2 : Math.max(0, meanPart(p) * multiplier)), 0);
}

/** Double every part (used when a system gives no explicit critical formula). */
export function doubled(parts) {
  return parts.map(p => ({ ...p, dice: p.dice.map(d => ({ ...d, mult: (d.mult ?? 1) * 2 })), flat: p.flat * 2 }));
}
