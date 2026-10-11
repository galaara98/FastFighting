/**
 * Battle preparation (once per batch) and per-run mutable state.
 *
 * @typedef {object} CombatantSpec
 * @property {string} id
 * @property {string} name
 * @property {string} side
 * @property {string} kind                  "pc" | "npc" | "companion" | "summon" | "minion" | "hazard"
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
 * @property {object} [disposition]         {healAggro, allyDying, selfRevived}
 * @property {boolean} [diesAtZero]         NPCs normally die at 0 HP
 * @property {object} [social]              Talking: {languages[], mindless, gullible?, resolve?, pitches, resist}
 *   pitches: {persuade|intimidate|deceive: {skill: display name, mod}}   what this creature can try on others
 *   resist:  {persuade|intimidate|deceive: {dc, label}}                  the DC others face, and what it's called
 *   resolve: how much more strong-willed than typical for its level (0 typical; -5 or less: very gullible)
 * @property {object} [valuables]           What it could be talked into giving up:
 *   {money: total in the smallest coin, denominations: [{label, value}] largest first,
 *    stowed: [{id, name, value}] carried but not wielded or worn, wielded: [{id, name, value}]}
 * @property {number} [wounded]
 * @property {number} [doomed]
 * @property {number} [dying]               Already dying when the battle starts (a fight resumed mid-way)
 * @property {boolean} [stable]             At 0 HP: stable (true) or still dying (false); by default stable unless dying > 0
 * @property {Record<string, number|boolean>} [conditions]  Conditions already on the creature (frightened, slowed, ...)
 * @property {object[]} [persistent]        Persistent damage already running: DamagePart[] with persistent: true
 * @property {number} [perception]          Perception modifier, for bystanders noticing a fight
 * @property {boolean} [darkvision]         Sees in the dark (bystanders spotting a fight at night)
 * @property {{mod: number}} [firstAid]     Can stabilize the dying without magic (PF2e: trained in Medicine)
 * @property {number} [group]               A neutral token's friend group (1-3, from the planner): they look out for each other
 * @property {string} [creatureKind]        What kind of creature it is, as the system has it (5e: its type), for grouping neutrals
 * @property {boolean} [avoidFleeing]       "I don't like to flee": most times, stays when it would choose to run
 *
 * @typedef {object} ActionSpec
 * @property {string} id
 * @property {string} name
 * @property {string} kind                  "strike" | "spell-attack" | "save" | "auto" | "heal"
 * @property {number|object} cost           What one use costs: a number of the rules' main pool (PF2e actions), or
 *                                          {action: 1} / {bonus: 1} ... (see engine/turn.js); rules.costOf may decide
 * @property {object[]} [sequence]          A multiattack: component strikes made in order with one use
 * @property {number} [bonus]               Attack modifier
 * @property {number[]} [maps]              Multiple attack penalties
 * @property {boolean} [subjectToMAP]
 * @property {boolean} [melee]
 * @property {number} [reach]
 * @property {{increment: number, max?: number}} [range]
 * @property {object[]} [damage]            DamagePart[]
 * @property {object[]} [critDamage]        DamagePart[] (defaults to doubled damage)
 * @property {{type: string, dc: number, basic: boolean}} [save]
 * @property {{targets: number}} [area]
 * @property {object[]} [heal]              DamagePart[] of healing
 * @property {string} [resource]            Pool key consumed per use
 * @property {number} [uses]                Uses per battle when not pool-based
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
 * @property {Record<string, Record<string, object>>} [approach]  approach[a][t] = {dist, mult, speed, mode, los, meleeOk}
 * @property {object} options                         {maxRounds, downedModel, positioning, morale, leadership, initiativeOrder, surpriseSide}
 */
