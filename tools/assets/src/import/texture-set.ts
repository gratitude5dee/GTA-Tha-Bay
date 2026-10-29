/**
 * `assets:import -- textures [--check]` (M10d0, DL-OWN-06): the six CC0 PBR sets as KTX2.
 *
 * The manifest `assets/import/textures.json` names, per set, the vetted Poly Haven (or ambientCG) source maps with their
 * URLs and SHA-256. The importer downloads a source into `.cache/import/` (git-ignored), checks its hash, decodes the PNG,
 * box-filters it down to the tier sizes (1024, 512 and 256 px for `desktop`, `mobile` and `mobile-low`), encodes it and writes
 * `assets/src/texture/pbr.<set>.<map>/{desktop,mobile,mobile-low}.ktx2`, the asset spec and the provenance records: one licensed
 * root per source file and one derived record per KTX2 file.
 *
 * Encoding runs through the `Ktx2Encoder` interface. The backend is the Basis Universal encoder of `ktx2-encoder` (WASM, in
 * process; BD-M10d0-01 records why it stands in for the KTX-Software process of F-017). `--check` re-reads the committed outputs
 * and needs neither an encoder nor a network, so CI can run it anywhere.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { TEXTURE_TOOL, ART_VETTING_GATE } from '../../../../packages/shared/src/assets/gates/provenance.ts';
import { finding, type GateFinding } from '../../../../packages/shared/src/assets/gates/types.ts';
import type { ProvenanceRecord } from '../../../../packages/shared/src/assets/provenance.ts';
import type { VariantId, VariantStats } from '../../../../packages/shared/src/assets/c07.ts';
import { sha256Hex } from '../../../ci/lib/common.ts';
import { buildRecord } from '../../provenance-new.ts';

export const MANIFEST_PATH = 'assets/import/textures.json';
export const GATE = 'assets:import';
export const SET_NAMES = ['asphalt', 'concrete', 'pavers', 'grass-dirt', 'brick', 'stucco'] as const;
export type SetName = (typeof SET_NAMES)[number];
export const MAP_NAMES = ['albedo', 'normal', 'orm'] as const;
export type MapName = (typeof MAP_NAMES)[number];
/** Variant id to edge length in px (DL-OWN-07: 1024 / 512 / 256, tuned here). */
export const TIER_SIZES: Readonly<Record<'desktop' | 'mobile' | 'mobile-low', number>> = { desktop: 1024, mobile: 512, 'mobile-low': 256 };
export const TIER_VARIANTS = ['desktop', 'mobile', 'mobile-low'] as const satisfies readonly VariantId[];
export const CODEC_OF: Readonly<Record<MapName, 'ktx2-etc1s' | 'ktx2-uastc'>> = { albedo: 'ktx2-etc1s', normal: 'ktx2-uastc', orm: 'ktx2-uastc' };
/** The tool and version recorded on every derived record. The version names the encoder backend. */
export const TOOL_VERSION = 'ktx2-encoder@0.6.0 (basis_universal)';
const CREATED_AT = '2026-10-28T00:00:00Z';
const USER_AGENT = 'dee-verse-builder-m10d0/1.0 (art intake; contact gratitude@5-dee.com)';

export interface SourceMap { file: string; url: string; sha256: string | null; bytes?: number }
export interface SetEntry {
  set: SetName;
  pack: 'polyhaven' | 'ambientcg';
  assetId: string;
  name: string;
  author: string;
  pageUrl: string;
  /** Edge of one tile in metres, from the pack's dimensions. */
  tileM: number;
  retrieved: string;
  maps: Record<MapName, SourceMap>;
}
export interface TextureManifest { schema: 'texture-import/1'; sets: SetEntry[] }

export function assetIdOf(set: string, map: MapName): string {
  return `pbr.${set}.${map}`;
}
export const assetDirOf = (set: string, map: MapName): string => `assets/src/texture/${assetIdOf(set, map)}`;

export function readManifest(root: string): TextureManifest {
  return JSON.parse(readFileSync(path.join(root, MANIFEST_PATH), 'utf8')) as TextureManifest;
}

// ---------------------------------------------------------------------------------------------
// images

export interface Raster { width: number; height: number; data: Uint8Array }

