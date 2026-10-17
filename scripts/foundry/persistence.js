/**
 * Where battle setup lives:
 *  - The plan (per-battle options, side settings, per-token overrides, groups and fudges): a `fast-fighting.setup`
 *    flag on the encounter the planner is tied to (the Combat on the viewed scene), so each encounter has a plan of its
 *    own, kept until the encounter ends (it goes with the Combat). With no encounter on the scene, on the scene.
 *  - Actor flag `fast-fighting.tactics`: a character's tactics answers, carried between battles (foundry/tactics.js).
 *  - Scene flag `fast-fighting.undo`: the last Make it So undo records.
 */
import { MODULE_ID, SIDES, TRAITS, MAX_ROUNDS, clamp } from "../constants.js";
import { setting } from "../settings.js";
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
      bystanders: setting("bystanders"),
      surprise: setting("surpriseDefault"),
      includeHidden: setting("includeHidden"),
      includeOtherLevels: setting("includeOtherLevels"),
      playersRunPCs: setting("playersRunPCs"),
      applyPlayerDamage: setting("applyPlayerDamage")
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
 * The plan, as saved. An encounter with no plan of its own yet starts from its scene's (what the GM set up on the map
 * before the encounter began), else from the defaults: hostile tokens in one group, the GM splitting them.
 * @param {Document} [holder]   the encounter or the scene (planHolder)
 */
export function getSetup(holder = planHolder()) {
  const stored = holder?.getFlag(MODULE_ID, "setup") ?? holder?.scene?.getFlag?.(MODULE_ID, "setup") ?? {};
  const setup = foundry.utils.mergeObject(defaultSetup(), stored, { inplace: false });
  // (A plan saved before the most rounds went to 4 to 12 is held to them.)
  setup.options.maxRounds = clamp(Math.round(Number(setup.options.maxRounds) || MAX_ROUNDS.default), MAX_ROUNDS.min, MAX_ROUNDS.max);
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
}

export function tokenSetup(setup, tokenId) {
  setup.tokens[tokenId] ??= { include: true, side: null, fudge: { ...emptyFudge(), ac: 0, hp: 0, attack: 0, damage: 0 }, ignoreTerrain: false };
  setup.tokens[tokenId].fudge ??= { ...emptyFudge(), ac: 0, hp: 0, attack: 0, damage: 0 };
  return setup.tokens[tokenId];
}
