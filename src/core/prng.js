/**
 * Deterministic pseudo-random number generators and string hashing.
 * 100% pure JS with seeded PRNG.
 */

/**
 * xmur3 hash function. Takes a seed string and yields a 32-bit stateful hash generator.
 * @param {string} str
 * @returns {() => number} Returns an unsigned 32-bit integer generator.
 */
export function xmur3(str) {
  const s = String(str);
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/**
 * Mulberry32 32-bit PRNG generator.
 * @param {number} a Seed number (uint32).
 * @returns {() => number} Generator returning float in [0, 1).
 */
export function mulberry32(a) {
  return function() {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Creates a seeded PRNG suite.
 * @param {string|number} seedString
 * @returns {{
 *   next: () => number,
 *   int: (min: number, maxInclusive: number) => number,
 *   chance: (p: number) => boolean,
 *   pick: <T>(array: T[]) => T | undefined,
 *   shuffle: <T>(array: T[]) => T[]
 * }}
 */
export function createRng(seedString) {
  const seedGen = xmur3(String(seedString));
  const rand = mulberry32(seedGen());

  function next() {
    return rand();
  }

  function int(min, maxInclusive) {
    return Math.floor(rand() * (maxInclusive - min + 1)) + min;
  }

  function chance(p) {
    return rand() < p;
  }

  function pick(array) {
    if (!array || array.length === 0) return undefined;
    return array[Math.floor(rand() * array.length)];
  }

  function shuffle(array) {
    if (!array) return [];
    const copy = array.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  return { next, int, chance, pick, shuffle };
}

/**
 * Produces an 8-hex-character hash from a string.
 * Used for map.hash, stateHash and determinism checks.
 * @param {string} str
 * @returns {string} 8 hex characters
 */
export function hashString(str) {
  const seedGen = xmur3(String(str));
  const h = seedGen();
  return h.toString(16).padStart(8, '0');
}
