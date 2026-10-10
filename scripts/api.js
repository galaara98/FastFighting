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
 *   fastFighting.prepareReport (report, context)      edit the player chat card before it is sent
 *   fastFighting.preMakeItSo (plan) / fastFighting.makeItSo (undoRecords)
 */
import { SystemAdapter } from "./adapters/adapter-base.js";
import * as engine from "./engine/simulator.js";
import * as dice from "./engine/dice.js";
import * as constants from "./constants.js";

const adapters = new Map(); // systemId -> [{cls, priority, source}]
const modifiers = [];
const traitRules = [];

export function registerAdapter(systemId, AdapterClass, { priority = 0, source = "unknown" } = {}) {
  if ( !(AdapterClass?.prototype instanceof SystemAdapter) ) {
    throw new Error("FastFighting | registerAdapter expects a subclass of api.SystemAdapter");
  }
  const list = adapters.get(systemId) ?? [];
  list.push({ cls: AdapterClass, priority, source });
  list.sort((a, b) => b.priority - a.priority);
  adapters.set(systemId, list);
}

/** The highest-priority adapter for a system, instantiated once. */
const instances = new Map();
export function getAdapter(systemId = game.system.id) {
  const best = adapters.get(systemId)?.[0] ?? adapters.get("*")?.[0];
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

export function buildApi(extra = {}) {
  return {
    SystemAdapter,
    registerAdapter,
    getAdapter,
    listAdapters,
    registerModifier,
    registerTraitRule,
    engine,
    dice,
    constants,
    ...extra
  };
}
