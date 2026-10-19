/**
 * check:telemetry (M00d, DL-230; the static C16 privacy rules of 09-backend-contracts.md section 3):
 *
 *   tsx tools/ci/check-telemetry.ts [--root <dir>] [--emit-pending]
 *
 *  - no `profileId`, email, free-text or sub-chunk-position prop in any packages/shared/schemas/telemetry/*.json;
 *  - every `telemetry.emit('<name>'` call site in packages/*\/src and services/*\/src names a registered TelemetryName
 *    of packages/shared/src/telemetry.ts;
 *  - every name with such a call site has a schema (an entry of names.schema.json `$defs`, or a `<name>.json` /
 *    `<name>.schema.json` file).
 * Registered names with neither a call site nor a schema are warnings, each printed with its owner milestone from
 * packages/shared/schemas/telemetry/pending.json (`{name: milestoneId}`; the owner adds the schema with its emitter, else
 * M14b2). M14b2's registry audit turns the warnings into failures (DL-558).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMain } from './lib/common.ts';
import { parseMilestone, parsePlanOrder } from './md-parse.ts';
import { args, repoRoot } from './run.ts';

export interface TelemetryFinding {
  kind: 'forbidden-prop' | 'unregistered-name' | 'missing-schema' | 'unowned-pending';
  where: string;
  message: string;
}

export interface TelemetryResult {
  ok: boolean;
  failures: TelemetryFinding[];
  /** Registered names with no call site and no schema: `<name> (owner <milestone>)`. */
  warnings: string[];
  registered: string[];
}

const read = (file: string): string => (existsSync(file) ? readFileSync(file, 'utf8') : '');

/** Property names that carry identity, contact data, free text or a sub-chunk position (C16 privacy rules). */
export const FORBIDDEN_PROP =
  /^(profile_?id|player_?id|user_?id|email|e_?mail|phone|user_?name|display_?name|ip|ip_?address|text|free_?text|prompt|utterance|transcript|comment|note|notes|chat|message_?text|pos|position|x|y|z|lat|lng|lon|latitude|longitude|local_?x|local_?y|local_?z|cell_?x|cell_?z|chunk_?x|chunk_?z)$/i;

/** Registered names: every string of the two const arrays of telemetry.ts. */
export function registeredNames(telemetrySrc: string): string[] {
  const out: string[] = [];
  for (const m of telemetrySrc.matchAll(/export const (?:CLIENT|SERVER_ONLY)_TELEMETRY_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const/g)) {
    for (const s of (m[1] as string).matchAll(/'([a-z0-9_.]+)'/g)) out.push(s[1] as string);
  }
  return out;
}

