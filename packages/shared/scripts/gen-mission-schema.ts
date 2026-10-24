/** Writes (or with --check, verifies) packages/shared/schemas/mission-ir-1.schema.json from scripts/mission-ir-schema.ts. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { missionIrSchema } from './mission-ir-schema.ts';

const file = path.join(import.meta.dirname, '../schemas/mission-ir-1.schema.json');
const text = `${JSON.stringify(missionIrSchema(), null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (!existsSync(file) || readFileSync(file, 'utf8') !== text) {
    console.error('mission-ir-1.schema.json differs from scripts/mission-ir-schema.ts: run `pnpm --filter @dv/shared schema:mission`');
    process.exit(1);
  }
  console.log('mission-ir-1.schema.json ok');
} else {
  writeFileSync(file, text);
  console.log(`wrote ${path.relative(process.cwd(), file)} (${text.length} bytes)`);
}
