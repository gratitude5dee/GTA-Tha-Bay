/**
 * The Coast set and the batch plan (M10a2): the subject card of `pc-coast`, the owner's sheet as the first reference of the sheet stage, the
 * owner-only H1 and H3 gates, and the plan over the whole roster with the real-derived fighter slots reserved. No vendor call leaves memory.
 */
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeHarness } from '../../../services/pipeline/test/helpers/character-harness.ts';
import { runIdOf } from '../../../services/pipeline/src/steps/character.ts';
import { repoRoot } from '../../ci/run.ts';
import { useTempDirs } from '../../ci/test-tmp.ts';
import { main } from '../gen/cli.ts';
import { loadWorld, planBatch, renderPlan } from '../gen/plan.ts';
import { cardProblems, readCards, refPaths, sniffImage } from '../gen/subject-card.ts';

const tempDir = useTempDirs();
const SHEET = 'content/characters/pc-coast/sheet.webp';

describe('the pc-coast subject card', () => {
  it('is the only card, passes its checks and names the owner-signed gates and the six creator rows', () => {
    const { cards, problems } = readCards(repoRoot);
    expect(problems).toEqual([]);
    expect(cards.map((c) => c.id)).toEqual(['pc-coast']);
    const c = cards[0]!;
    expect(c).toMatchObject({ kind: 'player', pipeline: 'standard', hero: true, heightM: 1.75, signers: { H1: 'owner', H3: 'owner' }, refs: [SHEET] });
    expect(c.parts.map((p) => p.row)).toEqual(['body-coast', 'face-coast', 'hair-coast', 'top-coast-hoodie', 'bottom-coast-jeans', 'shoes-coast-sneakers']);
    const catalog = JSON.parse(readFileSync(path.join(repoRoot, 'content/ui/creator/catalog.json'), 'utf8')) as { slots: Record<string, { id: string }[]> };
    const ids = new Set(Object.values(catalog.slots).flat().map((p) => p.id));
    for (const p of c.parts) expect(ids.has(p.row), `${p.row} is a creator row`).toBe(true);
  });

  it('is a card, not an NPC: no roster row and no soul file', () => {
    const roster = JSON.parse(readFileSync(path.join(repoRoot, 'content/npcs/roster.json'), 'utf8')) as { entries: { id: string }[] };
    expect(roster.entries.some((e) => e.id === 'pc-coast')).toBe(false);
    expect(existsSync(path.join(repoRoot, 'content/npcs/pc-coast'))).toBe(false);
  });

  it('rejects a card with a wrong shape, a missing ref list or a folder mismatch', () => {
    const good = JSON.parse(readFileSync(path.join(repoRoot, 'content/characters/pc-coast/subject.json'), 'utf8')) as Record<string, unknown>;
    expect(cardProblems(good, 'content/characters/pc-coast/subject.json')).toEqual([]);
    expect(cardProblems({ ...good, refs: [] }, 'content/characters/pc-coast/subject.json').join()).toMatch(/refs must be/);
    expect(cardProblems({ ...good, signers: { H9: 'owner' } }, 'content/characters/pc-coast/subject.json').join()).toMatch(/signers must be/);
    expect(cardProblems(good, 'content/characters/other/subject.json').join()).toMatch(/does not match the folder/);
    expect(cardProblems({ ...good, pipeline: 'lean' }, 'content/characters/pc-coast/subject.json').join()).toMatch(/pipeline must be/);
  });

  it('the sheet is a WebP and reference paths come from the card', () => {
    const { cards } = readCards(repoRoot);
    expect(refPaths(repoRoot, 'pc-coast', cards[0])).toEqual([SHEET]);
    expect(sniffImage(new Uint8Array(readFileSync(path.join(repoRoot, SHEET))))).toBe('image/webp');
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe('image/png');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });
});

describe('the sheet stage takes the owner sheet', () => {
  it('sends the WebP as ref-1 with its own media type, after the style bible, and never as a video reference', async () => {
    const h = await makeHarness({ subject: { slug: 'pc-coast', hero: true, heightM: 1.75 } });
    h.cfg.refs = [new Uint8Array(readFileSync(path.join(repoRoot, SHEET)))];
    const seen: Record<string, unknown>[] = [];
    const submit = h.ports.fal.submit.bind(h.ports.fal);
    h.ports.fal.submit = (e, i, o) => {
      seen.push(i);
      return submit(e, i, o);
    };
    await h.decide('H0');
    const out = await h.run('sheet');
    expect(out.status, out.detail).toBe('awaiting');
    expect(out.gate).toBe('H1');
    const sheetCall = seen[0] as { image_urls: string[] };
    expect(sheetCall.image_urls).toHaveLength(2);
    expect(sheetCall.image_urls[0]).toMatch(/^data:image\/png;base64,/);
    expect(sheetCall.image_urls[1]).toMatch(/^data:image\/webp;base64,/);
    // no endpoint of the stages up to the sheet is a video model
    expect(h.submits.every((e) => !/video|kling|veo|sora|seedance|runway/i.test(e))).toBe(true);
  }, 120_000);
});

