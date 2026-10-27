/**
 * Battle preparation (once per batch) and per-run mutable state.
 *
 * @typedef {object} CombatantSpec
 * @property {string} id
 * @property {string} name
 * @property {string} side
 * @property {string} kind                  "pc" | "npc" | "companion" | "summon" | "minion" | "hazard"
 * @property {object} [hazard]              A hazard (a trap, a haunt, a hazardous feature): {once} (a simple one fires once).
 *                                          It doesn't move, think or talk; give it untargetable too (nobody attacks it).
 * @property {number} level
 * @property {{value: number, max: number, temp?: number}} hp
 * @property {{ac: number, fortitude?: number, reflex?: number, will?: number}} defenses
 * @property {{ac: number}|null} [shield]   Shield bonus available via Raise a Shield
 * @property {{mod: number, stealth?: number}} initiative
 * @property {Record<string, number>} speeds  walk / fly / swim / climb / burrow in feet
 * @property {ActionSpec[]} actions
 * @property {{immune?: string[], weak?: Record<string,number>, resist?: Record<string,number>}} iwr
 * @property {Record<string, number>} [resources]  Pools such as "focus", "slot:3", "item:<id>"
 * @property {Record<string, {base:number, fudge:number}>} traits
 * @property {object} [flags]               packTactics, fearless, mindless, masterId, flying
 * @property {boolean} [animalistic]        Fights as an animal does (behavior/animal.js): the helper's call
 * @property {boolean} [diesAtZero]         NPCs normally die at 0 HP
 * @property {object} [social]              Talking: {languages[], anyLanguage?, mindless, gullible?, resolve?, pitches,
 *                                          resist} (anyLanguage: it understands and speaks every language)
 *   pitches: {persuade|intimidate|deceive: {skill: display name, mod}}   what this creature can try on others
 *   resist:  {persuade|intimidate|deceive: {dc, label}}                  the DC others face, and what it's called
 *   resolve: how much more strong-willed than typical for its level (0 typical; -5 or less: very gullible)
 * @property {object} [valuables]           What it has that could change hands (stolen, looted, given up; its team's
 *                                          purse, the GM's, besides: spec.purses, by group key, behavior/talk.js remaining):
 *   {money: total in the smallest coin, denominations: [{label, value}] largest first,
 *    stowed: [{id, name, value, quantity?, category?, material?, rarity?}] carried but not wielded or worn (value: each;
 *    quantity: how many, one if it doesn't say), wielded: (the same) in its hands, worn: (the same) on it: those two
 *    only ever robbed off a fallen creature (behavior/fallen.js), never stolen, given or taken in a deal,
 *    pooled: true where its side shares the money (Ironsworn's Supply: one pays, all have that much less),
 *    progress: n where giving ground marks n progress on its own track instead (an Ironsworn foe: the winner's reward)}
 * @property {number} [wounded]
 * @property {number} [doomed]
 * @property {number} [dying]               Already dying when the battle starts (a fight resumed mid-way)
 * @property {boolean} [stable]             At 0 HP: stable (true) or still dying (false); by default stable unless dying > 0
 * @property {Record<string, number|boolean>} [conditions]  Conditions already on the creature (frightened, slowed, ...)
 * @property {object[]} [persistent]        Persistent damage already running: DamagePart[] with persistent: true
 * @property {number} [perception]          Perception modifier, for bystanders noticing a fight
 * @property {{sight?: number|null, lowlight?: number|null, hearing?: number|null, smell?: number|null, feel?: number|null, radar?: number|null}} [senses]
 *                                          How far its senses reach, in feet (null: no limit; 0: none; left out: the
 *                                          ordinary): seeing, seeing in the dark, hearing, smell, any other of its own,
 *                                          and tech sensing (behavior/senses.js)
 * @property {{mod: number}} [firstAid]     Can stabilize the dying without magic (PF2e: trained in Medicine)
 * @property {number} [group]               A neutral token's friend group (1-3, from the planner): they look out for each other
 * @property {string} [creatureKind]        What kind of creature it is, as the system has it (5e: its type), for grouping neutrals
 * @property {number} [avoidFleeing]        not liking to flee, 0 to 1 (its answer to when to retreat; true: 1)
 * @property {number} [avoidKilling]        avoiding killing, 0 to 1 (its answer to who it goes for; true: 1)
 * @property {number} [alwaysTalk]          always talking unless being hurt, 0 to 1 (its answer to talking; true: 1)
 * @property {object[]} [saveVs]            Situational saves: bonuses (or advantage) against effects with some tags only
 *                                          (behavior/save-vs.js)
 * @property {object[]} [auras]             Auras that make foes save, as they come inside or start a turn there
 *                                          (behavior/auras.js)
 *
 * @typedef {object} ActionSpec
 * @property {string} id
 * @property {string} name
 * @property {string} kind                  "strike" | "spell-attack" | "save" | "auto" | "heal"
 * @property {number|object} cost           What one use costs: a number of the rules' main pool (PF2e actions), or
 *                                          {action: 1} / {bonus: 1} ... (see engine/turn.js); rules.costOf may decide
 * @property {object[]} [sequence]          A multiattack: component strikes made in order with one use
 * @property {string} [from]                A strike built on another (a multiattack's part): that one's id, so it counts
 *                                          as it for what needs a hit with it (requires)
 * @property {object|object[]} [requires]   What it needs first: {holding, target, lastHit, hits, self, shieldRaised}, all
 *                                          of them; a list, any one (see behavior/requires.js)
 * @property {number} [bonus]               Attack modifier
 * @property {number[]} [maps]              Multiple attack penalties
 * @property {boolean} [subjectToMAP]
 * @property {boolean} [melee]
 * @property {boolean} [thrown]             A ranged strike that throws the weapon itself (a dagger, a javelin, a bomb): told as the
 *                                          weapon flying, not as a shot from it
 * @property {number} [reach]
 * @property {{increment: number, max?: number}} [range]
 * @property {object[]} [damage]            DamagePart[]
 * @property {object[]} [critDamage]        DamagePart[] (defaults to doubled damage)
 * @property {object[]} [effects]           A hit's riders: {kind: "prone" | "grabbed" | "move" | "condition" | "save" |
 *                                          "affliction" | "control", critOnly, ...}; "control" carries `control`, a
 *                                          maneuver with its own roll (PF2e's Improved Grab: simulator.js applyEffects)
 * @property {boolean} [card]               A control action with a card of its own: a live battle shows it (`use`)
 *                                          before its roll
 * @property {{type: string, dc: number, basic: boolean}} [save]
 * @property {{targets: number}} [area]
 * @property {object[]} [heal]              DamagePart[] of healing
 * @property {string} [resource]            Pool key consumed per use
 * @property {string} [ammo]                Pool key its shots come from (API 20: ammunition, never saved up), and
 * @property {number} [ammoCost]            the rounds a shot takes (1)
 * @property {string} [gear]                What it uses, as a key: actions sharing one share whether it's in hand and
 *                                          loaded (API 20, engine/gear.js; default its own id)
 * @property {number} [drawCost]            Main-pool units to get it in hand (PF2e's Interact); with it, it starts out of hand
 * @property {number} [reload]              Main-pool units a Reload takes, apart from its cost (Infinity: none in a fight)
 * @property {boolean|number} [loaded]      Whether it starts loaded (default true), or the rounds loaded in it
 * @property {number} [capacity]            The rounds it holds loaded (1); a Reload loads one
 * @property {number} [uses]                Uses per battle when not pool-based
 * @property {boolean} [rechargeOnCrit]     Its uses come back when its user scores a critical hit with a Strike (PF2e
 *                                          Draconic Momentum: the Breath Weapon)
 * @property {boolean} [attack]             Counts toward MAP
 * @property {number} [die]                 The die its attack rolls, if not the creature's usual (DCC action dice)
 * @property {number} [critOn]              A natural this high threatens a crit (the system scales it to the die)
 * @property {number} [fumbleOn]            A natural this low fumbles
 * @property {number} [deedDie]             A die rolled with each attack, added to the roll and the damage; it
 *                                          decides the creature's deeds (DCC Mighty Deeds: spec.deeds, riders.js)
 * @property {object} [crit]                Its crit table: {die, mod, rows} (see riders.js)
 * @property {object} [repeat]              A DamagePart: how many times the damage is rolled (DCC magic missiles)
 * @property {number} [healDice]            Heals this many of the target's own hit dice (spec.hitDie)
 * @property {object} [casting]             A check whose total picks what it does, with tiers (see casting.js)
 * @property {object[]} [creatures]         kind "summon": the creatures it calls (CombatantSpecs, without id, side or
 *                                          position), with rounds (how long they stay), concentration, sustain (actions
 *                                          the summoner spends each turn to keep them: PF2e)
 *
 * @typedef {object} BattleSpec
 * @property {CombatantSpec[]} combatants
 * @property {Record<string, object>} sides           {id, label, enemies[], traits, leaderId, leadership, healAggro, morale}
 * @property {Record<string, object[]>} [command]       Chains of command, by group (a side; for those who take no side, a
 *   friend group: "neutralParty#2"): [{id, role: "boss" | "leader" | "lieutenant", leadership}], the boss or the leader
 *   first, then the 1st and 2nd lieutenants. Without it, a side's leaderId leads it.
 * @property {Record<string, Record<string, object>>} [approach]  approach[a][t] = {dist, mult, speed, mode, los, meleeOk}
 * @property {object} options                         {maxRounds, downedModel, positioning, morale, leadership, initiativeOrder, surprise}
 */
import { keepClear } from "./behavior/traps.js";
import { tiedOut } from "./behavior/holds.js";
import { holderOf, cutOff } from "./behavior/troubles.js";
import { saveVsBonus } from "./behavior/save-vs.js";
import { withManeuver } from "./maneuvers.js";
import { STATUS, NEUTRAL_PARTY, AVOID_KILLING, TACTICAL, clamp, fudged, tacticalTier, TRAITS } from "../constants.js";
import { isAnimalistic } from "./behavior/animal.js";
import { meanPart } from "./dice.js";
import { typicalValue, tacticFits } from "./tactics.js";
import { talkAffinity } from "./behavior/talk.js";
import { goadAction } from "./behavior/goad.js";
import { Turn } from "./turn.js";
import { initGear } from "./gear.js";
import { combineMods, netAdvantage } from "./mods.js";
import { conditionSetup, barred, profiled } from "./conditions.js";
import { inTheWay, crossed, crossedExtra, passOf, spotWithin, wallsKnown, lineOfSight, spotToShoot, coverFrom, crowdCost } from "./behavior/space.js";
import { degreeDistribution } from "./probability.js";
import { combinePlaystyles } from "./playstyles.js";
import { answersTo } from "../story/master.js";

const DEFAULT_APPROACH = Object.freeze({ dist: 5, mult: 1, speed: 25, mode: "walk", los: true, meleeOk: true });
const SIDE_WEIGHT = 0.3;

/**
 * One-time preparation shared by every run of a batch.
 */
