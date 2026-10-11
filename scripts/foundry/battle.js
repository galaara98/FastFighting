/**
 * Turns the tokens on the viewed scene plus the GM's setup into a BattleSpec, runs it, and digs into the results.
 */
import { MODULE_ID, SIDES, ALLEGIANCE, DISPOSITION_SIDES, NEUTRAL_PARTY, TRAITS, clamp } from "../constants.js";
import { runBatch, runBatchSync, replay, findSample } from "../engine/simulator.js";
import { deriveSeed } from "../engine/rng.js";
import { applyTraitRules, getAdapter, getModifiers } from "../api.js";
import { computeApproach, computeAwareness, environmentAt, positionOf, squareFeet } from "./terrain.js";
import { resetPathGrid } from "./pathing.js";
import { tokenSetup } from "./persistence.js";
import { tacticsFor, isPlayerControlled, statedDesires } from "./tactics.js";
import { setting } from "../settings.js";

const SIDE_LABELS = {
  [SIDES.FRIENDLY]: "FASTFIGHTING.Side.friendly",
  [SIDES.HOSTILE]: "FASTFIGHTING.Side.hostile",
  [SIDES.NEUTRAL]: "FASTFIGHTING.Side.neutral",
  [SIDES.SECRET]: "FASTFIGHTING.Side.secret",
  [NEUTRAL_PARTY]: "FASTFIGHTING.Side.neutralParty"
};

/** Neutral tokens take no side in the fight: these allegiances are only the way they lean (behavior/neutral.js). */
const LEANS = new Set([ALLEGIANCE.NEUTRAL, ALLEGIANCE.FRIENDLY, ALLEGIANCE.HOSTILE, ALLEGIANCE.CLOSEST, ALLEGIANCE.UNDERDOG]);

/**
 * Read every eligible token on the viewed scene.
 * @returns {Promise<{token: Token, spec: object, baseSide: string}[]>}
 */
/** The encounter for the viewed scene: the combat tracker's viewed combat, else any combat on this scene. */
export function sceneEncounter(scene = canvas.scene) {
  const viewed = ui.combat?.viewed;
  if ( viewed && (!viewed.scene || viewed.scene.id === scene?.id) ) return viewed;
  return game.combats.find(c => c.scene?.id === scene?.id) ?? null;
}

/** Token ids of the encounter's combatants on this scene. */
export function encounterTokenIds(scene = canvas.scene) {
  const combat = sceneEncounter(scene);
  if ( !combat ) return new Set();
  return new Set(combat.combatants.filter(c => c.tokenId && (!c.sceneId || c.sceneId === scene?.id)).map(c => c.tokenId));
}