describe('owner-signed gates', () => {
  function mini(): string {
    const root = tempDir('dv-coast-gate-');
    for (const f of ['config/genai-endpoints.json', 'content/npcs/roster.json', 'content/characters/pc-coast/subject.json']) {
      mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      cpSync(path.join(repoRoot, f), path.join(root, f));
    }
    return root;
  }
  const gate = (root: string, runId: string, g: string, by: string, extra: string[] = []): Promise<{ code: number; text: string }> => {
    const logs: string[] = [];
    return main(['gate', '--run', runId, '--gate', g, '--choose', '1', '--by', by, ...extra], {}, (() => Promise.reject(new Error('no network'))) as never, (l) => logs.push(l), { root })
      .then((code) => ({ code, text: logs.join('\n') }));
  };

  it('refuses H1 and H3 from anyone but the owner, accepts the owner, and lets any profile record H0, H2, H4 and H5', async () => {
    const root = mini();
    const world = loadWorld(root);
    const subject = world.entries.find((e) => e.entry.id === 'pc-coast')?.subject;
    expect(subject).toBeTruthy();
    const runId = runIdOf(subject!);
    const no = await gate(root, runId, 'H1', 'art-lead', ['--checklist']);
    expect(no.code).toBe(1);
    expect(no.text).toMatch(/H1 of pc-coast is signed by owner only/);
    expect((await gate(root, runId, 'H3', 'art-lead')).code).toBe(1);
    const ok = await gate(root, runId, 'H1', 'owner', ['--checklist']);
    expect(ok.code, ok.text).toBe(0);
    expect((await gate(root, runId, 'H3', 'owner')).code).toBe(0);
    expect((await gate(root, runId, 'H0', 'art-lead')).code).toBe(0);
    const run = JSON.parse(readFileSync(path.join(root, `.genai/work/character/pc-coast/run.json`), 'utf8')) as { review: { gate: string; by: string }[] };
    expect(run.review.map((r) => `${r.gate}:${r.by}`)).toEqual(['H1:owner', 'H3:owner', 'H0:art-lead']);
  });
});

describe('the batch plan over the whole roster (M10a2 AC-1)', () => {
  it('lists pc-coast first, the real-derived fighter slots as blocked:research with their estimate reserved, and stays inside the characters line', async () => {
    const w = loadWorld(repoRoot);
    const r = await planBatch({
      entries: w.entries, tier: 'all', registry: w.registry, ledgerRows: [], gate: { falMode: 'mock', environment: 'dev', registry: w.registry, lintPrompt: () => ({ ok: true }) }, reservedSlots: w.reservedSlots,
    });
    expect(r.rows[0]?.slug).toBe('pc-coast');
    expect(r.rows[0]?.status).toBe('ok');
    const reserved = r.rows.filter((x) => x.reason.startsWith('blocked:research'));
    expect(reserved.map((x) => x.slug)).toEqual(['rap-hyphy-elder', 'rap-lyricist', 'tech-visionary', 'tech-hacker', 'ath-shooter', 'ath-power-back', 'influencer']);
    for (const x of reserved) expect(x.estimateMicros).toBe(3_666_590);
    // canary-mc holds RAP_NEW_WAVE and is planned as itself, not reserved twice
    expect(r.rows.filter((x) => x.slug === 'canary-mc')).toHaveLength(1);
    expect(r.batchMicros).toBeLessThanOrEqual(42_000_000);
    expect(r.refused).toBeNull();
    expect(renderPlan(r).join('\n')).toMatch(/blocked:research \(RAP_HYPHY_ELDER/);
  });

  it('a pending-research draft entry keeps its Standard estimate in the plan; an unrelated draft does not', async () => {
    const w = loadWorld(repoRoot);
    const base = w.entries.find((e) => e.entry.id === 'canary-mc')!;
    const pending = { ...base, entry: { ...base.entry, id: 'real-one', status: 'draft' as const, research: 'pending' as const }, subject: { ...base.subject!, slug: 'real-one' } };
    const plain = { ...base, entry: { ...base.entry, id: 'plain-draft', status: 'draft' as const }, subject: { ...base.subject!, slug: 'plain-draft' } };
    const r = await planBatch({ entries: [pending, plain], tier: 'all', registry: w.registry, ledgerRows: [], gate: { falMode: 'mock', environment: 'dev', registry: w.registry, lintPrompt: () => ({ ok: true }) } });
    expect(r.rows.map((x) => [x.slug, x.reason])).toEqual([['real-one', 'blocked:research']]);
    expect(r.rows[0]?.estimateMicros).toBe(3_666_590);
  });

  it('the plan prints the room left on the line, and the same plan twice is the same text', async () => {
    const run = async (): Promise<string> => {
      const logs: string[] = [];
      await main(['plan', '--roster', 'content/npcs/roster.json', '--tier', 'all'], { FAL_MODE: 'mock' }, (() => Promise.reject(new Error('no network'))) as never, (l) => logs.push(l), { root: repoRoot });
      return logs.join('\n');
    };
    const a = await run();
    expect(a).toMatch(/room on the characters line after the batch: \$7\.95/);
    expect(a).toMatch(/pc-coast \[standard\] ok/);
    expect(await run()).toBe(a);
  });
});
