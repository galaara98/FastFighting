/**
 * Getting ready (API 20): what a creature does with actions or movement it can't spend on what it wants most, so that
 * it can do it next turn, rather than standing idle. Any system: it reads what an action needs (engine/gear.js: in hand,
 * loaded), how far everyone is, and what the creature wants (behavior/desire.js).
 *
 * What's missing, and the step that makes up for it:
 *  - its weapon (or a potion) not in hand: it draws it (`draw`, `retrieve`); not loaded: it reloads it (`reload`);
 *  - whoever it wants to hurt out of reach or range: it moves toward them, as far as it needs (the simulator's own
 *    approach, every turn it can), and with what's spare, to where it can strike next turn (`approach`, `range`), a
 *    flanking spot beside a friend (`flank`);
 *  - a friend it means to heal out of reach this turn: it goes to them (`tend`); a potion it can't drink this turn: it
 *    gets it out (`retrieve`);
 *  - on the ground: it stands (`stand`);
 *  - and with movement to spare, where it would rather stand as the round comes round: behind cover, to hide next turn
 *    (`cover`); between its foes and the friends it guards (`guard`); out of its foes' reach, behind its friends
 *    (`fallBack`); a kiter's in and out again (`hitAndRun`). Its personality says how much each matters.
 *
 * How it's weighed (STATS_AND_FORMULAS_README, "Getting ready"): a step is worth what it enables next turn, discounted
 * (NEXT: the target may move or fall, the plan change), times the chance it still matters (stillMatters), against what
 * else the same actions would do now; a spot to end the turn on, what it lets it do next turn and the harm it spares it,
 * less the reactions moving there provokes. Steps that only use what's spare never take the place of an attack, a heal
 * or a step it's already taking; one that is the best use of the turn by that reckoning (a healer that can't heal this
 * turn at all) is taken as the turn's own.
 * Lazy creatures still slack (simulator.js slacksOff): being unable to act directly is no longer a reason to idle.
 * Pure: no Foundry globals.
 */
import { STATUS, TACTICAL, clamp } from "../../constants.js";
import { isStanding, enemiesOf, alliesOf, liveTier, liveTrait, behaviorOf, canMove, heldOff, areEnemies, approach } from "../battle-state.js";
import { needsDraw, isLoaded, canReload, draw, load, gearOf, reloadPerUse } from "../gear.js";
import { costOf, costUnits, mainPool, normalizeCost } from "../turn.js";
import { expectedDamage, threatOf, hasUses, unitsPerTurn } from "./evaluate.js";
import { mind, levelOf, protective } from "./desire.js";
import { threats } from "./reactions.js";
import { edgeAt, inTheWay, wallsKnown, sightBlocked, blockedPoints } from "./space.js";
import { meanPart } from "../dice.js";

/**
 * NEXT: what next turn's use is worth now. HARM: harm next round, as it counts now. LEAST: the least a step must be
 * worth (in damage) to bother. KITE: how much more a kiter minds ending its turn in reach. FLANK: a melee blow's worth
 * with a friend on its target too. PRONE: the share of a round's give and take being on the ground costs.
 */
export const PREP = Object.freeze({ next: 0.75, harm: 0.85, least: 0.5, kite: 2.5, flank: 1.15, prone: 0.12 });

/* -------------------------------------------- */
/*  What its gear needs                         */
/* -------------------------------------------- */

/** What a use of this action still needs first: [{step: "draw" | "retrieve" | "reload", units}], in order. */
export function gearNeeds(u, action) {
  const out = [];
  if ( needsDraw(u, action) ) out.push({ step: action.kind === "heal" ? "retrieve" : "draw", units: Number(action.drawCost) });
  if ( !isLoaded(u, action) && canReload(action) ) out.push({ step: "reload", units: Number(action.reload) });
  return out;
}

/**
 * Its gear made ready for a use it's paying for now (the cost included its draw and Reload: turn.js costOf), told:
 * a `draw` (or a potion got out), then a `reload`.
 */
export function readyNow(u, action, say) {
  for ( const need of gearNeeds(u, action) ) doGear(u, action, need.step, say);
}

/** One gear step done and told (`prepared`: a step for later, the story tells it by its `prepare` event). */
function doGear(u, action, step, say, prepared = false) {
  if ( step === "reload" ) {
    load(u, action);
    say?.(u, { type: "reload", item: action.name ?? "", gear: gearOf(action), ...(action.ammoName ? { ammo: action.ammoName } : {}), ...(prepared ? { prepared } : {}) });
    return;
  }
  draw(u, action);
  say?.(u, { type: "draw", item: action.name ?? "", gear: gearOf(action), ...(step === "retrieve" ? { retrieve: true } : {}), ...(prepared ? { prepared } : {}) });
}

/**
 * How likely what it's getting ready for still matters next turn: for a foe, that it's still standing then (what its
 * friends set on it would do to it before then, against what it has left); a friend, mostly; itself, always.
 */
export function stillMatters(run, u, t) {
  if ( !t || t === u ) return 1;
  if ( !areEnemies(run, u, t) ) return t.status === STATUS.DEAD ? 0 : 0.9;
  let pressure = 0;
  for ( const a of alliesOf(run, u) ) if ( a !== u && isStanding(a) && a.targetId === t.id ) pressure += threatOf(run, a, t);
  return clamp(1 - 0.8 * pressure / Math.max(1, t.hp + (t.temp ?? 0)), 0.2, 1);
}

/** Its weapon is good against any foe: the chance it matters is a sure thing while two or more stand. */
const gearMatters = (run, u, t) => (enemiesOf(run, u).filter(isStanding).length >= 2 ? 0.95 : stillMatters(run, u, t));

