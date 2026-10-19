/** M00f AC-3 (bundle half): check:bundle fails when a bundled module id resolves under third_party/. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
type OutputBundle = Record<string, { type: string; moduleIds?: string[] }>;
import { afterAll, describe, expect, it } from 'vitest';
import { moduleIds } from '../../../apps/web/vite/module-ids.ts';
import { checkModuleIds } from '../lib/module-ids.ts';
import { repoRoot } from '../run.ts';
import { buildCase, cleanupCases, CODE_PATH, ENTRY } from './third-party-fixtures.ts';

const tmp: string[] = [];
afterAll(() => {
  cleanupCases();
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

function stubDist(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dv-dist-'));
  tmp.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
  writeFileSync(path.join(dir, 'sw.js'), 'precacheAndRoute([{url:"index.html",revision:null}])');
  return dir;
}

function bundleMode(idsFile: string) {
  const bin = path.join(repoRoot, 'node_modules/.bin/tsx');
  return spawnSync(bin, ['tools/ci/check-dist.ts', 'bundle', '--dist', stubDist(), '--module-ids', idsFile], { cwd: repoRoot, encoding: 'utf8' });
}

describe('check:bundle third_party rule (M00f)', () => {
  it('module-ids-third-party: fails and names the id', () => {
    const c = buildCase('module-ids-third-party');
    const r = bundleMode(c.moduleIdsFile!);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`third_party/${ENTRY}/${CODE_PATH}`);
  });

  it('module-ids-worker: an id reached only from a Web Worker entry is merged into the file and fails', () => {
    const c = buildCase('clean');
    const web = path.join(c.root, 'apps/web');
    const main = moduleIds(web, c.root, true);
    const worker = moduleIds(web, c.root, false);
    const chunk = (ids: string[]): OutputBundle => ({ 'a.js': { type: 'chunk', moduleIds: ids } as OutputBundle[string] });
    const call = (p: ReturnType<typeof moduleIds>, hook: 'buildStart' | 'generateBundle', arg?: OutputBundle): void => {
      const h = p[hook] as unknown as { call?: (...a: unknown[]) => void } | ((...a: unknown[]) => void);
      (typeof h === 'function' ? h : (h.call as (...a: unknown[]) => void)).call({}, {}, arg);
    };
    call(main, 'buildStart');
    call(worker, 'generateBundle', chunk([path.join(c.root, 'third_party', ENTRY, CODE_PATH) + '?worker_file']));
    call(main, 'generateBundle', chunk([path.join(c.root, 'apps/web/src/main.ts')]));
    const file = path.join(web, '.dv-build/module-ids.json');
    const ids = (JSON.parse(readFileSync(file, 'utf8')) as { ids: string[] }).ids;
    expect(ids).toContain(`third_party/${ENTRY}/${CODE_PATH}`);
    expect(ids).toContain('apps/web/src/main.ts');
    expect(checkModuleIds(c.root, file).join('\n')).toContain('third_party/');
    // A later main build starts clean.
    call(main, 'buildStart');
    expect(checkModuleIds(c.root, file)).toEqual([]);
  });

  it('fails when the file is missing, passes when no id is under third_party/', () => {
    const c = buildCase('clean');
    expect(checkModuleIds(c.root, path.join(c.root, 'nope.json')).join('')).toContain('missing');
    const ok = path.join(c.root, 'ok.json');
    writeFileSync(ok, JSON.stringify({ ids: ['apps/web/src/main.ts', 'node_modules/three/build/three.js'] }));
    expect(checkModuleIds(c.root, ok)).toEqual([]);
    const r = bundleMode(ok);
    expect(r.status).toBe(0);
  });
});
