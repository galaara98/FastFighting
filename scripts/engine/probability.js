/**
 * Exact outcome distributions used by behavior heuristics (the simulation itself rolls dice).
 *
 * Most systems roll a d20. Some roll other dice for the same job (DCC's action dice: a d24 for a giant, a d16 for a
 * second weapon), so the die is an option everywhere: `faces` (default 20). Where a crit or a fumble depends on more
 * than the natural roll alone, `critOn` (a natural this high threatens a crit, as the system reads it for this die)
 * and `fumbleOn` (a natural this low fumbles) ride along to the system's degreeOfSuccess, which decides.
 *
 * `roller`: who rolls. A system whose creatures roll different dice says which (rules.dieOf(roller, kind): Daggerheart's
 * player characters roll the Hope and Fear d12s, its adversaries a d20); that's the roll's `faces` then, a number or the
 * system's own name for its dice, which its roll() and distribution() read. Its roll() also gets the roller.
 */

/** The die `roller` rolls for this kind of roll, by the system (rules.dieOf), else the one given (a d20 by default). */
function facesOf(rules, { roller = null, kind = "check", faces = 20 } = {}) {
  return (roller && rules.dieOf ? rules.dieOf(roller, kind) : null) ?? faces;
}

const cache = new WeakMap(); // rules -> Map(key -> distribution)
const KIND_CODE = { attack: 0, save: 1, check: 2 };

/** Chance the kept die shows `natural`: one die, the higher of two (advantage) or the lower (disadvantage). */
function naturalChance(natural, advantage, faces = 20) {
  if ( advantage > 0 ) return (2 * natural - 1) / (faces * faces);
  if ( advantage < 0 ) return (2 * (faces - natural) + 1) / (faces * faces);
  return 1 / faces;
}

/**
 * Probability of each degree of success for a die + modifier vs dc. Behavior code asks this tens of thousands of
 * times per fight with the same handful of numbers, so results are cached (and must not be mutated).
 * @param {object} rules       System rules providing degreeOfSuccess(natural, total, dc, kind, die)
 * @param {number} modifier
 * @param {number} dc
 * @param {object} [options]
 * @param {number} [options.advantage=0]  +1 advantage, -1 disadvantage
 * @param {string} [options.kind="check"] "attack" | "save" | "check": some systems only crit on attacks
 * @param {number[]} [options.dice]       signed dice rolled with it (5e Bless [4] = +1d4, Bane [-4]; a DCC deed die)
 * @param {number} [options.faces=20]     the die rolled (DCC action dice)
 * @param {number} [options.critOn]       natural that threatens a crit (the system scales it to the die)
 * @param {number} [options.fumbleOn]     natural at or under which it fumbles
 * @returns {readonly number[]}  [critFail, fail, success, critSuccess]
 */
export function degreeDistribution(rules, modifier, dc, options = {}) {
  const { advantage = 0, kind = "check", dice = null, critOn = null, fumbleOn = null, progress = false } = options;
  const faces = facesOf(rules, options);
  let byKey = cache.get(rules);
  if ( !byKey ) cache.set(rules, byKey = new Map());
  // A system with dice of its own (Ironsworn: an action die against two challenge dice) works its chances out itself.
  if ( rules.distribution ) {
    const key = `own|${modifier}|${dc}|${Math.sign(advantage)}|${kind}|${dice?.length ? dice.join(",") : ""}|${progress ? 1 : 0}|${faces}|${critOn ?? ""}`;
    let own = byKey.get(key);
    if ( !own ) byKey.set(key, own = Object.freeze(rules.distribution(modifier, dc, { advantage, kind, dice, progress, faces, critOn })));
    return own;
  }
  const adv = Math.sign(advantage);
  const k = KIND_CODE[kind];
  const plain = faces === 20 && critOn === null && fumbleOn === null;
  const key = plain && !dice?.length && k !== undefined && Number.isInteger(modifier) && Number.isInteger(dc) && Math.abs(modifier) < 500 && Math.abs(dc) < 500
    ? (((k * 3 + adv + 1) * 1000) + dc + 500) * 1000 + modifier + 500
    : `${modifier}|${dc}|${adv}|${kind}|${dice?.length ? dice.join(",") : ""}|${faces}|${critOn ?? ""}|${fumbleOn ?? ""}`;
  let out = byKey.get(key);
  if ( out ) return out;
  out = [0, 0, 0, 0];
  const die = plain ? undefined : { faces, critOn, fumbleOn };
  // Every total the dice can add, each as likely as the others' product.
  let totals = [{ add: 0, p: 1 }];
  for ( const f of dice ?? [] ) {
    const n = Math.max(1, Math.abs(Math.round(f)));
    const next = [];
    for ( const t of totals ) for ( let r = 1; r <= n; r++ ) next.push({ add: t.add + Math.sign(f) * r, p: t.p / n });
    totals = next;
  }
  for ( const { add, p } of totals ) {
    for ( let natural = 1; natural <= faces; natural++ ) {
      out[rules.degreeOfSuccess(natural, natural + modifier + add, dc, kind, die)] += p * naturalChance(natural, adv, faces);
    }
  }
  byKey.set(key, Object.freeze(out));
  return out;
}

