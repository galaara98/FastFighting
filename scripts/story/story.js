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

export const STORY_STYLES = ["roleplay", "standard", "statistician"];

const SPELL_KINDS = new Set(["spell-attack", "save", "auto"]);
const DEGREE = ["critical failure", "failure", "success", "critical success"];

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
const capital = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const signed = n => (n >= 0 ? `+${n}` : `${n}`);
/** Money in the system's coins, largest first ("1 gp, 4 sp"), from an amount in its smallest coin. */
export function formatMoney(amount, denominations) {
  if ( !denominations?.length ) return String(amount);
  const parts = [];
  let left = Math.round(amount);
  for ( const d of denominations ) {
    const n = Math.floor(left / d.value);
    if ( n > 0 ) { parts.push(`${n} ${d.label}`); left -= n * d.value; }
  }
  return parts.join(", ") || `0 ${denominations.at(-1).label}`;
}

/** What a creature handed over, in words. */
export function concessionText(c) {
  if ( !c ) return "";
  return c.kind === "money" ? formatMoney(c.amount, c.denominations) : (c.item?.name ?? "");
}

const listJoin = names => names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

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
    this.leaders = new Set(Object.values(spec.sides ?? {}).map(s => s.leaderId).filter(Boolean));
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
  return (key, fill = {}) => {
    const entries = tables.get(key);
    if ( !entries?.length ) return "";
    const text = entries[Math.floor(rng.next() * entries.length)] ?? "";
    return text.replace(/\{(\w+)\}/g, (m, k) => (fill[k] !== undefined && fill[k] !== null ? fill[k] : m));
  };
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
      text = agreeWithWeapon(text, f.weapon);
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
    case "flee": return roll(e.feet ? `move.${e.mode === "fly" ? "fly" : "walk"}.flee` : "event.flee", f);
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
    case "study": return roll("event.study", f);
    case "parley": return roll("event.parley", f);
    case "callHelp": return roll("event.callHelp", { ...f, target: e.toward });
    case "notice": return roll({ sight: "event.noticeSight", sound: "event.noticeSound", fledInto: "event.noticeFled", help: "event.noticeHelp", attacked: "event.noticeAttacked", standoff: "event.noticeStandoff" }[e.cause] ?? "event.noticeSound", f);
    case "join": return roll(e.why === "forced" ? "event.joinForced" : "event.join", f);
    case "watch": return roll("event.watch", f);
    case "leave": return roll("event.leave", f);
    case "sway": {
      if ( e.lie ) return roll("event.lieAndRun", f);
      if ( e.outcome === "conceded" ) {
        const c = e.concession;
        const key = !c ? "event.standDown" : c.kept ? "event.concedeKept" : c.kind === "money" ? "event.concedeMoney" : "event.concedeItem";
        return roll(key, { ...f, amount: concessionText(c), item: c?.item?.name ?? "" });
      }
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
      if ( !others.length ) return roll("event.buffSelf", fill);
      if ( e.withSelf ) return roll("event.buffWithSelf", fill);
      return roll(others.length > 1 ? "event.buffMany" : "event.buffOne", fill);
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
    case "breakStandoff": return roll({ insulted: "event.breakInsulted", beast: "event.breakBeast" }[e.cause] ?? "event.breakStandoff", f);
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
    const target = d.targetId === e.actorId ? "themselves" : d.target;
    const intensity = roll(`desire.intensity.${DESIRE_BAND_KEYS[desireBand(d.level)]}`);
    const verb = roll(`desire.verb.${d.kind}`, { target });
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
  const winners = standing.length > 3 ? `${standing.slice(0, 2).join(", ")} and their companions` : standing.length ? listJoin(standing) : (end.winnerLabels ?? []).join(" and ");
  // A lone survivor takes a singular verb ("Lini prevails").
  if ( end.resolved === "conceded" ) return roll("event.dealStruck", { winners });
  if ( end.resolved === "fled" ) return roll("event.backedOff", { winners });
  if ( end.peaceful ) return roll("event.peace", { winners });
  if ( end.outcome === "stalemate" && end.standoff ) return roll("event.talksStall", { winners });
  const victory = standing.length === 1 ? "event.victoryOne" : "event.victory";
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
      s.notes.push(e.stolen ? `stole ${concessionText(e.stolen)} from ${e.target}` : e.noticed ? `caught stealing from ${e.target}` : `came away empty-handed from ${e.target}`);
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
      s.notes.push(c.kept ? `kept ${concessionText(c)} (luck ${c.luck})` : `gave ${concessionText(c)} to ${c.toName}`);
    } else if ( e.type === "reclaim" ) s.notes.push(`got back ${concessionText(e.concession)} from ${e.by}`);
    else if ( ["join", "leave", "sway", "flee", "callHelp"].includes(e.type) ) s.notes.push(e.text);
  }
  const end = result.log.find(e => e.type === "end");
  const summary = end?.text ?? "";
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
    if ( s?.heals ) bits.push(`${labels.healed} ${s.heals}× (${s.healed} HP)`);
    if ( s?.potions ) bits.push(`${s.potions} ${labels.potion}`);
    if ( s?.aid ) bits.push(`${labels.firstAid} ${s.aid}× (${s.stabilized} ${labels.stabilized})`);
    if ( s?.feet ) bits.push(`${labels.moved} ${s.feet} ft`);
    if ( !bits.length ) bits.push(final?.active === false ? labels.stayedOut : labels.nothing);
    const statusKey = final?.swayed === "switched" ? "switched" : final?.swayed === "conceded" ? "conceded" : final?.status;
    const status = final ? `${labels.status[statusKey] ?? statusKey}, ${final.hp}/${c.hp.max} HP` : "";
    rows.push(`<li><strong>${esc(c.name)}</strong>: ${esc(bits.join("; "))}. <em>${esc(status)}</em>${s?.notes?.length ? ` <small>(${esc(s.notes.join("; "))})</small>` : ""}</li>`);
  }
  const html = `<p><strong>${esc(summary)}</strong></p><ul>${rows.join("")}</ul>`;
  return { title, html, text: [summary, ...rows.map(r => r.replace(/<[^>]+>/g, ""))].join("\n") };
}

