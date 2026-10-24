import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compileStringMatcher, scanText as scanBrandText, type IpDenylistConfig } from '../../../packages/shared/src/index.ts';
import { evaluate, type Change } from '../check-do-migrations.ts';
import { findTestRouteStrings, prodConfigProblems } from '../check-prod-routes.ts';
import { scanDir, scanText } from '../check-secrets.ts';
import { mediaEnvOf, overrideHeader, smoke } from '../check-smoke.ts';
import {
  parseCurrentVersion,
  parseVersionId,
  parseWorkersDevUrl,
  planProd,
  runProd,
  type Deps,
  type ExecResult,
  type ProdOptions,
} from '../deploy-prod.ts';

// Fixtures are assembled at run time so this file itself holds no secret-shaped string.
const body = (n: number, alphabet = 'abcdef0123456789'): string => Array.from({ length: n }, (_, i) => alphabet[(i * 7) % alphabet.length]).join('');
const FIXTURES = {
  cfat: `token = "${'cfat' + '_'}${body(40, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk0123456789')}"`,
  anthropic: `key: ${'sk' + '-ant' + '-'}${body(40, 'abcdefghijklmnopqrstuvwxyz0123456789')}`,
  pem: `${'-----BEGIN ' + 'PRIVATE KEY-----'}\nMIIE...`,
  fal: `FAL_KEY=${'0123abcd-4567-89ab-cdef-0123456789ab'}:${body(32)}`,
};

describe('check:secrets', () => {
  it('reports each secret shape', () => {
    expect(scanText(FIXTURES.cfat)[0]?.pattern).toMatch(/cfat_/);
    expect(scanText(FIXTURES.anthropic)[0]?.pattern).toMatch(/sk-ant-/);
    expect(scanText(FIXTURES.pem)[0]?.pattern).toMatch(/pem/);
    expect(scanText(FIXTURES.fal)[0]?.pattern).toMatch(/fal/);
  });

  it('does not flag prose that only names a prefix', () => {
    expect(scanText('secret patterns incl. cfat_, cfut_, sbp_, sb_secret_ and sk-ant- keys')).toEqual([]);
  });

  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('scans a directory and reports file and line without the value', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dv-secrets-'));
    dirs.push(dir);
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'assets', 'a.js'), `var a = 1;\n${FIXTURES.cfat}\n`);
    writeFileSync(path.join(dir, 'clean.js'), 'var ok = true;\n');
    const findings = scanDir(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: path.join('assets', 'a.js'), line: 2 });
    expect(JSON.stringify(findings)).not.toContain(body(40, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk0123456789'));
  });
});

