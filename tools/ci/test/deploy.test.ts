import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSecretsJson, main, parsePreviewUrl, PREVIEW_URL_FILE, previewCommands, QUEUE_NAMES, stripJsonc, WORKER_SECRETS, workerNames } from '../deploy.ts';
import { dropDashDash, repoRoot } from '../run.ts';

describe('deploy.ts', () => {
  afterEach(() => vi.restoreAllMocks());

  it('every Worker in wrangler.jsonc is named tha-bay-*', () => {
    const names = workerNames(readFileSync(path.join(repoRoot, 'services/edge/wrangler.jsonc'), 'utf8'));
    expect(names.sort()).toEqual(['tha-bay-web', 'tha-bay-web-staging']);
  });

  it('strips comments without touching strings', () => {
    const text = '{ "a": "x // not a comment", // gone\n "b": 1, /* gone */ "c": [1,2,], }';
    expect(JSON.parse(stripJsonc(text))).toEqual({ a: 'x // not a comment', b: 1, c: [1, 2] });
  });

  it('prints SKIP naming both variables, writes no preview URL file and exits 0 without credentials', () => {
    const file = path.join(repoRoot, PREVIEW_URL_FILE);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'https://stale.example.workers.dev\n');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main(['preview'], {})).toBe(0);
    expect(log).toHaveBeenCalledWith('SKIP deploy:preview: CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID not set');
    expect(existsSync(file)).toBe(false);
    for (const mode of ['prod', 'bootstrap']) expect(main([mode], { CLOUDFLARE_API_TOKEN: 'only-one' })).toBe(0);
  });

  it('maps the Worker secrets from the environment into the secrets file (DL-679, M06a1): keys only asserted, absent ones left out', () => {
    expect(WORKER_SECRETS).toEqual(['PLAY_TOKEN_HMAC', 'PLAY_TOKEN_HMAC_PREV', 'QUOTA_NET_SALT_SECRET', 'SUPABASE_SECRET_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_MODERATION_API_KEY', 'ANTHROPIC_BUILDER_KEY']);
    const full = buildSecretsJson({ PLAY_TOKEN_HMAC: 'k1:aaaa', PLAY_TOKEN_HMAC_PREV: 'k0:bbbb', QUOTA_NET_SALT_SECRET: 'salt', SUPABASE_SECRET_KEY: 'sb_secret_x', UNRELATED: 'x' });
    expect(Object.keys(JSON.parse(full.json) as object).sort()).toEqual(['PLAY_TOKEN_HMAC', 'PLAY_TOKEN_HMAC_PREV', 'QUOTA_NET_SALT_SECRET', 'SUPABASE_SECRET_KEY']);
    expect(full.missing).toEqual([]);
    const partial = buildSecretsJson({ PLAY_TOKEN_HMAC: 'k1:aaaa', PLAY_TOKEN_HMAC_PREV: '' });
    expect(Object.keys(JSON.parse(partial.json) as object)).toEqual(['PLAY_TOKEN_HMAC']);
    expect(partial.missing).toEqual(['QUOTA_NET_SALT_SECRET', 'SUPABASE_SECRET_KEY']);
    expect(buildSecretsJson({}).json).toBe('{}\n');
  });

  it('passes the secrets file to both Preview paths only when the environment holds a Worker secret (BD-FIX-CI5-S02)', () => {
    const withFile = previewCommands('pr-6', '/tmp/preview-secrets.json');
    expect(withFile.first).toEqual(['preview', '--env', 'staging', '--name', 'pr-6', '--json', '--secrets-file', '/tmp/preview-secrets.json']);
    expect(withFile.second).toEqual(['versions', 'upload', '--env', 'staging', '--preview-alias', 'pr-6', '--secrets-file', '/tmp/preview-secrets.json']);
    const without = previewCommands('pr-6', null);
    expect(without.first).not.toContain('--secrets-file');
    expect(without.second).not.toContain('--secrets-file');
  });

  it('bootstrap creates the four queues of the web Worker, every name tha-bay-*', () => {
    expect([...QUEUE_NAMES]).toEqual(['tha-bay-jobs', 'tha-bay-spend', 'tha-bay-npc-builder', 'tha-bay-jobs-staging', 'tha-bay-spend-staging', 'tha-bay-npc-builder-staging']);
  });

  it('finds a preview URL in JSON, NDJSON and plain wrangler output', () => {
    const url = 'https://pr-7-tha-bay-web-staging.example.workers.dev';
    expect(parsePreviewUrl(JSON.stringify({ name: 'pr-7', preview_url: url, other: 'https://dash.cloudflare.com/x' }))).toBe(url);
    expect(parsePreviewUrl(`log line\n${JSON.stringify({ type: 'preview', previewUrl: url })}\n`)).toBe(url);
    expect(parsePreviewUrl(`Uploaded. Version Preview URL: ${url}\nDone`)).toBe(url);
    expect(parsePreviewUrl('nothing here')).toBeNull();
  });
});