/**
 * The first thing an action it can't afford this turn still needs, if what's left of the turn pays for it: {step,
 * cost, action, target, worth, desire}; worth what it lets the action do next turn (gearWorth; `o`, its nextOption, where
 * it has it). Null for none.
 */
export function gearStep(run, u, turn, action, target, o = null) {
  const need = gearNeeds(u, action)[0];
  if ( !need ) return null;
  const cost = normalizeCost(run.prep.rules, need.units);
  if ( !turn.canAfford(cost) ) return null;
  const plan = o?.action === action ? o : optionFor(run, u, action, target);
  const worth = plan ? gearWorth(run, u, plan, need.units, target) : 0;
  return { step: need.step, cost, action, target, desire: action.kind === "heal" ? "heal" : "hurt", worth };
}

/** A gear step taken: paid for, done, and told why. */
export function takeGearStep(run, u, turn, step, say) {
  turn.spend(step.cost);
  tellPrepare(u, step, say);
  doGear(u, step.action, step.step, say, true);
}

/** The why of a step for later: what it serves (the desire), at whom, with what. */
function tellPrepare(u, step, say) {
  say?.(u, {
    type: "prepare", step: step.step, desire: step.desire ?? null, target: step.target?.spec.name ?? null, targetId: step.target?.id ?? null,
    item: step.action?.name ?? null, worth: Math.round((step.worth ?? 0) * 10) / 10
  });
}

/* -------------------------------------------- */
/*  What it would do next turn                  */
/* -------------------------------------------- */

/** Whoever it most wants to hurt, standing: its lead, else the one it went for, else its strongest such wish. */
export function nextFoe(run, u) {
  const ok = t => t && isStanding(t) && areEnemies(run, u, t) && !heldOff(run, u, t) && !t.spec.untargetable;
  const lead = mind(run, u).lead;
  if ( lead?.kind === "hurt" && ok(run.byId.get(lead.targetId)) ) return run.byId.get(lead.targetId);
  if ( ok(run.byId.get(u.targetId)) ) return run.byId.get(u.targetId);
  const want = mind(run, u).ranked.find(d => d.kind === "hurt" && !d.sunk && ok(run.byId.get(d.targetId)));
  return want ? run.byId.get(want.targetId) : null;
}

/**
 * How many uses of an option fit a turn once `units` are spent before the first (moves, a draw, a Reload): the first
 * at its cost, each after it at its cost and its Reload (engine/gear.js), no more than it has worked out.
 */
export function usesIn(o, units, perTurn) {
  const left = perTurn - units;
  if ( !o || left < o.cost - 1e-9 ) return 0;
  return Math.min(o.evs.length, 1 + Math.floor((left - o.cost) / Math.max(0.5, o.cost + o.reload) + 1e-9));
}

/** What so many uses of an option would do: its first uses' expected damage, in order. */
export const usesWorth = (o, n) => o.evs.slice(0, n).reduce((s, x) => s + x, 0);

/**
 * Its best everyday way to hurt t next turn, from where it stands, with what its gear needs (nothing that needs
 * setting up first, nothing the system rules out): {action, evs (each use's expected damage in a turn, in order),
 * cost, reload, gear (units its gear needs now), moves (units to get there next turn), value}. Null for none.
 */
export function nextOption(run, u, t) {
  if ( !t ) return null;
  let best = null;
  for ( const a of u.prep.offense ?? [] ) {
    const o = optionFor(run, u, a, t);
    if ( o && (!best || o.value > best.value) ) best = o;
  }
  return best;
}

/**
 * One way to hurt t next turn (nextOption's), or null where it can't be used on t. Its value: what it does next turn
 * as things stand, or, with its gear made ready this turn instead, that, discounted, if that's more.
 */
export function optionFor(run, u, a, t) {
  const rules = run.prep.rules;
  if ( !t || !hasUses(u, a) || a.requires || (a.kind === "control" && !(a.damage?.length)) ) return null;
  if ( rules.usable && rules.usable(run, u, a, t) === false ) return null;
  const perTurn = unitsPerTurn(rules, u);
  const speed = t.pos && u.pos ? approach(run, u, t).speed : speedOf(u);
  const cost = Math.max(0.5, costUnits(rules, costOf(rules, a)));
  const evs = [];
  for ( let i = 0; i < Math.min(3, Math.max(1, Math.ceil(perTurn / cost))); i++ ) evs.push(expectedDamage(run, u, a, t, i));
  const o = { action: a, evs, cost, reload: reloadPerUse(a), gear: gearNeeds(u, a).reduce((s, n) => s + n.units, 0) };
  const pace = paceOf(rules, u.pos && t.pos ? movesFrom(run, u, u.pos, t, a.range ? { range: a.range.max ?? a.range.increment * 3 } : { reach: a.reach ?? 5 }, speed) : 0, cost, perTurn);
  o.moves = pace.units;
  const later = PREP.next ** pace.wait;
  o.value = Math.max(usesWorth(o, usesIn(o, o.moves + o.gear, perTurn)), PREP.next * usesWorth(o, usesIn(o, o.moves, perTurn))) * later;
  return o;
}

/**
 * What getting `units` of an option's gear done now is worth: what it can do next turn with them done, over what it
 * could do with them still to do then; at the least the units it frees next turn, at what the option does per unit
 * (a heavy crossbow loaded now shoots next turn and has its Reload's actions to load it again); discounted, and as
 * likely as it is to matter.
 */
