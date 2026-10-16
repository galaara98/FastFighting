/**
 * What a character brings to a standoff, and what it wants out of it: the survey's "Do you offer something to end this
 * argument?" and "Do you expect something to end this argument?", in every survey (any encounter can open as a
 * standoff). Stored with its tactics (flags tactics.offer and tactics.expect); turned into the engine's spec.motives
 * (engine/behavior/bargain.js) when a battle is built.
 *
 * Anti-cheating: players own their flags and can write anything to them, so only what the character really has
 * reaches the engine (money up to what it carries; one of its own things, still in its pack or hands), and only the
 * kinds of thing the system knows (its own categories, materials and rarities, from the helper's item catalog):
 * never a particular item, nor anything of someone else's.
 *
 * Money is whatever paying costs in the system: coins (stored as so many of one coin), or Ironsworn's Supply.
 */
import { PROMISES } from "../engine/behavior/bargain.js";
import { isPlain } from "../constants.js";
import { localize } from "../i18n.js";
import { formatMoney } from "../story/log-lines.js";

/** The kinds of offer (none, money, one of its things, a promise), and of expectation (something of a kind, not a thing). */
export const OFFER_KINDS = Object.freeze(["", "money", "item", ...PROMISES]);
export const EXPECT_KINDS = Object.freeze(["", "money", "thing", ...PROMISES]);

/** "Let this character decide": what it offers or expects is worked out (suggestMotives), and stored with its answers. */
export const AUTO = "auto";

/** A survey field for a motive: offer.kind, expect.category ... */
export const MOTIVE_KEY = /^(offer|expect)\.(kind|amount|coin|item|category|material|rarity|minValue|unvalued)$/;

const MAX = 1e9;
const count = v => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(MAX, n)) : 0; };
const word = v => (typeof v === "string" ? v.slice(0, 64) : "");

/** One motive as stored: only the fields the survey writes, of the right types. */
export function cleanMotive(which, raw) {
  if ( !isPlain(raw) ) return null;
  const kinds = which === "offer" ? OFFER_KINDS : EXPECT_KINDS;
  const out = {};
  if ( kinds.includes(raw.kind) || raw.kind === AUTO ) out.kind = raw.kind;
  for ( const k of ["amount", "coin", "minValue"] ) if ( k in raw ) out[k] = count(raw[k]);
  for ( const k of ["item", "category", "material", "rarity"] ) if ( k in raw ) out[k] = word(raw[k]);
  if ( "unvalued" in raw ) out.unvalued = raw.unvalued === true;
  return out;
}

/** One field from the survey, cleaned for storage (null: not something the survey writes). */
export function cleanMotiveField(which, field, value) {
  const clean = cleanMotive(which, { [field]: field === "unvalued" ? value === true || value === "true" : value });
  return clean && field in clean ? clean[field] : null;
}

/** The coin an amount is counted in: the one stored, if the system has it; else the one worth a hundred of the smallest (gold, in most systems), else the largest. */
function coinOf(valuables, coin) {
  const coins = valuables?.denominations ?? [];
  return coins.find(c => c.value === coin) ?? coins.find(c => c.value === 100) ?? coins[0] ?? null;
}

/** So many of a coin, in the smallest coin (the engine's money). */
const inCoins = (valuables, n, coin) => (n ?? 0) * (coinOf(valuables, coin)?.value ?? 1);

/** Does the system have money at all (coins, or what paying costs)? */
const hasMoney = valuables => !!valuables?.denominations?.length;

/** Everything it could hand over of its own: carried, and held. */
const ownThings = valuables => [...(valuables?.stowed ?? []), ...(valuables?.wielded ?? [])];

/**
 * The engine's motives for a character: what it stored, checked against what it really has (its valuables, as the
 * system read them) and what the system knows (catalog). Null when it offers and expects nothing that holds up.
 * @param {object} stored                its tactics ({offer, expect})
 * @param {object|null} valuables        spec.valuables {money, denominations, stowed, wielded}
 * @param {object} [catalog]             the helper's item catalog {categories, materials, rarities}: [{key, label}]
 * @returns {{offer: object|null, expect: object|null}|null}
 */
export function validMotives(stored, valuables, catalog = {}) {
  const offer = validOffer(cleanMotive("offer", stored?.offer), valuables);
  const expect = validExpect(cleanMotive("expect", stored?.expect), valuables, catalog);
  return offer || expect ? { offer, expect } : null;
}

