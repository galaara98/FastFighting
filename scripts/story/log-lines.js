/**
 * The fight's log in words: one line per event, as the Statistician story shows it (and the Standard story's notes),
 * built from the event's data in the reader's language. Each phrase is a template under FASTFIGHTING.Log in the
 * language files. Only text a game system writes itself (a rule's own report: recovery checks, enduring harm, carried
 * as e.text) is shown as it comes.
 * Pure apart from reading Foundry's translations when they're there (../i18n.js).
 */
import { localize, listJoin, listItems, hasWords, distanceText, roundsText, term } from "../i18n.js";

/** A phrase of the log, by its key (for the stories' own lists and headings). */
export const logTerm = (key, data = null) => t(key, data);

/** One phrase, in the reader's language. */
const t = (key, data = null) => localize(`FASTFIGHTING.Log.${key}`, data);
/** A hold's name: the condition's word (its key, where there's none). */
const holdName = key => {
  const word = localize(`FASTFIGHTING.Condition.${key}`);
  return word === `FASTFIGHTING.Condition.${key}` ? key : word;
};

const signed = n => (n >= 0 ? `+${n}` : `${n}`);
const degree = d => t(`Degree${d ?? 1}`);
/** The line being written (its die, for dice() where the caller doesn't say). */
let current = null;
/** A roll: its die and natural (a system's own dice, Daggerheart's two d12s, without a die's name), mod, total, against what. */
const dice = (nat, mod, total, dc, label, faces) => {
  const f = faces ?? current?.faces ?? 20;
  return t(typeof f === "number" ? "Roll" : "RollOwn", { faces: f, natural: nat, mod: signed(mod ?? 0), total, label, dc });
};
/** A damage type's name: the common ones in the reader's language (the system's own word otherwise). */
const damageType = type => (hasWords(`FASTFIGHTING.DamageType.${type}`) ? localize(`FASTFIGHTING.DamageType.${type}`) : type ?? "");
const damage = (n, type) => (n ? t("Damage", { n, type: damageType(type) }).trim() : "");
const bits = list => list.filter(Boolean).join(" · ");

/** Money in the system's coins, largest first ("1 gp, 4 sp"), from an amount in its smallest coin. */
export function formatMoney(amount, denominations) {
  if ( !denominations?.length ) return String(amount);
  const parts = [];
  let left = Math.round(amount);
  for ( const d of denominations ) {
    const n = Math.floor(left / d.value);
    if ( n > 0 ) { parts.push(t("Money", { n, coin: d.label })); left -= n * d.value; }
  }
  return parts.length ? listItems(parts) : t("Money", { n: 0, coin: denominations.at(-1).label });
}

/**
 * What a creature expects, in words: money; a promise; or something of a kind (the system's own words for its
 * category, material and rarity, as the survey stored them), worth at least so much, or unvalued.
 */
export function expectText(e) {
  if ( !e ) return "";
  if ( e.kind === "money" ) return formatMoney(e.amount, e.denominations);
  if ( e.kind === "promise" ) return t(PROMISE[e.promise] ?? "PromiseNoHarm");
  const labels = e.labels ?? {};
  const details = [
    labels.material ? t("ExpectMaterial", { material: labels.material }) : "",
    labels.rarity ? t("ExpectRarity", { rarity: labels.rarity }) : "",
    e.minValue > 0 ? t("ExpectWorth", { value: formatMoney(e.minValue, e.denominations) }) : "",
    e.unvalued ? t("ExpectUnvalued") : ""
  ].filter(Boolean);
  const what = labels.category || t("ExpectAnything");
  return details.length ? t("ExpectThing", { what, details: listItems(details) }) : what;
}

/** What a creature handed over, in words. */
export function concessionText(c) {
  if ( !c ) return "";
  if ( c.kind === "progress" ) return t("GroundGiven", { n: c.amount });
  return c.kind === "money" ? formatMoney(c.amount, c.denominations) : (c.item?.name ?? "");
}

