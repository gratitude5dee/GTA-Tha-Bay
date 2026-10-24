/**
 * `pnpm --filter @dv/mode-fighter fighter:replay -- <file.dvfight>... [--kit <kit.json>] [--force]`
 * Re-simulates each replay against the frame-data pack built from config/fighter.tuning.json and content/fighter/kits/
 * (or the one `--kit` file for the PLAYER_FIGHTER slot), compares every 60-tick checkpoint and the final result.
 * `--force` re-simulates even when the frame-data hash differs, to name the first bad checkpoint. Exit 1 on any mismatch.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { args } from '../../../../tools/ci/run.ts';
import type { FighterDef } from '@dv/shared/fight';
import { decodeReplay, verifyReplay } from '@dv/shared/fight';
import { loadPack } from '../src/pack-files.ts';
import { lintReplay } from '../src/lint/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const argv = args();
const kitAt = argv.indexOf('--kit');
const kitFile = kitAt >= 0 ? argv[kitAt + 1] : undefined;
const force = argv.includes('--force');
const files = argv.filter((a, i) => !a.startsWith("--") && (kitAt < 0 || i !== kitAt + 1));
if (files.length === 0) { console.error('usage: fighter:replay -- <file.dvfight>... [--kit <kit.json>] [--force]'); process.exit(2); }

const pack = loadPack(root, kitFile === undefined ? undefined : { PLAYER_FIGHTER: JSON.parse(readFileSync(path.resolve(kitFile), 'utf8')) as FighterDef });
let failed = 0;
for (const f of files) {
  const text = readFileSync(path.resolve(f), 'utf8');
  const schema = lintReplay(JSON.parse(text) as unknown);
  if (schema.length > 0) { failed++; for (const i of schema) console.error(`FAIL ${f} [schema] ${i.where}: ${i.message}`); continue; }
  const r = verifyReplay(pack, decodeReplay(text), force);
  if (r.ok) console.log(`ok   ${f}: ${r.ticks} ticks, every checkpoint matches, winner ${r.winner}, rounds ${r.rounds.join('-')}`);
  else {
    failed++;
    console.error(`FAIL ${f} [${r.code}]${r.checkpoint !== undefined ? ` checkpoint ${r.checkpoint}` : ''}${r.tick !== undefined ? ` tick ${r.tick}` : ''}: ${r.detail}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