export function prepareBattle(spec, rules) {
  const options = {
    maxRounds: 20,
    downedModel: "simulate",
    positioning: true,
    morale: true,
    leadership: true,
    // How readily followers take their lead (0 to 100: 50 is the usual), and how much more readily under a boss.
    leaderInfluence: 50,
    bossInfluence: 2,
    talking: true,
    opening: "auto",
    // (The GM's lean toward opening with a standoff, -50 to 50: behavior/standoff.js noncombatLean.)
    standoffNoncombat: 0,
    aftermath: "tell",
    ...spec.options
  };
  const sides = {};
  for ( const [id, side] of Object.entries(spec.sides) ) {
    sides[id] = {
      id,
      label: side.label ?? id,
      enemies: new Set(side.enemies ?? []),
      traits: Object.fromEntries(TRAITS.map(k => [k, fudged(side.traits?.[k] ?? 50)])),
      leaderId: options.leadership ? (side.leaderId ?? null) : null,
      leadership: leadershipOf(side.leadership),
      healAggro: side.healAggro ?? "balanced",
      morale: options.morale && side.morale !== false,
      // (The player party's wishes, its players' votes: desire.js partyWants.)
      party: side.party && Number(side.party.sway) > 0 ? side.party : null
    };
  }
  // Chains of command, by group: the boss or the leader first, then the lieutenants (at most two). A side with no chain
  // of its own but a leaderId: that leader alone.
  const command = {};
  if ( options.leadership ) {
    for ( const [key, chain] of Object.entries(spec.command ?? {}) ) {
      if ( !Array.isArray(chain) || !chain.length ) continue;
      command[key] = chain.filter(c => c?.id).slice(0, 3).map((c, i) => {
        const role = c.role === "boss" && i === 0 ? "boss" : c.role === "lieutenant" || i > 0 ? "lieutenant" : "leader";
        return { id: c.id, role, slot: SLOTS.includes(c.slot) ? c.slot : role === "lieutenant" ? (i > 1 ? "lt2" : "lt1") : role, leadership: leadershipOf(c.leadership) };
      });
    }
    for ( const [id, side] of Object.entries(sides) ) {
      if ( !command[id] && side.leaderId ) command[id] = [{ id: side.leaderId, role: "leader", leadership: side.leadership }];
      // (The side's own leaderId and leadership: whoever heads its chain.)
      if ( command[id] ) {
        side.leaderId = command[id][0].id;
        side.leadership = command[id][0].leadership;
      }
    }
  }
  // Enemy relations are symmetric.
  for ( const a of Object.values(sides) ) {
    for ( const b of a.enemies ) sides[b]?.enemies.add(a.id);
  }
  // Those who take no side: always there for anyone who stands aside mid-fight, and nobody's enemy as a side (each
  // of them turns on whoever crosses it, on its own).
  sides[NEUTRAL_PARTY] ??= {
    id: NEUTRAL_PARTY, label: spec.neutralLabel ?? NEUTRAL_PARTY, traits: Object.fromEntries(TRAITS.map(k => [k, fudged(50)])), leaderId: null,
    leadership: { brave: fudged(0), tacticalFloor: fudged(0), attack: fudged(0), ac: fudged(0) }, healAggro: "balanced", morale: options.morale
  };
  sides[NEUTRAL_PARTY].enemies = new Set();
  sides[NEUTRAL_PARTY].neutral = true;
  sides[NEUTRAL_PARTY].leaderId = null;
  for ( const s of Object.values(sides) ) s.enemies.delete(NEUTRAL_PARTY);

  const combatants = spec.combatants.filter(c => sides[c.side]).map(c => prepareCombatant(c, sides[c.side]));

  // Battle-worthiness: offense compared with everyone else on the field. The weakest may talk twice a turn.
  const offense = combatants.map(c => Math.max(0, ...c.offense.map(a => typicalValue(a, c.spec.level ?? 1, rules))));
  const sorted = [...offense].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  combatants.forEach((c, i) => {
    c.offensePower = offense[i];
    c.lowBattleWorth = median > 0 && offense[i] < median * 0.5;
    c.talkAffinity = talkAffinity(c.spec, c.traits, rules);
  });
  // A taunt its playstyles give it (behavior/goad.js): an action like its others, weighed against them.
  for ( const c of combatants ) {
    const goad = goadAction(c, rules, options);
    if ( goad ) c.offense.push(goad);
  }
  // First aid for a friend who's dying, in the fight as after it (PF2e Administer First Aid, 5e a Medicine check): a
  // heal of its own kind, for the dying only, a touch away, as dear as the system says.
  if ( rules.firstAid && rules.firstAidDC ) {
    for ( const c of combatants ) {
      if ( c.spec.firstAid && Number.isFinite(Number(c.spec.firstAid.mod)) ) {
        c.healActions.push({ id: `${c.spec.id}.firstAid`, name: "", kind: "heal", firstAid: true, cost: rules.firstAidCost ?? rules.basicAction ?? 1, reach: 5, heal: [], traits: [] });
      }
    }
  }

  const byId = new Map(combatants.map(c => [c.spec.id, c]));
  // Whoever heads a group (its boss or its leader) finds its words more readily (one who only wants to lead doesn't).
  for ( const chain of Object.values(command) ) headsUp(byId.get(chain[0]?.id));
  const approachOf = (aId, tId) => spec.approach?.[aId]?.[tId] ?? DEFAULT_APPROACH;

  // What each summoning calls, ready to join a fight (on the summoner's side, under its command).
  const summons = new Map();
  for ( const c of combatants ) {
    for ( const a of c.summonActions ) {
      const list = (a.creatures ?? []).map((t, i) => {
        const s = { ...t, id: `${c.spec.id}~${a.id}~${i}`, side: c.spec.side, kind: "summon", position: null, inEncounter: true, summoned: true,
          hp: { ...(t.hp ?? { value: 1, max: 1 }) }, actions: t.actions ?? [], traits: t.traits ?? c.spec.traits, flags: { ...(t.flags ?? {}), masterId: c.spec.id, fearless: true } };
        const p = prepareCombatant(s, sides[c.spec.side]);
        p.offensePower = Math.max(0, ...p.offense.map(x => typicalValue(x, s.level ?? 1, rules)));
        p.lowBattleWorth = false;
        p.talkAffinity = 0;
        return p;
      });
      summons.set(a.id, list);
    }
  }

  // Each team's reinforcements (the planner's: one creature, and how many can come), ready to join it when called
  // (behavior/reinforce.js): on its side, a friend group's in that group.
  const reinforcements = new Map();
  for ( const [key, r] of Object.entries(spec.reinforcements ?? {}) ) {
    if ( !r?.spec || !(Number(r.count) > 0) ) continue;
    const [sideKey, group] = key.startsWith(`${NEUTRAL_PARTY}#`) ? [NEUTRAL_PARTY, Number(key.split("#")[1]) || null] : [key, null];
    if ( !sides[sideKey] ) continue;
    const s = { ...r.spec, id: `reinforce~${key}`, side: sideKey, kind: r.spec.kind === "pc" ? "npc" : (r.spec.kind ?? "npc"), position: null, inEncounter: true,
      ...(group ? { originSide: "neutral", group } : {}), hp: { ...(r.spec.hp ?? { value: 1, max: 1 }) }, actions: r.spec.actions ?? [] };
    reinforcements.set(key, { p: prepareCombatant(s, sides[sideKey]), count: Math.round(Number(r.count)) });
  }

  return { spec, rules, options, sides, command, combatants, byId, approachOf, summons, reinforcements, meanCache: new Map() };
}

/** What heading a group lends a creature's words (prepareBattle; live.js when the GM changes who heads it). */
const HEAD_WORDS = 0.15;

/** One heading a group finds its words more readily; one who no longer does, as it was. */
export function headsUp(c, on = true) {
  if ( !c ) return;
  if ( !on ) {
    c.talkAffinity -= c.headWords ?? 0;
    c.headWords = 0;
    return;
  }
  if ( c.headWords || !(c.talkAffinity > 0) ) return;
  const raised = Math.min(1, c.talkAffinity + HEAD_WORDS);
  c.headWords = raised - c.talkAffinity;
  c.talkAffinity = raised;
}

/** The places in a group's chain of command, in order: its boss or its leader, then two lieutenants. */
export const SLOTS = Object.freeze(["boss", "leader", "lt1", "lt2"]);

/** What a leader lends those it leads, as fudged numbers: bravery, a floor under tactics, attack and AC. */
export function leadershipOf(l = {}) {
  return {
    brave: fudged(l?.brave ?? 0, -50, 50),
    tacticalFloor: fudged(l?.tacticalFloor ?? 0, 0, 100),
    attack: fudged(l?.attack ?? 0, -5, 5),
    ac: fudged(l?.ac ?? 0, -5, 5)
  };
}

/** How much a creature's own ADHD, at 100%, takes off its Tactical (a share of it). */
const ADHD_TACTICAL = 0.3;

/** A combatant as a batch uses it: its traits blended with its side's, and its actions sorted by what they're for. */
function prepareCombatant(c, side) {
  const traits = {};
  for ( const k of TRAITS ) {
    traits[k] = clamp(Math.round(fudged(c.traits?.[k] ?? 50) * (1 - SIDE_WEIGHT) + side.traits[k] * SIDE_WEIGHT), 0, 100);
  }
  // (Its own ADHD, 0 to 100%: its Tactical down to 70% of what it is, at 100%. The world's ADHD is the chance it follows
  // its urges: behavior/desire.js orderAgenda.)
  const adhd = clamp(Number(c.adhd) || 0, 0, 100);
  if ( adhd > 0 ) traits.tactical = clamp(Math.round(traits.tactical * (1 - ADHD_TACTICAL * adhd / 100)), 0, 100);
  const meanHeal = a => (a.heal ?? []).reduce((s, p) => s + meanPart(p), 0);
  // (Legendary actions are taken between others' turns, not on its own. A maneuver the core knows, with no outcomes of
  // its own: the core's, maneuvers.js.)
  const own = c.actions.filter(a => !a.legendary).map(withManeuver);
  return {
    spec: c,
    traits,
    isHealer: own.some(a => a.kind === "heal"),
    // (Or one the system says has powers of that kind: Ironsworn's horrors and the Firstborn.)
    isCaster: own.some(a => a.kind === "save" || a.kind === "spell-attack") || !!c.caster,
    flies: (c.speeds?.fly ?? 0) > 0,
    healActions: own.filter(a => a.kind === "heal").sort((x, y) => meanHeal(y) / y.cost - meanHeal(x) / x.cost),
    buffActions: own.filter(a => a.kind === "buff" && (a.outcome || Array.isArray(a.onDegree))),
    summonActions: own.filter(a => a.kind === "summon" && a.creatures?.length),
    offense: own.filter(a => !["heal", "buff", "summon"].includes(a.kind)),
    legendaryActions: c.legendary?.pool ? c.actions.filter(a => a.legendary && !["heal", "buff", "summon"].includes(a.kind)) : []
  };
}

/** Fresh mutable state for one run. */
/**
 * How a team's purse is pictured split among its members as the fight starts (the money itself stays in the purse):
 * a share each, a lieutenant 2, a leader 4, a boss a leader's times the boss's influence (options.bossInfluence, 2 by
 * default: 8). {shares: {unit id: n}, totalShares}. What one that dies leaves on its body: behavior/talk.js dropShare.
 */
export function purseShares(prep, key, members) {
  const chain = prep.command?.[key] ?? (prep.sides?.[key]?.leaderId ? [{ id: prep.sides[key].leaderId, role: "leader" }] : []);
  const boss = Number(prep.options?.bossInfluence) || 2;
  const shareOf = role => (role === "boss" ? 4 * boss : role === "leader" ? 4 : role === "lieutenant" ? 2 : 1);
  const shares = Object.fromEntries(members.map(u => [u.id, shareOf(chain.find(c => c.id === u.id)?.role)]));
  return { shares, totalShares: Object.values(shares).reduce((s, n) => s + n, 0) };
}

