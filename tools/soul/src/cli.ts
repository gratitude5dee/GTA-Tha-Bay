/**
 * Soul CLIs (root scripts npc:*). Run through `tsx tools/soul/src/cli.ts <command> [args]`; pnpm passes a leading `--`
 * that args() drops.
 *
 *   schemas [--check]
 *   lint [<soul.md | dir>...] [--baseline <file>] [--release]
 *   compile <id | soul.md>... [--out <dir>]
 *   build [--out <dir>] [--release] [--upload] [--env staging|prod] [--write-baseline] [--no-assets]
 *   consent-index
 *   summarize <id> [--fixture <recorded.json>] [--out <dir>]
 *   normalize <slug> [--fixture <recorded.json>] [--out <dir>]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateBarkPool, validateRoster, validateVoiceCatalog, formatIssue } from '../../../packages/shared/src/npc/validate.ts';
import { args } from '../../ci/run.ts';
import { isMain } from '../../ci/lib/common.ts';
import { runBuild } from './build.ts';
import { discoverSouls, readJson, soulRoot, soulsUnder } from './common.ts';
import { compileToFiles } from './compile.ts';
import { writeConsentIndex } from './consent-index.ts';
import { buildLintEnv, lintFiles } from './lint.ts';
import { normalize } from './normalize.ts';
import { runSchemas } from './schemas.ts';
import { summarize } from './summarize.ts';

/** Config files this milestone owns, validated whenever the default roster is linted. */
export function configIssues(root: string): string[] {
  const out: string[] = [];
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const npcSchema = readJson<object>(root, 'tools/ci/schemas/npc-config.v1.json');
  const check = ajv.compile(npcSchema);
  if (!check(readJson(root, 'config/npc.json'))) out.push(...(check.errors ?? []).map((e) => `config/npc.json: ${e.instancePath || '/'} ${e.message ?? 'invalid'}`));
  for (const i of validateVoiceCatalog(readJson(root, 'config/voice-catalog.json'))) out.push(`config/voice-catalog.json: ${formatIssue(i)}`);
  for (const i of validateRoster(readJson(root, 'content/npcs/roster.json'))) out.push(`content/npcs/roster.json: ${formatIssue(i)}`);
  const goals = readJson<{ schema?: string; goals?: { id?: unknown }[] }>(root, 'config/npc-goals.json');
  if (goals.schema !== 'npc-goals/1' || !Array.isArray(goals.goals) || !goals.goals.every((g) => typeof g.id === 'string' && /^[a-z_]{3,32}$/.test(g.id))) {
    out.push('config/npc-goals.json: expected {schema: "npc-goals/1", goals: [{id: /^[a-z_]{3,32}$/}]}');
  }
  // bark pools, when a soul ships one (M06c)
  for (const f of discoverSouls(root)) {
    const dir = path.dirname(f);
    try {
      const pool = JSON.parse(readFileSync(path.join(root, dir, 'barks.json'), 'utf8')) as unknown;
      for (const i of validateBarkPool(pool)) out.push(`${dir}/barks.json: ${formatIssue(i)}`);
    } catch {
      /* no pool yet */
    }
  }
  return out;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: args(),
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      out: { type: 'string', default: '.out' },
      check: { type: 'boolean', default: false },
      release: { type: 'boolean', default: false },
      upload: { type: 'boolean', default: false },
      env: { type: 'string' },
      baseline: { type: 'string' },
      fixture: { type: 'string' },
      'write-baseline': { type: 'boolean', default: false },
      'no-assets': { type: 'boolean', default: false },
    },
  });
  const root = path.resolve(values.root ?? soulRoot);
  const [cmd, ...rest] = positionals;
  const log = (l: string): void => console.log(l);

  switch (cmd) {
    case 'schemas': {
      const r = runSchemas(root, values.check);
      r.messages.forEach(log);
      return r.ok ? 0 : 1;
    }
    case 'lint': {
      const files = rest.length ? rest.flatMap((p) => soulsUnder(path.resolve(p))) : discoverSouls(root);
      if (files.length === 0) {
        console.log('npc:lint: no soul.md files found');
        return 1;
      }
      const env = buildLintEnv({ root, release: values.release, baseline: values.baseline, log });
      const issues: string[] = rest.length ? [] : configIssues(root);
      const res = await lintFiles(root, files, env);
      for (const i of res.issues) issues.push(`${i.file}: ${i.rule}: ${i.message}`);
      issues.forEach((i) => console.log(`npc:lint: ${i}`));
      console.log(`npc:lint: ${files.length} souls, ${issues.length} issues`);
      return issues.length ? 1 : 0;
    }
    case 'compile': {
      if (rest.length === 0) {
        console.error('usage: npc:compile <id | soul.md>... [--out <dir>]');
        return 2;
      }
      for (const id of rest) {
        const c = await compileToFiles(root, id, { out: path.resolve(root, values.out), log });
        console.log(`npc:compile: ${c.id} v${c.soulVersion}: sha256 ${c.promptSha256}, tokens ${c.compiledSoul.prompt.tokens}, ${path.relative(root, c.dir)}`);
      }
      return 0;
    }
    case 'build': {
      const r = await runBuild({
        root, out: values.out, release: values.release, upload: values.upload, writeBaseline: values['write-baseline'], writeAssets: !values['no-assets'], log,
        ...(values.env === 'prod' || values.env === 'staging' ? { r2Env: values.env } : {}),
      });
      for (const i of r.lint) console.log(`npc:build: ${i.file}: ${i.rule}: ${i.message}`);
      for (const i of r.roster) console.log(`npc:build: roster: ${i.rule}: ${i.id}: ${i.message}`);
      for (const p of r.problems) console.log(`npc:build: ${p}`);
      if (!r.ok) {
        console.log('npc:build: failed');
        return 1;
      }
      console.log(`npc:build: ${Object.keys(r.index?.souls ?? {}).length} active souls, data/npc-roster v${r.bundle?.rosterVersion}, souls/index.json lists ${Object.entries(r.index?.souls ?? {}).map(([id, s]) => `${id}@${s.soulVersion}`).join(', ')}`);
      return 0;
    }
    case 'consent-index': {
      const r = writeConsentIndex(root);
      r.problems.forEach((p) => console.log(`npc:consent-index: ${p}`));
      console.log(`npc:consent-index: ${r.problems.length ? 'not written' : `wrote ${r.path}`} (${r.entries} entries, source ${r.source})`);
      return r.problems.length ? 1 : 0;
    }
    case 'summarize': {
      if (!rest[0]) {
        console.error('usage: npc:summarize <id> [--fixture <recorded.json>]');
        return 2;
      }
      const r = summarize(root, rest[0], values.fixture, values.out, log);
      r.problems.forEach((p) => console.log(`npc:summarize: ${p}`));
      return r.ok ? 0 : 1;
    }
    case 'normalize': {
      if (!rest[0]) {
        console.error('usage: npc:normalize <slug> [--fixture <recorded.json>]');
        return 2;
      }
      const r = await normalize(root, rest[0], values.fixture, values.out, log);
      r.problems.forEach((p) => console.log(`npc:normalize: ${p}`));
      return r.ok ? 0 : 1;
    }
    default:
      console.error('usage: tools/soul/src/cli.ts schemas | lint | compile | build | consent-index | summarize | normalize');
      return 2;
  }
}

if (isMain(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(`npc: ${(e as Error).stack ?? String(e)}`);
      process.exit(1);
    },
  );
}
