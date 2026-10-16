/**
 * The conditions the core can put on a creature, in any system: their engine keys, and which are counted (frightened
 * 2). What each one does is the engine's (battle-state.js, simulator.js: unable to act, can't move, can't see ...)
 * and the system's rules' (conditionMods, conditionWeight, modifiers). A helper adds its system's own
 * (adapter.conditionChoices), names them in the system's words (adapter.conditionLabel), and says which its sheets
 * carry (adapter.sheetCarries): those go on the sheet; the rest the core keeps.
 *
 * Many of them (PROFILES) do something of their own in a fight where the system says nothing of them: bonuses and
 * penalties, losing its actions, harm each turn, a hold to break, a remedy to try, a countdown, a spread. A system that
 * gives one its own meaning says so (rules.ownConditions, or rules.conditionMods for it): then the core's steps aside
 * for that one. And CONDITION_SYNONYMS: the names systems give them, for a helper mapping its own (coreKeyFor).
 *
 * And the ones toward another creature (RELATIONS): afraid of it, grabbed by it, goaded by it, controlled by it, tied
 * up by it, off guard to it alone, marked by it (live.js setRelation). A condition laid by someone (swallowed by the
 * worm, charmed by the bard) keeps who: its line on the map of minds is from them.
 * Pure: no Foundry globals.
 */

/** {key, valued}: valued ones have a number (frightened 2); the rest are on or off. */
export const CORE_CONDITIONS = Object.freeze([
  { key: "prone" },
  { key: "offGuard" },
  { key: "frightened", valued: true },
  { key: "sickened", valued: true },
  { key: "slowed", valued: true },
  { key: "stunned", valued: true },
  { key: "clumsy", valued: true },
  { key: "enfeebled", valued: true },
  { key: "exhaustion", valued: true },
  { key: "blinded" },
  { key: "deafened" },
  { key: "silenced" },
  { key: "hidden" },
  { key: "invisible" },
  { key: "immobilized" },
  { key: "restrained" },
  { key: "grabbed" },
  { key: "paralyzed" },
  { key: "petrified" },
  { key: "unconscious" },
  { key: "asleep" },
  { key: "incapacitated" },
  { key: "confused" },
  { key: "dazed" },
  { key: "fleeing" },
  { key: "turned" },
  { key: "poisoned" },
  { key: "vulnerable" },
  { key: "disarmed" },
  { key: "bound" },
  // Senses
  { key: "dazzled" },
  { key: "concealed" },
  { key: "outlined" },
  // The mind
  { key: "fascinated" },
  { key: "charmed" },
  { key: "enraged" },
  { key: "stupefied", valued: true },
  { key: "cursed", valued: true },
  // The body
  { key: "drained", valued: true },
  { key: "doomed", valued: true },
  { key: "chilled", valued: true },
  { key: "frozen" },
  { key: "burning", valued: true },
  { key: "bleeding", valued: true },
  { key: "corroding", valued: true },
  { key: "diseased", valued: true },
  { key: "unhealable" },
  { key: "hastened" },
  { key: "encumbered" },
  // Gear and machines
  { key: "gearBroken" },
  { key: "glitching", valued: true },
  { key: "overheated", valued: true },
  { key: "suppressed" },
  // What the stars bring
  { key: "irradiated", valued: true },
  { key: "infectious", valued: true },
  { key: "impregnated", valued: true },
  { key: "suffocating", valued: true },
  { key: "adrift" },
  // Held inside something
  { key: "swallowed" },
  { key: "engulfed" },
  // Out of it
  { key: "stasis" },
  { key: "banished" },
  { key: "transformed" }
].map(Object.freeze));

/** Conditions toward another creature: who it's afraid of, grabbed by, goaded by, controlled by, tied up by, off guard to, marked by. */
export const RELATIONS = Object.freeze(["afraid", "grabbed", "goaded", "controlled", "bound", "exposedTo", "marked"]);

/** Those the GM can put on (marked: a power's own, only taken off). */
export const GM_RELATIONS = Object.freeze(RELATIONS.filter(k => k !== "marked" && k !== "bound"));

/** Is this a condition key worth taking (a short identifier)? */
export const validConditionKey = key => typeof key === "string" && /^[a-zA-Z][\w-]{0,40}$/.test(key);

/* -------------------------------------------- */
/*  What they do                                */
/* -------------------------------------------- */

