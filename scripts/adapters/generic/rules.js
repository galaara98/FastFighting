/**
 * Generic d20 rules for systems without a dedicated helper: one action and a move each turn, hit on total >= AC,
 * a natural 20 on an attack crits (double damage), a natural 1 misses, down at 0 HP. Pure.
 */
import { DOWNED_MODELS, STATUS } from "../../constants.js";
import { doubled } from "../../engine/dice.js";

export const genericRules = {
  id: "generic-d20",

  /** One action and a full move each turn; moving doesn't cost the action. */
  mainPool: "action",
  movement: "feet",
  turn(u) {
    return { action: 1, move: Math.max(0, ...Object.values(u.spec.speeds ?? { walk: 30 })) };
  },
  costOf() {
    return { action: 1 };
  },
  basicAction: { action: 1 },

  degreeOfSuccess(natural, total, dc, kind = "check") {
    if ( kind === "attack" ) {
      if ( natural === 20 ) return 3;
      if ( natural === 1 ) return 1;
    }
    return total >= dc ? 2 : 1;
  },

  attackPenalty() {
    return 0;
  },

  /** Half damage on a successful save (none if the effect isn't "basic"). */
  saveMultiplier(degree, save) {
    if ( degree >= 2 ) return save?.basic === false ? 0 : 0.5;
    return 1;
  },

  critical(parts) {
    return doubled(parts);
  },

  applyIwr(iwr, byType) {
    let total = 0;
    for ( const [type, amount] of Object.entries(byType) ) {
      if ( iwr?.immune?.includes(type) ) continue;
      let value = amount;
      if ( iwr?.resist?.[type] ) value = Math.floor(value / 2);
      if ( iwr?.weak?.[type] ) value *= 2;
      total += value;
    }
    return total;
  },

  onDropped(c, { model = DOWNED_MODELS.OUT } = {}) {
    c.status = (model === DOWNED_MODELS.DEAD || c.spec.diesAtZero) ? STATUS.DEAD : STATUS.DOWN;
    c.stable = true; // the generic rules don't model dying
    return c.status;
  },

  onHealed(c, amount) {
    c.hp = Math.min(c.maxHp, c.hp + amount);
    if ( c.status === STATUS.DOWN && c.hp > 0 ) c.status = STATUS.STANDING;
  },

  recoveryCheck: null,

  persistentFlatCheck(rng) {
    return rng.d20() >= 11;
  }
};
