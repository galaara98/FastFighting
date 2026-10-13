/**
 * Turns the tokens on the viewed scene plus the GM's setup into a BattleSpec, runs it, and digs into the results.
 */
import { MODULE_ID, SIDES, ALLEGIANCE, DISPOSITION_SIDES, NEUTRAL_PARTY, HOSTILE_GROUPS, GROUPS, TRAITS, clamp } from "../constants.js";
import { runBatch, replay } from "../engine/simulator.js";
import { runsFor, swingRunsFor } from "../engine/run-budget.js";
import { deriveSeed } from "../engine/rng.js";
import { characterSpec, getAdapter, getModifiers } from "../api.js";
import { computeApproach, computeAwareness, environmentAt, positionOf, squareFeet } from "./terrain.js";
import { proposeGroups } from "../engine/groups.js";
import { TACTIC_KEYS, TACTIC_WISHES } from "../engine/tactics.js";
import { resetPathGrid } from "./pathing.js";
import { tokenSetup, sceneEncounter } from "./persistence.js";
import { tacticsFor, isPlayerControlled, statedDesires, getStoredTactics } from "./tactics.js";
import { ensureAutoConfig } from "./auto-config.js";
import { partyWishes, voters, PARTY_TACTICS } from "./party.js";
import { validMotives, NO_CATALOG, effectiveMotives } from "./motives.js";
import { rankForCommand, autoLieutenants, partyRoles } from "./command-pick.js";
import { setting } from "../settings.js";

const SIDE_LABELS = {
  [SIDES.FRIENDLY]: "FASTFIGHTING.Side.friendly",
  [SIDES.HOSTILE]: "FASTFIGHTING.Side.hostile",
  [SIDES.NEUTRAL]: "FASTFIGHTING.Side.neutral",
  [SIDES.SECRET]: "FASTFIGHTING.Side.secret",
  [NEUTRAL_PARTY]: "FASTFIGHTING.Side.neutralParty"
};

/** How many hostile groups are among these sides (a battle's, or its tokens'). */
export const hostileGroupsIn = sides => new Set([...sides].filter(s => HOSTILE_GROUPS.includes(s))).size;

/**
 * A side's name, in the reader's language. A hostile group is numbered ("FASTFIGHTING.Side.hostileGroup", {n}) when more
 * than one fights, or when the one that does isn't group 1; a lone hostile side is just that.
 * @param {string} side
 * @param {number} [hostileGroups]   how many hostile groups fight (hostileGroupsIn)
 */
export function sideName(side, hostileGroups = 1) {
  const n = HOSTILE_GROUPS.indexOf(side) + 1;
  if ( n > 1 || (n === 1 && hostileGroups > 1) ) return game.i18n.format("FASTFIGHTING.Side.hostileGroup", { n });
  return game.i18n.localize(SIDE_LABELS[side] ?? side);
}

/** Neutral tokens take no side in the fight: these allegiances are only the way they lean (behavior/neutral.js). */
export const LEANS = new Set([ALLEGIANCE.NEUTRAL, ALLEGIANCE.FRIENDLY, ALLEGIANCE.HOSTILE, ALLEGIANCE.CLOSEST, ALLEGIANCE.UNDERDOG]);

/** How the GM can mark any token in its FastFighting tab: as the system has it (""), not a hazard, simple, complex. */
export const HAZARD_MARKS = Object.freeze(["", "no", "simple", "complex"]);

/**
 * A token the GM marked as a hazard, in any system (a trap made as a creature, a system with no hazards of its own):
 * it fires as one, doesn't move, think or talk, and nobody attacks it; a simple one fires once, a complex one each
 * round. "no": not a hazard, whatever the system says (one the party can attack and break).
 * @param {object} spec        a CombatantSpec, changed in place
 * @param {string} [mark]      one of HAZARD_MARKS
 */
export function applyHazard(spec, mark) {
  if ( mark === "no" ) {
    delete spec.hazard;
    delete spec.untargetable;
    if ( spec.kind === "hazard" ) spec.kind = "npc";
  } else if ( mark === "simple" || mark === "complex" ) {
    Object.assign(spec, {
      kind: "hazard", hazard: { once: mark === "simple" }, untargetable: true, speeds: {}, leadership: null,
      social: { mindless: true, languages: [], pitches: {}, resist: {} }, flags: { ...spec.flags, fearless: true, mindless: true }
    });
  }
  return spec;
}

/** Token ids of the encounter's combatants on this scene. */
export function encounterTokenIds(scene = canvas.scene) {
  const combat = sceneEncounter(scene);
  if ( !combat ) return new Set();
  return new Set(combat.combatants.filter(c => c.tokenId && (!c.sceneId || c.sceneId === scene?.id)).map(c => c.tokenId));
}

/**
 * Read every eligible token on the viewed scene.
 * @returns {Promise<{token: Token, spec: object, baseSide: string}[]>}
 */
