/**
 * The assets of the roster fighters (M10a2, AC-4 and AC-5): every slot and its stand-in resolve model, base clips, move clips and portrait on
 * all six quality tiers through C07 `resolveVariant`; every move of every kit has a clip in its moves file or a library clip in
 * `content/fighter/clip-fallbacks.json`; a baked `anim/<slug>.moves` has clip names equal to the kit's move ids, the sample count the kit's frame
 * data asks for at the declared fps, and a passing A5 record. No baked file exists until the art lead's clips arrive (Q-24), so the baked-file
 * rules also run on a file the retarget tool bakes from synthetic mannequin clips with the real kit's move ids and frame counts.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FighterDef, RosterEntry } from '@dv/shared/fight';
import { resolveVariant, type AssetManifest } from '../../../shared/src/assets/c07.ts';
import type { RigFamily } from '../../../shared/src/assets/gates/index.ts';
import { VARIANT_FALLBACK, type QualityTierId } from '../../../shared/src/platform/c13.ts';
import rigJson from '../../../shared/src/rig/bay_rig_v1.json';
import { glbJson, inspectMoves, isGraybox, movesOf, totalFrames, type Retarget5 } from '../../../../tools/assets/src/moves-check.ts';
import { retargetReport } from '../../../../tools/assets/src/moves-asset.ts';
import { retargetClips } from '../../../../tools/assets/src/retarget.ts';
import { buildMannequin } from '../../../../tools/assets/test/helpers/mannequin.ts';
import { libraryClipId } from '../src/ui/clips.ts';

const root = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(path.join(root, rel), 'utf8')) as T;
const TIERS = Object.keys(VARIANT_FALLBACK) as QualityTierId[];

interface LockEntry { variants: Record<string, string> }
const lock = readJson<{ entries: Record<string, LockEntry> }>('assets/assets.lock.json').entries;
const roster = readJson<RosterEntry[]>('content/fighter/roster.json');
const fallbacks = readJson<{ shapes: string[]; kits: Record<string, Record<string, string>> }>('content/fighter/clip-fallbacks.json');
const kitOf = (id: string): FighterDef => readJson<FighterDef>(`content/fighter/kits/${id}.json`);
const rig = rigJson as unknown as RigFamily;

/** The manifest a lock entry stands for: enough for `resolveVariant`. */
const manifestOf = (ref: string, e: LockEntry): AssetManifest => {
  const [kind, id] = ref.split('/') as [string, string];
  return { schema: 'asset/1', id, kind, rev: 1, variants: Object.fromEntries(Object.entries(e.variants).map(([v, sha]) => [v, { key: sha, sha256: sha }])) } as unknown as AssetManifest;
};

describe('the four assets of every roster slot and stand-in (AC-4)', () => {
  it('there are eight v1 slots', () => {
    expect(roster.filter((r) => r.v1)).toHaveLength(8);
  });

  for (const r of roster) {
    it(`${r.slot}: model, base clips, move clips and portrait resolve on all six tiers, for the fighter and the stand-in`, () => {
      for (const assets of [r.assets, r.standIn.assets]) {
        for (const k of ['model', 'animBase', 'animMoves', 'portrait'] as const) {
          const ref = assets[k];
          const e = lock[ref];
          expect(e, `${ref} is in the lock`).toBeDefined();
          for (const t of TIERS) expect(() => resolveVariant(manifestOf(ref, e as LockEntry), t), `${ref} on ${t}`).not.toThrow();
        }
      }
    });

    it(`${r.slot}: every move id of the kit has a clip in the moves file or a library clip`, () => {
      const kit = kitOf(r.kit);
      const id = r.assets.animMoves.slice(r.assets.animMoves.indexOf('/') + 1);
      const names = new Set((glbJson(readFileSync(path.join(root, 'assets/src/anim', id, 'default.glb'))).animations ?? []).map((a) => a.name ?? ''));
      const fb = fallbacks.kits[r.kit] ?? {};
      const via: string[] = [];
      for (const m of movesOf(kit)) {
        if (names.has(m.id)) continue;
        const lib = fb[m.id];
        expect(lib, `${r.kit}/${m.id} has a clip or a fallback`).toBeDefined();
        expect(fallbacks.shapes, `${m.id} maps to a library shape`).toContain((lib as string).slice(0, (lib as string).lastIndexOf('.')));
        via.push(m.id);
      }
      // the report lists these moves; the table is the same one the presenter plays
      for (const m of movesOf(kit)) expect(fb[m.id]).toBe(libraryClipId(m));
      expect(via.length).toBeLessThanOrEqual(movesOf(kit).length);
    });
  }

  it('the fallback table has exactly the kits of the roster, and no entry for a move the kit does not have', () => {
    expect(Object.keys(fallbacks.kits).sort()).toEqual(roster.map((r) => r.kit).sort());
    for (const r of roster) expect(Object.keys(fallbacks.kits[r.kit] ?? {}).sort()).toEqual(movesOf(kitOf(r.kit)).map((m) => m.id).sort());
  });
});

