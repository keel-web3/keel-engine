// Ported from Three.js r180's core/EventDispatcher.js (MIT, see packages/lit/NOTICE).

/** An event: a type, plus whatever the sender adds. `target` is the sender while listeners run. */
export interface EmitterEvent {
  type: string;
  target?: unknown;
  [key: string]: unknown;
}

export type Listener<E extends EmitterEvent = EmitterEvent> = (event: E) => void;

export class Emitter {
  // (made on the first addEventListener, as r180 does: an own property only once something listens)
  declare _listeners?: Record<string, Listener[]>;

  addEventListener<E extends EmitterEvent = EmitterEvent>(type: string, listener: Listener<E>): void {
    if (this._listeners === undefined) this._listeners = {};

    const listeners = this._listeners;

    if (listeners[type] === undefined) {
      listeners[type] = [];
    }

    const list = listeners[type];
    if (list.indexOf(listener as Listener) === - 1) {
      list.push(listener as Listener);
    }
  }

  hasEventListener<E extends EmitterEvent = EmitterEvent>(type: string, listener: Listener<E>): boolean {
    const listeners = this._listeners;

    if (listeners === undefined) return false;

    return listeners[type] !== undefined && listeners[type].indexOf(listener as Listener) !== - 1;
  }

  removeEventListener<E extends EmitterEvent = EmitterEvent>(type: string, listener: Listener<E>): void {
    const listeners = this._listeners;

    if (listeners === undefined) return;

    const listenerArray = listeners[type];

    if (listenerArray !== undefined) {
      const index = listenerArray.indexOf(listener as Listener);

      if (index !== - 1) {
        listenerArray.splice(index, 1);
      }
    }
  }

  dispatchEvent(event: EmitterEvent): void {
    const listeners = this._listeners;

    if (listeners === undefined) return;

    const listenerArray = listeners[event.type];

    if (listenerArray !== undefined) {
      event.target = this;

      // (a copy, in case listeners are removed while iterating)
      const array = listenerArray.slice(0);

      for (let i = 0, l = array.length; i < l; i++) {
        array[i]!.call(this, event);
      }

      event.target = null;
    }
  }
}
