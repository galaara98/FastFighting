/**
 * Summoning: a spell or ability that calls creatures to fight for the summoner (5e Spiritual Weapon, Conjure
 * Animals, Animate Objects; PF2e Summon Animal). They join right after the summoner in the turn order and fight as
 * its side. They go when their time is up, when the summoner stops concentrating on them, or, where they must be
 * sustained (PF2e), when it doesn't.
 *
 * An action of kind "summon": {creatures: [CombatantSpec], rounds, concentration, sustain, sustainOrEnd, range}
 *   sustain        what the summoner spends at the start of each of its turns to keep them acting ({actions: 1} in
 *                  PF2e; a 5e Spiritual Weapon's bonus action); unpaid, they do nothing that round
 *   sustainOrEnd   unpaid, they're gone (PF2e)
 *   range          how far off it calls them, in feet (or {max}: by default 30). Each appears in the nearest space no one's
 *                  in, within it and in the summoner's sight: beside the foe it would go for, else beside the summoner
 * A summoned creature with `untargetable` (Spiritual Weapon: not a creature at all) can't be attacked and doesn't
 * keep its side in the fight. Summoned creatures aren't the table's: they're left out of the results and Make it So.
 * In a live battle they're placed on the scene and the tracker as they're called (foundry/live-battle.js), and take
 * turns of their own; a kept turn remembers them (summonOf), so a restored one has them again.
 * Pure: no Foundry globals.
 */
import { STATUS, TACTICAL } from "../../constants.js";
import { createUnit, isUp, isStanding, liveTier, enemiesOf, edgeDistance } from "../battle-state.js";
import { freeSpotNear, lineOfSight, wallsKnown } from "./space.js";
import { costOf, costUnits, hasUses, unitsPerTurn } from "./evaluate.js";
import { offenseBaseline } from "./support.js";
import { usefulRounds } from "./effects.js";
import { initDesires } from "./desire.js";
import { sampleRunTactics } from "../playstyles.js";
import { specialtyLean } from "./specialty.js";

/** Those u has called with this action and who are still here. */
const calledBy = (run, u, action) => run.units.filter(o => o.summoner === u.id && o.summonedBy === action.id && !o.vanished && o.status !== STATUS.DEAD);

/** What summoning would be worth to u now, in damage terms, or 0. */
function worthOf(run, u, action) {
  const entries = run.prep.summons?.get(action.id) ?? [];
  if ( !entries.length ) return 0;
  const rounds = usefulRounds(run, u.side, action.rounds ?? 10);
  const rules = run.prep.rules;
  let worth = 0;
  for ( const p of entries ) {
    const perTurn = (p.offensePower ?? 0) * unitsPerTurn(rules, { spec: p.spec, conds: {}, mods: {} });
    worth += perTurn * rounds;
    if ( !p.spec.untargetable ) worth += (p.spec.hp?.max ?? 0) * 0.3; // blows it soaks up for its side
  }
  // Keeping them costs the summoner every turn (PF2e Sustain, a 5e Spiritual Weapon's bonus action).
  if ( action.sustain ) worth -= costUnits(rules, action.sustain) * offenseBaseline(run, u) * rounds * 0.8;
  return worth;
}

/**
 * Does u call its creatures now? The summoning worth the most, if it beats what attacking would do with the same
 * actions over the next couple of rounds. The feral don't; nobody calls what's already here.
 */
export function decideSummon(run, u, turn) {
  const list = u.prep.summonActions;
  if ( !list?.length || liveTier(run, u) <= TACTICAL.FERAL ) return null;
  const rules = run.prep.rules;
  const baseline = offenseBaseline(run, u);
  let best = null;
  for ( const action of list ) {
    if ( !hasUses(u, action) || !turn.canAfford(costOf(rules, action, u)) || calledBy(run, u, action).length ) continue;
    const worth = worthOf(run, u, action) * specialtyLean(u, action);
    const cost = Math.max(0.5, costUnits(rules, costOf(rules, action, u)));
    if ( worth > baseline * cost * 2 && (!best || worth > best.worth) ) best = { action, worth };
  }
  return best?.action ?? null;
}

/** How far off a summoning can call its creatures, in feet, where it doesn't say (action.range): PF2e's usual 30. */
const SUMMON_RANGE = 30;

/**
 * Where a summoned creature appears: the nearest space no one's in (behavior/space.js freeSpotNear) to where it would
 * want to: beside the foe it would go for (the summoner's, else the nearest), if it fights hand to hand and that foe
 * is within the summoning's range and in the summoner's sight; else beside the summoner. Only a space within that
 * range the summoner can see. With none free, a step beside the summoner, as ever.
 */
