/**
 * The maneuvers the core knows how to play: what each does at each degree, so a helper wires its system's own to them
 * (PF2e Shove, Trip, Grapple, Disarm, Reposition, Feint, Demoralize; 5e Shove and Grapple; a DCC Mighty Deed ...) by
 * naming it (action.maneuver) and giving its roll, and the core does the rest. Each is a control action
 * (behavior/control.js: kind "control", decided by a check against a defense, an attack, or the target's save); one
 * with no outcomes of its own takes these (withManeuver), one with its own keeps them.
 *
 * What a degree can do, besides conditions (effects.js): move (forced movement, behavior/forced.js: {kind: "push"
 * away from the one doing it, "pull" toward it, "place" anywhere within its reach, feet; or to: a push until it's that
 * far off}), grab (the one doing it holds it: u.grabbedBy; as long as what it lays with it, where it lays anything, else
 * until it's broken or the holder falls), and damage (its own, at that degree only: PF2e's critical Trip). From the
 * doer's side: crit, success, fail, critFail; a botch with self: true lands on the doer (a move: the target moves it;
 * a grab: the target has hold of it).
 * A rider on a blow can carry a move too ({kind: "move", move, critOnly}), or be a maneuver of its own with its own roll
 * ({kind: "control", control, critOnly}: PF2e's Improved Grab), and a save rider's failure a move or a grab.
 * The ids are the story's too (story/master.js MANEUVERS), told as what they are.
 */
const push = (feet, extra = {}) => Object.freeze({ move: Object.freeze({ kind: "push", feet }), ...extra });
const pull = feet => Object.freeze({ move: Object.freeze({ kind: "pull", feet }) });
const place = feet => Object.freeze({ move: Object.freeze({ kind: "place", feet }) });
const lay = (conditions, extra = {}) => Object.freeze({ conditions: Object.freeze(conditions), ...extra });
const botch = conditions => Object.freeze({ self: true, conditions: Object.freeze(conditions) });

export const MANEUVERS = Object.freeze({
  // Away from it: off a ledge, into the fire, out of reach.
  shove: Object.freeze({ success: push(5), crit: push(10), critFail: botch({ prone: 1 }) }),
  // Toward it: out of cover, into its friends' reach, over the edge behind it.
  drag: Object.freeze({ success: pull(5), crit: pull(10) }),
  // Anywhere within its reach: the worst of it.
  reposition: Object.freeze({ success: place(5), crit: place(10) }),
  // Thrown (one held, a big creature's toss).
  fling: Object.freeze({ success: push(10, { conditions: Object.freeze({ prone: 1 }) }), crit: push(20, { conditions: Object.freeze({ prone: 1 }) }) }),
  trip: Object.freeze({ success: lay({ prone: 1 }), crit: lay({ prone: 1 }), critFail: botch({ prone: 1 }) }),
  grapple: Object.freeze({ success: Object.freeze({ grab: true }), crit: Object.freeze({ grab: true, conditions: Object.freeze({ restrained: 1 }) }), critFail: botch({ prone: 1 }) }),
  disarm: Object.freeze({ success: lay({ disarmed: 1 }, { rounds: 1 }), crit: lay({ disarmed: 1 }) }),
  feint: Object.freeze({ success: lay({ offGuard: 1 }, { onlyVs: true, rounds: 1 }), crit: lay({ offGuard: 1 }, { onlyVs: true, rounds: 2 }) }),
  demoralize: Object.freeze({ success: lay({ frightened: 1 }), crit: lay({ frightened: 2 }) }),
  // A low blow, a jab where it hurts: caught off guard; done well, reeling.
  cheapShot: Object.freeze({ success: lay({ offGuard: 1 }, { rounds: 1 }), crit: lay({ stunned: 1 }, { rounds: 1 }) }),
  // Sand in the eyes, a cloak over the head.
  blindFoe: Object.freeze({ success: lay({ dazzled: 1 }, { rounds: 1 }), crit: lay({ blinded: 1 }, { rounds: 1 }) }),
  // Bowled over on the way past.
  trample: Object.freeze({ success: lay({ prone: 1 }), crit: lay({ prone: 1 }) }),
  // Its weapon or shield broken.
  sunder: Object.freeze({ success: lay({ gearBroken: 1 }), crit: lay({ gearBroken: 1 }) })
});
export const MANEUVER_IDS = Object.freeze(Object.keys(MANEUVERS));

/**
 * An action as the core plays it: a control action naming a maneuver it knows, with no outcomes of its own, takes the
 * maneuver's (a check or an attack: onHit by degree; a save: onSave, the target's failure the doer's success).
 */
export function withManeuver(action) {
  const m = action?.kind === "control" ? MANEUVERS[action.maneuver] : null;
  if ( !m || action.onHit || action.onSave || action.outcome ) return action;
  if ( action.save ) return { ...action, onSave: [m.crit ?? m.success ?? null, m.success ?? null, null, null] };
  return { ...action, onHit: [m.critFail ?? null, m.fail ?? null, m.success ?? null, m.crit ?? m.success ?? null] };
}
