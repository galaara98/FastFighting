/**
 * What lies on the ground, as something to go for instead of a foe:
 *  - a pile of goods (a chest, a bag, what someone dropped: the battle's spec.piles), its valuables for a thief, a
 *    greedy one, or one whose team is preying (behavior/stance.js); its food for the hungry;
 *  - the dead, their meat (spec.meat, portions: the helper's say), for the hungry that eat meat: a foe's, or (a cannibal,
 *    or a feral mind) a teammate's; a player character's only where the GM's setting says so (options.pcMeat).
 * Hunger: only a creature that eats (spec.diet, the helper's), rolled as the fight begins: famished (FAMISHED, any
 * wisdom, wanting it badly), else hungry (spec.hunger, the helper's chance), wanting it the less the wiser it is; the
 * GM's mark (spec.hungry) over the roll. It eats a portion an action until it has had its fill (by size).
 * Each turn its wants are goals (behavior/goals.js: pickUp, eat; the GM may hold them); on its turn, the strongest goes
 * ahead of the foe it most wants when it's stronger still. Pure: no Foundry globals.
 */
import { TACTICAL, STATUS, clamp } from "../../constants.js";
import { liveTier, liveTrait, isStanding, areEnemies, enemiesOf, canMove } from "../battle-state.js";
import { aptitude } from "../aptitudes.js";
import { isAnimalistic } from "./animal.js";
import { heldGoal } from "./goals.js";
import { stanceOf, STANCE } from "./stance.js";
import { remaining } from "./talk.js";

/** The chance any creature that eats comes to the fight famished, whatever its wisdom; and how badly it wants food then. */
export const FAMISHED = Object.freeze({ chance: 0.03, level: 75 });
/** Hungry: how badly, before wisdom (each point of the 0-4 wise aptitude takes a fifth off), and a feral mind's more. */
export const HUNGRY = Object.freeze({ level: 60, feral: 10 });
/** Portions it eats before it's had its fill, by size (tiny to gargantuan). */
export const FILL = Object.freeze([1, 1, 2, 4, 8, 16]);
/** How far off a pile is noticed (feet). Off a map, every pile is. */
export const SPOTS = 60;
/** Wanting valuables: how much greed, a Thief, a Mercenary, and what the pile is worth add. */
export const GREED = Object.freeze({ base: 30, greed: 30, worth: 15, thief: 0.5, mercenary: 0.25, most: 75 });

/** Its things as the fight begins: each pile on the map (a copy, taken from as it goes), and each one's hunger. */
export function initForage(run) {
  run.piles = new Map((run.prep.spec?.piles ?? []).map(p => [p.id, { ...p, money: Number(p.money) || 0, items: (p.items ?? []).map(i => ({ ...i })) }]));
  for ( const u of run.units ) {
    u.hunger = null;
    u.eaten = 0;
    const diet = u.spec.diet ?? null;
    if ( !diet || u.spec.hazard ) continue;
    const mark = u.spec.hungry ?? null;
    if ( mark === "sated" ) continue;
    const famished = mark === "famished" || (!mark && run.rng.chance(FAMISHED.chance));
    if ( famished ) {
      u.hunger = { famished: true, level: FAMISHED.level };
      continue;
    }
    if ( mark !== "hungry" && !run.rng.chance(clamp(Number(u.spec.hunger) || 0, 0, 1)) ) continue;
    u.hunger = { famished: false, level: hungryLevel(run, u) };
  }
}

/** How badly a hungry (not famished) creature wants food mid-fight: less the wiser it is; a feral mind more. */
export function hungryLevel(run, u) {
  const wise = clamp(aptitude(u, "wise") ?? 2, 0, 4);
  return Math.round(HUNGRY.level * (1 - wise / 5) + (liveTier(run, u) === TACTICAL.FERAL ? HUNGRY.feral : 0));
}