/**
 * What each does where the system says nothing of it, every field optional (its value v: 1 for one that isn't counted):
 *   most          its highest value (counted ones; none: no most)
 *   mods(v)       bonuses and penalties (engine/mods.js), flat ones in d20 points (a system with other dice gets as
 *                 many of its own as are worth as much: rules.rollPoint)
 *   weight(v)     the share of its fighting it takes away each round, besides its mods
 *   act           false: it loses its actions (frozen solid, in stasis)
 *   move          false: it can't move; "fly": only flying (adrift)
 *   command       false: it can't direct anyone (it can't be seen and heard leading)
 *   talk          false: it can't talk anyone round (choking, in a rage)
 *   heal          false: it regains no hit points (unhealable)
 *   untouchable   nothing harms it, and nobody goes for it (stasis, banished)
 *   reveals       being hidden or invisible does it no good (outlined)
 *   spares        it won't go for whoever laid it (charmed)
 *   rage          it goes for the nearest foe, badly, and thinks of nothing else
 *   noGear        it can use nothing that needs hands, and no spells (transformed)
 *   harm          [formula, type] it takes at the end of each of its turns, by its value (formula: a function of v);
 *                 bySource: by the level of whoever laid it (in a gullet: the swallower's). A system may say what it is
 *                 in its own terms (rules.conditionHarm(key, value, unit, by): damage parts, or null for none)
 *   grows         its value rises at the end of each of its turns, to its most; term: what comes then, there ("burst":
 *                 whatever grows in it tears free, and it falls; "drop": it falls, out of breath)
 *   spreads       at the end of its turn, each creature beside it may catch it (a save against a typical DC for the
 *                 bearer's level, the better of its Fortitude and Constitution): caught, at 1
 *   hold          an action breaks it (behavior/holds.js): {others: "check" (a friend beside it can try) | "untie" (a
 *                 friend beside it does it, no roll) | null, via: "medicine" (first aid, not an escape), harder (more
 *                 than a typical DC), worsens (a failed try makes it 1 worse), bySource (as hard as whoever laid it
 *                 makes it, and gone when that one falls)}
 *   remedy        what it can try itself (holds.js remediesOf: the desire to be rid of it): {chance, lowers (by how
 *                 much; else it ends), moves (it must be free to move), annoyance (how badly it bothers it), type (a
 *                 damage type, for the story: fire is douse the flames)}
 *   help          a friend beside it can do it for it: {others, via}, as a hold's
 *   breaks        "harm": any harm ends it; "source": harm from whoever laid it, or that one's side
 *   healed        "ends": any healing ends it (a bleed)
 */
const it = (formula, type) => [formula, type];
export const PROFILES = Object.freeze({
  dazzled: { mods: () => ({ attack: -2 }) },
  concealed: { mods: () => ({ defAdv: -1 }) },
  outlined: { mods: () => ({ defAdv: 1 }), reveals: true },
  fascinated: { act: false, command: false, breaks: "harm", weight: () => 0.8 },
  charmed: { spares: true, breaks: "source", weight: () => 0.3 },
  enraged: { mods: () => ({ ac: -2, attack: 1 }), rage: true, talk: false },
  stupefied: { most: 4, mods: v => ({ checks: -v }) },
  cursed: { most: 3, mods: v => ({ saves: -v, checks: -v }) },
  drained: { most: 4, mods: v => ({ saves: -v }) },
  doomed: { most: 3, weight: v => 0.05 * v },
  chilled: { most: 3, mods: v => ({ speed: -10 * v }) },
  frozen: { act: false, move: false, command: false, talk: false, mods: () => ({ defAdv: 1 }), weight: () => 1, hold: { others: "check" } },
  burning: { most: 4, harm: it(v => `${v}d6`, "fire"), remedy: { chance: 0.5, annoyance: 60, type: "fire" }, help: { others: "untie" } },
  bleeding: { most: 4, harm: it(v => `${v}d4`, "bleed"), remedy: { chance: 0.4, annoyance: 45, type: "bleed" }, help: { others: "check", via: "medicine" }, healed: "ends" },
  corroding: { most: 4, harm: it(v => `${v}d6`, "acid"), remedy: { chance: 0.5, annoyance: 50, type: "acid" } },
  diseased: { most: 4, mods: v => ({ attack: -v, checks: -v }) },
  unhealable: { heal: false, weight: () => 0.05 },
  hastened: { mods: () => ({ actions: 1 }) },
  encumbered: { mods: () => ({ speed: -10 }) },
  gearBroken: { mods: () => ({ attack: -2, ac: -2 }) },
  glitching: { most: 4, mods: v => ({ attack: -v, checks: -v }), remedy: { chance: 0.5, lowers: 1, annoyance: 35 } },
  overheated: { most: 2, mods: v => ({ attack: -2 * v }), harm: it(v => (v >= 2 ? "1d6" : null), "fire"), remedy: { chance: 1, annoyance: 40 } },
  suppressed: { mods: () => ({ attack: -1, speed: -10 }) },
  irradiated: { most: 4, harm: it(v => `${v}d4`, "radiation"), mods: v => ({ saves: -Math.ceil(v / 2) }) },
  infectious: { most: 3, spreads: true },
  impregnated: { most: 6, grows: true, term: "burst", mods: v => ({ attack: -Math.floor(v / 3), saves: -Math.floor(v / 3) }), hold: { others: "check", via: "medicine", harder: 5, worsens: true } },
  suffocating: { most: 3, grows: true, term: "drop", command: false, talk: false, remedy: { chance: 0.75, moves: true, annoyance: 90 } },
  adrift: { move: "fly", mods: () => ({ attack: -2 }), remedy: { chance: 0.4, moves: false, annoyance: 40 }, help: { others: "untie" } },
  swallowed: { move: false, command: false, mods: () => ({ attack: -2 }), harm: it(null, "acid"), bySource: true, hold: { others: null, bySource: true } },
  engulfed: { move: false, command: false, talk: false, mods: () => ({ attack: -2 }), harm: it(null, "acid"), bySource: true, hold: { others: null, bySource: true } },
  stasis: { act: false, move: false, command: false, untouchable: true, weight: () => 1 },
  banished: { act: false, move: false, command: false, untouchable: true, weight: () => 1 },
  transformed: { noGear: true, command: false, weight: () => 0.4 }
});

