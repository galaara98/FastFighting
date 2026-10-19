/**
 * Table rolls: the dice FastFighting rolls itself for what a person would roll at the table (damage and healing, an
 * attack, a save or a check, a flat check, a recharge, a recovery check, Luck, a crit or fumble table, an Ironsworn
 * move), kept so a live battle can show them in the chat as the rolls they are. Never the Statistics Engine's own
 * randoms: its choices, a fight it imagines, its model of morale or of luck, anything only it needs.
 *
 * Only a live battle's dice record. Its turns (engine/live.js nextDice) roll with a recording rng: the very dice the
 * plain one rolls, the same calls in the same order, each also noted on a tape as it falls. A simulation's rng (and a
 * plan's, a sample fight's, the Battle Vantage's odds) is a plain one, so it records nothing and costs nothing.
 *
 * A table roll claims the dice it rolled from the tape, from where the tape stood before them, with what it was:
 *   const at = diceAt(run);                       // where the tape is now; -1 where nothing records
 *   ... the dice ...
 *   if ( at >= 0 ) tableRoll(run, at, {by, kind, label, mod, total, dc});
 * A die is claimed once: a roll inside another's claims its own dice first, the outer one only what's left. Dice no
 * table roll claims (the engine's own d100s, a d20 that only orders a simulation) are never shown. A roll with no dice
 * is none, but for a heal of so many hit points (API 21: its `parts`' numbers, PF2e Lay on Hands' 6): the table sees it
 * as it sees any heal, who got how much.
 *
 * A helper's rules hear only the rng (rules.recoveryCheck(unit, rng)): `rng.mark?.()` and `rng.record?.(at, roll)` do
 * the same, and nothing where nothing records (an older core, a simulation).
 *
 * A roll: {by, target, kind, label, what, action, stat, source, mod, total, dc, natural, degree, dice: [{faces, result}],
 * groups, rolls, multiplier, crit}. `by` and `target` are creature ids. `kind`: attack, save, check, flat, damage,
 * healing, recharge or other. `label`: what it was for, in words the fight already has (an action's name, a helper's
 * words); else `what`, a key the Foundry side words (FASTFIGHTING.Rolls.What). `action`: the id of the action it was
 * for, where there is one (a helper's own id: its item, for the system's card); `stat`: a save's key (the rules' own:
 * "reflex"); `source`: what a damage roll's blow was, "attack" or "save", where it says. `groups` say how its dice read
 * as a formula (shapeOf: from the `parts`, `extras`, `split`, `keep` or `each` it's recorded with; a damage part's
 * groups say its `type`, `category` and which `part` they are), `rolls` each of its rolls' modifier and total where it
 * shows as several.
 *
 * Shown by the system (API 20): a live battle may show a roll as its system's own card (the helper's showTableRoll),
 * and a damage roll the engine deals in a turn it plays as the system's damage card, applied the system's way
 * (simulator.js engineCard: engine/live.js systemRoll "card"). Those, and every roll still waiting before it, are marked
 * `shown` (markShown; a damage card's id as `card`) and never posted again.
 * Pure: no Foundry globals.
 */
import { MAX_DICE } from "./dice.js";

/** The kinds of table roll, as the chat words them (FASTFIGHTING.Rolls.Kind). */
export const ROLL_KINDS = Object.freeze(["attack", "save", "check", "flat", "damage", "healing", "recharge", "other"]);

/**
 * A recording rng: `rng` as it is (every roll the same), its dice also on a tape, with mark() and record(at, roll) for
 * table rolls to claim them, and a tray of the rolls recorded (takeRolls).
 */
export function recordingRng(rng) {
  if ( rng?.tray ) return rng;
  const tray = { tape: [], rolls: [] };
  const die = faces => {
    const result = rng.die(faces);
    tray.tape.push({ faces, result, claimed: false });
    return result;
  };
  return {
    ...rng,
    // (rng.d20() is rng.die(20): the same draw, the same die.)
    die,
    d20: () => die(20),
    tray,
    mark: () => tray.tape.length,
    record: (at, roll) => claim(tray, at, roll)
  };
}

/** Where the run's tape stands (for a table roll about to roll), or -1 where nothing records. */
export const diceAt = run => run?.rng?.mark?.() ?? -1;

/** The dice rolled since `at`, claimed as a table roll (see the header). Returns the roll recorded, or null. */
export function tableRoll(run, at, roll) {
  return run?.rng?.record?.(at, roll) ?? null;
}

/** The table rolls recorded since the last take (the live side's, to show), taken. */
export function takeRolls(run) {
  return run?.rng?.tray?.rolls.splice(0) ?? [];
}

/** How many table rolls are waiting to be taken (where a fate's reroll begins: markRerolled). */
export const rollsWaiting = run => run?.rng?.tray?.rolls.length ?? 0;

/** The table rolls recorded and not yet shown (where a roll the system shows now begins: simulator.js engineCard). */
export const pendingRolls = run => (run?.rng?.tray?.rolls ?? []).filter(r => !r.shown);

