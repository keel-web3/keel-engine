// Ported from Three.js r180's renderers/webgl/WebGLAnimation.js (MIT, see
// packages/lit/NOTICE): the renderer's animation loop.

/** What drives the loop (a window; r180 also took an XR session here). */
export interface AnimationContext {
  requestAnimationFrame(callback: (time: number, frame?: unknown) => void): number;
  cancelAnimationFrame(handle: number): void;
}

export type AnimationLoop = (time: number, frame?: unknown) => void;

/** r180's WebGLAnimation. */
export interface Animation {
  start(): void;
  stop(): void;
  setAnimationLoop(callback: AnimationLoop | null): void;
  setContext(value: AnimationContext | null): void;
}

export function createAnimation(): Animation {
  let context: AnimationContext | null = null;
  let isAnimating = false;
  let animationLoop: AnimationLoop | null = null;
  let requestId: number | null = null;

  function onAnimationFrame(time: number, frame?: unknown): void {
    animationLoop!(time, frame);

    requestId = context!.requestAnimationFrame(onAnimationFrame);
  }

  return {
    start: function (): void {
      if (isAnimating === true) return;
      if (animationLoop === null) return;

      requestId = context!.requestAnimationFrame(onAnimationFrame);

      isAnimating = true;
    },

    stop: function (): void {
      context!.cancelAnimationFrame(requestId as number);

      isAnimating = false;
    },

    setAnimationLoop: function (callback: AnimationLoop | null): void {
      animationLoop = callback;
    },

    setContext: function (value: AnimationContext | null): void {
      context = value;
    },
  };
}
