/**
 * Exact d20 outcome distributions used by behavior heuristics (the simulation itself rolls dice).
 */

const cache = new WeakMap(); // rules -> Map(key -> distribution)

/** Chance the kept d20 shows `natural`: one die, the higher of two (advantage) or the lower (disadvantage). */
function naturalChance(natural, advantage) {
  if ( advantage > 0 ) return (2 * natural - 1) / 400;
  if ( advantage < 0 ) return (41 - 2 * natural) / 400;
  return 0.05;
}

/**
 * Probability of each degree of success for d20 + modifier vs dc. Behavior code asks this tens of thousands of
 * times per fight with the same handful of numbers, so results are cached (and must not be mutated).
 * @param {object} rules       System rules providing degreeOfSuccess(natural, total, dc, kind)
 * @param {number} modifier
 * @param {number} dc
 * @param {object} [options]
 * @param {number} [options.advantage=0]  +1 advantage, -1 disadvantage
 * @param {string} [options.kind="check"] "attack" | "save" | "check": some systems only crit on attacks
 * @param {number[]} [options.dice]       signed dice rolled with it (5e Bless [4] = +1d4, Bane [-4])
 * @returns {readonly number[]}  [critFail, fail, success, critSuccess]
 */
export function degreeDistribution(rules, modifier, dc, { advantage = 0, kind = "check", dice = null } = {}) {
  let byKey = cache.get(rules);
  if ( !byKey ) cache.set(rules, byKey = new Map());
  const adv = Math.sign(advantage);
  const key = `${modifier}|${dc}|${adv}|${kind}|${dice?.length ? dice.join(",") : ""}`;
  let out = byKey.get(key);
  if ( out ) return out;
  out = [0, 0, 0, 0];
  // Every total the dice can add, each as likely as the others' product.
  let totals = [{ add: 0, p: 1 }];
  for ( const f of dice ?? [] ) {
    const faces = Math.max(1, Math.abs(Math.round(f)));
    const next = [];
    for ( const t of totals ) for ( let r = 1; r <= faces; r++ ) next.push({ add: t.add + Math.sign(f) * r, p: t.p / faces });
    totals = next;
  }
  for ( const { add, p } of totals ) {
    for ( let natural = 1; natural <= 20; natural++ ) {
      out[rules.degreeOfSuccess(natural, natural + modifier + add, dc, kind)] += p * naturalChance(natural, adv);
    }
  }
  byKey.set(key, Object.freeze(out));
  return out;
}

/** Roll a d20 check with advantage or disadvantage: {natural, total, degree}. Rules use this unless they roll their own. */
export function rollD20(rules, rng, modifier, dc, { advantage = 0, kind = "check" } = {}) {
  let natural = rng.d20();
  if ( advantage ) {
    const second = rng.d20();
    natural = advantage > 0 ? Math.max(natural, second) : Math.min(natural, second);
  }
  const total = natural + modifier;
  return { natural, total, degree: rules.degreeOfSuccess(natural, total, dc, kind) };
}

/** Roll a check the system's way: its own roll() if it has one, otherwise a plain d20. */
export function rollCheck(rules, rng, modifier, dc, options = {}) {
  // A die that rides along (Bless, Bane) is rolled first and simply adds to the modifier, so a system's own roll
  // needs to know nothing about it.
  let extra = 0;
  for ( const f of options.dice ?? [] ) {
    const faces = Math.max(1, Math.abs(Math.round(f)));
    extra += Math.sign(f) * rng.die(faces);
  }
  const mod = modifier + extra;
  const roll = rules.roll ? rules.roll(rng, mod, dc, options) : rollD20(rules, rng, mod, dc, options);
  return extra ? { ...roll, die: extra } : roll;
}