/** Rolls the system has shown already (its own cards): never posted again. */
export function markShown(rolls) {
  for ( const r of rolls ?? [] ) r.shown = true;
}

/** The rolls since `from` were taken back by a reroll (fate, a Hero Point): still shown, as rerolled. */
export function markRerolled(run, from) {
  for ( const r of run?.rng?.tray?.rolls.slice(from) ?? [] ) r.rerolled = true;
}

/** A creature (or its id), as its id. */
const idOf = u => (u && typeof u === "object" ? u.id ?? null : u ?? null);

/** A heal of so many hit points, no dice (PF2e Lay on Hands' 6): its parts' flat numbers, more than none. */
const flatHeal = roll => roll?.kind === "healing" && Array.isArray(roll.parts)
  && roll.parts.some(p => p && !p.persistent && (Number(p.flat) || 0) > 0) && (finite(roll.total) ?? 0) > 0;

const finite = v => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);

function claim(tray, at, roll = {}) {
  if ( !(at >= 0) ) return null;
  const dice = [];
  for ( let i = at; i < tray.tape.length; i++ ) {
    const d = tray.tape[i];
    if ( d.claimed ) continue;
    d.claimed = true;
    dice.push({ faces: d.faces, result: d.result });
  }
  // (Nothing rolled: nothing to show. A total with no dice is the rules' arithmetic, not a roll; but a heal of so many
  // hit points is shown all the same, as the system shows a heal, so the table sees who got how much: API 21.)
  if ( !dice.length && !flatHeal(roll) ) return null;
  const kind = ROLL_KINDS.includes(roll.kind) ? roll.kind : "other";
  const out = {
    by: idOf(roll.by), target: idOf(roll.target), kind, label: typeof roll.label === "string" ? roll.label : "", what: roll.what ?? null,
    mod: finite(roll.mod) ?? 0, total: finite(roll.total), dc: finite(roll.dc), natural: finite(roll.natural), degree: finite(roll.degree),
    dice
  };
  // (What it was for, where the caller says: the action's id, a save's key, an attack's or a save's blow.)
  for ( const key of ["action", "stat", "source"] ) if ( typeof roll[key] === "string" && roll[key] ) out[key] = roll[key];
  const shape = shapeOf(dice, roll);
  out.groups = shape.groups;
  if ( out.total === null ) out.total = shape.total ?? totalOf(out.groups, 0, out.mod);
  // (Shown as several rolls: each its own modifier and total, the first the roll's own unless its system said.)
  if ( shape.rolls ) {
    out.rolls = shape.rolls.map((r, i) => {
      const mod = r.mod ?? (i === 0 ? out.mod : 0);
      return { mod, total: r.total ?? (i === 0 ? out.total : totalOf(out.groups, i, mod)) };
    });
  }
  if ( finite(roll.multiplier) !== null && Number(roll.multiplier) !== 1 ) out.multiplier = Number(roll.multiplier);
  if ( roll.crit ) out.crit = true;
  tray.rolls.push(out);
  return out;
}

/**
 * How a roll's dice read as a formula: groups of dice, in the order rolled, each {faces, results, sign, mult, keep,
 * roll} (`keep`: "kh" or "kl", the higher or lower of them kept, a d20 with advantage; `roll`: which of the roll's own
 * rolls it's in, for one shown as several, an Ironsworn action roll against its challenge dice). From the roll's
 * `parts` (damage: its DamageParts, as dice.js samples them); its `each` (every die a roll of its own: a system's
 * roll the core shows without knowing how its dice add up, a helper's recovery check); else its `extras` (dice that
 * ride along, Bless: rolled first, signed faces), then its `split` ([{dice, sign, roll, mod, total}]: so many dice at a
 * time, to which of its rolls, with that roll's own modifier and total, as a system's roll says: probability.js
 * rollCheck's roll.shown) or its `keep` (two dice, one kept); else one group for each run of dice of a kind.
 */