function validOffer(o, valuables) {
  if ( !o?.kind ) return null;
  if ( PROMISES.includes(o.kind) ) return { kind: "promise", promise: o.kind };
  // Money: never more than it carries.
  if ( o.kind === "money" ) {
    if ( !hasMoney(valuables) ) return null;
    const amount = Math.min(inCoins(valuables, o.amount, o.coin), valuables.money ?? 0);
    return amount > 0 ? { kind: "money", amount, denominations: valuables.denominations } : null;
  }
  // One of its own things, still with it.
  const item = ownThings(valuables).find(i => i.id === o.item);
  return item ? { kind: "item", item } : null;
}

function validExpect(e, valuables, catalog) {
  if ( !e?.kind ) return null;
  if ( PROMISES.includes(e.kind) ) return { kind: "promise", promise: e.kind };
  if ( !hasMoney(valuables) && e.kind === "money" ) return null;
  const denominations = valuables?.denominations ?? null;
  if ( e.kind === "money" ) {
    const amount = inCoins(valuables, e.amount, e.coin);
    return amount > 0 ? { kind: "money", amount, denominations } : null;
  }
  // Something of a kind: only the system's own categories, materials and rarities (never a particular item).
  if ( !valuables ) return null;
  const pick = (list, key) => (key ? (list ?? []).find(x => x.key === key) ?? null : null);
  const category = pick(catalog.categories, e.category);
  const material = pick(catalog.materials, e.material);
  const rarity = pick(catalog.rarities, e.rarity);
  return {
    kind: "thing",
    category: category?.key ?? "",
    material: material?.key ?? "",
    rarity: rarity?.key ?? "",
    minValue: hasMoney(valuables) ? inCoins(valuables, e.minValue, e.coin) : 0,
    unvalued: !!e.unvalued,
    denominations,
    labels: { category: category?.label ?? "", material: material?.label ?? "", rarity: rarity?.label ?? "" }
  };
}

/** Has it said what it offers or expects (anything but leaving it to the character)? */
const said = m => !!m && m.kind !== undefined && m.kind !== AUTO;

/**
 * What it offers and expects: what it said, or, where it left it to the character, what the character would (its
 * calculated answer, as stored).
 */
export function effectiveMotives(stored, auto) {
  return {
    offer: said(stored?.offer) ? stored.offer : auto?.offer ?? null,
    expect: said(stored?.expect) ? stored.expect : auto?.expect ?? null
  };
}

/**
 * What a character would offer and expect to end an argument, when nobody says (stored-shape answers, as the survey
 * writes them): the core's reading, from its hidden scores and what it carries. A system helper can say otherwise
 * (adapter.tacticHints). Offer: the timid offer to leave; the selfless and loyal, not to harm the other side; a
 * wealthy, clever, not very selfish one buys its way out with a tenth of its money. Expect: the self-serving want
 * money (by its level); the timid, not to be harmed. The mindless, and those with no words, nothing.
 * @param {object} spec   its CombatantSpec (traits, valuables, social)
 * @returns {{offer: object, expect: object}}
 */
export function suggestMotives(spec) {
  const none = { offer: { kind: "" }, expect: { kind: "" } };
  if ( spec?.hazard || spec?.social?.mindless || !(spec?.social?.languages?.length ?? 0) ) return none;
  const trait = k => Math.max(0, Math.min(100, (spec.traits?.[k]?.base ?? 50) + (spec.traits?.[k]?.fudge ?? 0)));
  const [T, B, S, L] = ["tactical", "brave", "selfish", "loyal"].map(trait);
  const v = spec.valuables ?? null;
  const main = coinOf(v, null);
  const level = Math.max(1, Number(spec.level) || 1);
  let offer = { kind: "" };
  if ( B < 40 ) offer = { kind: "leave" };
  else if ( S <= 30 && L >= 60 ) offer = { kind: "noHarm" };
  else if ( hasMoney(v) && main && S <= 45 && T >= 60 ) {
    const amount = Math.floor((v.money ?? 0) / main.value / 10);
    if ( amount >= 1 ) offer = { kind: "money", amount, coin: main.value };
  }
  let expect = { kind: "" };
  if ( S >= 65 && hasMoney(v) && main ) {
    // (So much of its main coin by its level: tens of gold, where there's a coin a hundred times the smallest.)
    const amount = main.value >= 100 ? 10 * level : Math.max(1, Math.ceil(level / 2));
    expect = { kind: "money", amount, coin: main.value };
  } else if ( B < 40 ) expect = { kind: "noHarm" };
  return { offer, expect };
}

/** A motive in words: "Nothing", "50 gp", "Not to harm them" (as the survey says it). */
export function describeMotive(which, m, valuables) {
  const side = which === "offer" ? "Offer" : "Expect";
  if ( !m?.kind ) return localize(`FASTFIGHTING.Motive.${side}.none`);
  if ( m.kind === "money" ) return formatMoney(inCoins(valuables, m.amount, m.coin), valuables?.denominations ?? []);
  return localize(`FASTFIGHTING.Motive.${side}.${m.kind}`);
}

