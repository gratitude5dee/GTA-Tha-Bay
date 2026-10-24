/**
 * The Playwright browsers of one CI job and their system packages, resilient to a slow Ubuntu mirror (BD-FIX-CI10-P01).
 *
 *   tsx tools/ci/pw-install.ts <browser>...    install (e.g. `chromium`, `webkit`, `chromium webkit`)
 *   tsx tools/ci/pw-install.ts --count-new     `new=<n>`: .deb files added to the apt archive cache since the install began
 *   tsx tools/ci/pw-install.ts --cache-key <browser>...   `key=` and `base=`: the apt cache key of this package set (BD-FU-B05)
 *
 * Why: on some GitHub-hosted runners the Azure Ubuntu mirror serves package files at about 42 kB/s while its indexes come at
 * about 10 MB/s (run 40017655149: perf, webkit-webgl2 shard 2 and xr-quest3 shard 2 spent 45 to 47 min fetching 119 MB). The
 * Actions cache cannot cover that on a branch's first run: a run restores only its own branch's and the default branch's
 * caches (spec/03 section 6), and every merge candidate is a new branch.
 *
 * What it does, in order:
 *   1. Records the .deb files the cache restore brought back (`--count-new` compares against that list later).
 *   2. Points apt at the cache directory and sets `Acquire::Retries` and `Acquire::http::Timeout`, so a stalled transfer fails
 *      and the runner's `mirror+file:` list moves on to its next mirror (apt-transport-mirror(1)).
 *   3. `playwright install-deps --dry-run <browsers>` exits 0 when no package is missing: then only the browsers are installed
 *      (`playwright install`, no apt at all). Playwright checks the host libraries again when it launches a browser.
 *   4. Otherwise it prefetches: `playwright install-deps` in apt download-only mode (APT::Get::Download-Only), time-boxed with
 *      timeout(1). A cut attempt keeps every finished .deb and its partial file (apt resumes it), and the next attempt
 *      starts with the runner's mirror list rotated, so archive.ubuntu.com serves first. A prefetch never fails the step.
 *   5. `playwright install --with-deps <browsers>`, unbounded, as before: its exit status is the step's, so a real failure
 *      (a missing package, a broken mirror, a failed browser download) still fails the job. Most files now come from the cache.
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { args, repoRoot } from './run.ts';

/** The apt archive cache the workflows restore and save (`path: ~/.cache/dv-pw-apt/*.deb`). */
export const ARCHIVES = path.join(os.homedir(), '.cache', 'dv-pw-apt');
/** The listing of the restored .deb files: beside the directory, so the cache glob never picks it up. */
export const RESTORED_LIST = `${ARCHIVES}.restored`;
export const APT_CONF = '/etc/apt/apt.conf.d/99dv-pw-apt';
export const DOWNLOAD_ONLY_CONF = '/etc/apt/apt.conf.d/98dv-pw-download-only';
/** The runner image's mirror list (actions/runner-images configure-apt-sources.sh): azure, archive.ubuntu.com, security. */
export const MIRRORS = '/etc/apt/apt-mirrors.txt';
/** One time-boxed prefetch attempt. A healthy runner fetches all 119 MB in under 30 s; a slow one moves on after this. */
export const ATTEMPT_S = 180;
export const ATTEMPTS = 2;
const BROWSER = /^[a-z][a-z-]*$/;

/** The apt configuration fragment: the cache directory, retries, and a connection and data timeout (seconds). */
export function aptConf(archives: string): string {
  return [`Dir::Cache::archives "${archives}/";`, 'Acquire::Retries "5";', 'Acquire::http::Timeout "30";', ''].join('\n');
}

/**
 * A mirror list with its first entry moved to the end and every `priority:` renumbered in the new order (apt tries the lowest
 * number first). Comments and blank lines are dropped; other metadata stays. `null` when there is nothing to rotate.
 */
export function rotateMirrors(text: string): string | null {
  const lines = text.split('\n').filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
  if (lines.length < 2) return null;
  const rotated = [...lines.slice(1), lines[0] as string];
  return `${rotated.map((l, i) => (/\bpriority:\d+/.test(l) ? l.replace(/\bpriority:\d+/, `priority:${i + 1}`) : `${l}\tpriority:${i + 1}`)).join('\n')}\n`;
}