import { STATUS, NEUTRAL_PARTY, clamp, fudged, tacticalTier, TRAITS } from "../constants.js";
import { meanPart } from "./dice.js";
import { typicalValue } from "./tactics.js";
import { talkAffinity } from "./behavior/talk.js";
import { Turn } from "./turn.js";
import { combineMods, netAdvantage } from "./mods.js";

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
    talking: true,
    opening: "auto",
    aftermath: "tell",
    ...spec.options
  };
  const sides = {};
  for ( const [id, side] of Object.entries(spec.sides) ) {
    const leadership = side.leadership ?? {};
    sides[id] = {
      id,
      label: side.label ?? id,
      enemies: new Set(side.enemies ?? []),
      traits: Object.fromEntries(TRAITS.map(k => [k, fudged(side.traits?.[k] ?? 50)])),
      leaderId: options.leadership ? (side.leaderId ?? null) : null,
      leadership: {
        brave: fudged(leadership.brave ?? 0, -50, 50),
        tacticalFloor: fudged(leadership.tacticalFloor ?? 0, 0, 100),
        attack: fudged(leadership.attack ?? 0, -5, 5),
        ac: fudged(leadership.ac ?? 0, -5, 5)
      },
      healAggro: side.healAggro ?? "balanced",
      morale: options.morale && side.morale !== false
    };
  }
  // Enemy relations are symmetric.
  for ( const a of Object.values(sides) ) {
    for ( const b of a.enemies ) sides[b]?.enemies.add(a.id);
  }
  // Those who take no side: always there for anyone who stands aside mid-fight, and nobody's enemy as a side (each
  // of them turns on whoever crosses it, on its own).
  sides[NEUTRAL_PARTY] ??= {
    id: NEUTRAL_PARTY, label: "Neutral", traits: Object.fromEntries(TRAITS.map(k => [k, fudged(50)])), leaderId: null,
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

  const byId = new Map(combatants.map(c => [c.spec.id, c]));
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

  return { spec, rules, options, sides, combatants, byId, approachOf, summons, meanCache: new Map() };
}

/** A combatant as a batch uses it: its traits blended with its side's, and its actions sorted by what they're for. */
function prepareCombatant(c, side) {
  const traits = {};
  for ( const k of TRAITS ) {
    traits[k] = clamp(Math.round(fudged(c.traits?.[k] ?? 50) * (1 - SIDE_WEIGHT) + side.traits[k] * SIDE_WEIGHT), 0, 100);
  }
  const meanHeal = a => (a.heal ?? []).reduce((s, p) => s + meanPart(p), 0);
  // (Legendary actions are taken between others' turns, not on its own.)
  const own = c.actions.filter(a => !a.legendary);
  return {
    spec: c,
    traits,
    isHealer: own.some(a => a.kind === "heal"),
    isCaster: own.some(a => a.kind === "save" || a.kind === "spell-attack"),
    hasRanged: own.some(a => a.range && !["heal", "buff", "summon"].includes(a.kind)),
    flies: (c.speeds?.fly ?? 0) > 0,
    healActions: own.filter(a => a.kind === "heal").sort((x, y) => meanHeal(y) / y.cost - meanHeal(x) / x.cost),
    buffActions: own.filter(a => a.kind === "buff" && a.outcome),
    summonActions: own.filter(a => a.kind === "summon" && a.creatures?.length),
    offense: own.filter(a => !["heal", "buff", "summon"].includes(a.kind)),
    legendaryActions: c.legendary?.pool ? c.actions.filter(a => a.legendary && !["heal", "buff", "summon"].includes(a.kind)) : []
  };
}

