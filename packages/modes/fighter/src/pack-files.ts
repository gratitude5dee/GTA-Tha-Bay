/**
 * Builds the FrameDataPack from the repository files (config/fighter.tuning.json and content/fighter/kits/*.json).
 * Node only: the tools and the tests use it; the sim never reads files.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildPack } from '@dv/shared/fight';
import type { FighterDef, FightTuning, FrameDataPack } from '@dv/shared/fight';

export function loadPack(root: string, override?: Record<string, FighterDef>): FrameDataPack {
  const tuning = JSON.parse(readFileSync(path.join(root, 'config', 'fighter.tuning.json'), 'utf8')) as FightTuning;
  const dir = path.join(root, 'content', 'fighter', 'kits');
  const kits: Record<string, FighterDef> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const kit = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as FighterDef;
    kits[kit.slot] = kit;
  }
  return buildPack({ ...kits, ...override }, tuning);
}
