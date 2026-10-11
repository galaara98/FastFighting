/**
 * Buffs: spells, songs, shouts and stances that make friends (or the user) fight better: Bless, Heroism, Courageous
 * Anthem, Shield of Faith, Haste, Dodge.
 *
 * A buff is an ActionSpec with kind "buff" and an `outcome` (see effects.js: mods, conditions, tempHp, rounds,
 * label), reaching
 *   targets: "self"      only the user (Dodge, Rage)
 *   (otherwise)          one friend it can reach (range or reach as for any action; with neither, a touch)
 *   area: {targets: n}   up to n friends in range (5e Bless: three)
 *   aura: feet           every friend within that many feet of the user (PF2e Bless, Courageous Anthem)
 *   includeSelf: false   not the user itself
 *   concentration        it lasts only while the user concentrates
 *   check: {mod, dc, label}  it needs a roll to land (PF2e Aid, DC 15; Ironsworn Secure an Advantage, an action
 *                        roll): onDegree [critical failure, failure, success, critical success] says what comes of each
 *                        (an outcome, or null for nothing); without it, the outcome on a success and nothing otherwise
 *   besideFoe: feet      only for a friend whose foe is that close to the user (5e Help: within 5 feet of you)
 * An outcome with `failed` is what a failure costs (Ironsworn: Pay the Price, through rules.onOutcome).
 * An outcome with vsFocus counts against whoever the friend is set on (effects.js), and `uses` makes it one roll's
 * worth: Help, Aid, Guidance, an inspiration die, "+1 on your next move".
 *   oncePerTurn          no more than once in a turn (Action Surge, Reckless Attack)
 *   tell                 the story table to tell it with (event.dodge, event.reckless, event.surge), for what isn't magic
 * A buff is worth casting when what it adds up to across its recipients, over the rounds it will matter, beats what
 * the same actions would do as an attack. Thinking minds see this best; feral ones only ever look after themselves.
 * Pure: no Foundry globals.
 */
import { STATUS, TACTICAL } from "../../constants.js";
import { alliesOf, enemiesOf, isStanding, liveTier, movesNeeded, edgeDistance, behaviorOf, checkRoll } from "../battle-state.js";
import { degreeDistribution } from "../probability.js";
import { hasUses, costOf, costUnits, threatOf, unitsPerTurn } from "./evaluate.js";
import { outcomeWorth, hasFresh, concentrationCost, heldElsewhere, focusOf } from "./effects.js";
import { mind, levelOf } from "./desire.js";
import { bringsItself } from "./reluctance.js";
import { castChanceOf } from "./casting.js";

/** How well each tactical band sees what a buff is worth (feral: not at all, beyond itself). */
const SEES = [0.5, 0.6, 0.9, 1.05, 1.15];

const limited = a => !!a.resource || Number.isFinite(a.uses);

/** Can u lay this on a without moving? */
function reaches(run, u, a, action) {
  if ( a === u ) return true;
  if ( action.aura ) {
    const d = edgeDistance(u, a);
    return d === null || d <= action.aura;
  }
  const how = action.range || action.reach !== undefined ? action : { ...action, reach: 5 };
  return movesNeeded(run, u, a, how) === 0;
}

/**
 * Whom a buff would go to now, and what it's worth to each: [{ally, worth}], best first. With `all`, every friend it
 * could go to, not just as many as it reaches.
 */
export function recipients(run, u, action, tier = liveTier(run, u), { all = false } = {}) {
  const outcome = action.outcome ?? action.onDegree?.[2] ?? action.onDegree?.[3];
  if ( !outcome || typeof outcome !== "object" ) return [];
  const self = action.targets === "self";
  const pool = self || tier <= TACTICAL.FERAL
    ? (action.includeSelf === false && !self ? [] : [u])
    : alliesOf(run, u).filter(a => isStanding(a) && (a !== u || action.includeSelf !== false) && reaches(run, u, a, action) && besideFoe(run, u, a, action));
  const picks = [];
  for ( const ally of pool ) {
    if ( hasFresh(ally, action) && !outcome.actionsNow ) continue; // it's on them already
    const worth = edgeWorth(run, u, ally, action, outcome);
    if ( worth > 0 ) picks.push({ ally, worth });
  }
  // A friend it wants to bolster (one that asked, say) comes first, as far as the wish goes: at 50, worth twice as much.
  const rank = x => x.worth * (1 + levelOf(u, "aid", x.ally.id) / 50);
  picks.sort((a, b) => rank(b) - rank(a));
  const n = self ? 1 : action.aura ? picks.length : Math.max(1, Number(action.area?.targets) || 1);
  return all ? picks : picks.slice(0, n);
}

/** 5e Help: only for a friend whose foe is close enough to the helper (any friend, for one that isn't fighting). */
function besideFoe(run, u, a, action) {
  const feet = Number(action.besideFoe) || 0;
  if ( !feet || a === u ) return true;
  const focus = focusOf(run, a);
  if ( focus?.kind !== "hurt" ) return true;
  const d = edgeDistance(u, focus.unit);
  return d === null || d <= feet;
}

/** Chances of each degree for a buff that needs a roll to land ([0, 0, 1, 0] for one that doesn't). */
export function landing(run, u, action) {
  if ( !action.check || !Number.isFinite(Number(action.check.mod)) ) return [0, 0, 1, 0];
  const c = checkRoll(run, u, Number(action.check.mod));
  return degreeDistribution(run.prep.rules, c.mod, Number(action.check.dc) || 0, { advantage: c.advantage, dice: c.dice, kind: "check" });
}

