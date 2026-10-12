/**
 * Taunting as a playstyle's perk (behavior `taunt`, its share of the Taunting setting: a Tank's all of it, then an
 * Instigator's, a Martyr's, a Brawler's, a Redeem-Seeker's; less for a pill further down). Words in battle, like any
 * other talk:
 *  - It's an action, as dear as the system says (rules.tauntCost: PF2e one action, 5e an action, DCC an action die,
 *    Ironsworn a move; without one, what talking costs).
 *  - It goads a foe within 30 feet into coming at it, with its talking: its best of Intimidation (threats) and
 *    Deception (mockery, a show of weakness) against the foe's resistance to that, with what it knows of the foe and any
 *    edges it has, as any pitch (talk.js bestPitch).
 *  - Made, it takes hold only on a luck check: a d100 at or under the Taunting setting (42 by default) times its share.
 *    Taken hold, the foe wants to go for it (effects.js taunt) until the end of the foe's next turn; on a critical
 *    success, more badly.
 * Only the playstyles' own taunt goes by that setting: a game system's taunts (skills, powers, spells) go by their own
 * rules. It takes a voice (a creature that can talk), and a foe with a mind to rile (never the mindless): words, but not
 * a language in common, since tone carries. Some won't rise to any taunt at all (effects.js tauntProof).
 * Pure: no Foundry globals.
 */
import { TAUNT_LUCK, clamp } from "../../constants.js";
import { typical, checkRoll, studyBonus, boostBonus } from "../battle-state.js";
import { degreeDistribution } from "../probability.js";
import { canTalk } from "./standoff.js";

/** How far a taunt carries. */
export const GOAD_RANGE = 30;
/** The pitches that goad: threats, and mockery. */
export const GOAD_KINDS = Object.freeze(["intimidate", "deceive"]);
/** How badly a critical success makes the foe want the taunter (a plain success: effects.js TAUNT, "driven"). */
export const GOAD_CRIT = 80;

/**
 * The taunt a prepared combatant's playstyles give it, as a control action decided by its talking (behavior/control.js
 * "goad"), or null: no such playstyle, no voice, or no way with threats or mockery.
 */
export function goadAction(c, rules, options = {}) {
  const share = Math.min(1, Number(c.spec.behavior?.taunt) || 0);
  if ( !(share > 0) || options.talking === false || c.spec.hazard || !canTalk({ spec: c.spec }) ) return null;
  const pitches = GOAD_KINDS.filter(k => typeof c.spec.social?.pitches?.[k]?.mod === "number");
  if ( !pitches.length ) return null;
  const goaded = { taunt: true, rounds: 1, label: "" };
  const own = typeof rules.tauntCost === "function" ? rules.tauntCost(c.spec) : rules.tauntCost;
  return {
    id: `${c.spec.id}.goad`, name: "", kind: "control", goad: share, pitches,
    // (As dear as the system says a taunt is, whatever its own action costs would make of it.)
    cost: own ?? rules.talkCost ?? rules.basicAction ?? 1, fixedCost: true,
    range: { increment: GOAD_RANGE, max: GOAD_RANGE, noPenalty: true }, melee: false,
    onHit: [null, null, goaded, { ...goaded, taunt: GOAD_CRIT }]
  };
}

/**
 * The talker's best way to goad t: {kind, skill, mod, advantage, dice, dc, dcLabel, boost}, the pitch most likely to get
 * through (its resistance to that kind of pitch, else a typical DC for its level).
 */
export function goadPitch(run, talker, t, action) {
  const rules = run.prep.rules;
  let best = null;
  const study = studyBonus(talker, t, { words: true });
  for ( const kind of action.pitches ?? GOAD_KINDS ) {
    const pitch = talker.spec.social?.pitches?.[kind];
    if ( typeof pitch?.mod !== "number" ) continue;
    const { mod: base, advantage, dice } = checkRoll(run, talker, pitch.mod + study, t);
    const dc = t.spec.social?.resist?.[kind]?.dc ?? typical(rules, "dc", t.spec.level ?? 0);
    const lift = boostBonus(rules, talker, t, base, dc, { advantage, dice, kind: "check", roller: talker });
    const mod = base + lift;
    const dist = degreeDistribution(rules, mod, dc, { advantage, dice, kind: "check", roller: talker });
    const p = dist[2] + dist[3];
    if ( !best || p > best.p ) best = { kind, skill: pitch.skill ?? kind, mod, advantage, dice, dc, dcLabel: t.spec.social?.resist?.[kind]?.label ?? "DC", boost: lift || null, p };
  }
  return best;
}

/** What the luck check needs (a d100 at or under it): the Taunting setting times the taunter's share. */
export function goadLuck(run, action) {
  const setting = run.prep.options.tauntLuck ?? TAUNT_LUCK;
  return clamp(Math.round(setting * (Number(action.goad) || 0)), 0, 100);
}
