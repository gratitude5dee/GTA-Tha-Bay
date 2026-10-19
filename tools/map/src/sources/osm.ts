/**
 * OSM extract download with mirrors (DL-703). The primary `url` of source `osm` is tried first; on any failure (connection reset,
 * HTTP error, truncated body) each entry of `mirrors` is tried in order. Every route serves the same OpenStreetMap data under
 * ODbL-1.0, so the lock only has to say which URL served the bytes and their SHA-256.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { assertAllowedHost, type SourceDef } from '../config.ts';
import { sha256File } from '../raw-lock.ts';

/** Downloads `url` into `file` (any previous content is replaced) or throws. Injected in tests. */
export type OsmDownloader = (url: string, file: string) => Promise<void>;

export const PBF_NAME = 'osm-source.osm.pbf';
export const PBF_META_NAME = 'osm-source.json';

export interface OsmServed {
  /** The URL whose bytes are in the PBF. */
  url: string;
  sha256: string;
  bytes: number;
  /** 0 for the primary, 1.. for the mirrors in order. */
  routeIndex: number;
  /** ISO-8601 Z. */
  retrievedAt: string;
}

export const defaultDownloader: OsmDownloader = async (url, file) => {
  assertAllowedHost(url);
  const res = await fetch(url, { headers: { 'user-agent': 'tha-bay-map-bake/0.3' } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const want = Number(res.headers.get('content-length') ?? '');
  mkdirSync(path.dirname(file), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
  if (Number.isFinite(want) && want > 0 && statSync(file).size !== want) throw new Error(`truncated body for ${url}: ${statSync(file).size} of ${want} bytes`);
};

/** The sidecar of an earlier download in `dir`, or null (a hand-supplied export has none). */
export function readOsmServed(dir: string): OsmServed | null {
  const meta = path.join(dir, PBF_META_NAME);
  return existsSync(meta) ? (JSON.parse(readFileSync(meta, 'utf8')) as OsmServed) : null;
}

/** Routes in the order they are tried: the primary URL, then each mirror. */
export function osmRoutes(def: Pick<SourceDef, 'url' | 'mirrors'>): { url: string; coverage: string }[] {
  return [{ url: def.url, coverage: 'primary' }, ...(def.mirrors ?? []).map((m) => ({ url: m.url, coverage: m.coverage }))];
}

const nowIso = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Makes sure `<dir>/osm-source.osm.pbf` exists and says which route served it (`osm-source.json` next to it). A PBF with its
 * sidecar is reused as is. Otherwise routes are tried in order; failures are logged and the next route follows. Throws with
 * every failure listed when none answers.
 */
export async function ensureOsmPbf(
  def: Pick<SourceDef, 'id' | 'url' | 'mirrors'>,
  dir: string,
  o: { download?: OsmDownloader | undefined; log?: ((l: string) => void) | undefined; now?: (() => string) | undefined } = {},
): Promise<{ pbf: string; served: OsmServed; reused: boolean }> {
  const log = o.log ?? (() => {});
  const download = o.download ?? defaultDownloader;
  const pbf = path.join(dir, PBF_NAME);
  const meta = path.join(dir, PBF_META_NAME);
  if (existsSync(pbf) && existsSync(meta)) {
    const served = JSON.parse(readFileSync(meta, 'utf8')) as OsmServed;
    log(`map:fetch ${def.id}: using the downloaded ${PBF_NAME} (served by ${served.url})`);
    return { pbf, served, reused: true };
  }
  mkdirSync(dir, { recursive: true });
  const routes = osmRoutes(def);
  const failures: string[] = [];
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i] as { url: string; coverage: string };
    const part = `${pbf}.part`;
    try {
      log(`map:fetch ${def.id}: downloading ${r.url}${i > 0 ? ` (mirror ${i} of ${routes.length - 1}, coverage ${r.coverage})` : ''}`);
      rmSync(part, { force: true });
      await download(r.url, part);
      renameSync(part, pbf);
      const served: OsmServed = { url: r.url, sha256: await sha256File(pbf), bytes: statSync(pbf).size, routeIndex: i, retrievedAt: (o.now ?? nowIso)() };
      writeFileSync(meta, `${JSON.stringify(served, null, 2)}\n`);
      return { pbf, served, reused: false };
    } catch (e) {
      rmSync(part, { force: true });
      const msg = (e as Error).message.split('\n')[0] ?? 'failed';
      failures.push(`${r.url}: ${msg}`);
      log(`map:fetch ${def.id}: ${r.url} failed (${msg})${i < routes.length - 1 ? '; trying the next route' : ''}`);
    }
  }
  throw new Error(`no OSM route answered:\n  ${failures.join('\n  ')}`);
}