export function createRun(prep) {
  const units = prep.combatants.map(p => createUnit(prep, p));
  // Money its side pools (Ironsworn's Supply): what one pays, all of them have that much less of.
  for ( const u of units ) {
    if ( u.spec.valuables?.pooled ) u.pool = units.filter(o => o.side === u.side && o.spec.valuables?.pooled);
  }
  // A team's purse, the GM's (spec.purses, by group key, in the smallest coin): its members share it (behavior/talk.js
  // remaining). What's drawn from it is in their payments (a concession's `purse`), so it needs no keeping of its own.
  for ( const [key, money] of Object.entries(prep.spec?.purses ?? {}) ) {
    const amount = Math.max(0, Math.round(Number(money) || 0));
    const members = units.filter(u => groupKeyOf(u) === key);
    if ( !amount || !members.length ) continue;
    const purse = { key, money: amount, members, ...purseShares(prep, key, members) };
    for ( const u of members ) u.purse = purse;
  }
  // Boost pools several share (DCC's Fleeting Luck: a player's, for all its characters): one stock for the fight.
  const sharedPools = {};
  for ( const u of units ) {
    for ( const b of u.spec.boosts ?? [] ) if ( b.shared ) sharedPools[b.shared] ??= Number(u.spec.resources?.[b.pool]) || 0;
    u.sharedPools = sharedPools;
  }
  // A boss (the head of its group's chain, as a boss): almost never runs; in a standoff it's paid, not talked, away.
  for ( const chain of Object.values(prep.command ?? {}) ) {
    if ( chain?.[0]?.role !== "boss" ) continue;
    for ( const u of units ) if ( u.id === chain[0].id ) u.isBoss = true;
  }
  return {
    sharedPools,
    prep,
    units,
    fateInPlay: units.some(u => (u.resources.fate ?? 0) > 0), // anyone with hero points or the like to spend
    neutral: units.some(u => u.side === NEUTRAL_PARTY),        // anyone standing aside (more may, mid-fight)
    boosting: units.some(u => u.spec.boosts?.length),       // anyone who can burn Luck (or the like) on a roll
    counters: units.some(u => u.spec.reactions?.some(r => answersTo(r, "foeCasts"))), // anyone with a counterspell
    legendary: units.some(u => u.prep.legendaryActions?.length),               // anyone with legendary actions
    auras: units.some(u => u.spec.saveAura),                                     // anyone whose aura helps friends' saves
    foeAuras: units.some(u => u.spec.auras?.length),                             // anyone whose aura makes foes save (behavior/auras.js)
    guards: units.some(u => u.spec.reactions?.some(r => answersTo(r, "allyHit"))),     // anyone who reacts when a friend is hit
    wardens: units.some(u => u.spec.reactions?.some(r => answersTo(r, "allyTargeted"))), // anyone who covers a friend attacked
    movers: units.some(u => u.spec.reactions?.some(r => answersTo(r, "allyMoves") || answersTo(r, "foeApproaches"))), // anyone who answers a move beside it
    // anyone whose opportunity strike answers a foe moving through its reach, longer than a square (PF2e: a reach weapon)
    reachers: !!prep.rules.opportunityOn?.includes("foeMovesInReach") && units.some(u => u.spec.actions?.some(a => a.kind === "strike" && a.melee && (a.reach ?? 5) > 5)),
    untargetable: units.some(u => u.spec.untargetable),                           // anything nobody can attack (a hazard)
    byId: new Map(units.map(u => [u.id, u])),
    round: 0,
    sideFocus: {},
    firstFallen: null,
    log: null
  };
}

/** One combatant's state for a fight (a summoned creature's too, when it's called). */
export function createUnit(prep, p) {
  const s = p.spec;
  const resources = { ...(s.resources ?? {}) };
  const uses = {};
  for ( const a of s.actions ) if ( Number.isFinite(a.uses) ) uses[a.id] = a.uses;
  // (What it can't do tied up: what needs hands, and what the system rules out: behavior/holds.js tiedOut.)
  const handActions = new Set(s.actions.filter(a => tiedOut(prep.rules, a)).map(a => a.id));
  const u = {
    prep: p,
    handActions,
    // (Which of the core's conditions its system gives its own meaning, and its roll's points: engine/conditions.js.)
    coreConds: conditionSetup(prep.rules),
    spec: s,
    id: s.id,
    side: s.side,
    homeSide: s.side,      // where it belongs (a charmed creature fights for someone else until it wears off)
    controlledBy: null,
    hp: s.hp.value,
    maxHp: s.hp.max,
    temp: s.hp.temp ?? 0,
    // Stamina (a system's variant, PF2e's): spent before hit points; healing doesn't bring it back.
    stamina: s.hp.stamina?.value ?? 0,
    status: s.hp.value > 0 ? STATUS.STANDING : STATUS.DOWN,
    // A creature already dying keeps dying; one down at 0 HP without a dying value is stable.
    dying: s.hp.value > 0 ? 0 : Math.max(0, s.dying ?? 0),
    wounded: s.wounded ?? 0,
    doomed: s.doomed ?? 0,
    // The system may say outright (5e: a creature at 0 HP is dying until stabilized).
    stable: s.hp.value <= 0 && (s.stable ?? !(s.dying > 0)),
    prone: !!s.conditions?.prone,
    persistent: (s.persistent ?? []).map(part => ({ part, sourceId: null })),
    resources,
    resourcesStart: { ...resources },
    uses,
    lost: null,            // spells it lost to a failed check (DCC wizards), by action id
    disapproval: null,     // a DCC cleric's disapproval range, once a failure has widened it
    riderUses: null,       // limited riders used (riders.js)
    actsThisTurn: 0,       // actions taken this turn (which of several action dice the next one rolls)
    advance: 0,
    adjacent: new Set(),
    losGained: new Set(),
    lastAttackerId: null,
    targetId: null,
    shieldRaised: false,
    wavering: false,
    moraleStress: 0,
    damageDealt: 0,
    healingDone: 0,
    fellRound: null,
    wasDowned: false,
    healedTargets: new Set(),
    // (Its gear in hand, and what's loaded in what it reloads: engine/gear.js.)
    drawn: new Set(),
    loaded: new Map(),
    conds: Object.fromEntries(Object.entries(s.conditions ?? {}).filter(([k]) => k !== "prone").map(([k, v]) => [k, v === true ? 1 : Number(v) || 0])),
    baseConds: null, // set below: conditions that were there before any affliction
    afflictions: [],
    effects: [],           // timed effects (crowd control, buffs, debuffs): see behavior/effects.js
    baseMods: s.mods ?? null, // bonuses and penalties already on it when the fight starts (one, or a list)
    mods: combineMods([].concat(s.mods ?? [])),
    marks: [],             // extra damage on the hits of whoever marked it (Hunter's Mark, Hex): {by, parts}
    vs: null,              // conditions that hold against one foe only (PF2e Feint): Map(sourceId -> conditions)
    concentration: null,   // the effect it is holding up (5e concentration): {actionId, name, worth}
    triedOn: null,         // once-per-target actions already tried (PF2e Demoralize)
    grabbedBy: null,
    tac: s.tactics ?? null, // replaced per fight by sampleRunTactics in runOne
    studied: new Set(),
    parleyed: false,
    turnsTaken: 0,
    harmedBy: new Map(),   // attackerId -> damage dealt to this unit
    rebuffed: new Map(),   // talkerId -> failed pitches
    offendedBy: new Set(), // talkers this unit will no longer listen to
    sway: new Map(),       // talker side -> persuasion progress
    swayTurn: new Map(),   // talkerId -> the talker's turn (turnsTaken) it last won a step (behavior/talk.js movedThisTurn)
    swayOutcome: null,
    // Taking no side (NEUTRAL_PARTY): the side it leans to, the sides it has turned on, how much each has crossed
    // it, and a quarrel it's still trying to settle with words. (See behavior/neutral.js.)
    lean: s.lean ?? null,
    friendGroup: s.side === NEUTRAL_PARTY && (s.originSide === "neutral" || s.originSide === "secret") && s.group ? s.group : null,
    against: new Set(),
    grievance: new Map(),
    crossedBy: new Set(),
    truce: null,
    // Encounter membership: combatants start active; bystanders wait until they notice the fight.
    active: s.inEncounter !== false || !!s.hazard, // (a hazard is set from the start: it has nothing to notice)
    aware: s.inEncounter !== false,
    joinedRound: s.inEncounter !== false ? 0 : null,
    calledForHelp: false,
    // Positions in feet (token centers), when the scene provided them.
    pos: s.position ? { x: s.position.x, y: s.position.y } : null,
    feetMoved: 0
  };
  u.baseConds = { ...u.conds };
  initGear(u, s.actions);
  prep.rules.initUnit?.(u); // the system's own per-fight state (5e: death saves already on the sheet)
  // Ready to react from the start (5e opportunity attacks, PF2e Reactive Strike); none if the system has none.
  u.reactionsLeft = prep.rules.opportunity || prep.rules.ready || s.reactions?.length ? (prep.rules.reactions ? prep.rules.reactions(u) : 1) : 0;
  // (A legendary creature starts the fight with its legendary actions, and has them back at the start of each turn.)
  if ( s.legendary?.pool ) u.legendaryLeft = s.legendary.pool;
  return u;
}

/** On its feet and taking part (bystanders who haven't joined are not). */
export const isStanding = u => u.status === STATUS.STANDING && u.active !== false;

/** On its feet, whether or not it has joined the fight. */
export const isUp = u => u.status === STATUS.STANDING;

/** How much of its hit points u has left, 0 to 1 (1 for one with none to lose). */
export const hpFraction = u => (u.maxHp > 0 ? u.hp / u.maxHp : 1);

/** How dangerous a creature seems, by its level and the harm it has done (who's "the most dangerous"). */
export const dangerScore = u => (Number(u.spec.level) || 0) * 2 + (u.damageDealt ?? 0) / 5;

/**
 * Its regeneration right now: its own (spec.regen), or one an effect lends it (a Regenerate spell: effects.js), the
 * stronger. {amount, stoppedBy, needsHp} or null.
 */
export function regenOf(u) {
  const own = u.spec.regen ?? null;
  const lent = u.fxRegen ?? null;
  if ( !own || !lent ) return own ?? lent;
  return (Number(lent.amount) || 0) > (Number(own.amount) || 0) ? lent : own;
}

/** Can it regain hit points (not under a wound that won't close: the unhealable condition)? */
export const canHeal = u => !barred(u, "heal");

/** Straight-line feet between two units' centers, or null without positions. */
export function centerDistance(a, b) {
  if ( !a.pos || !b.pos ) return null;
  return Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
}

/** Edge-to-edge feet between two units (adjacent creatures are 5 ft apart). */
export function edgeDistance(a, b) {
  const d = centerDistance(a, b);
  if ( d === null ) return null;
  const sizeA = a.spec.position?.size ?? 5;
  const sizeB = b.spec.position?.size ?? 5;
  return Math.max(5, d - ((sizeA + sizeB) / 2 - 5));
}

