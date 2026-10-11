/**
 * The story of one simulated fight, at three levels of detail:
 *   roleplay      a short piece of prose: every action narrated from the story tables, with cover, terrain,
 *                 movement modes and the relationships between combatants coloring the telling
 *   standard      what each character did (attacks, hits, spells, talking, healing, movement) and a summary
 *   statistician  every roll: die, modifier, total, DC, degree, margin and damage, round by round
 *
 * Pure apart from the tables object passed in ({get(key) -> string[]}), so it can be unit-tested.
 */
import { createRng } from "../engine/rng.js";
import { DAMAGE_TYPES } from "./tables-en.js";
import { desireBand, DESIRE_BAND_KEYS } from "../engine/behavior/desire.js";
import { listJoin, localize } from "../i18n.js";
import { logLine, endLine, logTerm, formatMoney, concessionText } from "./log-lines.js";

export { formatMoney, concessionText };

export const STORY_STYLES = ["roleplay", "standard", "statistician"];

const SPELL_KINDS = new Set(["spell-attack", "save", "auto"]);

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
const capital = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;


/** Outcome tier of a check from the actor's point of view. */
export function tierOf(degree, margin) {
  if ( degree === 3 ) return "criticalSuccess";
  if ( degree === 2 ) return margin >= 6 ? "majorSuccess" : margin <= 1 ? "minorSuccess" : "success";
  if ( degree === 1 ) return margin >= -2 ? "minorFailure" : margin <= -6 ? "majorFailure" : "failure";
  return "criticalFailure";
}

/** A saving throw seen from the caster's side: the target failing is the caster's success. */
function saveTier(e) {
  if ( e.degree === 0 ) return "criticalSuccess";
  if ( e.degree === 1 ) return e.margin <= -6 ? "majorSuccess" : "success";
  if ( e.degree === 2 ) return e.damage > 0 ? "minorSuccess" : "minorFailure";
  return e.damage > 0 ? "minorSuccess" : "majorFailure";
}

const successful = tier => tier.toLowerCase().endsWith("success");

function deliveryOf(e) {
  if ( SPELL_KINDS.has(e.actionKind) ) return "spell";
  return e.ranged ? "ranged" : "melee";
}

/** The imagery family for a damage type: the system maps its own types (5e "lightning" reads as electricity). */
function damageTypeOf(e, mapType) {
  const type = mapType ? mapType(e.damageType) : e.damageType;
  return DAMAGE_TYPES.includes(type) ? type : "untyped";
}

/**
 * Tracks who did what to whom, so the telling can call out grudges, vengeance and rivalries.
 */
class Relationships {
  constructor(spec) {
    // (Those who command a group: the heads of its chain, and its lieutenants.)
    this.leaders = new Set([...Object.values(spec.sides ?? {}).map(s => s.leaderId), ...Object.values(spec.command ?? {}).flatMap(c => (c ?? []).map(x => x.id))].filter(Boolean));
    this.sideOf = new Map((spec.combatants ?? []).map(c => [c.id, c.side]));
    this.hurtBy = new Map();      // victimId -> Set(attackerId)
    this.downedBy = new Map();    // fallenId -> attackerName/id
    this.rebuffed = new Set();    // "talker|target" after a failed pitch
    this.exchanges = new Map();   // "a|b" -> count
    this.targetOf = new Map();    // attackerId -> last targetId
    this.down = new Set();
    this.told = new Set();
  }

  kind(e) {
    const a = e.actorId;
    const t = e.targetId;
    if ( this.down.has(t) ) return "finishing";
    for ( const [fallen, by] of this.downedBy ) {
      if ( by === t && fallen !== a && this.sideOf.get(fallen) === this.sideOf.get(a) ) return "avenger";
    }
    if ( this.leaders.has(t) && this.sideOf.get(t) !== this.sideOf.get(a) ) return "enemyLeader";
    if ( this.rebuffed.has(`${a}|${t}`) ) return "talkingNemesis";
    if ( this.hurtBy.get(a)?.has(t) ) return "grudge";
    const victim = this.targetOf.get(t);
    if ( victim && victim !== a && this.sideOf.get(victim) === this.sideOf.get(a) ) return "protector";
    if ( (this.exchanges.get([a, t].sort().join("|")) ?? 0) >= 3 ) return "rival";
    return "none";
  }