/** Roll a check with advantage or disadvantage: {natural, total, degree}. Rules use this unless they roll their own. */
export function rollD20(rules, rng, modifier, dc, { advantage = 0, kind = "check", faces = 20, critOn = null, fumbleOn = null } = {}) {
  let natural = rng.die(faces);
  if ( advantage ) {
    const second = rng.die(faces);
    natural = advantage > 0 ? Math.max(natural, second) : Math.min(natural, second);
  }
  const total = natural + modifier;
  const die = faces === 20 && critOn === null && fumbleOn === null ? undefined : { faces, critOn, fumbleOn };
  return { natural, total, degree: rules.degreeOfSuccess(natural, total, dc, kind, die) };
}

/**
 * Roll a check the system's way: its own roll() if it has one, otherwise a plain die. `options.rolled`: the roll the
 * system made itself in a live battle ({degree, natural, total, dice}), taken as it came out, no dice of the engine's:
 * the rules' `asRolled` makes it theirs (what their own roll would have done with those dice: Daggerheart's Hope or
 * Fear), else it's {natural, total, degree} as it stands.
 */
export function rollCheck(rules, rng, modifier, dc, options = {}) {
  if ( options.rolled ) {
    const own = { ...options, faces: facesOf(rules, options) };
    const r = options.rolled;
    const roll = rules.asRolled?.(r, modifier, dc, own) ?? { natural: r.natural ?? null, total: r.total ?? null, degree: r.degree };
    roll.faces ??= own.faces;
    // (Its card, where the system named it: for the rules to change it the system's way, adjustRoll's.)
    if ( typeof r.card === "string" ) roll.card ??= r.card;
    return roll;
  }
  // A die that rides along (Bless, Bane) is rolled first and simply adds to the modifier, so a system's own roll
  // needs to know nothing about it.
  let extra = 0;
  for ( const f of options.dice ?? [] ) {
    const faces = Math.max(1, Math.abs(Math.round(f)));
    extra += Math.sign(f) * rng.die(faces);
  }
  const mod = modifier + extra;
  const own = { ...options, faces: facesOf(rules, options) };
  const roll = rules.roll ? rules.roll(rng, mod, dc, own) : rollD20(rules, rng, mod, dc, own);
  roll.faces ??= own.faces; // (the die it was, for the log)
  return extra ? { ...roll, die: extra } : roll;
}

/** The degree a check reaches once its total changes (Luck burned after the roll), by the system's rules. */
export function regrade(rules, roll, dc, kind, options = {}) {
  const { critOn = null, fumbleOn = null } = options;
  const faces = facesOf(rules, { ...options, kind });
  const die = faces === 20 && critOn === null && fumbleOn === null ? undefined : { faces, critOn, fumbleOn };
  return rules.degreeOfSuccess(roll.natural, roll.total, dc, kind, die);
}