export function gearWorth(run, u, o, units, t) {
  if ( !o ) return 0;
  const perTurn = unitsPerTurn(run.prep.rules, u);
  const gain = usesWorth(o, usesIn(o, o.moves + Math.max(0, o.gear - units), perTurn)) - usesWorth(o, usesIn(o, o.moves + o.gear, perTurn));
  const freed = Math.min(units, o.gear) * (o.evs[0] ?? 0) / Math.max(0.5, o.cost + o.reload);
  return Math.max(gain, freed) * PREP.next * gearMatters(run, u, t);
}

/* -------------------------------------------- */
/*  Where to end the turn                       */
/* -------------------------------------------- */

const SQUARE = 5;
/** Directions a spot is looked for in (16 round the compass). */
const DIRECTIONS = Array.from({ length: 16 }, (_, i) => [Math.cos(i * Math.PI / 8), Math.sin(i * Math.PI / 8)]);

/** Its speed on foot (or the fastest it has), with what it's lent or lost. */
export const speedOf = u => Math.max(5, (Math.max(...Object.values(u.spec.speeds ?? { walk: 25 }).map(Number).filter(Number.isFinite), 0) || 25) + (u.mods?.speed ?? 0));

/** A spot on u's grid (its middle, a square at a time). */
function onGrid(u, x, y) {
  const ox = ((u.pos.x % SQUARE) + SQUARE) % SQUARE;
  const oy = ((u.pos.y % SQUARE) + SQUARE) % SQUARE;
  return { x: Math.round((x - ox) / SQUARE) * SQUARE + ox, y: Math.round((y - oy) / SQUARE) * SQUARE + oy };
}

/** Inside the map's edges (spec.bounds), where it knows them. */
function onMap(run, p) {
  const b = run.prep.spec.bounds;
  return !b || (p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1);
}

/** Free spots it could end a move of `feet` on: rings round it, a square's width apart, none past a wall, none taken. */
function spotsWithin(run, u, feet) {
  const seen = new Set();
  const out = [];
  const rings = [...new Set([SQUARE, 10, Math.round(feet / 2 / SQUARE) * SQUARE, Math.floor(feet / SQUARE) * SQUARE].filter(r => r >= SQUARE && r <= feet))];
  const walls = wallsKnown(run);
  for ( const r of rings ) {
    for ( const [dx, dy] of DIRECTIONS ) {
      const p = onGrid(u, u.pos.x + dx * r, u.pos.y + dy * r);
      const key = `${p.x},${p.y}`;
      if ( seen.has(key) || (p.x === u.pos.x && p.y === u.pos.y) ) continue;
      seen.add(key);
      if ( Math.hypot(p.x - u.pos.x, p.y - u.pos.y) > feet + 0.5 || !onMap(run, p) || inTheWay(run, u, p) ) continue;
      if ( walls && sightBlocked(run, u.pos, p) ) continue;
      out.push(p);
    }
  }
  return out;
}

/** Its best strike's reach, and how far it shoots (an action's range: its first increment for one who keeps its distance). */
function reachOf(f) {
  let reach = -1;
  let range = 0;
  for ( const a of f.prep.offense ?? [] ) {
    if ( !hasUses(f, a) ) continue;
    if ( a.range ) range = Math.max(range, a.range.max ?? (a.range.increment ?? 0) * 3);
    else if ( a.kind === "strike" || a.melee ) reach = Math.max(reach, a.reach ?? 5);
  }
  return { reach, range };
}

/**
 * How much of a foe's round it can turn on someone at `d` feet (edge to edge): all of it in reach or range; less for
 * each move it must make first (a move an action: PF2e; a move free, then a Dash with no attack: 5e); none beyond.
 */
function reachFactor(run, f, d, info) {
  if ( info.range > 0 && d <= info.range + 0.5 ) return 1;
  if ( info.reach < 0 ) return 0;
  const gap = d - info.reach;
  if ( gap <= 0.5 ) return 1;
  if ( info.still || !(info.speed > 0) ) return 0;
  const moves = Math.ceil(gap / info.speed);
  const rules = run.prep.rules;
  if ( rules.movement === "feet" ) return moves <= 1 ? 0.9 : 0;
  const left = info.perTurn - moves;
  return left <= 0 ? 0 : left >= 3 ? 1 : left === 2 ? 0.8 : 0.5;
}

/** The foes on the map as u sees the coming round: how hard each hits it, how far it reaches, how fast it comes. */
function foesOf(run, u) {
  const rules = run.prep.rules;
  return enemiesOf(run, u).filter(o => isStanding(o) && o.pos && !heldOff(run, u, o) && !o.spec.hazard).map(f => {
    const r = reachOf(f);
    return { f, ...r, threat: threatOf(run, f, u), speed: speedOf(f), still: !canMove(run, f), perTurn: unitsPerTurn(rules, f), mine: f.targetId === u.id };
  });
}

/** A stand-in for u at p, to measure from (its own id per spot: the sight cache keeps each apart). */
const at = (u, p) => ({ id: `${u.id}@${p.x},${p.y}`, pos: p, spec: u.spec });

/** How much a foe's shots lose to the cover between it and p (none: all; some; most; total: nothing gets through). */
function coverShare(run, u, p, foe) {
  if ( !wallsKnown(run) ) return 1;
  const n = blockedPoints(run, foe.f, at(u, p), foe.f.pos);
  return n === 0 ? 1 : n <= 2 ? 0.85 : n < 5 ? 0.6 : 0;
}

/**
 * The harm foes would do it at p in the coming round: each one's threat, as far as it can turn it on it there, as likely
 * as it is to pick it over the friends nearer it (the one already on it, likelier), through what cover p gives from a
 * shooter.
 */
