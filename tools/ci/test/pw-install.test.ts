import { describe, expect, it } from 'vitest';
import {
  APT_CONF,
  ATTEMPT_S,
  DOWNLOAD_ONLY_CONF,
  ISO_WEEK,
  MIRRORS,
  aptConf,
  cacheKey,
  composeCommand,
  countNew,
  install,
  main,
  osRelease,
  rotateMirrors,
  type Host,
  type InstallPlan,
} from '../pw-install.ts';

// The runner image's list, as actions/runner-images configure-apt-sources.sh writes it.
const RUNNER_MIRRORS = 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n';

describe('pw-install pure parts (BD-FIX-CI10-P01)', () => {
  it('points apt at the cache directory with retries and a stall timeout', () => {
    expect(aptConf('/home/runner/.cache/dv-pw-apt')).toBe(
      'Dir::Cache::archives "/home/runner/.cache/dv-pw-apt/";\nAcquire::Retries "5";\nAcquire::http::Timeout "30";\n',
    );
  });

  it('rotates the runner mirror list so archive.ubuntu.com is tried first and renumbers the priorities', () => {
    expect(rotateMirrors(RUNNER_MIRRORS)).toBe(
      'https://archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://security.ubuntu.com/ubuntu/\tpriority:2\nhttp://azure.archive.ubuntu.com/ubuntu/\tpriority:3\n',
    );
    expect(rotateMirrors('http://a/\nhttp://b/\tarch:amd64\n')).toBe('http://b/\tarch:amd64\tpriority:1\nhttp://a/\tpriority:2\n');
    expect(rotateMirrors('# only one\nhttp://a/\tpriority:1\n')).toBeNull();
    expect(rotateMirrors('')).toBeNull();
  });

  it('counts only the .deb files added since the restore; nothing without a restore listing', () => {
    expect(countNew('a.deb\nb.deb\n', ['a.deb', 'b.deb', 'c.deb'])).toBe(1);
    expect(countNew('a.deb\n', ['a.deb'])).toBe(0);
    expect(countNew('', ['a.deb'])).toBe(1);
    expect(countNew(null, ['a.deb', 'b.deb'])).toBe(0);
  });

  it('runs a time-boxed root command as sudo env PATH timeout --kill-after', () => {
    expect(composeCommand('/w/node_modules/.bin/playwright', ['install-deps', 'webkit'], { asRoot: true, timeoutS: 180 }, { isRoot: false, path: '/n/bin:/usr/bin' })).toEqual([
      'sudo', 'env', 'PATH=/n/bin:/usr/bin', 'timeout', '--kill-after=20', '180', '/w/node_modules/.bin/playwright', 'install-deps', 'webkit',
    ]);
    expect(composeCommand('pw', ['install', 'chromium'], {}, { isRoot: false, path: '/x' })).toEqual(['pw', 'install', 'chromium']);
    expect(composeCommand('pw', ['install-deps'], { asRoot: true }, { isRoot: true, path: '/x' })).toEqual(['env', 'PATH=/x', 'pw', 'install-deps']);
  });
});

