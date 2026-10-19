import { DataTexture, RGBAFormat, UnsignedByteType, WebGPURenderer } from 'three/webgpu';

/**
 * GPU half of the QA memory-bomb page (apps/web/qa/memory-bomb.ts): a throwaway WebGL2 renderer and `DataTexture` uploads. It
 * lives in the engine package because apps/web does not depend on three directly. QA builds only.
 */
export interface BombRenderer {
  /** Uploads a `side` x `side` RGBA8 texture filled with `fill` (side 4096 = 64 MiB). Returns the texture for retention. */
  upload(side: number, fill: number): unknown;
}

export async function createBombRenderer(): Promise<BombRenderer> {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const renderer = new WebGPURenderer({ canvas, antialias: false, forceWebGL: true });
  await renderer.init();
  return {
    upload(side, fill) {
      const data = new Uint8Array(side * side * 4);
      data.fill(fill);
      const tex = new DataTexture(data, side, side, RGBAFormat, UnsignedByteType);
      tex.needsUpdate = true;
      renderer.initTexture(tex);
      return tex;
    },
  };
}