function harmAt(run, u, p, ctx) {
  let total = 0;
  for ( const foe of ctx.foes ) {
    const d = edgeAt(u, p, foe.f);
    const rf = reachFactor(run, foe.f, d, foe);
    if ( !(rf > 0) ) continue;
    let nearer = 0;
    for ( const x of foe.friendsAt ) if ( x < d - 2.5 ) nearer += 1;
    const focus = foe.mine ? 0.75 : 1 / (1 + nearer);
    const cover = foe.range > 0 && d > foe.reach + 0.5 ? coverShare(run, u, p, foe) : 1;
    total += foe.threat * rf * focus * cover;
  }
  return total;
}

/** The moves it takes from p to have t within `reach` (or `range`, in sight). */
function movesFrom(run, u, p, t, { reach = null, range = null } = {}, speed) {
  const d = edgeAt(u, p, t);
  const gap = range !== null ? d - range : d - (reach ?? 5);
  let moves = gap <= 0.5 ? 0 : Math.ceil(gap / Math.max(5, speed));
  // (A shot needs to see it: from behind a wall, a move to where it can.)
  if ( range !== null && moves === 0 && wallsKnown(run) && blockedPoints(run, u, t, p) >= 5 ) moves = 1;
  return moves;
}

/**
 * So many moves before something that costs `cost`: the turns of nothing but moving first (`wait`), and the main-pool
 * units the moves take on the turn it does it (`units`). A move an action (PF2e), or the first free and a Dash for each
 * after, that turn's action gone (5e).
 */
export function paceOf(rules, moves, cost, perTurn) {
  if ( rules.movement === "feet" ) {
    if ( moves <= 1 ) return { wait: 0, units: 0 };
    return { wait: Math.ceil((moves - 1) / 2), units: 0 };
  }
  const most = Math.max(0, Math.floor(perTurn - cost + 1e-9));
  if ( moves <= most ) return { wait: 0, units: moves };
  const wait = Math.ceil((moves - most) / Math.max(1, perTurn));
  return { wait, units: Math.max(0, moves - wait * perTurn) };
}

/** A little less for each foot still to go (a tenth, four moves off or more): nothing once it's within reach or range. */
const closer = (gap, speed) => 1 - 0.1 * Math.min(1, Math.max(0, gap) / (4 * Math.max(5, speed)));

/** What it could do to the foe it wants next turn from p: its best option's uses that fit after the moves (a friend on it: flanked). */
function offenseAt(run, u, p, ctx) {
  const o = ctx.option;
  if ( !o ) return 0;
  const a = o.action;
  const effective = a.range ? (ctx.kiter ? a.range.increment ?? a.range.max : a.range.max ?? a.range.increment * 3) : null;
  const pace = paceOf(run.prep.rules, movesFrom(run, u, p, ctx.foe, a.range ? { range: effective } : { reach: a.reach ?? 5 }, ctx.speed), o.cost, ctx.perTurn);
  const fit = usesIn(o, pace.units + o.gear, ctx.perTurn);
  // (Farther than a turn's moves: worth less the more turns it takes to get there, and a little less the farther, so
  // closing in still counts.)
  let total = usesWorth(o, fit) * PREP.next ** pace.wait * closer(edgeAt(u, p, ctx.foe) - (effective ?? a.reach ?? 5), ctx.speed);
  // (Beside its foe with a friend beside it too: flanked, where the system makes anything of it.)
  if ( a.melee && fit > 0 && ctx.flanks && edgeAt(u, p, ctx.foe) <= (a.reach ?? 5) + 0.5 ) total *= PREP.flank;
  return total;
}

/** What it could do for the friend it means to heal next turn from p: the heal, if the moves and the heal fit a turn. */
function healAt(run, u, p, ctx) {
  const h = ctx.heal;
  if ( !h ) return 0;
  const pace = paceOf(run.prep.rules, movesFrom(run, u, p, h.target, h.action.range ? { range: h.action.range.max ?? h.action.range.increment * 3 } : { reach: h.action.reach ?? 5 }, ctx.speed), h.units, ctx.perTurn);
  return h.worth * PREP.next ** pace.wait * closer(edgeAt(u, p, h.target) - (h.action.range ? h.action.range.max ?? h.action.range.increment * 3 : h.action.reach ?? 5), ctx.speed);
}

/**
 * What standing at p spares the friends it guards: each foe that could get at one of them, as likely to turn on u
 * instead as u is the nearer, easier target (in reach where the friend isn't, closer, a protector's pull), the more so
 * standing across its way to them.
 */
function guardAt(run, u, p, ctx) {
  if ( !ctx.wards.length ) return 0;
  let total = 0;
  for ( const foe of ctx.foes ) {
    if ( !foe.wards.length ) continue;
    const dp = edgeAt(u, p, foe.f);
    const mine = reachFactor(run, foe.f, dp, foe) * (1 + ctx.draws) / (1 + dp / 15);
    for ( const w of foe.wards ) {
      let share = mine / Math.max(1e-6, mine + w.theirs);
      if ( across(p, foe.f.pos, w.unit.pos) ) share = Math.min(0.9, share + 0.3);
      total += w.harm * share * w.weight;
    }
  }
  return total * ctx.guard;
}

/** Is p across the way from a to b (within a square and a half of the line between them, between the two)? */
function across(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if ( !len2 ) return false;
  const k = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  if ( k <= 0.1 || k >= 0.9 ) return false;
  return Math.hypot(a.x + k * dx - p.x, a.y + k * dy - p.y) <= 7.5;
}

