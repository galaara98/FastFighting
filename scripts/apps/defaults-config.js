/**
 * Settings submenu: default group personality for each side, with the same fudge controls as the planner.
 */
import { MODULE_ID, SIDES, TRAITS, traitBand, clamp, FUDGE_STEP } from "../constants.js";
import { DEFAULT_SIDE_TRAITS } from "../settings.js";

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
      traits: TRAITS.map(k => {
        const base = DEFAULT_SIDE_TRAITS[id][k];
        const value = clamp(this.#values[id]?.[k] ?? base, 0, 100);
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

  static #onFudge(event, target) {
    const { path, step, dir } = target.dataset;
    const [side, trait] = path.split(".");
    const base = DEFAULT_SIDE_TRAITS[side][trait];
    const current = this.#values[side]?.[trait] ?? base;
    this.#values[side] ??= {};
    this.#values[side][trait] = Number(dir) === 0 ? base : clamp(current + Number(dir) * Number(step), 0, 100);
    this.render();
  }

  static #onRestore() {
    this.#values = foundry.utils.deepClone(DEFAULT_SIDE_TRAITS);
    this.render();
  }

  static async #onSubmit() {
    await game.settings.set(MODULE_ID, "sideDefaults", this.#values);
  }
}