/** What makes up one package set: the runner, its Ubuntu release, the Playwright version and the browser engines. */
export interface KeyInputs {
  /** `RUNNER_OS` and `RUNNER_ARCH` (default variables on every runner). */
  os: string;
  arch: string;
  /** `ID` and `VERSION_ID` of /etc/os-release, e.g. `ubuntu24.04`. */
  release: string;
  /** The installed `@playwright/test` version: its `install-deps` list is the package set. */
  playwright: string;
  browsers: readonly string[];
}

const keyPart = (v: string): string => v.replace(/[^A-Za-z0-9._]+/g, '_') || 'unknown';

/**
 * The apt cache key of one package set (BD-FU-B05): stable across runs, attempts, jobs and lockfile changes, so every job that
 * installs the same engines on the same image with the same Playwright shares one cache and saves it once (GitHub caches are
 * immutable and a repository holds 10 GB; spec/03 section 6). `base` (no Playwright version) is the last restore prefix: the
 * newest cache of an older Playwright release still holds most of the files.
 */
export function cacheKey(k: KeyInputs): { key: string; base: string } {
  const base = `pw-apt-${keyPart(k.os)}-${keyPart(k.arch)}-${keyPart(k.release)}-${[...k.browsers].sort().map(keyPart).join('+')}-`;
  return { key: `${base}pw${keyPart(k.playwright)}`, base };
}

/** `ID` + `VERSION_ID` of an os-release(5) file; `unknown` when either is missing. */
export function osRelease(text: string | null): string {
  const field = (name: string): string | undefined => new RegExp(`^${name}="?([^"\n]*)"?$`, 'm').exec(text ?? '')?.[1];
  const id = field('ID');
  const version = field('VERSION_ID');
  return id && version ? `${id}${version}` : 'unknown';
}

/** The .deb files present now that were not in the restored listing. */
export function newArchives(restored: readonly string[], now: readonly string[]): string[] {
  const had = new Set(restored);
  return now.filter((f) => !had.has(f));
}

export interface ArchiveState {
  files: number;
  bytes: number;
}

export interface RunResult {
  status: number;
}

/** Everything the install touches outside its own memory, injected so the plan is tested without apt or a runner. */
export interface Host {
  /** Runs a command with inherited stdio; `asRoot` through sudo; `timeoutS` through timeout(1) (exit 124 when cut). */
  run(cmd: string, argv: readonly string[], opts?: { asRoot?: boolean; timeoutS?: number }): RunResult;
  /** Writes a root-owned file (sudo tee) or removes it (content null). */
  writeRootFile(file: string, content: string | null): boolean;
  readFile(file: string): string | null;
  /** The .deb file names in the archive directory, sorted. */
  debs(): string[];
  state(): ArchiveState;
  writeRestored(names: readonly string[]): void;
  now(): number;
  log(line: string): void;
}

export interface InstallPlan {
  playwright: string;
  browsers: readonly string[];
  archives: string;
  attemptS: number;
  attempts: number;
}

const mb = (b: number): string => (b / 1e6).toFixed(1);

