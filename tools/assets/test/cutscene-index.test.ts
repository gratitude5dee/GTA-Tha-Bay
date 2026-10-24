/**
 * M05b2 AC-2: the cutscene index builder over fixture refs, souls and a previous index.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { CutsceneRef } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import type { GenAiRegistry } from '../../../packages/shared/src/genai/registry.ts';
import { cutsceneKey } from '../../../packages/shared/src/genai/cutscene-key.ts';
import { stableJson } from '../../ci/missions/build.ts';
import { loadLintBase } from '../../ci/prompt-lint.ts';
import { toolsRoot } from '../../ci/lib/common.ts';
import { buildCutsceneIndex, selectProvider, type IndexInputs } from '../cutscene-index/build.ts';
import { runCutsceneIndex, uploadRequests } from '../cutscene-index/cli.ts';
import type { ReadyPort } from '../cutscene-index/carry-over.ts';
import { loadCutsceneContent, loadCutsceneRefs, loadTemplates } from '../cutscene-index/refs.ts';
import { memorySoulFacts, type SoulFacts } from '../cutscene-index/soul-facts.ts';
import { cutsceneIndexFindings } from '../cutscene-index/verify.ts';

const root = toolsRoot;
const registry = JSON.parse(readFileSync(path.join(root, 'config/genai-endpoints.json'), 'utf8')) as GenAiRegistry;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const soul = (over: Partial<SoulFacts> = {}): SoulFacts => ({ id: 'npc_test', soulVersion: 1, tier: 'original', visualBrief: 'A person in a gray jumpsuit with a clipboard.', killed: [], ...over });
const ref = (over: Partial<CutsceneRef> = {}): CutsceneRef => ({
  id: 'cut.story.m.dev.sample.intro', hook: 'story.beat', template: 'story.beat@1', cast: ['npc_test'], stage: 'beat.cut.story.m.dev.sample.intro@1', move: null,
  slots: { time_of_day: 'afternoon', weather: 'clear', mood: 'calm', action_1: 'a person crosses a plaza', camera_1: 'slow push-in', action_2: 'the person stops', camera_2: 'static medium shot' },
  fallback: 'm.dev.sample.intro', cues: [{ line: 'line.m.dev.sample.cut.intro.1', startMs: 0, endMs: 1000, kind: 'dialogue' }], audio: 'engine', prefetch: 'onTrigger', priority: 1, skippable: true, ...over,
});

const notReady: ReadyPort = { has: () => Promise.resolve(false) };
const readyKeys = (...keys: string[]): ReadyPort => ({ has: (k) => Promise.resolve(keys.includes(k)) });

function inputs(over: Partial<IndexInputs> = {}): IndexInputs {
  const content = loadCutsceneContent(root);
  return {
    release: 'r1', builtAt: 1_000, refs: [ref()], templates: loadTemplates(root), souls: memorySoulFacts([soul()]), registry: clone(registry),
    seeds: {}, places: { 'beat.cut.story.m.dev.sample.intro': 'a civic plaza' }, styles: content.styles, plates: {}, directors: new Set(['m.dev.sample.intro']),
    previous: null, ready: notReady, lint: { ...loadLintBase(root, {}), names: [] }, ...over,
  };
}

describe('cutscene index builder', () => {
  it('builds an entry, a request and a catalog key, and is byte-identical on a rerun', async () => {
    const a = await buildCutsceneIndex(inputs());
    const b = await buildCutsceneIndex(inputs());
    expect(a.problems).toEqual([]);
    expect(stableJson(a.index)).toBe(stableJson(b.index));
    expect(stableJson(a.requests)).toBe(stableJson(b.requests));
    expect(a.index.entries).toHaveLength(1);
    const e = a.index.entries[0]!;
    expect(e.key).toBe(cutsceneKey(e.keyInput));
    expect(e.provider).toBe(registry.defaults.videoProvider);
    expect(e.durationMs).toBe(14_000);
    expect(a.requests[0]?.key).toBe(e.key);
    expect(a.requests[0]?.shots).toHaveLength(2);
    expect(a.catalogKeys).toEqual([e.key]);
  });

  it('the public index holds no prompt and no URL; the private request holds the filled prompts, lint clean', async () => {
    const r = await buildCutsceneIndex(inputs());
    const pub = stableJson(r.index);
    expect(pub).not.toMatch(/https?:\/\//);
    expect(pub).not.toMatch(/prompt/i);
    const shot = r.requests[0]!.shots[0]!;
    expect(shot.prompt).toContain('a civic plaza');
    expect(shot.prompt).toContain('in the afternoon');
    expect(shot.prompt).toContain('A person in a gray jumpsuit');
    expect(shot.prompt).not.toContain('{');
    // shot one keeps its own action and drops the other shot's
    expect(shot.prompt).toContain('a person crosses a plaza');
    expect(shot.prompt).not.toContain('the person stops');
    expect(r.requests[0]!.shots[1]!.prompt).toContain('the person stops');
    expect(r.requests[0]!.budgetUsdMicros).toBe(Math.round(14 * Math.round(registry.videoProviders[registry.defaults.videoProvider]!.price.usdPerS * 1e6) * 1.5) + 2 * 39_600);
  });

  it('a not-ready desired key with a still-valid previous key keeps the previous key, marked stale', async () => {
    const first = await buildCutsceneIndex(inputs());
    const prevKey = first.index.entries[0]!.key;
    // an endpoint re-pin of the video endpoint: new desired key
    const repinned = clone(registry);
    repinned.endpoints['minimax/h3/image-to-video'] = { ...clone(Object.values(registry.endpoints)[0]!), id: 'minimax/h3/image-to-video', pinnedUpdatedAt: '2026-11-01T00:00:00Z' };
    const second = await buildCutsceneIndex(inputs({ previous: first.index, registry: repinned, release: 'r2' }));
    expect(second.problems).toEqual([]);
    const e = second.index.entries[0]!;
    expect(e.key).toBe(prevKey);
    expect(e.stale).toBe(true);
    expect(second.staleRefs).toEqual([e.ref]);
    // the desired key is still planned for prewarm, and both keys are in the catalog
    expect(second.requests[0]!.key).not.toBe(prevKey);
    expect(second.catalogKeys).toContain(prevKey);
    expect(second.catalogKeys).toContain(second.requests[0]!.key);
    // once the desired key is ready it wins and the stale mark goes
    const third = await buildCutsceneIndex(inputs({ previous: second.index, registry: repinned, release: 'r3', ready: readyKeys(second.requests[0]!.key) }));
    expect(third.index.entries[0]!.key).toBe(second.requests[0]!.key);
    expect(third.index.entries[0]!.stale).toBeUndefined();
  });

  it('a soulVersion change or a tier change yields the desired key', async () => {
    const first = await buildCutsceneIndex(inputs());
    const bumped = await buildCutsceneIndex(inputs({ previous: first.index, souls: memorySoulFacts([soul({ soulVersion: 2 })]) }));
    expect(bumped.index.entries[0]!.key).not.toBe(first.index.entries[0]!.key);
    expect(bumped.index.entries[0]!.stale).toBeUndefined();
    const tier = await buildCutsceneIndex(inputs({ previous: first.index, souls: memorySoulFacts([soul({ tier: 'parody' })]) }));
    expect(tier.index.entries[0]!.stale).toBeUndefined();
    expect(tier.index.entries[0]!.key).not.toBe(first.index.entries[0]!.key);
  });

  it('a killed character suppresses the entry and its request', async () => {
    const first = await buildCutsceneIndex(inputs());
    const killed = await buildCutsceneIndex(inputs({ previous: first.index, souls: memorySoulFacts([soul({ killed: ['cutscene'] })]) }));
    expect(killed.index.entries).toEqual([]);
    expect(killed.requests).toEqual([]);
    expect(killed.suppressed).toEqual(['cut.story.m.dev.sample.intro']);
    expect(killed.catalogKeys).toEqual([]);
  });

  it('a delisted provider drops the previous key', async () => {
    const first = await buildCutsceneIndex(inputs());
    const prevKey = first.index.entries[0]!.key;
    // the default provider is blocked: selection moves to the next usable one, and the previous entry (default provider) is not carried
    const reg = clone(registry);
    reg.videoProviders[reg.defaults.videoProvider]!.licence.status = 'blocked';
    const second = await buildCutsceneIndex(inputs({ previous: first.index, registry: reg }));
    expect(second.index.entries[0]!.provider).not.toBe(first.index.entries[0]!.provider);
    expect(second.index.entries[0]!.key).not.toBe(prevKey);
    expect(second.index.entries[0]!.stale).toBeUndefined();
    expect(second.catalogKeys).not.toContain(prevKey);
    // no usable provider at all is a problem
    const none = clone(registry);
    for (const p of Object.values(none.videoProviders)) p.licence.status = 'blocked';
    expect((await buildCutsceneIndex(inputs({ registry: none }))).problems).toContain('no usable video provider in the registry');
  });

  it('fails a ref without a fallback DirectorScript, one with a previs/ input, an unknown template and a prompt that breaks the lint', async () => {
    const noFallback = await buildCutsceneIndex(inputs({ directors: new Set() }));
    expect(noFallback.problems.join('\n')).toMatch(/no fallback DirectorScript/);
    const previs = await buildCutsceneIndex(inputs({ plates: { 'beat.cut.story.m.dev.sample.intro': { sha256: 'a'.repeat(64), ref: 'previs/plate.png' } } }));
    expect(previs.problems.join('\n')).toMatch(/references previs\//);
    const tpl = await buildCutsceneIndex(inputs({ refs: [ref({ template: 'story.nope@1' })] }));
    expect(tpl.problems.join('\n')).toMatch(/unknown template/);
    const banned = await buildCutsceneIndex(inputs({ refs: [ref({ slots: { ...ref().slots, action_1: 'a person holds a pistol' } })] }));
    expect(banned.problems.join('\n')).toMatch(/prompt lint \(rule 2\)/);
    const missingSlot = await buildCutsceneIndex(inputs({ refs: [ref({ slots: { time_of_day: 'afternoon' } })] }));
    expect(missingSlot.problems.join('\n')).toMatch(/slot weather has no value/);
  });

  it('a pinned seed and a plate change the key', async () => {
    const base = (await buildCutsceneIndex(inputs())).index.entries[0]!.key;
    const seeded = (await buildCutsceneIndex(inputs({ seeds: { 'cut.story.m.dev.sample.intro': 7 } }))).index.entries[0]!.key;
    const plated = (await buildCutsceneIndex(inputs({ plates: { 'beat.cut.story.m.dev.sample.intro': { sha256: 'b'.repeat(64) } } }))).index.entries[0]!.key;
    expect(new Set([base, seeded, plated]).size).toBe(3);
  });

  it('selects the first cleared provider, else the default one', () => {
    expect(selectProvider(registry)?.key).toBe(registry.defaults.videoProvider);
    expect(selectProvider(registry)?.cleared).toBe(false);
    const cleared = clone(registry);
    cleared.videoProviders['ltx25.fast']!.licence.status = 'cleared';
    expect(selectProvider(cleared)).toMatchObject({ key: 'ltx25.fast', cleared: true });
  });
});

describe('the repository index', () => {
  it('the shipped refs build without problems and the shipped index matches (--check)', async () => {
    const refs = await loadCutsceneRefs(root);
    expect(refs.map((r) => r.id)).toContain('cut.story.m.dev.sample.intro');
    const log: string[] = [];
    const code = await runCutsceneIndex({ root, release: 'dev', builtAt: 1, check: true, log: (l) => void log.push(l), env: {} });
    expect(log.filter((l) => !l.startsWith('SKIP'))).toEqual([]);
    expect(code).toBe(0);
    expect(cutsceneIndexFindings(root).findings).toEqual([]);
  });
});

describe('check:assets rules for the index and the SKIP upload line', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'dv-cidx-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const write = (idx: unknown): string => {
    const dir = path.join(tmp, `r${Math.random().toString(36).slice(2)}`);
    mkdirSync(path.join(dir, 'assets/src/data/cutscene-index'), { recursive: true });
    writeFileSync(path.join(dir, 'assets/src/data/cutscene-index/index.json'), JSON.stringify(idx));
    return dir;
  };
  const entry = { ref: 'cut.a', key: 'a'.repeat(64), fallback: 'x' };

  it('flags a previs/ reference, a URL, a prompt, a missing fallback and a duplicate', () => {
    const bad = cutsceneIndexFindings(write({ schema: 'cutscene-index/1', entries: [entry, { ...entry, fallback: '', note: 'previs/x https://a.b', prompt: 'p' }] }));
    expect(bad.findings.map((f) => f.rule).sort()).toEqual(['cutscene-index-duplicate', 'cutscene-index-fallback', 'cutscene-index-previs', 'cutscene-index-prompt', 'cutscene-index-url'].sort());
    expect(cutsceneIndexFindings(write({ schema: 'cutscene-index/1', entries: [entry] })).findings).toEqual([]);
  });

  it('prints SKIP without the R2 keys and calls rclone copyto with them', () => {
    const log: string[] = [];
    expect(uploadRequests({ root, release: 'dev', env: {}, log: (l) => log.push(l) }, 'x.json')).toBe(false);
    expect(log[0]).toMatch(/^SKIP cutscene-requests upload: R2_ACCESS_KEY_ID/);
    const calls: { cmd: string; args: string[] }[] = [];
    const ok = uploadRequests(
      { root, release: 'dev', env: { R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', CLOUDFLARE_ACCOUNT_ID: 'acct' }, log: (l) => log.push(l), run: (cmd, args) => (calls.push({ cmd, args }), { status: 0 }) },
      'x.json',
    );
    expect(ok).toBe(true);
    expect(calls[0]).toEqual({ cmd: 'rclone', args: ['copyto', 'x.json', 'r2:tha-bay-private-staging/cutscene-requests/dev.json'] });
  });
});