/** How strong a wish is, 0 to 1 (a tick-box's true is all of it). */
export const wish = v => (v === true ? 1 : clamp(Number(v) || 0, 0, 1));

/** Does a wish this strong win out this time? (No dice for none or all of it: the fight's other rolls stay as they were.) */
export const wishWins = (run, v) => {
  const strength = wish(v);
  return strength >= 1 || (strength > 0 && run.rng.chance(strength));
};

/**
 * How strongly u would rather not kill, this fight: its stated wish (spec.avoidKilling, from its answer), or what this
 * fight's answer to "Foes who fall" means (its own, calculated, or its party's): sparing them all of it, taking them
 * alive to tie up most of it (TAKING_ALIVE).
 */
const TAKING_ALIVE = Object.freeze({ spare: 1, tie: 0.66 });
const avoidsKilling = u => Math.max(wish(u?.spec.avoidKilling), TAKING_ALIVE[u?.tac?.fallen] ?? 0);

/**
 * One who avoids killing holds back from a kill this time? As often as the avoidKilling setting says (90% by default)
 * for "Spare them: I avoid killing", less for answers that lean less that way: nobody controls the story entirely.
 */
export function holdsBack(run, u) {
  const strength = avoidsKilling(u);
  if ( !strength ) return false;
  return run.rng.chance((clamp(run.prep.options.avoidKilling ?? AVOID_KILLING, 0, 100) / 100) * strength);
}

/** The same, decided once a round: choosing whom to strike, it doesn't change its mind with every look. */
export function holdsBackThisRound(run, u) {
  if ( !avoidsKilling(u) ) return false;
  if ( u.holdBackRound !== run.round ) {
    u.holdBackRound = run.round;
    u.holdingBack = holdsBack(run, u);
  }
  return u.holdingBack;
}

/**
 * Does u pull its blows this round, striking to knock out rather than kill: holding back (holdsBackThisRound), or one
 * that spares the fallen every time (a Moralist)? Only where its system says which blows can be pulled (rules.pullsBlow);
 * those it strikes with then cost what the system says (rules.pullPenalty: PF2e's -2 for a lethal weapon).
 */
export function pullsThisRound(run, u) {
  if ( !run.prep.rules.pullsBlow || !u ) return false;
  return holdsBackThisRound(run, u) || (Number(behaviorOf(u).spareDowned) || 0) >= 1;
}

/** Playstyle-driven behavior chances (see engine/playstyles.js): its own, leaning toward its leader's on a turn it follows. */
export function behaviorOf(u) {
  return u.turnBehavior ?? u.ownBehavior ?? u.spec.behavior ?? {};
}

/**
 * u has changed sides: wanting to lead (a playstyle) goes, with whatever it was brooding over. Its pills are worked out
 * again without it, for the rest of the fight (and the real fight takes it off the character: final.ambitionDropped).
 */
export function dropAmbition(u) {
  const ids = u.spec.playstyles ?? [];
  u.scheming = null;
  if ( u.ambitionGone || !ids.includes("leader") ) return;
  u.ambitionGone = true;
  const rest = combinePlaystyles(ids.filter(id => id !== "leader"), { stayTrue: !!u.spec.stayTrue, roleplay: !!u.spec.roleplay, fits: (k, v) => tacticFits(k, v, u.spec) });
  u.ownBehavior = rest.behavior;
  u.ownDesireStyle = rest.desire;
}

/** Does u refuse to help t: scheming against its leaders this turn, and t one of its group's chain of command? */
export function refusesToHelp(run, u, t) {
  if ( !u?.scheming || !t || t === u ) return false;
  return !!chainOf(run, groupKeyOf(u))?.some(c => c.id === t.id);
}

/**
 * Lore-Collector bonus against a foe it has sized up: +1 to its attacks (+2 when the foe has a weakness to exploit),
 * and +1 to its words (it knows what moves them). While its payoff for sizing it up holds (a boost: see effects.js),
 * that counts instead.
 */
export function studyBonus(u, t, { words = false } = {}) {
  if ( !t || !sizedUp(u, t) || boosted(u, t) ) return 0;
  return !words && Object.keys(t.spec.iwr?.weak ?? {}).length ? 2 : 1;
}

/**
 * A foe's sort, for what sizing it up teaches: its stat block (the actor its token is of), else its name without the
 * number tokens get ("Goblin Warrior 2": goblin warrior). Knowing one goblin warrior is knowing them all.
 */
export const sortOf = t => String(t?.spec?.actorId ?? String(t?.spec?.name ?? "").toLowerCase().replace(/[\s\d#.()-]+$/, "").trim());

/** Has u sized t up: it, or another of its sort? */
export const sizedUp = (u, t) => !!t && !!u.studied?.size && (u.studied.has(t.id) || u.studied.has(`sort:${sortOf(t)}`));

/** Has u let t's sort go: tried and learned nothing, or decided against sizing it up? */
export const passedOver = (u, t) => !!t && !!u.studied?.size && (u.studied.has(`skip:${t.id}`) || u.studied.has(`skipsort:${sortOf(t)}`));

/** Does u have a boost against t (a Lore-Collector's payoff for sizing it up)? */
export const boosted = (u, t) => boostOf(u, t) > 1;

/**
 * The strongest boost u has against t (1: none). Only a Lore-Collector that paid for one has it: an action (or a
 * turn) spent sizing t up, and the sizing up worked (see simulator sizesUp).
 */
export function boostOf(u, t) {
  let best = 1;
  for ( const e of u?.effects ?? [] ) if ( e.boost > best && boostReaches(e, t) ) best = e.boost;
  return best;
}

/** Does a boost reach t: one for anyone, for t itself, or for t's sort? */
export const boostReaches = (e, t) => (!e.vs && !e.vsSort) || e.vs === t?.id || (!!e.vsSort && e.vsSort === sortOf(t));

/**
 * What a boost adds to a roll against t: the bonus that makes it about `boost` times as likely to succeed as it
 * would have been without one (as far as the dice allow), or 0 without a boost.
 */
export function boostBonus(rules, u, t, mod, dc, options = {}) {
  const factor = boostOf(u, t);
  if ( !(factor > 1) || !Number.isFinite(dc) ) return 0;
  const p = extra => {
    const d = degreeDistribution(rules, mod + extra, dc, options);
    return d[2] + d[3];
  };
  const base = p(0);
  const goal = Math.min(p(30), factor * base, 0.95);
  if ( base >= goal ) return 0;
  for ( let b = 1; b < 30; b++ ) if ( p(b) >= goal - 1e-9 ) return b;
  return 30;
}

/** u's bonuses and penalties for a roll against t: its own, with any that count against t alone. */
export function modsAgainst(u, t = null) {
  return (t && u.edgeMods?.get(t.id)) ?? u.mods ?? {};
}

export function areEnemies(run, a, b) {
  // Someone who takes no side fights only the sides it has turned on.
  if ( a.side === NEUTRAL_PARTY || b.side === NEUTRAL_PARTY ) return !!(a.against?.has(b.side) || b.against?.has(a.side));
  return run.prep.sides[a.side]?.enemies.has(b.side) ?? false;
}

/**
 * While a standoff holds, its sides keep their hands off each other. (Someone taking no side, and whoever it has come
 * to blows with, may fight it out meanwhile: that doesn't end the standoff.)
 */
export const heldOff = (run, a, b) => !!run.standoff && a.side !== NEUTRAL_PARTY && b.side !== NEUTRAL_PARTY;

export function enemiesOf(run, u) {
  if ( run.untargetable ) return run.units.filter(o => o !== u && !o.spec.untargetable && areEnemies(run, u, o));
  return run.units.filter(o => o !== u && areEnemies(run, u, o));
}

export function alliesOf(run, u) {
  // Standing aside: with its friend group (neutral tokens the planner grouped), else on its own.
  if ( u.side === NEUTRAL_PARTY ) return u.friendGroup ? run.units.filter(o => o.side === NEUTRAL_PARTY && o.friendGroup === u.friendGroup) : [u];
  return run.units.filter(o => o.side === u.side);
}

/**
 * Its teammates on the map and on their feet (behavior/together.js): kept until someone moves (run.geo) or the round
 * turns, the spot searches ask it so often.
 */
export function teamOf(run, u) {
  const kept = u.teamKept;
  if ( kept && kept.geo === run.geo && kept.round === run.round && kept.side === u.side ) return kept.list;
  const list = alliesOf(run, u).filter(a => a !== u && isStanding(a) && a.pos && !a.spec.hazard);
  u.teamKept = { geo: run.geo, round: run.round, side: u.side, list };
  return list;
}

/** For one keeping together this turn (u.together: behavior/together.js), what a spot costs it bunched up (space.js crowdCost), or null. */
const crowdOf = (run, u, t) => (u.together ? crowdCost(u, teamOf(run, u), t) : null);

/* Chains of command ------------------------------------------------------
 * Every group (a side; for those who take no side, each friend group) may have a boss (never the party) or a leader,
 * and up to two lieutenants. Whoever of them comes first and can lead right now commands the group: a lieutenant steps
 * up (as a leader: never a boss) when those before it are down, dead, gone, or can't make themselves seen and heard
 * (blinded, deafened, silenced, out of their wits); the boss or the leader takes back over when it can again. Nobody
 * able to lead: the group is leaderless.
 */

/** The group a unit belongs to, for command: its side, or its friend group if it takes no side (or null, alone). */
export const groupKeyOf = u => (u.side === NEUTRAL_PARTY ? (u.friendGroup ? `${NEUTRAL_PARTY}#${u.friendGroup}` : null) : u.side);

/** Conditions that keep a commander from directing anyone. */
const CANT_COMMAND = new Set(["incapacitated", "controlled", "unconscious", "paralyzed", "stunned", "confused", "fleeing", "blinded", "deafened", "silenced", "petrified"]);

/**
 * Is u in the fight? Not one who has yet to notice it, nor one who takes no side and hasn't turned on anyone (standing
 * clear, watching): such a one can't lead its group in it. Its group looks to the next who can.
 */
const inTheFight = u => u.active !== false && (u.side !== NEUTRAL_PARTY || u.against?.size > 0);

/** Can u direct its group right now: up and in the fight, its own master, and able to see, hear and speak? */
export function canCommand(u) {
  if ( !u || !isStanding(u) || u.controlledBy ) return false;
  for ( const k in u.conds ?? {} ) if ( u.conds[k] > 0 && CANT_COMMAND.has(k) ) return false;
  // (The core's own: choking, swallowed, frozen solid, banished ...)
  return !barred(u, "command");
}

/** A group's chain of command, as given (or a side's lone leader): [{id, role, leadership}]. */
export function chainOf(run, key) {
  if ( !key ) return null;
  const chain = run.prep.command?.[key];
  if ( chain ) return chain;
  const side = run.prep.sides?.[key];
  return side?.leaderId ? [{ id: side.leaderId, role: "leader", leadership: side.leadership }] : null;
}

/**
 * Who commands a group right now: {unit, role ("boss" only for the boss itself; anyone after it leads as a leader),
 * boss, leadership, rank (0 the head, 1 and 2 the lieutenants)}, or null (leaderless).
 */
export function command(run, key) {
  const chain = chainOf(run, key);
  if ( !chain?.length ) return null;
  for ( let i = 0; i < chain.length; i++ ) {
    const u = run.byId.get(chain[i].id);
    if ( !u || groupKeyOf(u) !== key || !canCommand(u) || !inTheFight(u) ) continue;
    const boss = i === 0 && chain[i].role === "boss";
    return { unit: u, role: boss ? "boss" : "leader", boss, leadership: chain[i].leadership, rank: i };
  }
  return null;
}

/** Who commands u's group right now (null: leaderless, or alone). */
export const commandOf = (run, u) => command(run, groupKeyOf(u));

/** Trait value including live leadership effects. */
export function liveTrait(run, u, trait) {
  let value = u.prep.traits[trait];
  if ( trait === "brave" || trait === "tactical" ) {
    const cmd = commandOf(run, u);
    if ( cmd && cmd.unit !== u ) {
      if ( trait === "brave" ) value += cmd.leadership.brave;
      if ( trait === "tactical" ) value = Math.max(value, cmd.leadership.tacticalFloor);
    }
  }
  return clamp(value, 0, 100);
}

export function liveTier(run, u) {
  const tier = tacticalTier(liveTrait(run, u, "tactical"));
  // (An animal reads the fight; it doesn't plan one: behavior/animal.js.)
  return isAnimalistic(u) ? Math.min(tier, TACTICAL.INSTINCTIVE) : tier;
}

/* Rules-facing situation ------------------------------------------------
 * The engine knows the facts (prone, grabbed, flanked, how far, which conditions); the system's rules say what
 * they're worth. Leadership, wavering and studying a foe are FastFighting's own and stay here.
 */

/** Attackers flank when another standing ally of theirs is adjacent to the target and they coordinate. */
export function isFlanked(run, target, attacker) {
  if ( !attacker.adjacent.has(target.id) ) return false;
  const coordinates = liveTier(run, attacker) >= 2 || attacker.spec.flags?.packTactics;
  if ( !coordinates ) return false;
  return alliesAdjacentTo(run, target, attacker) >= 1;
}

/** Number of attacker's standing allies (excluding the attacker) adjacent to the target. */
export function alliesAdjacentTo(run, target, attacker) {
  let n = 0;
  for ( const id of target.adjacent ) {
    const other = run.byId.get(id);
    if ( other && other !== attacker && other.side === attacker.side && isStanding(other) ) n += 1;
  }
  return n;
}

/**
 * The facts the rules weigh for an attack (or an effect) from attacker against target: {target, attacker, action,
 * grabbed, flanked, alliesAdjacent, attackerEngaged, distance, positioning, exposedTo}. Each is worked out only when
 * the rules ask for it, and once.
 */
export function situation(run, target, attacker = null, action = null) {
  return new Situation(run, target, attacker, action);
}

class Situation {
  #run;
  #facts = {};
  constructor(run, target, attacker, action) {
    this.#run = run;
    this.target = target;
    this.attacker = attacker;
    this.action = action;
    this.positioning = !!run.prep.options.positioning;
  }

  #fact(key, work) {
    if ( !(key in this.#facts) ) this.#facts[key] = work();
    return this.#facts[key];
  }

  get grabbed() {
    return this.#fact("grabbed", () => {
      const grabber = this.target.grabbedBy ? this.#run.byId.get(this.target.grabbedBy) : null;
      return !!(grabber && isStanding(grabber));
    });
  }

  get flanked() {
    return this.#fact("flanked", () => !!(this.attacker && this.action?.melee && isFlanked(this.#run, this.target, this.attacker)));
  }

  /** Standing allies of the attacker next to the target (5e Pack Tactics). */
  get alliesAdjacent() {
    return this.#fact("alliesAdjacent", () => (this.attacker ? alliesAdjacentTo(this.#run, this.target, this.attacker) : 0));
  }

  /** Whether a foe is next to the attacker (5e: a ranged attack in melee has disadvantage). */
  get attackerEngaged() {
    return this.#fact("attackerEngaged", () => !!this.attacker && [...this.attacker.adjacent].some(id => {
      const o = this.#run.byId.get(id);
      return o && isStanding(o) && areEnemies(this.#run, this.attacker, o);
    }));
  }

  /** The cover the target has from the attacker, by the scene's walls: "none", "some", "most", "total" (behavior/space.js). */
  get cover() {
    return this.#fact("cover", () => (wallsKnown(this.#run) && this.attacker?.pos && this.target?.pos ? coverFrom(this.#run, this.attacker, this.target) : "none"));
  }

  get distance() {
    return this.#fact("distance", () => (this.attacker ? separation(this.#run, this.attacker, this.target) : 0));
  }

  /** Off guard against this attacker in particular (PF2e Feint). */
  get exposedTo() {
    // (Off-guard to this attacker alone, or to its melee attacks alone: effects.js onlyVs.)
    return this.#fact("exposedTo", () => !!(this.attacker && (this.target.vs?.get(this.attacker.id)?.offGuard
      || (this.action?.melee && this.target.vsMelee?.get(this.attacker.id)?.offGuard))));
  }
}

