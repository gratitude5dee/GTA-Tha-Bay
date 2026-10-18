/**
 * Local probes for the spike: ffprobe and c2patool wrappers (tool absent is recorded, never an error), a byte-scan
 * C2PA heuristic, the GLB probe (bones, clips, triangles) with @gltf-transform/core, and the turnaround crops.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NodeIO, type Document } from '@gltf-transform/core';
import { PNG } from 'pngjs';

export interface MediaInfo {
  tool: 'ffprobe' | 'absent';
  container?: string;
  durationS?: number;
  video?: { codec: string; width: number; height: number; fps: number | null };
  audio?: { codec: string; sampleRate: number | null; channels: number | null } | null;
}

export interface C2paInfo { present: boolean | null; method: 'c2patool' | 'heuristic'; detail: string }

function toolExists(cmd: string): boolean {
  return spawnSync(cmd, ['-version'], { stdio: 'ignore' }).error === undefined;
}

export const toolsAvailable = (): { ffprobe: boolean; c2patool: boolean } => ({
  ffprobe: toolExists('ffprobe'),
  c2patool: spawnSync('c2patool', ['--version'], { stdio: 'ignore' }).error === undefined,
});

function withTempFile<T>(bytes: Uint8Array, ext: string, f: (file: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'dv-spike-'));
  const file = path.join(dir, `probe.${ext}`);
  try {
    writeFileSync(file, bytes);
    return f(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function parseFps(rate: unknown): number | null {
  if (typeof rate !== 'string') return null;
  const [n, d] = rate.split('/').map(Number);
  if (!n || !d) return null;
  return Math.round((n / d) * 1000) / 1000;
}

/** Pure: shape the ffprobe JSON. */
export function parseFfprobe(json: unknown): MediaInfo {
  const j = json as { format?: { format_name?: string; duration?: string }; streams?: Record<string, unknown>[] };
  const streams = j.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  const info: MediaInfo = { tool: 'ffprobe', audio: null };
  if (j.format?.format_name) info.container = j.format.format_name;
  if (j.format?.duration) info.durationS = Number(j.format.duration);
  if (v) info.video = { codec: String(v.codec_name), width: Number(v.width), height: Number(v.height), fps: parseFps(v.avg_frame_rate ?? v.r_frame_rate) };
  if (a) info.audio = { codec: String(a.codec_name), sampleRate: a.sample_rate ? Number(a.sample_rate) : null, channels: typeof a.channels === 'number' ? a.channels : null };
  return info;
}

export function probeMedia(bytes: Uint8Array, ext: string): MediaInfo {
  if (!toolExists('ffprobe')) return { tool: 'absent' };
  return withTempFile(bytes, ext, (file) => {
    const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' });
    if (r.status !== 0) return { tool: 'ffprobe' as const };
    try {
      return parseFfprobe(JSON.parse(r.stdout));
    } catch {
      return { tool: 'ffprobe' as const };
    }
  });
}

/** Byte scan for the JUMBF box type and the C2PA label. Labelled heuristic: a hit is a strong hint, a miss is not proof. */
export function scanC2pa(bytes: Uint8Array): C2paInfo {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  const jumb = text.includes('jumb');
  const label = text.includes('c2pa');
  return { present: jumb && label, method: 'heuristic', detail: `jumb box ${jumb ? 'found' : 'absent'}, c2pa label ${label ? 'found' : 'absent'}` };
}

