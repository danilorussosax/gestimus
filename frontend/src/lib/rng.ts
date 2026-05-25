// Seedable PRNG (mulberry32). Port of js/rng.js — identical math.
// Used for reproducible sorteggi (same seed → same shuffle).

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher–Yates shuffle, seeded. Returns a shuffled copy of `arr`.
 * Same seed always produces the same permutation (reproducible draw order).
 */
export function shuffleSeeded<T>(arr: T[], seed: number): T[] {
  const rand = mulberry32(seed >>> 0);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
