/** Bounded GPU workspace reuse: alternating main/mirror sizes must not allocate every frame. */
export function createSizeCache<T>(capacity: number, create: (width: number, height: number) => T, dispose: (value: T) => void) {
  const entries = new Map<string, T>();
  return (width: number, height: number): T => {
    const key = `${width}x${height}`;
    let value = entries.get(key);
    if (value !== undefined) entries.delete(key);
    else {
      value = create(width, height);
      if (entries.size >= capacity) {
        const oldest = entries.keys().next().value!;
        dispose(entries.get(oldest)!); entries.delete(oldest);
      }
    }
    entries.set(key, value);
    return value;
  };
}
