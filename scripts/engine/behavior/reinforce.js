/**
 * Reinforcements: each team's own, the planner's (one creature, and how many of it can come: prep.reinforcements),
 * called by the team's head when the fight turns against it, or by the GM (engine/live.js, the Battle Vantage). They
 * come the next round, at the map's edge farthest from the team's foes (or anywhere, with no map), and join the team:
 * its side, its friend group, under its head. The party's only when FastFighting plays all of it (stance.js free).
 *   - A competent head or better calls when its odds fall under the mark at which it would leave, and a little more
 *     (MARGIN): help on its way, it holds on. As many as would even the hit points, at least one.
 *   - An instinctive head (a pack's howl) calls when outnumbered or one of its own is down: as many as would even the
 *     numbers.
 *   - A feral one never calls.
 * Pure: no Foundry globals.
 */
import { TACTICAL, STATUS, clamp } from "../../constants.js";
import { createUnit, groupKeyOf, liveTier, isStanding } from "../battle-state.js";
import { headOf, free, dangerTo, leaveNeed, teamOdds } from "./stance.js";
import { isLeaving } from "./leaving.js";
import { initDesires } from "./desire.js";
import { sampleRunTactics } from "../playstyles.js";
import { isAnimalistic, animalTactics } from "./animal.js";

/** How far above its leaving mark a head's odds may be when it calls (help on its way, it holds on). */
export const MARGIN = 0.15;

/** Each team's reinforcements for this fight: how many are left, and those on their way. */
export function initReinforcements(run) {
  run.reinforce = {};
  for ( const [key, r] of run.prep.reinforcements ?? [] ) run.reinforce[key] = { left: r.count, coming: [] };
}

/** A team's name, as its side's label has it (a friend group: its own name, with its number). */
const teamName = (run, key) => run.prep.sides[key]?.label ?? (key.includes("#") ? `${run.prep.spec?.neutralLabel ?? ""} ${key.split("#")[1]}`.trim() : key);

/** A team's members still in it. */
const membersOf = (run, key) => run.units.filter(o => groupKeyOf(o) === key && isStanding(o) && !isLeaving(o));

/** How many u, its team's head, calls for now (0: none). */
export function reinforcementsWanted(run, u) {
  const key = groupKeyOf(u);
  const r = key ? run.reinforce?.[key] : null;
  if ( !r?.left || r.coming.length || headOf(run, key) !== u || !free(run, key, u) ) return 0;
  const tier = liveTier(run, u);
  if ( tier < TACTICAL.INSTINCTIVE ) return 0;
  const team = membersOf(run, key);
  const { foes } = dangerTo(run, team, new Set());
  if ( !foes.length ) return 0;
  if ( tier === TACTICAL.INSTINCTIVE ) {
    const fallen = run.units.some(o => groupKeyOf(o) === key && (o.status === STATUS.DOWN || o.status === STATUS.DEAD));
    if ( foes.length <= team.length && !fallen ) return 0;
    return clamp(foes.length - team.length + 1, 1, r.left);
  }
  if ( teamOdds(run, team, foes, tier) >= leaveNeed(run, u) + MARGIN ) return 0;
  const hp = list => list.reduce((s, o) => s + Math.max(0, o.hp) + (o.temp ?? 0), 0);
  const each = Math.max(1, Number(run.prep.reinforcements.get(key)?.p.spec.hp?.max) || 1);
  return clamp(Math.ceil((hp(foes) - hp(team)) / each), 1, r.left);
}

/** `n` of a team's reinforcements are on their way (its head's call, or the GM's): they come next round. */
export function callReinforcements(run, key, n, { by = null, say = () => {} } = {}) {
  const r = run.reinforce?.[key];
  const count = Math.min(Math.max(0, Math.round(Number(n) || 0)), r?.left ?? 0);
  if ( !count ) return 0;
  r.left -= count;
  r.coming.push({ n: count, round: run.round + 1 });
  say(by, { type: "reinforce", team: key, teamName: teamName(run, key), count, left: r.left });
  return count;
}

/** Where the n-th of them comes in: the map's edge farthest from the team's foes, a few feet apart; null with no map. */
function arrivalAt(run, key, i) {
  const b = run.prep.spec?.bounds;
  if ( !b ) return null;
  const foes = run.units.filter(o => o.pos && isStanding(o) && groupKeyOf(o) !== key);
  const cx = foes.length ? foes.reduce((s, o) => s + o.pos.x, 0) / foes.length : (b.x0 + b.x1) / 2;
  const cy = foes.length ? foes.reduce((s, o) => s + o.pos.y, 0) / foes.length : (b.y0 + b.y1) / 2;
  const mx = (b.x0 + b.x1) / 2;
  const my = (b.y0 + b.y1) / 2;
  const edges = [{ x: b.x0 + 5, y: my }, { x: b.x1 - 5, y: my }, { x: mx, y: b.y0 + 5 }, { x: mx, y: b.y1 - 5 }];
  const at = edges.reduce((best, e) => (Math.hypot(e.x - cx, e.y - cy) > Math.hypot(best.x - cx, best.y - cy) ? e : best));
  const along = at.x === b.x0 + 5 || at.x === b.x1 - 5;
  const step = 5 * (i % 2 ? (i + 1) / 2 : -i / 2);
  return along ? { x: at.x, y: clamp(at.y + step, b.y0 + 5, b.y1 - 5) } : { x: clamp(at.x + step, b.x0 + 5, b.x1 - 5), y: at.y };
}

/** Those due this round come in (simulator.js beginRound): new creatures of the team, in the fight from now. */
export function arriveReinforcements(run, say = () => {}) {
  for ( const [key, r] of Object.entries(run.reinforce ?? {}) ) {
    const due = r.coming.filter(c => c.round <= run.round);
    if ( !due.length ) continue;
    r.coming = r.coming.filter(c => c.round > run.round);
    const t = run.prep.reinforcements.get(key);
    if ( !t ) continue;
    const came = [];
    for ( let i = 0; i < due.reduce((s, c) => s + c.n, 0); i++ ) {
      const s = createUnit(run.prep, t.p);
      run.reinforced = (run.reinforced ?? 0) + 1;
      s.id = `${t.p.spec.id}#${run.reinforced}`;
      s.reinforcementOf = key;
      s.joinedRound = run.round;
      s.pos = arrivalAt(run, key, i);
      initDesires(s);
      s.tac = sampleRunTactics(s.spec, run.rng);
      if ( isAnimalistic(s) ) s.tac = { ...animalTactics(s.spec), ...(s.tac ?? {}) };
      run.units.push(s);
      run.byId.set(s.id, s);
      run.order?.push(s);
      came.push(s);
    }
    if ( came.some(s => s.pos) ) run.geo = (run.geo ?? 0) + 1;
    if ( came.length ) say(came[0], { type: "arrive", team: key, teamName: teamName(run, key), count: came.length, names: came.map(s => s.spec.name), ids: came.map(s => s.id) });
  }
}

/** The template a team's reinforcements are made from (live.js restoreRun, a live battle kept and taken up again). */
export const reinforcementOf = (run, key) => run.prep.reinforcements?.get(key)?.p ?? null;
