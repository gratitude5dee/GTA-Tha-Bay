/**
 * KTX2 decoding for the surface textures (M10d0): a thin wrapper around three's `KTX2Loader` and its Basis transcoder (WASM in
 * worker threads). The transcoder files are copied same-origin by `apps/web/vite.config.ts` (`/basis/`), which keeps them under the
 * isolation headers; nothing is fetched from a CDN. The bytes come from the pack store through the `world.texture` job, so the loader
 * only parses (`parse`), it never fetches.
 *
 * The loader picks the GPU format from what the renderer reports (`detectSupport`), so it is built after `renderer.init()` and again
 * when the renderer is replaced (`onRendererReplaced`): a texture transcoded for one device is not valid on the next.
 */
import {
  CompressedTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/** Where `apps/web/vite.config.ts` copies the Basis transcoder (`basis_transcoder.js`, `basis_transcoder.wasm`). */
export const TRANSCODER_PATH = '/basis/';

export class Ktx2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ktx2Error';
  }
}

interface MipLevel {
  data: ArrayBufferView;
  width: number;
  height: number;
}
type WithMips = Texture & { mipmaps?: MipLevel[]; image: { width: number; height: number } };

/** Format names three uses for the transcoder's targets, by `Texture.format` (the constants of three's `constants.js`). */
const FORMAT_NAMES: Readonly<Record<number, string>> = {
  1023: 'RGBA8',
  33776: 'DXT1',
  33777: 'DXT3',
  33779: 'DXT5',
  36492: 'BC7',
  35840: 'PVRTC',
  35841: 'PVRTC',
  35842: 'PVRTC',
  35843: 'PVRTC',
  36196: 'ETC1',
  37492: 'ETC2',
  37496: 'ETC2',
  37808: 'ASTC4x4',
};

export const formatName = (format: number): string => FORMAT_NAMES[format] ?? `format-${format}`;

/** Bytes of the transcoded mip chain: the figure that the texture occupies in GPU memory (compressed formats) or as RGBA8. */
export function textureBytes(tex: Texture): number {
  const t = tex as WithMips;
  let total = 0;
  for (const m of t.mipmaps ?? []) total += m.data.byteLength;
  return total;
}

/** Mip levels the texture holds. */
export function mipCount(tex: Texture): number {
  return (tex as WithMips).mipmaps?.length ?? 1;
}

/** Drops the largest mip level (a quarter of the bytes); false when only one level is left. */
export function dropTopMip(tex: Texture): boolean {
  const t = tex as WithMips;
  const mips = t.mipmaps;
  if (!mips || mips.length < 2) return false;
  mips.shift();
  const top = mips[0] as MipLevel;
  t.image.width = top.width;
  t.image.height = top.height;
  t.needsUpdate = true;
  return true;
}

/**
 * The texture in the shape the renderers upload the same way on both backends: a compressed result stays a `CompressedTexture`; an
 * uncompressed RGBA8 result (a device with no compressed format) becomes a `DataTexture` with its mip chain. Repeat wrapping, trilinear.
 */
export function prepareTexture(tex: Texture): Texture {
  const t = tex as WithMips;
  let out: Texture = tex;
  if (t.format === RGBAFormat && t.mipmaps && t.mipmaps.length > 0 && tex instanceof CompressedTexture) {
    const top = t.mipmaps[0] as MipLevel;
    const d = new DataTexture(new Uint8Array((top.data as Uint8Array).buffer, (top.data as Uint8Array).byteOffset, top.data.byteLength), top.width, top.height, RGBAFormat, UnsignedByteType);
    (d as WithMips).mipmaps = t.mipmaps;
    d.colorSpace = tex.colorSpace;
    d.generateMipmaps = false;
    out = d;
  }
  out.wrapS = RepeatWrapping;
  out.wrapT = RepeatWrapping;
  out.magFilter = LinearFilter;
  out.minFilter = mipCount(out) > 1 ? LinearMipmapLinearFilter : LinearFilter;
  out.anisotropy = 4;
  out.needsUpdate = true;
  return out;
}

/** One loader per renderer: `detectSupport` fixes the transcoder targets. */
export class Ktx2Decoder {
  private loader: KTX2Loader | null = null;
  private disposed = false;

  constructor(private readonly transcoderPath: string = TRANSCODER_PATH) {}

  /** Builds the loader for `renderer` (which must have finished `init()`); a loader built for an earlier renderer is disposed. */
  bind(renderer: WebGPURenderer): void {
    this.loader?.dispose();
    const loader = new KTX2Loader();
    loader.setTranscoderPath(this.transcoderPath);
    loader.setWorkerLimit(2);
    loader.detectSupport(renderer);
    this.loader = loader;
  }

  get bound(): boolean {
    return this.loader !== null && !this.disposed;
  }

  /** Transcodes one KTX2 file. `bytes` is consumed (transferred to a worker). */
  decode(bytes: ArrayBuffer): Promise<Texture> {
    const loader = this.loader;
    if (!loader || this.disposed) return Promise.reject(new Ktx2Error('the KTX2 decoder is not bound to a renderer'));
    return new Promise<Texture>((resolve, reject) => {
      try {
        loader.parse(
          bytes,
          (t) => resolve(prepareTexture(t)),
          (e) => reject(new Ktx2Error(e instanceof Error ? e.message : String(e))),
        );
      } catch (e) {
        reject(new Ktx2Error(e instanceof Error ? e.message : String(e)));
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loader?.dispose();
    this.loader = null;
  }
}
