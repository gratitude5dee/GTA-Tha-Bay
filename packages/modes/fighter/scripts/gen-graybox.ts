/**
 * `pnpm --filter @dv/mode-fighter fighter:gen-graybox [-- --check]`
 * Writes the gray-box assets of the eight roster slots (M08b1): per slot `character/graybox.<slug>` (a blocky figure in the slot's colours),
 * `portrait/graybox.<slug>` (a flat bust) and `anim/graybox.<slug>-moves` (one clip per move id of the kit, the duration of the move; the
 * poses stay procedural in the presenter until the art lead's clips arrive, Q-24), plus the shared `anim/graybox.fighter-base` and the neutral
 * `character/graybox.standin` and `portrait/graybox.standin`. Each file gets an asset.json and a provenance record (authored, original
 * tier). Then run `pnpm assets:lock` for the lock entries. The bytes are a pure function of the tables, so `--check` can compare them.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { Document, Logger, NodeIO } from '@gltf-transform/core';
import type { FighterDef } from '@dv/shared/fight';
import { args } from '../../../../tools/ci/run.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const GENERATOR = 'dee-verse fighter gray-box';
const CREATED = '2026-10-25T00:00:00Z';

export const SLOT_COLORS: Record<string, [string, string]> = {
  RAP_HYPHY_ELDER: ['#e8873a', '#f6d86b'], RAP_LYRICIST: ['#3f8f6b', '#d9e6df'], RAP_NEW_WAVE: ['#d2467a', '#3ad6c2'], TECH_VISIONARY: ['#2b4a7a', '#c9d6ea'],
  TECH_HACKER: ['#e0c53a', '#2fb7b0'], ATH_SHOOTER: ['#5fd0a5', '#ffffff'], ATH_POWER_BACK: ['#a45a36', '#d8c8ae'], INFLUENCER: ['#ee7766', '#ffd6c9'],
};
const SLOTS = Object.keys(SLOT_COLORS);
export const slugOf = (slot: string): string => slot.toLowerCase().replace(/_/g, '-');

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

class Boxes {
  pos: number[] = []; nor: number[] = []; col: number[] = []; idx: number[] = [];
  box(cx: number, y0: number, cz: number, w: number, h: number, d: number, color: [number, number, number]): void {
    const x0 = cx - w / 2, x1 = cx + w / 2, y1 = y0 + h, z0 = cz - d / 2, z1 = cz + d / 2;
    const c = color.map(lin);
    const faces: [[number, number, number], number[][]][] = [
      [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]], [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
      [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]], [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
      [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]], [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
    ];
    for (const [n, quad] of faces) {
      const base = this.pos.length / 3;
      for (const p of quad) { this.pos.push(...(p as number[])); this.nor.push(...n); this.col.push(...c); }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
}

async function modelGlb(id: string, body: string, trim: string): Promise<Uint8Array> {
  const b = hex(body), t = hex(trim), skin: [number, number, number] = hex('#d9b38c');
  const g = new Boxes();
  g.box(-0.13, 0, 0, 0.16, 0.85, 0.16, t);      // legs
  g.box(0.13, 0, 0, 0.16, 0.85, 0.16, t);
  g.box(0, 0.85, 0, 0.5, 0.65, 0.26, b);        // torso
  g.box(-0.36, 0.85, 0, 0.14, 0.62, 0.14, b);   // arms
  g.box(0.36, 0.85, 0, 0.14, 0.62, 0.14, b);
  g.box(0, 1.5, 0, 0.26, 0.28, 0.26, skin);     // head
  g.box(0, 1.2, 0.135, 0.5, 0.1, 0.02, t);      // sash across the chest
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.SILENT));
  doc.getRoot().getAsset().generator = GENERATOR;
  const buffer = doc.createBuffer('data');
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(g.pos)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(g.nor)).setBuffer(buffer))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(g.col)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint16Array.from(g.idx)).setBuffer(buffer))
    .setMaterial(doc.createMaterial('matte').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.9).setMetallicFactor(0));
  const mesh = doc.createMesh(id).addPrimitive(prim);
  doc.createScene(id).addChild(doc.createNode(id).setMesh(mesh));
  return new NodeIO().writeBinary(doc);
}

async function animGlb(id: string, clips: { name: string; seconds: number }[]): Promise<Uint8Array> {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.SILENT));
  doc.getRoot().getAsset().generator = GENERATOR;
  const buffer = doc.createBuffer('data');
  const node = doc.createNode('root');
  doc.createScene(id).addChild(node);
  for (const c of clips) {
    const input = doc.createAccessor().setType('SCALAR').setArray(Float32Array.from([0, c.seconds])).setBuffer(buffer);
    const output = doc.createAccessor().setType('VEC3').setArray(Float32Array.from([0, 0, 0, 0, 0, 0])).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    const channel = doc.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(sampler);
    doc.createAnimation(c.name).addSampler(sampler).addChannel(channel);
  }
  return new NodeIO().writeBinary(doc);
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
/** A 64 x 64 flat bust: background, shoulders in the body colour, a trim stripe, a head. Stored (level 0) deflate blocks, so the bytes do not depend on zlib. */
function portraitPng(body: string, trim: string): Buffer {
  const S = 64, bg = hex('#26303b').map((c) => Math.round(c * 255)), b = hex(body).map((c) => Math.round(c * 255)), t = hex(trim).map((c) => Math.round(c * 255)), sk = hex('#d9b38c').map((c) => Math.round(c * 255));
  const rows: Buffer[] = [];
  for (let y = 0; y < S; y++) {
    const row = Buffer.alloc(1 + S * 3);
    for (let x = 0; x < S; x++) {
      let c = bg;
      const dx = x - 32;
      if (y >= 40) c = Math.abs(dx) < 26 - (y - 40) / 3 ? (y >= 48 && y < 52 ? t : b) : bg;
      if (Math.hypot(dx, y - 26) < 12) c = sk;
      row.set(c, 1 + x * 3);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}

const BASE_CLIPS = ['idle', 'walkF', 'walkB', 'crouch', 'jump', 'land', 'dashF', 'dashB', 'block', 'check', 'clear', 'hitStand', 'hitCrouch', 'hitAir', 'knockdown', 'wakeup', 'ko', 'intro', 'roundWin', 'roundLose', 'victory', 'defeat'];

interface Out { ref: string; kind: string; id: string; file: string; bytes: Uint8Array; likeness: boolean; extras?: unknown; tags: string[]; deps: string[] }

async function build(): Promise<Out[]> {
  const out: Out[] = [];
  const likeTags = (slug: string): string[] => ['fighter', 'graybox', `char:${slug}`];
  const baseId = 'graybox.fighter-base';
  out.push({ ref: `anim/${baseId}`, kind: 'anim', id: baseId, file: 'default.glb', bytes: await animGlb(baseId, BASE_CLIPS.map((n) => ({ name: n, seconds: 0.5 }))), likeness: true, tags: ['fighter', 'graybox'], deps: [] });
  for (const slot of SLOTS) {
    const slug = slugOf(slot), [body, trim] = SLOT_COLORS[slot] as [string, string];
    const kit = JSON.parse(readFileSync(path.join(root, 'content', 'fighter', 'kits', `${slot.toLowerCase()}.json`), 'utf8')) as FighterDef;
    const movesId = `graybox.${slug}-moves`;
    const moves = [...kit.moves, ...kit.supers, kit.shutdown, kit.taunt];
    out.push({
      ref: `anim/${movesId}`, kind: 'anim', id: movesId, file: 'default.glb', likeness: true, tags: likeTags(slug), deps: [],
      bytes: await animGlb(movesId, moves.map((m) => ({ name: m.id, seconds: (m.startup - 1 + m.active + m.recovery) / 60 }))),
    });
    out.push({ ref: `portrait/graybox.${slug}`, kind: 'portrait', id: `graybox.${slug}`, file: 'default.png', bytes: portraitPng(body, trim), likeness: true, tags: likeTags(slug), deps: [] });
    out.push({
      ref: `character/graybox.${slug}`, kind: 'character', id: `graybox.${slug}`, file: 'default.glb', bytes: await modelGlb(`graybox.${slug}`, body, trim), likeness: true, tags: likeTags(slug),
      deps: [`anim/${baseId}`, `anim/${movesId}`, `portrait/graybox.${slug}`],
      extras: { t: 'character', npcId: slug, rigFamily: 'bay_rig_v1', heightM: 1.78, bones: { jaw: false, fingers: false }, animSets: [`anim/${baseId}`, `anim/${movesId}`], portrait: `portrait/graybox.${slug}` },
    });
  }
  out.push({ ref: 'portrait/graybox.standin', kind: 'portrait', id: 'graybox.standin', file: 'default.png', bytes: portraitPng('#8a939b', '#c4cbd1'), likeness: true, tags: ['fighter', 'graybox', 'char:standin'], deps: [] });
  out.push({
    ref: 'character/graybox.standin', kind: 'character', id: 'graybox.standin', file: 'default.glb', bytes: await modelGlb('graybox.standin', '#8a939b', '#c4cbd1'), likeness: true, tags: ['fighter', 'graybox', 'char:standin'],
    deps: [`anim/${baseId}`, 'portrait/graybox.standin'],
    extras: { t: 'character', npcId: 'standin', rigFamily: 'bay_rig_v1', heightM: 1.78, bones: { jaw: false, fingers: false }, animSets: [`anim/${baseId}`], portrait: 'portrait/graybox.standin' },
  });
  return out;
}

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

async function main(): Promise<void> {
  const check = args().includes('--check');
  let bad = 0;
  for (const o of await build()) {
    const dir = path.join(root, 'assets', 'src', o.kind, o.id);
    const rel = `assets/src/${o.kind}/${o.id}/${o.file}`;
    const hash = sha(o.bytes);
    const spec = {
      kind: o.kind, id: o.id, variants: { default: rel }, deps: o.deps, tags: o.tags,
      ...(o.extras ? { extras: o.extras } : {}),
      likeness: { tier: 'original', subjectId: null, faceReferenceUsed: false, voiceMode: 'none', photoreal: false, disclaimer: 'none' },
      status: 'active', visibility: 'public',
    };
    const rec = {
      ai_generated: false, authors: ['studio:dee-verse'], created_at: CREATED, derived_from: [], ip_checks: { signatures: 'n/a', strings: 'n/a', similarity: 'n/a' }, kind: o.kind,
      license: 'LicenseRef-DeeVerse-Owned', likeness: { subject_id: null, tier: 'original', face_reference_used: false, voice_mode: 'none', photoreal: false },
      origin: 'authored', paths: [rel], review: [], schema: 'provenance/1.0', sha256: hash, status: 'active',
    };
    const files: [string, string | Uint8Array][] = [
      [path.join(dir, o.file), o.bytes], [path.join(dir, 'asset.json'), `${JSON.stringify(spec, null, 2)}\n`],
      [path.join(root, 'assets', 'provenance', hash.slice(0, 2), `${hash}.json`), `${JSON.stringify(rec, null, 2)}\n`],
    ];
    for (const [f, data] of files) {
      if (check) {
        const cur = existsSync(f) ? readFileSync(f) : null;
        const want = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
        if (cur === null || !cur.equals(want)) { console.error(`gen-graybox: ${path.relative(root, f)} differs`); bad++; }
      } else {
        mkdirSync(path.dirname(f), { recursive: true });
        writeFileSync(f, data);
      }
    }
  }
  if (bad > 0) process.exit(1);
  if (!check) console.log('wrote the gray-box fighter assets; now run pnpm assets:lock');
}
void main();
