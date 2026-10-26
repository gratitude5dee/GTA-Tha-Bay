/**
 * Temp folders for Vitest specs that remove themselves (BD-FIX-TMP-01).
 *
 * The per-run root (tools/ci/tmp-root.ts) guarantees that nothing outlives a run; this keeps a single long run small. Call
 * `useTempDirs()` once at the top level of a spec file or of a helper module the spec imports (it registers an afterAll hook, so it must
 * run while Vitest collects the file), then make folders with the function it returns: they are removed after the file's last test.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

export type MakeTempDir = (prefix: string) => string;

export function useTempDirs(): MakeTempDir {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  return (prefix) => {
    const d = mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(d);
    return d;
  };
}
