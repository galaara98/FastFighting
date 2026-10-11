/**
 * Generic adapter: works with any system by reading GM-configured data paths (HP, AC, attack bonus, damage).
 * Used when no adapter is registered for the active system. A dedicated helper module will always do better.
 */
import { SystemAdapter } from "../adapter-base.js";
import { genericRules } from "./rules.js";
import { parseFormula } from "../../engine/dice.js";
import { MODULE_ID, STATUS } from "../../constants.js";

export const GENERIC_PATHS = {
  hp: "system.attributes.hp.value",
  hpMax: "system.attributes.hp.max",
  ac: "system.attributes.ac.value",
  attack: "",
  damage: "",
  level: "system.details.level.value",
  initiative: "",
  // (Noticing a fight, and telling who is hurt: without it, the initiative stands in, as it does in many systems.)
  perception: ""
};

function read(doc, path, fallback = null) {
  if ( !path ) return fallback;
  const v = foundry.utils.getProperty(doc, path);
  return v === undefined || v === null || v === "" ? fallback : v;
}

export class GenericAdapter extends SystemAdapter {
  static systemId = "*";

  get label() {
    return game.i18n.localize("FASTFIGHTING.Generic.Label");
  }

  get rules() {
    return genericRules;
  }

  get paths() {
    return { ...GENERIC_PATHS, ...(game.settings.get(MODULE_ID, "genericPaths") ?? {}) };
  }

  canHandle(actor) {
    return !!actor && Number.isFinite(Number(read(actor, this.paths.hpMax)));
  }

  async toCombatantSpec(tokenDoc) {
    const actor = tokenDoc.actor;
    const p = this.paths;
    const level = Number(read(actor, p.level, 1)) || 1;
    const hpMax = Number(read(actor, p.hpMax, 10)) || 10;
    const hp = Number(read(actor, p.hp, hpMax));
    const ac = Number(read(actor, p.ac, 10 + level));
    const bonus = Number(read(actor, p.attack, Math.ceil(level / 2) + 3));
    const damageFormula = String(read(actor, p.damage, `1d8+${Math.ceil(level / 2)}`));
    const derived = this.deriveTraits(actor);
    return {
      id: tokenDoc.id,
      tokenId: tokenDoc.id,
      actorId: actor.id,
      name: tokenDoc.name,
      img: tokenDoc.texture?.src ?? actor.img,
      kind: actor.hasPlayerOwner ? "pc" : "npc",
      level,
      hp: { value: hp, max: hpMax, temp: 0 },
      defenses: { ac }, // saves fall back to the rules' typical values
      initiative: { mod: Number(read(actor, p.initiative, 0)) || 0 },
      perception: Number(read(actor, p.perception, read(actor, p.initiative, 0))) || 0,
      speeds: { walk: 30 },
      actions: [{
        id: `${actor.id}.attack`, name: game.i18n.localize("FASTFIGHTING.Generic.Attack"), kind: "strike", cost: 1,
        bonus, melee: true, reach: 5, damage: [parseFormula(damageFormula, "untyped")]
      }],
      iwr: {},
      resources: {},
      social: {
        pitches: { persuade: { skill: "Persuasion", mod: Math.ceil(level / 2) + 2 }, intimidate: { skill: "Intimidation", mod: Math.ceil(level / 2) + 2 } },
        resist: { persuade: { dc: 10 + bonus, label: "DC" }, intimidate: { dc: 10 + bonus, label: "DC" }, deceive: { dc: 10 + bonus, label: "DC" } },
        languages: ["common"], mindless: false
      },
      traits: Object.fromEntries(Object.entries(derived.traits).map(([k, v]) => [k, { base: v, fudge: 0 }])),
      traitReasons: derived.reasons,
      flags: {},
      diesAtZero: !actor.hasPlayerOwner
    };
  }

  deriveTraits(actor) {
    const pc = actor.hasPlayerOwner;
    return {
      traits: { tactical: pc ? 65 : 45, brave: pc ? 75 : 55, selfish: pc ? 25 : 45, loyal: pc ? 80 : 50 },
      flags: {},
      reasons: { tactical: "Generic default", brave: "Generic default", selfish: "Generic default", loyal: "Generic default" }
    };
  }

  describeOutcome(spec, final) {
    const lines = [];
    if ( final.hp !== spec.hp.value ) lines.push(`HP ${spec.hp.value} → ${final.hp}`);
    if ( final.status === STATUS.DEAD ) lines.push("Dead");
    else if ( final.status === STATUS.FLED ) lines.push(spec.kind === "pc" ? "Retreated from the battle" : "Fled the battle (token hidden)");
    else if ( final.status === STATUS.SURRENDERED ) lines.push("Surrenders");
    else if ( final.status === STATUS.STOOD_DOWN ) lines.push("Stands down (talked out of fighting)");
    if ( final.swayed === "switched" ) lines.push("Switches sides");
    else if ( final.status === STATUS.DOWN ) lines.push("Down");
    return lines;
  }

  async commitOutcome(tokenDoc, spec, final, options = {}) {
    const actor = tokenDoc.actor;
    const path = this.paths.hp;
    const undo = { tokenUuid: tokenDoc.uuid, actorUuid: actor.uuid, actorUpdate: {}, statuses: [], createdItems: [], deletedItems: [], itemUpdates: [], createdActors: [], createdTokens: [], deletedTokens: [] };
    if ( path && final.hp !== spec.hp.value ) {
      undo.actorUpdate[path] = foundry.utils.getProperty(actor, path);
      await actor.update({ [path]: final.hp });
    }
    if ( final.status === STATUS.DEAD ) {
      await actor.toggleStatusEffect(CONFIG.specialStatusEffects.DEFEATED, { active: true, overlay: true });
      undo.statuses.push({ id: CONFIG.specialStatusEffects.DEFEATED, active: false, overlay: true });
    } else if ( final.status === STATUS.FLED && options.fledMode !== "leave" && spec.kind !== "pc" ) {
      undo.tokenUpdate = { hidden: tokenDoc.hidden };
      await tokenDoc.update({ hidden: true });
    }
    return undo;
  }
}