describe('pw-install cache key: one stable key per package set and ISO week (BD-FU-B05)', () => {
  const set = { os: 'Linux', arch: 'X64', release: 'ubuntu24.04', playwright: '1.64.1', week: '2026W43' };

  it('names the runner, the Ubuntu release, the engines, the Playwright version and the week, and nothing of one run or job', () => {
    expect(cacheKey({ ...set, browsers: ['chromium'] })).toEqual({
      key: 'pw-apt-Linux-X64-ubuntu24.04-chromium-pw1.64.1-2026W43',
      version: 'pw-apt-Linux-X64-ubuntu24.04-chromium-pw1.64.1-',
      base: 'pw-apt-Linux-X64-ubuntu24.04-chromium-',
    });
    expect(cacheKey({ ...set, browsers: ['webkit', 'chromium'] }).key).toBe('pw-apt-Linux-X64-ubuntu24.04-chromium+webkit-pw1.64.1-2026W43');
    // the same set in any order is the same key; another set never matches its restore prefixes
    expect(cacheKey({ ...set, browsers: ['chromium', 'webkit'] })).toEqual(cacheKey({ ...set, browsers: ['webkit', 'chromium'] }));
    expect(cacheKey({ ...set, browsers: ['chromium', 'webkit'] }).key.startsWith(cacheKey({ ...set, browsers: ['chromium'] }).base)).toBe(false);
    expect(cacheKey({ ...set, browsers: ['chromium', 'webkit'] }).key.startsWith(cacheKey({ ...set, browsers: ['chromium'] }).version)).toBe(false);
    // a new Playwright release is a new key under the same base prefix, outside the old version prefix
    const next = cacheKey({ ...set, playwright: '1.65.0', browsers: ['chromium'] });
    expect(next.key).not.toBe(cacheKey({ ...set, browsers: ['chromium'] }).key);
    expect(next.base).toBe(cacheKey({ ...set, browsers: ['chromium'] }).base);
    expect(next.key.startsWith(cacheKey({ ...set, browsers: ['chromium'] }).version)).toBe(false);
    // 1.64.1 is not a prefix match of 1.64.10
    expect(cacheKey({ ...set, playwright: '1.64.10', browsers: ['chromium'] }).key.startsWith(cacheKey({ ...set, browsers: ['chromium'] }).version)).toBe(false);
    expect(cacheKey({ ...set, release: 'ubuntu 26.04/x', playwright: '', browsers: ['chromium'] }).key).toBe('pw-apt-Linux-X64-ubuntu_26.04_x-chromium-pwunknown-2026W43');
  });

  it('a new ISO week is a new key, and last week\'s set is restored by the version prefix', () => {
    const now = cacheKey({ ...set, browsers: ['chromium'] });
    const later = cacheKey({ ...set, week: '2026W44', browsers: ['chromium'] });
    expect(later.key).not.toBe(now.key);
    expect(later.version).toBe(now.version);
    expect(now.key.startsWith(later.version)).toBe(true);
    // this week's partial caches (`<key>-partial-…`) are not taken for another week's exact key prefix
    expect(`${now.key}-partial-1-1-e2e-0`.startsWith(`${later.key}-`)).toBe(false);
    // the year turn follows ISO weeks (date -u +%GW%V), e.g. 2026-12-31 is 2026W53, 2027-01-04 is 2027W01
    expect(ISO_WEEK.test('2026W53')).toBe(true);
    expect(ISO_WEEK.test('2027W01')).toBe(true);
    for (const bad of ['2026W00', '2026W54', '2026-W43', '26W43', '', '2026W4']) expect(ISO_WEEK.test(bad), bad).toBe(false);
  });

  it('the CLI needs the week before the engines', () => {
    expect(main(['--cache-key', 'chromium'])).toBe(2);
    expect(main(['--cache-key', '--week', 'soon', 'chromium'])).toBe(2);
    expect(main(['--cache-key', '--week', '2026W43'])).toBe(2);
  });

  it('reads the release from os-release(5)', () => {
    expect(osRelease('PRETTY_NAME="Ubuntu 24.04.5 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nID=ubuntu\n')).toBe('ubuntu24.04');
    expect(osRelease('ID=ubuntu\n')).toBe('unknown');
    expect(osRelease(null)).toBe('unknown');
  });
});

interface Call {
  argv: string[];
  asRoot: boolean;
  timeoutS: number | undefined;
  downloadOnly: boolean;
  mirrors: string | null;
}

/**
 * A runner in memory: `answers` gives each playwright call's exit status and bytes fetched, keyed by its kind; files are a map.
 * `downloadOnly` records whether 98dv-pw-download-only was in place during each call.
 */
function fakeHost(opts: {
  dry?: number;
  prefetch?: Array<{ status: number; bytes: number; seconds: number }>;
  install?: number;
  mirrors?: string | null;
  failRemove?: boolean;
}): Host & { calls: Call[]; files: Map<string, string>; logs: string[]; restored: string[] | null } {
  const files = new Map<string, string>();
  if (opts.mirrors !== null) files.set(MIRRORS, opts.mirrors ?? RUNNER_MIRRORS);
  const prefetch = [...(opts.prefetch ?? [])];
  let bytes = 1_000;
  let debs = ['restored.deb'];
  let clock = 0;
  const host = {
    calls: [] as Call[],
    files,
    logs: [] as string[],
    restored: null as string[] | null,
    run(cmd: string, argv: readonly string[], o: { asRoot?: boolean; timeoutS?: number } = {}) {
      host.calls.push({ argv: [cmd, ...argv], asRoot: o.asRoot === true, timeoutS: o.timeoutS, downloadOnly: files.has(DOWNLOAD_ONLY_CONF), mirrors: files.get(MIRRORS) ?? null });
      if (argv.includes('--dry-run')) return { status: opts.dry ?? 1 };
      if (argv[0] === 'install-deps') {
        const p = prefetch.shift() ?? { status: 0, bytes: 0, seconds: 1 };
        bytes += p.bytes;
        clock += p.seconds * 1000;
        if (p.bytes > 0) debs = [...debs, `new-${host.calls.length}.deb`];
        return { status: p.status };
      }
      return { status: opts.install ?? 0 };
    },
    writeRootFile(file: string, content: string | null) {
      if (content === null) {
        if (opts.failRemove && file === DOWNLOAD_ONLY_CONF) return false;
        files.delete(file);
      } else files.set(file, content);
      return true;
    },
    readFile: (file: string) => files.get(file) ?? null,
    debs: () => debs,
    state: () => ({ files: debs.length, bytes }),
    writeRestored: (names: readonly string[]) => {
      host.restored = [...names];
    },
    now: () => clock,
    log: (line: string) => {
      host.logs.push(line);
    },
  };
  return host;
}

