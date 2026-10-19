/**
 * Patrolling (API 20): a turn in the fight with nothing better to do in it (no foe it knows of to go for, nothing else it
 * wants that it can work on, no step for later worth more) spent looking for a foe, rather than standing idle. Any
 * system: the system says how a creature searches (rules.seek), the core how it goes about it.
 *
 * Who patrols, and how (patrolMode): its playstyles say first (playstyles.js `patrol`, each pill a vote as heavy as its
 * place), then its nature, then its tactics:
 *   roam    an animal (animal.js), taken to be hungry: toward the strongest cue, else it wanders, its search widening
 *           each turn it finds nothing (PATROL.wander); a pack keeps loosely together (PATROL.pack), and goes where a
 *           packmate's cue leads.
 *   spread  a patroller (Wants to Lead, Tank, Brawler, Lore-Collector, Vengeful, Relentless ...): toward a cue, else out
 *           to 20 to 30 feet (PATROL.spread) from its teammates, where it hasn't searched yet.
 *   near    keeps by its teammates (PATROL.near: a Medic, an Enabler, a Martyr ...), searching from there, going where
 *           they go.
 *   watch   anyone else: toward the din of a fight it hears, else it searches from where it stands.
 *   hold    searches from where it stands and goes nowhere (Lazy, Fragile, a Diplomat; tactics' "Stay with the fight").
 *   hide    keeps out of sight (Chicken, Wallflower): hides where it can, else stays put, watching.
 * Its teammates are its own side, or its friend group (battle-state.js alliesOf): not every friendly creature.
 * Tactics "Stay with the fight" (beyond "stay") holds it to where it stands whatever its pills say; "Hunt down enemies
 * nearby" (beyond "hunt") makes a watcher a patroller.
 *
 * The cues (cueOf), strongest first: a foe's scent it can follow (scent: within PATROL.trail times its smell, along the
 * way there, walls and all), the din of a fight it hears (noise: a quiet Perception check, the Statistics Engine's,
 * against the notice system's DC, senses.js hearDC, once a turn, to the easiest fight to hear), a foe its teammates have
 * in view (seen), and, for a pack animal, where a packmate's cue leads (pack). Each is a creature to head for, the
 * engine's way (its approach, the way round walls; a door on the way opened as any is).
 *
 * Searching is a Seek (seek): an action (rules.seek.cost, else the basic action) and a check, its Perception, against
 * the Stealth DC (10 + its Stealth, spec.initiative.stealth; rules.seek.dc may say otherwise) of each foe in the area
 * (rules.seek.area toward where it's looking, a 30-foot cone; with nowhere in particular, rules.seek.around, round itself
 * 15 feet) that's hidden from it or out of its senses, walls blocking as they block sight. One it beats is known to it
 * (desire.js seenFoes) and, hidden, not hidden from it any more (senses.js hiddenFrom; invisible, still hidden). One roll
 * for all of them, against the hardest of their DCs (nobody there: the typical DC for its level); in a live battle the
 * system's own (systemRolled, purpose "seek": PF2e's Seek action), else a table roll (`what` "seek"). rules.seek false:
 * no Seek, it moves and watches. A spot searched (PATROL.fresh) this round or last isn't searched again: a turn with
 * three actions is Seek, Stride, Seek from a fresh spot, Stride, Seek, Stride from one searched already; toward a cue,
 * Strides, and a Seek with its last action.
 *
 * Its moves count the harm foes it knows of could do it, as a spot for later is weighed (prepare.js walkRisk). Whatever
 * it finds (a foe in its senses, known), it goes back to fighting: at once, with what's left of its turn.
 * Fidgeting (fidget): a turn spent doing nothing at all, now and then it fidgets, as the world's ADHD setting and its own
 * say: a step aside, or a look elsewhere (where its next Seek looks). Never in place of anything else.
 * Logged: `patrol` (how, cue, toward), `seek` (its roll, the DC, who it found), `fidget` (how), and its moves (`move`,
 * purpose "patrol" or "fidget", `patrol: true`: told by those events).
 * Pure: no Foundry globals.
 */
import { STATUS, ADHD, clamp } from "../../constants.js";
import { isStanding, alliesOf, edgeDistance, approach, canMove, checkRoll, systemRolled, typical, inArea, areEnemies } from "../battle-state.js";
import { patrolStyle } from "../playstyles.js";
import { isAnimalistic } from "./animal.js";
import { perceives, knowsOf, hearDC, sensesOf, hiddenFrom } from "./senses.js";
import { seemsFoe } from "./neutral.js";
import { holdsOf } from "./holds.js";
import { isLeaving } from "./leaving.js";
import { spotsWithin, speedOf, walkRisk } from "./prepare.js";
import { rollCheck, regrade } from "../probability.js";
import { normalizeCost } from "../turn.js";