/** Is the target exposed to this attack (PF2e: off-guard; 5e: attacked with advantage)? */
export function isExposed(run, target, attacker = null, action = null) {
  const rules = run.prep.rules;
  const ctx = situation(run, target, attacker, action);
  if ( rules.modifiers?.exposed ) return !!rules.modifiers.exposed(ctx);
  return !!(target.prone || ctx.grabbed || ctx.flanked || ctx.exposedTo || target.conds.offGuard);
}

/** Current AC: base, a raised shield, leadership, and whatever the rules make of the situation. */
export function currentAc(run, target, attacker, action) {
  let ac = target.spec.defenses.ac;
  if ( target.shieldRaised && target.spec.shield ) ac += target.spec.shield.ac;
  const cmd = commandOf(run, target);
  if ( cmd ) ac += cmd.leadership.ac;
  ac += target.mods?.ac ?? 0;
  ac += run.prep.rules.modifiers?.defense?.(situation(run, target, attacker, action)) ?? 0;
  ac += coverDefault(run, target, attacker);
  return ac;
}

/** A d20 point or two: what three quarters' cover or more adds to a defense where the system has no rule for cover. */
export const COVER_POINTS = 2;

/** The shapes that spread from the one who makes them (the rest, bursts, from where they're aimed). */
export const FROM_USER = Object.freeze(["cone", "line", "emanation", "cube"]);

/**
 * An area that lands where it's drawn, on everyone in it: one with a shape, on a map with positions. Its maker's friends
 * in it are caught too unless it's `selective` (it spares whom its maker chooses); its maker only in a burst of its
 * own (a cone, a line, a cube or an emanation spreads from it).
 */
export const drawnArea = (run, u, t, area) => !!area?.shape && !!run.prep.options.positioning && !!u.pos && !!t?.pos;

/** Friends of u's an area it aims at t would catch (u in a burst of its own too): none for a selective one, or off the map. */
export function friendsInArea(run, u, t, area, caught = o => inArea(run, u, t, o, area)) {
  if ( !drawnArea(run, u, t, area) || area.selective ) return [];
  return run.units.filter(o => o !== t && isStanding(o) && o.side === u.side && !areEnemies(run, u, o) && o.pos
    && (o !== u || !FROM_USER.includes(area.shape)) && caught(o));
}

/**
 * Could an area u aims at t also catch o? Off the map (no positions): anyone, as many as its count says. On it: o
 * within the area's size (area.feet; 10 if the system doesn't say) of where it spreads from (u, for a cone, a line, a
 * cube or an emanation; t, for a burst), a cone, a line or a cube only toward t, and nothing wholly in the way (walls:
 * total cover from where it spreads). A cone is area.angle degrees wide (a quarter turn if the system doesn't say); a
 * line, area.width feet across (5); a cube, area.feet on a side, one face against u (5e's); a square, area.feet on a
 * side round where it's aimed (a 5e cube placed at range), its sides along the map's.
 */
export function inArea(run, u, t, o, area) {
  if ( !run.prep.options.positioning || !u.pos || !t.pos || !o.pos ) return true;
  const shape = area.shape ?? "burst";
  const feet = Number(area.feet) > 0 ? Number(area.feet) : 10;
  const from = FROM_USER.includes(shape) ? u : t;
  if ( shape === "square" ) {
    // (Any square of o's inside it: its middle within half the side, and half o's width, of the middle's.)
    const half = feet / 2 + (o.spec.position?.size ?? 5) / 2 - 0.5;
    if ( Math.abs(o.pos.x - t.pos.x) > half || Math.abs(o.pos.y - t.pos.y) > half ) return false;
    return coverOf(run, o, t) !== "total";
  }
  if ( shape === "burst" ) {
    // (From a corner of t's space, as the system's own grid has a burst: any square of o's whose middle it reaches.)
    if ( !burstReaches(o, burstPoint(run, u, t, area), feet) ) return false;
    return coverOf(run, o, t) !== "total";
  }
  const d = edgeDistance(from, o);
  // (A cube's far corners lie beyond its side: up to the diagonal of half of it.)
  const most = shape === "cube" ? Math.hypot(feet, feet / 2) : feet;
  if ( d === null || d > most + 0.5 ) return false;
  if ( shape === "cone" || shape === "line" || shape === "cube" ) {
    const ax = t.pos.x - u.pos.x;
    const ay = t.pos.y - u.pos.y;
    const bx = o.pos.x - u.pos.x;
    const by = o.pos.y - u.pos.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if ( la && lb ) {
      const cos = (ax * bx + ay * by) / (la * lb);
      if ( cos <= 0 ) return false;
      const angle = Number(area.angle) > 0 ? Math.min(180, Number(area.angle)) : 90;
      if ( shape === "cone" && cos < Math.cos((angle / 2) * Math.PI / 180) - 1e-9 ) return false;
      // (Across it, a creature whose square touches it: half its width and half the line's or the cube's, plus a little.)
      const half = shape === "cube" ? feet / 2 : (Number(area.width) > 0 ? Number(area.width) : 5) / 2;
      const off = lb * Math.sqrt(Math.max(0, 1 - cos * cos));
      if ( shape !== "cone" && off > half + (o.spec.position?.size ?? 5) / 2 + 0.5 ) return false;
      // (Along it, a cube reaches only its side, from u's edge.)
      if ( shape === "cube" && lb * cos - ((o.spec.position?.size ?? 5) + (u.spec.position?.size ?? 5)) / 2 > feet + 0.5 ) return false;
    }
  }
  return coverOf(run, o, from) !== "total";
}

/** The middles of the squares a creature covers, in feet (one for a creature smaller than a square). */
function squareCenters(o) {
  const size = o.spec.position?.size ?? 5;
  const n = Math.max(1, Math.round(size / 5));
  if ( n === 1 ) return [o.pos];
  const out = [];
  for ( let i = 0; i < n; i++ ) for ( let j = 0; j < n; j++ ) out.push({ x: o.pos.x - size / 2 + (i + 0.5) * 5, y: o.pos.y - size / 2 + (j + 0.5) * 5 });
  return out;
}

/** How far out from its target's space a burst placed freely is looked for (feet): enough, and quick to search. */
const FREE_REACH = 15;

/** Does a burst at this point (a grid corner, in feet) of this radius reach o (any square of o's)? */
const burstReaches = (o, at, feet) => !!o.pos && squareCenters(o).some(c => Math.hypot(c.x - at.x, c.y - at.y) <= feet + 0.01);