/** An empty item catalog: a system whose helper names no kinds of thing. */
export const NO_CATALOG = Object.freeze({ categories: [], materials: [], rarities: [] });

/**
 * The survey's view of a character's offer and expectation: the kinds as pills (what it doesn't have, left out), and
 * the fields for the kind chosen.
 * @param {object} spec      its CombatantSpec (valuables)
 * @param {object} stored    its tactics
 * @param {object} catalog   the helper's item catalog
 * @param {string} uid       a suffix for input names in this form
 * @param {string} actorUuid whose answers these are
 * @param {object} [options]
 * @param {object} [options.auto]   what "Let this character decide" stands for ({offer, expect}), for the GM
 * @param {object} [options.why]    why ({offer, expect}: a system's reason)
 * @param {boolean} [options.gm]    show the GM what "Let this character decide" stands for
 */
export function motivesContext(spec, stored, catalog, uid, actorUuid, { auto = null, why = {}, gm = false } = {}) {
  const v = spec.valuables ?? null;
  const money = hasMoney(v);
  const things = ownThings(v);
  const coins = v?.denominations ?? [];
  const coinChoices = picked => coins.map(c => ({ value: c.value, label: c.label, selected: c === coinOf(v, picked) }));
  const listOf = (list, picked, any) => (list?.length ? [{ value: "", label: localize(any), selected: !picked }, ...list.map(x => ({ value: x.key, label: x.label, selected: x.key === picked }))] : null);
  const side = (which, kinds) => {
    const m = cleanMotive(which, stored?.[which]) ?? {};
    const shown = [AUTO, ...kinds.filter(k => (k !== "money" || money) && (k !== "item" || things.length) && (k !== "thing" || v))];
    // (Never said, or left to the character: "Let this character decide".)
    const kind = m.kind === undefined ? AUTO : shown.includes(m.kind) ? m.kind : "";
    const means = auto?.[which] ? describeMotive(which, auto[which], v) : null;
    const name = field => `motive-${uid}-${which}-${field}`;
    return {
      which,
      actorUuid,
      label: localize(`FASTFIGHTING.Motive.${which === "offer" ? "Offer" : "Expect"}.Label`),
      hint: localize(`FASTFIGHTING.Motive.${which === "offer" ? "Offer" : "Expect"}.Hint`),
      kinds: shown.map(k => ({ value: k, label: localize(`FASTFIGHTING.Motive.${which === "offer" ? "Offer" : "Expect"}.${k || "none"}`), active: k === kind })),
      kind,
      autoValue: gm && means ? (why?.[which] ? localize("FASTFIGHTING.Tactics.AutoFrom", { choice: means, why: why[which] }) : means) : null,
      money: kind === "money" ? {
        amount: { key: `${which}.amount`, name: name("amount"), value: m.amount ?? 0 },
        coin: coins.length > 1 ? { key: `${which}.coin`, name: name("coin"), choices: coinChoices(m.coin) } : null,
        unit: coins.length === 1 ? coins[0].label : "",
        have: which === "offer" ? localize("FASTFIGHTING.Motive.YouHave", { money: formatMoney(v.money ?? 0, coins) }) : ""
      } : null,
      item: kind === "item" ? {
        key: `${which}.item`, name: name("item"),
        choices: [{ value: "", label: localize("FASTFIGHTING.Motive.PickItem"), selected: !m.item }, ...things.map(i => ({
          value: i.id, label: i.value > 0 ? `${i.name} (${formatMoney(i.value, coins)})` : i.name, selected: i.id === m.item
        }))]
      } : null,
      thing: kind === "thing" ? {
        category: listOf(catalog.categories, m.category, "FASTFIGHTING.Motive.AnyCategory"),
        material: listOf(catalog.materials, m.material, "FASTFIGHTING.Motive.AnyMaterial"),
        rarity: listOf(catalog.rarities, m.rarity, "FASTFIGHTING.Motive.AnyRarity"),
        names: { category: name("category"), material: name("material"), rarity: name("rarity"), minValue: name("minValue"), coin: name("coin"), unvalued: name("unvalued") },
        keys: { category: `${which}.category`, material: `${which}.material`, rarity: `${which}.rarity`, minValue: `${which}.minValue`, coin: `${which}.coin`, unvalued: `${which}.unvalued` },
        minValue: money ? m.minValue ?? 0 : null,
        coin: money && coins.length > 1 ? coinChoices(m.coin) : null,
        unit: coins.length === 1 ? coins[0].label : "",
        unvalued: !!m.unvalued
      } : null
    };
  };
  return { sides: [side("offer", OFFER_KINDS), side("expect", EXPECT_KINDS)] };
}