/** A condition's highest value (null: none; 1: on or off). */
export function conditionMost(key) {
  const c = CORE_CONDITIONS.find(x => x.key === key);
  if ( !c ) return null;
  return c.valued ? (PROFILES[key]?.most ?? null) : 1;
}

/**
 * What the core needs of a system to play its conditions, kept with each creature (plain data, kept between turns):
 * the keys the system gives its own meaning (rules.ownConditions, or rules.conditionMods for it), and how many of its
 * roll's points one d20 point is worth.
 */
export function conditionSetup(rules) {
  const own = new Set(rules?.ownConditions ?? []);
  for ( const key of Object.keys(PROFILES) ) {
    const m = rules?.conditionMods?.(key, 1);
    if ( m && typeof m === "object" ) own.add(key);
  }
  const point = Number(rules?.rollPoint);
  return { owned: [...own].filter(k => PROFILES[k]), scale: point > 0 ? D20_POINT / point : 1 };
}
/** One point on a d20 (behavior/effects.js D20_POINT). */
const D20_POINT = 0.085;

/** What a condition does on this creature by the core's say: its profile, unless the system gives it its own meaning. */
export const profileOf = (u, key) => (u?.coreConds?.owned?.includes(key) ? null : PROFILES[key] ?? null);

/** Its conditions (with their values) that do something by the core's say: [[key, value, profile]]. */
export function profiled(u) {
  const out = [];
  for ( const [k, raw] of Object.entries(u?.conds ?? {}) ) {
    const v = raw === true ? 1 : Number(raw) || 0;
    const p = v > 0 ? profileOf(u, k) : null;
    if ( p ) out.push([k, v, p]);
  }
  return out;
}

/** Does any condition on it rule this out (its profile's field false: act, move, command, talk, heal)? */
export const barred = (u, what) => profiled(u).some(([, , p]) => p[what] === false);

/** Does any condition on it have this (untouchable, reveals, rage, noGear ...)? */
export const hasTrait = (u, what) => profiled(u).some(([, , p]) => !!p[what]);

/** A profile's bonuses and penalties at that value, as many of the system's points as its d20 points are worth. */
export function profileMods(p, v, scale = 1) {
  const raw = p?.mods?.(v);
  if ( !raw ) return null;
  const out = {};
  for ( const [k, n] of Object.entries(raw) ) {
    if ( !n ) continue;
    if ( ["attack", "ac", "saves", "checks"].includes(k) && scale !== 1 ) out[k] = Math.sign(n) * Math.max(1, Math.round(Math.abs(n) * scale));
    else out[k] = n;
  }
  return out;
}

/* -------------------------------------------- */
/*  What systems call them                      */
/* -------------------------------------------- */

/**
 * The names systems give the core's conditions (lower case, words joined by hyphens), for a helper mapping one of its
 * own that the core has under another name (coreKeyFor): grappled is grabbed, flat-footed off guard, entangled
 * restrained, lock-on outlined, polymorphed transformed, hacked controlled ...
 */