/** The whole install; returns the step's exit status (the final `playwright install`'s). */
export function install(plan: InstallPlan, host: Host): number {
  const { playwright, browsers } = plan;
  if (browsers.length === 0 || browsers.some((b) => !BROWSER.test(b))) {
    host.log(`pw-install: usage: pw-install.ts <browser>... (got ${JSON.stringify(browsers)})`);
    return 2;
  }
  host.writeRestored(host.debs());
  const restored = host.state();
  host.log(`pw-install: ${restored.files} .deb files (${mb(restored.bytes)} MB) restored from the Actions cache`);
  if (!host.writeRootFile(APT_CONF, aptConf(plan.archives))) {
    host.log(`pw-install: could not write ${APT_CONF}`);
    return 1;
  }

  const dry = host.run(playwright, ['install-deps', '--dry-run', ...browsers]);
  if (dry.status === 0) {
    host.log('pw-install: every system package is already installed; installing the browsers only');
    return host.run(playwright, ['install', ...browsers]).status;
  }

  const mirrorsBefore = host.readFile(MIRRORS);
  const rates: number[] = [];
  let lastStatus = -1;
  for (let attempt = 1; attempt <= plan.attempts; attempt++) {
    if (!host.writeRootFile(DOWNLOAD_ONLY_CONF, 'APT::Get::Download-Only "true";\n')) break;
    const before = host.state();
    const t0 = host.now();
    const res = host.run(playwright, ['install-deps', ...browsers], { asRoot: true, timeoutS: plan.attemptS });
    // Never leave download-only mode on: the install below would then download and install nothing, and pass.
    if (!host.writeRootFile(DOWNLOAD_ONLY_CONF, null) || host.readFile(DOWNLOAD_ONLY_CONF) !== null) {
      host.log(`pw-install: could not remove ${DOWNLOAD_ONLY_CONF}`);
      return 1;
    }
    lastStatus = res.status;
    const after = host.state();
    const s = Math.max(0.001, (host.now() - t0) / 1000);
    const rate = (after.bytes - before.bytes) / s;
    rates.push(rate);
    host.log(
      `pw-install: prefetch ${attempt}/${plan.attempts}: exit ${res.status}, +${after.files - before.files} .deb files, ` +
        `+${mb(after.bytes - before.bytes)} MB in ${s.toFixed(0)} s (${(rate / 1e3).toFixed(0)} kB/s)`,
    );
    if (res.status === 0) break;
    if (res.status !== 124 && res.status !== 137) {
      host.log(`::warning::pw-install: the download-only prefetch exited ${res.status}; the install below reports the cause`);
      break;
    }
    if (attempt === plan.attempts) break;
    const current = host.readFile(MIRRORS);
    const rotated = current === null ? null : rotateMirrors(current);
    if (rotated === null || !host.writeRootFile(MIRRORS, rotated)) {
      host.log(`pw-install: ${MIRRORS} absent or not rotatable; the next attempt uses the same mirrors`);
    } else {
      host.log(`pw-install: cut after ${plan.attemptS} s; ${MIRRORS} rotated to: ${rotated.trim().replace(/\n/g, ' | ')}`);
    }
  }
  // The install fetches whatever is left: from the image's own mirror order again when the rotated mirror was cut too and slower.
  const cut = lastStatus === 124 || lastStatus === 137;
  const slower = rates.length >= 2 && (rates[rates.length - 1] as number) < (rates[0] as number);
  if (mirrorsBefore !== null && cut && slower && host.readFile(MIRRORS) !== mirrorsBefore) {
    host.writeRootFile(MIRRORS, mirrorsBefore);
    host.log(`pw-install: the rotated mirror was slower; ${MIRRORS} restored`);
  }

  const res = host.run(playwright, ['install', '--with-deps', ...browsers]);
  const end = host.state();
  host.log(`pw-install: install exit ${res.status}; the cache directory holds ${end.files} .deb files (${mb(end.bytes)} MB)`);
  return res.status;
}

/** `--count-new`: the number of .deb files added since the install began, for the save step's condition. */
export function countNew(restoredText: string | null, now: readonly string[]): number {
  if (restoredText === null) return 0; // the install never started: nothing of ours to save
  return newArchives(restoredText.split('\n').filter(Boolean), now).length;
}

/**
 * The argv `Host.run` executes. As root through `sudo env PATH=<path>` (sudo resets PATH, and node comes from the tool cache);
 * time-boxed through `timeout --kill-after=20 <s>`, which runs as root too, so the TERM reaches apt-get and its download
 * methods (timeout(1) signals the children of its command unless --foreground is given).
 */
export function composeCommand(cmd: string, argv: readonly string[], opts: { asRoot?: boolean; timeoutS?: number }, env: { isRoot: boolean; path: string }): string[] {
  const root = opts.asRoot ? [...(env.isRoot ? [] : ['sudo']), 'env', `PATH=${env.path}`] : [];
  const timed = opts.timeoutS !== undefined ? ['timeout', '--kill-after=20', String(opts.timeoutS)] : [];
  return [...root, ...timed, cmd, ...argv];
}

