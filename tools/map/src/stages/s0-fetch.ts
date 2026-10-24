/**
 * S0 fetch (`pnpm map:fetch`): Socrata datasets, Terrarium tiles and the OSM extract into `.cache/map/raw/<area>/` plus
 * raw.lock.json (one RawSourceLock per source). For `sf` the lock is also committed as content/world/raw.lock.sf.json, but
 * only when every source of the area was fetched. Without network, without `osmium`, or with DV_MAP_OFFLINE=1 a source
 * prints `SKIP map:fetch <source>: <reason>` and the command still exits 0.
 *
 * The `sf` OSM extract is the bbox extract, tag-filtered, plus the objects named in the landmark seeds (`osmium getid`, merged
 * before the export, DL-708).
 *
 * `civic-excerpt --fixture` cuts the committed 1 km2 excerpt: DataSF rows and Terrarium tiles from the network, the OSM part
 * from the synth generator restricted to the square (the bake never calls Overpass or Nominatim), stamps marked synthetic.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { latLngFromEnu } from '../../../../packages/shared/src/index.ts';
import { toolsRoot } from '../../../ci/lib/common.ts';
import { spawnRunner, type Runner } from '../../../assets/src/uploader-rclone.ts';
import {
  CIVIC_FIXTURE_DIR, enuBoxOf, loadBounds, loadSources, loadSynth, rawDirOf, sourceById,
  type AreaId, type BBox, type EnuBox, type SourcesConfig,
} from '../config.ts';
import { RAW_LOCK_NAME, rawLockText, readRawLock, sha256File, sha256Text, writeRawLock, type RawLockFile, type RawSourceLock } from '../raw-lock.ts';
import { loadContentWorld } from '../content.ts';
import { clipRingToBox } from '../geom/rings.ts';
import { polygonsOf } from '../sources/geo.ts';
import { ensureOsmPbf, readOsmServed, type OsmDownloader } from '../sources/osm.ts';
import { generateSynth } from '../sources/synth.ts';
import { countLines, fetchSocrata, readJsonl, whereLatLng, whereWithinBox, writeJsonl } from '../sources/socrata.ts';
import { fetchTiles, listTileFiles, tilePath, tilesCovering, unionTiles, type TileId } from '../sources/terrarium.ts';

export interface FetchOptions {
  area: AreaId;
  archive?: boolean | undefined;
  fixture?: boolean | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  log?: ((line: string) => void) | undefined;
  cfg?: SourcesConfig | undefined;
  rawDir?: string | undefined;
  /** Where the committed sf lock goes (default content/world). */
  contentDir?: string | undefined;
  run?: Runner | undefined;
  /** Replaces the HTTP download of the OSM extract (tests inject a fake with failing routes). */
  osmDownload?: OsmDownloader | undefined;
  /** Replaces the shell run of the osmium commands and the `osmium --version` probe (tests). */
  osmShell?: ((cmd: string) => number) | undefined;
  /** Stop after this many rows per Socrata source (tests). */
  rowLimit?: number | undefined;
}

/** The street, SFMTA stop and SFMTA pattern sources of the excerpt are synthetic like its OSM part (no network, M02a2). */
export const SYNTHETIC_ROAD_SOURCES = ['datasf-streets', 'datasf-addresses', 'sfmta-stops', 'sfmta-patterns'] as const;

export const nowIso = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const skip = (log: (l: string) => void, id: string, reason: string): void => log(`SKIP map:fetch ${id}: ${reason}`);