/**
 * spread: the feet from its nearest teammate a patroller spreads out to. near: the feet a "near" one keeps within.
 * pack: the most a pack animal strays from its nearest packmate. trail: a scent followed as far as so many times its
 * smell reaches, along the way there. fresh: a spot within so many feet of one searched this round or last isn't searched
 * again. wander: how far from where it began a wanderer searches, widening by `step` each turn, to `most`. least: what a
 * spot must be better than where it stands to walk there (in the spot's own points).
 */
export const PATROL = Object.freeze({ spread: [20, 30], near: 15, pack: 30, trail: 2, fresh: 15, wander: Object.freeze({ start: 20, step: 15, most: 120 }), least: 0.5 });

/** A Seek where the system says nothing: toward where it looks, a 30-foot cone; with nowhere in particular, round itself. */
export const SEEK = Object.freeze({ area: Object.freeze({ shape: "cone", feet: 30 }), around: Object.freeze({ shape: "emanation", feet: 15 }) });

/** How often an idle creature fidgets: the world's ADHD share times (base + its own ADHD share). */
export const FIDGET = Object.freeze({ base: 0.5 });

/** The cues, strongest first. */
export const CUES = Object.freeze(["scent", "noise", "seen", "pack"]);

/* -------------------------------------------- */
/*  Who patrols                                 */
/* -------------------------------------------- */

/** How u patrols: "roam", "spread", "near", "watch", "hold" or "hide" (see the header). */
export function patrolMode(run, u) {
  const said = patrolStyle(u.spec.playstyles ?? []);
  const animal = isAnimalistic(u);
  let mode = said ?? (animal ? "roam" : "watch");
  if ( animal && (mode === "spread" || mode === "watch") ) mode = "roam";
  if ( mode === "watch" && u.tac?.beyond === "hunt" ) mode = "spread";
  // (Holding its ground, whatever its pills say: it searches from where it stands, or keeps hidden there.)
  if ( u.tac?.beyond === "stay" && mode !== "hide" ) mode = "hold";
  return mode;
}

/** Does it go anywhere looking (a hold or hide one doesn't)? */
const roams = mode => mode !== "hold" && mode !== "hide";
/** Does it walk about with no cue to follow (a watcher only goes toward a cue)? */
const wanders = mode => mode === "roam" || mode === "spread" || mode === "near";

/** Its foes in the fight (those a standoff holds off too) and the bystanders it takes for prey: those it could find. */
const foesHere = (run, u) => run.units.filter(o => o !== u && o.status === STATUS.STANDING && !o.spec.hazard && !o.spec.untargetable
  && (areEnemies(run, u, o) ? o.active !== false : seemsFoe(run, u, o)));

/** Does u know of a foe on its feet (senses.js knowsOf)? None: it has nothing to go for. */
export const knowsAFoe = (run, u) => foesHere(run, u).some(o => knowsOf(run, u, o));

/**
 * May u patrol this turn: in the fight (no standoff holding), on its feet, knowing of no foe, not leaving, not held (a
 * grab, its bonds, a hold it would break), not a hazard or something summoned?
 */
export function mayPatrol(run, u) {
  if ( run.standoff || !u.active || !isStanding(u) || u.spec.hazard || u.summoner || isLeaving(u) ) return false;
  if ( holdsOf(run, u).length ) return false;
  return !knowsAFoe(run, u);
}

/** Its teammates on the map: its side, or its friend group, standing. */
export const teammates = (run, u) => alliesOf(run, u).filter(o => o !== u && isStanding(o) && o.pos);

/** Its pack: teammates that are animals too. */
const packOf = (run, u) => (isAnimalistic(u) ? teammates(run, u).filter(isAnimalistic) : []);

/* -------------------------------------------- */
/*  Cues                                        */
/* -------------------------------------------- */

/** How far it is to t the way it would go (around walls: the approach's own reckoning), in feet. */
function wayTo(run, u, t) {
  const d = edgeDistance(u, t);
  if ( d === null ) return Infinity;
  const mult = approach(run, u, t).mult;
  return Number.isFinite(mult) && mult > 0 ? d * Math.max(1, mult) : Infinity;
}