describe('check:do-migrations', () => {
  const config = (migrations: unknown[], extra = ''): string =>
    `{ "name": "tha-bay-web", "main": "src/index.ts"${extra}, "migrations": ${JSON.stringify(migrations)} }`;
  const m1 = [{ tag: 'web-v1', new_sqlite_classes: ['FooDO'] }];
  const m2 = [...m1, { tag: 'web-v2', new_sqlite_classes: ['BarDO'] }];

  it('fails when a migration change comes with another runtime change', () => {
    const changes: Change[] = [
      { file: 'services/edge/wrangler.jsonc', before: config(m1), after: config(m2) },
      { file: 'services/edge/src/index.ts', before: 'a', after: 'b' },
    ];
    const v = evaluate(changes);
    expect(v.ok).toBe(false);
    expect(v.reasons.join('\n')).toMatch(/src\/index\.ts/);
  });

  it('fails when the same config changes something besides the lifecycle sections', () => {
    const v = evaluate([{ file: 'services/edge/wrangler.jsonc', before: config(m1), after: config(m2, ', "workers_dev": false') }]);
    expect(v.ok).toBe(false);
  });

  it('passes a migrations-only change and labels it do-lifecycle', () => {
    const v = evaluate([
      { file: 'services/edge/wrangler.jsonc', before: config(m1), after: config(m2) },
      { file: 'spec/11-decision-log.md', before: 'a', after: 'b' },
      { file: 'services/edge/test/x.test.ts', before: null, after: 'c' },
    ]);
    expect(v).toMatchObject({ ok: true, lifecycle: true, label: 'do-lifecycle' });
  });

  it('passes the lifecycle shape of DL-233: DO skeletons, export-from lines, a new service package', () => {
    const skeleton = "import { DurableObject } from 'cloudflare:workers';\n\n// skeleton\nexport class FooDO extends DurableObject {}\n";
    const v = evaluate([
      { file: 'services/edge/wrangler.jsonc', before: config(m1), after: config(m2) },
      { file: 'services/edge/src/foo/FooDO.ts', before: null, after: skeleton },
      { file: 'services/pipeline/src/do/BarDO.ts', before: null, after: skeleton },
      {
        file: 'services/edge/src/index.ts',
        before: "import a from 'a';\nconst x = 1;\n",
        after: "import a from 'a';\nexport { FooDO } from './foo/FooDO.ts';\nexport { BarDO } from '@dv/pipeline';\nconst x = 1;\n",
      },
      { file: 'services/pipeline/package.json', before: null, after: '{ "name": "@dv/pipeline" }' },
      {
        file: 'services/edge/package.json',
        before: '{ "dependencies": { "@dv/shared": "workspace:*" } }',
        after: '{ "dependencies": { "@dv/pipeline": "workspace:*", "@dv/shared": "workspace:*" } }',
      },
    ]);
    expect(v).toMatchObject({ ok: true, lifecycle: true, label: 'do-lifecycle' });
  });

  it('still fails a logic edit in src/index.ts, a DO class with a body, and a non-workspace dependency', () => {
    const lifecycle = { file: 'services/edge/wrangler.jsonc', before: config(m1), after: config(m2) };
    const edit = evaluate([
      lifecycle,
      { file: 'services/edge/src/index.ts', before: "import a from 'a';\n", after: "import a from 'a';\nexport { FooDO } from './FooDO.ts';\nrouteAll();\n" },
    ]);
    expect(edit.ok).toBe(false);
    const body = evaluate([
      lifecycle,
      {
        file: 'services/edge/src/FooDO.ts',
        before: null,
        after: "import { DurableObject } from 'cloudflare:workers';\nexport class FooDO extends DurableObject { fetch() { return new Response('x'); } }\n",
      },
    ]);
    expect(body.ok).toBe(false);
    const grown = evaluate([
      lifecycle,
      { file: 'services/edge/src/FooDO.ts', before: 'export class FooDO extends DurableObject {}\n', after: 'export class FooDO extends DurableObject {}\n// edit\n' },
    ]);
    expect(grown.ok).toBe(false);
    const dep = evaluate([
      lifecycle,
      { file: 'services/edge/package.json', before: '{ "dependencies": {} }', after: '{ "dependencies": { "left-pad": "1.0.0" } }' },
    ]);
    expect(dep.ok).toBe(false);
  });

  it('passes a change that touches no lifecycle section', () => {
    const v = evaluate([
      { file: 'services/edge/wrangler.jsonc', before: config(m1), after: config(m1, ', "workers_dev": false') },
      { file: 'services/edge/src/index.ts', before: 'a', after: 'b' },
    ]);
    expect(v).toMatchObject({ ok: true, lifecycle: false });
  });
});

describe('check:prod-routes', () => {
  it('finds test-route strings in a bundle', () => {
    expect(findTestRouteStrings('a\npath: "/api/v1/_test/echo-country"\nb')).toHaveLength(1);
    expect(findTestRouteStrings('if (false) {}\nconst x = 1')).toEqual([]);
  });

  it('flags a mock prod FAL_MODE and an enabled define', () => {
    const bad = '{ "vars": { "FAL_MODE": "mock", "ENVIRONMENT": "prod", "ANTHROPIC_MODE": "live" }, "define": { "__DV_TEST_ROUTES__": "true" } }';
    expect(prodConfigProblems(bad)).toHaveLength(2);
    const good = '{ "vars": { "FAL_MODE": "live", "ENVIRONMENT": "prod", "ANTHROPIC_MODE": "live" }, "define": { "__DV_TEST_ROUTES__": "false" } }';
    expect(prodConfigProblems(good)).toEqual([]);
  });

  it('flags a production ANTHROPIC_MODE that is fixture or unset (M06a3)', () => {
    const base = (mode: string): string => `{ "vars": { "FAL_MODE": "live", "ENVIRONMENT": "prod"${mode} }, "define": { "__DV_TEST_ROUTES__": "false" } }`;
    expect(prodConfigProblems(base(', "ANTHROPIC_MODE": "fixture"'))).toEqual([expect.stringContaining('ANTHROPIC_MODE')]);
    expect(prodConfigProblems(base(''))).toEqual([expect.stringContaining('unset')]);
    expect(prodConfigProblems(base(', "ANTHROPIC_MODE": "live"'))).toEqual([]);
  });
});