const MODE = { walk: "ModeWalk", fly: "ModeFly", swim: "ModeSwim", climb: "ModeClimb", burrow: "ModeBurrow" };
const DESIRE = { hurt: "DesireHurt", heal: "DesireHeal", protect: "DesireProtect", aid: "DesireAid", talk: "DesireTalk", avoid: "DesireAvoid", bind: "DesireBind", rob: "DesireRob", breakFree: "DesireBreakFree", free: "DesireFree", rid: "DesireRid" };
const WHY = { hurt: "WhyHurt", harmed: "WhyHarmed", helped: "WhyHelped", robbed: "WhyRobbed", insulted: "WhyInsulted", impatient: "WhyImpatient", kin: "WhyKin" };
const NOTICE = { sight: "NoticeSight", sound: "NoticeSound", smell: "NoticeSmell", feel: "NoticeFeel", radar: "NoticeRadar", standoff: "NoticeStandoff", fledInto: "NoticeFled", help: "NoticeHelp", attacked: "NoticeAttacked", gm: "NoticeGm" };
const BREAKS = { insulted: "BreakInsulted", beast: "BreakBeast", annoyed: "BreakAnnoyed", blood: "BreakBlood", impatient: "BreakImpatient", unmet: "BreakUnmet" };
/** Only an argument: why the talks collapsed (nobody fights). */
const COLLAPSES = { insulted: "CollapseInsulted", beast: "CollapseBeast", annoyed: "CollapseAnnoyed", blood: "CollapseBlood", impatient: "CollapseImpatient", fray: "CollapseFray", unmet: "CollapseUnmet" };
const PROMISE = { noHarm: "PromiseNoHarm", passage: "PromisePassage", leave: "PromiseLeave" };
const TRIGGER = { hit: "TriggerHit", attacked: "TriggerAttacked", missed: "TriggerMissed", damaged: "TriggerDamaged", spell: "TriggerSpell" };
const VANISH = { expired: "VanishExpired", released: "VanishReleased", unsustained: "VanishUnsustained", idle: "VanishIdle" };
const role = r => (r === "boss" ? t("RoleBoss") : r === "leader" ? t("RoleLeader") : String(r ?? "").startsWith("lieutenant") ? t("RoleLieutenant", { n: String(r).split(" ")[1] ?? "" }) : r ?? "");

/**
 * One log event as a line of text, in the reader's language.
 * @param {object} e   a log event (type, actor, target, and its data)
 * @returns {string}
 */
export function logLine(e) {
  current = e;
  const line = baseLine(e);
  current = null;
  // (The system's own word on its dice, when it has one: Daggerheart's Hope and Fear.)
  return e.note && line ? `${line} · ${e.note}` : line;
}

