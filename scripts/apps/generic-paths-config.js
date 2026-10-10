/**
 * Settings submenu for the generic adapter's actor data paths.
 */
import { MODULE_ID } from "../constants.js";
import { GENERIC_PATHS } from "../adapters/generic/index.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class GenericPathsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fast-fighting-generic-paths",
    tag: "form",
    classes: ["fast-fighting"],
    window: { title: "FASTFIGHTING.Generic.MenuName", icon: "fa-solid fa-route", contentClasses: ["standard-form"] },
    position: { width: 520 },
    form: { handler: GenericPathsConfig.#onSubmit, closeOnSubmit: true }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/generic-paths.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  async _prepareContext() {
    const stored = game.settings.get(MODULE_ID, "genericPaths") ?? {};
    return {
      fields: Object.entries(GENERIC_PATHS).map(([key, fallback]) => ({
        key, value: stored[key] ?? fallback, placeholder: fallback,
        label: game.i18n.localize(`FASTFIGHTING.Generic.Path.${key}`)
      })),
      buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "SETTINGS.Save" }]
    };
  }

  static async #onSubmit(event, form, formData) {
    await game.settings.set(MODULE_ID, "genericPaths", formData.object);
  }
}