// ---- the world release (M02c2, AC-13; DL-661, DL-670, DL-688, DL-695) ---------------------------------------------------------------

import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import { worldReleaseWarnings } from '../check-assets.ts';
import { runProd, type Deps, type ProdOptions } from '../deploy-prod.ts';
import { odblOffer } from '../odbl-offer.ts';
import { runProvenanceCheck } from '../provenance-check.ts';
import {
  ASSETS_LOCK, POINTER_EDGE, POINTER_WEB, WORLD_LOCK, checkOdblOffer, metaFile, pointerFile, prepareWorldRelease, releaseKeyOf, staleLockMessage, type ReleaseIo,
} from '../world-release.ts';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const OFFER = 'https://tha-bay-web-staging.example.workers.dev/media/odbl/abc/index.json';

/** A checkout in memory: release.json, the committed pointers, the locks, the world pointer and its meta, the attribution and the built credits. */
function checkout(over: Record<string, string | null> = {}): { io: ReleaseIo; files: Map<string, string> } {
  const worldLock = JSON.stringify({ schema: 'asset-lock/1', entries: { 'data/world-index': { rev: 1, variants: { default: 'a'.repeat(64) }, root: 'a'.repeat(64) } } });
  const assetsLock = JSON.stringify({ schema: 'asset-lock/1', entries: {} });
  const base: Record<string, string> = {
    'config/world/release.json': JSON.stringify({ schema: 'world-release/1', staging: 'sf', production: null }),
    [POINTER_WEB]: '{"committed":"graybox"}',
    [POINTER_EDGE]: '{"committed":"graybox"}',
    [ASSETS_LOCK]: assetsLock,
    [WORLD_LOCK]: worldLock,
    [pointerFile('staging')]: JSON.stringify({ schema: 'asset-catalog-pointer/1', sha256: 'c'.repeat(64), key: `manifests/assets-${'c'.repeat(64)}.json`, bytes: 10 }),
    [metaFile('staging')]: JSON.stringify({ schema: 'world-pointer-meta/1', assetsLockSha256: sha256(assetsLock), worldLockSha256: sha256(worldLock), worldIndexSha256: 'a'.repeat(64) }),
    'config/attribution.world.json': JSON.stringify({ entries: [{ id: 'osm', offerUrl: OFFER }] }),
    'apps/web/dist/credits.json': JSON.stringify({ world: [{ id: 'osm', offerUrl: OFFER }] }),
  };
  const files = new Map<string, string>();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== null) files.set(k, v);
  return { files, io: { read: (rel) => files.get(rel) ?? null, write: (rel, text) => void files.set(rel, text) } };
}

const prodOptions = (env?: string): ProdOptions => ({ env, workerName: env === 'staging' ? 'tha-bay-web-staging' : 'tha-bay-web', sha12: 'abc', title: 't', secretsFile: 's', doLifecycle: false, outputFile: 'o' });

function prodDeps(io: ReleaseIo, key: ReturnType<typeof releaseKeyOf>, log: string[], seen: { atBuild?: string | null } = {}): Deps {
  return {
    exec: (cmd) => {
      log.push(cmd.join(' '));
      return { status: 0, out: cmd.join(' ').includes('deployments status') ? JSON.stringify({ versions: [{ version_id: 'old-1', percentage: 100 }] }) : '' };
    },
    world: { before: () => prepareWorldRelease(io, key), afterBuild: () => checkOdblOffer(io, key, 'apps/web/dist/credits.json') },
    build: () => {
      log.push('build');
      seen.atBuild = io.read(POINTER_WEB);
      return 0;
    },
    writeSecrets: () => undefined,
    readOutputFile: () => '{"type":"version-upload","version_id":"new-1"}',
    configUrl: () => 'http://localhost:8788',
    log: () => undefined,
  };
}

