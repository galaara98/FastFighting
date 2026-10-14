/**
 * The Battle Interface: the GM's window on a live battle (foundry/live-battle.js). Whose turn it is and what
 * FastFighting is waiting for (Continue, Rewind Turn, Play it, Rewind This Encounter, Play to the end, how NPCs'
 * reactions are decided); and each creature's mind as FastFighting has it (what it wants and how badly, its fears,
 * how far it's been talked round, who it won't listen to, whether it's shaken, who goads it), with what came of the
 * table's own rolls put in as the simulation would have it ("the goblin is afraid of Valeros", "Kyra's Diplomacy at
 * it: a success", "it surrenders").
 */
import { NEUTRAL_PARTY } from "../constants.js";
import { DESIRE_BAND_KEYS } from "../engine/behavior/desire.js";
import { mindOf, bandLevel } from "../engine/live.js";
import {
  liveBattle, continueBattle, rewindTurn, rewindEncounter, playCurrent, liveFact, dropHeldFact, setNpcReactions, setPlayThrough, finishReview,
  waitingOnGm, suggestedSpotlight, spotlightNext
} from "../foundry/live-battle.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const loc = key => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);

/** What the GM can say came of the table's rolls, each as engine/live.js applyFact takes it. */
const FACTS = Object.freeze({
  fear: { who: true, how: "band", fact: (id, by, band) => ({ kind: "want", id, desire: "avoid", targetId: by, level: bandLevel(band) }) },
  hurt: { who: true, how: "band", fact: (id, by, band) => ({ kind: "want", id, desire: "hurt", targetId: by, level: bandLevel(band) }) },
  protect: { who: true, how: "band", fact: (id, by, band) => ({ kind: "want", id, desire: "protect", targetId: by, level: bandLevel(band) }) },
  taunt: { who: true, fact: (id, by) => ({ kind: "taunt", id, byId: by, rounds: 1 }) },
  persuade: { who: true, how: "degree", fact: (id, by, degree) => ({ kind: "talk", id, byId: by, talk: "persuade", degree }) },
  intimidate: { who: true, how: "degree", fact: (id, by, degree) => ({ kind: "talk", id, byId: by, talk: "intimidate", degree }) },
  deceive: { who: true, how: "degree", fact: (id, by, degree) => ({ kind: "talk", id, byId: by, talk: "deceive", degree }) },
  insult: { who: true, fact: (id, by) => ({ kind: "insult", id, byId: by }) },
  waver: { fact: id => ({ kind: "waver", id, on: true }) },
  steady: { fact: id => ({ kind: "waver", id, on: false }) },
  flee: { fact: id => ({ kind: "flee", id }) },
  surrender: { fact: (id, by) => ({ kind: "surrender", id, byId: by || null }) },
  standDown: { fact: (id, by) => ({ kind: "standDown", id, byId: by || null }) },
  noSide: { fact: id => ({ kind: "side", id, side: NEUTRAL_PARTY }) }
});

