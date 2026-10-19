import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAgents, lintInstructionFile, MAX_AGENTS_BYTES, missingReadmes, pnpmScriptsInCode } from '../check-agents.ts';
import { repoRoot } from '../run.ts';

const fx = (...p: string[]): string => path.join(repoRoot, 'tools', 'ci', 'fixtures', 'agents', ...p);
const text = (f: string): string => readFileSync(fx(f), 'utf8');
const known = (s: string): boolean => ['check:unit', 'build'].includes(s);

describe('check:agents over the repository (AC-6)', () => {
  const r = checkAgents(repoRoot);

  it('passes and prints the line and byte counts of CLAUDE.md and AGENTS.md', () => {
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.lines.join('\n')).toMatch(/CLAUDE\.md: \d+ lines \(< 200\), \d+ bytes/);
    expect(r.lines.join('\n')).toMatch(/AGENTS\.md: \d+ lines \(< 200\), \d+ bytes/);
  });

  it('a later milestone script such as pnpm missions:build passes through the registry', () => {
    expect(lintInstructionFile({ name: 'x.md', text: 'Run `pnpm missions:build` and `pnpm assets:gen -- plan`.\n' }, () => false).failures.length).toBe(2);
    const live = checkAgents(repoRoot);
    expect(live.failures.filter((f) => f.includes('missions:build'))).toEqual([]);
    const claude = readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('pnpm missions:build');
  });

  it('every workspace directory with a package.json has a README.md', () => {
    expect(missingReadmes(repoRoot)).toEqual([]);
    for (const f of ['apps/web/README.md', 'packages/ui/README.md', 'services/edge/README.md']) expect(readFileSync(path.join(repoRoot, f), 'utf8').length).toBeGreaterThan(100);
  });
});

describe('check:agents fixtures (AC-6)', () => {
  it('a 201-line CLAUDE.md fails', () => {
    const r = lintInstructionFile({ name: 'CLAUDE.md', text: text('claude-201-lines.md') }, known);
    expect(r.lines).toBe(201);
    expect(r.failures.join('\n')).toContain('201 lines');
  });

  it('an AGENTS.md over 16,384 bytes fails', () => {
    const r = lintInstructionFile({ name: 'AGENTS.md', text: text('agents-oversize.md'), maxBytes: MAX_AGENTS_BYTES }, known);
    expect(r.lines).toBeLessThan(200);
    expect(r.bytes).toBeGreaterThan(MAX_AGENTS_BYTES);
    expect(r.failures.join('\n')).toContain('bytes');
  });

  it('an unknown script in a code span or fenced block fails, naming it; prose is not scanned', () => {
    const t = text('agents-unknown-script.md');
    expect(pnpmScriptsInCode(t)).toEqual(['no-such-script', 'check:unit', 'also-not-a-script']);
    const r = lintInstructionFile({ name: 'AGENTS.md', text: t }, known);
    expect(r.failures.length).toBe(2);
    expect(r.failures.join('\n')).toContain('no-such-script');
    expect(r.failures.join('\n')).toContain('also-not-a-script');
    expect(r.failures.join('\n')).not.toContain('workspaces');
  });

  it('skips pnpm built-ins and option tokens', () => {
    expect(pnpmScriptsInCode('`pnpm install` `pnpm --filter @dv/x test` `pnpm <script>` `pnpm exec wrangler` `pnpm check:unit [-- <paths>]`')).toEqual(['check:unit']);
  });

  it('a package directory without a README fails', () => {
    expect(missingReadmes(fx('pkg-no-readme'))).toEqual(['packages/x']);
  });
});