describe('check:smoke', () => {
  const isolated = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' };

  /** A catalog with a world index, its pointer, and the media objects a published deploy serves (BD-FU-A03). */
  const catalogBody = JSON.stringify({
    schema: 'asset-catalog/1',
    entries: { 'data/world-index': { variants: { default: { key: 'assets/data/world-index/default.aaaaaaaaaaaa.json' } } } },
  });
  const catalogSha = createHash('sha256').update(catalogBody).digest('hex');
  const pointer = { schema: 'asset-catalog-pointer/1', sha256: catalogSha, key: `manifests/assets-${catalogSha}.json`, bytes: Buffer.byteLength(catalogBody) };
  const published: Record<string, string> = {
    [`/media/${pointer.key}`]: catalogBody,
    '/media/assets/data/world-index/default.aaaaaaaaaaaa.json': '{}',
  };

  /** A healthy Worker; `media` overrides what the media route answers for a path (a status, or a body). */
  function worker(media: Record<string, number | string> = {}, seen: Array<{ path: string; method: string; headers: Record<string, string> }> = []): typeof fetch {
    return (async (input: URL | RequestInfo, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      seen.push({ path, method: init?.method ?? 'GET', headers: init?.headers as Record<string, string> });
      if (path === '/api/v1/health') return new Response('{"ok":true}', { headers: { ...isolated, 'X-Request-Id': '0198aaaa-bbbb-7ccc-8ddd-eeeeffff0000' } });
      if (path === '/asset-catalog.json') return Response.json(pointer, { headers: isolated });
      if (path.startsWith('/media/')) {
        const over = media[path];
        if (typeof over === 'number') return new Response(null, { status: over, headers: { 'Access-Control-Allow-Origin': '*' } });
        const body = over ?? published[path];
        return body === undefined ? new Response(null, { status: 404 }) : new Response(init?.method === 'HEAD' ? null : body);
      }
      return new Response('<html></html>', { headers: isolated });
    }) as typeof fetch;
  }

  it('sends the version override header and passes on a healthy worker', async () => {
    const seen: Array<{ path: string; method: string; headers: Record<string, string> }> = [];
    const fetchImpl = worker({}, seen);
    expect(await smoke('https://x.test', { version: 'v-new', worker: 'tha-bay-web-staging', fetchImpl })).toEqual([]);
    expect(seen.every((r) => r.headers['Cloudflare-Workers-Version-Overrides'] === 'tha-bay-web-staging="v-new"')).toBe(true);
    // The catalog the pointer names is fetched, and the world index it lists is checked with HEAD.
    expect(seen.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining(['GET /asset-catalog.json', `GET /media/${pointer.key}`, 'HEAD /media/assets/data/world-index/default.aaaaaaaaaaaa.json']),
    );
    expect(overrideHeader('tha-bay-web', 'abc')).toBe('tha-bay-web="abc"');
  });

  it('fails when the deployed pointer names a catalog the media route does not serve, and names the operator step (BD-FU-A03)', async () => {
    const staging = await smoke('https://x.test', { worker: 'tha-bay-web-staging', fetchImpl: worker({ [`/media/${pointer.key}`]: 404 }) });
    expect(staging).toHaveLength(1);
    expect(staging[0]).toContain(`names ${pointer.key}, but GET /media/${pointer.key} answered 404`);
    expect(staging[0]).toContain('pnpm assets:publish -- --env staging');
    const prod = await smoke('https://x.test', { fetchImpl: worker({ [`/media/${pointer.key}`]: 404 }) });
    expect(prod[0]).toContain('pnpm assets:publish -- --env prod');
    expect(mediaEnvOf('tha-bay-web-staging')).toBe('staging');
    expect(mediaEnvOf('tha-bay-web')).toBe('prod');
  });

  it('fails on catalog bytes that do not match the pointer, a missing world index object, or a pointer that is not served', async () => {
    const tampered = await smoke('https://x.test', { fetchImpl: worker({ [`/media/${pointer.key}`]: catalogBody.replace('world-index', 'world-indey') }) });
    expect(tampered).toEqual([expect.stringContaining('/asset-catalog.json wants')]);
    const noIndex = await smoke('https://x.test', { fetchImpl: worker({ '/media/assets/data/world-index/default.aaaaaaaaaaaa.json': 404 }) });
    expect(noIndex).toEqual([expect.stringContaining('data/world-index variant assets/data/world-index/default.aaaaaaaaaaaa.json answered HEAD 404')]);
    const healthy = worker();
    const noPointer = (async (input: URL | RequestInfo, init?: RequestInit) =>
      new URL(String(input)).pathname === '/asset-catalog.json' ? new Response('<html></html>', { headers: isolated }) : healthy(input, init)) as typeof fetch;
    expect(await smoke('https://x.test', { fetchImpl: noPointer })).toEqual(['/asset-catalog.json is not an asset-catalog-pointer/1']);
  });

  it('a 503 from the media route (its kill switch) is a warning, not a failure', async () => {
    const warnings: string[] = [];
    const problems = await smoke('https://x.test', { fetchImpl: worker({ [`/media/${pointer.key}`]: 503 }), warn: (m) => warnings.push(m) });
    expect(problems).toEqual([]);
    expect(warnings).toEqual([expect.stringContaining('MEDIA_ROUTE')]);
  });

  it('reports missing isolation headers and a bad request id', async () => {
    const fetchImpl = (async () => new Response('{"ok":true}')) as unknown as typeof fetch;
    const problems = await smoke('https://x.test', { fetchImpl });
    expect(problems.some((p) => p.includes('cross-origin-opener-policy'))).toBe(true);
    expect(problems.some((p) => p.includes('UUIDv7'))).toBe(true);
  });
});

