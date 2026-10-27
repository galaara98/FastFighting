/**
 * How a live battle is kept on its transcript, a journal of its own (live-battle.js keep), so each turn writes what it
 * changed and not the whole fight again. Under the journal's flags (`root`), by the battle's combat's id:
 *   battles.<id>    the battle as it stands, without its turns: the run as it is now (without its log), whose turn,
 *                   what's been told (`layout`: KEPT_LAYOUT)
 *   specs.<id>      its spec (packed), when it's changed
 *   turns.<id>.<n>  each turn kept, in order (what it wrote, told, moved), without the run as it was before it ...
 *   snaps.<id>.<n>  ... which is kept apart, for the turns that still have it (Rewind Turn's)
 *   logs.<id>.<n>   the log, a piece at a time: each keep adds what's new since the one before (a rewind cuts it back)
 *   pcs.<id>        a player's turn under way: the run as it was before it and every sheet as it began (its big
 *                   parts, written once a turn; the rest of it is in battles.<id>.pc)
 *   keptAt          when it was last kept (ms), for how long it's kept (live-store.js)
 * A battle kept before this had its turns and its log in battles.<id>: read as it was kept, and kept this way from its
 * next keep on. Pure: no Foundry globals (the update is Foundry's document update, `==` and `-=` keys and all).
 */

export const KEPT_LAYOUT = 2;

/** A turn as it's kept (turns.<id>.<n>): all of it but the run as it was before it (snaps.<id>.<n>). */
const turnKept = ({ snapshot: _s, ...turn }) => turn;

/**
 * Each turn's JSON as last worked out, and what the turn's own fields were then. A kept turn changes only at its top
 * (a list added to, a field set, its snapshot dropped: live-battle.js), so the same fields, each list as long, is the
 * same turn, and its JSON isn't worked out again.
 */
const turnJson = new WeakMap();
function jsonOf(turn) {
  const fields = Object.entries(turn).filter(([k]) => k !== "snapshot").map(([k, v]) => [k, v, Array.isArray(v) ? v.length : -1]);
  const was = turnJson.get(turn);
  const same = was && was.fields.length === fields.length && was.fields.every(([k, v, n], i) => fields[i][0] === k && fields[i][1] === v && fields[i][2] === n);
  if ( same ) return was.json;
  const json = JSON.stringify(turnKept(turn));
  turnJson.set(turn, { fields, json });
  return json;
}

/**
 * The update that keeps a battle, and what's kept once it's written (the next keep's `was`).
 * @param {{turns, log, pcTurn}|null} was  What the last keep of this battle in this browser wrote (none: write it all,
 *                                    in place of whatever the journal had for this combat)
 * @param {string} id                The battle's combat's id
 * @param {object} data              The battle's data (live-battle.js battle.data): its spec, its turns, and the rest
 * @param {object} options
 * @param {object[]} options.log     The run's log as it is now
 * @param {(from: number, to: number) => object[]} options.pack   Log entries from..to, as plain data (live.js packLog)
 * @param {string} options.root      Where the journal's flags are ("flags.<module id>")
 * @param {string|null} [options.keptSpec]  The spec as it was last written (unchanged: not written again)
 * @param {number|null} [options.keptAt]    When it's kept (ms), written beside it
 * @param {{snapshot, sheets}|null} [options.pcTurn]  A player's turn's big parts (pcs.<id>): written when it's another
 *                                    object than the last keep's, gone when there's none
 * @returns {{update: object, kept: {turns, log, pcTurn}}}
 */
export function keepUpdate(was, id, data, { log = [], pack, root, keptSpec = null, keptAt = null, pcTurn = null }) {
  const { spec, turns = [], log: _log, ...rest } = data;
  const update = { [`${root}.battles.==${id}`]: { ...rest, layout: KEPT_LAYOUT } };
  if ( keptAt !== null ) update[`${root}.keptAt`] = keptAt;
  if ( spec !== keptSpec ) update[`${root}.specs.==${id}`] = spec;
  const keptTurns = turnsToKeep(was?.turns ?? null, id, turns, update, root);
  const keptLog = logToKeep(was?.log ?? null, id, log, pack, update, root);
  if ( pcTurn && (!was || was.pcTurn !== pcTurn) ) update[`${root}.pcs.==${id}`] = pcTurn;
  else if ( !pcTurn && (!was || was.pcTurn) ) update[`${root}.pcs.-=${id}`] = null;
  return { update, kept: { turns: keptTurns, log: keptLog, pcTurn } };
}

