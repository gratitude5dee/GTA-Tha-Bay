import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { configIssues } from '../src/cli.ts';
import { discoverSouls } from '../src/common.ts';
import { buildLintEnv, lintFiles, lintSoul } from '../src/lint.ts';
import type { LintEnv } from '../src/lint.ts';
import { countTokensLive, estimateTokens, resetSkipNotice, resolveTokenBounds } from '../src/tokens.ts';
import { fixtureDir, repoRoot } from '../../../packages/shared/test/npc/helpers/souls.ts';

const quiet = (): void => {};
const mkEnv = (over: Partial<LintEnv> = {}, opts: Parameters<typeof buildLintEnv>[0] = { root: repoRoot }): LintEnv =>
  ({ ...buildLintEnv({ noTokenWrite: true, log: quiet, env: { PATH: process.env.PATH ?? '' }, ...opts }), ...over });
const fx = (rel: string): string => path.join(fixtureDir, rel, 'soul.md');
const lintFx = async (rel: string, env: LintEnv = mkEnv()) => (await lintFiles(repoRoot, [fx(rel)], env)).issues;

describe('npc:lint on the shipped souls (AC-1)', () => {
  it('passes the five souls', async () => {
    const files = discoverSouls(repoRoot);
    expect(files.map((f) => f.split('/')[2]).sort()).toEqual(['canary-mc', 'npc_test', 'ro-batista', 'standin_founder', 'standin_rapper']);
    const { issues } = await lintFiles(repoRoot, files, mkEnv());
    expect(issues).toEqual([]);
  });

  it('validates the config files this milestone owns', () => {
    expect(configIssues(repoRoot)).toEqual([]);
  });
});

describe('npc:lint on the bad fixtures (AC-1)', () => {
  const rules = Array.from({ length: 14 }, (_, i) => `L${i + 1}`);
  it.each(rules)('%s fails with exactly its rule id', async (rule) => {
    const env = rule === 'L14' ? mkEnv({}, { root: repoRoot, baseline: path.join(fixtureDir, 'bad/L14/baseline.json') }) : mkEnv();
    const issues = await lintFx(`bad/${rule}`, env);
    expect(issues.length, `${rule}: no issue`).toBeGreaterThan(0);
    expect([...new Set(issues.map((i) => i.rule))]).toEqual([rule]);
  });

  it('reports the messages that name the problem', async () => {
    expect((await lintFx('bad/L1')).map((i) => i.message).join('|')).toMatch(/overlap/);
    expect((await lintFx('bad/L2'))[0]?.message).toMatch(/nobody-here/);
    expect((await lintFx('bad/L5'))[0]?.message).toMatch(/minimum 8/);
    expect((await lintFx('bad/L6'))[0]?.message).toMatch(/url/);
    expect((await lintFx('bad/L9'))[0]?.message).toMatch(/voice-catalog/);
    expect((await lintFx('bad/L13'))[0]?.message).toMatch(/not_a_goal/);
  });

  it('reports schema errors first and stops: other rules stay silent', async () => {
    const bad = readFileSync(fx('bad/L1'), 'utf8').replace('minor: false', 'minor: true');
    const r = await lintSoul('x/soul.md', bad, mkEnv());
    expect([...new Set(r.issues.map((i) => i.rule))]).toEqual(['schema']);
    const notYaml = await lintSoul('x/soul.md', 'no frontmatter here\n', mkEnv());
    expect(notYaml.issues[0]).toMatchObject({ rule: 'schema' });
  });
});

describe('npc:lint on the good fixtures', () => {
  it.each(['good/base', 'good/consented', 'good/fighter'])('%s passes', async (rel) => {
    expect(await lintFx(rel)).toEqual([]);
  });
  it('parody passes only with a classifier (L7 fails closed without one)', async () => {
    expect((await lintFx('good/parody')).map((i) => i.message)).toEqual(['L7: classifier unavailable']);
    expect(await lintFx('good/parody', mkEnv({ classifier: async () => ({ ok: true, reasons: [] }) }))).toEqual([]);
    const rejected = await lintFx('good/parody', mkEnv({ classifier: async () => ({ ok: false, reasons: ['health claim'] }) }));
    expect(rejected[0]?.message).toMatch(/health claim/);
    const broken = await lintFx('good/parody', mkEnv({ classifier: async () => { throw new Error('offline'); } }));
    expect(broken[0]).toMatchObject({ rule: 'L7' });
  });
  it('L7 does not apply to other tiers', async () => {
    expect(await lintFx('good/base', mkEnv({ classifier: async () => ({ ok: false, reasons: ['x'] }) }))).toEqual([]);
  });
});

