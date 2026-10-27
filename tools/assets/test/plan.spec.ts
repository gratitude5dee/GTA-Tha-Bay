/** assets:gen plan (M10a1 AC-1 and AC-2): zero vendor calls, the DL-172 refusal, blocked entries, and the ledger line. */
import { describe, expect, it, vi } from 'vitest';
import type { NpcRosterEntry } from '../../../packages/shared/src/contracts/c10-npc.ts';
import type { GenAiRegistry } from '../../../packages/shared/src/genai/registry.ts';
import { GENAI_REGISTRY } from '../../../services/pipeline/src/registry.ts';
import { LEAN_PENDING_ENDPOINTS } from '../../../services/pipeline/src/steps/character.ts';
import type { CharacterSubject } from '../../../services/pipeline/src/steps/character.ts';
import { repoRoot } from '../../ci/run.ts';
import { main } from '../gen/cli.ts';
import type { LedgerRow } from '../gen/ledger.ts';
import { planBatch, renderPlan, type LoadedEntry } from '../gen/plan.ts';

const brief = 'Lean performer in a yellow jacket over a black hoodie, round glasses and white sneakers.';

function entry(id: string, over: Partial<NpcRosterEntry> = {}, subject: Partial<CharacterSubject> = {}): LoadedEntry {
  const e: NpcRosterEntry = { id, soul: `content/npcs/${id}/soul.md`, status: 'active', tier: 'fictionalized', basis: 'original', hero: false, pipeline: 'standard', priority: 2, research: 'none', standIn: null, modes: ['story'], ...over };
  return {
    entry: e, problem: null,
    subject: { slug: id, tier: 'original', soulVersion: 1, visualBrief: brief, heightM: 1.7, moves: [], standIn: null, pipeline: 'standard', hero: false, killed: [], ...subject },
  };
}

const row = (usdMicros: number): LedgerRow => ({ schema: 'fal-spend/1', kind: 'import', at: '2026-10-27T00:00:00Z', line: 'characters', usdMicros, ref: `fixture:${usdMicros}` });
const gate = (registry: GenAiRegistry) => ({ falMode: 'mock' as const, environment: 'dev', registry, lintPrompt: () => ({ ok: true }) });

/** The registry with the mesh price raised until a Standard character estimates 3,800,000 micros. */
function dearRegistry(): GenAiRegistry {
  const r = structuredClone(GENAI_REGISTRY);
  const mesh = Object.values(r.endpoints).find((e) => e.role === 'mesh');
  if (mesh === undefined) throw new Error('no mesh endpoint');
  mesh.price.usd = 1.266705;
  return r;
}

describe('assets:gen plan on the roster (AC-1)', () => {
  it('prints jobs, job keys, estimates and verdicts for every Standard slug, with no network request, and exits 0', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('the plan must not touch the network')));
    const logs: string[] = [];
    const code = await main(['plan', '--roster', 'content/npcs/roster.json', '--tier', 'standard'], { FAL_MODE: 'mock' }, fetchSpy as never, (l) => logs.push(l), { root: repoRoot });
    expect(code).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    const text = logs.join('\n');
    expect(text).toMatch(/zero vendor calls; zero network requests/);
    expect(text).toMatch(/canary-mc \[standard\] ok\s+verdict ok\s+estimate \$3\.67 \(3,666,590 micros\)/);
    for (const stage of ['sheet', 'portrait', 'mouth_atlas', 'mesh', 'rig']) expect(text).toMatch(new RegExp(`${stage}\\s+\\S+\\s+.*planKey [0-9a-f]{16}`));
  });

  it('prices a Standard character at the spec figure of $3.67 and a Lean one at $1.05', async () => {
    const r = await planBatch({ entries: [entry('s1'), entry('l1', { pipeline: 'lean' }, { pipeline: 'lean' })], tier: 'all', registry: GENAI_REGISTRY, ledgerRows: [], gate: { ...gate(GENAI_REGISTRY), environment: 'dev' } });
    const std = r.rows.find((x) => x.slug === 's1');
    const lean = r.rows.find((x) => x.slug === 'l1');
    expect(std?.estimateMicros).toBe(3_666_590);
    expect(lean?.estimateMicros).toBe(1_052_000);
  });
});