/**
 * Where a burst u aims at t goes off: the corner of t's space (a grid corner, as the system's own template has it) that
 * catches the most of u's foes standing, less its friends (u too) unless it's `selective` (it spares whom it chooses);
 * the first, on a tie. Worked out once a turn for each aim. A system whose bursts are centered on what they're aimed
 * at, with no grid to snap to (`area.center: "target"`, API 34: DCC's "a radius centered on the target"): the middle of
 * t's space. A system whose burst's point of origin may be any point its maker chooses (`area.center: "free"`, API 35:
 * 5e's sphere and cylinder): the best of every point half a square apart in and round t's space (a square's corners,
 * its sides' middles, its middle), still catching t; on a tie, the one nearest t's middle.
 */
export function burstPoint(run, u, t, area) {
  if ( area.center === "target" ) return { x: t.pos.x, y: t.pos.y };
  const feet = Number(area.feet) > 0 ? Number(area.feet) : 10;
  const free = area.center === "free";
  const key = `${run.round}|${run.turn ?? 0}|${u.id}|${t.id}|${feet}|${area.selective ? 1 : 0}|${free ? 1 : 0}|${t.pos.x},${t.pos.y}|${u.pos?.x},${u.pos?.y}`;
  const kept = (run.burstPoints ??= new Map());
  if ( kept.has(key) ) return kept.get(key);
  if ( kept.size > 2000 ) kept.clear();
  const size = Math.max(5, Math.round((t.spec?.position?.size ?? 5) / 5) * 5);
  const left = Math.round((t.pos.x - size / 2) / 5) * 5;
  const top = Math.round((t.pos.y - size / 2) / 5) * 5;
  const foes = run.units.filter(o => o !== t && isStanding(o) && areEnemies(run, u, o));
  const friends = area.selective ? [] : run.units.filter(o => isStanding(o) && o.side === u.side && !areEnemies(run, u, o));
  // (Free: half a square apart, up to FREE_REACH out from t while the burst still catches it; else t's own corners.)
  const step = free ? 2.5 : 5;
  const out = free ? Math.min(FREE_REACH, Math.floor(feet / step) * step) : 0;
  let best = null;
  for ( let i = -out; i <= size + out; i += step ) {
    for ( let j = -out; j <= size + out; j += step ) {
      const at = { x: left + i, y: top + j };
      if ( free && !burstReaches(t, at, feet) ) continue;
      const score = foes.filter(o => burstReaches(o, at, feet)).length - friends.filter(o => burstReaches(o, at, feet)).length;
      const near = Math.hypot(at.x - t.pos.x, at.y - t.pos.y);
      if ( !best || score > best.score || (free && score === best.score && near < best.near) ) best = { at, score, near };
    }
  }
  if ( !best ) best = { at: { x: t.pos.x, y: t.pos.y } };
  kept.set(key, best.at);
  return best.at;
}

/** The cover t has from `from`, by the scene's walls (behavior/space.js): "none", "some", "most", "total". */
export const coverOf = (run, t, from) => (from && from !== t && wallsKnown(run) && t?.pos && from.pos ? coverFrom(run, from, t) : "none");

/**
 * What cover adds to t's defense against `from` (its AC against an attack, its save against what it set off), where
 * the system has no rule of its own for cover (rules.handlesCover: its rules read situation.cover, and a save's
 * cover, themselves): with three quarters of t hidden or more, COVER_POINTS, in the system's own points.
 */
export function coverDefault(run, t, from) {
  if ( run.prep.rules.handlesCover ) return 0;
  const cover = coverOf(run, t, from);
  return cover === "most" || cover === "total" ? Math.max(1, Math.round(COVER_POINTS * (t.coreConds?.scale ?? 1))) : 0;
}

/** Typical numbers for a creature of this level, when the system didn't supply one. */
export function typical(rules, what, level = 0) {
  const fn = rules?.typical?.[what];
  if ( fn ) return fn(level);
  return { ac: 10 + level, save: Math.ceil(level / 2) + 2, skill: Math.ceil(level / 2) + 2, dc: 10 + level }[what] ?? 0;
}

/** Spells and the like (an action with a spell rank, a spell check, or marked magical). */
export const isMagical = action => !!action && (!!action.magical || action.rank !== undefined || !!action.casting || !!action.spellId);

/**
 * A live battle's save or check the system rolls itself, its card in the chat, where it makes that kind (engine/live.js
 * systemRoll: "save", "check"): {degree, natural, total, dice}, for rollCheck's `rolled`; null, the engine's dice. A
 * save: u's, against what `from` did (`save`: its key, as the rules name it). A check: u's, at `target` (`purpose`, as
 * modifiers.check hears it; `skill`, where the spec names one; `against`, the defense it's rolled against;
 * `attackNumber`, the attacks it made this turn before it, for one with the attack trait: a multiple attack penalty;
 * `standoff`, true while a standoff holds, no blows struck yet: a system's words may differ then). `advantage`: the
 * engine's net advantage on it (above 0, advantage; below, disadvantage: API 24), for a system whose roller has it.
 */
export function systemRolled(run, u, kind, { dc, from = null, target = null, save = null, skill = null, purpose = null, against = null, attackNumber = null, action = null, label = "", advantage = 0, deal = null } = {}) {
  if ( !run.live?.playing || !u || !Number.isFinite(Number(dc)) ) return null;
  const what = { id: typeof action?.id === "string" ? action.id : null, name: action?.name ?? label ?? "" };
  const edge = Math.sign(Number(advantage) || 0);
  const request = kind === "save"
    ? { kind, unitId: u.id, targetId: from?.id ?? null, save: save ?? null, dc: Number(dc), action: what, advantage: edge }
    : {
      kind, unitId: u.id, targetId: target?.id ?? null, purpose: purpose ?? null, skill: skill ?? null, against: against ?? null, ...(Number.isInteger(attackNumber) ? { attackNumber } : {}),
      ...(run.standoff ? { standoff: true } : {}), dc: Number(dc), action: what, advantage: edge,
      // (A deal's check, API 26: what's offered or asked, and whether it's made without words: behavior/deals.js.)
      ...(deal ? { deal: { kind: deal.kind, ask: deal.ask ?? null, wordless: !!deal.wordless } } : {})
    };
  return run.live.roll?.(run, request) ?? null;
}

/**
 * A save's modifier and advantage. With `magical`, Magic Resistance (spec.magicResistance) gives advantage. A
 * friend's aura (spec.saveAura {bonus, range}: 5e Aura of Protection) adds to it while that friend is up and near
 * (the best one only). Its situational saves (spec.saveVs: behavior/save-vs.js) against what `action` is, from `from`.
 */
export function saveRoll(run, target, type, { magical = false, from = null, action = null } = {}) {
  if ( Array.isArray(type) ) {
    const rolls = type.map(t => saveRoll(run, target, t, { magical, from, action }));
    return rolls.reduce((best, r) => (r.mod + 3.5 * r.advantage > best.mod + 3.5 * best.advantage ? r : best), rolls[0] ?? saveRoll(run, target, "none"));
  }
  const base = target.spec.defenses[type] ?? typical(run.prep.rules, "save", target.spec.level ?? 0);
  // (Against what `from` set off: the cover it has from it, for the system's rules (PF2e's Reflex, 5e's Dexterity), or
  // the core's little more where they have none; and the action it's against, where there is one: a stupefied caster's
  // spell, PF2e's, is the easier to resist.)
  const m = run.prep.rules.modifiers?.save?.({ unit: target, type, cover: coverOf(run, target, from), from, action }) ?? {};
  const mods = target.mods ?? {};
  let advantage = netAdvantage(m.advantage ?? 0, mods.saveAdv ?? 0);
  if ( magical && target.spec.magicResistance ) advantage = netAdvantage(advantage, 1);
  const vs = target.spec.saveVs ? saveVsBonus(target, type, { action, from, magical }) : null;
  if ( vs?.advantage ) advantage = netAdvantage(advantage, vs.advantage);
  // (Its bonuses to every save, and to this one alone: mods.js bySave.)
  const own = (mods.saves ?? 0) + (Number(mods.bySave?.[type]) || 0);
  return { mod: base + (m.bonus ?? 0) + own + (vs?.bonus ?? 0) + auraBonus(run, target) + coverDefault(run, target, from), advantage, dice: mods.saveDie ?? null, roller: target };
}

/** The best save aura over t from a friend who's up and within its reach (anywhere, without positions). */
function auraBonus(run, t) {
  if ( !run.auras ) return 0;
  let best = 0;
  for ( const a of run.units ) {
    const aura = a.spec.saveAura;
    if ( !aura || a.side !== t.side || a.status !== STATUS.STANDING || a.conds?.incapacitated ) continue;
    const d = a === t ? 0 : edgeDistance(a, t);
    if ( d === null || d <= (aura.range ?? 10) ) best = Math.max(best, aura.bonus ?? 0);
  }
  return best;
}

/** Does t turn a success on this kind of save into a critical success (PF2e Evasion, Juggernaut, Resolve)? */
export const upgradesSave = (t, type) => !!t.spec.saveUpgrades?.length && [].concat(type).some(x => t.spec.saveUpgrades.includes(x));

/**
 * The DC to beat with a skill against a target's defense (PF2e: Will DC for Demoralize, Reflex DC for Trip,
 * Perception DC for Feint): the system's, else 10 + the defense's modifier.
 */
export function defenseDc(run, target, against, by = null) {
  const own = run.prep.rules.defenseDc?.(target, against, by);
  if ( Number.isFinite(own) ) return own;
  // (A Perception DC moves with its checks: its bonuses to every check and to Perception alone, mods.js byCheck.)
  if ( against === "perception" ) return 10 + (target.spec.perception ?? target.spec.initiative?.mod ?? typical(run.prep.rules, "skill", target.spec.level ?? 0)) + checkMods(target.mods, "perception");
  if ( against === "ac" ) return target.spec.defenses.ac;
  return 10 + saveRoll(run, target, against).mod;
}

/**
 * A skill check (talking, first aid): the rules' situational bonus and advantage, and u's own bonuses to checks (a
 * die such as Guidance's, advantage), with those that count against `target` alone when there is one. The rules hear
 * what it's for (`purpose`: "talk", "goad", "theft", "firstAid", "sizeUp", "notice", "heal", "aid", "control"), the
 * skill where the spec names one (a pitch's, first aid's, theft's), and the action that calls for it: PF2e's
 * attribute penalties. A notice check says the sense it's by (`sense`, API 34: "sight", "sound", "smell", "feel",
 * "radar", "help"): DCC listens with Luck.
 */
export function checkRoll(run, u, mod, target = null, { purpose = null, skill = null, action = null, sense = null } = {}) {
  const m = run.prep.rules.modifiers?.check?.({ unit: u, target, purpose, skill, action, ...(sense ? { sense } : {}) }) ?? {};
  const own = modsAgainst(u, target);
  return { mod: (Number(mod) || 0) + (m.bonus ?? 0) + checkMods(own, skill), advantage: netAdvantage(m.advantage ?? 0, own.checkAdv ?? 0), dice: own.checkDie ?? null, roller: u };
}

/** Its bonuses to every check, and to checks of this skill alone (mods.js byCheck: "perception", a skill's key). */
const checkMods = (mods, skill = null) => (Number(mods?.checks) || 0) + (skill ? Number(mods?.byCheck?.[skill]) || 0 : 0);

