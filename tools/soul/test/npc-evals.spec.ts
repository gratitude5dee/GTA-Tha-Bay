import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EVALS_DIR, FileRecordings, formatSummary, loadEvalSouls, loadSuites, runEvalCli } from '../src/eval.ts';
import { soulRoot } from '../src/common.ts';
import { validateSuites } from '../../../packages/npc/evals/suites.ts';

// M06a4 AC-8 and AC-9: the shipped recordings pass in replay; a recording whose action_arg is not in the offers makes the run exit 1; --live without
// ANTHROPIC_EVALS_KEY prints the SKIP line and exits 0.
const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(over: Partial<Parameters<typeof runEvalCli>[0]> = {}): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const out = mkdtempSync(path.join(os.tmpdir(), 'npc-eval-out-'));
  tmp.push(out);
  return runEvalCli({ root: soulRoot, soul: 'all', suite: 'all', mode: 'replay', out, env: {}, log: (l) => lines.push(l), ...over }).then((code) => ({ code, lines }));
}

describe('the shipped suites', () => {
  it('hold at least 40 red-team probes, the 5 builder probes and 10 golden conversations for each of the 5 active souls', () => {
    const suites = loadSuites(path.join(soulRoot, EVALS_DIR));
    const { souls } = loadEvalSouls(soulRoot, null);
    expect(souls.map((s) => s.id).sort()).toEqual(['canary-mc', 'npc_test', 'ro-batista', 'standin_founder', 'standin_rapper']);
    expect(suites.redteam.length).toBeGreaterThanOrEqual(40);
    expect(suites.probes).toHaveLength(5);
    for (const s of souls) expect(suites.golden.get(s.id)?.conversations).toHaveLength(10);
    expect(validateSuites(suites, souls.map((s) => s.id))).toEqual([]);
    const categories = new Set(suites.redteam.map((p) => p.category));
    for (const c of ['instruction_override', 'persona_swap', 'fake_system_tags', 'close_character_tag', 'ai_question', 'real_person', 'sexual', 'minors', 'slur_bait', 'self_harm', 'crime_howto', 'pii_fishing', 'money_advice']) {
      expect(categories.has(c), c).toBe(true);
    }
  });

  it('label every shipped recording as synthetic', () => {
    const dir = path.join(soulRoot, EVALS_DIR, 'recordings');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(5);
    for (const f of files) {
      const doc = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as { entries: Record<string, { synthetic: boolean }> };
      expect(Object.values(doc.entries).every((e) => e.synthetic === true)).toBe(true);
    }
  });
});

describe('npc:eval', () => {
  it('replays the shipped recordings: every deterministic check passes and a report is written', async () => {
    const { code, lines } = await run({ run: 'ac8' });
    expect(code).toBe(0);
    expect(lines.join('\n')).toMatch(/PASS/);
    expect(lines.join('\n')).toMatch(/report written to/);
  });

  it('writes a report per soul and a summary', async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'npc-eval-out-'));
    tmp.push(out);
    const code = await runEvalCli({ root: soulRoot, soul: 'npc_test', suite: 'redteam', mode: 'replay', out, run: 'r1', env: {}, log: () => undefined });
    expect(code).toBe(0);
    expect(readdirSync(path.join(out, 'r1')).sort()).toEqual(['npc_test.json', 'summary.json']);
    const report = JSON.parse(readFileSync(path.join(out, 'r1', 'npc_test.json'), 'utf8')) as { ok: boolean; suites: { suite: string; turns: number }[] };
    expect(report.ok).toBe(true);
    expect(report.suites[0]).toMatchObject({ suite: 'redteam' });
    expect(report.suites[0]!.turns).toBeGreaterThanOrEqual(40);
  });

  it('exits 1 when a recording answers with an action_arg that is not in the offers', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'npc-eval-rec-'));
    tmp.push(dir);
    cpSync(path.join(soulRoot, EVALS_DIR, 'recordings'), dir, { recursive: true });
    const file = path.join(dir, 'npc_test.json');
    const doc = JSON.parse(readFileSync(file, 'utf8')) as { entries: Record<string, { label: string; response: Record<string, unknown> }> };
    const victim = Object.values(doc.entries).find((e) => e.label === 'redteam/rt-io-01')!;
    victim.response = { ...victim.response, line: 'Noted. Here is a job, per protocol.', action: 'offer_mission', action_arg: 'm_not_offered' };
    writeFileSync(file, JSON.stringify(doc));
    const { code, lines } = await run({ soul: 'npc_test', suite: 'redteam', recordings: dir });
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/action_in_offers/);
  });

  it('exits 1 when the recordings of a soul are missing', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'npc-eval-rec-'));
    tmp.push(dir);
    const { code, lines } = await run({ soul: 'npc_test', suite: 'redteam', recordings: dir });
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/no recording for this request/);
  });

  it('prints the SKIP line and exits 0 for --live and --record without ANTHROPIC_EVALS_KEY', async () => {
    for (const mode of ['live', 'record'] as const) {
      const { code, lines } = await run({ soul: 'npc_test', mode });
      expect(code).toBe(0);
      expect(lines).toEqual([`SKIP npc:eval --${mode}: ANTHROPIC_EVALS_KEY not set`]);
    }
  });

  it('refuses an unknown suite and an unknown soul', async () => {
    expect((await run({ suite: 'nope' })).code).toBe(1);
    expect((await run({ soul: 'nobody' })).code).toBe(1);
  });

  it('rewrites the synthetic recordings to the same bytes (the shipped files are current)', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'npc-eval-rec-'));
    tmp.push(dir);
    const { code } = await run({ mode: 'write-synthetic', recordings: dir });
    expect(code).toBe(0);
    for (const f of readdirSync(dir)) expect(readFileSync(path.join(dir, f), 'utf8'), f).toBe(readFileSync(path.join(soulRoot, EVALS_DIR, 'recordings', f), 'utf8'));
  });

  it('formats a failing report with the first failures', () => {
    const lines = formatSummary({
      run: 'x',
      mode: 'replay',
      ok: false,
      exitCode: 1,
      souls: [{ npcId: 'a', mode: 'replay', synthetic: true, ok: false, judge: { ran: false, reason: 'r' }, gates: [{ name: 'g', pass: false, value: '1/2', kind: 'blocking' }], suites: [{ suite: 'redteam', turns: 2, deterministicOk: 1, failures: [{ id: 'redteam/x', check: 'schema', detail: 'bad' }] }] }],
    });
    expect(lines.join('\n')).toMatch(/FAIL/);
    expect(lines.join('\n')).toContain('redteam/x: schema bad');
  });

  it('keeps recordings sorted by key', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'npc-eval-rec-'));
    tmp.push(dir);
    const store = new FileRecordings(dir);
    store.put('x', 'b', { label: 'b', synthetic: true, model: 'm', response: {} });
    store.put('x', 'a', { label: 'a', synthetic: true, model: 'm', response: {} });
    store.save();
    expect(Object.keys((JSON.parse(readFileSync(path.join(dir, 'x.json'), 'utf8')) as { entries: object }).entries)).toEqual(['a', 'b']);
  });
});
