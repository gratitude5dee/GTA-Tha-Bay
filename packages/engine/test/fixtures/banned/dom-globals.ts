// Banned in sim code (C02 rule 1): DOM globals.
export const touch = (x: unknown): unknown[] => [
  window, document, navigator, location, localStorage, sessionStorage, self,
  requestAnimationFrame(() => {}), cancelAnimationFrame(0),
  x instanceof HTMLElement, x instanceof HTMLCanvasElement, x instanceof Element, x instanceof Node,
  new Event('x'), new MouseEvent('x'), new KeyboardEvent('x'), new PointerEvent('x'), new TouchEvent('x'),
  new OffscreenCanvas(1, 1), x instanceof CanvasRenderingContext2D, x instanceof WebGL2RenderingContext,
  new AudioContext(), new XMLHttpRequest(),
];
