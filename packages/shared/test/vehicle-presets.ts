import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { HandlingProfile } from '../src/vehicle/index.ts';

const DIR = path.join(import.meta.dirname, '../../../content/vehicles/handling');

/** Every `content/vehicles/handling/*.json`, parsed, in file order. */
export function loadPresets(): { file: string; p: HandlingProfile }[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({ file, p: JSON.parse(readFileSync(path.join(DIR, file), 'utf8')) as HandlingProfile }));
}
