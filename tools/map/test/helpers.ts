import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { decodeL0, decodeP0, type RenderChunk, type SimChunk } from '../../../packages/shared/src/index.ts';
import { runBake, type BakeResult } from '../src/bake.ts';
import { useTempDirs } from '../../ci/test-tmp.ts';

// BD-FIX-TMP-01: temp folders made here are removed after the last test of this file.
const tempDir = useTempDirs();

export interface ExcerptBake {
  result: BakeResult;
  outDir: string;
  sim: SimChunk[];
  render: RenderChunk[];
  report: Record<string, unknown> & { gates: { id: string; level: string }[]; counts: Record<string, number>; terrain: Record<string, number> };
}

let memo: Promise<ExcerptBake> | null = null;

/** Bakes the committed civic-excerpt once per test file into temporary roots and decodes its packs. */
export function bakeExcerpt(): Promise<ExcerptBake> {
  memo ??= (async () => {
    const root = tempDir('dv-map-test-');
    const result = await runBake({ area: 'civic-excerpt', outRoot: path.join(root, 'world'), cacheRoot: path.join(root, 'cache'), log: () => {}, writeLatest: false });
    const outDir = result.outDir;
    const sim: SimChunk[] = [];
    const render: RenderChunk[] = [];
    for (const name of readdirSync(path.join(outDir, 'packs')).sort()) {
      if (!name.startsWith('p0-')) continue;
      const p0 = decodeP0(readFileSync(path.join(outDir, 'packs', name)));
      sim.push(...p0);
      render.push(...decodeL0(readFileSync(path.join(outDir, 'packs', name.replace('p0-', 'l0-'))), p0));
    }
    const report = JSON.parse(readFileSync(path.join(outDir, 'bake-report.json'), 'utf8')) as ExcerptBake['report'];
    return { result, outDir, sim, render, report };
  })();
  return memo;
}
