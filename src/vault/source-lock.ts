/** Serialize each source's encrypted record updates across extension contexts. */
export async function withSourceDataLock<T>(
  source: 'obsidian' | 'notion',
  work: () => Promise<T>,
): Promise<T> {
  if (!globalThis.navigator?.locks)
    throw new Error('Attention source data coordination unavailable.');
  // Callers may already own attention-personal-data; this must be a different
  // lock, and work inside it must never acquire the personal-data lock.
  return navigator.locks.request(`attention-${source}-data`, work);
}