describe('a baked anim/<slug>.moves file (AC-5)', () => {
  /** Every roster moves file that is not the gray-box set; empty until the art lead's clips are baked. */
  const baked = roster.flatMap((r) => [r.assets.animMoves, r.standIn.assets.animMoves].filter((ref) => !isGraybox(ref)).map((ref) => ({ r, ref })));

  it('lists the baked files of the roster (none while the clips are the library set)', () => {
    const seen = new Set<string>();
    for (const { r, ref } of baked) {
      if (seen.has(`${r.kit}:${ref}`)) continue;
      seen.add(`${r.kit}:${ref}`);
      const id = ref.slice(ref.indexOf('/') + 1);
      const bytes = new Uint8Array(readFileSync(path.join(root, 'assets/src/anim', id, 'default.glb')));
      const rep = path.join(root, 'assets/src/anim', id, 'retarget.json');
      const found = inspectMoves(bytes, kitOf(r.kit), existsSync(rep) ? (JSON.parse(readFileSync(rep, 'utf8')) as Retarget5) : null);
      expect(found, `${ref}: ${found.map((f) => `${f.rule} ${f.clip}`).join(', ')}`).toEqual([]);
    }
    expect(baked.every(({ ref }) => lock[ref] !== undefined)).toBe(true);
  });

  const kit = kitOf('rap_new_wave');
  const bake = async (fps: 30 | 60, shift?: (name: string, seconds: number) => number) => {
    const clips = movesOf(kit).map((m) => ({ name: m.id, fps: 60, seconds: shift ? shift(m.id, totalFrames(m) / 60) : totalFrames(m) / 60 }));
    const clipsGlb = await buildMannequin({ clipsOnly: true, heightM: 1.75, clips });
    const targetGlb = await buildMannequin({ heightM: 1.72 });
    const r = await retargetClips({ clipsGlb, targetGlb, slug: 'fixture-mc', heightM: 1.72, rig, fps });
    return { r, report: retargetReport('fixture-mc', 'bay_rig_v1', fps, r) };
  };

  it('passes when the clip names are the move ids, the frame counts are the kit total frames at the declared fps and A5 passed, at 60 fps and at 30 fps', async () => {
    for (const fps of [60, 30] as const) {
      const { r, report } = await bake(fps);
      expect(r.findings, `A5 findings at ${fps} fps`).toEqual([]);
      expect(report.a5).toBe('pass');
      const found = inspectMoves(r.glb, kit, report);
      expect(found, found.map((f) => `${f.rule} ${f.clip}: ${f.detail}`).join('\n')).toEqual([]);
      const names = (glbJson(r.glb).animations ?? []).map((a) => a.name);
      expect(names).toEqual(movesOf(kit).map((m) => m.id));
      for (const m of movesOf(kit)) {
        const a = (glbJson(r.glb).animations ?? []).find((x) => x.name === m.id);
        expect(a?.extras?.fps).toBe(fps);
        expect(Math.abs((a?.extras?.frames ?? -9) - (totalFrames(m) * fps) / 60)).toBeLessThanOrEqual(0.5);
        if (fps === 60) expect(a?.extras?.frames).toBe(totalFrames(m));
      }
    }
  }, 120_000);

  it('fails a clip whose length is not the move length, a missing clip, an extra clip and a missing or failed A5 record', async () => {
    const { r, report } = await bake(60, (id, s) => (id === '5M' ? s + 0.2 : s));
    const f = inspectMoves(r.glb, kit, report);
    expect(f.map((x) => `${x.rule}:${x.clip}`)).toContain('frames:5M');
    expect(f.map((x) => `${x.rule}:${x.clip}`)).toContain('duration:5M');

    const good = await bake(60);
    expect(inspectMoves(good.r.glb, kit, null).map((x) => x.rule)).toEqual(['a5-missing']);
    expect(inspectMoves(good.r.glb, kit, { ...good.report, a5: 'fail', clips: good.report.clips.map((c, i) => (i === 0 ? { ...c, status: 'fail' as const } : c)) }).map((x) => x.rule)).toEqual(['a5-fail', 'a5-fail']);
    const fewer: FighterDef = { ...kit, moves: kit.moves.slice(1) };
    expect(inspectMoves(good.r.glb, fewer, good.report).map((x) => `${x.rule}:${x.clip}`)).toEqual([`clip-extra:${kit.moves[0]!.id}`]);
    const more: FighterDef = { ...kit, moves: [...kit.moves, { ...kit.moves[0]!, id: 'newMove' }] };
    expect(inspectMoves(good.r.glb, more, good.report).map((x) => `${x.rule}:${x.clip}`)).toEqual(['clip-missing:newMove']);
  }, 120_000);
});
