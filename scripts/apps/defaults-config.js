/**
 * Settings submenu: default group personality for each side, with the same fudge controls as the planner.
 */
import { MODULE_ID, SIDES, TRAITS, traitBand, clamp, FUDGE_STEP } from "../constants.js";
import { DEFAULT_SIDE_TRAITS } from "../settings.js";
import { withinBudget, traitTotal, TRAIT_BUDGET } from "../engine/trait-budget.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class DefaultsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fast-fighting-defaults",
    tag: "form",
    classes: ["fast-fighting", "ff-defaults"],
    window: { title: "FASTFIGHTING.Settings.sideDefaults.Name", icon: "fa-solid fa-people-group", contentClasses: ["standard-form"] },
    position: { width: 560 },
    form: { handler: DefaultsConfig.#onSubmit, closeOnSubmit: true },
    actions: { fudge: DefaultsConfig.#onFudge, restore: DefaultsConfig.#onRestore }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/defaults-config.hbs`, templates: [`modules/${MODULE_ID}/templates/partials/fudge.hbs`] },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  #values = null;

  async _prepareContext(options) {
    this.#values ??= foundry.utils.deepClone(game.settings.get(MODULE_ID, "sideDefaults"));
    const sides = Object.values(SIDES).map(id => ({
      id,
      label: game.i18n.localize(`FASTFIGHTING.Side.${id}`),
      budget: {
        text: game.i18n.format("FASTFIGHTING.Planner.TraitBudget", { total: Math.round(traitTotal(this.#kept(id))), budget: TRAIT_BUDGET }),
        hint: game.i18n.format("FASTFIGHTING.Planner.TraitBudgetHint", { budget: TRAIT_BUDGET })
      },
      traits: TRAITS.map(k => {
        const base = DEFAULT_SIDE_TRAITS[id][k];
        const value = this.#kept(id)[k];
        const fudge = value - base;
        return {
          label: game.i18n.localize(`FASTFIGHTING.Trait.${k}`), value, base, fudge, path: `${id}.${k}`, step: FUDGE_STEP.trait,
          band: game.i18n.localize(`FASTFIGHTING.Band.${traitBand(k, value)}`),
          fudgeLabel: fudge ? (fudge > 0 ? `+${fudge}` : `${fudge}`) : "",
          tooltip: `${game.i18n.localize(`FASTFIGHTING.Trait.${k}`)}: ${value}`
        };
      })
    }));
    return {
      sides,
      buttons: [
        { type: "button", action: "restore", icon: "fa-solid fa-rotate-left", label: "FASTFIGHTING.Defaults.Restore" },
        { type: "submit", icon: "fa-solid fa-floppy-disk", label: "SETTINGS.Save" }
      ]
    };
  }

  /** A side's four traits as set, within the trait budget (engine/trait-budget.js). */
  #kept(side) {
    return withinBudget(Object.fromEntries(TRAITS.map(k => [k, clamp(this.#values[side]?.[k] ?? DEFAULT_SIDE_TRAITS[side][k], 0, 100)])));
  }

  static #onFudge(event, target) {
    const { path, step, dir } = target.dataset;
    const [side, trait] = path.split(".");
    const base = DEFAULT_SIDE_TRAITS[side][trait];
    const was = this.#kept(side);
    const next = Number(dir) === 0 ? base : clamp(was[trait] + Number(dir) * Number(step), 0, 100);
    // (Raised past the trait budget: the highest of the others comes down.)
    this.#values[side] = withinBudget({ ...was, [trait]: next }, { raised: next > was[trait] ? trait : null });
    this.render();
  }

  static #onRestore() {
    this.#values = foundry.utils.deepClone(DEFAULT_SIDE_TRAITS);
    this.render();
  }

  static async #onSubmit() {
    await game.settings.set(MODULE_ID, "sideDefaults", Object.fromEntries(Object.values(SIDES).map(id => [id, this.#kept(id)])));
  }
}
