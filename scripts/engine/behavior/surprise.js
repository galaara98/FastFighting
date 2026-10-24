/**
 * Surprise at the start of a fight, as the battle's plan has it (spec.options.surprise):
 *   "system"             the system's own rule (rules.surprise(run)), where it has one; else no one is surprised;
 *   "none"               no one is surprised;
 *   "friendlySurprised"  the party is surprised: every side against it gets a round of its own before the first;
 *   "friendlySurprise"   the party surprises the others: it gets that round.
 * What it comes to (run.surprise, resolveSurprise):
 *   by            the sides that have surprise (Ironsworn: who enters the fray with +shadow, and who with +wits);
 *   round         whether they get a round of their own before the first (a surprise round);
 *   stealthSides  sides that roll Stealth for initiative (PF2e: sneaking up, Avoid Notice);
 *   surprised     creatures that lose their first turn, and can't react until it's gone by (5e's 2014 rules);
 *   disadvantage  creatures that roll initiative at a disadvantage (5e's 2024 rules);
 *   hidden        creatures that start the fight hidden, until what they do gives them away (PF2e: one that sneaked up
 *                 unnoticed, its first blow finding its target off-guard);
 *   caught        creatures marked surprised that keep their turn (API 29: a system whose surprise is a debuff, not a
 *                 lost turn);
 *   outcome       what being caught unready costs, in the system's terms (API 29: an outcome, its conditions and mods:
 *                 flat-footed, -2 AC), on the `caught` and the `surprised` until their first turn has gone by.
 * A creature that is never caught unready (spec.alert, API 29: DCC's "never surprised", 5e's Alert) is never among
 * `surprised` or `disadvantage`, and acts in a surprise round whatever its side.
 * A system's rule returns any of these; the rest are none. A system with no rounds to speak of (rules.surpriseRound
 * false: Ironsworn) has the plan's own choices give surprise without a round of its own (its rule reads `by`).
 * Pure: no Foundry globals.
 */
import { SIDES } from "../../constants.js";

export const SURPRISE = Object.freeze({ SYSTEM: "system", NONE: "none", PARTY_SURPRISED: "friendlySurprised", PARTY_SURPRISES: "friendlySurprise" });

/** No one surprised. */
const NONE = () => ({ by: [], round: false, stealthSides: [], surprised: [], disadvantage: [], hidden: [], caught: [], outcome: null });

/** A list of strings, from whatever a system's rule gave (none for anything else). */
const ids = v => (Array.isArray(v) ? v.filter(x => typeof x === "string") : []);

/** The sides fighting in this battle (its creatures'). */
const sidesHere = run => [...new Set(run.units.map(u => u.side))];

/** Surprise as the plan has it, for this fight. */
export function resolveSurprise(run) {
  const { options, rules } = run.prep;
  const out = NONE();
  const mode = options.surprise ?? null;
  const rounds = rules.surpriseRound !== false;
  if ( mode === SURPRISE.PARTY_SURPRISES ) {
    out.by = [SIDES.FRIENDLY];
    out.round = rounds;
  } else if ( mode === SURPRISE.PARTY_SURPRISED ) {
    out.by = sidesHere(run).filter(s => run.prep.sides[s]?.enemies?.has?.(SIDES.FRIENDLY));
    out.round = rounds && out.by.length > 0;
  } else if ( mode === SURPRISE.SYSTEM ) {
    const said = typeof rules.surprise === "function" ? rules.surprise(run) : null;
    if ( said && typeof said === "object" ) {
      out.by = ids(said.by);
      out.round = !!said.round && out.by.length > 0;
      out.stealthSides = ids(said.stealthSides);
      out.surprised = ids(said.surprised);
      out.disadvantage = ids(said.disadvantage);
      out.hidden = ids(said.hidden);
      out.caught = ids(said.caught);
      out.outcome = said.outcome && typeof said.outcome === "object" ? said.outcome : null;
    }
  }
  const alert = new Set(run.units.filter(u => u.spec.alert).map(u => u.id));
  if ( alert.size ) {
    out.surprised = out.surprised.filter(id => !alert.has(id));
    out.disadvantage = out.disadvantage.filter(id => !alert.has(id));
    out.caught = out.caught.filter(id => !alert.has(id));
  }
  return out;
}

/** The sides with hidden creatures on them (those trying not to be seen as it starts: an ambush). */
export const hiddenSides = run => sidesHere(run).filter(s => run.units.some(u => u.side === s && u.spec.hidden));