/* -------------------------------------------- */
/*  Statistician                                */
/* -------------------------------------------- */

function statLine(e) {
  const roll = (nat, mod, total, dc, label, faces = 20) => `d${faces ?? 20} ${nat} ${signed(mod)} = ${total} vs ${label} ${dc}`;
  switch ( e.type ) {
    case "attack":
      return `${e.actor} → ${e.target}: ${e.action} · ${roll(e.natural, e.mod, e.total, e.dc, "AC", e.faces)}${e.deed !== null && e.deed !== undefined ? ` (deed ${e.deed})` : ""} · ${DEGREE[e.degree]} (${signed(e.margin)})${e.damage ? ` · ${e.damage} ${e.damageType}` : ""}${e.attackNumber > 1 ? ` · attack #${e.attackNumber}` : ""}${e.riders?.length ? ` · ${e.riders.join(", ")}` : ""}${e.critRoll !== null && e.critRoll !== undefined ? ` · crit table ${e.critRoll}` : ""}`;
    case "deed": return `${e.actor} → ${e.target}: ${e.deed} · deed ${e.roll} · ${e.success ? (e.effect || "succeeds") : "fails"}`;
    case "rider": {
      const mended = Number.isFinite(e.roll) ? ` · +${e.roll}, ${e.made ? "now a hit" : "still a miss"}` : "";
      const saved = e.saveType ? ` · ${e.saveType} d20 ${e.natural} = ${e.total} vs DC ${e.dc} · ${DEGREE[e.degree]}` : "";
      return `${e.actor} → ${e.target}: ${e.rider}${mended}${saved}${e.effect ? ` · ${e.effect}` : ""}`;
    }
    case "critTable": return `${e.by} → ${e.actor}: crit table ${e.roll}${e.slain ? " · slain outright" : ""}${e.effect ? ` · ${e.effect}` : ""}${e.rowText ? ` (${e.rowText})` : ""}`;
    case "fumble": return `${e.actor}: fumble table ${e.roll}${e.effect ? ` · ${e.effect}` : ""}${e.rowText ? ` (${e.rowText})` : ""}`;
    case "cast": {
      const how = e.success ? `works (result ${(e.tier ?? 0) + 1})`
        : `${e.fumble ? "fumble" : e.disapproved ? "disapproval" : "fails"}${e.lost ? ", spell lost" : ""}${e.disapproval ? ` (disapproval ${e.disapproval})` : ""}`;
      return `${e.actor}: ${e.action} · d${e.faces ?? 20} ${e.natural} ${signed(e.mod)} = ${e.total} · ${how}`;
    }
    case "boost": return `${e.actor} burns ${e.spent} ${e.label}${e.self ? "" : ` for ${e.target}`}: ${e.from} → ${e.to} vs ${e.dc} · ${e.made ? "made it" : "still short"}`;
    case "save":
      return `${e.target} saves vs ${e.actor}'s ${e.action} · ${e.saveType} ${roll(e.natural, e.mod, e.total, e.dc, "DC")} · ${DEGREE[e.degree]} (${signed(e.margin)}) · ${e.damage} ${e.damageType}`;
    case "auto": return `${e.actor} → ${e.target}: ${e.action} (no roll) · ${e.damage} ${e.damageType}`;
    case "talk":
      return `${e.actor} → ${e.target}: ${e.skill} · ${roll(e.natural, e.mod, e.total, e.dc, `${e.dcStat} DC`)} · ${DEGREE[e.degree]} (${signed(e.margin)}) · persuasion ${e.progress}/${e.steps}`;
    case "heal":
      return `${e.actor} → ${e.self ? "self" : e.target}: ${e.action}${e.check ? ` · medicine ${roll(e.check.natural, e.check.mod, e.check.total, e.check.dc, "DC")} · ${DEGREE[e.check.degree]}` : ""} · +${e.amount} HP${e.revived ? " · revived" : ""}`;
    case "move": return `${e.actor} ${{ walk: "walks", fly: "flies", swim: "swims", climb: "climbs", burrow: "burrows" }[e.mode] ?? "moves"} ${e.feet} ft toward ${e.toward}${e.mult > 1.05 ? ` (terrain ×${e.mult.toFixed(2)}${e.regions?.length ? `: ${e.regions.join(", ")}` : ""})` : ""}`;
    case "afflictionSave": return `${e.actor} vs ${e.name} · ${e.saveType} ${roll(e.natural, e.mod, e.total, e.dc, "DC")} · ${DEGREE[e.degree]}`;
    case "opportunity": return `${e.actor} → ${e.target}: opportunity attack (reaction)`;
    case "disengage": return `${e.actor}: ${e.label || "disengages"}`;
    case "door": return `${e.actor} → the door: ${e.method}${e.natural !== undefined ? ` · ${roll(e.natural, e.mod, e.total, e.dc, e.method === "attack" ? "AC" : "DC")}` : ""}${e.method === "attack" && e.hit ? ` · ${e.damage} damage` : ""} · ${e.method === "giveup" ? `gives up on ${e.target}` : e.success ? "open" : "holds"}`;
    case "thought": return `${e.actor} thinks: ${(e.desires ?? []).map(d => `${d.kind} ${d.targetId === e.actorId ? "self" : d.target} ${d.level}`).join(" · ")}`;
    case "riderSave": return `${e.actor} vs ${e.name} · ${e.saveType} ${roll(e.natural, e.mod, e.total, e.dc, "DC")} · ${DEGREE[e.degree]}${e.damage ? ` · ${e.damage} damage` : ""}`;
    case "notice": return `${e.actor} notices (${e.cause})`;
    case "firstAid": return `${e.actor} → ${e.target}: first aid · medicine ${roll(e.natural, e.mod, e.total, e.dc, "DC")} · ${DEGREE[e.degree]} · ${e.stable ? "stabilized" : e.dead ? "dies" : `dying ${e.dying}`}`;
    case "aftermath": return "After the fight";
    case "control": {
      if ( e.immune ) return `${e.actor} → ${e.target}: ${e.action} · unaffected`;
      const how = e.roll === "auto" ? "no roll"
        : e.roll === "check" ? `${roll(e.natural, e.mod, e.total, e.dc, `${e.against ?? "defense"} DC`)} · ${DEGREE[e.degree]}`
          : `${e.saveType ? `${[].concat(e.saveType).join("/")} ` : ""}${roll(e.natural, e.mod, e.total, e.dc, e.saveType ? "DC" : "AC")} · ${DEGREE[e.degree]}`;
      return `${e.actor} → ${e.target}: ${e.action} · ${how}${e.shifted ? " (shifted)" : ""} · ${e.effect || "no effect"}${e.backfired ? ` (on ${e.actor})` : ""}${e.damage ? ` · ${e.damage} damage` : ""}`;
    }
    case "buff": return `${e.actor} → ${(e.targets ?? []).map((n, i) => (e.targetIds?.[i] === e.actorId ? "self" : n)).join(", ")}: ${e.action} · ${e.effect || "bolstered"}${e.tempHp ? ` · ${e.tempHp} temp HP` : ""}`;
    case "concentrationEnd":
      if ( e.reason === "switch" ) return `${e.actor} lets ${(e.effects ?? []).join(", ")} go`;
      return `${e.actor} loses concentration on ${e.action}${e.natural !== undefined ? ` · ${e.saveType} ${roll(e.natural, e.mod, e.total, e.dc, "DC")}` : " (can't act)"}`;
    case "shakeOff": return `${e.actor} shakes off ${e.effect} · ${e.saveType} ${roll(e.natural, e.mod, e.total, e.dc, "DC")}`;
    case "execute": return `${e.actor} → ${e.target}: execution luck d100 ${e.luck} (${e.needed} or less) · ${e.goes ? "goes for the kill" : `spares them${e.next ? `, turns on ${e.next}` : ""}`}`;
    case "allegiance": return e.joined ? `${e.actor} fights for ${e.by}'s side (controlled)` : `${e.actor} returns to ${e.homeLabel}`;
    case "theft": {
      // The luck check against a PC is the GM's secret, so it never appears here.
      const feint = e.feint ? `feint ${e.feint.weapon} · ${roll(e.feint.natural, e.feint.mod, e.feint.total, e.feint.ac, "AC")} · ${e.feint.hit ? "hit, no damage" : "miss"}` : "";
      if ( e.feint && !e.feint.hit ) return `${e.actor} → ${e.target}: ${feint}`;
      return `${e.actor} → ${e.target}: ${feint ? `${feint} · ` : ""}${e.skill} · ${roll(e.natural, e.mod, e.total, e.dc, `${e.dcStat} DC`)} · ${DEGREE[e.degree]} · ${e.stolen ? `steals ${concessionText(e.stolen)}` : e.noticed ? "caught" : "nothing taken"}`;
    }
    case "reclaim": return `${e.actor} gets back ${concessionText(e.concession)} from ${e.by}`;
    case "sway":
      if ( !e.concession ) return `${e.actor}: ${e.text}`;
      return e.concession.kept
        ? `${e.actor} agrees to hand over ${concessionText(e.concession)} · luck d100 ${e.concession.luck} (needs ${e.concession.needed ?? 39} or less) · keeps it`
        : `${e.actor} gives ${concessionText(e.concession)} to ${e.concession.toName}${e.concession.luck ? ` · luck d100 ${e.concession.luck}` : ""}`;
    default: return `${e.actor ? `${e.actor}: ` : ""}${e.text}`;
  }
}