/** What a buff is worth to a friend, over what its roll may come to. */
function edgeWorth(run, u, ally, action, outcome) {
  if ( !action.check ) return outcomeWorth(run, u, ally, outcome);
  const dist = landing(run, u, action);
  if ( !Array.isArray(action.onDegree) ) return (dist[2] + dist[3]) * outcomeWorth(run, u, ally, outcome);
  return dist.reduce((s, p, d) => s + (p > 0 && action.onDegree[d] ? p * outcomeWorth(run, u, ally, action.onDegree[d]) : 0), 0);
}

/** What u would do with one action's worth of attacking instead: its best damage per action against a standing foe. */
export function offenseBaseline(run, u) {
  let best = 0;
  for ( const f of enemiesOf(run, u) ) if ( isStanding(f) ) best = Math.max(best, threatOf(run, u, f));
  return best / Math.max(1, unitsPerTurn(run.prep.rules, u));
}

/** In trouble enough that a careful character spends what it has been saving. */
function inTrouble(run, u) {
  if ( u.maxHp > 0 && u.hp / u.maxHp < 0.5 ) return true;
  return alliesOf(run, u).some(a => a !== u && a.status === STATUS.DOWN && a.active);
}

/**
 * Each buff's best use now, scored per action against what attacking would do: [{action, targets, worth, score}],
 * best first. `turn` (optional) leaves out what's left of the turn can't pay for.
 */
export function buffOptions(run, u, turn = null) {
  const buffs = u.prep.buffActions;
  if ( !buffs?.length ) return [];
  const rules = run.prep.rules;
  const tier = liveTier(run, u);
  const gate = { conserve: inTrouble(run, u) ? 1.15 : 1.6, balanced: 1.05, nova: 1 }[u.tac?.resourceUse] ?? 1.05;
  const out = [];
  for ( const action of buffs ) {
    if ( !hasUses(u, action) ) continue;
    if ( action.oncePerTurn && u.usedThisTurn?.has(action.id) ) continue;
    if ( rules.usable && !rules.usable(run, u, action, null) ) continue; // (Ironsworn: Secure an Advantage only in control)
    const cost = costOf(rules, action, u);
    if ( turn && !turn.canAfford(cost) ) continue;
    // A single-target buff it's holding on a friend still standing stays with them.
    if ( heldElsewhere(run, u, action) ) continue;
    const candidates = recipients(run, u, action, tier, { all: true });
    const n = action.targets === "self" ? 1 : action.aura ? candidates.length : Math.max(1, Number(action.area?.targets) || 1);
    const picks = candidates.slice(0, n);
    if ( !picks.length ) continue;
    const worth = castChanceOf(u, action) * picks.reduce((s, x) => s + x.worth, 0) - concentrationCost(run, u, action);
    if ( !(worth > 0) ) continue;
    let score = (worth / Math.max(0.25, costUnits(rules, cost))) * (SEES[tier] ?? 1);
    if ( limited(action) ) score /= gate;
    out.push({ action, targets: picks.map(x => x.ally), picks, candidates, worth, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Whether u bolsters someone now, whom, and with what: {action, targets, worth} or null. Its desires have the last
 * word: a friend it's set on helping is helped first; a mind full of something stronger doesn't think of it.
 */
export function decideBuff(run, u, turn) {
  if ( !u.prep.buffActions?.length ) return null;
  const wants = mind(run, u);
  if ( wants.blinding && !wants.kindInView("aid") ) return null;
  const options = buffOptions(run, u, turn);
  if ( !options.length ) return null;
  const leadAid = wants.lead?.kind === "aid" ? wants.lead.targetId : null;
  // Set on it (driven or more, and not just its own reckoning: told to, stirred by the fight, a friend who asked):
  // it bolsters that friend with whatever reaches them, worth it or not.
  const devoted = leadAid && wants.lead.level >= 60 && wants.lead.driven !== "logic";
  // Helpers think helping is worth more than it is; everyone else weighs it against hitting something.
  const baseline = devoted ? 0 : offenseBaseline(run, u) * (behaviorOf(u).helps ? 0.8 : 1);
  let best = null;
  for ( const o of options ) {
    const forLead = leadAid && o.targets.some(t => t.id === leadAid);
    if ( devoted && !forLead ) continue;
    const score = forLead ? o.score * 1.5 : o.score;
    if ( score <= baseline ) continue;
    if ( !best || score > best.score ) best = { ...o, score };
  }
  if ( !best || !bringsItself(run, u, best.action) ) return null;
  return best;
}

/** How much u's buffs would do for each friend now ([{ally, score}], score 1 = as good as attacking): its desires to aid. */
export function aidScores(run, u) {
  const baseline = Math.max(0.5, offenseBaseline(run, u));
  const best = new Map();
  for ( const o of buffOptions(run, u) ) {
    if ( o.action.tell ) continue; // Dodge, Reckless Attack, Action Surge: moves, not something to want for a friend
    // (Every friend it could bolster with it, not only the one it would pick: a friend who asks can change its mind.)
    for ( const { ally, worth } of o.candidates ) {
      const units = Math.max(0.25, costUnits(run.prep.rules, costOf(run.prep.rules, o.action, u)));
      const score = (worth / units) / baseline;
      if ( score > (best.get(ally) ?? 0) ) best.set(ally, score);
    }
  }
  return [...best].map(([ally, score]) => ({ ally, score })).sort((a, b) => b.score - a.score);
}