/**
 * Could it hide at p: no foe sees it there, or each that might has it behind cover (the system's own test where it has
 * one is its Hide's `rules.usable`; this is the same reckoning, by the walls).
 */
function hideable(run, u, p, ctx) {
  if ( !wallsKnown(run) ) return false;
  let seen = 0;
  for ( const foe of ctx.foes ) {
    const n = blockedPoints(run, foe.f, at(u, p), foe.f.pos);
    if ( n >= 5 ) continue;
    if ( n === 0 ) return false;
    seen += 1;
  }
  return seen >= 0;
}

/** What hiding next turn from p is worth to a hider: its foes' blows half as likely to find it, and its sneaky edge. */
function hideAt(run, u, p, ctx, harm) {
  if ( !ctx.hider || !hideable(run, u, p, ctx) ) return 0;
  return ctx.hider.chance * (0.5 * harm + ctx.hider.edge);
}

/** Cornered at p: nowhere to go back to, away from the nearest foe (walls, the map's edge, others in the way). */
function cornered(run, u, p, ctx) {
  const near = ctx.foes.reduce((b, foe) => (!b || edgeAt(u, p, foe.f) < edgeAt(u, p, b.f) ? foe : b), null);
  if ( !near ) return false;
  const dx = p.x - near.f.pos.x;
  const dy = p.y - near.f.pos.y;
  const len = Math.hypot(dx, dy) || 1;
  const walls = wallsKnown(run);
  for ( const turn of [0, Math.PI / 4, -Math.PI / 4] ) {
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const q = { x: p.x + ((dx * c - dy * s) / len) * 10, y: p.y + ((dx * s + dy * c) / len) * 10 };
    if ( onMap(run, q) && !(walls && sightBlocked(run, p, q)) && !inTheWay(run, u, q) ) return false;
  }
  return true;
}

/**
 * How much a creature minds being hit, by who it is (0.05 to 3): a little, for anyone; much more for the selfish, the
 * timid, the badly hurt, those who'd rather keep a low profile or run (Chicken, Fragile, Wallflower), shooters and
 * casters keeping their distance, and kiters most; half as much for protectors and those who draw the blows.
 */
export function harmWeight(run, u) {
  const b = behaviorOf(u);
  let w = 0.1 + 0.4 * Math.max(0, liveTrait(run, u, "selfish") - 50) / 50 + 0.4 * Math.max(0, 50 - liveTrait(run, u, "brave")) / 50;
  w += 0.6 * (Number(b.lowProfile) || 0) + 0.2 * (Number(b.flighty) || 0);
  if ( u.maxHp > 0 && u.hp / u.maxHp < 0.5 ) w += 1.2 * (0.5 - u.hp / u.maxHp);
  if ( u.tac?.style === "ranged" || u.tac?.style === "caster" ) w += 0.3;
  w += PREP.kite * (Number(b.kite) || 0);
  if ( protective(u) || (Number(b.drawAggro) || 0) > 0 ) w *= 0.5;
  if ( mind(run, u).obsessed ) w *= 0.3;
  return clamp(w, 0.05, 3);
}

/** A hider: one that keeps a low profile or strikes from hiding, with a way to hide. {chance, edge} or null. */
function hiderOf(run, u) {
  const hide = (u.prep.buffActions ?? []).find(a => a.targets === "self" && [a.outcome, ...(a.onDegree ?? [])].some(o => Number(o?.conditions?.hidden) > 0));
  if ( !hide || !hasUses(u, hide) ) return null;
  const sneaky = (u.prep.offense ?? []).flatMap(a => a.bonusDamage ?? []).filter(x => [].concat(x.when).some(w => w === "offGuard" || w === "exposed"));
  const low = Number(behaviorOf(u).lowProfile) || 0;
  if ( !sneaky.length && !(low > 0) && !u.spec.camouflage ) return null;
  const edge = sneaky.length ? Math.max(...sneaky.map(x => (x.parts ?? []).reduce((s, q) => s + Math.max(0, meanPart(q)), 0))) * 0.6 : 0;
  return { chance: clamp(0.5 + low, 0.5, 1), edge };
}

/** The friends it guards, and how much each: those it wants to protect, and (a protector) the weaker ones near it. */
function wardsOf(run, u, friends) {
  const out = [];
  const keen = protective(u);
  for ( const a of friends ) {
    const want = levelOf(u, "protect", a.id);
    const weak = keen && ((a.maxHp > 0 && a.hp / a.maxHp < 0.5) || a.prep.isCaster || a.prep.isHealer || (a.tac?.style === "ranged"));
    if ( want > 0 || weak ) out.push({ unit: a, weight: Math.max(want / 50, weak ? 0.6 : 0) });
  }
  return out;
}

/** The heal it means to give next turn: {target, action, units, worth}, a friend's it can't reach this turn. */
function healPlan(run, u) {
  const lead = mind(run, u).ranked.find(d => d.kind === "heal" && d.targetId !== u.id && !d.sunk);
  const w = lead ? run.byId.get(lead.targetId) : null;
  if ( !w || !w.pos ) return null;
  const rules = run.prep.rules;
  let best = null;
  for ( const a of u.prep.healActions ?? [] ) {
    if ( !hasUses(u, a) || a.selfOnly || (!a.range && a.reach === undefined) ) continue;
    if ( a.firstAid && !(w.status === STATUS.DOWN && !w.stable) ) continue;
    if ( !a.firstAid && rules.usable && rules.usable(run, u, a, w) === false ) continue;
    const mean = (a.heal ?? []).reduce((s, q) => s + Math.max(0, meanPart(q)), 0);
    const worth = (w.status === STATUS.DOWN ? 10 + 0.25 * (w.maxHp ?? 0) : 0) + mean;
    if ( !best || worth > best.worth ) best = { target: w, action: a, units: normalizeCost(rules, costOf(rules, a, u))[mainPool(rules)] ?? 1, worth };
  }
  return best;
}