/**
 * The turns, into the update: each new or changed since the last keep (`was`: each turn kept then, as written), its
 * run as it was once (until the turn no longer has it: then gone); those taken back since, gone too.
 */
function turnsToKeep(was, id, turns, update, root) {
  const marks = turns.map(turn => ({ turn, json: jsonOf(turn), snap: !!turn.snapshot }));
  if ( !was ) {
    update[`${root}.turns.==${id}`] = Object.fromEntries(turns.map((t, i) => [i, turnKept(t)]));
    update[`${root}.snaps.==${id}`] = Object.fromEntries(turns.flatMap((t, i) => (t.snapshot ? [[i, t.snapshot]] : [])));
    return marks;
  }
  marks.forEach((m, i) => {
    const old = was[i];
    const same = old?.turn === m.turn;
    if ( !same || old.json !== m.json ) update[`${root}.turns.${id}.==${i}`] = turnKept(m.turn);
    if ( m.snap && !(same && old.snap) ) update[`${root}.snaps.${id}.==${i}`] = m.turn.snapshot;
    else if ( !m.snap && old?.snap ) update[`${root}.snaps.${id}.-=${i}`] = null;
  });
  for ( let i = marks.length; i < was.length; i++ ) {
    update[`${root}.turns.${id}.-=${i}`] = null;
    if ( was[i].snap ) update[`${root}.snaps.${id}.-=${i}`] = null;
  }
  return marks;
}

/**
 * The log, into the update: what's new since the last keep (`was`: the entries kept, and where each piece of them
 * starts) as one piece more; where a rewind cut it back, the pieces past the cut cut back too.
 */
function logToKeep(was, id, log, pack, update, root) {
  const at = `${root}.logs`;
  if ( !was ) {
    update[`${at}.==${id}`] = log.length ? { 0: { from: 0, entries: pack(0, log.length) } } : {};
    return { entries: log.slice(), starts: log.length ? [0] : [] };
  }
  // (Where what's kept and the log as it is part: at its end, unless a rewind cut it back.)
  let same = 0;
  const most = Math.min(was.entries.length, log.length);
  while ( same < most && was.entries[same] === log[same] ) same++;
  const starts = [...was.starts];
  const write = new Map();
  if ( same < was.entries.length ) {
    while ( starts.length && starts.at(-1) >= same ) starts.pop();
    if ( starts.length ) write.set(starts.length - 1, { from: starts.at(-1), entries: pack(starts.at(-1), same) });
  }
  if ( log.length > same ) {
    starts.push(same);
    write.set(starts.length - 1, { from: same, entries: pack(same, log.length) });
  }
  for ( let j = starts.length; j < was.starts.length; j++ ) update[`${at}.${id}.-=${j}`] = null;
  for ( const [j, piece] of write ) update[`${at}.${id}.==${j}`] = piece;
  return { entries: log.slice(), starts };
}

/** The keys of a kept set of slots ({0: ..., 1: ...}), in order. */
const slotsOf = o => Object.entries(o ?? {}).filter(([k]) => /^\d+$/.test(k)).sort(([a], [b]) => Number(a) - Number(b));

/**
 * A battle as it was kept: its data, with its spec, its turns (each with its run as it was, where that's kept) and,
 * kept as KEPT_LAYOUT has it, its log (`log`: the packed entries, for its snapshot); null if none is kept.
 * @param {(path: string) => any} get   The journal's flag at a path ("battles.<id>")
 */
export function keptBattle(get, id) {
  const data = get(`battles.${id}`);
  if ( !data ) return null;
  const spec = get(`specs.${id}`);
  if ( data.layout !== KEPT_LAYOUT ) return { ...data, spec };
  const snaps = get(`snaps.${id}`) ?? {};
  const turns = slotsOf(get(`turns.${id}`)).map(([i, t]) => (snaps[i] ? { ...t, snapshot: snaps[i] } : { ...t }));
  const log = slotsOf(get(`logs.${id}`)).flatMap(([, piece]) => piece?.entries ?? []);
  // (A player's turn under way: its big parts given back. One kept before they were apart has its snapshot in it.)
  const pcTurn = data.pc ? get(`pcs.${id}`) : null;
  const pc = data.pc && pcTurn ? { ...data.pc, snapshot: pcTurn.snapshot ?? data.pc.snapshot, sheets: pcTurn.sheets ?? null } : data.pc;
  return { ...data, spec, turns, log, ...(data.pc !== undefined ? { pc } : {}) };
}