function walkSrc(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkSrc(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** `{ name -> files }` for every `telemetry.emit('<name>'` (also `emitter?.emit(`) in the source trees. */
export function emitCallSites(root: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const dirs: string[] = [];
  for (const group of ['packages', 'services']) {
    const g = path.join(root, group);
    if (!existsSync(g)) continue;
    for (const pkg of readdirSync(g)) {
      dirs.push(path.join(g, pkg, 'src'));
      const modes = path.join(g, pkg);
      if (pkg === 'modes' && existsSync(modes)) for (const m of readdirSync(modes)) dirs.push(path.join(modes, m, 'src'));
    }
  }
  for (const d of dirs) {
    for (const f of walkSrc(d)) {
      const text = read(f);
      for (const m of text.matchAll(/\b(?:telemetry|emitter)\??\.emit\(\s*(['"])([^'"]+)\1/g)) {
        const name = m[2] as string;
        const rel = path.relative(root, f).split(path.sep).join('/');
        (out.get(name) ?? out.set(name, []).get(name)!).push(rel);
      }
    }
  }
  return out;
}

function propViolations(node: unknown, where: string, trail: string, out: TelemetryFinding[]): void {
  if (typeof node !== 'object' || node === null) return;
  const o = node as Record<string, unknown>;
  const props = o['properties'];
  if (typeof props === 'object' && props !== null) {
    for (const [key, schema] of Object.entries(props as Record<string, unknown>)) {
      const here = `${trail}.${key}`;
      if (FORBIDDEN_PROP.test(key)) out.push({ kind: 'forbidden-prop', where, message: `prop "${key}" at ${here} is identity, free text or a sub-chunk position (C16 privacy)` });
      const s = schema as { type?: unknown; enum?: unknown; const?: unknown; pattern?: unknown; maxLength?: unknown } | null;
      if (s && s.type === 'string' && s.enum === undefined && s.const === undefined && s.pattern === undefined && typeof s.maxLength !== 'number') {
        out.push({ kind: 'forbidden-prop', where, message: `string prop "${key}" at ${here} has no enum, const, pattern or maxLength (free text)` });
      }
      propViolations(schema, where, here, out);
    }
  }
  for (const [k, v] of Object.entries(o)) if (k !== 'properties') propViolations(v, where, `${trail}/${k}`, out);
}

export function checkTelemetry(root: string = repoRoot): TelemetryResult {
  const schemaDir = path.join(root, 'packages', 'shared', 'schemas', 'telemetry');
  const registered = registeredNames(read(path.join(root, 'packages', 'shared', 'src', 'telemetry.ts')));
  const regSet = new Set(registered);
  const failures: TelemetryFinding[] = [];
  const schemaNames = new Set<string>();

  for (const f of existsSync(schemaDir) ? readdirSync(schemaDir).filter((x) => x.endsWith('.json')).sort() : []) {
    if (f === 'pending.json') continue;
    const rel = `packages/shared/schemas/telemetry/${f}`;
    let json: unknown;
    try {
      json = JSON.parse(read(path.join(schemaDir, f)));
    } catch {
      failures.push({ kind: 'forbidden-prop', where: rel, message: 'not valid JSON' });
      continue;
    }
    const defs = (json as { $defs?: Record<string, unknown> }).$defs;
    if (f === 'names.schema.json' && defs) for (const k of Object.keys(defs)) schemaNames.add(k);
    const stem = f.replace(/\.schema\.json$|\.json$/, '');
    if (regSet.has(stem)) schemaNames.add(stem);
    propViolations(json, rel, '', failures);
  }

  const sites = emitCallSites(root);
  for (const [name, files] of sites) {
    if (!regSet.has(name)) failures.push({ kind: 'unregistered-name', where: files[0] as string, message: `emit of "${name}", which is not a registered TelemetryName` });
    else if (!schemaNames.has(name)) failures.push({ kind: 'missing-schema', where: files[0] as string, message: `"${name}" is emitted but has no schema in packages/shared/schemas/telemetry` });
  }

  let pending: Record<string, string> = {};
  try {
    pending = JSON.parse(read(path.join(schemaDir, 'pending.json')) || '{}') as Record<string, string>;
  } catch {
    pending = {};
  }
  const warnings: string[] = [];
  for (const name of registered) {
    if (sites.has(name) || schemaNames.has(name)) continue;
    warnings.push(`${name} (owner ${pending[name] ?? 'M14b2'})`);
  }
  return { ok: failures.length === 0, failures, warnings, registered };
}

/** Owner milestone for each pending name: the first milestone (plan order) whose file names it in backticks, else M14b2. */
export function ownerMap(root: string, names: string[]): Record<string, string> {
  const dir = path.join(root, 'spec', '07-milestones');
  const order = parsePlanOrder(read(path.join(dir, '_PLAN.md'))).map((p) => p.id);
  const files = new Map<string, string>();
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    const id = /^(M\d{2}[a-z]?\d?)-.*\.md$/.exec(f)?.[1];
    if (id) files.set(id, read(path.join(dir, f)));
  }
  const out: Record<string, string> = {};
  for (const name of names) {
    const owner = order.find((id) => {
      const text = files.get(id);
      if (!text) return false;
      const doc = parseMilestone(text);
      const scope = ['Scope in', 'Deliverables'].map((h) => doc.sections.get(h)?.lines.map((l) => l.text).join('\n') ?? '').join('\n');
      return scope.includes(`\`${name}\``);
    });
    out[name] = owner ?? 'M14b2';
  }
  return out;
}

function main(): void {
  const argv = args();
  const root = argv.includes('--root') ? path.resolve(argv[argv.indexOf('--root') + 1] as string) : repoRoot;
  const res = checkTelemetry(root);
  if (argv.includes('--emit-pending')) {
    const names = res.warnings.map((w) => w.split(' ')[0] as string);
    const file = path.join(root, 'packages', 'shared', 'schemas', 'telemetry', 'pending.json');
    writeFileSync(file, `${JSON.stringify(ownerMap(root, names), null, 2)}\n`);
    console.log(`check:telemetry: wrote ${names.length} pending names to ${path.relative(root, file)}`);
    return;
  }
  for (const w of res.warnings) console.log(`warn  registered name without call site or schema: ${w}`);
  for (const f of res.failures) console.log(`FAIL  ${f.where}: ${f.message}`);
  console.log(res.ok ? `check:telemetry passed (${res.registered.length} registered names, ${res.warnings.length} warnings)` : `check:telemetry failed (${res.failures.length})`);
  process.exit(res.ok ? 0 : 1);
}

if (isMain(import.meta.url)) main();