/** Fresh mutable state for one run. */
export function createRun(prep) {
  const units = prep.combatants.map(p => createUnit(prep, p));
  return {
    prep,
    units,
    fateInPlay: units.some(u => (u.resources.fate ?? 0) > 0), // anyone with hero points or the like to spend
    neutral: units.some(u => u.side === NEUTRAL_PARTY),        // anyone standing aside (more may, mid-fight)
    boosting: units.some(u => u.spec.boosts?.length),       // anyone who can burn Luck (or the like) on a roll
    counters: units.some(u => u.spec.reactions?.some(r => r.on === "spell")), // anyone with a counterspell
    legendary: units.some(u => u.prep.legendaryActions?.length),               // anyone with legendary actions
    auras: units.some(u => u.spec.saveAura),                                     // anyone whose aura helps friends' saves
    guards: units.some(u => u.spec.reactions?.some(r => r.on === "allyHit")),     // anyone who reacts when a friend is hit
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
  const u = {
    prep: p,
    spec: s,
    id: s.id,
    side: s.side,
    homeSide: s.side,      // where it belongs (a charmed creature fights for someone else until it wears off)
    controlledBy: null,
    hp: s.hp.value,
    maxHp: s.hp.max,
    temp: s.hp.temp ?? 0,
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
    drawn: new Set(),
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
    swayOutcome: null,
    // Taking no side (NEUTRAL_PARTY): the side it leans to, the sides it has turned on, how much each has crossed
    // it, and a quarrel it's still trying to settle with words. (See behavior/neutral.js.)
    lean: s.lean ?? null,
    friendGroup: s.side === NEUTRAL_PARTY && s.originSide === "neutral" && s.group ? s.group : null,
    against: new Set(),
    grievance: new Map(),
    crossedBy: new Set(),
    truce: null,
    // Encounter membership: combatants start active; bystanders wait until they notice the fight.
    active: s.inEncounter !== false,
    aware: s.inEncounter !== false,
    joinedRound: s.inEncounter !== false ? 0 : null,
    calledForHelp: false,
    // Positions in feet (token centers), when the scene provided them.
    pos: s.position ? { x: s.position.x, y: s.position.y } : null,
    feetMoved: 0
  };
  u.baseConds = { ...u.conds };
  prep.rules.initUnit?.(u); // the system's own per-fight state (5e: death saves already on the sheet)
  // Ready to react from the start (5e opportunity attacks, PF2e Reactive Strike); none if the system has none.
  u.reactionsLeft = prep.rules.opportunity || s.reactions?.length ? (prep.rules.reactions ? prep.rules.reactions(u) : 1) : 0;
  return u;
}

/** On its feet and taking part (bystanders who haven't joined are not). */
export const isStanding = u => u.status === STATUS.STANDING && u.active !== false;

/** On its feet, whether or not it has joined the fight. */
export const isUp = u => u.status === STATUS.STANDING;

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

/** Healing/dying answers for this fight: player tactics, else the older disposition record. */
export function dispositionOf(u) {
  return u.tac ?? u.spec.disposition ?? {};
}

/** Playstyle-driven behavior chances (see engine/playstyles.js). */
export function behaviorOf(u) {
  return u.spec.behavior ?? {};
}

/** Lore-Collector bonus against a foe it has studied: +1, or +2 when the foe has a weakness to exploit. */
export function studyBonus(u, t) {
  if ( !t || !u.studied?.has(t.id) ) return 0;
  return Object.keys(t.spec.iwr?.weak ?? {}).length ? 2 : 1;
}

export function areEnemies(run, a, b) {
  // Someone who takes no side fights only the sides it has turned on.
  if ( a.side === NEUTRAL_PARTY || b.side === NEUTRAL_PARTY ) return !!(a.against?.has(b.side) || b.against?.has(a.side));
  return run.prep.sides[a.side]?.enemies.has(b.side) ?? false;
}

export function enemiesOf(run, u) {
  if ( run.untargetable ) return run.units.filter(o => o !== u && !o.spec.untargetable && areEnemies(run, u, o));
  return run.units.filter(o => o !== u && areEnemies(run, u, o));
}

export function alliesOf(run, u) {
  // Standing aside: with its friend group (neutral tokens the planner grouped), else on its own.
  if ( u.side === NEUTRAL_PARTY ) return u.friendGroup ? run.units.filter(o => o.side === NEUTRAL_PARTY && o.friendGroup === u.friendGroup) : [u];
  return run.units.filter(o => o.side === u.side);
}

export function leaderStanding(run, side) {
  const id = run.prep.sides[side]?.leaderId;
  if ( !id ) return false;
  const leader = run.byId.get(id);
  return !!leader && isStanding(leader);
}

/** Trait value including live leadership effects. */
export function liveTrait(run, u, trait) {
  let value = u.prep.traits[trait];
  const side = run.prep.sides[u.side];
  if ( leaderStanding(run, u.side) && side.leaderId !== u.id ) {
    if ( trait === "brave" ) value += side.leadership.brave;
    if ( trait === "tactical" ) value = Math.max(value, side.leadership.tacticalFloor);
  }
  return clamp(value, 0, 100);
}

export function liveTier(run, u) {
  return tacticalTier(liveTrait(run, u, "tactical"));
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

/** The facts the rules weigh for an attack (or an effect) from attacker against target. */
export function situation(run, target, attacker = null, action = null) {
  const grabber = target.grabbedBy ? run.byId.get(target.grabbedBy) : null;
  return {
    target,
    attacker,
    action,
    grabbed: !!(grabber && isStanding(grabber)),
    flanked: !!(attacker && action?.melee && isFlanked(run, target, attacker)),
    // Standing allies of the attacker next to the target (5e Pack Tactics), and whether a foe is next to the
    // attacker (5e: a ranged attack in melee has disadvantage).
    alliesAdjacent: attacker ? alliesAdjacentTo(run, target, attacker) : 0,
    attackerEngaged: !!attacker && [...attacker.adjacent].some(id => {
      const o = run.byId.get(id);
      return o && isStanding(o) && areEnemies(run, attacker, o);
    }),
    distance: attacker ? separation(run, attacker, target) : 0,
    positioning: !!run.prep.options.positioning,
    // Off guard against this attacker in particular (PF2e Feint).
    exposedTo: !!(attacker && target.vs?.get(attacker.id)?.offGuard)
  };
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
  const side = run.prep.sides[target.side];
  if ( leaderStanding(run, target.side) ) ac += side.leadership.ac;
  ac += target.mods?.ac ?? 0;
  ac += run.prep.rules.modifiers?.defense?.(situation(run, target, attacker, action)) ?? 0;
  return ac;
}

/** Typical numbers for a creature of this level, when the system didn't supply one. */
export function typical(rules, what, level = 0) {
  const fn = rules?.typical?.[what];
  if ( fn ) return fn(level);
  return { ac: 10 + level, save: Math.ceil(level / 2) + 2, skill: Math.ceil(level / 2) + 2, dc: 10 + level }[what] ?? 0;
}

/** A saving throw: the modifier, any advantage (+1) or disadvantage (-1), and dice that ride along (Bless). */
/** Spells and the like (an action with a spell rank, a spell check, or marked magical). */
export const isMagical = action => !!action && (!!action.magical || action.rank !== undefined || !!action.casting || !!action.spellId);

/**
 * A save's modifier and advantage. With `magical`, Magic Resistance (spec.magicResistance) gives advantage. A
 * friend's aura (spec.saveAura {bonus, range}: 5e Aura of Protection) adds to it while that friend is up and near
 * (the best one only).
 */
export function saveRoll(run, target, type, { magical = false } = {}) {
  if ( Array.isArray(type) ) {
    const rolls = type.map(t => saveRoll(run, target, t, { magical }));
    return rolls.reduce((best, r) => (r.mod + 3.5 * r.advantage > best.mod + 3.5 * best.advantage ? r : best), rolls[0] ?? saveRoll(run, target, "none"));
  }
  const base = target.spec.defenses[type] ?? typical(run.prep.rules, "save", target.spec.level ?? 0);
  const m = run.prep.rules.modifiers?.save?.({ unit: target, type }) ?? {};
  const mods = target.mods ?? {};
  let advantage = netAdvantage(m.advantage ?? 0, mods.saveAdv ?? 0);
  if ( magical && target.spec.magicResistance ) advantage = netAdvantage(advantage, 1);
  return { mod: base + (m.bonus ?? 0) + (mods.saves ?? 0) + auraBonus(run, target), advantage, dice: mods.saveDie ?? null };
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
export function defenseDc(run, target, against) {
  const own = run.prep.rules.defenseDc?.(target, against);
  if ( Number.isFinite(own) ) return own;
  if ( against === "perception" ) return 10 + (target.spec.perception ?? target.spec.initiative?.mod ?? typical(run.prep.rules, "skill", target.spec.level ?? 0));
  if ( against === "ac" ) return target.spec.defenses.ac;
  return 10 + saveRoll(run, target, against).mod;
}

/** A skill check (talking, first aid): the rules' situational bonus and advantage. */
export function checkRoll(run, u, mod) {
  const m = run.prep.rules.modifiers?.check?.({ unit: u }) ?? {};
  return { mod: (Number(mod) || 0) + (m.bonus ?? 0) + (u.mods?.checks ?? 0), advantage: m.advantage ?? 0 };
}

/** A fresh turn budget for u, minus what conditions take away (stunned, slowed, paralyzed ...). */
export function turnFor(run, u) {
  const rules = run.prep.rules;
  // "incapacitated" (asleep, held) is the engine's own: no actions at all.
  // Haste and the like give an action (a negative loss); Slow takes one.
  const lost = (rules.modifiers?.actionsLost?.(u) ?? 0) + (u.conds.incapacitated ? 99 : 0) - (u.mods?.actions ?? 0);
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
  if ( leaderStanding(run, u.side) && run.prep.sides[u.side].leaderId !== u.id ) bonus += run.prep.sides[u.side].leadership.attack;
  bonus += studyBonus(u, target);
  bonus += u.mods?.attack ?? 0;
  const m = rules.modifiers?.attack?.(situation(run, target, u, action)) ?? {};
  return {
    // (A roll whose score the system sets outright: an Ironsworn progress roll, the foe's track as it stands.)
    bonus: Number.isFinite(m.score) ? m.score : bonus + (m.bonus ?? 0),
    progress: !!action.progressRoll,
    advantage: netAdvantage(m.advantage ?? 0, u.mods?.adv ?? 0, target.mods?.defAdv ?? 0),
    dice: u.mods?.attackDie ?? null,
    faces: dieFor(run, u, action),
    critOn: action.critOn ?? null,
    fumbleOn: action.fumbleOn ?? null,
    deed: action.deedDie ?? null
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
  return { advantage: r.advantage, dice: dice?.length ? dice : null, kind: "attack", faces: r.faces ?? 20, critOn: r.critOn ?? null, fumbleOn: r.fumbleOn ?? null, progress: !!r.progress };
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
  if ( u.conds.immobilized ) return false;
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

/** Move actions a needs before it can make `action` against t (Infinity when impossible). */
export function movesNeeded(run, a, t, action) {
  if ( !run.prep.options.positioning ) return 0;
  const ap = approach(run, a, t);
  if ( action.range ) {
    const maxRange = action.range.max ?? action.range.increment * 3;
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
  const gap = Math.max(0, separation(run, a, t) - reach);
  if ( gap <= 0.5 ) return 0;
  if ( !Number.isFinite(ap.mult) || ap.speed <= 0 ) return Infinity;
  // (An action that moves first: PF2e Sudden Charge strides twice, then strikes.)
  return Math.max(0, Math.ceil((gap * ap.mult) / ap.speed) - (action.charge ?? 0));
}

/** One move toward a spot (a door): straight there, stopping `stopAt` feet short. */
export function moveTowardPoint(run, a, point, budget, stopAt = 5) {
  run.geo = (run.geo ?? 0) + 1;
  const from = run.log && a.pos ? { x: a.pos.x, y: a.pos.y } : null;
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
export function moveToward(run, a, t, reach = null, budget = null) {
  run.geo = (run.geo ?? 0) + 1; // someone moved: distances are stale
  const from = run.log && a.pos ? { x: a.pos.x, y: a.pos.y } : null; // for playing the fight back on the map
  const ap = approach(run, a, t);
  const progress = Number.isFinite(ap.mult) && ap.mult > 0 ? (budget ?? ap.speed) / ap.mult : 0;
  let feet = progress;
  if ( a.pos && t.pos ) {
    const d = centerDistance(a, t);
    // Close the gap until the target is within reach (or simply adjacent when moving for a ranged shot).
    feet = Math.max(0, Math.min(progress, edgeDistance(a, t) - (reach ?? 5)));
    if ( d > 0 && feet > 0 ) {
      a.pos.x += ((t.pos.x - a.pos.x) / d) * feet;
      a.pos.y += ((t.pos.y - a.pos.y) / d) * feet;
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
  return { feet: Math.round(feet), cost: feet * (ap.mult ?? 1), mode: ap.mode ?? "walk", mult: ap.mult ?? 1, regions: ap.regions ?? [], reached,
    from, to: from ? { x: a.pos.x, y: a.pos.y } : null };
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
