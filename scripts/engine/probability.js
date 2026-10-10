/**
 * Exact d20 outcome distributions used by behavior heuristics (the simulation itself rolls dice).
 */

/**
 * Probability of each degree of success for d20 + modifier vs dc.
 * @param {object} rules       System rules providing degreeOfSuccess(natural, total, dc)
 * @returns {number[]}         [critFail, fail, success, critSuccess]
 */
export function degreeDistribution(rules, modifier, dc) {
  const out = [0, 0, 0, 0];
  for ( let natural = 1; natural <= 20; natural++ ) {
    out[rules.degreeOfSuccess(natural, natural + modifier, dc)] += 0.05;
  }
  return out;
}