/** A foe on the map whose scent it can follow: within PATROL.trail times its smell, the way there. The nearest, or null. */
function scentCue(run, u, foes) {
  const smell = sensesOf(run, u).smell;
  if ( !(smell > 0) ) return null;
  let best = null;
  for ( const o of foes ) {
    if ( !o.pos ) continue;
    const way = wayTo(run, u, o);
    if ( way <= smell * PATROL.trail + 0.5 && (!best || way < best.way) ) best = { unit: o, way };
  }
  return best ? { kind: "scent", unit: best.unit } : null;
}

/** Is c fighting, as one hears it: in the fight, on its feet (or fallen just now), and in a blow struck this round or last? */
const fighting = (run, c) => c.active && !c.spec.hazard && c.pos && (c.dinRound ?? -9) >= run.round - 1
  && (c.status === STATUS.STANDING || (c.fellRound ?? -9) >= run.round - 1);

/**
 * The din of a fight it can hear and can't see: the easiest one to hear (senses.js hearDC) that it doesn't already stand
 * beside, if a quiet Perception check against it says it hears it (the Statistics Engine's own, as a bystander's notice
 * is: never shown). Null otherwise.
 */
function noiseCue(run, u) {
  let best = null;
  for ( const c of run.units ) {
    if ( c === u || !fighting(run, c) || (edgeDistance(u, c) ?? 0) <= PATROL.fresh ) continue;
    const dc = hearDC(run, u, c);
    if ( dc !== null && (!best || dc < best.dc) ) best = { unit: c, dc };
  }
  if ( !best ) return null;
  const perception = u.spec.perception ?? u.spec.initiative?.mod ?? 0;
  const check = checkRoll(run, u, perception, null, { purpose: "notice", skill: "perception" });
  const roll = rollCheck(run.prep.rules, run.rng, check.mod, best.dc, { advantage: check.advantage, kind: "check", roller: u, quiet: true });
  return roll.degree >= 2 ? { kind: "noise", unit: best.unit, dc: best.dc } : null;
}

/** A foe one of its teammates has in view (the nearest to u): where the fight is, as they'd show it. Null for none. */
function seenCue(run, u, foes) {
  let best = null;
  for ( const a of teammates(run, u) ) {
    for ( const o of foes ) {
      if ( !o.pos || !perceives(run, a, o) ) continue;
      const d = edgeDistance(u, o) ?? Infinity;
      if ( !best || d < best.d ) best = { unit: o, d };
    }
  }
  return best ? { kind: "seen", unit: best.unit } : null;
}

/** A packmate's cue this round, followed (the pack goes where one of it goes): the creature it heads for. */
function packCue(run, u) {
  for ( const a of packOf(run, u) ) {
    const cue = a.patrol?.cueRound === run.round ? run.byId.get(a.patrol.cueId) : null;
    if ( cue && cue !== u && isStanding(cue) ) return { kind: "pack", unit: cue, via: a };
  }
  return null;
}

/**
 * What it has to go on, the strongest first (CUES): {kind, unit, dc?}, or null. Worked out once a turn (the din is a
 * check), kept on u.patrol.
 */
export function cueOf(run, u, mode) {
  const p = patrolState(run, u);
  if ( p.cueTurn === u.turnsTaken ) return p.cue ? { ...p.cue, unit: run.byId.get(p.cue.id) ?? null } : null;
  const foes = foesHere(run, u);
  const cue = scentCue(run, u, foes) ?? noiseCue(run, u) ?? seenCue(run, u, foes) ?? (mode === "roam" ? packCue(run, u) : null);
  p.cueTurn = u.turnsTaken;
  p.cue = cue ? { kind: cue.kind, id: cue.unit.id, dc: cue.dc ?? null } : null;
  if ( cue ) {
    p.cueRound = run.round;
    p.cueId = cue.unit.id;
  }
  return cue;
}

/** Its patrol's memory (u.patrol): where it began, how many turns it has searched, the spots it searched lately. */
export function patrolState(run, u) {
  const p = (u.patrol ??= { origin: u.pos ? { x: u.pos.x, y: u.pos.y } : null, turns: 0, sought: [], cueTurn: null, cue: null });
  return p;
}

/* -------------------------------------------- */
/*  Where to go, with no cue                    */
/* -------------------------------------------- */

