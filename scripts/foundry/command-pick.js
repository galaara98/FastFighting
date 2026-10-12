/**
 * Who takes command of a group the GM hasn't given a commander (battle.js commandChains). Pure: it reads only what it's
 * given.
 *
 * Outside the party: the group's best. The system's own ranking of who leads (adapter.detectLeaders: social and warfare
 * skills, a commander's class, rallying abilities) counts double; how bossy the creature is sways it (its playstyles,
 * Wants to Lead above all; its nerve; its head for tactics); a rarer creature, where its system rates rarity (PF2e),
 * a little more. A group of five or more gets a lieutenant too.
 * The party: the roles the GM gave its members in earlier fights; else a leader only when one member, and only one,
 * wants to lead.
 */

/** How much each playstyle makes a creature want to be in charge (Wants to Lead above all), or keeps it from it. */
export const BOSSY = Object.freeze({
  leader: 4, instigator: 1.5, cruel: 1, brawler: 0.5, relentless: 0.5, skeptic: 0.5, vengeful: 0.5, redeemSeeker: 0.5,
  peoplePleaser: -2, wallflower: -2, chicken: -2, enabler: -1.5, lazy: -1.5, mercenary: -1, wildcard: -0.5, fragile: -0.5
});

/** A playstyle's pull by its pill's place: the first counts most. */
const PILL_WEIGHT = [1.5, 1, 0.8, 0.6];

/**
 * A rarer creature's slight edge for command (spec.rarity: 0 common, 1 uncommon, 2 rare, 3 unique, where the system
 * rates it): enough to settle a near thing, never to beat a plainly better leader.
 */
export const RARITY_PULL = Object.freeze([0, 0.5, 1, 1.5]);
export const rarityPull = rarity => RARITY_PULL[Math.max(0, Math.min(3, Math.round(Number(rarity) || 0)))];

/** The system's ranking counts this many times over how bossy a creature is. */
const STATS = 2;

/** A member the system doesn't rank as a leader at all starts this far behind (before doubling). */
const UNRANKED = -10;

/**
 * A creature's pull toward being in charge: its playstyles, its nerve (Brave) and its head for tactics (Tactical).
 * @param {{playstyles?: string[], traits?: Record<string, number>}} creature   traits 0-100, 50 the usual
 */
export function bossiness({ playstyles = [], traits = {} } = {}) {
  const pull = playstyles.reduce((s, id, i) => s + (BOSSY[id] ?? 0) * (PILL_WEIGHT[i] ?? 0.5), 0);
  const trait = k => Number(traits[k] ?? 50);
  return pull + (trait("brave") - 50) / 25 + (trait("tactical") - 50) / 50;
}

/**
 * A group's members outside the party, the best to command it first: [{id, score}].
 * @param {{id: string, playstyles?: string[], traits?: object, rarity?: number}[]} members
 * @param {{id: string, score: number}[]} ranked   the system's ranking of who leads (adapter.detectLeaders)
 */
export function rankForCommand(members, ranked = []) {
  const stats = new Map(ranked.map(r => [r.id, Number(r.score) || 0]));
  return members.map(m => ({ id: m.id, score: STATS * (stats.has(m.id) ? stats.get(m.id) : UNRANKED) + bossiness(m) + rarityPull(m.rarity) }))
    .sort((a, b) => b.score - a.score);
}

/** How many lieutenants a group outside the party gets on its own: one, in a group of five or more. */
export const autoLieutenants = size => (size > 4 ? 1 : 0);

/**
 * The party's roles on its own: the ones its members held in earlier fights; else a leader only when one member, and
 * only one, wants to lead. [{id, slot: "leader" | "lt1" | "lt2", why: "remembered" | "wantsToLead"}]
 * @param {{id: string, actorId: string, playstyles?: string[]}[]} members   those the GM hasn't given a role in this plan
 * @param {Record<string, string>} remembered   actorId -> the slot the GM gave it last
 * @param {Set<string>} taken   slots the GM filled in this plan
 */
export function partyRoles(members, remembered = {}, taken = new Set()) {
  const out = [];
  const placed = id => out.some(o => o.id === id);
  for ( const slot of ["leader", "lt1", "lt2"] ) {
    if ( taken.has(slot) ) continue;
    const m = members.find(x => x.actorId && remembered[x.actorId] === slot && !placed(x.id));
    if ( m ) out.push({ id: m.id, slot, why: "remembered" });
  }
  if ( !taken.has("leader") && !out.some(o => o.slot === "leader") ) {
    const keen = members.filter(m => m.playstyles?.includes("leader"));
    if ( keen.length === 1 && !placed(keen[0].id) ) out.push({ id: keen[0].id, slot: "leader", why: "wantsToLead" });
  }
  return out;
}

/**
 * The party's roles to remember after the GM gives one (or takes one away): actorId -> slot. A boss in the party
 * leads as its leader; a slot has one holder.
 * @param {Record<string, string>} memory
 * @param {string} actorId
 * @param {string|null} role   the token's role now ("none" or null: none)
 */
export function rememberRole(memory, actorId, role) {
  const slot = role === "boss" ? "leader" : role;
  const out = Object.fromEntries(Object.entries(memory ?? {}).filter(([a, s]) => a !== actorId && s !== slot));
  if ( ["leader", "lt1", "lt2"].includes(slot) ) out[actorId] = slot;
  return out;
}