export const CONDITION_SYNONYMS = Object.freeze({
  "flat-footed": "offGuard", "off-guard": "offGuard", unaware: "offGuard", grappled: "grabbed", seized: "grabbed",
  fatigued: "exhaustion", exhausted: "exhaustion", tired: "exhaustion",
  entangled: "restrained", webbed: "restrained", netted: "restrained", pinned: "restrained", ensnared: "restrained",
  helpless: "paralyzed", held: "paralyzed", "held-fast": "immobilized", rooted: "immobilized", stuck: "immobilized",
  nauseated: "sickened", nauseous: "sickened", impaired: "sickened", staggered: "slowed", hindered: "slowed",
  panicked: "fleeing", routed: "fleeing", cowering: "stunned", shaken: "frightened", scared: "frightened", terrified: "frightened",
  dominated: "controlled", possessed: "controlled", hacked: "controlled", "mind-controlled": "controlled", compelled: "controlled",
  "turned-to-stone": "petrified", stoned: "petrified", "knocked-down": "prone", "knocked-prone": "prone",
  sleeping: "asleep", "knocked-out": "unconscious", insensate: "unconscious",
  befuddled: "stupefied", addled: "stupefied", "mind-fogged": "stupefied", weakened: "enfeebled", sapped: "enfeebled",
  maddened: "confused", insane: "confused", deranged: "confused", "temporary-insanity": "confused",
  exposed: "vulnerable", shredded: "vulnerable", defenseless: "vulnerable", "lock-on": "outlined", "locked-on": "outlined",
  painted: "outlined", tagged: "outlined", revealed: "outlined", "faerie-fire": "outlined", glowing: "outlined", spotlit: "outlined",
  blurred: "concealed", obscured: "concealed", "lightly-obscured": "concealed", "in-smoke": "concealed",
  "blinded-by-light": "dazzled", glare: "dazzled", flashed: "dazzled",
  hypnotized: "fascinated", entranced: "fascinated", mesmerized: "fascinated", transfixed: "fascinated",
  beguiled: "charmed", enthralled: "charmed", infatuated: "charmed",
  berserk: "enraged", frenzied: "enraged", frenzy: "enraged", "blood-rage": "enraged",
  hexed: "cursed", bewitched: "cursed", jinxed: "cursed", "ill-omened": "cursed",
  "energy-drained": "drained", "level-drained": "drained", withered: "drained",
  frostbitten: "chilled", numbed: "chilled", "frozen-solid": "frozen", encased: "frozen", "iced-over": "frozen",
  "on-fire": "burning", ablaze: "burning", aflame: "burning", ignited: "burning", alight: "burning",
  bleed: "bleeding", "persistent-bleed": "bleeding", hemorrhaging: "bleeding",
  acid: "corroding", corroded: "corroding", dissolving: "corroding", "acid-burned": "corroding",
  sick: "diseased", plague: "diseased", ill: "diseased", fevered: "diseased",
  rotting: "unhealable", "no-healing": "unhealable", festering: "unhealable", necrotized: "unhealable",
  quickened: "hastened", hasted: "hastened", haste: "hastened", accelerated: "hastened",
  overburdened: "encumbered", burdened: "encumbered", "weighed-down": "encumbered",
  broken: "gearBroken", sundered: "gearBroken", "weapon-broken": "gearBroken", "armor-broken": "gearBroken", damaged: "gearBroken",
  jammed: "glitching", malfunctioning: "glitching", emp: "glitching", "systems-failing": "glitching", bugged: "glitching",
  shorted: "stunned", "shorted-out": "stunned", overloaded: "stunned",
  overheating: "overheated", "danger-zone": "overheated", "running-hot": "overheated",
  "pinned-down": "suppressed", "under-fire": "suppressed", "keeping-low": "suppressed",
  radiated: "irradiated", "radiation-sickness": "irradiated", "rad-poisoned": "irradiated",
  infected: "infectious", contagious: "infectious", carrier: "infectious",
  implanted: "impregnated", infested: "impregnated", parasitized: "impregnated", "host-of": "impregnated",
  choking: "suffocating", drowning: "suffocating", "out-of-air": "suffocating", decompressing: "suffocating", strangled: "suffocating",
  untethered: "adrift", levitated: "adrift", "zero-g": "adrift", floating: "adrift", weightless: "adrift",
  devoured: "swallowed", gulped: "swallowed", enveloped: "engulfed", absorbed: "engulfed",
  "time-stopped": "stasis", "in-stasis": "stasis", suspended: "stasis", "frozen-in-time": "stasis",
  exiled: "banished", "plane-shifted": "banished", "sent-away": "banished", "teleported-away": "banished",
  polymorphed: "transformed", "baleful-polymorph": "transformed", shapechanged: "transformed", "turned-into": "transformed",
  silence: "silenced", muted: "silenced", gagged: "silenced", deaf: "deafened", blind: "blinded", undetected: "hidden"
});

/**
 * The core's key for a system's word for a condition (its slug or name: "Flat-Footed", "grappled", "on_fire"), or null:
 * a key of the core's own, or one of CONDITION_SYNONYMS.
 */
export function coreKeyFor(word) {
  if ( typeof word !== "string" || !word.trim() ) return null;
  const own = CORE_CONDITIONS.find(c => c.key === word || c.key.toLowerCase() === word.toLowerCase());
  if ( own ) return own.key;
  const norm = word.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return CONDITION_SYNONYMS[norm] ?? CORE_CONDITIONS.find(c => c.key.toLowerCase() === norm.replace(/-/g, ""))?.key ?? null;
}