const plan = (browsers: string[]): InstallPlan => ({ playwright: 'pw', browsers, archives: '/home/runner/.cache/dv-pw-apt', attemptS: ATTEMPT_S, attempts: 2 });
const kinds = (calls: Call[]): string[] => calls.map((c) => c.argv.slice(1).join(' '));

describe('pw-install plan (BD-FIX-CI10-P01)', () => {
  it('installs only the browsers when the dry run finds every package (no apt, no prefetch)', () => {
    const h = fakeHost({ dry: 0 });
    expect(install(plan(['chromium']), h)).toBe(0);
    expect(kinds(h.calls)).toEqual(['install-deps --dry-run chromium', 'install chromium']);
    expect(h.files.get(APT_CONF)).toContain('Dir::Cache::archives "/home/runner/.cache/dv-pw-apt/";');
    expect(h.restored).toEqual(['restored.deb']);
  });

  it('on a healthy runner: one download-only prefetch under timeout as root, then the unbounded install --with-deps', () => {
    const h = fakeHost({ prefetch: [{ status: 0, bytes: 119e6, seconds: 20 }] });
    expect(install(plan(['chromium', 'webkit']), h)).toBe(0);
    expect(kinds(h.calls)).toEqual(['install-deps --dry-run chromium webkit', 'install-deps chromium webkit', 'install --with-deps chromium webkit']);
    const [, pre, fin] = h.calls as [Call, Call, Call];
    expect(pre).toMatchObject({ asRoot: true, timeoutS: ATTEMPT_S, downloadOnly: true });
    expect(fin).toMatchObject({ asRoot: false, timeoutS: undefined, downloadOnly: false, mirrors: RUNNER_MIRRORS });
    expect(h.files.has(DOWNLOAD_ONLY_CONF)).toBe(false);
  });

  it('on a slow mirror: the cut attempt is followed by one on the rotated list, and the install keeps the faster order', () => {
    const h = fakeHost({ prefetch: [{ status: 124, bytes: 7.5e6, seconds: 180 }, { status: 0, bytes: 112e6, seconds: 15 }] });
    expect(install(plan(['webkit']), h)).toBe(0);
    expect(kinds(h.calls)).toEqual(['install-deps --dry-run webkit', 'install-deps webkit', 'install-deps webkit', 'install --with-deps webkit']);
    const rotated = rotateMirrors(RUNNER_MIRRORS);
    expect(h.calls[1]?.mirrors).toBe(RUNNER_MIRRORS);
    expect(h.calls[2]).toMatchObject({ downloadOnly: true, mirrors: rotated });
    expect(h.calls[3]).toMatchObject({ downloadOnly: false, mirrors: rotated });
    expect(h.logs.some((l) => /prefetch 1\/2: exit 124, \+1 \.deb files, \+7\.5 MB in 180 s \(42 kB\/s\)/.test(l))).toBe(true);
  });

  it('restores the image mirror order for the install when the rotated mirror was cut too and was slower', () => {
    const h = fakeHost({ prefetch: [{ status: 124, bytes: 7.5e6, seconds: 180 }, { status: 124, bytes: 1e6, seconds: 180 }] });
    expect(install(plan(['webkit']), h)).toBe(0);
    expect(h.calls).toHaveLength(4);
    expect(h.calls[3]).toMatchObject({ argv: ['pw', 'install', '--with-deps', 'webkit'], mirrors: RUNNER_MIRRORS });
  });

  it('never hides a real failure: a prefetch error stops the prefetch, and the install exit status is the result', () => {
    const h = fakeHost({ prefetch: [{ status: 100, bytes: 0, seconds: 2 }], install: 1 });
    expect(install(plan(['webkit']), h)).toBe(1);
    expect(kinds(h.calls)).toEqual(['install-deps --dry-run webkit', 'install-deps webkit', 'install --with-deps webkit']);
    expect(h.logs.some((l) => l.startsWith('::warning::pw-install: the download-only prefetch exited 100'))).toBe(true);
  });

  it('fails without installing when download-only mode cannot be switched off', () => {
    const h = fakeHost({ prefetch: [{ status: 0, bytes: 1e6, seconds: 1 }], failRemove: true });
    expect(install(plan(['chromium']), h)).toBe(1);
    expect(kinds(h.calls)).toEqual(['install-deps --dry-run chromium', 'install-deps chromium']);
  });

  it('keeps going without a mirror list (no rotation) and rejects a bad browser argument', () => {
    const h = fakeHost({ mirrors: null, prefetch: [{ status: 124, bytes: 1e6, seconds: 180 }, { status: 0, bytes: 1e6, seconds: 5 }] });
    expect(install(plan(['chromium']), h)).toBe(0);
    expect(h.files.has(MIRRORS)).toBe(false);
    expect(h.calls).toHaveLength(4);
    expect(install(plan([]), fakeHost({}))).toBe(2);
    expect(install(plan(['chromium;rm']), fakeHost({}))).toBe(2);
  });
});
