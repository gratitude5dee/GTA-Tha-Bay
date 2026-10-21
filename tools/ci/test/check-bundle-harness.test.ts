/** M04d AC-9 (scan half): check:bundle finds the QA harness identifiers in a production chunk and wants them in a QA build. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { repoRoot } from '../run.ts';

const tmp: string[] = [];
afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

function dist(js: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dv-harness-'));
  tmp.push(dir);
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
  writeFileSync(path.join(dir, 'sw.js'), 'precacheAndRoute([{url:"index.html",revision:null}])');
  writeFileSync(path.join(dir, 'assets', 'app.js'), js);
  return dir;
}

function bundle(d: string): { status: number | null; out: string } {
  const ids = path.join(dir0(), 'ids.json');
  writeFileSync(ids, JSON.stringify({ ids: ['apps/web/src/main.ts'] }));
  const r = spawnSync(path.join(repoRoot, 'node_modules/.bin/tsx'), ['tools/ci/check-dist.ts', 'bundle', '--dist', d, '--module-ids', ids], { cwd: repoRoot, encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
}

function dir0(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'dv-ids-'));
  tmp.push(d);
  return d;
}

describe('check:bundle QA harness scan (M04d)', () => {
  it('a production chunk with registerBot fails and names it', () => {
    const r = bundle(dist('console.log("registerBot: bot driver already registered")'));
    expect(r.status).toBe(1);
    expect(r.out).toContain('registerBot');
  });

  it('a clean production chunk passes', () => {
    expect(bundle(dist('console.log("hello")')).status).toBe(0);
  });

  it('a QA build (it has __dvBridge) must hold all three identifiers', () => {
    const missing = bundle(dist('window.__dvBridge={}'));
    expect(missing.status).toBe(1);
    expect(missing.out).toContain('the QA build contains the QA harness');
    const full = bundle(dist('window.__dvBridge={};"CanonicalRunner BotDriver registerBot"'));
    expect(full.status).toBe(0);
  });
});
