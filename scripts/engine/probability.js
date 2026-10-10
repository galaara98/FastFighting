/**
 * Exact d20 outcome distributions used by behavior heuristics (the simulation itself rolls dice).
 */

const cache = new WeakMap(); // rules -> Map(modifier/dc key -> distribution)

/**
 * Probability of each degree of success for d20 + modifier vs dc. Behavior code asks this tens of thousands of
 * times per fight with the same handful of numbers, so results are cached (and must not be mutated).
 * @param {object} rules       System rules providing degreeOfSuccess(natural, total, dc)
 * @returns {readonly number[]}  [critFail, fail, success, critSuccess]
 */
export function degreeDistribution(rules, modifier, dc) {
  let byKey = cache.get(rules);
  if ( !byKey ) cache.set(rules, byKey = new Map());
  const key = `${modifier}|${dc}`;
  let out = byKey.get(key);
  if ( out ) return out;
  out = [0, 0, 0, 0];
  for ( let natural = 1; natural <= 20; natural++ ) {
    out[rules.degreeOfSuccess(natural, natural + modifier, dc)] += 0.05;
  }
  byKey.set(key, Object.freeze(out));
  return out;
}
