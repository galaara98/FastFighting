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
import { DAMAGE_TYPES } from "./blocks.js";
import { damageFamily } from "./families.js";
import { desireBand, DESIRE_BAND_KEYS } from "../engine/behavior/desire.js";
import { listJoin, listItems, localize, hasWords, distanceText, escapeHtml as esc } from "../i18n.js";
import { logLine, endLine, logTerm, formatMoney, concessionText } from "./log-lines.js";

export { formatMoney, concessionText };

export const STORY_STYLES = ["roleplay", "standard", "statistician"];

const SPELL_KINDS = new Set(["spell-attack", "save", "auto"]);

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


/**
 * The family an attack is told with (story/families.js): the one named for it when its sheet was read (by its helper,
 * or its name), else its damage's: a sword that deals void damage too withers its target; it isn't told as a cut.
 */
function damageTypeOf(e, mapType) {
  if ( e.storyType && DAMAGE_TYPES.includes(e.storyType) ) return e.storyType;
  return damageFamily(e.damageTypes?.length ? e.damageTypes : [e.damageType], mapType);
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
    this.asideTurns = new Set(); // "actor|turn": an aside told
    this.ducked = new Set();     // "target|turn": ducking into cover told
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

/** What gives a creature the chance to strike as it goes. */
const LEAVING = new Set(["move", "flee", "leave"]);

/**
 * The log in the order it's told: a reaction comes after what it answers. (A blow at one leaving its reach is
 * struck as it goes, so it's logged before the move: told after it, with whatever came of the blow.)
 */
export function tellingOrder(log = []) {
  const out = [...log];
  for ( let i = 0; i < out.length; i++ ) {
    const e = out[i];
    if ( e.type !== "opportunity" ) continue;
    const j = out.findIndex((m, k) => k > i && m.turn === e.turn && m.actorId === e.targetId && LEAVING.has(m.type));
    if ( j < 0 ) continue;
    // (The move first; then everything from the blow to the move: the blow, what came of it, and anyone else who
    // struck at it as it went.)
    const [move] = out.splice(j, 1);
    out.splice(i, 0, move);
    i = j;
  }
  return out;
}

/** How many of a table's latest lines are kept out of its next draw (fewer for a short table). */
const RECENT = 3;

function makeRoller(tables, seed) {
  const rng = createRng(seed >>> 0);
  const recent = new Map();
  const roll = (key, fill = {}) => {
    const entries = tables.get(key);
    if ( !entries?.length ) return "";
    // (The same line again soon after reads like a mistake: one not said lately, where the table has one.)
    const used = recent.get(key) ?? [];
    const fresh = entries.map((x, i) => i).filter(i => !used.includes(i));
    const pick = fresh.length ? fresh[Math.floor(rng.next() * fresh.length)] : Math.floor(rng.next() * entries.length);
    recent.set(key, [pick, ...used].slice(0, Math.min(RECENT, entries.length - 1)));
    const text = entries[pick] ?? "";
    return text.replace(/\{(\w+)\}/g, (m, k) => {
      const v = fill[k];
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
  // (Talking: only a nemesis in words is worth remarking on; a leader or a grudge is about blows.)
  if ( e.type === "talk" && kind !== "talkingNemesis" ) return "";
  if ( e.type !== "talk" && kind === "talkingNemesis" ) return "";
  const key = `${e.actorId}|${e.targetId}|${kind}`;
  const decisive = tier.startsWith("critical") || tier.startsWith("major");
  if ( rel.told.has(key) && !decisive ) return "";
  // (One aside a character a turn: a second reads like the first said again.)
  const turn = `${e.actorId}|${e.turn}`;
  if ( rel.asideTurns.has(turn) ) return "";
  rel.asideTurns.add(turn);
  rel.told.add(key);
  const clause = roll(`relationship.${kind}.${successful(tier) ? "success" : "failure"}`, fill).trim();
  return clause ? ` ${capital(clause)}` : "";
}

/** A blow that takes this much of its target's most hit points, or more, is a big one: it gets its emphasis too. */
const BIG_SHARE = 1 / 3;

/**
 * One more sentence after a big moment: a critical hit or win, or a blow that takes a big bite out of its target
 * (emphasis.<kind>: how bad the harm is, how well the words landed); or after a critical failure, how little came of it
 * (letdown.<kind>). `kind` is the damage type, or the way of talking. "" when there's none.
 */
function followUp(e, tier, roll, f, kind, maxHp) {
  let key = null;
  if ( tier === "criticalFailure" ) key = `letdown.${kind}`;
  else if ( tier === "criticalSuccess" ) key = `emphasis.${kind}`;
  else if ( successful(tier) && e.damage > 0 && e.targetId ) {
    const max = maxHp?.(e.targetId);
    if ( max > 0 && e.damage >= max * BIG_SHARE ) key = `emphasis.${kind}`;
  }
  const line = key ? roll(key, f).trim() : "";
  return line ? ` ${capital(line)}` : "";
}

function narrate(e, roll, rel, fill) {
  const base = { actor: e.actor, target: e.target ?? "", weapon: e.action ?? e.item ?? "", by: e.by ?? "", affliction: e.name ?? "" };
  const f = { ...base, ...fill };
  delete f.mapType;
  delete f.maxHp;
  switch ( e.type ) {
    case "attack":
    case "save":
    case "auto": {
      const tier = e.type === "save" ? saveTier(e) : e.type === "auto" ? "success" : tierOf(e.degree, e.margin);
      const type = damageTypeOf(e, fill.mapType);
      // (A family a translation hasn't written yet is told as plain harm.)
      let text = roll(`action.${type}.${tier}`, f) || roll(`action.untyped.${tier}`, f);
      if ( roll.lang === "en" ) text = agreeWithWeapon(text, f.weapon);
      if ( e.attackerCover && e.ranged && e.natural % 3 === 0 ) text = `${roll("event.coverShoot", f)} ${capital(text)}`;
      text += followUp(e, tier, roll, f, type, fill.maxHp);
      // (Precision damage, a sneak attack's: no look of its own, so it's told by how it came.)
      if ( e.precision && e.damage > 0 && successful(tier) ) {
        const line = roll("emphasis.precision", f).trim();
        if ( line ) text += ` ${capital(line)}`;
      }
      if ( e.targetCover && e.ranged && !successful(tier) && !rel.ducked.has(`${e.targetId}|${e.turn}`) ) {
        rel.ducked.add(`${e.targetId}|${e.turn}`);
        text += ` ${capital(roll("event.coverDuck", f))}`;
      }
      return text + relationshipClause(e, tier, rel, roll, f);
    }
    case "talk": {
      const tier = tierOf(e.degree, e.margin);
      const kind = e.kind ?? "persuade";
      // (A big moment in words: only a system whose checks can be critical has one.)
      return roll(`talk.${kind}.${tier}`, f) + followUp(e, tier, roll, f, kind) + relationshipClause(e, tier, rel, roll, f);
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
    // Beaten (out of the fight, however the table decides), or killed by one who would kill.
    case "beaten": return roll(e.killed ? "event.beatenKilled" : "event.beaten", { ...f, by: e.by ?? "" });
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
      if ( e.outcome === "bribed" ) return roll("event.bribed", { ...f, amount: concessionText(e.concession) || localize("FASTFIGHTING.Story.APrice"), target: e.payer ?? e.by ?? "" });
      if ( e.paidOff ) {
        const c = e.concession;
        return roll(!c ? "event.paidNothing" : c.kept ? "event.paidKept" : "event.paidOff", { ...f, amount: concessionText(c), item: c?.item?.name ?? "" });
      }
      if ( e.outcome === "conceded" ) {
        const c = e.concession;
        const key = !c ? "event.standDown" : c.kept ? "event.concedeKept" : { money: "event.concedeMoney", progress: "event.concedeProgress" }[c.kind] ?? "event.concedeItem";
        return roll(key, { ...f, amount: concessionText(c), item: c?.item?.name ?? "" });
      }
      if ( e.outcome === "switched" && e.recruit ) return roll("event.recruit", f);
      if ( e.outcome === "neutral" ) return roll(e.again ? "event.standAsideAgain" : "event.standAside", f);
      return roll({ surrendered: "event.surrender", fled: "event.swayFlee", switched: "event.switch", stoodDown: "event.standDown" }[e.outcome] ?? "event.surrender", f);
    }
    case "lastWord": return roll("event.lastWord", f);
    case "condition": return roll("event.conditionRider", { ...f, effect: e.effect ?? "" });
    case "control": {
      // (A playstyle's taunt has no name of its own: it's a taunt.)
      const g = e.goad ? { ...f, weapon: e.action || localize("FASTFIGHTING.Words.Taunt") } : f;
      if ( e.immune ) return roll("event.controlImmune", g);
      if ( e.backfired ) return roll("event.controlBackfire", { ...g, effect: e.effect ?? "" });
      // (Goaded: told as a taunt that lands, where there are words for it.)
      if ( e.taunt && e.took ) {
        const own = roll("event.taunted", { ...g, effect: e.effect ?? "" });
        if ( own ) return own;
      }
      // (Not risen to: shrugged off, or a playstyle's taunt that didn't get through.)
      if ( e.shrugged || (e.goad && !e.took) ) {
        const own = roll("event.tauntIgnored", g);
        if ( own ) return own;
      }
      return roll(e.took ? "event.controlTakes" : "event.controlResisted", { ...g, effect: e.effect ?? "" });
    }
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
    case "deed": return e.success ? roll("event.deed", { ...f, weapon: e.deed ?? "", effect: e.effect || logTerm("Reeling") }) : "";
    case "rider": return e.landed ? roll("event.riderTakes", { ...f, weapon: e.rider ?? "", effect: e.effect || logTerm("Reeling") }) : (e.tell ? roll(`event.${e.tell}`, f) : "");
    case "critTable": return !e.slain && e.effect ? roll("event.critEffect", { ...f, effect: e.effect }) : "";
    case "fumble": return e.effect ? roll("event.fumbleEffect", { ...f, effect: e.effect }) : roll("event.fumble", f);
    case "cast": return e.success ? "" : roll(e.lost ? "event.spellLost" : e.disapproved ? "event.disapproval" : "event.spellFails", f);
    case "boost": return roll(e.self ? "event.boost" : "event.boostFor", { ...f, label: e.label ?? localize("FASTFIGHTING.Words.Luck"), target: e.target ?? "" });
    case "fate": return roll(e.self ? "event.fateSelf" : "event.fateFor", { ...f, label: e.label ?? localize("FASTFIGHTING.Words.Fate"), target: e.target ?? "" });
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
    case "disengage": return e.made === false ? "" : roll("event.disengage", f); // (missed: the blows that follow tell it)
    case "afflictionStage": return roll("event.afflictionStage", f);
    case "afflictionEnd": return roll("event.afflictionEnd", f);
    case "step": return roll("event.step", f);
    case "surprise": return roll("event.surprise", f);
    case "aftermath": return roll(e.tended ? "event.aftermath" : "event.aftermathAlone", f);
    case "standoff": return roll("event.standoff", f);
    case "breakStandoff": return roll({ insulted: "event.breakInsulted", beast: "event.breakBeast", annoyed: "event.breakAnnoyed", blood: "event.breakBlood", unmet: "event.breakUnmet" }[e.cause] ?? "event.breakStandoff", f);
    case "collapse": return roll("event.collapse", f); // (only an argument: it would have come to blows)
    case "deal": {
      // A bargain: goods handed over, or a promise given, to end it.
      const c = e.concession;
      if ( e.promise ) return roll({ noHarm: "event.promiseNoHarm", passage: "event.promisePassage", leave: "event.promiseLeave" }[e.promise] ?? "event.promiseNoHarm", { ...f, by: e.target ?? "" });
      return roll({ money: "event.concedeMoney", progress: "event.concedeProgress" }[c?.kind] ?? "event.concedeItem", { ...f, by: e.target ?? "", amount: concessionText(c), item: c?.item?.name ?? "" });
    }
    case "haggle":
      // Talked down from what it expects (or out of it); a player character pressed for one of its things, keeping it.
      if ( e.what === "keeps" ) return roll("event.concedeKept", { ...f, item: e.item?.name ?? "", by: e.by ?? "" });
      return roll(e.what === "drops" ? "event.haggleDrop" : "event.haggleLower", { ...f, by: e.by ?? "" });
    // A spell answered with a spell: undone, or not.
    case "duel": return roll(e.outcome === "wins" || e.outcome === "both" ? "event.duelWin" : "event.duelLose", { ...f, target: e.target ?? "", spell: e.action ?? "" });
    // A shot into a melee that missed, straying toward the shooter's own friend.
    case "stray": return roll(e.hit ? "event.strayHit" : "event.strayMiss", { ...f, target: e.target ?? "" });
    case "peacekeep": return roll("event.peacekeep", f);
    case "firstAid": return roll(e.stable ? "event.firstAid" : e.dead ? "event.death" : "event.firstAidFail", f);
    default: return "";
  }
}

/**
 * An attack that repeats one made earlier in the turn, to the same end (the same weapon at the same foe, a hit
 * again or a miss again): told as doing it again, not as if it were the first. A critical hit or fumble is told in
 * full. Returns the line, or "" (told as usual). `done`: what each has done so far this turn.
 */
function againLine(e, done, roll) {
  if ( e.type !== "attack" ) return "";
  const how = e.degree === 2 ? "hit" : e.degree === 1 ? "miss" : null;
  const key = `${e.actorId}|${e.action}|${e.targetId}`;
  const before = done.get(key);
  done.set(key, how);
  if ( !how || before !== how ) return "";
  return roll(how === "hit" ? "event.againHit" : "event.againMiss", { actor: e.actor, target: e.target ?? "", weapon: e.action ?? e.item ?? "" });
}

/** How often a creature's first attack of its turn comes with a line on how far it was (distance.near / distance.far). */
const DISTANCE_CHANCE = 0.35;
/** What counts as an attack, for that. */
const STRIKES = new Set(["attack", "save", "auto"]);

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
    const verb = (self && roll(`desire.self.${d.kind}`)) || roll(`desire.verb.${d.kind}`, { target: self ? localize("FASTFIGHTING.Story.Themselves") : d.target });
    return intensity && verb ? localize("FASTFIGHTING.Story.Desire", { intensity, verb }) : "";
  };
  const first = phrase(desires[0]);
  if ( !first ) return "";
  // (Both at the very top, "can think only of" twice, contradicts itself: the first alone.)
  const top = DESIRE_BAND_KEYS.length - 1;
  const both = desires[1] && !(desireBand(desires[0].level) === top && desireBand(desires[1].level) === top);
  const second = both ? phrase(desires[1]) : "";
  return second ? roll("event.thoughtTwo", { actor: e.actor, first, second }) : roll("event.thoughtOne", { actor: e.actor, first });
}

function roleplay(result, spec, tables, seed, title, mapType) {
  const paragraphs = roleplayParagraphs(result, spec, tables, seed, mapType).map(p => p.text ?? p.sentences.map(x => x.text).join(" ")).filter(Boolean);
  return { title, html: paragraphs.map(p => `<p>${esc(p)}</p>`).join(""), text: paragraphs.join("\n\n") };
}

/**
 * The Roleplay telling, as paragraphs: the opening line ({text}), a round's sentences ({round, sentences: [{e,
 * text}]}, each with the event it tells), and the ending ({e, text}).
 */
/**
 * Deaths that didn't stand: a character's own fate turned them back at once (PF2e Heroic Recovery), so only that's
 * told. (Any other fate rolls the blow again, and its death isn't in the log.)
 */
function avertedDeaths(log) {
  const out = new Set();
  log.forEach((e, i) => {
    if ( e.type !== "fate" || !e.self ) return;
    for ( let k = i - 1; k >= 0 && log[k].turn === e.turn; k-- ) {
      const d = log[k];
      if ( d.actorId === e.actorId && (d.type === "death" || (d.type === "recovery" && d.dead)) ) {
        out.add(d);
        break;
      }
    }
  });
  return out;
}

/**
 * How the story calls each creature: by its name, or, for one known by what it is (spec.generic: "Goblin Warrior"),
 * as the language puts that ("the Goblin Warrior"). An event's names, told that way.
 */
function storyNames(spec) {
  const generic = new Set((spec.combatants ?? []).filter(c => c.generic).map(c => c.name));
  const call = name => (typeof name === "string" && generic.has(name) ? localize("FASTFIGHTING.Story.TheName", { name }) : name);
  const named = e => {
    if ( !generic.size ) return e;
    const out = { ...e };
    for ( const [k, v] of Object.entries(e) ) {
      if ( typeof v === "string" ) out[k] = call(v);
      else if ( Array.isArray(v) && v.some(x => typeof x === "string") ) out[k] = v.map(call);
    }
    if ( Array.isArray(e.desires) ) out.desires = e.desires.map(d => ({ ...d, target: call(d.target) }));
    return out;
  };
  return { call, named };
}

function roleplayParagraphs(result, spec, tables, seed, mapType) {
  const roll = makeRoller(tables, seed);
  const averted = avertedDeaths(result.log ?? []);
  const { call, named } = storyNames(spec);
  const most = new Map((spec.combatants ?? []).map(c => [c.id, c.hp?.max ?? null]));
  const maxHp = id => most.get(id) ?? null;
  const moment = createRng((seed + 7919) >>> 0); // when someone pauses to think
  const lastThought = new Map();
  const lastShield = new Map();
  const reach = createRng((seed + 104729) >>> 0); // when a first attack says how far it was
  const struck = new Set(); // "actor|turn": its first attack this turn told
  const closed = new Set(); // "actor|turn": it moved this turn (closing in is told already)
  const rel = new Relationships(spec);
  const { mentions } = storyCast(result, spec);
  const paragraphs = [];
  const opening = result.log.find(e => e.type === "surprise" || e.type === "standoff") ? null : roll("event.opening");
  if ( opening ) paragraphs.push({ text: opening });
  let current = null;
  let lastMoveKey = null;
  const done = new Map();
  let doneTurn = null;
  for ( const logged of tellingOrder(result.log) ) {
    if ( logged.type === "initiative" || !mentions(logged) || averted.has(logged) ) continue;
    // (Told with each creature called as the story calls it; the sentence keeps the event it tells.)
    const e = named(logged);
    if ( e.turn !== doneTurn ) {
      done.clear();
      doneTurn = e.turn;
    }
    // The outcome comes where the fighting stops; anything after it (tending the fallen) follows.
    if ( e.type === "end" ) {
      paragraphs.push({ e: logged, text: ending(result, spec, e, roll, call) });
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
    // (Raising a shield every round: told once, and again only after a round without it.)
    if ( e.type === "shield" ) {
      const last = lastShield.get(e.actorId);
      lastShield.set(e.actorId, e.round);
      if ( last !== undefined && last >= e.round - 1 ) continue;
    }
    if ( e.type === "thought" ) {
      if ( (lastThought.get(e.actorId) ?? -9) >= e.round - 1 || moment.next() > THOUGHT_CHANCE ) continue;
      const thought = thinkAloud(e, roll, mentions);
      if ( thought ) {
        lastThought.set(e.actorId, e.round);
        current.sentences.push({ e: logged, text: capital(thought.trim()) });
      }
      continue;
    }
    if ( e.type === "move" ) closed.add(`${e.actorId}|${e.turn}`);
    // Now and then, a creature's first attack of its turn says how far it was: from afar, or up close (unless it just
    // closed in, which said so).
    let lead = "";
    if ( STRIKES.has(e.type) && e.targetId && !struck.has(`${e.actorId}|${e.turn}`) ) {
      struck.add(`${e.actorId}|${e.turn}`);
      const near = !e.ranged;
      if ( reach.next() < DISTANCE_CHANCE && !(near && closed.has(`${e.actorId}|${e.turn}`)) ) {
        lead = roll(near ? "distance.near" : "distance.far", { actor: e.actor, target: e.target ?? "", weapon: e.action ?? "" }).trim();
      }
    }
    const told = againLine(e, done, roll) || narrate(e, roll, rel, { mapType, maxHp });
    const sentence = lead && told ? `${capital(lead)} ${capital(told.trim())}` : told;
    rel.record(e);
    if ( sentence ) current.sentences.push({ e: logged, text: capital(sentence.trim()) });
  }
  return paragraphs;
}

/** The closing line, naming the survivors rather than the side. */
function ending(result, spec, end, roll, call = name => name) {
  const standing = spec.combatants.filter(c => end.winners?.includes(result.units[c.id]?.final?.side ?? c.side)
    && result.units[c.id]?.final?.status === "standing" && result.units[c.id]?.final?.active !== false).map(c => call(c.name));
  const winners = standing.length > 3 ? localize("FASTFIGHTING.Story.Companions", { names: listItems(standing.slice(0, 2)) })
    : standing.length ? listJoin(standing) : listJoin(end.winnerLabels ?? []);
  // A lone survivor takes a singular verb ("Lini prevails").
  if ( end.resolved === "collapsed" ) return roll("event.talksCollapse", { winners });
  // Only an argument, agreed on a promise: no harm (a truce), safe passage, or one side leaving.
  if ( end.resolved === "truce" ) return roll("event.agreedNoHarm", { winners });
  if ( end.resolved === "passage" ) return roll("event.agreedPassage", { winners });
  if ( end.resolved === "leave" ) return roll("event.agreedLeave", { winners });
  if ( end.resolved === "conceded" ) return roll("event.dealStruck", { winners });
  if ( end.resolved === "fled" ) return roll("event.backedOff", { winners });
  if ( end.peaceful ) return roll("event.peace", { winners });
  if ( end.outcome === "stalemate" && end.standoff ) return roll("event.talksStall", { winners });
  const victory = standing.length === 1 ? "event.victoryOne" : "event.victory";
  // Nobody's side left, but someone who took no side (and then turned on one) still stands.
  if ( end.outcome === "none" ) {
    const last = spec.combatants.filter(c => result.units[c.id]?.final?.status === "standing" && result.units[c.id]?.final?.side === "neutralParty"
      && result.units[c.id]?.final?.against?.length).map(c => call(c.name));
    if ( last.length ) return roll("event.lastStanding", { winners: listJoin(last) });
  }
  return roll(end.outcome === "victory" ? victory : end.outcome === "none" ? "event.noOne" : "event.stalemate", { winners });
}

/* -------------------------------------------- */
/*  Standard                                    */
/* -------------------------------------------- */

const labelWord = (key, data = null) => localize(`FASTFIGHTING.Story.Labels.${key}`, data);

/** What each did in these events (by actor id, in the order they first act): attacks, spells, talking, healing, moves. */
function tally(events, mentions) {
  const by = new Map();
  const entry = e => {
    if ( !by.has(e.actorId) ) by.set(e.actorId, { name: e.actor, attacks: new Map(), spells: new Map(), buffs: new Map(), talks: { tries: 0, wins: 0 }, heals: 0, healed: 0, potions: 0, aid: 0, stabilized: 0, feet: 0, damage: 0, notes: [] });
    return by.get(e.actorId);
  };
  for ( const e of events ) {
    if ( !e.actorId || !mentions(e) ) continue;
    const s = entry(e);
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
  return by;
}

/** One tally as its parts: "2× Longsword (1 hit, 1 missed)", "moved 20 ft". */
function tallyBits(s) {
  const w = labelWord;
  const bits = [];
  const results = list => list.filter(Boolean).join(localize("FASTFIGHTING.Words.ListSeparator"));
  for ( const [name, a] of s?.attacks ?? [] ) {
    bits.push(w("Uses", { n: a.uses, name, results: results([w("Hits", { n: a.hits }), a.crits ? w("Crits", { n: a.crits }) : "", a.misses ? w("Misses", { n: a.misses }) : ""]) }));
  }
  for ( const [name, a] of s?.spells ?? [] ) {
    bits.push(w("Uses", { n: a.uses, name, results: results([w("Hits", { n: a.hits }), a.misses ? w("Resisted", { n: a.misses }) : ""]) }));
  }
  for ( const [name, n] of s?.buffs ?? [] ) bits.push(w("Bolstered", { n, name }));
  if ( s?.talks.tries ) bits.push(w("Talked", { n: s.talks.tries, wins: s.talks.wins }));
  if ( s?.heals ) bits.push(w("Healed", { n: s.heals, hp: logTerm("HpN", { n: s.healed }) }));
  if ( s?.potions ) bits.push(w("Potions", { n: s.potions }));
  if ( s?.aid ) bits.push(w("FirstAid", { n: s.aid, stabilized: s.stabilized }));
  if ( s?.feet ) bits.push(w("Moved", { distance: distanceText(s.feet) }));
  return bits;
}

function standard(result, spec, title) {
  const w = labelWord;
  const { out, mentions } = storyCast(result, spec);
  const by = tally(result.log, mentions);
  const end = result.log.find(e => e.type === "end");
  const summary = end ? endLine(end) : "";
  const rows = [];
  for ( const c of spec.combatants ) {
    if ( out.has(c.id) ) continue; // never took part
    const s = by.get(c.id);
    const final = result.units[c.id]?.final;
    const bits = tallyBits(s);
    if ( !bits.length ) bits.push(final?.active === false ? w("StayedOut") : w("Nothing"));
    const statusKey = final?.swayed === "switched" ? "switched" : final?.swayed === "conceded" ? "conceded"
      : final?.status === "standing" && final?.side === "neutralParty" ? (final.swayed === "neutral" ? "neutral" : "noSide") : final?.status;
    const status = final ? w("Status", { status: statusWord(statusKey), hp: logTerm("HpN", { n: `${final.hp}/${c.hp.max}` }) }) : "";
    rows.push(`<li><strong>${esc(c.name)}</strong>: ${esc(bits.join("; "))}. <em>${esc(status)}</em>${s?.notes?.length ? ` <small>(${esc(s.notes.join("; "))})</small>` : ""}</li>`);
  }
  const html = `<p><strong>${esc(summary)}</strong></p><ul>${rows.join("")}</ul>`;
  return { title, html, text: [summary, ...rows.map(r => r.replace(/<[^>]+>/g, ""))].join("\n") };
}

/* -------------------------------------------- */
/*  Statistician                                */
/* -------------------------------------------- */

function statistician(result, spec, title) {
  const { out, mentions } = storyCast(result, spec);
  const rounds = new Map();
  for ( const e of tellingOrder(result.log) ) {
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
      name: c.name, status: statusWord(f.status), swayed: f.swayed ? logTerm("FinalSwayed", { how: statusWord(f.swayed) }) : "",
      now: f.hp, max: c.hp.max, dying: f.dying ? logTerm("FinalDying", { n: f.dying }) : "", wounded: f.wounded ? logTerm("FinalWounded", { n: f.wounded }) : ""
    }) : c.name;
  });
  parts.push(`<p><strong>${esc(logTerm("Final"))}</strong></p><ul>${finals.map(l => `<li>${esc(l)}</li>`).join("")}</ul>`);
  return { title, html: parts.join(""), text: [...rounds.entries()].map(([r, ls]) => `${r === "after" ? logTerm("Aftermath") : logTerm("RoundShort", { n: r })}\n${ls.join("\n")}`).join("\n") };
}

/**
 * @param {object} result   runOne(..., {log: true, capture: true}) output
 * @param {object} spec     BattleSpec it came from
 * @param {string} style    roleplay | standard | statistician
 * @param {object} options  {tables, seed, title, damageType: (systemType) => imagery family}
 */
export function buildStory(result, spec, style, { tables, seed = 1, title = "", damageType = null } = {}) {
  if ( style === "statistician" ) return statistician(result, spec, title);
  if ( style === "standard" ) return standard(result, spec, title);
  return roleplay(result, spec, tables, seed, title, damageType);
}

/** The words of a piece of the story as plain text: its HTML read back, tags gone and characters as they are. */
const UNESCAPES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'" };
const plainText = html => html.replace(/<\/?(strong|em|small|b|i)>/g, "").replace(/<[^>]+>/g, " ").replace(/&(amp|lt|gt|quot|#39);/g, m => UNESCAPES[m]).replace(/\s+/g, " ").trim();

/**
 * Each creature's name in bold, in a piece of the story already escaped for HTML (for the chat cards): everyone the
 * fight names, the summoned too. A longer name wins over one it contains ("Goblin Warrior" over "Goblin").
 */
function nameBolder(result, spec) {
  const names = new Set((spec.combatants ?? []).map(c => c.name));
  for ( const e of result.log ?? [] ) {
    if ( e.actorId && e.actor ) names.add(e.actor);
    if ( e.targetId && e.target ) names.add(e.target);
  }
  const list = [...names].filter(Boolean).map(n => esc(n)).sort((a, b) => b.length - a.length)
    .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if ( !list.length ) return html => html;
  // (A whole name, not part of a word, and never inside an escaped character such as &#39;.)
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}&#])(?:${list.join("|")})(?![\\p{L}\\p{N}])`, "gu");
  return html => html.replace(pattern, m => `<strong>${m}</strong>`);
}

/** Falls, told in a Standard turn after what everyone did. */
const FALLS = new Set(["down", "death", "beaten", "struckDown"]);

/**
 * What a creature can do on its turn and still only be talking (the others' answers, such as being talked round,
 * don't count): with nothing else, its turn is said aloud, as its own words in the chat.
 */
const TALKING = new Set(["talk", "parley", "haggle", "deal", "callHelp", "lastWord", "rally", "retreat", "command", "thought", "standoff"]);

/**
 * The story as it's told in the chat, one turn at a time: a beat for each turn of the fight (the opening's first),
 * and a closing one (how it ended, and the aftermath). Each beat is {turns, round, actorId, html, text, closing,
 * talking}: `turns` are the log's turns it tells, whose moves play on the map with it (a beat with nothing to say,
 * html "", still has its moves); `talking`, a turn its creature spent only talking. Roleplay and Standard only (the
 * Statistician's account is one card).
 * @param {object} result   runOne(..., {log: true, capture: true}) output
 * @param {object} spec     BattleSpec it came from
 * @param {string} style    roleplay | standard
 * @param {object} options  {tables, seed, damageType} as for buildStory
 */
export function storyBeats(result, spec, style, { tables, seed = 1, damageType = null } = {}) {
  const log = tellingOrder(result.log);
  const end = log.find(e => e.type === "end");
  const endTurn = end ? (end.turn ?? 0) : Infinity;
  const keyOf = e => ((e?.turn ?? 0) >= endTurn ? "closing" : (e?.turn ?? 0));
  // Every turn in the log, in order, with whose it is; whatever comes from the end on is the closing beat's.
  const beats = [];
  const byTurn = new Map();
  for ( const e of log ) {
    const key = keyOf(e);
    if ( !byTurn.has(key) ) {
      const closing = key === "closing";
      const beat = { turns: [], round: e.round, actorId: closing ? null : (e.turnOf ?? null), closing, parts: [], events: [] };
      byTurn.set(key, beat);
      beats.push(beat);
    }
    const beat = byTurn.get(key);
    if ( !beat.turns.includes(e.turn ?? 0) ) beat.turns.push(e.turn ?? 0);
    beat.events.push(e);
  }
  const bold = nameBolder(result, spec);
  if ( style === "standard" ) {
    const { mentions } = storyCast(result, spec);
    for ( const beat of beats ) {
      if ( beat.closing ) continue;
      const rows = [];
      for ( const s of tally(beat.events, mentions).values() ) {
        const bits = tallyBits(s);
        if ( !bits.length && !s.notes.length ) continue;
        const notes = s.notes.length ? ` <small>(${bold(esc(s.notes.join("; ")))})</small>` : "";
        rows.push(`<li><strong>${esc(s.name)}</strong>: ${bold(esc(bits.join("; ")))}${notes}</li>`);
      }
      for ( const e of beat.events ) if ( FALLS.has(e.type) && mentions(e) ) rows.push(`<li>${bold(esc(logLine(e)))}</li>`);
      if ( rows.length ) beat.parts.push(`<ul>${rows.join("")}</ul>`);
    }
    // The close: the whole fight's tally, and where everyone ended up.
    const close = byTurn.get("closing");
    if ( close ) close.parts.push(standard(result, spec, "").html);
  } else {
    let opening = null;
    for ( const p of roleplayParagraphs(result, spec, tables, seed, damageType) ) {
      if ( p.sentences ) for ( const x of p.sentences ) byTurn.get(keyOf(x.e))?.parts.push(x.text);
      else if ( p.e ) byTurn.get(keyOf(p.e))?.parts.push(p.text);
      else opening = p.text;
    }
    // (The opening line comes first, before anything: with what's said before the first turn, or on its own.)
    if ( opening ) {
      const first = byTurn.get(0);
      if ( first ) first.parts.unshift(opening);
      else beats.unshift({ turns: [], round: 0, actorId: null, closing: false, parts: [opening], events: [] });
    }
    for ( const beat of beats ) beat.parts = beat.parts.length ? [`<p>${bold(beat.parts.map(esc).join(" "))}</p>`] : [];
  }
  return beats.map(({ turns, round, actorId, closing, parts, events }) => {
    const html = parts.join("");
    const own = events.filter(e => e.actorId && e.actorId === actorId);
    const talking = !!actorId && own.some(e => e.type !== "thought") && own.every(e => TALKING.has(e.type));
    return { turns, round, actorId, closing, talking, html, text: plainText(html) };
  });
}

/** Where a creature ended up ("standing", "stood down"), in the reader's language. */
const statusWord = key => (hasWords(`FASTFIGHTING.Status.${key}`) ? localize(`FASTFIGHTING.Status.${key}`) : key ?? "");