export function probeC2pa(bytes: Uint8Array, ext: string): C2paInfo {
  if (spawnSync('c2patool', ['--version'], { stdio: 'ignore' }).error !== undefined) return scanC2pa(bytes);
  return withTempFile(bytes, ext, (file) => {
    const r = spawnSync('c2patool', [file], { encoding: 'utf8' });
    const none = /no claim|no manifest|not found/i.test(`${r.stdout}${r.stderr}`);
    return { present: r.status === 0 && !none, method: 'c2patool' as const, detail: none ? 'no manifest' : r.status === 0 ? 'manifest found' : `exit ${String(r.status)}` };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// GLB probe

export const HUMANOID_BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'l_shoulder', 'l_upperArm', 'l_lowerArm', 'l_hand', 'r_shoulder', 'r_upperArm', 'r_lowerArm', 'r_hand',
  'l_upperLeg', 'l_lowerLeg', 'l_foot', 'l_toes', 'r_upperLeg', 'r_lowerLeg', 'r_foot', 'r_toes',
] as const;

/** Normalised vendor name -> canonical bay_rig_v1 bone, for Mixamo-style names (Meshy states these; vendor marketing). */
const MIXAMO: Record<string, (typeof HUMANOID_BONES)[number]> = {
  hips: 'hips', spine: 'spine', spine1: 'chest', spine2: 'upperChest', chest: 'chest', upperchest: 'upperChest', neck: 'neck', head: 'head',
  leftshoulder: 'l_shoulder', leftarm: 'l_upperArm', leftforearm: 'l_lowerArm', lefthand: 'l_hand',
  rightshoulder: 'r_shoulder', rightarm: 'r_upperArm', rightforearm: 'r_lowerArm', righthand: 'r_hand',
  leftupleg: 'l_upperLeg', leftleg: 'l_lowerLeg', leftfoot: 'l_foot', lefttoebase: 'l_toes', lefttoes: 'l_toes',
  rightupleg: 'r_upperLeg', rightleg: 'r_lowerLeg', rightfoot: 'r_foot', righttoebase: 'r_toes', righttoes: 'r_toes',
};

export function normaliseBoneName(name: string): string {
  return name.replace(/^mixamorig[:_]?/i, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

/** Proposed alias table: vendor bone name -> canonical name, plus canonical bones nothing mapped to. */
export function proposeAliases(boneNames: readonly string[]): { aliases: Record<string, string>; unmapped: string[]; missingCanonical: string[] } {
  const aliases: Record<string, string> = {};
  const unmapped: string[] = [];
  for (const n of boneNames) {
    const c = MIXAMO[normaliseBoneName(n)];
    if (c) aliases[n] = c;
    else unmapped.push(n);
  }
  const mapped = new Set(Object.values(aliases));
  return { aliases, unmapped, missingCanonical: HUMANOID_BONES.filter((b) => !mapped.has(b)) };
}

export interface BoneNode { name: string; parent: string | null }

export interface GlbProbe {
  fileSizeBytes: number;
  triangleCount: number;
  meshCount: number;
  skinCount: number;
  jointCount: number;
  bones: BoneNode[];
  hasFingerBones: boolean;
  hasJawBone: boolean;
  hasFaceBones: boolean;
  clips: { name: string; durationS: number }[];
  proposal: ReturnType<typeof proposeAliases>;
}

export function summariseDocument(doc: Document, fileSizeBytes: number): GlbProbe {
  const root = doc.getRoot();
  const parentOf = new Map<unknown, string | null>();
  for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n.getName());
  const jointSet = new Set<unknown>();
  for (const s of root.listSkins()) for (const j of s.listJoints()) jointSet.add(j);
  const bones: BoneNode[] = [...jointSet].map((j) => ({ name: (j as { getName(): string }).getName(), parent: parentOf.get(j) ?? null }));
  let triangles = 0;
  for (const m of root.listMeshes()) {
    for (const p of m.listPrimitives()) {
      if (p.getMode() !== 4) continue;
      const idx = p.getIndices();
      const pos = p.getAttribute('POSITION');
      triangles += Math.floor((idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3);
    }
  }
  const clips = root.listAnimations().map((a) => {
    let end = 0;
    for (const s of a.listSamplers()) {
      const t = s.getInput();
      if (t && t.getCount() > 0) {
        const last = t.getScalar(t.getCount() - 1);
        if (last > end) end = last;
      }
    }
    return { name: a.getName(), durationS: Math.round(end * 1000) / 1000 };
  });
  const names = bones.map((b) => b.name);
  return {
    fileSizeBytes,
    triangleCount: triangles,
    meshCount: root.listMeshes().length,
    skinCount: root.listSkins().length,
    jointCount: bones.length,
    bones,
    hasFingerBones: names.some((n) => /thumb|index|middle|ring|pinky|finger/i.test(n)),
    hasJawBone: names.some((n) => /jaw/i.test(n)),
    hasFaceBones: names.some((n) => /eye|brow|mouth|lip|tongue|cheek|face/i.test(n)),
    clips,
    proposal: proposeAliases(names),
  };
}

export async function probeGlb(bytes: Uint8Array): Promise<GlbProbe> {
  const doc = await new NodeIO().readBinary(bytes);
  return summariseDocument(doc, bytes.length);
}

// ---------------------------------------------------------------------------------------------------------------------
// Crops

export const CROP_ORDER = ['front', 'left', 'back', 'right'] as const;

/**
 * Splits a 4-panel sheet into equal-width panels, each pasted centred onto a square canvas filled with the sheet's
 * top-left pixel colour (the brief demands a flat background). Square crops stay inside the free reference-token
 * allowance of Recipe R.
 */
export function cropPanels(png: Uint8Array, panels = 4): { name: string; png: Buffer; width: number; height: number }[] {
  const src = PNG.sync.read(Buffer.from(png));
  const pw = Math.floor(src.width / panels);
  const side = Math.max(pw, src.height);
  const bg = [src.data[0] ?? 255, src.data[1] ?? 255, src.data[2] ?? 255, 255] as const;
  const out: { name: string; png: Buffer; width: number; height: number }[] = [];
  for (let i = 0; i < panels; i++) {
    const dst = new PNG({ width: side, height: side });
    for (let p = 0; p < side * side; p++) {
      dst.data[p * 4] = bg[0];
      dst.data[p * 4 + 1] = bg[1];
      dst.data[p * 4 + 2] = bg[2];
      dst.data[p * 4 + 3] = 255;
    }
    PNG.bitblt(src, dst, i * pw, 0, pw, src.height, Math.floor((side - pw) / 2), Math.floor((side - src.height) / 2));
    out.push({ name: CROP_ORDER[i] ?? `panel${i}`, png: PNG.sync.write(dst), width: side, height: side });
  }
  return out;
}
