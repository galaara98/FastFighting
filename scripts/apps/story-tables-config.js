/**
 * Settings submenu: install the story tables into this world as editable RollTables.
 */
import { MODULE_ID } from "../constants.js";
import { allStoryKeys, installStoryTables } from "../story/tables.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class StoryTablesConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fast-fighting-story-tables",
    classes: ["fast-fighting"],
    window: { title: "FASTFIGHTING.Story.TablesMenuName", icon: "fa-solid fa-table-list", contentClasses: ["standard-form"] },
    position: { width: 520 },
    actions: { install: StoryTablesConfig.#onInstall, reinstall: StoryTablesConfig.#onReinstall }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/story-tables.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  async _prepareContext() {
    const installed = game.tables.filter(t => t.getFlag(MODULE_ID, "storyKey")).length;
    return {
      total: (await allStoryKeys()).length,
      installed,
      buttons: [
        { type: "button", action: "reinstall", icon: "fa-solid fa-rotate", label: "FASTFIGHTING.Story.Reinstall" },
        { type: "button", action: "install", icon: "fa-solid fa-download", label: "FASTFIGHTING.Story.Install" }
      ]
    };
  }

  static async #onInstall() {
    ui.notifications.info(game.i18n.localize("FASTFIGHTING.Story.Installing"));
    const r = await installStoryTables();
    ui.notifications.info("FASTFIGHTING.Story.Installed", { format: r });
    this.render();
  }

  static async #onReinstall() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("FASTFIGHTING.Story.Reinstall") },
      content: `<p>${game.i18n.localize("FASTFIGHTING.Story.ReinstallConfirm")}</p>`
    });
    if ( !ok ) return;
    ui.notifications.info(game.i18n.localize("FASTFIGHTING.Story.Installing"));
    const r = await installStoryTables({ overwrite: true });
    ui.notifications.info("FASTFIGHTING.Story.Installed", { format: r });
    this.render();
  }
}
