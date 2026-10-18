/**
 * Speed Runner became DPS (temporary: remove at 0.7.0 with tests/temporary/speedrunner-to-dps.test.js). Once, on the
 * active GM's ready: every actor whose stored FastFighting playstyles still name `speedRunner` (its tactics' pills, and
 * the picks its auto setup kept), and every unlinked token's own, now names `dps`, each once. Quiet: a console line
 * with the count, no notification. Run again, it finds nothing to change. Wherever playstyles are read meanwhile, the
 * alias does the same (engine/playstyles.js RENAMED_PLAYSTYLES).
 * The planner's setups keep no playstyles (foundry/persistence.js): nothing there to change.
 */
import { MODULE_ID } from "../constants.js";
import { currentPlaystyles } from "../engine/playstyles.js";

/** The ids that are gone, by what they are now. */
const GONE = Object.freeze(["speedRunner"]);

/**
 * The update that brings one actor's (or token delta's) stored playstyles up to date, from its flags, or null where
 * nothing names a gone one. Pure.
 * @param {object} flags   the document's flags (actor.flags, or a token delta's)
 * @returns {object|null}  {"flags.fast-fighting.tactics.playstyles": [...], "flags.fast-fighting.auto.picked": [...]}
 */
export function playstyleFixes(flags) {
  const own = flags?.[MODULE_ID];
  if ( !own || typeof own !== "object" ) return null;
  const out = {};
  const fix = (list, path) => {
    if ( Array.isArray(list) && list.some(id => GONE.includes(id)) ) out[`flags.${MODULE_ID}.${path}`] = currentPlaystyles(list);
  };
  fix(own.tactics?.playstyles, "tactics.playstyles");
  fix(own.auto?.picked, "auto.picked");
  return Object.keys(out).length ? out : null;
}

/** On the active GM's ready: every actor, and every unlinked token's own, brought up to date. Returns how many. */
export async function migratePlaystyles() {
  if ( !game.user?.isActiveGM ) return 0;
  let count = 0;
  try {
    for ( const actor of game.actors ?? [] ) {
      const fix = playstyleFixes(actor.flags);
      if ( !fix ) continue;
      await actor.update(fix);
      count += 1;
    }
    for ( const scene of game.scenes ?? [] ) {
      for ( const token of scene.tokens ?? [] ) {
        if ( token.actorLink || !token.delta ) continue;
        const fix = playstyleFixes(token.delta.flags);
        if ( !fix ) continue;
        await token.delta.update(fix);
        count += 1;
      }
    }
  } catch ( err ) {
    console.warn(`${MODULE_ID} | bringing stored playstyles up to date`, err);
  }
  if ( count ) console.log(`${MODULE_ID} | Speed Runner is DPS now: ${count} characters' playstyles brought up to date`);
  return count;
}
