// Seeded random number generator (Mulberry32 variant)
function seededRandom(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return function() {
    let t = h += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seeded array shuffling helper
export function shuffleArray<T>(array: T[], seed: string): T[] {
  const rand = seededRandom(seed);
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Attempt IDs are immutable persisted identities. Recomputing on the server avoids
// competing initialization writes and preserves the existing monitored shuffle.
// Quiz question content is locked once attempts exist; canonical IDs fix the input order.
export function getAttemptQuestionOrder<T extends { id: number }>(questions: readonly T[], attemptId: string): T[] {
  return shuffleArray([...questions].sort((a, b) => a.id - b.id), attemptId);
}
