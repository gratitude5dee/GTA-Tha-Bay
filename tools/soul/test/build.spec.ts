import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { NpcRosterEntry, NpcRosterManifest, SoulFrontmatter } from '../../../packages/shared/src/contracts/c10-npc.ts';
import { sha256Hex } from '../../../packages/shared/src/hash.ts';
import { parseSoul } from '../../../packages/shared/src/npc/parse.ts';
import { checkRoster, rosterSha256, runBuild } from '../src/build.ts';
import type { RosterCaps, RosterInput } from '../src/build.ts';
import { buildConsentIndex, writeConsentIndex } from '../src/consent-index.ts';
import { inkJsonProblems } from '../src/ink.ts';
import { normalize } from '../src/normalize.ts';
import { runSchemas } from '../src/schemas.ts';
import { summarize } from '../src/summarize.ts';
import { repoRoot, shippedSoul } from '../../../packages/shared/test/npc/helpers/souls.ts';

const tmpDirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'npc-build-'));
  tmpDirs.push(d);
  return d;
};
afterAll(() => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const caps: RosterCaps = { rosterSonnetMax: 8, rosterStandardMax: 8, rosterLeanMax: 12 };
const roManifest = JSON.parse(readFileSync(path.join(repoRoot, 'content/npcs/roster.json'), 'utf8')) as NpcRosterManifest;
const ro = parseSoul(shippedSoul('ro-batista')).front;

/** A synthetic roster of n entries whose souls are copies of Ro with the entry's id. */
function synth(n: number, edit: (e: NpcRosterEntry, f: SoulFrontmatter, i: number) => void = () => {}): RosterInput {
  const entries: NpcRosterEntry[] = [];
  const souls = new Map<string, SoulFrontmatter>();
  for (let i = 0; i < n; i++) {
    const id = `npc_${String(i).padStart(2, '0')}`;
    const f = structuredClone(ro);
    f.id = id;
    f.dialogue.modelTier = 'haiku';
    f.roles.hero = false;
    const e: NpcRosterEntry = { id, soul: `content/npcs/${id}/soul.md`, status: 'active', tier: 'fictionalized', basis: 'original', hero: false, pipeline: 'none', priority: 5, research: 'none', standIn: null, modes: ['story'] };
    edit(e, f, i);
    entries.push(e);
    souls.set(id, f);
  }
  return { manifest: { schema: 'npc-roster/1', rosterVersion: 1, entries }, souls, soulFileExists: () => true, baseline: null, caps };
}
const rules = (r: RosterInput): string[] => [...new Set(checkRoster(r).map((i) => i.rule))];

describe('checkRoster R1-R7 (AC-6)', () => {
  it('passes the shipped roster', () => {
    const souls = new Map(roManifest.entries.map((e) => [e.id, parseSoul(shippedSoul(e.id)).front]));
    expect(checkRoster({ manifest: roManifest, souls, soulFileExists: () => true, baseline: null, caps })).toEqual([]);
  });

  it('R1: a duplicate id, and a soul path that does not exist', () => {
    const r = synth(3);
    (r.manifest.entries[1] as NpcRosterEntry).id = 'npc_00';
    expect(checkRoster(r).filter((i) => i.rule === 'R1').map((i) => i.message)).toContain('id npc_00 appears twice');
    expect(rules({ ...synth(2), soulFileExists: (p) => !p.includes('npc_01') })).toEqual(['R1']);
  });

  it('R2: tier, basis, hero and status must equal the soul', () => {
    const r = synth(2, (_e, f, i) => { if (i === 1) f.tier = 'parody'; });
    expect(checkRoster(r).find((i) => i.rule === 'R2')?.message).toMatch(/tier is fictionalized in the roster but parody in the soul/);
    expect(rules(synth(2, (e, _f, i) => { if (i === 0) e.hero = true; }))).toEqual(['R2']);
    expect(rules(synth(2, (e, _f, i) => { if (i === 0) e.basis = 'real_person'; }))).toContain('R2');
  });

  it('R3: a real-derived entry needs an active original stand-in', () => {
    const base = (standIn: string | null): RosterInput => synth(2, (e, f, i) => {
      if (i === 1) { e.basis = 'real_person'; f.likeness.basis = 'real_person'; e.standIn = standIn as NpcRosterEntry['standIn']; }
    });
    expect(checkRoster(base('character/npc_00')).filter((i) => i.rule === 'R3')).toEqual([]);
    expect(checkRoster(base(null)).some((i) => i.rule === 'R3')).toBe(true);
    expect(checkRoster(base('character/npc_99')).some((i) => i.rule === 'R3')).toBe(true);
  });

  it('R4: at most 8 Sonnet entries', () => {
    const sonnet = (r: RosterInput): RosterInput => {
      r.souls.forEach((f) => { f.dialogue.modelTier = 'sonnet'; f.roles.hero = true; });
      r.manifest.entries.forEach((e) => { e.hero = true; });
      return r;
    };
    const eight = sonnet(synth(8));
    expect(checkRoster(eight)).toEqual([]);
    expect(checkRoster(sonnet(synth(9))).map((i) => i.rule)).toEqual(['R4']);
  });

  it('R5: rosterVersion must rise when the roster changes', () => {
    const r = synth(2);
    const baseline = { schema: 'souls-index/1' as const, rosterVersion: 3, rosterSha256: rosterSha256(r.manifest), souls: {} };
    expect(checkRoster({ ...r, baseline })).toEqual([]);                                  // unchanged: fine at any version
    r.manifest.entries[0]!.priority = 2;
    expect(rules({ ...r, baseline })).toEqual(['R5']);                                    // changed, version 1 <= 3
    expect(checkRoster({ ...r, manifest: { ...r.manifest, rosterVersion: 4 }, baseline })).toEqual([]);
  });

  it('R6: research pending stays draft', () => {
    expect(rules(synth(2, (e, _f, i) => { if (i === 0) e.research = 'pending'; }))).toEqual(['R6']);
    expect(rules(synth(2, (e, f, i) => { if (i === 0) { e.research = 'pending'; e.status = 'draft'; f.status = 'draft'; } }))).toEqual([]);
  });

  it('R7: at most 8 standard and 12 lean, no premium', () => {
    expect(rules(synth(9, (e) => { e.pipeline = 'standard'; }))).toEqual(['R7']);
    expect(rules(synth(8, (e) => { e.pipeline = 'standard'; }))).toEqual([]);
    expect(rules(synth(13, (e) => { e.pipeline = 'lean'; }))).toEqual(['R7']);
    expect(rules(synth(2, (e, _f, i) => { if (i === 0) e.pipeline = 'premium'; }))).toEqual(['R7']);
  });

  it('reports R1, R2, R4 and R7 in turn for one broken roster', () => {
    const r = synth(9, (e, f, i) => { e.pipeline = 'standard'; e.hero = true; f.roles.hero = true; f.dialogue.modelTier = 'sonnet'; if (i === 8) f.tier = 'parody'; });
    (r.manifest.entries[1] as NpcRosterEntry).id = 'npc_00';
    expect(rules(r)).toEqual(['R1', 'R2', 'R4', 'R7']);
  });

  it('puts schema errors first', () => {
    const r = synth(2);
    (r.manifest.entries[0] as unknown as Record<string, unknown>).pipeline = 'ultra';
    expect(checkRoster(r).map((i) => i.rule)).toEqual(expect.arrayContaining(['schema']));
    expect(checkRoster(r).every((i) => i.rule === 'schema')).toBe(true);
  });
});

describe('npc:build on the shipped souls (AC-7)', () => {
  const out = tmp();
  const lines: string[] = [];
  const run = () => runBuild({ root: repoRoot, out, writeAssets: false, env: { PATH: process.env.PATH ?? '' }, nowMs: 1760832000000, log: (l) => lines.push(l) });

  it('builds offline, validates the assets and prints the PRIVATE upload SKIP', async () => {
    const r = await run();
    expect([r.lint, r.roster, r.problems]).toEqual([[], [], []]);
    expect(r.ok).toBe(true);
    expect(lines.some((l) => /^SKIP npc:build PRIVATE upload: R2_ACCESS_KEY_ID not set/.test(l))).toBe(true);

    // data/npc-roster: active souls only, no rails, visual brief or prompt text
    const bundleText = readFileSync(path.join(out, 'data/npc-roster.json'), 'utf8');
    const bundle = JSON.parse(bundleText) as { souls: { id: string }[]; rosterVersion: number };
    expect(bundle.souls.map((s) => s.id)).toEqual(['canary-mc', 'npc_test', 'ro-batista', 'standin_founder', 'standin_rapper']);
    for (const banned of ['"rails"', '"visual_brief"', 'forbiddenTopics', '<character', 'Batista Customs', 'coveralls']) expect(bundleText).not.toContain(banned);

    // data/ink.<id>: five knots each
    for (const s of bundle.souls) {
      const ink = readFileSync(path.join(out, 'data', `ink.${s.id}.json`), 'utf8');
      expect(inkJsonProblems(ink), s.id).toEqual([]);
    }

    // souls/index.json lists each active version; PRIVATE files exist per version
    const index = JSON.parse(readFileSync(path.join(out, 'souls/index.json'), 'utf8')) as { souls: Record<string, { soulVersion: number; promptSha256: string }> };
    expect(Object.keys(index.souls).sort()).toEqual(bundle.souls.map((s) => s.id));
    for (const [id, e] of Object.entries(index.souls)) {
      expect(e.soulVersion).toBe(1);
      expect(existsSync(path.join(out, 'souls', id, '1', 'soul.prompt.txt'))).toBe(true);
      const compiled = JSON.parse(readFileSync(path.join(out, 'souls', id, '1', 'soul.compiled.json'), 'utf8')) as { prompt: { sha256: string; key: string; tokens: number }; rails: unknown };
      expect(compiled.prompt.sha256).toBe(e.promptSha256);
      expect(compiled.prompt.key).toBe(`souls/${id}/1/soul.prompt.txt`);
      expect(compiled.prompt.tokens).toBeGreaterThanOrEqual(600);
      expect(compiled.rails).toBeDefined(); // the server view keeps the rails
    }
  });

  it('is repeatable: a second build gives identical private files', async () => {
    const out2 = tmp();
    await runBuild({ root: repoRoot, out: out2, writeAssets: false, env: { PATH: process.env.PATH ?? '' }, nowMs: 1760832000000, log: () => {} });
    for (const id of ['ro-batista', 'canary-mc']) {
      expect(readFileSync(path.join(out2, 'souls', id, '1', 'soul.prompt.txt'))).toEqual(readFileSync(path.join(out, 'souls', id, '1', 'soul.prompt.txt')));
      expect(readFileSync(path.join(out2, 'souls', id, '1', 'soul.compiled.json'))).toEqual(readFileSync(path.join(out, 'souls', id, '1', 'soul.compiled.json')));
    }
    expect(readFileSync(path.join(out2, 'souls/index.json'))).toEqual(readFileSync(path.join(out, 'souls/index.json')));
  });

  it('keeps the committed data/npc-roster source in step with the souls', async () => {
    const committed = readFileSync(path.join(repoRoot, 'assets/src/data/npc-roster/npc-roster.json'), 'utf8');
    expect(readFileSync(path.join(out, 'data/npc-roster.json'), 'utf8')).toBe(committed);
    for (const id of ['canary-mc', 'npc_test', 'ro-batista', 'standin_founder', 'standin_rapper']) {
      expect(readFileSync(path.join(out, 'data', `ink.${id}.json`), 'utf8')).toBe(readFileSync(path.join(repoRoot, `assets/src/data/ink.${id}/ink.json`), 'utf8'));
    }
  });
});

describe('npc:build --release (AC-9)', () => {
  it('fails with L10 naming each active soul that still has assetsPending', async () => {
    const r = await runBuild({ root: repoRoot, out: tmp(), release: true, writeAssets: false, env: { PATH: process.env.PATH ?? '' }, log: () => {} });
    expect(r.ok).toBe(false);
    const l10 = r.lint.filter((i) => i.rule === 'L10');
    expect(l10.length).toBe(5);
    for (const id of ['canary-mc', 'npc_test', 'ro-batista', 'standin_founder', 'standin_rapper']) expect(l10.some((i) => i.message.includes(id))).toBe(true);
  });
});

describe('build in a scratch copy', () => {
  function scratch(): string {
    const root = tmp();
    for (const d of ['content', 'config', 'tools/ci/schemas', 'assets']) cpSync(path.join(repoRoot, d), path.join(root, d), { recursive: true });
    mkdirSync(path.join(root, 'packages/shared'), { recursive: true });
    cpSync(path.join(repoRoot, 'packages/shared/schemas'), path.join(root, 'packages/shared/schemas'), { recursive: true });
    return root;
  }

  it('writes data assets with provenance records, prunes stale ones, and the result passes the asset schema join', async () => {
    const root = scratch();
    const first = await runBuild({ root, out: '.out', env: { PATH: process.env.PATH ?? '' }, nowMs: 1760832000000, log: () => {} });
    expect(first.ok).toBe(true);
    const spec = JSON.parse(readFileSync(path.join(root, 'assets/src/data/ink.ro-batista/asset.json'), 'utf8')) as Record<string, unknown>;
    expect(spec).toMatchObject({ kind: 'data', id: 'ink.ro-batista', status: 'active', visibility: 'public', tags: ['char:ro-batista'] });
    expect(spec.variants).toEqual({ default: 'assets/src/data/ink.ro-batista/ink.json' });
    const records = readdirSync(path.join(root, 'assets/provenance')).flatMap((d) => readdirSync(path.join(root, 'assets/provenance', d)).map((f) => path.join(root, 'assets/provenance', d, f)));
    const mine = records.map((f) => JSON.parse(readFileSync(f, 'utf8')) as { paths: string[]; origin: string; kind: string; license: string }).filter((r) => r.paths.some((p) => p.startsWith('assets/src/data/ink.') || p.includes('npc-roster')));
    expect(mine).toHaveLength(6);
    expect(mine.every((r) => r.origin === 'authored' && r.kind === 'data' && r.license === 'LicenseRef-DeeVerse-Owned')).toBe(true);

    // change one soul: the roster source changes, its old record is removed, a new one is written
    const soulFile = path.join(root, 'content/npcs/npc_test/soul.md');
    writeFileSync(soulFile, readFileSync(soulFile, 'utf8').replace('Good day. Please confirm the lot is clear.', 'Good day. Please confirm that the lot is clear.'));
    writeFileSync(soulFile, readFileSync(soulFile, 'utf8').replace('soulVersion: 1', 'soulVersion: 2'));
    const second = await runBuild({ root, out: '.out', env: { PATH: process.env.PATH ?? '' }, nowMs: 1760832000000, log: () => {} });
    expect(second.ok, JSON.stringify([second.lint, second.roster, second.problems])).toBe(true);
    const after = readdirSync(path.join(root, 'assets/provenance')).flatMap((d) => readdirSync(path.join(root, 'assets/provenance', d)));
    expect(after.length).toBe(records.length); // one record replaced by one record
  });

  it('refuses a roster whose version did not rise after a change (R5)', async () => {
    const root = scratch();
    const first = await runBuild({ root, out: '.out', writeBaseline: true, env: { PATH: process.env.PATH ?? '' }, log: () => {} });
    expect(first.ok).toBe(true);
    expect(existsSync(path.join(root, 'content/npcs/souls.index.json'))).toBe(true);
    const rosterFile = path.join(root, 'content/npcs/roster.json');
    writeFileSync(rosterFile, readFileSync(rosterFile, 'utf8').replace('"priority": 4', '"priority": 5'));
    const second = await runBuild({ root, out: '.out', env: { PATH: process.env.PATH ?? '' }, log: () => {} });
    expect(second.ok).toBe(false);
    expect(second.roster.map((i) => i.rule)).toEqual(['R5']);
  });

  it('refuses a changed prompt with an unchanged soulVersion (L14)', async () => {
    const root = scratch();
    expect((await runBuild({ root, out: '.out', writeBaseline: true, env: { PATH: process.env.PATH ?? '' }, log: () => {} })).ok).toBe(true);
    const soulFile = path.join(root, 'content/npcs/ro-batista/soul.md');
    writeFileSync(soulFile, readFileSync(soulFile, 'utf8').replace('Short sentences. Deadpan.', 'Short sentences. Deadpan!'));
    const r = await runBuild({ root, out: '.out', env: { PATH: process.env.PATH ?? '' }, log: () => {} });
    expect(r.ok).toBe(false);
    expect(r.lint.map((i) => i.rule)).toEqual(['L14']);
  });

  it('flags a soul on disk that the roster does not name', async () => {
    const root = scratch();
    mkdirSync(path.join(root, 'content/npcs/stray_npc'), { recursive: true });
    cpSync(path.join(root, 'content/npcs/npc_test/soul.md'), path.join(root, 'content/npcs/stray_npc/soul.md'));
    const r = await runBuild({ root, out: '.out', writeAssets: false, env: { PATH: process.env.PATH ?? '' }, log: () => {} });
    expect(r.ok).toBe(false);
    expect(r.roster.some((i) => i.rule === 'R1' && /stray_npc/.test(i.message))).toBe(true);
  });
});

describe('npc:consent-index', () => {
  it('writes an empty index without the private mount', () => {
    const root = tmp();
    mkdirSync(path.join(root, 'config'), { recursive: true });
    const r = writeConsentIndex(root);
    expect(r).toMatchObject({ entries: 0, source: 'empty', problems: [] });
    expect(JSON.parse(readFileSync(path.join(root, 'config/consent-index.json'), 'utf8'))).toEqual({ schema: 'consent-index/1', entries: [] });
  });

  it('exports ids, scopes and term_end only from content-private/consents', () => {
    const root = tmp();
    mkdirSync(path.join(root, 'config'), { recursive: true });
    mkdirSync(path.join(root, 'content-private/consents'), { recursive: true });
    writeFileSync(path.join(root, 'content-private/consents/b.json'), JSON.stringify({ id: 'consent_bbbbbbbb', subject_id: 'subj_bbbbbb', scopes: ['name', 'cutscene'], term_end: '2030-01-01', legalName: 'Never Exported' }));
    writeFileSync(path.join(root, 'content-private/consents/a.json'), JSON.stringify({ id: 'consent_aaaaaaaa', subjectId: 'subj_aaaaaa', scopes: ['voice_clone'] }));
    const { index, source, problems } = buildConsentIndex(root);
    expect(source).toBe('content-private');
    expect(problems).toEqual([]);
    expect(index.entries.map((e) => e.id)).toEqual(['consent_aaaaaaaa', 'consent_bbbbbbbb']);
    expect(index.entries[1]).toEqual({ id: 'consent_bbbbbbbb', subject_id: 'subj_bbbbbb', scopes: ['cutscene', 'name'], term_end: '2030-01-01' });
    expect(index.entries[0]?.term_end).toBeNull();
    expect(JSON.stringify(index)).not.toContain('Never Exported');
  });

  it('reports a malformed consent file and writes nothing', () => {
    const root = tmp();
    mkdirSync(path.join(root, 'config'), { recursive: true });
    mkdirSync(path.join(root, 'content-private/consents'), { recursive: true });
    writeFileSync(path.join(root, 'content-private/consents/x.json'), '{"id": 7}');
    const r = writeConsentIndex(root);
    expect(r.problems).toHaveLength(1);
    expect(existsSync(path.join(root, 'config/consent-index.json'))).toBe(false);
  });

  it('the committed index is the empty index (no private mount in this repository)', () => {
    expect(JSON.parse(readFileSync(path.join(repoRoot, 'config/consent-index.json'), 'utf8'))).toEqual({ schema: 'consent-index/1', entries: [] });
  });
});

describe('npc:schemas (AC-3)', () => {
  it('has no drift between the schemas and the generated validators and LLM schema', () => {
    const r = runSchemas(repoRoot, true);
    expect(r.messages.join('\n')).not.toMatch(/drift/);
    expect(r.ok).toBe(true);
  });
});

describe('npc:summarize and npc:normalize run on recorded fixtures only', () => {
  const lines: string[] = [];
  const log = (l: string): void => void lines.push(l);

  it('summarize: SKIP without a fixture, and without a Backstory it says so', () => {
    expect(summarize(repoRoot, 'ro-batista', undefined, tmp(), log).problems[0]).toMatch(/no "## Backstory" section/);
  });

  it('summarize: accepts a recording made from the same Backstory and refuses a stale or copied one', () => {
    const root = tmp();
    mkdirSync(path.join(root, 'content/npcs/sum_test'), { recursive: true });
    const md = shippedSoul('npc_test').replace('id: npc_test', 'id: sum_test') + '\n## Backstory\nThe inspector grew up near the water and spent twenty years reading meters for the city, which taught a habit of writing down everything and trusting nothing that was not on a form.\n';
    writeFileSync(path.join(root, 'content/npcs/sum_test/soul.md'), md);
    const backstory = parseSoul(md).sections.Backstory as string;
    const good = { model: 'claude-sonnet-5-5', recordedAt: '2026-10-19', backstorySha256: sha256Hex(backstory), summary: 'A former meter reader who now inspects a parking lot and writes everything down.' };
    writeFileSync(path.join(root, 'rec.json'), JSON.stringify(good));
    const ok = summarize(root, 'sum_test', 'rec.json', '.out', log);
    expect(ok).toEqual({ ok: true, problems: [] });
    expect(readFileSync(path.join(root, '.out/summaries/sum_test.md'), 'utf8')).toContain('A former meter reader');
    writeFileSync(path.join(root, 'rec.json'), JSON.stringify({ ...good, backstorySha256: '0'.repeat(64) }));
    expect(summarize(root, 'sum_test', 'rec.json', '.out', log).problems[0]).toMatch(/different Backstory/);
    writeFileSync(path.join(root, 'rec.json'), JSON.stringify({ ...good, summary: backstory }));
    expect(summarize(root, 'sum_test', 'rec.json', '.out', log).problems.join('|')).toMatch(/verbatim/);
  });

  it('normalize: SKIP without a fixture; with a recording it writes a draft and lints it', async () => {
    const out: string[] = [];
    expect(await normalize(repoRoot, 'x', undefined, tmp(), (l) => out.push(l))).toEqual({ ok: true, problems: [] });
    expect(out[0]).toMatch(/^SKIP npc:normalize live call/);

    const root = tmp();
    const parsed = parseSoul(readFileSync(path.join(repoRoot, 'packages/shared/test/npc/fixtures/good/base/soul.md'), 'utf8'));
    for (const d of ['content', 'config', 'tools/ci/schemas', 'assets']) cpSync(path.join(repoRoot, d), path.join(root, d), { recursive: true });
    mkdirSync(path.join(root, 'packages/shared'), { recursive: true });
    cpSync(path.join(repoRoot, 'packages/shared/schemas'), path.join(root, 'packages/shared/schemas'), { recursive: true });
    writeFileSync(path.join(root, 'rec.json'), JSON.stringify({ model: 'claude-sonnet-5-5', recordedAt: '2026-10-19', frontmatter: { ...parsed.front, id: 'norm_test', name: 'Normal Fixture', status: 'active' }, sections: parsed.sections }));
    const lines2: string[] = [];
    const r = await normalize(root, 'norm_test', 'rec.json', '.out', (l) => lines2.push(l));
    expect(r).toEqual({ ok: true, problems: [] });
    const md = readFileSync(path.join(root, '.out/normalize/norm_test/soul.md'), 'utf8');
    expect(md).toMatch(/^---\n/);
    expect(md).toContain('status: draft');
    expect(md).toContain('reviewedBy: null');
    expect(parseSoul(md).front.id).toBe('norm_test');
    expect(lines2[0]).toMatch(/lint clean/);
    // a recording that breaks the schema is refused
    writeFileSync(path.join(root, 'bad.json'), JSON.stringify({ model: 'm', recordedAt: '2026-10-19', frontmatter: { ...parsed.front, minor: true }, sections: parsed.sections }));
    const bad = await normalize(root, 'norm_test', 'bad.json', '.out', () => {});
    expect(bad.ok).toBe(false);
  });
});