/**
 * What u has in view for the coming round, worked out once a look (its foes, friends, the foe and the friend it's
 * after, those it guards, how much it minds being hit, whether it hides).
 */
function lookAhead(run, u) {
  const rules = run.prep.rules;
  const friends = alliesOf(run, u).filter(a => a !== u && isStanding(a) && a.pos);
  const foe = nextFoe(run, u);
  const option = foe?.pos ? nextOption(run, u, foe) : null;
  const behavior = behaviorOf(u);
  const kiter = (Number(behavior.kite) || 0) > 0;
  const wards = wardsOf(run, u, friends);
  const foes = foesOf(run, u);
  // (What doesn't hang on where u stands, worked out once: how far its friends are from each foe, and what each foe
  // would do to each friend u guards.)
  for ( const foe of foes ) {
    foe.friendsAt = friends.map(a => edgeAt(a, a.pos, foe.f));
    foe.wards = [];
    for ( const w of wards ) {
      const dw = edgeAt(w.unit, w.unit.pos, foe.f);
      const rf = reachFactor(run, foe.f, dw, foe);
      if ( rf > 0 ) foe.wards.push({ unit: w.unit, weight: w.weight, theirs: rf / (1 + dw / 15), harm: threatOf(run, foe.f, w.unit) * rf });
    }
  }
  return {
    foes,
    friends,
    foe: foe?.pos ? foe : null,
    option,
    flanks: !!foe && liveTier(run, u) >= TACTICAL.COMPETENT && friends.some(a => a.adjacent?.has(foe.id)),
    heal: healPlan(run, u),
    wards,
    guard: protective(u) ? 0.8 + liveTrait(run, u, "loyal") / 250 : 0.3,
    draws: Number(behavior.drawAggro) || 0,
    harmW: harmWeight(run, u),
    hider: hiderOf(run, u),
    kiter: kiter ? Number(behavior.kite) : 0,
    perTurn: unitsPerTurn(rules, u),
    speed: speedOf(u)
  };
}

/** What ending the turn at p is worth, as u sees the coming round. */
function spotWorth(run, u, p, ctx) {
  const harm = harmAt(run, u, p, ctx);
  let v = PREP.next * (offenseAt(run, u, p, ctx) + healAt(run, u, p, ctx) + guardAt(run, u, p, ctx) + hideAt(run, u, p, ctx, harm));
  v -= PREP.harm * ctx.harmW * harm;
  if ( ctx.kiter || ctx.harmW >= 0.8 ) {
    // (Back toward its friends rather than away from them; a kiter never into a corner.)
    const near = ctx.friends.reduce((m, a) => Math.min(m, edgeAt(u, p, a)), Infinity);
    if ( Number.isFinite(near) ) v += (ctx.kiter ? 1 : 0.5) * (near <= 30 ? 1 : 30 / near);
    if ( ctx.kiter && cornered(run, u, p, ctx) ) v -= ctx.kiter * 0.5 * ctx.foes.reduce((s, f) => s + f.threat, 0);
  }
  return v;
}

/** What walking from where it is to p would draw: the blows of those whose reach it leaves (`near`: moveThreats'). */
function moveRisk(u, p, near) {
  let risk = 0;
  for ( const { e, reach, harm } of near ) if ( edgeAt(u, p, e) > reach + 0.5 ) risk += harm;
  return risk;
}

/** Those who'd strike it as it walks out of their reach (none once it got clear: disengaged), and what each blow does. */
function moveThreats(run, u) {
  if ( u.disengaged ) return [];
  return threats(run, u).map(({ e, strike }) => ({ e, reach: strike.reach ?? 5, harm: expectedDamage(run, e, strike, u, 0) }));
}

/**
 * Where it would best end a move now: {to, feet, kind ("stride", "step", "free"), cost, gain, step} (gain: over staying,
 * less the risk), or null where nowhere is better by PREP.least. `kinds`: the moves it can afford (a Stride, a Step,
 * movement it has left).
 */
export function bestSpot(run, u, turn, { ctx = null } = {}) {
  if ( !mayWalk(run, u, turn) || !canMove(run, u) ) return null;
  const rules = run.prep.rules;
  const look = ctx ?? lookAhead(run, u);
  if ( !look.foes.length ) return null;
  const kinds = [];
  const speed = Math.max(5, approachSpeed(run, u, look.foe) ?? look.speed);
  if ( turn.feetMovement && (turn.pools.move ?? 0) >= SQUARE ) kinds.push({ kind: "free", feet: turn.pools.move, cost: null });
  else if ( turn.left >= 1 ) kinds.push({ kind: "stride", feet: turn.feetMovement ? (turn.pools.move ?? 0) + speed : speed, cost: normalizeCost(rules, 1) });
  const safe = rules.disengage?.(u);
  if ( safe && !turn.feetMovement && turn.canAfford(safe.cost) && threats(run, u).length ) kinds.push({ kind: "step", feet: SQUARE, cost: safe.cost, label: safe.label ?? "" });
  if ( !kinds.length ) return null;
  const here = spotWorth(run, u, u.pos, look);
  const near = moveThreats(run, u);
  let best = null;
  for ( const k of kinds ) {
    for ( const p of spotsWithin(run, u, k.feet) ) {
      const risk = k.kind === "step" ? 0 : moveRisk(u, p, near);
      const gain = spotWorth(run, u, p, look) - here - risk;
      if ( gain >= PREP.least && (!best || gain > best.gain) ) best = { ...k, to: p, gain, feetTo: Math.hypot(p.x - u.pos.x, p.y - u.pos.y), look };
    }
  }
  if ( best ) best.step = moveKind(run, u, best, look, here);
  return best;
}