export async function gatherRoster(setup, adapter = getAdapter()) {
  if ( !canvas.ready || !adapter ) return [];
  const levelId = canvas.level?.id ?? null;
  const inEncounter = encounterTokenIds();
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
      const spec = await adapter.toCombatantSpec(token.document);
      if ( !spec ) continue;
      applyTraitRules(token.actor, spec);
      spec.environment = environmentAt(token);
      spec.hidden = token.document.hidden;
      spec.inEncounter = inEncounter.has(token.id);
      spec.position = positionOf(token);
      spec.perception ??= spec.initiative?.mod ?? 0;
      out.push({ token, spec, baseSide: DISPOSITION_SIDES[token.document.disposition] ?? SIDES.HOSTILE });
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

function averageDistance(a, list) {
  if ( !list.length ) return Infinity;
  return list.reduce((s, b) => s + canvas.grid.measurePath([a.token.center, b.token.center]).distance, 0) / list.length;
}

/**
 * Decide where Neutral and Secret tokens end up.
 * @returns {Record<string, string|null>} tokenId -> resolved side id (null = excluded)
 */
export function resolveAllegiances(roster, setup, underdog = null) {
  const resolved = {};
  const included = roster.filter(e => setup.tokens[e.token.id]?.include !== false);
  const friendly = included.filter(e => chosenSide(e, setup) === SIDES.FRIENDLY);
  const hostile = included.filter(e => chosenSide(e, setup) === SIDES.HOSTILE);
  for ( const e of included ) {
    const side = chosenSide(e, setup);
    const explicit = setup.tokens[e.token.id]?.side;
    if ( side === SIDES.FRIENDLY || side === SIDES.HOSTILE || (explicit && ![SIDES.NEUTRAL, SIDES.SECRET].includes(side)) ) {
      resolved[e.token.id] = side;
      continue;
    }
    const allegiance = setup.sides[side]?.allegiance ?? ALLEGIANCE.EXCLUDE;
    // Neutrals stand on the field taking no side, leaning the way their allegiance says (and a Secret token told to
    // take no side does the same, leaning nowhere).
    if ( (side === SIDES.NEUTRAL && LEANS.has(allegiance)) || allegiance === ALLEGIANCE.NEUTRAL ) {
      resolved[e.token.id] = NEUTRAL_PARTY;
      continue;
    }
    switch ( allegiance ) {
      case ALLEGIANCE.EXCLUDE: resolved[e.token.id] = null; break;
      case ALLEGIANCE.FRIENDLY: resolved[e.token.id] = SIDES.FRIENDLY; break;
      case ALLEGIANCE.HOSTILE: resolved[e.token.id] = SIDES.HOSTILE; break;
      case ALLEGIANCE.CLOSEST:
        resolved[e.token.id] = averageDistance(e, friendly) <= averageDistance(e, hostile) ? SIDES.FRIENDLY : SIDES.HOSTILE;
        break;
      case ALLEGIANCE.UNDERDOG: resolved[e.token.id] = underdog ?? SIDES.FRIENDLY; break;
      case ALLEGIANCE.OWN: resolved[e.token.id] = side; break;
      default: resolved[e.token.id] = null;
    }
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
  const friendly = included.filter(e => chosenSide(e, setup) === SIDES.FRIENDLY);
  const hostile = included.filter(e => chosenSide(e, setup) === SIDES.HOSTILE);
  for ( const e of included ) {
    const side = chosenSide(e, setup);
    if ( side !== SIDES.NEUTRAL ) continue;
    const allegiance = setup.sides[side]?.allegiance;
    leans[e.token.id] = {
      [ALLEGIANCE.FRIENDLY]: SIDES.FRIENDLY,
      [ALLEGIANCE.HOSTILE]: SIDES.HOSTILE,
      [ALLEGIANCE.UNDERDOG]: "underdog",
      [ALLEGIANCE.CLOSEST]: averageDistance(e, friendly) <= averageDistance(e, hostile) ? SIDES.FRIENDLY : SIDES.HOSTILE
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
 *  - NPCs: only what their playstyles imply; everything else stays personality-driven.
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
  spec.alwaysTalk = !!stored.alwaysTalk; // "always prefers talking to fighting"
  spec.desires = statedDesires(stored); // what the GM or player says it wants, at whom, how badly
  spec.avoidConsumables = !!stored.avoidConsumables; // "I don't like to use consumables"
  spec.avoidCostlySpells = !!stored.avoidCostlySpells; // "I don't like to use spells that cost something"
  spec.neverKill = !!stored.neverKill; // "I never kill": knocks out, never finishes the fallen, spares them after
  for ( const [k, v] of Object.entries(playstyles.traits) ) {
    if ( spec.traits[k] ) spec.traits[k] = { ...spec.traits[k], fudge: (spec.traits[k].fudge ?? 0) + v };
  }
  // Questions left to "Let them decide" where the pills disagree: each fight draws one pill's answer, by its place.
  const mixFor = keys => {
    const out = Object.fromEntries(Object.entries(playstyles.mix ?? {}).filter(([k]) => keys.includes(k)));
    return Object.keys(out).length ? out : null;
  };
  if ( isPlayerControlled(entry.spec, actor) ) {
    spec.tactics = resolved;
    spec.tacticsCalc = calc;
    spec.tacticsMix = mixFor(Object.keys(playstyles.mix ?? {}).filter(k => [undefined, null, "", "auto"].includes(stored[k])));
  } else if ( Object.keys(playstyles.suggest).length ) {
    spec.tactics = { ...playstyles.suggest };
    spec.tacticsCalc = Object.fromEntries(Object.keys(playstyles.suggest).map(k => [k, calc[k]]));
    spec.tacticsMix = mixFor(Object.keys(playstyles.mix ?? {}));
  }
  if ( spec.tactics ) {
    spec.disposition = { healAggro: spec.tactics.healAggro, allyDying: spec.tactics.allyDying, selfRevived: spec.tactics.selfRevived };
  }
}

/** Leader playstyles put a character forward as their side's leader. */
export function withPlaystyleLeaders(leaders, members) {
  const out = leaders.map(l => ({ ...l }));
  for ( const m of members ) {
    if ( !m.behavior?.leads ) continue;
    const existing = out.find(l => l.id === m.id);
    const reason = game.i18n.localize("FASTFIGHTING.Playstyle.leader.Name");
    if ( existing ) {
      existing.score += 5;
      existing.reason = `${existing.reason}; ${reason}`;
    } else {
      out.push({ id: m.id, score: 3, reason, bonus: { brave: 10, tacticalFloor: 40, attack: 0, ac: 0 } });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Build the BattleSpec the engine runs.
 * @param {object[]} roster      From gatherRoster
 * @param {object} setup         Scene setup
 * @param {object} [extra]       {underdog, approach, exclude: Set<tokenId>, optionOverrides}
 */
export function buildBattleSpec(roster, setup, { underdog = null, approach = null, exclude = new Set(), optionOverrides = {} } = {}) {
  const adapter = getAdapter();
  const sideDefaults = setting("sideDefaults");
  const resolved = resolveAllegiances(roster, setup, underdog);
  const leans = resolveLeans(roster, setup);
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
    spec.traits = fudgedTraits(e.spec, ts.fudge);
    applyCharacterTactics(spec, e);
    if ( ts.diesAtZero !== undefined ) spec.diesAtZero = ts.diesAtZero;
    combatants.push(spec);
    (bySide[side] ??= []).push(spec);
  }
  // Companions: map the master actor to the master's token on this battlefield.
  for ( const c of combatants ) {
    const masterActorId = c.flags?.masterActorId;
    if ( masterActorId ) c.flags.masterId = combatants.find(o => o.actorId === masterActorId)?.id ?? null;
  }

  const options = { ...setup.options, ...optionOverrides };
  const sides = {};
  const used = Object.keys(bySide);
  const fighting = used.filter(s => s !== NEUTRAL_PARTY); // (those who take no side are nobody's enemy, as a side)
  for ( const side of used ) {
    const neutral = side === NEUTRAL_PARTY;
    const s = (neutral ? setup.sides[SIDES.NEUTRAL] : setup.sides[side]) ?? {};
    const defaults = sideDefaults[neutral ? SIDES.NEUTRAL : side] ?? sideDefaults.hostile;
    let enemies;
    if ( neutral ) enemies = [];
    else if ( side === SIDES.FRIENDLY ) enemies = fighting.filter(o => o !== SIDES.FRIENDLY);
    else if ( side === SIDES.HOSTILE ) enemies = fighting.filter(o => o !== SIDES.HOSTILE);
    else enemies = fighting.filter(o => o !== side); // third parties fight everyone
    const leaders = withPlaystyleLeaders(adapter?.detectLeaders(bySide[side]) ?? [], bySide[side]);
    const leader = s.leaderId === "auto" ? leaders[0] : leaders.find(l => l.id === s.leaderId) ?? (s.leaderId && s.leaderId !== "none" ? { id: s.leaderId, bonus: { brave: 10, tacticalFloor: 40, attack: 0, ac: 0 } } : null);
    const lf = s.leadershipFudge ?? {};
    sides[side] = {
      label: game.i18n.localize(SIDE_LABELS[side] ?? side),
      enemies,
      traits: Object.fromEntries(TRAITS.map(k => [k, { base: defaults[k] ?? 50, fudge: s.traitFudge?.[k] ?? 0 }])),
      leaderId: neutral || s.leaderId === "none" ? null : leader?.id ?? null,
      leadership: leader ? {
        brave: { base: leader.bonus.brave, fudge: lf.brave ?? 0 },
        tacticalFloor: { base: leader.bonus.tacticalFloor, fudge: lf.tacticalFloor ?? 0 },
        attack: { base: leader.bonus.attack, fudge: lf.attack ?? 0 },
        ac: { base: leader.bonus.ac, fudge: lf.ac ?? 0 }
      } : {},
      healAggro: s.healAggro ?? "balanced",
      morale: s.morale !== false
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
    stealthSides = used.filter(s => s === SIDES.SECRET || combatants.some(c => c.side === s && c.hidden));
  } else if ( used.includes(options.surprise) ) {
    surpriseSide = options.surprise;
  }

  const spec = {
    combatants,
    sides,
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
      talking: options.talking !== false,
      opening: options.opening ?? "auto",
      // The luck checks that protect player characters (world settings, as sliders).
      concedeLuck: setting("concedeLuck"),
      theftLuck: setting("theftLuck"),
      executeLuck: setting("executeLuck"),
      // And the one that keeps enemies from changing sides too easily.
      switchLuck: setting("switchLuck"),
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

  // Secret tokens joining the underdog need a quick estimate without them. (Neutrals only lean toward the underdog,
  // and that's worked out as the fight goes.)
  let underdog = null;
  const needsUnderdog = setup.sides[SIDES.SECRET]?.allegiance === ALLEGIANCE.UNDERDOG;
  if ( needsUnderdog ) {
    const probeSetup = foundry.utils.deepClone(setup);
    probeSetup.sides[SIDES.SECRET].allegiance = ALLEGIANCE.EXCLUDE;
    const probe = runBatchSync(buildBattleSpec(roster, probeSetup, { approach }), adapter.rules, { runs: 200, seed: 7 });
    underdog = (probe.sides.friendly?.pWin ?? 0) < (probe.sides.hostile?.pWin ?? 0) ? SIDES.FRIENDLY : SIDES.HOSTILE;
  }

  const spec = buildBattleSpec(roster, setup, { underdog, approach });
  spec.awareness = awarenessFor(roster);
  Hooks.callAll("fastFighting.preSimulate", spec, { setup, roster });
  const seed = setup.options.seed ?? undefined;
  const results = await runBatch(spec, adapter.rules, { runs: setup.options.runs, seed, onProgress, signal });
  results.crossCheck = adapter.difficultyCrossCheck?.(
    spec.combatants.filter(c => c.side === SIDES.FRIENDLY),
    spec.combatants.filter(c => c.side !== SIDES.FRIENDLY && c.side !== NEUTRAL_PARTY)
  ) ?? null;
  results.underdog = underdog;
  Hooks.callAll("fastFighting.postSimulate", results, { setup, roster, spec });
  return { spec, results, approach };
}

/**
 * Swing factors: how much does the party's win chance move without each combatant, or with each modifier toggled?
 * @returns {Promise<{label: string, delta: number}[]>} sorted by impact
 */
export async function swingFactors(spec, baseline, { runs = 300, onProgress } = {}) {
  const rules = getAdapter().rules;
  const friendlyWin = r => r.sides.friendly?.pWin ?? 0;
  const base = friendlyWin(baseline);
  const tests = [];
  for ( const c of spec.combatants ) {
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
  for ( const [i, t] of tests.entries() ) {
    const r = runBatchSync(t.make(spec), rules, { runs, seed: 99 });
    out.push({ label: t.label, side: t.side ?? null, id: t.id ?? null, delta: friendlyWin(r) - base });
    onProgress?.((i + 1) / tests.length);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export { replay, findSample };
