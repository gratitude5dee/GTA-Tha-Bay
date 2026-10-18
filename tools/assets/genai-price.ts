/**
 * genai:price. Monthly price check [spec/domains/05-assets-pipeline.md section 9]: GET https://api.fal.ai/v1/models/pricing
 * (needs FAL_KEY) and report registry prices that differ from the live price by more than 5 %.
 * The response shape is not in the ledger: rows are found defensively (any object with an endpoint id and a numeric
 * price field); an unknown shape is reported as "unparsed" and the script exits 0.
 *
 *   tsx tools/assets/genai-price.ts                    live (FAL_KEY required; without it: SKIP, exit 0)
 *   tsx tools/assets/genai-price.ts --fixture <file>   read a recorded response instead of the network
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { GenAiRegistry } from '../../packages/shared/src/genai/registry.ts';
import { args } from '../ci/run.ts';
import { isMain, readJson, toolsRoot } from '../ci/lib/common.ts';

const API = 'https://api.fal.ai/v1/models/pricing';
export const THRESHOLD = 0.05;

export interface PriceDiff { id: string; registryUsd: number; liveUsd: number; pct: number }
export interface PriceReport { diffs: PriceDiff[]; compared: number; unparsed: boolean; unpriced: string[] }

interface LiveRow { id: string; usd: number }

/** Pulls { endpoint id, price } rows out of an unknown JSON shape. */
export function extractRows(body: unknown): LiveRow[] {
  const rows: LiveRow[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const id = typeof o.endpoint_id === 'string' ? o.endpoint_id : typeof o.id === 'string' && o.id.includes('/') ? o.id : null;
      const price = [o.unit_price, o.price, o.usd, o.unitPrice].find((x): x is number => typeof x === 'number');
      if (id && price !== undefined && !seen.has(id)) {
        seen.add(id);
        rows.push({ id, usd: price });
      } else for (const x of Object.values(o)) walk(x);
    }
  };
  walk(body);
  return rows;
}

/** Pure: compare registry prices with the live rows. A registry price of 0 means "not set yet" and is listed, not compared. */
export function diffPrices(reg: GenAiRegistry, body: unknown, threshold = THRESHOLD): PriceReport {
  const rows = extractRows(body);
  if (rows.length === 0) return { diffs: [], compared: 0, unparsed: true, unpriced: [] };
  const live = new Map(rows.map((r) => [r.id, r.usd]));
  const diffs: PriceDiff[] = [];
  const unpriced: string[] = [];
  let compared = 0;
  const check = (id: string, registryUsd: number): void => {
    const l = live.get(id);
    if (l === undefined) return;
    if (registryUsd === 0) {
      unpriced.push(id);
      return;
    }
    compared++;
    const pct = (l - registryUsd) / registryUsd;
    if (Math.abs(pct) > threshold) diffs.push({ id, registryUsd, liveUsd: l, pct });
  };
  for (const e of Object.values(reg.endpoints)) if (e.vendor === 'fal') check(e.id, e.price.usd);
  for (const p of Object.values(reg.videoProviders)) for (const id of Object.values(p.endpoints)) if (id) check(id, p.price.usdPerS);
  return { diffs, compared, unparsed: false, unpriced };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ args: args(), options: { fixture: { type: 'string' }, root: { type: 'string' } } });
  const root = path.resolve(values.root ?? toolsRoot);
  const reg = readJson<GenAiRegistry>(path.join(root, 'config', 'genai-endpoints.json'));
  let body: unknown;
  if (values.fixture) body = JSON.parse(readFileSync(path.resolve(values.fixture), 'utf8'));
  else {
    const key = process.env.FAL_KEY;
    if (!key) {
      console.log('SKIP genai:price: FAL_KEY not set');
      process.exit(0);
    }
    const ids = Object.values(reg.endpoints).filter((e) => e.vendor === 'fal').map((e) => `endpoint_id=${encodeURIComponent(e.id).replace(/%2F/g, '/')}`);
    const res = await fetch(`${API}?${ids.join('&')}`, { headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(30_000) }).catch((e: Error) => e);
    if (res instanceof Error) {
      console.log(`genai:price: unreachable (${res.message})`);
      process.exit(0);
    }
    body = await res.json().catch(() => null);
    if (!res.ok) {
      console.log(`genai:price: unparsed (HTTP ${res.status})`);
      process.exit(0);
    }
  }
  const report = diffPrices(reg, body);
  if (report.unparsed) console.log('genai:price: unparsed (no endpoint/price rows in the response)');
  for (const d of report.diffs) console.log(`DIFF ${d.id}: registry $${d.registryUsd} live $${d.liveUsd} (${(d.pct * 100).toFixed(1)} %)`);
  for (const id of report.unpriced) console.log(`note ${id}: registry price is 0 (not set); not compared`);
  if (!report.unparsed) console.log(`genai:price: ${report.diffs.length} of ${report.compared} compared prices differ by more than ${THRESHOLD * 100} %`);
  process.exit(0);
}

if (isMain(import.meta.url)) void main();