function appearAt(run, u, s, action, i) {
  const range = Number(action.range?.max ?? action.range?.increment ?? action.range) || SUMMON_RANGE;
  const seen = o => !wallsKnown(run) || lineOfSight(run, u, o);
  const within = p => (edgeDistance(u, { pos: p, spec: s.spec }) ?? 0) <= range + 0.5;
  const accept = p => within(p) && seen({ pos: p, spec: s.spec });
  const fights = (s.prep.offense ?? []).some(a => !a.range) || !!s.spec.untargetable;
  if ( fights ) {
    const foes = enemiesOf(run, u).filter(o => isStanding(o) && o.pos && within(o.pos) && seen(o));
    const target = foes.find(o => o.id === u.targetId) ?? foes.sort((a, b) => (edgeDistance(u, a) ?? 0) - (edgeDistance(u, b) ?? 0))[0];
    const spot = target ? freeSpotNear(run, s, target.pos, { lattice: target, most: 15, accept }) : null;
    if ( spot ) return spot;
  }
  return freeSpotNear(run, s, u.pos, { lattice: u, most: Math.min(range, 30), accept })
    ?? { x: u.pos.x + 5 * (1 + (i % 3)), y: u.pos.y + 5 * Math.floor(i / 3) };
}

/** Call the creatures: they join the fight right after u. Returns them. */
export function callSummons(run, u, action) {
  const entries = run.prep.summons?.get(action.id) ?? [];
  const order = run.order ?? [];
  let at = order.indexOf(u);
  const out = [];
  run.calls = (run.calls ?? 0) + 1;
  entries.forEach((p, i) => {
    const s = createUnit(run.prep, p);
    // (Its own id each time it's called: the ones called before may still lie on the field.)
    if ( run.byId.has(s.id) ) s.id = `${s.id}#${run.calls}`;
    s.summoner = u.id;
    s.summonedBy = action.id;
    s.summonOf = p.spec.id; // (which of the summoning's creatures: a live battle kept and restored makes it again)
    s.expires = action.rounds ? run.round + action.rounds : null;
    s.joinedRound = run.round;
    s.sustainedRound = run.round; // the round it's called, it acts
    // Where it would appear, in the nearest space no one's in: beside the foe it would go for, within the summoning's
    // reach and in sight; else beside the summoner.
    s.pos = u.pos ? appearAt(run, u, s, action, i) : null;
    initDesires(s);
    s.tac = sampleRunTactics(s.spec, run.rng);
    run.units.push(s);
    run.byId.set(s.id, s);
    if ( at >= 0 ) order.splice(++at, 0, s);
    if ( s.spec.untargetable ) run.untargetable = true;
    out.push(s);
  });
  return out;
}

/**
 * At the start of the summoner's turn: it pays to keep what it has called (PF2e Sustain), if it can; what it can't
 * keep acting does nothing this round, or (PF2e) goes. Returns the ones it kept, and the ones that went.
 */
export function sustainSummons(run, u, turn) {
  const kept = [];
  const gone = [];
  for ( const action of u.prep.summonActions ?? [] ) {
    if ( !action.sustain ) continue;
    const called = calledBy(run, u, action);
    if ( !called.length ) continue;
    const able = isUp(u) && !u.conds?.incapacitated && turn.canAfford(action.sustain);
    if ( able ) {
      turn.spend(action.sustain);
      for ( const s of called ) s.sustainedRound = run.round;
      kept.push(action);
    } else if ( action.sustainOrEnd ) {
      gone.push(...called);
    }
  }
  return { kept, gone };
}

/**
 * At the start of a summoned creature's own turn: has its time run out, or its summoner's concentration on it? Then
 * it's gone ("expired" / "released"); if it wasn't kept acting this round, "idle"; else null.
 */
export function summonState(run, s) {
  const action = run.prep.combatants.find(c => c.spec.id === s.summoner)?.summonActions?.find(a => a.id === s.summonedBy) ?? null;
  const summoner = run.byId.get(s.summoner);
  if ( s.expires && run.round > s.expires ) return "expired";
  if ( action?.concentration && summoner?.concentration?.actionId !== action.id ) return "released";
  if ( action?.sustain && s.sustainedRound !== run.round ) return "idle";
  return null;
}

/** It goes: out of the fight, without dying. */
export function dismiss(s) {
  s.vanished = true;
  s.status = STATUS.FLED;
  s.active = false;
}
