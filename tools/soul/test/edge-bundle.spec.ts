import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../../packages/shared/src/hash.ts';
import { repoRoot } from '../../../packages/shared/test/npc/helpers/souls.ts';
import { buildEdgeBundle, EDGE_BUNDLE_PATH, renderEdgeBundle, runEdgeBundle } from '../src/edge-bundle.ts';

// M06a3: services/edge/src/generated/npc-fixtures.json (block A and the npc_test soul that the dialogue Worker bundles for previews and tests)
// is what the current sources produce, and matches the L14 baseline of content/npcs/souls.index.json.
describe('npc:edge-bundle', () => {
  it('is current: the committed file equals a fresh build', async () => {
    const r = await runEdgeBundle(repoRoot, true);
    expect(r.message).toContain('current');
    expect(r.ok).toBe(true);
  });

  it('carries the prompt bytes whose sha256 the soul index lists for npc_test', async () => {
    const bundle = await buildEdgeBundle(repoRoot);
    const index = JSON.parse(readFileSync(path.join(repoRoot, 'content/npcs/souls.index.json'), 'utf8')) as { souls: Record<string, { soulVersion: number; promptSha256: string }> };
    const soul = bundle.souls['npc_test']!;
    expect(sha256Hex(soul.prompt)).toBe(index.souls['npc_test']!.promptSha256);
    expect(soul.promptSha256).toBe(index.souls['npc_test']!.promptSha256);
    expect(soul.soulVersion).toBe(index.souls['npc_test']!.soulVersion);
  });

  it('holds block A as the public example loadRules reads, and renders the same text twice', async () => {
    const a = await buildEdgeBundle(repoRoot);
    expect(a.rules.text.startsWith('<role>')).toBe(true);
    expect(a.rules.text).not.toContain('<rules>');
    expect(renderEdgeBundle(a)).toBe(renderEdgeBundle(await buildEdgeBundle(repoRoot)));
    expect(EDGE_BUNDLE_PATH).toBe('services/edge/src/generated/npc-fixtures.json');
  });

  it('bundles no private character: only the original npc_test and ro-batista (the t1 voiced preview soul, M06a4)', async () => {
    const bundle = await buildEdgeBundle(repoRoot);
    expect(Object.keys(bundle.souls)).toEqual(['npc_test', 'ro-batista']);
    for (const s of Object.values(bundle.souls)) expect((s.compiled as { basis: string }).basis).toBe('original');
  });
});