/** Replaces `{name}` and `{a.b}` placeholders from a flat lookup. */
export function fillCommand(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{([a-zA-Z.]+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** The OSM ids of the landmark seeds (`w<id>`, `r<id>`, `n<id>`), one per line, for the `osmium getid` pass (DL-708). */
export function landmarkIdsText(seeds: readonly { osm: string }[]): string {
  const ids = [...new Set(seeds.map((s) => s.osm).filter((o) => /^[wrn]\d+$/.test(o)))].sort();
  return `${ids.join('\n')}\n`;
}

export function osmCommands(cfg: SourcesConfig, dir: string, pbf: string, backdrop = false): string[] {
  const b = cfg.osm.bboxes;
  const vars: Record<string, string | number> = {
    'sf.minLng': b.sf.minLng, 'sf.minLat': b.sf.minLat, 'sf.maxLng': b.sf.maxLng, 'sf.maxLat': b.sf.maxLat,
    'backdrop.minLng': b.backdrop.minLng, 'backdrop.minLat': b.backdrop.minLat, 'backdrop.maxLng': b.backdrop.maxLng, 'backdrop.maxLat': b.backdrop.maxLat,
    dir, pbf, tagFilter: cfg.osm.tagFilter,
  };
  return (backdrop ? cfg.osm.backdropCommands : cfg.osm.commands).map((t) => fillCommand(t, vars));
}

function hasOsmium(shell?: (cmd: string) => number): boolean {
  if (shell) return shell('osmium --version') === 0;
  const r = spawnSync('osmium', ['--version'], { encoding: 'utf8' });
  return !r.error && r.status === 0;
}

/** SHA-256 of a Terrarium set: sorted `<z>/<x>/<y> <sha256 of the PNG>` lines. */
export function terrariumSetSha(dir: string): { sha256: string; rows: number } {
  const tiles = listTileFiles(dir);
  const lines = tiles.map((t) => `${tilePath(t)} ${sha256Text(readFileSync(path.join(dir, tilePath(t))))}`);
  return { sha256: sha256Text(lines.join('\n')), rows: tiles.length };
}

function tilesForBoxes(cfg: SourcesConfig, which: 'core' | 'far'): TileId[] {
  const set = cfg.terrarium[which];
  const b = loadBounds();
  return unionTiles([set.boxes.map((n) => tilesCovering(enuBoxOf(n, b), set.z))].flat());
}

function mergeLock(prev: RawLockFile | null, area: AreaId, entries: RawSourceLock[], syntheticSources: string[] = []): RawLockFile {
  const byId = new Map<string, RawSourceLock>();
  for (const s of prev?.sources ?? []) byId.set(s.id, s);
  for (const e of entries) byId.set(e.id, e);
  const lock: RawLockFile = { schema: 'raw-lock/1', area, synthetic: false, sources: [...byId.values()] };
  if (syntheticSources.length > 0) lock.syntheticSources = [...syntheticSources].sort();
  return lock;
}

// ---- the sf fetch ---------------------------------------------------------------------------------------------------

async function fetchSf(o: FetchOptions, cfg: SourcesConfig, rawDir: string, log: (l: string) => void): Promise<number> {
  const def = cfg.areas.sf;
  const env = o.env ?? process.env;
  const entries: RawSourceLock[] = [];
  const skipped: string[] = [];
  mkdirSync(rawDir, { recursive: true });
  for (const id of def.sources) {
    const s = sourceById(cfg, id);
    try {
      if (s.kind === 'socrata') {
        const file = path.join(rawDir, s.file);
        log(`map:fetch ${id}: ${s.url}${s.select ? ` ($select=${s.select})` : ''}`);
        const rows = await fetchSocrata(s, file, { log, env, ...(o.rowLimit !== undefined ? { limit: o.rowLimit } : {}) });
        entries.push({ id, url: s.url, retrievedAt: nowIso(), sha256: await sha256File(file), rows, licence: s.licence });
      } else if (s.kind === 'terrarium') {
        const dir = path.join(rawDir, s.file);
        const tiles = [...tilesForBoxes(cfg, 'core'), ...tilesForBoxes(cfg, 'far')];
        log(`map:fetch ${id}: ${tiles.length} tiles (z${cfg.terrarium.core.z} over stream and play, z${cfg.terrarium.far.z} over far)`);
        const n = await fetchTiles(s.url, dir, tiles, log);
        const set = terrariumSetSha(dir);
        log(`map:fetch ${id}: ${n} new tiles, ${set.rows} in the set`);
        entries.push({ id, url: s.url, retrievedAt: nowIso(), sha256: set.sha256, rows: set.rows, licence: s.licence });
      } else {
        const file = path.join(rawDir, s.file);
        let extract: RawSourceLock['extract'];
        let servedUrl = s.url;
        let servedAt = nowIso();
        if (existsSync(file)) {
          log(`map:fetch ${id}: using the existing ${s.file} (hand-supplied or earlier osmium export)`);
          const prev = readOsmServed(rawDir);
          if (prev) {
            servedUrl = prev.url;
            servedAt = prev.retrievedAt;
            extract = { sha256: prev.sha256, bytes: prev.bytes, route: prev.routeIndex };
          }
        } else if (!hasOsmium(o.osmShell)) {
          skip(log, id, 'osmium not found on PATH (install osmium-tool, then re-run; commands are in config/world/sources.json osm.commands)');
          skipped.push(id);
          continue;
        } else {
          const got = await ensureOsmPbf(s, rawDir, { download: o.osmDownload, log });
          // S0 merges the landmark Source ids of 02-world-bake.md section 7 into the extract: the tag filter drops some of them (DL-708)
          writeFileSync(path.join(rawDir, 'landmark-ids.txt'), landmarkIdsText(loadContentWorld().landmarks));
          for (const cmd of [...osmCommands(cfg, rawDir, got.pbf), ...osmCommands(cfg, rawDir, got.pbf, true)]) {
            log(`map:fetch ${id}: ${cmd}`);
            const status = o.osmShell ? o.osmShell(cmd) : spawnSync(cmd, { shell: true, stdio: 'inherit' }).status;
            if (status !== 0) throw new Error(`osmium step failed with exit ${status ?? 'null'}: ${cmd}`);
          }
          servedUrl = got.served.url;
          servedAt = got.served.retrievedAt;
          extract = { sha256: got.served.sha256, bytes: got.served.bytes, route: got.served.routeIndex };
          log(`map:fetch ${id}: extract served by ${servedUrl} (sha256 ${got.served.sha256}, ${got.served.bytes} bytes)`);
        }
        entries.push({
          id, url: servedUrl, retrievedAt: servedAt, sha256: await sha256File(file), rows: countLines(file), licence: s.licence,
          ...(extract ? { extract } : {}),
        });
      }
    } catch (e) {
      log(`map:fetch ${id}: FAILED: ${(e as Error).message}`);
      skip(log, id, `download failed (${(e as Error).message.split('\n')[0]})`);
      skipped.push(id);
    }
  }
  const lock = mergeLock(readRawLock(rawDir), 'sf', entries);
  writeRawLock(path.join(rawDir, RAW_LOCK_NAME), lock);
  const complete = def.sources.every((id) => lock.sources.some((x) => x.id === id));
  if (complete) {
    const dest = path.join(o.contentDir ?? path.join(toolsRoot, 'content', 'world'), 'raw.lock.sf.json');
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, rawLockText(lock));
    log(`map:fetch: wrote ${path.relative(toolsRoot, dest)} (${lock.sources.length} sources); commit it`);
  } else {
    log(`map:fetch: raw.lock.json is incomplete (${skipped.join(', ') || 'no entries'}); content/world/raw.lock.sf.json not written`);
  }
  if (o.archive) archive(rawDir, env, o.run ?? spawnRunner, log);
  return 0;
}

/** `--archive`: copies the raw snapshot to tha-bay-private-staging with the separate private R2 token (DL-287). */
export function archive(rawDir: string, env: NodeJS.ProcessEnv, run: Runner, log: (l: string) => void): void {
  const missing = ['R2_PRIVATE_ACCESS_KEY_ID', 'R2_PRIVATE_SECRET_ACCESS_KEY', 'CLOUDFLARE_ACCOUNT_ID'].filter((k) => !env[k]);
  if (missing.length > 0) {
    log(`SKIP map:fetch --archive: ${missing.join(', ')} not set (needs R2_PRIVATE_ACCESS_KEY_ID, R2_PRIVATE_SECRET_ACCESS_KEY, CLOUDFLARE_ACCOUNT_ID)`);
    return;
  }
  if (run('rclone', ['version'], env).status !== 0) {
    log('SKIP map:fetch --archive: rclone binary not found on PATH');
    return;
  }
  const renv: NodeJS.ProcessEnv = {
    ...env,
    RCLONE_CONFIG_R2PRIV_TYPE: 's3',
    RCLONE_CONFIG_R2PRIV_PROVIDER: 'Cloudflare',
    RCLONE_CONFIG_R2PRIV_ENDPOINT: `https://${env['CLOUDFLARE_ACCOUNT_ID'] ?? ''}.r2.cloudflarestorage.com`,
    RCLONE_CONFIG_R2PRIV_ACCESS_KEY_ID: env['R2_PRIVATE_ACCESS_KEY_ID'] ?? '',
    RCLONE_CONFIG_R2PRIV_SECRET_ACCESS_KEY: env['R2_PRIVATE_SECRET_ACCESS_KEY'] ?? '',
    RCLONE_CONFIG_R2PRIV_NO_CHECK_BUCKET: 'true',
  };
  const stamp = nowIso().slice(0, 10);
  const r = run('rclone', ['copy', rawDir, `r2priv:tha-bay-private-staging/map-raw/sf/${stamp}`, '--exclude', '*.pbf', '--immutable', '-v'], renv);
  log(r.status === 0 ? `map:fetch --archive: uploaded to tha-bay-private-staging/map-raw/sf/${stamp}` : `map:fetch --archive FAILED: rclone exited ${r.status}`);
}

// ---- the civic-excerpt cut ------------------------------------------------------------------------------------------

const toBBox = (b: EnuBox, margin: number): BBox => {
  const nw = latLngFromEnu(b.minX - margin, b.minZ - margin);
  const se = latLngFromEnu(b.maxX + margin, b.maxZ + margin);
  return { minLat: se.lat, maxLat: nw.lat, minLng: nw.lng, maxLng: se.lng };
};

function enuRingToCoords(r: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < r.length; i += 2) {
    const p = latLngFromEnu(r[i] as number, r[i + 1] as number);
    out.push([Number(p.lng.toFixed(9)), Number(p.lat.toFixed(9))]);
  }
  out.push(out[0] as number[]);
  return out;
}

/** Clips every polygon of the rows' geometry column to the box; rows with nothing left are dropped. */
export function clipRowsToBox<T extends Record<string, unknown>>(rows: readonly T[], column: string, box: EnuBox): T[] {
  const out: T[] = [];
  for (const row of rows) {
    const polys = polygonsOf(row[column] as never);
    const kept: number[][][][] = [];
    for (const p of polys) {
      const outer = clipRingToBox(p.outer, box);
      if (outer.length < 6) continue;
      const holes = p.holes.map((h) => clipRingToBox(h, box)).filter((h) => h.length >= 6);
      kept.push([enuRingToCoords(outer), ...holes.map(enuRingToCoords)]);
    }
    if (kept.length > 0) out.push({ ...row, [column]: { type: 'MultiPolygon', coordinates: kept } });
  }
  return out;
}

async function cutCivicExcerpt(o: FetchOptions, cfg: SourcesConfig, log: (l: string) => void): Promise<number> {
  const dir = o.rawDir ?? CIVIC_FIXTURE_DIR;
  const box = enuBoxOf(cfg.areas['civic-excerpt'].box);
  const bb = toBBox(box, 40);
  const entries: RawSourceLock[] = [];
  const sources = ['datasf-footprints', 'datasf-neighborhoods', 'datasf-parks', 'datasf-trees'].map((id) => sourceById(cfg, id));
  const tmp = path.join(dir, '.cut');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    for (const s of sources) {
      const file = path.join(dir, s.file);
      const raw = path.join(tmp, s.file);
      const where = s.id === 'datasf-footprints' ? whereWithinBox('shape', bb) : s.id === 'datasf-trees' ? whereLatLng(bb) : undefined;
      log(`map:fetch ${s.id}: ${s.url}${where ? ` where ${where}` : ''}`);
      await fetchSocrata(s, raw, { ...(where ? { where } : {}), log, env: o.env ?? process.env });
      let rows = readJsonl<Record<string, unknown>>(raw);
      if (s.id === 'datasf-footprints') {
        rows = rows.filter((r) => {
          const p = polygonsOf(r['shape'] as never)[0];
          if (!p) return false;
          let cx = 0, cz = 0;
          const n = p.outer.length / 2;
          for (let i = 0; i < n; i++) { cx += p.outer[i * 2] as number; cz += p.outer[i * 2 + 1] as number; }
          cx /= n; cz /= n;
          return cx >= box.minX && cx < box.maxX && cz >= box.minZ && cz < box.maxZ;
        });
      } else if (s.id === 'datasf-trees') {
        rows = rows.filter((r) => {
          const lat = Number(r['latitude']), lng = Number(r['longitude']);
          const p = { x: (lng + 122.4193) * 88083.39, z: -(lat - 37.7793) * 110992.06 };
          return p.x >= box.minX && p.x < box.maxX && p.z >= box.minZ && p.z < box.maxZ;
        });
      } else if (s.geometryColumn) rows = clipRowsToBox(rows, s.geometryColumn, box);
      writeJsonl(file, rows);
      entries.push({ id: s.id, url: s.url, retrievedAt: nowIso(), sha256: await sha256File(file), rows: rows.length, licence: s.licence });
    }
    const t = sourceById(cfg, 'terrarium');
    const tiles = tilesCovering(box, 15);
    const n = await fetchTiles(t.url, path.join(dir, t.file), tiles, log);
    const set = terrariumSetSha(path.join(dir, t.file));
    log(`map:fetch terrarium: ${n} new tiles, ${set.rows} in the excerpt`);
    entries.push({ id: 'terrarium', url: t.url, retrievedAt: nowIso(), sha256: set.sha256, rows: set.rows, licence: t.licence });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  // The OSM part: the synth generator restricted to the square (no Overpass, no Nominatim in the bake).
  const osm = sourceById(cfg, 'osm');
  const gen = path.join(dir, '.gen');
  rmSync(gen, { recursive: true, force: true });
  generateSynth(loadSynth(), cfg, 'civic-excerpt', { outDir: gen, box, restricted: true });
  copyFileSync(path.join(gen, osm.file), path.join(dir, osm.file));
  entries.push({ id: 'osm', url: 'synth://osm', retrievedAt: nowIso(), sha256: await sha256File(path.join(dir, osm.file)), rows: countLines(path.join(dir, osm.file)), licence: 'LicenseRef-DeeVerse-Owned' });
  for (const id of SYNTHETIC_ROAD_SOURCES) {
    const s = sourceById(cfg, id);
    copyFileSync(path.join(gen, s.file), path.join(dir, s.file));
    entries.push({ id, url: `synth://${id}`, retrievedAt: nowIso(), sha256: await sha256File(path.join(dir, s.file)), rows: countLines(path.join(dir, s.file)), licence: 'LicenseRef-DeeVerse-Owned' });
  }
  rmSync(gen, { recursive: true, force: true });
  const lock = mergeLock(null, 'civic-excerpt', entries, ['osm', ...SYNTHETIC_ROAD_SOURCES]);
  writeRawLock(path.join(dir, RAW_LOCK_NAME), lock);
  log(`map:fetch: cut the civic-excerpt into ${path.relative(toolsRoot, dir)} (${entries.map((e) => `${e.id} ${e.rows}`).join(', ')}); OSM part is synthetic`);
  return 0;
}

/** No network: the whole excerpt from the synth generator restricted to the square (README and stamps say synthetic). */
function synthExcerpt(o: FetchOptions, cfg: SourcesConfig, log: (l: string) => void): number {
  const dir = o.rawDir ?? CIVIC_FIXTURE_DIR;
  rmSync(dir, { recursive: true, force: true });
  const box = enuBoxOf(cfg.areas['civic-excerpt'].box);
  const g = generateSynth(loadSynth(), cfg, 'civic-excerpt', { outDir: dir, box, restricted: true });
  log(`map:fetch: civic-excerpt generated from the restricted synth generator (synthetic: true): ${Object.entries(g.stats.rows).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  return 0;
}

export async function runFetch(o: FetchOptions): Promise<number> {
  const log = o.log ?? ((l: string) => console.log(l));
  const cfg = o.cfg ?? loadSources();
  const env = o.env ?? process.env;
  const def = cfg.areas[o.area];
  if (o.area === 'synth') {
    log('map:fetch: synth sources are generated by map:build (no network); nothing to fetch');
    return 0;
  }
  if (env['DV_MAP_OFFLINE'] === '1') {
    for (const id of def.sources) skip(log, id, 'offline');
    return 0;
  }
  if (o.area === 'civic-excerpt') {
    if (!o.fixture) {
      log(`map:fetch: the civic-excerpt raw files are committed under ${path.relative(toolsRoot, CIVIC_FIXTURE_DIR)}; pass --fixture to re-cut them`);
      return 0;
    }
    try {
      return await cutCivicExcerpt(o, cfg, log);
    } catch (e) {
      log(`map:fetch: network cut failed (${(e as Error).message.split('\n')[0]}); generating a synthetic excerpt instead`);
      return synthExcerpt(o, cfg, log);
    }
  }
  return fetchSf(o, cfg, o.rawDir ?? rawDirOf('sf'), log);
}