/** A fresh turn budget for u, minus what conditions take away (stunned, slowed, paralyzed ...). */
export function turnFor(run, u) {
  const rules = run.prep.rules;
  // "incapacitated" (asleep, held) is the engine's own: no actions at all.
  // Haste and the like give an action (a negative loss); Slow takes one.
  // (The core's own that take every action: frozen solid, in stasis, banished, fascinated.)
  const lost = (rules.modifiers?.actionsLost?.(u) ?? 0) + (u.conds.incapacitated || barred(u, "act") ? 99 : 0) - (u.mods?.actions ?? 0);
  return new Turn(rules, u, lost);
}

/**
 * Everything that adjusts an attack roll: the rules' situation (prone, conditions, range, ...), plus wavering,
 * leadership and having studied the foe. Returns {bonus, advantage, dice, faces, critOn, fumbleOn, deed}: dice ride
 * along (Bless), faces is the die rolled, deed a deed die's faces (rolled apart: it also adds to the damage).
 */
export function attackRoll(run, u, target, action, attacksMade = 0) {
  const rules = run.prep.rules;
  let bonus = (action.bonus ?? 0) + rules.attackPenalty(action, attacksMade);
  if ( u.wavering ) bonus -= 1;
  // (A blow pulled to knock out, what its system says that costs: PF2e's -2 with a lethal weapon.)
  if ( rules.pullPenalty && pullsThisRound(run, u) && rules.pullsBlow(u, action) ) bonus += Number(rules.pullPenalty(u, action)) || 0;
  const cmd = commandOf(run, u);
  if ( cmd && cmd.unit !== u ) bonus += cmd.leadership.attack;
  bonus += studyBonus(u, target);
  const mods = modsAgainst(u, target);
  bonus += mods.attack ?? 0;
  const m = rules.modifiers?.attack?.(situation(run, target, u, action)) ?? {};
  return {
    // (A roll whose score the system sets outright: an Ironsworn progress roll, the foe's track as it stands.)
    bonus: Number.isFinite(m.score) ? m.score : bonus + (m.bonus ?? 0),
    progress: !!action.progressRoll,
    advantage: netAdvantage(m.advantage ?? 0, mods.adv ?? 0, target.mods?.defAdv ?? 0),
    dice: mods.attackDie ?? null,
    faces: dieFor(run, u, action),
    critOn: action.critOn ?? null,
    fumbleOn: action.fumbleOn ?? null,
    deed: action.deedDie ?? null,
    roller: u
  };
}

/** The die an action rolls: its own, else the system's for the creature's next action (DCC action dice), else a d20. */
export function dieFor(run, u, action) {
  return action.die ?? run.prep.rules.actionDie?.(u, u.actsThisTurn ?? 0) ?? 20;
}

/**
 * How to roll (or weigh) an attack from attackRoll's result: the die, its crit and fumble ranges, the dice riding
 * along. With `deed`, the deed die rides along too (for the odds; the simulation rolls it apart).
 */
export function attackOptions(r, { deed = false } = {}) {
  const dice = deed && r.deed ? [...(r.dice ?? []), r.deed] : r.dice;
  return { advantage: r.advantage, dice: dice?.length ? dice : null, kind: "attack", faces: r.faces ?? 20, critOn: r.critOn ?? null, fumbleOn: r.fumbleOn ?? null, progress: !!r.progress, roller: r.roller ?? null };
}

/** Does a bonus-damage condition hold for this hit? */
function bonusApplies(run, attacker, action, target, when, bonus, advantage) {
  switch ( when ) {
    case "always": return true;
    case "offGuard":
    case "exposed": return isExposed(run, target, attacker, action);
    case "advantage": return advantage > 0;
    case "allyAdjacent": return alliesAdjacentTo(run, target, attacker) >= 1;
    case "pack": return alliesAdjacentTo(run, target, attacker) >= (bonus.allies ?? 2);
    default: return false;
  }
}

/**
 * Extra damage parts that apply to this hit (sneak attack, pack attack, ...). `when` may be one condition or a list
 * (any one will do); `oncePerTurn` bonuses apply to the first qualifying hit of the attacker's turn only.
 * Pass `commit` when the hit lands, so once-per-turn bonuses are used up.
 */
export function bonusDamageParts(run, attacker, action, target, { advantage = 0, commit = false } = {}) {
  const out = [];
  for ( const bonus of action.bonusDamage ?? [] ) {
    const key = bonus.id ?? bonus.when;
    if ( bonus.oncePerTurn && attacker.usedThisTurn?.has(key) ) continue;
    const conditions = Array.isArray(bonus.when) ? bonus.when : [bonus.when];
    if ( !conditions.some(w => bonusApplies(run, attacker, action, target, w, bonus, advantage)) ) continue;
    out.push(...bonus.parts);
    if ( commit && bonus.oncePerTurn ) (attacker.usedThisTurn ??= new Set()).add(key);
  }
  // A flat bonus (or penalty) to its damage, and the extra hurt of a foe it marked.
  const flat = attacker.mods?.damage ?? 0;
  if ( flat && action.damage?.length ) out.push({ dice: [], flat, type: action.damage[0].type ?? "untyped" });
  for ( const m of target.marks ?? [] ) if ( m.by === attacker.id ) out.push(...m.parts);
  return out;
}

/** Can u move at all (not grabbed by someone standing, not immobilized)? */
export function canMove(run, u) {
  if ( u.conds.immobilized || u.spec.hazard ) return false; // (a hazard stays where it is)
  if ( u.bound || u.boundBy ) return false; // (tied up: it can't go anywhere)
  // (The core's own: frozen solid, in a gullet; adrift, only flying.)
  if ( barred(u, "move") ) return false;
  if ( profiled(u).some(([, , p]) => p.move === "fly") && !((u.spec.speeds?.fly ?? 0) > 0) ) return false;
  const grabber = u.grabbedBy ? run.byId.get(u.grabbedBy) : null;
  return !(grabber && isStanding(grabber));
}

/** Geometry ------------------------------------------------------------- */

export function approach(run, a, t) {
  const ap = run.prep.approachOf(a.id, t.id);
  const extra = a.mods?.speed;
  return extra ? { ...ap, speed: Math.max(0, ap.speed + extra) } : ap;
}

/** Feet still separating a and t: from real positions when known, otherwise from how far both advanced. */
export function separation(run, a, t) {
  if ( !run.prep.options.positioning ) return 0;
  if ( a.adjacent.has(t.id) ) return 0;
  const edge = edgeDistance(a, t);
  if ( edge !== null ) return edge;
  const ap = approach(run, a, t);
  return Math.max(0, ap.dist - a.advance - t.advance);
}

/**
 * Move actions a needs before it can make `action` against t (Infinity when impossible). On a map with its walls, a
 * ranged one needs a spot it can see t from (behavior/space.js: the nearest within two moves; none, it can't); a melee
 * one, a free spot within reach (one with every spot round it taken, it can't), and the way round those in the way.
 * While a creature makes up its mind (run.movesCache, a Map: simulator.js deliberate, and each step of its turn until
 * it does something), nothing on the map changes, so each is worked out once: its tactics ask the same of every foe
 * several times over, and of every action that gets there the same way (reachShape: a Strike, a Trip and a Grapple at
 * the same reach). Anywhere else (null), always afresh.
 */
export function movesNeeded(run, a, t, action) {
  const cache = run.movesCache;
  if ( !cache ) return movesNow(run, a, t, action);
  let byAction = cache.get(a);
  if ( !byAction ) cache.set(a, byAction = new Map());
  const shape = reachShape(action);
  let byTarget = byAction.get(shape);
  if ( !byTarget ) byAction.set(shape, byTarget = new Map());
  let moves = byTarget.get(t);
  if ( moves === undefined ) byTarget.set(t, moves = movesNow(run, a, t, action));
  return moves;
}

/** All of an action movesNow reads: its range (as far as it shoots), or its reach and the moves it makes first. */
export const reachShape = action => (action.range ? `r${action.range.max ?? action.range.increment * 3}` : `m${action.reach ?? 5}|${action.charge ?? 0}`);

function movesNow(run, a, t, action) {
  // (Inside another creature: it reaches the one holding it from in there, and nothing outside, nor anything outside
  // it: behavior/troubles.js cutOff.)
  if ( cutOff(run, a, t) ) return Infinity;
  if ( !run.prep.options.positioning || holderOf(run, a) === t ) return 0;
  const ap = approach(run, a, t);
  if ( action.range ) {
    const maxRange = action.range.max ?? action.range.increment * 3;
    if ( wallsKnown(run) && a.pos && t.pos ) return movesToShoot(run, a, t, ap, maxRange);
    let moves = (ap.los || a.losGained.has(t.id)) ? 0 : 1;
    const gap = separation(run, a, t) - maxRange;
    if ( gap > 0 ) {
      if ( !Number.isFinite(ap.mult) || ap.speed <= 0 ) return Infinity;
      moves = Math.max(moves, Math.ceil((gap * ap.mult) / ap.speed));
    }
    return moves;
  }
  // Melee
  if ( a.adjacent.has(t.id) ) return 0;
  if ( !ap.meleeOk ) return Infinity;
  const reach = action.reach ?? 5;
  let gap = Math.max(0, separation(run, a, t) - reach);
  if ( gap <= 0.5 ) return 0;
  if ( !Number.isFinite(ap.mult) || ap.speed <= 0 ) return Infinity;
  // (On the map: the free spot it would end on, and the way round whoever's in the way.)
  if ( a.pos && t.pos ) {
    const end = meleeEnd(run, a, t, reach);
    if ( !end ) return Infinity;
    gap = end.feet + crossedExtra(run, a, a.pos, end, t, areEnemies);
  }
  // (An action that moves first: PF2e Sudden Charge strides twice, then strikes.)
  return Math.max(0, Math.ceil((gap * ap.mult) / ap.speed) - (action.charge ?? 0));
}

/**
 * Where a melee move toward t ends: straight in to within reach, unless someone's there (then the nearest free spot
 * within reach); null when there's none. {x, y, feet} (feet from where a is).
 */
function meleeEnd(run, a, t, reach) {
  const d = centerDistance(a, t);
  const feet = Math.max(0, edgeDistance(a, t) - reach);
  const p = d > 0 ? { x: a.pos.x + ((t.pos.x - a.pos.x) / d) * feet, y: a.pos.y + ((t.pos.y - a.pos.y) / d) * feet } : { x: a.pos.x, y: a.pos.y };
  if ( !inTheWay(run, a, p) ) return { ...p, feet };
  return spotWithin(run, a, t, reach);
}

/** Moves a needs to shoot t on a map with its walls: none if it can see it in range now; else to the nearest spot it can. */
function movesToShoot(run, a, t, ap, range) {
  if ( separation(run, a, t) <= range + 0.5 && lineOfSight(run, a, t) ) return 0;
  if ( !Number.isFinite(ap.mult) || ap.speed <= 0 ) return Infinity;
  const stride = ap.speed / ap.mult;
  const spot = spotToShoot(run, a, t, range, stride * 2, edgeDistance);
  if ( spot ) return Math.max(1, Math.ceil(spot.feet / stride));
  // (Out of range by more than that: as many moves as it takes to get in range, where it'll look again.)
  const gap = separation(run, a, t) - range;
  return gap > stride * 2 ? Math.ceil(gap / stride) : Infinity;
}

