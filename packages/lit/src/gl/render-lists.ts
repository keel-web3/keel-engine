// Ported from Three.js r180's renderers/webgl/WebGLRenderLists.js (MIT, see
// packages/lit/NOTICE). What a frame draws, in r180's order: opaque front to
// back (by group order, render order, material id, depth, then object id),
// transparent back to front (the same keys, depth reversed, no material).

/** What a render item needs of the drawn object. */
export interface RenderListObject {
  readonly id: number;
  readonly renderOrder: number;
}

/** What a render item needs of the material. */
export interface RenderListMaterial {
  readonly id: number;
  readonly transparent: boolean;
  readonly transmission?: number;
}

export interface RenderItem<O extends RenderListObject = RenderListObject, G = unknown, M extends RenderListMaterial = RenderListMaterial, Gr = unknown> {
  id: number | null;
  object: O | null;
  geometry: G | null;
  material: M | null;
  groupOrder: number;
  renderOrder: number;
  z: number;
  group: Gr | null;
}

/** A sorted item: its references are set (finish() clears only the unused ones). */
export interface SortItem {
  readonly id: number | null;
  readonly material: { readonly id: number } | null;
  readonly groupOrder: number;
  readonly renderOrder: number;
  readonly z: number;
}

export type SortFunction = (a: SortItem, b: SortItem) => number;

/** r180's painterSortStable (opaque). */
export function painterSortStable(a: SortItem, b: SortItem): number {
  if (a.groupOrder !== b.groupOrder) {
    return a.groupOrder - b.groupOrder;
  } else if (a.renderOrder !== b.renderOrder) {
    return a.renderOrder - b.renderOrder;
  } else if (a.material!.id !== b.material!.id) {
    return a.material!.id - b.material!.id;
  } else if (a.z !== b.z) {
    return a.z - b.z;
  } else {
    return a.id! - b.id!;
  }
}

/** r180's reversePainterSortStable (transmissive and transparent). */
export function reversePainterSortStable(a: SortItem, b: SortItem): number {
  if (a.groupOrder !== b.groupOrder) {
    return a.groupOrder - b.groupOrder;
  } else if (a.renderOrder !== b.renderOrder) {
    return a.renderOrder - b.renderOrder;
  } else if (a.z !== b.z) {
    return b.z - a.z;
  } else {
    return a.id! - b.id!;
  }
}

export interface RenderList<O extends RenderListObject = RenderListObject, G = unknown, M extends RenderListMaterial = RenderListMaterial, Gr = unknown> {
  opaque: RenderItem<O, G, M, Gr>[];
  transmissive: RenderItem<O, G, M, Gr>[];
  transparent: RenderItem<O, G, M, Gr>[];

  init(): void;
  push(object: O, geometry: G, material: M, groupOrder: number, z: number, group: Gr | null): void;
  unshift(object: O, geometry: G, material: M, groupOrder: number, z: number, group: Gr | null): void;
  finish(): void;

  sort(customOpaqueSort?: SortFunction | null, customTransparentSort?: SortFunction | null): void;
}

/** r180's WebGLRenderList. */
export function createRenderList<O extends RenderListObject = RenderListObject, G = unknown, M extends RenderListMaterial = RenderListMaterial, Gr = unknown>(): RenderList<O, G, M, Gr> {
  type Item = RenderItem<O, G, M, Gr>;

  const renderItems: Item[] = [];
  let renderItemsIndex = 0;

  const opaque: Item[] = [];
  const transmissive: Item[] = [];
  const transparent: Item[] = [];

  function init(): void {
    renderItemsIndex = 0;

    opaque.length = 0;
    transmissive.length = 0;
    transparent.length = 0;
  }

  function getNextRenderItem(object: O, geometry: G, material: M, groupOrder: number, z: number, group: Gr | null): Item {
    let renderItem = renderItems[renderItemsIndex];

    if (renderItem === undefined) {
      renderItem = {
        id: object.id,
        object: object,
        geometry: geometry,
        material: material,
        groupOrder: groupOrder,
        renderOrder: object.renderOrder,
        z: z,
        group: group,
      };

      renderItems[renderItemsIndex] = renderItem;
    } else {
      renderItem.id = object.id;
      renderItem.object = object;
      renderItem.geometry = geometry;
      renderItem.material = material;
      renderItem.groupOrder = groupOrder;
      renderItem.renderOrder = object.renderOrder;
      renderItem.z = z;
      renderItem.group = group;
    }

    renderItemsIndex++;

    return renderItem;
  }

  function push(object: O, geometry: G, material: M, groupOrder: number, z: number, group: Gr | null): void {
    const renderItem = getNextRenderItem(object, geometry, material, groupOrder, z, group);

    if ((material.transmission as number) > 0.0) {
      transmissive.push(renderItem);
    } else if (material.transparent === true) {
      transparent.push(renderItem);
    } else {
      opaque.push(renderItem);
    }
  }

  function unshift(object: O, geometry: G, material: M, groupOrder: number, z: number, group: Gr | null): void {
    const renderItem = getNextRenderItem(object, geometry, material, groupOrder, z, group);

    if ((material.transmission as number) > 0.0) {
      transmissive.unshift(renderItem);
    } else if (material.transparent === true) {
      transparent.unshift(renderItem);
    } else {
      opaque.unshift(renderItem);
    }
  }

  function sort(customOpaqueSort?: SortFunction | null, customTransparentSort?: SortFunction | null): void {
    if (opaque.length > 1) opaque.sort(customOpaqueSort || painterSortStable);
    if (transmissive.length > 1) transmissive.sort(customTransparentSort || reversePainterSortStable);
    if (transparent.length > 1) transparent.sort(customTransparentSort || reversePainterSortStable);
  }

  function finish(): void {
    // Clear references from inactive renderItems in the list

    for (let i = renderItemsIndex, il = renderItems.length; i < il; i++) {
      const renderItem = renderItems[i]!;

      if (renderItem.id === null) break;

      renderItem.id = null;
      renderItem.object = null;
      renderItem.geometry = null;
      renderItem.material = null;
      renderItem.group = null;
    }
  }

  return {
    opaque: opaque,
    transmissive: transmissive,
    transparent: transparent,

    init: init,
    push: push,
    unshift: unshift,
    finish: finish,

    sort: sort,
  };
}

export interface RenderLists<O extends RenderListObject = RenderListObject, G = unknown, M extends RenderListMaterial = RenderListMaterial, Gr = unknown> {
  get(scene: object, renderCallDepth: number): RenderList<O, G, M, Gr>;
  dispose(): void;
}

/** r180's WebGLRenderLists: one list per stage per nested render call. */
export function createRenderLists<O extends RenderListObject = RenderListObject, G = unknown, M extends RenderListMaterial = RenderListMaterial, Gr = unknown>(): RenderLists<O, G, M, Gr> {
  let lists = new WeakMap<object, RenderList<O, G, M, Gr>[]>();

  function get(scene: object, renderCallDepth: number): RenderList<O, G, M, Gr> {
    const listArray = lists.get(scene);
    let list: RenderList<O, G, M, Gr>;

    if (listArray === undefined) {
      list = createRenderList();
      lists.set(scene, [list]);
    } else {
      if (renderCallDepth >= listArray.length) {
        list = createRenderList();
        listArray.push(list);
      } else {
        list = listArray[renderCallDepth]!;
      }
    }

    return list;
  }

  function dispose(): void {
    lists = new WeakMap();
  }

  return {
    get: get,
    dispose: dispose,
  };
}