export class BattleInterface extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fast-fighting-battle",
    classes: ["fast-fighting", "ff-battle"],
    window: { title: "FASTFIGHTING.Battle.Title", icon: "fa-solid fa-chess-knight", resizable: true },
    position: { width: 560, height: 720 },
    actions: {
      continue: BattleInterface.#onContinue,
      rewind: BattleInterface.#onRewind,
      play: BattleInterface.#onPlay,
      rewindAll: BattleInterface.#onRewindAll,
      fact: BattleInterface.#onFact,
      forget: BattleInterface.#onForget,
      dropHeld: BattleInterface.#onDropHeld,
      npcReactions: BattleInterface.#onNpcReactions,
      tellIt: BattleInterface.#onTellIt,
      playThrough: BattleInterface.#onPlayThrough,
      spotlight: BattleInterface.#onSpotlight
    }
  };

  static PARTS = {
    main: { template: "modules/fast-fighting/templates/battle-interface.hbs", scrollable: [".ff-battle-creatures"] }
  };

  /** Open it (GMs only), or bring it to the front. */
  static open() {
    if ( !game.user.isGM ) return null;
    const existing = foundry.applications.instances.get("fast-fighting-battle");
    if ( existing ) {
      existing.bringToFront?.();
      return existing.render({ force: true });
    }
    return new BattleInterface().render({ force: true });
  }

  /** Drawn again, if it's open. */
  static refresh() {
    foundry.applications.instances.get("fast-fighting-battle")?.render();
  }

  _canRender() {
    return game.user.isGM;
  }

  async _prepareContext() {
    const b = liveBattle();
    if ( !b ) return { none: true };
    const run = b.run;
    const combatant = b.combat.combatant;
    const current = combatant ? run.byId.get(combatant.tokenId) : null;
    const name = id => run.byId.get(id)?.spec.name ?? "";
    const sideLabel = side => b.spec.sides?.[side]?.label ?? (game.i18n.has(`FASTFIGHTING.Side.${side}`) ? loc(`FASTFIGHTING.Side.${side}`) : side);
    const played = !!current && waitingOnGm();
    const player = !!current && run.live.players.has(current.id);
    const state = b.data.ended ? "ended" : b.pc ? "player" : played ? "waiting" : b.data.spotlight && !current ? "spotlight" : "ready";
    // (A spotlight system: whom FastFighting would give it to next.)
    const next = state === "waiting" || state === "spotlight" ? suggestedSpotlight() : null;
    const others = run.units.map(u => ({ id: u.id, name: u.spec.name }));
    const creatures = run.units.filter(u => u.active || u.status !== "standing").map(u => {
      const mind = mindOf(run, u.id);
      const doc = b.scene.tokens.get(u.spec.tokenId ?? u.id);
      return {
        id: u.id, name: u.spec.name, img: doc?.texture?.src ?? u.spec.img ?? "icons/svg/mystery-man.svg",
        current: current?.id === u.id, player: run.live.players.has(u.id),
        hp: `${u.hp}/${u.maxHp}`, status: loc(`FASTFIGHTING.Status.${u.status}`), side: sideLabel(u.side), sideClass: u.side,
        desires: mind.desires.slice(0, 3).map(d => ({
          text: fmt("FASTFIGHTING.Battle.Desire", { what: loc(`FASTFIGHTING.Desire.Kind.${d.kind}`), who: name(d.targetId), how: loc(`FASTFIGHTING.Desire.Level.${DESIRE_BAND_KEYS[d.band]}`) }),
          gm: d.gm, kind: d.kind, targetId: d.targetId
        })),
        gm: mind.gm.map(g => ({ text: fmt("FASTFIGHTING.Battle.Desire", { what: loc(`FASTFIGHTING.Desire.Kind.${g.kind}`), who: name(g.targetId), how: loc(`FASTFIGHTING.Desire.Level.${DESIRE_BAND_KEYS[Math.min(4, Math.floor(g.level / 20))]}`) }), kind: g.kind, targetId: g.targetId })),
        sway: mind.sway.filter(s => s.progress > 0).map(s => fmt("FASTFIGHTING.Battle.Persuaded", { side: sideLabel(s.side), n: s.progress, steps: s.steps })),
        wontListen: mind.offendedBy.length ? fmt("FASTFIGHTING.Battle.WontListen", { names: mind.offendedBy.map(name).join(", ") }) : "",
        wavering: mind.wavering,
        taunts: mind.taunts.map(t => fmt("FASTFIGHTING.Battle.Goaded", { name: name(t.byId) })),
        others: others.filter(o => o.id !== u.id)
      };
    });
    // A player's turn waiting on the GM: what was read of it, to keep or drop (and a talk set right).
    const review = b.review ? {
      title: fmt("FASTFIGHTING.Battle.ReviewTitle", { name: name(b.review.id) }),
      events: b.review.events.map((e, i) => ({
        i, unsure: e.sure === false, talk: e.type === "talk",
        text: fmt(`FASTFIGHTING.Battle.Read.${game.i18n.has(`FASTFIGHTING.Battle.Read.${e.type}`) ? e.type : "other"}`, {
          actor: name(b.review.id), target: name(e.targetId), action: e.action || e.skill || "", damage: e.damage ?? 0, amount: e.amount ?? 0,
          degree: Number.isFinite(e.degree) ? loc(`FASTFIGHTING.Battle.Degree.${e.degree}`) : "", kind: e.kind ? loc(`FASTFIGHTING.Battle.Talk.${e.kind}`) : ""
        }),
        kinds: ["persuade", "intimidate", "deceive"].map(k => ({ value: k, label: loc(`FASTFIGHTING.Battle.Talk.${k}`), selected: e.kind === k })),
        targets: [{ value: "", label: "—", selected: !e.targetId }, ...run.units.filter(u => u.id !== b.review.id).map(u => ({ value: u.id, label: u.spec.name, selected: e.targetId === u.id }))],
        degrees: [3, 2, 1, 0].map(d => ({ value: d, label: loc(`FASTFIGHTING.Battle.Degree.${d}`), selected: (e.degree ?? 2) === d }))
      }))
    } : null;
    return {
      review,
      round: b.data.spotlight ? run.round : b.combat.round,
      spotlight: next ? fmt("FASTFIGHTING.Battle.Spotlight", { name: next.spec.name }) : "",
      turn: current ? fmt(player ? "FASTFIGHTING.Battle.PlayerTurn" : "FASTFIGHTING.Battle.Turn", { name: current.spec.name }) : "",
      state, stateText: loc(`FASTFIGHTING.Battle.State.${state}`),
      canContinue: state === "waiting", canPlay: state === "ready" && !player, canRewind: b.data.turns.length > 0,
      npcAsk: run.live.npcReactions === "ask", playThrough: !!b.data.auto,
      held: (b.pc?.facts ?? []).map((f, i) => ({ i, text: factText(f, name) })),
      creatures,
      facts: Object.entries(FACTS).map(([key, f]) => ({ key, label: loc(`FASTFIGHTING.Battle.Fact.${key}`), who: !!f.who, how: f.how ?? "" })),
      bands: DESIRE_BAND_KEYS.map((k, i) => ({ value: i, label: loc(`FASTFIGHTING.Desire.Level.${k}`) })),
      degrees: [3, 2, 1, 0].map(d => ({ value: d, label: loc(`FASTFIGHTING.Battle.Degree.${d}`) }))
    };
  }

  static async #onContinue() {
    await continueBattle();
  }

  static async #onSpotlight() {
    await spotlightNext();
  }

  static async #onRewind() {
    await rewindTurn();
  }

  static async #onPlay() {
    await playCurrent();
  }

  static async #onRewindAll() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("FASTFIGHTING.MakeItSo.UndoTitle") }, content: `<p>${foundry.utils.escapeHTML(loc("FASTFIGHTING.Live.RewindAllConfirm"))}</p>`
    });
    if ( ok ) await rewindEncounter();
  }

  /** A fact from the table, as the creature's card says: what, by (or about) whom, how much (or how well). */
  static async #onFact(event, target) {
    const row = target.closest("[data-creature]");
    const id = row?.dataset.creature;
    const what = row?.querySelector("[name=what]")?.value;
    const f = FACTS[what];
    if ( !id || !f ) return;
    const by = row.querySelector("[name=who]")?.value ?? "";
    if ( f.who && !by && !["surrender", "standDown"].includes(what) ) return ui.notifications.warn(loc("FASTFIGHTING.Battle.PickWho"));
    const how = Number(row.querySelector(f.how === "degree" ? "[name=degree]" : "[name=band]")?.value ?? 2);
    await liveFact(f.fact(id, by, how));
  }

  /** A want the GM set, taken back. */
  static async #onForget(event, target) {
    const { creature, kind, who } = target.dataset;
    await liveFact({ kind: "forget", id: creature, desire: kind, targetId: who });
  }

  static #onDropHeld(event, target) {
    dropHeldFact(Number(target.dataset.index));
  }

  /** The GM's review done: the events kept, a talk as the GM set it, all of them sure now. */
  static #onTellIt(event, target) {
    const b = liveBattle();
    if ( !b?.review ) return;
    const root = target.closest(".ff-battle-review");
    const events = [];
    b.review.events.forEach((e, i) => {
      const row = root.querySelector(`[data-event="${i}"]`);
      if ( row && !row.querySelector("[name=keep]")?.checked ) return;
      const kept = { ...e, sure: true };
      if ( e.type === "talk" && row ) {
        kept.kind = row.querySelector("[name=kind]")?.value ?? e.kind;
        kept.degree = Number(row.querySelector("[name=degree]")?.value ?? e.degree ?? 2);
        kept.targetId = row.querySelector("[name=target]")?.value || e.targetId;
        if ( !kept.targetId ) return; // (at no one: nothing to tell)
      }
      events.push(kept);
    });
    finishReview(events);
  }

  static async #onNpcReactions(event, target) {
    await setNpcReactions(target.checked ? "ask" : "calculated");
  }

  static async #onPlayThrough(event, target) {
    await setPlayThrough(target.checked);
  }
}