  record(e) {
    if ( ["attack", "save", "auto"].includes(e.type) ) {
      this.targetOf.set(e.actorId, e.targetId);
      const key = [e.actorId, e.targetId].sort().join("|");
      this.exchanges.set(key, (this.exchanges.get(key) ?? 0) + 1);
      if ( (e.damage ?? 0) > 0 ) {
        if ( !this.hurtBy.has(e.targetId) ) this.hurtBy.set(e.targetId, new Set());
        this.hurtBy.get(e.targetId).add(e.actorId);
      }
    }
    if ( e.type === "talk" && e.degree <= 1 ) this.rebuffed.add(`${e.actorId}|${e.targetId}`);
    if ( e.type === "down" || e.type === "death" ) {
      this.down.add(e.actorId);
      if ( e.byId || e.by ) this.downedBy.set(e.actorId, e.byId ?? null);
    }
    if ( e.type === "heal" && e.revived ) this.down.delete(e.targetId);
  }
}

/**
 * Who the story may talk about. A creature that never took part is left out of the lists; a hidden one that
 * never took part isn't mentioned at all (the story is often posted for the players, and they never met it).
 */
function storyCast(result, spec) {
  const out = new Set();
  const secret = new Set();
  for ( const c of spec.combatants ?? [] ) {
    if ( result.units?.[c.id]?.final?.active !== false ) continue;
    out.add(c.id);
    if ( c.hidden ) secret.add(c.id);
  }
  // With a quiet aftermath the story ends at the last blow (the outcome is still settled).
  const quiet = spec.options?.aftermath === "quiet";
  const mentions = e => !(quiet && e.aftermath) && !secret.has(e.actorId) && !secret.has(e.targetId) && !secret.has(e.towardId) && !secret.has(e.byId);
  return { out, mentions };
}

function makeRoller(tables, seed) {
  const rng = createRng(seed >>> 0);
  const roll = (key, fill = {}) => {
    const entries = tables.get(key);
    if ( !entries?.length ) return "";
    const text = entries[Math.floor(rng.next() * entries.length)] ?? "";
    // (A language whose possessive agrees with the weapon fills {su} from its tables' possessive().)
    const extra = tables.possessive && text.includes("{su}") ? { su: tables.possessive(fill.weapon ?? "") } : null;
    return text.replace(/\{(\w+)\}/g, (m, k) => {
      const v = fill[k] ?? extra?.[k];
      return v !== undefined && v !== null ? v : m;
    });
  };
  roll.lang = tables.lang ?? "en";
  return roll;
}

/* -------------------------------------------- */
/*  Roleplay                                    */
/* -------------------------------------------- */