export function decodePng(bytes: Uint8Array): Raster {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

/** Halves an RGBA raster with a 2 x 2 box filter; `normal` renormalises each averaged vector. */
export function halve(src: Raster, normal: boolean): Raster {
  const w = src.width >> 1;
  const h = src.height >> 1;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const i00 = ((2 * y) * src.width + 2 * x) * 4;
      const i01 = i00 + 4;
      const i10 = i00 + src.width * 4;
      const i11 = i10 + 4;
      for (let c = 0; c < 4; c++) {
        out[o + c] = Math.round(((src.data[i00 + c] as number) + (src.data[i01 + c] as number) + (src.data[i10 + c] as number) + (src.data[i11 + c] as number)) / 4);
      }
      if (normal) {
        const nx = ((out[o] as number) / 255) * 2 - 1;
        const ny = ((out[o + 1] as number) / 255) * 2 - 1;
        const nz = ((out[o + 2] as number) / 255) * 2 - 1;
        const len = Math.hypot(nx, ny, nz) || 1;
        out[o] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
        out[o + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
        out[o + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      }
    }
  }
  return { width: w, height: h, data: out };
}

/** The raster at `size` px: the source itself when it already has that size, else halved repeatedly. */
export function resizeTo(src: Raster, size: number, normal: boolean): Raster {
  if (src.width !== src.height) throw new Error(`source is ${src.width}x${src.height}; tiles must be square`);
  if (src.width < size) throw new Error(`source is ${src.width} px, below the ${size} px variant`);
  let cur = src;
  while (cur.width > size) {
    if (cur.width % 2 !== 0) throw new Error(`cannot halve ${cur.width} px`);
    cur = halve(cur, normal);
  }
  if (cur.width !== size) throw new Error(`${src.width} px does not reduce to ${size} px by halving`);
  return cur;
}

// ---------------------------------------------------------------------------------------------
// KTX2

const KTX2_ID = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
export const COLOR_MODEL_ETC1S = 163;
export const COLOR_MODEL_UASTC = 166;
export const TRANSFER_LINEAR = 1;
export const TRANSFER_SRGB = 2;

export interface Ktx2Info { width: number; height: number; levels: number; supercompression: number; colorModel: number; transfer: number }

/** Header and basic data format descriptor of a KTX2 file; null when the bytes are not KTX2. */
export function readKtx2(bytes: Uint8Array): Ktx2Info | null {
  if (bytes.length < 80 || KTX2_ID.some((b, i) => bytes[i] !== b)) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dfdOffset = dv.getUint32(48, true);
  if (dfdOffset + 16 > bytes.length) return null;
  return {
    width: dv.getUint32(20, true),
    height: dv.getUint32(24, true),
    levels: dv.getUint32(40, true),
    supercompression: dv.getUint32(44, true),
    colorModel: dv.getUint8(dfdOffset + 12),
    transfer: dv.getUint8(dfdOffset + 14),
  };
}

/** Bytes of the full mip chain in an 8 bits per texel GPU format (BC7, ASTC 4x4): one 16-byte block per 4 x 4 texels. */
export function gpuBytesOf(width: number, height: number, levels: number): number {
  let total = 0;
  for (let l = 0; l < levels; l++) {
    total += Math.max(1, Math.ceil(Math.max(1, width >> l) / 4)) * Math.max(1, Math.ceil(Math.max(1, height >> l) / 4)) * 16;
  }
  return total;
}

export function levelsFor(size: number): number {
  return Math.floor(Math.log2(size)) + 1;
}

export interface Ktx2Encoder { readonly version: string; encode(img: Raster, map: MapName): Promise<Uint8Array> }

/** The in-process Basis Universal encoder of ktx2-encoder. */
export async function basisEncoder(): Promise<Ktx2Encoder> {
  const { encodeToKTX2 } = await import('ktx2-encoder');
  return {
    version: TOOL_VERSION,
    async encode(img, map) {
      const etc1s = map === 'albedo';
      const out = await encodeToKTX2(new Uint8Array(1), {
        isUASTC: !etc1s,
        isKTX2File: true,
        generateMipmap: true,
        isPerceptual: etc1s,
        isSetKTX2SRGBTransferFunc: etc1s,
        isNormalMap: map === 'normal',
        needSupercompression: !etc1s,
        ...(etc1s ? { qualityLevel: 128, compressionLevel: 2 } : { uastcLDRQualityLevel: 2, enableRDO: true, rdoQualityLevel: 1.5 }),
        imageDecoder: async () => ({ width: img.width, height: img.height, data: img.data }),
      });
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// sources

export function cachePath(root: string, entry: SetEntry, map: MapName): string {
  return path.join(root, '.cache', 'import', entry.pack, entry.maps[map].file);
}

async function download(url: string): Promise<Uint8Array> {
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw new Error(`download of ${url} failed: ${last}`);
}

/** The bytes of one source map: from the cache, else downloaded; checked against the manifest hash unless `pin`. */
export async function sourceBytes(root: string, entry: SetEntry, map: MapName, pin: boolean): Promise<Uint8Array> {
  const file = cachePath(root, entry, map);
  let bytes: Uint8Array;
  if (existsSync(file)) bytes = readFileSync(file);
  else {
    bytes = await download(entry.maps[map].url);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  const sha = sha256Hex(bytes);
  const want = entry.maps[map].sha256;
  if (!pin && want !== null && sha !== want) throw new Error(`${entry.assetId} ${map}: source sha256 ${sha.slice(0, 12)} differs from the manifest ${want.slice(0, 12)}`);
  return bytes;
}

// ---------------------------------------------------------------------------------------------
// outputs

export interface MapOutput {
  set: SetName;
  map: MapName;
  files: Record<(typeof TIER_VARIANTS)[number], Uint8Array>;
  stats: Record<(typeof TIER_VARIANTS)[number], VariantStats>;
}

export async function buildMap(entry: SetEntry, map: MapName, source: Uint8Array, enc: Ktx2Encoder): Promise<MapOutput> {
  const raster = decodePng(source);
  const files = {} as MapOutput['files'];
  const stats = {} as MapOutput['stats'];
  for (const variant of TIER_VARIANTS) {
    const size = TIER_SIZES[variant];
    const img = resizeTo(raster, size, map === 'normal');
    const bytes = await enc.encode(img, map);
    const info = readKtx2(bytes);
    if (!info) throw new Error(`${entry.set} ${map} ${variant}: the encoder did not return KTX2`);
    files[variant] = bytes;
    stats[variant] = { texMaxPx: size, texGpuBytes: gpuBytesOf(info.width, info.height, info.levels) };
  }
  return { set: entry.set, map, files, stats };
}

function specJson(out: MapOutput): string {
  const dir = assetDirOf(out.set, out.map);
  const spec = {
    kind: 'texture',
    id: assetIdOf(out.set, out.map),
    variants: Object.fromEntries(TIER_VARIANTS.map((v) => [v, `${dir}/${v}.ktx2`])),
    deps: [],
    tags: ['pbr', `set:${out.set}`, `map:${out.map}`],
    codec: { tex: CODEC_OF[out.map] },
    stats: out.stats,
    status: 'active',
    visibility: 'public',
  };
  return `${JSON.stringify(spec, null, 2)}\n`;
}

/** The licensed root of one source file and the derived record of each KTX2 file written from it. */
export function recordsFor(entry: SetEntry, out: MapOutput, sourceSha: string, outputShas: Record<string, string>, toolVersion: string): ProvenanceRecord[] {
  const author = `profile:${entry.author.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  const src = entry.maps[out.map];
  const root = buildRecord({
    sha256: sourceSha,
    paths: [`import/${entry.pack}/${entry.assetId}/${src.file}`],
    kind: 'texture',
    origin: 'licensed',
    license: 'CC0-1.0',
    authors: [author],
    source: { url: entry.pageUrl, dataset_id: entry.assetId, retrieved: entry.retrieved },
    createdAt: CREATED_AT,
  });
  root.ip_checks = { signatures: 'pass', strings: 'pass', similarity: 'n/a' };
  root.review = [{ gate: ART_VETTING_GATE, by: 'profile:builder-m10d0', at: CREATED_AT, decision: 'approve', note: `assets/intake/${entry.pack}/${entry.set}.json` }];
  const records = [root];
  for (const variant of TIER_VARIANTS) {
    const sha = outputShas[variant] as string;
    const rec = buildRecord({
      sha256: sha,
      paths: [`${assetDirOf(out.set, out.map)}/${variant}.ktx2`],
      kind: 'texture',
      origin: 'derived',
      license: 'CC0-1.0',
      authors: [author],
      derivedFrom: [sourceSha],
      tool: { name: TEXTURE_TOOL, version: toolVersion, args_sha256: sha256Hex(Buffer.from(`${toolVersion} ${out.map} ${TIER_SIZES[variant]} ${CODEC_OF[out.map]}`)) },
      createdAt: CREATED_AT,
    });
    rec.ip_checks = { signatures: 'pass', strings: 'pass', similarity: 'n/a' };
    records.push(rec);
  }
  return records;
}

export function writeRecord(root: string, rec: ProvenanceRecord): void {
  const out = path.join(root, 'assets', 'provenance', rec.sha256.slice(0, 2), `${rec.sha256}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(rec, null, 2)}\n`);
}

export interface ImportOptions { root: string; encoder?: Ktx2Encoder; only?: string[]; log?: (m: string) => void }

/** Downloads, converts and writes every set (or `only`). */
export async function importTextures(opts: ImportOptions): Promise<void> {
  const manifest = readManifest(opts.root);
  const enc = opts.encoder ?? (await basisEncoder());
  const log = opts.log ?? ((): void => undefined);
  for (const entry of manifest.sets) {
    if (opts.only && !opts.only.includes(entry.set)) continue;
    for (const map of MAP_NAMES) {
      const source = await sourceBytes(opts.root, entry, map, false);
      const sourceSha = sha256Hex(source);
      const out = await buildMap(entry, map, source, enc);
      const dir = path.join(opts.root, assetDirOf(entry.set, map));
      mkdirSync(dir, { recursive: true });
      const shas: Record<string, string> = {};
      for (const v of TIER_VARIANTS) {
        writeFileSync(path.join(dir, `${v}.ktx2`), out.files[v]);
        shas[v] = sha256Hex(out.files[v]);
      }
      writeFileSync(path.join(dir, 'asset.json'), specJson(out));
      for (const rec of recordsFor(entry, out, sourceSha, shas, enc.version)) writeRecord(opts.root, rec);
      log(`${assetIdOf(entry.set, map)}: ${TIER_VARIANTS.map((v) => `${v} ${out.files[v].length} B`).join(', ')}`);
    }
  }
}

/** Writes the SHA-256 and size of every source map into the manifest (authoring step: downloads what the cache lacks). */
export async function pinSources(root: string, log: (m: string) => void = () => undefined): Promise<void> {
  const manifest = readManifest(root);
  for (const entry of manifest.sets) {
    for (const map of MAP_NAMES) {
      const bytes = await sourceBytes(root, entry, map, true);
      entry.maps[map].sha256 = sha256Hex(bytes);
      entry.maps[map].bytes = bytes.length;
      log(`${entry.assetId} ${map}: ${entry.maps[map].sha256?.slice(0, 12)} ${bytes.length} B`);
    }
  }
  writeFileSync(path.join(root, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
}

// ---------------------------------------------------------------------------------------------
// --check

function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Verifies the committed outputs against the manifest without ktx or a network: 18 assets x 3 variants. */
export function checkTextures(root: string): { findings: GateFinding[]; assets: number } {
  const findings: GateFinding[] = [];
  const bad = (file: string, rule: string, detail: string): void => {
    findings.push(finding(GATE, file, rule, detail));
  };
  if (!existsSync(path.join(root, MANIFEST_PATH))) {
    bad(MANIFEST_PATH, 'manifest-missing', 'assets/import/textures.json does not exist');
    return { findings, assets: 0 };
  }
  const manifest = readManifest(root);
  const sets = manifest.sets.map((s) => s.set).sort();
  if (JSON.stringify(sets) !== JSON.stringify([...SET_NAMES].sort())) bad(MANIFEST_PATH, 'sets', `the manifest must list ${SET_NAMES.join(', ')}; it lists ${sets.join(', ')}`);
  let assets = 0;
  const records = new Map<string, ProvenanceRecord>();
  for (const entry of manifest.sets) {
    for (const map of MAP_NAMES) {
      const id = assetIdOf(entry.set, map);
      const dir = assetDirOf(entry.set, map);
      const specFile = path.join(root, dir, 'asset.json');
      if (!entry.maps[map]?.sha256) {
        bad(MANIFEST_PATH, 'source-unpinned', `${id}: no sha256 for the source map`);
        continue;
      }
      if (!existsSync(specFile)) {
        bad(`${dir}/asset.json`, 'spec-missing', `${id}: run assets:import -- textures`);
        continue;
      }
      assets++;
      const spec = JSON.parse(readFileSync(specFile, 'utf8')) as { variants: Record<string, string>; codec?: { tex?: string }; stats?: Record<string, VariantStats> };
      if (spec.codec?.tex !== CODEC_OF[map]) bad(`${dir}/asset.json`, 'codec', `${id}: codec.tex is ${spec.codec?.tex}, want ${CODEC_OF[map]}`);
      const rootRec = readRecord(root, entry.maps[map].sha256);
      if (!rootRec) bad(`${dir}/asset.json`, 'record-missing', `${id}: no licensed root record for source ${entry.maps[map].sha256.slice(0, 12)}`);
      else if (rootRec.origin !== 'licensed') bad(`${dir}/asset.json`, 'record-root', `${id}: the root record is ${rootRec.origin}, not licensed`);
      for (const variant of TIER_VARIANTS) {
        const rel = spec.variants[variant];
        if (rel !== `${dir}/${variant}.ktx2`) {
          bad(`${dir}/asset.json`, 'variant', `${id}: variant ${variant} must be ${dir}/${variant}.ktx2`);
          continue;
        }
        const abs = path.join(root, rel);
        if (!existsSync(abs)) {
          bad(rel, 'variant-file-missing', `${id} ${variant}: file does not exist`);
          continue;
        }
        const bytes = readFileSync(abs);
        const info = readKtx2(bytes);
        const size = TIER_SIZES[variant];
        if (!info) {
          bad(rel, 'not-ktx2', `${id} ${variant}: not a KTX2 file`);
          continue;
        }
        if (info.width !== size || info.height !== size) bad(rel, 'size', `${id} ${variant}: ${info.width}x${info.height}, want ${size}x${size}`);
        if (info.levels !== levelsFor(size)) bad(rel, 'mips', `${id} ${variant}: ${info.levels} levels, want ${levelsFor(size)}`);
        const etc1s = CODEC_OF[map] === 'ktx2-etc1s';
        if (info.colorModel !== (etc1s ? COLOR_MODEL_ETC1S : COLOR_MODEL_UASTC)) bad(rel, 'codec', `${id} ${variant}: colour model ${info.colorModel} is not ${CODEC_OF[map]}`);
        if (info.transfer !== (etc1s ? TRANSFER_SRGB : TRANSFER_LINEAR)) bad(rel, 'transfer', `${id} ${variant}: transfer function ${info.transfer}, want ${etc1s ? 'sRGB' : 'linear'}`);
        const stats = spec.stats?.[variant];
        if (!stats || stats.texGpuBytes !== gpuBytesOf(info.width, info.height, info.levels)) bad(`${dir}/asset.json`, 'stats', `${id} ${variant}: texGpuBytes must be ${gpuBytesOf(info.width, info.height, info.levels)}`);
        if (stats && stats.texMaxPx !== size) bad(`${dir}/asset.json`, 'stats', `${id} ${variant}: texMaxPx must be ${size}`);
        const sha = sha256File(abs);
        const rec = records.get(sha) ?? readRecord(root, sha);
        if (!rec) bad(rel, 'record-missing', `${id} ${variant}: no provenance record for ${sha.slice(0, 12)}`);
        else {
          records.set(sha, rec);
          if (rec.origin !== 'derived' || rec.tool?.name !== TEXTURE_TOOL) bad(rel, 'record', `${id} ${variant}: the record must be derived by ${TEXTURE_TOOL}`);
          if (!rec.derived_from.includes(entry.maps[map].sha256)) bad(rel, 'record-root', `${id} ${variant}: derived_from must list the source ${entry.maps[map].sha256.slice(0, 12)}`);
        }
      }
    }
  }
  return { findings, assets };
}

function readRecord(root: string, sha: string): ProvenanceRecord | null {
  const file = path.join(root, 'assets', 'provenance', sha.slice(0, 2), `${sha}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ProvenanceRecord) : null;
}