/** Could it move somewhere this turn at all: on a map, on its feet, with an action or movement to spare? */
const mayWalk = (run, u, turn) => !!run.prep.options.positioning && !!u.pos && u.status === STATUS.STANDING && !u.prone
  && (turn.left >= 1 || (turn.feetMovement && (turn.pools.move ?? 0) >= SQUARE));

/** How fast it goes toward what it's after (the approach table's, with what it's lent or lost). */
function approachSpeed(run, u, t) {
  return t ? approach(run, u, t).speed : null;
}

/**
 * What a move to a better spot is for, told by what gains most there: closing on its foe (or into range), the friend
 * it means to heal, a guard spot, cover, out of reach.
 */
function moveKind(run, u, best, ctx, here) {
  const p = best.to;
  const parts = {
    approach: PREP.next * (offenseAt(run, u, p, ctx) - offenseAt(run, u, u.pos, ctx)),
    tend: PREP.next * (healAt(run, u, p, ctx) - healAt(run, u, u.pos, ctx)),
    guard: PREP.next * (guardAt(run, u, p, ctx) - guardAt(run, u, u.pos, ctx)),
    cover: PREP.next * (hideAt(run, u, p, ctx, harmAt(run, u, p, ctx)) - hideAt(run, u, u.pos, ctx, harmAt(run, u, u.pos, ctx))),
    fallBack: PREP.harm * ctx.harmW * (harmAt(run, u, u.pos, ctx) - harmAt(run, u, p, ctx))
  };
  let step = Object.entries(parts).reduce((b, e) => (e[1] > b[1] ? e : b), ["approach", -Infinity])[0];
  // (Somewhere a hider can hide from, where it couldn't: for cover, whatever else it gains there.)
  if ( ctx.hider && parts.cover > 0 && hideAt(run, u, u.pos, ctx, 0) === 0 ) step = "cover";
  if ( step === "approach" && ctx.option?.action.range ) step = "range";
  if ( step === "approach" && ctx.flanks && ctx.option?.action.melee ) step = "flank";
  if ( step === "fallBack" && ctx.kiter && (u.turnAttacks ?? 0) > 0 ) step = "hitAndRun";
  return step;
}

/* -------------------------------------------- */
/*  With what's spare                           */
/* -------------------------------------------- */

/**
 * A potion (a heal of its own it must get out first) it wants and can't drink this turn: got out now, to drink next.
 * Worth its healing, discounted, as badly as it's hurt.
 */
export function potionStep(run, u, turn) {
  if ( !(u.maxHp > 0) ) return null;
  const frac = u.hp / u.maxHp;
  const at = Number(u.tac?.potionThreshold);
  if ( !(levelOf(u, "heal", u.id) > 0) && !(at > 0 && frac < at / 100) ) return null;
  const rules = run.prep.rules;
  let best = null;
  for ( const a of u.prep.healActions ?? [] ) {
    if ( !a.selfOnly || !needsDraw(u, a) || !hasUses(u, a) ) continue;
    if ( rules.usable && rules.usable(run, u, a, u) === false ) continue;
    // (Both this turn: it simply drinks it, decideHeal's.)
    if ( turn.canAfford(costOf(rules, a, u)) ) continue;
    const cost = normalizeCost(rules, Number(a.drawCost));
    if ( !turn.canAfford(cost) ) continue;
    const mean = (a.heal ?? []).reduce((s, q) => s + Math.max(0, meanPart(q)), 0);
    const worth = mean * PREP.next * clamp(2 * (1 - frac), 0, 1);
    if ( !best || worth > best.worth ) best = { step: "retrieve", cost, action: a, target: u, desire: "heal", worth };
  }
  return best;
}

/** Up off the ground with an action to spare (one that bore it until now): worth a share of the round's give and take. */
function standStep(run, u, turn, ctx) {
  if ( !u.prone || !run.prep.rules ) return null;
  const rules = run.prep.rules;
  const cost = normalizeCost(rules, rules.standCost ? rules.standCost(u) : rules.basicAction ?? 1);
  if ( !turn.canAfford(cost) ) return null;
  const give = ctx.option ? usesWorth(ctx.option, usesIn(ctx.option, ctx.option.moves + ctx.option.gear, ctx.perTurn)) : 0;
  return { step: "stand", cost, worth: PREP.prone * (give + (u.pos ? harmAt(run, u, u.pos, ctx) : ctx.foes.reduce((s, f) => s + f.threat, 0))) };
}

/**
 * The best thing to do with what's spare of its turn, for next turn's sake: its gear for its best option, a potion
 * got out, standing up, a raised shield (`kit.shield`: what raising it now is worth, or null), a better spot to end the
 * turn on. {step, cost, worth, ...} or null where nothing is worth PREP.least. `moves: false`: no moving.
 */