describe('the world release of deploy:prod (AC-13)', () => {
  it('maps deploy:prod with no --env to the production key and --env staging to the staging key', () => {
    expect(releaseKeyOf(undefined)).toBe('production');
    expect(releaseKeyOf('staging')).toBe('staging');
    expect(pointerFile('production')).toBe('assets/world/pointer.production.json');
    expect(metaFile('staging')).toBe('assets/world/pointer.staging.meta.json');
  });

  it('copies the world pointer over both pointer files before the build step when release.json names sf', () => {
    const { io, files } = checkout();
    const log: string[] = [];
    const seen: { atBuild?: string | null } = {};
    const r = runProd(prodOptions('staging'), prodDeps(io, 'staging', log, seen));
    expect(r.code).toBe(0);
    const world = files.get(pointerFile('staging'));
    expect(seen.atBuild).toBe(world);
    expect(files.get(POINTER_WEB)).toBe(world);
    expect(files.get(POINTER_EDGE)).toBe(world);
    expect(log.indexOf('build')).toBeLessThan(log.findIndex((l) => l.includes('versions upload')));
  });

  it('builds the committed pointers when the key is null, for staging and for production', () => {
    for (const [env, release] of [['staging', { staging: null, production: 'sf' }], [undefined, { staging: 'sf', production: null }]] as const) {
      const { io, files } = checkout({ 'config/world/release.json': JSON.stringify({ schema: 'world-release/1', ...release }) });
      const log: string[] = [];
      const seen: { atBuild?: string | null } = {};
      expect(runProd(prodOptions(env), prodDeps(io, releaseKeyOf(env), log, seen)).code).toBe(0);
      expect(seen.atBuild).toBe('{"committed":"graybox"}');
      expect(files.get(POINTER_EDGE)).toBe('{"committed":"graybox"}');
    }
  });

  it('reads an absent env as production for the lookup', () => {
    const { io, files } = checkout({
      'config/world/release.json': JSON.stringify({ schema: 'world-release/1', staging: null, production: 'sf' }),
      [pointerFile('production')]: files0('production'),
      [metaFile('production')]: meta0(),
    });
    const log: string[] = [];
    expect(runProd(prodOptions(undefined), prodDeps(io, releaseKeyOf(undefined), log)).code).toBe(0);
    expect(files.get(POINTER_WEB)).toBe(files.get(pointerFile('production')));
  });

  it('fails on a pointer that is missing or has no data/world-index, before the build', () => {
    for (const over of [
      { [pointerFile('staging')]: null },
      { [metaFile('staging')]: JSON.stringify({ schema: 'world-pointer-meta/1' }) },
      { [WORLD_LOCK]: JSON.stringify({ schema: 'asset-lock/1', entries: {} }) },
    ]) {
      const { io } = checkout(over);
      const log: string[] = [];
      const r = runProd(prodOptions('staging'), prodDeps(io, 'staging', log));
      expect(r.code).toBe(1);
      expect(r.message).toBe('world release staging: pointer missing or without data/world-index');
      expect(log).not.toContain('build');
    }
  });

  it('fails naming "re-run assets:publish --world" when a lock changed after the pointer was built (DL-688)', () => {
    const { io, files } = checkout();
    files.set(ASSETS_LOCK, JSON.stringify({ schema: 'asset-lock/1', entries: { 'texture/new': {} } }));
    const log: string[] = [];
    const r = runProd(prodOptions('staging'), prodDeps(io, 'staging', log));
    expect(r.code).toBe(1);
    expect(r.message).toMatch(/^world release staging: pointer built from lock [0-9a-f]{12}\+[0-9a-f]{12}, current lock [0-9a-f]{12}\+[0-9a-f]{12}; re-run assets:publish --world$/);
    expect(log).not.toContain('build');
    expect(staleLockMessage(io, 'staging')).toBe(r.message);
  });

  it('fails with "ODbL offer missing" when the OSM row lacks offerUrl or the built credits lack it, before any versions upload (DL-695)', () => {
    for (const over of [
      { 'config/attribution.world.json': JSON.stringify({ entries: [{ id: 'osm' }] }) },
      { 'apps/web/dist/credits.json': JSON.stringify({ world: [{ id: 'osm' }] }) },
      { 'apps/web/dist/credits.json': null },
      { 'config/attribution.world.json': JSON.stringify({ entries: [{ id: 'osm', offerUrl: 'http://not-https.example/x' }] }) },
    ]) {
      const { io } = checkout(over);
      const log: string[] = [];
      const r = runProd(prodOptions('staging'), prodDeps(io, 'staging', log));
      expect(r.code).toBe(1);
      expect(r.message).toMatch(/^world release staging: ODbL offer missing/);
      expect(log).toContain('build');
      expect(log.some((l) => l.includes('versions upload'))).toBe(false);
    }
  });

  it('passes the odblOffer check after a build whose emitter wrote the offer URL (the fixture credits stand in for the emitter output)', () => {
    const { io } = checkout();
    expect(checkOdblOffer(io, 'staging', 'apps/web/dist/credits.json')).toBeNull();
    expect(checkOdblOffer(io, 'production', 'apps/web/dist/credits.json')).toBeNull();   // not a release: no check
  });

  it('passes the odblOffer check on a build whose own step ran the emitter (fixture checkout on disk)', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dv-rel-emit-'));
    cpSync(path.join(repoRoot, 'config'), path.join(root, 'config'), { recursive: true });
    const { files } = checkout();
    for (const [rel, text] of files) {
      if (rel === 'apps/web/dist/credits.json') continue;
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), text);
    }
    const io: ReleaseIo = {
      read: (rel) => (existsSync(path.join(root, rel)) ? readFileSync(path.join(root, rel), 'utf8') : null),
      write: (rel, text) => {
        mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        writeFileSync(path.join(root, rel), text);
      },
    };
    const dist = path.join(root, 'apps/web/dist');
    const log: string[] = [];
    const deps = prodDeps(io, 'staging', log);
    deps.build = () => {
      log.push('build');
      mkdirSync(dist, { recursive: true });
      runProvenanceCheck({ root, dist, emitCredits: true, emitOnly: true });
      return 0;
    };
    expect(runProd(prodOptions('staging'), deps).code).toBe(0);
    expect(JSON.parse(readFileSync(path.join(dist, 'credits.json'), 'utf8')).world.find((e: { id: string }) => e.id === 'osm').offerUrl).toBe(OFFER);
    // without the OSM offerUrl in the attribution file the same build fails the check before versions upload
    writeFileSync(path.join(root, 'config/attribution.world.json'), JSON.stringify({ entries: [{ id: 'osm', text: 'x', licence: 'ODbL-1.0', licenceUrl: 'https://x.example/', source: 's', surfaces: ['full-map'] }] }));
    const log2: string[] = [];
    const deps2 = prodDeps(io, 'staging', log2);
    deps2.build = deps.build;
    const r = runProd(prodOptions('staging'), deps2);
    expect(r.message).toMatch(/ODbL offer missing/);
    expect(log2.some((l) => l.includes('versions upload'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('check:assets prints the stale-lock warning and exits 0 while release.json names sf', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dv-rel-'));
    const { files } = checkout();
    files.set(ASSETS_LOCK, '{"schema":"asset-lock/1","entries":{"a/b":{}}}');
    for (const [rel, text] of files) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), text);
    }
    const w = worldReleaseWarnings(root);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('re-run assets:publish --world');
    // the committed repository has release.json at null: no warning
    expect(worldReleaseWarnings(repoRoot)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('odblOffer (DL-695)', () => {
  const att = { entries: [{ id: 'osm', offerUrl: OFFER }] };
  const credits = { world: [{ id: 'osm', offerUrl: OFFER }] };

  it('passes only with an https offerUrl present in both inputs', () => {
    expect(odblOffer({ attribution: att, credits }).status).toBe('pass');
    expect(odblOffer({ attribution: { entries: [{ id: 'osm' }] }, credits }).status).toBe('pending');
    expect(odblOffer({ attribution: att, credits: { world: [{ id: 'osm' }] } }).status).toBe('pending');
    expect(odblOffer({ attribution: att, credits: { world: [{ id: 'osm', offerUrl: `${OFFER}x` }] } }).status).toBe('pending');
    expect(odblOffer({ attribution: { entries: [{ id: 'osm', offerUrl: 'http://x.example/y' }] }, credits }).status).toBe('pending');
    expect(odblOffer({ attribution: att, credits: null }).status).toBe('pending');
    expect(odblOffer({ attribution: null, credits }).status).toBe('pending');
    expect(odblOffer({ attribution: { entries: [{ id: 'datasf-streets', offerUrl: OFFER }] }, credits }).status).toBe('pending');
  });

  it('names the reason in its evidence', () => {
    expect(odblOffer({ attribution: { entries: [{ id: 'osm' }] }, credits }).evidence).toMatch(/no https offerUrl/);
    expect(odblOffer({ attribution: att, credits: { world: [] } }).evidence).toMatch(/has no offerUrl/);
  });
});

function files0(key: 'production'): string {
  return JSON.stringify({ schema: 'asset-catalog-pointer/1', sha256: 'd'.repeat(64), key: `manifests/assets-${'d'.repeat(64)}.json`, bytes: 10, key0: key });
}
function meta0(): string {
  const worldLock = JSON.stringify({ schema: 'asset-lock/1', entries: { 'data/world-index': { rev: 1, variants: { default: 'a'.repeat(64) }, root: 'a'.repeat(64) } } });
  return JSON.stringify({ schema: 'world-pointer-meta/1', assetsLockSha256: sha256(JSON.stringify({ schema: 'asset-lock/1', entries: {} })), worldLockSha256: sha256(worldLock), worldIndexSha256: 'a'.repeat(64) });
}

describe('run.ts', () => {
  it('drops only the first literal --', () => {
    expect(dropDashDash(['vitest', 'run', '--', 'packages/ui'])).toEqual(['vitest', 'run', 'packages/ui']);
    expect(dropDashDash(['a', '--', '--', 'b'])).toEqual(['a', '--', 'b']);
    expect(dropDashDash(['a', 'b'])).toEqual(['a', 'b']);
  });
});
