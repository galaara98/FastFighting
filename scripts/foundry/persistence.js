/**
 * Where battle setup lives:
 *  - The plan (per-battle options, side settings, per-token overrides, groups and fudges): a `fast-fighting.setup`
 *    flag on the encounter the planner is tied to (the Combat on the viewed scene), so each encounter has a plan of its
 *    own, kept until the encounter ends (it goes with the Combat). With no encounter on the scene, on the scene.
 *  - Actor flag `fast-fighting.tactics`: a character's tactics answers, carried between battles (foundry/tactics.js).
 */
import { MODULE_ID, SIDES, TRAITS, clamp } from "../constants.js";
import { setting, roundsRange } from "../settings.js";
import { PREDICTION_SECONDS } from "../engine/run-budget.js";
import { rememberRole } from "./command-pick.js";

const emptyFudge = () => Object.fromEntries(TRAITS.map(k => [k, 0]));

export function defaultSideSetup(side) {
  return {
    traitFudge: emptyFudge(),
    healAggro: side === SIDES.FRIENDLY ? setting("pcHealAggro") : "balanced",
    morale: true,
    leaderId: "auto",
    leadershipFudge: { brave: 0, tacticalFloor: 0, attack: 0, ac: 0 },
    allegiance: side === SIDES.NEUTRAL ? setting("neutralDefault") : null
  };
}

export function defaultSetup() {
  return {
    options: {
      seconds: setting("predictionTime"),
      maxRounds: setting("maxRounds"),
      seed: null,
      downedModel: setting("downedModel"),
      aftermath: setting("aftermath"),
      positioning: setting("positioning"),
      morale: setting("morale"),
      leadership: setting("leadership"),
      talking: setting("talking"),
      ignoreLanguages: setting("ignoreLanguages"),
      opening: setting("opening"),
      standoffNoncombat: setting("standoffNoncombat"),
      bystanders: setting("bystanders"),
      surprise: setting("surpriseDefault"),
      includeHidden: setting("includeHidden"),
      includeOtherLevels: setting("includeOtherLevels"),
      playersRunPCs: setting("playersRunPCs"),
      applyPlayerDamage: setting("applyPlayerDamage"),
      // (The teams' purses, the GM's, in the system's main coin, by group key: foundry/battle.js PURSE_TEAMS.)
      purses: {}
    },
    sides: Object.fromEntries(Object.values(SIDES).map(s => [s, defaultSideSetup(s)])),
    tokens: {}
  };
}

/** The encounter for the viewed scene: the combat tracker's viewed combat, else any combat on this scene. */
export function sceneEncounter(scene = canvas.scene) {
  const viewed = ui.combat?.viewed;
  if ( viewed && (!viewed.scene || viewed.scene.id === scene?.id) ) return viewed;
  return game.combats.find(c => c.scene?.id === scene?.id) ?? null;
}

/**
 * An encounter's number, as the Combat Tracker numbers the scene's encounters, when the scene has more than one:
 * {n, count}, else null.
 */
export function encounterNumber(combat) {
  const all = game.combats?.combats ?? [];
  const n = combat ? all.findIndex(c => c.uuid === combat.uuid) + 1 : 0;
  return n && all.length > 1 ? { n, count: all.length } : null;
}

/** What holds the plan: the scene's encounter (its own plan, until it ends), else the scene. */
export const planHolder = (scene = canvas.scene) => sceneEncounter(scene) ?? scene ?? null;

/**
 * Is a plan kept on a scene not to be read? A scene's flags are any of its owners' to write, and a plan sets the
 * battle's options (players' damage applied at once, fudges): one on a scene a player owns is read only as a GM saved
 * it, its signature (planSignature) noted on a GM's own user, where no player can write. "player", or null (it's read).
 * (An encounter's plan is a GM's alone: a player may change only a combat's turn.) Pure: the scene's facts (sceneFacts).
 * @param {{playerOwned: boolean, signed: boolean}} facts
 */
export const planDistrust = ({ playerOwned, signed } = {}) => (playerOwned && !signed ? "player" : null);

