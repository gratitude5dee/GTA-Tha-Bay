/**
 * M05c3 AC-10: the Worker configuration stays inside the Workers Free plan (DL-OWN-08, DL-749, DL-750).
 * No environment declares a Container, a TRANSCODER binding, `limits.cpu_ms`, a Tail Worker or Logpush; each environment has at
 * most 40 `vars` (Free allows 64 variables per Worker, secrets included); `C2PA_RESIGN` is "1" in production and "0" in staging
 * and previews; and the migration tags are the two that exist today.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripJsonc } from '../deploy.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const wranglerFiles = ['services/edge/wrangler.jsonc'];

type Dict = Record<string, unknown>;
interface Environment {
  name: string;
  config: Dict;
}

function environments(file: string): Environment[] {
  const top = JSON.parse(stripJsonc(readFileSync(path.join(root, file), 'utf8'))) as Dict;
  const out: Environment[] = [{ name: `${file} (production)`, config: top }];
  for (const [n, c] of Object.entries((top['env'] as Record<string, Dict> | undefined) ?? {})) out.push({ name: `${file} env.${n}`, config: c });
  if (top['previews'] !== undefined) out.push({ name: `${file} previews`, config: top['previews'] as Dict });
  return out;
}

const bindingNames = (config: Dict): string[] => {
  const names: string[] = [];
  const dos = config['durable_objects'] as { bindings?: { name: string }[] } | undefined;
  for (const b of dos?.bindings ?? []) names.push(b.name);
  for (const key of ['r2_buckets', 'kv_namespaces', 'services', 'workflows', 'ai', 'analytics_engine_datasets']) {
    const v = config[key];
    for (const b of Array.isArray(v) ? (v as { binding?: string }[]) : v !== undefined ? [v as { binding?: string }] : []) if (b.binding) names.push(b.binding);
  }
  return names;
};

describe.each(wranglerFiles)('%s on Workers Free (AC-10)', (file) => {
  const envs = environments(file);

  it('reads production, staging and previews', () => {
    expect(envs.map((e) => e.name.replace(`${file} `, ''))).toEqual(['(production)', 'env.staging', 'previews']);
  });

  it.each(envs.map((e) => [e.name, e] as const))('%s declares none of the Paid-only features', (_n, e) => {
    expect(e.config['containers']).toBeUndefined();
    expect(e.config['tail_consumers']).toBeUndefined();
    expect(e.config['logpush']).toBeUndefined();
    const limits = e.config['limits'] as Dict | undefined;
    expect(limits?.['cpu_ms']).toBeUndefined();
    expect(bindingNames(e.config)).not.toContain('TRANSCODER');
    expect(JSON.stringify(e.config)).not.toMatch(/TranscoderContainer|"TRANSCODER"/);
  });

  it.each(envs.map((e) => [e.name, e] as const))('%s has at most 40 vars', (_n, e) => {
    const vars = (e.config['vars'] as Dict | undefined) ?? {};
    expect(Object.keys(vars).length).toBeLessThanOrEqual(40);
  });

  it('C2PA_RESIGN is "1" in production and "0" in staging and previews', () => {
    const by = Object.fromEntries(envs.map((e) => [e.name.replace(`${file} `, ''), ((e.config['vars'] as Dict | undefined) ?? {})['C2PA_RESIGN']]));
    expect(by).toEqual({ '(production)': '1', 'env.staging': '0', previews: '0' });
  });

  it('adds no migration tag and no Durable Object class beyond web-v1 and web-v2', () => {
    for (const e of envs) {
      const migrations = (e.config['migrations'] as { tag: string; new_sqlite_classes?: string[] }[] | undefined) ?? [];
      if (e.name.endsWith('previews')) {
        expect(migrations).toEqual([]);
        continue;
      }
      expect(migrations.map((m) => m.tag)).toEqual(['web-v1', 'web-v2']);
      expect(migrations.flatMap((m) => m.new_sqlite_classes ?? []).sort()).toEqual(['BudgetGovernorDO', 'CutsceneJobDO', 'EncounterDO', 'FalGateDO', 'PlayerQuotaDO']);
    }
  });
});
