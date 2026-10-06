export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** Read access without a write probe; reads remain usable when storage is read-only. */
export function availableStorage(): StorageLike | null {
  try { return (globalThis as { localStorage?: StorageLike }).localStorage ?? null; } catch { return null; }
}