describe('individual rules', () => {
  it('L3 compares against the real-side list when one is supplied', async () => {
    const names = { schema: 'names/1' as const, entries: [{ id: 'r1', real: 'Fixture Pilotte' }] };
    const env = mkEnv({ realNames: names });
    expect((await lintFx('good/base', env)).map((i) => i.rule)).toEqual([]); // non-parody: only an identical name fails
    const same = { schema: 'names/1' as const, entries: [{ id: 'r1', real: 'Fixture Pilot' }] };
    expect((await lintFx('good/base', mkEnv({ realNames: same }))).map((i) => i.rule)).toEqual(['L3']);
  });

  it('L4 uses the exact count when there is one', async () => {
    const over = await lintFx('good/base', mkEnv({ tokens: async () => ({ lower: 1, upper: 2, exact: 4001 }) }));
    expect(over.map((i) => i.rule)).toEqual(['L4']);
    const under = await lintFx('good/base', mkEnv({ tokens: async () => ({ lower: 1, upper: 2, exact: 599 }) }));
    expect(under.map((i) => i.rule)).toEqual(['L4']);
    expect(await lintFx('good/base', mkEnv({ tokens: async () => ({ lower: 1, upper: 2, exact: 2000 }) }))).toEqual([]);
  });

  it('L8 catches a move id shared by two souls', async () => {
    const dup = readFileSync(fx('good/fighter'), 'utf8').replace(/fx_special_a/g, 'canary_chirp').replace('id: fx_fighter', 'id: fx_dup');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'npc-l8-'));
    try {
      writeFileSync(path.join(dir, 'soul.md'), dup);
      const { issues } = await lintFiles(repoRoot, [path.join(dir, 'soul.md'), path.join(repoRoot, 'content/npcs/canary-mc/soul.md')], mkEnv());
      expect(issues.some((i) => i.rule === 'L8' && /canary_chirp/.test(i.message))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('L10 refuses assetsPending on an active soul only in release mode, and unlocked refs otherwise', async () => {
    const roPath = path.join(repoRoot, 'content/npcs/ro-batista/soul.md');
    expect((await lintFiles(repoRoot, [roPath], mkEnv())).issues).toEqual([]);
    const rel = (await lintFiles(repoRoot, [roPath], mkEnv({ release: true }))).issues;
    expect(rel).toHaveLength(1);
    expect(rel[0]).toMatchObject({ rule: 'L10' });
    expect(rel[0]?.message).toMatch(/ro-batista/);
  });

  it('L14 needs a higher soulVersion after a prompt change, and accepts it once raised', async () => {
    // the shipped soul is at version 2; the case starts from its version-1 text
    const md = readFileSync(path.join(repoRoot, 'content/npcs/ro-batista/soul.md'), 'utf8').replace('soulVersion: 2', 'soulVersion: 1');
    const env0 = mkEnv();
    const base = await lintSoul('content/npcs/ro-batista/soul.md', md, env0);
    const compiled = base.compiled as NonNullable<typeof base.compiled>;
    const { promptHash, publicSoulHash } = await import('../../../packages/shared/src/npc/compile.ts');
    const baseline = {
      schema: 'souls-index/1' as const, rosterVersion: 1, rosterSha256: '0'.repeat(64),
      souls: { 'ro-batista': { soulVersion: 1, promptSha256: promptHash(compiled.promptTxt), publicSha256: publicSoulHash(compiled.publicSoul) } },
    };
    const env = mkEnv({ baseline });
    expect((await lintSoul('a/soul.md', md, env)).issues).toEqual([]);
    const edited = md.replace('Short sentences. Deadpan.', 'Short sentences. Deadpan!');
    expect((await lintSoul('a/soul.md', edited, env)).issues.map((i) => i.rule)).toEqual(['L14']);
    expect((await lintSoul('a/soul.md', edited.replace('soulVersion: 1', 'soulVersion: 2'), env)).issues).toEqual([]);
  });
});

describe('token bounds', () => {
  it('estimates from the byte length', () => {
    expect(estimateTokens('a'.repeat(300))).toEqual({ lower: 60, upper: 100 });
    expect(estimateTokens('é'.repeat(30))).toEqual({ lower: 12, upper: 20 }); // 60 bytes
  });

  it('prints one SKIP line and uses the estimate without a key', async () => {
    resetSkipNotice();
    const lines: string[] = [];
    const root = mkdtempSync(path.join(os.tmpdir(), 'npc-tok-'));
    try {
      const b = await resolveTokenBounds({ root, id: 'x_test', text: 'hello', sha256: 'a'.repeat(64), env: {}, log: (l) => lines.push(l) });
      await resolveTokenBounds({ root, id: 'x_test', text: 'hello', sha256: 'a'.repeat(64), env: {}, log: (l) => lines.push(l) });
      expect(b).toEqual({ lower: 1, upper: 2, exact: null });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^SKIP npc tokens: ANTHROPIC_API_KEY not set/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('counts with a key, caches by prompt sha256, and falls back on failure', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'npc-tok-'));
    try {
      mkdirSync(path.join(root, 'content/npcs/x_test'), { recursive: true });
      const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
      const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
        calls.push({ url, headers: init.headers, body: init.body });
        return { ok: true, status: 200, json: async () => ({ input_tokens: 1234 }) };
      };
      const sha = 'b'.repeat(64);
      const first = await resolveTokenBounds({ root, id: 'x_test', text: 'hello', sha256: sha, env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl, log: quiet });
      expect(first.exact).toBe(1234);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages/count_tokens');
      expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({ model: 'claude-haiku-5-5' });
      expect(JSON.parse(readFileSync(path.join(root, 'content/npcs/x_test/tokens.json'), 'utf8'))[sha]).toEqual({ tokens: 1234, model: 'claude-haiku-5-5' });
      const second = await resolveTokenBounds({ root, id: 'x_test', text: 'hello', sha256: sha, env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl, log: quiet });
      expect(second.exact).toBe(1234);
      expect(calls).toHaveLength(1); // served from tokens.json
      const failing = async () => ({ ok: false, status: 500, json: async () => ({}) });
      const warned: string[] = [];
      const third = await resolveTokenBounds({ root, id: 'x_test', text: 'other', sha256: 'c'.repeat(64), env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: failing, log: (l) => warned.push(l) });
      expect(third.exact).toBeNull();
      expect(warned[0]).toMatch(/^WARN npc tokens: count_tokens answered HTTP 500/);
      await expect(countTokensLive('x', 'k', async () => ({ ok: true, status: 200, json: async () => ({ input_tokens: 'many' }) }))).rejects.toThrow(/integer/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
