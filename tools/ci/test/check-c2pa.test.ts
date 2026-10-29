import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  const run = async (argv: string[]): Promise<{ code: number; out: string }> => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await main(argv);
    const out = [...log.mock.calls, ...err.mock.calls].map((c) => c.join(' ')).join('\n');
    log.mockRestore();
    err.mockRestore();
    return { code, out };
  };

  it('prints 0 shipped cutscenes and exits 0 when the index is absent (the state of this repository)', async () => {
    const r = await run([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('0 shipped cutscenes');
  });

  it('passes a shipped index of good manifests and fails one with a bad manifest', async () => {
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
    const okRun = await run(['--index', idx(['goodkey']), '--manifests', path.join(dir, 'm')]);
    expect(okRun.code).toBe(0);
    expect(okRun.out).toContain('1 shipped cutscene');
    const badRun = await run(['--index', idx(['goodkey', 'badkey']), '--manifests', path.join(dir, 'm')]);
    expect(badRun.code).toBe(1);
    expect(badRun.out).toContain('resign-missing');
  });

  it('prints the fixture self-test on the default run (M05c3)', async () => {
    const r = await run([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('check:c2pa fixtures ok: 3');
  });
});

describe('check:c2pa production rules (M05c3 AC-6)', () => {
  const fixtures = path.join(import.meta.dirname, '../fixtures/c2pa');
  const run = async (argv: string[]): Promise<{ code: number; out: string }> => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await main(argv);
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

  it('fails the unsigned production fixture and the fixture without aiGenerated, and passes the mock prewarm output', async () => {
    const manifests = path.join(fixtures, 'manifests');
    const bad = await run(['--env', 'prod', '--index', path.join(fixtures, 'index-fail.json'), '--manifests', manifests]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('resign-missing');
    expect(bad.out).toContain('ai-generated-missing');
    const ok = await run(['--env', 'prod', '--index', path.join(fixtures, 'index-pass.json'), '--manifests', manifests]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain('1 shipped cutscene');
  });

  it('rejects an unknown --env', async () => {
    expect((await run(['--env', 'moon'])).code).toBe(2);
  });
});

describe('check:c2pa strict index and signature verification (M05c4 AC-7)', () => {
  const fixtureDir = path.join(import.meta.dirname, '../../../services/pipeline/fixtures/cutscene');
  const run = async (argv: string[]): Promise<{ code: number; out: string }> => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await main(argv);
    const out = [...log.mock.calls, ...err.mock.calls].map((c) => c.join(' ')).join('\n');
    log.mockRestore();
    err.mockRestore();
    return { code, out };
  };

  /** The same file with its C2PA manifest box (a top-level `uuid` box with the C2PA extended type) turned into a `free` box. */
  function stripC2pa(buf: Buffer): Buffer {
    const out = Buffer.from(buf);
    const C2PA_UUID = Buffer.from('d8fec3d61b0e483c92975828877ec481', 'hex');
    let at = 0;
    let stripped = 0;
    while (at + 8 <= out.length) {
      let size = out.readUInt32BE(at);
      if (size === 1) size = Number(out.readBigUInt64BE(at + 8));
      if (size === 0) size = out.length - at;
      if (out.toString('latin1', at + 4, at + 8) === 'uuid' && out.subarray(at + 8, at + 24).equals(C2PA_UUID)) {
        out.write('free', at + 4, 'latin1');
        stripped++;
      }
      if (size < 8) break;
      at += size;
    }
    expect(stripped).toBeGreaterThan(0); // the fixture really carried a manifest box
    return out;
  }

  function release(dir: string, key: string, files: Record<string, Buffer>): { index: string; manifests: string } {
    const m = path.join(dir, 'm');
    mkdirSync(path.join(m, key), { recursive: true });
    for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(m, key, name), bytes);
    const renditions = Object.fromEntries(Object.keys(files).filter((f) => f.endsWith('.mp4')).map((f) => [f.replace('.mp4', ''), { file: f }]));
    writeFileSync(path.join(m, key, 'manifest.json'), JSON.stringify({ ...good(), renditions }));
    const index = path.join(dir, `index-${key}.json`);
    writeFileSync(index, JSON.stringify({ schema: 'cutscene-index/1', entries: [{ key }] }));
    return { index, manifests: m };
  }

  it('an explicit --index that does not exist, or has no entries, fails; the default keeps its pass', async () => {
    const dir = tempDir('dv-c2pa-strict-');
    const missing = await run(['--index', path.join(dir, 'nope.json'), '--manifests', dir]);
    expect(missing.code).toBe(1);
    expect(missing.out).toContain('does not exist');
    const empty = path.join(dir, 'empty.json');
    writeFileSync(empty, JSON.stringify({ schema: 'cutscene-index/1', entries: [] }));
    const none = await run(['--index', empty, '--manifests', dir]);
    expect(none.code).toBe(1);
    expect(none.out).toContain('has no entries');
    const dflt = await run([]);
    expect(dflt.code).toBe(0);
    expect(dflt.out).toContain('0 shipped cutscenes');
  });

  it('--verify-signatures passes the signed fixture renditions and fails a copy with its C2PA manifest stripped', async () => {
    const dir = tempDir('dv-c2pa-sig-');
    const v768 = readFileSync(path.join(fixtureDir, 'v768.mp4'));
    const v540 = readFileSync(path.join(fixtureDir, 'v540.mp4'));
    const signed = release(dir, 'signed', { 'v768.mp4': v768, 'v540.mp4': v540 });
    const ok = await run(['--index', signed.index, '--manifests', signed.manifests, '--verify-signatures']);
    expect(ok.out).toContain('check:c2pa ok: 1 shipped cutscene(s)');
    expect(ok.code).toBe(0);

    const stripped = release(dir, 'stripped', { 'v768.mp4': stripC2pa(v768), 'v540.mp4': v540 });
    const fail = await run(['--index', stripped.index, '--manifests', stripped.manifests, '--verify-signatures']);
    expect(fail.code).toBe(1);
    expect(fail.out).toContain('signature-invalid');
    expect(fail.out).toContain('v768.mp4: no active C2PA manifest');
    expect(fail.out).not.toContain('v540.mp4:');

    // without the flag the same release passes the manifest rules: the signature read is opt-in
    expect((await run(['--index', stripped.index, '--manifests', stripped.manifests])).code).toBe(0);
  });
});