function baseLine(e) {
  const a = { actor: e.actor ?? "", target: e.target ?? "", by: e.by ?? "" };
  switch ( e.type ) {
    case "attack": {
      if ( e.challenge ) {
        const roll = e.natural ? t("Challenge", { natural: e.natural, mod: signed(e.mod ?? 0), total: e.total, dice: e.challenge.join(", ") }) : t("Progress", { total: e.total, dice: e.challenge.join(", ") });
        return `${e.actor} → ${e.target}: ${bits([e.action, `${roll}${e.burned ? ` (${t("Momentum", { n: e.burned })})` : ""}`, t(`Ironsworn${e.degree}`), damage(e.damage, e.damageType)])}`;
      }
      if ( e.retort ) return `${e.actor} → ${e.target}: ${bits([e.action, damage(e.damage, e.damageType)])}`;
      return `${e.actor} → ${e.target}: ${bits([
        e.action,
        `${dice(e.natural, e.mod, e.total, e.dc, term("ac"), e.faces)}${e.deed !== null && e.deed !== undefined ? ` (${t("DeedRoll", { n: e.deed })})` : ""}`,
        `${degree(e.degree)} (${signed(e.margin ?? 0)})`,
        damage(e.damage, e.damageType),
        e.interceptedBy ? t("TakenBy", { name: e.interceptedBy, n: e.intercepted }) : "",
        e.boost ? t("SizedUp", { n: e.boost }) : "",
        e.attackNumber > 1 ? t("AttackN", { n: e.attackNumber }) : "",
        e.riders?.length ? listItems(e.riders) : "",
        e.critRoll !== null && e.critRoll !== undefined ? t("CritTable", { n: e.critRoll }) : ""
      ])}`;
    }
    case "deed": return t("DeedLine", { ...a, deed: e.deed, n: e.roll, result: e.success ? (e.effect || t("Succeeds")) : t("Fails") });
    case "rider": {
      const mended = Number.isFinite(e.roll) ? t("RiderMended", { n: e.roll, result: e.made ? t("NowAHit") : t("StillAMiss") }) : "";
      const saved = e.saveType ? t("RiderSaved", { saveType: e.saveType, natural: e.natural, total: e.total, dc: e.dc, degree: degree(e.degree) }) : "";
      return t("Rider", { ...a, rider: e.rider, mended, saved, effect: e.effect ? ` · ${e.effect}` : "" });
    }
    case "critTable": return t("CritTableLine", { actor: e.actor, by: e.by, n: e.roll, slain: e.slain ? ` · ${t("SlainOutright")}` : "", effect: e.effect ? ` · ${e.effect}` : "", row: e.rowText ? ` (${e.rowText})` : "" });
    case "fumble": return t("Fumble", { actor: e.actor, n: e.roll, effect: e.effect ? ` · ${e.effect}` : "", row: e.rowText ? ` (${e.rowText})` : "" });
    case "cast": {
      const how = e.success ? t("CastWorks", { n: (e.tier ?? 0) + 1 })
        : [e.fumble ? t("CastFumble") : e.disapproved ? t("CastDisapproval") : t("CastFails"), e.lost ? t("SpellLost") : ""].filter(Boolean).join(t("Separator")) + (e.disapproval ? ` ${t("DisapprovalRange", { n: e.disapproval })}` : "");
      return t("Cast", { actor: e.actor, action: e.action, faces: e.faces ?? 20, natural: e.natural, mod: signed(e.mod ?? 0), total: e.total, how });
    }
    case "boost": return t("Boost", { actor: e.actor, spent: e.spent, label: e.label, forTarget: e.self ? "" : t("BoostFor", { target: e.target }), from: e.from, to: e.to, dc: e.dc, made: e.made ? t("MadeIt") : t("StillShort") });
    case "reaction": return t("Reaction", { ...a, reaction: e.reaction, trigger: TRIGGER[e.trigger] ? t(TRIGGER[e.trigger]) : e.trigger ?? "" });
    case "summon": return t("Summon", { actor: e.actor, action: e.action, names: listJoin(e.names ?? []) });
    case "vanish": return t("Vanish", { actor: e.actor, reason: VANISH[e.reason] ? t(VANISH[e.reason]) : e.reason ?? "" });
    case "counter": return t("Counter", { ...a, reaction: e.reaction, action: e.action, roll: e.natural !== null && e.natural !== undefined ? t("CounterRoll", { natural: e.natural, total: e.total }) : "", how: e.countered ? t("Countered") : t("GetsThrough") });
    case "save": return t("Save", { ...a, action: e.action, saveType: e.saveType, roll: dice(e.natural, e.mod, e.total, e.dc, t("DC")), degree: degree(e.degree), margin: signed(e.margin ?? 0), damage: damage(e.damage, e.damageType) || t("DamageN", { n: 0 }) });
    case "auto": return t("Auto", { ...a, action: e.action, damage: damage(e.damage, e.damageType) || t("DamageN", { n: e.damage ?? 0 }) });
    case "strain": return t(e.empty ? "StrainEmpty" : "Strain", { actor: e.actor, target: e.target, lost: e.lost, pool: e.label ?? e.pool, left: e.left });
    case "talk": return t("Talk", { ...a, skill: e.skill, roll: dice(e.natural, e.mod, e.total, e.dc, t("DcOf", { stat: e.dcStat })), degree: degree(e.degree), margin: signed(e.margin ?? 0), boost: e.boost ? ` · ${t("SizedUp", { n: e.boost })}` : "", progress: e.progress, steps: e.steps });
    case "heal": return t("Heal", { actor: e.actor, target: e.self ? t("Self") : e.target, action: e.action, check: e.check ? ` · ${t(e.check.skill ? "HealCheck" : "Medicine", { skill: e.check.skill ?? "", roll: dice(e.check.natural, e.check.mod, e.check.total, e.check.dc, t("DC")), degree: degree(e.check.degree) })}` : "", amount: e.amount, revived: e.revived ? t("Revived") : "" });
    case "move": return t("Move", {
      actor: e.actor, mode: t(MODE[e.mode] ?? "ModeMove"), distance: distanceText(e.feet), toward: e.purpose === "door" ? t("TheDoor") : e.toward,
      terrain: e.mult > 1.05 ? t("Terrain", { mult: Number(e.mult).toFixed(2), regions: e.regions?.length ? t("TerrainRegions", { regions: listItems(e.regions) }) : "" }) : ""
    });
    case "afflictionSave": return t("AfflictionSave", { actor: e.actor, name: e.name, saveType: e.saveType, roll: dice(e.natural, e.mod, e.total, e.dc, t("DC")), degree: degree(e.degree) });
    case "afflictionStage": return t("AfflictionStage", { actor: e.actor, name: e.name, stage: e.stage, damage: damage(e.amount, e.damageType) });
    case "afflictionEnd": return Number.isFinite(e.natural) ? t("AfflictionCured", { actor: e.actor, name: e.name, roll: dice(e.natural, e.mod, e.total, e.dc, t("DC")), degree: degree(e.degree) }) : t("AfflictionEnd", { actor: e.actor, name: e.name });
    case "opportunity": return t("Opportunity", a);
    case "disengage":
      // (A way out that takes a check: missed, it goes anyway, and the blows come.)
      if ( e.made === false ) return t("DisengageMissed", { actor: e.actor, label: e.label || t("Disengages"), total: e.total, dc: e.dc });
      return t("Disengage", { actor: e.actor, label: e.label || t("Disengages") });
    case "door": {
      const method = { open: "DoorOpen", force: "DoorForce", pick: "DoorPick", attack: "DoorAttack", giveup: "DoorGiveUp" }[e.method] ?? "DoorOpen";
      const roll = e.natural !== undefined ? ` · ${dice(e.natural, e.mod, e.total, e.dc, e.method === "attack" ? term("ac") : t("DC"))}` : "";
      return t("Door", { actor: e.actor, method: t(method), roll, damage: e.method === "attack" && e.hit ? ` · ${t("DamageN", { n: e.damage })}` : "", result: e.method === "giveup" ? t("DoorGaveUp") : e.success ? t("DoorOpened") : t("DoorHolds") });
    }
    case "thought": return t("Thought", {
      actor: e.actor,
      desires: (e.desires ?? []).map(d => t("ThoughtDesire", { desire: DESIRE[d.kind] ? t(DESIRE[d.kind]) : d.kind, target: d.targetId === e.actorId ? t("Self") : d.target, level: d.level })).join(" · "),
      following: e.following ? t("Following", { name: e.following.name, boss: e.following.boss ? t("Boss") : "", chance: Math.round(e.following.chance * 100) }) : ""
    });
    case "riderSave": return t("RiderSave", { actor: e.actor, name: e.name, saveType: e.saveType, roll: dice(e.natural, e.mod, e.total, e.dc, t("DC")), degree: degree(e.degree), damage: e.damage ? ` · ${t("DamageN", { n: e.damage })}` : "" });
    case "notice": return t("Notice", { actor: e.actor, cause: NOTICE[e.cause] ? t(NOTICE[e.cause], { by: e.by ?? "" }) : e.cause ?? "" });
    case "study": {
      const c = e.check;
      const roll = !c ? "" : ` · ${c.skill ? `${c.skill} ` : ""}${c.challenge ? t("Challenge", { natural: c.natural, mod: signed(c.mod ?? 0), total: c.total, dice: c.challenge.join(", ") }) : dice(c.natural, c.mod, c.total, c.dc, t("DC"))} · ${degree(c.degree)}`;
      const factor = e.factor ?? 2.5;
      const pays = e.worked === false ? [t("LearnsNothing"), e.price].filter(Boolean).join(" · ")
        : e.oneRoll ? t("NextRoll", { against: e.anyFoe ? "" : t("AgainstThem", { target: e.target }), factor, target: e.target }) : t("NextRolls", { factor, target: e.target });
      return t("Study", { ...a, kin: e.kin ? t("StudyKin", { kin: e.kin, target: e.target }) : "", roll, pays });
    }
    case "observe": return t("Observe", { actor: e.actor, targets: listJoin(e.targets ?? []) });
    case "command":
      if ( e.lost ) return t("CommandLost", { after: e.from ? t("CommandAfter", { name: e.from }) : "" });
      return e.back ? t("CommandBack", { actor: e.actor, role: role(e.role) }) : t("CommandTakes", { actor: e.actor, role: role(e.role), from: e.from ? t("CommandFrom", { name: e.from }) : "" });
    case "scheme": return t("Scheme", { ...a, boss: e.boss ? t("Boss") : "" });
    case "shareLore": return t("ShareLore", { actor: e.actor, allies: listJoin(e.with ?? []), target: e.target, chance: Number.isFinite(e.chance) ? t("MindedToShare", { n: Math.round(e.chance * 100) }) : "" });
    case "keepLore": return t("KeepLore", { ...a, n: Math.round((e.chance ?? 0) * 100) });
    case "firstAid": return t("FirstAid", { ...a, skill: e.skill || t("MedicineSkill"), roll: dice(e.natural, e.mod, e.total, e.dc, t("DC")), degree: degree(e.degree), result: e.stable ? t("Stabilized") : e.dead ? t("Dies") : t("DyingN", { n: e.dying }) });
    case "aftermath": return t("Aftermath");
    case "control": {
      // (A playstyle's taunt has no name of its own: it's a taunt.)
      const action = e.action || (e.goad ? t("Goad") : "");
      if ( e.immune ) return t("ControlImmune", { ...a, action });
      const how = e.roll === "auto" ? t("NoRoll")
        : e.roll === "goad" ? `${e.skill ? `${e.skill} ` : ""}${dice(e.natural, e.mod, e.total, e.dc, t("DcOf", { stat: e.dcStat ?? t("Defense") }))} · ${degree(e.degree)}${e.luck !== null && e.luck !== undefined ? t("GoadLuck", { luck: e.luck, needed: e.needed }) : ""}`
        : e.roll === "check" ? `${dice(e.natural, e.mod, e.total, e.dc, t("DcOf", { stat: e.against ?? t("Defense") }))} · ${degree(e.degree)}`
          : `${e.saveType ? `${[].concat(e.saveType).join("/")} ` : ""}${dice(e.natural, e.mod, e.total, e.dc, e.saveType ? t("DC") : term("ac"))} · ${degree(e.degree)}`;
      const effect = e.effect || (e.shrugged ? t("Shrugged") : e.taunt && e.took ? t("Goaded") : t("NoEffect"));
      return t("Control", { ...a, action, how, shifted: e.shifted ? ` ${t("Shifted")}` : "", effect, onSelf: e.backfired ? ` ${t("OnSelf", { name: e.actor })}` : "", damage: e.damage ? ` · ${t("DamageN", { n: e.damage })}` : "" });
    }
    case "buff": {
      const c = e.check;
      const check = !c ? "" : ` · ${c.skill ? `${c.skill} ` : ""}${c.challenge ? t("Challenge", { natural: c.natural, mod: signed(c.mod ?? 0), total: c.total, dice: c.challenge.join(", ") }) : dice(c.natural, c.mod, c.total, c.dc, t("DC"))} · ${degree(c.degree)}`;
      return t("Buff", {
        actor: e.actor, targets: listItems((e.targets ?? []).map((n, i) => (e.targetIds?.[i] === e.actorId ? t("Self") : n))), action: e.action, check,
        effect: e.failed ? (e.effect && e.effect !== e.action ? e.effect : t("NothingComesOfIt")) : e.effect || t("Bolstered"),
        against: (e.against ?? []).some(Boolean) ? t("BuffAgainst", { names: listItems(e.against.filter(Boolean)) }) : "",
        temp: e.tempHp ? t("TempHp", { n: e.tempHp }) : "", asked: e.askedBy?.length ? t("AskedBy", { names: listJoin(e.askedBy) }) : ""
      });
    }
    case "concentrationEnd":
      if ( e.reason === "switch" ) return t("LetsGo", { actor: e.actor, effects: listJoin(e.effects ?? []) });
      return t("LosesConcentration", { actor: e.actor, action: e.action, roll: e.natural !== undefined ? ` · ${e.saveType} ${dice(e.natural, e.mod, e.total, e.dc, t("DC"))}` : t("CantAct") });
    case "shakeOff": return t("ShakeOff", { actor: e.actor, effect: e.effect || t("TheEffect"), saveType: e.saveType, roll: dice(e.natural, e.mod, e.total, e.dc, t("DC")) });
    case "trap": return t({ spots: "TrapSpots", learns: "TrapLearns", braves: "TrapBraves", holds: "TrapHolds", stepsOut: "TrapStepsOut" }[e.what] ?? "TrapSpots", { ...a, luck: e.luck, needed: e.needed });
    case "execute": return t("Execute", { ...a, luck: e.luck, needed: e.needed, how: e.goes ? t("GoesForKill") : t("SparesThem", { next: e.next ? t("TurnsOn", { name: e.next }) : "" }) });
    case "allegiance": return e.joined ? t("AllegianceTurn", a) : t("AllegianceBack", { actor: e.actor, side: e.homeLabel ?? "" });
    case "neutral": {
      const why = WHY[e.why] ? t(WHY[e.why]) : e.why ?? "";
      switch ( e.what ) {
        case "luck": return t("NeutralLuck", { actor: e.actor, luck: e.luck, needed: e.needed });
        case "offended": return t("NeutralOffended", { actor: e.actor, side: e.sideLabel ?? "", why, victim: e.victim ? `: ${e.victim}` : "", by: e.by ?? "" });
        case "truce": return t("NeutralTruce", { actor: e.actor, by: e.by ?? "", over: e.victim ? t("Over", { name: e.victim }) : "", why });
        case "aloof": return t("NeutralAloof", { actor: e.actor, n: Math.round((e.chance ?? 0) * 100) });
        case "meddle": return e.how === "extort" ? t("NeutralExtort", { actor: e.actor, against: e.against ?? "", n: Math.round((e.chance ?? 0) * 100) }) : t("NeutralMeddle", { actor: e.actor, side: e.sideLabel ?? "", n: Math.round((e.chance ?? 0) * 100) });
        case "feud": return t("NeutralFeud", a);
        case "holds": return t("NeutralHolds", a);
        case "calmed": return t("NeutralCalmed", a);
        case "amends": return t("NeutralAmends", a);
        default: return t("NeutralLapse", a);
      }
    }
    case "theft": {
      // The luck check against a PC is the GM's secret, so it never appears here.
      const feint = e.feint ? t("Feint", { weapon: e.feint.weapon, roll: dice(e.feint.natural, e.feint.mod, e.feint.total, e.feint.ac, term("ac")), hit: e.feint.hit ? t("FeintHit") : t("FeintMiss") }) : "";
      if ( e.feint && !e.feint.hit ) return t("FeintOnly", { ...a, feint });
      return t("Theft", { ...a, feint: feint ? `${feint} · ` : "", skill: e.skill ?? "", roll: dice(e.natural, e.mod, e.total, e.dc, t("DcOf", { stat: e.dcStat })), degree: degree(e.degree), result: e.stolen ? t("Steals", { what: concessionText(e.stolen) }) : e.noticed ? t("Caught") : t("NothingTaken") });
    }
    case "reclaim": return t("Reclaim", { actor: e.actor, what: concessionText(e.concession), by: e.by ?? "" });
    case "sway": {
      const c = e.concession;
      if ( e.outcome === "bribed" ) return t("Bribed", { actor: e.actor, what: c ? concessionText(c) : t("Nothing"), payer: e.payer ?? e.by ?? "" });
      if ( e.lie ) return t("LieAndRun", a);
      if ( e.paidOff ) {
        if ( !c ) return t("PaysNothing", a);
        return c.kept ? t("KeepsIt", { actor: e.actor, what: concessionText(c), luck: c.luck, needed: c.needed ?? 39 }) : t("PaysOff", { ...a, what: concessionText(c) });
      }
      if ( e.outcome === "neutral" ) {
        if ( e.luck ) return t("StandsAsideLuck", { actor: e.actor, luck: e.luck, needed: e.needed });
        return e.again ? t("StandAsideAgain", a) : t("StandAside", a);
      }
      if ( c ) {
        return c.kept ? t("KeepsIt", { actor: e.actor, what: concessionText(c), luck: c.luck, needed: c.needed ?? 39 })
          : t("Gives", { actor: e.actor, what: concessionText(c), to: c.toName ?? "", luck: c.luck ? t("GivesLuck", { luck: c.luck }) : "" });
      }
      if ( e.recruit ) return t("Recruit", { actor: e.actor, side: e.sideLabel ?? "" });
      return t({ fled: "SwayFled", stoodDown: "SwayStoodDown", switched: "SwaySwitched" }[e.outcome] ?? "SwaySurrendered", a);
    }
    case "backlash": return t("Backlash", { actor: e.actor, label: e.label || t("PaysForIt"), damage: damage(e.damage, e.damageType) });
    case "breakStandoff": return t("BreakStandoff", { actor: e.actor, how: t(BREAKS[e.cause] ?? "BreakImpatient") });
    case "collapse": return t("Collapse", { actor: e.actor, how: t(COLLAPSES[e.cause] ?? "CollapseImpatient") });
    // Only an argument: what was handed over, or promised, to end it.
    case "duel": return t("Duel", { actor: e.actor, target: e.target ?? "", action: e.action ?? "", counter: e.counter ?? "", total: e.total, against: e.against, result: t({ wins: "DuelWins", both: "DuelBoth", loses: "DuelLoses", fails: "DuelFails" }[e.outcome] ?? "DuelFails") });
    case "stray": return t("Stray", { actor: e.actor, target: e.target ?? "", result: e.hit ? t("StrayHit", { n: e.damage }) : t("StrayMiss") });
    case "deal": return t("Deal", { actor: e.actor, target: e.target ?? "", what: e.promise ? t(PROMISE[e.promise] ?? "PromiseNoHarm") : concessionText(e.concession) });
    case "haggle":
      if ( e.what === "keeps" ) return t("KeepsIt", { actor: e.actor, what: e.item?.name ?? "", luck: e.luck, needed: e.needed ?? 39 });
      return e.what === "drops" ? t("HaggleDrops", { actor: e.actor, by: e.by ?? "" }) : t("HaggleLowers", { actor: e.actor, by: e.by ?? "", what: expectText(e.expect) });
    case "callHelp": return t("CallHelp", { actor: e.actor, target: e.toward ?? "" });
    case "lazy": return t("Lazy", { actor: e.actor });
    case "callToArms": return t("CallToArms", { actor: e.actor, targets: listJoin(e.targets ?? []) });
    case "condition": return t("Condition", { actor: e.actor, effect: e.effect || t("Reeling") });
    case "down": return e.knockedOut ? t("KnockedOut", a) : t("Down", { actor: e.actor, dying: e.dying ? t("DownDying", { n: e.dying }) : "" });
    // Beaten (out of the fight, however the table decides), or killed by one who would kill.
    case "beaten": return t(e.killed ? "BeatenKilled" : "Beaten", { actor: e.actor, by: e.by ?? "" });
    case "death":
      if ( e.regen ) return t("RegenStopped", a);
      if ( e.crit ) return t("SlainOutrightBy", a);
      if ( e.finished ) return t("Finished", a);
      return t("Slain", a);
    case "struckDown": return t("StruckDown", { actor: e.actor, n: e.dying ?? 0 });
    case "draw": return t("Draw", { actor: e.actor, item: e.item ?? "" });
    case "end": return endLine(e);
    case "escape": {
      // (A grab, a prisoner's bonds, or another hold; with what it rolled, if it rolled.)
      const roll = e.natural !== undefined ? ` · ${dice(e.natural, e.mod, e.total, e.dc, t("DC"))}` : e.said ? ` · ${e.said}` : "";
      if ( e.hold === "bound" ) return t(e.success ? "EscapeBonds" : "StuckBonds", { ...a, roll });
      if ( e.hold && e.hold !== "grabbed" ) return t(e.success ? "EscapeFrom" : "StuckIn", { ...a, what: holdName(e.hold), roll });
      return e.success ? t("Escape", a) + roll : t("Stuck", a) + roll;
    }
    case "remedy": {
      // (What it tried to be rid of: harm of a kind, or the system's own.)
      const what = e.damageType ? damageType(e.damageType) : e.label ?? e.what;
      return t(e.success ? "Remedy" : "RemedyFails", { actor: e.actor, what, said: e.said ? ` · ${e.said}` : "" });
    }
    case "free": {
      const roll = e.natural !== undefined ? ` · ${dice(e.natural, e.mod, e.total, e.dc, t("DC"))}` : e.said ? ` · ${e.said}` : "";
      return t(e.success ? "Free" : "FreeFails", { ...a, roll });
    }
    case "fate":
      if ( e.sure ) return t("FateSure", { actor: e.actor, label: e.label });
      if ( e.self === undefined ) return t("FateRetry", { ...a, label: e.label });
      return e.self ? t("FateSelf", { actor: e.actor, label: e.label }) : t("FateFor", { ...a, label: e.label });
    case "flee":
      if ( e.retreat ) return e.leads ? t("FleeLeads", a) : t("FleeWith", { actor: e.actor, name: e.with ?? "" });
      return t({ dread: "FleeDread", breaks: "FleeBreaks", revived: "FleeRevived", allyFalls: "FleeAllyFalls" }[e.why] ?? "Flee", { actor: e.actor, name: e.dread ?? "" });
    case "grabbed": return t("Grabbed", a);
    case "holdGround": return e.ordered ? t("HoldOrdered", { actor: e.actor, by: e.by ? t("ByName", { name: e.by }) : "" }) : t("HoldGround", a);
    case "holdOn": return t("HoldOn", { actor: e.actor, label: e.label || t("HoldsOn") });
    case "initiative": return t("Initiative", { order: listItems(e.order ?? []) });
    case "join": return e.why === "forced" ? t("JoinForced", a) : t("Join", a);
    case "watch": return t("Watch", a);
    case "lastWord": return t("LastWord", a);
    case "legendary": return t("Legendary", { ...a, action: e.action });
    case "mercy": return t("Mercy", a);
    case "bind": return t("Bind", a);
    // (A player character's luck check, like a thief's, is the GM's secret: a kept thing is just nothing taken.)
    case "rob": return e.stolen ? t("Rob", { ...a, what: concessionText(e.stolen) }) : t("RobNothing", a);
    case "bound": return e.by ? t("Bound", { actor: e.actor, by: e.by }) : t("BoundAlone", { actor: e.actor });
    case "parley": return t("Parley", a);
    case "peacekeep": return t("Peacekeep", a);
    case "persistent": return t("Persistent", { actor: e.actor, damage: damage(e.amount, e.damageType) });
    case "prone": return t("Prone", a);
    case "rally": return t("Rally", { actor: e.actor, allies: listJoin(e.with ?? []) });
    case "recharge": return t("Recharge", { actor: e.actor, action: e.action });
    case "regen": return t("Regen", { actor: e.actor, n: e.amount, up: e.revived ? t("GetsUp") : "" });
    case "retreat":
      if ( e.what === "refused" ) return t("RetreatRefused", { ...a, n: Math.round((e.chance ?? 0) * 100) });
      return e.urged ? t("RetreatUrged", a) : t("RetreatCall", a);
    case "standFirm": return t("StandFirm", { actor: e.actor, label: e.label || t("StandsFirm"), against: e.against ?? "" });
    case "standoff": return t("Standoff");
    case "step": return t("Step", a);
    case "surprise": return t("Surprise", { side: e.sideLabel ?? "" });
    case "sustain": return t("Sustain", { actor: e.actor, action: e.action });
    case "waver": return t("Waver", a);
    case "stand": return t("Stand", a);
    case "shield": return t("Shield", a);
    case "leave": return t("Leave", a);
    // (A system's own report: recovery checks, enduring harm, its start-of-turn rules. The system words these itself.)
    default: return `${e.actor ? `${e.actor}: ` : ""}${e.text ?? ""}`;
  }
}

/** The fight's outcome in a line: who won, after how long. */
export function endLine(e) {
  const rounds = roundsText(e.rounds ?? e.round ?? 0);
  // (Only an argument, broken up before it came to blows: nobody won, and nobody fell.)
  if ( e.resolved === "collapsed" ) return t("EndCollapsed", { rounds });
  if ( e.outcome === "stalemate" ) return t("EndStalemate", { rounds });
  if ( e.outcome === "none" || !(e.winnerLabels ?? []).length ) return t("EndNone", { rounds });
  return t("End", { winners: listJoin(e.winnerLabels), rounds });
}
