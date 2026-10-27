/**
 * Minions: creatures that serve a master in the fight (spec.flags.masterId: a familiar, an animal companion, a
 * guard dog), that act only when the master commands them, where the system says so (API 32).
 *
 *   rules.minionCommand(minion, master)   what the master pays, at the start of its turn, for the minion to act on its
 *                                         next turn (PF2e: one action, for a minion's two); null: it acts on its own.
 *                                         API 35: a cost with `once` (a key) is paid once a turn for every minion
 *                                         whose cost names that key (5e's Animate Dead: one bonus action commands
 *                                         every creature the spell made)
 *
 * A master commands each of its minions that is up and in the fight, while it can pay, at the start of its turn (after
 * keeping what it summoned: summons.js). A minion not commanded since its last turn does nothing that turn. One whose
 * master isn't in the fight, or is down, gone or can't act, isn't commanded by anyone: it looks after itself, acting
 * on its own. In a simulated fight a minion goes right after its master (orderMinions), as summoned creatures do; in a
 * live battle it keeps its place on the tracker and acts on its turn if its master commanded it since its last one.
 * A summoned creature is its summoner's to keep acting (Sustain: summons.js), not commanded here.
 * Pure: no Foundry globals.
 */
import { STATUS } from "../../constants.js";
import { isUp, isStanding } from "../battle-state.js";

/** Its master on the battlefield, or null. */
const masterOf = (run, u) => (u.spec.flags?.masterId ? run.byId.get(u.spec.flags.masterId) ?? null : null);

/** A player's to run, in a live battle (live.js playerRuns, without its import). */
const playerRun = (run, u) => !!run.live?.players?.has(u.id) || (!!u.controlledBy && !!run.live?.players?.has(u.controlledBy));

/** A master that can command: up, in the fight, not kept from acting. */
const canCommand = m => !!m && isUp(m) && m.active !== false && !m.conds?.incapacitated && !m.vanished;

/** What its master pays to command it (rules.minionCommand), or null: it acts on its own. */
function commandCost(run, u, master) {
  const rules = run.prep.rules;
  if ( !rules.minionCommand || u.summoner || !master ) return null;
  return rules.minionCommand(u, master) ?? null;
}

/** Those u commands: its minions on the battlefield that need its word to act. */
export const minionsOf = (run, u) => run.units.filter(o => o !== u && o.spec.flags?.masterId === u.id && !o.vanished
  && o.status !== STATUS.DEAD && commandCost(run, o, u));

/**
 * At the start of a master's turn: it commands each of its minions that is up and in the fight, as long as it can pay
 * for it. Returns the ones it commanded.
 */
export function commandMinions(run, u, turn) {
  const commanded = [];
  if ( !canCommand(u) ) return commanded;
  const paid = new Set();
  for ( const m of minionsOf(run, u) ) {
    if ( !isStanding(m) ) continue;
    // (A cost with `once`, API 35: one payment this turn commands every minion whose cost names the same key.)
    const { once = null, ...cost } = commandCost(run, m, u);
    if ( !(once && paid.has(once)) ) {
      if ( !turn.canAfford(cost) ) continue;
      turn.spend(cost);
      if ( once ) paid.add(once);
    }
    m.commanded = true;
    commanded.push(m);
  }
  return commanded;
}

/**
 * At the start of a minion's own turn: does it wait for a word it wasn't given? True when its master is here and able
 * to command it, and didn't since its last turn. A command it had is spent on this turn either way.
 */
export function awaitsCommand(run, u) {
  const master = masterOf(run, u);
  const cost = commandCost(run, u, master);
  const commanded = !!u.commanded;
  u.commanded = false;
  if ( !cost || !canCommand(master) ) return false;
  // (A master a player runs in a live battle commands at the table, where the engine doesn't see it: the minion acts.)
  if ( playerRun(run, master) ) return false;
  return !commanded;
}

/** The turn order with each commanded minion right after its master (where its master is in it). */
export function orderMinions(run, order) {
  const commandedBy = u => { const m = masterOf(run, u); return m && m !== u && order.includes(m) && commandCost(run, u, m) ? m : null; };
  // (Not one whose master is itself moved: a minion commands no one.)
  const moved = order.filter(u => { const m = commandedBy(u); return m && !commandedBy(m); });
  if ( !moved.length ) return order;
  const out = [];
  for ( const u of order ) {
    if ( !moved.includes(u) ) out.push(u, ...moved.filter(m => masterOf(run, m) === u));
  }
  return out;
}