export function spareBest(run, u, turn, kit = {}, { moves = true } = {}) {
  if ( !isStanding(u) || u.spec.hazard ) return null;
  const walks = moves && mayWalk(run, u, turn);
  if ( !(turn.left > 0) && !walks ) return null;
  // (What it has in view for the coming round, worked out only where something needs it.)
  let ctx = null;
  const look = () => (ctx ??= lookAhead(run, u));
  const options = [];
  if ( turn.left > 0 ) {
    // (Whichever of its weapons getting ready does most for: the one it would use next turn, most often.)
    const foe = u.prep.offense?.some(a => gearNeeds(u, a).length) ? nextFoe(run, u) : null;
    let gear = null;
    for ( const a of foe ? u.prep.offense : [] ) {
      if ( !gearNeeds(u, a).length ) continue;
      const g = gearStep(run, u, turn, a, foe);
      if ( g && (!gear || g.worth > gear.worth) ) gear = g;
    }
    if ( gear ) options.push(gear);
    const potion = potionStep(run, u, turn);
    if ( potion ) options.push(potion);
    const stand = u.prone ? standStep(run, u, turn, look()) : null;
    if ( stand ) options.push(stand);
    const shield = kit.shield?.(turn);
    if ( shield ) options.push(shield);
  }
  if ( walks ) {
    const spot = bestSpot(run, u, turn, { ctx: look() });
    if ( spot ) options.push({ step: spot.step, move: spot, cost: spot.cost, worth: spot.gain, target: targetOfMove(spot, ctx), desire: desireOfMove(spot.step) });
  }
  const best = options.reduce((b, x) => (x.worth > (b?.worth ?? -Infinity) ? x : b), null);
  return best && best.worth >= PREP.least ? best : null;
}

/** Whom a move is about: the foe it's after, the friend it means to heal, the one it guards, the foe it keeps from. */
function targetOfMove(spot, ctx) {
  if ( spot.step === "tend" ) return ctx.heal?.target ?? null;
  if ( spot.step === "guard" ) return ctx.wards[0]?.unit ?? null;
  if ( ["fallBack", "hitAndRun", "cover"].includes(spot.step) ) return nearestFoe(spot.to, ctx);
  return ctx.foe;
}

/** The desire a move serves. */
const desireOfMove = step => ({ approach: "hurt", range: "hurt", flank: "hurt", tend: "heal", guard: "protect", cover: "hurt", fallBack: "avoid", hitAndRun: "avoid" }[step] ?? null);

/** The foe nearest a spot. */
function nearestFoe(p, ctx) {
  let best = null;
  let d = Infinity;
  for ( const { f } of ctx.foes ) {
    const x = Math.hypot(f.pos.x - p.x, f.pos.y - p.y);
    if ( x < d ) { d = x; best = f; }
  }
  return best;
}

/**
 * A spare step taken: paid for, done and told. A move goes through the simulator's own (`kit.walk(u, turn, spot,
 * toward)`: the reactions it draws, played and answered); a shield through `kit.raise`. Returns whether it's still up.
 */
export function takeSpare(run, u, turn, pick, kit) {
  const say = kit.say;
  if ( pick.step === "shield" ) {
    kit.raise(turn);
    return isStanding(u);
  }
  if ( pick.move ) {
    tellPrepare(u, pick, say);
    return kit.walk(u, turn, pick.move, pick.target, pick.step);
  }
  if ( pick.step === "stand" ) {
    turn.spend(pick.cost);
    tellPrepare(u, pick, say);
    return kit.stand(u);
  }
  takeGearStep(run, u, turn, pick, say);
  return isStanding(u);
}

/**
 * What's left of its turn, spent getting ready for the next (the turn's main actions done: it found nothing better to
 * do with them): one step after another while any is worth it. True if it did anything.
 */
export function spareTurn(run, u, turn, kit) {
  let did = false;
  for ( let i = 0; i < 4 && isStanding(u); i++ ) {
    const pick = spareBest(run, u, turn, kit);
    if ( !pick ) break;
    did = true;
    if ( !takeSpare(run, u, turn, pick, kit) ) break;
  }
  return did;
}

/* -------------------------------------------- */
/*  Healing it can't give this turn             */
/* -------------------------------------------- */

/**
 * The heal it means to give but can't this turn (out of reach, or not enough of the turn left): the step toward it that
 * fits, as the turn's own when healing leads its mind. Toward a friend out of reach: {step: "tend", target, action}, a
 * move toward them (only as far as the heal needs); itself, a potion to get out: {step: "retrieve", ...}. Null for none.
 */
export function healAhead(run, u, turn) {
  const lead = mind(run, u).lead;
  if ( lead?.kind !== "heal" ) return null;
  const w = run.byId.get(lead.targetId);
  if ( !w ) return null;
  if ( w === u ) return potionStep(run, u, turn);
  const plan = healPlan(run, u);
  if ( !plan || plan.target !== w || !canMove(run, u) || !u.pos || !w.pos || turn.left < 1 && !(turn.feetMovement && (turn.pools.move ?? 0) >= SQUARE) ) return null;
  const a = plan.action;
  const reach = a.range ? null : (a.reach ?? 5);
  const range = a.range ? a.range.max ?? a.range.increment * 3 : null;
  if ( edgeAt(u, u.pos, w) <= (range ?? reach) + 0.5 ) return null;
  return { step: "tend", target: w, action: a, reach, range, desire: "heal", worth: plan.worth * PREP.next };
}

/** Told: the why of a step for later the simulator takes itself (a move toward a friend to heal). */
export const tellStep = (u, step, say) => tellPrepare(u, step, say);

/** What a spot's worth, part by part, for the planner's reasoning and the tests: u's look ahead, and each part at p. */
export function spotParts(run, u, p, ctx = lookAhead(run, u)) {
  const harm = harmAt(run, u, p, ctx);
  return { offense: offenseAt(run, u, p, ctx), heal: healAt(run, u, p, ctx), guard: guardAt(run, u, p, ctx), hide: hideAt(run, u, p, ctx, harm), harm, worth: spotWorth(run, u, p, ctx) };
}
