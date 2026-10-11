/**
 * Where battle setup lives:
 *  - Scene flag `fast-fighting.setup`: per-battle options, side settings, per-token overrides and fudges.
 *  - Actor flag `fast-fighting.tactics`: a character's tactics answers, carried between battles (foundry/tactics.js).
 *  - Scene flag `fast-fighting.undo`: the last Make it So undo records.
 */
import { MODULE_ID, SIDES, TRAITS } from "../constants.js";
import { setting } from "../settings.js";

const emptyFudge = () => Object.fromEntries(TRAITS.map(k => [k, 0]));

export function defaultSideSetup(side) {
  return {
    traitFudge: emptyFudge(),
    healAggro: side === SIDES.FRIENDLY ? setting("pcHealAggro") : "balanced",
    morale: true,
    leaderId: "auto",
    leadershipFudge: { brave: 0, tacticalFloor: 0, attack: 0, ac: 0 },
    allegiance: side === SIDES.NEUTRAL ? setting("neutralDefault") : side === SIDES.SECRET ? setting("secretDefault") : null
  };
}

export function defaultSetup() {
  return {
    options: {
      runs: setting("runs"),
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
      includeOtherLevels: setting("includeOtherLevels")
    },
    sides: Object.fromEntries(Object.values(SIDES).map(s => [s, defaultSideSetup(s)])),
    tokens: {}
  };
}

export function getSetup(scene = canvas.scene) {
  const stored = scene?.getFlag(MODULE_ID, "setup") ?? {};
  return foundry.utils.mergeObject(defaultSetup(), stored, { inplace: false });
}

export async function saveSetup(setup, scene = canvas.scene) {
  if ( !scene || !game.user.isGM ) return;
  await scene.update({ [`flags.${MODULE_ID}.==setup`]: setup }, { render: false });
}

export function tokenSetup(setup, tokenId) {
  setup.tokens[tokenId] ??= { include: true, side: null, fudge: { ...emptyFudge(), ac: 0, hp: 0, attack: 0, damage: 0 }, ignoreTerrain: false };
  setup.tokens[tokenId].fudge ??= { ...emptyFudge(), ac: 0, hp: 0, attack: 0, damage: 0 };
  return setup.tokens[tokenId];
}
