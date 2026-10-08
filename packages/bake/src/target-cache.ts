interface Target<T> { readonly width: number; readonly height: number; readonly value: T }

/** One current canvas workspace, plus bounded offscreen workspaces for mirrors, bakes and exports.
 * A toolbar or orientation resize replaces the canvas workspace instead of keeping old full-size pictures. */
export function createTargetCache<T>(auxiliaryCapacity: number, create: (width: number, height: number) => T, dispose: (value: T) => void) {
  if (!Number.isInteger(auxiliaryCapacity) || auxiliaryCapacity < 1) throw new RangeError("At least one auxiliary workspace is required");
  let primaryKey = "", primary: Target<T> | null = null;
  const auxiliary = new Map<string, Target<T>>();
  return {
    get(width: number, height: number, primaryWidth: number, primaryHeight: number): T {
      const nextPrimary = `${primaryWidth}x${primaryHeight}`, key = `${width}x${height}`;
      if (nextPrimary !== primaryKey) {
        if (primary) dispose(primary.value);
        primary = null;
        primaryKey = nextPrimary;
      }
      if (key === primaryKey) {
        if (!primary) {
          // An export/mirror may already be the new canvas size. Promote it without allocating another copy.
          primary = auxiliary.get(key) ?? { width, height, value: create(width, height) };
          auxiliary.delete(key);
        }
        return primary.value;
      }
      let target = auxiliary.get(key);
      if (target) auxiliary.delete(key);
      else {
        // Release before allocating: even transient residency must respect the limit.
        if (auxiliary.size >= auxiliaryCapacity) {
          const oldest = auxiliary.keys().next().value!;
          dispose(auxiliary.get(oldest)!.value);
          auxiliary.delete(oldest);
        }
        target = { width, height, value: create(width, height) };
      }
      auxiliary.set(key, target);
      return target.value;
    },
    stats(): { workspaces: number; pixels: number } {
      let pixels = primary ? primary.width * primary.height : 0;
      for (const target of auxiliary.values()) pixels += target.width * target.height;
      return { workspaces: auxiliary.size + (primary ? 1 : 0), pixels };
    },
  };
}