/** One move toward a spot (a door): straight there, stopping `stopAt` feet short. */
export function moveTowardPoint(run, a, point, budget, stopAt = 5) {
  run.geo = (run.geo ?? 0) + 1;
  const from = (run.log || run.movers || run.reachers) && a.pos ? { x: a.pos.x, y: a.pos.y } : null;
  if ( !a.pos ) return { feet: 0, cost: 0, mode: "walk", mult: 1, regions: [], reached: true, from, to: null };
  const d = Math.hypot(point.x - a.pos.x, point.y - a.pos.y);
  const feet = Math.max(0, Math.min(budget ?? a.spec.speeds?.walk ?? 25, d - stopAt));
  if ( d > 0 && feet > 0 ) {
    a.pos.x += ((point.x - a.pos.x) / d) * feet;
    a.pos.y += ((point.y - a.pos.y) / d) * feet;
  }
  a.feetMoved += feet;
  return { feet: Math.round(feet), cost: feet, mode: "walk", mult: 1, regions: [], reached: d - feet <= stopAt + 0.5, from, to: from ? { x: a.pos.x, y: a.pos.y } : null };
}

/**
 * One move advancing a toward t (stopping at reach for melee). `budget` is the movement it may spend (feet of
 * speed before terrain), a full speed by default.
 * @returns {{feet: number, cost: number, mode: string, mult: number, regions: string[], reached: boolean}}
 *   feet covered (for the story) and movement spent (feet × terrain)
 */
export function moveToward(run, a, t, reach = null, budget = null, { range = null } = {}) {
  const ap = approach(run, a, t);
  const progress = Number.isFinite(ap.mult) && ap.mult > 0 ? (budget ?? ap.speed) / ap.mult : 0;
  // (On a map with its walls, for a shot: to the nearest spot it can see t from.)
  if ( reach === null && range !== null && wallsKnown(run) && a.pos && t.pos ) return moveToShoot(run, a, t, ap, progress, range);
  run.geo = (run.geo ?? 0) + 1; // someone moved: distances are stale
  const from = (run.log || run.movers || run.reachers) && a.pos ? { x: a.pos.x, y: a.pos.y } : null; // for playing the fight back on the map (and moves answered)
  let feet = progress;
  let extra = 0;
  let stopped = null;
  if ( a.pos && t.pos ) {
    const d = centerDistance(a, t);
    // Close the gap until the target is within reach (or simply adjacent when moving for a ranged shot).
    feet = Math.max(0, Math.min(progress, edgeDistance(a, t) - (reach ?? 5)));
    if ( d > 0 && feet > 0 ) {
      let to = { x: a.pos.x + ((t.pos.x - a.pos.x) / d) * feet, y: a.pos.y + ((t.pos.y - a.pos.y) / d) * feet };
      // (Someone already there: the nearest free spot within reach instead, as far as it gets toward it. One keeping
      // together, ending in reach bunched up beside a teammate: a spot in reach that isn't, if this move gets there too.)
      if ( reach !== null && inTheWay(run, a, to) ) to = freeEnd(run, a, t, reach, progress) ?? to;
      else if ( reach !== null && edgeDistance(a, t) - reach <= progress + 0.5 ) to = spread(run, a, t, reach, progress, to);
      // (Those in the way: round them, through them, or tumbling past, as the system says: behavior/space.js.)
      const past = passing(run, a, to, t);
      extra = past.extra;
      if ( past.stop ) {
        to = past.stop.at;
        stopped = past.stop.o;
      } else if ( extra > 0 && Math.hypot(to.x - a.pos.x, to.y - a.pos.y) + extra > progress + 0.5 ) {
        // (The way round takes some of the move: as far as the rest goes.)
        const left = Math.max(0, progress - extra);
        const k = left / Math.max(0.001, Math.hypot(to.x - a.pos.x, to.y - a.pos.y));
        if ( k < 1 ) to = backOff(run, a, { x: a.pos.x + (to.x - a.pos.x) * k, y: a.pos.y + (to.y - a.pos.y) * k });
      }
      // (Never ending in someone's space.)
      if ( inTheWay(run, a, to) ) to = backOff(run, a, to);
      // (A trap avoider keeps clear of the hazards it spotted: around them, or short of them.)
      if ( run.trapsSpotted ) to = keepClear(run, a, t, to, run.trapLog);
      feet = Math.hypot(to.x - a.pos.x, to.y - a.pos.y);
      a.pos.x = to.x;
      a.pos.y = to.y;
    }
  } else {
    a.advance = Math.min(a.advance + progress, ap.dist);
  }
  a.feetMoved += feet;
  a.losGained.add(t.id);
  let reached = false;
  if ( (reach !== null) && ap.meleeOk && separation(run, a, t) <= reach + 0.5 ) {
    a.adjacent.add(t.id);
    t.adjacent.add(a.id);
    reached = true;
  }
  return { feet: Math.round(feet), cost: (feet + extra) * (ap.mult ?? 1), mode: ap.mode ?? "walk", mult: ap.mult ?? 1, regions: ap.regions ?? [], reached,
    from, to: from ? { x: a.pos.x, y: a.pos.y } : null, ...(stopped ? { stoppedBy: stopped.id, tumbled: false } : {}) };
}

/** The nearest free spot within reach of t, or as far toward it as `progress` goes; null when every spot is taken. */
function freeEnd(run, a, t, reach, progress) {
  const spot = spotWithin(run, a, t, reach);
  if ( !spot ) return null;
  if ( spot.feet <= progress + 0.5 ) return { x: spot.x, y: spot.y };
  const k = progress / spot.feet;
  return { x: a.pos.x + (spot.x - a.pos.x) * k, y: a.pos.y + (spot.y - a.pos.y) * k };
}

/**
 * For one keeping together (behavior/together.js), a move that would end at `to`, in reach of t, bunched up beside a
 * teammate: the spot in reach it would rather (space.js crowdCost), if this move gets there as well; else `to`. Never
 * at the cost of the blow.
 */
function spread(run, a, t, reach, progress, to) {
  const crowd = crowdOf(run, a, t);
  const here = crowd?.(to) ?? 0;
  if ( !(here > 0) ) return to;
  const spot = spotWithin(run, a, t, reach, a.pos, crowd);
  return spot && spot.feet <= progress + 0.5 && crowd(spot) < here ? { x: spot.x, y: spot.y } : to;
}

/** Back along the way it came, 5 feet at a time, until it's in no one's space (as far back as where it started). */
function backOff(run, a, to) {
  const d = Math.hypot(to.x - a.pos.x, to.y - a.pos.y);
  for ( let back = 0; back < d; back += 5 ) {
    const k = (d - back) / d;
    const p = { x: a.pos.x + (to.x - a.pos.x) * k, y: a.pos.y + (to.y - a.pos.y) * k };
    if ( !inTheWay(run, a, p) ) return p;
  }
  return { x: a.pos.x, y: a.pos.y };
}

/**
 * Getting past those between a and `to`: the extra feet round them (or through them as difficult ground), and a
 * tumble past each one the system says to (rules.tumbleThrough): failed, its move stops short of that one ({stop: {o,
 * at}}). Logged.
 */
function passing(run, a, to, t) {
  const list = crossed(run, a, a.pos, to, t);
  if ( !list.length ) return { extra: 0, stop: null };
  const rules = run.prep.rules;
  let extra = 0;
  for ( const { o, k } of list ) {
    const how = passOf(run, a, o, areEnemies);
    if ( how === "around" || how === "difficult" ) extra += o.spec.position?.size ?? 5;
    if ( how !== "tumble" ) continue;
    const got = rules.tumbleThrough?.(run, a, o) ?? { success: false };
    run.trapLog?.(a, { type: "tumble", target: o.spec.name, targetId: o.id, success: !!got.success, natural: got.natural, mod: got.mod, total: got.total, dc: got.dc, ...(got.said?.text ? { said: got.said.text } : {}) });
    // (Through it, as through difficult ground, unless the system says not: PF2e's Tumble Through.)
    if ( got.success ) {
      if ( got.difficult !== false ) extra += o.spec.position?.size ?? 5;
      continue;
    }
    // (Stopped short of it: as near as it gets without sharing its space.)
    const reachK = Math.max(0, k - ((a.spec.position?.size ?? 5) + (o.spec.position?.size ?? 5)) / 2 / Math.max(1, Math.hypot(to.x - a.pos.x, to.y - a.pos.y)));
    return { extra, stop: { o, at: backOff(run, a, { x: a.pos.x + (to.x - a.pos.x) * reachK, y: a.pos.y + (to.y - a.pos.y) * reachK }) } };
  }
  return { extra, stop: null };
}

/**
 * A move for a shot, on a map with its walls: to the nearest spot it can see t from with t in range, as far as this
 * move goes (and on toward one farther off); with none near, straight on until t is in range.
 */
function moveToShoot(run, a, t, ap, progress, range) {
  run.geo = (run.geo ?? 0) + 1;
  const from = run.log || run.movers || run.reachers ? { x: a.pos.x, y: a.pos.y } : null;
  let spot = spotToShoot(run, a, t, range, progress * 2, edgeDistance);
  // (One keeping together: a spot to shoot from that isn't bunched up beside a teammate, if this move gets there.)
  const crowd = spot ? crowdOf(run, a, t) : null;
  if ( crowd && crowd(spot) > 0 ) {
    const apart = spotToShoot(run, a, t, range, progress, edgeDistance, crowd);
    if ( apart && crowd(apart) < crowd(spot) ) spot = apart;
  }
  let to;
  if ( spot ) {
    const k = spot.feet > progress ? progress / spot.feet : 1;
    to = { x: a.pos.x + (spot.x - a.pos.x) * k, y: a.pos.y + (spot.y - a.pos.y) * k };
  } else {
    const d = centerDistance(a, t);
    const feet = Math.max(0, Math.min(progress, edgeDistance(a, t) - range));
    to = d > 0 ? { x: a.pos.x + ((t.pos.x - a.pos.x) / d) * feet, y: a.pos.y + ((t.pos.y - a.pos.y) / d) * feet } : { x: a.pos.x, y: a.pos.y };
  }
  if ( inTheWay(run, a, to) ) to = backOff(run, a, to);
  const feet = Math.hypot(to.x - a.pos.x, to.y - a.pos.y);
  a.pos.x = to.x;
  a.pos.y = to.y;
  a.feetMoved += feet;
  return { feet: Math.round(feet), cost: feet * (ap.mult ?? 1), mode: ap.mode ?? "walk", mult: ap.mult ?? 1, regions: ap.regions ?? [], reached: false, from, to: from ? { x: a.pos.x, y: a.pos.y } : null };
}

/** Move u away from its nearest foes (fleeing): up to `feet` along the line away from them. */
export function moveAway(run, u, feet) {
  if ( !u.pos ) return 0;
  run.geo = (run.geo ?? 0) + 1;
  const foes = run.units.filter(o => o !== u && o.pos && areEnemies(run, u, o) && o.status === STATUS.STANDING);
  if ( !foes.length ) return 0;
  const cx = foes.reduce((s, f) => s + f.pos.x, 0) / foes.length;
  const cy = foes.reduce((s, f) => s + f.pos.y, 0) / foes.length;
  let dx = u.pos.x - cx;
  let dy = u.pos.y - cy;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  u.pos.x += dx * feet;
  u.pos.y += dy * feet;
  u.feetMoved += feet;
  return feet;
}