describe('deploy:prod', () => {
  const o: ProdOptions = {
    env: 'staging', workerName: 'tha-bay-web-staging', sha12: 'abc123def456', title: 'feat: x',
    secretsFile: '/tmp/s.json', url: 'https://x.workers.dev', doLifecycle: false, outputFile: '/tmp/o.ndjson',
  };

  it('plans upload, 0 %, smoke with the version, 100 % and rollback in that order', () => {
    const plan = planProd(o).join('\n');
    const at = (s: string): number => plan.indexOf(s);
    expect(at('versions upload')).toBeGreaterThan(-1);
    expect(at('versions upload')).toBeLessThan(at('<NEW>@0% <OLD>@100%'));
    expect(at('<NEW>@0% <OLD>@100%')).toBeLessThan(at('--version <NEW>'));
    expect(at('--version <NEW>')).toBeLessThan(at('<NEW>@100% -y'));
    expect(at('<NEW>@100% -y')).toBeLessThan(at('rollback <OLD>'));
  });

  it('parses version ids and the current version defensively', () => {
    expect(parseVersionId('{"type":"version-upload","version_id":"11111111-aaaa"}\n')).toBe('11111111-aaaa');
    expect(parseVersionId('noise')).toBeNull();
    const status = JSON.stringify({ versions: [{ version_id: 'old-1', percentage: 100 }] });
    expect(parseCurrentVersion(status)).toBe('old-1');
    const list = JSON.stringify([{ id: 'new', metadata: { created_on: '2026-10-18T10:00:00Z' } }, { id: 'old', metadata: { created_on: '2026-10-17T10:00:00Z' } }]);
    expect(parseCurrentVersion(list, 'new')).toBe('old');
    expect(parseCurrentVersion('garbage')).toBeNull();
    expect(parseWorkersDevUrl('Deployed to https://tha-bay-web-staging.me.workers.dev now')).toBe('https://tha-bay-web-staging.me.workers.dev');
  });

  function deps(script: (cmd: string) => ExecResult, log: string[]): Deps {
    return {
      exec: (cmd) => {
        const line = cmd.join(' ');
        log.push(line);
        return script(line);
      },
      build: () => 0,
      writeSecrets: () => {},
      readOutputFile: () => '{"type":"version-upload","version_id":"new-1"}',
      configUrl: () => 'http://localhost:8788',
      log: () => {},
    };
  }
  const ok = (out = ''): ExecResult => ({ status: 0, out });
  const healthy = (cmd: string): ExecResult =>
    cmd.includes('deployments status') ? ok(JSON.stringify({ versions: [{ version_id: 'old-1', percentage: 100 }] })) : ok();

  it('promotes when the smoke test passes', () => {
    const log: string[] = [];
    const r = runProd(o, deps(healthy, log));
    expect(r).toMatchObject({ code: 0, newVersion: 'new-1', oldVersion: 'old-1' });
    expect(log.some((l) => l.includes('new-1@100% -y'))).toBe(true);
    expect(log.some((l) => l.includes('rollback'))).toBe(false);
  });

  it('rolls back to the old version when the smoke test fails', () => {
    const log: string[] = [];
    const r = runProd(o, deps((cmd) => (cmd.includes('check:smoke') ? { status: 1, out: 'bad' } : healthy(cmd)), log));
    expect(r).toMatchObject({ code: 1, rolledBack: true });
    expect(log.at(-1)).toContain('rollback old-1');
    expect(log.some((l) => l.includes('new-1@100% -y'))).toBe(false);
  });

  it('stops before versions deploy when no rollback target can be found', () => {
    const log: string[] = [];
    const r = runProd(o, deps((cmd) => (cmd.includes('deployments status') || cmd.includes('versions list') ? ok('nothing') : ok()), log));
    expect(r.code).toBe(1);
    expect(log.some((l) => l.includes('versions deploy'))).toBe(false);
  });

  it('a do-lifecycle deploy uses a plain deploy and records the rollback floor', () => {
    const log: string[] = [];
    const r = runProd({ ...o, doLifecycle: true }, deps(healthy, log));
    expect(r.code).toBe(0);
    expect(log.some((l) => l.includes('wrangler deploy'))).toBe(true);
    expect(log.some((l) => l.includes('versions deploy'))).toBe(false);
    expect(r.oldVersion).toBe('old-1');
  });
});