/** How far p is from the nearest of `list` (edge to edge, as if u stood at p). */
function nearestAt(u, p, list) {
  let best = Infinity;
  for ( const o of list ) best = Math.min(best, Math.max(5, Math.hypot(p.x - o.pos.x, p.y - o.pos.y) - (((u.spec.position?.size ?? 5) + (o.spec.position?.size ?? 5)) / 2 - 5)));
  return best;
}

/** How new the ground at p is: the feet to the nearest spot it searched lately (to 30). */
function novelty(p, sought) {
  let d = 30;
  for ( const s of sought ) d = Math.min(d, Math.hypot(p.x - s.x, p.y - s.y));
  return d;
}

/** How well p suits its patrol, with no cue: higher, the better (see the header). */
function spotScore(run, u, mode, p, ctx) {
  const p0 = ctx.state;
  let v = 0.05 * novelty(p, p0.sought);
  if ( mode === "near" ) return ctx.mates.length ? -Math.max(0, nearestAt(u, p, ctx.mates) - 10) : v;
  if ( mode === "spread" && ctx.mates.length ) {
    const d = nearestAt(u, p, ctx.mates);
    const [lo, hi] = PATROL.spread;
    v -= 0.2 * (d < lo ? lo - d : d > hi ? d - hi : 0);
  } else if ( p0.origin ) {
    // (Wandering: out to how far it has got, widening each turn.)
    const w = PATROL.wander;
    const r = Math.min(w.most, w.start + w.step * p0.turns);
    v -= 0.05 * Math.abs(Math.hypot(p.x - p0.origin.x, p.y - p0.origin.y) - r);
  }
  // (A pack keeps loosely together.)
  if ( ctx.pack.length ) v -= 0.1 * Math.max(0, nearestAt(u, p, ctx.pack) - PATROL.pack);
  return v;
}

/**
 * Where to walk this move with no cue to follow, for a roamer, a patroller or one keeping near (a spot within a move,
 * none past a wall: prepare.js spotsWithin), less the harm it would risk there (prepare.js walkRisk): {to, feet} or null
 * where nowhere is better by PATROL.least.
 */
export function patrolSpot(run, u, mode, { risk = null } = {}) {
  if ( !u.pos || !wanders(mode) || !canMove(run, u) ) return null;
  const ctx = { state: patrolState(run, u), mates: teammates(run, u), pack: packOf(run, u) };
  // (Keeping near, already near: it stays.)
  if ( mode === "near" && ctx.mates.length && nearestAt(u, u.pos, ctx.mates) <= PATROL.near ) return null;
  const cost = risk ?? walkRisk(run, u);
  const here = spotScore(run, u, mode, u.pos, ctx);
  let best = null;
  // (Ties go either way, by the engine's own die, so a wanderer doesn't always walk the same line.)
  const spots = run.rng.shuffle(spotsWithin(run, u, speedOf(u)));
  for ( const p of spots ) {
    const gain = spotScore(run, u, mode, p, ctx) - here - cost(p);
    if ( gain >= PATROL.least && (!best || gain > best.gain) ) best = { to: p, gain, feet: Math.hypot(p.x - u.pos.x, p.y - u.pos.y) };
  }
  return best;
}

/* -------------------------------------------- */
/*  Seek                                        */
/* -------------------------------------------- */

/** The system's Seek ({cost, area, around, dc}), the core's where it says nothing; null where it has none. */
export function seekOf(rules) {
  if ( rules.seek === false ) return null;
  const own = rules.seek && typeof rules.seek === "object" ? rules.seek : {};
  return { cost: normalizeCost(rules, own.cost ?? rules.basicAction ?? 1), area: own.area ?? SEEK.area, around: own.around ?? SEEK.around, dc: own.dc ?? null };
}

/** The Stealth DC to find t: the system's, else 10 + its Stealth (spec.initiative.stealth) and its bonuses to checks. */
export function stealthDC(run, seeker, t) {
  const own = seekOf(run.prep.rules)?.dc?.(run, seeker, t);
  if ( Number.isFinite(own) ) return own;
  const stealth = Number(t.spec.initiative?.stealth);
  const mod = Number.isFinite(stealth) ? stealth : typical(run.prep.rules, "skill", t.spec.level ?? 0);
  return 10 + mod + (Number(t.mods?.checks) || 0) + (Number(t.mods?.byCheck?.stealth) || 0);
}

/** Has u searched near p this round or last? */
const searched = (run, u, p) => (u.patrol?.sought ?? []).some(s => s.round >= run.round - 1 && Math.hypot(p.x - s.x, p.y - s.y) <= PATROL.fresh);

