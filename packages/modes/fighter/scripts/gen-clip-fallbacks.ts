/**
 * `pnpm --filter @dv/mode-fighter fighter:gen-clip-fallbacks [-- --check]`
 * Writes `content/fighter/clip-fallbacks.json` (M10a2, FX7): for every kit, the library clip each move plays while no authored clip exists in
 * `anim/<slug>.moves` (Q-24: the art lead's signature clips are not in yet). The library is the procedural pose set of the presenter
 * (`libraryClipId` in `src/ui/clips.ts`), so the table is a pure function of the kits and the presenter. `check:fighter` runs `--check` and
 * requires every move id of every kit to have either a clip in its moves file or an entry here. Frame data never depends on this file.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FighterDef, MoveDef } from '@dv/shared/fight';
import { args } from '../../../../tools/ci/run.ts';
import { LIBRARY_SHAPES, libraryClipId } from '../src/ui/clips.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const FALLBACK_FILE = 'content/fighter/clip-fallbacks.json';

export interface ClipFallbacks {
  schema: 'clip-fallbacks/1';
  /** What the values are: `<shape>.<strength>` of the procedural library. */
  library: string;
  shapes: string[];
  /** kit id -> move id -> library clip id. */
  kits: Record<string, Record<string, string>>;
}

/** Every move of a kit that needs a clip: the moves, the supers, the shutdown and the taunt. */
export const kitMoves = (kit: FighterDef): MoveDef[] => [...kit.moves, ...kit.supers, kit.shutdown, kit.taunt];

export function buildFallbacks(rootDir: string): ClipFallbacks {
  const dir = path.join(rootDir, 'content/fighter/kits');
  const kits: ClipFallbacks['kits'] = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const kit = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as FighterDef & { kit?: string };
    const id = f.replace(/\.json$/, '');
    if (id === 'player') continue;
    kits[id] = Object.fromEntries(kitMoves(kit).map((m) => [m.id, libraryClipId(m)]));
  }
  return { schema: 'clip-fallbacks/1', library: 'procedural pose library of the presenter: <shape>.<strength> (packages/modes/fighter/src/ui/clips.ts)', shapes: [...LIBRARY_SHAPES], kits };
}

const render = (c: ClipFallbacks): string => `${JSON.stringify(c, null, 2)}\n`;

function main(): void {
  const check = args().includes('--check');
  const want = render(buildFallbacks(root));
  const file = path.join(root, FALLBACK_FILE);
  if (check) {
    const have = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (have !== want) {
      console.error(`${FALLBACK_FILE} differs from the kits: run pnpm --filter @dv/mode-fighter fighter:gen-clip-fallbacks`);
      process.exit(1);
    }
    console.log(`${FALLBACK_FILE}: ok`);
    return;
  }
  writeFileSync(file, want);
  console.log(`wrote ${FALLBACK_FILE}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