describe('assets:gen plan refusals (AC-2)', () => {
  it('refuses the over-DL-172 estimate, lists research and killed slugs as blocked, and refuses a batch past the characters line', async () => {
    const registry = dearRegistry();
    const result = await planBatch({
      entries: [
        entry('dear'),
        entry('pending-research', { research: 'pending', basis: 'real_person' }),
        entry('killed-one', {}, { killed: ['all'] }),
      ],
      tier: 'standard', registry, ledgerRows: [row(40_000_000)], gate: gate(registry),
    });
    const byId = Object.fromEntries(result.rows.map((r) => [r.slug, r]));
    expect(byId['dear']?.estimateMicros).toBe(3_800_000);
    expect(byId['dear']?.status).toBe('refused');
    expect(byId['dear']?.reason).toMatch(/DL-172/);
    expect(byId['pending-research']?.reason).toBe('blocked:research');
    expect(byId['killed-one']?.reason).toMatch(/^blocked:KILLED/);
    // blocked entries keep their estimate reserved; the refused one is not part of the batch
    expect(result.batchMicros).toBe(byId['pending-research']!.estimateMicros + byId['killed-one']!.estimateMicros);
    expect(result.refused).toMatch(/passes the characters line of 42,000,000 micros/);
    expect(renderPlan(result).join('\n')).toMatch(/refused: 40,000,000 micros spent/);
  });

  it('refuses a batch that would pass the programme cap even when the line has room', async () => {
    const rows: LedgerRow[] = [
      { schema: 'fal-spend/1', kind: 'import', at: '2026-10-27T00:00:00Z', line: 'cutscenes', usdMicros: 38_000_000, ref: 'a' },
      { schema: 'fal-spend/1', kind: 'import', at: '2026-10-27T00:00:00Z', line: 'vehiclesProps', usdMicros: 14_000_000, ref: 'b' },
      { schema: 'fal-spend/1', kind: 'import', at: '2026-10-27T00:00:00Z', line: 'spike', usdMicros: 4_000_000, ref: 'c' },
      { schema: 'fal-spend/1', kind: 'import', at: '2026-10-27T00:00:00Z', line: 'buffer', usdMicros: 2_000_000, ref: 'd' },
      row(40_000_000),
    ];
    const r = await planBatch({ entries: [entry('one')], tier: 'standard', registry: GENAI_REGISTRY, ledgerRows: rows, gate: gate(GENAI_REGISTRY) });
    expect(r.refused).not.toBeNull();
  });

  it('lists a missing soul as blocked:soul and skips entries that are not active', async () => {
    const missing: LoadedEntry = { entry: entry('gone').entry, subject: null, problem: 'soul file content/npcs/gone/soul.md is missing' };
    const draft = entry('draft', { status: 'draft' });
    const r = await planBatch({ entries: [missing, draft], tier: 'all', registry: GENAI_REGISTRY, ledgerRows: [], gate: gate(GENAI_REGISTRY) });
    expect(r.rows.map((x) => x.slug)).toEqual(['gone']);
    expect(r.rows[0]?.reason).toMatch(/^blocked:soul/);
  });

  it('shows the Lean mesher and rigger as blocked while they are pending (not yet in the registry file)', async () => {
    const lean = entry('lean-one', { pipeline: 'lean' }, { pipeline: 'lean' });
    const r = await planBatch({ entries: [lean], tier: 'lean', registry: GENAI_REGISTRY, ledgerRows: [], gate: { falMode: 'mock', environment: 'dev', registry: GENAI_REGISTRY, lintPrompt: () => ({ ok: true }) } });
    expect(r.rows[0]?.reason).toMatch(/^blocked:ENDPOINT_NOT_CLEARED/);
    expect(Object.keys(LEAN_PENDING_ENDPOINTS)).toEqual(['tripo3d/h3.1/multiview-to-3d', 'fal-ai/meshy/rigging']);
    expect(GENAI_REGISTRY.endpoints['tripo3d/h3.1/multiview-to-3d']).toBeUndefined();
  });
});
