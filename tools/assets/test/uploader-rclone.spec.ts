/**
 * M05c4: the single-object operations of the rclone uploader (`copyto` both ways, `cat`, `lsf`) over a stub runner. The existing per-class
 * `copy` of `assets:publish` is covered by publish.spec.ts and stays unchanged.
 */
import { describe, expect, it } from 'vitest';
import { createRcloneUploader, type RunResult, type Runner } from '../src/uploader-rclone.ts';

const ENV = { R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'secret', CLOUDFLARE_ACCOUNT_ID: 'acct' };

function uploader(answer: (args: string[]) => RunResult): { up: ReturnType<typeof createRcloneUploader>; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = (_cmd, args) => (calls.push(args), answer(args));
  return { up: createRcloneUploader({ bucket: 'tha-bay-private-staging', env: ENV, run }), calls };
}

const ok = (stdout = ''): RunResult => ({ status: 0, stdout, stderr: '' });

describe('rclone remote files (M05c4)', () => {
  it('download and putFile are copyto in the two directions; putFile sets the headers it is given', () => {
    const { up, calls } = uploader(() => ok());
    up.download('cutscenes-orig/k/orig.mp4', '/tmp/x/orig.mp4');
    up.putFile('/tmp/x/finish.json', 'cutscenes-orig/k/finish.json', { contentType: 'application/json', cacheControl: 'no-store' });
    expect(calls[0]).toEqual(['copyto', 'r2:tha-bay-private-staging/cutscenes-orig/k/orig.mp4', '/tmp/x/orig.mp4', '--no-traverse']);
    expect(calls[1]).toEqual(['copyto', '/tmp/x/finish.json', 'r2:tha-bay-private-staging/cutscenes-orig/k/finish.json', '--no-traverse', '--header-upload', 'Cache-Control: no-store', '--header-upload', 'Content-Type: application/json']);
    // an existing object is replaced: no --immutable and no --ignore-existing
    expect(calls.flat()).not.toContain('--immutable');
    expect(calls.flat()).not.toContain('--ignore-existing');
  });

  it('a failed copy throws with the exit code', () => {
    const { up } = uploader(() => ({ status: 1, stdout: '', stderr: 'boom\nAccessDenied' }));
    expect(() => up.download('a', '/tmp/a')).toThrow(/rclone copyto a failed with exit 1: .*AccessDenied/);
    expect(() => up.putFile('/tmp/a', 'a')).toThrow(/failed with exit 1/);
  });

  it('readJson parses cat, answers null for a missing object and throws otherwise', () => {
    expect(uploader(() => ok('{"a":1}')).up.readJson('k.json')).toEqual({ a: 1 });
    expect(uploader(() => ({ status: 3, stdout: '', stderr: 'directory not found' })).up.readJson('k.json')).toBeNull();
    expect(uploader(() => ({ status: 1, stdout: '', stderr: 'Failed to cat: object not found' })).up.readJson('k.json')).toBeNull();
    expect(() => uploader(() => ({ status: 1, stdout: '', stderr: 'AccessDenied' })).up.readJson('k.json')).toThrow(/failed with exit 1/);
    expect(() => uploader(() => ok('not json')).up.readJson('k.json')).toThrow(/is not JSON/);
  });

  it('list is a recursive files-only lsf of the prefix; a missing prefix is empty', () => {
    const a = uploader(() => ok('k/handoff.json\nk/orig.mp4\n\n'));
    expect(a.up.list('cutscenes-orig/')).toEqual(['k/handoff.json', 'k/orig.mp4']);
    expect(a.calls[0]).toEqual(['lsf', '-R', '--files-only', 'r2:tha-bay-private-staging/cutscenes-orig/']);
    expect(uploader(() => ({ status: 3, stdout: '', stderr: 'directory not found' })).up.list('nope/')).toEqual([]);
    expect(() => uploader(() => ({ status: 1, stdout: '', stderr: 'AccessDenied' })).up.list('x/')).toThrow(/failed with exit 1/);
  });
});