/** "jaws skewers" -> "jaws skewer": plural natural weapons take a plural verb. */
function agreeWithWeapon(text, weapon) {
  if ( !weapon || !/[^s]s$/i.test(weapon.trim()) ) return text;
  const escaped = weapon.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(${escaped}) (still )?([a-z]+)`, "gi"), (m, w, still = "", verb) => {
    let v = verb;
    if ( /ies$/.test(v) ) v = v.replace(/ies$/, "y");
    else if ( /(ss|sh|ch|x)es$/.test(v) ) v = v.replace(/es$/, "");
    else if ( /[^s]s$/.test(v) ) v = v.slice(0, -1);
    return `${w} ${still}${v}`;
  });
}

/**
 * The relationship aside ("Payback, at last."). Used sparingly: the first time a pairing takes on meaning,
 * and on decisive moments (critical or major results), so the prose doesn't repeat itself every swing.
 */
function relationshipClause(e, tier, rel, roll, fill) {
  const kind = rel.kind(e);
  if ( kind === "none" ) return "";
  const key = `${e.actorId}|${e.targetId}|${kind}`;
  const decisive = tier.startsWith("critical") || tier.startsWith("major");
  if ( rel.told.has(key) && !decisive ) return "";
  rel.told.add(key);
  const clause = roll(`relationship.${kind}.${successful(tier) ? "success" : "failure"}`, fill).trim();
  return clause ? ` ${capital(clause)}` : "";
}

function narrate(e, roll, rel, fill) {
  const base = { actor: e.actor, target: e.target ?? "", weapon: e.action ?? e.item ?? "", by: e.by ?? "", affliction: e.name ?? "" };
  const f = { ...base, ...fill };
  delete f.mapType;
  switch ( e.type ) {
    case "attack":
    case "save":
    case "auto": {
      const tier = e.type === "save" ? saveTier(e) : e.type === "auto" ? "success" : tierOf(e.degree, e.margin);
      let text = roll(`action.${deliveryOf(e)}.${damageTypeOf(e, fill.mapType)}.${tier}`, f);
      if ( roll.lang === "en" ) text = agreeWithWeapon(text, f.weapon);
      if ( e.attackerCover && e.ranged && e.natural % 3 === 0 ) text = `${roll("event.coverShoot", f)} ${capital(text)}`;
      if ( e.targetCover && e.ranged && !successful(tier) ) text += ` ${capital(roll("event.coverDuck", f))}`;
      return text + relationshipClause(e, tier, rel, roll, f);
    }
    case "talk": {
      const tier = tierOf(e.degree, e.margin);
      return roll(`talk.${e.kind ?? "persuade"}.${tier}`, f) + relationshipClause(e, tier, rel, roll, f);
    }
    case "door": {
      const key = { open: "doorOpen", giveup: "doorGiveUp" }[e.method]
        ?? (e.method === "attack" ? (e.success ? "doorSmashed" : e.hit ? "doorHit" : "doorMiss") : `door${e.method === "pick" ? "Picked" : "Forced"}${e.success ? "" : "Fail"}`);
      return roll(`event.${key}`, f);
    }
    case "move": {
      if ( e.purpose === "tend" ) return roll("event.moveTend", { ...f, target: e.toward });
      if ( e.purpose === "door" ) return roll("event.moveDoor", f);
      const mode = ["walk", "fly", "swim", "climb", "burrow"].includes(e.mode) ? e.mode : "walk";
      const situation = e.purpose === "help" ? "help" : e.purpose === "hunt" ? "hunt" : (e.regions?.length && (e.mult > 1.05 || mode === "fly" || mode === "burrow" || mode === "climb")) ? "terrain" : "approach";
      return roll(`move.${mode}.${situation}`, { ...f, target: e.toward, region: e.regions?.[0] ?? "" });
    }
    case "flee":
      if ( e.retreat ) return roll(e.leads ? "event.leadRetreat" : "event.fallBack", { ...f, target: e.with ?? "" });
      return roll(e.feet ? `move.${e.mode === "fly" ? "fly" : "walk"}.flee` : "event.flee", f);
    case "retreat": return e.what === "refused" ? roll("event.retreatRefused", { ...f, target: e.target ?? "" }) : roll(e.urged ? "event.retreatUrged" : "event.retreatCall", { ...f, target: e.by ?? "" });
    case "rally": return roll("event.rally", { ...f, allies: listJoin(e.with ?? []) });
    case "heal":
      if ( e.potion ) return roll("event.potion", f);
      if ( e.revived ) return roll("event.revive", f);
      return roll(e.self ? "event.healSelf" : "event.heal", f);
    case "down": return roll(e.knockedOut ? "event.knockout" : "event.down", f);
    case "mercy": return roll("event.mercy", f);
    case "execute": return e.goes ? roll("event.executeGoes", f) : roll(e.next ? "event.executeSpared" : "event.executeSparedAlone", { ...f, next: e.next ?? "" });
    case "death": return roll(e.finished ? "event.finished" : "event.death", f);
    case "struckDown": return roll("event.struckDown", f);
    case "recovery":
      if ( e.dead ) return roll("event.death", f);
      if ( e.stable ) return roll("event.stabilize", f);
      return roll(e.dying < e.before ? "event.recoveryGood" : "event.recoveryBad", f);
    case "stand": return roll("event.stand", f);
    case "shield": return roll("event.shield", f);
    case "draw": return roll("event.draw", f);
    case "prone": return roll("event.prone", f);
    case "grabbed": return roll("event.grabbed", f);
    case "escape": return roll(e.success ? "event.escape" : "event.stuck", f);
    case "waver": return roll("event.waver", f);
    case "holdGround": return roll(e.ordered ? "event.holdOrdered" : "event.holdGround", { ...f, target: e.by ?? "" });
    case "study": return roll(e.worked === false ? "event.studyFails" : "event.study", f);
    case "observe": return roll("event.observe", { ...f, targets: listJoin(e.targets ?? []) });
    case "shareLore": return roll("event.shareLore", { ...f, allies: listJoin(e.with ?? []) });
    case "scheme": return roll("event.scheme", f);
    case "command":
      if ( e.lost ) return e.from ? roll("event.commandLost", { ...f, actor: e.from }) : "";
      return roll(e.back ? "event.commandBack" : e.from ? "event.commandTakes" : "event.commandTakesFresh", { ...f, target: e.from ?? "" });
    case "keepLore": return ""; // (kept to itself: nothing to see)
    case "parley": return roll("event.parley", f);
    case "callHelp": return roll("event.callHelp", { ...f, target: e.toward });
    case "notice": return roll({ sight: "event.noticeSight", sound: "event.noticeSound", fledInto: "event.noticeFled", help: "event.noticeHelp", attacked: "event.noticeAttacked", standoff: "event.noticeStandoff" }[e.cause] ?? "event.noticeSound", f);
    case "join": return roll(e.why === "forced" ? "event.joinForced" : "event.join", f);
    case "watch": return roll(e.neutral ? "event.watchNeutral" : "event.watch", f);
    case "neutral": {
      const g = { ...f, side: e.sideLabel ?? "", victim: e.victim ?? "" };
      switch ( e.what ) {
        case "truce": return roll(e.victim ? "event.truceVictim" : "event.truce", g);
        case "offended": return roll(e.why === "hurt" ? "event.offendedHurt" : e.why === "robbed" ? "event.offendedRobbed" : e.why === "insulted" ? "event.offendedInsulted" : e.victim ? "event.offendedVictim" : "event.offended", g);
        case "luck": return roll("event.nearlyTurns", g);
        case "amends": return roll("event.amends", g);
        case "calmed": return roll("event.calmed", g);
        case "holds": return roll("event.holdsBack", g);
        case "feud": return roll("event.feud", { ...g, target: e.target ?? "" });
        case "meddle": return roll(e.how === "extort" ? "event.meddleExtort" : "event.meddle", { ...g, side: e.how === "extort" ? e.against ?? "" : e.sideLabel ?? "" });
        case "aloof": return roll("event.aloof", g);
        default: return roll("event.lapse", g);
      }
    }
    case "leave": return roll("event.leave", f);
    case "sway": {
      if ( e.lie ) return roll("event.lieAndRun", f);
      if ( e.outcome === "bribed" ) return roll("event.bribed", { ...f, amount: concessionText(e.concession) || "a price", target: e.payer ?? e.by ?? "" });
      if ( e.paidOff ) {
        const c = e.concession;
        return roll(!c ? "event.paidNothing" : c.kept ? "event.paidKept" : "event.paidOff", { ...f, amount: concessionText(c), item: c?.item?.name ?? "" });
      }
      if ( e.outcome === "conceded" ) {
        const c = e.concession;
        const key = !c ? "event.standDown" : c.kept ? "event.concedeKept" : c.kind === "money" ? "event.concedeMoney" : "event.concedeItem";
        return roll(key, { ...f, amount: concessionText(c), item: c?.item?.name ?? "" });
      }
      if ( e.outcome === "switched" && e.recruit ) return roll("event.recruit", f);
      if ( e.outcome === "neutral" ) return roll(e.again ? "event.standAsideAgain" : "event.standAside", f);
      return roll({ surrendered: "event.surrender", fled: "event.swayFlee", switched: "event.switch", stoodDown: "event.standDown" }[e.outcome] ?? "event.surrender", f);
    }
    case "lastWord": return roll("event.lastWord", f);
    case "condition": return roll("event.conditionRider", { ...f, effect: e.effect ?? "" });
    case "control":
      if ( e.immune ) return roll("event.controlImmune", f);
      if ( e.backfired ) return roll("event.controlBackfire", { ...f, effect: e.effect ?? "" });
      return roll(e.took ? "event.controlTakes" : "event.controlResisted", { ...f, effect: e.effect ?? "" });
    case "buff": {
      // Plain moves (Dodge, Reckless Attack, Action Surge) are told as what they are, not as magic.
      if ( e.tell ) {
        const own = roll(`event.${e.tell}`, f);
        if ( own ) return own;
      }
      const others = (e.targets ?? []).filter((n, i) => e.targetIds?.[i] !== e.actorId);
      const fill = { ...f, effect: e.effect ?? "", target: others[0] ?? "", targets: listJoin(others), all: listJoin([e.actor, ...others]) };
      // (An edge that needed a roll, and didn't land.)
      if ( e.failed ) return roll(others.length ? "event.edgeFails" : "event.edgeFailsSelf", fill);
      if ( !others.length ) return roll("event.buffSelf", fill);
      const asked = e.askedBy?.length ? `${roll("event.answerCall", { ...f, target: e.askedBy[0] })} ` : "";
      if ( e.withSelf ) return asked + roll("event.buffWithSelf", fill);
      return asked + roll(others.length > 1 ? "event.buffMany" : "event.buffOne", fill);
    }
    // Letting one spell go for another passes without comment; losing hold of it doesn't.
    case "concentrationEnd": return e.reason === "switch" ? "" : roll("event.concentrationLost", { ...f, weapon: e.action ?? "" });
    case "shakeOff": return roll("event.shakeOff", { ...f, effect: e.effect ?? "" });
    case "deed": return e.success ? roll("event.deed", { ...f, weapon: e.deed ?? "", effect: e.effect || "reeling" }) : "";
    case "rider": return e.landed ? roll("event.riderTakes", { ...f, weapon: e.rider ?? "", effect: e.effect || "reeling" }) : (e.tell ? roll(`event.${e.tell}`, f) : "");
    case "critTable": return !e.slain && e.effect ? roll("event.critEffect", { ...f, effect: e.effect }) : "";
    case "fumble": return e.effect ? roll("event.fumbleEffect", { ...f, effect: e.effect }) : roll("event.fumble", f);
    case "cast": return e.success ? "" : roll(e.lost ? "event.spellLost" : e.disapproved ? "event.disapproval" : "event.spellFails", f);
    case "boost": return roll(e.self ? "event.boost" : "event.boostFor", { ...f, label: e.label ?? "luck", target: e.target ?? "" });
    case "fate": return roll(e.self ? "event.fateSelf" : "event.fateFor", { ...f, label: e.label ?? "fate", target: e.target ?? "" });
    case "body": return roll(e.alive ? "event.bodyAlive" : "event.bodyDead", f);
    case "summon": return roll((e.names ?? []).length > 1 ? "event.summonMany" : "event.summonOne", { ...f, weapon: e.action ?? "", names: listJoin(e.names ?? []), name: e.names?.[0] ?? "" });
    case "vanish": return roll("event.vanish", f);
    case "reaction": {
      const fill = { ...f, weapon: e.reaction ?? "", target: e.target ?? "" };
      if ( e.tell ) {
        const own = roll(`event.${e.tell}`, fill);
        if ( own ) return own;
      }
      return roll({ hit: "event.reactHit", attacked: "event.reactAttacked", missed: "event.reactMissed", damaged: "event.reactDamaged" }[e.trigger] ?? "event.reactHit", fill);
    }
    case "counter": return roll(e.countered ? "event.counterTakes" : "event.counterFails", { ...f, weapon: e.reaction ?? "", spell: e.action ?? "", target: e.target ?? "" });
    case "allegiance": return roll(e.joined ? "event.allegianceTurn" : "event.allegianceBack", { ...f, by: e.by ?? "" });
    case "theft":
      if ( e.feint && !e.feint.hit ) return roll("event.feintMiss", { ...f, weapon: e.feint.weapon });
      if ( e.stolen ) return roll(e.feint ? "event.theftFeint" : "event.theftSuccess", { ...f, amount: concessionText(e.stolen), weapon: e.feint?.weapon ?? "" });
      return roll(e.noticed ? "event.theftCaught" : "event.theftEmpty", f);
    case "reclaim": return roll("event.reclaim", { ...f, amount: concessionText(e.concession) });
    case "persistent": return roll("event.persistent", f);
    case "afflictionSave": return roll(e.degree <= 1 ? "event.afflictionSaveFail" : "event.afflictionSavePass", f);
    // A failed save that leaves a condition is told by the condition that follows.
    case "riderSave": return e.degree > 1 && e.controls ? roll("event.riderSavePass", f) : "";
    case "opportunity": return roll("event.opportunity", f);
    case "disengage": return roll("event.disengage", f);
    case "afflictionStage": return roll("event.afflictionStage", f);
    case "afflictionEnd": return roll("event.afflictionEnd", f);
    case "step": return roll("event.step", f);
    case "surprise": return roll("event.surprise", f);
    case "aftermath": return roll(e.tended ? "event.aftermath" : "event.aftermathAlone", f);
    case "standoff": return roll("event.standoff", f);
    case "breakStandoff": return roll({ insulted: "event.breakInsulted", beast: "event.breakBeast", annoyed: "event.breakAnnoyed", blood: "event.breakBlood" }[e.cause] ?? "event.breakStandoff", f);
    case "peacekeep": return roll("event.peacekeep", f);
    case "firstAid": return roll(e.stable ? "event.firstAid" : e.dead ? "event.death" : "event.firstAidFail", f);
    default: return "";
  }
}

/** How often a character's turn opens with a moment of thought (and never two rounds running for the same one). */
const THOUGHT_CHANCE = 0.25;

/**
 * A character's two strongest desires, as a thought: "Charlette really wants to heal Brent, but also kind of wants
 * to hurt the wolf." Desires about creatures the story mustn't name are left out.
 */
function thinkAloud(e, roll, mentions) {
  const desires = (e.desires ?? []).filter(d => d.target && mentions({ targetId: d.targetId }))
    // (Two goblins read as one: "hurt Goblin, but also hurt Goblin" says nothing.)
    .filter((d, i, all) => i === 0 || d.kind !== all[0].kind || d.target !== all[0].target);
  if ( !desires.length ) return "";
  const phrase = d => {
    const intensity = roll(`desire.intensity.${DESIRE_BAND_KEYS[desireBand(d.level)]}`);
    // (About itself: its own words, "heal themselves", "curarse".)
    const self = d.targetId === e.actorId;
    const verb = (self && roll(`desire.self.${d.kind}`)) || roll(`desire.verb.${d.kind}`, { target: self ? localize("FASTFIGHTING.Story.Themselves", "themselves") : d.target });
    return intensity && verb ? `${intensity} ${verb}` : "";
  };
  const first = phrase(desires[0]);
  if ( !first ) return "";
  const second = desires[1] ? phrase(desires[1]) : "";
  return second ? roll("event.thoughtTwo", { actor: e.actor, first, second }) : roll("event.thoughtOne", { actor: e.actor, first });
}

function roleplay(result, spec, tables, seed, title, mapType) {
  const roll = makeRoller(tables, seed);
  const moment = createRng((seed + 7919) >>> 0); // when someone pauses to think
  const lastThought = new Map();
  const rel = new Relationships(spec);
  const { mentions } = storyCast(result, spec);
  const paragraphs = [];
  const opening = result.log.find(e => e.type === "surprise" || e.type === "standoff") ? null : roll("event.opening");
  if ( opening ) paragraphs.push(opening);
  let current = null;
  let lastMoveKey = null;
  for ( const e of result.log ) {
    if ( e.type === "initiative" || !mentions(e) ) continue;
    // The outcome comes where the fighting stops; anything after it (tending the fallen) follows.
    if ( e.type === "end" ) {
      paragraphs.push(ending(result, spec, e, roll));
      current = null;
      continue;
    }
    if ( !current || current.round !== e.round ) {
      current = { round: e.round, sentences: [] };
      paragraphs.push(current);
      lastMoveKey = null;
    }
    // Several moves in a row by the same character read as one.
    if ( e.type === "move" ) {
      const key = `${e.actorId}|${e.towardId}|${e.purpose}`;
      if ( key === lastMoveKey ) continue;
      lastMoveKey = key;
    } else lastMoveKey = null;
    if ( e.type === "thought" ) {
      if ( (lastThought.get(e.actorId) ?? -9) >= e.round - 1 || moment.next() > THOUGHT_CHANCE ) continue;
      const thought = thinkAloud(e, roll, mentions);
      if ( thought ) {
        lastThought.set(e.actorId, e.round);
        current.sentences.push(capital(thought.trim()));
      }
      continue;
    }
    const sentence = narrate(e, roll, rel, { mapType });
    rel.record(e);
    if ( sentence ) current.sentences.push(capital(sentence.trim()));
  }
  const html = paragraphs
    .map(p => (typeof p === "string" ? p : p.sentences.join(" ")))
    .filter(Boolean)
    .map(p => `<p>${esc(p)}</p>`)
    .join("");
  return { title, html, text: paragraphs.map(p => (typeof p === "string" ? p : p.sentences.join(" "))).filter(Boolean).join("\n\n") };
}

/** The closing line, naming the survivors rather than the side. */
function ending(result, spec, end, roll) {
  const standing = spec.combatants.filter(c => end.winners?.includes(result.units[c.id]?.final?.side ?? c.side)
    && result.units[c.id]?.final?.status === "standing" && result.units[c.id]?.final?.active !== false).map(c => c.name);
  const winners = standing.length > 3 ? localize("FASTFIGHTING.Story.Companions", "{names} and their companions", { names: standing.slice(0, 2).join(", ") })
    : standing.length ? listJoin(standing) : listJoin(end.winnerLabels ?? []);
  // A lone survivor takes a singular verb ("Lini prevails").
  if ( end.resolved === "conceded" ) return roll("event.dealStruck", { winners });
  if ( end.resolved === "fled" ) return roll("event.backedOff", { winners });
  if ( end.peaceful ) return roll("event.peace", { winners });
  if ( end.outcome === "stalemate" && end.standoff ) return roll("event.talksStall", { winners });
  const victory = standing.length === 1 ? "event.victoryOne" : "event.victory";
  // Nobody's side left, but someone who took no side (and then turned on one) still stands.
  if ( end.outcome === "none" ) {
    const last = spec.combatants.filter(c => result.units[c.id]?.final?.status === "standing" && result.units[c.id]?.final?.side === "neutralParty"
      && result.units[c.id]?.final?.against?.length).map(c => c.name);
    if ( last.length ) return roll("event.lastStanding", { winners: listJoin(last) });
  }
  return roll(end.outcome === "victory" ? victory : end.outcome === "none" ? "event.noOne" : "event.stalemate", { winners });
}

/* -------------------------------------------- */
/*  Standard                                    */
/* -------------------------------------------- */

function standard(result, spec, title, labels) {
  const { out, mentions } = storyCast(result, spec);
  const by = new Map();
  const entry = id => {
    if ( !by.has(id) ) by.set(id, { attacks: new Map(), spells: new Map(), buffs: new Map(), talks: { tries: 0, wins: 0 }, heals: 0, healed: 0, potions: 0, aid: 0, stabilized: 0, feet: 0, damage: 0, notes: [] });
    return by.get(id);
  };
  for ( const e of result.log ) {
    if ( !e.actorId || !mentions(e) ) continue;
    const s = entry(e.actorId);
    if ( e.type === "control" ) {
      const a = s.spells.get(e.action) ?? { uses: 0, hits: 0, crits: 0, misses: 0 };
      a.uses += 1;
      if ( e.took ) a.hits += 1; else a.misses += 1;
      s.spells.set(e.action, a);
      s.damage += e.damage ?? 0;
    } else if ( e.type === "buff" ) {
      s.buffs.set(e.action, (s.buffs.get(e.action) ?? 0) + 1);
    } else if ( e.type === "theft" ) {
      s.notes.push(e.stolen ? logTerm("NoteStole", { what: concessionText(e.stolen), target: e.target }) : e.noticed ? logTerm("NoteCaught", { target: e.target }) : logTerm("NoteEmpty", { target: e.target }));
    } else if ( e.type === "attack" || e.type === "save" || e.type === "auto" ) {
      const bucket = SPELL_KINDS.has(e.actionKind) ? s.spells : s.attacks;
      const a = bucket.get(e.action) ?? { uses: 0, hits: 0, crits: 0, misses: 0 };
      a.uses += 1;
      const hit = e.type === "auto" || (e.type === "save" ? e.damage > 0 : e.degree >= 2);
      if ( hit ) a.hits += 1; else a.misses += 1;
      if ( (e.type === "attack" && e.degree === 3) || (e.type === "save" && e.degree === 0) ) a.crits += 1;
      bucket.set(e.action, a);
      s.damage += e.damage ?? 0;
    } else if ( e.type === "talk" ) {
      s.talks.tries += 1;
      if ( e.degree >= 2 ) s.talks.wins += 1;
    } else if ( e.type === "heal" ) {
      if ( e.potion ) s.potions += 1; else s.heals += 1;
      s.healed += e.amount ?? 0;
    } else if ( e.type === "firstAid" ) {
      s.aid += 1;
      if ( e.stable ) s.stabilized += 1;
    } else if ( e.type === "move" ) s.feet += e.feet ?? 0;
    else if ( e.type === "sway" && e.concession ) {
      const c = e.concession;
      s.notes.push(c.kept ? logTerm("NoteKept", { what: concessionText(c), luck: c.luck }) : logTerm("NoteGave", { what: concessionText(c), name: c.toName }));
    } else if ( e.type === "reclaim" ) s.notes.push(logTerm("NoteGotBack", { what: concessionText(e.concession), by: e.by }));
    else if ( ["join", "leave", "sway", "flee", "callHelp"].includes(e.type) ) s.notes.push(logLine(e));
  }
  const end = result.log.find(e => e.type === "end");
  const summary = end ? endLine(end) : "";
  const rows = [];
  for ( const c of spec.combatants ) {
    if ( out.has(c.id) ) continue; // never took part
    const s = by.get(c.id);
    const final = result.units[c.id]?.final;
    const bits = [];
    for ( const [name, a] of s?.attacks ?? [] ) bits.push(`${a.uses}× ${name} (${a.hits} ${labels.hit}${a.crits ? `, ${a.crits} ${labels.crit}` : ""}${a.misses ? `, ${a.misses} ${labels.miss}` : ""})`);
    for ( const [name, a] of s?.spells ?? [] ) bits.push(`${a.uses}× ${name} (${a.hits} ${labels.hit}${a.misses ? `, ${a.misses} ${labels.resisted}` : ""})`);
    for ( const [name, n] of s?.buffs ?? [] ) bits.push(`${n}× ${name} (${labels.bolstered ?? "bolstered"})`);
    if ( s?.talks.tries ) bits.push(`${labels.talked} ${s.talks.tries}× (${s.talks.wins} ${labels.convincing})`);
    if ( s?.heals ) bits.push(`${labels.healed} ${s.heals}× (${logTerm("HpN", { n: s.healed })})`);
    if ( s?.potions ) bits.push(`${s.potions} ${labels.potion}`);
    if ( s?.aid ) bits.push(`${labels.firstAid} ${s.aid}× (${s.stabilized} ${labels.stabilized})`);
    if ( s?.feet ) bits.push(`${labels.moved} ${logTerm("Feet", { n: s.feet })}`);
    if ( !bits.length ) bits.push(final?.active === false ? labels.stayedOut : labels.nothing);
    const statusKey = final?.swayed === "switched" ? "switched" : final?.swayed === "conceded" ? "conceded"
      : final?.status === "standing" && final?.side === "neutralParty" ? (final.swayed === "neutral" ? "neutral" : "noSide") : final?.status;
    const status = final ? `${labels.status[statusKey] ?? statusKey}, ${logTerm("HpN", { n: `${final.hp}/${c.hp.max}` })}` : "";
    rows.push(`<li><strong>${esc(c.name)}</strong>: ${esc(bits.join("; "))}. <em>${esc(status)}</em>${s?.notes?.length ? ` <small>(${esc(s.notes.join("; "))})</small>` : ""}</li>`);
  }
  const html = `<p><strong>${esc(summary)}</strong></p><ul>${rows.join("")}</ul>`;
  return { title, html, text: [summary, ...rows.map(r => r.replace(/<[^>]+>/g, ""))].join("\n") };
}

/* -------------------------------------------- */
/*  Statistician                                */
/* -------------------------------------------- */

function statistician(result, spec, title, labels = DEFAULT_LABELS) {
  const { out, mentions } = storyCast(result, spec);
  const rounds = new Map();
  for ( const e of result.log ) {
    if ( !mentions(e) || e.type === "aftermath" ) continue;
    const key = e.aftermath ? "after" : e.round;
    if ( !rounds.has(key) ) rounds.set(key, []);
    rounds.get(key).push(logLine(e));
  }
  const parts = [];
  for ( const [round, lines] of rounds ) {
    const heading = round === "after" ? logTerm("Aftermath") : logTerm("RoundShort", { n: round });
    parts.push(`<p><strong>${heading}</strong></p><ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>`);
  }
  const finals = spec.combatants.filter(c => !out.has(c.id)).map(c => {
    const f = result.units[c.id]?.final;
    return f ? logTerm("FinalLine", {
      name: c.name, status: labels.status?.[f.status] ?? f.status, swayed: f.swayed ? logTerm("FinalSwayed", { how: labels.status?.[f.swayed] ?? f.swayed }) : "",
      hp: f.hp, max: c.hp.max, dying: f.dying ? logTerm("FinalDying", { n: f.dying }) : "", wounded: f.wounded ? logTerm("FinalWounded", { n: f.wounded }) : ""
    }) : c.name;
  });
  parts.push(`<p><strong>${esc(logTerm("Final"))}</strong></p><ul>${finals.map(l => `<li>${esc(l)}</li>`).join("")}</ul>`);
  return { title, html: parts.join(""), text: [...rounds.entries()].map(([r, ls]) => `${r === "after" ? logTerm("Aftermath") : logTerm("RoundShort", { n: r })}\n${ls.join("\n")}`).join("\n") };
}

/**
 * @param {object} result   runOne(..., {log: true, capture: true}) output
 * @param {object} spec     BattleSpec it came from
 * @param {string} style    roleplay | standard | statistician
 * @param {object} options  {tables, seed, title, labels, damageType: (systemType) => imagery family}
 */
export function buildStory(result, spec, style, { tables, seed = 1, title = "", labels = DEFAULT_LABELS, damageType = null } = {}) {
  if ( style === "statistician" ) return statistician(result, spec, title, labels);
  if ( style === "standard" ) return standard(result, spec, title, labels);
  return roleplay(result, spec, tables, seed, title, damageType);
}

export const DEFAULT_LABELS = {
  hit: "hit", crit: "critical", miss: "missed", resisted: "resisted", talked: "talked", convincing: "convincing",
  healed: "healed", potion: "potion(s)", firstAid: "first aid", bolstered: "bolstered", stabilized: "stabilized", moved: "moved", stayedOut: "stayed out of it", nothing: "did nothing of note",
  status: { standing: "standing", down: "down", dead: "dead", fled: "fled", surrendered: "surrendered", stoodDown: "stood down", conceded: "gave something up", switched: "switched sides", neutral: "stood aside", noSide: "took no side" }
};
