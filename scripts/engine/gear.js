/**
 * What a creature's weapons and things need before it can use them: in hand, and loaded (API 20). Any system says it
 * on its actions; the engine keeps track as the fight goes. Pure and import-free: turn.js costs with it.
 *
 *   action.gear       what it uses, as a key: actions with the same one share whether it's in hand and loaded (two
 *                     Strikes with one crossbow). Default: the action's own id.
 *   action.drawCost   main-pool units it takes to get it in hand (PF2e's Interact to draw a weapon or retrieve a
 *                     potion). With it, it starts out of hand; without, it's in hand or needs no hand.
 *   action.reload     main-pool units one Reload of it takes (PF2e's reload 1, 2), apart from its own cost. None or 0:
 *                     it's never loaded (a sword) or always ready while it has ammunition (a bow). Infinity: no Reload
 *                     fits in a fight (a minute's); one that takes more than a whole turn can't be reloaded either.
 *   action.loaded     whether it starts loaded (left out: loaded, as most tables assume), or the rounds loaded in it
 *   action.capacity   the rounds it holds loaded (1 if not said); each Reload loads one, each use fires one
 *   action.drawEach   each use leaves the hand empty (a potion drunk, a bomb or a dagger thrown): drawn again for the next
 *
 * The creature's own: u.drawn (the gear keys in hand), u.loaded (gear key -> rounds loaded, for gear that reloads).
 */

/** The key an action's gear goes by. */
export const gearOf = action => action?.gear ?? action?.id;

/** Does this action need its gear drawn first (it has a cost to draw, and it isn't in hand)? */
export const needsDraw = (u, action) => (Number(action?.drawCost) || 0) > 0 && !u?.drawn?.has(gearOf(action));

/** Is it gear that's loaded and reloaded? */
export const reloads = action => (Number(action?.reload) || 0) > 0;

/** The rounds it holds loaded. */
export const capacityOf = action => Math.max(1, Math.floor(Number(action?.capacity) || 1));

/** The rounds it starts with loaded: all of them unless it says otherwise. */
export function startLoaded(action) {
  const said = action?.loaded;
  if ( said === undefined || said === null || said === true ) return capacityOf(action);
  if ( said === false ) return 0;
  return Math.max(0, Math.min(capacityOf(action), Math.floor(Number(said) || 0)));
}

/** The rounds loaded in it now (Infinity for gear that isn't loaded at all). */
export function roundsLoaded(u, action) {
  if ( !reloads(action) ) return Infinity;
  return u?.loaded?.get(gearOf(action)) ?? startLoaded(action);
}

/** Is it loaded (or gear that needs no loading)? */
export const isLoaded = (u, action) => roundsLoaded(u, action) > 0;

/** Can it be reloaded in a turn of `perTurn` main-pool units (a finite Reload no longer than a whole turn)? */
export const canReload = (action, perTurn = Infinity) => reloads(action) && Number.isFinite(Number(action.reload)) && Number(action.reload) <= perTurn;

/**
 * Could it ever be used again this fight: loaded, or a Reload a turn can hold. (An empty crossbow that takes a minute to
 * load can't.)
 */
export const usable = (u, action, perTurn = Infinity) => isLoaded(u, action) || canReload(action, perTurn);

/** Main-pool units this use takes before the action itself: its draw, and a Reload where it's empty. */
export function readyUnits(u, action) {
  let n = needsDraw(u, action) ? Number(action.drawCost) : 0;
  if ( !isLoaded(u, action) && canReload(action) ) n += Number(action.reload);
  return n;
}

/**
 * Main-pool units a use takes beside its cost, over the fight (for what it's worth per action): every shot needs its
 * Reload (none for one that can't be reloaded: it has the one shot).
 */
export const reloadPerUse = action => (canReload(action) ? Number(action.reload) : 0);

/** A creature's gear as a fight begins: nothing drawn (what's in hand needs no draw), each reloading thing as it starts. */
export function initGear(u, actions = []) {
  u.drawn = new Set();
  u.loaded = new Map();
  for ( const a of actions ) {
    if ( reloads(a) && !u.loaded.has(gearOf(a)) ) u.loaded.set(gearOf(a), startLoaded(a));
  }
}

/** Its gear in hand. */
export function draw(u, action) {
  (u.drawn ??= new Set()).add(gearOf(action));
}

/** One Reload: a round more loaded, up to what it holds. */
export function load(u, action) {
  if ( !reloads(action) ) return;
  (u.loaded ??= new Map()).set(gearOf(action), Math.min(capacityOf(action), Math.max(0, roundsLoaded(u, action)) + 1));
}

/** A use fired: a round fewer loaded. */
export function fire(u, action) {
  if ( !reloads(action) ) return;
  (u.loaded ??= new Map()).set(gearOf(action), Math.max(0, roundsLoaded(u, action) - 1));
}

/** A use made: a round fewer loaded, and what's used up (drawEach) gone from the hand. */
export function used(u, action) {
  fire(u, action);
  if ( action?.drawEach ) u?.drawn?.delete(gearOf(action));
}

/**
 * The sheet's word on its gear (a live battle's readLiveState: `gear`), over what the engine had: {inHand: [keys],
 * out: [keys], loaded: {key: rounds}}. Keys it doesn't name stay as they were.
 */
export function syncGear(u, gear) {
  if ( !gear || typeof gear !== "object" ) return;
  for ( const k of gear.inHand ?? [] ) (u.drawn ??= new Set()).add(k);
  for ( const k of gear.out ?? [] ) u.drawn?.delete(k);
  for ( const [k, n] of Object.entries(gear.loaded ?? {}) ) if ( Number.isFinite(Number(n)) ) (u.loaded ??= new Map()).set(k, Math.max(0, Number(n)));
}
