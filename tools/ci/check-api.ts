/**
 * pnpm check:api (M05d, 09-backend-ops.md section 2): regenerates packages/shared/schemas/api/<Type>.schema.json from the exported
 * request and response types of packages/shared/src/api/v1.ts and fails on drift.
 *
 *   tsx tools/ci/check-api.ts [--write]
 *
 * One schema file per exported interface or type alias of v1.ts (constants are not DTOs). The generator is ts-json-schema-generator
 * (the version pnpm resolves, recorded in spec/03). --write rewrites the directory (and removes schemas of types that no longer
 * exist); without it the committed files are compared and any difference, missing file or stale file fails the run.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createGenerator } from 'ts-json-schema-generator';
import { args, repoRoot } from './run.ts';

export const SOURCE = 'packages/shared/src/api/v1.ts';
export const SCHEMA_DIR = 'packages/shared/schemas/api';

/** Names of the exported interfaces and type aliases of a source text, in file order. */
export function dtoNames(source: string): string[] {
  const names: string[] = [];
  for (const m of source.matchAll(/^export\s+(?:interface|type)\s+([A-Za-z0-9_]+)/gm)) names.push(m[1]!);
  return names;
}

/** Stable JSON: keys in the order the generator emits them, two-space indent, trailing newline. */
const render = (schema: unknown): string => `${JSON.stringify(schema, null, 2)}\n`;

export interface Generated {
  files: Map<string, string>;
  errors: string[];
}

export function generate(root: string = repoRoot, source: string = SOURCE): Generated {
  const file = path.join(root, source);
  const files = new Map<string, string>();
  const errors: string[] = [];
  for (const name of dtoNames(readFileSync(file, 'utf8'))) {
    try {
      const schema = createGenerator({
        path: file,
        tsconfig: path.join(root, 'tsconfig.base.json'),
        type: name,
        expose: 'none',
        topRef: false,
        skipTypeCheck: true,
        // Structure only: a doc-comment edit in v1.ts must not read as an API change.
        jsDoc: 'none',
        additionalProperties: false,
      }).createSchema(name);
      files.set(`${name}.schema.json`, render(schema));
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  }
  return { files, errors };
}

/** Differences between generated files and a directory: missing, changed and stale file names. */
export function compare(generated: Map<string, string>, dir: string): { missing: string[]; changed: string[]; stale: string[] } {
  const have = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.schema.json')) : [];
  const missing: string[] = [];
  const changed: string[] = [];
  for (const [name, text] of generated) {
    if (!have.includes(name)) missing.push(name);
    else if (readFileSync(path.join(dir, name), 'utf8') !== text) changed.push(name);
  }
  return { missing, changed, stale: have.filter((n) => !generated.has(n)) };
}

export function main(argv: string[]): number {
  const { values } = parseArgs({ args: argv, options: { write: { type: 'boolean', default: false } } });
  const { files, errors } = generate();
  for (const e of errors) console.log(`check:api: FAIL cannot generate a schema for ${e}`);
  if (errors.length > 0) return 1;
  const dir = path.join(repoRoot, SCHEMA_DIR);
  if (values.write) {
    mkdirSync(dir, { recursive: true });
    for (const stale of compare(files, dir).stale) rmSync(path.join(dir, stale));
    for (const [name, text] of files) writeFileSync(path.join(dir, name), text);
    console.log(`check:api: wrote ${files.size} schemas to ${SCHEMA_DIR}`);
    return 0;
  }
  const d = compare(files, dir);
  for (const n of d.missing) console.log(`check:api: FAIL ${SCHEMA_DIR}/${n} is missing`);
  for (const n of d.changed) console.log(`check:api: FAIL ${SCHEMA_DIR}/${n} differs from ${SOURCE}`);
  for (const n of d.stale) console.log(`check:api: FAIL ${SCHEMA_DIR}/${n} has no type in ${SOURCE}`);
  if (d.missing.length + d.changed.length + d.stale.length > 0) {
    console.log('check:api: regenerate with: pnpm check:api -- --write');
    return 1;
  }
  console.log(`check:api: ${files.size} schemas match ${SOURCE}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(args()));
