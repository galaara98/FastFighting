/**
 * Seeded pseudo-random number generation so any run can be replayed exactly.
 */

/** mulberry32: small, fast, good enough statistical quality for dice. */
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** Integer in [1, faces]. */
    die: faces => Math.floor(next() * faces) + 1,
    d20: () => Math.floor(next() * 20) + 1,
    /** True with probability p. */
    chance: p => next() < p,
    pick: list => list[Math.floor(next() * list.length)],
    shuffle(list) {
      for ( let i = list.length - 1; i > 0; i-- ) {
        const j = Math.floor(next() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      return list;
    }
  };
}

/** Derive an independent seed for run `index` of a batch. */
export function deriveSeed(baseSeed, index) {
  let h = (baseSeed ^ 0x9E3779B9) >>> 0;
  h = Math.imul(h ^ (index + 0x85EBCA6B), 0xC2B2AE35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function randomSeed() {
  return Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;
}