describe('ip:strings brand words (DL-664)', () => {
  const deny = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'config', 'ip-denylist.json'), 'utf8')) as IpDenylistConfig;
  const matcher = compileStringMatcher(deny);
  // the words come from the config, so this test never spells a brand out
  const brands = [['wa', 'ymo'], ['tes', 'la'], ['trans', 'america'], ['sales', 'force'], ['ora', 'cle park'], ['chase', ' center'], ['hum', 'vee']].map((p) => p.join(''));

  it('has every brand word in config/ip-denylist.json words', () => {
    for (const w of brands) expect(deny.words).toContain(w);
  });

  it('flags each brand word as a whole word, case-insensitively, and with . and - as word boundaries', () => {
    for (const w of brands) {
      expect(scanBrandText(`visit the ${w} today`, matcher).length, w).toBeGreaterThan(0);
      expect(scanBrandText(w.toUpperCase(), matcher).length, w).toBeGreaterThan(0);
      expect(scanBrandText(`poi.sf.${w}-depot`, matcher).length, `${w} between . and -`).toBeGreaterThan(0);
    }
  });

  it('does not flag a longer word that merely contains a brand word', () => {
    expect(scanBrandText(`${brands[1]}ssellate ${brands[0]}ing`.replace(/\s+/g, ' '), matcher)).toEqual([]);
  });
});
