/**
 * Settings submenu (GMs only): the journals live battles are kept in (foundry/live-journals.js), each battle's
 * transcript, the planner's last run while troubleshooting, and any older store; exported to a file for a bug report,
 * and cleaned up once they're more than a month old (foundry/live-store.js whatGoes).
 */
import { MODULE_ID } from "../constants.js";
import { localize, listJoin, escapeHtml as escape } from "../i18n.js";
import { journalFacts, combatsHere, worldFacts, deleteJournals } from "../foundry/live-journals.js";
import { KEEP_DAYS, lastKept, sizeOf, whatGoes, exportData, exportFileName } from "../foundry/live-store.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const loc = (key, data) => localize(key, data);
/** A time as the GM reads it, or a dash for none. */
const when = t => (t ? new Date(t).toLocaleString(game.i18n.lang) : "—");
/** A size in bytes, as Foundry shows one. */
const bytes = n => foundry.utils.formatFileSize(n, { decimalPlaces: 1 });

export class LiveDataConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fast-fighting-live-data",
    classes: ["fast-fighting", "ff-live-data"],
    window: { title: "FASTFIGHTING.LiveData.MenuName", icon: "fa-solid fa-box-archive", contentClasses: ["standard-form"], resizable: true },
    position: { width: 760 },
    actions: { exportOne: LiveDataConfig.#onExportOne, exportAll: LiveDataConfig.#onExportAll, cleanUp: LiveDataConfig.#onCleanUp }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/live-data.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  async _prepareContext() {
    const facts = journalFacts();
    const here = combatsHere();
    const rows = facts.map(j => ({ j, size: sizeOf(j.flags) }));
    const total = rows.reduce((sum, r) => sum + r.size, 0);
    // (Trusted transcripts and the planner's last run; everything else below, with why it's there.)
    const shown = ({ j }) => j.trusted && (j.kind === "transcript" || j.kind === "plan");
    return {
      total: loc("FASTFIGHTING.LiveData.Total", { n: facts.length, size: bytes(total), days: KEEP_DAYS }),
      transcripts: rows.filter(shown).sort((a, b) => lastKept(b.j) - lastKept(a.j)).map(({ j, size }) => ({
        id: j.id, name: j.name, combat: combatOf(j, here), state: stateOf(j), kept: when(lastKept(j)), size: bytes(size)
      })),
      others: rows.filter(r => !shown(r)).map(({ j, size }) => ({
        id: j.id, name: j.name, owner: game.users.get(j.createdBy)?.name ?? j.createdBy ?? "—", created: when(j.createdTime),
        modified: when(j.modifiedTime), why: loc(`FASTFIGHTING.LiveData.Why.${whyOf(j)}`), size: bytes(size)
      })),
      buttons: [
        { type: "button", action: "cleanUp", icon: "fa-solid fa-broom", label: "FASTFIGHTING.LiveData.CleanUp" },
        { type: "button", action: "exportAll", icon: "fa-solid fa-file-export", label: "FASTFIGHTING.LiveData.ExportAll", disabled: !facts.length }
      ]
    };
  }

  /** Export every journal to one file. */
  static #onExportAll() {
    download(journalFacts());
  }

  /** Export one journal, from its row. */
  static #onExportOne(event, target) {
    const j = journalFacts().find(f => f.id === target.dataset.id);
    if ( j ) download([j], j.name);
  }

  /**
   * Clean up: what's more than a month old shown first (and what's held back, why), then, if the GM says so, deleted
   * and reported.
   */
  static async #onCleanUp() {
    const plan = () => whatGoes("cleanup", journalFacts(), { now: Date.now(), combatIds: combatsHere() });
    const { remove, keep } = plan();
    if ( !remove.length ) {
      ui.notifications.info(keep.length ? "FASTFIGHTING.LiveData.NothingOldHeld" : "FASTFIGHTING.LiveData.NothingOld", { format: { n: keep.length, days: KEEP_DAYS } });
      return;
    }
    const item = j => `<li>${escape(j.name)} <span class="hint">${escape(when(lastKept(j)))}</span></li>`;
    const held = keep.length ? `<p>${escape(loc("FASTFIGHTING.LiveData.Held", { n: keep.length }))}</p>
      <ul>${keep.map(j => `<li>${escape(j.name)}: ${escape(loc(`FASTFIGHTING.LiveData.Why.${j.why}`))}</li>`).join("")}</ul>` : "";
    const ok = await DialogV2.confirm({
      window: { title: loc("FASTFIGHTING.LiveData.CleanUp") },
      content: `<p>${escape(loc("FASTFIGHTING.LiveData.WillRemove", { n: remove.length, days: KEEP_DAYS }))}</p><ul>${remove.map(item).join("")}</ul>${held}`
    });
    if ( !ok ) return;
    // (As things stand now: one kept again while the GM read, or begun on again, stays.)
    const still = new Set(plan().remove.map(j => j.id));
    const names = new Map(remove.map(j => [j.id, j.name]));
    const gone = await deleteJournals(remove.map(j => j.id).filter(id => still.has(id)));
    ui.notifications.info("FASTFIGHTING.LiveData.Removed", { format: { n: gone.length, names: listJoin(gone.map(id => names.get(id))) } });
    this.render();
  }
}

/** A transcript's combat (the scene and the tracker's number, while it's there; else its id), or the planner's scene. */
function combatOf(j, here) {
  if ( j.kind === "plan" ) {
    const scene = j.flags.scene?.name ?? j.flags.scene?.id ?? "—";
    return j.flags.encounter ? loc("FASTFIGHTING.LiveData.CombatHere", { scene, n: j.flags.encounter.n ?? 1 }) : scene;
  }
  const id = j.flags.liveBattle;
  if ( !here.has(id) ) return loc("FASTFIGHTING.LiveData.CombatGone", { id });
  // (Its number as its name has it: the tracker's, when it began.)
  return loc("FASTFIGHTING.LiveData.CombatHere", { scene: game.combats.get(id)?.scene?.name ?? id, n: j.flags.encounter ?? 1 });
}

/** Ended, in play, or the planner's last run. */
function stateOf(j) {
  if ( j.kind === "plan" ) return loc("FASTFIGHTING.LiveData.State.plan");
  return loc(`FASTFIGHTING.LiveData.State.${j.flags.battles?.[j.flags.liveBattle]?.ended ? "ended" : "inPlay"}`);
}

/**
 * Why a journal is among the others: the old store, not trusted (and why), or a store no longer used. (The store and
 * the leftover: temporary, remove at 0.7.0 with tests/temporary/live-single-store.test.js.)
 */
function whyOf(j) {
  if ( j.distrust ) return j.distrust;
  return j.kind === "store" ? "store" : "leftover";
}

/** The export: one file of these journals, with the world's context (live-store.js exportData). Nothing is changed. */
function download(journals, one = null) {
  const at = Date.now();
  const data = exportData(journals, worldFacts(), { at, existing: combatsHere() });
  foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json", exportFileName(game.world.id, at, one));
}
