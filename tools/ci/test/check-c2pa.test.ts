import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { checkAll, main, manifestFindings } from '../check-c2pa.ts';
import { useTempDirs } from '../test-tmp.ts';

// BD-FIX-TMP-01: temp folders made here are removed after the last test of this file.
const tempDir = useTempDirs();

const SHA = 'a'.repeat(64);
const good = (over: Record<string, unknown> = {}, licence: Record<string, unknown> = { status: 'cleared' }) => ({
  schema: 'cutscene-asset/1',
  licence: { gate: 'ADR-GENAI-01', ...licence },
  provenance: { endpoint: 'e', pinnedUpdatedAt: '', requestIds: ['r'], origSha256: SHA, c2pa: 'valid-untrusted', resigned: true, aiGenerated: true, ...over },
});

describe('check:c2pa manifest rules (AC-10)', () => {
  it('passes a manifest with the original anchor, the AI flag and, on a cleared licence, the re-sign', () => {
    expect(manifestFindings('k', good())).toEqual([]);
    expect(manifestFindings('k', good({ resigned: false }, { status: 'pending' }))).toEqual([]); // pending: mock output, not shippable anyway
  });

  it('fails a manifest without origSha256', () => {
    expect(manifestFindings('k', good({ origSha256: undefined })).map((f) => f.rule)).toEqual(['orig-sha256-missing']);
    expect(manifestFindings('k', good({ origSha256: 'ABC' })).map((f) => f.rule)).toEqual(['orig-sha256-missing']);
  });

  it('fails a manifest without aiGenerated: true', () => {
    expect(manifestFindings('k', good({ aiGenerated: false })).map((f) => f.rule)).toEqual(['ai-generated-missing']);
    expect(manifestFindings('k', good({ aiGenerated: undefined })).map((f) => f.rule)).toEqual(['ai-generated-missing']);
  });

  it('fails a cleared licence without resigned: true', () => {
    expect(manifestFindings('k', good({ resigned: false })).map((f) => f.rule)).toEqual(['resign-missing']);
    expect(manifestFindings('k', good({ resigned: undefined })).map((f) => f.rule)).toEqual(['resign-missing']);
  });

  it('fails a manifest with no provenance object', () => {
    expect(manifestFindings('k', { schema: 'cutscene-asset/1' }).map((f) => f.rule)).toEqual(['manifest-invalid']);
    expect(manifestFindings('k', null).map((f) => f.rule)).toEqual(['manifest-invalid']);
  });

  it('checks every index entry once and reports an unreadable manifest', () => {
    const index = { schema: 'cutscene-index/1', entries: [{ key: 'one' }, { key: 'two' }, { key: 'one' }] };
    const r = checkAll(index, (k) => {
      if (k === 'two') throw new Error('ENOENT');
      return good();
    });
    expect(r.count).toBe(2);
    expect(r.findings.map((f) => f.rule)).toEqual(['manifest-missing']);
  });
});

describe('check:c2pa command', () => {
  const run = (argv: string[]): { code: number; out: string } => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = main(argv);
    const out = [...log.mock.calls, ...err.mock.calls].map((c) => c.join(' ')).join('\n');
    log.mockRestore();
    err.mockRestore();
    return { code, out };
  };

  it('prints 0 shipped cutscenes and exits 0 when the index is absent (the state of this repository)', () => {
    const r = run([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('0 shipped cutscenes');
  });

  it('passes a shipped index of good manifests and fails one with a bad manifest', () => {
    const dir = tempDir('dv-c2pa-');
    const write = (key: string, m: unknown): void => {
      mkdirSync(path.join(dir, 'm', key), { recursive: true });
      writeFileSync(path.join(dir, 'm', key, 'manifest.json'), JSON.stringify(m));
    };
    write('goodkey', good());
    write('badkey', good({ resigned: false }));
    const idx = (keys: string[]): string => {
      const file = path.join(dir, `index-${keys.join('-')}.json`);
      writeFileSync(file, JSON.stringify({ schema: 'cutscene-index/1', entries: keys.map((key) => ({ key })) }));
      return file;
    };
    const okRun = run(['--index', idx(['goodkey']), '--manifests', path.join(dir, 'm')]);
    expect(okRun.code).toBe(0);
    expect(okRun.out).toContain('1 shipped cutscene');
    const badRun = run(['--index', idx(['goodkey', 'badkey']), '--manifests', path.join(dir, 'm')]);
    expect(badRun.code).toBe(1);
    expect(badRun.out).toContain('resign-missing');
  });

  it('prints the fixture self-test on the default run (M05c3)', () => {
    const r = run([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('check:c2pa fixtures ok: 3');
  });
});

describe('check:c2pa production rules (M05c3 AC-6)', () => {
  const fixtures = path.join(import.meta.dirname, '../fixtures/c2pa');
  const run = (argv: string[]): { code: number; out: string } => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = main(argv);
    const out = [...log.mock.calls, ...err.mock.calls].map((c) => c.join(' ')).join('\n');
    log.mockRestore();
    err.mockRestore();
    return { code, out };
  };

  it('a production manifest needs resigned: true whatever its licence status', () => {
    const m = good({ resigned: false }, { status: 'pending' });
    expect(manifestFindings('k', m)).toEqual([]);
    expect(manifestFindings('k', m, { env: 'prod' }).map((f) => f.rule)).toEqual(['resign-missing']);
    expect(manifestFindings('k', m, { env: 'staging' })).toEqual([]);
    expect(manifestFindings('k', good({}, { status: 'pending' }), { env: 'prod' })).toEqual([]);
  });

  it('fails the unsigned production fixture and the fixture without aiGenerated, and passes the mock prewarm output', () => {
    const manifests = path.join(fixtures, 'manifests');
    const bad = run(['--env', 'prod', '--index', path.join(fixtures, 'index-fail.json'), '--manifests', manifests]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('resign-missing');
    expect(bad.out).toContain('ai-generated-missing');
    const ok = run(['--env', 'prod', '--index', path.join(fixtures, 'index-pass.json'), '--manifests', manifests]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain('1 shipped cutscene');
  });

  it('rejects an unknown --env', () => {
    expect(run(['--env', 'moon']).code).toBe(2);
  });
});