/** Does this food suit its diet (meat for a meat-eater, the rest for a plant-eater, anything for one that eats it all)? */
const suits = (diet, meat) => diet === "any" || (diet === "meat" ? meat : diet === "plants" ? !meat : false);

/** Portions of meat a dead body has left. */
export const meatLeft = t => t.status === STATUS.DEAD ? Math.max(0, (Number(t.spec.meat) || 0) - (t.meatEaten ?? 0)) : 0;

/** Feet from u to a point (its edge to it). */
const feetTo = (u, x, y) => (u.pos ? Math.max(0, Math.hypot(x - u.pos.x, y - u.pos.y) - (u.spec.position?.size ?? 5) / 2) : 0);

/** Has u room to forage: on its feet, in the fight, its hands free of a foe right beside it (the famished don't care). */
function free(run, u, famished = false) {
  if ( u.status !== STATUS.STANDING || !u.active || u.leaving ) return false;
  return famished || !enemiesOf(run, u).some(o => isStanding(o) && u.adjacent?.has(o.id));
}

/** Is it safe to go after a pile's valuables: its side winning, no foe near, or its team preying? */
function safe(run, u) {
  if ( stanceOf(run, u)?.kind === STANCE.PREY ) return true;
  const foes = enemiesOf(run, u).filter(isStanding);
  if ( !foes.length ) return true;
  const ours = run.units.filter(o => o.side === u.side && isStanding(o)).length;
  return ours > foes.length || !foes.some(f => !u.pos || !f.pos || Math.hypot(f.pos.x - u.pos.x, f.pos.y - u.pos.y) <= 30);
}

/** How much it wants valuables lying about: greed, a Thief's or a Mercenary's nature; 0 for none. */
function greedOf(run, u) {
  const styles = new Set(u.spec.playstyles ?? []);
  return clamp((liveTrait(run, u, "selfish") - 40) / 40, 0, 1) + (styles.has("thief") ? GREED.thief : 0) + (styles.has("mercenary") ? GREED.mercenary : 0);
}

/** A pile's worth: its money, and each thing's value times how many. */
const worthOf = p => p.money + p.items.reduce((s, i) => s + (Number(i.value) || 0) * (Number(i.quantity) || 1), 0);

/**
 * What u wants of what lies about, this turn: u.forage = [{kind: "pickUp" | "eat", sourceId, x, y, name, level}],
 * strongest first (the GM's hold on each over it). Shown as its goals (goals.js goalsOf).
 */
export function forageWishes(run, u) {
  u.forage = [];
  if ( u.status !== STATUS.STANDING || !u.active ) return;
  const add = (kind, sourceId, x, y, name, level) => {
    const held = heldGoal(u, kind, sourceId);
    const at = held ?? Math.round(level);
    if ( at > 0 ) u.forage.push({ kind, sourceId, x, y, name, level: at, gm: held !== undefined });
  };
  const near = (x, y) => !u.pos || feetTo(u, x, y) <= SPOTS;
  // Food: the hungry.
  const h = u.hunger;
  if ( h && free(run, u, h.famished) ) {
    const diet = u.spec.diet;
    const cannibal = !!u.spec.cannibal || liveTier(run, u) === TACTICAL.FERAL;
    for ( const t of run.units ) {
      if ( t === u || !meatLeft(t) || !suits(diet, true) || !t.pos ) continue;
      if ( t.spec.kind === "pc" && !run.prep.options.pcMeat ) continue;
      if ( !areEnemies(run, u, t) && !cannibal ) continue;
      add("eat", t.id, t.pos.x, t.pos.y, t.spec.name, h.level - (u.pos ? feetTo(u, t.pos.x, t.pos.y) / 10 : 0));
    }
    for ( const p of run.piles?.values() ?? [] ) {
      if ( !near(p.x, p.y) || !p.items.some(i => i.food && i.quantity > 0 && suits(diet, i.food.meat)) ) continue;
      add("eat", p.id, p.x, p.y, p.name, h.level - (u.pos ? feetTo(u, p.x, p.y) / 10 : 0));
    }
  }
  // Valuables: a thief, a greedy one, one whose team is preying; never an animal (no hands for it), and only when safe.
  const greed = isAnimalistic(u) ? 0 : greedOf(run, u) + (stanceOf(run, u)?.kind === STANCE.PREY ? 0.5 : 0);
  if ( greed > 0 && run.piles?.size && free(run, u) && safe(run, u) ) {
    for ( const p of run.piles.values() ) {
      const worth = worthOf(p);
      if ( !(worth > 0) || !near(p.x, p.y) ) continue;
      // (Worth, against what it has itself: a fortune to a pauper, pocket change to the rich.)
      const own = Math.max(1, remaining(u).own || 100);
      const w = clamp(Math.log10(1 + worth / own) / 2, 0, 1);
      add("pickUp", p.id, p.x, p.y, p.name, Math.min(GREED.most, GREED.base * Math.min(1, greed) + GREED.greed * Math.max(0, greed - 0.5) + GREED.worth * w * 2));
    }
  }
  u.forage.sort((a, b) => b.level - a.level);
}

