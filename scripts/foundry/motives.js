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
import { localize } from "../i18n.js";
import { formatMoney } from "../story/log-lines.js";

/** The kinds of offer (none, money, one of its things, a promise), and of expectation (something of a kind, not a thing). */
export const OFFER_KINDS = Object.freeze(["", "money", "item", ...PROMISES]);
export const EXPECT_KINDS = Object.freeze(["", "money", "thing", ...PROMISES]);

/** A survey field for a motive: offer.kind, expect.category ... */
export const MOTIVE_KEY = /^(offer|expect)\.(kind|amount|coin|item|category|material|rarity|minValue|unvalued)$/;

const MAX = 1e9;
const count = v => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(MAX, n)) : 0; };
const word = v => (typeof v === "string" ? v.slice(0, 64) : "");
const isPlain = v => !!v && typeof v === "object" && !Array.isArray(v);

/** One motive as stored: only the fields the survey writes, of the right types. */
export function cleanMotive(which, raw) {
  if ( !isPlain(raw) ) return null;
  const kinds = which === "offer" ? OFFER_KINDS : EXPECT_KINDS;
  const out = {};
  if ( kinds.includes(raw.kind) ) out.kind = raw.kind;
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
 */
export function motivesContext(spec, stored, catalog, uid, actorUuid) {
  const v = spec.valuables ?? null;
  const money = hasMoney(v);
  const things = ownThings(v);
  const coins = v?.denominations ?? [];
  const coinChoices = picked => coins.map(c => ({ value: c.value, label: c.label, selected: c === coinOf(v, picked) }));
  const listOf = (list, picked, any) => (list?.length ? [{ value: "", label: localize(any), selected: !picked }, ...list.map(x => ({ value: x.key, label: x.label, selected: x.key === picked }))] : null);
  const side = (which, kinds) => {
    const m = cleanMotive(which, stored?.[which]) ?? {};
    const shown = kinds.filter(k => (k !== "money" || money) && (k !== "item" || things.length) && (k !== "thing" || v));
    const kind = shown.includes(m.kind) ? m.kind : "";
    const name = field => `motive-${uid}-${which}-${field}`;
    return {
      which,
      actorUuid,
      label: localize(`FASTFIGHTING.Motive.${which === "offer" ? "Offer" : "Expect"}.Label`),
      hint: localize(`FASTFIGHTING.Motive.${which === "offer" ? "Offer" : "Expect"}.Hint`),
      kinds: shown.map(k => ({ value: k, label: localize(`FASTFIGHTING.Motive.${which === "offer" ? "Offer" : "Expect"}.${k || "none"}`), active: k === kind })),
      kind,
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
