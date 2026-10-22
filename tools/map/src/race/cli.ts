/**
 * `pnpm map:races compile|validate [-- <raceId>]` (M07a1; 06-racing.md 2.7).
 *
 *   map:races compile  [<raceId>] [--area sf]   source.json + the bake -> race.json (+ corridor.bin); needs a finished bake
 *   map:races validate [<raceId>] [--json]      V1 to V11, V13 to V15 on every race, or one; without a bake the rules that need
 *                                               the road graph are skipped and the run says so
 *
 * Races live in `content/races/<id>/{source.json, race.json, corridor.bin}`. Exit 0 when every race passes, 1 on a finding or an
 * error, 2 on a usage error. A missing bake is not an error for `validate` (it prints SKIP for the graph rules); `compile` needs it.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { RaceDef, RaceSource, RaceValidationReport } from '../../../../packages/shared/src/index.ts';
import { args } from '../../../ci/run.ts';
import { isMain, toolsRoot } from '../../../ci/lib/common.ts';
import { buildCorridor } from './corridor.ts';
import { compileRace, CompileError, raceJson } from './compile.ts';
import { findBake, openBake, type BakeGraph } from './snap.ts';
import { schemaFindings, validateRace } from './validate.ts';

export const RACES_DIR = path.join(toolsRoot, 'content', 'races');

export function raceIds(dir = RACES_DIR): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(path.join(dir, d, 'source.json'))).sort() : [];
}

const readJson = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T;

export function compileOne(id: string, bg: BakeGraph, dir = RACES_DIR): { def: RaceDef; json: string; corridor: Uint8Array; lengthM: number } {
  const source = readJson<RaceSource>(path.join(dir, id, 'source.json'));
  const bad = schemaFindings('race-source', source);
  if (bad.length > 0) throw new CompileError('V0', bad.map((b) => b.message).join('; '));
  const c = compileRace(source, bg);
  return { def: c.def, json: raceJson(c.def), corridor: buildCorridor(bg, c.samples), lengthM: c.stats.lengthM };
}

export function runCompile(argv: readonly string[]): number {
  const { positionals, values } = parseArgs({ args: [...argv], allowPositionals: true, options: { area: { type: 'string', default: 'sf' } } });
  const bake = findBake(values.area);
  if (!bake) {
    console.error(`map:races compile: no finished ${values.area} bake in dist/world; run pnpm map:build -- --area ${values.area} first`);
    return 1;
  }
  const bg = openBake(bake);
  const ids = positionals.length > 0 ? positionals : raceIds();
  let code = 0;
  for (const id of ids) {
    try {
      const r = compileOne(id, bg);
      writeFileSync(path.join(RACES_DIR, id, 'race.json'), r.json);
      writeFileSync(path.join(RACES_DIR, id, 'corridor.bin'), r.corridor);
      console.log(`map:races compile: ${id} ${r.lengthM.toFixed(0)} m, ${r.def.gates.length} gates, race.json ${Buffer.byteLength(r.json)} B, corridor.bin ${r.corridor.length} B, bake ${bake.bakeId.slice(0, 12)}`);
    } catch (e) {
      console.error(`map:races compile: ${id}: ${(e as Error).message}`);
      code = 1;
    }
  }
  return code;
}

export function validateId(id: string, bg: BakeGraph | null, dir = RACES_DIR): RaceValidationReport {
  const source = readJson<RaceSource>(path.join(dir, id, 'source.json'));
  const raceFile = path.join(dir, id, 'race.json');
  const json = existsSync(raceFile) ? readFileSync(raceFile, 'utf8') : undefined;
  const def = json ? (JSON.parse(json) as RaceDef) : null;
  const report = validateRace({ source, def, ...(json !== undefined ? { json } : {}), bg });
  const bad = [...schemaFindings('race-source', source), ...(def ? schemaFindings('race-def', def) : [])];
  if (!def) bad.push({ rule: 'V0', level: 'error', message: 'race.json is missing; run pnpm map:races compile' });
  report.findings.unshift(...bad);
  report.ok = !report.findings.some((x) => x.level === 'error');
  return report;
}

export function runValidate(argv: readonly string[]): number {
  const { positionals, values } = parseArgs({ args: [...argv], allowPositionals: true, options: { json: { type: 'boolean', default: false }, area: { type: 'string', default: 'sf' } } });
  const ids = positionals.length > 0 ? positionals : raceIds();
  if (ids.length === 0) {
    console.error('map:races validate: no races in content/races');
    return 1;
  }
  const bake = findBake(values.area);
  const bg = bake ? openBake(bake) : null;
  if (!bg) console.log(`SKIP map:races validate: no ${values.area} bake in dist/world, so V1, V2 and V7 (the graph rules) are not checked here; they run next to map:verify`);
  const reports: RaceValidationReport[] = [];
  for (const id of ids) reports.push(validateId(id, bg));
  if (values.json) console.log(JSON.stringify(reports, null, 2));
  else {
    for (const r of reports) {
      for (const x of r.findings) console.log(`${x.level.toUpperCase().padEnd(5)} ${r.id} ${x.rule}: ${x.message}`);
      console.log(`map:races validate: ${r.id} ${r.ok ? 'ok' : 'FAIL'} (${r.stats.lengthM.toFixed(0)} m, ${r.stats.gates} gates, max grade ${r.stats.maxGradePct} %)`);
    }
  }
  return reports.every((r) => r.ok) ? 0 : 1;
}

export function main(argv: readonly string[]): number {
  const [cmd, ...rest] = argv;
  if (cmd === 'compile') return runCompile(rest);
  if (cmd === 'validate') return runValidate(rest);
  console.error('usage: map:races compile|validate [-- <raceId>] [--area sf] [--json]');
  return 2;
}

if (isMain(import.meta.url)) process.exit(main(args()));