/**
 * Its strongest want on the ground, if it beats what it most wants of the fight (`lead`, its level): {want, feet}, or
 * null. One held off by the GM (a hold of 0) isn't there to want.
 */
export function decideForage(run, u, leadLevel = 0) {
  const want = u.forage?.[0];
  if ( !want || want.level <= leadLevel || (!canMove(run, u) && feetTo(u, want.x, want.y) > 5) ) return null;
  return { want, feet: feetTo(u, want.x, want.y) };
}

/** It's at its want: it takes (the best thing in the pile, or its money) or eats a portion. Logged; kept for the sheets. */
export function forageNow(run, u, want, say) {
  if ( want.kind === "eat" ) {
    const t = run.byId.get(want.sourceId);
    let meat = false;
    if ( t ) {
      if ( !meatLeft(t) ) return false;
      t.meatEaten = (t.meatEaten ?? 0) + 1;
      meat = true;
    } else {
      const p = run.piles?.get(want.sourceId);
      const food = p?.items.find(i => i.food && i.quantity > 0 && suits(u.spec.diet, i.food.meat));
      if ( !food ) return false;
      food.quantity -= 1;
      meat = !!food.food.meat;
      (u.foraged ??= []).push({ source: p.id, pile: true, item: { id: food.id, name: food.name }, count: 1, eaten: true });
    }
    if ( t ) (u.foraged ??= []).push({ source: t.id, pile: false, count: 1, eaten: true, meat });
    u.eaten = (u.eaten ?? 0) + 1;
    const fill = FILL[clamp(Number(u.spec.size) || 2, 0, FILL.length - 1)];
    const sated = u.eaten >= fill;
    say(u, { type: "eat", target: want.name, targetId: want.sourceId, pile: !t, meat, sated });
    if ( sated ) u.hunger = null;
    return true;
  }
  const p = run.piles?.get(want.sourceId);
  if ( !p ) return false;
  // (The best of it: its money, or its most valuable thing, whichever is worth more.)
  const item = p.items.filter(i => i.quantity > 0).sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))[0] ?? null;
  const takeMoney = p.money > 0 && (!item || p.money >= (Number(item.value) || 0));
  if ( !takeMoney && !item ) return false;
  const taken = takeMoney ? { source: p.id, pile: true, money: p.money, count: 0 } : { source: p.id, pile: true, item: { id: item.id, name: item.name, value: item.value }, count: 1 };
  if ( takeMoney ) p.money = 0;
  else item.quantity -= 1;
  (u.foraged ??= []).push(taken);
  say(u, { type: "scavenge", target: p.name, targetId: p.id, money: takeMoney, item: takeMoney ? null : item.name });
  return true;
}
