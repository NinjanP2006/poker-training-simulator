// Deterministic randomness for bots: the same hand seed and the same point in
// the hand always give the same number, so replaying a hand replays the bots'
// decisions exactly.

/** FNV-1a: a small, stable string hash. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One step of mulberry32, a fast, well-distributed 32-bit generator. */
function mulberry32(state: number): number {
  let t = (state + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A number in [0, 1) fixed by the hand seed, how far the hand has got, and the seat. */
export function seededRandom(seed: string, eventCount: number, seat: number): number {
  return mulberry32(hash32(`${seed}:${eventCount}:${seat}`));
}