/** Could u Seek now, somewhere it hasn't searched (a Seek the system has, and the turn pays for)? */
export function canSeek(run, u, turn) {
  const seek = seekOf(run.prep.rules);
  return !!seek && turn.canAfford(seek.cost) && !(u.pos && searched(run, u, u.pos));
}

/** A stand-in for a point it looks toward, for inArea. */
const lookAt = p => ({ id: "look", pos: p, spec: { position: { size: 5 } } });

/**
 * A Seek: paid for, rolled, and what it finds known to it (see the header). `aim`: a creature or a point it looks toward
 * (its cone), else its heading, else round itself. Returns the creatures it found ([]), or null where it couldn't.
 */
export function seek(run, u, turn, { aim = null, say = null } = {}) {
  const rules = run.prep.rules;
  const how = seekOf(rules);
  if ( !how || !turn.canAfford(how.cost) ) return null;
  turn.spend(how.cost);
  const toward = aim?.pos ? aim : aim ? lookAt(aim) : u.patrol?.heading ? lookAt(u.patrol.heading) : null;
  const area = toward && u.pos && (toward.pos.x !== u.pos.x || toward.pos.y !== u.pos.y) ? how.area : how.around;
  const center = area === how.around ? u : toward;
  const there = run.units.filter(o => o !== u && o.status === STATUS.STANDING && !o.spec.hazard && (areEnemies(run, u, o) || seemsFoe(run, u, o))
    && (hiddenFrom(u, o) || !perceives(run, u, o)) && inArea(run, u, center, o, area));
  const dcs = new Map(there.map(o => [o, stealthDC(run, u, o)]));
  const dc = dcs.size ? Math.max(...dcs.values()) : typical(rules, "dc", u.spec.level ?? 0);
  const perception = u.spec.perception ?? u.spec.initiative?.mod ?? 0;
  const check = checkRoll(run, u, perception, null, { purpose: "seek", skill: "perception" });
  // (A live battle's: the system's own roll where it makes checks, PF2e's Seek; else the engine's, shown as a table roll.)
  const rolled = systemRolled(run, u, "check", { dc, purpose: "seek", skill: "perception" });
  const roll = rollCheck(rules, run.rng, check.mod, dc, { advantage: check.advantage, dice: check.dice, kind: "check", roller: u, rolled, what: "seek" });
  rules.afterRoll?.(run, u, roll, { kind: "check", purpose: "seek", faces: roll.faces ?? 20 });
  const found = [];
  for ( const [o, oDc] of dcs ) {
    const degree = oDc === dc ? roll.degree : regrade(rules, roll, oDc, "check");
    if ( degree < 2 ) continue;
    found.push(o);
    (u.seenFoes ??= new Set()).add(o.id);
    // (Seen now, unless nothing will let it be: invisible, it's only found where it is.)
    if ( hiddenFrom(u, o) && !(Number(o.conds?.invisible) > 0) ) (o.foundBy ??= new Set()).add(u.id);
  }
  const p = patrolState(run, u);
  if ( u.pos ) p.sought = [...p.sought.filter(s => s.round >= run.round - 1), { x: u.pos.x, y: u.pos.y, round: run.round }];
  say?.(u, {
    type: "seek", natural: roll.natural, mod: check.mod, total: roll.total, dc, degree: roll.degree, rolled: !!rolled,
    found: found.map(o => o.spec.name), foundIds: found.map(o => o.id), shape: area.shape ?? null, feet: Number(area.feet) || null,
    toward: aim?.spec?.name ?? null, towardId: aim?.spec ? aim.id ?? null : null
  });
  return found;
}

/* -------------------------------------------- */
/*  A patrol's turn                             */
/* -------------------------------------------- */

/**
 * The rest of u's turn spent patrolling (mayPatrol said it may): what its mode and its cues say, a step at a time, until
 * it finds a foe, the turn runs out, or nothing more is worth doing. `kit`, the simulator's own: say (the log), toward(t)
 * (a move toward a creature, its door worked if one's in the way: false if it couldn't move), walk(spot) (a move to a
 * spot), hide() (its Hide, where it has one it can use now, and isn't hidden: true if it did). True if it found a foe.
 */