function realHost(archives: string): Host {
  const isRoot = (process.getuid?.() ?? 0) === 0;
  const sudo = isRoot ? [] : ['sudo'];
  const exec = (argv: readonly string[], opts: SpawnSyncOptions = { stdio: 'inherit' }): RunResult => {
    const [cmd, ...rest] = argv as [string, ...string[]];
    const r = spawnSync(cmd, rest, opts);
    return { status: r.status ?? (r.signal === 'SIGKILL' ? 137 : 1) };
  };
  const debs = (): string[] => (existsSync(archives) ? readdirSync(archives).filter((f) => f.endsWith('.deb')).sort() : []);
  return {
    run: (cmd, argv, opts = {}) => exec(composeCommand(cmd, argv, opts, { isRoot, path: process.env['PATH'] ?? '' })),
    writeRootFile(file, content) {
      if (content === null) return exec([...sudo, 'rm', '-f', file]).status === 0;
      return exec([...sudo, 'tee', file], { input: content, stdio: ['pipe', 'ignore', 'inherit'] }).status === 0;
    },
    readFile: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null),
    debs,
    state() {
      const names = debs();
      let bytes = names.reduce((n, f) => n + statSync(path.join(archives, f)).size, 0);
      const partial = path.join(archives, 'partial');
      try {
        bytes += readdirSync(partial).reduce((n, f) => n + statSync(path.join(partial, f)).size, 0);
      } catch {
        // partial/ belongs to _apt (mode 700) once apt has used it: its bytes are left out
      }
      return { files: names.length, bytes };
    },
    writeRestored: (names) => writeFileSync(RESTORED_LIST, names.map((n) => `${n}\n`).join('')),
    now: () => Date.now(),
    log: (line) => console.log(line),
  };
}

export function main(argv: readonly string[]): number {
  if (argv[0] === '--cache-key') {
    const browsers = argv.slice(1);
    if (browsers.length === 0 || browsers.some((b) => !BROWSER.test(b))) {
      console.log(`pw-install: usage: pw-install.ts --cache-key <browser>... (got ${JSON.stringify(browsers)})`);
      return 2;
    }
    let playwright = 'unknown';
    try {
      playwright = (JSON.parse(readFileSync(path.join(repoRoot, 'node_modules', '@playwright', 'test', 'package.json'), 'utf8')) as { version?: string }).version ?? 'unknown';
    } catch {
      // not installed: the key still names the set, with an unknown version
    }
    const release = osRelease(existsSync('/etc/os-release') ? readFileSync('/etc/os-release', 'utf8') : null);
    const { key, base } = cacheKey({ os: process.env['RUNNER_OS'] ?? os.platform(), arch: process.env['RUNNER_ARCH'] ?? os.arch(), release, playwright, browsers });
    console.log(`pw-install: apt cache key ${key} (restore prefix ${base})`);
    const out = process.env['GITHUB_OUTPUT'];
    if (out) appendFileSync(out, `key=${key}\nbase=${base}\n`);
    return 0;
  }
  if (argv[0] === '--count-new') {
    const restored = existsSync(RESTORED_LIST) ? readFileSync(RESTORED_LIST, 'utf8') : null;
    const now = existsSync(ARCHIVES) ? readdirSync(ARCHIVES).filter((f) => f.endsWith('.deb')) : [];
    const n = countNew(restored, now);
    console.log(`pw-install: ${n} new .deb files since the restore${restored === null ? ' (no restore listing: the install never started)' : ''}`);
    const out = process.env['GITHUB_OUTPUT'];
    if (out) appendFileSync(out, `new=${n}\n`);
    return 0;
  }
  mkdirSync(path.join(ARCHIVES, 'partial'), { recursive: true });
  const plan: InstallPlan = {
    playwright: path.join(repoRoot, 'node_modules', '.bin', 'playwright'),
    browsers: argv,
    archives: ARCHIVES,
    attemptS: ATTEMPT_S,
    attempts: ATTEMPTS,
  };
  return install(plan, realHost(ARCHIVES));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(args()));
