/**
 * Public API, exposed as game.modules.get("fast-fighting").api and passed to the "fastFighting.init" hook.
 *
 * Helper modules for other systems:
 *
 *   Hooks.once("fastFighting.init", api => {
 *     class MySystemAdapter extends api.SystemAdapter { ... }
 *     api.registerAdapter("my-system", MySystemAdapter, { priority: 10 });
 *   });
 *
 * Other hooks fired by FastFighting:
 *   fastFighting.preSimulate (battleSpec, context)   mutate the spec before a batch runs
 *   fastFighting.postSimulate (results, context)      read or annotate results
 *   fastFighting.preMakeItSo (plan) / fastFighting.makeItSo (undoRecords)
 */
import { SystemAdapter } from "./adapters/adapter-base.js";
import * as engine from "./engine/simulator.js";
import * as dice from "./engine/dice.js";
import * as constants from "./constants.js";
import { MODULE_ID } from "./constants.js";
import { keywords, applyBiography } from "./foundry/keywords.js";
import { CORE_API_VERSION } from "./core-api.js";
import { adviseTranslation } from "./foundry/translation-advice.js";
import { keepEnglish } from "./foundry/keep-english.js";

const adapters = new Map(); // systemId -> [{cls, priority, source}]
const modifiers = [];
const traitRules = [];

export function registerAdapter(systemId, AdapterClass, { priority = 0, source = "unknown" } = {}) {
  if ( !(AdapterClass?.prototype instanceof SystemAdapter) ) {
    throw new Error("FastFighting | registerAdapter expects a subclass of api.SystemAdapter");
  }
  // A helper only counts for the system it was written for.
  if ( systemId !== "*" && globalThis.game?.system && systemId !== game.system.id ) {
    console.warn(`FastFighting | ignoring the "${systemId}" adapter from ${source}: this world uses "${game.system.id}".`);
    return false;
  }
  const list = adapters.get(systemId) ?? [];
  list.push({ cls: AdapterClass, priority, source });
  list.sort((a, b) => b.priority - a.priority);
  adapters.set(systemId, list);
  return true;
}

/** Is there an adapter written for this system (not just the generic fallback)? */
export function hasSystemAdapter(systemId = game.system.id) {
  return !!adapters.get(systemId)?.length;
}

/** The highest-priority adapter for a system, instantiated once. */
const instances = new Map();
export function getAdapter(systemId = game.system.id) {
  // The generic adapter is experimental: used only when the GM opts in and no helper exists.
  const generic = game.settings.get(MODULE_ID, "genericFallback") ? adapters.get("*")?.[0] : null;
  const best = adapters.get(systemId)?.[0] ?? generic;
  if ( !best ) return null;
  if ( !instances.has(best.cls) ) instances.set(best.cls, new best.cls());
  return instances.get(best.cls);
}

export function listAdapters() {
  return [...adapters.entries()].map(([id, list]) => ({ systemId: id, adapters: list.map(l => ({ name: l.cls.name, priority: l.priority, source: l.source })) }));
}

/**
 * A battle modifier transforms the BattleSpec just before simulation.
 * @param {{id: string, label: string, apply: (spec: object, context: object) => void}} modifier
 */
export function registerModifier(modifier) {
  modifiers.push(modifier);
}

export function getModifiers() {
  return [...modifiers];
}

/**
 * A trait rule adjusts derived personality for matching actors.
 * @param {{id: string, test: (actor: Actor, spec: object) => boolean, apply: (traits: object, spec: object) => void}} rule
 */
export function registerTraitRule(rule) {
  traitRules.push(rule);
}

export function applyTraitRules(actor, spec) {
  for ( const rule of traitRules ) {
    try {
      if ( rule.test(actor, spec) ) rule.apply(spec.traits, spec);
    } catch ( err ) {
      console.error(`FastFighting | trait rule ${rule.id} failed`, err);
    }
  }
}

/**
 * A character as FastFighting reads it, the same wherever it's read (the planner, its token's tab, a player's survey):
 * its system helper's spec, what its biography's words say of its traits, then the trait rules other modules add.
 * @returns {Promise<object|null>} the CombatantSpec
 */
export async function characterSpec(adapter, tokenDoc) {
  const spec = await adapter.toCombatantSpec(tokenDoc);
  if ( !spec ) return spec;
  const actor = tokenDoc?.actor ?? null;
  try {
    const words = await keywords();
    applyBiography(spec, actor ? adapter.biography?.(actor) ?? "" : "", words);
  } catch ( err ) {
    console.warn(`${MODULE_ID} | reading ${actor?.name ?? "a character"}'s biography failed`, err);
  }
  applyTraitRules(actor, spec);
  return spec;
}

export function buildApi(extra = {}) {
  return {
    version: CORE_API_VERSION,
    SystemAdapter,
    registerAdapter,
    getAdapter,
    listAdapters,
    registerModifier,
    registerTraitRule,
    engine,
    dice,
    constants,
    // (A helper names its system's last known translation module; its settings recommend it when it's missing.)
    adviseTranslation,
    // (A helper's hardcoded-toEN.json: words kept in English for now, while its system isn't translated.)
    keepEnglish,
    ...extra
  };
}
