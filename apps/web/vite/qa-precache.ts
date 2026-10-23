import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * QA builds only: keeps the chunks that only QA code loads out of the service worker's precache (BD-FIX-CI7-D04).
 *
 * `globIgnores: ['qa/**']` keeps the QA pages out, but the code a QA build adds (the QA page entries, every `__dvBridge`, the debug
 * panels, the QA modes of the sim worker, the workers the QA pages start) is split into ordinary `assets/<name>-<hash>.js` chunks, so a
 * QA build precached 175 entries (11.5 MB) where a production build precaches 71. Which chunks those are follows from the bundle
 * graphs: a chunk is precached when a player's page can load it, that is when it is reachable from a non-QA entry (the app, the account
 * island, the workers they start) through static imports and through dynamic imports other than the QA ones. QA code only ever loads
 * its modules behind `import.meta.env.VITE_DV_QA === '1'` (the literal comparison production builds drop); the dynamic-import targets of
 * those branches match {@link QA_IMPORT_ROOTS}. A production build is not touched: the filter is installed only when `VITE_DV_QA=1`.
 */

/** Repository-relative module ids of the dynamic-import targets that only QA branches load. */
export const QA_IMPORT_ROOTS: readonly RegExp[] = [
  /^apps\/web\/(src\/)?qa\//, // the QA pages, panels and bridges of the app
  /\/src\/(.+\/)?(qa|debug)\//, // the packages' qa/ and debug/ folders (racing, tycoon, story, npc, engine)
  /\/src\/(.+\/)?(qa|debug)\.ts$/, // sim/modes/qa.ts, sim/pursuit/qa.ts, sim/vehicle/debug.ts
  /^packages\/ui\/src\/screen\/xr-qa\.ts$/,
  /^packages\/engine\/src\/assets\/(bridge|qa-ops)\.ts$/,
  /^packages\/engine\/src\/platform\/probe\.ts$/, // installs the IWER emulator (`?xr=emulate`)
  /^packages\/engine\/src\/client\/xr\/(smoke|panels)\.ts$/,
  /^packages\/engine\/src\/sim\/input\/bot-input\.ts$/,
  /^packages\/engine\/src\/sim\/lines\//,
  /^packages\/world\/src\/client\/world-bridge\.ts$/,
];

/** What the filter needs of one output chunk. */
export interface ChunkNode {
  file: string;
  entry: boolean;
  /** Repository-relative facade module id, or null. */
  facade: string | null;
  imports: readonly string[];
  dynamicImports: readonly string[];
  /** CSS and asset files the chunk imports (Vite's `viteMetadata`). */
  assets: readonly string[];
  /** Files of other bundles the chunk's code names (a worker's entry file, `new Worker(new URL(...))`). */
  code: string;
  /** Repository-relative ids of the modules in the chunk (for the report). */
  modules?: readonly string[];
}

/** One Rollup bundle: the app's (`main`) or one worker's. */
export interface BundleGraph {
  main: boolean;
  chunks: readonly ChunkNode[];
}

/**
 * The output files only QA code loads. Roots: the app's non-QA entries (facade not under `apps/web/qa/`); a worker bundle joins when a
 * reachable chunk names its entry file. Edges: static imports always, dynamic imports unless the target's facade is a QA import root.
 * A file is QA-only when it is in some bundle and reachable in none; a CSS or asset file when only unreachable chunks import it.
 */
export function qaOnlyFiles(graphs: readonly BundleGraph[], isQaRoot: (moduleId: string) => boolean = isQaImportRoot): Set<string> {
  return reach(graphs, isQaRoot).qaOnly;
}

/** A module id that matches {@link QA_IMPORT_ROOTS}. */
export function isQaImportRoot(moduleId: string): boolean {
  return QA_IMPORT_ROOTS.some((r) => r.test(moduleId));
}

