/**
 * `map:geocode` (M02c2): the offline geocoder of `sf-geocode.v1` on the command line, with the same `Geocoder` class the game uses.
 *
 *   pnpm map:geocode -- "<text>" [--area <id> | --bake <id>] [--limit <n>]
 *   pnpm map:geocode -- --sample <n> [--area <id> | --bake <id>]
 *
 * `--sample n` takes n seeded EAS rows of the area's raw snapshot, geocodes each address string and checks that the result lies
 * within 10 m of the row and on the row's `cnn`. It prints one line per row and writes `docs/bake-runs/M02c2/notes.json`
 * (the numbers the operator commits for AC-11).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { enuFromLatLng } from '../../../packages/shared/src/index.ts';
import { Geocoder } from '../../../packages/world/src/sim/map/geocoder.ts';
import { toolsRoot } from '../../ci/lib/common.ts';
import { resolveBake } from './cli.ts';
import { isAreaId, rawDirOf } from './config.ts';
import { readJsonl } from './sources/socrata.ts';
import { parseAddressNumber, type EasRow } from './stages/s12-geocode.ts';
import { GEOCODE_TOLERANCE_M, seededSample } from './verify/map-verify.ts';
import { stableJson } from './util.ts';

const NOTES = path.join(toolsRoot, 'docs', 'bake-runs', 'M02c2', 'notes.json');

export async function runGeocodeCommand(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { area: { type: 'string' }, bake: { type: 'string' }, sample: { type: 'string' }, limit: { type: 'string', default: '5' }, notes: { type: 'string' } },
  });
  const area = values.area ?? 'civic-excerpt';
  if (values.area !== undefined && !isAreaId(values.area)) {
    console.error(`map:geocode: unknown area ${values.area} (sf, civic-excerpt or synth)`);
    return 2;
  }
  const sel = resolveBake({ bake: values.bake, area: values.bake ? undefined : area });
  if (typeof sel === 'string') {
    console.error(`map:geocode: ${sel}`);
    return 1;
  }
  const file = path.join(sel.dir, 'packs', 'sf-geocode.v1.pack');
  if (!existsSync(file)) {
    console.error(`map:geocode: ${path.relative(toolsRoot, file)} does not exist; run pnpm map:build -- --area ${area}`);
    return 1;
  }
  const geo = Geocoder.fromBytes(readFileSync(file));

  if (values.sample !== undefined) {
    const n = Math.max(1, Math.floor(Number(values.sample)));
    if (!Number.isFinite(n)) {
      console.error('usage: map:geocode -- --sample <n> [--area <id>]');
      return 2;
    }
    const rawFile = path.join(rawDirOf(area as never), 'ramy-di5m.jsonl');
    if (!existsSync(rawFile)) {
      console.error(`map:geocode --sample: ${rawFile} does not exist`);
      return 1;
    }
    const rows = readJsonl<EasRow>(rawFile).filter((r) => parseAddressNumber(r.address ?? '', r.address_number) && Number(r.cnn) > 0 && !(r.address ?? '').includes('#'));
    // only addresses the geocoder holds (the box and the base-address rule drop some)
    const keyed = rows.filter((r) => {
      const num = parseAddressNumber(r.address ?? '', r.address_number);
      return num !== null && geo.address(r.address ?? '', 1).some((h) => h.exact);
    });
    keyed.sort((a, b) => Number(a.eas_baseid) - Number(b.eas_baseid));
    const pick = seededSample(sel.bakeId, 'geocode-cli', keyed.length, n);
    let bad = 0;
    let worst = 0;
    const lines: string[] = [];
    for (const i of pick) {
      const r = keyed[i] as EasRow;
      const p = enuFromLatLng(Number(r.latitude), Number(r.longitude));
      const hits = geo.address(r.address ?? '', 3).filter((h) => h.exact);
      const best = hits.find((h) => h.cnn === Number(r.cnn)) ?? hits[0];
      const d = best ? Math.hypot(best.x - p.x, best.z - p.z) : Infinity;
      const ok = best !== undefined && d <= GEOCODE_TOLERANCE_M && best.cnn === Number(r.cnn);
      if (!ok) bad++;
      worst = Math.max(worst, Number.isFinite(d) ? d : 1e9);
      lines.push(`${ok ? 'ok  ' : 'FAIL'} ${r.address} cnn ${r.cnn} -> ${best ? `${best.label} cnn ${best.cnn} ${d.toFixed(2)} m` : 'no result'}`);
    }
    for (const l of lines) console.log(l);
    console.log(`map:geocode --sample: ${pick.length} of ${keyed.length} base addresses, ${bad} failing, worst ${worst.toFixed(2)} m (limit ${GEOCODE_TOLERANCE_M} m)`);
    const report = JSON.parse(readFileSync(path.join(sel.dir, 'bake-report.json'), 'utf8')) as { bakeId: string; area: string; map?: { mapBytes: number; bldgBytes: number; streets: { cnns: number; kept: number } }; geocode?: { addresses: number; bytes: number }; gates: { id: string; level: string; detail: string }[] };
    const notes = {
      schema: 'bake-run-notes/1',
      milestone: 'M02c2',
      area,
      bakeId: report.bakeId,
      sfMapBytes: report.map?.mapBytes ?? null,
      sfMapBldgBytes: report.map?.bldgBytes ?? null,
      streetSegments: report.map?.streets.cnns ?? null,
      geocodeBytes: report.geocode?.bytes ?? null,
      baseAddresses: report.geocode?.addresses ?? null,
      mapGates: report.gates.filter((g) => g.id.startsWith('s12.')).map((g) => ({ id: g.id, level: g.level, detail: g.detail })),
      geocodeSample: { requested: n, checked: pick.length, failing: bad, worstM: Math.round(worst * 100) / 100, toleranceM: GEOCODE_TOLERANCE_M },
    };
    const out = values.notes ? path.resolve(values.notes) : NOTES;
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, stableJson(notes));
    console.log(`map:geocode --sample: wrote ${path.relative(toolsRoot, out)}`);
    return bad === 0 ? 0 : 1;
  }

  const text = positionals.join(' ').trim();
  if (text === '') {
    console.error('usage: map:geocode -- "<text>" [--area <id>] | --sample <n> [--area <id>]');
    return 2;
  }
  const hits = geo.search(text, Math.max(1, Number(values.limit) || 5));
  if (hits.length === 0) {
    console.log(`map:geocode: no result for "${text}" in bake ${sel.bakeId.slice(0, 12)}`);
    return 1;
  }
  for (const h of hits) console.log(`${h.kind.padEnd(8)} ${h.label}  x ${h.x.toFixed(1)} z ${h.z.toFixed(1)}${h.cnn ? ` cnn ${h.cnn}` : ''}${h.exact ? '' : '  (nearest number)'}`);
  return 0;
}

