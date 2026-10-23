/**
 * BD-FIX-CI7-D04: a QA build precaches what a player's page of that build can load, and none of the chunks that only QA code loads.
 * The filter reads the bundle graphs (the app's and one per worker) that the collector plugins record; these graphs are hand-made.
 */
import { describe, expect, it } from 'vitest';
import { isQaImportRoot, qaOnlyFiles, qaPrecache, type BundleGraph, type ChunkNode } from '../vite/qa-precache.ts';

const chunk = (file: string, over: Partial<ChunkNode> = {}): ChunkNode => ({ file, entry: false, facade: null, imports: [], dynamicImports: [], assets: [], code: '', ...over });

/** The shape of a QA build: the app entry, a lazy page, the QA bridges, a QA page and its own worker, the app's worker. */
function qaBuild(): BundleGraph[] {
  return [
    {
      main: true,
      chunks: [
        chunk('assets/main-A.js', {
          entry: true,
          facade: 'apps/web/index.html',
          imports: ['assets/shell-A.js'],
          dynamicImports: ['assets/page-saves-A.js', 'assets/bridge-A.js', 'assets/missions-A.js'],
          assets: ['assets/main-A.css'],
          code: 'new Worker(new URL("/assets/sim.worker-A.js", import.meta.url))',
        }),
        chunk('assets/shell-A.js', { assets: ['assets/shell-A.css'] }),
        chunk('assets/page-saves-A.js', { facade: 'packages/ui/src/pages/saves.tsx', imports: ['assets/shell-A.js'] }),
        // QA branches: `import('@dv/engine/client/debug/bridge')` and `import('./qa/missions.ts')`, and what only they import
        chunk('assets/bridge-A.js', { facade: 'packages/engine/src/client/debug/bridge.ts', imports: ['assets/inspector-A.js', 'assets/shell-A.js'], assets: ['assets/debug-A.css'] }),
        chunk('assets/inspector-A.js'),
        chunk('assets/missions-A.js', { facade: 'apps/web/src/qa/missions.ts' }),
        // a QA page: its entry and the worker only it starts
        chunk('assets/qa/determinism-A.js', { entry: true, facade: 'apps/web/qa/determinism.html', imports: ['assets/shell-A.js'], code: '"/assets/sim.worker-Q.js"' }),
        chunk('assets/account-A.js', { entry: true, facade: 'apps/web/account/index.html' }),
      ],
    },
    {
      main: false,
      chunks: [
        chunk('assets/sim.worker-A.js', { entry: true, facade: 'apps/web/src/workers/sim.worker.ts', imports: ['assets/sim-A.js'], dynamicImports: ['assets/save-A.js', 'assets/qa-ops-A.js'] }),
        chunk('assets/sim-A.js'),
        chunk('assets/save-A.js', { facade: 'packages/engine/src/sim/save/index.ts' }),
        chunk('assets/qa-ops-A.js', { facade: 'packages/engine/src/sim/modes/qa.ts' }),
      ],
    },
    {
      main: false,
      chunks: [chunk('assets/sim.worker-Q.js', { entry: true, facade: 'apps/web/src/workers/sim.worker.ts', imports: ['assets/sim-Q.js'] }), chunk('assets/sim-Q.js')],
    },
  ];
}

describe('the QA-only files of a QA build', () => {
  it('are the QA branches, the QA pages and the workers only they start, with what only they import', () => {
    expect([...qaOnlyFiles(qaBuild())].sort()).toEqual(
      ['assets/bridge-A.js', 'assets/debug-A.css', 'assets/inspector-A.js', 'assets/missions-A.js', 'assets/qa-ops-A.js', 'assets/qa/determinism-A.js', 'assets/sim-Q.js', 'assets/sim.worker-Q.js'].sort(),
    );
  });

  it('keep everything a player page loads: entries, static imports, lazy pages, the app worker and its lazy chunks, shared CSS', () => {
    const qaOnly = qaOnlyFiles(qaBuild());
    for (const f of ['assets/main-A.js', 'assets/shell-A.js', 'assets/shell-A.css', 'assets/main-A.css', 'assets/page-saves-A.js', 'assets/account-A.js', 'assets/sim.worker-A.js', 'assets/sim-A.js', 'assets/save-A.js']) {
      expect(qaOnly.has(f), f).toBe(false);
    }
  });

  it('a chunk that a player page also imports statically stays, even when a QA chunk imports it too', () => {
    const graphs = qaBuild();
    (graphs[0]!.chunks[0] as { imports: string[] }).imports = ['assets/shell-A.js', 'assets/inspector-A.js'];
    expect(qaOnlyFiles(graphs).has('assets/inspector-A.js')).toBe(false);
  });

  it('the import roots name QA modules only, not their production neighbours', () => {
    for (const id of ['apps/web/src/qa/npc.ts', 'apps/web/qa/determinism.html', 'packages/engine/src/client/debug/bridge.ts', 'packages/modes/racing/src/qa/bridge.ts', 'packages/engine/src/sim/pursuit/qa.ts', 'packages/engine/src/sim/vehicle/debug.ts', 'packages/ui/src/screen/xr-qa.ts', 'packages/engine/src/platform/probe.ts', 'packages/world/src/client/world-bridge.ts']) {
      expect(isQaImportRoot(id), id).toBe(true);
    }
    for (const id of ['packages/engine/src/sim/save/index.ts', 'packages/engine/src/platform/perf/probe.ts', 'packages/engine/src/platform/benchmark.ts', 'packages/engine/src/platform/renderer-host.ts', 'packages/engine/src/sim/ui/bridge.ts', 'packages/ui/src/pages/saves.tsx', 'packages/npc/src/voice/index.ts']) {
      expect(isQaImportRoot(id), id).toBe(false);
    }
  });
});

describe('the manifest transform', () => {
  it('drops the QA-only entries and keeps the rest in order', () => {
    const f = qaPrecache('/repo');
    // feed the recorded graphs the way the collector plugins do
    const main = f.main() as unknown as { generateBundle(o: unknown, b: Record<string, unknown>): void };
    const bundle = (chunks: ChunkNode[]): Record<string, unknown> =>
      Object.fromEntries(chunks.map((c) => [c.file, { type: 'chunk', fileName: c.file, isEntry: c.entry, facadeModuleId: c.facade ? `/repo/${c.facade}` : null, imports: c.imports, dynamicImports: c.dynamicImports, code: c.code, moduleIds: [], viteMetadata: { importedCss: new Set(c.assets), importedAssets: new Set() } }]));
    const [app, worker, qaWorker] = qaBuild();
    main.generateBundle({}, bundle([...app!.chunks]));
    (f.worker() as unknown as typeof main).generateBundle({}, bundle([...worker!.chunks]));
    (f.worker() as unknown as typeof main).generateBundle({}, bundle([...qaWorker!.chunks]));
    const entries = ['index.html', 'assets/main-A.js', 'assets/bridge-A.js', 'assets/sim.worker-A.js', 'assets/sim.worker-Q.js', 'assets/debug-A.css', 'assets/shell-A.css'].map((url) => ({ url, revision: null, size: 1 }));
    expect(f.transform(entries).manifest.map((e) => e.url)).toEqual(['index.html', 'assets/main-A.js', 'assets/sim.worker-A.js', 'assets/shell-A.css']);
    expect(f.dropped()).toEqual(['assets/bridge-A.js', 'assets/sim.worker-Q.js', 'assets/debug-A.css']);
  });
});
