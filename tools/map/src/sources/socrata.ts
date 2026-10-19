/**
 * DataSF Socrata datasets: paged fetch with `$order=:id&$limit=45000&$offset=...` [research/repos-world.md section 1.2],
 * JSON Lines storage (one row per line, sorted by :id by the server) and readers. The optional app token comes from
 * SOCRATA_APP_TOKEN in the shell environment and is never written to outputs.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BBox, SourceDef } from '../config.ts';
import { fetchBuffer } from './net.ts';

export const SOCRATA_PAGE = 45000;

export interface SocrataFetchOptions {
  where?: string;
  limit?: number;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
}

export function socrataUrl(def: SourceDef, params: Record<string, string>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) q.set(k, v);
  // URLSearchParams encodes '$' and ':'; Socrata accepts both forms.
  return `${def.url}?${q.toString()}`;
}

/** Fetches every page into `file` (JSON Lines) and returns the row count. */
export async function fetchSocrata(def: SourceDef, file: string, o: SocrataFetchOptions = {}): Promise<number> {
  const env = o.env ?? process.env;
  const headers: Record<string, string> = {};
  if (env['SOCRATA_APP_TOKEN']) headers['X-App-Token'] = env['SOCRATA_APP_TOKEN'];
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '');
  let offset = 0;
  let rows = 0;
  const pageSize = o.limit ? Math.min(SOCRATA_PAGE, o.limit) : SOCRATA_PAGE;
  for (;;) {
    const params: Record<string, string> = { $order: ':id', $limit: String(pageSize), $offset: String(offset) };
    if (def.select) params['$select'] = def.select;
    if (o.where) params['$where'] = o.where;
    const body = await fetchBuffer(socrataUrl(def, params), { headers });
    const page = JSON.parse(body.toString('utf8')) as unknown[];
    if (!Array.isArray(page)) throw new Error(`${def.id}: Socrata did not return an array`);
    if (page.length > 0) appendFileSync(file, `${page.map((r) => JSON.stringify(r)).join('\n')}\n`);
    rows += page.length;
    offset += page.length;
    o.log?.(`map:fetch ${def.id}: ${rows} rows`);
    if (page.length < pageSize || (o.limit !== undefined && rows >= o.limit)) break;
  }
  return rows;
}

/** WHERE clause that keeps rows of a geometry column inside a lat/lng box. */
export function whereWithinBox(column: string, b: BBox): string {
  return `within_box(${column}, ${b.maxLat}, ${b.minLng}, ${b.minLat}, ${b.maxLng})`;
}
/** WHERE clause for tables with plain latitude and longitude columns. */
export function whereLatLng(b: BBox): string {
  return `latitude between ${b.minLat} and ${b.maxLat} and longitude between ${b.minLng} and ${b.maxLng}`;
}

/** Reads a JSON Lines file; a missing file is an error. */
export function readJsonl<T = Record<string, unknown>>(file: string): T[] {
  if (!existsSync(file)) throw new Error(`missing raw file ${file}`);
  const text = readFileSync(file, 'utf8');
  const out: T[] = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    const end = nl < 0 ? text.length : nl;
    if (end > start) out.push(JSON.parse(text.slice(start, end)) as T);
    if (nl < 0) break;
    start = nl + 1;
  }
  return out;
}

export function countLines(file: string): number {
  const text = readFileSync(file, 'utf8');
  let n = 0;
  for (const line of text.split('\n')) if (line.length > 0) n++;
  return n;
}

export function writeJsonl(file: string, rows: readonly unknown[]): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, rows.length === 0 ? '' : `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
}
