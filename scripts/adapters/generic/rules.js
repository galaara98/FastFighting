/**
 * Generic d20 rules for systems without a dedicated adapter: one attack action per turn, hit on total >= AC,
 * natural 20 crits (double damage), natural 1 misses, down at 0 HP. Pure.
 */
import { DOWNED_MODELS, STATUS } from "../../constants.js";

export const genericRules = {
  id: "generic-d20",
  actionsPerTurn: 1,

  degreeOfSuccess(natural, total, dc) {
    if ( natural === 20 ) return 3;
    if ( natural === 1 ) return 1;
    return total >= dc ? 2 : 1;
  },

  roll(rng, modifier, dc) {
    const natural = rng.d20();
    return { natural, total: natural + modifier, degree: this.degreeOfSuccess(natural, natural + modifier, dc) };
  },

  attackPenalty() {
    return 0;
  },

  basicSaveMultiplier(degree) {
    return degree >= 2 ? 0.5 : 1;
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