export function patrolTurn(run, u, turn, kit) {
  const mode = patrolMode(run, u);
  const p = patrolState(run, u);
  p.turns += 1;
  p.round = run.round;
  p.moved = false;
  const mates = teammates(run, u);
  // (Keeping near: it goes where its teammates go, not on its own; alone, it goes as a watcher would.)
  const cue = roams(mode) && (mode !== "near" || !mates.length) ? cueOf(run, u, mode) : null;
  const how = mode === "hide" ? "hide" : cue ? cue.kind : { roam: "wander", spread: mates.length ? "spread" : "wander", near: mates.length ? "near" : "watch", watch: "watch", hold: "hold" }[mode];
  kit.say?.(u, { type: "patrol", how, mode, toward: cue?.unit.spec.name ?? null, towardId: cue?.unit.id ?? null });
  p.how = how;
  if ( mode === "hide" ) {
    if ( kit.hide?.() ) return knowsAFoe(run, u);
    if ( Number(u.conds?.hidden) > 0 ) return false; // (kept hidden: a search would give it away)
  }
  const heading = before => {
    if ( u.pos && before && (u.pos.x !== before.x || u.pos.y !== before.y) ) p.heading = { x: 2 * u.pos.x - before.x, y: 2 * u.pos.y - before.y };
  };
  for ( let step = 0; step < 6 && turn.any && isStanding(u); step++ ) {
    if ( knowsAFoe(run, u) ) return true;
    // (Its last action: on PF2e's three, the third; with movement of its own, once that's gone.)
    const last = turn.feetMovement ? !((turn.pools.move ?? 0) >= 5) : turn.left <= 1;
    const before = u.pos ? { x: u.pos.x, y: u.pos.y } : null;
    // Toward the cue: moving, and a Seek with its last action, where it hasn't searched; with nothing to follow, a Seek
    // from a spot not searched yet, else on to the next spot.
    if ( cue && !(last && canSeek(run, u, turn)) && canMove(run, u) && kit.toward(cue.unit) ) {
      p.moved = true;
      heading(before);
      continue;
    }
    if ( canSeek(run, u, turn) ) {
      if ( seek(run, u, turn, { aim: cue?.unit ?? null, say: kit.say })?.length ) return knowsAFoe(run, u);
      continue;
    }
    if ( cue || !wanders(mode) ) break;
    const spot = patrolSpot(run, u, mode);
    if ( !spot || !kit.walk(spot, "patrol") ) break;
    p.moved = true;
    heading(before);
  }
  return isStanding(u) && knowsAFoe(run, u);
}

/* -------------------------------------------- */
/*  Fidgeting                                   */
/* -------------------------------------------- */

/** How likely an otherwise idle creature fidgets this turn: the world's ADHD share times (FIDGET.base + its own). */
export function fidgetChance(run, u) {
  const world = clamp(Number(run.prep.options?.adhd ?? ADHD), 0, 100) / 100;
  const own = clamp(Number(u.spec.adhd) || 0, 0, 100) / 100;
  return clamp(world * (FIDGET.base + own), 0, 1);
}

/**
 * A turn it did nothing at all with: now and then (fidgetChance) it fidgets, a step aside where it can take one in
 * safety (a free spot beside it, no foe it knows of near, the move paid for as any), else a look elsewhere (where its
 * next Seek looks). `kit.walk(spot)`, `kit.say`. True if it did.
 */
export function fidget(run, u, turn, kit) {
  if ( !isStanding(u) || !u.active || u.spec.hazard || u.summoner || !run.rng.chance(fidgetChance(run, u)) ) return false;
  const spots = u.pos && canMove(run, u) && turn.any && !knowsAFoe(run, u) ? spotsWithin(run, u, 5) : [];
  const spot = spots.length && run.rng.chance(0.5) ? run.rng.pick(spots) : null;
  if ( spot && kit.walk({ to: spot, feet: Math.hypot(spot.x - u.pos.x, spot.y - u.pos.y) }, "fidget") ) {
    kit.say?.(u, { type: "fidget", how: "step" });
    return true;
  }
  if ( u.pos ) {
    const angle = run.rng.next() * 2 * Math.PI;
    patrolState(run, u).heading = { x: u.pos.x + 30 * Math.cos(angle), y: u.pos.y + 30 * Math.sin(angle) };
  }
  kit.say?.(u, { type: "fidget", how: "look" });
  return true;
}

/** What it's at, for the GM (the Battle Vantage): "patrolling" (it walked), "searching" (it stood and looked), or null. */
export function patrolNow(run, u) {
  const p = u.patrol;
  if ( !p || !(p.round >= run.round - 1) || !u.active || !isStanding(u) ) return null;
  return p.moved ? "patrolling" : "searching";
}