/** A held fact, in a few words: "Kyra: Was persuaded by (success)". */
function factText(f, name) {
  const who = name(f.id);
  const key = f.kind === "want" ? { avoid: "fear", hurt: "hurt", protect: "protect" }[f.desire] : f.kind === "talk" ? f.talk : f.kind === "waver" ? (f.on ? "waver" : "steady") : f.kind === "side" ? "noSide" : f.kind;
  const label = game.i18n.has(`FASTFIGHTING.Battle.Fact.${key}`) ? loc(`FASTFIGHTING.Battle.Fact.${key}`) : key;
  const by = f.byId ?? f.targetId;
  return [who, label, by ? name(by) : "", f.kind === "talk" ? `(${loc(`FASTFIGHTING.Battle.Degree.${f.degree}`)})` : ""].filter(Boolean).join(" ");
}

/** Drawn again whenever the battle changes, and when hit points or the tracker do. */
export function registerBattleInterface() {
  Hooks.on("fastFighting.liveBattle", () => BattleInterface.refresh());
  let soon = null;
  const later = () => {
    clearTimeout(soon);
    soon = setTimeout(() => BattleInterface.refresh(), 250);
  };
  for ( const hook of ["updateCombat", "updateActor", "updateToken"] ) Hooks.on(hook, later);
}