export async function gatherRoster(setup, adapter = getAdapter()) {
  if ( !canvas.ready || !adapter ) return [];
  const levelId = canvas.level?.id ?? null;
  const encounter = encounterTokenIds();
  // In the encounter: aware of the conflict from the start. With no encounter on the scene, that's everyone on the map.
  const inEncounter = { has: id => !encounter.size || encounter.has(id) };
  const tokens = canvas.tokens.placeables.filter(t => {
    if ( !t.actor || !adapter.canHandle(t.actor) ) return false;
    const starts = inEncounter.has(t.id);
    // The encounter's combatants always start the fight; everyone else on the map is a bystander.
    if ( !starts && setup.options.bystanders === false ) return false;
    if ( !starts && !setup.options.includeOtherLevels && levelId && t.document.level && t.document.level !== levelId ) return false;
    if ( !starts && !setup.options.includeHidden && t.document.hidden ) return false;
    return true;
  });
  const out = [];
  for ( const token of tokens ) {
    try {
      const spec = await characterSpec(adapter, token.document);
      if ( !spec ) continue;
      spec.environment = environmentAt(token);
      spec.hidden = token.document.hidden;
      spec.inEncounter = inEncounter.has(token.id);
      spec.position = positionOf(token);
      spec.perception ??= spec.initiative?.mod ?? 0;
      // (The GM's mark, in the token's FastFighting tab. Players can write their own actors' flags, and nobody attacks a
      // hazard: on an actor a player owns, the mark doesn't count.)
      applyHazard(spec, token.actor?.hasPlayerOwner ? null : token.actor?.getFlag(MODULE_ID, "hazard"));
      // (A hazard on the Neutral side, as PF2e leaves one with no alliance, is set against the party.)
      const side = DISPOSITION_SIDES[token.document.disposition] ?? SIDES.HOSTILE;
      out.push({ token, spec, baseSide: spec.hazard && side === SIDES.NEUTRAL ? SIDES.HOSTILE : side });
    } catch ( err ) {
      console.error(`${MODULE_ID} | failed to read ${token.name}`, err);
    }
  }
  return out;
}

/** The side a roster entry fights on for this run, before allegiance resolution. */
export function chosenSide(entry, setup) {
  return setup.tokens[entry.token.id]?.side ?? entry.baseSide;
}

/**
 * The friend group (1-3) a hostile or neutral token is in: the GM's pick, else (a neutral) the one proposed when the
 * planner opened, else 1.
 */
export function groupOf(entry, setup) {
  const ts = setup.tokens[entry.token.id];
  const neutral = chosenSide(entry, setup) === SIDES.NEUTRAL;
  const g = Number(ts?.group ?? (neutral ? ts?.autoGroup : null) ?? 1);
  return GROUPS.includes(g) ? g : 1;
}

/** The teams a Secret token can be put on: any hostile group, or any neutral team (an unused number: one of its own). */
export const SECRET_TEAMS = Object.freeze(GROUPS.flatMap(n => [`hostile${n}`]).concat(GROUPS.map(n => `neutral${n}`)));

/**
 * The team a Secret token is on ({side: "hostile" | "neutral", group: 1-3}): the GM's pick, else hostile group 1. (Null
 * for a token that isn't Secret.)
 */
export function secretTeam(entry, setup) {
  if ( chosenSide(entry, setup) !== SIDES.SECRET ) return null;
  const m = /^(hostile|neutral)([1-3])$/.exec(setup.tokens[entry.token.id]?.team ?? "");
  return m ? { side: m[1], group: Number(m[2]) } : { side: "hostile", group: 1 };
}

/** The neutral friend group a token taking no side is in: a neutral's group, or a Secret token's neutral team (else null). */
function neutralTeamOf(entry, setup) {
  if ( chosenSide(entry, setup) === SIDES.NEUTRAL ) return groupOf(entry, setup);
  const team = secretTeam(entry, setup);
  return team?.side === "neutral" ? team.group : null;
}

/** The side a hostile group fights as (group 1 is the hostile side itself). */
export const hostileSide = group => HOSTILE_GROUPS[group - 1] ?? SIDES.HOSTILE;

/** The side a token picked as Friendly or Hostile fights on: its hostile group's, for a hostile one. */
function campOf(entry, setup) {
  const side = chosenSide(entry, setup);
  return side === SIDES.HOSTILE ? hostileSide(groupOf(entry, setup)) : side;
}