function statistician(result, spec, title) {
  const { out, mentions } = storyCast(result, spec);
  const rounds = new Map();
  for ( const e of result.log ) {
    if ( !mentions(e) || e.type === "aftermath" ) continue;
    const key = e.aftermath ? "after" : e.round;
    if ( !rounds.has(key) ) rounds.set(key, []);
    rounds.get(key).push(statLine(e));
  }
  const parts = [];
  for ( const [round, lines] of rounds ) {
    const heading = round === "after" ? "After the fight" : `R${round}`;
    parts.push(`<p><strong>${heading}</strong></p><ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>`);
  }
  const finals = spec.combatants.filter(c => !out.has(c.id)).map(c => {
    const f = result.units[c.id]?.final;
    return f ? `${c.name}: ${f.status}${f.swayed ? ` (${f.swayed})` : ""}, ${f.hp}/${c.hp.max} HP${f.dying ? `, dying ${f.dying}` : ""}${f.wounded ? `, wounded ${f.wounded}` : ""}` : c.name;
  });
  parts.push(`<p><strong>Final</strong></p><ul>${finals.map(l => `<li>${esc(l)}</li>`).join("")}</ul>`);
  return { title, html: parts.join(""), text: [...rounds.entries()].map(([r, ls]) => `${r === "after" ? "After the fight" : `R${r}`}\n${ls.join("\n")}`).join("\n") };
}

/**
 * @param {object} result   runOne(..., {log: true, capture: true}) output
 * @param {object} spec     BattleSpec it came from
 * @param {string} style    roleplay | standard | statistician
 * @param {object} options  {tables, seed, title, labels, damageType: (systemType) => imagery family}
 */
export function buildStory(result, spec, style, { tables, seed = 1, title = "", labels = DEFAULT_LABELS, damageType = null } = {}) {
  if ( style === "statistician" ) return statistician(result, spec, title);
  if ( style === "standard" ) return standard(result, spec, title, labels);
  return roleplay(result, spec, tables, seed, title, damageType);
}

export const DEFAULT_LABELS = {
  hit: "hit", crit: "critical", miss: "missed", resisted: "resisted", talked: "talked", convincing: "convincing",
  healed: "healed", potion: "potion(s)", firstAid: "first aid", bolstered: "bolstered", stabilized: "stabilized", moved: "moved", stayedOut: "stayed out of it", nothing: "did nothing of note",
  status: { standing: "standing", down: "down", dead: "dead", fled: "fled", surrendered: "surrendered", stoodDown: "stood down", conceded: "gave something up", switched: "switched sides" }
};
