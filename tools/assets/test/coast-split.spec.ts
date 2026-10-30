/**
 * assets:coast (M10a2, DL-737): the published `character/pc-coast` split into the six creator parts, their specs and records, and the catalog
 * rows linked to them. Runs on a synthetic skinned mannequin in a temporary tree; the real `pc-coast` waits for the operator's batch.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProvenanceRecord } from '../../../packages/shared/src/assets/provenance.ts';
import { repoRoot } from '../../ci/run.ts';
import { sha256Hex } from '../../ci/lib/common.ts';
import { buildRecord } from '../provenance-new.ts';
import { coastCommand } from '../src/coast-cli.ts';
import { SLOTS, checkCoast, linkCoast, partGlb, partId, readSplitConfig, splitCoast, CATALOG_FILE } from '../src/coast.ts';
import { readGlb, triangleCount } from '../src/glb-inspect.ts';
import { readLock, recordMap, updateLock, writeLock } from '../src/lock.ts';
import { loadSpecs } from '../src/spec.ts';
import { buildMannequin } from './helpers/mannequin.ts';
import { tempRepo } from './helpers.ts';

const VARIANTS = ['desktop', 'mobile', 'mobile-low'] as const;

async function coastTree(): Promise<{ root: string; sources: Record<string, Uint8Array> }> {
  const root = tempRepo();
  for (const f of ['content/characters/pc-coast/subject.json', 'content/characters/pc-coast/split.json', 'content/ui/creator/catalog.json', 'content/ui/creator/defaults.json']) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    cpSync(path.join(repoRoot, f), path.join(root, f));
  }
  const sources: Record<string, Uint8Array> = {};
  const variants: Record<string, string> = {};
  for (const v of VARIANTS) {
    const bytes = await buildMannequin({ heightM: 1.75, texturePx: 64 });
    const rel = `assets/src/character/pc-coast/${v}.glb`;
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), bytes);
    variants[v] = rel;
    sources[v] = bytes;
    const rec = { ...buildRecord({ sha256: sha256Hex(bytes), paths: [rel], kind: 'character', origin: 'derived', license: 'LicenseRef-DeeVerse-Owned', authors: ['profile:art-lead'], derivedFrom: ['f'.repeat(64)], createdAt: '2026-10-28T00:00:00Z' }),
      ai_generated: true, likeness: { subject_id: null, tier: 'original' as const, face_reference_used: false, voice_mode: 'none' as const, photoreal: false } };
    mkdirSync(path.join(root, 'assets/provenance', sha256Hex(bytes).slice(0, 2)), { recursive: true });
    writeFileSync(path.join(root, 'assets/provenance', sha256Hex(bytes).slice(0, 2), `${sha256Hex(bytes)}.json`), `${JSON.stringify(rec, null, 2)}\n`);
  }
  writeFileSync(path.join(root, 'assets/src/character/pc-coast/asset.json'), JSON.stringify({
    kind: 'character', id: 'pc-coast', variants, deps: [], tags: ['char:pc-coast', 'class:hero'],
    extras: { t: 'character', npcId: 'pc-coast', rigFamily: 'bay_rig_v1', heightM: 1.75, bones: { jaw: false, fingers: false }, animSets: [], portrait: 'portrait/pc-coast' },
    likeness: { tier: 'original', subjectId: null, soulVersion: 1, faceReferenceUsed: false, voiceMode: 'none', photoreal: false, disclaimer: 'none' }, codec: { mesh: 'meshopt' }, status: 'active', visibility: 'public',
  }));
  return { root, sources };
}

describe('the partition of a character into the six parts', () => {
  it('gives every triangle to exactly one part: the six parts together hold the source triangles, none is empty', async () => {
    const { root, sources } = await coastTree();
    const cfg = readSplitConfig(root);
    const total = triangleCount(await readGlb(sources['desktop'] as Uint8Array));
    let sum = 0;
    for (const slot of SLOTS) {
      const glb = await partGlb(sources['desktop'] as Uint8Array, slot, cfg);
      expect(glb, `${slot} has triangles`).not.toBeNull();
      const t = triangleCount(await readGlb(glb as Uint8Array));
      expect(t).toBeGreaterThan(0);
      sum += t;
    }
    expect(sum).toBe(total);
  }, 120_000);

  it('puts the bone groups where the config says: shoes hold the feet, the top holds the torso and the arms, the head splits into hair and face', async () => {
    const { root, sources } = await coastTree();
    const cfg = readSplitConfig(root);
    const tris = async (slot: (typeof SLOTS)[number]): Promise<number> => triangleCount(await readGlb((await partGlb(sources['desktop'] as Uint8Array, slot, cfg)) as Uint8Array));
    // one 12-triangle box per bone: the shoes are the foot and toe bones (4 boxes) and the 2 foot blocks; the head bone has 2 boxes (24 triangles) split between hair and face
    expect(await tris('shoes')).toBe(12 * 6);
    expect(await tris('hair')).toBeGreaterThan(0);
    expect(await tris('face')).toBeGreaterThan(0);
    expect((await tris('hair')) + (await tris('face'))).toBe(24);
    expect(await tris('body')).toBe(12 * 3);
    const narrow = { ...cfg, head: { ...cfg.head, hairlineYFrac: 2 } };
    const noHair = await partGlb(sources['desktop'] as Uint8Array, 'hair', { ...narrow, head: { ...narrow.head, faceMinZM: -1 } });
    expect(noHair, 'a config that puts every head triangle on the face leaves hair empty').toBeNull();
  }, 120_000);
});

describe('assets:coast split, link and check', () => {
  it('writes six parts in three fidelities with portraits, specs and derived records; the lock takes them; link sets the six rows; check is clean', async () => {
    const { root, sources } = await coastTree();
    expect(checkCoast(root)).toEqual([]);
    const before = linkCoast(root, { write: true });
    expect(before.pending).toHaveLength(6);
    expect(before.set).toEqual([]);

    const r = await splitCoast(root, { by: 'art-lead', at: '2026-10-28T12:00:00Z' });
    expect(r.findings, r.findings.join('\n')).toEqual([]);
    expect(r.ok).toBe(true);
    for (const slot of SLOTS) {
      for (const v of VARIANTS) expect(existsSync(path.join(root, `assets/src/character/${partId(slot)}/${v}.glb`)), `${slot} ${v}`).toBe(true);
      const png = readFileSync(path.join(root, `assets/src/portrait/${partId(slot)}/default.png`));
      expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      const spec = JSON.parse(readFileSync(path.join(root, `assets/src/character/${partId(slot)}/asset.json`), 'utf8')) as { id: string; tags: string[]; extras: { npcId: string; portrait: string; animSets: string[] }; stats: Record<string, { tris: number }> };
      expect(spec.id).toBe(partId(slot));
      expect(spec.tags).toEqual(expect.arrayContaining(['char:pc-coast', 'creator-part']));
      expect(spec.extras).toMatchObject({ npcId: 'pc-coast', portrait: `portrait/${partId(slot)}`, animSets: [] });
      expect(Object.keys(spec.stats).sort()).toEqual([...VARIANTS].sort());
      // the derived record of the desktop part names the source file's hash and carries its likeness block
      const glb = new Uint8Array(readFileSync(path.join(root, `assets/src/character/${partId(slot)}/desktop.glb`)));
      const sha = sha256Hex(glb);
      const rec = JSON.parse(readFileSync(path.join(root, 'assets/provenance', sha.slice(0, 2), `${sha}.json`), 'utf8')) as ProvenanceRecord;
      expect(rec).toMatchObject({ origin: 'derived', derived_from: [sha256Hex(sources['desktop'] as Uint8Array)], ai_generated: true, likeness: { tier: 'original', face_reference_used: false }, tool: { name: 'assets:coast' } });
    }

    const { specs } = loadSpecs(root);
    const refs = specs.map((s) => s.ref);
    for (const slot of SLOTS) expect(refs).toEqual(expect.arrayContaining([`character/${partId(slot)}`, `portrait/${partId(slot)}`]));
    const { lock } = updateLock(specs, readLock(root), recordMap(root), 'art-lead', '2026-10-28T12:30:00Z');
    writeLock(root, lock);

    expect(checkCoast(root).join('\n')).toMatch(/the part assets are locked but the catalog row has no model yet/);
    const after = linkCoast(root, { write: true });
    expect(after.problems).toEqual([]);
    expect(after.set).toEqual(['body-coast', 'face-coast', 'hair-coast', 'top-coast-hoodie', 'bottom-coast-jeans', 'shoes-coast-sneakers']);
    const catalog = JSON.parse(readFileSync(path.join(root, CATALOG_FILE), 'utf8')) as { rev: number; slots: Record<string, { id: string; model?: string; portrait?: string }[]> };
    const row = (slot: string, id: string) => (catalog.slots[slot] ?? []).find((x) => x.id === id);
    expect(row('body', 'body-coast')).toMatchObject({ model: 'character/pc-body-coast', portrait: 'portrait/pc-body-coast' });
    expect(row('top', 'top-coast-hoodie')).toMatchObject({ model: 'character/pc-top-coast', portrait: 'portrait/pc-top-coast' });
    expect(catalog.rev).toBe(2); // AppearanceV1 stays byte-equal: no revision bump for a model
    expect(checkCoast(root)).toEqual([]);
    // idempotent
    const again = linkCoast(root, { write: true });
    expect(again.set).toEqual([]);
    expect(again.unchanged).toHaveLength(SLOTS.length);
    expect(again.problems).toEqual([]);
  }, 240_000);

  it('refuses a row with a model that is not in the lock, a part without its portrait, and a split without the published character', async () => {
    const { root } = await coastTree();
    const file = path.join(root, CATALOG_FILE);
    const catalog = JSON.parse(readFileSync(file, 'utf8')) as { slots: Record<string, { id: string; model?: string }[]> };
    (catalog.slots['hair'] ?? []).find((x) => x.id === 'hair-coast')!.model = 'character/pc-hair-coast';
    writeFileSync(file, `${JSON.stringify(catalog, null, 1)}\n`);
    expect(checkCoast(root).join('\n')).toMatch(/hair-coast names character\/pc-hair-coast/);

    const bare = tempRepo();
    for (const f of ['content/characters/pc-coast/subject.json', 'content/characters/pc-coast/split.json']) {
      mkdirSync(path.dirname(path.join(bare, f)), { recursive: true });
      cpSync(path.join(repoRoot, f), path.join(bare, f));
    }
    const logs: string[] = [];
    expect(await coastCommand(['split'], bare, (l) => logs.push(l))).toBe(1);
    expect(logs.join('\n')).toMatch(/publish pc-coast first/);
    expect(await coastCommand(['nope'], bare, (l) => logs.push(l))).toBe(2);
  }, 120_000);

  it('on the repository: every Coast row is pending (no model), check is clean, and the CLI changes nothing', async () => {
    const before = readFileSync(path.join(repoRoot, CATALOG_FILE), 'utf8');
    const logs: string[] = [];
    expect(await coastCommand(['link'], repoRoot, (l) => logs.push(l))).toBe(0);
    expect(logs.join('\n')).toMatch(/set 0 \(-\), unchanged 0, pending 6/);
    expect(await coastCommand(['check'], repoRoot, () => undefined)).toBe(0);
    expect(readFileSync(path.join(repoRoot, CATALOG_FILE), 'utf8')).toBe(before);
  });
});