/** {@link qaOnlyFiles}, plus for each reachable chunk the chunk it was first reached from (null for a root), for the build report. */
export function reach(graphs: readonly BundleGraph[], isQaRoot: (moduleId: string) => boolean = isQaImportRoot): { qaOnly: Set<string>; via: Map<string, string | null> } {
  const byFile = new Map<string, ChunkNode[]>();
  for (const g of graphs) for (const c of g.chunks) byFile.set(c.file, [...(byFile.get(c.file) ?? []), c]);
  const workerEntries = graphs.filter((g) => !g.main).flatMap((g) => g.chunks.filter((c) => c.entry));
  const via = new Map<string, string | null>();
  const queue: { c: ChunkNode; from: string | null }[] = graphs
    .filter((g) => g.main)
    .flatMap((g) => g.chunks.filter((c) => c.entry && !(c.facade ?? '').startsWith('apps/web/qa/')).map((c) => ({ c, from: null })));
  const visit = (file: string, from: string): void => {
    for (const c of byFile.get(file) ?? []) queue.push({ c, from });
  };
  while (queue.length > 0) {
    const { c, from } = queue.pop() as { c: ChunkNode; from: string | null };
    if (via.has(c.file)) continue;
    via.set(c.file, from);
    for (const f of c.imports) visit(f, c.file);
    for (const f of c.dynamicImports) {
      const target = byFile.get(f)?.[0];
      if (target?.facade && isQaRoot(target.facade)) continue;
      visit(f, c.file);
    }
    for (const w of workerEntries) if (!via.has(w.file) && c.code.includes(path.posix.basename(w.file))) queue.push({ c: w, from: c.file });
  }
  const used = new Set<string>();
  const assets = new Set<string>();
  for (const g of graphs)
    for (const c of g.chunks)
      for (const a of c.assets) {
        assets.add(a);
        if (via.has(c.file)) used.add(a);
      }
  const qaOnly = new Set<string>();
  for (const f of byFile.keys()) if (!via.has(f)) qaOnly.add(f);
  for (const a of assets) if (!used.has(a)) qaOnly.add(a);
  return { qaOnly, via };
}

/** The precache entry shape of workbox-build's `manifestTransforms` (the fields this filter reads and returns). */
interface ManifestEntry {
  url: string;
  revision: string | null;
  size: number;
}

/**
 * The collector plugins (one for the app's bundle, one per worker bundle) and the `manifestTransforms` step that drops the QA-only
 * files. The transform runs when vite-plugin-pwa injects the manifest, after every bundle is written.
 */
export function qaPrecache(repoRoot: string, report?: string): {
  main: () => Plugin;
  worker: () => Plugin;
  transform: (entries: ManifestEntry[]) => { manifest: ManifestEntry[]; warnings: string[] };
  dropped: () => readonly string[];
} {
  const graphs: BundleGraph[] = [];
  let dropped: string[] = [];
  const rel = (id: string | null): string | null => {
    if (id === null) return null;
    const clean = id.replace(/^\0/, '').split('?')[0] as string;
    return path.isAbsolute(clean) ? path.relative(repoRoot, clean).split(path.sep).join('/') : clean;
  };
  const collect = (main: boolean): Plugin => ({
    name: main ? 'dv-qa-precache' : 'dv-qa-precache-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks: ChunkNode[] = [];
      for (const out of Object.values(bundle)) {
        if (out.type !== 'chunk') continue;
        const meta = (out as { viteMetadata?: { importedCss?: Set<string>; importedAssets?: Set<string> } }).viteMetadata;
        chunks.push({
          file: out.fileName,
          entry: out.isEntry,
          facade: rel(out.facadeModuleId),
          imports: out.imports,
          dynamicImports: out.dynamicImports,
          assets: [...(meta?.importedCss ?? []), ...(meta?.importedAssets ?? [])],
          code: out.code,
          modules: out.moduleIds.map((id) => rel(id) as string),
        });
      }
      graphs.push({ main, chunks });
    },
  });
  return {
    main: () => collect(true),
    worker: () => collect(false),
    transform(entries) {
      const { qaOnly, via } = reach(graphs);
      const keep = entries.filter((e) => !qaOnly.has(e.url));
      dropped = entries.filter((e) => qaOnly.has(e.url)).map((e) => e.url);
      if (report !== undefined) {
        // Outside dist/ and never deployed, like module-ids.json: what was left out and which modules those chunks hold, and for each
        // precached chunk the chunk that loads it (why it is kept).
        const modules = new Map<string, readonly string[]>();
        for (const g of graphs) for (const c of g.chunks) modules.set(c.file, c.modules ?? []);
        mkdirSync(path.dirname(report), { recursive: true });
        writeFileSync(report, `${JSON.stringify({ schema: 'qa-precache/1', kept: keep.length, dropped: dropped.map((file) => ({ file, modules: modules.get(file) ?? [] })), via: Object.fromEntries(keep.filter((e) => via.has(e.url)).map((e) => [e.url, via.get(e.url)])) }, null, 1)}\n`);
      }
      return { manifest: keep, warnings: [] };
    },
    dropped: () => dropped,
  };
}