/** The base actor's name, without the numbers tokens get ("Goblin 3"). */
const baseName = token => String(token.actor?.name ?? token.name ?? "").toLowerCase().replace(/[\s\d#.()-]+$/, "").trim();

/**
 * Propose friend groups for the neutral tokens on the map (engine/groups.js), each to its token's setup as autoGroup.
 * The planner does this the moment it opens; the GM's own picks (group) stand over these.
 * @param {boolean} [missingOnly]  only for neutrals that have no proposal yet (one put on the map since)
 */
export function proposeNeutralGroups(roster, setup, { missingOnly = false } = {}) {
  const neutrals = roster.filter(e => chosenSide(e, setup) === SIDES.NEUTRAL);
  if ( !neutrals.length || (missingOnly && neutrals.every(e => setup.tokens[e.token.id]?.autoGroup)) ) return;
  const feet = squareFeet();
  const { sceneX = 0, sceneY = 0, size } = canvas.dimensions;
  const list = neutrals.map(e => ({
    id: e.token.id,
    ...(e.spec.position ?? positionOf(e.token)),
    block: e.token.actor?._stats?.compendiumSource ?? e.token.document.actorId ?? null,
    kind: e.spec.creatureKind ?? null,
    name: baseName(e.token)
  }));
  const groups = proposeGroups(list, { origin: { x: (sceneX / size) * feet, y: (sceneY / size) * feet }, reach: setting("neutralReach"), square: feet });
  for ( const [id, g] of groups ) {
    const ts = tokenSetup(setup, id);
    if ( !missingOnly || !ts.autoGroup ) ts.autoGroup = g;
  }
}

function averageDistance(a, list) {
  if ( !list.length ) return Infinity;
  return list.reduce((s, b) => s + canvas.grid.measurePath([a.token.center, b.token.center]).distance, 0) / list.length;
}

/** Of the sides tokens were picked for (the party, each hostile group), the one nearest e on average. */
function closestCamp(e, camps) {
  let best = SIDES.FRIENDLY;
  let bestDistance = Infinity;
  for ( const [side, members] of Object.entries(camps) ) {
    const d = averageDistance(e, members);
    if ( d < bestDistance ) [best, bestDistance] = [side, d];
  }
  return best;
}

/** The party and each hostile group, with their members (tokens picked for them). */
function campsOf(included, setup) {
  const camps = { [SIDES.FRIENDLY]: [] };
  for ( const e of included ) {
    const side = chosenSide(e, setup);
    if ( side === SIDES.FRIENDLY || side === SIDES.HOSTILE ) (camps[campOf(e, setup)] ??= []).push(e);
  }
  return camps;
}

/**
 * Decide where Neutral and Secret tokens end up.
 * @returns {Record<string, string|null>} tokenId -> resolved side id (null = excluded)
 */
export function resolveAllegiances(roster, setup) {
  const resolved = {};
  const included = roster.filter(e => setup.tokens[e.token.id]?.include !== false);
  for ( const e of included ) {
    const side = chosenSide(e, setup);
    const explicit = setup.tokens[e.token.id]?.side;
    if ( side === SIDES.FRIENDLY || side === SIDES.HOSTILE || (explicit && ![SIDES.NEUTRAL, SIDES.SECRET].includes(side)) ) {
      resolved[e.token.id] = campOf(e, setup);
      continue;
    }
    // A Secret token is always on a team: its hostile group, or its neutral team (taking no side with it).
    const team = secretTeam(e, setup);
    if ( team ) {
      resolved[e.token.id] = team.side === "hostile" ? hostileSide(team.group) : NEUTRAL_PARTY;
      continue;
    }
    // Neutrals stand on the field taking no side, leaning the way their lean says; or they're left out, or fight everyone.
    const allegiance = setup.sides[side]?.allegiance ?? ALLEGIANCE.EXCLUDE;
    resolved[e.token.id] = LEANS.has(allegiance) ? NEUTRAL_PARTY : allegiance === ALLEGIANCE.OWN ? side : null;
  }
  return resolved;
}

/**
 * Which way each token that takes no side leans: toward the party, the enemy, the nearest of them, or the underdog
 * (worked out as the fight goes); null leans nowhere.
 * @returns {Record<string, string|null>} tokenId -> lean
 */
export function resolveLeans(roster, setup) {
  const leans = {};
  const included = roster.filter(e => setup.tokens[e.token.id]?.include !== false);
  const camps = campsOf(included, setup);
  for ( const e of included ) {
    // Neutrals, and Secret tokens on a neutral team: they lean as the neutrals do.
    if ( chosenSide(e, setup) !== SIDES.NEUTRAL && secretTeam(e, setup)?.side !== "neutral" ) continue;
    const allegiance = setup.sides[SIDES.NEUTRAL]?.allegiance;
    leans[e.token.id] = {
      [ALLEGIANCE.FRIENDLY]: SIDES.FRIENDLY,
      [ALLEGIANCE.HOSTILE]: SIDES.HOSTILE,
      [ALLEGIANCE.UNDERDOG]: "underdog",
      [ALLEGIANCE.CLOSEST]: allegiance === ALLEGIANCE.CLOSEST ? closestCamp(e, camps) : null
    }[allegiance] ?? null;
  }
  return leans;
}

function fudgedTraits(spec, fudge) {
  const out = {};
  for ( const k of TRAITS ) out[k] = { base: spec.traits[k]?.base ?? 50, fudge: (spec.traits[k]?.fudge ?? 0) + (fudge?.[k] ?? 0) };
  return out;
}

/** Apply stat fudges (AC, HP, attack, damage) to a copy of the spec. */
function applyStatFudges(spec, fudge = {}) {
  const s = foundry.utils.deepClone(spec);
  if ( fudge.ac ) s.defenses.ac += fudge.ac;
  if ( fudge.hp ) {
    s.hp.max = Math.max(1, s.hp.max + fudge.hp);
    s.hp.value = clamp(s.hp.value + fudge.hp, 0, s.hp.max);
  }
  for ( const a of s.actions ) {
    if ( fudge.attack && a.bonus !== undefined ) a.bonus += fudge.attack;
    if ( fudge.attack && a.save ) a.save.dc += fudge.attack;
    if ( fudge.damage && a.damage?.length ) a.damage[0].flat += fudge.damage;
  }
  return s;
}

/**
 * Fold a character's tactics answers and playstyles into its spec.
 *  - Player-controlled: full tactics (answers over playstyle-adjusted suggestions), plus the calculated
 *    strategy so "stay mostly true" can fall back to it.
 *  - NPCs: the answers the GM gave, and what their playstyles imply; everything else stays personality-driven.
 * Three questions carry a wish each, as strongly as the answer says (TACTIC_WISHES): always talking (unless hurt),
 * avoiding killing, not liking to flee. "Let this character decide" carries none.
 * Playstyle trait shifts land on the trait fudges (already capped at ±10 when staying true).
 */
function applyCharacterTactics(spec, entry) {
  const actor = entry.token.actor;
  const { calc, resolved, stored, playstyles } = tacticsFor(actor, entry.spec);
  spec.playstyles = playstyles.ids;
  spec.behavior = playstyles.behavior;
  spec.desireStyle = playstyles.desire; // how its pills say it picks up desires
  spec.stayTrue = !!stored.stayTrue;
  spec.roleplay = !!stored.roleplay;
  // The wishes the answers carry, 0 to 1: always talking (unless being hurt), avoiding killing, not liking to flee.
  const wish = key => TACTIC_WISHES[key][stored[key]] ?? 0;
  spec.alwaysTalk = wish("talk");
  spec.desires = statedDesires(stored, spec); // what the GM or player says it wants, at whom, how badly
  spec.avoidCostlySpells = !!stored.avoidCostlySpells; // "I don't like to use spells that cost something"
  spec.avoidKilling = wish("target"); // holds back from a kill: knocks out, leaves the fallen be, spares them after
  spec.avoidFleeing = wish("retreat"); // stays when it would choose to run
  // What it brings to a standoff, and what it wants out of it: only what it really has, and the system's own kinds of thing.
  // (Left to the character: what "Let this character decide" stands for.)
  const motives = validMotives(effectiveMotives(stored, { offer: calc.offer, expect: calc.expect }), spec.valuables, getAdapter()?.itemCatalog?.() ?? NO_CATALOG);
  if ( motives ) spec.motives = motives;
  for ( const [k, v] of Object.entries(playstyles.traits) ) {
    if ( spec.traits[k] ) spec.traits[k] = { ...spec.traits[k], fudge: (spec.traits[k].fudge ?? 0) + v };
  }
  // Questions left to "Let this character decide" where the pills disagree: each fight draws one pill's answer, by its place.
  const mixFor = keys => {
    const out = Object.fromEntries(Object.entries(playstyles.mix ?? {}).filter(([k]) => keys.includes(k)));
    return Object.keys(out).length ? out : null;
  };
  const unanswered = k => [undefined, null, "", "auto"].includes(stored[k]);
  if ( isPlayerControlled(entry.spec, actor) ) {
    spec.tactics = { ...resolved };
    spec.tacticsCalc = calc;
    spec.tacticsMix = mixFor(Object.keys(playstyles.mix ?? {}).filter(unanswered));
  } else {
    const answered = Object.fromEntries(TACTIC_KEYS.filter(k => !unanswered(k)).map(k => [k, resolved[k]]));
    const tactics = { ...playstyles.suggest, ...answered };
    if ( Object.keys(tactics).length ) {
      spec.tactics = tactics;
      spec.tacticsCalc = Object.fromEntries(Object.keys(tactics).map(k => [k, calc[k]]));
      spec.tacticsMix = mixFor(Object.keys(playstyles.mix ?? {}).filter(unanswered));
    }
  }
  // (The engine hears "always" as talking first, the wish carried by alwaysTalk; avoiding killing leaves whom it goes
  // for to what it would do anyway.)
  if ( spec.tactics?.talk === "always" ) spec.tactics.talk = "first";
  if ( spec.tactics?.target === "avoidKilling" ) {
    if ( isPlayerControlled(entry.spec, actor) ) spec.tactics.target = { ...calc, ...playstyles.suggest }.target;
    else if ( playstyles.suggest.target ) spec.tactics.target = playstyles.suggest.target;
    else delete spec.tactics.target;
  }
}

/** The player party's wishes for this fight (party.js): its players' votes, majority rules, at the world's Party's sway. */
/**
 * Could a character know of that token: it's in the fight (the encounter's), or within the character's sight (no wall
 * that blocks sight between them)?
 */
function knowable(token, targetId) {
  const scene = token.document?.parent ?? token.scene;
  const target = scene?.tokens?.get(targetId);
  if ( !target ) return false;
  if ( sceneEncounter(scene)?.combatants?.some(c => c.tokenId === targetId) ) return true;
  const from = token.center;
  const to = target.object?.center;
  if ( !from || !to ) return true;
  try {
    return !CONFIG.Canvas.polygonBackends.sight.testCollision(from, to, { type: "sight", mode: "any" });
  } catch ( err ) {
    return true;
  }
}

/**
 * The party's wishes for a fight: the votes of the players logged in with a character on the friendly side (with none,
 * the GM's own friendly characters have none), a tie settled by the players of its leader (its token, if it has one).
 */
function partyFor(entries, leaderId = null) {
  const owns = (u, e) => !!e?.token.actor?.testUserPermission?.(u, "OWNER");
  const inFight = voters().filter(u => entries.some(e => owns(u, e)));
  const leader = entries.find(e => e.token.id === leaderId);
  return partyWishes(inFight, setting("partySway"), inFight.filter(u => owns(u, leader)));
}

/**
 * The party's say in how a member of the friendly side acts: its answers to the questions the member left to "Let this
 * character decide" (talking, resources, when to pull out), drawn in that share of fights (playstyles.js
 * sampleRunTactics); and, sparing the fallen, as strong a wish to.
 */
function applyPartyWishes(spec, entry, party) {
  const stored = entry.token.actor ? getStoredTactics(entry.token.actor) : {};
  const open = k => [undefined, null, "", "auto"].includes(stored[k]);
  const picks = {};
  for ( const [question, keys] of Object.entries(PARTY_TACTICS) ) {
    if ( !party[question] ) continue;
    for ( const [key, map] of Object.entries(keys) ) if ( open(key) && map[party[question]] ) picks[key] = map[party[question]];
  }
  if ( Object.keys(picks).length && spec.tactics ) {
    spec.partyTactics = picks;
    spec.partySway = party.sway;
  }
  if ( party.fallen === "spare" ) spec.avoidKilling = Math.max(Number(spec.avoidKilling) || 0, party.sway);
}

/** Leader playstyles put a character forward as their side's leader. */
/** The roles a token can hold in its group's chain of command (the planner's pills): boss or leader, then two lieutenants. */
export const ROLES = Object.freeze(["boss", "leader", "lt1", "lt2"]);
/** What a leader the system didn't rank (the GM's own pick) lends its group. */
const PICKED_BONUS = Object.freeze({ brave: 10, tacticalFloor: 40, attack: 0, ac: 0 });

/** The group a roster entry fights in, for command: its side, or (taking no side) its friend group, or null. */
export function commandGroup(entry, setup, resolved) {
  const side = resolved[entry.token.id];
  if ( !side ) return null;
  if ( side === NEUTRAL_PARTY ) {
    const team = neutralTeamOf(entry, setup);
    return team ? `${NEUTRAL_PARTY}#${team}` : null;
  }
  return side;
}

/** The planner tab whose settings a command group uses (hostile groups share the Hostile tab's; neutral groups the Neutral's). */
const tabOf = key => (key.startsWith(NEUTRAL_PARTY) ? SIDES.NEUTRAL : HOSTILE_GROUPS.includes(key) ? SIDES.HOSTILE : key);

/** A member's playstyles and traits (its playstyles' shifts in them), for who takes command (command-pick.js). */
function bossyOf(entry) {
  let styles = { ids: [], traits: {} };
  try {
    styles = tacticsFor(entry.token.actor, entry.spec).playstyles ?? styles;
  } catch ( err ) { /* (no tactics to read: it's as its traits say) */ }
  const traits = Object.fromEntries(TRAITS.map(k => [k, (Number(entry.spec.traits?.[k]?.base) || 50) + (styles.traits?.[k] ?? 0)]));
  return { playstyles: styles.ids ?? [], traits, rarity: entry.spec.rarity ?? 0 };
}

/**
 * Every group's chain of command: {key: [{id, slot (boss | leader | lt1 | lt2), role, leadership, auto, reason, why}]},
 * from the roles in the plan (a pill in the planner; "none" keeps a token out; auto: the automatic pick made when the
 * plan was new, see seedCommand). With `auto`, the automatic pick fills the rest (command-pick.js):
 *  - outside the party, the group's best heads it (as its boss when it outranks every other member by 2 levels or
 *    more): the system's ranking of who leads (adapter.detectLeaders) counts double, how bossy each is sways it; a
 *    group of five or more gets a lieutenant too. A group of one has nobody to command.
 *  - the party: the roles the GM gave its members in earlier fights (the partyCommand setting); else a leader only
 *    when one member, and only one, wants to lead. It never has a boss.
 * A tab set to "No leaders" has none.
 * @param {object[]} entries   roster entries in the fight
 * @param {object} [options]   {auto: fill what the plan leaves open with the automatic pick}
 */
export function commandChains(entries, setup, resolved, adapter = getAdapter(), { auto: fill = false } = {}) {
  const groups = new Map();
  for ( const e of entries ) {
    if ( e.spec.hazard ) continue; // (a hazard commands nobody, and nobody commands it)
    const key = commandGroup(e, setup, resolved);
    if ( !key ) continue;
    if ( !groups.has(key) ) groups.set(key, []);
    groups.get(key).push(e);
  }
  const out = {};
  for ( const [key, members] of groups ) {
    const tab = tabOf(key);
    const s = setup.sides[tab] ?? {};
    if ( s.leaderId === "none" ) continue;
    const party = key === SIDES.FRIENDLY;
    const ranked = adapter?.detectLeaders(members.map(m => m.spec)) ?? [];
    const roleOf = e => setup.tokens[e.token.id]?.role ?? null;
    const picked = slot => members.find(e => roleOf(e) === slot) ?? null;
    // (A leader picked the old way, by the tab's leader setting.)
    const legacy = s.leaderId && s.leaderId !== "auto" ? members.find(e => e.token.id === s.leaderId && !roleOf(e)) ?? null : null;
    const used = new Set(members.filter(e => roleOf(e)).map(e => e.token.id));
    if ( legacy ) used.add(legacy.token.id);
    const lf = s.leadershipFudge ?? {};
    const entry = (id, slot, auto, why = null) => {
      const r = ranked.find(x => x.id === id);
      const b = r?.bonus ?? PICKED_BONUS;
      // (A role the automatic pick gave when the plan was new keeps saying why.)
      const ts = setup.tokens[id];
      if ( !auto && ts?.roleAuto ) [auto, why] = [true, ts.roleWhy ?? null];
      return {
        id, slot, auto, why, reason: why ? game.i18n.localize(why) : r?.reason ?? "", role: slot === "boss" ? "boss" : slot === "leader" ? "leader" : "lieutenant",
        leadership: Object.fromEntries(["brave", "tacticalFloor", "attack", "ac"].map(k => [k, { base: b[k] ?? 0, fudge: lf[k] ?? 0 }]))
      };
    };
    const level = id => Number(members.find(m => m.token.id === id)?.spec.level) || 0;
    const outranks = id => members.length > 1 && members.every(m => m.token.id === id || level(id) >= (Number(m.spec.level) || 0) + 2);
    const chain = [];
    const boss = party ? null : picked("boss");
    const leader = picked("leader") ?? (party ? picked("boss") : null) ?? legacy;
    const free = members.filter(e => !used.has(e.token.id));
    if ( party ) {
      // The roles from earlier fights, or the one member who wants to lead.
      const taken = new Set(["leader", "lt1", "lt2"].filter(slot => (slot === "leader" ? leader : picked(slot))));
      const auto = new Map(partyRoles(free.map(e => ({ id: e.token.id, actorId: e.token.actor?.id ?? null, playstyles: bossyOf(e).playstyles })),
        setting("partyCommand") ?? {}, taken).map(r => [r.slot, r]));
      const why = r => (r.why === "remembered" ? "FASTFIGHTING.Planner.RoleRemembered" : "FASTFIGHTING.Planner.RoleWantsToLead");
      if ( leader ) chain.push(entry(leader.token.id, "leader", false));
      else if ( fill && auto.has("leader") ) chain.push(entry(auto.get("leader").id, "leader", true, why(auto.get("leader"))));
      for ( const slot of ["lt1", "lt2"] ) {
        const p = picked(slot);
        if ( p ) chain.push(entry(p.token.id, slot, false));
        else if ( fill && auto.has(slot) ) chain.push(entry(auto.get(slot).id, slot, true, why(auto.get(slot))));
      }
    } else {
      // The group's best: the system's ranking counts double, how bossy each is sways it.
      const order = rankForCommand(free.map(e => ({ id: e.token.id, ...bossyOf(e) })), ranked);
      const next = () => {
        const r = order.find(x => !used.has(x.id));
        if ( r ) used.add(r.id);
        return r ?? null;
      };
      if ( boss ) chain.push(entry(boss.token.id, "boss", false));
      else if ( leader ) chain.push(entry(leader.token.id, "leader", false));
      else if ( fill && members.length > 1 ) {
        const r = next();
        if ( r ) chain.push(entry(r.id, outranks(r.id) ? "boss" : "leader", true));
      }
      // A lieutenant of its own in a group of five or more (unless the GM gave it one).
      let lieutenants = Math.max(0, autoLieutenants(members.length) - ["lt1", "lt2"].filter(slot => picked(slot)).length);
      for ( const slot of ["lt1", "lt2"] ) {
        const p = picked(slot);
        if ( p ) chain.push(entry(p.token.id, slot, false));
        else if ( fill && lieutenants > 0 && chain.length ) {
          const r = next();
          if ( r ) chain.push(entry(r.id, slot, true));
          lieutenants--;
        }
      }
    }
    if ( chain.length ) out[key] = chain;
  }
  return out;
}

/**
 * A new plan (or one just cleared) gets its chains of command once: whoever the plan gives no role takes the one the
 * automatic pick gives it, kept in the plan as automatic (faded in the planner). After that only the GM changes them:
 * tokens joining the fight, or moving from group to group, reshuffle nothing.
 */
export function seedCommand(roster, setup, adapter = getAdapter()) {
  const resolved = resolveAllegiances(roster, setup);
  const entries = roster.filter(e => resolved[e.token.id] && setup.tokens[e.token.id]?.include !== false);
  for ( const chain of Object.values(commandChains(entries, setup, resolved, adapter, { auto: true })) ) {
    for ( const c of chain ) {
      if ( !c.auto || setup.tokens[c.id]?.role ) continue;
      Object.assign(tokenSetup(setup, c.id), { role: c.slot, roleAuto: true, ...(c.why ? { roleWhy: c.why } : {}) });
    }
  }
  setup.commandSeeded = true;
}

/** A token's role in the plan, gone (with whether the automatic pick gave it, and why). */
export function clearRole(ts) {
  if ( !ts ) return;
  delete ts.role;
  delete ts.roleAuto;
  delete ts.roleWhy;
}

/**
 * Build the BattleSpec the engine runs.
 * @param {object[]} roster      From gatherRoster
 * @param {object} setup         Scene setup
 * @param {object} [extra]       {approach, exclude: Set<tokenId>, optionOverrides}
 */
export function buildBattleSpec(roster, setup, { approach = null, exclude = new Set(), optionOverrides = {} } = {}) {
  const adapter = getAdapter();
  const sideDefaults = setting("sideDefaults");
  proposeNeutralGroups(roster, setup, { missingOnly: true }); // (a neutral put on the map since the planner opened)
  const resolved = resolveAllegiances(roster, setup);
  const options = { ...setup.options, ...optionOverrides };
  // Who commands each group: its boss or leader, and its lieutenants. (The party's leader settles a tie in its wishes,
  // whether or not leadership counts in this fight.)
  const fighters = roster.filter(e => resolved[e.token.id] && !exclude.has(e.token.id));
  const command = commandChains(fighters, setup, resolved, adapter);
  const chains = options.leadership ? command : {};
  // The player party's wishes: the votes of the players with a character on the friendly side.
  const party = partyFor(fighters.filter(e => resolved[e.token.id] === SIDES.FRIENDLY), command[SIDES.FRIENDLY]?.[0]?.id ?? null);
  const leans = resolveLeans(roster, setup);
  const hidden = new Set(roster.filter(e => e.token.document?.hidden).map(e => e.token.id));
  const combatants = [];
  const bySide = {};
  for ( const e of roster ) {
    const side = resolved[e.token.id];
    if ( !side || exclude.has(e.token.id) ) continue;
    const ts = tokenSetup(setup, e.token.id);
    const spec = applyStatFudges(e.spec, ts.fudge);
    spec.side = side;
    spec.originSide = e.baseSide;
    if ( side === NEUTRAL_PARTY ) spec.lean = leans[e.token.id] ?? null;
    if ( side === NEUTRAL_PARTY ) spec.group = neutralTeamOf(e, setup) ?? undefined; // its friend group
    spec.traits = fudgedTraits(e.spec, ts.fudge);
    applyCharacterTactics(spec, e);
    if ( side === SIDES.FRIENDLY && party ) applyPartyWishes(spec, e, party);
    // (A player's character wants nothing of a token hidden from it, or of one it couldn't know is there (out of the
    // fight and out of its sight): the survey never offers one, and a flag written by hand can't name one either.)
    if ( e.token.actor?.hasPlayerOwner ) spec.desires = (spec.desires ?? []).filter(d => !hidden.has(d.targetId) && knowable(e.token, d.targetId));
    if ( ts.diesAtZero !== undefined ) spec.diesAtZero = ts.diesAtZero;
    combatants.push(spec);
    (bySide[side] ??= []).push(spec);
  }
  // Companions: map the master actor to the master's token on this battlefield.
  for ( const c of combatants ) {
    const masterActorId = c.flags?.masterActorId;
    if ( masterActorId ) c.flags.masterId = combatants.find(o => o.actorId === masterActorId)?.id ?? null;
  }

  const sides = {};
  const used = Object.keys(bySide);
  const fighting = used.filter(s => s !== NEUTRAL_PARTY); // (those who take no side are nobody's enemy, as a side)
  const hostileGroups = hostileGroupsIn(used);
  for ( const side of used ) {
    const neutral = side === NEUTRAL_PARTY;
    // Hostile groups share the hostile side's settings; each has its own leader (the GM's pick, if it's in the group).
    const group = HOSTILE_GROUPS.includes(side);
    const s = (neutral ? setup.sides[SIDES.NEUTRAL] : group ? setup.sides[SIDES.HOSTILE] : setup.sides[side]) ?? {};
    const defaults = sideDefaults[neutral ? SIDES.NEUTRAL : group ? SIDES.HOSTILE : side] ?? sideDefaults.hostile;
    // Everyone who fights is everyone else's enemy: the party's, each hostile group's (and third parties fight all).
    const enemies = neutral ? [] : fighting.filter(o => o !== side);
    const head = neutral ? null : chains[side]?.[0] ?? null;
    sides[side] = {
      label: sideName(side, hostileGroups),
      enemies,
      traits: Object.fromEntries(TRAITS.map(k => [k, { base: defaults[k] ?? 50, fudge: s.traitFudge?.[k] ?? 0 }])),
      leaderId: head?.id ?? null,
      leadership: head?.leadership ?? {},
      healAggro: s.healAggro ?? "balanced",
      morale: s.morale !== false,
      ...(side === SIDES.FRIENDLY && party ? { party } : {})
    };
  }

  // Initiative and surprise
  let initiativeOrder = null;
  let stealthSides = [];
  let surpriseSide = null;
  if ( options.surprise === "tracker" ) {
    const combat = sceneEncounter();
    if ( combat?.combatants.some(x => x.initiative !== null) ) {
      // An encounter already under way picks up from whoever's turn it is.
      const turns = combat.started ? [...combat.turns.slice(combat.turn ?? 0), ...combat.turns.slice(0, combat.turn ?? 0)] : combat.turns;
      initiativeOrder = turns.filter(t => t.initiative !== null && t.tokenId).map(t => t.tokenId);
    }
  } else if ( options.surprise === "stealth" ) {
    stealthSides = used.filter(s => combatants.some(c => c.side === s && c.hidden));
  } else if ( used.includes(options.surprise) ) {
    surpriseSide = options.surprise;
  }

  const spec = {
    combatants,
    sides,
    // (What those who stand aside mid-fight are called, in the reader's language.)
    neutralLabel: sideName(NEUTRAL_PARTY),
    command: Object.fromEntries(Object.entries(chains).map(([k, chain]) => [k, chain.map(c => ({ id: c.id, role: c.role, leadership: c.leadership }))])),
    approach: options.positioning ? approach : null,
    doors: options.positioning ? sceneDoors() : {},
    options: {
      maxRounds: options.maxRounds,
      downedModel: options.downedModel,
      aftermath: options.aftermath,
      positioning: options.positioning && !!approach,
      // How dark the scene is (0 to 1): in the dark, only darkvision and the like see far.
      darkness: canvas.scene?.environment?.darknessLevel ?? 0,
      morale: options.morale,
      leadership: options.leadership,
      // How readily followers take their lead, and how much more readily a boss's (world settings, as sliders).
      leaderInfluence: setting("leaderInfluence"),
      bossInfluence: setting("bossInfluence"),
      talking: options.talking !== false,
      ignoreLanguages: options.ignoreLanguages === true,
      opening: options.opening ?? "auto",
      // The luck checks that protect player characters (world settings, as sliders).
      concedeLuck: setting("concedeLuck"),
      theftLuck: setting("theftLuck"),
      executeLuck: setting("executeLuck"),
      trapLuck: setting("trapLuck"),
      // And how readily a playstyle's taunt takes hold.
      tauntLuck: setting("tauntLuck"),
      // And the one that keeps enemies from changing sides too easily.
      switchLuck: setting("switchLuck"),
      // And the one a player character scheming against the leader it wasn't chosen to be needs to turn traitor.
      traitorLuck: setting("traitorLuck"),
      // How often someone who doesn't like to flee ignores the urge to run.
      standGround: setting("standGround"),
      avoidKilling: setting("avoidKilling"),
      initiativeOrder,
      stealthSides,
      surpriseSide
    }
  };
  for ( const m of getModifiers() ) {
    try {
      m.apply(spec, { setup, roster });
    } catch ( err ) {
      console.error(`${MODULE_ID} | modifier ${m.id} failed`, err);
    }
  }
  // The game system's own settings for this encounter (the planner's system section): its helper applies them.
  try {
    adapter?.applyPlannerSettings?.(spec, setup.system ?? {}, { setup, roster, resolved });
  } catch ( err ) {
    console.error(`${MODULE_ID} | the system's settings for this encounter failed`, err);
  }
  return spec;
}

/**
 * Terrain-aware approach matrix for the roster, reused until a token moves, changes elevation or speed, or the
 * GM changes who ignores terrain. Measuring every pair's path is the slowest step on a busy map.
 */
let approachCache = { key: null, value: null };
export function approachFor(roster, setup) {
  const ignoreTerrainFor = new Set(Object.entries(setup.tokens ?? {}).filter(([, t]) => t?.ignoreTerrain).map(([id]) => id));
  const key = JSON.stringify([
    canvas.scene?.id,
    roster.map(e => [e.token.id, e.token.document._source.x, e.token.document._source.y, e.token.document.elevation, e.spec.speeds]),
    [...ignoreTerrainFor].sort()
  ]);
  if ( approachCache.key !== key ) {
    const specs = new Map(roster.map(e => [e.token.id, e.spec]));
    approachCache = { key, value: computeApproach(roster.map(e => e.token), specs, { ignoreTerrainFor }) };
  }
  return approachCache.value;
}

/**
 * The scene's closed doors, for the fight: where each is (its middle, in feet) and whether it's locked. A GM can give a
 * door its own numbers in the wall's flags (`fast-fighting.door`: ac, hp, forceDC, pickDC, and whatever the system's
 * door rules use, such as PF2e hardness); otherwise the system's typical door applies.
 */
function sceneDoors() {
  const { size } = canvas.dimensions;
  const feet = squareFeet();
  const out = {};
  for ( const w of canvas.scene.walls ) {
    if ( w.door !== CONST.WALL_DOOR_TYPES.DOOR || w.ds === CONST.WALL_DOOR_STATES.OPEN ) continue;
    const [x1, y1, x2, y2] = w.c;
    const own = w.getFlag?.(MODULE_ID, "door") ?? {};
    out[w.id] = { ...own, locked: w.ds === CONST.WALL_DOOR_STATES.LOCKED, x: ((x1 + x2) / 2 / size) * feet, y: ((y1 + y2) / 2 / size) * feet };
  }
  return out;
}

/** Walls and regions change the paths, so forget the cached matrix when they do. */
export function invalidateApproach() {
  approachCache = { key: null, value: null };
  resetPathGrid();
}

/**
 * Draw one of the simulated fights at random: the fair choice for Make it So. Every fight in the batch is
 * equally likely to be picked, so outcomes come up as often as the odds say.
 */
export function drawFight(spec, results) {
  if ( !results?.runs ) return null;
  const seed = deriveSeed(results.seed, Math.floor(Math.random() * results.runs));
  return { seed, result: replay(spec, getAdapter().rules, seed), how: "drawn" };
}

/** Sight and sound from each bystander to each starting combatant (and between bystanders). */
export function awarenessFor(roster) {
  const bystanders = roster.filter(e => !e.spec.inEncounter).map(e => e.token);
  if ( !bystanders.length ) return {};
  const darkvision = new Set(roster.filter(e => e.spec.darkvision).map(e => e.token.id));
  return computeAwareness(bystanders, roster.map(e => e.token), { darkvision });
}

/** Full pipeline used by the Battle Planner. */
export async function simulate(roster, setup, { onProgress, signal } = {}) {
  const adapter = getAdapter();
  const approach = setup.options.positioning ? approachFor(roster, setup) : null;
  // (Each character's calculated answers as they are now, whatever was written to its flags since the roster was read.)
  if ( game.user.isGM ) await Promise.all(roster.map(e => ensureAutoConfig(e.token?.actor, e.spec)));

  const spec = buildBattleSpec(roster, setup, { approach });
  spec.awareness = awarenessFor(roster);
  Hooks.callAll("fastFighting.preSimulate", spec, { setup, roster });
  const seed = setup.options.seed ?? undefined;
  // (As many fights as the GM asks for, or as fit the time for so many creatures: engine/run-budget.js.)
  const results = await runBatch(spec, adapter.rules, { runs: runsFor(setup.options.runs, spec.combatants.length, setting("hardware")), seed, onProgress, signal });
  Hooks.callAll("fastFighting.postSimulate", results, { setup, roster, spec });
  return { spec, results, approach };
}

/** The most combatants the swing factors leave out one at a time (in a bigger battle, the ones likeliest to matter). */
const SWING_COMBATANTS = 12;

/**
 * Swing factors: how much does the party's win chance move without each combatant, or with each modifier toggled? In a
 * big battle, only the SWING_COMBATANTS that weigh most (the highest level, then the toughest), each with as many fights
 * as fit the time (engine/run-budget.js).
 * @returns {Promise<{label: string, delta: number}[]>} sorted by impact
 */
export async function swingFactors(spec, baseline, { runs = null, onProgress } = {}) {
  const rules = getAdapter().rules;
  const friendlyWin = r => r.sides.friendly?.pWin ?? 0;
  const base = friendlyWin(baseline);
  const tests = [];
  const weightiest = [...spec.combatants]
    .sort((a, b) => (Number(b.level) || 0) - (Number(a.level) || 0) || (Number(b.hp?.max) || 0) - (Number(a.hp?.max) || 0))
    .slice(0, SWING_COMBATANTS);
  for ( const c of spec.combatants.filter(x => weightiest.includes(x)) ) {
    tests.push({ label: game.i18n.format("FASTFIGHTING.Swing.Without", { name: c.name }), id: c.id, side: c.side, make: s => ({ ...s, combatants: s.combatants.filter(x => x.id !== c.id) }) });
  }
  const toggles = [
    ["leadership", "FASTFIGHTING.Swing.NoLeadership"],
    ["morale", "FASTFIGHTING.Swing.NoMorale"],
    ["positioning", "FASTFIGHTING.Swing.NoPositioning"]
  ];
  for ( const [key, label] of toggles ) {
    if ( spec.options[key] ) tests.push({ label: game.i18n.localize(label), make: s => ({ ...s, options: { ...s.options, [key]: false } }) });
  }
  const out = [];
  const each = runs ?? swingRunsFor(spec.combatants.length, tests.length, { speed: setting("hardware") });
  for ( const [i, t] of tests.entries() ) {
    const r = await runBatch(t.make(spec), rules, { runs: each, seed: 99 });
    out.push({ label: t.label, side: t.side ?? null, id: t.id ?? null, delta: friendlyWin(r) - base });
    onProgress?.((i + 1) / tests.length);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export { replay };