/**
 * A plan's signature: a hash of it as it's kept, its keys in order, so the same plan read back signs the same. Pure.
 * (Not secret, and needn't be: a player can read it, but not make another plan that signs the same.)
 */
export function planSignature(plan) {
  const sorted = v => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v);
  const text = JSON.stringify(sorted(plan ?? null)) ?? "";
  // (cyrb53: 53 bits.)
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for ( let i = 0; i < text.length; i++ ) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** What planDistrust asks of a scene and its plan: does a player own the scene, and did a GM sign the plan as it is? */
function sceneFacts(scene, plan) {
  const signature = planSignature(plan);
  return {
    playerOwned: !!game.users?.some?.(u => !u.isGM && !!scene.testUserPermission?.(u, "OWNER")),
    signed: !!game.users?.some?.(u => u.isGM && u.getFlag?.(MODULE_ID, "scenePlans")?.[scene.id] === signature)
  };
}

/** The plan a document keeps: an encounter's, or a scene's while it's to be read (planDistrust); else null. */
function keptPlan(doc) {
  const plan = doc?.getFlag?.(MODULE_ID, "setup") ?? null;
  if ( !plan || doc.documentName !== "Scene" || !planDistrust(sceneFacts(doc, plan)) ) return plan;
  console.warn(`${MODULE_ID} | ${doc.name}: its plan wasn't saved by a GM as it is now, on a scene a player owns, and isn't read`);
  return null;
}

/**
 * The plan, as saved. An encounter with no plan of its own yet starts from its scene's (what the GM set up on the map
 * before the encounter began), else from the defaults: hostile tokens in one group, the GM splitting them.
 * @param {Document} [holder]   the encounter or the scene (planHolder)
 */
export function getSetup(holder = planHolder()) {
  const stored = keptPlan(holder) ?? keptPlan(holder?.scene) ?? {};
  const setup = foundry.utils.mergeObject(defaultSetup(), stored, { inplace: false });
  // (A plan's most rounds held to the system's range: roundsRange.)
  const rounds = roundsRange();
  setup.options.maxRounds = clamp(Math.round(Number(setup.options.maxRounds) || rounds.default), rounds.min, rounds.max);
  // (And one saved before the prediction's time went to 6 to 60 seconds, to them.)
  setup.options.seconds = clamp(Math.round(Number(setup.options.seconds) || setting("predictionTime")), PREDICTION_SECONDS.min, PREDICTION_SECONDS.max);
  return setup;
}

/**
 * Keep the GM's pick for a party member's role for the party's next fights (by actor): the partyCommand setting.
 * @param {string} actorId
 * @param {string|null} role   the token's role now ("none" or null: none)
 */
export async function rememberPartyRole(actorId, role) {
  if ( !actorId || !game.user.isGM ) return;
  await game.settings.set(MODULE_ID, "partyCommand", rememberRole(setting("partyCommand") ?? {}, actorId, role));
}

/** Clear the plan: back to the defaults (an encounter's clears to the defaults, not to its scene's plan). */
export async function clearSetup(holder = planHolder()) {
  if ( !holder || !game.user.isGM ) return;
  await holder.update({ [`flags.${MODULE_ID}.==setup`]: {} }, { render: false });
}

export async function saveSetup(setup, holder = planHolder()) {
  if ( !holder || !game.user.isGM ) return;
  await holder.update({ [`flags.${MODULE_ID}.==setup`]: setup }, { render: false });
  // (A scene's: signed, on this GM's own user, as it's kept: read back, on a scene a player owns, only as it was saved.)
  if ( holder.documentName === "Scene" ) await game.user.update?.({ [`flags.${MODULE_ID}.scenePlans.${holder.id}`]: planSignature(holder.getFlag(MODULE_ID, "setup")) });
}

export function tokenSetup(setup, tokenId) {
  setup.tokens[tokenId] ??= { include: true, side: null, fudge: { ...emptyFudge(), ac: 0, hp: 0, attack: 0, damage: 0 }, ignoreTerrain: false };
  setup.tokens[tokenId].fudge ??= { ...emptyFudge(), ac: 0, hp: 0, attack: 0, damage: 0 };
  return setup.tokens[tokenId];
}