function shapeOf(dice, roll) {
  if ( Array.isArray(roll.parts) ) {
    const own = partGroups(dice, roll.parts);
    if ( own ) return own;
  }
  // (`each`: a system's rolls the core shows for it, not knowing how they add up: each die a roll of its own.)
  if ( roll.each ) {
    return {
      groups: dice.map((d, i) => ({ faces: d.faces, results: [d.result], sign: 1, mult: 1, keep: null, roll: i })),
      rolls: dice.map(d => ({ mod: 0, total: d.result })), total: dice[0].result
    };
  }
  const groups = [];
  let rest = dice;
  let riding = 0;
  for ( const f of roll.extras ?? [] ) {
    const faces = Math.max(1, Math.abs(Math.round(Number(f) || 0)));
    if ( rest[0]?.faces !== faces ) break;
    const sign = Math.sign(Number(f)) || 1;
    groups.push({ faces, results: [rest[0].result], sign, mult: 1, keep: null, roll: 0 });
    riding += sign * rest[0].result;
    rest = rest.slice(1);
  }
  if ( Array.isArray(roll.split) && roll.split.length ) {
    const own = [];
    const rolls = [];
    let i = 0;
    roll.split.forEach((s, n) => {
      const at = Number.isInteger(s.roll) ? s.roll : n;
      const count = Math.max(0, Math.round(Number(s.dice) || 0));
      own.push(...runsOf(rest.slice(i, i + count)).map(g => ({ ...g, sign: Number(s.sign) < 0 ? -1 : 1, roll: at })));
      i += count;
      rolls[at] ??= { mod: null, total: null };
      // (A system's roll counts the dice that rode along in its own modifier: shown as dice, not twice.)
      if ( finite(s.mod) !== null ) rolls[at].mod = finite(s.mod) - (at === 0 ? riding : 0);
      if ( finite(s.total) !== null ) rolls[at].total = finite(s.total);
    });
    if ( i === rest.length ) return { groups: groups.concat(own), rolls: Array.from(rolls, r => r ?? { mod: null, total: null }) };
  }
  // (Kept high or low: a d20 with advantage or disadvantage, its two dice one group.)
  if ( roll.keep && rest.length === 2 && rest[0].faces === rest[1].faces ) {
    groups.push({ faces: rest[0].faces, results: rest.map(d => d.result), sign: 1, mult: 1, keep: roll.keep === "kl" ? "kl" : "kh", roll: 0 });
    return { groups };
  }
  return { groups: groups.concat(runsOf(rest)) };
}

/** Each run of dice of a kind, a group. */
function runsOf(dice) {
  const out = [];
  for ( const d of dice ) {
    const last = out.at(-1);
    if ( last && last.faces === d.faces ) last.results.push(d.result);
    else out.push({ faces: d.faces, results: [d.result], sign: 1, mult: 1, keep: null, roll: 0 });
  }
  return out;
}

/**
 * Damage parts' dice, as dice.js rolls them (each part's dice in order, a persistent part's not at all; at most
 * MAX_DICE of a kind): a group for each, and a group of no dice for a part's flat (so the formula has it), each saying
 * its part's `type`, `category` and which `part` it is (for a system's own damage card: rolledParts). Null when the
 * dice rolled don't match the parts (rolled some other way): plain runs then.
 */
function partGroups(dice, parts) {
  const groups = [];
  let i = 0;
  let total = 0;
  let n = 0;
  for ( const p of parts ) {
    if ( !p || p.persistent ) continue;
    const own = [];
    const of = { type: typeof p.type === "string" ? p.type : "untyped", category: p.category ?? null, part: n++ };
    for ( const { n: count0, faces, mult = 1 } of p.dice ?? [] ) {
      const count = Math.min(Math.abs(count0), MAX_DICE);
      if ( !count ) continue;
      const rolled = dice.slice(i, i + count);
      if ( rolled.length !== count || rolled.some(d => d.faces !== faces) ) return null;
      own.push({ faces, results: rolled.map(d => d.result), sign: count0 < 0 ? -1 : 1, mult, keep: null, roll: 0, ...of });
      i += count;
    }
    if ( p.flat ) own.push({ faces: 0, results: [], flat: p.flat, sign: 1, mult: 1, keep: null, roll: 0, ...of });
    groups.push(...own);
    // (Each part as dice.js samples it: rounded down, and none below 0.)
    total += Math.max(0, Math.floor(own.reduce((s, g) => s + groupValue(g), 0)));
  }
  return i === dice.length ? { groups, total } : null;
}

/**
 * A damage roll's parts as they were rolled, for a system's own damage card (API 20): [{type, category, dice: [{faces,
 * results, sign, mult}], flat}], in the order rolled (a part's dice in order, its flat after them). Empty for a roll
 * whose dice weren't recorded by part (not a damage roll's, or rolled some other way).
 */
export function rolledParts(roll) {
  const out = [];
  for ( const g of roll?.groups ?? [] ) {
    if ( !Number.isInteger(g.part) ) return [];
    let p = out[g.part];
    if ( !p ) p = out[g.part] = { type: g.type ?? "untyped", category: g.category ?? null, dice: [], flat: 0 };
    if ( g.faces ) p.dice.push({ faces: g.faces, results: [...g.results], sign: g.sign ?? 1, mult: g.mult ?? 1 });
    else p.flat += Number(g.flat) || 0;
  }
  return out.filter(Boolean);
}

/** A group's value: its dice (the one kept, where it keeps one), signed, times its multiplier; a flat its number. */
export function groupValue(g) {
  if ( !g.faces ) return Number(g.flat) || 0;
  const kept = g.keep === "kh" ? [Math.max(...g.results)] : g.keep === "kl" ? [Math.min(...g.results)] : g.results;
  return kept.reduce((s, r) => s + r, 0) * (g.sign ?? 1) * (g.mult ?? 1);
}

/** The total of one of a roll's rolls (`n`) from its dice and modifier, where it gave none. */
function totalOf(groups, n, mod) {
  return Math.floor(groups.filter(g => (g.roll ?? 0) === n).reduce((s, g) => s + groupValue(g), 0) + (mod ?? 0));
}
